import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { serializeChatHistory, chatHistorySnapshotSchema } from "@/features/ai/chat-history";
import { comparisonSearch, parseComparisonQuery, savedAnalysisSchema, type SavedAnalysis } from "@/features/analyses/schemas";
import { ANALYSES_STORAGE_KEY, MAX_SAVED_ANALYSES, readAnalyses, saveAnalysis, writeAnalyses } from "@/features/analyses/storage";

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function analysis(): SavedAnalysis {
  const serialized = serializeChatHistory({ contextKey: "{}", sessionId: randomUUID(), messages: [
    { id: "u", role: "user", parts: [{ type: "text", text: "CHN regulations" }, { type: "file", mediaType: "text/plain", url: "data:text/plain;base64,c2VjcmV0", filename: "notes.txt" }] },
    { id: "a", role: "assistant", parts: [{ type: "reasoning", text: "PRIVATE_REASONING" }, { type: "text", text: "Evidence missing." }] },
  ] }, new Date("2020-01-01T00:00:00Z"))!;
  return savedAnalysisSchema.parse({ id: randomUUID(), version: 1, locale: "en", title: "Research",
    savedAt: "2020-01-01T00:00:00Z", payload: { kind: "chat", history: chatHistorySnapshotSchema.parse(JSON.parse(serialized)) } });
}

describe("explicitly saved local analyses", () => {
  it("preserves old snapshots without the tab cache TTL, excluding reasoning and attachment bytes", () => {
    const storage = memoryStorage();
    const saved = analysis();
    saveAnalysis(storage, saved);
    expect(readAnalyses(storage)).toEqual([saved]);
    const raw = storage.getItem(ANALYSES_STORAGE_KEY)!;
    expect(raw).toContain("2020-01-01");
    expect(raw).not.toContain("PRIVATE_REASONING");
    expect(raw).not.toContain("base64");
    expect(raw).toContain("notes.txt");
  });
  it("refuses a full archive without silently deleting old analyses", () => {
    const storage = memoryStorage();
    const existing = Array.from({ length: MAX_SAVED_ANALYSES }, analysis);
    writeAnalyses(storage, existing);
    expect(() => saveAnalysis(storage, analysis())).toThrow();
    expect(readAnalyses(storage)).toEqual(existing);
  });
  it("does not overwrite corrupt data and rejects unknown snapshot versions", () => {
    const storage = memoryStorage();
    storage.setItem(ANALYSES_STORAGE_KEY, "broken");
    expect(() => saveAnalysis(storage, analysis())).toThrow();
    expect(storage.getItem(ANALYSES_STORAGE_KEY)).toBe("broken");
    expect(savedAnalysisSchema.safeParse({ ...analysis(), version: 2 }).success).toBe(false);
  });
  it("rejects stored reasoning and raw attachments rather than rendering them", () => {
    const candidate = analysis();
    if (candidate.payload.kind !== "chat") throw new Error("Expected chat");
    const history = candidate.payload.history;
    for (const part of [{ type: "reasoning", text: "secret" }, { type: "file", url: "data:text/plain;base64,YQ==", mediaType: "text/plain" }]) {
      expect(savedAnalysisSchema.safeParse({ ...candidate, payload: { kind: "chat", history: { ...history, messages: [history.messages[0], { ...history.messages[1], parts: [part] }] } } }).success).toBe(false);
    }
  });
});

describe("shareable deterministic comparison conditions", () => {
  const valid = { countryIso3s: ["CHN", "BRA"], applicationScope: "non-road", asOf: "2026-08-13", powerKw: "120" };
  it("round-trips two or three distinct countries without a product or AI request", () => {
    for (const countries of [["CHN", "BRA"], ["CHN", "BRA", "DEU"]]) {
      const query = parseComparisonQuery({ ...valid, countryIso3s: [...countries, ""] })!;
      const params = new URLSearchParams(comparisonSearch(query));
      expect(parseComparisonQuery({ ...Object.fromEntries(params), countryIso3s: params.getAll("countryIso3s") })).toEqual(query);
    }
  });
  it.each([
    { countryIso3s: ["CHN"] }, { countryIso3s: ["CHN", "CHN"] },
    { countryIso3s: ["CHN", "BRA", "DEU", "JPN"] }, { countryIso3s: ["CHN", "oops"] },
    { powerKw: "-2" }, { asOf: "2026-02-30" }, { applicationScope: "made-up" },
    { powerKw: ["100", "120"] },
  ])("rejects ambiguous or invalid conditions: %j", variation => {
    expect(parseComparisonQuery({ ...valid, ...variation })).toBeNull();
  });
});
