import { describe, expect, it, vi } from "vitest";

import {
  AdminAuthorizationError,
  AdminRoleBindingsConfigurationError,
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

function captureThrownError(action: () => unknown): Error {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error instance.");
  }
  throw new Error("Expected the action to throw.");
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

  it("accepts structural JSON whitespace around a valid binding", () => {
    expect(
      resolveAdminPrincipal(identityHeaders("editor@example.test"), {
        ADMIN_ROLE_BINDINGS_JSON:
          ' \n { \n "EDITOR@example.test" : "editor" \n } \t',
      }),
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

  it.each(["not-an-email", "@example.test", "ordinary @example.test"])(
    "rejects malformed authenticated identity %j as unauthenticated",
    (email) => {
      expect(() =>
        resolveAdminPrincipal(identityHeaders(email), roleEnvironment),
      ).toThrowError(
        expect.objectContaining<Partial<AdminAuthorizationError>>({
          code: "UNAUTHENTICATED",
          status: 401,
        }),
      );
    },
  );

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

  it("treats a missing role-binding environment as an empty allowlist", () => {
    expect(() =>
      resolveAdminPrincipal(identityHeaders("ordinary@example.test"), {}),
    ).toThrowError(
      expect.objectContaining<Partial<AdminAuthorizationError>>({
        code: "FORBIDDEN",
        status: 403,
      }),
    );
  });

  it.each([
    {
      bindings: '{"role-binding-secret@example.test":',
      name: "malformed JSON",
    },
    {
      bindings: JSON.stringify({
        "role-binding-secret@example.test": "super-admin",
      }),
      name: "a schema-invalid role",
    },
    {
      bindings: JSON.stringify({
        "role-binding-secret@example.test invalid": "admin",
      }),
      name: "an invalid email key",
    },
    {
      bindings: JSON.stringify({
        " ROLE-BINDING-SECRET@example.test ": "admin",
        "role-binding-secret@example.test": "reviewer",
      }),
      name: "duplicate emails after normalization",
    },
    {
      bindings:
        '{"role-binding-secret@example.test":"editor","role-binding-secret@example.test":"admin"}',
      name: "duplicate raw JSON members",
    },
    {
      bindings:
        '{"role-binding-secret@example.test":"editor","role-binding-secret\\u0040example.test":"admin"}',
      name: "escaped duplicate raw JSON members",
    },
    {
      bindings:
        '{"__proto__":"admin","role-binding-secret@example.test":"admin"}',
      name: "a prototype-like member discarded by schema parsing",
    },
    {
      bindings: JSON.stringify({
        "role-binding-secret@example.test": {
          nested: ["value", { quoted: 'escaped " text' }],
        },
      }),
      name: "a nested schema-invalid role value",
    },
    {
      bindings: "[]",
      name: "a non-object JSON root",
    },
  ])(
    "fails closed with a redacted configuration error for $name",
    ({ bindings }) => {
      const secretCanary = "role-binding-secret@example.test";
      const error = captureThrownError(() =>
        resolveAdminPrincipal(identityHeaders(secretCanary), {
          ADMIN_ROLE_BINDINGS_JSON: bindings,
        }),
      );
      const observableError = JSON.stringify({
        message: error.message,
        name: error.name,
        ownProperties: Object.fromEntries(
          Object.getOwnPropertyNames(error).map((property) => [
            property,
            String(Reflect.get(error, property)),
          ]),
        ),
      });

      expect(error).toBeInstanceOf(
        AdminRoleBindingsConfigurationError,
      );
      expect(error).toMatchObject({
        message: "管理员角色绑定配置无效。",
        name: "AdminRoleBindingsConfigurationError",
      });
      expect(observableError.toLowerCase()).not.toContain(
        secretCanary,
      );
    },
  );

  it("rejects duplicate normalized bindings even when their roles agree", () => {
    expect(() =>
      resolveAdminPrincipal(identityHeaders("editor@example.test"), {
        ADMIN_ROLE_BINDINGS_JSON: JSON.stringify({
          " EDITOR@example.test ": "editor",
          "editor@example.test": "editor",
        }),
      }),
    ).toThrow(AdminRoleBindingsConfigurationError);
  });

  it.each([
    {
      name: "a member that does not start with a JSON string",
      serialized: "{not-a-json-key}",
    },
    {
      name: "an unterminated member key",
      serialized: '{"unterminated',
    },
    {
      name: "a missing key-value delimiter",
      serialized: '{"scanner-key" "editor"}',
    },
    {
      name: "an unterminated string value",
      serialized: '{"scanner-key":"unterminated}',
    },
    {
      name: "an unexpected top-level value delimiter",
      serialized: '{"scanner-key":"editor"]',
    },
    {
      name: "an exhausted member sequence",
      serialized: '{"scanner-key":"editor",',
    },
  ])(
    "fails closed when the defensive member scanner encounters $name",
    ({ serialized }) => {
      const nativeJsonParse = JSON.parse;
      const parseSpy = vi
        .spyOn(JSON, "parse")
        .mockImplementation((text, reviver) =>
          text === serialized ? {} : nativeJsonParse(text, reviver),
        );

      try {
        expect(() =>
          resolveAdminPrincipal(identityHeaders("editor@example.test"), {
            ADMIN_ROLE_BINDINGS_JSON: serialized,
          }),
        ).toThrow(AdminRoleBindingsConfigurationError);
      } finally {
        parseSpy.mockRestore();
      }
    },
  );

  it("fails closed if decoded scanner input is not a string", () => {
    const serialized = '{"scanner-key":"editor"}';
    const nativeJsonParse = JSON.parse;
    const parseSpy = vi
      .spyOn(JSON, "parse")
      .mockImplementation((text, reviver) => {
        if (text === serialized) return {};
        if (text === '"scanner-key"') return 7;
        return nativeJsonParse(text, reviver);
      });

    try {
      expect(() =>
        resolveAdminPrincipal(identityHeaders("editor@example.test"), {
          ADMIN_ROLE_BINDINGS_JSON: serialized,
        }),
      ).toThrow(AdminRoleBindingsConfigurationError);
    } finally {
      parseSpy.mockRestore();
    }
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
