import { buildEvidenceGapResponse } from "@/domain/ai/evidence-gap-response";
import { describe, expect, it } from "vitest";

import { chatRequestSchema } from "@/features/ai/schemas";
import { buildDirectChatResponse } from "@/server/ai/chat-turn-guidance";

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
      expected: ["rated power in kW", "positive value", "CHN", "Non-road", "retain your country, application and date"],
      locale: "en" as const,
      text: "Check current CHN non-road regulations.",
    },
    {
      expected: ["CHN", "100 kW", "实际用途", "不用重复国家和功率"],
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
