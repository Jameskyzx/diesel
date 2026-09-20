import type { ChildProcess } from "node:child_process";

import { z } from "zod";

import {
  discardScreenshotDemoResponse,
  readScreenshotDemoJson,
} from "./screenshot-demo-json";

export const screenshotDemoInstanceNonceEnvironmentVariable =
  "DEMO_INSTANCE_NONCE" as const;
export const screenshotDemoReadinessPath = "/__demo/readiness" as const;
export const screenshotDemoShutdownPath = "/__demo/shutdown" as const;
export const screenshotDemoShutdownNonceHeader =
  "x-diesel-demo-instance-nonce" as const;

export const screenshotDemoInstanceNonceSchema = z.string().uuid();

const readinessSchema = z
  .object({
    instanceNonce: screenshotDemoInstanceNonceSchema,
    status: z.literal("ready"),
  })
  .strict();
const shutdownSchema = z
  .object({
    instanceNonce: screenshotDemoInstanceNonceSchema,
    status: z.literal("stopped"),
  })
  .strict();

export type ScreenshotDemoProcessOutcome =
  | Readonly<{ error: Error; type: "spawn_error" }>
  | Readonly<{
      code: number | null;
      signal: NodeJS.Signals | null;
      type: "exit";
    }>;

export type ObservedScreenshotDemoProcess = Readonly<{
  child: ChildProcess;
  currentOutcome: () => ScreenshotDemoProcessOutcome | null;
  outcome: Promise<ScreenshotDemoProcessOutcome>;
}>;

type FetchFunction = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

type DemoRequestOptions = Readonly<{
  fetchFunction?: FetchFunction;
  pollIntervalMs?: number;
  readinessTimeoutMs?: number;
  requestTimeoutMs?: number;
  shutdownExitTimeoutMs?: number;
  shutdownKillTimeoutMs?: number;
}>;

function errorFromOutcome(
  outcome: ScreenshotDemoProcessOutcome,
  phase: string,
): Error {
  if (outcome.type === "spawn_error") {
    return new Error(`Screenshot demo ${phase} failed to spawn.`, {
      cause: outcome.error,
    });
  }
  return new Error(
    `Screenshot demo exited ${phase} with code ${outcome.code ?? "null"}` +
      ` and signal ${outcome.signal ?? "null"}.`,
  );
}

export function observeScreenshotDemoProcess(
  child: ChildProcess,
): ObservedScreenshotDemoProcess {
  let currentOutcome: ScreenshotDemoProcessOutcome | null = null;
  let settleOutcome: ((outcome: ScreenshotDemoProcessOutcome) => void) | null =
    null;
  const outcome = new Promise<ScreenshotDemoProcessOutcome>((resolveOutcome) => {
    settleOutcome = resolveOutcome;
  });
  const settle = (next: ScreenshotDemoProcessOutcome) => {
    if (currentOutcome !== null) return;
    currentOutcome = next;
    settleOutcome?.(next);
  };
  child.once("error", (error) => settle({ error, type: "spawn_error" }));
  child.once("exit", (code, signal) =>
    settle({ code, signal, type: "exit" }),
  );
  if (child.exitCode !== null || child.signalCode !== null) {
    settle({
      code: child.exitCode,
      signal: child.signalCode,
      type: "exit",
    });
  }
  return {
    child,
    currentOutcome: () => currentOutcome,
    outcome,
  };
}

function timeoutSignal(milliseconds: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, milliseconds));
}

async function probeOwnedReadiness(input: {
  baseURL: string;
  fetchFunction: FetchFunction;
  nonce: string;
  requestTimeoutMs: number;
}): Promise<boolean> {
  try {
    const identitySignal = timeoutSignal(input.requestTimeoutMs);
    const identityResponse = await input.fetchFunction(
      `${input.baseURL}${screenshotDemoReadinessPath}`,
      { cache: "no-store", redirect: "error", signal: identitySignal },
    );
    if (!identityResponse.ok) {
      discardScreenshotDemoResponse(identityResponse);
      return false;
    }
    const identity = readinessSchema.parse(
      await readScreenshotDemoJson(identityResponse, identitySignal),
    );
    if (identity.instanceNonce !== input.nonce) return false;
    const applicationReadiness = await input.fetchFunction(
      `${input.baseURL}/api/health/ready`,
      { cache: "no-store", redirect: "error", signal: timeoutSignal(input.requestTimeoutMs) },
    );
    discardScreenshotDemoResponse(applicationReadiness);
    return applicationReadiness.ok;
  } catch {
    return false;
  }
}

async function delayOrProcessExit(
  process: ObservedScreenshotDemoProcess,
  milliseconds: number,
): Promise<ScreenshotDemoProcessOutcome | null> {
  return new Promise((resolveWait) => {
    let settled = false;
    const finish = (value: ScreenshotDemoProcessOutcome | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveWait(value);
    };
    const timer = setTimeout(() => finish(null), milliseconds);
    process.outcome.then((outcome) => finish(outcome));
  });
}

export async function waitForOwnedScreenshotDemoReadiness(
  process: ObservedScreenshotDemoProcess,
  baseURL: string,
  nonce: string,
  options: DemoRequestOptions = {},
): Promise<void> {
  screenshotDemoInstanceNonceSchema.parse(nonce);
  const fetchFunction = options.fetchFunction ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 120_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 2_000;
  const deadline = Date.now() + readinessTimeoutMs;
  while (Date.now() < deadline) {
    const existingOutcome = process.currentOutcome();
    if (existingOutcome !== null) {
      throw errorFromOutcome(existingOutcome, "before readiness");
    }
    const probe = probeOwnedReadiness({
      baseURL,
      fetchFunction,
      nonce,
      requestTimeoutMs,
    });
    const result = await Promise.race([
      probe.then((ready) => ({ ready, type: "probe" as const })),
      process.outcome.then((outcome) => ({ outcome, type: "process" as const })),
    ]);
    if (result.type === "process") {
      throw errorFromOutcome(result.outcome, "before readiness");
    }
    if (result.ready) return;
    const delayOutcome = await delayOrProcessExit(process, pollIntervalMs);
    if (delayOutcome !== null) {
      throw errorFromOutcome(delayOutcome, "before readiness");
    }
  }
  throw new Error("Timed out waiting for the owned screenshot demo server.");
}

async function waitForProcessOutcome(
  process: ObservedScreenshotDemoProcess,
  milliseconds: number,
): Promise<ScreenshotDemoProcessOutcome | null> {
  const existing = process.currentOutcome();
  if (existing !== null) return existing;
  return delayOrProcessExit(process, milliseconds);
}

function isCleanExit(outcome: ScreenshotDemoProcessOutcome): boolean {
  return (
    outcome.type === "exit" &&
    outcome.code === 0 &&
    outcome.signal === null
  );
}

function connectionWasRefused(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > 4) return false;
  try {
    if (error instanceof AggregateError) {
      const errors: unknown = Object.getOwnPropertyDescriptor(error, "errors")?.value;
      return Array.isArray(errors) && errors.length > 0 && errors.length <= 8 &&
        errors.every((entry: unknown) => connectionWasRefused(entry, depth + 1));
    }
    const code: unknown = Object.getOwnPropertyDescriptor(error, "code")?.value;
    if (code !== undefined) return code === "ECONNREFUSED";
    const cause: unknown = Object.getOwnPropertyDescriptor(error, "cause")?.value;
    return connectionWasRefused(cause, depth + 1);
  } catch {
    return false;
  }
}

async function ownedEndpointIsGone(input: {
  baseURL: string;
  fetchFunction: FetchFunction;
  nonce: string;
  requestTimeoutMs: number;
}): Promise<boolean> {
  const signal = timeoutSignal(input.requestTimeoutMs);
  let response: Response;
  try {
    response = await input.fetchFunction(
      `${input.baseURL}${screenshotDemoReadinessPath}`,
      { cache: "no-store", redirect: "error", signal },
    );
  } catch (error: unknown) {
    return !signal.aborted && connectionWasRefused(error);
  }
  if (!response.ok) {
    discardScreenshotDemoResponse(response);
    return response.status === 404 || response.status === 410;
  }
  try {
    const parsed = readinessSchema.safeParse(await readScreenshotDemoJson(response, signal));
    return parsed.success && parsed.data.instanceNonce !== input.nonce;
  } catch {
    return false;
  }
}

export async function stopOwnedScreenshotDemoServer(
  process: ObservedScreenshotDemoProcess,
  baseURL: string,
  nonce: string,
  options: DemoRequestOptions = {},
): Promise<void> {
  screenshotDemoInstanceNonceSchema.parse(nonce);
  const priorOutcome = process.currentOutcome();
  if (priorOutcome !== null) {
    throw errorFromOutcome(priorOutcome, "before owned shutdown");
  }

  const fetchFunction = options.fetchFunction ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  const shutdownExitTimeoutMs = options.shutdownExitTimeoutMs ?? 10_000;
  const shutdownKillTimeoutMs = options.shutdownKillTimeoutMs ?? 5_000;
  let shutdownError: unknown;
  try {
    const signal = timeoutSignal(requestTimeoutMs);
    const response = await fetchFunction(
      `${baseURL}${screenshotDemoShutdownPath}`,
      {
        cache: "no-store",
        headers: { [screenshotDemoShutdownNonceHeader]: nonce },
        method: "POST",
        redirect: "error",
        signal,
      },
    );
    const body = shutdownSchema.safeParse(await readScreenshotDemoJson(response, signal));
    if (!body.success) {
      throw new Error("Screenshot demo shutdown response is invalid.");
    }
    if (!response.ok || body.data.instanceNonce !== nonce) {
      throw new Error(
        `Screenshot demo shutdown was not acknowledged (${response.status}).`,
      );
    }
  } catch (cause: unknown) {
    shutdownError = cause;
  }

  let outcome = await waitForProcessOutcome(process, shutdownExitTimeoutMs);
  if (outcome === null) {
    process.child.kill("SIGTERM");
    outcome = await waitForProcessOutcome(process, shutdownExitTimeoutMs);
  }
  if (outcome === null) {
    process.child.kill("SIGKILL");
    outcome = await waitForProcessOutcome(process, shutdownKillTimeoutMs);
  }

  const errors: unknown[] = [];
  if (shutdownError !== undefined) errors.push(shutdownError);
  if (outcome === null) {
    errors.push(new Error("Screenshot demo did not exit after SIGKILL."));
  } else if (!isCleanExit(outcome)) {
    errors.push(errorFromOutcome(outcome, "during owned shutdown"));
  }
  if (
    outcome !== null &&
    isCleanExit(outcome) &&
    !(await ownedEndpointIsGone({
      baseURL,
      fetchFunction,
      nonce,
      requestTimeoutMs: Math.min(requestTimeoutMs, 1_000),
    }))
  ) {
    errors.push(
      new Error(
        "Screenshot demo child exited but its nonce-bound endpoint remains live or its absence could not be proven.",
      ),
    );
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "Screenshot demo shutdown was not proven successful.",
    );
  }
}

export function serializeScreenshotDemoReadiness(nonce: string): string {
  return JSON.stringify(
    readinessSchema.parse({ instanceNonce: nonce, status: "ready" }),
  );
}

export function serializeScreenshotDemoShutdown(nonce: string): string {
  return JSON.stringify(
    shutdownSchema.parse({ instanceNonce: nonce, status: "stopped" }),
  );
}
