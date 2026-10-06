import { describe, expect, it } from "vitest";

import { CHAT_HISTORY_MAX_AGE_MS, CHAT_HISTORY_MAX_BYTES, parseChatHistory, serializeChatHistory } from "@/features/ai/chat-history";
import { prepareSalesChatRequestMessages, type SalesChatUiMessage } from "@/features/ai/released-attachment";
import { buildToolErrorResult } from "@/server/ai/tool-results";

const now = new Date("2026-10-06T04:00:00.000Z");
const contextKey = '{"demoMode":false}';
const sessionId = "d2870b5e-944c-4aba-b14d-ff9d3449a4e2";
const messages: SalesChatUiMessage[] = [
  { id: "question", role: "user", parts: [{ type: "text", text: "Compare CHN and JPN construction 120 kW as of 2026-08-13." }] },
  { id: "answer", role: "assistant", parts: [{ type: "text", text: "Evidence was checked as of 2026-08-13." }] },
];
const serialized = () => serializeChatHistory({ contextKey, sessionId, messages }, now)!;

describe("bounded tab-local conversation snapshots", () => {
  it("restores a complete conversation and sends only trusted user history", () => {
    const snapshot = parseChatHistory(serialized(), contextKey, now);
    expect(snapshot).toMatchObject({ sessionId, messages });
    expect(prepareSalesChatRequestMessages(snapshot!.messages)).toEqual([messages[0]]);
  });

  it("excludes attachment bytes, reasoning, and provider metadata", () => {
    const withAttachments: SalesChatUiMessage[] = [
      { ...messages[0]!, metadata: { marker: "private-provider-marker" }, parts: [
        { type: "text", text: "Read this attachment." },
        { type: "file", filename: "manual.txt", mediaType: "text/plain", url: "data:text/plain;base64,cHJpdmF0ZS1hdHRhY2htZW50" },
      ] },
      { ...messages[1]!, parts: [
        { type: "reasoning", text: "private-reasoning-marker" },
        { type: "text", text: "Summary." },
      ] },
    ];
    const value = serializeChatHistory({ contextKey, sessionId, messages: withAttachments }, now)!;
    expect(value).not.toContain("base64");
    expect(value).not.toContain("private-provider-marker");
    expect(value).not.toContain("private-reasoning-marker");
    const restored = parseChatHistory(value, contextKey, now)!;
    expect(restored.messages[0]!.parts).toContainEqual({ type: "data-releasedAttachment", data: { filename: "manual.txt" } });
    expect(prepareSalesChatRequestMessages(restored.messages)[0]!.parts).toEqual([{ type: "text", text: "Read this attachment." }]);
  });

  it("preserves validated tool cards and rejects mismatched stored inputs", () => {
    const input = { countryIso3: "CHN", asOf: "2026-08-13", topics: ["market"] };
    const output = buildToolErrorResult("getCountryProfile", "2026-08-13", input);
    const withTool: SalesChatUiMessage[] = [messages[0]!, { ...messages[1]!, parts: [
      { type: "dynamic-tool", toolName: "getCountryProfile", toolCallId: "call-1", state: "output-available", input, output },
      ...messages[1]!.parts,
    ] }];
    const value = serializeChatHistory({ contextKey, sessionId, messages: withTool }, now)!;
    expect(parseChatHistory(value, contextKey, now)?.messages[1]!.parts[0]).toMatchObject({ output });
    const corrupt: unknown = JSON.parse(value.replace('"countryIso3":"CHN"', '"countryIso3":"DEU"'));
    expect(parseChatHistory(JSON.stringify(corrupt), contextKey, now)).toBeNull();
  });

  it("does not restore a different country/query context", () => {
    expect(parseChatHistory(serialized(), '{"countryIso3":"DEU"}', now)).toBeNull();
  });

  it.each([
    new Date(now.getTime() + CHAT_HISTORY_MAX_AGE_MS),
    new Date(now.getTime() - 1),
    new Date(Number.NaN),
  ])("rejects expired or invalid observation times: %s", (time) => {
    expect(parseChatHistory(serialized(), contextKey, time)).toBeNull();
  });

  it("rejects invalid, oversized and unsupported snapshots without throwing", () => {
    for (const value of [null, "not JSON", "x".repeat(CHAT_HISTORY_MAX_BYTES + 1),
      serialized().replace('"version":1', '"version":2'),
      serialized().replace('"role":"user"', '"role":"system"')]) {
      expect(parseChatHistory(value, contextKey, now)).toBeNull();
    }
  });

  it("refuses incomplete or overlong conversations instead of dropping their original context", () => {
    expect(serializeChatHistory({ contextKey, sessionId, messages: [messages[0]!] }, now)).toBeNull();
    expect(serializeChatHistory({ contextKey, sessionId, messages: Array.from({ length: 26 }, (_, index) => ({
      ...messages[index % 2]!, id: `message-${index}`,
    })) }, now)).toBeNull();
  });
});
