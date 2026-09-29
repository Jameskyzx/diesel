import { describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { evaluateLiveEvalResponseContract } from "@/domain/ai/live-eval";
import { prepareLiveEvalResponseText } from "@/domain/ai/live-eval-response-text";

function canonicalCase(id: string) {
  const testCase = salesChatLiveCases.find((candidate) => candidate.id === id);
  if (!testCase) throw new Error(`Missing canonical case: ${id}`);
  return testCase;
}

const mixedCase = canonicalCase("mixed-regulation-and-product-intent");
const productCase = canonicalCase("product-ready-dual-axis");
const mixedFacts = "截至 2026-08-13，CHN non-road 100 kW，DEMO-ENG-100 判定为适配。";
const chineseDisclaimer = "信息参考，不替代正式认证或法律意见。";
const englishFacts = "For DEMO-ENG-100 in CHN non-road at 100 kW on 2026-08-13.";
const englishDisclaimer = "For information only; not a substitute for formal certification or legal advice.";
const affirmative = "The product is compatible and is ready for supply.";
const regulation = "生效法规：`DEMO ONLY — Fictional China Non-road Stage A` (locator: `DEMO-CHN-NR-A`, status: effective, effectiveFrom: 2025-01-01)。";
const observedList = "**关键证据：**\n*   **法规核对 (asOf: 2026-08-13)**：\n    *   " + regulation;

function mixedResponse(body: string) {
  return `${mixedFacts}\n\n${body}\n\n${chineseDisclaimer}`;
}

function evaluateMixed(responseText: string) {
  return evaluateLiveEvalResponseContract({
    expectedLocale: mixedCase.locale, responseContract: mixedCase.responseContract, responseText,
  });
}

function evaluateProduct(body: string) {
  return evaluateLiveEvalResponseContract({
    expectedLocale: productCase.locale, responseContract: productCase.responseContract,
    responseText: `${englishFacts}\n\n${body}\n\n${englishDisclaimer}`,
  });
}

describe("response anchors follow bounded, parented unordered-list structure", () => {
  it("recognizes the exact observed nested regulation excerpt without changing its facts", () => {
    const response = mixedResponse(observedList);
    expect(prepareLiveEvalResponseText(response).claims.some((claim) => claim.includes("生效法规"))).toBe(true);
    expect(evaluateMixed(response).responseGroundingPassed).toBe(true);
  });

  it.each(["*", "-", "+"])("recognizes a four-space nested item under its %s parent", (marker) => {
    expect(evaluateMixed(mixedResponse(`${marker}   证据明细：\n    ${marker}   ${regulation}`))
      .responseGroundingPassed).toBe(true);
  });

  it("keeps a supported third level and same-indent sibling items", () => {
    const body = `*   Assessment:\n    *   Details:\n        *   The product is compatible.\n        *   The product is ready for supply.`;
    expect(evaluateProduct(body).responseGroundingPassed).toBe(true);
  });

  it.each([
    ["no parent", `    *   ${regulation}`],
    ["tab-indented code without a parent", `\t*   ${regulation}`],
    ["code four spaces beyond parent content", `*   证据明细：\n        *   ${regulation}`],
    ["blank paragraph ends parent context", `*   证据明细：\n\n    *   ${regulation}`],
    ["new root paragraph ends parent context", `*   证据明细：\n独立的新段落。\n    *   ${regulation}`],
  ])("does not reinterpret %s as prose", (_label, body) => {
    const response = mixedResponse(body);
    expect(evaluateMixed(response).missingResponseAnchorIds).toContain("decision:regulation-comparison");
    expect(prepareLiveEvalResponseText(response).claims.some((claim) => claim.includes("生效法规"))).toBe(false);
  });

  it.each([
    ["child fence", `*   证据明细：\n    *   \`\`\`text\n        ${regulation}\n        \`\`\``],
    ["parent continuation fence", `*   证据明细：\n    \`\`\`text\n    ${regulation}\n    \`\`\``],
    ["child tilde fence", `*   证据明细：\n    *   ~~~text\n        ${regulation}\n        ~~~`],
    ["unclosed child fence", `*   证据明细：\n    *   \`\`\`text\n        ${regulation}`],
    ["child block quote", `*   证据明细：\n    *   > ${regulation}`],
    ["quote lazy continuation", `*   证据明细：\n    *   > 引用开始：\n        ${regulation}`],
    ["parent continuation quote", `*   证据明细：\n    > 引用开始：\n    ${regulation}`],
    ["child HTML", `*   证据明细：\n    *   <div>\n        ${regulation}\n        </div>`],
    ["HTML lazy continuation", `*   证据明细：\n    *   <div>引用开始\n        ${regulation}`],
    ["parent continuation HTML", `*   证据明细：\n    <div>\n    ${regulation}\n    </div>`],
  ])("does not extract a regulation topic from %s", (_label, body) => {
    const response = mixedResponse(body);
    expect(evaluateMixed(response).missingResponseAnchorIds).toContain("decision:regulation-comparison");
    expect(prepareLiveEvalResponseText(response).claims.some((claim) => claim.includes("生效法规"))).toBe(false);
  });

  it.each([
    ["Example:", affirmative],
    ["If the conditions were satisfied:", affirmative],
    ["示例：", "合规适配结论为通过，供应状态为可供货。"],
  ])("does not promote a child affirmation under parent %s", (parent, child) => {
    const observation = evaluateProduct(`*   ${parent}\n    *   ${child}`);
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toEqual(expect.arrayContaining([
      "decision:product-compatible", "decision:supply-ready",
    ]));
  });

  it.each([
    ["The product is not compatible and is ready for supply.", "decision:product-compatible"],
    ["The product is compatible and is not ready for supply.", "decision:supply-ready"],
    ["The product is not compatible and is not ready for supply.", "decision:product-compatible"],
  ])("does not invert a nested negative decision: %s", (conclusion, anchor) => {
    const observation = evaluateProduct(`*   Assessment:\n    *   ${conclusion}`);
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toContain(anchor);
  });

  it.each([
    ["The product is not compatible.", "decision:product-compatible"],
    ["The product is not ready for supply.", "decision:supply-ready"],
  ])("retains a legitimate child veto after an earlier affirmative: %s", (conclusion, anchor) => {
    const observation = evaluateProduct(`${affirmative}\n*   Updated assessment:\n    *   ${conclusion}`);
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toContain(anchor);
  });

  it("does not promote a deeper relative code example into a contradiction", () => {
    const body = `${affirmative}\n*   Example data:\n        The product is not compatible and is not ready for supply.`;
    expect(evaluateProduct(body).responseGroundingPassed).toBe(true);
  });

  it.each([
    `*     ${affirmative}`,
    `*   Assessment:\n    *     ${affirmative}`,
  ])("does not expose code after five marker-padding spaces: %s", (body) => {
    expect(evaluateProduct(body).responseGroundingPassed).toBe(false);
  });

  it.each(["Example:", "If the conditions were satisfied:", "示例："])(
    "inherits non-asserting parent continuation %s", (context) => {
      const body = `*   Assessment:\n    ${context}\n    *   ${affirmative}`;
      const observation = evaluateProduct(body);
      expect(observation.responseGroundingPassed).toBe(false);
      expect(observation.missingResponseAnchorIds).toEqual(expect.arrayContaining([
        "decision:product-compatible", "decision:supply-ready",
      ]));
    },
  );

  it("retains a visible child veto after a correctly closed list-scoped fence", () => {
    const body = `${affirmative}\n*   Updated assessment:\n    \`\`\`text\n    example data\n    \`\`\`\n    *   The product is not compatible.`;
    const observation = evaluateProduct(body);
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toContain("decision:product-compatible");
  });

  it.each([
    ["quote", "> Quoted neutral data"],
    ["HTML", "<div>\n        neutral data\n        </div>"],
  ])("retains a visible sibling veto after a nested %s container", (_label, block) => {
    const body = `${affirmative}\n*   Updated assessment:\n    *   ${block}\n    *   The product is not compatible.`;
    const observation = evaluateProduct(body);
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toContain("decision:product-compatible");
  });

  it("does not assemble a factual power value across two distinct list items", () => {
    const responseText = `DEMO-ENG-100 in CHN non-road on 2026-08-13.\n*   100\n    *   kW\n\n${affirmative}\n\n${englishDisclaimer}`;
    const observation = evaluateLiveEvalResponseContract({
      expectedLocale: productCase.locale, responseContract: productCase.responseContract, responseText,
    });
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toContain("fact:power-100-kw");
  });

  it.each([
    ["CHN", "BRA", "fact:country-chn"],
    ["100 kW", "1100 kW", "fact:power-100-kw"],
    ["2026-08-13", "2026-08-14", "fact:date-2026-08-13"],
    ["DEMO-ENG-100", "DEMO-ENG-1000", "fact:model-demo-eng-100"],
  ])("does not let list formatting substitute for %s", (before, after, anchor) => {
    const response = mixedResponse(observedList).replaceAll(before, after);
    const observation = evaluateMixed(response);
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toContain(anchor);
  });

  it("accepts the declared sixteen-level nested-list boundary", () => {
    const parents = Array.from({ length: 15 }, (_, level) => `${" ".repeat(level * 4)}*   Details:`);
    const body = `${parents.join("\n")}\n${" ".repeat(15 * 4)}*   ${affirmative}`;
    expect(evaluateProduct(body).responseGroundingPassed).toBe(true);
  });

  it.each([
    ["separate items", "*   100\n*   kW", false],
    ["parent and child", "*   100\n    *   kW", false],
    ["list exit", "*   100\nkW", false],
    ["supported continuation", "*   100\n    kW", true],
  ])("keeps factual boundaries for %s", (_label, responseText, expected) => {
    const result = evaluateLiveEvalResponseContract({
      expectedLocale: "en", responseText,
      responseContract: {
        factAnchors: [{ id: "fact:power-100-kw", anyOf: ["100 kW"] }],
        decisionAnchors: [], disclaimerAnchor: null,
      },
    });
    expect(result.responseGroundingPassed).toBe(expected);
  });

  it.each([
    "    *     Code example only.",
    "    [reference]: https://example.invalid",
  ])("retains an ordinary sibling veto after excluded list content: %s", (excluded) => {
    const response = `${affirmative}\n*   Updated assessment:\n${excluded}\n    *   The product is not compatible.`;
    expect(evaluateProduct(response).missingResponseAnchorIds).toContain("decision:product-compatible");
  });

  it.each(["*   *   *", "-   -   -", "_   _   _"])("does not use a thematic break as a parent: %s", (line) => {
    expect(evaluateProduct(`${line}\n    *   ${affirmative}`).responseGroundingPassed).toBe(false);
  });

  it.each([17, 65])("fails closed at %i levels rather than silently hiding a final negative decision", (depth) => {
    const levels = Array.from({ length: depth - 1 }, (_, level) => `${" ".repeat(level * 4)}*   Details:`);
    const body = `${affirmative}\n${levels.join("\n")}\n${" ".repeat((depth - 1) * 4)}*   The product is not compatible.`;
    expect(evaluateProduct(body).responseGroundingPassed).toBe(false);
  });
});
