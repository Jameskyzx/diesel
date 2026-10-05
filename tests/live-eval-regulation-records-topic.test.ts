import { describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { evaluateLiveEvalResponseContract } from "@/domain/ai/live-eval";

const testCase = salesChatLiveCases.find(({ id }) => id === "cross-country-regulation");
if (!testCase) throw new Error("Missing canonical regulation comparison case");
const responseContract = testCase.responseContract;
const disclaimer = "信息参考，不替代正式认证或法律意见。";
// Exact opening from run 7956de7a's public diagnostic; this is a topic
// regression, not reconstructed full-response citation or locale evidence.
const observedOpening = "截至 2026-08-13，本次查询针对 non-road 应用、100 kW 功率段，返回了中国和巴西的法规记录：中国有一条已生效的非道路 Stage A 法规（含 NOX 与 PM 限值）和一条已采纳但 2030 年才生效的 Stage C 法规；巴西有一条已生效的非道路 Stage A 法规（仅返回 NOX 限值）。以下为逐国差异说明，不作严格或宽松排名。";
const facts = "截至 2026-08-13，CHN 和 BRA，non-road 100 kW。";
const observe = (responseText: string) => evaluateLiveEvalResponseContract({
  expectedLocale: "zh-CN", responseContract, responseText,
});

describe("v26 regulation-records topic recognition", () => {
  it("recognizes the observed topic while demonstrating the v25 vocabulary omission", () => {
    expect(observe(observedOpening + disclaimer).responseGroundingPassed).toBe(true);
    const oldVocabulary = {
      ...responseContract,
      decisionAnchors: responseContract.decisionAnchors.map((anchor) => ({
        ...anchor, anyOf: anchor.anyOf.filter((term) => term !== "法规记录"),
      })),
    };
    expect(evaluateLiveEvalResponseContract({
      expectedLocale: "zh-CN", responseContract: oldVocabulary,
      responseText: observedOpening + disclaimer,
    }).missingResponseAnchorIds).toEqual(["decision:regulation-comparison"]);
  });

  it.each([
    ["中国", "美国", "fact:country-chn"],
    ["巴西", "德国", "fact:country-bra"],
    ["100 kW", "1100 kW", "fact:power-100-kw"],
    ["2026-08-13", "2026-08-14", "fact:date-2026-08-13"],
  ])("keeps %s independently binding", (before, after, anchor) => {
    const result = observe(observedOpening.replaceAll(before, after) + disclaimer);
    expect(result.responseGroundingPassed).toBe(false);
    expect(result.missingResponseAnchorIds).toContain(anchor);
  });

  it("does not substitute the topic for the requested scope or disclaimer", () => {
    expect(observe(facts.replace("non-road", "marine") + "法规记录为虚构 Demo。" + disclaimer)
      .missingResponseAnchorIds).toContain("fact:application-non-road");
    expect(observe(observedOpening).missingResponseAnchorIds).toContain("disclaimer:regulatory");
  });

  it.each([
    "> 法规记录为虚构 Demo。", "```text\n法规记录为虚构 Demo。\n```",
    "“法规记录为虚构 Demo。”", "`法规记录为虚构 Demo。`",
    "    法规记录为虚构 Demo。", "法规名称：虚构 Demo。",
  ])("does not get topical evidence from excluded or generic text: %s", (topic) => {
    expect(observe(`${facts}\n\n${topic}\n\n${disclaimer}`).missingResponseAnchorIds)
      .toContain("decision:regulation-comparison");
  });
});
