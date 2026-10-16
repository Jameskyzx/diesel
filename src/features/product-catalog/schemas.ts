import { z } from "zod";
import {
  applicableRegulationsQuerySchema,
  applicationScopeSchema,
  isoDateSchema,
} from "@/features/database/schemas";

export const catalogCategories = ["truck", "bus", "construction", "agriculture", "generator-set", "marine"] as const;
export const catalogCategorySchema = z.enum(catalogCategories);
export type CatalogCategory = z.infer<typeof catalogCategorySchema>;
export const catalogRecordIdSchema = z.string().regex(/^demo-cat-\d{3}$/u);

export const catalogQuerySchema = z.object({
  query: z.string().trim().max(100).default(""),
  category: z.union([catalogCategorySchema, z.literal("")]).default(""),
  minPowerKw: z.number().nonnegative().max(100_000).optional(),
  maxPowerKw: z.number().positive().max(100_000).optional(),
  recordIds: z.array(catalogRecordIdSchema).max(5).default([]),
  offset: z.number().int().nonnegative().max(10_000).default(0),
  limit: z.number().int().min(1).max(20).default(10),
}).strict().refine(q => q.minPowerKw === undefined || q.maxPowerKw === undefined || q.minPowerKw <= q.maxPowerKw,
  "Minimum power cannot exceed maximum power");
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

/** A fictional spec-sheet entry. `declaredCitationCodes` is what the sheet
 * claims to meet; it is matched literally and never treated as certification. */
export const catalogRecordSchema = z.object({
  id: catalogRecordIdSchema,
  model: z.string().regex(/^DEMO-[A-Z0-9-]+$/u),
  series: z.string().regex(/^DEMO-[A-Z0-9]+$/u),
  category: catalogCategorySchema,
  applicationScopes: z.array(applicationScopeSchema).min(1),
  ratedPowerKw: z.number().positive(),
  ratedSpeedRpm: z.number().positive(),
  powerMinKw: z.number().nonnegative(),
  powerMaxKw: z.number().positive(),
  displacementL: z.number().positive(),
  cylinders: z.number().int().positive(),
  aftertreatment: z.string().min(1),
  emissionLabel: z.string().min(1),
  declaredCitationCodes: z.array(z.string().min(1)).max(20),
}).strict().refine(r => r.powerMinKw < r.powerMaxKw && r.ratedPowerKw >= r.powerMinKw && r.ratedPowerKw < r.powerMaxKw,
  "Rated power must sit inside the declared half-open power band");
export type CatalogRecord = z.infer<typeof catalogRecordSchema>;

const catalogIdentity = {
  isDemo: z.literal(true),
  title: z.string().startsWith("DEMO ONLY"),
  evidenceStatus: z.literal("fictional_declaration"),
};

export const catalogSnapshotSchema = z.object({
  version: z.literal(2), ...catalogIdentity, notice: z.string().min(1),
  records: z.array(catalogRecordSchema).min(1),
}).strict().refine(s => new Set(s.records.map(r => r.id)).size === s.records.length, "Duplicate catalogue record ID")
  .refine(s => new Set(s.records.map(r => r.model)).size === s.records.length, "Duplicate catalogue model code");
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;

export const catalogResultSchema = z.object({
  kind: z.literal("product_catalog"), ...catalogIdentity,
  query: catalogQuerySchema, total: z.number().int().nonnegative(), modelCount: z.number().int(),
  records: z.array(catalogRecordSchema).max(20),
}).strict();
export type CatalogResult = z.infer<typeof catalogResultSchema>;

export const catalogFitQuerySchema = applicableRegulationsQuerySchema;
export type CatalogFitQuery = z.infer<typeof catalogFitQuerySchema>;

export const catalogFitRegulationSchema = z.object({
  regulationId: z.string().min(1),
  citationCode: z.string().nullable(),
  canonicalName: z.string().min(1),
  recordStatus: z.enum(["effective", "superseded"]),
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.nullable(),
  jurisdictionCode: z.string().min(1),
  isDemo: z.boolean(),
  source: z.object({
    id: z.string().min(1), title: z.string().min(1), url: z.string().nullable(),
    verifiedAt: z.iso.datetime(), isDemo: z.boolean(),
  }).strict(),
}).strict();
export type CatalogFitRegulation = z.infer<typeof catalogFitRegulationSchema>;

export const catalogFitStatuses = ["declared_match", "declaration_gap", "unknown", "not_fit"] as const;
export const catalogFitStatusSchema = z.enum(catalogFitStatuses);
export type CatalogFitStatus = z.infer<typeof catalogFitStatusSchema>;
export const catalogFitReasonSchema = z.enum([
  "DECLARATION_COVERS_ALL_APPLICABLE",
  "DECLARATION_GAP",
  "NO_APPLICABLE_REGULATION_DATA",
  "APPLICATION_SCOPE_MISMATCH",
  "POWER_OUT_OF_RANGE",
]);
export type CatalogFitReason = z.infer<typeof catalogFitReasonSchema>;

export const catalogFitEvaluationSchema = z.object({
  record: catalogRecordSchema,
  status: catalogFitStatusSchema,
  reason: catalogFitReasonSchema,
  scopeMatch: z.boolean(),
  powerMatch: z.boolean(),
  declaredRegulationIds: z.array(z.string()),
  undeclaredRegulationIds: z.array(z.string()),
}).strict();
export type CatalogFitEvaluation = z.infer<typeof catalogFitEvaluationSchema>;

export const catalogFitResultSchema = z.object({
  kind: z.literal("catalog_fit"),
  rulesetVersion: z.literal("catalog-fit-v1"),
  evidenceBasis: z.literal("manufacturer_declaration"),
  certificationVerified: z.literal(false),
  catalog: z.object(catalogIdentity).strict(),
  query: catalogFitQuerySchema,
  applicableRegulations: z.array(catalogFitRegulationSchema),
  evaluations: z.array(catalogFitEvaluationSchema),
  counts: z.record(catalogFitStatusSchema, z.number().int().nonnegative()),
}).strict();
export type CatalogFitResult = z.infer<typeof catalogFitResultSchema>;
