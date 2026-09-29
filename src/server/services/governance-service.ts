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
} from "@/features/admin/schemas";
import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import { sha256 } from "@/server/knowledge/document-file";
import { getErrorCode } from "@/lib/api-error";
import {
  createGovernanceDashboardRepository,
  type GovernanceDashboardRepository,
} from "@/server/repositories/governance-dashboard-repository";
import {
  createGovernanceRepository,
  GovernanceConflictError,
} from "@/server/repositories/governance-repository";
import type { KnowledgeDocumentReprocessingAccessScope } from "@/server/repositories/knowledge-repository";
import {
  createKnowledgeDocumentImportResponse,
  prepareKnowledgeDocument,
  prepareKnowledgeDocumentReprocessing,
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

async function getGovernanceDashboardRepository() {
  if (getDatabaseMode() === "pglite-demo") {
    return createGovernanceDashboardRepository(await getDemoDatabase());
  }

  return createGovernanceDashboardRepository(getDatabase());
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
  if (
    z
      .object({ entityType: z.literal("document") })
      .passthrough()
      .safeParse(rawInput).success
  ) {
    throw new GovernanceConflictError(
      "Document drafts must be created through the governed upload or reprocessing workflow.",
    );
  }
  const input = governanceDraftCreateSchema.parse(rawInput);
  const normalized = normalizeDraft(input);
  const repository = await getGovernanceRepository();

  return repository.createDraft({
    actor,
    changeReason: input.changeReason,
    ...normalized,
  });
}

export async function getGovernanceDashboard(principal: AdminPrincipal) {
  requireEditor(principal);
  const repository = await getGovernanceDashboardRepository();

  return getGovernanceDashboardFromRepository(repository, principal);
}

export async function getGovernanceDashboardFromRepository(
  repository: GovernanceDashboardRepository,
  principal: AdminPrincipal,
) {
  requireEditor(principal);
  const [drafts, workflowCounts, auditLogs] = await Promise.all([
    repository.listActiveDrafts(principal),
    repository.getWorkflowCounts(principal),
    principal.role === "editor"
      ? Promise.resolve([])
      : repository.listDashboardAuditLogs(),
  ]);
  if (
    drafts.some(
      (draft) =>
        (draft.workflowStatus !== "draft" &&
          draft.workflowStatus !== "reviewed") ||
        (principal.role === "editor" &&
          draft.createdBy !== principal.email),
    )
  ) {
    throw new Error(
      "Governance dashboard repository returned an out-of-scope draft.",
    );
  }
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
      return {
        ...draft,
        reviewContext:
          principal.role === "editor" &&
          reviewContext.publishedBaseline
            ? {
                ...reviewContext,
                publishedBaseline: {
                  ...reviewContext.publishedBaseline,
                  publishedBy: null,
                },
              }
            : reviewContext,
      };
    }),
    workflowCounts,
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
  const { reason: changeReason } = governanceActionInputSchema.parse({
    reason: input.changeReason,
  });
  const prepared = await prepareKnowledgeDocument({
    bytes: input.bytes,
    fileName: input.fileName,
    metadata: input.metadata,
    mimeType: input.mimeType,
  });
  const repository = await getGovernanceRepository();
  let committed;
  try {
    committed = await repository.commitDocumentUpload({
      actor: input.actor,
      changeReason,
      prepared,
    });
  } catch (error: unknown) {
    if (prepared.storageCreated) {
      console.warn("Governed document orphan cleanup deferred", {
        errorCode: getErrorCode(error),
      });
    }
    throw error;
  }
  const imported = createKnowledgeDocumentImportResponse({
    status: committed.created
      ? prepared.outcome.processingStatus
      : "duplicate",
    summary: committed.summary,
  });

  return {
    draft:
      committed.created || committed.draftCreated
        ? committed.draft
        : null,
    import: imported,
  };
}

export async function reprocessGovernedDocument(input: {
  actor: AdminPrincipal;
  documentId: string;
  metadata: unknown;
  reason: unknown;
}) {
  requireEditor(input.actor);
  const accessScope: KnowledgeDocumentReprocessingAccessScope =
    input.actor.role === "editor"
      ? { createdBy: input.actor.email, kind: "creator" }
      : { kind: "global" };
  const action = governanceActionInputSchema.parse({
    reason: input.reason,
  });
  const documentId = z.uuid().parse(input.documentId);
  const prepared = await prepareKnowledgeDocumentReprocessing({
    accessScope,
    documentId,
    metadata: input.metadata,
  });
  const governedPrepared = {
    ...prepared,
    operationFingerprint: sha256(
      JSON.stringify({
        actorEmail: input.actor.email,
        actorRole: input.actor.role,
        preparationFingerprint: prepared.operationFingerprint,
        reason: action.reason,
      }),
    ),
  };
  const repository = await getGovernanceRepository();
  const committed = await repository.commitDocumentReprocessing({
    actor: input.actor,
    prepared: governedPrepared,
    reason: action.reason,
  });

  return createKnowledgeDocumentImportResponse({
    status: committed.processingStatus,
    summary: committed.summary,
  });
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
    verifiedAt: action.verifiedAt,
  });
}
