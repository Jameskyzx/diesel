import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as archiveEntity } from "@/app/api/admin/entities/[entityType]/[entityKey]/archive/route";
import { POST as uploadDocument } from "@/app/api/admin/documents/route";
import { POST as reprocessDocument } from "@/app/api/admin/documents/[documentId]/reprocess/route";
import { POST as createDraft } from "@/app/api/admin/drafts/route";
import { POST as publishDraft } from "@/app/api/admin/drafts/[draftId]/publish/route";
import { POST as reviewDraft } from "@/app/api/admin/drafts/[draftId]/review/route";
import { POST as confirmMarketImport } from "@/app/api/admin/imports/market/[batchId]/confirm/route";
import { POST as previewMarketImport } from "@/app/api/admin/imports/market/preview/route";
import { POST as verifySource } from "@/app/api/admin/sources/[sourceId]/verify/route";
import {
  ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER,
  ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER,
  ADMIN_PRINCIPAL_EMAIL_RESPONSE_HEADER,
  ADMIN_PRINCIPAL_ROLE_RESPONSE_HEADER,
} from "@/features/admin/schemas";
import {
  MAX_DOCUMENT_UPLOAD_REQUEST_BYTES,
  MAX_MARKET_CSV_FILE_BYTES,
  MAX_MARKET_CSV_UPLOAD_REQUEST_BYTES,
} from "@/server/http/request-limits";
import {
  handleAdminRoute,
  MAX_ADMIN_JSON_REQUEST_BYTES,
} from "@/server/http/admin-route";
import { GovernanceMaintenanceError } from "@/server/db/governance-maintenance-lock";
import {
  KnowledgeConflictError,
  KnowledgeInputError,
} from "@/server/services/knowledge-service";

const originalRoleBindings = process.env.ADMIN_ROLE_BINDINGS_JSON;

const testAdminPrincipals = {
  "admin@example.test": { role: "admin" },
  "editor-b@example.test": { role: "editor" },
  "editor@example.test": { role: "editor" },
  "reviewer@example.test": { role: "reviewer" },
} as const;

type TestAdminEmail = keyof typeof testAdminPrincipals;

function adminHeaders(
  email: TestAdminEmail,
  initialHeaders?: HeadersInit,
): Headers {
  const headers = new Headers(initialHeaders);
  headers.set("oai-authenticated-user-email", email);
  headers.set(ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER, email);
  headers.set(
    ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER,
    testAdminPrincipals[email].role,
  );
  return headers;
}

function adminRequest(email: TestAdminEmail): Request {
  return new Request("http://localhost/api/admin/test", {
    body: JSON.stringify({ reason: "Validate malformed route input." }),
    headers: adminHeaders(email, {
      "content-type": "application/json",
    }),
    method: "POST",
  });
}

function expectPrivateAdminResponse(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
}

describe("admin route path validation", () => {
  beforeAll(() => {
    process.env.ADMIN_ROLE_BINDINGS_JSON = JSON.stringify(
      Object.fromEntries(
        Object.entries(testAdminPrincipals).map(([email, principal]) => [
          email,
          principal.role,
        ]),
      ),
    );
  });

  afterAll(() => {
    if (originalRoleBindings === undefined) {
      delete process.env.ADMIN_ROLE_BINDINGS_JSON;
    } else {
      process.env.ADMIN_ROLE_BINDINGS_JSON = originalRoleBindings;
    }
  });

  it("returns 400 for a malformed draft UUID before querying the database", async () => {
    const response = await reviewDraft(
      adminRequest("reviewer@example.test"),
      { params: Promise.resolve({ draftId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("validates the publish route UUID before querying the database", async () => {
    const response = await publishDraft(
      adminRequest("reviewer@example.test"),
      { params: Promise.resolve({ draftId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("validates the market confirmation batch UUID before database access", async () => {
    const response = await confirmMarketImport(
      adminRequest("editor@example.test"),
      { params: Promise.resolve({ batchId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("validates the source verification UUID before database access", async () => {
    const response = await verifySource(
      new Request("http://localhost/api/admin/sources/not-a-uuid/verify", {
        body: JSON.stringify({
          reason: "Validate malformed route input.",
          verifiedAt: "2026-08-15T00:00:00.000Z",
        }),
        headers: adminHeaders("editor@example.test", {
          "content-type": "application/json",
        }),
        method: "POST",
      }),
      { params: Promise.resolve({ sourceId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("validates the document reprocess UUID before document storage access", async () => {
    const body = new FormData();
    body.set("documentType", "government-notice");
    body.set("languageCode", "en");
    body.set("reason", "Validate malformed route input.");
    body.set("sourceTitle", "Route contract source");
    body.set("sourceType", "government-notice");
    body.set("title", "Route contract document");

    const response = await reprocessDocument(
      new Request("http://localhost/api/admin/documents/not-a-uuid/reprocess", {
        body,
        headers: adminHeaders("editor@example.test"),
        method: "POST",
      }),
      { params: Promise.resolve({ documentId: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("rejects an invalid create-draft contract before database access", async () => {
    const response = await createDraft(adminRequest("editor@example.test"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("rejects the direct document-draft API bypass", async () => {
    const response = await createDraft(
      new Request("http://localhost/api/admin/drafts", {
        body: JSON.stringify({
          changeReason: "Attempt to bypass governed document creation.",
          entityType: "document",
          payload: {
            documentId: "00000000-0000-4000-8000-000000000701",
          },
        }),
        headers: adminHeaders("editor@example.test", {
          "content-type": "application/json",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CONFLICT",
        message:
          "Document drafts must be created through the governed upload or reprocessing workflow.",
      },
    });
  });

  it("returns 400 when an entity key does not match its entity type", async () => {
    const response = await archiveEntity(
      adminRequest("admin@example.test"),
      {
        params: Promise.resolve({
          entityKey: "CHN",
          entityType: "regulation",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  it("maps document state conflicts to 409", async () => {
    const response = await handleAdminRoute(
      adminRequest("admin@example.test"),
      "editor",
      "/api/admin/test",
      async () => {
        throw new KnowledgeConflictError("Document is no longer a Draft.");
      },
    );

    expect(response.status).toBe(409);
    expectPrivateAdminResponse(response);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CONFLICT",
        message: "Document is no longer a Draft.",
      },
    });
  });

  it("maps governance maintenance contention to a retryable 503", async () => {
    const response = await handleAdminRoute(
      adminRequest("admin@example.test"),
      "editor",
      "/api/admin/test",
      async () => {
        throw new GovernanceMaintenanceError();
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "GOVERNANCE_MAINTENANCE" },
    });
  });

  it("maps an oversized document file to 413", async () => {
    const response = await handleAdminRoute(
      adminRequest("admin@example.test"),
      "editor",
      "/api/admin/test",
      async () => {
        throw new KnowledgeInputError(
          "FILE_TOO_LARGE",
          "上传文件不得超过 5 MiB。",
        );
      },
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FILE_TOO_LARGE" },
    });
  });

  it("rejects a cross-site multipart admin write before parsing its body", async () => {
    const body = new FormData();
    body.set("changeReason", "Cross-site write must be rejected.");
    body.set(
      "file",
      new File(["document"], "document.txt", { type: "text/plain" }),
    );

    const response = await uploadDocument(
      new Request("http://localhost/api/admin/documents", {
        body,
        headers: adminHeaders("editor@example.test", {
          origin: "https://attacker.example",
          "sec-fetch-site": "same-origin",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expectPrivateAdminResponse(response);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FORBIDDEN",
        message: "管理写入请求必须来自同一站点。",
      },
    });
  });

  it("rejects cross-site Fetch Metadata even when Origin matches", async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const response = await handleAdminRoute(
      new Request("http://localhost/api/admin/documents", {
        headers: adminHeaders("editor@example.test", {
          origin: "http://localhost",
          "sec-fetch-site": "cross-site",
        }),
        method: "POST",
      }),
      "editor",
      "/api/admin/documents",
      handler,
    );

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts the public origin reconstructed from trusted proxy headers", async () => {
    const handler = vi.fn(
      async () =>
        new Response(null, {
          headers: { "Cache-Control": "public, max-age=3600" },
          status: 204,
        }),
    );
    const response = await handleAdminRoute(
      new Request("https://127.0.0.1:8788/api/admin/documents", {
        headers: adminHeaders("editor@example.test", {
          host: "jamesky.site",
          origin: "https://jamesky.site",
          "sec-fetch-site": "same-origin",
          "x-forwarded-proto": "https",
        }),
        method: "POST",
      }),
      "editor",
      "/api/admin/documents",
      handler,
    );

    expect(response.status).toBe(204);
    expectPrivateAdminResponse(response);
    expect(
      response.headers.get(ADMIN_PRINCIPAL_EMAIL_RESPONSE_HEADER),
    ).toBe("editor@example.test");
    expect(response.headers.get(ADMIN_PRINCIPAL_ROLE_RESPONSE_HEADER)).toBe(
      "editor",
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      configure(headers: Headers) {
        headers.delete(ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER);
        headers.delete(ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER);
      },
      name: "missing expected-principal headers",
    },
    {
      configure(headers: Headers) {
        headers.set(
          ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER,
          "not-an-email",
        );
      },
      name: "a malformed expected email",
    },
    {
      configure(headers: Headers) {
        headers.set(
          ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER,
          "super-admin",
        );
      },
      name: "a malformed expected role",
    },
    {
      configure(headers: Headers) {
        headers.set(
          ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER,
          "editor@example.test",
        );
      },
      name: "a different expected principal",
    },
  ])(
    "rejects an admin write with $name before invoking its handler",
    async ({ configure }) => {
      const headers = adminHeaders("editor-b@example.test");
      configure(headers);
      const handler = vi.fn(
        async () => new Response(null, { status: 204 }),
      );

      const response = await handleAdminRoute(
        new Request("http://localhost/api/admin/test", {
          headers,
          method: "POST",
        }),
        "editor",
        "/api/admin/test",
        handler,
      );

      expect(response.status).toBe(409);
      expectPrivateAdminResponse(response);
      expect(handler).not.toHaveBeenCalled();
      expect(
        response.headers.get(ADMIN_PRINCIPAL_EMAIL_RESPONSE_HEADER),
      ).toBe("editor-b@example.test");
      expect(
        response.headers.get(ADMIN_PRINCIPAL_ROLE_RESPONSE_HEADER),
      ).toBe("editor");
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "PRINCIPAL_CHANGED",
          message: "管理身份已发生变化，操作未执行；请刷新后重试。",
        },
      });
    },
  );

  it("invokes an admin write handler when the expected principal matches", async () => {
    const handler = vi.fn(
      async (principal) => Response.json({ principal }, { status: 201 }),
    );

    const response = await handleAdminRoute(
      new Request("http://localhost/api/admin/test", {
        headers: adminHeaders("editor-b@example.test"),
        method: "POST",
      }),
      "editor",
      "/api/admin/test",
      handler,
    );

    expect(response.status).toBe(201);
    expect(handler).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      principal: {
        email: "editor-b@example.test",
        role: "editor",
      },
    });
  });

  it("marks unauthenticated admin responses private and non-cacheable", async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const response = await handleAdminRoute(
      new Request("http://localhost/api/admin/test"),
      "editor",
      "/api/admin/test",
      handler,
    );

    expect(response.status).toBe(401);
    expectPrivateAdminResponse(response);
    expect(
      response.headers.get(ADMIN_PRINCIPAL_EMAIL_RESPONSE_HEADER),
    ).toBeNull();
    expect(
      response.headers.get(ADMIN_PRINCIPAL_ROLE_RESPONSE_HEADER),
    ).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it("logs a fixed route template when the request pathname is unbounded", async () => {
    const response = await handleAdminRoute(
      new Request(`http://localhost/api/admin/documents/${"x".repeat(256)}`, {
        headers: adminHeaders("editor@example.test"),
        method: "POST",
      }),
      "editor",
      "/api/admin/documents/:documentId/reprocess",
      async () => new Response(null, { status: 204 }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("rejects an oversized multipart upload before parsing the form", async () => {
    const response = await uploadDocument(
      new Request("http://localhost/api/admin/documents", {
        body: "x",
        headers: adminHeaders("editor@example.test", {
          "content-length": String(
            MAX_DOCUMENT_UPLOAD_REQUEST_BYTES + 1,
          ),
          "content-type": "multipart/form-data; boundary=oversized",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "上传请求过大，请缩小文件或表单后重试。",
      },
    });
  });

  it("returns a structured 408 and cancels an aborted multipart upload", async () => {
    const abortController = new AbortController();
    const cancel = vi.fn();
    const requestInit: RequestInit & { duplex: "half" } = {
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: "half",
      headers: adminHeaders("editor@example.test", {
        "content-type": "multipart/form-data; boundary=stalled",
      }),
      method: "POST",
      signal: abortController.signal,
    };
    const responsePending = uploadDocument(
      new Request("http://localhost/api/admin/documents", requestInit),
    );

    abortController.abort("client-disconnected");
    const response = await responsePending;

    expect(response.status).toBe(408);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "REQUEST_TIMEOUT",
        message: "请求体接收超时或已由客户端取消，请重试。",
      },
    });
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(cancel).toHaveBeenCalledWith("request-body-aborted");
  });

  it("rejects an oversized market CSV request before parsing the form", async () => {
    const response = await previewMarketImport(
      new Request("http://localhost/api/admin/imports/market/preview", {
        body: "x",
        headers: adminHeaders("editor@example.test", {
          "content-length": String(
            MAX_MARKET_CSV_UPLOAD_REQUEST_BYTES + 1,
          ),
          "content-type": "multipart/form-data; boundary=oversized",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "上传请求过大，请缩小文件或表单后重试。",
      },
    });
  });

  it("reports malformed multipart input as an invalid request body", async () => {
    const response = await uploadDocument(
      new Request("http://localhost/api/admin/documents", {
        body: "not-a-valid-multipart-body",
        headers: adminHeaders("editor@example.test", {
          "content-type": "multipart/form-data; boundary=malformed",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "请求体格式无效。",
      },
    });
  });

  it("rejects a market CSV with malformed UTF-8 before creating a preview", async () => {
    const body = new FormData();
    body.set(
      "file",
      new File(
        [Uint8Array.from([0x63, 0x6f, 0x75, 0x6e, 0x74, 0x72, 0x79, 0xc3, 0x28])],
        "market.csv",
        { type: "text/csv" },
      ),
    );

    const response = await previewMarketImport(
      new Request("http://localhost/api/admin/imports/market/preview", {
        body,
        headers: adminHeaders("editor@example.test"),
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "请求体格式无效。",
      },
    });
  });

  it("enforces the market CSV file-byte limit before decoding", async () => {
    const body = new FormData();
    body.set(
      "file",
      new File(
        [new Uint8Array(MAX_MARKET_CSV_FILE_BYTES + 1)],
        "market.csv",
        { type: "text/csv" },
      ),
    );

    const response = await previewMarketImport(
      new Request("http://localhost/api/admin/imports/market/preview", {
        body,
        headers: adminHeaders("editor@example.test"),
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FILE_TOO_LARGE",
        message: "CSV 文件不得超过 2 MB。",
      },
    });
  });

  it("uses the same request-body error for malformed JSON", async () => {
    const response = await reviewDraft(
      new Request("http://localhost/api/admin/drafts/test/review", {
        body: "not-json",
        headers: adminHeaders("reviewer@example.test", {
          "content-type": "application/json",
        }),
        method: "POST",
      }),
      {
        params: Promise.resolve({
          draftId: "10000000-0000-4000-8000-000000000001",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "请求体格式无效。",
      },
    });
  });

  it("rejects an oversized governance JSON body before database access", async () => {
    const response = await reviewDraft(
      new Request("http://localhost/api/admin/drafts/test/review", {
        body: "{}",
        headers: adminHeaders("reviewer@example.test", {
          "content-length": String(MAX_ADMIN_JSON_REQUEST_BYTES + 1),
          "content-type": "application/json",
        }),
        method: "POST",
      }),
      {
        params: Promise.resolve({
          draftId: "10000000-0000-4000-8000-000000000001",
        }),
      },
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  it("redacts invalid role-binding configuration from the response and logs", async () => {
    const secretEmail = "role-binding-route-secret@example.test";
    const secretRole = "secret-super-admin-role";
    const savedRoleBindings = process.env.ADMIN_ROLE_BINDINGS_JSON;
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const consoleInfoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    process.env.ADMIN_ROLE_BINDINGS_JSON = JSON.stringify({
      [secretEmail]: secretRole,
    });

    try {
      const handler = vi.fn(
        async () => new Response(null, { status: 204 }),
      );
      const response = await handleAdminRoute(
        new Request("http://localhost/api/admin/test", {
          headers: {
            "oai-authenticated-user-email": secretEmail,
          },
        }),
        "editor",
        "/api/admin/test",
        handler,
      );
      const responseBody = await response.text();
      const capturedLogs = JSON.stringify([
        ...consoleErrorSpy.mock.calls,
        ...consoleInfoSpy.mock.calls,
      ]);

      expect(response.status).toBe(500);
      expectPrivateAdminResponse(response);
      expect(handler).not.toHaveBeenCalled();
      expect(
        response.headers.get(ADMIN_PRINCIPAL_EMAIL_RESPONSE_HEADER),
      ).toBeNull();
      expect(
        response.headers.get(ADMIN_PRINCIPAL_ROLE_RESPONSE_HEADER),
      ).toBeNull();
      expect(JSON.parse(responseBody)).toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "管理操作暂时失败；没有报告为已完成。",
        },
      });
      for (const secret of [secretEmail, secretRole]) {
        expect(responseBody).not.toContain(secret);
        expect(capturedLogs).not.toContain(secret);
      }
      expect(consoleErrorSpy).toHaveBeenCalledWith("Admin route failed", {
        errorCode: "AdminRoleBindingsConfigurationError",
      });
    } finally {
      if (savedRoleBindings === undefined) {
        delete process.env.ADMIN_ROLE_BINDINGS_JSON;
      } else {
        process.env.ADMIN_ROLE_BINDINGS_JSON = savedRoleBindings;
      }
      consoleErrorSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    }
  });

  it("does not log sensitive details from unexpected admin failures", async () => {
    const sensitiveText = "postgres://admin:secret@example.test/database";
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await handleAdminRoute(
        adminRequest("admin@example.test"),
        "editor",
        "/api/admin/test",
        async () => {
          throw new Error(`Database failed at ${sensitiveText}`);
        },
      );

      expect(response.status).toBe(500);
      expectPrivateAdminResponse(response);
      expect(
        response.headers.get(ADMIN_PRINCIPAL_EMAIL_RESPONSE_HEADER),
      ).toBe("admin@example.test");
      expect(response.headers.get(ADMIN_PRINCIPAL_ROLE_RESPONSE_HEADER)).toBe(
        "admin",
      );
      expect(JSON.stringify(await response.json())).not.toContain(
        sensitiveText,
      );
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(
        sensitiveText,
      );
      expect(consoleSpy).toHaveBeenCalledWith("Admin route failed", {
        errorCode: "Error",
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
