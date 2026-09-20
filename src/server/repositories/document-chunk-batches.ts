import type { ChunkInsert } from "@/server/repositories/knowledge-repository";

const documentChunkInsertBatchSize = 1_000;

/**
 * Consume every batch sequentially inside the caller's existing transaction.
 * A chunk currently binds 18 parameters including documentId; 1000 rows leave
 * headroom below the installed postgres.js >= 65534 parameter rejection guard.
 * This helper neither opens transactions nor catches write errors.
 */
export function* documentChunkInsertBatches(
  documentId: string,
  chunks: readonly ChunkInsert[],
): Generator<(ChunkInsert & { documentId: string })[]> {
  if (chunks.length === 0) {
    throw new Error("Cannot insert an empty document chunk set.");
  }
  for (let offset = 0; offset < chunks.length; offset += documentChunkInsertBatchSize) {
    yield chunks.slice(offset, offset + documentChunkInsertBatchSize).map((chunk) => ({
      ...chunk,
      documentId,
    }));
  }
}
