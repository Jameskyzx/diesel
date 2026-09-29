import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPublicDataAdmissionGate,
  PUBLIC_DATA_OPERATION_TIMEOUT_MS,
  resetPublicDataAdmissionForTests,
  runPublicDataOperation,
  runPublicDataRenderOperation,
} from "@/server/http/public-data-admission";
import { createCountryRepository } from "@/server/repositories/country-repository";

function createDeferred<T>() {
  let rejectPromise: (error: unknown) => void = () => undefined;
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function request(
  signal?: AbortSignal,
  clientIdentifier = "192.0.2.1",
): Request {
  return new Request("http://localhost/api/countries", {
    headers: { "x-forwarded-for": clientIdentifier },
    signal,
  });
}

function createDeferredSelectDatabase() {
  const queries: Array<ReturnType<typeof createDeferred<unknown[]>>> = [];
  const select = vi.fn(() => {
    const deferred = createDeferred<unknown[]>();
    queries.push(deferred);
    const query: object = new Proxy({}, {
      get(_target, property) {
        if (property === "then") {
          return deferred.promise.then.bind(deferred.promise);
        }
        return () => query;
      },
    });
    return query;
  });
  const database = { select } as unknown as Parameters<
    typeof createCountryRepository
  >[0];
  return { database, queries, select };
}

describe("public data admission", () => {
  beforeEach(() => {
    resetPublicDataAdmissionForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetPublicDataAdmissionForTests();
  });

  it.each([
    { globalLimit: 0, perClientLimit: 1 },
    { globalLimit: 1, perClientLimit: 0 },
    { globalLimit: 1.5, perClientLimit: 1 },
    { globalLimit: 1, perClientLimit: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid in-flight limits: $globalLimit/$perClientLimit", (limits) => {
    expect(() => createPublicDataAdmissionGate(limits)).toThrow(RangeError);
  });

  it("enforces global and per-client limits with idempotent release", () => {
    const gate = createPublicDataAdmissionGate({
      globalLimit: 2,
      perClientLimit: 1,
    });
    const first = gate.tryAcquire("client-a");
    const second = gate.tryAcquire("client-b");

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(gate.tryAcquire("client-a")).toBeNull();
    expect(gate.tryAcquire("client-c")).toBeNull();

    first?.release();
    first?.release();
    expect(gate.tryAcquire("client-c")).not.toBeNull();

    gate.reset();
    expect(gate.tryAcquire("client-a")).not.toBeNull();
  });

  it("returns fulfilled and failed work without leaking a rejection", async () => {
    await expect(
      runPublicDataOperation({
        request: request(),
        route: "/api/countries",
        work: async () => "ok",
      }),
    ).resolves.toEqual({ status: "fulfilled", value: "ok" });

    const failure = new Error("database unavailable");
    await expect(
      runPublicDataOperation({
        request: request(),
        route: "/api/countries",
        work: async () => {
          throw failure;
        },
      }),
    ).resolves.toEqual({ error: failure, status: "failed" });
  });

  it("admits header-only render fan-out as one lease and does not start excess work", async () => {
    const firstBranches = [createDeferred<string>(), createDeferred<string>()];
    const second = createDeferred<string>();
    const firstWork = vi.fn(async () =>
      Promise.all(firstBranches.map(({ promise }) => promise)),
    );
    const secondWork = vi.fn(() => second.promise);
    const excessWork = vi.fn(async () => "must-not-run");
    const headers = new Headers({ "x-forwarded-for": "192.0.2.20" });

    const firstPending = runPublicDataRenderOperation({
      headers,
      route: "/countries/:iso3",
      work: firstWork,
    });
    await vi.waitFor(() => expect(firstWork).toHaveBeenCalledOnce());

    // The two branches inside the first render share its one outer lease, so
    // a second operation can still enter the global limit of two.
    const secondPending = runPublicDataRenderOperation({
      headers,
      route: "/countries/:iso3",
      work: secondWork,
    });
    await vi.waitFor(() => expect(secondWork).toHaveBeenCalledOnce());

    await expect(
      runPublicDataRenderOperation({
        headers,
        route: "/countries/:iso3",
        work: excessWork,
      }),
    ).resolves.toEqual({ status: "admission_rejected" });
    expect(excessWork).not.toHaveBeenCalled();

    firstBranches.forEach((branch, index) => branch.resolve(`branch-${index}`));
    second.resolve("second");
    await expect(firstPending).resolves.toEqual({
      status: "fulfilled",
      value: ["branch-0", "branch-1"],
    });
    await expect(secondPending).resolves.toEqual({
      status: "fulfilled",
      value: "second",
    });
  });

  it("passes a deadline signal to header-only render work", async () => {
    vi.useFakeTimers();
    const deferred = createDeferred<string>();
    let receivedSignal: AbortSignal | undefined;
    const pending = runPublicDataRenderOperation({
      headers: new Headers({ "x-forwarded-for": "192.0.2.21" }),
      route: "/countries/:iso3",
      work: (signal) => {
        receivedSignal = signal;
        return deferred.promise;
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(receivedSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(PUBLIC_DATA_OPERATION_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ status: "timed_out" });
    expect(receivedSignal?.aborted).toBe(true);

    deferred.resolve("late-settlement");
    await deferred.promise;
    await Promise.resolve();
    await Promise.resolve();
  });

  it("does not acquire admission or start work for a pre-aborted request", async () => {
    const abortController = new AbortController();
    const work = vi.fn(async () => "not-run");
    abortController.abort("client-disconnected");

    await expect(
      runPublicDataOperation({
        request: request(abortController.signal),
        route: "/api/countries",
        work,
      }),
    ).resolves.toEqual({ status: "aborted" });
    expect(work).not.toHaveBeenCalled();
  });

  it("closes the abort race between the initial check and listener registration", async () => {
    const abortController = new AbortController();
    const deferred = createDeferred<string>();
    const work = vi.fn(() => deferred.promise);
    let signalReads = 0;
    const racedRequest = {
      headers: new Headers({ "x-forwarded-for": "192.0.2.2" }),
      get signal() {
        signalReads += 1;
        if (signalReads === 2) {
          abortController.abort("client-disconnected-in-race");
        }
        return abortController.signal;
      },
    } as unknown as Request;

    const result = await runPublicDataOperation({
      request: racedRequest,
      route: "/api/countries",
      timeoutMs: 60_000,
      work,
    });

    expect(result).toEqual({ status: "aborted" });
    expect(signalReads).toBeGreaterThanOrEqual(2);
    expect(work).not.toHaveBeenCalled();
    deferred.resolve("finished");
    await deferred.promise;
    await Promise.resolve();
    await Promise.resolve();
  });

  it("does not start work or leak a lease when headers abort after the core precheck", async () => {
    const abortController = new AbortController();
    const work = vi.fn(async () => "must-not-run");
    const racedRequest = {
      headers: {
        get() {
          abortController.abort("client-disconnected-during-admission");
          return "192.0.2.3";
        },
      },
      signal: abortController.signal,
    } as unknown as Request;

    await expect(
      runPublicDataOperation({
        request: racedRequest,
        route: "/api/countries",
        timeoutMs: 60_000,
        work,
      }),
    ).resolves.toEqual({ status: "aborted" });
    expect(work).not.toHaveBeenCalled();

    // Both global slots remain available, proving the never-started operation
    // returned its lease rather than waiting for a settlement that cannot run.
    const deferreds = [createDeferred<string>(), createDeferred<string>()];
    const admittedWork = vi.fn((signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      return deferreds[admittedWork.mock.calls.length - 1]!.promise;
    });
    const admitted = deferreds.map((_, index) =>
      runPublicDataOperation({
        request: request(),
        route: `/api/countries/${index}`,
        work: admittedWork,
      }),
    );
    await vi.waitFor(() => expect(admittedWork).toHaveBeenCalledTimes(2));

    deferreds.forEach((deferred, index) => deferred.resolve(`result-${index}`));
    await expect(Promise.all(admitted)).resolves.toEqual([
      { status: "fulfilled", value: "result-0" },
      { status: "fulfilled", value: "result-1" },
    ]);
  });

  it("keeps timed-out work admitted until its non-rejecting settlement", async () => {
    vi.useFakeTimers();
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const thirdWork = vi.fn(async () => "third");
    const firstPending = runPublicDataOperation({
      request: request(),
      route: "/api/countries",
      work: () => first.promise,
    });
    const secondPending = runPublicDataOperation({
      request: request(),
      route: "/api/products",
      work: () => second.promise,
    });

    await vi.advanceTimersByTimeAsync(PUBLIC_DATA_OPERATION_TIMEOUT_MS);
    await expect(firstPending).resolves.toEqual({ status: "timed_out" });
    await expect(secondPending).resolves.toEqual({ status: "timed_out" });
    await expect(
      runPublicDataOperation({
        request: request(),
        route: "/api/countries",
        work: thirdWork,
      }),
    ).resolves.toEqual({ status: "admission_rejected" });
    expect(thirdWork).not.toHaveBeenCalled();

    first.resolve("finished");
    await first.promise;
    await Promise.resolve();
    await Promise.resolve();
    await expect(
      runPublicDataOperation({
        request: request(),
        route: "/api/countries",
        work: thirdWork,
      }),
    ).resolves.toEqual({ status: "fulfilled", value: "third" });

    second.resolve("finished");
    await second.promise;
    await Promise.resolve();
    await Promise.resolve();
  });

  it("keeps admission until every nested country-detail query settles after an early rejection", async () => {
    const fake = createDeferredSelectDatabase();
    const repository = createCountryRepository(fake.database);
    const held = createDeferred<string>();
    const heldWork = vi.fn(() => held.promise);
    const excessWork = vi.fn(async () => "must-not-run");
    const firstPending = runPublicDataOperation({
      request: request(undefined, "192.0.2.30"),
      route: "/api/countries/:iso3",
      work: () => repository.findDetailsByIso3({
        asOf: "2026-08-30",
        iso3: "CHN",
      }),
    });

    await vi.waitFor(() => expect(fake.select).toHaveBeenCalledOnce());
    fake.queries[0]!.resolve([{}]);
    await vi.waitFor(() => expect(fake.select).toHaveBeenCalledTimes(4));

    const heldPending = runPublicDataOperation({
      request: request(undefined, "192.0.2.31"),
      route: "/api/products",
      work: heldWork,
    });
    await vi.waitFor(() => expect(heldWork).toHaveBeenCalledOnce());

    const jurisdictionFailure = new Error("jurisdiction query failed");
    const regulationFailure = new Error("regulation query failed first");
    // The regulation branch rejects first, while the jurisdiction and market
    // branches remain active. The repository and outer admission lease must
    // not settle on this first rejection.
    fake.queries[2]!.reject(regulationFailure);
    let firstSettled = false;
    void firstPending.then(() => {
      firstSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(firstSettled).toBe(false);

    await expect(
      runPublicDataOperation({
        request: request(undefined, "192.0.2.32"),
        route: "/api/countries",
        work: excessWork,
      }),
    ).resolves.toEqual({ status: "admission_rejected" });
    expect(excessWork).not.toHaveBeenCalled();

    // Failure selection follows query input order, not rejection timing.
    fake.queries[1]!.reject(jurisdictionFailure);
    fake.queries[3]!.resolve([]);
    await expect(firstPending).resolves.toEqual({
      error: jurisdictionFailure,
      status: "failed",
    });

    await expect(
      runPublicDataOperation({
        request: request(undefined, "192.0.2.32"),
        route: "/api/countries",
        work: async () => "recovered",
      }),
    ).resolves.toEqual({ status: "fulfilled", value: "recovered" });

    held.resolve("held-finished");
    await expect(heldPending).resolves.toEqual({
      status: "fulfilled",
      value: "held-finished",
    });
  });

  it("observes and sanitizes a late failure before releasing admission", async () => {
    const abortController = new AbortController();
    const deferred = createDeferred<string>();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const pending = runPublicDataOperation({
      request: request(abortController.signal),
      route: "/api/products",
      work: () => deferred.promise,
    });
    await Promise.resolve();
    abortController.abort("client-disconnected");

    await expect(pending).resolves.toEqual({ status: "aborted" });
    deferred.reject(new Error("postgres://user:secret@example.test/database"));
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "Public data operation failed after request completion",
        { errorCode: "Error", route: "/api/products" },
      );
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
    consoleError.mockRestore();
  });

  it("still releases admission when the late-failure logger throws", async () => {
    const abortController = new AbortController();
    const deferred = createDeferred<string>();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {
        throw new Error("logger unavailable");
      });
    const pending = runPublicDataOperation({
      request: request(abortController.signal),
      route: "/api/products",
      work: () => deferred.promise,
    });
    await Promise.resolve();
    abortController.abort("client-disconnected");
    await expect(pending).resolves.toEqual({ status: "aborted" });

    deferred.reject(new Error("database unavailable"));
    await Promise.resolve();
    await Promise.resolve();
    await expect(
      runPublicDataOperation({
        request: request(),
        route: "/api/products",
        work: async () => "recovered",
      }),
    ).resolves.toEqual({ status: "fulfilled", value: "recovered" });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid operation timeout %s",
    async (timeoutMs) => {
      await expect(
        runPublicDataOperation({
          request: request(),
          route: "/api/countries",
          timeoutMs,
          work: async () => "not-run",
        }),
      ).rejects.toThrow(RangeError);
    },
  );
});
