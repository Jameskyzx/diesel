import { z } from "zod";

export const catalogQuerySchema = z.object({
  query: z.string().trim().max(100).default(""),
  category: z.string().trim().max(60).default(""),
  fuel: z.string().trim().max(60).default(""),
  minPowerKw: z.number().nonnegative().max(100_000).optional(),
  maxPowerKw: z.number().positive().max(100_000).optional(),
  recordIds: z.array(z.string().regex(/^weichai-row-\d+$/u)).max(5).default([]),
  offset: z.number().int().nonnegative().max(10_000).default(0),
  limit: z.number().int().min(1).max(20).default(10),
}).strict().refine(q => q.minPowerKw === undefined || q.maxPowerKw === undefined || q.minPowerKw <= q.maxPowerKw,
  "Minimum power cannot exceed maximum power");
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export const catalogRecordSchema = z.object({
  id: z.string(), model: z.string(), category: z.string(), application: z.string(), product: z.string(),
  familyFuel: z.string(), ratedPowerKw: z.number().positive().nullable(), ratedSpeedRpm: z.number().positive().nullable(),
  family: z.record(z.enum(["series", "adaptation", "powerRange", "torqueRange", "displacement", "emissionClaim", "type", "cylinders", "valves", "aspiration", "dimensions", "weight"]), z.string()),
  raw: z.object({ power: z.string(), torque: z.string(), displacement: z.string(), emissionClaim: z.string(),
    technicalRoute: z.string(), vehicle: z.string(), valves: z.string(), purpose: z.string(), type: z.string(),
    aspiration: z.string(), weight: z.string(), outputInterface: z.string(), headers: z.string(),
    speed: z.string(), idle: z.string() }).strict(),
  source: z.object({ sheet: z.literal("型谱表明细"), row: z.number().int().positive(),
    familyRow: z.number().int().positive().nullable(), url: z.url().refine(url => {
      const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname === "www.weichaipower.com";
    }) }).strict(),
  issues: z.array(z.enum(["ambiguous_power", "missing_family", "multiple_model_records"])),
}).strict();
export type CatalogRecord = z.infer<typeof catalogRecordSchema>;

export const catalogSnapshotSchema = z.object({
  version: z.literal(1), workbook: z.literal("weichai_engines.xlsx"), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  publicDisplay: z.literal("user_authorized"), evidenceStatus: z.literal("source_reported_unverified"),
  importedOn: z.iso.date(), familyCount: z.number().int(), excludedHeaderRows: z.array(z.number().int()),
  records: z.array(catalogRecordSchema),
}).strict();
export const catalogResultSchema = z.object({
  kind: z.literal("product_catalog"), evidenceStatus: z.literal("source_reported_unverified"),
  query: catalogQuerySchema, total: z.number().int().nonnegative(), modelCount: z.number().int(),
  workbook: z.string(), sha256: z.string(), records: z.array(catalogRecordSchema).max(20),
}).strict();
export type CatalogResult = z.infer<typeof catalogResultSchema>;
