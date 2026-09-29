export const PUBLIC_API_REQUEST_TIMEOUT_MS = 15_000;

export type PublicApiRequestDeadline = {
  didTimeout: () => boolean;
  dispose: () => void;
  signal: AbortSignal;
};

/**
 * Combines a component-owned lifecycle signal with a bounded deadline for
 * short public JSON requests. Streaming chat intentionally does not use this
 * deadline because it has a separate server-managed lifecycle.
 */
export function createPublicApiRequestDeadline(
  lifecycleSignal: AbortSignal,
  timeoutMs = PUBLIC_API_REQUEST_TIMEOUT_MS,
): PublicApiRequestDeadline {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("timeoutMs must be a positive safe integer");
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(
      new DOMException("Public API request deadline exceeded.", "TimeoutError"),
    );
  }, timeoutMs);
  const signal = AbortSignal.any([
    lifecycleSignal,
    timeoutController.signal,
  ]);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", dispose);
  };
  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted) dispose();

  return {
    didTimeout: () => timeoutController.signal.aborted,
    dispose,
    signal,
  };
}
