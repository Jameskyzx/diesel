import { z } from "zod";

import { modelOriginatedProductModelCodeSchema } from "@/domain/ai/model-originated-input";
import {
  applicationScopeSchema,
  httpUrlSchema,
  iso3Schema,
  isoDateSchema,
  powerKwSchema,
} from "@/features/database/schemas";
import { OPPORTUNITY_SCORE_RULESET_VERSION } from "@/features/marketing/constants";
import { citationLocatorDescriptorSchema } from "@/features/ai/citation-locator";
import { citationTitleDescriptorSchema } from "@/features/ai/citation-title";
import {
  evidenceEntityTypes,
  marketComparisonSourcesMatchFacts,
  regulationComparisonSourcesMatchFacts,
} from "@/features/ai/evidence-semantics";
import { productFitEvaluationSchema } from "@/features/product-fit/schemas";

const isoTimestampSchema = z.iso.datetime({ offset: true });

export const opportunityScoreDimensionKeys = [
  "marketPotential",
  "productReadiness",
  "regulatoryCoverage",
] as const;

export const opportunityScoreDimensionKeySchema = z.enum(
  opportunityScoreDimensionKeys,
);

export const countryComparisonListSchema = z
  .array(iso3Schema)
  .min(2)
  .max(5)
  .superRefine((countries, context) => {
    if (new Set(countries).size !== countries.length) {
      context.addIssue({
        code: "custom",
        message: "countryIso3s must not contain duplicates",
      });
    }
  });

export const regulationCountryListSchema = z
  .array(iso3Schema)
  .min(1)
  .max(5)
  .superRefine((countries, context) => {
    if (new Set(countries).size !== countries.length) {
      context.addIssue({
        code: "custom",
        message: "countryIso3s must not contain duplicates",
      });
    }
  });

export const metricCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_:-]+$/)
  .transform((value) => value.toUpperCase());

export const metricCodeListSchema = z
  .array(metricCodeSchema)
  .min(1)
  .max(8)
  .superRefine((metricCodes, context) => {
    if (new Set(metricCodes).size !== metricCodes.length) {
      context.addIssue({
        code: "custom",
        message: "metricCodes must not contain duplicates",
      });
    }
  });

export const compareRegulationsInputSchema = z
  .object({
    applicationScope: applicationScopeSchema,
    asOf: isoDateSchema,
    countryIso3s: regulationCountryListSchema,
    powerKw: powerKwSchema,
  })
  .strict();

export const compareMarketsInputSchema = z
  .object({
    applicationScope: applicationScopeSchema.nullable().optional(),
    countryIso3s: countryComparisonListSchema,
    metricCodes: metricCodeListSchema.optional(),
  })
  .strict();

export const calculateOpportunityScoreInputSchema =
  compareRegulationsInputSchema
    .extend({
      countryIso3s: countryComparisonListSchema,
      metricCodes: metricCodeListSchema.optional(),
      productModelCode: modelOriginatedProductModelCodeSchema.optional(),
    })
    .strict();

export const generateSalesBriefInputSchema =
  calculateOpportunityScoreInputSchema
    .extend({
      targetCountryIso3: iso3Schema,
    })
    .superRefine((input, context) => {
      if (!input.countryIso3s.includes(input.targetCountryIso3)) {
        context.addIssue({
          code: "custom",
          message: "targetCountryIso3 must be included in countryIso3s",
          path: ["targetCountryIso3"],
        });
      }
    });

export const analysisSourceSchema = z
  .object({
    countryIso3: iso3Schema.nullable(),
    entityId: z.uuid(),
    entityType: z.enum(evidenceEntityTypes),
    isDemo: z.boolean(),
    locator: z.string().nullable(),
    locatorDescriptor: citationLocatorDescriptorSchema.nullable().optional(),
    publishedOn: isoDateSchema.nullable(),
    productId: z.uuid().optional(),
    productModelCode: z.string().trim().min(1).optional(),
    regulationId: z.uuid().nullable(),
    regulationStatus: z
      .enum(["proposed", "adopted", "effective", "superseded"])
      .nullable(),
    sourceId: z.uuid(),
    sourceTitle: z.string().trim().min(1),
    sourceUrl: httpUrlSchema.nullable(),
    title: z.string().trim().min(1),
    titleDescriptor: citationTitleDescriptorSchema.nullable().optional(),
    verifiedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((source, context) => {
    const isCertification = source.entityType === "product_certification";
    if (
      isCertification &&
      (source.productId === undefined ||
        source.productModelCode === undefined ||
        source.regulationId === null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Product-certification sources require product, model and regulation identities",
      });
    }
    if (
      !isCertification &&
      (source.productId !== undefined || source.productModelCode !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Product identity fields are reserved for product-certification sources",
      });
    }
  });

export const regulationApplicabilityComparisonSchema = z
  .object({
    countryIso3: iso3Schema,
    jurisdiction: z
      .object({
        code: z.string().trim().min(1),
        id: z.uuid(),
        isDemo: z.boolean(),
        name: z.string().trim().min(1),
        source: analysisSourceSchema,
        verifiedAt: isoTimestampSchema,
      })
      .strict(),
    membership: z
      .object({
        isDemo: z.boolean(),
        source: analysisSourceSchema,
        validFrom: isoDateSchema,
        validTo: isoDateSchema.nullable(),
        verifiedAt: isoTimestampSchema,
      })
      .strict(),
  })
  .strict();

export const regulationLimitComparisonSchema = z
  .object({
    id: z.uuid(),
    isDemo: z.boolean(),
    limitValue: z.string(),
    pollutantCode: z.string(),
    powerMaxKw: z.number().finite().positive().nullable(),
    powerMinKw: z.number().finite().nonnegative().nullable(),
    source: analysisSourceSchema,
    unitCode: z.string(),
    validFrom: isoDateSchema,
    validTo: isoDateSchema.nullable(),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

export const regulationComparisonItemSchema = z
  .object({
    applicability: regulationApplicabilityComparisonSchema,
    canonicalName: z.string().trim().min(1),
    citationCode: z.string().nullable(),
    effectiveFrom: isoDateSchema.nullable(),
    effectiveTo: isoDateSchema.nullable(),
    id: z.uuid(),
    isDemo: z.boolean(),
    limits: z.array(regulationLimitComparisonSchema),
    source: analysisSourceSchema,
    recordStatus: z
      .enum(["adopted", "effective", "superseded"]),
    status: z.enum(["adopted", "effective"]),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

export const regulationCountryComparisonSchema = z
  .object({
    countryIsDemo: z.boolean(),
    countryIso3: iso3Schema,
    countryName: z.string().nullable(),
    countrySource: z
      .object({
        countryIso2: z
          .string()
          .length(2)
          .regex(/^[A-Z]{2}$/),
        countryNameLocal: z.string().nullable(),
        id: z.uuid(),
        isDemo: z.boolean(),
        publishedOn: isoDateSchema.nullable(),
        title: z.string(),
        url: httpUrlSchema.nullable(),
        verifiedAt: isoTimestampSchema,
      })
      .strict()
      .nullable(),
    currentEffectiveRegulations: z.array(regulationComparisonItemSchema),
    futureAdoptedRegulations: z.array(regulationComparisonItemSchema),
    status: z.enum(["available", "no_data"]),
  })
  .strict();

export const regulationComparisonSchema = z
  .object({
    countries: z.array(regulationCountryComparisonSchema),
    missingData: z.array(z.string()),
    query: compareRegulationsInputSchema,
    sources: z.array(analysisSourceSchema),
  })
  .strict()
  .superRefine((comparison, context) => {
    if (!regulationComparisonSourcesMatchFacts(comparison)) {
      context.addIssue({
        code: "custom",
        message:
          "Regulation facts must match their nested and top-level source identities",
        path: ["sources"],
      });
    }
  });

export const marketObservationSchema = z
  .object({
    applicationScope: applicationScopeSchema.nullable(),
    countryIso3: iso3Schema,
    countryName: z.string(),
    currencyCode: z.string().length(3).nullable(),
    definition: z.string(),
    id: z.uuid(),
    isDemo: z.boolean(),
    methodologyVersion: z.string(),
    metricCode: metricCodeSchema,
    metricName: z.string(),
    periodEnd: isoDateSchema,
    periodStart: isoDateSchema,
    publishedOn: isoDateSchema.nullable(),
    source: analysisSourceSchema,
    unitCode: z.string(),
    valueNumeric: z.string(),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

export const marketMetricComparisonSchema = z
  .object({
    comparisonStatus: z.enum([
      "comparable",
      "incomparable",
      "insufficient_data",
    ]),
    issues: z.array(
      z.enum([
        "MISSING_COUNTRY_OBSERVATION",
        "AMBIGUOUS_LATEST_OBSERVATION",
        "MISSING_UNIT",
        "MISSING_DEFINITION",
        "MISSING_METHODOLOGY",
        "APPLICATION_SCOPE_MISMATCH",
        "UNIT_MISMATCH",
        "CURRENCY_MISMATCH",
        "DEFINITION_MISMATCH",
        "METHODOLOGY_MISMATCH",
        "PERIOD_MISMATCH",
      ]),
    ),
    metricCode: metricCodeSchema,
    metricName: z.string(),
    observations: z.array(marketObservationSchema),
  })
  .strict();

export const marketComparisonSchema = z
  .object({
    metrics: z.array(marketMetricComparisonSchema),
    missingData: z.array(z.string()),
    query: compareMarketsInputSchema,
    sources: z.array(analysisSourceSchema),
  })
  .strict()
  .superRefine((comparison, context) => {
    if (!marketComparisonSourcesMatchFacts(comparison)) {
      context.addIssue({
        code: "custom",
        message:
          "Market observations must match their metric and source identities",
        path: ["sources"],
      });
    }
  });

export const opportunityScoreWeightsSchema = z
  .object({
    marketPotential: z.number().finite().min(0).max(1),
    productReadiness: z.number().finite().min(0).max(1),
    regulatoryCoverage: z.number().finite().min(0).max(1),
  })
  .strict()
  .superRefine((weights, context) => {
    const sum =
      weights.marketPotential +
      weights.productReadiness +
      weights.regulatoryCoverage;
    if (Math.abs(sum - 1) > 0.000_001) {
      context.addIssue({
        code: "custom",
        message: "Opportunity-score weights must sum to 1",
      });
    }
  });

export const opportunityScoreComponentSchema = z
  .object({
    configuredWeight: z.number().finite().min(0).max(1),
    contribution: z.number().finite().min(0).max(100).nullable(),
    effectiveWeight: z.number().finite().min(0).max(1),
    key: opportunityScoreDimensionKeySchema,
    score: z.number().finite().min(0).max(100).nullable(),
    status: z.enum(["available", "missing"]),
  })
  .strict();

export const opportunityScoreGapSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("MARKET_DATA_UNAVAILABLE") }).strict(),
  z.object({ code: z.literal("PRODUCT_DATA_UNAVAILABLE") }).strict(),
  z.object({ code: z.literal("REGULATORY_DATA_UNAVAILABLE") }).strict(),
  z.object({ code: z.literal("TOOL_EXECUTION_FAILED") }).strict(),
  z
    .object({
      code: z.literal("PRODUCT_READINESS_UNKNOWN"),
      count: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      code: z.literal("UNSUPPORTED_METRIC_DIRECTION"),
      metricCodes: z.array(metricCodeSchema).min(1),
    })
    .strict(),
]);

export const countryOpportunityScoreSchema = z
  .object({
    components: z.array(opportunityScoreComponentSchema).length(3),
    countryIso3: iso3Schema,
    dataCoveragePct: z.number().finite().min(0).max(100),
    gaps: z.array(opportunityScoreGapSchema),
    overallScore: z.number().finite().min(0).max(100).nullable(),
  })
  .strict();

export const opportunityScoreProvenanceSchema = z
  .object({
    marketComparison: marketComparisonSchema,
    productEvaluations: z.array(
      z
        .object({
          countryIso3: iso3Schema,
          evaluations: z.array(productFitEvaluationSchema),
        })
        .strict(),
    ),
    regulationComparison: regulationComparisonSchema,
  })
  .strict();

export const opportunityScorecardSchema = z
  .object({
    provenance: opportunityScoreProvenanceSchema,
    query: calculateOpportunityScoreInputSchema,
    rulesetVersion: z.literal(OPPORTUNITY_SCORE_RULESET_VERSION),
    scores: z.array(countryOpportunityScoreSchema),
    sources: z.array(analysisSourceSchema),
    weights: opportunityScoreWeightsSchema,
  })
  .strict();

export const recommendedProductSchema = z
  .object({
    availableFrom: z.iso.date().nullable(),
    availableTo: z.iso.date().nullable(),
    availabilityStatus: z.literal("pass"),
    certifications: z.array(
      z
        .object({
          id: z.uuid(),
          regulationId: z.uuid(),
        })
        .strict(),
    ),
    commercialReadiness: z.literal("ready"),
    id: z.uuid(),
    isDemo: z.boolean(),
    modelCode: z.string().trim().min(1),
    name: z.string().trim().min(1),
    source: z
      .object({
        id: z.uuid(),
        isDemo: z.boolean(),
        title: z.string().trim().min(1),
      })
      .strict(),
    specificationVersion: z.string().trim().min(1),
    status: z.literal("fit"),
  })
  .strict();

export const salesActionSchema = z
  .discriminatedUnion("ruleCode", [
    z
      .object({
        priority: z.literal("high"),
        productIds: z.array(z.uuid()).min(1),
        ruleCode: z.literal("PREPARE_PRODUCT_EVIDENCE_PACK"),
      })
      .strict(),
    z
      .object({
        priority: z.literal("high"),
        regulationIds: z.array(z.uuid()).min(1),
        ruleCode: z.literal("REVALIDATE_BEFORE_FUTURE_REGULATION"),
      })
      .strict(),
    z
      .object({
        missingDataIndexes: z.array(z.number().int().nonnegative()).min(1),
        priority: z.literal("medium"),
        ruleCode: z.literal("RESOLVE_MISSING_DATA_BEFORE_COMMITMENT"),
      })
      .strict(),
  ]);

export const salesOpportunitySchema = z.discriminatedUnion("ruleCode", [
  z
    .object({
      metricCodes: z.array(metricCodeSchema).min(1),
      ruleCode: z.literal("MARKET_POTENTIAL_AT_LEAST_50"),
    })
    .strict(),
  z
    .object({
      productIds: z.array(z.uuid()).min(1),
      ruleCode: z.literal("READY_PRODUCTS_AVAILABLE"),
    })
    .strict(),
]);

export const salesRiskSchema = z.discriminatedUnion("ruleCode", [
  z
    .object({
      regulationIds: z.array(z.uuid()).min(1),
      ruleCode: z.literal("FUTURE_ADOPTED_REGULATION"),
    })
    .strict(),
  z
    .object({
      productIds: z.array(z.uuid()).min(1),
      ruleCode: z.enum([
        "PRODUCTS_NOT_FIT",
        "PRODUCT_EVIDENCE_UNKNOWN",
        "FIT_PRODUCTS_UNAVAILABLE",
        "FIT_PRODUCTS_AVAILABILITY_UNKNOWN",
      ]),
    })
    .strict(),
]);

export const salesBriefSchema = z
  .object({
    gaps: z.array(opportunityScoreGapSchema),
    marketScore: countryOpportunityScoreSchema,
    opportunities: z.array(salesOpportunitySchema),
    provenance: opportunityScoreProvenanceSchema,
    query: generateSalesBriefInputSchema,
    recommendedProducts: z.array(recommendedProductSchema),
    risks: z.array(salesRiskSchema),
    salesActions: z.array(salesActionSchema),
    sources: z.array(analysisSourceSchema),
  })
  .strict();

export type AnalysisSource = z.infer<typeof analysisSourceSchema>;
export type CalculateOpportunityScoreInput = z.infer<
  typeof calculateOpportunityScoreInputSchema
>;
export type CompareMarketsInput = z.infer<
  typeof compareMarketsInputSchema
>;
export type CompareRegulationsInput = z.infer<
  typeof compareRegulationsInputSchema
>;
export type CountryOpportunityScore = z.infer<
  typeof countryOpportunityScoreSchema
>;
export type GenerateSalesBriefInput = z.infer<
  typeof generateSalesBriefInputSchema
>;
export type MarketComparison = z.infer<typeof marketComparisonSchema>;
export type MarketObservation = z.infer<typeof marketObservationSchema>;
export type OpportunityScorecard = z.infer<
  typeof opportunityScorecardSchema
>;
export type OpportunityScoreWeights = z.infer<
  typeof opportunityScoreWeightsSchema
>;
export type OpportunityScoreGap = z.infer<typeof opportunityScoreGapSchema>;
export type OpportunityScoreProvenance = z.infer<
  typeof opportunityScoreProvenanceSchema
>;
export type RegulationComparison = z.infer<
  typeof regulationComparisonSchema
>;
export type RegulationComparisonItem = z.infer<
  typeof regulationComparisonItemSchema
>;
export type SalesBrief = z.infer<typeof salesBriefSchema>;
