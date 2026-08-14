import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import type { AdminPrincipal, AdminRole } from "@/features/admin/schemas";
import { getErrorCode } from "@/lib/api-error";
import {
  AdminAuthorizationError,
  requireAdminRole,
} from "@/server/auth/admin-auth";
import { GovernanceMaintenanceError } from "@/server/db/governance-maintenance-lock";
import { GovernanceConflictError } from "@/server/repositories/governance-repository";
import { GovernancePermissionError } from "@/server/services/governance-service";
import {
  readJsonRequest,
  RequestBodyTooLargeError,
} from "@/server/http/request-body";
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
  return readJsonRequest(request, MAX_ADMIN_JSON_REQUEST_BYTES);
}

export async function handleAdminRoute(
  request: Request,
  minimumRole: AdminRole,
  handler: (principal: AdminPrincipal) => Promise<Response>,
): Promise<Response> {
  const observer = createApiRequestObserver(new URL(request.url).pathname);
  let errorCode: string | null = null;
  let response: Response;
  try {
    const principal = requireAdminRole(request.headers, minimumRole);
    response = await handler(principal);
  } catch (error: unknown) {
    if (error instanceof AdminAuthorizationError) {
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

  return observer.finish(response, errorCode);
}
