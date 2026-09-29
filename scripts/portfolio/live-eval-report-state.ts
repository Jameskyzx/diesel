export type LiveEvalReportRunError =
  | {
      code: "INITIALIZATION_ERROR";
    }
  | null;

export function deriveLiveEvalReportState(input: {
  resultErrorCodes: readonly (string | null)[];
  resultIds: readonly string[];
  runError: LiveEvalReportRunError;
  suiteIds: readonly string[];
}): { complete: boolean; outcome: "failed" | "passed_candidate" } {
  if (input.resultErrorCodes.length !== input.resultIds.length) {
    throw new Error(
      `Live eval report contains ${input.resultErrorCodes.length} error codes for ${input.resultIds.length} results.`,
    );
  }

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

  const terminalStopIndex = input.resultErrorCodes.findIndex(
    (errorCode) =>
      errorCode === "EVAL_CASE_ERROR" || errorCode === "EVAL_BUDGET_STOP",
  );
  if (
    terminalStopIndex !== -1 &&
    terminalStopIndex !== input.resultErrorCodes.length - 1
  ) {
    throw new Error(
      `Live eval terminal case error must end the result sequence; found ${input.resultErrorCodes[terminalStopIndex]} at result ${terminalStopIndex + 1} of ${input.resultErrorCodes.length}.`,
    );
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
    terminalStopIndex === -1 &&
    input.resultIds.length === input.suiteIds.length;
  return {
    complete,
    outcome: complete ? "passed_candidate" : "failed",
  };
}
