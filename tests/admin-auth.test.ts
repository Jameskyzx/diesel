import { describe, expect, it } from "vitest";

import {
  AdminAuthorizationError,
  requireAdminRole,
  resolveAdminPrincipal,
} from "@/server/auth/admin-auth";

const roleEnvironment = {
  ADMIN_ROLE_BINDINGS_JSON: JSON.stringify({
    "admin@example.test": "admin",
    "editor@example.test": "editor",
    "reviewer@example.test": "reviewer",
  }),
};

function identityHeaders(email?: string): Headers {
  const headers = new Headers();
  if (email) {
    headers.set("oai-authenticated-user-email", email);
  }
  return headers;
}

describe("admin authorization", () => {
  it("resolves a workspace identity through the server-side role allowlist", () => {
    expect(
      resolveAdminPrincipal(
        identityHeaders(" EDITOR@example.test "),
        roleEnvironment,
      ),
    ).toEqual({
      email: "editor@example.test",
      role: "editor",
    });
  });

  it("rejects requests without an authenticated workspace identity", () => {
    expect(() =>
      resolveAdminPrincipal(identityHeaders(), roleEnvironment),
    ).toThrowError(
      expect.objectContaining<Partial<AdminAuthorizationError>>({
        code: "UNAUTHENTICATED",
        status: 401,
      }),
    );
  });

  it("rejects authenticated users that are not allowlisted", () => {
    expect(() =>
      resolveAdminPrincipal(
        identityHeaders("ordinary@example.test"),
        roleEnvironment,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AdminAuthorizationError>>({
        code: "FORBIDDEN",
        status: 403,
      }),
    );
  });

  it("enforces editor, reviewer, and admin role thresholds", () => {
    expect(() =>
      requireAdminRole(
        identityHeaders("editor@example.test"),
        "reviewer",
        roleEnvironment,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<AdminAuthorizationError>>({
        code: "FORBIDDEN",
        status: 403,
      }),
    );
    expect(
      requireAdminRole(
        identityHeaders("reviewer@example.test"),
        "reviewer",
        roleEnvironment,
      ).role,
    ).toBe("reviewer");
    expect(
      requireAdminRole(
        identityHeaders("admin@example.test"),
        "admin",
        roleEnvironment,
      ).role,
    ).toBe("admin");
  });
});
