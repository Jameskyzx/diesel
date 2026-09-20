import { describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { evaluateLiveEvalResponseContract } from "@/domain/ai/live-eval";
import { prepareLiveEvalResponseText } from "@/domain/ai/live-eval-response-text";

const productCase = salesChatLiveCases.find(({ id }) => id === "product-ready-dual-axis");
if (!productCase) throw new Error("Missing canonical product case");
const responseContract = productCase.responseContract;
const facts = "For DEMO-ENG-100 in CHN non-road at 100 kW on 2026-08-13.";
const url = "https://example.invalid/CHN/2026-08-13";
const wrappers = [
  ["backticks", "`", "`"], ["double backticks", "``", "``"],
  ["triple inline backticks", "```", "```"],
  ["straight double quotes", '"', '"'], ["straight single quotes", "'", "'"],
  ["curly double quotes", "“", "”"], ["curly single quotes", "‘", "’"],
  ["corner quotes", "「", "」"], ["double corner quotes", "『", "』"],
] as const;
const missingFacts = [
  [facts.replace(" in CHN", ""), ["fact:country-chn"]],
  [facts.replace(" on 2026-08-13", ""), ["fact:date-2026-08-13"]],
  [facts.replace(" in CHN", "").replace(" on 2026-08-13", ""), ["fact:country-chn", "fact:date-2026-08-13"]],
] as const;

function response(context: string, reference: string) {
  return `${context}\n\nThe product is compatible and is ready for supply.\n\nReference: ${reference}\n\nFor information only; not a substitute for formal certification or legal advice.`;
}

function observe(responseText: string) {
  return evaluateLiveEvalResponseContract({ expectedLocale: "en", responseContract, responseText });
}

describe("HTTP URL literals never provide missing canonical facts", () => {
  it.each(wrappers)("excludes the whole URL inside %s", (_label, left, right) => {
    for (const [context, missing] of missingFacts) {
      const responseText = response(context, left + url + right);
      expect(prepareLiveEvalResponseText(responseText).facts).not.toContain("example.invalid");
      expect(observe(responseText).missingResponseAnchorIds).toEqual(missing);
      expect(observe(responseText).responseGroundingPassed).toBe(false);
    }
  });

  it.each([
    "https://", "http://", "hTtPs://", "ｈｔｔｐｓ：／／", "h\u200Bttps://",
    "htt\u2060ps://", "https:\uFEFF//", "h\u00ADttps://", "h\u034Fttps://",
    "https\uFE0F://", "htt\u202Eps://", "h\u200Bttps:/\u2060/",
  ])("keeps the existing Unicode canonicalization before URL exclusion: %s", (scheme) => {
    const value = scheme + "example.invalid/CHN/2026-08-13";
    for (const reference of [value, "`" + value + "`", '"' + value + '"']) {
      const [context, missing] = missingFacts[2];
      const responseText = response(context, reference);
      expect(prepareLiveEvalResponseText(responseText).facts).not.toContain("example.invalid");
      expect(observe(responseText).missingResponseAnchorIds).toEqual(missing);
    }
  });

  it.each(wrappers)("preserves genuine atomic IDs, dates and powers in %s", (_label, left, right) => {
    const context = `For ${left}DEMO-ENG-100${right} in ${left}CHN${right} non-road at ${left}100 kW${right} on ${left}2026-08-13${right}.`;
    expect(observe(response(context, "No URL.")).responseGroundingPassed).toBe(true);
  });

  it.each(wrappers)("retains an omission barrier for %s", (_label, left, right) => {
    const responseText = response(facts.replace("100 kW", `100 ${left}${url}${right} kW`), "No URL.");
    expect(prepareLiveEvalResponseText(responseText).facts).toContain("100 \uFFFC kw");
    expect(observe(responseText).missingResponseAnchorIds).toContain("fact:power-100-kw");
  });

  it("keeps visible link labels while excluding destinations and URL-valued labels", () => {
    const [context, missing] = missingFacts[2];
    expect(observe(response(context, "[CHN 2026-08-13](https://example.invalid/reference)"))
      .responseGroundingPassed).toBe(true);
    for (const reference of [`[Reference](${url})`, `[${url}](https://example.invalid/reference)`, `[\`${url}\`](https://example.invalid/reference)`]) {
      expect(observe(response(context, reference)).missingResponseAnchorIds).toEqual(missing);
    }
  });

  it("does not use a URL literal to construct a compound model or country", () => {
    const responseText = response(facts.replace("CHN", `C\`${url}\`HN`).replace("DEMO-ENG-100", `DEMO-ENG-\`${url}\`100`), "No URL.");
    expect(observe(responseText).missingResponseAnchorIds).toEqual(["fact:model-demo-eng-100", "fact:country-chn"]);
  });

  it.each(["`", '"', "“"])("still fails closed on an unfinished %s URL literal", (opening) => {
    const responseText = response(facts, opening + url);
    expect(prepareLiveEvalResponseText(responseText)).toEqual({ facts: "", claims: [], assertionClaims: [] });
    expect(observe(responseText).matchedResponseAnchorIds).toEqual([]);
  });
});
