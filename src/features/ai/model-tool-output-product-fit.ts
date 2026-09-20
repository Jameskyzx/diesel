import "server-only";

import { z } from "zod";

import { findCompatibleProductsResultSchema } from "@/features/ai/schemas";
import {
  compactModelToolOutputCitations,
  modelToolOutputEnvelopeSchema,
  modelToolOutputFactSourceClosureMatches,
  modelToolOutputSourceRegistry,
  refineModelToolOutputEnvelope,
  refineModelToolOutputSize,
  SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
  type ModelToolOutputCitation,
} from "@/features/ai/model-tool-output-core";
import {
  applicationScopeSchema,
  iso3Schema,
  isoDateSchema,
  powerKwSchema,
} from "@/features/database/schemas";
import {
  certificationStatusSchema,
  commercialReadinessSchema,
  productFitCheckStatusSchema,
  productFitReasonCodeSchema,
  productFitStatusSchema,
} from "@/features/product-fit/schemas";

const productFitQueryProjectionSchema = findCompatibleProductsResultSchema.shape.query
  .omit({ productModelCode: true })
  .extend({ productModelCode: z.string().trim().min(1).max(100).nullable() })
  .strict();

const productFitCheckProjectionSchema = z
  .object({
    code: productFitReasonCodeSchema,
    status: productFitCheckStatusSchema,
  })
  .strict();

const productProjectionSchema = z
  .object({
    applicationScopes: z.array(applicationScopeSchema).min(1),
    availableFrom: isoDateSchema.nullable(),
    availableTo: isoDateSchema.nullable(),
    id: z.uuid(),
    isDemo: z.boolean(),
    modelCode: z.string().trim().min(1),
    name: z.string().trim().min(1),
    powerMaxKw: z.number().finite().positive(),
    powerMinKw: z.number().finite().nonnegative(),
    sourceId: z.uuid(),
    specificationVersion: z.string().trim().min(1),
  })
  .strict();

const regulationApplicabilityProjectionSchema = z
  .object({
    countryIso3: iso3Schema,
    jurisdiction: z
      .object({
        code: z.string().trim().min(1),
        id: z.uuid(),
        isDemo: z.boolean(),
        name: z.string().trim().min(1),
        sourceId: z.uuid(),
      })
      .strict(),
    membership: z
      .object({
        isDemo: z.boolean(),
        sourceId: z.uuid(),
        validFrom: isoDateSchema,
        validTo: isoDateSchema.nullable(),
      })
      .strict(),
  })
  .strict();

const productRegulationProjectionSchema = z
  .object({
    applicability: regulationApplicabilityProjectionSchema,
    canonicalName: z.string().trim().min(1),
    citationCode: z.string().nullable(),
    effectiveFrom: isoDateSchema.nullable(),
    effectiveTo: isoDateSchema.nullable(),
    isDemo: z.boolean(),
    limitSourceIds: z.array(z.uuid()).min(1),
    recordStatus: z.enum(["effective", "superseded"]),
    regulationId: z.uuid(),
    sourceId: z.uuid(),
    status: z.literal("effective"),
  })
  .strict();

const certificationProjectionSchema = z
  .object({
    applicationScope: applicationScopeSchema,
    certificateNumber: z.string().nullable(),
    id: z.uuid(),
    isDemo: z.boolean(),
    powerMaxKw: z.number().finite().positive().nullable(),
    powerMinKw: z.number().finite().nonnegative().nullable(),
    productId: z.uuid(),
    productModelCode: z.string().trim().min(1),
    regulationId: z.uuid(),
    sourceId: z.uuid(),
    status: certificationStatusSchema,
    validFrom: isoDateSchema.nullable(),
    validTo: isoDateSchema.nullable(),
  })
  .strict();

const certificationCheckProjectionSchema = z
  .object({
    certification: certificationProjectionSchema,
    reasonCodes: z.array(productFitReasonCodeSchema).min(1),
    status: productFitCheckStatusSchema,
  })
  .strict();

const regulationCheckProjectionSchema = z
  .object({
    certifications: z.array(certificationCheckProjectionSchema),
    code: productFitReasonCodeSchema,
    regulation: productRegulationProjectionSchema,
    status: productFitCheckStatusSchema,
  })
  .strict();

const productFitEvaluationProjectionSchema = z
  .object({
    asOf: isoDateSchema,
    commercialReadiness: commercialReadinessSchema,
    input: z
      .object({
        applicationScope: applicationScopeSchema,
        asOf: isoDateSchema,
        countryIso3: iso3Schema,
        powerKw: powerKwSchema,
        productModelCode: z.string().trim().min(1),
      })
      .strict(),
    product: productProjectionSchema.nullable(),
    productChecks: z
      .object({
        applicationScope: productFitCheckProjectionSchema,
        availability: productFitCheckProjectionSchema,
        power: productFitCheckProjectionSchema,
      })
      .strict(),
    reasonCodes: z.array(productFitReasonCodeSchema).min(1),
    regulationChecks: z.array(regulationCheckProjectionSchema),
    rulesetVersion: z.literal("product-fit-v2"),
    status: productFitStatusSchema,
  })
  .strict();

type ProductFitProjectionEvaluation = z.infer<
  typeof productFitEvaluationProjectionSchema
>;

function productFitFactSourceIds(
  evaluations: readonly ProductFitProjectionEvaluation[],
): string[] {
  const sourceIds: string[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.product !== null) sourceIds.push(evaluation.product.sourceId);
    for (const check of evaluation.regulationChecks) {
      sourceIds.push(
        check.regulation.sourceId,
        check.regulation.applicability.jurisdiction.sourceId,
        check.regulation.applicability.membership.sourceId,
        ...check.regulation.limitSourceIds,
      );
      sourceIds.push(
        ...check.certifications.map(
          ({ certification }) => certification.sourceId,
        ),
      );
    }
  }
  return sourceIds;
}

function productFitCitationMatchesFact(
  citation: ModelToolOutputCitation,
  evaluations: readonly ProductFitProjectionEvaluation[],
): boolean {
  for (const evaluation of evaluations) {
    const countryIso3 = evaluation.input.countryIso3;
    if (
      evaluation.product !== null &&
      citation.entityType === "product" &&
      citation.entityId === evaluation.product.id &&
      citation.countryIso3 === countryIso3 &&
      citation.sourceId === evaluation.product.sourceId
    ) {
      return true;
    }
    for (const check of evaluation.regulationChecks) {
      const { regulation } = check;
      if (
        citation.countryIso3 !== countryIso3 ||
        citation.regulationId !== regulation.regulationId
      ) {
        continue;
      }
      if (
        citation.entityType === "regulation" &&
        citation.entityId === regulation.regulationId &&
        citation.sourceId === regulation.sourceId
      ) {
        return true;
      }
      if (
        citation.entityId === regulation.applicability.jurisdiction.id &&
        ((citation.entityType === "jurisdiction" &&
          citation.sourceId === regulation.applicability.jurisdiction.sourceId) ||
          (citation.entityType === "country_jurisdiction" &&
            citation.sourceId === regulation.applicability.membership.sourceId))
      ) {
        return true;
      }
      if (
        citation.entityType === undefined &&
        regulation.limitSourceIds.includes(citation.sourceId)
      ) {
        return true;
      }
      if (
        check.certifications.some(
          ({ certification }) =>
            citation.entityType === "product_certification" &&
            citation.entityId === certification.id &&
            citation.productCertificationId === certification.id &&
            citation.sourceId === certification.sourceId,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function refineProductFitProjection(
  output: {
    citations: readonly ModelToolOutputCitation[];
    evidenceSufficient: boolean;
    evaluations: readonly ProductFitProjectionEvaluation[];
    informationAsOf: string;
    query: z.infer<typeof productFitQueryProjectionSchema>;
    status: "error" | "no_data" | "ok";
  },
  context: z.RefinementCtx,
): void {
  const evidenceExpected =
    output.citations.length > 0 &&
    output.evaluations.length > 0 &&
    output.evaluations.some(({ status }) => status !== "unknown");
  if (
    output.evidenceSufficient !== evidenceExpected ||
    output.status !== (evidenceExpected ? "ok" : output.status === "error" ? "error" : "no_data")
  ) {
    context.addIssue({
      code: "custom",
      message: "Product-fit projection status does not match its facts",
      path: ["status"],
    });
  }
  if (output.informationAsOf !== output.query.asOf) {
    context.addIssue({
      code: "custom",
      message: "Product-fit information date must match its query",
      path: ["informationAsOf"],
    });
  }
  for (const [index, evaluation] of output.evaluations.entries()) {
    const inputMatches =
      evaluation.asOf === output.query.asOf &&
      evaluation.input.asOf === output.query.asOf &&
      evaluation.input.applicationScope === output.query.applicationScope &&
      evaluation.input.countryIso3 === output.query.countryIso3 &&
      evaluation.input.powerKw === output.query.powerKw &&
      (output.query.productModelCode === null ||
        evaluation.input.productModelCode.toUpperCase() ===
          output.query.productModelCode.toUpperCase()) &&
      (evaluation.product === null ||
        evaluation.product.modelCode.toUpperCase() ===
          evaluation.input.productModelCode.toUpperCase());
    if (!inputMatches) {
      context.addIssue({
        code: "custom",
        message: "Product-fit evaluation does not match its query",
        path: ["evaluations", index, "input"],
      });
    }
  }
  if (
    output.citations.some(
      (citation) =>
        !productFitCitationMatchesFact(citation, output.evaluations),
    ) ||
    !modelToolOutputFactSourceClosureMatches(
      productFitFactSourceIds(output.evaluations),
      output.citations,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Product-fit citations do not exactly cover visible facts",
      path: ["citations"],
    });
  }
}

export const compatibleProductsModelToolOutputSchema =
  modelToolOutputEnvelopeSchema
    .extend({
      evaluations: z.array(productFitEvaluationProjectionSchema),
      query: productFitQueryProjectionSchema,
      tool: z.literal("findCompatibleProducts"),
    })
    .strict()
    .superRefine(refineModelToolOutputEnvelope)
    .superRefine(refineProductFitProjection)
    .superRefine(refineModelToolOutputSize);

export function compatibleProductsResultToModelOutput(output: unknown) {
  const result = findCompatibleProductsResultSchema.parse(output);
  const citations = compactModelToolOutputCitations(result.citations);
  return compatibleProductsModelToolOutputSchema.parse({
    citations,
    evidenceSufficient: result.evidenceSufficient,
    evaluations: result.evaluations.map((evaluation) => ({
      asOf: evaluation.asOf,
      commercialReadiness: evaluation.commercialReadiness,
      input: evaluation.input,
      product:
        evaluation.product === null
          ? null
          : {
              applicationScopes: evaluation.product.applicationScopes,
              availableFrom: evaluation.product.availableFrom,
              availableTo: evaluation.product.availableTo,
              id: evaluation.product.id,
              isDemo: evaluation.product.isDemo,
              modelCode: evaluation.product.modelCode,
              name: evaluation.product.name,
              powerMaxKw: evaluation.product.powerMaxKw,
              powerMinKw: evaluation.product.powerMinKw,
              sourceId: evaluation.product.source.id,
              specificationVersion: evaluation.product.specificationVersion,
            },
      productChecks: {
        applicationScope: {
          code: evaluation.productChecks.applicationScope.code,
          status: evaluation.productChecks.applicationScope.status,
        },
        availability: {
          code: evaluation.productChecks.availability.code,
          status: evaluation.productChecks.availability.status,
        },
        power: {
          code: evaluation.productChecks.power.code,
          status: evaluation.productChecks.power.status,
        },
      },
      reasonCodes: evaluation.reasons.map(({ code }) => code),
      regulationChecks: evaluation.regulationChecks.map((check) => ({
        certifications: check.certifications.map((certificationCheck) => ({
          certification: {
            applicationScope:
              certificationCheck.certification.applicationScope,
            certificateNumber:
              certificationCheck.certification.certificateNumber,
            id: certificationCheck.certification.id,
            isDemo: certificationCheck.certification.isDemo,
            powerMaxKw: certificationCheck.certification.powerMaxKw,
            powerMinKw: certificationCheck.certification.powerMinKw,
            productId: certificationCheck.certification.productId,
            productModelCode:
              certificationCheck.certification.productModelCode,
            regulationId: certificationCheck.certification.regulationId,
            sourceId: certificationCheck.certification.source.id,
            status: certificationCheck.certification.status,
            validFrom: certificationCheck.certification.validFrom,
            validTo: certificationCheck.certification.validTo,
          },
          reasonCodes: certificationCheck.reasons.map(({ code }) => code),
          status: certificationCheck.status,
        })),
        code: check.code,
        regulation: {
          applicability: {
            countryIso3: check.regulation.applicability.countryIso3,
            jurisdiction: {
              code: check.regulation.applicability.jurisdiction.code,
              id: check.regulation.applicability.jurisdiction.id,
              isDemo: check.regulation.applicability.jurisdiction.isDemo,
              name: check.regulation.applicability.jurisdiction.name,
              sourceId:
                check.regulation.applicability.jurisdiction.source.id,
            },
            membership: {
              isDemo: check.regulation.applicability.membership.isDemo,
              sourceId: check.regulation.applicability.membership.source.id,
              validFrom: check.regulation.applicability.membership.validFrom,
              validTo: check.regulation.applicability.membership.validTo,
            },
          },
          canonicalName: check.regulation.canonicalName,
          citationCode: check.regulation.citationCode,
          effectiveFrom: check.regulation.effectiveFrom,
          effectiveTo: check.regulation.effectiveTo,
          isDemo: check.regulation.isDemo,
          limitSourceIds: check.regulation.limitSources.map(({ id }) => id),
          recordStatus: check.regulation.recordStatus,
          regulationId: check.regulation.regulationId,
          sourceId: check.regulation.source.id,
          status: check.regulation.status,
        },
        status: check.status,
      })),
      rulesetVersion: evaluation.rulesetVersion,
      status: evaluation.status,
    })),
    informationAsOf: result.informationAsOf,
    latestVerifiedAt: result.latestVerifiedAt,
    projectionVersion: SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
    query: {
      ...result.query,
      productModelCode: result.query.productModelCode ?? null,
    },
    sources: modelToolOutputSourceRegistry(result.citations),
    status: result.status,
    tool: result.tool,
    warnings: result.warnings,
  });
}
