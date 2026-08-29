import { afterEach, describe, expect, it, vi } from "vitest";

import { runWithLiveEvalCaseDeadline } from "../scripts/ai/live-eval-deadline";

afterEach(() => {
  vi.useRealTimers();
});

describe("live eval case deadline", () => {
  it("returns a timely result and clears the pending deadline", async () => {
    vi.useFakeTimers();
    const observed: { signal?: AbortSignal } = {};

    await expect(
      runWithLiveEvalCaseDeadline({
        run: async (signal) => {
          observed.signal = signal;
          return "ok";
        },
        timeoutMs: 100,
      }),
    ).resolves.toBe("ok");
    await vi.advanceTimersByTimeAsync(100);

    expect(observed.signal?.aborted).toBe(false);
  });

  it("aborts and rejects a provider operation that does not settle", async () => {
    vi.useFakeTimers();
    const observed: { signal?: AbortSignal } = {};
    const result = runWithLiveEvalCaseDeadline({
      run: (signal) => {
        observed.signal = signal;
        return new Promise<never>(() => undefined);
      },
      timeoutMs: 100,
    });
    const rejection = expect(result).rejects.toThrow(
      "Live eval case exceeded its deadline.",
    );

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(observed.signal?.aborted).toBe(true);
  });

  it("fails closed when a resolved operation is observed at the deadline", async () => {
    const timestamps = [0, 100];
    const observed: { signal?: AbortSignal } = {};

    await expect(
      runWithLiveEvalCaseDeadline({
        now: () => timestamps.shift() ?? 100,
        run: async (signal) => {
          observed.signal = signal;
          return "late";
        },
        timeoutMs: 100,
      }),
    ).rejects.toThrow("Live eval case exceeded its deadline.");
    expect(observed.signal?.aborted).toBe(true);
  });
});
