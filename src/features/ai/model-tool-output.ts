import "server-only";

import { z } from "zod";

import { marketComparisonIssues, marketComparisonStatus } from "@/domain/marketing/comparison-consistency";

import {
  KNOWLEDGE_DEMO_WARNING,
  KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING,
  KNOWLEDGE_TOOL_EXECUTION_FAILURE_WARNING,
} from "@/domain/knowledge/search-consistency";
import {
  calculateProductReadiness,
  calculateRegulatoryCoverage,
  combineOpportunityScore,
  countryOpportunityScoreMatchesMath,
  normalizeComparableMetric,
} from "@/domain/marketing/opportunity-score";
import {
  calculateOpportunityScoreResultSchema,
  generateSalesBriefResultSchema,
} from "@/features/ai/schemas";
import { citationLocatorDescriptorSchema } from "@/features/ai/citation-locator";
import { citationTitleDescriptorSchema } from "@/features/ai/citation-title";
import {
  citationHasPairedEntityIdentity,
  evidenceEntityTypes,
  latestVerifiedAtFromCitations,
} from "@/features/ai/evidence-semantics";
import {
  applicationScopeSchema,
  httpUrlSchema,
  iso3Schema,
  isoDateSchema,
  powerKwSchema,
} from "@/features/database/schemas";
import { opportunityMetricDirection } from "@/features/marketing/opportunity-score-registry";
import {
  marketMetricComparisonSchema,
  metricCodeSchema,
  opportunityScorecardSchema,
  regulationComparisonItemSchema,
  salesBriefSchema,
} from "@/features/marketing/schemas";
import {
  certificationStatusSchema,
  commercialReadinessSchema,
  productFitCheckStatusSchema,
  productFitReasonCodeSchema,
  productFitStatusSchema,
} from "@/features/product-fit/schemas";
import { opportunityScoreGapWarning } from "@/features/ai/tool-result-envelope";
import { getOpportunityScoreWeights } from "@/server/config/opportunity-score-config";
import {
  SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES,
  SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
} from "@/features/ai/model-tool-output-core";

export {
  SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES,
  SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
} from "@/features/ai/model-tool-output-core";

const compactCitationSchema = z
  .object({
    countryIso3: iso3Schema.optional(),
    entityId: z.uuid().optional(),
    entityType: z.enum(evidenceEntityTypes).optional(),
    locator: z.string().trim().min(1).optional(),
    locatorDescriptor: citationLocatorDescriptorSchema.optional(),
    regulationId: z.uuid().optional(),
    sourceId: z.uuid(),
    title: z.string().trim().min(1).optional(),
    titleDescriptor: citationTitleDescriptorSchema.optional(),
  })
  .strict()
  .superRefine((citation, context) => {
    if (!citationHasPairedEntityIdentity(citation)) {
      context.addIssue({
        code: "custom",
        message: "Citation entityType and entityId must appear together",
        path: ["entityId"],
      });
    }
    if (citation.title === undefined && citation.titleDescriptor === undefined) {
      context.addIssue({
        code: "custom",
        message: "Citation requires an original title or typed title descriptor",
        path: ["title"],
      });
    }
  });

const compactEvidenceSourceSchema = z
  .object({
    id: z.uuid(),
    isDemo: z.boolean(),
    title: z.string().trim().min(1),
    url: httpUrlSchema.nullable(),
    verifiedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const modelToolOutputBaseSchema = z
  .object({
    citations: z.array(compactCitationSchema),
    evidenceSufficient: z.boolean(),
    informationAsOf: isoDateSchema,
    latestVerifiedAt: z.iso.datetime({ offset: true }).nullable(),
    projectionVersion: z.literal(SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION),
    sources: z.array(compactEvidenceSourceSchema),
    status: z.enum(["ok", "no_data", "error"]),
    warnings: z.array(z.string()),
  })
  .strict();

const compactAnalysisQuerySchema = opportunityScorecardSchema.shape.query
  .omit({ metricCodes: true, productModelCode: true })
  .extend({
    metricCodes: z.array(metricCodeSchema).max(8),
    productModelCode: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

const compactBriefQuerySchema = compactAnalysisQuerySchema
  .extend({ targetCountryIso3: iso3Schema })
  .superRefine((query, context) => {
    if (!query.countryIso3s.includes(query.targetCountryIso3)) {
      context.addIssue({
        code: "custom",
        message: "targetCountryIso3 must be included in countryIso3s",
        path: ["targetCountryIso3"],
      });
    }
  });

const compactScorecardSchema = opportunityScorecardSchema
  .pick({
    rulesetVersion: true,
    scores: true,
    weights: true,
  })
  .extend({ query: compactAnalysisQuerySchema })
  .strict();

const compactSalesBriefSchema = salesBriefSchema
  .pick({
    gaps: true,
    marketScore: true,
    opportunities: true,
    risks: true,
    salesActions: true,
  })
  .extend({
    query: compactBriefQuerySchema,
    recommendedProducts: z.array(
      salesBriefSchema.shape.recommendedProducts.element.pick({ id: true }),
    ),
  })
  .strict();

const compactMarketObservationSchema = marketMetricComparisonSchema.shape
  .observations.element.pick({
    applicationScope: true,
    countryIso3: true,
    currencyCode: true,
    definition: true,
    id: true,
    isDemo: true,
    methodologyVersion: true,
    periodEnd: true,
    periodStart: true,
    unitCode: true,
    valueNumeric: true,
  })
  .extend({ sourceId: z.uuid() })
  .strict();

const compactMarketMetricSchema = marketMetricComparisonSchema
  .pick({
    comparisonStatus: true,
    issues: true,
    metricCode: true,
    metricName: true,
  })
  .extend({ observations: z.array(compactMarketObservationSchema) })
  .strict();

const compactProductSchema = z
  .object({
    availableFrom: isoDateSchema.nullable(),
    availableTo: isoDateSchema.nullable(),
    id: z.uuid(),
    modelCode: z.string().trim().min(1),
    name: z.string().trim().min(1),
    sourceId: z.uuid(),
    specificationVersion: z.string().trim().min(1),
  })
  .strict()
  .superRefine((product, context) => {
    if (product.availableTo !== null && product.availableFrom === null) {
      context.addIssue({
        code: "custom",
        message: "availableFrom is required when availableTo is set",
        path: ["availableFrom"],
      });
    }
    if (
      product.availableFrom !== null &&
      product.availableTo !== null &&
      product.availableTo <= product.availableFrom
    ) {
      context.addIssue({
        code: "custom",
        message: "availableTo must be after availableFrom",
        path: ["availableTo"],
      });
    }
  });

const compactProductCheckSchema = z
  .object({
    code: productFitReasonCodeSchema,
    status: productFitCheckStatusSchema,
  })
  .strict();

const compactCertificationCheckSchema = z
  .object({
    certificateNumber: z.string().trim().min(1).nullable(),
    certificationId: z.uuid(),
    reasonCodes: z.array(productFitReasonCodeSchema),
    status: productFitCheckStatusSchema,
    certificationStatus: certificationStatusSchema,
    sourceId: z.uuid(),
  })
  .strict();

const compactProductRegulationCheckSchema = z
  .object({
    certifications: z.array(compactCertificationCheckSchema),
    code: productFitReasonCodeSchema,
    regulationId: z.uuid(),
    status: productFitCheckStatusSchema,
  })
  .strict();

const compactProductEvaluationSchema = z
  .object({
    applicationScope: applicationScopeSchema,
    asOf: isoDateSchema,
    commercialReadiness: commercialReadinessSchema,
    countryIso3: iso3Schema,
    product: compactProductSchema.nullable(),
    productModelCode: z.string().trim().min(1),
    powerKw: powerKwSchema,
    productChecks: z
      .object({
        applicationScope: compactProductCheckSchema,
        availability: compactProductCheckSchema,
        power: compactProductCheckSchema,
      })
      .strict(),
    reasonCodes: z.array(productFitReasonCodeSchema).min(1),
    regulationChecks: z.array(compactProductRegulationCheckSchema),
    status: productFitStatusSchema,
  })
  .strict();

const compactRegulationSchema = regulationComparisonItemSchema
  .pick({
    canonicalName: true,
    citationCode: true,
    effectiveFrom: true,
    effectiveTo: true,
    id: true,
    recordStatus: true,
    status: true,
  })
  .extend({
    applicability: z
      .object({
        countryIso3: iso3Schema,
        jurisdiction: z
          .object({
            code: z.string().trim().min(1),
            id: z.uuid(),
            name: z.string().trim().min(1),
            sourceId: z.uuid(),
          })
          .strict(),
        membership: z
          .object({
            sourceId: z.uuid(),
            validFrom: isoDateSchema,
            validTo: isoDateSchema.nullable(),
          })
          .strict(),
      })
      .strict(),
    bucket: z.enum(["current_effective", "future_adopted"]),
    sourceId: z.uuid(),
  })
  .strict();

function boundedDigestCollectionSchema<TItem extends z.ZodType>(
  itemSchema: TItem,
  maximumItems: number,
) {
  return z
    .object({
      complete: z.boolean(),
      items: z.array(itemSchema).max(maximumItems),
      omittedCount: z.number().int().nonnegative(),
      totalCount: z.number().int().nonnegative(),
    })
    .strict()
    .superRefine((collection, context) => {
      if (
        collection.totalCount !==
          collection.items.length + collection.omittedCount ||
        collection.complete !== (collection.omittedCount === 0) ||
        (!collection.complete && collection.items.length !== maximumItems)
      ) {
        context.addIssue({
          code: "custom",
          message: "Digest collection counts are inconsistent",
        });
      }
    });
}

const modelEvidenceDigestSchema = z
  .object({
    marketMetrics: boundedDigestCollectionSchema(
      compactMarketMetricSchema,
      8,
    ),
    productEvaluations: boundedDigestCollectionSchema(
      compactProductEvaluationSchema,
      125,
    ),
    regulations: boundedDigestCollectionSchema(compactRegulationSchema, 250),
  })
  .strict();

function citationCoversEntity(
  citations: z.infer<typeof compactCitationSchema>[],
  entityType: (typeof evidenceEntityTypes)[number],
  entityId: string,
  countryIso3: string,
): boolean {
  return citations.some(
    (citation) =>
      citation.entityType === entityType &&
      citation.entityId === entityId &&
      citation.countryIso3 === countryIso3,
  );
}

type ModelEvidenceDigest = z.infer<typeof modelEvidenceDigestSchema>;
type ModelQuery = z.infer<typeof compactScorecardSchema>["query"];
type ModelScore = z.infer<typeof compactScorecardSchema>["scores"][number];
type ModelWeights = z.infer<typeof compactScorecardSchema>["weights"];

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function weightsMatchRuntime(weights: ModelWeights): boolean {
  try {
    return exactJson(weights, getOpportunityScoreWeights());
  } catch {
    return false;
  }
}

function digestIsComplete(digest: ModelEvidenceDigest): boolean {
  return (
    digest.marketMetrics.complete &&
    digest.productEvaluations.complete &&
    digest.regulations.complete
  );
}

function weightsFromScore(score: ModelScore): ModelWeights | null {
  const byKey = new Map(
    score.components.map(({ configuredWeight, key }) => [
      key,
      configuredWeight,
    ]),
  );
  if (byKey.size !== 3) return null;
  const marketPotential = byKey.get("marketPotential");
  const productReadiness = byKey.get("productReadiness");
  const regulatoryCoverage = byKey.get("regulatoryCoverage");
  if (
    marketPotential === undefined ||
    productReadiness === undefined ||
    regulatoryCoverage === undefined
  ) {
    return null;
  }
  return { marketPotential, productReadiness, regulatoryCoverage };
}

function expectedScoreFromDigest(input: {
  countryIso3: string;
  digest: ModelEvidenceDigest;
  query: ModelQuery;
  weights: ModelWeights;
}): ModelScore {
  const marketScores: number[] = [];
  for (const metric of input.digest.marketMetrics.items) {
    const direction = opportunityMetricDirection(metric.metricCode);
    if (metric.comparisonStatus !== "comparable" || direction === null) {
      continue;
    }
    const normalized = normalizeComparableMetric(
      metric.observations.map(({ countryIso3, valueNumeric }) => ({
        countryIso3,
        value: valueNumeric,
      })),
      direction,
    );
    const score = normalized.get(input.countryIso3);
    if (score !== undefined) marketScores.push(score);
  }

  const evaluations = input.digest.productEvaluations.items.filter(
    ({ countryIso3 }) => countryIso3 === input.countryIso3,
  );
  const components = {
    marketPotential:
      marketScores.length === 0
        ? null
        : marketScores.reduce((sum, score) => sum + score, 0) /
          marketScores.length,
    productReadiness: calculateProductReadiness(
      evaluations.map(({ commercialReadiness }) => commercialReadiness),
    ),
    regulatoryCoverage: calculateRegulatoryCoverage(
      evaluations.flatMap(({ regulationChecks }) =>
        regulationChecks.map(({ regulationId, status }) => ({
          regulationId,
          status,
        })),
      ),
    ),
  };
  const unknownCount = evaluations.filter(
    ({ commercialReadiness }) => commercialReadiness === "unknown",
  ).length;
  const unsupportedMetricCodes = input.digest.marketMetrics.items.flatMap(
    ({ metricCode }) =>
      opportunityMetricDirection(metricCode) === null ? [metricCode] : [],
  );
  const gaps: ModelScore["gaps"] = [
    ...(components.marketPotential === null
      ? [{ code: "MARKET_DATA_UNAVAILABLE" as const }]
      : []),
    ...(components.productReadiness === null
      ? [{ code: "PRODUCT_DATA_UNAVAILABLE" as const }]
      : []),
    ...(components.regulatoryCoverage === null
      ? [{ code: "REGULATORY_DATA_UNAVAILABLE" as const }]
      : []),
    ...(unknownCount > 0
      ? [
          {
            code: "PRODUCT_READINESS_UNKNOWN" as const,
            count: unknownCount,
          },
        ]
      : []),
    ...(unsupportedMetricCodes.length > 0
      ? [
          {
            code: "UNSUPPORTED_METRIC_DIRECTION" as const,
            metricCodes: unsupportedMetricCodes,
          },
        ]
      : []),
  ];
  return combineOpportunityScore({
    components: [
      { key: "marketPotential", score: components.marketPotential },
      { key: "productReadiness", score: components.productReadiness },
      { key: "regulatoryCoverage", score: components.regulatoryCoverage },
    ],
    countryIso3: input.countryIso3,
    gaps,
    weights: input.weights,
  });
}

function productEvaluationMatchesQuery(
  evaluation: ModelEvidenceDigest["productEvaluations"]["items"][number],
  query: ModelQuery,
): boolean {
  const productModelMatches =
    query.productModelCode === null
      ? evaluation.product !== null &&
        evaluation.productModelCode === evaluation.product.modelCode
      : evaluation.productModelCode === query.productModelCode &&
        (evaluation.product === null ||
          evaluation.product.modelCode === query.productModelCode);
  return (
    evaluation.applicationScope === query.applicationScope &&
    evaluation.asOf === query.asOf &&
    evaluation.powerKw === query.powerKw &&
    query.countryIso3s.includes(evaluation.countryIso3) &&
    productModelMatches
  );
}

function regulationMatchesQuery(
  regulation: ModelEvidenceDigest["regulations"]["items"][number],
  query: ModelQuery,
): boolean {
  const { membership } = regulation.applicability;
  const membershipApplies =
    membership.validFrom <= query.asOf &&
    (membership.validTo === null || membership.validTo > query.asOf);
  const effectiveApplies =
    regulation.effectiveFrom !== null &&
    regulation.effectiveFrom <= query.asOf &&
    (regulation.effectiveTo === null || regulation.effectiveTo > query.asOf);
  const validEffectiveRange =
    regulation.effectiveTo === null ||
    (regulation.effectiveFrom !== null &&
      regulation.effectiveTo > regulation.effectiveFrom);
  return (
    query.countryIso3s.includes(regulation.applicability.countryIso3) &&
    membershipApplies &&
    validEffectiveRange &&
    (regulation.recordStatus !== "superseded" ||
      regulation.effectiveTo !== null) &&
    (regulation.bucket === "current_effective"
      ? regulation.status === "effective" &&
        regulation.recordStatus !== "adopted" &&
        effectiveApplies
      : regulation.status === "adopted" && !effectiveApplies)
  );
}

function citationMatchesSource(
  citation: z.infer<typeof compactCitationSchema>,
  sourceId: string,
): boolean {
  return citation.sourceId === sourceId;
}

function citationMatchesDigest(
  citation: z.infer<typeof compactCitationSchema>,
  digest: ModelEvidenceDigest,
): boolean {
  if (citation.entityType === undefined || citation.entityId === undefined) {
    return false;
  }
  if (citation.entityType === "market_metric") {
    for (const metric of digest.marketMetrics.items) {
      const observation = metric.observations.find(
        ({ countryIso3, id }) =>
          countryIso3 === citation.countryIso3 && id === citation.entityId,
      );
      if (!observation) continue;
      return (
        citationMatchesSource(citation, observation.sourceId) &&
        citation.regulationId === undefined &&
        citation.locator === undefined &&
        citation.title === undefined &&
        exactJson(citation.locatorDescriptor, {
          kind: "market_period",
          periodEnd: observation.periodEnd,
          periodStart: observation.periodStart,
        }) &&
        exactJson(citation.titleDescriptor, {
          isDemo: observation.isDemo,
          kind: "market_metric",
          metricCode: metric.metricCode,
          metricId: observation.id,
          metricName: metric.metricName,
        })
      );
    }
    return false;
  }
  if (citation.entityType === "product") {
    const evaluation = digest.productEvaluations.items.find(
      ({ countryIso3, product }) =>
        countryIso3 === citation.countryIso3 &&
        product?.id === citation.entityId,
    );
    const product = evaluation?.product;
    return (
      product !== null &&
      product !== undefined &&
      citation.regulationId === undefined &&
      citationMatchesSource(citation, product.sourceId) &&
      citation.title === product.name &&
      citation.titleDescriptor === undefined &&
      citation.locator === undefined &&
      exactJson(citation.locatorDescriptor, {
        availableFrom: product.availableFrom,
        availableTo: product.availableTo,
        kind: "product_availability",
        modelCode: product.modelCode,
        specificationVersion: product.specificationVersion,
      })
    );
  }
  if (citation.entityType === "product_certification") {
    for (const evaluation of digest.productEvaluations.items) {
      if (evaluation.countryIso3 !== citation.countryIso3) continue;
      for (const check of evaluation.regulationChecks) {
        if (
          check.regulationId === citation.regulationId &&
          check.certifications.some(
            ({ certificationId }) => certificationId === citation.entityId,
          )
        ) {
          const certification = check.certifications.find(
            ({ certificationId }) => certificationId === citation.entityId,
          )!;
          if (!citationMatchesSource(citation, certification.sourceId)) {
            return false;
          }
          return certification.certificateNumber === null
            ? citation.title === undefined &&
                citation.locator === undefined &&
                citation.locatorDescriptor === undefined &&
                exactJson(citation.titleDescriptor, {
                  kind: "product_certification_record",
                  productModelCode: evaluation.productModelCode,
                })
            : citation.title === certification.certificateNumber &&
                citation.locator === certification.certificateNumber &&
                citation.titleDescriptor === undefined &&
                citation.locatorDescriptor === undefined;
        }
      }
    }
    return false;
  }
  if (citation.entityType === "regulation") {
    const regulation = digest.regulations.items.find(
      ({ applicability, id }) =>
        applicability.countryIso3 === citation.countryIso3 &&
        id === citation.entityId,
    );
    return (
      regulation !== undefined &&
      citation.regulationId === regulation.id &&
      citationMatchesSource(citation, regulation.sourceId) &&
      citation.title === regulation.canonicalName &&
      citation.titleDescriptor === undefined &&
      citation.locatorDescriptor === undefined &&
      citation.locator === (regulation.citationCode ?? undefined)
    );
  }
  if (
    citation.entityType === "jurisdiction" ||
    citation.entityType === "country_jurisdiction"
  ) {
    const regulation = digest.regulations.items.find(
      ({ applicability, id }) =>
        applicability.countryIso3 === citation.countryIso3 &&
        applicability.jurisdiction.id === citation.entityId &&
        id === citation.regulationId,
    );
    if (!regulation) return false;
    if (citation.entityType === "jurisdiction") {
      return (
        citationMatchesSource(
          citation,
          regulation.applicability.jurisdiction.sourceId,
        ) &&
        citation.locator === regulation.applicability.jurisdiction.code &&
        citation.locatorDescriptor === undefined &&
        citation.title === regulation.applicability.jurisdiction.name &&
        citation.titleDescriptor === undefined
      );
    }
    return (
      citationMatchesSource(
        citation,
        regulation.applicability.membership.sourceId,
      ) &&
      citation.locator === undefined &&
      citation.title === undefined &&
      exactJson(citation.locatorDescriptor, {
        kind: "membership_period",
        validFrom: regulation.applicability.membership.validFrom,
        validTo: regulation.applicability.membership.validTo,
      }) &&
      exactJson(citation.titleDescriptor, {
        countryIso3: regulation.applicability.countryIso3,
        jurisdictionName: regulation.applicability.jurisdiction.name,
        kind: "country_jurisdiction_membership",
      })
    );
  }
  return false;
}

function briefMatchesDigest(
  brief: z.infer<typeof compactSalesBriefSchema>,
  digest: ModelEvidenceDigest,
): boolean {
  const weights = weightsFromScore(brief.marketScore);
  if (!weights) return false;
  const expectedScore = expectedScoreFromDigest({
    countryIso3: brief.query.targetCountryIso3,
    digest,
    query: brief.query,
    weights,
  });
  const targetEvaluations = digest.productEvaluations.items.filter(
    ({ countryIso3 }) => countryIso3 === brief.query.targetCountryIso3,
  );
  const recommendedProductIds = targetEvaluations.flatMap((evaluation) =>
    evaluation.product !== null &&
    evaluation.status === "fit" &&
    evaluation.commercialReadiness === "ready"
      ? [evaluation.product.id]
      : [],
  );
  const productIds = (status: "fit" | "not_fit" | "unknown") =>
    targetEvaluations.flatMap((evaluation) =>
      evaluation.product !== null && evaluation.status === status
        ? [evaluation.product.id]
        : [],
    );
  const unavailableFitProductIds = targetEvaluations.flatMap((evaluation) =>
    evaluation.product !== null &&
    evaluation.status === "fit" &&
    evaluation.productChecks.availability.status === "fail"
      ? [evaluation.product.id]
      : [],
  );
  const availabilityUnknownFitProductIds = targetEvaluations.flatMap(
    (evaluation) =>
      evaluation.product !== null &&
      evaluation.status === "fit" &&
      evaluation.productChecks.availability.status === "unknown"
        ? [evaluation.product.id]
        : [],
  );
  const futureRegulationIds = digest.regulations.items.flatMap((regulation) =>
    regulation.applicability.countryIso3 === brief.query.targetCountryIso3 &&
    regulation.bucket === "future_adopted"
      ? [regulation.id]
      : [],
  );
  const contributingMetricCodes = digest.marketMetrics.items.flatMap(
    ({ comparisonStatus, metricCode }) =>
      comparisonStatus === "comparable" &&
      opportunityMetricDirection(metricCode) !== null
        ? [metricCode]
        : [],
  );
  const marketComponent = brief.marketScore.components.find(
    ({ key }) => key === "marketPotential",
  );
  const expectedOpportunities = [
    ...(marketComponent?.score !== null &&
    marketComponent?.score !== undefined &&
    marketComponent.score >= 50 &&
    contributingMetricCodes.length > 0
      ? [
          {
            metricCodes: contributingMetricCodes,
            ruleCode: "MARKET_POTENTIAL_AT_LEAST_50" as const,
          },
        ]
      : []),
    ...(recommendedProductIds.length > 0
      ? [
          {
            productIds: recommendedProductIds,
            ruleCode: "READY_PRODUCTS_AVAILABLE" as const,
          },
        ]
      : []),
  ];
  const expectedRisks = [
    ...(futureRegulationIds.length > 0
      ? [
          {
            regulationIds: futureRegulationIds,
            ruleCode: "FUTURE_ADOPTED_REGULATION" as const,
          },
        ]
      : []),
    ...(productIds("not_fit").length > 0
      ? [
          {
            productIds: productIds("not_fit"),
            ruleCode: "PRODUCTS_NOT_FIT" as const,
          },
        ]
      : []),
    ...(productIds("unknown").length > 0
      ? [
          {
            productIds: productIds("unknown"),
            ruleCode: "PRODUCT_EVIDENCE_UNKNOWN" as const,
          },
        ]
      : []),
    ...(unavailableFitProductIds.length > 0
      ? [
          {
            productIds: unavailableFitProductIds,
            ruleCode: "FIT_PRODUCTS_UNAVAILABLE" as const,
          },
        ]
      : []),
    ...(availabilityUnknownFitProductIds.length > 0
      ? [
          {
            productIds: availabilityUnknownFitProductIds,
            ruleCode: "FIT_PRODUCTS_AVAILABILITY_UNKNOWN" as const,
          },
        ]
      : []),
  ];
  const expectedActions = [
    ...(recommendedProductIds.length > 0
      ? [
          {
            priority: "high" as const,
            productIds: recommendedProductIds,
            ruleCode: "PREPARE_PRODUCT_EVIDENCE_PACK" as const,
          },
        ]
      : []),
    ...(futureRegulationIds.length > 0
      ? [
          {
            priority: "high" as const,
            regulationIds: futureRegulationIds,
            ruleCode: "REVALIDATE_BEFORE_FUTURE_REGULATION" as const,
          },
        ]
      : []),
    ...(brief.gaps.length > 0
      ? [
          {
            missingDataIndexes: brief.gaps.map((_, index) => index),
            priority: "medium" as const,
            ruleCode: "RESOLVE_MISSING_DATA_BEFORE_COMMITMENT" as const,
          },
        ]
      : []),
  ];
  return (
    brief.marketScore.countryIso3 === brief.query.targetCountryIso3 &&
    countryOpportunityScoreMatchesMath(brief.marketScore, weights) &&
    exactJson(brief.marketScore, expectedScore) &&
    exactJson(brief.gaps, brief.marketScore.gaps) &&
    exactJson(
      brief.recommendedProducts,
      recommendedProductIds.map((id) => ({ id })),
    ) &&
    exactJson(brief.opportunities, expectedOpportunities) &&
    exactJson(brief.risks, expectedRisks) &&
    exactJson(brief.salesActions, expectedActions)
  );
}

function refineModelEvidenceDigest(
  output: {
    brief?: z.infer<typeof compactSalesBriefSchema>;
    citations: z.infer<typeof compactCitationSchema>[];
    evidenceDigest: z.infer<typeof modelEvidenceDigestSchema>;
    evidenceSufficient: boolean;
    informationAsOf: string;
    latestVerifiedAt: string | null;
    scorecard?: z.infer<typeof compactScorecardSchema>;
    sources: z.infer<typeof compactEvidenceSourceSchema>[];
    status: "error" | "no_data" | "ok";
    warnings: string[];
  },
  context: z.RefinementCtx,
): void {
  const query = output.scorecard?.query ?? output.brief?.query;
  if (!query) {
    context.addIssue({ code: "custom", message: "Projection query is missing" });
    return;
  }
  if (output.informationAsOf !== query.asOf) {
    context.addIssue({
      code: "custom",
      message: "Projection query date must match informationAsOf",
      path: ["informationAsOf"],
    });
  }
  if (output.status === "error") {
    if (
      output.citations.length !== 0 ||
      output.sources.length !== 0 ||
      output.latestVerifiedAt !== null ||
      !exactJson(output.warnings, [KNOWLEDGE_TOOL_EXECUTION_FAILURE_WARNING]) ||
      [
        output.evidenceDigest.marketMetrics,
        output.evidenceDigest.productEvaluations,
        output.evidenceDigest.regulations,
      ].some(
        (collection) =>
          !collection.complete ||
          collection.items.length !== 0 ||
          collection.omittedCount !== 0 ||
          collection.totalCount !== 0,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Failed tool projections must use the canonical no-facts envelope",
        path: ["evidenceDigest"],
      });
    }
    const errorWeights = output.scorecard?.weights ??
      (output.brief ? weightsFromScore(output.brief.marketScore) : null);
    if (errorWeights === null) {
      context.addIssue({
        code: "custom",
        message: "Failed tool projection has invalid score weights",
      });
      return;
    }
    const failedScore = (countryIso3: string) =>
      combineOpportunityScore({
        components: [
          { key: "marketPotential", score: null },
          { key: "productReadiness", score: null },
          { key: "regulatoryCoverage", score: null },
        ],
        countryIso3,
        gaps: [{ code: "TOOL_EXECUTION_FAILED" }],
        weights: errorWeights,
      });
    if (
      output.scorecard &&
      !exactJson(
        output.scorecard.scores,
        query.countryIso3s.map(failedScore),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Failed score projection is not canonical",
        path: ["scorecard", "scores"],
      });
    }
    if (
      output.brief &&
      (!exactJson(
        output.brief.marketScore,
        failedScore(output.brief.query.targetCountryIso3),
      ) ||
        !exactJson(output.brief.gaps, [
          { code: "TOOL_EXECUTION_FAILED" },
        ]) ||
        output.brief.recommendedProducts.length !== 0 ||
        output.brief.opportunities.length !== 0 ||
        output.brief.risks.length !== 0 ||
        output.brief.salesActions.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Failed sales-brief projection is not canonical",
        path: ["brief"],
      });
    }
    return;
  }
  if (!digestIsComplete(output.evidenceDigest)) {
    context.addIssue({
      code: "custom",
      message: "Model projections require a complete replayable evidence digest",
      path: ["evidenceDigest"],
    });
    return;
  }
  const queryCountries = new Set(query.countryIso3s);
  const queryMetricCodes = new Set(query.metricCodes);
  const metricItems = output.evidenceDigest.marketMetrics.items;
  const productItems = output.evidenceDigest.productEvaluations.items;
  const regulationItems = output.evidenceDigest.regulations.items;

  const sourceIds = output.sources.map(({ id }) => id);
  const referencedSourceIds = [
    ...output.citations.map(({ sourceId }) => sourceId),
    ...metricItems.flatMap(({ observations }) =>
      observations.map(({ sourceId }) => sourceId),
    ),
    ...productItems.flatMap((evaluation) => [
      ...(evaluation.product ? [evaluation.product.sourceId] : []),
      ...evaluation.regulationChecks.flatMap(({ certifications }) =>
        certifications.map(({ sourceId }) => sourceId),
      ),
    ]),
    ...regulationItems.flatMap(({ applicability, sourceId }) => [
      sourceId,
      applicability.jurisdiction.sourceId,
      applicability.membership.sourceId,
    ]),
  ];
  if (
    new Set(sourceIds).size !== sourceIds.length ||
    referencedSourceIds.some((sourceId) => !sourceIds.includes(sourceId)) ||
    sourceIds.some((sourceId) => !referencedSourceIds.includes(sourceId))
  ) {
    context.addIssue({
      code: "custom",
      message: "Projection source registry must exactly cover visible facts",
      path: ["sources"],
    });
  }
  if (
    output.latestVerifiedAt !== latestVerifiedAtFromCitations(output.sources)
  ) {
    context.addIssue({
      code: "custom",
      message: "Projection freshness must match the source registry",
      path: ["latestVerifiedAt"],
    });
  }
  const expectedEvidenceSufficient = output.scorecard
    ? output.citations.length > 0 &&
      output.scorecard.scores.filter(
        ({ overallScore }) => overallScore !== null,
      ).length >= 2
    : output.brief !== undefined &&
      output.citations.length > 0 &&
      (output.brief.marketScore.overallScore !== null ||
        output.brief.recommendedProducts.length > 0);
  const projectedGaps = output.scorecard
    ? output.scorecard.scores.flatMap((score) =>
        score.gaps.map((gap) =>
          opportunityScoreGapWarning(gap, score.countryIso3),
        ),
      )
    : (output.brief?.gaps ?? []).map((gap) =>
        opportunityScoreGapWarning(
          gap,
          output.brief!.marketScore.countryIso3,
        ),
      );
  const expectedWarnings = [
    ...(expectedEvidenceSufficient
      ? []
      : [KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING]),
    ...projectedGaps,
    ...(output.sources.some(({ isDemo }) => isDemo)
      ? [KNOWLEDGE_DEMO_WARNING]
      : []),
  ];
  if (
    output.evidenceSufficient !== expectedEvidenceSufficient ||
    output.status !== (expectedEvidenceSufficient ? "ok" : "no_data") ||
    !exactJson(output.warnings, expectedWarnings)
  ) {
    context.addIssue({
      code: "custom",
      message: "Projection status and warnings must replay from visible facts",
      path: ["status"],
    });
  }

  const duplicateKeys = (keys: readonly string[]) =>
    new Set(keys).size !== keys.length;
  if (
    duplicateKeys(output.citations.map((citation) => JSON.stringify(citation))) ||
    duplicateKeys(
      output.citations.map((citation) =>
        [
          citation.entityType ?? "none",
          citation.countryIso3 ?? "global",
          citation.entityId ?? "none",
          citation.regulationId ?? "none",
        ].join(":"),
      ),
    ) ||
    duplicateKeys(metricItems.map(({ metricCode }) => metricCode)) ||
    duplicateKeys(
      metricItems.flatMap(({ observations }) =>
        observations.map(({ id }) => id),
      ),
    ) ||
    duplicateKeys(
      metricItems.flatMap(({ metricCode, observations }) =>
        observations.map(
          ({ countryIso3 }) => `${metricCode}:${countryIso3}`,
        ),
      ),
    ) ||
    duplicateKeys(
      productItems.map(
        ({ countryIso3, productModelCode }) =>
          `${countryIso3}:${productModelCode}`,
      ),
    ) ||
    duplicateKeys(
      regulationItems.map(
        ({ applicability, id }) => `${applicability.countryIso3}:${id}`,
      ),
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Evidence digest contains duplicate entity identities",
      path: ["evidenceDigest"],
    });
  }
  if (
    !exactSequence(
      metricItems.map(({ metricCode }) => metricCode),
      query.metricCodes,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Evidence-digest metrics must match the query order",
      path: ["evidenceDigest", "marketMetrics"],
    });
  }
  for (const [metricIndex, metric] of metricItems.entries()) {
    const issues = marketComparisonIssues(metric.observations, query.countryIso3s);
    if (
      !exactSequence(metric.issues, issues) ||
      metric.comparisonStatus !== marketComparisonStatus(issues)
    ) {
      context.addIssue({
        code: "custom",
        message: "Market digest comparability must match its observation basis",
        path: ["evidenceDigest", "marketMetrics", metricIndex, "issues"],
      });
    }
    if (!queryMetricCodes.has(metric.metricCode)) {
      context.addIssue({
        code: "custom",
        message: "Evidence-digest metric is outside the query",
        path: ["evidenceDigest", "marketMetrics", metricIndex, "metricCode"],
      });
    }
    if (
      metric.comparisonStatus === "comparable" &&
      !exactSequence(
        metric.observations.map(({ countryIso3 }) => countryIso3),
        query.countryIso3s,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Comparable market observations must match the query order",
        path: ["evidenceDigest", "marketMetrics", metricIndex, "observations"],
      });
    }
    for (const [observationIndex, observation] of metric.observations.entries()) {
      if (
        !queryCountries.has(observation.countryIso3) ||
        (observation.applicationScope !== null &&
          observation.applicationScope !== query.applicationScope) ||
        !citationCoversEntity(
          output.citations,
          "market_metric",
          observation.id,
          observation.countryIso3,
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Market digest observation is outside the query or uncited",
          path: [
            "evidenceDigest",
            "marketMetrics",
            metricIndex,
            "observations",
            observationIndex,
          ],
        });
      }
    }
  }

  for (const [evaluationIndex, evaluation] of productItems.entries()) {
    if (!productEvaluationMatchesQuery(evaluation, query)) {
      context.addIssue({
        code: "custom",
        message: "Product digest evaluation does not match the query",
        path: ["evidenceDigest", "productEvaluations", evaluationIndex, "countryIso3"],
      });
    }
    if (
      evaluation.product &&
      !citationCoversEntity(
        output.citations,
        "product",
        evaluation.product.id,
        evaluation.countryIso3,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Product digest entity is uncited",
        path: ["evidenceDigest", "productEvaluations", evaluationIndex, "product"],
      });
    }
    for (const [regulationIndex, regulation] of evaluation.regulationChecks.entries()) {
      if (
        evaluation.regulationChecks.findIndex(
          ({ regulationId }) => regulationId === regulation.regulationId,
        ) !== regulationIndex ||
        duplicateKeys(
          regulation.certifications.map(
            ({ certificationId }) => certificationId,
          ),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Product digest contains duplicate regulation or certification identities",
          path: ["evidenceDigest", "productEvaluations", "items", evaluationIndex, "regulationChecks", regulationIndex],
        });
      }
      if (
        !citationCoversEntity(
          output.citations,
          "regulation",
          regulation.regulationId,
          evaluation.countryIso3,
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Product regulation digest entity is uncited",
          path: ["evidenceDigest", "productEvaluations", evaluationIndex, "regulationChecks", regulationIndex],
        });
      }
      for (const [certificationIndex, certification] of regulation.certifications.entries()) {
        if (
          !citationCoversEntity(
            output.citations,
            "product_certification",
            certification.certificationId,
            evaluation.countryIso3,
          )
        ) {
          context.addIssue({
            code: "custom",
            message: "Product certification digest entity is uncited",
            path: ["evidenceDigest", "productEvaluations", evaluationIndex, "regulationChecks", regulationIndex, "certifications", certificationIndex],
          });
        }
      }
    }
  }

  for (const [regulationIndex, regulation] of regulationItems.entries()) {
    const countryIso3 = regulation.applicability.countryIso3;
    if (
      !regulationMatchesQuery(regulation, query) ||
      !citationCoversEntity(
        output.citations,
        "regulation",
        regulation.id,
        countryIso3,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Regulation digest entity is outside the query or uncited",
        path: ["evidenceDigest", "regulations", regulationIndex],
      });
    }
    const requiredCitationCounts = [
      output.citations.filter(
        ({ countryIso3: citationCountry, entityId, entityType, regulationId }) =>
          citationCountry === countryIso3 &&
          entityType === "regulation" &&
          entityId === regulation.id &&
          regulationId === regulation.id,
      ).length,
      output.citations.filter(
        ({ countryIso3: citationCountry, entityId, entityType, regulationId }) =>
          citationCountry === countryIso3 &&
          entityType === "jurisdiction" &&
          entityId === regulation.applicability.jurisdiction.id &&
          regulationId === regulation.id,
      ).length,
      output.citations.filter(
        ({ countryIso3: citationCountry, entityId, entityType, regulationId }) =>
          citationCountry === countryIso3 &&
          entityType === "country_jurisdiction" &&
          entityId === regulation.applicability.jurisdiction.id &&
          regulationId === regulation.id,
      ).length,
    ];
    if (requiredCitationCounts.some((count) => count !== 1)) {
      context.addIssue({
        code: "custom",
        message: "Each regulation requires its three applicability citations",
        path: ["citations"],
      });
    }
  }

  for (const [citationIndex, citation] of output.citations.entries()) {
    if (!citationMatchesDigest(citation, output.evidenceDigest)) {
      context.addIssue({
        code: "custom",
        message: "Citation identity or descriptor does not match the digest",
        path: ["citations", citationIndex],
      });
    }
  }

  const currentRegulationIdsByCountry = new Map(
    query.countryIso3s.map((countryIso3) => [
      countryIso3,
      regulationItems.flatMap((regulation) =>
        regulation.applicability.countryIso3 === countryIso3 &&
        regulation.bucket === "current_effective"
          ? [regulation.id]
          : [],
      ),
    ]),
  );
  for (const [evaluationIndex, evaluation] of productItems.entries()) {
    if (
      !exactSequence(
        evaluation.regulationChecks.map(({ regulationId }) => regulationId),
        currentRegulationIdsByCountry.get(evaluation.countryIso3) ?? [],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Product regulation checks must match current digest regulations",
        path: ["evidenceDigest", "productEvaluations", evaluationIndex],
      });
    }
  }

  if (output.scorecard) {
    for (const [scoreIndex, score] of output.scorecard.scores.entries()) {
      const expectedScore = expectedScoreFromDigest({
        countryIso3: score.countryIso3,
        digest: output.evidenceDigest,
        query,
        weights: output.scorecard.weights,
      });
      if (
        !countryOpportunityScoreMatchesMath(
          score,
          output.scorecard.weights,
        ) ||
        !exactJson(score, expectedScore)
      ) {
        context.addIssue({
          code: "custom",
          message: "Projected score does not replay from the evidence digest",
          path: ["scorecard", "scores", scoreIndex],
        });
      }
    }
  }

  if (output.brief && !briefMatchesDigest(output.brief, output.evidenceDigest)) {
    context.addIssue({
      code: "custom",
      message: "Sales brief does not replay from the evidence digest",
      path: ["brief"],
    });
  }
}

function exactSequence(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function refineModelToolOutputEnvelope(
  output: {
    citations: readonly unknown[];
    evidenceSufficient: boolean;
    status: "error" | "no_data" | "ok";
  },
  context: z.RefinementCtx,
): void {
  if ((output.status === "ok") !== output.evidenceSufficient) {
    context.addIssue({
      code: "custom",
      message: "Model tool-output status must match evidence sufficiency",
      path: ["status"],
    });
  }
  if (output.evidenceSufficient && output.citations.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Sufficient model tool output requires citations",
      path: ["citations"],
    });
  }
}

function refineModelToolOutputSize(
  output: unknown,
  context: z.RefinementCtx,
): void {
  const byteLength = new TextEncoder().encode(JSON.stringify(output)).byteLength;
  if (byteLength > SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES) {
    context.addIssue({
      code: "custom",
      message: `Model tool output exceeds ${SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES} UTF-8 bytes`,
    });
  }
}

function refineScoreProjection(
  output: { scorecard: z.infer<typeof compactScorecardSchema> },
  context: z.RefinementCtx,
): void {
  const actualCountries = output.scorecard.scores.map(
    ({ countryIso3 }) => countryIso3,
  );
  if (!exactSequence(actualCountries, output.scorecard.query.countryIso3s)) {
    context.addIssue({
      code: "custom",
      message: "Projected score countries must match the query order",
      path: ["scorecard", "scores"],
    });
  }
  if (
    !weightsMatchRuntime(output.scorecard.weights) ||
    output.scorecard.scores.some(
      (score) =>
        !countryOpportunityScoreMatchesMath(score, output.scorecard.weights),
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Projected scores must satisfy deterministic score arithmetic",
      path: ["scorecard", "scores"],
    });
  }
}

function refineBriefProjection(
  output: { brief: z.infer<typeof compactSalesBriefSchema> },
  context: z.RefinementCtx,
): void {
  const weights = weightsFromScore(output.brief.marketScore);
  if (
    weights === null ||
    !weightsMatchRuntime(weights) ||
    !countryOpportunityScoreMatchesMath(output.brief.marketScore, weights) ||
    output.brief.marketScore.countryIso3 !==
      output.brief.query.targetCountryIso3 ||
    !exactJson(output.brief.gaps, output.brief.marketScore.gaps)
  ) {
    context.addIssue({
      code: "custom",
      message: "Projected sales-brief score is internally inconsistent",
      path: ["brief", "marketScore"],
    });
  }
}

/**
 * Validates internal replay consistency, not the authenticity of arbitrary
 * standalone JSON. Production output is authorized only when constructed by
 * the full-result factories below.
 */
export const opportunityScoreModelToolOutputSchema =
  modelToolOutputBaseSchema
    .extend({
      evidenceDigest: modelEvidenceDigestSchema,
      scorecard: compactScorecardSchema,
      tool: z.literal("calculateOpportunityScore"),
    })
    .strict()
    .superRefine(refineModelToolOutputEnvelope)
    .superRefine(refineScoreProjection)
    .superRefine(refineModelEvidenceDigest)
    .superRefine(refineModelToolOutputSize);

/** See the trust-boundary note on {@link opportunityScoreModelToolOutputSchema}. */
export const salesBriefModelToolOutputSchema = modelToolOutputBaseSchema
  .extend({
    brief: compactSalesBriefSchema,
    evidenceDigest: modelEvidenceDigestSchema,
    tool: z.literal("generateSalesBrief"),
  })
  .strict()
  .superRefine(refineModelToolOutputEnvelope)
  .superRefine(refineBriefProjection)
  .superRefine(refineModelEvidenceDigest)
  .superRefine(refineModelToolOutputSize);

type ScoreResultCitations = z.infer<
  typeof calculateOpportunityScoreResultSchema
>["citations"];

const modelCitationEntityTypes = new Set([
  "country_jurisdiction",
  "jurisdiction",
  "market_metric",
  "product",
  "product_certification",
  "regulation",
]);

function modelVisibleCitations(citations: ScoreResultCitations) {
  return citations.filter(({ entityType }) =>
    modelCitationEntityTypes.has(entityType ?? ""),
  );
}

function compactCitations(citations: ScoreResultCitations) {
  return modelVisibleCitations(citations)
    .map((citation) => ({
      ...(citation.countryIso3 === null
        ? {}
        : { countryIso3: citation.countryIso3 }),
      ...(citation.entityId == null || citation.entityType == null
        ? {}
        : { entityId: citation.entityId, entityType: citation.entityType }),
      ...(citation.locator === null || citation.locatorDescriptor != null
        ? {}
        : { locator: citation.locator }),
      ...(citation.locatorDescriptor == null
        ? {}
        : { locatorDescriptor: citation.locatorDescriptor }),
      ...(citation.regulationId === null
        ? {}
        : { regulationId: citation.regulationId }),
      sourceId: citation.sourceId,
      ...(citation.titleDescriptor == null ? { title: citation.title } : {}),
      ...(citation.titleDescriptor == null
        ? {}
        : { titleDescriptor: citation.titleDescriptor }),
    }));
}

function compactSources(citations: ScoreResultCitations) {
  const sources = new Map<
    string,
    z.infer<typeof compactEvidenceSourceSchema>
  >();
  for (const citation of modelVisibleCitations(citations)) {
    const existing = sources.get(citation.sourceId);
    if (
      existing !== undefined &&
      (existing.title !== citation.sourceTitle ||
        existing.url !== citation.sourceUrl ||
        existing.verifiedAt !== citation.verifiedAt)
    ) {
      throw new Error(
        `Conflicting source metadata for model-visible source ${citation.sourceId}`,
      );
    }
    sources.set(citation.sourceId, {
      id: citation.sourceId,
      isDemo: existing?.isDemo === true || citation.isDemo,
      title: citation.sourceTitle,
      url: citation.sourceUrl,
      verifiedAt: citation.verifiedAt,
    });
  }
  return [...sources.values()];
}

function boundedDigestCollection<T>(items: readonly T[], maximumItems: number) {
  const selectedItems = items.slice(0, maximumItems);
  const omittedCount = items.length - selectedItems.length;
  return {
    complete: omittedCount === 0,
    items: selectedItems,
    omittedCount,
    totalCount: items.length,
  };
}

function compactEvidenceDigest(
  provenance: z.infer<typeof opportunityScorecardSchema>["provenance"],
) {
  const marketMetrics = provenance.marketComparison.metrics.map((metric) => ({
      comparisonStatus: metric.comparisonStatus,
      issues: metric.issues,
      metricCode: metric.metricCode,
      metricName: metric.metricName,
      observations: metric.observations.map((observation) => ({
        applicationScope: observation.applicationScope,
        countryIso3: observation.countryIso3,
        currencyCode: observation.currencyCode,
        definition: observation.definition,
        id: observation.id,
        isDemo: observation.isDemo,
        methodologyVersion: observation.methodologyVersion,
        periodEnd: observation.periodEnd,
        periodStart: observation.periodStart,
        sourceId: observation.source.sourceId,
        unitCode: observation.unitCode,
        valueNumeric: observation.valueNumeric,
      })),
    }));
  const productEvaluations = provenance.productEvaluations.flatMap(
      ({ countryIso3, evaluations }) =>
        evaluations.map((evaluation) => ({
          applicationScope: evaluation.input.applicationScope,
          asOf: evaluation.asOf,
          commercialReadiness: evaluation.commercialReadiness,
          countryIso3,
          productModelCode: evaluation.input.productModelCode,
          powerKw: evaluation.input.powerKw,
          product: evaluation.product
            ? {
                availableFrom: evaluation.product.availableFrom,
                availableTo: evaluation.product.availableTo,
                id: evaluation.product.id,
                modelCode: evaluation.product.modelCode,
                name: evaluation.product.name,
                sourceId: evaluation.product.source.id,
                specificationVersion: evaluation.product.specificationVersion,
              }
            : null,
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
          reasonCodes: Array.from(
            new Set(evaluation.reasons.map(({ code }) => code)),
          ),
          regulationChecks: evaluation.regulationChecks.map((check) => ({
            certifications: check.certifications.map((certification) => ({
              certificateNumber:
                certification.certification.certificateNumber,
              certificationId: certification.certification.id,
              certificationStatus: certification.certification.status,
              reasonCodes: Array.from(
                new Set(certification.reasons.map(({ code }) => code)),
              ),
              sourceId: certification.certification.source.id,
              status: certification.status,
            })),
            code: check.code,
            regulationId: check.regulation.regulationId,
            status: check.status,
          })),
          status: evaluation.status,
        })),
    );
  const regulations = provenance.regulationComparison.countries.flatMap((country) =>
      [
        ...country.currentEffectiveRegulations.map((regulation) => ({
          bucket: "current_effective" as const,
          regulation,
        })),
        ...country.futureAdoptedRegulations.map((regulation) => ({
          bucket: "future_adopted" as const,
          regulation,
        })),
      ].map(({ bucket, regulation }) => ({
        applicability: {
          countryIso3: regulation.applicability.countryIso3,
          jurisdiction: {
            code: regulation.applicability.jurisdiction.code,
            id: regulation.applicability.jurisdiction.id,
            name: regulation.applicability.jurisdiction.name,
            sourceId:
              regulation.applicability.jurisdiction.source.sourceId,
          },
          membership: {
            sourceId: regulation.applicability.membership.source.sourceId,
            validFrom: regulation.applicability.membership.validFrom,
            validTo: regulation.applicability.membership.validTo,
          },
        },
        bucket,
        canonicalName: regulation.canonicalName,
        citationCode: regulation.citationCode,
        effectiveFrom: regulation.effectiveFrom,
        effectiveTo: regulation.effectiveTo,
        id: regulation.id,
        recordStatus: regulation.recordStatus,
        sourceId: regulation.source.sourceId,
        status: regulation.status,
      })),
    );
  return {
    marketMetrics: boundedDigestCollection(marketMetrics, 8),
    productEvaluations: boundedDigestCollection(productEvaluations, 125),
    regulations: boundedDigestCollection(regulations, 250),
  };
}

function compactProjectionQuery<
  TQuery extends z.infer<typeof opportunityScorecardSchema>["query"],
>(query: TQuery, digest: ModelEvidenceDigest) {
  return {
    ...query,
    metricCodes:
      query.metricCodes ??
      digest.marketMetrics.items.map(({ metricCode }) => metricCode),
    productModelCode: query.productModelCode ?? null,
  };
}

/**
 * Keeps the full deterministic result at the application boundary while
 * sending only the facts needed for model explanation into the next step.
 */
export function opportunityScoreResultToModelOutput(output: unknown) {
  const result = calculateOpportunityScoreResultSchema.parse(output);
  const citations = compactCitations(result.citations);
  const evidenceDigest = compactEvidenceDigest(result.scorecard.provenance);
  const sources = compactSources(result.citations);

  return opportunityScoreModelToolOutputSchema.parse({
    citations,
    evidenceDigest,
    evidenceSufficient: result.evidenceSufficient,
    informationAsOf: result.informationAsOf,
    latestVerifiedAt: latestVerifiedAtFromCitations(sources),
    projectionVersion: SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
    scorecard: {
      query: compactProjectionQuery(result.scorecard.query, evidenceDigest),
      rulesetVersion: result.scorecard.rulesetVersion,
      scores: result.scorecard.scores,
      weights: result.scorecard.weights,
    },
    sources,
    status: result.status,
    tool: result.tool,
    warnings: result.warnings,
  });
}

/** See {@link opportunityScoreResultToModelOutput}. */
export function salesBriefResultToModelOutput(output: unknown) {
  const result = generateSalesBriefResultSchema.parse(output);
  const citations = compactCitations(result.citations);
  const evidenceDigest = compactEvidenceDigest(result.brief.provenance);
  const sources = compactSources(result.citations);

  return salesBriefModelToolOutputSchema.parse({
    brief: {
      gaps: result.brief.gaps,
      marketScore: result.brief.marketScore,
      opportunities: result.brief.opportunities,
      query: compactProjectionQuery(result.brief.query, evidenceDigest),
      recommendedProducts: result.brief.recommendedProducts.map(({ id }) => ({
        id,
      })),
      risks: result.brief.risks,
      salesActions: result.brief.salesActions,
    },
    citations,
    evidenceDigest,
    evidenceSufficient: result.evidenceSufficient,
    informationAsOf: result.informationAsOf,
    latestVerifiedAt: latestVerifiedAtFromCitations(sources),
    projectionVersion: SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
    sources,
    status: result.status,
    tool: result.tool,
    warnings: result.warnings,
  });
}
