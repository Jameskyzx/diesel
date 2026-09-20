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

export class AdminRoleBindingsConfigurationError extends Error {
  constructor() {
    super("管理员角色绑定配置无效。");
    this.name = "AdminRoleBindingsConfigurationError";
  }
}

function skipJsonWhitespace(serialized: string, start: number): number {
  let index = start;
  while (/\s/u.test(serialized[index] ?? "")) index += 1;
  return index;
}

function findJsonStringEnd(
  serialized: string,
  start: number,
): number | null {
  if (serialized[start] !== '"') return null;

  for (let index = start + 1; index < serialized.length; index += 1) {
    if (serialized[index] === "\\") {
      index += 1;
    } else if (serialized[index] === '"') {
      return index + 1;
    }
  }

  return null;
}

/**
 * JSON.parse intentionally keeps only the last value for duplicate object
 * members. Preserve the decoded top-level member sequence so role bindings
 * can reject duplicates before that behavior becomes authorization state.
 * The input has already passed JSON.parse, so this scanner only identifies
 * member boundaries; it does not replace JSON validation.
 */
function readTopLevelJsonObjectKeys(
  serialized: string,
): string[] | null {
  let index = skipJsonWhitespace(serialized, 0);
  if (serialized[index] !== "{") return null;
  index += 1;

  const keys: string[] = [];
  while (index < serialized.length) {
    index = skipJsonWhitespace(serialized, index);
    if (serialized[index] === "}") return keys;

    const keyEnd = findJsonStringEnd(serialized, index);
    if (keyEnd === null) return null;

    const decodedKey: unknown = JSON.parse(
      serialized.slice(index, keyEnd),
    );
    if (typeof decodedKey !== "string") return null;
    keys.push(decodedKey);

    index = skipJsonWhitespace(serialized, keyEnd);
    if (serialized[index] !== ":") return null;
    index = skipJsonWhitespace(serialized, index + 1);

    let nestedDepth = 0;
    while (index < serialized.length) {
      const character = serialized[index];
      if (character === '"') {
        const stringEnd = findJsonStringEnd(serialized, index);
        if (stringEnd === null) return null;
        index = stringEnd;
        continue;
      }
      if (character === "{" || character === "[") {
        nestedDepth += 1;
      } else if (character === "}" || character === "]") {
        if (nestedDepth === 0) break;
        nestedDepth -= 1;
      } else if (character === "," && nestedDepth === 0) {
        break;
      }
      index += 1;
    }

    if (serialized[index] === ",") {
      index += 1;
      continue;
    }
    if (serialized[index] === "}") return keys;
    return null;
  }

  return null;
}

function parseRoleBindings(
  environment: Readonly<Record<string, string | undefined>>,
): Map<string, AdminRole> {
  const serialized = environment.ADMIN_ROLE_BINDINGS_JSON ?? "{}";
  let raw: unknown;

  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new AdminRoleBindingsConfigurationError();
  }

  const parsedBindings = roleBindingsSchema.safeParse(raw);
  const sourceKeys = readTopLevelJsonObjectKeys(serialized);
  if (
    !parsedBindings.success ||
    sourceKeys === null ||
    sourceKeys.length !== Object.keys(parsedBindings.data).length ||
    new Set(sourceKeys).size !== sourceKeys.length
  ) {
    throw new AdminRoleBindingsConfigurationError();
  }

  const normalized = new Map<string, AdminRole>();

  for (const [email, role] of Object.entries(parsedBindings.data)) {
    const parsedEmail = z.email().safeParse(email.trim().toLowerCase());
    if (!parsedEmail.success || normalized.has(parsedEmail.data)) {
      throw new AdminRoleBindingsConfigurationError();
    }
    normalized.set(parsedEmail.data, role);
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

  const parsedEmail = z.email().safeParse(email);
  if (!parsedEmail.success) {
    throw new AdminAuthorizationError(
      "UNAUTHENTICATED",
      "需要经过工作区认证才能访问管理后台。",
    );
  }

  const role = parseRoleBindings(environment).get(parsedEmail.data);
  if (!role) {
    throw new AdminAuthorizationError(
      "FORBIDDEN",
      "当前账号没有管理后台权限。",
    );
  }

  return adminPrincipalSchema.parse({ email: parsedEmail.data, role });
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
