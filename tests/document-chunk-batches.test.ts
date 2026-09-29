import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";

import { chunkStructuredText } from "@/domain/knowledge/chunk-document";
import { createLocalHashEmbedding, KNOWLEDGE_EMBEDDING_MODEL } from "@/domain/knowledge/embedding";
import * as schema from "@/server/db/schema";
import { sha256 } from "@/server/knowledge/document-file";
import { documentChunkInsertBatches } from "@/server/repositories/document-chunk-batches";
import type { ChunkInsert } from "@/server/repositories/knowledge-repository";

const documentId = "00000000-0000-4000-8000-000000000999";
const database = drizzle.mock({ schema });

function chunksFor(count: number): ChunkInsert[] {
  return chunkStructuredText("DEMO ONLY — SQL batching", "body\n\n".repeat(count))
    .map((chunk) => ({
      ...chunk,
      applicationScope: null,
      contentHash: sha256(chunk.content),
      countryIso3: null,
      embedding: createLocalHashEmbedding(chunk.content),
      embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
      isDemo: true,
      jurisdictionId: null,
      validFrom: null,
      validTo: null,
      verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    }));
}

describe("document chunk insert batches", () => {
  it.each([1, 999, 1000, 1001, 3641, 5000])(
    "preserves all %s chunks and keeps each compiled statement below the driver parameter guard",
    (count) => {
      const chunks = chunksFor(count);
      const batches = Array.from(documentChunkInsertBatches(documentId, chunks));
      const expectedRows = chunks.map((chunk) => ({ ...chunk, documentId }));
      expect(batches).toHaveLength(Math.ceil(count / 1000));
      expect(batches.every((batch) => batch.length > 0 && batch.length <= 1000)).toBe(true);
      expect(batches.flat()).toEqual(expectedRows);

      const compiled = batches.map((batch) => database.insert(schema.documentChunks).values(batch).toSQL());
      const unbatched = database.insert(schema.documentChunks).values(expectedRows).toSQL();
      expect(compiled.every((query) => query.params.length < 65534)).toBe(true);
      expect(compiled.flatMap((query) => query.params)).toEqual(unbatched.params);
      if (count >= 3641) expect(unbatched.params.length).toBeGreaterThanOrEqual(65534);
    },
  );

  it("binds the destination document without mutating or reordering input records", () => {
    const chunks = chunksFor(3).map((chunk) => ({ ...chunk, documentId: "stale-document-id" }));
    const before = structuredClone(chunks);
    const rows = Array.from(documentChunkInsertBatches(documentId, chunks)).flat();
    expect(rows.map((row) => row.documentId)).toEqual([documentId, documentId, documentId]);
    expect(rows.map((row) => row.chunkIndex)).toEqual([0, 1, 2]);
    expect(chunks).toEqual(before);
    expect(rows[0]).not.toBe(chunks[0]);
  });

  it("keeps empty ready chunk sets invalid instead of silently skipping the write", () => {
    expect(() => Array.from(documentChunkInsertBatches(documentId, [])))
      .toThrow("Cannot insert an empty document chunk set.");
  });
});
