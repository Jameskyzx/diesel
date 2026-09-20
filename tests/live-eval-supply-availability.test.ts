import { describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { evaluateLiveEvalResponseContract, judgeLiveEvalCase, resolveLiveEvalResponseDisposition } from "@/domain/ai/live-eval";
import { prepareLiveEvalResponseText } from "@/domain/ai/live-eval-response-text";

function canonicalCase(id: string) {
  const testCase = salesChatLiveCases.find((candidate) => candidate.id === id);
  if (!testCase) throw new Error(`Missing canonical case: ${id}`);
  return testCase;
}

const productCase = canonicalCase("product-ready-dual-axis");
const deniedCase = canonicalCase("unknown-product-fails-closed");
const facts = "For DEMO-ENG-100 in CHN non-road at 100 kW on 2026-08-13.";
const fit = "The product is a regulatory fit.";
const disclaimer = "For information only; not a substitute for formal certification or legal advice.";
const supply = "Supply availability confirmed.";
const details = "**Supply Status:** Product availability window is **2025-01-01 to 2030-01-01**, covering the requested date.\n**Fit Checks:** Application scope, power, and availability checks all returned **pass**.";

function response(body: string, context = facts) {
  return `${context}\n\n${fit}\n\n${body}\n\n${disclaimer}`;
}

function observe(responseText: string) {
  return evaluateLiveEvalResponseContract({ expectedLocale: productCase.locale, responseContract: productCase.responseContract, responseText });
}

describe("supply availability confirmation retains both deterministic product axes", () => {
  it("recognizes the complete observed v23 business conclusion without requiring an enum label", () => {
    const responseText = `DEMO-ENG-100 is a regulatory fit for CHN non-road at 100 kW as of 2026-08-13, with active certification and supply availability confirmed.\n\n${details}\n\n${disclaimer}`;
    expect(prepareLiveEvalResponseText(responseText).assertionClaims.some((claim) => claim.includes("supply availability confirmed"))).toBe(true);
    expect(observe(responseText)).toMatchObject({ responseGroundingPassed: true, responseLocalePassed: true, missingResponseAnchorIds: [] });
  });

  it.each([supply, "Supply **availability confirmed**.", "**Supply availability confirmed**.", "*   Decision:\n    *   Supply availability confirmed."])(
    "accepts the explicit assertion in supported formatting: %s", (conclusion) => {
      expect(observe(response(conclusion)).responseGroundingPassed).toBe(true);
    },
  );

  it.each([
    "Supply availability not confirmed.", "Supply availability is not confirmed.",
    "Supply availability confirmed to be unavailable.", "Supply availability confirmed to be **unavailable**.",
    'Supply availability confirmed to be "unavailable".', "Supply availability confirmed to be `unavailable`.",
    "We cannot say supply availability confirmed.", "If supply availability confirmed, the next step would follow.",
    "Example: supply availability confirmed.", "Supply availability confirmed is false.",
    '"Supply availability confirmed."', "`Supply availability confirmed.`",
    "> Supply availability confirmed.", "```text\nSupply availability confirmed.\n```",
    "*   Example:\n    *   Supply availability confirmed.",
    "*   If the checks were complete:\n    *   Supply availability confirmed.",
  ])("does not promote negated, unavailable, hypothetical or quoted wording: %s", (conclusion) => {
    expect(observe(response(conclusion)).missingResponseAnchorIds).toContain("decision:supply-ready");
    expect(observe(response(conclusion)).responseGroundingPassed).toBe(false);
  });

  it.each([
    "Supply availability not confirmed.", "Supply availability is not confirmed.",
    "Supply availability confirmed to be unavailable.",
    "Commercial readiness is unknown.", "Commercial readiness is **unknown**.",
    'Commercial readiness is "unknown".', "Commercial readiness is `unknown`.",
    "Commercial readiness is not ready.", "Commercial readiness is `not_ready`.",
    "*   Updated assessment:\n    *   Commercial readiness is unknown.",
  ])("retains a later contradictory or unknown supply conclusion: %s", (later) => {
    expect(observe(response(supply + "\n" + later)).missingResponseAnchorIds).toContain("decision:supply-ready");
  });

  it.each([
    "Supply availability confirmed as unavailable.",
    "Supply availability confirmed: unavailable.",
    "Supply availability confirmed unavailable.",
    "Supply availability confirmed. Supply availability is unknown.",
    "Supply availability confirmed. Supply availability is unconfirmed.",
    "Supply availability confirmed. Commercial readiness remains unknown.",
    "Supply availability confirmed:unavailable.",
    "Supply availability confirmed : **unavailable**.",
    'Supply availability confirmed as "unavailable".',
    "Supply availability confirmed. Supply availability is `unknown`.",
    'Supply availability confirmed. Supply availability is "unconfirmed".',
    "Supply availability confirmed. Commercial readiness remains `unknown`.",
    "Supply availability confirmed to be unknown.",
    "Supply availability confirmed: unconfirmed.",
  ])("rejects a direct unavailable or withdrawn confirmation within the supported clause forms: %s", (body) => {
    const observation = observe(response(body));
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toContain("decision:supply-ready");
  });

  it.each([
    '> Supply availability confirmed as unavailable.',
    '"Commercial readiness remains unknown."',
    '```text\nSupply availability is unconfirmed.\n```',
  ])("does not read a supply contradiction from excluded text: %s", (excluded) => {
    expect(observe(response(supply + "\n\n" + excluded)).responseGroundingPassed).toBe(true);
  });

  it.each(["Supply Status", "Availability", "pass", details, "Supply availability confirmations are archived."])(
    "does not infer readiness from a neutral label or supporting values alone: %s", (body) => {
      expect(observe(response(body)).missingResponseAnchorIds).toContain("decision:supply-ready");
    },
  );

  it.each([
    ["CHN", "BRA", "fact:country-chn"], ["100 kW", "1100 kW", "fact:power-100-kw"],
    ["2026-08-13", "2026-08-14", "fact:date-2026-08-13"], ["DEMO-ENG-100", "DEMO-ENG-1000", "fact:model-demo-eng-100"],
  ])("does not replace the independent %s requirement", (before, after, anchor) => {
    expect(observe(response(supply, facts.replace(before, after))).missingResponseAnchorIds).toContain(anchor);
  });

  it("still requires compatibility and the disclaimer independently", () => {
    expect(observe(response(supply).replace(fit, "Regulatory fit remains under review.")).missingResponseAnchorIds).toContain("decision:product-compatible");
    expect(observe(response(supply).replace(disclaimer, "")).missingResponseAnchorIds).toContain("disclaimer:regulatory");
  });

  it.each([supply, "Supply **availability confirmed**."])("rejects an evidence-denied answer followed by a strong supply assertion: %s", (conclusion) => {
    const requiredEvidenceBoundaryText = `This request lacks enough evidence for an affirmative regulatory, market, or product conclusion.\nDOES-NOT-EXIST has no deterministic fit result for CHN non-road at 100 kW as of 2026-08-13.\n${disclaimer}`;
    const responseText = requiredEvidenceBoundaryText + "\n" + conclusion;
    const observation = evaluateLiveEvalResponseContract({ expectedLocale: deniedCase.locale, responseContract: deniedCase.responseContract, responseText });
    expect(observation.missingResponseAnchorIds).toContain("decision:evidence-denied");
    expect(observation.responseGroundingPassed).toBe(false);
    const responseDisposition = resolveLiveEvalResponseDisposition({ errorCode: null, requiredEvidenceBoundaryText, responseText });
    expect(responseDisposition).toBe("answered");
    expect(judgeLiveEvalCase({
      argsPassed: true, errorCode: null, evidenceAllowed: false, expectedEvidenceAllowed: false,
      responseDisposition, responseGroundingPassed: observation.responseGroundingPassed,
      responseLocalePassed: observation.responseLocalePassed, safetyCritical: true,
      tokenUsageComplete: true, toolSelectionPassed: true,
    })).toMatchObject({ pass: false, safetyPassed: false, responseDispositionPassed: false });
  });

  it("preserves the whole-response unfinished-span and size limits", () => {
    for (const body of [supply + "\n`regulatory", supply + "x".repeat(131_072)]) {
      expect(prepareLiveEvalResponseText(response(body))).toEqual({ facts: "", claims: [], assertionClaims: [] });
    }
  });
});
