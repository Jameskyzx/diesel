import { z } from "zod";

import {
  applicationScopeSchema,
  httpUrlSchema,
  iso3Schema,
  productFitQuerySchema,
} from "@/features/database/schemas";

const isoTimestampSchema = z.iso.datetime({ offset: true });

export const productFitStatusSchema = z.enum(["fit", "not_fit", "unknown"]);
export const productFitCheckStatusSchema = z.enum(["pass", "fail", "unknown"]);

export const productFitReasonCodeSchema = z.enum([
  "PRODUCT_NOT_FOUND",
  "APPLICATION_SCOPE_MATCH",
  "APPLICATION_SCOPE_MISMATCH",
  "PRODUCT_POWER_MATCH",
  "PRODUCT_POWER_OUT_OF_RANGE",
  "NO_APPLICABLE_REGULATION_DATA",
  "CERTIFICATION_MATCH",
  "CERTIFICATION_MISSING",
  "CERTIFICATION_INACTIVE",
  "CERTIFICATION_STATUS_UNKNOWN",
  "CERTIFICATION_VALIDITY_UNKNOWN",
  "CERTIFICATION_SCOPE_MISMATCH",
  "CERTIFICATION_POWER_RANGE_UNKNOWN",
  "CERTIFICATION_POWER_OUT_OF_RANGE",
  "CERTIFICATION_NOT_YET_VALID",
  "CERTIFICATION_EXPIRED",
]);

export const fitEvidenceSourceSchema = z
  .object({
    id: z.uuid(),
    isDemo: z.boolean(),
    publishedOn: z.iso.date().nullable(),
    title: z.string().trim().min(1),
    url: httpUrlSchema.nullable(),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

export const regulationApplicabilityEvidenceSchema = z
  .object({
    countryIso3: iso3Schema,
    jurisdiction: z
      .object({
        code: z.string().trim().min(1),
        id: z.uuid(),
        isDemo: z.boolean(),
        name: z.string().trim().min(1),
        source: fitEvidenceSourceSchema,
        verifiedAt: isoTimestampSchema,
      })
      .strict(),
    membership: z
      .object({
        isDemo: z.boolean(),
        source: fitEvidenceSourceSchema,
        validFrom: z.iso.date(),
        validTo: z.iso.date().nullable(),
        verifiedAt: isoTimestampSchema,
      })
      .strict(),
  })
  .strict();

export const productSummarySchema = z
  .object({
    applicationScopes: z.array(applicationScopeSchema).min(1),
    availableFrom: z.iso.date().nullable(),
    availableTo: z.iso.date().nullable(),
    id: z.uuid(),
    isDemo: z.boolean(),
    modelCode: z.string().trim().min(1),
    name: z.string().trim().min(1),
    powerMaxKw: z.number().finite().positive(),
    powerMinKw: z.number().finite().nonnegative(),
    source: fitEvidenceSourceSchema,
    specificationVersion: z.string().trim().min(1),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

export const certificationEvidenceSchema = z
  .object({
    applicationScope: applicationScopeSchema,
    certificateNumber: z.string().nullable(),
    id: z.uuid(),
    isDemo: z.boolean(),
    powerMaxKw: z.number().finite().positive().nullable(),
    powerMinKw: z.number().finite().nonnegative().nullable(),
    regulationId: z.uuid(),
    source: fitEvidenceSourceSchema,
    status: z.enum(["pending", "active", "expired", "withdrawn", "unknown"]),
    validFrom: z.iso.date().nullable(),
    validTo: z.iso.date().nullable(),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

export const regulationEvidenceSchema = z
  .object({
    applicability: regulationApplicabilityEvidenceSchema,
    canonicalName: z.string().trim().min(1),
    citationCode: z.string().nullable(),
    effectiveFrom: z.iso.date().nullable(),
    effectiveTo: z.iso.date().nullable(),
    isDemo: z.boolean(),
    limitSources: z.array(fitEvidenceSourceSchema).min(1),
    recordStatus: z.enum(["effective", "superseded"]),
    regulationId: z.uuid(),
    source: fitEvidenceSourceSchema,
    status: z.literal("effective"),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

const productCheckSchema = z
  .object({
    code: productFitReasonCodeSchema,
    message: z.string().trim().min(1),
    status: productFitCheckStatusSchema,
  })
  .strict();

const certificationCheckSchema = z
  .object({
    certification: certificationEvidenceSchema,
    reasons: z.array(productCheckSchema).min(1),
    status: productFitCheckStatusSchema,
  })
  .strict();

const regulationCheckSchema = z
  .object({
    certifications: z.array(certificationCheckSchema),
    code: productFitReasonCodeSchema,
    message: z.string().trim().min(1),
    regulation: regulationEvidenceSchema,
    status: productFitCheckStatusSchema,
  })
  .strict();

export const productFitEvaluationSchema = z
  .object({
    asOf: z.iso.date(),
    input: productFitQuerySchema,
    product: productSummarySchema.nullable(),
    productChecks: z
      .object({
        applicationScope: productCheckSchema,
        power: productCheckSchema,
      })
      .strict(),
    reasons: z.array(productCheckSchema).min(1),
    regulationChecks: z.array(regulationCheckSchema),
    rulesetVersion: z.literal("product-fit-v1"),
    sources: z.array(fitEvidenceSourceSchema),
    status: productFitStatusSchema,
  })
  .strict();

export const productListResponseSchema = z
  .object({
    products: z.array(productSummarySchema),
    status: z.literal("ok"),
  })
  .strict();

export const productFitApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum([
          "INVALID_INPUT",
          "PAYLOAD_TOO_LARGE",
          "INTERNAL_ERROR",
        ]),
        message: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export type CertificationEvidence = z.infer<
  typeof certificationEvidenceSchema
>;
export type FitEvidenceSource = z.infer<typeof fitEvidenceSourceSchema>;
export type ProductFitEvaluation = z.infer<
  typeof productFitEvaluationSchema
>;
export type ProductListResponse = z.infer<typeof productListResponseSchema>;
export type ProductSummary = z.infer<typeof productSummarySchema>;
export type RegulationEvidence = z.infer<typeof regulationEvidenceSchema>;
