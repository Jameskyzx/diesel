import { z } from "zod";

import { salesChatLiveCases } from "../../evals/sales-chat-live-cases";
import {
  CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT,
  KNOWLEDGE_APPLICATION_SCOPE_MISSING_WARNING,
  KNOWLEDGE_COUNTRY_MISSING_WARNING,
  KNOWLEDGE_DEMO_WARNING,
  KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING,
  KNOWLEDGE_TOOL_EXECUTION_FAILURE_WARNING,
  KNOWLEDGE_VALID_FROM_MISSING_WARNING,
} from "../../src/domain/knowledge/search-consistency";
import { searchKnowledgeBaseResultSchema } from "../../src/features/ai/schemas";
import {
  MAX_LIVE_EVAL_CASE_TOOL_ITEMS,
  MAX_LIVE_EVAL_OBSERVATION_STEPS,
  MAX_LIVE_EVAL_STEP_TOOL_ITEMS,
} from "./live-eval-observations";

const sourceCases = salesChatLiveCases.filter((testCase) =>
  testCase.expectedEvidenceAllowed && !testCase.safetyCritical &&
  testCase.expectedTools.length === 1 && testCase.expectedTools[0] === "searchKnowledgeBase");
const identitySchema = z.object({
  runId: z.string().uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});
const resultSchema = z.object({
  errorCode: z.null(),
  evidenceAllowed: z.literal(false),
  expectedEvidenceAllowed: z.literal(true),
  id: z.string(),
  loopSteps: z.number().int().min(1).max(MAX_LIVE_EVAL_OBSERVATION_STEPS),
  pass: z.literal(false),
  safetyCritical: z.literal(false),
  toolSequence: z.array(z.literal("searchKnowledgeBase")).min(1).max(MAX_LIVE_EVAL_CASE_TOOL_ITEMS),
  toolTraceStatus: z.literal("complete"),
});
const toolIdentitySchema = z.object({
  toolCallId: z.string().min(1).max(256),
  toolName: z.literal("searchKnowledgeBase"),
});
// Inputs, response text and provider metrics are intentionally not inspected.
const observationSchema = z.object({
  boundaryRejections: z.array(z.never()).length(0),
  id: z.string(),
  streamCompleted: z.literal(true),
  streamErrorObserved: z.literal(false),
  steps: z.array(z.object({
    toolCalls: z.array(toolIdentitySchema.extend({
      dynamic: z.literal(false),
      invalid: z.literal(false),
    })).max(MAX_LIVE_EVAL_STEP_TOOL_ITEMS),
    toolResults: z.array(toolIdentitySchema.extend({ output: z.unknown() }))
      .max(MAX_LIVE_EVAL_STEP_TOOL_ITEMS),
  })).min(1).max(MAX_LIVE_EVAL_OBSERVATION_STEPS),
});
// Check cardinality before applying the existing full production result schema.
const sourceOutputBoundsSchema = z.object({
  citations: z.array(z.unknown()).max(CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT),
  search: z.object({
    results: z.array(z.unknown()).max(CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT),
  }),
});
const warningCodes = [
  "application_scope_missing", "country_missing", "demo_data",
  "insufficient_evidence", "tool_execution_failure", "valid_from_missing",
] as const;
type KnowledgeWarningCode = (typeof warningCodes)[number];
const warningCodeByText = new Map<string, KnowledgeWarningCode>([
  [KNOWLEDGE_APPLICATION_SCOPE_MISSING_WARNING, "application_scope_missing"],
  [KNOWLEDGE_COUNTRY_MISSING_WARNING, "country_missing"],
  [KNOWLEDGE_DEMO_WARNING, "demo_data"],
  [KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING, "insufficient_evidence"],
  [KNOWLEDGE_TOOL_EXECUTION_FAILURE_WARNING, "tool_execution_failure"],
  [KNOWLEDGE_VALID_FROM_MISSING_WARNING, "valid_from_missing"],
]);
const countSchema = z.number().int().min(0).max(MAX_LIVE_EVAL_CASE_TOOL_ITEMS);
const sourceSummarySchema = z.object({
  citationCount: z.number().int().min(0).max(CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT),
  evidenceSufficient: z.boolean(),
  ordinal: countSchema,
  searchResultCount: z.number().int().min(0).max(CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT),
  status: z.enum(["ok", "no_data", "error"]),
  unknownWarningCount: z.number().int().nonnegative(),
  warningCodes: z.array(z.enum(warningCodes)).max(warningCodes.length),
});
const diagnosticSchema = z.object({
  caseId: z.string().refine((id) => sourceCases.some((testCase) => testCase.id === id)),
  reportSha256: identitySchema.shape.sha256,
  results: z.array(sourceSummarySchema).min(1).max(MAX_LIVE_EVAL_CASE_TOOL_ITEMS),
  runId: identitySchema.shape.runId,
  statusCounts: z.object({ error: countSchema, no_data: countSchema, ok: countSchema }),
});

type SourceEvidenceSummary = Readonly<Omit<z.infer<typeof sourceSummarySchema>, "warningCodes"> & {
  warningCodes: readonly KnowledgeWarningCode[];
}>;
export type FailedSourceEvidenceDiagnostic = Readonly<{
  caseId: string;
  reportSha256: string;
  results: readonly SourceEvidenceSummary[];
  runId: string;
  statusCounts: Readonly<{ error: number; no_data: number; ok: number }>;
}>;
export type FailedSourceEvidenceObserver = (diagnostic: FailedSourceEvidenceDiagnostic) => undefined;

function sourceSummaries(
  observed: z.infer<typeof observationSchema>,
  row: z.infer<typeof resultSchema>,
): SourceEvidenceSummary[] | null {
  const calls = observed.steps.flatMap((step) => step.toolCalls);
  const results = observed.steps.flatMap((step) => step.toolResults);
  if (calls.length + results.length > MAX_LIVE_EVAL_CASE_TOOL_ITEMS ||
      observed.steps.length !== row.loopSteps || calls.length !== row.toolSequence.length ||
      calls.length !== results.length || new Set(calls.map((call) => call.toolCallId)).size !== calls.length ||
      new Set(results.map((result) => result.toolCallId)).size !== results.length) return null;
  const summaries: SourceEvidenceSummary[] = [];
  for (const [ordinal, call] of calls.entries()) {
    const output = results.find((result) => result.toolCallId === call.toolCallId)?.output;
    if (!sourceOutputBoundsSchema.safeParse(output).success) return null;
    const parsed = searchKnowledgeBaseResultSchema.safeParse(output);
    if (!parsed.success) return null;
    const result = parsed.data;
    const codes = new Set<KnowledgeWarningCode>();
    let unknownWarningCount = 0;
    for (const warning of result.warnings) {
      const code = warningCodeByText.get(warning);
      if (code === undefined) unknownWarningCount += 1;
      else codes.add(code);
    }
    summaries.push(Object.freeze({
      citationCount: result.citations.length,
      evidenceSufficient: result.evidenceSufficient,
      ordinal,
      searchResultCount: result.search.results.length,
      status: result.status,
      unknownWarningCount,
      warningCodes: Object.freeze(warningCodes.filter((code) => codes.has(code))),
    }));
  }
  return summaries;
}

/** Diagnostic only: reuse validated outputs without reproducing the evidence judgement. */
export function observeFailedSourceEvidence(input: {
  observations: readonly unknown[];
  observer?: FailedSourceEvidenceObserver;
  reportReceipt: { runId: string; sha256: string };
  results: readonly unknown[];
}): void {
  if (input.observer === undefined) return;
  try {
    const identity = identitySchema.safeParse(input.reportReceipt);
    if (!identity.success || input.results.length > salesChatLiveCases.length ||
        input.observations.length > salesChatLiveCases.length) return;
    for (const testCase of sourceCases) {
      const hasCaseId = (row: unknown) => typeof row === "object" && row !== null &&
        "id" in row && row.id === testCase.id;
      const rows = input.results.filter(hasCaseId);
      const observations = input.observations.filter(hasCaseId);
      if (rows.length !== 1 || observations.length !== 1) continue;
      const row = resultSchema.safeParse(rows[0]);
      const observed = observationSchema.safeParse(observations[0]);
      if (!row.success || !observed.success) continue;
      const results = sourceSummaries(observed.data, row.data);
      if (results === null || results.length === 0) continue;
      const statusCounts = { error: 0, no_data: 0, ok: 0 };
      for (const result of results) statusCounts[result.status] += 1;
      const diagnostic: FailedSourceEvidenceDiagnostic = Object.freeze({
        caseId: testCase.id,
        reportSha256: identity.data.sha256,
        results: Object.freeze(results),
        runId: identity.data.runId,
        statusCounts: Object.freeze(statusCounts),
      });
      try {
        const returned: unknown = input.observer(diagnostic);
        void Promise.resolve(returned).catch(() => undefined);
      } catch {
        // Best-effort diagnostics cannot alter the persisted report or exit.
      }
    }
  } catch {
    // Never emit raw validation faults from malformed diagnostic observations.
  }
}

export function formatFailedSourceEvidenceDiagnostic(diagnostic: FailedSourceEvidenceDiagnostic): string {
  // The projection also strips unexpected properties from a trusted caller;
  // no output/query/title/response text or raw warning may enter the JSON line.
  return `${JSON.stringify({ type: "live_eval_failed_source_evidence", ...diagnosticSchema.parse(diagnostic) })}\n`;
}
