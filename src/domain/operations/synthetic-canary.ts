import { uiMessageChunkSchema } from "ai";

import {
  healthResponseSchema,
  readinessResponseSchema,
} from "@/lib/health";
import { countryDetailResponseSchema } from "@/features/countries/schemas";
import type { ApplicationScope } from "@/features/database/schemas";
import { productListResponseSchema } from "@/features/product-fit/schemas";

const MAX_CANARY_RESPONSE_BYTES = 1_000_000;
export const CANARY_HEALTH_MAX_CLOCK_SKEW_MS = 5_000;
export const CANARY_HEALTH_CACHE_CONTROL = "private, no-store, max-age=0";
export const CANARY_HEALTH_PRAGMA = "no-cache";

export type CanaryHealthTimeWindow = {
  maxClockSkewMs: number;
  requestStartedAtMs: number;
  responseReceivedAtMs: number;
};

export type CanaryErrorCode =
  | "CONTENT_TYPE_MISMATCH"
  | "INVALID_RESPONSE"
  | "MISSING_REQUEST_ID"
  | "NETWORK_ERROR"
  | "STATUS_MISMATCH"
  | "TIMEOUT";

export type CanaryCheck = {
  body?: string;
  expectedContentType?: string;
  expectedStatus: number;
  expectedVersion?: string;
  id: string;
  jsonExpectation?: {
    applicationScope: ApplicationScope;
    asOf: string;
    countryIso3: string;
    powerKw: number;
    summaryStatus: "available" | "no_data";
  };
  productExpectation?: {
    demoModelCodes: readonly string[];
    realProductCount: number;
  };
  jsonShape?: "country-summary" | "liveness" | "products" | "readiness";
  method: "GET" | "POST";
  path: string;
  requireRequestId?: boolean;
  streamShape?: "ui-message-v1";
};

export type CanaryCheckResult = {
  durationMs: number;
  errorCode: CanaryErrorCode | null;
  id: string;
  method: "GET" | "POST";
  pass: boolean;
  path: string;
  requestId: string | null;
  status: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCanaryJson(
  shape: NonNullable<CanaryCheck["jsonShape"]>,
  value: unknown,
  expectation?: CanaryCheck["jsonExpectation"],
  expectedVersion?: string,
  productExpectation?: CanaryCheck["productExpectation"],
  healthTimeWindow?: CanaryHealthTimeWindow,
): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (shape === "liveness") {
    const parsed = healthResponseSchema.safeParse(value);
    return parsed.success &&
      healthTimeWindow !== undefined &&
      healthTimestampIsWithinRequestWindow(
        parsed.data.timestamp,
        healthTimeWindow,
      ) &&
      (expectedVersion === undefined ||
        parsed.data.version === expectedVersion);
  }
  if (shape === "readiness") {
    const parsed = readinessResponseSchema.safeParse(value);
    return parsed.success &&
      parsed.data.status === "ok" &&
      parsed.data.checks.aiChatAdmission === "ok" &&
      parsed.data.checks.aiChatRateLimit === "ok" &&
      parsed.data.checks.database === "ok" &&
      healthTimeWindow !== undefined &&
      healthTimestampIsWithinRequestWindow(
        parsed.data.timestamp,
        healthTimeWindow,
      ) &&
      (expectedVersion === undefined ||
        parsed.data.version === expectedVersion);
  }
  if (shape === "country-summary") {
    const parsed = countryDetailResponseSchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.status !== "available" ||
      parsed.data.applicabilitySummary === null
    ) {
      return false;
    }
    if (!expectation) {
      return true;
    }
    const summary = parsed.data.applicabilitySummary;
    const matchesEvidenceState = expectation.summaryStatus === "available"
      ? summary.country.status === "available" &&
        summary.lastVerifiedAt !== null && summary.sources.length > 0
      : summary.country.status === "no_data" &&
        summary.country.currentEffectiveRegulations.length === 0 &&
        summary.country.futureAdoptedRegulations.length === 0 &&
        summary.lastVerifiedAt === null && summary.sources.length === 0 &&
        summary.missingData.length > 0;
    return (
      parsed.data.asOf === expectation.asOf &&
      parsed.data.country.iso3 === expectation.countryIso3 &&
      !parsed.data.country.isStale &&
      summary.country.countryIso3 === expectation.countryIso3 &&
      matchesEvidenceState &&
      summary.query.applicationScope === expectation.applicationScope &&
      summary.query.asOf === expectation.asOf &&
      summary.query.countryIso3s.length === 1 &&
      summary.query.countryIso3s[0] === expectation.countryIso3 &&
      summary.query.powerKw === expectation.powerKw
    );
  }
  const parsed = productListResponseSchema.safeParse(value);
  if (!parsed.success) {
    return false;
  }
  if (!productExpectation) {
    return true;
  }
  const demoModelCodes = parsed.data.products
    .filter((product) => product.isDemo && product.source.isDemo)
    .map(({ modelCode }) => modelCode)
    .toSorted();
  const realOrMismatchedCount = parsed.data.products.length -
    demoModelCodes.length;
  return realOrMismatchedCount === productExpectation.realProductCount &&
    JSON.stringify(demoModelCodes) ===
      JSON.stringify([...productExpectation.demoModelCodes].toSorted());
}

function healthTimestampIsWithinRequestWindow(
  timestamp: string,
  window: CanaryHealthTimeWindow,
): boolean {
  const timestampMs = Date.parse(timestamp);
  if (
    !Number.isFinite(timestampMs) ||
    !Number.isFinite(window.requestStartedAtMs) ||
    !Number.isFinite(window.responseReceivedAtMs) ||
    !Number.isFinite(window.maxClockSkewMs) ||
    window.maxClockSkewMs < 0 ||
    window.responseReceivedAtMs < window.requestStartedAtMs
  ) {
    return false;
  }
  return timestampMs >= window.requestStartedAtMs - window.maxClockSkewMs &&
    timestampMs <= window.responseReceivedAtMs + window.maxClockSkewMs;
}

function hasExpectedHealthCachePolicy(headers: Headers): boolean {
  return headers.get("cache-control") === CANARY_HEALTH_CACHE_CONTROL &&
    headers.get("pragma") === CANARY_HEALTH_PRAGMA;
}

export async function validateUiMessageSse(value: string): Promise<boolean> {
  const payloads = value
    .replace(/\r\n/gu, "\n")
    .split(/\n\n+/u)
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /u, ""))
        .join("\n"),
    )
    .filter(Boolean);
  let sawDone = false;
  let sawFinish = false;
  let sawStart = false;
  let sawTextDelta = false;
  const openTextIds = new Set<string>();
  const validateChunk = uiMessageChunkSchema().validate;
  if (!validateChunk) {
    return false;
  }

  for (const payload of payloads) {
    if (payload === "[DONE]") {
      if (sawDone || !sawFinish || openTextIds.size > 0) {
        return false;
      }
      sawDone = true;
      continue;
    }
    if (sawDone || sawFinish) {
      return false;
    }

    let rawEvent: unknown;
    try {
      rawEvent = JSON.parse(payload);
    } catch {
      return false;
    }
    const validation = await validateChunk(rawEvent);
    if (!validation.success) {
      return false;
    }
    const event = validation.value;
    if (!sawStart && event.type !== "start") {
      return false;
    }
    if (
      event.type.startsWith("reasoning") ||
      event.type === "abort" ||
      event.type === "error"
    ) {
      return false;
    }
    if (event.type === "start") {
      if (sawStart) {
        return false;
      }
      sawStart = true;
    } else if (event.type === "text-start") {
      if (
        typeof event.id !== "string" ||
        event.id.length === 0 ||
        openTextIds.has(event.id)
      ) {
        return false;
      }
      openTextIds.add(event.id);
    } else if (event.type === "text-delta") {
      if (
        typeof event.id !== "string" ||
        !openTextIds.has(event.id) ||
        typeof event.delta !== "string" ||
        event.delta.length === 0
      ) {
        return false;
      }
      sawTextDelta = true;
    } else if (event.type === "text-end") {
      if (typeof event.id !== "string" || !openTextIds.delete(event.id)) {
        return false;
      }
    } else if (event.type === "finish") {
      if (
        event.finishReason !== "stop" ||
        !sawStart ||
        !sawTextDelta ||
        openTextIds.size > 0
      ) {
        return false;
      }
      sawFinish = true;
    }
  }

  return sawStart && sawTextDelta && sawFinish && sawDone;
}

export function validateCanaryBaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error("CANARY_BASE_URL must be an HTTP(S) URL without credentials.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

export function createCanaryChecks(input: {
  asOf: string;
  expectedVersion?: string;
  includeProviderAi: boolean;
}): CanaryCheck[] {
  const checks: CanaryCheck[] = [
    {
      expectedContentType: "application/json",
      expectedStatus: 200,
      ...(input.expectedVersion
        ? { expectedVersion: input.expectedVersion }
        : {}),
      id: "liveness",
      jsonShape: "liveness",
      method: "GET",
      path: "/api/health/live",
      requireRequestId: true,
    },
    {
      expectedContentType: "application/json",
      expectedStatus: 200,
      ...(input.expectedVersion
        ? { expectedVersion: input.expectedVersion }
        : {}),
      id: "readiness",
      jsonShape: "readiness",
      method: "GET",
      path: "/api/health/ready",
      requireRequestId: true,
    },
    {
      expectedContentType: "application/json",
      expectedStatus: 200,
      id: "country-decision-summary",
      jsonExpectation: {
        applicationScope: "construction",
        asOf: input.asOf,
        countryIso3: "CHN",
        powerKw: 100,
        summaryStatus: "available",
      },
      jsonShape: "country-summary",
      method: "GET",
      path: `/api/countries/CHN?applicationScope=construction&powerKw=100&asOf=${input.asOf}`,
      requireRequestId: true,
    },
    {
      expectedContentType: "application/json",
      expectedStatus: 200,
      id: "country-decision-no-data",
      jsonExpectation: {
        applicationScope: "non-road",
        asOf: input.asOf,
        countryIso3: "CHN",
        powerKw: 100,
        summaryStatus: "no_data",
      },
      jsonShape: "country-summary",
      method: "GET",
      path: `/api/countries/CHN?applicationScope=non-road&powerKw=100&asOf=${input.asOf}`,
      requireRequestId: true,
    },
    {
      expectedContentType: "application/json",
      expectedStatus: 200,
      id: "public-products",
      jsonShape: "products",
      method: "GET",
      path: "/api/products",
      productExpectation: {
        demoModelCodes: ["DEMO-ENG-100", "DEMO-ENG-200"],
        realProductCount: 0,
      },
      requireRequestId: true,
    },
    {
      body: JSON.stringify({
        locale: "en",
        messages: [
          {
            id: crypto.randomUUID(),
            parts: [{ text: "What can you do?", type: "text" }],
            role: "user",
          },
        ],
        sessionId: crypto.randomUUID(),
      }),
      expectedContentType: "text/event-stream",
      expectedStatus: 200,
      id: "chat-direct-sse",
      method: "POST",
      path: "/api/chat",
      requireRequestId: true,
      streamShape: "ui-message-v1",
    },
  ];

  if (input.includeProviderAi) {
    checks.push({
      body: JSON.stringify({
        locale: "zh-CN",
        messages: [
          {
            id: crypto.randomUUID(),
            parts: [{ text: "核对 CHN non-road 100 kW 当前法规。", type: "text" }],
            role: "user",
          },
        ],
        selectedCountryIso3: "CHN",
        sessionId: crypto.randomUUID(),
      }),
      expectedContentType: "text/event-stream",
      expectedStatus: 200,
      id: "chat-provider-sse",
      method: "POST",
      path: "/api/chat",
      requireRequestId: true,
      streamShape: "ui-message-v1",
    });
  }

  return checks;
}

async function readResponseText(response: Response): Promise<string | null> {
  if (!response.body) {
    return null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let value = "";

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        value += decoder.decode();
        return value;
      }
      size += next.value.byteLength;
      if (size > MAX_CANARY_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      value += decoder.decode(next.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body may already be locked or aborted; the check result still wins.
  }
}

function errorCodeFor(error: unknown): CanaryErrorCode {
  return error instanceof DOMException && error.name === "TimeoutError"
    ? "TIMEOUT"
    : "NETWORK_ERROR";
}

export async function runCanaryCheck(input: {
  baseUrl: URL;
  check: CanaryCheck;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs: number;
}): Promise<CanaryCheckResult> {
  const startedAt = performance.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const requestStartedAtMs = now();

  try {
    const response = await fetchImpl(new URL(input.check.path, input.baseUrl), {
      body: input.check.body,
      headers: input.check.body
        ? { "Content-Type": "application/json" }
        : undefined,
      method: input.check.method,
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    const responseReceivedAtMs = now();
    const requestId = response.headers.get("x-request-id");
    let errorCode: CanaryErrorCode | null = null;
    let bodyRead = false;

    if (response.status !== input.check.expectedStatus) {
      errorCode = "STATUS_MISMATCH";
    } else if (
      input.check.expectedContentType &&
      !response.headers.get("content-type")?.includes(
        input.check.expectedContentType,
      )
    ) {
      errorCode = "CONTENT_TYPE_MISMATCH";
    } else if (input.check.requireRequestId && !requestId) {
      errorCode = "MISSING_REQUEST_ID";
    } else if (
      (input.check.jsonShape === "liveness" ||
        input.check.jsonShape === "readiness") &&
      !hasExpectedHealthCachePolicy(response.headers)
    ) {
      errorCode = "INVALID_RESPONSE";
    } else if (
      input.check.streamShape === "ui-message-v1" &&
      response.headers.get("x-vercel-ai-ui-message-stream") !== "v1"
    ) {
      errorCode = "INVALID_RESPONSE";
    } else if (input.check.jsonShape) {
      bodyRead = true;
      const responseText = await readResponseText(response);
      if (responseText === null) {
        errorCode = "INVALID_RESPONSE";
      } else {
        let responseJson: unknown;
        try {
          responseJson = JSON.parse(responseText);
        } catch {
          errorCode = "INVALID_RESPONSE";
        }
        if (
          errorCode === null &&
          !validateCanaryJson(
            input.check.jsonShape,
            responseJson,
            input.check.jsonExpectation,
            input.check.expectedVersion,
            input.check.productExpectation,
            {
              maxClockSkewMs: CANARY_HEALTH_MAX_CLOCK_SKEW_MS,
              requestStartedAtMs,
              responseReceivedAtMs,
            },
          )
        ) {
          errorCode = "INVALID_RESPONSE";
        }
      }
    } else if (input.check.streamShape === "ui-message-v1") {
      bodyRead = true;
      const responseText = await readResponseText(response);
      if (
        responseText === null ||
        !(await validateUiMessageSse(responseText))
      ) {
        errorCode = "INVALID_RESPONSE";
      }
    }

    if (!bodyRead) {
      await cancelResponseBody(response);
    }
    return {
      durationMs: Math.round(performance.now() - startedAt),
      errorCode,
      id: input.check.id,
      method: input.check.method,
      pass: errorCode === null,
      path: input.check.path,
      requestId,
      status: response.status,
    };
  } catch (error) {
    return {
      durationMs: Math.round(performance.now() - startedAt),
      errorCode: errorCodeFor(error),
      id: input.check.id,
      method: input.check.method,
      pass: false,
      path: input.check.path,
      requestId: null,
      status: null,
    };
  }
}
