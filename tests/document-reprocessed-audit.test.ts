import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createDocumentChunkSetFingerprint,
  createDocumentDataSourceFingerprint,
  createDocumentDataSourceFingerprintFromPayload,
  parseCanonicalDocumentProvenanceMarkerFor,
} from "@/features/admin/document-reprocessed-audit";
import type { DocumentImportMetadata } from "@/features/knowledge/schemas";

const documentId = "82000000-0000-4000-8000-000000000001";
const draftId = "82000000-0000-4000-8000-000000000002";
const sourceId = "82000000-0000-4000-8000-000000000003";
const supersededDraftId = "82000000-0000-4000-8000-000000000004";

const metadata: DocumentImportMetadata = {
  applicationScope: "non-road",
  canonicalUrl: "https://example.test/documents/audit",
  countryIso3: null,
  demoNotice: null,
  documentType: "government-notice",
  isDemo: false,
  jurisdictionId: null,
  languageCode: "en",
  licenseCode: "CC-BY-4.0",
  publishedOn: "2026-08-30",
  redistributionAllowed: true,
  sourcePublisher: "Audit publisher",
  sourceTitle: "Audit source",
  sourceType: "government-notice",
  sourceUrl: "https://example.test/sources/audit",
  title: "Audit document",
  validFrom: "2026-01-01",
  validTo: null,
};
const source = {
  archivedAt: null,
  createdAt: "2026-08-30T00:00:00.123456Z",
  demoNotice: null,
  id: sourceId,
  isDemo: false,
  publishedOn: "2026-08-30",
  publisher: "Audit publisher",
  sourceType: "government-notice",
  title: "Audit source",
  updatedAt: "2026-08-30T00:00:00.123456Z",
  url: "https://example.test/sources/audit",
  verifiedAt: "2026-08-30T00:00:00.123456Z",
} as const;
const sourceFingerprint =
  createDocumentDataSourceFingerprintFromPayload(source);
const contentSha256 = "a".repeat(64);
const chunkContent = "Canonical chunk content.";
const chunk = {
  applicationScope: metadata.applicationScope,
  chunkIndex: 0,
  content: chunkContent,
  contentHash:
    "2218559d5021424d11b59cdb1e862710fb6b90d3c79288e5dd463e4ef1dd415d",
  countryIso3: metadata.countryIso3,
  createdAt: "2026-08-30T00:00:00.123456Z",
  embedding: Array.from({ length: 128 }, () => 0),
  embeddingModel: "local-hash-v1",
  headingPath: ["Canonical heading"],
  isDemo: metadata.isDemo,
  jurisdictionId: metadata.jurisdictionId,
  pageFrom: 1,
  pageTo: 1,
  sectionLocator: "section-1",
  tokenCount: 3,
  updatedAt: "2026-08-30T00:00:00.123456Z",
  validFrom: metadata.validFrom,
  validTo: metadata.validTo,
  verifiedAt: "2026-08-30T00:00:00.123456Z",
} as const;
const chunkSetFingerprint = createDocumentChunkSetFingerprint({
  chunks: [chunk],
  processingStatus: "ready",
});

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function expectation(version: number, marker: unknown) {
  return parseCanonicalDocumentProvenanceMarkerFor({
    draftVersion: version,
    expectedChunkSetFingerprint: chunkSetFingerprint,
    expectedContentSha256: contentSha256,
    expectedDocumentId: documentId,
    expectedDraftId: draftId,
    expectedMetadata: metadata,
    expectedProcessingStatus: "ready",
    expectedSourceFingerprint: sourceFingerprint,
    expectedSourceId: sourceId,
    marker,
  });
}

function v1Marker() {
  return {
    afterData: {
      chunkSetFingerprint,
      contentSha256,
      documentId,
      metadata,
      processingStatus: "ready",
      provenanceVersion: 2,
      sourceFingerprint,
      sourceId,
    },
    draftId,
    entityKey: documentId,
    entityType: "document",
  };
}

function v2Marker() {
  return {
    afterData: {
      chunkSetFingerprint,
      contentSha256,
      documentId,
      metadata,
      operationFingerprint: "b".repeat(64),
      processingStatus: "ready",
      provenanceVersion: 2,
      sourceFingerprint,
      sourceId,
      status: "ready",
      supersededDraftIds: [supersededDraftId],
    },
    draftId,
    entityKey: documentId,
    entityType: "document",
  };
}

describe("canonical document provenance audit parser", () => {
  it("selects strict draft_created provenance for v1 and reprocessed provenance for v2+", () => {
    expect(expectation(1, v1Marker())?.action).toBe("draft_created");
    expect(expectation(2, v2Marker())?.action).toBe(
      "document_reprocessed",
    );
    expect(expectation(1, v2Marker())).toBeNull();
    expect(expectation(2, v1Marker())).toBeNull();
  });

  it.each([
    ["empty", []],
    [
      "multiple",
      [supersededDraftId, "82000000-0000-4000-8000-000000000005"],
    ],
  ])("rejects a %s superseded draft lineage", (_label, supersededDraftIds) => {
    const marker = v2Marker();
    marker.afterData.supersededDraftIds = supersededDraftIds;
    expect(expectation(2, marker)).toBeNull();
  });

  it.each([
    ["content hash", { contentSha256: "c".repeat(64) }],
    ["chunk set", { chunkSetFingerprint: "e".repeat(64) }],
    ["metadata", { metadata: { ...metadata, title: "Drifted title" } }],
    ["processing status", { processingStatus: "failed" }],
    ["source fingerprint", { sourceFingerprint: "d".repeat(64) }],
    ["source id", { sourceId: "82000000-0000-4000-8000-000000000099" }],
  ] as const)("rejects v1 %s drift", (_label, patch) => {
    const marker = v1Marker();
    marker.afterData = { ...marker.afterData, ...patch };
    expect(expectation(1, marker)).toBeNull();
  });

  it("preserves PostgreSQL microseconds while padding Date/millisecond inputs", () => {
    const milliseconds = {
      ...source,
      createdAt: "2026-08-30T00:00:00.123Z",
      updatedAt: "2026-08-30T00:00:00.123Z",
      verifiedAt: "2026-08-30T00:00:00.123Z",
    };
    const padded = {
      ...milliseconds,
      createdAt: "2026-08-30T00:00:00.123000Z",
      updatedAt: "2026-08-30T00:00:00.123000Z",
      verifiedAt: "2026-08-30T00:00:00.123000Z",
    };
    expect(
      createDocumentDataSourceFingerprintFromPayload(milliseconds),
    ).toBe(createDocumentDataSourceFingerprintFromPayload(padded));
    expect(
      createDocumentDataSourceFingerprint({
        ...milliseconds,
        createdAt: new Date(milliseconds.createdAt),
        updatedAt: new Date(milliseconds.updatedAt),
        verifiedAt: new Date(milliseconds.verifiedAt),
      }),
    ).toBe(createDocumentDataSourceFingerprintFromPayload(padded));
    expect(
      createDocumentDataSourceFingerprintFromPayload({
        ...source,
        createdAt: "2026-08-30T00:00:00.123789Z",
      }),
    ).not.toBe(sourceFingerprint);
  });

  it("binds the strict canonical chunk set and rejects invalid cardinality or hashes", () => {
    expect(() =>
      createDocumentChunkSetFingerprint({
        chunks: [{ ...chunk, content: "Tampered content." }],
        processingStatus: "ready",
      }),
    ).toThrow();
    expect(() =>
      createDocumentChunkSetFingerprint({
        chunks: [],
        processingStatus: "ready",
      }),
    ).toThrow();
    expect(() =>
      createDocumentChunkSetFingerprint({
        chunks: [chunk],
        processingStatus: "failed",
      }),
    ).toThrow();
    expect(
      createDocumentChunkSetFingerprint({
        chunks: [],
        processingStatus: "failed",
      }),
    ).toMatch(/^[0-9a-f]{64}$/u);
  });

  it.each([
    ["content", { content: "Replacement content.", contentHash: digest("Replacement content.") }],
    ["heading", { headingPath: ["Replacement heading"] }],
    ["page", { pageFrom: 2, pageTo: 2 }],
    ["section", { sectionLocator: "section-2" }],
    ["tokens", { tokenCount: 4 }],
    ["embedding", { embedding: [0.5, ...Array.from({ length: 127 }, () => 0)] }],
    ["model", { embeddingModel: "replacement-model" }],
    ["scope", { applicationScope: "marine" }],
    ["country", { countryIso3: "CHN" }],
    ["jurisdiction", { jurisdictionId: "82000000-0000-4000-8000-000000000004" }],
    ["demo", { isDemo: true }],
    ["validity", { validFrom: "2026-02-01" }],
    ["created microseconds", { createdAt: "2026-08-30T00:00:00.123789Z" }],
    ["updated microseconds", { updatedAt: "2026-08-30T00:00:00.123789Z" }],
    ["verified microseconds", { verifiedAt: "2026-08-30T00:00:00.123789Z" }],
  ] as const)("changes the chunk-set fingerprint after %s drift", (_label, patch) => {
    expect(
      createDocumentChunkSetFingerprint({
        chunks: [{ ...chunk, ...patch }],
        processingStatus: "ready",
      }),
    ).not.toBe(chunkSetFingerprint);
  });
});
