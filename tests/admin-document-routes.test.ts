import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseDocumentImportFormData: vi.fn(),
  parseDocumentReprocessFormData: vi.fn(),
  reprocessGovernedDocument: vi.fn(),
  uploadGovernedDocument: vi.fn(),
}));

vi.mock("@/server/services/knowledge-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/services/knowledge-service")
  >();
  return {
    ...actual,
    parseDocumentImportFormData: mocks.parseDocumentImportFormData,
    parseDocumentReprocessFormData: mocks.parseDocumentReprocessFormData,
  };
});

vi.mock("@/server/services/governance-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/services/governance-service")
  >();
  return {
    ...actual,
    reprocessGovernedDocument: mocks.reprocessGovernedDocument,
    uploadGovernedDocument: mocks.uploadGovernedDocument,
  };
});

import { POST as uploadDocument } from "@/app/api/admin/documents/route";
import { POST as reprocessDocument } from "@/app/api/admin/documents/[documentId]/reprocess/route";
import {
  ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER,
  ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER,
} from "@/features/admin/schemas";
import { GovernanceConflictError } from "@/server/repositories/governance-repository";

const originalRoleBindings = process.env.ADMIN_ROLE_BINDINGS_JSON;
const documentId = "83000000-0000-4000-8000-000000000001";
const draftId = "83000000-0000-4000-8000-000000000002";
const principal = {
  email: "editor@example.test",
  role: "editor" as const,
};

function editorRequest(path: string, body: FormData): Request {
  return new Request(`http://localhost${path}`, {
    body,
    headers: {
      [ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER]: principal.email,
      [ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER]: principal.role,
      "oai-authenticated-user-email": principal.email,
    },
    method: "POST",
  });
}

describe("admin governed document routes", () => {
  beforeAll(() => {
    process.env.ADMIN_ROLE_BINDINGS_JSON = JSON.stringify({
      [principal.email]: principal.role,
    });
  });

  afterAll(() => {
    if (originalRoleBindings === undefined) {
      delete process.env.ADMIN_ROLE_BINDINGS_JSON;
    } else {
      process.env.ADMIN_ROLE_BINDINGS_JSON = originalRoleBindings;
    }
  });

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.parseDocumentImportFormData.mockReturnValue({ title: "Upload" });
    mocks.parseDocumentReprocessFormData.mockReturnValue({
      title: "Reprocess",
    });
  });

  it("returns only the upload fields consumed by the dashboard", async () => {
    const result = {
      draft: { id: draftId, payload: { canary: "PRIVATE_CANARY" } },
      import: {
        document: {
          contentSha256: "PRIVATE_CANARY",
          id: documentId,
          originalFilename: "PRIVATE_CANARY",
        },
        status: "ready",
      },
    };
    mocks.uploadGovernedDocument.mockResolvedValue(result);
    const body = new FormData();
    body.set("changeReason", "Create the governed upload.");
    body.set(
      "file",
      new File(["document"], "document.txt", { type: "text/plain" }),
    );

    const response = await uploadDocument(
      editorRequest("/api/admin/documents", body),
    );

    expect(response.status).toBe(201);
    const responseBody = await response.text();
    expect(JSON.parse(responseBody)).toEqual({
      draftCreated: true,
      status: "ready",
    });
    expect(responseBody).not.toContain("PRIVATE_CANARY");
    expect(mocks.uploadGovernedDocument).toHaveBeenCalledWith({
      actor: principal,
      bytes: new Uint8Array(Buffer.from("document")),
      changeReason: "Create the governed upload.",
      fileName: "document.txt",
      metadata: { title: "Upload" },
      mimeType: "text/plain",
    });
  });

  it("reports an existing duplicate without a newly created draft", async () => {
    mocks.uploadGovernedDocument.mockResolvedValue({
      draft: null,
      import: {
        document: {
          id: documentId,
          originalFilename: "PRIVATE_CANARY",
        },
        status: "duplicate",
      },
    });
    const body = new FormData();
    body.set("changeReason", "Check the duplicate upload result.");
    body.set(
      "file",
      new File(["document"], "document.txt", { type: "text/plain" }),
    );

    const response = await uploadDocument(
      editorRequest("/api/admin/documents", body),
    );
    const responseBody = await response.text();

    expect(response.status).toBe(201);
    expect(JSON.parse(responseBody)).toEqual({
      draftCreated: false,
      status: "duplicate",
    });
    expect(responseBody).not.toContain("PRIVATE_CANARY");
  });

  it("returns only reprocessing status with HTTP 200", async () => {
    const result = {
      document: {
        id: documentId,
        originalFilename: "PRIVATE_CANARY",
        processingError: "PRIVATE_CANARY",
      },
      status: "failed",
    };
    mocks.reprocessGovernedDocument.mockResolvedValue(result);
    const body = new FormData();
    body.set("reason", "Reprocess the governed document.");
    body.set("title", "Updated title");

    const response = await reprocessDocument(
      editorRequest(`/api/admin/documents/${documentId}/reprocess`, body),
      { params: Promise.resolve({ documentId }) },
    );

    expect(response.status).toBe(200);
    const responseBody = await response.text();
    expect(JSON.parse(responseBody)).toEqual({ status: "failed" });
    expect(responseBody).not.toContain("PRIVATE_CANARY");
    expect(mocks.parseDocumentReprocessFormData).toHaveBeenCalledOnce();
    expect(mocks.parseDocumentImportFormData).not.toHaveBeenCalled();
    expect(mocks.reprocessGovernedDocument).toHaveBeenCalledWith({
      actor: principal,
      documentId,
      metadata: { title: "Reprocess" },
      reason: "Reprocess the governed document.",
    });
  });

  it("maps a stale atomic reprocess to a structured 409", async () => {
    mocks.reprocessGovernedDocument.mockRejectedValue(
      new GovernanceConflictError(
        "The document changed while reprocessing was prepared.",
      ),
    );
    const body = new FormData();
    body.set("reason", "Reject the stale reprocess attempt.");

    const response = await reprocessDocument(
      editorRequest(`/api/admin/documents/${documentId}/reprocess`, body),
      { params: Promise.resolve({ documentId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CONFLICT",
        message: "The document changed while reprocessing was prepared.",
      },
    });
  });
});
