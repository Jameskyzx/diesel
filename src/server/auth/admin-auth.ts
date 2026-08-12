import "server-only";

import { z } from "zod";

import {
  adminPrincipalSchema,
  adminRoleSchema,
  type AdminPrincipal,
  type AdminRole,
} from "@/features/admin/schemas";

const roleBindingsSchema = z.record(z.string(), adminRoleSchema);

const roleRank: Record<AdminRole, number> = {
  admin: 3,
  editor: 1,
  reviewer: 2,
};

export class AdminAuthorizationError extends Error {
  constructor(
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "AdminAuthorizationError";
  }

  get status(): 401 | 403 {
    return this.code === "UNAUTHENTICATED" ? 401 : 403;
  }
}

function parseRoleBindings(
  environment: Readonly<Record<string, string | undefined>>,
): Map<string, AdminRole> {
  let raw: unknown;

  try {
    raw = JSON.parse(environment.ADMIN_ROLE_BINDINGS_JSON ?? "{}");
  } catch {
    throw new Error("ADMIN_ROLE_BINDINGS_JSON must be valid JSON.");
  }

  const bindings = roleBindingsSchema.parse(raw);
  const normalized = new Map<string, AdminRole>();

  for (const [email, role] of Object.entries(bindings)) {
    const parsedEmail = z.email().parse(email.trim().toLowerCase());
    normalized.set(parsedEmail, role);
  }

  return normalized;
}

export function resolveAdminPrincipal(
  requestHeaders: Headers,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AdminPrincipal {
  const email = requestHeaders
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();

  if (!email) {
    throw new AdminAuthorizationError(
      "UNAUTHENTICATED",
      "需要经过工作区认证才能访问管理后台。",
    );
  }

  const role = parseRoleBindings(environment).get(z.email().parse(email));
  if (!role) {
    throw new AdminAuthorizationError(
      "FORBIDDEN",
      "当前账号没有管理后台权限。",
    );
  }

  return adminPrincipalSchema.parse({ email, role });
}

export function requireAdminRole(
  requestHeaders: Headers,
  minimumRole: AdminRole,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AdminPrincipal {
  const principal = resolveAdminPrincipal(requestHeaders, environment);

  if (roleRank[principal.role] < roleRank[minimumRole]) {
    throw new AdminAuthorizationError(
      "FORBIDDEN",
      `该操作需要 ${minimumRole} 或更高权限。`,
    );
  }

  return principal;
}
