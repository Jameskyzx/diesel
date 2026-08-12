import { z } from "zod";

import {
  applicationScopeSchema,
  decimalNumberStringSchema,
  governanceWorkflowStatusSchema,
  httpUrlSchema,
  iso3Schema,
  isoDateSchema,
} from "@/features/database/schemas";

const isoTimestampSchema = z.iso.datetime({ offset: true });
const nullableIsoDateSchema = z.union([isoDateSchema, z.null()]);
const searchLimitSchema = z
  .union([z.number(), decimalNumberStringSchema])
  .transform((value) =>
    typeof value === "number" ? value : Number(value),
  )
  .pipe(z.number().finite().int().min(1).max(25));

export const documentTypes = [
  "regulation-text",
  "government-notice",
  "product-manual",
  "industry-report",
  "certificate",
  "other",
] as const;

export const sourceTypes = [
  "official-regulation",
  "government-notice",
  "product-manual",
  "industry-report",
  "certificate",
  "demo",
  "other",
] as const;

export const documentProcessingStatusSchema = z.enum([
  "pending",
  "processing",
  "ready",
  "failed",
]);

const optionalUrlSchema = z.union([
  httpUrlSchema,
  z.literal(""),
  z.null(),
]);

export const documentImportMetadataSchema = z
  .object({
    applicationScope: z.union([applicationScopeSchema, z.null()]),
    canonicalUrl: optionalUrlSchema,
    countryIso3: z.union([iso3Schema, z.null()]),
    demoNotice: z.string().trim().max(500).nullable(),
    documentType: z.enum(documentTypes),
    isDemo: z.boolean(),
    jurisdictionId: z.union([z.uuid(), z.null()]),
    languageCode: z
      .string()
      .trim()
      .min(2)
      .max(10)
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/),
    licenseCode: z.string().trim().max(100).nullable(),
    publishedOn: nullableIsoDateSchema,
    redistributionAllowed: z.boolean().nullable(),
    sourcePublisher: z.string().trim().max(200).nullable(),
    sourceTitle: z.string().trim().min(1).max(300),
    sourceType: z.enum(sourceTypes),
    sourceUrl: optionalUrlSchema,
    title: z.string().trim().min(1).max(300),
    validFrom: nullableIsoDateSchema,
    validTo: nullableIsoDateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.isDemo !== (value.sourceType === "demo")) {
      context.addIssue({
        code: "custom",
        message: "isDemo must be true if and only if sourceType is demo",
        path: ["sourceType"],
      });
    }
    if (
      value.validFrom !== null &&
      value.validTo !== null &&
      value.validTo <= value.validFrom
    ) {
      context.addIssue({
        code: "custom",
        message: "validTo must be later than validFrom",
        path: ["validTo"],
      });
    }

    if (value.isDemo && !value.demoNotice) {
      context.addIssue({
        code: "custom",
        message: "Demo documents require a demo notice",
        path: ["demoNotice"],
      });
    }
  });

export const knowledgeDocumentSummarySchema = z
  .object({
    byteSize: z.number().int().nonnegative().nullable(),
    chunkCount: z.number().int().nonnegative(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: isoTimestampSchema,
    downloadUrl: z.string().nullable(),
    governanceStatus: governanceWorkflowStatusSchema,
    id: z.uuid(),
    isDemo: z.boolean(),
    mimeType: z.string().nullable(),
    originalFilename: z.string().nullable(),
    processedAt: isoTimestampSchema.nullable(),
    processingError: z.string().nullable(),
    processingStatus: documentProcessingStatusSchema,
    sourceTitle: z.string(),
    title: z.string(),
    type: z.enum(documentTypes),
  })
  .strict();

export const documentImportResponseSchema = z
  .object({
    document: knowledgeDocumentSummarySchema,
    status: z.enum(["ready", "duplicate", "failed"]),
  })
  .strict();

export const hybridSearchQuerySchema = z
  .object({
    applicationScope: z
      .union([applicationScopeSchema, z.null()])
      .default(null),
    asOf: z.union([isoDateSchema, z.null()]).default(null),
    countryIso3: z.union([iso3Schema, z.null()]).default(null),
    jurisdictionId: z.union([z.uuid(), z.null()]).default(null),
    limit: searchLimitSchema.default(10),
    query: z.string().trim().min(1).max(500),
  })
  .strict();

const searchSourceSchema = z
  .object({
    id: z.uuid(),
    isDemo: z.boolean(),
    publishedOn: nullableIsoDateSchema,
    publisher: z.string().nullable(),
    title: z.string(),
    url: httpUrlSchema.nullable(),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

export const hybridSearchResultSchema = z
  .object({
    applicationScope: z.union([applicationScopeSchema, z.null()]),
    chunkId: z.uuid(),
    content: z.string(),
    countryIso3: z.union([iso3Schema, z.null()]),
    document: z
      .object({
        downloadUrl: z.string().nullable(),
        id: z.uuid(),
        originalFilename: z.string().nullable(),
        publishedOn: nullableIsoDateSchema,
        source: searchSourceSchema,
        title: z.string(),
      })
      .strict(),
    finalScore: z.number().finite(),
    headingPath: z.array(z.string()).nullable(),
    jurisdiction: z
      .object({
        id: z.uuid(),
        name: z.string(),
      })
      .nullable(),
    keywordScore: z.number().finite(),
    pageFrom: z.number().int().positive().nullable(),
    pageTo: z.number().int().positive().nullable(),
    rank: z.number().int().positive(),
    sectionLocator: z.string().nullable(),
    validFrom: nullableIsoDateSchema,
    validTo: nullableIsoDateSchema,
    vectorScore: z.number().finite(),
    warnings: z.array(z.string()),
  })
  .strict();

export const hybridSearchResponseSchema = z
  .object({
    embeddingModel: z.literal("local-hash-embedding-v1"),
    filters: hybridSearchQuerySchema.omit({ query: true }),
    query: z.string(),
    results: z.array(hybridSearchResultSchema),
    scoring: z
      .object({
        keywordWeight: z.literal(0.5),
        vectorWeight: z.literal(0.5),
      })
      .strict(),
    status: z.literal("ok"),
  })
  .strict();

export const knowledgeOptionsResponseSchema = z
  .object({
    countries: z.array(
      z
        .object({
          iso3: iso3Schema,
          name: z.string(),
        })
        .strict(),
    ),
    documents: z.array(knowledgeDocumentSummarySchema),
    jurisdictions: z.array(
      z
        .object({
          countryIso3: z.union([iso3Schema, z.null()]),
          id: z.uuid(),
          name: z.string(),
        })
        .strict(),
    ),
    status: z.literal("ok"),
  })
  .strict();

export const knowledgeApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum([
          "DEVELOPER_ONLY",
          "INVALID_INPUT",
          "PAYLOAD_TOO_LARGE",
          "FILE_TOO_LARGE",
          "EMPTY_FILE",
          "NOT_FOUND",
          "INTERNAL_ERROR",
        ]),
        message: z.string(),
      })
      .strict(),
    document: knowledgeDocumentSummarySchema.optional(),
  })
  .strict();

export type DocumentImportMetadata = z.infer<
  typeof documentImportMetadataSchema
>;
export type DocumentImportResponse = z.infer<
  typeof documentImportResponseSchema
>;
export type HybridSearchQuery = z.infer<typeof hybridSearchQuerySchema>;
export type HybridSearchResponse = z.infer<typeof hybridSearchResponseSchema>;
export type KnowledgeDocumentSummary = z.infer<
  typeof knowledgeDocumentSummarySchema
>;
export type KnowledgeOptionsResponse = z.infer<
  typeof knowledgeOptionsResponseSchema
>;
