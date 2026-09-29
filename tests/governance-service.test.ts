import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({
  commitDocumentReprocessing: vi.fn(),
  commitDocumentUpload: vi.fn(),
  createDraft: vi.fn(),
  createKnowledgeDocumentImportResponse: vi.fn(),
  prepareKnowledgeDocument: vi.fn(),
  prepareKnowledgeDocumentReprocessing: vi.fn(),
  updateSourceVerifiedAt: vi.fn(),
}));

vi.mock("@/server/db/environment", () => ({
  getDatabaseMode: () => "pglite-demo",
}));

vi.mock("@/server/db/demo-client", () => ({
  getDemoDatabase: vi.fn(async () => ({})),
}));

vi.mock("@/server/repositories/governance-repository", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/repositories/governance-repository")
  >();
  return {
    ...actual,
    createGovernanceRepository: () => ({
      commitDocumentReprocessing: mocks.commitDocumentReprocessing,
      commitDocumentUpload: mocks.commitDocumentUpload,
      createDraft: mocks.createDraft,
      updateSourceVerifiedAt: mocks.updateSourceVerifiedAt,
    }),
  };
});

vi.mock("@/server/services/knowledge-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/services/knowledge-service")
  >();
  return {
    ...actual,
    createKnowledgeDocumentImportResponse:
      mocks.createKnowledgeDocumentImportResponse,
    prepareKnowledgeDocument: mocks.prepareKnowledgeDocument,
    prepareKnowledgeDocumentReprocessing:
      mocks.prepareKnowledgeDocumentReprocessing,
  };
});

import { sha256 } from "@/server/knowledge/document-file";
import { GovernanceConflictError } from "@/server/repositories/governance-repository";
import {
  createGovernanceDraft,
  reprocessGovernedDocument,
  uploadGovernedDocument,
  verifyDataSource,
} from "@/server/services/governance-service";

const actor = {
  email: "editor@example.test",
  role: "editor" as const,
};
const documentId = "82000000-0000-4000-8000-000000000001";

describe("governed document orchestration", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.createKnowledgeDocumentImportResponse.mockImplementation(
      ({ status }: { status: string }) => ({
        document: { id: documentId },
        status,
      }),
    );
  });

  it("rejects direct document draft creation before repository access", async () => {
    await expect(
      createGovernanceDraft(
        {
          changeReason: "Attempt to bypass the governed document workflow.",
          entityType: "document",
          payload: { documentId },
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(GovernanceConflictError);

    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it("keeps direct product draft creation available", async () => {
    const productId = "82000000-0000-4000-8000-000000000003";
    const sourceId = "82000000-0000-4000-8000-000000000004";
    const draft = { id: "82000000-0000-4000-8000-000000000005" };
    const payload = {
      applicationScopes: ["non-road"],
      availableFrom: "2026-01-01",
      availableTo: null,
      dataSourceId: sourceId,
      description: null,
      id: productId,
      isDemo: false,
      modelCode: "PRODUCT-DRAFT",
      name: "Product draft",
      parameters: {},
      powerMaxKw: 200,
      powerMinKw: 100,
      specificationVersion: "2026-01",
      verifiedAt: "2026-08-01T00:00:00.000Z",
    };
    mocks.createDraft.mockResolvedValue(draft);

    await expect(
      createGovernanceDraft(
        {
          changeReason: "  Create the product draft.  ",
          entityType: "product",
          payload,
        },
        actor,
      ),
    ).resolves.toEqual(draft);
    expect(mocks.createDraft).toHaveBeenCalledWith({
      actor,
      changeReason: "Create the product draft.",
      entityKey: productId,
      entityType: "product",
      payload,
    });
  });

  it("passes the validated source verification ISO string without losing microseconds", async () => {
    const sourceId = "82000000-0000-4000-8000-000000000006";
    const verifiedAt = "2026-03-01T00:00:00.123456Z";
    mocks.updateSourceVerifiedAt.mockResolvedValue({ id: sourceId });

    await verifyDataSource({
      actor,
      reason: "  Preserve the database timestamp precision.  ",
      sourceId,
      verifiedAt,
    });

    expect(mocks.updateSourceVerifiedAt).toHaveBeenCalledWith({
      actor,
      reason: "Preserve the database timestamp precision.",
      sourceId,
      verifiedAt,
    });
  });

  it("validates the change reason before preparing or persisting an upload", async () => {
    await expect(
      uploadGovernedDocument({
        actor,
        bytes: new TextEncoder().encode("document"),
        changeReason: "x",
        fileName: "document.txt",
        metadata: {},
        mimeType: "text/plain",
      }),
    ).rejects.toBeInstanceOf(ZodError);

    expect(mocks.prepareKnowledgeDocument).not.toHaveBeenCalled();
    expect(mocks.commitDocumentUpload).not.toHaveBeenCalled();
  });

  it("commits a prepared upload through one composite repository call", async () => {
    const prepared = {
      outcome: { processingStatus: "ready" },
      storageCreated: true,
    };
    const draft = { id: "82000000-0000-4000-8000-000000000002" };
    const summary = { id: documentId };
    mocks.prepareKnowledgeDocument.mockResolvedValue(prepared);
    mocks.commitDocumentUpload.mockResolvedValue({
      created: true,
      documentId,
      draft,
      draftCreated: true,
      summary,
    });

    await expect(
      uploadGovernedDocument({
        actor,
        bytes: new TextEncoder().encode("document"),
        changeReason: "  Create an auditable draft.  ",
        fileName: "document.txt",
        metadata: { title: "Document" },
        mimeType: "text/plain",
      }),
    ).resolves.toEqual({
      draft,
      import: { document: { id: documentId }, status: "ready" },
    });

    expect(mocks.commitDocumentUpload).toHaveBeenCalledOnce();
    expect(mocks.commitDocumentUpload).toHaveBeenCalledWith({
      actor,
      changeReason: "Create an auditable draft.",
      prepared,
    });
    expect(mocks.createKnowledgeDocumentImportResponse).toHaveBeenCalledWith({
      status: "ready",
      summary,
    });
  });

  it("keeps an ordinary duplicate draft hidden from the upload response", async () => {
    const prepared = {
      outcome: { processingStatus: "ready" },
      storageCreated: false,
    };
    mocks.prepareKnowledgeDocument.mockResolvedValue(prepared);
    mocks.commitDocumentUpload.mockResolvedValue({
      created: false,
      documentId,
      draft: { id: "82000000-0000-4000-8000-000000000002" },
      draftCreated: false,
      summary: { id: documentId },
    });

    const result = await uploadGovernedDocument({
      actor,
      bytes: new TextEncoder().encode("document"),
      changeReason: "Retry the same governed upload.",
      fileName: "document.txt",
      metadata: {},
      mimeType: "text/plain",
    });

    expect(result).toMatchObject({
      draft: null,
      import: { status: "duplicate" },
    });
  });

  it("validates reprocess reason and UUID before reading the stored file", async () => {
    await expect(
      reprocessGovernedDocument({
        actor,
        documentId: "not-a-uuid",
        metadata: {},
        reason: "Reprocess the latest draft.",
      }),
    ).rejects.toBeInstanceOf(ZodError);

    expect(mocks.prepareKnowledgeDocumentReprocessing).not.toHaveBeenCalled();
    expect(mocks.commitDocumentReprocessing).not.toHaveBeenCalled();
  });

  it("binds idempotency to the actor and normalized reason before commit", async () => {
    const prepared = {
      documentId,
      operationFingerprint: "preparation-fingerprint",
      outcome: { processingStatus: "ready" },
    };
    const summary = { id: documentId };
    mocks.prepareKnowledgeDocumentReprocessing.mockResolvedValue(prepared);
    mocks.commitDocumentReprocessing.mockResolvedValue({
      documentId,
      processingStatus: "ready",
      summary,
    });

    await reprocessGovernedDocument({
      actor,
      documentId,
      metadata: { title: "Updated" },
      reason: "  Refresh governed evidence.  ",
    });

    const expectedFingerprint = sha256(
      JSON.stringify({
        actorEmail: actor.email,
        actorRole: actor.role,
        preparationFingerprint: "preparation-fingerprint",
        reason: "Refresh governed evidence.",
      }),
    );
    expect(
      mocks.prepareKnowledgeDocumentReprocessing,
    ).toHaveBeenCalledWith({
      accessScope: { createdBy: actor.email, kind: "creator" },
      documentId,
      metadata: { title: "Updated" },
    });
    expect(mocks.commitDocumentReprocessing).toHaveBeenCalledWith({
      actor,
      prepared: {
        ...prepared,
        operationFingerprint: expectedFingerprint,
      },
      reason: "Refresh governed evidence.",
    });
    expect(mocks.createKnowledgeDocumentImportResponse).toHaveBeenCalledWith({
      status: "ready",
      summary,
    });
  });

  it.each([
    { email: "reviewer@example.test", role: "reviewer" as const },
    { email: "admin@example.test", role: "admin" as const },
  ])("gives $role global reprocessing scope", async (privilegedActor) => {
    const prepared = {
      documentId,
      operationFingerprint: "preparation-fingerprint",
      outcome: { processingStatus: "ready" },
    };
    mocks.prepareKnowledgeDocumentReprocessing.mockResolvedValue(prepared);
    mocks.commitDocumentReprocessing.mockResolvedValue({
      documentId,
      processingStatus: "ready",
      summary: { id: documentId },
    });

    await reprocessGovernedDocument({
      actor: privilegedActor,
      documentId,
      metadata: {},
      reason: "Refresh governed evidence.",
    });

    expect(
      mocks.prepareKnowledgeDocumentReprocessing,
    ).toHaveBeenCalledWith({
      accessScope: { kind: "global" },
      documentId,
      metadata: {},
    });
  });
});
