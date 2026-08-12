import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as archiveEntity } from "@/app/api/admin/entities/[entityType]/[entityKey]/archive/route";
import { POST as uploadDocument } from "@/app/api/admin/documents/route";
import { POST as reviewDraft } from "@/app/api/admin/drafts/[draftId]/review/route";
import { POST as previewMarketImport } from "@/app/api/admin/imports/market/preview/route";
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

function adminRequest(email: string): Request {
  return new Request("http://localhost/api/admin/test", {
    body: JSON.stringify({ reason: "Validate malformed route input." }),
    headers: {
      "content-type": "application/json",
      "oai-authenticated-user-email": email,
    },
    method: "POST",
  });
}

describe("admin route path validation", () => {
  beforeAll(() => {
    process.env.ADMIN_ROLE_BINDINGS_JSON = JSON.stringify({
      "admin@example.test": "admin",
      "editor@example.test": "editor",
      "reviewer@example.test": "reviewer",
    });
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
      async () => {
        throw new KnowledgeConflictError("Document is no longer a Draft.");
      },
    );

    expect(response.status).toBe(409);
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

  it("rejects an oversized multipart upload before parsing the form", async () => {
    const response = await uploadDocument(
      new Request("http://localhost/api/admin/documents", {
        body: "x",
        headers: {
          "content-length": String(
            MAX_DOCUMENT_UPLOAD_REQUEST_BYTES + 1,
          ),
          "content-type": "multipart/form-data; boundary=oversized",
          "oai-authenticated-user-email": "editor@example.test",
        },
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

  it("rejects an oversized market CSV request before parsing the form", async () => {
    const response = await previewMarketImport(
      new Request("http://localhost/api/admin/imports/market/preview", {
        body: "x",
        headers: {
          "content-length": String(
            MAX_MARKET_CSV_UPLOAD_REQUEST_BYTES + 1,
          ),
          "content-type": "multipart/form-data; boundary=oversized",
          "oai-authenticated-user-email": "editor@example.test",
        },
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
        headers: {
          "content-type": "multipart/form-data; boundary=malformed",
          "oai-authenticated-user-email": "editor@example.test",
        },
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
        headers: {
          "oai-authenticated-user-email": "editor@example.test",
        },
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
        headers: {
          "oai-authenticated-user-email": "editor@example.test",
        },
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
        headers: {
          "content-type": "application/json",
          "oai-authenticated-user-email": "reviewer@example.test",
        },
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
        headers: {
          "content-length": String(MAX_ADMIN_JSON_REQUEST_BYTES + 1),
          "content-type": "application/json",
          "oai-authenticated-user-email": "reviewer@example.test",
        },
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

  it("does not log sensitive details from unexpected admin failures", async () => {
    const sensitiveText = "postgres://admin:secret@example.test/database";
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await handleAdminRoute(
        adminRequest("admin@example.test"),
        "editor",
        async () => {
          throw new Error(`Database failed at ${sensitiveText}`);
        },
      );

      expect(response.status).toBe(500);
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
