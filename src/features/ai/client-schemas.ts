import { z } from "zod";

import { httpUrlSchema } from "@/features/database/schemas";
import { productFitReasonCodeSchema } from "@/features/product-fit/schemas";

const clientCitationSchema = z
  .object({
    chunkId: z.string().nullable(),
    countryIso3: z.string().nullable(),
    documentId: z.string().nullable(),
    documentTitle: z.string().nullable(),
    isDemo: z.boolean(),
    locator: z.string().nullable(),
    pageFrom: z.number().int().positive().nullable(),
    pageTo: z.number().int().positive().nullable(),
    productCertificationId: z.string().nullable(),
    publishedOn: z.string().nullable(),
    regulationId: z.string().nullable(),
    regulationStatus: z
      .enum(["proposed", "adopted", "effective", "superseded"])
      .nullable(),
    sectionLocator: z.string().nullable(),
    sourceId: z.string(),
    sourceTitle: z.string(),
    sourceUrl: httpUrlSchema.nullable(),
    title: z.string(),
    verifiedAt: z.string(),
  })
  .strict();

const clientToolResultBase = z.object({
  citations: z.array(clientCitationSchema),
  evidenceSufficient: z.boolean(),
  informationAsOf: z.string(),
  latestVerifiedAt: z.string().nullable(),
  status: z.enum(["ok", "no_data", "error"]),
  warnings: z.array(z.string()),
});

const clientAnalysisQuerySchema = z
  .object({
    applicationScope: z.string(),
    asOf: z.iso.date(),
    countryIso3s: z.array(z.string()).min(2),
    metricCodes: z.array(z.string()).optional(),
    powerKw: z.number().finite().nonnegative(),
    productModelCode: z.string().optional(),
  })
  .passthrough();

const clientRegulationQuerySchema = clientAnalysisQuerySchema.extend({
  countryIso3s: z.array(z.string()).min(1).max(5),
});

const clientCountryRegulationSchema = z
  .object({
    applicability: z
      .object({
        jurisdiction: z
          .object({
            code: z.string(),
            name: z.string(),
          })
          .passthrough(),
        membership: z
          .object({
            validFrom: z.iso.date(),
            validTo: z.iso.date().nullable(),
          })
          .passthrough(),
      })
      .passthrough(),
    canonicalName: z.string(),
    id: z.string(),
    status: z.enum(["proposed", "adopted", "effective", "superseded"]),
    statusAtAsOf: z.enum(["effective", "adopted"]),
  })
  .passthrough();

const clientCountryProfileResultSchema = clientToolResultBase
  .extend({
    profile: z
      .union([
        z
          .object({
            iso3: z.string(),
            status: z.literal("no_data"),
          })
          .passthrough(),
        z
          .object({
            country: z
              .object({
                currentEffectiveRegulations: z.array(
                  clientCountryRegulationSchema,
                ),
                futureAdoptedRegulations: z.array(
                  clientCountryRegulationSchema,
                ),
              })
              .passthrough(),
            status: z.literal("available"),
          })
          .passthrough(),
        z.null(),
      ]),
    requestedTopics: z
      .array(z.enum(["country", "regulations", "market"]))
      .min(1),
    tool: z.literal("getCountryProfile"),
  })
  .passthrough();

const clientKnowledgeResultSchema = clientToolResultBase
  .extend({
    search: z
      .object({
        results: z.array(
          z
            .object({
              chunkId: z.string(),
              content: z.string(),
              document: z
                .object({
                  title: z.string(),
                })
                .passthrough(),
              finalScore: z.number(),
              rank: z.number().int().positive(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    tool: z.literal("searchKnowledgeBase"),
  })
  .passthrough();

const clientCompatibleProductsResultSchema = clientToolResultBase
  .extend({
    evaluations: z.array(
      z
        .object({
          commercialReadiness: z.enum(["ready", "not_ready", "unknown"]),
          input: z
            .object({
              productModelCode: z.string(),
            })
            .passthrough(),
          product: z
            .object({
              availableFrom: z.iso.date().nullable(),
              availableTo: z.iso.date().nullable(),
              id: z.string(),
              name: z.string(),
            })
            .passthrough()
            .nullable(),
          reasons: z.array(
            z
              .object({
                code: productFitReasonCodeSchema,
                message: z.string(),
                status: z.enum(["pass", "fail", "unknown"]),
              })
              .passthrough(),
          ),
          productChecks: z
            .object({
              availability: z
                .object({
                  code: z.enum([
                    "PRODUCT_AVAILABLE",
                    "PRODUCT_NOT_YET_AVAILABLE",
                    "PRODUCT_NO_LONGER_AVAILABLE",
                    "PRODUCT_AVAILABILITY_UNKNOWN",
                    "PRODUCT_NOT_FOUND",
                  ]),
                  message: z.string(),
                  status: z.enum(["pass", "fail", "unknown"]),
                })
                .passthrough(),
            })
            .passthrough(),
          status: z.enum(["fit", "not_fit", "unknown"]),
        })
        .passthrough(),
    ),
    query: z
      .object({
        applicationScope: z.string(),
        asOf: z.iso.date(),
        countryIso3: z.string().nullable(),
        powerKw: z.number().finite().nonnegative(),
        productModelCode: z.string().optional(),
      })
      .passthrough(),
    tool: z.literal("findCompatibleProducts"),
  })
  .passthrough();

const clientRegulationApplicabilitySchema = z
  .object({
    countryIso3: z.string(),
    jurisdiction: z
      .object({
        code: z.string(),
        name: z.string(),
      })
      .passthrough(),
    membership: z
      .object({
        validFrom: z.string(),
        validTo: z.string().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

const clientRegulationLimitSchema = z
  .object({
    id: z.string(),
    limitValue: z.string(),
    pollutantCode: z.string(),
    unitCode: z.string(),
    validFrom: z.string(),
    validTo: z.string().nullable(),
  })
  .passthrough();

const clientRegulationComparisonItemSchema = z
  .object({
    applicability: clientRegulationApplicabilitySchema,
    canonicalName: z.string(),
    effectiveFrom: z.string().nullable(),
    id: z.string(),
    limits: z.array(clientRegulationLimitSchema),
    recordStatus: z
      .enum(["adopted", "effective", "superseded"]),
    status: z.enum(["adopted", "effective"]),
  })
  .passthrough();

const clientRegulationComparisonResultSchema = clientToolResultBase
  .extend({
    comparison: z
      .object({
        countries: z.array(
          z
            .object({
              countryIso3: z.string(),
              countryName: z.string().nullable(),
              currentEffectiveRegulations: z.array(
                clientRegulationComparisonItemSchema,
              ),
              futureAdoptedRegulations: z.array(
                clientRegulationComparisonItemSchema,
              ),
              status: z.enum(["available", "no_data"]),
            })
            .passthrough(),
        ),
        missingData: z.array(z.string()),
        query: clientRegulationQuerySchema,
      })
      .passthrough(),
    tool: z.literal("compareRegulations"),
  })
  .passthrough();

const clientMarketComparisonResultSchema = clientToolResultBase
  .extend({
    comparison: z
      .object({
        metrics: z.array(
          z
            .object({
              comparisonStatus: z.enum([
                "comparable",
                "incomparable",
                "insufficient_data",
              ]),
              issues: z.array(z.string()),
              metricCode: z.string(),
              metricName: z.string(),
              observations: z.array(
                z
                  .object({
                    countryIso3: z.string(),
                    unitCode: z.string(),
                    valueNumeric: z.string(),
                  })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ),
        missingData: z.array(z.string()),
      })
      .passthrough(),
    tool: z.literal("compareMarkets"),
  })
  .passthrough();

const clientScoreComponentSchema = z
  .object({
    configuredWeight: z.number(),
    contribution: z.number().nullable(),
    effectiveWeight: z.number(),
    explanation: z.string(),
    inputFacts: z.array(z.string()),
    key: z.enum([
      "marketPotential",
      "productReadiness",
      "regulatoryCoverage",
    ]),
    score: z.number().nullable(),
    status: z.enum(["available", "missing"]),
  })
  .passthrough();

const clientCountryScoreSchema = z
  .object({
    components: z.array(clientScoreComponentSchema),
    countryIso3: z.string(),
    dataCoveragePct: z.number(),
    missingData: z.array(z.string()),
    overallScore: z.number().nullable(),
  })
  .passthrough();

const clientOpportunityScoreResultSchema = clientToolResultBase
  .extend({
    scorecard: z
      .object({
        query: clientAnalysisQuerySchema,
        rulesetVersion: z.string(),
        scores: z.array(clientCountryScoreSchema),
        weights: z
          .object({
            marketPotential: z.number(),
            productReadiness: z.number(),
            regulatoryCoverage: z.number(),
          })
          .passthrough(),
      })
      .passthrough(),
    tool: z.literal("calculateOpportunityScore"),
  })
  .passthrough();

const clientSalesBriefResultSchema = clientToolResultBase
  .extend({
    brief: z
      .object({
        executiveSummary: z.string(),
        marketScore: clientCountryScoreSchema,
        missingData: z.array(z.string()),
        opportunities: z.array(
          z
            .object({
              evidenceIds: z.array(z.string()),
              text: z.string(),
              title: z.string(),
            })
            .passthrough(),
        ),
        recommendedProducts: z.array(
          z
            .object({
              availableFrom: z.iso.date().nullable(),
              availableTo: z.iso.date().nullable(),
              modelCode: z.string(),
              name: z.string(),
              reasons: z.array(z.string()),
              status: z.literal("fit"),
            })
            .passthrough(),
        ),
        query: clientAnalysisQuerySchema
          .extend({
            targetCountryIso3: z.string(),
          })
          .passthrough(),
        risks: z.array(
          z
            .object({
              evidenceIds: z.array(z.string()),
              text: z.string(),
              title: z.string(),
            })
            .passthrough(),
        ),
        salesActions: z.array(
          z
            .object({
              action: z.string(),
              kind: z.literal("rule_generated"),
              priority: z.enum(["high", "medium", "low"]),
              rationale: z.string(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    tool: z.literal("generateSalesBrief"),
  })
  .passthrough();

export const clientAiToolResultSchema = z.discriminatedUnion("tool", [
  clientKnowledgeResultSchema,
  clientCountryProfileResultSchema,
  clientCompatibleProductsResultSchema,
  clientRegulationComparisonResultSchema,
  clientMarketComparisonResultSchema,
  clientOpportunityScoreResultSchema,
  clientSalesBriefResultSchema,
]);

export type ClientAiCitation = z.infer<typeof clientCitationSchema>;
export type ClientAiToolResult = z.infer<
  typeof clientAiToolResultSchema
>;
