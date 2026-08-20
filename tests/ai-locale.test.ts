import { describe, expect, it } from "vitest";

import { chatRequestSchema } from "@/features/ai/schemas";
import { buildDirectChatResponse } from "@/server/ai/chat-turn-guidance";
import {
  buildEvidenceGapResponse,
  buildSalesChatInstructions,
} from "@/server/ai/sales-chat";

describe("AI locale contract", () => {
  it("accepts only supported optional chat locales and defaults to English", () => {
    const base = {
      messages: [{ id: "m1", parts: [{ text: "hello", type: "text" }], role: "user" }],
      sessionId: "9fb7d93c-0b56-4708-8d04-6435919791a0",
    };

    expect(chatRequestSchema.parse(base).locale).toBe("en");
    expect(chatRequestSchema.parse({ ...base, locale: "zh-CN" }).locale).toBe("zh-CN");
    expect(chatRequestSchema.safeParse({ ...base, locale: "fr" }).success).toBe(false);
  });

  it("builds an English prompt with the same evidence and routing boundaries", () => {
    const prompt = buildSalesChatInstructions("CHN", "en");

    expect(prompt).toContain('locale="en"');
    expect(prompt).toContain("pass that exact date to every tool that supports asOf");
    expect(prompt).toContain("must call only searchKnowledgeBase");
    expect(prompt).toContain(
      "For information only; not a substitute for formal certification or legal advice.",
    );
  });

  it("localizes direct guidance without weakening required parameters", () => {
    const response = buildDirectChatResponse({
      locale: "en",
      selectedCountryIso3: "CHN",
      text: "hello",
    });

    expect(response).toContain("structured facts and traceable sources");
    expect(response).toContain("CHN");
  });

  it("localizes fixed fail-closed evidence gaps and disclaimers", () => {
    const response = buildEvidenceGapResponse([], false, false, "en");
    const responseWithSteps = buildEvidenceGapResponse([], true, false, "en");

    expect(response).toContain("lacks enough evidence");
    expect(response).toContain(
      "For information only; not a substitute for formal certification or legal advice.",
    );
    expect(response).not.toContain("信息参考");
    expect(responseWithSteps).toContain("Next steps:\n");
    expect(responseWithSteps).not.toContain("Next steps：");
  });
});
