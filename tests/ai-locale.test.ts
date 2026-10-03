import { describe, expect, it } from "vitest";

import { chatRequestSchema } from "@/features/ai/schemas";
import { buildDirectChatResponse } from "@/server/ai/chat-turn-guidance";
import {
  buildEvidenceGapResponse,
  buildSalesChatInstructions,
} from "@/server/ai/sales-chat";

describe("AI locale contract", () => {
  it.each([
    ["en", "without ranking countries as stricter/weaker", 'never "no legal limit"'],
    ["zh-CN", "不排名哪个国家更严格或更宽松", "不得写成“不设限值”"],
  ] as const)("keeps regulation comparisons scoped to returned facts in %s", (locale, ranking, absence) => {
    const prompt = buildSalesChatInstructions(null, locale);
    expect(prompt).toContain(ranking);
    expect(prompt).toContain(absence);
  });

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

  it.each([
    { locale: "en" as const, clauses: [
      "plain, complete sentence", "market metrics or market comparison",
      "regulatory requirements", "opportunity score", "at most four short evidence bullets",
      "Do not dump tool names, JSON property names, internal UUIDs, reason-code lists",
      "Put each source title in quotation marks", "Do not insert bold/code formatting",
    ] },
    { locale: "zh-CN" as const, clauses: [
      "完整中文句子", "市场指标或市场比较", "法规要求", "机会评分",
      "最多四条简短证据", "不要堆砌英文工具名、JSON 字段名、内部 UUID 或原因代码",
      "用引号逐字引用一次", "不加粗、不嵌入代码",
    ] },
  ])("requires concise reader-facing $locale explanations without schema dumps", ({ locale, clauses }) => {
    const prompt = buildSalesChatInstructions(null, locale);
    expect(prompt).toContain('version="sales-chat-system-v8"');
    for (const clause of clauses) expect(prompt).toContain(clause);
    // Production instructions must be domain-wide, never benchmark fixtures.
    expect(prompt).not.toMatch(/DEMO-ENG-100|DEMO_ADDRESSABLE_UNITS|2026-08-13|country-overview-china/u);
  });

  it.each([
    { locale: "en" as const, clauses: [
      "regulatory/certification fit and recorded supply availability separately",
      "conditional vocabulary rules, not findings", "never infer a positive result",
      "Preserve unknown and not-fit outcomes", "does not establish inventory, lead time",
      "not ready for supply with the returned reason", "never recalculate scores",
    ] },
    { locale: "zh-CN" as const, clauses: [
      "分别解释法规/认证适配与记录中的供应可用性", "只是条件化术语说明，不是个案事实",
      "不得据此推断肯定结论", "保留未知、不适配", "不代表库存、交期",
      "不可供货", "评分禁止重算",
    ] },
  ])("keeps dual-axis decisions conditional and scoped in $locale", ({ locale, clauses }) => {
    const prompt = buildSalesChatInstructions(null, locale);
    for (const clause of clauses) expect(prompt).toContain(clause);
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
