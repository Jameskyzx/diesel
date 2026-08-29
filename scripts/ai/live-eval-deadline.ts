type LiveEvalCaseDeadlineInput<T> = {
  now?: () => number;
  run: (abortSignal: AbortSignal) => Promise<T>;
  timeoutMs: number;
};

export class LiveEvalCaseTimeoutError extends Error {
  override readonly name = "LiveEvalCaseTimeoutError";

  constructor() {
    super("Live eval case exceeded its deadline.");
  }
}

function deadlineError(): Error {
  return new LiveEvalCaseTimeoutError();
}

export async function runWithLiveEvalCaseDeadline<T>(
  input: LiveEvalCaseDeadlineInput<T>,
): Promise<T> {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error("Live eval case timeout must be a positive integer.");
  }

  const now = input.now ?? (() => performance.now());
  const startedAt = now();
  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      abortController.abort();
      reject(deadlineError());
    }, input.timeoutMs);
  });

  try {
    const result = await Promise.race([
      input.run(abortController.signal),
      deadline,
    ]);
    if (
      abortController.signal.aborted ||
      now() - startedAt >= input.timeoutMs
    ) {
      abortController.abort();
      throw deadlineError();
    }
    return result;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
