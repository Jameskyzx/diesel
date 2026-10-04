import { describe, expect, it } from "vitest";
import { buildFinalAnswerGuidance } from "@/server/ai/sales-chat-prompt";

describe("evidence-backed final answer task guidance", () => {
  it.each(["en", "zh-CN"] as const)("names both supported tasks without claiming positive outcomes in %s", locale => {
    const guidance = buildFinalAnswerGuidance(["compareRegulations", "generateSalesBrief"], locale);
    expect(guidance).toContain(locale === "en" ? "regulatory requirements" : "法规要求");
    expect(guidance).toContain(locale === "en" ? "sales brief" : "销售简报");
    expect(guidance).toContain(locale === "en" ? "never replace unknown outcomes" : "未知结果不得改成肯定结论");
    expect(guidance).not.toMatch(/DEMO-ENG-100|2026-08-13|CHN|BRA|100 kW|100 分/u);
  });
  it("does not introduce unrelated tasks", () => {
    expect(buildFinalAnswerGuidance(["getCountryProfile", "searchKnowledgeBase"])).toBe("");
    expect(buildFinalAnswerGuidance(["compareRegulations"])).not.toContain("sales brief");
    expect(buildFinalAnswerGuidance(["generateSalesBrief"], "zh-CN")).not.toContain("法规要求的核对");
  });
});
