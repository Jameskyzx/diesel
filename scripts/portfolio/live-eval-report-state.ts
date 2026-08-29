export type LiveEvalReportRunError =
  | {
      code: "INITIALIZATION_ERROR";
    }
  | null;

export function deriveLiveEvalReportState(input: {
  resultIds: readonly string[];
  runError: LiveEvalReportRunError;
  suiteIds: readonly string[];
}): { complete: boolean; outcome: "failed" | "passed_candidate" } {
  if (input.resultIds.length > input.suiteIds.length) {
    throw new Error(
      `Live eval report contains ${input.resultIds.length} results for a ${input.suiteIds.length}-case suite.`,
    );
  }

  for (const [index, resultId] of input.resultIds.entries()) {
    const expectedId = input.suiteIds[index];
    if (resultId !== expectedId) {
      throw new Error(
        `Live eval result ${index + 1} must be ${expectedId ?? "absent"}, received ${resultId}.`,
      );
    }
  }

  if (input.runError !== null && input.resultIds.length > 0) {
    throw new Error(
      "A live eval initialization failure cannot contain case results.",
    );
  }
  if (input.runError === null && input.resultIds.length === 0) {
    throw new Error(
      "A live eval without an initialization failure must contain at least one case result.",
    );
  }

  const complete =
    input.runError === null &&
    input.resultIds.length === input.suiteIds.length;
  return {
    complete,
    outcome: complete ? "passed_candidate" : "failed",
  };
}
