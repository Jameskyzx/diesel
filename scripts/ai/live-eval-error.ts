export const SAFE_LIVE_EVAL_ERROR_NAMES = [
  "AI_APICallError",
  "AI_InvalidPromptError",
  "AI_NoOutputGeneratedError",
  "AI_RetryError",
  "AI_UnsupportedFunctionalityError",
  "AiConfigurationError",
  "Error",
  "LiveEvalCaseTimeoutError",
  "SyntaxError",
  "TypeError",
  "UnknownError",
  "ZodError",
] as const;

const safeErrorNames = new Set<string>(SAFE_LIVE_EVAL_ERROR_NAMES);
const errorNamePriority: readonly string[] = [
  "AI_APICallError",
  "AI_InvalidPromptError",
  "AI_UnsupportedFunctionalityError",
  "AiConfigurationError",
  "LiveEvalCaseTimeoutError",
  "ZodError",
  "TypeError",
  "SyntaxError",
  "AI_NoOutputGeneratedError",
  "AI_RetryError",
  "Error",
  "UnknownError",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function safeRead(
  record: Record<string, unknown>,
  key: string,
): unknown {
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function safeTail(value: unknown): unknown[] {
  try {
    return Array.isArray(value) ? value.slice(-3).reverse() : [];
  } catch {
    return [];
  }
}

function errorCandidates(error: unknown): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  const pending: unknown[] = [error];
  const seen = new Set<object>();

  while (pending.length > 0 && candidates.length < 8) {
    const current = pending.shift();
    const record = asRecord(current);
    if (record === null || seen.has(record)) continue;

    seen.add(record);
    candidates.push(record);
    pending.push(safeRead(record, "cause"), safeRead(record, "lastError"));
    pending.push(...safeTail(safeRead(record, "errors")));
  }

  return candidates;
}

export function safeLiveEvalErrorName(error: unknown): string {
  try {
    const observedNames = new Set<string>();

    for (const candidate of errorCandidates(error)) {
      const name = safeRead(candidate, "name");
      if (typeof name !== "string" || !safeErrorNames.has(name)) continue;
      observedNames.add(name);
    }

    for (const name of errorNamePriority) {
      if (observedNames.has(name)) return name;
    }
    return error instanceof Error ? "Error" : "UnknownError";
  } catch {
    return "UnknownError";
  }
}

export function safeLiveEvalHttpStatus(error: unknown): number | null {
  try {
    for (const candidate of errorCandidates(error)) {
      const statusCode = safeRead(candidate, "statusCode");
      if (
        typeof statusCode === "number" &&
        Number.isSafeInteger(statusCode) &&
        statusCode >= 400 &&
        statusCode <= 599
      ) {
        return statusCode;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function summarizeLiveEvalError(error: unknown): string {
  try {
    const name = safeLiveEvalErrorName(error);
    const status = safeLiveEvalHttpStatus(error);
    return `${name}${status === null ? "" : ` (HTTP ${status})`}: Eval case execution failed.`;
  } catch {
    return "UnknownError: Eval case execution failed.";
  }
}
