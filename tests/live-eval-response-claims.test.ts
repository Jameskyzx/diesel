import { describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { evaluateLiveEvalResponseContract } from "@/domain/ai/live-eval";

const productCase = salesChatLiveCases.find(({ id }) => id === "product-ready-dual-axis");
if (!productCase) throw new Error("Missing canonical product-ready case");
const responseContract = productCase.responseContract;
const facts = "For DEMO-ENG-100 in CHN non-road at 100 kW on 2026-08-13. ";
const disclaimer = " For information only; not a substitute for formal certification or legal advice.";

function observe(responseText: string, expectedLocale: "en" | "zh-CN" = "en") {
  return evaluateLiveEvalResponseContract({ expectedLocale, responseContract, responseText });
}

describe("response claims preserve formatting, factual identity, and assertion context", () => {
  it.each([
    ['plain value', 'The product is a regulatory fit, with commercial readiness marked as ready.'],
    ['quoted value', 'The product is a regulatory fit, with commercial readiness marked as "ready".'],
    ['emphasized value', 'The product is a **regulatory fit**, with commercial readiness marked as **ready**.'],
    ['inline value', 'The product is a regulatory fit, with commercial readiness marked as `ready`.'],
  ])("accepts semantically explicit observed fit/readiness wording: %s", (_label, conclusion) => {
    expect(observe(facts + conclusion + disclaimer).responseGroundingPassed).toBe(true);
  });

  it.each([
    'The product is not a regulatory fit, with commercial readiness marked as ready.',
    'The product is a regulatory fit, with commercial readiness marked as not ready.',
    'The product is a regulatory fit, with commercial readiness marked as "not_ready".',
    'The product is a regulatory fit, with commercial readiness marked as "unknown".',
    'The product is a regulatory fit.',
    'Commercial readiness marked as ready.',
    'If the product is a regulatory fit, commercial readiness marked as ready would follow.',
    'We cannot confirm the product is a regulatory fit, with commercial readiness marked as ready.',
    'Example: "The product is a regulatory fit, with commercial readiness marked as ready."',
    '> The product is a regulatory fit, with commercial readiness marked as ready.',
    '```text\nThe product is a regulatory fit, with commercial readiness marked as ready.\n```',
    'The product is a regulatory fitting, with commercial readiness marked as readiness.',
    'The product is a regulatory fit, with commercial readiness marked as ready. It is not a regulatory fit.',
    'The product is a regulatory fit, with commercial readiness marked as ready. Commercial readiness marked as not ready.',
    'The product is a regulatory fit, with commercial readiness marked as ready. Commercial readiness marked as "not_ready".',
  ])("does not relax polarity, both-axis, context or boundary requirements: %s", (conclusion) => {
    expect(observe(facts + "\n\n" + conclusion + "\n\n" + disclaimer).responseGroundingPassed).toBe(false);
  });

  it.each([
    ["single-country-market-profile", "en", "China's structured market data is available but consists entirely of fictional demo metrics, not real-world facts."],
    ["single-country-market-profile", "en", "China's market metrics are fictional Demo values, not real-world facts."],
    ["scoped-single-country-regulation", "zh-CN", "在 2026-08-13，CHN non-road 100 kW 的当前生效法规为虚构 Demo 法规，状态 effective。信息参考，不替代正式认证或法律意见"],
  ] as const)("recognizes observed business-topic wording without demanding a comparison: %s", (id, expectedLocale, responseText) => {
    const testCase = salesChatLiveCases.find((candidate) => candidate.id === id);
    if (!testCase) throw new Error("Missing canonical topical case");
    expect(evaluateLiveEvalResponseContract({ expectedLocale, responseContract: testCase.responseContract, responseText }).responseGroundingPassed).toBe(true);
  });

  it("keeps market-topic word boundaries and the country fact binding", () => {
    const testCase = salesChatLiveCases.find(({ id }) => id === "single-country-market-profile");
    if (!testCase) throw new Error("Missing market case");
    const evaluate = (responseText: string) => evaluateLiveEvalResponseContract({ expectedLocale: "en", responseContract: testCase.responseContract, responseText });
    expect(evaluate("China's market databank is a software storage component.").missingResponseAnchorIds).toContain("decision:market-comparison");
    expect(evaluate("Brazil's market data is available.").missingResponseAnchorIds).toContain("fact:country-chn");
  });

  it("accepts the same-run observed regulation-details topic without manufacturing missing facts", () => {
    const testCase = salesChatLiveCases.find(({ id }) => id === "multi-turn-country-conflict")!;
    const observeDetails = (responseText: string) => evaluateLiveEvalResponseContract({
      expectedLocale: "zh-CN", responseContract: testCase.responseContract, responseText,
    });
    const facts = "截至 2026-08-13，BRA non-road 100 kW。";
    const disclaimer = "信息参考，不替代正式认证或法律意见。";
    const details = "**法规详情**：虚构 Demo 法规处于 effective 状态。";
    expect(observeDetails(facts + details + disclaimer).responseGroundingPassed).toBe(true);
    expect(observeDetails(facts.replace("BRA", "CHN") + details + disclaimer)
      .missingResponseAnchorIds).toContain("fact:country-bra");
    for (const quoted of ["> 法规详情：虚构法规。", "```text\n法规详情：虚构法规。\n```", 'Example: "法规详情"']) {
      expect(observeDetails(`${facts}\n\n${quoted}\n\n${disclaimer}`)
        .missingResponseAnchorIds).toContain("decision:regulation-comparison");
    }
  });

  describe("mixed requests retain regulation topic and independent factual requirements", () => {
    const mixedCase = salesChatLiveCases.find(({ id }) => id === "mixed-regulation-and-product-intent");
    if (!mixedCase) throw new Error("Missing canonical mixed case");
    const mixedContract = mixedCase.responseContract;
    const context = "在 2026-08-13，CHN non-road 100 kW，DEMO-ENG-100 判定为适配。";
    const regulatoryDisclaimer = "信息参考，不替代正式认证或法律意见。";
    const evaluate = (responseText: string) => evaluateLiveEvalResponseContract({
      expectedLocale: "zh-CN", responseContract: mixedContract, responseText,
    });

    it.each([
      "现行有效法规为虚构 Demo Stage A（effective）；Stage C 为 adopted，尚未实施。",
      "**法规状态**：虚构 Demo Stage A 为 effective；Stage C 为 adopted，尚未实施。",
    ])("accepts observed regulation-topic wording: %s", (topic) => {
      expect(evaluate(context + topic + regulatoryDisclaimer).responseGroundingPassed).toBe(true);
    });

    it.each([
      ["missing topic", "仅说明产品。"],
      ["quoted topic", "\n\n> 法规状态：现行有效法规为虚构 Demo Stage A。\n\n"],
      ["code example", "\n\n```text\n法规状态：现行有效法规为虚构 Demo Stage A。\n```\n\n"],
    ])("does not manufacture topic coverage from %s", (_label, topic) => {
      expect(evaluate(context + topic + regulatoryDisclaimer).missingResponseAnchorIds).toContain("decision:regulation-comparison");
    });

    it.each([
      ["CHN", "BRA", "fact:country-chn"],
      ["100 kW", "1100 kW", "fact:power-100-kw"],
      ["2026-08-13", "2026-08-14", "fact:date-2026-08-13"],
      ["DEMO-ENG-100", "DEMO-ENG-1000", "fact:model-demo-eng-100"],
      ["判定为适配", "尚未确认适配", "decision:product-compatible"],
    ])("does not let the topic substitute for %s", (before, after, anchor) => {
      const observation = evaluate(context.replace(before, after) + "法规状态：现行有效法规为虚构 Demo Stage A。" + regulatoryDisclaimer);
      expect(observation.responseGroundingPassed).toBe(false);
      expect(observation.missingResponseAnchorIds).toContain(anchor);
    });
  });

  it.each([
    'The product is a regulatory fit.',
    'Commercial readiness marked as "ready".',
  ])("does not accept a refusal followed by a newly supported affirmative form: %s", (conclusion) => {
    const testCase = salesChatLiveCases.find(({ id }) => id === "unknown-product-fails-closed");
    if (!testCase) throw new Error("Missing fail-closed case");
    const observation = evaluateLiveEvalResponseContract({
      expectedLocale: "en",
      responseContract: { ...testCase.responseContract, factAnchors: [], disclaimerAnchor: null },
      responseText: "This request lacks enough evidence for an affirmative regulatory, market, or product conclusion. " + conclusion,
    });
    expect(observation.missingResponseAnchorIds).toContain("decision:evidence-denied");
    expect(observation.responseGroundingPassed).toBe(false);
  });

  it.each([
    "The product is compatible and is ready for supply.",
    "The product is **compatible** and is **ready for supply**.",
    "The product **is compatible** and **is ready for supply**.",
    "The product is *compatible* and is *ready for supply*.",
    "The product is ***compatible*** and is ***ready for supply***.",
    "The product is __compatible__ and is **ready for supply**.",
    "The product is [compatible](https://example.invalid/fit) and is [ready for supply](https://example.invalid/supply).",
    'The product is compatible and is ready for supply. [Reference](https://example.invalid "is not compatible and is not ready for supply")',
  ])("accepts the same affirmative statement: %s", (conclusion) => {
    expect(observe(facts + conclusion + disclaimer).responseGroundingPassed).toBe(true);
  });

  it.each([
    ["plain opposite conclusion", "The product is not compatible and is not ready for supply."],
    ["negated proposition", "It is false that the product is compatible and is ready for supply."],
    ["unconfirmed proposition", "We cannot confirm that the product is compatible and is ready for supply."],
    ["disavowed quotation", 'Do not conclude "the product is compatible and is ready for supply"; the actual assessment remains undetermined.'],
    ["curly-quoted example", "An unsupported example says “the product is compatible and is ready for supply”; this is not our conclusion."],
    ["struck-through conclusion", "~~The product is compatible and is ready for supply.~~ The assessment remains undetermined."],
    ["block quotation", "> The product is compatible and is ready for supply.\n\nThe assessment remains undetermined."],
    ["fenced example", "```text\nThe product is compatible and is ready for supply.\n```\nThe assessment remains undetermined."],
    ["inline-code example", "Example: `The product is compatible and is ready for supply.` The assessment remains undetermined."],
    ["image alternative text", "![The product is compatible and is ready for supply.](https://example.invalid/image.png)"],
    ["link destination title", '[Reference](https://example.invalid "The product is compatible and is ready for supply.")'],
    ["reference definition", '[source]: https://example.invalid "The product is compatible and is ready for supply."'],
    ["HTML content", "<div>The product is compatible and is ready for supply.</div>"],
    ["lazy block-quote continuation", "> Unsupported example:\nThe product is compatible and is ready for supply."],
    ["removed spans joining an assertion", "The product is ~~not~~compatible and is ~~not~~ready for supply."],
  ])("does not count %s as an affirmative product decision", (_label, conclusion) => {
    const observation = observe(facts + "\n\n" + conclusion + disclaimer);
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toEqual(expect.arrayContaining([
      "decision:product-compatible", "decision:supply-ready",
    ]));
  });

  it.each([
    ["longer model number", "DEMO-ENG-100", "DEMO-ENG-1000", "fact:model-demo-eng-100"],
    ["different model suffix", "DEMO-ENG-100", "DEMO-ENG-100-PRO", "fact:model-demo-eng-100"],
    ["different model prefix", "DEMO-ENG-100", "OTHER-DEMO-ENG-100", "fact:model-demo-eng-100"],
    ["invisible model suffix separator", "DEMO-ENG-100", "DEMO-ENG-100\u200b0", "fact:model-demo-eng-100"],
    ["dotted model suffix", "DEMO-ENG-100", "DEMO-ENG-100.PRO", "fact:model-demo-eng-100"],
    ["larger power magnitude", "100 kW", "1100 kW", "fact:power-100-kw"],
    ["fractional power suffix", "100 kW", "0.100 kW", "fact:power-100-kw"],
    ["thousands-group power", "100 kW", "1,100 kW", "fact:power-100-kw"],
    ["negative power", "100 kW", "-100 kW", "fact:power-100-kw"],
    ["different power unit", "100 kW", "100 kWh", "fact:power-100-kw"],
    ["derived power unit", "100 kW", "100 kW/h", "fact:power-100-kw"],
    ["dotted derived power unit", "100 kW", "100 kW.h", "fact:power-100-kw"],
    ["nearby non-equal decimal power", "100 kW", "100.0001 kW", "fact:power-100-kw"],
    ["decimal difference below binary-float precision", "100 kW", "100.000000000000000001 kW", "fact:power-100-kw"],
    ["country code substring", "CHN", "XCHNX", "fact:country-chn"],
  ])("rejects a %s instead of matching a factual substring", (_label, before, after, anchor) => {
    const response = facts.replace(before, after) + "The product is compatible and is ready for supply." + disclaimer;
    expect(observe(response).missingResponseAnchorIds).toContain(anchor);
  });

  it("allows an inline-code model identifier without treating a code example as a decision", () => {
    const response = facts.replace("DEMO-ENG-100", "`DEMO-ENG-100`") +
      "The product is compatible and is ready for supply." + disclaimer;
    expect(observe(response).responseGroundingPassed).toBe(true);
  });

  it("accepts a model identifier next to Chinese prose and sentence punctuation", () => {
    const response = facts.replace("DEMO-ENG-100", "产品DEMO-ENG-100.") +
      "The product is compatible and is ready for supply." + disclaimer;
    expect(observe(response).responseGroundingPassed).toBe(true);
  });

  it.each(["100.0 kW", "100.000 千瓦", "+100 kW", "功率100kW", "100.000000000000000000 kW"])("compares an exact numeric power value for %s", (power) => {
    const response = facts.replace("100 kW", power) + "The product is compatible and is ready for supply." + disclaimer;
    expect(observe(response).responseGroundingPassed).toBe(true);
  });

  it("does not assemble a multi-word factual anchor across a discarded span", () => {
    const observation = evaluateLiveEvalResponseContract({
      expectedLocale: "en",
      responseContract: { factAnchors: [{ id: "fact:country-usa", anyOf: ["United States"] }], decisionAnchors: [], disclaimerAnchor: null },
      responseText: "United ~~unrelated country~~ States is a constructed example.",
    });
    expect(observation.responseGroundingPassed).toBe(false);
  });

  it.each(["[".repeat(4096), "x".repeat(131_073)])("fails closed on excessive parsing work or input size", (suffix) => {
    expect(observe(facts + "The product is compatible and is ready for supply." + disclaimer + "\n\n" + suffix).responseGroundingPassed).toBe(false);
  });

  it.each([
    "`The product is not compatible and is not ready for supply.",
    '"The product is not compatible and is not ready for supply.',
    Array.from({ length: 20 }).reduce<string>((label) => `[${label}](https://example.invalid)`, "The product is not compatible and is not ready for supply."),
  ])("does not hide later prose behind malformed or over-nested inline markup", (suffix) => {
    expect(observe(facts + "The product is compatible and is ready for supply." + disclaimer + "\n\n" + suffix).responseGroundingPassed).toBe(false);
  });

  it.each([
    ["plain", "合规适配结论为通过，供应状态为可供货。", true],
    ["emphasis", "合规适配结论为**通过**，供应状态为**可供货**。", true],
    ["negated assertion", "不能断言合规适配结论为通过，也不能断言供应状态为可供货。", false],
    ["quoted example", "未作适配及供应判定。不要采用例句“合规适配结论为通过，供应状态为可供货”。", false],
  ])("applies assertion context to Chinese %s", (_label, conclusion, expected) => {
    const response = "中国 CHN 非道路 DEMO-ENG-100，100 千瓦，截至 2026-08-13。" + conclusion +
      "信息参考，不替代正式认证或法律意见";
    const observation = observe(response, "zh-CN");
    expect(observation.responseLocalePassed).toBe(true);
    expect(observation.responseGroundingPassed).toBe(expected);
  });
});
