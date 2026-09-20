import { posix } from "node:path";

import { z } from "zod";

import {
  playwrightRepositoryStateSchema,
  playwrightRunContracts,
  playwrightTestObservationSchema,
  type PlaywrightRunId,
} from "./playwright-evidence";
import { assertVerificationEqual } from "./verification-issues";

export const PLAYWRIGHT_FAILURE_DIAGNOSTIC_VERSION =
  "diesel-playwright-failure-v1" as const;

export const playwrightFailureObservationSchema =
  playwrightTestObservationSchema.extend({
    finalStatus: playwrightTestObservationSchema.shape.finalStatus.nullable(),
  }).strict().superRefine((observation, context) => {
    if (observation.attempts === 0) {
      if (observation.finalStatus !== null || observation.retryCount !== 0) {
        context.addIssue({
          code: "custom",
          message: "An unexecuted Playwright test requires a null status and zero retries.",
        });
      }
    } else if (observation.finalStatus === null) {
      context.addIssue({
        code: "custom",
        message: "An attempted Playwright test requires its actual final status.",
      });
    }
  });

export type PlaywrightFailureObservation = z.infer<
  typeof playwrightFailureObservationSchema
>;

const resultCountsSchema = z.object({
  collected: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  timedOut: z.number().int().nonnegative(),
  interrupted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  notRun: z.number().int().nonnegative(),
}).strict();

type ResultCounts = z.infer<typeof resultCountsSchema>;

const runIdSchema = z.enum(
  playwrightRunContracts.map(({ id }) => id) as [
    PlaywrightRunId,
    ...PlaywrightRunId[],
  ],
);

export const playwrightFailureDiagnosticSchema = z.object({
  version: z.literal(PLAYWRIGHT_FAILURE_DIAGNOSTIC_VERSION),
  purpose: z.literal("execution-diagnostics-only"),
  reporterExitCode: z.literal(1),
  id: runIdSchema,
  runStatus: z.enum(["passed", "failed", "timedout", "interrupted"]),
  stage: z.enum(["run", "receipt-validation", "receipt-persistence"]),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
  globalErrorCount: z.number().int().nonnegative(),
  provenance: z.object({
    started: playwrightRepositoryStateSchema,
    completed: playwrightRepositoryStateSchema.nullable(),
  }).strict(),
  projects: z.array(z.object({
    name: playwrightTestObservationSchema.shape.project,
    counts: resultCountsSchema,
  }).strict()).min(1).max(10),
  tests: z.array(playwrightFailureObservationSchema).max(2_000),
  totals: resultCountsSchema,
}).strict();

export type PlaywrightFailureDiagnostic = z.infer<
  typeof playwrightFailureDiagnosticSchema
>;

export type BuildPlaywrightFailureDiagnosticInput = Pick<
  PlaywrightFailureDiagnostic,
  | "id"
  | "runStatus"
  | "stage"
  | "startedAt"
  | "completedAt"
  | "globalErrorCount"
  | "provenance"
> & { tests: readonly PlaywrightFailureObservation[] };

export function playwrightFailureDiagnosticPath(id: PlaywrightRunId): string {
  const contract = playwrightRunContracts.find((candidate) => candidate.id === id);
  if (!contract) throw new Error(`Unknown Playwright diagnostic suite: ${id}`);
  return posix.join(posix.dirname(contract.receiptPath), "playwright-failure.json");
}

function summarizeObservations(
  observations: readonly PlaywrightFailureObservation[],
): ResultCounts {
  const counts: ResultCounts = {
    collected: observations.length,
    passed: 0,
    failed: 0,
    timedOut: 0,
    interrupted: 0,
    skipped: 0,
    notRun: 0,
  };
  for (const observation of observations) {
    if (observation.finalStatus === null) counts.notRun += 1;
    else counts[observation.finalStatus] += 1;
  }
  return counts;
}

function compareObservations(
  left: PlaywrightFailureObservation,
  right: PlaywrightFailureObservation,
): number {
  const leftKey = `${left.project}\0${left.file}\0${String(left.line).padStart(8, "0")}\0${left.id}`;
  const rightKey = `${right.project}\0${right.file}\0${String(right.line).padStart(8, "0")}\0${right.id}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

/** A factual failure record, never an input to the passing-evidence schema. */
export function buildPlaywrightFailureDiagnostic(
  input: BuildPlaywrightFailureDiagnosticInput,
): PlaywrightFailureDiagnostic {
  const id = runIdSchema.parse(input.id);
  const contract = playwrightRunContracts.find((candidate) => candidate.id === id);
  if (!contract) throw new Error(`Unknown Playwright diagnostic suite: ${id}`);
  const tests = z.array(playwrightFailureObservationSchema).max(2_000)
    .parse(input.tests).sort(compareObservations);
  const expectedProjects = new Set<string>(contract.projects);
  const seen = new Set<string>();
  for (const test of tests) {
    if (!expectedProjects.has(test.project)) {
      throw new Error(`Playwright failure diagnostic contains an unknown project: ${test.project}`);
    }
    const identity = `${test.project}\0${test.id}`;
    if (seen.has(identity)) {
      throw new Error("Playwright failure diagnostic contains a duplicate test identity.");
    }
    seen.add(identity);
  }
  const diagnostic = playwrightFailureDiagnosticSchema.parse({
    version: PLAYWRIGHT_FAILURE_DIAGNOSTIC_VERSION,
    purpose: "execution-diagnostics-only",
    reporterExitCode: 1,
    id,
    runStatus: input.runStatus,
    stage: input.stage,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    globalErrorCount: input.globalErrorCount,
    provenance: input.provenance,
    projects: contract.projects.map((name) => ({
      name,
      counts: summarizeObservations(tests.filter((test) => test.project === name)),
    })),
    tests,
    totals: summarizeObservations(tests),
  });
  if (Date.parse(diagnostic.completedAt) < Date.parse(diagnostic.startedAt)) {
    throw new Error("Playwright failure diagnostic completion precedes its start time.");
  }
  return diagnostic;
}

function assertDiagnostic(
  diagnosticInput: PlaywrightFailureDiagnostic,
): PlaywrightFailureDiagnostic {
  const diagnostic = playwrightFailureDiagnosticSchema.parse(diagnosticInput);
  const rebuilt = buildPlaywrightFailureDiagnostic(diagnostic);
  assertVerificationEqual(diagnostic, rebuilt, "Playwright failure diagnostic");
  return rebuilt;
}

export function serializeCanonicalPlaywrightFailureDiagnostic(
  diagnostic: PlaywrightFailureDiagnostic,
): string {
  return `${JSON.stringify(assertDiagnostic(diagnostic), null, 2)}\n`;
}

export function parseCanonicalPlaywrightFailureDiagnostic(
  text: string,
): PlaywrightFailureDiagnostic {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause: unknown) {
    throw new Error("Playwright failure diagnostic is not valid JSON.", { cause });
  }
  if (text !== `${JSON.stringify(parsed, null, 2)}\n`) {
    throw new Error("Playwright failure diagnostic must use canonical two-space JSON with one final newline.");
  }
  const diagnostic = assertDiagnostic(playwrightFailureDiagnosticSchema.parse(parsed));
  if (text !== serializeCanonicalPlaywrightFailureDiagnostic(diagnostic)) {
    throw new Error("Playwright failure diagnostic fields must use canonical ordering.");
  }
  return diagnostic;
}
