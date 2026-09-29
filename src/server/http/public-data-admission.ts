import "server-only";

import { getErrorCode } from "@/lib/api-error";

export const PUBLIC_DATA_MAX_IN_FLIGHT = 2;
export const PUBLIC_DATA_MAX_IN_FLIGHT_PER_CLIENT = 2;
export const PUBLIC_DATA_OPERATION_TIMEOUT_MS = 15_000;

type PublicDataLease = {
  release: () => void;
};

export type PublicDataAdmissionGate = {
  reset: () => void;
  tryAcquire: (clientIdentifier: string) => PublicDataLease | null;
};

export type PublicDataOperationResult<T> =
  | { status: "aborted" }
  | { status: "admission_rejected" }
  | { error: unknown; status: "failed" }
  | { status: "fulfilled"; value: T }
  | { status: "timed_out" };

type PublicDataSettlement<T> =
  | { status: "fulfilled"; value: T }
  | { status: "not_started" }
  | { error: unknown; status: "rejected" };

type PublicDataTermination =
  | { status: "aborted" }
  | { status: "timed_out" };

type PublicDataRequestHeaders = Pick<Headers, "get">;

type PublicDataOperationOptions<T> = {
  headers: PublicDataRequestHeaders;
  route: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  work: (signal: AbortSignal) => Promise<T>;
};

export function createPublicDataAdmissionGate(options: {
  globalLimit: number;
  perClientLimit: number;
}): PublicDataAdmissionGate {
  if (
    !Number.isSafeInteger(options.globalLimit) ||
    !Number.isSafeInteger(options.perClientLimit) ||
    options.globalLimit < 1 ||
    options.perClientLimit < 1
  ) {
    throw new RangeError(
      "Public data in-flight limits must be positive safe integers.",
    );
  }

  const activeByClient = new Map<string, number>();
  let activeGlobal = 0;

  return {
    reset() {
      activeByClient.clear();
      activeGlobal = 0;
    },
    tryAcquire(clientIdentifier) {
      const activeForClient = activeByClient.get(clientIdentifier) ?? 0;
      if (
        activeGlobal >= options.globalLimit ||
        activeForClient >= options.perClientLimit
      ) {
        return null;
      }

      activeGlobal += 1;
      activeByClient.set(clientIdentifier, activeForClient + 1);
      let released = false;

      return {
        release() {
          if (released) return;
          released = true;
          activeGlobal = Math.max(0, activeGlobal - 1);
          const currentForClient = activeByClient.get(clientIdentifier) ?? 0;
          if (currentForClient <= 1) {
            activeByClient.delete(clientIdentifier);
          } else {
            activeByClient.set(clientIdentifier, currentForClient - 1);
          }
        },
      };
    },
  };
}

type PublicDataRuntime = typeof globalThis & {
  __publicDataAdmissionGate?: PublicDataAdmissionGate;
};

function getPublicDataAdmissionGate(): PublicDataAdmissionGate {
  const runtime = globalThis as PublicDataRuntime;
  runtime.__publicDataAdmissionGate ??= createPublicDataAdmissionGate({
    globalLimit: PUBLIC_DATA_MAX_IN_FLIGHT,
    perClientLimit: PUBLIC_DATA_MAX_IN_FLIGHT_PER_CLIENT,
  });
  return runtime.__publicDataAdmissionGate;
}

export function resetPublicDataAdmissionForTests(): void {
  getPublicDataAdmissionGate().reset();
}

function clientIdentifierFromHeaders(headers: PublicDataRequestHeaders): string {
  const forwarded = headers.get("x-forwarded-for");
  const firstAddress = forwarded?.split(",", 1)[0]?.trim();
  return firstAddress && firstAddress.length > 0
    ? firstAddress.slice(0, 256)
    : "unknown-client";
}

function observeSettlement<T>(
  options: {
    onStart: () => void;
    signal: AbortSignal;
    work: () => Promise<T>;
  },
): Promise<PublicDataSettlement<T>> {
  return Promise.resolve().then<PublicDataSettlement<T>>(() => {
    // The signal can abort after the initial admission precheck but before
    // this work microtask runs. Check and invoke work without an await between
    // them so an already-terminated operation never starts database work.
    if (options.signal.aborted) {
      return { status: "not_started" as const };
    }

    options.onStart();
    try {
      return options.work().then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ error, status: "rejected" as const }),
      );
    } catch (error) {
      return { error, status: "rejected" as const };
    }
  });
}

async function runPublicDataOperationWithContext<T>(
  options: PublicDataOperationOptions<T>,
): Promise<PublicDataOperationResult<T>> {
  const timeoutMs = options.timeoutMs ?? PUBLIC_DATA_OPERATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError(
      "Public data operation timeout must be a positive safe integer.",
    );
  }
  if (options.signal?.aborted) {
    return { status: "aborted" };
  }

  const lease = getPublicDataAdmissionGate().tryAcquire(
    clientIdentifierFromHeaders(options.headers),
  );
  if (!lease) {
    return { status: "admission_rejected" };
  }

  const timeoutController = new AbortController();
  const operationSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const termination = new Promise<PublicDataTermination>((resolve) => {
    abortListener = () => {
      resolve({
        status: timeoutController.signal.aborted ? "timed_out" : "aborted",
      });
    };
    operationSignal.addEventListener("abort", abortListener, { once: true });
    // AbortSignal does not replay an abort event to listeners registered after
    // cancellation. Recheck immediately to close the precheck/listener race.
    if (operationSignal.aborted) {
      abortListener();
    }
    timeoutId = setTimeout(() => {
      timeoutController.abort(
        new DOMException("Public data operation deadline exceeded.", "TimeoutError"),
      );
    }, timeoutMs);
  });
  let workStarted = false;
  const settlement = observeSettlement({
    onStart: () => {
      workStarted = true;
    },
    signal: operationSignal,
    work: () => options.work(operationSignal),
  });

  const disposeDeadline = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (abortListener !== undefined) {
      operationSignal.removeEventListener("abort", abortListener);
      abortListener = undefined;
    }
  };

  const first = await Promise.race([settlement, termination]);
  disposeDeadline();

  if (first.status === "fulfilled") {
    lease.release();
    return first;
  }
  if (first.status === "rejected") {
    lease.release();
    return { error: first.error, status: "failed" };
  }
  if (first.status === "not_started") {
    lease.release();
    return {
      status: timeoutController.signal.aborted ? "timed_out" : "aborted",
    };
  }

  // If termination won the race before the settlement microtask could start
  // work, the aborted signal makes a later start impossible. Release now
  // instead of retaining a lease for work that never ran.
  if (!workStarted) {
    lease.release();
    return first;
  }

  // Returning an HTTP timeout must not reopen admission while uncancellable
  // database work is still active or queued. The settlement promise never
  // rejects, so a late failure is observed without creating an unhandled
  // rejection, and the lease is released only after the work actually ends.
  void settlement.then((lateSettlement) => {
    lease.release();
    if (lateSettlement.status === "rejected") {
      try {
        console.error("Public data operation failed after request completion", {
          errorCode: getErrorCode(lateSettlement.error),
          route: options.route,
        });
      } catch {
        // Logging must never turn the already-observed settlement into a new
        // unhandled rejection.
      }
    }
  });

  return first;
}

/**
 * Runs an HTTP route operation with both client-disconnect cancellation and
 * the shared public-data admission/deadline policy.
 */
export function runPublicDataOperation<T>(options: {
  request: Request;
  route: string;
  timeoutMs?: number;
  work: (signal: AbortSignal) => Promise<T>;
}): Promise<PublicDataOperationResult<T>> {
  // Preserve a separate precheck before building the shared context so an
  // abort between these reads is still observed by the context runner.
  if (options.request.signal.aborted) {
    return Promise.resolve({ status: "aborted" });
  }

  return runPublicDataOperationWithContext({
    headers: options.request.headers,
    route: options.route,
    signal: options.request.signal,
    timeoutMs: options.timeoutMs,
    work: options.work,
  });
}

/**
 * Server Components do not expose a Request/connection signal. This adapter
 * applies the same client admission and deadline policy using request headers
 * only, while the shared runner supplies a deadline signal to the work.
 */
export function runPublicDataRenderOperation<T>(options: {
  headers: PublicDataRequestHeaders;
  route: string;
  timeoutMs?: number;
  work: (signal: AbortSignal) => Promise<T>;
}): Promise<PublicDataOperationResult<T>> {
  return runPublicDataOperationWithContext(options);
}
