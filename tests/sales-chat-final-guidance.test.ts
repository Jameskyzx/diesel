import { describe, expect, it } from "vitest";
import { buildFinalAnswerGuidance, buildSalesChatInstructions } from "@/server/ai/sales-chat-prompt";

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
  it.each(["en", "zh-CN"] as const)("answers the latest explanation without repeating the entire comparison in %s", locale => {
    const guidance = buildFinalAnswerGuidance(["compareRegulations"], locale, "为什么HC和HC+NOx不能直接比？简单解释一下，我接下来需要准备什么？");
    expect(guidance).toContain(locale === "en" ? "2–4 short sentences" : "2–4 个短句");
    expect(guidance).toContain(locale === "en" ? "Do not repeat" : "不再逐国复述");
    expect(guidance).toContain(locale === "en" ? "validated evidence" : "本轮已验证证据");
    expect(guidance).toContain(locale === "en" ? "never assert they differ or match" : "不能声称两国测试循环不同或相同");
    expect(guidance).not.toContain(locale === "en" ? "including the returned scope" : "并包含工具返回的适用场景");
    const instructions = buildSalesChatInstructions(null, locale, undefined, "为什么HC和HC+NOx不能直接比？简单解释一下。");
    expect(instructions).toContain(locale === "en" ? "This is an explanation follow-up" : "本轮是解释追问");
    expect(instructions).not.toContain(locale === "en" ? "report each returned pollutant" : "法规对比逐项列出");
  });
});
