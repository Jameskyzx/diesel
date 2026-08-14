import {
  healthResponseSchema,
  readinessResponseSchema,
} from "@/lib/health";

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
  id: string;
  jsonShape?: "country-summary" | "liveness" | "products" | "readiness";
  method: "GET" | "POST";
  path: string;
  requireRequestId?: boolean;
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
): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (shape === "liveness") {
    return healthResponseSchema.safeParse(value).success;
  }
  if (shape === "readiness") {
    const parsed = readinessResponseSchema.safeParse(value);
    return parsed.success &&
      parsed.data.status === "ok" &&
      parsed.data.checks.database === "ok";
  }
  if (shape === "country-summary") {
    return value.status === "available" && isRecord(value.applicabilitySummary);
  }
  return value.status === "ok" && Array.isArray(value.products);
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
  includeAi: boolean;
}): CanaryCheck[] {
  const checks: CanaryCheck[] = [
    {
      expectedContentType: "application/json",
      expectedStatus: 200,
      id: "liveness",
      jsonShape: "liveness",
      method: "GET",
      path: "/api/health/live",
    },
    {
      expectedContentType: "application/json",
      expectedStatus: 200,
      id: "readiness",
      jsonShape: "readiness",
      method: "GET",
      path: "/api/health/ready",
    },
    {
      expectedContentType: "application/json",
      expectedStatus: 200,
      id: "country-decision-summary",
      jsonShape: "country-summary",
      method: "GET",
      path: `/api/countries/CHN?applicationScope=non-road&powerKw=100&asOf=${input.asOf}`,
    },
    {
      expectedContentType: "application/json",
      expectedStatus: 200,
      id: "public-products",
      jsonShape: "products",
      method: "GET",
      path: "/api/products",
    },
  ];

  if (input.includeAi) {
    checks.push({
      body: JSON.stringify({
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
      id: "ai-sse",
      method: "POST",
      path: "/api/chat",
      requireRequestId: true,
    });
  }

  return checks;
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
  timeoutMs: number;
}): Promise<CanaryCheckResult> {
  const startedAt = performance.now();
  const fetchImpl = input.fetchImpl ?? fetch;

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
    const requestId = response.headers.get("x-request-id");
    let errorCode: CanaryErrorCode | null = null;

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
    } else if (input.check.jsonShape) {
      try {
        if (!validateCanaryJson(input.check.jsonShape, await response.json())) {
          errorCode = "INVALID_RESPONSE";
        }
      } catch {
        errorCode = "INVALID_RESPONSE";
      }
    }

    if (!input.check.jsonShape) {
      await response.body?.cancel();
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
