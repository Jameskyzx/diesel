import "server-only";

import type { AdminPrincipal } from "@/features/admin/schemas";
import {
  feedbackQuerySchema,
  publicFeedbackRecordSchema,
  type FeedbackQuery,
  type PublicFeedbackRecord,
} from "@/features/feedback/schemas";
import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import { throwIfRequestAborted, type RequestSignalOptions } from "@/server/http/request-signal";
import { readDocumentFile } from "@/server/knowledge/local-document-storage";
import { createFeedbackRepository } from "@/server/repositories/feedback-repository";
import { GovernancePermissionError } from "@/server/services/governance-service";

async function getFeedbackRepository(options: RequestSignalOptions = {}) {
  throwIfRequestAborted(options.signal);
  if (getDatabaseMode() === "pglite-demo") return createFeedbackRepository(await getDemoDatabase());
  return createFeedbackRepository(getDatabase());
}

function toRecords(rows: readonly unknown[]): PublicFeedbackRecord[] {
  return rows.map(row => publicFeedbackRecordSchema.parse(row));
}

/**
 * Public read: only fictional demo feedback on demo engines. Real customer
 * feedback is never returned from a public route.
 */
export async function listPublicFeedback(input: unknown, options: RequestSignalOptions = {}): Promise<PublicFeedbackRecord[]> {
  const query = feedbackQuerySchema.parse(input);
  const repository = await getFeedbackRepository(options);
  return toRecords(await repository.listFeedback(query, "demo", options));
}

export type AdminFeedbackRecord = PublicFeedbackRecord & {
  customerRef: string | null;
  sourceFiles: { id: string; filename: string; mediaType: string }[];
};

/** Internal read for editors: every published record, with its original files. */
export async function listAdminFeedback(query: FeedbackQuery, actor: AdminPrincipal): Promise<AdminFeedbackRecord[]> {
  if (!["editor", "reviewer", "admin"].includes(actor.role)) throw new GovernancePermissionError("该操作需要 editor 权限。");
  const repository = await getFeedbackRepository();
  const records = toRecords(await repository.listFeedback(feedbackQuerySchema.parse(query), "all"));
  const sources = new Map((await repository.listFeedbackSources(records.map(({ id }) => id))).map(row => [row.id, row]));
  const batchIds = [...new Set([...sources.values()].flatMap(({ sourceBatchId }) => sourceBatchId ? [sourceBatchId] : []))];
  const files = await repository.listSourceFilesForBatches(batchIds);
  return records.map(record => {
    const source = sources.get(record.id);
    return {
      ...record,
      customerRef: source?.customerRef ?? null,
      sourceFiles: files.filter(file => file.batchId === source?.sourceBatchId)
        .map(file => ({ filename: file.originalFilename, id: file.id, mediaType: file.mediaType })),
    };
  });
}

const inlineMediaTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

/** The original upload behind a feedback batch, for internal review only. */
export async function readFeedbackSourceFile(fileId: string, actor: AdminPrincipal) {
  if (!["editor", "reviewer", "admin"].includes(actor.role)) throw new GovernancePermissionError("该操作需要 editor 权限。");
  const repository = await getFeedbackRepository();
  const file = await repository.getSourceFile(fileId);
  if (!file) return null;
  const bytes = await readDocumentFile(file.storagePath);
  return {
    bytes,
    filename: file.originalFilename,
    inline: inlineMediaTypes.has(file.mediaType),
    mediaType: inlineMediaTypes.has(file.mediaType) ? file.mediaType : "application/octet-stream",
  };
}
