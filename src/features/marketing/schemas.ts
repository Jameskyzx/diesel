import { z } from "zod";

import {
  applicationScopeSchema,
  httpUrlSchema,
  iso3Schema,
  isoDateSchema,
  powerKwSchema,
} from "@/features/database/schemas";

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
    metricCodes: z.array(metricCodeSchema).min(1).max(8).optional(),
  })
  .strict();

export const calculateOpportunityScoreInputSchema =
  compareRegulationsInputSchema
    .extend({
      countryIso3s: countryComparisonListSchema,
      metricCodes: z.array(metricCodeSchema).min(1).max(8).optional(),
      productModelCode: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .transform((value) => value.toUpperCase())
        .optional(),
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
    entityType: z.enum([
      "country_jurisdiction",
      "jurisdiction",
      "regulation",
      "regulation_limit",
      "market_metric",
      "product",
      "product_certification",
    ]),
    isDemo: z.boolean(),
    locator: z.string().nullable(),
    publishedOn: isoDateSchema.nullable(),
    regulationId: z.uuid().nullable(),
    regulationStatus: z
      .enum(["proposed", "adopted", "effective", "superseded"])
      .nullable(),
    sourceId: z.uuid(),
    sourceTitle: z.string().trim().min(1),
    sourceUrl: httpUrlSchema.nullable(),
    title: z.string().trim().min(1),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

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
    countryIso3: iso3Schema,
    countryName: z.string().nullable(),
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
  .strict();

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
  .strict();

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
    explanation: z.string().trim().min(1),
    inputFacts: z.array(z.string()),
    key: opportunityScoreDimensionKeySchema,
    score: z.number().finite().min(0).max(100).nullable(),
    status: z.enum(["available", "missing"]),
  })
  .strict();

export const countryOpportunityScoreSchema = z
  .object({
    components: z.array(opportunityScoreComponentSchema).length(3),
    countryIso3: iso3Schema,
    dataCoveragePct: z.number().finite().min(0).max(100),
    missingData: z.array(z.string()),
    overallScore: z.number().finite().min(0).max(100).nullable(),
  })
  .strict();

export const opportunityScorecardSchema = z
  .object({
    query: calculateOpportunityScoreInputSchema,
    rulesetVersion: z.literal("opportunity-score-v2"),
    scores: z.array(countryOpportunityScoreSchema),
    sources: z.array(analysisSourceSchema),
    weights: opportunityScoreWeightsSchema,
  })
  .strict();

const salesBriefItemSchema = z
  .object({
    evidenceIds: z.array(z.string()),
    text: z.string().trim().min(1),
    title: z.string().trim().min(1),
  })
  .strict();

export const recommendedProductSchema = z
  .object({
    availableFrom: z.iso.date().nullable(),
    availableTo: z.iso.date().nullable(),
    availabilityStatus: z.literal("pass"),
    certificationIds: z.array(z.uuid()),
    commercialReadiness: z.literal("ready"),
    modelCode: z.string().trim().min(1),
    name: z.string().trim().min(1),
    reasons: z.array(z.string()),
    regulationIds: z.array(z.uuid()),
    status: z.literal("fit"),
  })
  .strict();

export const salesActionSchema = z
  .object({
    action: z.string().trim().min(1),
    kind: z.literal("rule_generated"),
    priority: z.enum(["high", "medium", "low"]),
    rationale: z.string().trim().min(1),
  })
  .strict();

export const salesBriefSchema = z
  .object({
    executiveSummary: z.string().trim().min(1),
    marketScore: countryOpportunityScoreSchema,
    missingData: z.array(z.string()),
    opportunities: z.array(salesBriefItemSchema),
    query: generateSalesBriefInputSchema,
    recommendedProducts: z.array(recommendedProductSchema),
    risks: z.array(salesBriefItemSchema),
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
export type RegulationComparison = z.infer<
  typeof regulationComparisonSchema
>;
export type RegulationComparisonItem = z.infer<
  typeof regulationComparisonItemSchema
>;
export type SalesBrief = z.infer<typeof salesBriefSchema>;
