import { z } from "zod";

import {
  parseVitestJsonReporterOutput,
  summarizeReportedFailure,
} from "./vitest-execution-evidence";

const observationsSchema = z.array(z.object({
  file: z.string().min(1).max(4_096),
  tests: z.array(z.object({
    ancestorTitles: z.array(z.string().max(20_000)).max(100),
    title: z.string().min(1).max(20_000),
    location: z.object({
      line: z.number().int().positive(),
      column: z.number().int().positive(),
    }).strict().nullable(),
    state: z.enum(["passed", "failed", "pending", "skipped"]),
    firstError: z.unknown(),
  }).strict()).max(100_000),
}).strict()).max(10_000);

export type VitestReporterErrorObservations = z.infer<typeof observationsSchema>;

const timeoutErrorSchema = z.object({
  name: z.literal("Error"),
  message: z.string().min(1).max(500_000),
  stack: z.string().max(500_000).optional(),
});

function assertAligned(condition: boolean): asserts condition {
  if (!condition) {
    // Do not echo names, paths, or raw errors when the two views disagree.
    throw new Error("Vitest structured errors do not match the JSON reporter inventory.");
  }
}

/** Repairs only a recognized first timeout; outcomes and runner objects are untouched. */
export function restoreVitestTimeoutMessages(
  text: string,
  observations: unknown,
): string {
  const report = parseVitestJsonReporterOutput(text);
  const modules = observationsSchema.parse(observations);
  assertAligned(report.testResults.length === modules.length);
  let changed = false;
  report.testResults.forEach((file, fileIndex) => {
    const observedModule = modules[fileIndex]!;
    assertAligned(file.name === observedModule.file);
    assertAligned(file.assertionResults.length === observedModule.tests.length);
    file.assertionResults.forEach((test, testIndex) => {
      const observed = observedModule.tests[testIndex]!;
      const state = test.status === "todo" || test.status === "disabled"
        ? "skipped"
        : test.status;
      assertAligned(state === observed.state);
      assertAligned(test.title === observed.title);
      assertAligned(JSON.stringify(test.ancestorTitles) === JSON.stringify(observed.ancestorTitles));
      assertAligned(test.fullName === [...observed.ancestorTitles, observed.title].join(" "));
      assertAligned((test.location?.line ?? null) === (observed.location?.line ?? null));
      assertAligned((test.location?.column ?? null) === (observed.location?.column ?? null));
      if (state !== "failed") return;
      const error = timeoutErrorSchema.safeParse(observed.firstError);
      if (!error.success) return;
      const firstLine = `Error: ${error.data.message.split(/\r?\n/u, 1)[0]}`;
      const failure = summarizeReportedFailure([firstLine]);
      if (failure.kind !== "test_timeout" && failure.kind !== "hook_timeout") return;
      // Correlate the first error as well as the case before replacing its lossy stack.
      assertAligned(test.failureMessages?.[0] === (error.data.stack || error.data.message));
      test.failureMessages = [firstLine, ...test.failureMessages!.slice(1)];
      changed = true;
    });
  });
  return changed ? JSON.stringify(report) : text;
}
