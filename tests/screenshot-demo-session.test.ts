import { ChildProcess, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  observeScreenshotDemoProcess,
  screenshotDemoReadinessPath,
  screenshotDemoShutdownNonceHeader,
  screenshotDemoShutdownPath,
  stopOwnedScreenshotDemoServer,
  waitForOwnedScreenshotDemoReadiness,
} from "../scripts/portfolio/screenshot-demo-session";

const expectedNonce = "123e4567-e89b-42d3-a456-426614174000";
const staleNonce = "123e4567-e89b-42d3-a456-426614174001";
const children = new Set<ChildProcess>();

function spawnFixture(source: string): ChildProcess {
  const child = spawn(process.execPath, ["--eval", source], {
    stdio: "ignore",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function observedEventFixture() {
  const child = new ChildProcess();
  const kill = vi.spyOn(child, "kill");
  return { child, kill, observed: observeScreenshotDemoProcess(child) };
}

function connectionError(code: string): Error {
  return new Error("fetch failed", {
    cause: Object.assign(new Error("connection failed"), { code }),
  });
}

function stalledJsonResponse(cancel: () => void): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"instanceNonce":'));
    },
    cancel,
  }));
}

function acknowledgedShutdownFetch(
  child: ChildProcess,
  endpointProbe: () => Promise<Response>,
) {
  const fetchFunction = vi.fn<typeof fetch>();
  fetchFunction.mockImplementation(async (input) => {
    if (String(input).endsWith(screenshotDemoShutdownPath)) {
      queueMicrotask(() => child.emit("exit", 0, null));
      return Response.json({ instanceNonce: expectedNonce, status: "stopped" });
    }
    if (String(input).endsWith(screenshotDemoReadinessPath)) {
      return endpointProbe();
    }
    throw new Error(`Unexpected screenshot demo request: ${String(input)}`);
  });
  return fetchFunction;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children) child.kill("SIGKILL");
  children.clear();
});

describe("nonce-bound screenshot demo process", () => {
  it("does not accept a healthy old service on the requested port", async () => {
    const oldServiceFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(screenshotDemoReadinessPath)) {
        return Response.json({ instanceNonce: staleNonce, status: "ready" });
      }
      if (url.endsWith("/api/health/ready")) {
        return Response.json({ status: "ready" });
      }
      return Response.json({ status: "not_found" }, { status: 404 });
    });
    const observedProcess = observeScreenshotDemoProcess(
      spawnFixture("setTimeout(() => process.exit(23), 40)"),
    );

    await expect(
      waitForOwnedScreenshotDemoReadiness(
        observedProcess,
        "http://127.0.0.1:3210",
        expectedNonce,
        {
          fetchFunction: oldServiceFetch,
          pollIntervalMs: 5,
          readinessTimeoutMs: 2_000,
          requestTimeoutMs: 250,
        },
      ),
    ).rejects.toThrow(/before readiness with code 23/u);
    expect(oldServiceFetch).toHaveBeenCalled();
  });

  it("surfaces a child exit immediately even while the readiness request hangs", async () => {
    const observedProcess = observeScreenshotDemoProcess(
      spawnFixture("process.exit(17)"),
    );
    const neverFetch = vi.fn(
      async () => await new Promise<Response>(() => undefined),
    );

    await expect(
      waitForOwnedScreenshotDemoReadiness(
        observedProcess,
        "http://127.0.0.1:1",
        expectedNonce,
        {
          fetchFunction: neverFetch,
          readinessTimeoutMs: 2_000,
        },
      ),
    ).rejects.toThrow(/before readiness with code 17/u);
  });

  it("surfaces a spawn error while readiness is still pending", async () => {
    const child = spawn(
      resolve(tmpdir(), `missing-screenshot-demo-${process.pid}`),
      [],
      { stdio: "ignore" },
    );
    children.add(child);
    const observedProcess = observeScreenshotDemoProcess(child);
    const neverFetch = vi.fn(
      async () => await new Promise<Response>(() => undefined),
    );

    await expect(
      waitForOwnedScreenshotDemoReadiness(
        observedProcess,
        "http://127.0.0.1:3210",
        expectedNonce,
        { fetchFunction: neverFetch, readinessTimeoutMs: 2_000 },
      ),
    ).rejects.toThrow(/before readiness failed to spawn/u);
  });

  it("does not reinterpret a prior nonzero child exit as successful shutdown", async () => {
    const observedProcess = observeScreenshotDemoProcess(
      spawnFixture("process.exit(9)"),
    );
    await observedProcess.outcome;
    const fetchFunction = vi.fn<typeof fetch>();

    await expect(
      stopOwnedScreenshotDemoServer(
        observedProcess,
        "http://127.0.0.1:1",
        expectedNonce,
        { fetchFunction },
      ),
    ).rejects.toThrow(/before owned shutdown with code 9/u);
    expect(fetchFunction).not.toHaveBeenCalled();
  });

  it("rejects a nonce acknowledgement followed by a nonzero child exit", async () => {
    const observedProcess = observeScreenshotDemoProcess(
      spawnFixture("setTimeout(() => process.exit(11), 30)"),
    );
    const fetchFunction = vi.fn(async () =>
      Response.json({ instanceNonce: expectedNonce, status: "stopped" }),
    );

    const error = await stopOwnedScreenshotDemoServer(
      observedProcess,
      "http://127.0.0.1:3210",
      expectedNonce,
      {
        fetchFunction,
        requestTimeoutMs: 250,
        shutdownExitTimeoutMs: 500,
        shutdownKillTimeoutMs: 250,
      },
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(1);
    expect((error as AggregateError).errors[0]).toMatchObject({
      message: expect.stringContaining("code 11"),
    });
  });

  it("rejects a clean wrapper exit while its owned endpoint remains live", async () => {
    const observedProcess = observeScreenshotDemoProcess(
      spawnFixture("setTimeout(() => process.exit(0), 30)"),
    );
    const fetchFunction = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith(screenshotDemoReadinessPath)
        ? Response.json({ instanceNonce: expectedNonce, status: "ready" })
        : Response.json({ instanceNonce: expectedNonce, status: "stopped" }),
    );

    const error = await stopOwnedScreenshotDemoServer(
      observedProcess,
      "http://127.0.0.1:3210",
      expectedNonce,
      {
        fetchFunction,
        requestTimeoutMs: 250,
        shutdownExitTimeoutMs: 500,
        shutdownKillTimeoutMs: 250,
      },
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(1);
    expect((error as AggregateError).errors[0]).toMatchObject({
      message: expect.stringContaining("endpoint remains live"),
    });
  });
});

describe("screenshot demo endpoint disappearance proof", () => {
  it.each([
    { name: "HTTP 404", probe: async () => new Response(null, { status: 404 }) },
    { name: "HTTP 410", probe: async () => new Response(null, { status: 410 }) },
    {
      name: "a valid readiness identity belonging to another nonce",
      probe: async () => Response.json({ instanceNonce: staleNonce, status: "ready" }),
    },
    {
      name: "a refused connection",
      probe: async (): Promise<Response> => { throw connectionError("ECONNREFUSED"); },
    },
    {
      name: "an aggregate containing only refused connections",
      probe: async (): Promise<Response> => {
        throw new TypeError("fetch failed", {
          cause: new AggregateError([
            Object.assign(new Error("IPv4 refused"), { code: "ECONNREFUSED" }),
            Object.assign(new Error("IPv6 refused"), { code: "ECONNREFUSED" }),
          ]),
        });
      },
    },
  ])("accepts an acknowledged clean exit followed by $name", async ({ probe }) => {
    const { child, kill, observed } = observedEventFixture();
    const fetchFunction = acknowledgedShutdownFetch(child, probe);

    await expect(stopOwnedScreenshotDemoServer(
      observed,
      "http://127.0.0.1:3210",
      expectedNonce,
      { fetchFunction, requestTimeoutMs: 25, shutdownExitTimeoutMs: 50 },
    )).resolves.toBeUndefined();

    expect(kill).not.toHaveBeenCalled();
    expect(fetchFunction).toHaveBeenCalledTimes(2);
    expect(fetchFunction).toHaveBeenNthCalledWith(1,
      `http://127.0.0.1:3210${screenshotDemoShutdownPath}`,
      expect.objectContaining({
        headers: { [screenshotDemoShutdownNonceHeader]: expectedNonce },
        method: "POST",
        redirect: "error",
      }),
    );
    expect(fetchFunction).toHaveBeenNthCalledWith(2,
      `http://127.0.0.1:3210${screenshotDemoReadinessPath}`,
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each([
    ...[204, 301, 302, 307, 308, 400, 401, 403, 429, 500, 502, 503].map((status) => ({
      name: `HTTP ${status}`,
      probe: async () => new Response(null, { status }),
    })),
    { name: "invalid JSON", probe: async () => new Response("{invalid") },
    { name: "a body over 4 KiB", probe: async () => new Response(JSON.stringify("a".repeat(4096))) },
    { name: "an invalid readiness shape", probe: async () => Response.json({}) },
    {
      name: "a different nonce with an invalid readiness status",
      probe: async () => Response.json({ instanceNonce: staleNonce, status: "stopped" }),
    },
    {
      name: "a different nonce with unexpected properties",
      probe: async () => Response.json({ instanceNonce: staleNonce, status: "ready", extra: true }),
    },
    ...["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH"].map((code) => ({
      name: code,
      probe: async (): Promise<Response> => { throw connectionError(code); },
    })),
    {
      name: "a fetch error without a coded cause",
      probe: async (): Promise<Response> => { throw new TypeError("fetch failed"); },
    },
    {
      name: "an abort",
      probe: async (): Promise<Response> => { throw new DOMException("aborted", "AbortError"); },
    },
    {
      name: "a request deadline error",
      probe: async (): Promise<Response> => { throw new DOMException("timed out", "TimeoutError"); },
    },
    {
      name: "a non-Error object claiming connection refusal",
      probe: async (): Promise<Response> => {
        throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      },
    },
    {
      name: "a body read failure claiming connection refusal",
      probe: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(connectionError("ECONNREFUSED"));
        },
      })),
    },
    {
      name: "a mixed refused/reset connection aggregate",
      probe: async (): Promise<Response> => {
        throw new TypeError("fetch failed", {
          cause: new AggregateError([
            Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
            Object.assign(new Error("reset"), { code: "ECONNRESET" }),
          ]),
        });
      },
    },
    {
      name: "an empty connection aggregate",
      probe: async (): Promise<Response> => {
        throw new TypeError("fetch failed", { cause: new AggregateError([]) });
      },
    },
  ])("rejects a clean exit when the endpoint probe gives only $name", async ({ probe }) => {
    const { child, kill, observed } = observedEventFixture();
    const fetchFunction = acknowledgedShutdownFetch(child, probe);

    await expect(stopOwnedScreenshotDemoServer(
      observed,
      "http://127.0.0.1:3210",
      expectedNonce,
      { fetchFunction, requestTimeoutMs: 25, shutdownExitTimeoutMs: 50 },
    )).rejects.toThrow("Screenshot demo shutdown was not proven successful.");
    expect(kill).not.toHaveBeenCalled();
  });

  it("rejects and cancels a stalled disappearance-probe body after the request deadline", async () => {
    const cancel = vi.fn();
    const { child, observed } = observedEventFixture();
    const fetchFunction = acknowledgedShutdownFetch(child, async () => stalledJsonResponse(cancel));

    await expect(stopOwnedScreenshotDemoServer(
      observed,
      "http://127.0.0.1:3210",
      expectedNonce,
      { fetchFunction, requestTimeoutMs: 10, shutdownExitTimeoutMs: 50 },
    )).rejects.toThrow("Screenshot demo shutdown was not proven successful.");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not accept a clean exit and gone endpoint without a valid shutdown acknowledgement", async () => {
    const { child, observed } = observedEventFixture();
    const fetchFunction = vi.fn<typeof fetch>();
    fetchFunction.mockImplementation(async (input) => {
      if (String(input).endsWith(screenshotDemoShutdownPath)) {
        queueMicrotask(() => child.emit("exit", 0, null));
        return Response.json({ instanceNonce: staleNonce, status: "stopped" });
      }
      return new Response(null, { status: 404 });
    });

    await expect(stopOwnedScreenshotDemoServer(
      observed,
      "http://127.0.0.1:3210",
      expectedNonce,
      { fetchFunction, requestTimeoutMs: 25, shutdownExitTimeoutMs: 50 },
    )).rejects.toThrow("Screenshot demo shutdown was not proven successful.");
  });

  it("cancels a stalled shutdown acknowledgement and rejects despite clean exit and a gone endpoint", async () => {
    const cancel = vi.fn();
    const { child, observed } = observedEventFixture();
    const fetchFunction = vi.fn<typeof fetch>();
    fetchFunction.mockImplementation(async (input) => {
      if (String(input).endsWith(screenshotDemoShutdownPath)) {
        queueMicrotask(() => child.emit("exit", 0, null));
        return stalledJsonResponse(cancel);
      }
      return new Response(null, { status: 404 });
    });

    await expect(stopOwnedScreenshotDemoServer(
      observed,
      "http://127.0.0.1:3210",
      expectedNonce,
      { fetchFunction, requestTimeoutMs: 10, shutdownExitTimeoutMs: 50 },
    )).rejects.toThrow("Screenshot demo shutdown was not proven successful.");
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("screenshot demo readiness response boundaries", () => {
  it("requires its valid nonce identity before checking application health", async () => {
    const { observed } = observedEventFixture();
    const fetchFunction = vi.fn<typeof fetch>();
    fetchFunction
      .mockResolvedValueOnce(Response.json({ instanceNonce: expectedNonce, status: "ready" }))
      .mockResolvedValueOnce(Response.json({ status: "ready" }));

    await expect(waitForOwnedScreenshotDemoReadiness(
      observed,
      "http://127.0.0.1:3210",
      expectedNonce,
      { fetchFunction, readinessTimeoutMs: 100, requestTimeoutMs: 25 },
    )).resolves.toBeUndefined();

    expect(fetchFunction.mock.calls.map(([input]) => String(input))).toEqual([
      `http://127.0.0.1:3210${screenshotDemoReadinessPath}`,
      "http://127.0.0.1:3210/api/health/ready",
    ]);
    for (const [, init] of fetchFunction.mock.calls) {
      expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    { name: "malformed JSON", response: () => new Response("{invalid") },
    { name: "an oversized body", response: () => new Response(JSON.stringify("a".repeat(4096))) },
    { name: "a stale nonce", response: () => Response.json({ instanceNonce: staleNonce, status: "ready" }) },
    { name: "an invalid shape", response: () => Response.json({ instanceNonce: expectedNonce, status: "stopped" }) },
  ])("does not check health or become ready after $name", async ({ response }) => {
    const { observed } = observedEventFixture();
    const fetchFunction = vi.fn<typeof fetch>();
    fetchFunction.mockImplementation(async () => response());

    await expect(waitForOwnedScreenshotDemoReadiness(
      observed,
      "http://127.0.0.1:3210",
      expectedNonce,
      { fetchFunction, pollIntervalMs: 1, readinessTimeoutMs: 15, requestTimeoutMs: 5 },
    )).rejects.toThrow("Timed out waiting for the owned screenshot demo server.");
    expect(fetchFunction).toHaveBeenCalled();
    expect(fetchFunction.mock.calls.every(([input]) => String(input).endsWith(screenshotDemoReadinessPath))).toBe(true);
  });

  it("does not become ready when identity is valid but application health fails", async () => {
    const { observed } = observedEventFixture();
    const fetchFunction = vi.fn<typeof fetch>();
    fetchFunction.mockImplementation(async (input) => String(input).endsWith(screenshotDemoReadinessPath)
      ? Response.json({ instanceNonce: expectedNonce, status: "ready" })
      : Response.json({ status: "unavailable" }, { status: 503 }));

    await expect(waitForOwnedScreenshotDemoReadiness(
      observed,
      "http://127.0.0.1:3210",
      expectedNonce,
      { fetchFunction, pollIntervalMs: 1, readinessTimeoutMs: 15, requestTimeoutMs: 5 },
    )).rejects.toThrow("Timed out waiting for the owned screenshot demo server.");
    expect(fetchFunction.mock.calls.some(([input]) => String(input).endsWith("/api/health/ready"))).toBe(true);
  });

  it("bounds stalled readiness bodies and cancels them without reaching application health", async () => {
    const cancel = vi.fn();
    const { observed } = observedEventFixture();
    const fetchFunction = vi.fn<typeof fetch>();
    fetchFunction.mockImplementation(async () => stalledJsonResponse(cancel));

    await expect(waitForOwnedScreenshotDemoReadiness(
      observed,
      "http://127.0.0.1:3210",
      expectedNonce,
      { fetchFunction, pollIntervalMs: 1, readinessTimeoutMs: 20, requestTimeoutMs: 5 },
    )).rejects.toThrow("Timed out waiting for the owned screenshot demo server.");
    expect(cancel).toHaveBeenCalledTimes(fetchFunction.mock.calls.length);
    expect(fetchFunction.mock.calls.every(([input]) => String(input).endsWith(screenshotDemoReadinessPath))).toBe(true);
  });
});
