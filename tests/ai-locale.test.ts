import { describe, expect, it } from "vitest";

import { chatRequestSchema } from "@/features/ai/schemas";
import { buildDirectChatResponse } from "@/server/ai/chat-turn-guidance";
import {
  buildEvidenceGapResponse,
  buildSalesChatInstructions,
} from "@/server/ai/sales-chat";

describe("AI locale contract", () => {
  it("accepts only supported optional chat locales without overriding the request cookie fallback", () => {
    const base = {
      messages: [{ id: "m1", parts: [{ text: "hello", type: "text" }], role: "user" }],
      sessionId: "9fb7d93c-0b56-4708-8d04-6435919791a0",
    };

    expect(chatRequestSchema.parse(base).locale).toBeUndefined();
    expect(chatRequestSchema.parse({ ...base, locale: "zh-CN" }).locale).toBe("zh-CN");
    expect(chatRequestSchema.safeParse({ ...base, locale: "fr" }).success).toBe(false);
  });

  it.each([
    {
      locale: "en" as const,
      sourceLanguageContract:
        "Keep every source title and quoted source passage verbatim in its original language; do not translate either.",
    },
    {
      locale: "zh-CN" as const,
      sourceLanguageContract:
        "每个来源标题和引用的来源原文都必须逐字保留原始语言，两者均不得翻译。",
    },
  ])(
    "keeps source titles and quotations in their original language for $locale",
    ({ locale, sourceLanguageContract }) => {
      const prompt = buildSalesChatInstructions("CHN", locale);

      expect(prompt).toContain(`locale="${locale}"`);
      expect(prompt).toContain(sourceLanguageContract);
    },
  );

  it("builds an English prompt with the same evidence and routing boundaries", () => {
    const prompt = buildSalesChatInstructions("CHN", "en");

    expect(prompt).toContain("pass that exact date to every tool that supports asOf");
    expect(prompt).toContain("must call only searchKnowledgeBase");
    expect(prompt).toContain(
      "For information only; not a substitute for formal certification or legal advice.",
    );
  });

  it("defaults every optional AI locale boundary to English", () => {
    const prompt = buildSalesChatInstructions("CHN");
    const directResponse = buildDirectChatResponse({
      selectedCountryIso3: "CHN",
      text: "hello",
    });
    const evidenceGap = buildEvidenceGapResponse([], false);

    expect(prompt).toContain('locale="en"');
    expect(directResponse).toContain("structured facts and traceable sources");
    expect(evidenceGap).toContain("lacks enough evidence");
    expect(`${prompt}\n${directResponse}\n${evidenceGap}`).not.toMatch(
      /[\p{Script=Han}]/u,
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

  it.each([
    {
      expected: ["rated power in kW", "supplied together"],
      locale: "en" as const,
      text: "Check current CHN non-road regulations.",
    },
    {
      expected: ["应用场景", "成对提供"],
      locale: "zh-CN" as const,
      text: "核对 CHN 100 kW 当前法规。",
    },
    {
      expected: ["not filtered by application scope", "second country"],
      locale: "en" as const,
      text: "Show CHN non-road market data with no cross-country comparison.",
    },
    {
      expected: ["不能按应用场景过滤", "再提供一个国家"],
      locale: "zh-CN" as const,
      text: "不做跨国比较，只看 CHN non-road 市场数据。",
    },
  ])(
    "fails closed with localized partial-query guidance for $locale: $text",
    ({ expected, locale, text }) => {
      const response = buildDirectChatResponse({
        locale,
        selectedCountryIso3: null,
        text,
      });

      expect(response).not.toBeNull();
      for (const phrase of expected) {
        expect(response).toContain(phrase);
      }
    },
  );

  it("localizes fixed fail-closed evidence gaps and disclaimers", () => {
    const response = buildEvidenceGapResponse([], false, false, "en");
    const responseWithSteps = buildEvidenceGapResponse([], true, false, "en");
    const responseWithPrivateReasoning = buildEvidenceGapResponse(
      [],
      false,
      false,
      "en",
      true,
    );

    expect(response).toContain("lacks enough evidence");
    expect(response).toContain(
      "For information only; not a substitute for formal certification or legal advice.",
    );
    expect(response).not.toContain("信息参考");
    expect(responseWithSteps).toContain("Next steps:\n");
    expect(responseWithSteps).not.toContain("Next steps：");
    expect(responseWithPrivateReasoning).toContain(
      "withheld because it contained private reasoning markup",
    );
    expect(responseWithPrivateReasoning).toContain(
      "use only the structured evidence cards",
    );
    expect(responseWithPrivateReasoning).not.toContain("私有推理");
  });
});
