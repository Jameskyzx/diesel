import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER,
  ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER,
  ADMIN_PRINCIPAL_EMAIL_RESPONSE_HEADER,
  ADMIN_PRINCIPAL_ROLE_RESPONSE_HEADER,
  adminPrincipalSchema,
  type AdminPrincipal,
  type AdminRole,
} from "@/features/admin/schemas";
import { getErrorCode } from "@/lib/api-error";
import {
  AdminAuthorizationError,
  requireAdminRole,
} from "@/server/auth/admin-auth";
import { GovernanceMaintenanceError } from "@/server/db/governance-maintenance-lock";
import { GovernanceConflictError } from "@/server/repositories/governance-repository";
import { GovernancePermissionError } from "@/server/services/governance-service";
import {
  readFormDataRequest,
  readJsonRequest,
  RequestBodyAbortedError,
  RequestBodyTooLargeError,
  RequestBodyTimeoutError,
} from "@/server/http/request-body";
import { MAX_NON_CHAT_REQUEST_BODY_READ_MS } from "@/server/http/request-limits";
import {
  KnowledgeConflictError,
  KnowledgeInputError,
} from "@/server/services/knowledge-service";
import { createApiRequestObserver } from "@/server/observability/structured-log";

function errorResponse(
  code: string,
  message: string,
  status: number,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
      },
    },
    { headers, status },
  );
}

export const MAX_ADMIN_JSON_REQUEST_BYTES = 256 * 1024;

export function readAdminJsonRequest(request: Request): Promise<unknown> {
  return readJsonRequest(
    request,
    MAX_ADMIN_JSON_REQUEST_BYTES,
    MAX_NON_CHAT_REQUEST_BODY_READ_MS,
    request.signal,
  );
}

export function readAdminFormDataRequest(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  return readFormDataRequest(
    request,
    maxBytes,
    MAX_NON_CHAT_REQUEST_BODY_READ_MS,
    request.signal,
  );
}

function assertAdminWriteSameOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    return;
  }

  const origin = request.headers.get("origin");
  if (origin !== null) {
    let requestOrigin: string;
    let suppliedOrigin: string;
    try {
      const forwardedProto = request.headers.get("x-forwarded-proto");
      if (forwardedProto === null) {
        requestOrigin = new URL(request.url).origin;
      } else {
        const host = request.headers.get("host");
        if (
          (forwardedProto !== "http" && forwardedProto !== "https") ||
          host === null ||
          host !== host.trim() ||
          /[\u0000-\u001f\u007f]/u.test(host)
        ) {
          throw new Error("Invalid trusted proxy origin headers.");
        }
        const externalUrl = new URL(`${forwardedProto}://${host}`);
        if (
          externalUrl.username ||
          externalUrl.password ||
          externalUrl.pathname !== "/" ||
          externalUrl.search ||
          externalUrl.hash ||
          externalUrl.host !== host.toLowerCase()
        ) {
          throw new Error("Invalid trusted proxy host.");
        }
        requestOrigin = externalUrl.origin;
      }
      const suppliedUrl = new URL(origin);
      if (origin !== suppliedUrl.origin) {
        throw new Error("Origin must use its canonical origin form.");
      }
      suppliedOrigin = suppliedUrl.origin;
    } catch {
      throw new AdminAuthorizationError(
        "FORBIDDEN",
        "管理写入请求必须来自同一站点。",
      );
    }
    if (suppliedOrigin !== requestOrigin) {
      throw new AdminAuthorizationError(
        "FORBIDDEN",
        "管理写入请求必须来自同一站点。",
      );
    }
  }

  // Browser form submissions carry Origin and/or Fetch Metadata. Keep
  // non-browser administrative clients compatible when both are absent, but
  // fail closed for any browser-declared cross-site write.
  const fetchSite = request.headers
    .get("sec-fetch-site")
    ?.trim()
    .toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") {
    throw new AdminAuthorizationError(
      "FORBIDDEN",
      "管理写入请求必须来自同一站点。",
    );
  }
}

class AdminPrincipalChangedError extends Error {
  constructor() {
    super("管理身份已发生变化，操作未执行；请刷新后重试。");
    this.name = "AdminPrincipalChangedError";
  }
}

function assertExpectedAdminWritePrincipal(
  request: Request,
  principal: AdminPrincipal,
): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    return;
  }

  const expectedPrincipal = adminPrincipalSchema.safeParse({
    email: request.headers.get(
      ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER,
    ),
    role: request.headers.get(
      ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER,
    ),
  });

  if (
    !expectedPrincipal.success ||
    expectedPrincipal.data.email !== principal.email ||
    expectedPrincipal.data.role !== principal.role
  ) {
    throw new AdminPrincipalChangedError();
  }
}

export async function handleAdminRoute(
  request: Request,
  minimumRole: AdminRole,
  route: string,
  handler: (principal: AdminPrincipal) => Promise<Response>,
): Promise<Response> {
  const observer = createApiRequestObserver(route);
  let authenticatedPrincipal: AdminPrincipal | null = null;
  let errorCode: string | null = null;
  let response: Response;
  try {
    const principal = requireAdminRole(request.headers, minimumRole);
    authenticatedPrincipal = principal;
    assertAdminWriteSameOrigin(request);
    assertExpectedAdminWritePrincipal(request, principal);
    response = await handler(principal);
  } catch (error: unknown) {
    if (error instanceof AdminPrincipalChangedError) {
      errorCode = "PRINCIPAL_CHANGED";
      response = errorResponse(
        "PRINCIPAL_CHANGED",
        error.message,
        409,
      );
    } else if (error instanceof AdminAuthorizationError) {
      errorCode = error.code;
      response = errorResponse(error.code, error.message, error.status);
    } else if (error instanceof GovernancePermissionError) {
      errorCode = "FORBIDDEN";
      response = errorResponse("FORBIDDEN", error.message, 403);
    } else if (error instanceof GovernanceConflictError) {
      errorCode = "CONFLICT";
      response = errorResponse("CONFLICT", error.message, 409);
    } else if (error instanceof GovernanceMaintenanceError) {
      errorCode = "GOVERNANCE_MAINTENANCE";
      response = errorResponse(
        "GOVERNANCE_MAINTENANCE",
        "治理数据正在维护，请稍后重试。",
        503,
        { "Retry-After": "30" },
      );
    } else if (error instanceof KnowledgeConflictError) {
      errorCode = "CONFLICT";
      response = errorResponse("CONFLICT", error.message, 409);
    } else if (error instanceof KnowledgeInputError) {
      errorCode = error.code;
      response = errorResponse(
        error.code,
        error.message,
        error.code === "FILE_TOO_LARGE" ? 413 : 400,
      );
    } else if (error instanceof RequestBodyTooLargeError) {
      errorCode = "PAYLOAD_TOO_LARGE";
      response = errorResponse(
        "PAYLOAD_TOO_LARGE",
        "上传请求过大，请缩小文件或表单后重试。",
        413,
      );
    } else if (
      error instanceof RequestBodyTimeoutError ||
      error instanceof RequestBodyAbortedError
    ) {
      errorCode = "REQUEST_TIMEOUT";
      response = errorResponse(
        "REQUEST_TIMEOUT",
        "请求体接收超时或已由客户端取消，请重试。",
        408,
      );
    } else if (error instanceof ZodError || error instanceof SyntaxError) {
      errorCode = "INVALID_INPUT";
      response = errorResponse(
        "INVALID_INPUT",
        error instanceof ZodError
          ? error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("；")
          : "请求体格式无效。",
        400,
      );
    } else {
      errorCode = "INTERNAL_ERROR";
      console.error("Admin route failed", {
        errorCode: getErrorCode(error),
      });
      response = errorResponse(
        "INTERNAL_ERROR",
        "管理操作暂时失败；没有报告为已完成。",
        500,
      );
    }
  }

  const observedResponse = observer.finish(response, errorCode);
  observedResponse.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0",
  );
  observedResponse.headers.set("Pragma", "no-cache");
  if (authenticatedPrincipal) {
    observedResponse.headers.set(
      ADMIN_PRINCIPAL_EMAIL_RESPONSE_HEADER,
      authenticatedPrincipal.email,
    );
    observedResponse.headers.set(
      ADMIN_PRINCIPAL_ROLE_RESPONSE_HEADER,
      authenticatedPrincipal.role,
    );
  }
  return observedResponse;
}
