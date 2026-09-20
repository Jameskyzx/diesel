import "server-only";

import { z } from "zod";

import { marketComparisonIssues, marketComparisonStatus } from "@/domain/marketing/comparison-consistency";

import {
  compareMarketsResultSchema,
  compareRegulationsResultSchema,
} from "@/features/ai/schemas";
import {
  compactModelToolOutputCitations,
  exactModelToolOutputSequence,
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
} from "@/features/database/schemas";
import {
  compareRegulationsInputSchema,
  marketMetricComparisonSchema,
  metricCodeSchema,
} from "@/features/marketing/schemas";

const regulationLimitProjectionSchema = z
  .object({
    id: z.uuid(),
    isDemo: z.boolean(),
    limitValue: z.string(),
    pollutantCode: z.string().trim().min(1),
    powerMaxKw: z.number().finite().positive().nullable(),
    powerMinKw: z.number().finite().nonnegative().nullable(),
    sourceId: z.uuid(),
    unitCode: z.string(),
    validFrom: isoDateSchema,
    validTo: isoDateSchema.nullable(),
  })
  .strict();

const regulationProjectionSchema = z
  .object({
    applicability: z
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
      .strict(),
    canonicalName: z.string().trim().min(1),
    citationCode: z.string().nullable(),
    effectiveFrom: isoDateSchema.nullable(),
    effectiveTo: isoDateSchema.nullable(),
    id: z.uuid(),
    isDemo: z.boolean(),
    limits: z.array(regulationLimitProjectionSchema),
    recordStatus: z.enum(["adopted", "effective", "superseded"]),
    sourceId: z.uuid(),
    status: z.enum(["adopted", "effective"]),
  })
  .strict();

const regulationCountryProjectionSchema = z
  .object({
    country: z
      .object({
        countryIso2: z.string().length(2).regex(/^[A-Z]{2}$/u),
        countryNameLocal: z.string().nullable(),
        isDemo: z.boolean(),
        sourceId: z.uuid(),
      })
      .strict()
      .nullable(),
    countryIsDemo: z.boolean(),
    countryIso3: iso3Schema,
    countryName: z.string().nullable(),
    currentEffective: z.array(regulationProjectionSchema),
    futureAdopted: z.array(regulationProjectionSchema),
    status: z.enum(["available", "no_data"]),
  })
  .strict();

type RegulationCountryProjection = z.infer<
  typeof regulationCountryProjectionSchema
>;

function regulationFactSourceIds(
  countries: readonly RegulationCountryProjection[],
): string[] {
  const sourceIds: string[] = [];
  for (const country of countries) {
    if (country.country !== null) sourceIds.push(country.country.sourceId);
    for (const regulation of [
      ...country.currentEffective,
      ...country.futureAdopted,
    ]) {
      sourceIds.push(
        regulation.sourceId,
        regulation.applicability.jurisdiction.sourceId,
        regulation.applicability.membership.sourceId,
        ...regulation.limits.map(({ sourceId }) => sourceId),
      );
    }
  }
  return sourceIds;
}

function regulationCitationMatchesFact(
  citation: ModelToolOutputCitation,
  countries: readonly RegulationCountryProjection[],
): boolean {
  for (const country of countries) {
    if (
      country.country !== null &&
      citation.countryIso3 === country.countryIso3 &&
      citation.entityType === undefined &&
      citation.sourceId === country.country.sourceId
    ) {
      return true;
    }
    for (const regulation of [
      ...country.currentEffective,
      ...country.futureAdopted,
    ]) {
      if (
        citation.countryIso3 !== country.countryIso3 ||
        citation.regulationId !== regulation.id
      ) {
        continue;
      }
      if (
        citation.entityType === "regulation" &&
        citation.entityId === regulation.id &&
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
        regulation.limits.some(
          (limit) =>
            citation.entityType === "regulation_limit" &&
            citation.entityId === limit.id &&
            citation.sourceId === limit.sourceId,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function refineRegulationProjection(
  output: {
    citations: readonly ModelToolOutputCitation[];
    comparison: {
      countries: readonly RegulationCountryProjection[];
      missingData: readonly string[];
      query: z.infer<typeof compareRegulationsInputSchema>;
    };
    evidenceSufficient: boolean;
    informationAsOf: string;
    status: "error" | "no_data" | "ok";
  },
  context: z.RefinementCtx,
): void {
  const { countries, query } = output.comparison;
  const evidenceCountries = countries.filter(
    ({ currentEffective, futureAdopted }) =>
      currentEffective.length > 0 || futureAdopted.length > 0,
  ).length;
  const evidenceExpected =
    output.citations.length > 0 &&
    evidenceCountries >= Math.min(2, query.countryIso3s.length);
  if (
    output.evidenceSufficient !== evidenceExpected ||
    output.status !== (evidenceExpected ? "ok" : output.status === "error" ? "error" : "no_data")
  ) {
    context.addIssue({
      code: "custom",
      message: "Regulation projection status does not match its facts",
      path: ["status"],
    });
  }
  if (
    output.informationAsOf !== query.asOf ||
    !exactModelToolOutputSequence(
      countries.map(({ countryIso3 }) => countryIso3),
      query.countryIso3s,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Regulation projection query does not match its countries",
      path: ["comparison", "query"],
    });
  }
  for (const [countryIndex, country] of countries.entries()) {
    for (const [bucket, regulations] of [
      ["current", country.currentEffective],
      ["future", country.futureAdopted],
    ] as const) {
      for (const [regulationIndex, regulation] of regulations.entries()) {
        const validBucket =
          regulation.applicability.countryIso3 === country.countryIso3 &&
          (bucket === "current"
            ? regulation.status === "effective" &&
              regulation.effectiveFrom !== null &&
              regulation.effectiveFrom <= query.asOf &&
              (regulation.effectiveTo === null ||
                regulation.effectiveTo > query.asOf)
            : regulation.status === "adopted" &&
              (regulation.effectiveFrom === null ||
                regulation.effectiveFrom > query.asOf));
        if (!validBucket) {
          context.addIssue({
            code: "custom",
            message: "Regulation lifecycle bucket does not match the query",
            path: [
              "comparison",
              "countries",
              countryIndex,
              bucket,
              regulationIndex,
            ],
          });
        }
      }
    }
  }
  if (
    output.citations.some(
      (citation) => !regulationCitationMatchesFact(citation, countries),
    ) ||
    !modelToolOutputFactSourceClosureMatches(
      regulationFactSourceIds(countries),
      output.citations,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Regulation citations do not exactly cover visible facts",
      path: ["citations"],
    });
  }
}

export const regulationComparisonModelToolOutputSchema =
  modelToolOutputEnvelopeSchema
    .extend({
      comparison: z
        .object({
          countries: z.array(regulationCountryProjectionSchema),
          missingData: z.array(z.string()),
          query: compareRegulationsInputSchema,
        })
        .strict(),
      tool: z.literal("compareRegulations"),
    })
    .strict()
    .superRefine(refineModelToolOutputEnvelope)
    .superRefine(refineRegulationProjection)
    .superRefine(refineModelToolOutputSize);

const marketQueryProjectionSchema = z
  .object({
    applicationScope: applicationScopeSchema.nullable(),
    countryIso3s: z
      .array(iso3Schema)
      .min(2)
      .max(5)
      .refine((countries) => new Set(countries).size === countries.length),
    metricCodes: z
      .array(metricCodeSchema)
      .max(8)
      .refine((codes) => new Set(codes).size === codes.length),
  })
  .strict();

const marketObservationProjectionSchema = z
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
    sourceId: z.uuid(),
    unitCode: z.string(),
    valueNumeric: z.string(),
  })
  .strict();

const marketMetricProjectionSchema = z
  .object({
    comparisonStatus: z.enum([
      "comparable",
      "incomparable",
      "insufficient_data",
    ]),
    issues: marketMetricComparisonSchema.shape.issues,
    metricCode: metricCodeSchema,
    metricName: z.string(),
    observations: z.array(marketObservationProjectionSchema),
  })
  .strict();

type MarketMetricProjection = z.infer<typeof marketMetricProjectionSchema>;

function marketCitationMatchesFact(
  citation: ModelToolOutputCitation,
  metrics: readonly MarketMetricProjection[],
): boolean {
  return metrics.some((metric) =>
    metric.observations.some(
      (observation) =>
        citation.entityType === "market_metric" &&
        citation.entityId === observation.id &&
        citation.countryIso3 === observation.countryIso3 &&
        citation.sourceId === observation.sourceId,
    ),
  );
}

function refineMarketProjection(
  output: {
    citations: readonly ModelToolOutputCitation[];
    comparison: {
      metrics: readonly MarketMetricProjection[];
      missingData: readonly string[];
      query: z.infer<typeof marketQueryProjectionSchema>;
    };
    evidenceSufficient: boolean;
    status: "error" | "no_data" | "ok";
  },
  context: z.RefinementCtx,
): void {
  const evidenceExpected =
    output.citations.length > 0 &&
    output.comparison.metrics.some(
      ({ comparisonStatus }) => comparisonStatus === "comparable",
    );
  if (
    output.evidenceSufficient !== evidenceExpected ||
    output.status !== (evidenceExpected ? "ok" : output.status === "error" ? "error" : "no_data")
  ) {
    context.addIssue({
      code: "custom",
      message: "Market projection status does not match its facts",
      path: ["status"],
    });
  }
  if (
    output.status !== "error" &&
    !exactModelToolOutputSequence(
      output.comparison.metrics.map(({ metricCode }) => metricCode),
      output.comparison.query.metricCodes,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Market projection metrics do not match the explicit query",
      path: ["comparison", "query", "metricCodes"],
    });
  }
  for (const [metricIndex, metric] of output.comparison.metrics.entries()) {
    const issues = marketComparisonIssues(metric.observations, output.comparison.query.countryIso3s);
    if (
      !exactModelToolOutputSequence(metric.issues, issues) ||
      metric.comparisonStatus !== marketComparisonStatus(issues)
    ) {
      context.addIssue({
        code: "custom",
        message: "Market projection comparability must match its observation basis",
        path: ["comparison", "metrics", metricIndex, "issues"],
      });
    }
    if (
      metric.observations.some(
        (observation) =>
          observation.metricCode !== metric.metricCode ||
          observation.metricName !== metric.metricName ||
          !output.comparison.query.countryIso3s.includes(
            observation.countryIso3,
          ),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Market observation does not match its metric query",
        path: ["comparison", "metrics", metricIndex, "observations"],
      });
    }
  }
  const sourceIds = output.comparison.metrics.flatMap(({ observations }) =>
    observations.map(({ sourceId }) => sourceId),
  );
  if (
    output.citations.some(
      (citation) =>
        !marketCitationMatchesFact(citation, output.comparison.metrics),
    ) ||
    !modelToolOutputFactSourceClosureMatches(sourceIds, output.citations)
  ) {
    context.addIssue({
      code: "custom",
      message: "Market citations do not exactly cover visible observations",
      path: ["citations"],
    });
  }
}

export const marketComparisonModelToolOutputSchema =
  modelToolOutputEnvelopeSchema
    .extend({
      comparison: z
        .object({
          metrics: z.array(marketMetricProjectionSchema),
          missingData: z.array(z.string()),
          query: marketQueryProjectionSchema,
        })
        .strict(),
      tool: z.literal("compareMarkets"),
    })
    .strict()
    .superRefine(refineModelToolOutputEnvelope)
    .superRefine(refineMarketProjection)
    .superRefine(refineModelToolOutputSize);

function projectRegulation(
  regulation: z.infer<
    typeof compareRegulationsResultSchema
  >["comparison"]["countries"][number]["currentEffectiveRegulations"][number],
) {
  return {
    applicability: {
      countryIso3: regulation.applicability.countryIso3,
      jurisdiction: {
        code: regulation.applicability.jurisdiction.code,
        id: regulation.applicability.jurisdiction.id,
        isDemo: regulation.applicability.jurisdiction.isDemo,
        name: regulation.applicability.jurisdiction.name,
        sourceId: regulation.applicability.jurisdiction.source.sourceId,
      },
      membership: {
        isDemo: regulation.applicability.membership.isDemo,
        sourceId: regulation.applicability.membership.source.sourceId,
        validFrom: regulation.applicability.membership.validFrom,
        validTo: regulation.applicability.membership.validTo,
      },
    },
    canonicalName: regulation.canonicalName,
    citationCode: regulation.citationCode,
    effectiveFrom: regulation.effectiveFrom,
    effectiveTo: regulation.effectiveTo,
    id: regulation.id,
    isDemo: regulation.isDemo,
    limits: regulation.limits.map((limit) => ({
      id: limit.id,
      isDemo: limit.isDemo,
      limitValue: limit.limitValue,
      pollutantCode: limit.pollutantCode,
      powerMaxKw: limit.powerMaxKw,
      powerMinKw: limit.powerMinKw,
      sourceId: limit.source.sourceId,
      unitCode: limit.unitCode,
      validFrom: limit.validFrom,
      validTo: limit.validTo,
    })),
    recordStatus: regulation.recordStatus,
    sourceId: regulation.source.sourceId,
    status: regulation.status,
  };
}

export function regulationComparisonResultToModelOutput(output: unknown) {
  const result = compareRegulationsResultSchema.parse(output);
  const citations = compactModelToolOutputCitations(result.citations);
  return regulationComparisonModelToolOutputSchema.parse({
    citations,
    comparison: {
      countries: result.comparison.countries.map((country) => ({
        country:
          country.countrySource === null
            ? null
            : {
                countryIso2: country.countrySource.countryIso2,
                countryNameLocal: country.countrySource.countryNameLocal,
                isDemo: country.countrySource.isDemo,
                sourceId: country.countrySource.id,
              },
        countryIsDemo: country.countryIsDemo,
        countryIso3: country.countryIso3,
        countryName: country.countryName,
        currentEffective: country.currentEffectiveRegulations.map(
          projectRegulation,
        ),
        futureAdopted: country.futureAdoptedRegulations.map(projectRegulation),
        status: country.status,
      })),
      missingData: result.comparison.missingData,
      query: result.comparison.query,
    },
    evidenceSufficient: result.evidenceSufficient,
    informationAsOf: result.informationAsOf,
    latestVerifiedAt: result.latestVerifiedAt,
    projectionVersion: SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
    sources: modelToolOutputSourceRegistry(result.citations),
    status: result.status,
    tool: result.tool,
    warnings: result.warnings,
  });
}

export function marketComparisonResultToModelOutput(output: unknown) {
  const result = compareMarketsResultSchema.parse(output);
  const citations = compactModelToolOutputCitations(result.citations);
  const metricCodes =
    result.comparison.query.metricCodes ??
    result.comparison.metrics.map(({ metricCode }) => metricCode);
  return marketComparisonModelToolOutputSchema.parse({
    citations,
    comparison: {
      metrics: result.comparison.metrics.map((metric) => ({
        comparisonStatus: metric.comparisonStatus,
        issues: metric.issues,
        metricCode: metric.metricCode,
        metricName: metric.metricName,
        observations: metric.observations.map((observation) => ({
          applicationScope: observation.applicationScope,
          countryIso3: observation.countryIso3,
          countryName: observation.countryName,
          currencyCode: observation.currencyCode,
          definition: observation.definition,
          id: observation.id,
          isDemo: observation.isDemo,
          methodologyVersion: observation.methodologyVersion,
          metricCode: observation.metricCode,
          metricName: observation.metricName,
          periodEnd: observation.periodEnd,
          periodStart: observation.periodStart,
          publishedOn: observation.publishedOn,
          sourceId: observation.source.sourceId,
          unitCode: observation.unitCode,
          valueNumeric: observation.valueNumeric,
        })),
      })),
      missingData: result.comparison.missingData,
      query: {
        applicationScope: result.comparison.query.applicationScope ?? null,
        countryIso3s: result.comparison.query.countryIso3s,
        metricCodes,
      },
    },
    evidenceSufficient: result.evidenceSufficient,
    informationAsOf: result.informationAsOf,
    latestVerifiedAt: result.latestVerifiedAt,
    projectionVersion: SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
    sources: modelToolOutputSourceRegistry(result.citations),
    status: result.status,
    tool: result.tool,
    warnings: result.warnings,
  });
}
