import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { parseMarketCsv } from "@/domain/admin/parse-market-csv";
import {
  governanceActionInputSchema,
  governanceDraftCreateSchema,
  governedEntityReferenceSchema,
  marketCsvPreviewInputSchema,
  sourceVerificationInputSchema,
  type AdminPrincipal,
  type GovernedEntityType,
  type GovernanceDraftCreate,
  type GovernanceWorkflowStatus,
} from "@/features/admin/schemas";
import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import { sha256 } from "@/server/knowledge/document-file";
import { createGovernanceRepository } from "@/server/repositories/governance-repository";
import {
  importKnowledgeDocument,
  reprocessKnowledgeDocument,
} from "@/server/services/knowledge-service";

export class GovernancePermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernancePermissionError";
  }
}

function requireEditor(actor: AdminPrincipal): void {
  if (!["editor", "reviewer", "admin"].includes(actor.role)) {
    throw new GovernancePermissionError("该操作需要 editor 权限。");
  }
}

function requireReviewer(actor: AdminPrincipal): void {
  if (!["reviewer", "admin"].includes(actor.role)) {
    throw new GovernancePermissionError("该操作需要 reviewer 权限。");
  }
}

function requireAdmin(actor: AdminPrincipal): void {
  if (actor.role !== "admin") {
    throw new GovernancePermissionError("归档操作需要 admin 权限。");
  }
}

async function getGovernanceRepository() {
  if (getDatabaseMode() === "pglite-demo") {
    return createGovernanceRepository(await getDemoDatabase());
  }

  return createGovernanceRepository(getDatabase());
}

function normalizeDraft(input: GovernanceDraftCreate): {
  entityKey: string;
  entityType: GovernedEntityType;
  payload: Record<string, unknown>;
} {
  if (input.entityType === "country") {
    return {
      entityKey: input.payload.iso3,
      entityType: input.entityType,
      payload: { ...input.payload },
    };
  }
  if (input.entityType === "document") {
    return {
      entityKey: input.payload.documentId,
      entityType: input.entityType,
      payload: { ...input.payload },
    };
  }
  if (input.entityType === "regulation") {
    const id = input.payload.id ?? randomUUID();
    return {
      entityKey: id,
      entityType: input.entityType,
      payload: {
        ...input.payload,
        id,
        limits: input.payload.limits.map((limit) => ({
          ...limit,
          id: randomUUID(),
        })),
      },
    };
  }

  const id = input.payload.id ?? randomUUID();
  return {
    entityKey: id,
    entityType: input.entityType,
    payload: { ...input.payload, id },
  };
}

export async function archiveGovernedEntity(input: {
  actor: AdminPrincipal;
  entityKey: string;
  entityType: unknown;
  reason: unknown;
}) {
  requireAdmin(input.actor);
  const action = governanceActionInputSchema.parse({
    reason: input.reason,
  });
  const entity = governedEntityReferenceSchema.parse({
    entityKey: input.entityKey,
    entityType: input.entityType,
  });
  const repository = await getGovernanceRepository();

  await repository.archiveEntity({
    actor: input.actor,
    entityKey: entity.entityKey,
    entityType: entity.entityType,
    reason: action.reason,
  });

  return { status: "archived" as const };
}

export async function confirmMarketCsvImport(input: {
  actor: AdminPrincipal;
  batchId: string;
  reason: unknown;
}) {
  requireEditor(input.actor);
  const action = governanceActionInputSchema.parse({
    reason: input.reason,
  });
  const batchId = z.uuid().parse(input.batchId);
  const repository = await getGovernanceRepository();

  return repository.confirmMarketImport({
    actor: input.actor,
    batchId,
    reason: action.reason,
  });
}

export async function createGovernanceDraft(
  rawInput: unknown,
  actor: AdminPrincipal,
) {
  requireEditor(actor);
  const input = governanceDraftCreateSchema.parse(rawInput);
  const normalized = normalizeDraft(input);
  const repository = await getGovernanceRepository();

  return repository.createDraft({
    actor,
    changeReason: input.changeReason,
    ...normalized,
  });
}

export async function getGovernanceDashboard(input?: {
  status?: GovernanceWorkflowStatus;
}) {
  const repository = await getGovernanceRepository();

  return getGovernanceDashboardFromRepository(repository, input);
}

export async function getGovernanceDashboardFromRepository(
  repository: ReturnType<typeof createGovernanceRepository>,
  input?: { status?: GovernanceWorkflowStatus },
) {
  const [drafts, importBatches, auditLogs] = await Promise.all([
    repository.listDrafts(input?.status),
    repository.listImportBatches(),
    repository.listAuditLogs(),
  ]);
  const reviewContexts = await repository.getDraftReviewContexts(drafts);
  const reviewContextByDraftId = new Map(
    reviewContexts.map(({ draftId, ...reviewContext }) => [
      draftId,
      reviewContext,
    ]),
  );

  return {
    auditLogs,
    drafts: drafts.map((draft) => {
      const reviewContext = reviewContextByDraftId.get(draft.id);
      if (!reviewContext) {
        throw new Error(`Missing governance review context for ${draft.id}.`);
      }
      return { ...draft, reviewContext };
    }),
    importBatches,
  };
}

export async function previewMarketCsv(
  rawInput: unknown,
  actor: AdminPrincipal,
) {
  requireEditor(actor);
  const input = marketCsvPreviewInputSchema.parse(rawInput);
  const preview = parseMarketCsv(input.content);
  const repository = await getGovernanceRepository();
  const batch = await repository.createMarketImportPreview({
    actor,
    contentSha256: sha256(input.content),
    errors: preview.errors,
    fileName: input.fileName,
    rows: preview.rows.map((row) => ({
      parsed: row.parsed ? { ...row.parsed } : null,
      rowNumber: row.rowNumber,
    })),
  });

  return {
    batchId: batch.id,
    errors: preview.errors,
    invalidRows: batch.invalidRows,
    rows: preview.rows,
    status: "previewed" as const,
    totalRows: batch.totalRows,
    validRows: batch.validRows,
  };
}

export async function publishGovernanceDraft(input: {
  actor: AdminPrincipal;
  draftId: string;
  reason: unknown;
}) {
  requireReviewer(input.actor);
  const action = governanceActionInputSchema.parse({
    reason: input.reason,
  });
  const draftId = z.uuid().parse(input.draftId);
  const repository = await getGovernanceRepository();

  return repository.publishDraft({
    actor: input.actor,
    draftId,
    reason: action.reason,
  });
}

export async function reviewGovernanceDraft(input: {
  actor: AdminPrincipal;
  draftId: string;
  reason: unknown;
}) {
  requireReviewer(input.actor);
  const action = governanceActionInputSchema.parse({
    reason: input.reason,
  });
  const draftId = z.uuid().parse(input.draftId);
  const repository = await getGovernanceRepository();

  return repository.reviewDraft({
    actor: input.actor,
    draftId,
    reason: action.reason,
  });
}

export async function uploadGovernedDocument(input: {
  actor: AdminPrincipal;
  bytes: Uint8Array;
  changeReason: string;
  fileName: string;
  metadata: unknown;
  mimeType: string;
}) {
  requireEditor(input.actor);
  const imported = await importKnowledgeDocument({
    bytes: input.bytes,
    fileName: input.fileName,
    governanceStatus: "draft",
    metadata: input.metadata,
    mimeType: input.mimeType,
  });

  if (imported.status === "duplicate") {
    return { draft: null, import: imported };
  }

  const draft = await createGovernanceDraft(
    {
      changeReason: input.changeReason,
      entityType: "document",
      payload: {
        documentId: imported.document.id,
      },
    },
    input.actor,
  );

  return { draft, import: imported };
}

export async function reprocessGovernedDocument(input: {
  actor: AdminPrincipal;
  documentId: string;
  metadata: unknown;
  reason: unknown;
}) {
  requireEditor(input.actor);
  const action = governanceActionInputSchema.parse({
    reason: input.reason,
  });
  const documentId = z.uuid().parse(input.documentId);
  const operation = await reprocessKnowledgeDocument({
    documentId,
    metadata: input.metadata,
  });
  const repository = await getGovernanceRepository();

  await repository.recordOperationalChange({
    action: "document_reprocessed",
    actor: input.actor,
    afterData: operation.afterData,
    beforeData: operation.beforeData,
    entityKey: documentId,
    entityType: "document",
    reason: action.reason,
  });

  return operation.response;
}

export async function verifyDataSource(input: {
  actor: AdminPrincipal;
  reason: unknown;
  sourceId: string;
  verifiedAt: unknown;
}) {
  requireEditor(input.actor);
  const action = sourceVerificationInputSchema.parse({
    reason: input.reason,
    verifiedAt: input.verifiedAt,
  });
  const sourceId = z.uuid().parse(input.sourceId);

  const repository = await getGovernanceRepository();
  return repository.updateSourceVerifiedAt({
    actor: input.actor,
    reason: action.reason,
    sourceId,
    verifiedAt: new Date(action.verifiedAt),
  });
}
