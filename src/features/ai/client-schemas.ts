import { z } from "zod";

import { countryDetailResponseMatchesDeterministicRules } from "@/domain/countries/detail-consistency";
import { aiKnowledgeSearchResultMatchesDeterministicRules } from "@/domain/knowledge/search-consistency";
import {
  marketComparisonMatchesDeterministicRules,
  marketComparisonStatus,
  regulationComparisonMatchesDeterministicRules,
} from "@/domain/marketing/comparison-consistency";
import { opportunityScorecardMatchesTrustedProvenance } from "@/domain/marketing/analysis-provenance";
import { salesBriefMatchesDeterministicRules } from "@/domain/marketing/sales-brief-consistency";
import { productFitEvaluationMatchesDeterministicRules } from "@/domain/product-fit/evaluation-consistency";
import { citationLocatorDescriptorSchema } from "@/features/ai/citation-locator";
import { citationTitleDescriptorSchema } from "@/features/ai/citation-title";
import {
  aiToolResultWarningsMatchFacts,
  canonicalToolErrorResultMatchesNoFacts,
} from "@/features/ai/tool-result-envelope";
import {
  aiEvidenceCitationsMatchFacts,
  citationHasPairedEntityIdentity,
  compatibleProductPayloadMatchesQuery,
  countryProfilePayloadMatchesQuery,
  evidenceEntityTypes,
  expectedAiEvidenceSufficiency,
  latestVerifiedAtMatchesCitations,
} from "@/features/ai/evidence-semantics";
import {
  applicationScopeSchema,
  httpUrlSchema,
  iso3Schema,
  marketMetricDecimalSchema,
  regulationLimitDecimalSchema,
} from "@/features/database/schemas";
import { hybridSearchResponseSchema } from "@/features/knowledge/schemas";
import type { CountryDetailResponse } from "@/features/countries/schemas";
import {
  compareMarketsInputSchema,
  compareRegulationsInputSchema,
  countryOpportunityScoreSchema,
  marketMetricComparisonSchema,
  opportunityScorecardSchema,
  salesBriefSchema,
  type MarketComparison,
  type OpportunityScorecard,
  type RegulationComparison,
  type SalesBrief,
} from "@/features/marketing/schemas";
import {
  productFitReasonCodeSchema,
  type ProductFitEvaluation,
  type ProductFitReasonCode,
} from "@/features/product-fit/schemas";

const isoTimestampSchema = z.iso.datetime({ offset: true });
const nonEmptyTextSchema = z.string().trim().min(1);

const clientCitationSchema = z
  .object({
    chunkId: nonEmptyTextSchema.nullable(),
    countryIso3: iso3Schema.nullable(),
    documentId: nonEmptyTextSchema.nullable(),
    documentTitle: nonEmptyTextSchema.nullable(),
    entityId: nonEmptyTextSchema.nullable().optional(),
    entityType: z.enum(evidenceEntityTypes).nullable().optional(),
    isDemo: z.boolean(),
    locator: nonEmptyTextSchema.nullable(),
    locatorDescriptor: citationLocatorDescriptorSchema.nullable().optional(),
    pageFrom: z.number().int().positive().nullable(),
    pageTo: z.number().int().positive().nullable(),
    productCertificationId: nonEmptyTextSchema.nullable(),
    publishedOn: z.iso.date().nullable(),
    regulationId: nonEmptyTextSchema.nullable(),
    regulationStatus: z
      .enum(["proposed", "adopted", "effective", "superseded"])
      .nullable(),
    sectionLocator: nonEmptyTextSchema.nullable(),
    sourceId: nonEmptyTextSchema,
    sourceTitle: nonEmptyTextSchema,
    sourceUrl: httpUrlSchema.nullable(),
    title: nonEmptyTextSchema,
    titleDescriptor: citationTitleDescriptorSchema.nullable().optional(),
    verifiedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((citation, context) => {
    if (
      citation.pageFrom !== null &&
      citation.pageTo !== null &&
      citation.pageTo < citation.pageFrom
    ) {
      context.addIssue({
        code: "custom",
        message: "pageTo must be on or after pageFrom",
        path: ["pageTo"],
      });
    }
    if (!citationHasPairedEntityIdentity(citation)) {
      context.addIssue({
        code: "custom",
        message: "Citation entityType and entityId must appear together",
        path: ["entityId"],
      });
    }
  });

const clientToolResultBase = z.object({
  citations: z.array(clientCitationSchema),
  evidenceSufficient: z.boolean(),
  informationAsOf: z.iso.date(),
  latestVerifiedAt: isoTimestampSchema.nullable(),
  status: z.enum(["ok", "no_data", "error"]),
  warnings: z.array(nonEmptyTextSchema).max(100),
});

const clientEvidenceSourceIdentitySchema = z
  .object({
    id: nonEmptyTextSchema,
    isDemo: z.boolean(),
    title: nonEmptyTextSchema,
  })
  .passthrough();

const clientAnalysisSourceIdentitySchema = z
  .object({
    countryIso3: iso3Schema.nullable(),
    entityId: nonEmptyTextSchema,
    entityType: z.enum(evidenceEntityTypes),
    isDemo: z.boolean(),
    locatorDescriptor: citationLocatorDescriptorSchema.nullable().optional(),
    regulationId: nonEmptyTextSchema.nullable(),
    regulationStatus: z
      .enum(["proposed", "adopted", "effective", "superseded"])
      .nullable(),
    sourceId: nonEmptyTextSchema,
    sourceTitle: nonEmptyTextSchema,
  })
  .passthrough();

const clientRegulationQuerySchema = compareRegulationsInputSchema;

const clientCountryRegulationSchema = z
  .object({
    applicability: z
      .object({
        countryIso3: iso3Schema,
        jurisdiction: z
          .object({
            code: nonEmptyTextSchema,
            id: nonEmptyTextSchema,
            isDemo: z.boolean(),
            name: nonEmptyTextSchema,
            source: clientEvidenceSourceIdentitySchema,
          })
          .passthrough(),
        membership: z
          .object({
            source: clientEvidenceSourceIdentitySchema,
            validFrom: z.iso.date(),
            validTo: z.iso.date().nullable(),
          })
          .passthrough()
          .superRefine((membership, context) => {
            if (
              membership.validTo !== null &&
              membership.validTo < membership.validFrom
            ) {
              context.addIssue({
                code: "custom",
                message: "validTo must be on or after validFrom",
                path: ["validTo"],
              });
            }
          }),
      })
      .passthrough(),
    canonicalName: nonEmptyTextSchema,
    id: nonEmptyTextSchema,
    isDemo: z.boolean(),
    source: clientEvidenceSourceIdentitySchema,
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
            iso3: iso3Schema,
            status: z.literal("no_data"),
          })
          .passthrough(),
        z
          .object({
            asOf: z.iso.date(),
            country: z
              .object({
                currentEffectiveRegulations: z.array(
                  clientCountryRegulationSchema,
                ),
                futureAdoptedRegulations: z.array(
                  clientCountryRegulationSchema,
                ),
                marketMetrics: z.array(
                  z
                    .object({
                      applicationScope: applicationScopeSchema.nullable(),
                      countryIso3: iso3Schema,
                      currencyCode: z
                        .string()
                        .length(3)
                        .regex(/^[A-Z]{3}$/)
                        .nullable(),
                      id: z.uuid(),
                      isDemo: z.boolean(),
                      metricCode: nonEmptyTextSchema,
                      metricName: nonEmptyTextSchema,
                      periodEnd: z.iso.date(),
                      periodStart: z.iso.date(),
                      source: clientEvidenceSourceIdentitySchema,
                      valueNumeric: marketMetricDecimalSchema,
                    })
                    .passthrough()
                    .superRefine((metric, context) => {
                      if (metric.periodEnd <= metric.periodStart) {
                        context.addIssue({
                          code: "custom",
                          message: "periodEnd must be after periodStart",
                          path: ["periodEnd"],
                        });
                      }
                    }),
                ),
                isDemo: z.boolean(),
                iso3: iso3Schema,
                source: clientEvidenceSourceIdentitySchema,
              })
              .passthrough()
              .superRefine((country, context) => {
                if (
                  country.currentEffectiveRegulations.some(
                    (regulation) =>
                      regulation.statusAtAsOf !== "effective",
                  )
                ) {
                  context.addIssue({
                    code: "custom",
                    message:
                      "Current-effective profile regulations must be effective at the query date",
                    path: ["currentEffectiveRegulations"],
                  });
                }
                if (
                  country.futureAdoptedRegulations.some(
                    (regulation) => regulation.statusAtAsOf !== "adopted",
                  )
                ) {
                  context.addIssue({
                    code: "custom",
                    message:
                      "Future-adopted profile regulations must be adopted at the query date",
                    path: ["futureAdoptedRegulations"],
                  });
                }
              }),
            status: z.literal("available"),
          })
          .passthrough(),
        z.null(),
      ]),
    requestedTopics: z
      .array(z.enum(["country", "regulations", "market"]))
      .min(1)
      .max(3)
      .refine(
        (topics) => new Set(topics).size === topics.length,
        "requestedTopics must not contain duplicates",
      ),
    resolvedCountryIso3: iso3Schema.nullable(),
    tool: z.literal("getCountryProfile"),
  })
  .strict();

const clientKnowledgeResultSchema = clientToolResultBase
  .extend({
    resolvedCountryIso3: iso3Schema.nullable(),
    search: hybridSearchResponseSchema,
    tool: z.literal("searchKnowledgeBase"),
  })
  .strict();

const productFitReasonStatusByCode = {
  APPLICATION_SCOPE_MATCH: "pass",
  APPLICATION_SCOPE_MISMATCH: "fail",
  CERTIFICATION_EXPIRED: "fail",
  CERTIFICATION_INACTIVE: "fail",
  CERTIFICATION_MATCH: "pass",
  CERTIFICATION_MISSING: "unknown",
  CERTIFICATION_PRODUCT_MISMATCH: "fail",
  CERTIFICATION_NOT_YET_VALID: "fail",
  CERTIFICATION_POWER_OUT_OF_RANGE: "fail",
  CERTIFICATION_POWER_RANGE_UNKNOWN: "unknown",
  CERTIFICATION_SCOPE_MISMATCH: "fail",
  CERTIFICATION_STATUS_UNKNOWN: "unknown",
  CERTIFICATION_VALIDITY_UNKNOWN: "unknown",
  NO_APPLICABLE_REGULATION_DATA: "unknown",
  PRODUCT_AVAILABILITY_UNKNOWN: "unknown",
  PRODUCT_AVAILABLE: "pass",
  PRODUCT_NOT_FOUND: "unknown",
  PRODUCT_NOT_YET_AVAILABLE: "fail",
  PRODUCT_NO_LONGER_AVAILABLE: "fail",
  PRODUCT_POWER_MATCH: "pass",
  PRODUCT_POWER_OUT_OF_RANGE: "fail",
} as const satisfies Record<
  ProductFitReasonCode,
  "fail" | "pass" | "unknown"
>;

const clientProductFitReasonSchema = z
  .object({
    code: productFitReasonCodeSchema,
    message: nonEmptyTextSchema,
    status: z.enum(["pass", "fail", "unknown"]),
  })
  .passthrough()
  .superRefine((reason, context) => {
    if (reason.status !== productFitReasonStatusByCode[reason.code]) {
      context.addIssue({
        code: "custom",
        message: "Product-fit reason status does not match its reason code",
        path: ["status"],
      });
    }
  });

const productAvailabilityReasonCodes = new Set<ProductFitReasonCode>([
  "PRODUCT_AVAILABLE",
  "PRODUCT_NOT_YET_AVAILABLE",
  "PRODUCT_NO_LONGER_AVAILABLE",
  "PRODUCT_AVAILABILITY_UNKNOWN",
  "PRODUCT_NOT_FOUND",
]);

const clientProductAvailabilityCheckSchema = clientProductFitReasonSchema
  .safeExtend({
    code: productFitReasonCodeSchema,
  })
  .superRefine((reason, context) => {
    if (!productAvailabilityReasonCodes.has(reason.code)) {
      context.addIssue({
        code: "custom",
        message: "Availability check must use a product availability code",
        path: ["code"],
      });
    }
  });

const clientProductRegulationIdentitySchema = z
  .object({
    applicability: z
      .object({
        countryIso3: iso3Schema,
        jurisdiction: z
          .object({
            id: nonEmptyTextSchema,
            source: clientEvidenceSourceIdentitySchema,
          })
          .passthrough(),
        membership: z
          .object({ source: clientEvidenceSourceIdentitySchema })
          .passthrough(),
      })
      .passthrough(),
    limitSources: z.array(clientEvidenceSourceIdentitySchema),
    recordStatus: z.enum(["effective", "superseded"]),
    regulationId: nonEmptyTextSchema,
    source: clientEvidenceSourceIdentitySchema,
  })
  .passthrough();

const clientProductRegulationCheckIdentitySchema = z
  .object({
    certifications: z.array(
      z
        .object({
          certification: z
            .object({
              id: nonEmptyTextSchema,
              productId: nonEmptyTextSchema,
              productModelCode: nonEmptyTextSchema,
              regulationId: nonEmptyTextSchema,
              source: clientEvidenceSourceIdentitySchema,
            })
            .passthrough(),
        })
        .passthrough(),
    ),
    regulation: clientProductRegulationIdentitySchema,
  })
  .passthrough();

const clientCompatibleProductsResultSchema = clientToolResultBase
  .extend({
    evaluations: z.array(
      z
        .object({
          asOf: z.iso.date(),
          commercialReadiness: z.enum(["ready", "not_ready", "unknown"]),
          input: z
            .object({
              applicationScope: applicationScopeSchema,
              asOf: z.iso.date(),
              countryIso3: iso3Schema,
              powerKw: z.number().finite().nonnegative(),
              productModelCode: nonEmptyTextSchema,
            })
            .passthrough(),
          product: z
            .object({
              availableFrom: z.iso.date().nullable(),
              availableTo: z.iso.date().nullable(),
              id: nonEmptyTextSchema,
              isDemo: z.boolean(),
              modelCode: nonEmptyTextSchema,
              name: nonEmptyTextSchema,
              source: clientEvidenceSourceIdentitySchema,
              specificationVersion: nonEmptyTextSchema,
            })
            .passthrough()
            .superRefine((product, context) => {
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
            })
            .nullable(),
          reasons: z.array(clientProductFitReasonSchema).min(1),
          regulationChecks: z.array(
            clientProductRegulationCheckIdentitySchema,
          ),
          productChecks: z
            .object({
              availability: clientProductAvailabilityCheckSchema,
            })
            .passthrough(),
          status: z.enum(["fit", "not_fit", "unknown"]),
          sources: z.array(clientEvidenceSourceIdentitySchema),
        })
        .passthrough()
        .superRefine((evaluation, context) => {
          const expectedSummaryStatus = {
            fit: "pass",
            not_fit: "fail",
            unknown: "unknown",
          } as const;
          if (
            evaluation.reasons[0]?.status !==
            expectedSummaryStatus[evaluation.status]
          ) {
            context.addIssue({
              code: "custom",
              message: "Product-fit summary status is inconsistent",
              path: ["reasons", 0, "status"],
            });
          }

          const expectedReadiness =
            evaluation.status === "not_fit" ||
            evaluation.productChecks.availability.status === "fail"
              ? "not_ready"
              : evaluation.status === "fit" &&
                  evaluation.productChecks.availability.status === "pass"
                ? "ready"
                : "unknown";
          if (evaluation.commercialReadiness !== expectedReadiness) {
            context.addIssue({
              code: "custom",
              message: "Commercial readiness is inconsistent",
              path: ["commercialReadiness"],
            });
          }

          if (evaluation.product === null && evaluation.status !== "unknown") {
            context.addIssue({
              code: "custom",
              message: "A missing product cannot have a conclusive fit status",
              path: ["status"],
            });
          }
          if (
            (evaluation.product === null) !==
            (evaluation.productChecks.availability.code === "PRODUCT_NOT_FOUND")
          ) {
            context.addIssue({
              code: "custom",
              message: "Product presence and availability evidence disagree",
              path: ["productChecks", "availability", "code"],
            });
          }
        }),
    ),
    query: z
      .object({
        applicationScope: applicationScopeSchema,
        asOf: z.iso.date(),
        countryIso3: iso3Schema.nullable(),
        powerKw: z.number().finite().nonnegative(),
        productModelCode: nonEmptyTextSchema.optional(),
      })
      .passthrough(),
    tool: z.literal("findCompatibleProducts"),
  })
  .strict();

const clientRegulationApplicabilitySchema = z
  .object({
    countryIso3: iso3Schema,
    jurisdiction: z
      .object({
        code: nonEmptyTextSchema,
        id: nonEmptyTextSchema,
        isDemo: z.boolean(),
        name: nonEmptyTextSchema,
        source: clientAnalysisSourceIdentitySchema,
      })
      .passthrough(),
    membership: z
      .object({
        source: clientAnalysisSourceIdentitySchema,
        validFrom: z.iso.date(),
        validTo: z.iso.date().nullable(),
      })
      .passthrough()
      .superRefine((membership, context) => {
        if (
          membership.validTo !== null &&
          membership.validTo < membership.validFrom
        ) {
          context.addIssue({
            code: "custom",
            message: "validTo must be on or after validFrom",
            path: ["validTo"],
          });
        }
      }),
  })
  .passthrough();

const clientRegulationLimitSchema = z
  .object({
    id: nonEmptyTextSchema,
    limitValue: regulationLimitDecimalSchema,
    pollutantCode: nonEmptyTextSchema,
    powerMaxKw: z.number().finite().positive().nullable(),
    powerMinKw: z.number().finite().nonnegative().nullable(),
    unitCode: nonEmptyTextSchema,
    validFrom: z.iso.date(),
    validTo: z.iso.date().nullable(),
    source: clientAnalysisSourceIdentitySchema,
  })
  .passthrough()
  .superRefine((limit, context) => {
    if (limit.validTo !== null && limit.validTo < limit.validFrom) {
      context.addIssue({
        code: "custom",
        message: "validTo must be on or after validFrom",
        path: ["validTo"],
      });
    }
  });

const clientRegulationComparisonItemSchema = z
  .object({
    applicability: clientRegulationApplicabilitySchema,
    canonicalName: nonEmptyTextSchema,
    effectiveFrom: z.iso.date().nullable(),
    effectiveTo: z.iso.date().nullable(),
    id: nonEmptyTextSchema,
    isDemo: z.boolean(),
    limits: z.array(clientRegulationLimitSchema),
    recordStatus: z
      .enum(["adopted", "effective", "superseded"]),
    status: z.enum(["adopted", "effective"]),
    source: clientAnalysisSourceIdentitySchema,
  })
  .passthrough();

const clientRegulationComparisonResultSchema = clientToolResultBase
  .extend({
    comparison: z
      .object({
        countries: z.array(
          z
            .object({
              countryIsDemo: z.boolean(),
              countryIso3: iso3Schema,
              countryName: nonEmptyTextSchema.nullable(),
              countrySource: z
                .object({
                  countryIso2: z
                    .string()
                    .length(2)
                    .regex(/^[A-Z]{2}$/),
                  countryNameLocal: nonEmptyTextSchema.nullable(),
                  id: nonEmptyTextSchema,
                  isDemo: z.boolean(),
                  publishedOn: z.iso.date().nullable(),
                  title: nonEmptyTextSchema,
                  url: httpUrlSchema.nullable(),
                  verifiedAt: isoTimestampSchema,
                })
                .strict()
                .nullable(),
              currentEffectiveRegulations: z.array(
                clientRegulationComparisonItemSchema,
              ),
              futureAdoptedRegulations: z.array(
                clientRegulationComparisonItemSchema,
              ),
              status: z.enum(["available", "no_data"]),
            })
            .passthrough()
            .superRefine((country, context) => {
              const regulations = [
                ...country.currentEffectiveRegulations,
                ...country.futureAdoptedRegulations,
              ];
              const shouldBeAvailable =
                country.countryName !== null &&
                country.countrySource !== null &&
                regulations.length > 0;
              if (
                country.status !==
                (shouldBeAvailable ? "available" : "no_data")
              ) {
                context.addIssue({
                  code: "custom",
                  message: "Country comparison status is inconsistent",
                  path: ["status"],
                });
              }
              if (
                country.currentEffectiveRegulations.some(
                  (regulation) => regulation.status !== "effective",
                )
              ) {
                context.addIssue({
                  code: "custom",
                  message:
                    "Current-effective regulations must be effective at the query date",
                  path: ["currentEffectiveRegulations"],
                });
              }
              if (
                country.futureAdoptedRegulations.some(
                  (regulation) => regulation.status !== "adopted",
                )
              ) {
                context.addIssue({
                  code: "custom",
                  message:
                    "Future-adopted regulations must be adopted at the query date",
                  path: ["futureAdoptedRegulations"],
                });
              }
            }),
        ),
        missingData: z.array(z.string()),
        query: clientRegulationQuerySchema,
        sources: z.array(clientAnalysisSourceIdentitySchema),
      })
      .passthrough(),
    tool: z.literal("compareRegulations"),
  })
  .strict();

const clientMarketIssueSchema = marketMetricComparisonSchema.shape.issues.element;

const clientMarketQuerySchema = compareMarketsInputSchema;

const clientMarketComparisonMetricSchema = z
  .object({
    comparisonStatus: z.enum([
      "comparable",
      "incomparable",
      "insufficient_data",
    ]),
    issues: z.array(clientMarketIssueSchema),
    metricCode: nonEmptyTextSchema,
    metricName: nonEmptyTextSchema,
    observations: z.array(
      z
        .object({
          applicationScope: applicationScopeSchema.nullable(),
          countryIso3: iso3Schema,
          currencyCode: z.string().length(3).nullable(),
          definition: z.string(),
          id: nonEmptyTextSchema,
          isDemo: z.boolean(),
          methodologyVersion: z.string(),
          metricCode: nonEmptyTextSchema,
          metricName: nonEmptyTextSchema,
          periodEnd: z.iso.date(),
          periodStart: z.iso.date(),
          source: clientAnalysisSourceIdentitySchema,
          // Preserve missing basis on a sourced, insufficient-data observation.
          // The full deterministic check below rejects a comparable blank unit.
          unitCode: z.string(),
          valueNumeric: marketMetricDecimalSchema,
        })
        .passthrough(),
    ),
  })
  .passthrough()
  .superRefine((metric, context) => {
    const expectedStatus = marketComparisonStatus(metric.issues);
    if (metric.comparisonStatus !== expectedStatus) {
      context.addIssue({
        code: "custom",
        message: "Market comparison status is inconsistent with its issues",
        path: ["comparisonStatus"],
      });
    }
    if (
      metric.comparisonStatus === "comparable" &&
      metric.observations.length < 2
    ) {
      context.addIssue({
        code: "custom",
        message: "A comparable metric requires at least two observations",
        path: ["observations"],
      });
    }
  });

const clientMarketComparisonResultSchema = clientToolResultBase
  .extend({
    comparison: z
      .object({
        metrics: z.array(clientMarketComparisonMetricSchema),
        missingData: z.array(z.string()),
        query: clientMarketQuerySchema,
        sources: z.array(clientAnalysisSourceIdentitySchema),
      })
      .passthrough(),
    tool: z.literal("compareMarkets"),
  })
  .strict();


const clientOpportunityScoreResultSchema = clientToolResultBase
  .extend({
    scorecard: opportunityScorecardSchema,
    tool: z.literal("calculateOpportunityScore"),
  })
  .strict();

const clientSalesBriefResultSchema = clientToolResultBase
  .extend({
    brief: salesBriefSchema,
    tool: z.literal("generateSalesBrief"),
  })
  .strict();

const clientAiToolResultUnionSchema = z.discriminatedUnion("tool", [
  clientKnowledgeResultSchema,
  clientCountryProfileResultSchema,
  clientCompatibleProductsResultSchema,
  clientRegulationComparisonResultSchema,
  clientMarketComparisonResultSchema,
  clientOpportunityScoreResultSchema,
  clientSalesBriefResultSchema,
]);

type ClientAiToolResultUnion = z.infer<
  typeof clientAiToolResultUnionSchema
>;

type ClientCountryScore = z.infer<typeof countryOpportunityScoreSchema>;

function hasMatchingCountrySequence(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((countryIso3, index) => countryIso3 === expected[index])
  );
}

function hasVisibleScoreFacts(score: ClientCountryScore): boolean {
  return (
    score.overallScore !== null ||
    score.dataCoveragePct !== 0 ||
    score.components.some(
      (component) =>
        component.status === "available" ||
        component.effectiveWeight !== 0,
    )
  );
}

function hasVisibleStructuredFacts(
  result: ClientAiToolResultUnion,
): boolean {
  if (result.tool === "searchKnowledgeBase") {
    return result.search.results.length > 0;
  }
  if (result.tool === "getCountryProfile") {
    return result.profile?.status === "available";
  }
  if (result.tool === "findCompatibleProducts") {
    return result.evaluations.length > 0;
  }
  if (result.tool === "compareRegulations") {
    return result.comparison.countries.some(
      (country) =>
        country.countryIsDemo ||
        country.countryName !== null ||
        country.countrySource !== null ||
        country.currentEffectiveRegulations.length > 0 ||
        country.futureAdoptedRegulations.length > 0,
    );
  }
  if (result.tool === "compareMarkets") {
    // An explicitly requested metric can have a query-only, empty placeholder.
    // It is not a sourced observation; real observations still require citations.
    return result.comparison.metrics.some(({ observations }) => observations.length > 0);
  }
  if (result.tool === "calculateOpportunityScore") {
    return result.scorecard.scores.some(hasVisibleScoreFacts);
  }
  return (
    hasVisibleScoreFacts(result.brief.marketScore) ||
    result.brief.opportunities.length > 0 ||
    result.brief.recommendedProducts.length > 0 ||
    result.brief.risks.length > 0 ||
    result.brief.salesActions.length > 0
  );
}

function hasVisibleDemoEntity(result: ClientAiToolResultUnion): boolean {
  if (result.tool === "getCountryProfile") {
    return (
      result.profile?.status === "available" &&
      (result.profile.country.isDemo ||
        result.profile.country.source.isDemo ||
        result.profile.country.marketMetrics.some(({ isDemo }) => isDemo) ||
        [
          ...result.profile.country.currentEffectiveRegulations,
          ...result.profile.country.futureAdoptedRegulations,
        ].some(
          (regulation) =>
            regulation.isDemo ||
            regulation.applicability.jurisdiction.isDemo ||
            regulation.applicability.jurisdiction.source.isDemo,
        ))
    );
  }
  if (result.tool === "findCompatibleProducts") {
    return result.evaluations.some(
      ({ product }) =>
        product !== null && (product.isDemo || product.source.isDemo),
    );
  }
  if (result.tool === "compareRegulations") {
    return result.comparison.countries.some(
      (country) =>
        country.countryIsDemo ||
        country.countrySource?.isDemo === true ||
        [
          ...country.currentEffectiveRegulations,
          ...country.futureAdoptedRegulations,
        ].some(
          (regulation) =>
            regulation.isDemo ||
            regulation.applicability.jurisdiction.isDemo ||
            regulation.applicability.jurisdiction.source.isDemo,
        ),
    );
  }
  if (result.tool === "compareMarkets") {
    return result.comparison.metrics.some((metric) =>
      metric.observations.some(({ isDemo }) => isDemo),
    );
  }
  if (result.tool === "generateSalesBrief") {
    return result.brief.recommendedProducts.some(
      (product) => product.isDemo || product.source.isDemo,
    );
  }
  return false;
}

function safelyMatchesDeterministicRules(
  matcher: () => boolean,
): boolean {
  try {
    return matcher();
  } catch {
    return false;
  }
}

export const clientAiToolResultSchema = clientAiToolResultUnionSchema
  .superRefine((result, context) => {
    const hasStructuredFacts = hasVisibleStructuredFacts(result);

    if (!aiToolResultWarningsMatchFacts(result)) {
      context.addIssue({
        code: "custom",
        message: "Tool warnings do not match the structured result",
        path: ["warnings"],
      });
    }

    if (!canonicalToolErrorResultMatchesNoFacts(result)) {
      context.addIssue({
        code: "custom",
        message: "Failed tools may only expose a canonical no-facts result",
        path: ["status"],
      });
    }

    if (
      (result.status === "ok") !== result.evidenceSufficient ||
      (result.status === "error" && result.evidenceSufficient)
    ) {
      context.addIssue({
        code: "custom",
        message: "Tool status is inconsistent with evidence sufficiency",
        path: ["status"],
      });
    }

    if (
      result.evidenceSufficient !==
      expectedAiEvidenceSufficiency(result)
    ) {
      context.addIssue({
        code: "custom",
        message: "Evidence sufficiency does not match the structured result",
        path: ["evidenceSufficient"],
      });
    }

    if (!aiEvidenceCitationsMatchFacts(result)) {
      context.addIssue({
        code: "custom",
        message: "Visible facts must match their citation identities",
        path: ["citations"],
      });
    }

    if (
      result.tool === "searchKnowledgeBase" &&
      !safelyMatchesDeterministicRules(() =>
        aiKnowledgeSearchResultMatchesDeterministicRules(result),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Knowledge-search evidence does not match its public scores, filters, or trust boundary",
        path: ["search"],
      });
    }

    if (
      result.tool === "getCountryProfile" &&
      !countryProfilePayloadMatchesQuery(result)
    ) {
      context.addIssue({
        code: "custom",
        message: "Country-profile facts do not match the resolved query",
        path: ["profile"],
      });
    }

    if (
      result.tool === "getCountryProfile" &&
      result.profile !== null &&
      !safelyMatchesDeterministicRules(() =>
        countryDetailResponseMatchesDeterministicRules(
          result.profile as unknown as CountryDetailResponse,
        ),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Country-profile details do not match deterministic lifecycle and source rules",
        path: ["profile"],
      });
    }

    if (
      result.tool === "findCompatibleProducts" &&
      !compatibleProductPayloadMatchesQuery(result)
    ) {
      context.addIssue({
        code: "custom",
        message: "Product-fit evaluations do not match the public query",
        path: ["evaluations"],
      });
    }

    if (
      result.status !== "error" &&
      result.tool === "findCompatibleProducts" &&
      result.evaluations.some(
        (evaluation) =>
          !safelyMatchesDeterministicRules(() =>
            productFitEvaluationMatchesDeterministicRules(
              evaluation as unknown as ProductFitEvaluation,
            ),
          ),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Product-fit conclusions do not match their deterministic inputs",
        path: ["evaluations"],
      });
    }

    if (
      result.status !== "error" &&
      result.tool === "compareRegulations" &&
      !safelyMatchesDeterministicRules(() =>
        regulationComparisonMatchesDeterministicRules(
          result.comparison as unknown as RegulationComparison,
        ),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Regulation comparison does not match its deterministic query rules",
        path: ["comparison"],
      });
    }

    if (
      result.status !== "error" &&
      result.tool === "compareMarkets" &&
      !safelyMatchesDeterministicRules(() =>
        marketComparisonMatchesDeterministicRules(
          result.comparison as unknown as MarketComparison,
        ),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Market comparison does not match its deterministic query rules",
        path: ["comparison"],
      });
    }

    if (
      result.status !== "error" &&
      result.tool === "calculateOpportunityScore" &&
      !safelyMatchesDeterministicRules(() =>
        opportunityScorecardMatchesTrustedProvenance(
          result.scorecard as unknown as OpportunityScorecard,
        ),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Opportunity scorecard provenance is inconsistent",
        path: ["scorecard"],
      });
    }

    if (
      result.status !== "error" &&
      result.tool === "generateSalesBrief" &&
      !safelyMatchesDeterministicRules(() =>
        salesBriefMatchesDeterministicRules(
          result.brief as unknown as SalesBrief,
        ),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Sales brief does not match its deterministic visible facts",
        path: ["brief"],
      });
    }

    if (
      result.tool === "compareRegulations" &&
      !hasMatchingCountrySequence(
        result.comparison.countries.map(({ countryIso3 }) => countryIso3),
        result.comparison.query.countryIso3s,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Regulation result countries do not match the query",
        path: ["comparison", "countries"],
      });
    }

    if (
      result.tool === "calculateOpportunityScore" &&
      !hasMatchingCountrySequence(
        result.scorecard.scores.map(({ countryIso3 }) => countryIso3),
        result.scorecard.query.countryIso3s,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Score result countries do not match the query",
        path: ["scorecard", "scores"],
      });
    }

    if (hasStructuredFacts && result.citations.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Visible structured facts require a citation",
        path: ["citations"],
      });
    }

    if (!latestVerifiedAtMatchesCitations(result)) {
      context.addIssue({
        code: "custom",
        message: "Latest verification does not match the citation set",
        path: ["latestVerifiedAt"],
      });
    }

    if (
      hasVisibleDemoEntity(result) &&
      !result.citations.some(({ isDemo }) => isDemo)
    ) {
      context.addIssue({
        code: "custom",
        message: "Visible Demo entities require a Demo citation",
        path: ["citations"],
      });
    }

    if (result.tool === "findCompatibleProducts") {
      for (const [index, evaluation] of result.evaluations.entries()) {
        const expectedAvailabilityCode = evaluation.product === null
          ? "PRODUCT_NOT_FOUND"
          : evaluation.product.availableFrom === null ||
              evaluation.product.availableTo === null
            ? "PRODUCT_AVAILABILITY_UNKNOWN"
            : result.query.asOf < evaluation.product.availableFrom
              ? "PRODUCT_NOT_YET_AVAILABLE"
              : result.query.asOf >= evaluation.product.availableTo
                ? "PRODUCT_NO_LONGER_AVAILABLE"
                : "PRODUCT_AVAILABLE";
        if (
          evaluation.productChecks.availability.code !==
          expectedAvailabilityCode
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Product availability code does not match its dated evidence",
            path: [
              "evaluations",
              index,
              "productChecks",
              "availability",
              "code",
            ],
          });
        }
      }
    }
  });

export type ClientAiCitation = z.infer<typeof clientCitationSchema>;
export type ClientAiToolResult = z.infer<
  typeof clientAiToolResultSchema
>;
