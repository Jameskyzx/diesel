import "server-only";

export type RequestSignalOptions = {
  signal?: AbortSignal;
};

/**
 * Rejects with a fixed error rather than forwarding the caller-controlled
 * AbortSignal reason into logs or public error handling.
 */
export function throwIfRequestAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The request was canceled.", "AbortError");
  }
}
