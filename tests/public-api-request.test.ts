import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPublicApiRequestDeadline,
  PUBLIC_API_REQUEST_TIMEOUT_MS,
} from "@/lib/public-api-request";

afterEach(() => {
  vi.useRealTimers();
});

describe("public API request deadline", () => {
  it("aborts a short public request at the shared deadline", () => {
    vi.useFakeTimers();
    const lifecycleController = new AbortController();
    const deadline = createPublicApiRequestDeadline(
      lifecycleController.signal,
    );

    vi.advanceTimersByTime(PUBLIC_API_REQUEST_TIMEOUT_MS - 1);
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.didTimeout()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.didTimeout()).toBe(true);
    expect(deadline.signal.reason).toBeInstanceOf(DOMException);
    expect((deadline.signal.reason as DOMException).name).toBe("TimeoutError");
  });

  it("propagates lifecycle cancellation without waiting for the deadline", () => {
    vi.useFakeTimers();
    const lifecycleController = new AbortController();
    const deadline = createPublicApiRequestDeadline(
      lifecycleController.signal,
    );
    const reason = new DOMException("Navigation changed.", "AbortError");

    lifecycleController.abort(reason);

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe(reason);
    expect(deadline.didTimeout()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("can dispose a completed request without a later abort", () => {
    vi.useFakeTimers();
    const deadline = createPublicApiRequestDeadline(
      new AbortController().signal,
      25,
    );

    deadline.dispose();
    vi.advanceTimersByTime(25);

    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.didTimeout()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects invalid custom deadlines", () => {
    expect(() =>
      createPublicApiRequestDeadline(new AbortController().signal, 0),
    ).toThrow(RangeError);
  });
});
