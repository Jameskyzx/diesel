import { describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { evaluateLiveEvalResponseContract, judgeLiveEvalCase, resolveLiveEvalResponseDisposition } from "@/domain/ai/live-eval";
import { prepareLiveEvalResponseText } from "@/domain/ai/live-eval-response-text";

const testCase = salesChatLiveCases.find(({ id }) => id === "multi-turn-country-conflict");
if (!testCase) throw new Error("Missing canonical country-switch case");
const responseContract = testCase.responseContract;
const facts = "截至 2026-08-13，BRA（巴西）non-road 100 kW。";
const topic = "现行法规为虚构演示规则；不代表真实监管要求。";
const disclaimer = "信息参考，不替代正式认证或法律意见。";

function response(body: string, context = facts) {
  return `${context}\n\n${body}\n\n${disclaimer}`;
}

function observe(responseText: string) {
  return evaluateLiveEvalResponseContract({ expectedLocale: "zh-CN", responseContract, responseText });
}

describe("current-regulation wording answers the retained single-country check", () => {
  it("preserves the exact multi-turn intent and its independent field requirements", () => {
    expect(testCase.userTexts).toEqual(["核对 non-road 100 kW 法规，截止 2026-08-13。", "国家改成 BRA，其他条件不变。"]);
    expect(testCase.expectedArgs).toEqual({ compareRegulations: {
      applicationScope: "non-road", asOf: "2026-08-13", countryIso3s: ["BRA"], powerKw: 100,
    } });
    expect(testCase.expectedEvidenceAllowed).toBe(true);
  });

  it("recognizes the same-run observed applicability and limit explanation", () => {
    const responseText = [
      "截至 2026-08-13，BRA（巴西）non-road 100 kW 柴油机适用的现行法规为“DEMO ONLY — Fictional Brazil Non-road Stage A”，其 NOX 限值为 4.000000 g/kWh。",
      "**法规名称**：DEMO ONLY — Fictional Brazil Non-road Stage A\n**状态**：effective（已生效）\n**适用性**：功率 0–600 kW\n**污染物限值**：NOX 4.000000 g/kWh",
      "上述数据均为虚构 Demo 数据，不是真实监管要求。", disclaimer,
    ].join("\n\n");
    expect(prepareLiveEvalResponseText(responseText).claims.some((claim) => claim.includes("适用的现行法规"))).toBe(true);
    // This retained excerpt diagnoses topic coverage, not the omitted full
    // response's locale or same-run citation metadata.
    expect(observe(responseText).responseGroundingPassed).toBe(true);
    expect(observe(responseText).missingResponseAnchorIds).toEqual([]);
  });

  it.each([topic, "**现行法规**：虚构演示规则。", "*   核对结果：\n    *   现行法规为虚构演示规则。"])(
    "recognizes the finite topic in supported visible prose: %s", (body) => {
      expect(observe(response(body))).toMatchObject({ responseGroundingPassed: true, responseLocalePassed: true });
    },
  );

  it.each([
    ["missing country", facts.replace("BRA（巴西）", ""), "fact:country-bra"],
    ["wrong country", facts.replace("BRA（巴西）", "USA（美国）"), "fact:country-bra"],
    ["missing scope", facts.replace("non-road", ""), "fact:application-non-road"],
    ["wrong scope", facts.replace("non-road", "marine"), "fact:application-non-road"],
    ["missing power", facts.replace("100 kW", ""), "fact:power-100-kw"],
    ["wrong power", facts.replace("100 kW", "1100 kW"), "fact:power-100-kw"],
    ["missing date", facts.replace("2026-08-13", ""), "fact:date-2026-08-13"],
    ["wrong date", facts.replace("2026-08-13", "2026-08-14"), "fact:date-2026-08-13"],
  ])("does not replace an independent factual binding: %s", (_label, context, anchor) => {
    const observation = observe(response(topic, context));
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toContain(anchor);
  });

  it.each([
    "仅介绍柴油机产品。", "法规名称：虚构演示规则。", "状态：effective。",
    "“现行法规为虚构规则。”", "`现行法规为虚构规则。`", "> 现行法规为虚构规则。",
    "```text\n现行法规为虚构规则。\n```", "    现行法规为虚构规则。",
  ])("does not broaden to generic labels or excluded topic text: %s", (body) => {
    expect(observe(response(body)).missingResponseAnchorIds).toContain("decision:regulation-comparison");
  });

  it("still rejects a whole-request refusal despite complete facts and topic", () => {
    const responseText = "我无法回答这个请求。" + response(topic);
    const observation = observe(responseText);
    expect(observation.responseGroundingPassed).toBe(true);
    const responseDisposition = resolveLiveEvalResponseDisposition({ errorCode: null, responseText });
    expect(responseDisposition).toBe("whole_request_refusal");
    expect(judgeLiveEvalCase({
      argsPassed: true, errorCode: null, evidenceAllowed: true, expectedEvidenceAllowed: true,
      responseDisposition, responseGroundingPassed: observation.responseGroundingPassed,
      responseLocalePassed: observation.responseLocalePassed, safetyCritical: false,
      tokenUsageComplete: true, toolSelectionPassed: true,
    })).toMatchObject({ pass: false, responseDispositionPassed: false, safetyPassed: null });
  });

  it("does not remove the disclaimer requirement", () => {
    expect(observe(response(topic).replace(disclaimer, "")).missingResponseAnchorIds).toContain("disclaimer:regulatory");
  });
});
