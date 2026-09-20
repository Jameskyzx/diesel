import { describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { evaluateLiveEvalResponseContract } from "@/domain/ai/live-eval";
import { prepareLiveEvalResponseText } from "@/domain/ai/live-eval-response-text";

const mixedCase = salesChatLiveCases.find(({ id }) => id === "mixed-regulation-and-product-intent");
if (!mixedCase) throw new Error("Missing canonical mixed case");
const responseContract = mixedCase.responseContract;
const facts = "在 2026-08-13，CHN non-road 100 kW 的现行有效法规为“DEMO ONLY — Fictional China Non-road Stage A”（状态 effective），且 DEMO-ENG-100 在该日期与功率下判定为适配（fit）。";
const sources = "来源：`DEMO ONLY — Fictional product manual`（https://example.invalid/demo/products）、`DEMO ONLY — Fictional emissions bulletin`（https://example.invalid/demo/regulations）、`DEMO ONLY — Fictional product certificate`（https://example.invalid/demo/certificates）；最近核验时间 2026-01-15T00:00:00.000Z。";
const disclaimer = "信息参考，不替代正式认证或法律意见。";

function response(body: string, context = facts) {
  return `${context}\n\n${body}\n\n${disclaimer}`;
}

function observe(responseText: string) {
  return evaluateLiveEvalResponseContract({ expectedLocale: "zh-CN", responseContract, responseText });
}

describe("bare URL projection preserves external punctuation and hides URL contents", () => {
  it.each([
    ["actual complete three-source fragment", sources],
    ["ASCII punctuation equivalent", sources.normalize("NFKC")],
    ["HTTP links", sources.replaceAll("https://", "http://")],
    ["uppercase URL scheme", sources.replaceAll("https://", "HTTPS://")],
  ])("retains all seven anchors around %s", (_label, sourceText) => {
    const responseText = response(sourceText);
    expect(prepareLiveEvalResponseText(responseText).facts).not.toBe("");
    expect(observe(responseText).matchedResponseAnchorIds).toHaveLength(7);
    expect(observe(responseText).missingResponseAnchorIds).toEqual([]);
    expect(observe(responseText).responseGroundingPassed).toBe(true);
  });

  it.each([
    "来源（https://example.invalid/demo/products）；更正：该产品不适配。",
    "来源(https://example.invalid/demo/products);更正：该产品不适配。",
    "来源（https://example.invalid/demo/products(v1)）；更正：该产品不适配。",
    "来源（https://example.invalid/demo/products(v1(detail))）；更正：该产品不适配。",
  ])("does not swallow an adjacent Chinese veto: %s", (sourceText) => {
    const responseText = response(sourceText);
    expect(prepareLiveEvalResponseText(responseText).claims.some((claim) => claim.includes("不适配"))).toBe(true);
    expect(observe(responseText).responseGroundingPassed).toBe(false);
    expect(observe(responseText).missingResponseAnchorIds).toContain("decision:product-compatible");
  });

  it.each([
    "https://example.invalid/demo/products(v1)",
    "https://example.invalid/demo/products(v1(detail))/manual?revision=(2)",
    "https://example.invalid/demo/products%28v1%29/manual",
    `https://example.invalid/${"(".repeat(64)}detail${")".repeat(64)}/manual`,
  ])("keeps internal URL parentheses hidden while preserving the next title: %s", (url) => {
    const responseText = response(`来源（${url}）、\`DEMO ONLY — Fictional product manual\`。`);
    expect(observe(responseText).responseGroundingPassed).toBe(true);
    expect(prepareLiveEvalResponseText(responseText).facts).not.toContain("example.invalid");
  });

  it.each([
    ["CHN", "BRA", "fact:country-chn"],
    ["100 kW", "1100 kW", "fact:power-100-kw"],
    ["2026-08-13", "2026-08-14", "fact:date-2026-08-13"],
    ["DEMO-ENG-100", "DEMO-ENG-1000", "fact:model-demo-eng-100"],
  ])("does not recover a missing %s from the URL path or query", (expected, replacement, anchor) => {
    const url = `https://example.invalid/reference(v1)/CHN/DEMO-ENG-100?asOf=2026-08-13&power=100kW&value=${encodeURIComponent(expected)}`;
    const observation = observe(response(`来源（${url}）。`, facts.replaceAll(expected, replacement)));
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toContain(anchor);
  });

  it("does not expose a model suffix after a balanced URL parenthesis", () => {
    const responseText = response("来源（https://example.invalid/reference(v1)DEMO-ENG-100）。", facts.replaceAll("DEMO-ENG-100", "DEMO-ENG-1000"));
    expect(prepareLiveEvalResponseText(responseText).facts).not.toMatch(/v1\)demo-eng-100/u);
    expect(observe(responseText).missingResponseAnchorIds).toContain("fact:model-demo-eng-100");
  });

  it.each([
    "100https://example.invalid/demo/products)kW",
    "100(https://example.invalid/demo/products)kW",
    "100 https://example.invalid/demo/products kW",
  ])("does not join fragments across an omitted URL: %s", (power) => {
    expect(observe(response("", facts.replace("100 kW", power))).missingResponseAnchorIds).toContain("fact:power-100-kw");
  });

  it("does not turn a negative phrase inside the URL into visible prose", () => {
    const responseText = response("来源（https://example.invalid/reference(v1)/不适配）。");
    expect(prepareLiveEvalResponseText(responseText).claims.some((claim) => claim.includes("不适配"))).toBe(false);
    expect(observe(responseText).responseGroundingPassed).toBe(true);
  });

  it.each([
    "`regulatory",
    '"regulatory',
    "“regulatory",
  ])("still fails the complete response closed for a genuinely unfinished span: %s", (unfinished) => {
    const responseText = response(sources) + `\n${unfinished}`;
    expect(prepareLiveEvalResponseText(responseText)).toEqual({ facts: "", claims: [], assertionClaims: [] });
    expect(observe(responseText).matchedResponseAnchorIds).toEqual([]);
    expect(observe(responseText).responseGroundingPassed).toBe(false);
  });

  it.each([
    `[Reference](https://example.invalid/demo/products "不适配")`,
    `> 来源（https://example.invalid/demo/products）；更正：该产品不适配。`,
    "```text\n来源（https://example.invalid/demo/products）；更正：该产品不适配。\n```",
    "    来源（https://example.invalid/demo/products）；更正：该产品不适配。",
    "<div>来源（https://example.invalid/demo/products）；更正：该产品不适配。</div>",
  ])("preserves existing exclusions around URLs: %s", (excluded) => {
    expect(observe(response(excluded)).responseGroundingPassed).toBe(true);
  });

  it("fails closed beyond the existing whole-response size bound", () => {
    expect(prepareLiveEvalResponseText(response("https://example.invalid/" + "(".repeat(131_072))))
      .toEqual({ facts: "", claims: [], assertionClaims: [] });
  });
});
