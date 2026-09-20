import { z } from "zod";

import { salesChatLiveCases } from "../../evals/sales-chat-live-cases";
import {
  LIVE_EVAL_DETECTED_RESPONSE_LOCALES,
  liveEvalResponseContractAnchorIds,
} from "../../src/domain/ai/live-eval";
import { MAX_LIVE_EVAL_RESPONSE_BYTES } from "./live-eval-observations";

const identitySchema = z.object({
  runId: z.string().uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});
const resultSchema = z.object({
  argsPassed: z.boolean(),
  detectedResponseLocale: z.enum(LIVE_EVAL_DETECTED_RESPONSE_LOCALES),
  errorCode: z.null(),
  evidenceAllowed: z.literal(true),
  expectedEvidenceAllowed: z.literal(true),
  id: z.string(),
  locale: z.enum(["en", "zh-CN"]),
  matchedResponseAnchorIds: z.array(z.string()),
  missingResponseAnchorIds: z.array(z.string()),
  pass: z.literal(false),
  responseCharacterCount: z.number().int().positive(),
  responseDisposition: z.enum(["answered", "whole_request_refusal"]),
  responseGroundingPassed: z.boolean(),
  responseLocalePassed: z.boolean(),
  safetyCritical: z.literal(false),
  toolSelectionPassed: z.boolean(),
  toolTraceStatus: z.literal("complete"),
});
// Deliberately project only public-response fields. Do not parse/copy the raw
// tool steps, their inputs/outputs, billing metadata, or provider configuration.
const publicObservationSchema = z.object({
  boundaryRejections: z.array(z.never()).length(0),
  id: z.string(),
  responseText: z.string().refine((text) =>
    text.trim().length > 0 &&
    Buffer.byteLength(text, "utf8") <= MAX_LIVE_EVAL_RESPONSE_BYTES),
  streamCompleted: z.literal(true),
  streamErrorObserved: z.literal(false),
});

export type FailedPublicResponseDiagnostic = Readonly<{
  argsPassed: boolean;
  caseId: string;
  detectedResponseLocale: (typeof LIVE_EVAL_DETECTED_RESPONSE_LOCALES)[number];
  expectedLocale: "en" | "zh-CN";
  matchedResponseAnchorIds: readonly string[];
  missingResponseAnchorIds: readonly string[];
  reportSha256: string;
  responseDisposition: "answered" | "whole_request_refusal";
  responseGroundingPassed: boolean;
  responseLocalePassed: boolean;
  responseText: string;
  runId: string;
  toolSelectionPassed: boolean;
}>;

export type FailedPublicResponseObserver = (
  diagnostic: FailedPublicResponseDiagnostic,
) => undefined;

export function observeFailedPublicResponses(input: {
  observations: readonly unknown[];
  observer?: FailedPublicResponseObserver;
  reportReceipt: { runId: string; sha256: string };
  results: readonly unknown[];
}): void {
  if (input.observer === undefined) return;
  const identity = identitySchema.safeParse(input.reportReceipt);
  if (!identity.success || input.results.length > salesChatLiveCases.length ||
      input.observations.length > salesChatLiveCases.length) return;

  for (const testCase of salesChatLiveCases) {
    // Fixed canonical order and a maximum of one diagnostic per canonical case.
    const rows = input.results.filter((row) =>
      typeof row === "object" && row !== null &&
      "id" in row && row.id === testCase.id);
    const observations = input.observations.filter((row) =>
      typeof row === "object" && row !== null &&
      "id" in row && row.id === testCase.id);
    if (rows.length !== 1 || observations.length !== 1 ||
        !testCase.expectedEvidenceAllowed || testCase.safetyCritical) continue;
    const result = resultSchema.safeParse(rows[0]);
    const observed = publicObservationSchema.safeParse(observations[0]);
    if (!result.success || !observed.success) continue;
    const row = result.data;
    const publicResponse = observed.data;
    const expectedAnchors = liveEvalResponseContractAnchorIds(testCase.responseContract);
    const reportedAnchors = [...row.matchedResponseAnchorIds, ...row.missingResponseAnchorIds];
    if (row.locale !== testCase.locale ||
        row.responseCharacterCount !== publicResponse.responseText.trim().length ||
        reportedAnchors.length !== expectedAnchors.length ||
        new Set(reportedAnchors).size !== reportedAnchors.length ||
        reportedAnchors.some((anchor) => !expectedAnchors.includes(anchor))) continue;

    const diagnostic: FailedPublicResponseDiagnostic = Object.freeze({
      argsPassed: row.argsPassed,
      caseId: testCase.id,
      detectedResponseLocale: row.detectedResponseLocale,
      expectedLocale: testCase.locale,
      matchedResponseAnchorIds: Object.freeze([...row.matchedResponseAnchorIds]),
      missingResponseAnchorIds: Object.freeze([...row.missingResponseAnchorIds]),
      reportSha256: identity.data.sha256,
      responseDisposition: row.responseDisposition,
      responseGroundingPassed: row.responseGroundingPassed,
      responseLocalePassed: row.responseLocalePassed,
      responseText: publicResponse.responseText,
      runId: identity.data.runId,
      toolSelectionPassed: row.toolSelectionPassed,
    });
    try {
      // This is trusted, synchronous in-process code, not an arbitrary plugin.
      // Absorb accidental async rejection too; never wait or log its raw error.
      const returned: unknown = input.observer(diagnostic);
      void Promise.resolve(returned).catch(() => undefined);
    } catch {
      // Diagnostics cannot rewrite a persisted judgement or start another call.
    }
  }
}

export function liveEvalPublicDiagnosticsEnabled(value: string | undefined): boolean {
  return value === "public-failures";
}

export function formatFailedPublicResponseDiagnostic(
  diagnostic: FailedPublicResponseDiagnostic,
): string {
  // JSON escapes control characters/newlines rather than rendering terminal commands.
  return `${JSON.stringify({ type: "live_eval_failed_public_response", ...diagnostic })}\n`;
}
