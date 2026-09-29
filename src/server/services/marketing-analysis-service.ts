import "server-only";

import { compareCanonicalText } from "@/domain/canonical-order";
import {
  calculateProductReadiness,
  calculateRegulatoryCoverage,
  combineOpportunityScore,
  normalizeComparableMetric,
} from "@/domain/marketing/opportunity-score";
import { opportunityScorecardMatchesTrustedProvenance } from "@/domain/marketing/analysis-provenance";
import {
  marketComparisonIssues,
  marketComparisonMatchesDeterministicRules,
  marketComparisonStatus,
  regulationComparisonMatchesDeterministicRules,
} from "@/domain/marketing/comparison-consistency";
import { salesBriefMatchesDeterministicRules } from "@/domain/marketing/sales-brief-consistency";
import { OPPORTUNITY_SCORE_RULESET_VERSION } from "@/features/marketing/constants";
import { opportunityMetricDirection } from "@/features/marketing/opportunity-score-registry";
import {
  compareMarketsInputSchema,
  compareRegulationsInputSchema,
  calculateOpportunityScoreInputSchema,
  generateSalesBriefInputSchema,
  marketComparisonSchema,
  opportunityScorecardSchema,
  regulationComparisonSchema,
  salesBriefSchema,
  type AnalysisSource,
  type MarketComparison,
  type MarketObservation,
  type OpportunityScoreProvenance,
  type RegulationComparisonItem,
} from "@/features/marketing/schemas";
import type { ProductFitEvaluation } from "@/features/product-fit/schemas";
import {
  getOpportunityScoreWeights,
} from "@/server/config/opportunity-score-config";
import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import { createCountryRepository } from "@/server/repositories/country-repository";
import { createMarketRepository } from "@/server/repositories/market-repository";
import { createRegulationRepository } from "@/server/repositories/regulation-repository";
import { awaitStartedOperationsInOrder } from "@/server/http/settled-operation-barrier";
import { findCompatibleProducts } from "@/server/services/compatible-products-service";
import {
  throwIfRequestAborted,
  type RequestSignalOptions,
} from "@/server/http/request-signal";

function serializeTimestamp(value: Date): string {
  return value.toISOString();
}

function uniqueSources(sources: AnalysisSource[]): AnalysisSource[] {
  return Array.from(
    new Map(
      sources.map((source) => [
        `${source.countryIso3 ?? "global"}:${source.entityType}:${source.entityId}:${source.regulationId ?? "none"}:${source.sourceId}`,
        source,
      ]),
    ).values(),
  );
}

async function getCountryRepository(options: RequestSignalOptions = {}) {
  throwIfRequestAborted(options.signal);
  if (getDatabaseMode() === "pglite-demo") {
    const database = await getDemoDatabase();
    throwIfRequestAborted(options.signal);
    return createCountryRepository(database);
  }

  return createCountryRepository(getDatabase());
}

async function getMarketRepository(options: RequestSignalOptions = {}) {
  throwIfRequestAborted(options.signal);
  if (getDatabaseMode() === "pglite-demo") {
    const database = await getDemoDatabase();
    throwIfRequestAborted(options.signal);
    return createMarketRepository(database);
  }

  return createMarketRepository(getDatabase());
}

async function getRegulationRepository(options: RequestSignalOptions = {}) {
  throwIfRequestAborted(options.signal);
  if (getDatabaseMode() === "pglite-demo") {
    const database = await getDemoDatabase();
    throwIfRequestAborted(options.signal);
    return createRegulationRepository(database);
  }

  return createRegulationRepository(getDatabase());
}

/**
 * Waits for every already-started comparison read before propagating a
 * failure. Country failures win in query order, followed by the regulation
 * read, so callers never release request admission while sibling SQL is still
 * running and failure selection is deterministic.
 */
export async function awaitRegulationComparisonReads<TCountry, TRow>(input: {
  countryReads: readonly Promise<TCountry>[];
  regulationRead: Promise<readonly TRow[]>;
}): Promise<[TCountry[], readonly TRow[]]> {
  const countryBarrier = Promise.allSettled(input.countryReads);
  const regulationBarrier = Promise.allSettled([input.regulationRead]).then(
    ([outcome]) => outcome,
  );
  const [countryOutcomes, regulationOutcome] = await Promise.all([
    countryBarrier,
    regulationBarrier,
  ]);

  for (const countryOutcome of countryOutcomes) {
    if (countryOutcome.status === "rejected") {
      throw countryOutcome.reason;
    }
  }
  if (!regulationOutcome || regulationOutcome.status === "rejected") {
    throw (
      regulationOutcome?.reason ?? new Error("Regulation read did not settle.")
    );
  }

  return [
    countryOutcomes.map((outcome) => {
      if (outcome.status === "rejected") {
        throw outcome.reason;
      }
      return outcome.value;
    }),
    regulationOutcome.value,
  ];
}

export async function compareRegulations(
  input: unknown,
  options: RequestSignalOptions = {},
) {
  throwIfRequestAborted(options.signal);
  const query = compareRegulationsInputSchema.parse(input);
  const [countryRepository, regulationRepository] =
    await awaitStartedOperationsInOrder([
      getCountryRepository(options),
      getRegulationRepository(options),
    ] as const);
  throwIfRequestAborted(options.signal);
  return compareRegulationsFromRepositories(
    query,
    { countryRepository, regulationRepository },
    options,
  );
}

export type RegulationComparisonRepositories = {
  countryRepository: Pick<
    ReturnType<typeof createCountryRepository>,
    "findByIso3"
  >;
  regulationRepository: Pick<
    ReturnType<typeof createRegulationRepository>,
    "findForComparison"
  >;
};

/**
 * Runs the deterministic comparison against repositories supplied by the
 * caller. Country detail uses this entry point so its wide profile and the
 * optional applicability summary share one database transaction/snapshot.
 */
export async function compareRegulationsFromRepositories(
  input: unknown,
  repositories: RegulationComparisonRepositories,
  options: RequestSignalOptions = {},
) {
  throwIfRequestAborted(options.signal);
  const query = compareRegulationsInputSchema.parse(input);
  const { countryRepository, regulationRepository } = repositories;
  const [countryRecords, rows] = await awaitRegulationComparisonReads({
    countryReads: query.countryIso3s.map((iso3) =>
      countryRepository.findByIso3({ iso3 }, options),
    ),
    regulationRead: regulationRepository.findForComparison(query, options),
  });
  throwIfRequestAborted(options.signal);

  const countries = query.countryIso3s.map((countryIso3, countryIndex) => {
    const countryRecord = countryRecords[countryIndex] ?? null;
    const countryRows = rows.filter(
      (row) => row.countryIso3 === countryIso3,
    );
    const regulations = new Map<string, RegulationComparisonItem>();

    for (const row of countryRows) {
      if (
        row.status !== "effective" &&
        row.status !== "adopted" &&
        row.status !== "superseded"
      ) {
        throw new Error("Regulation comparison returned an invalid status.");
      }
      const statusAtAsOf =
        row.effectiveFrom !== null &&
        row.effectiveFrom <= query.asOf &&
        (row.effectiveTo === null || row.effectiveTo > query.asOf)
          ? ("effective" as const)
          : ("adopted" as const);
      const existing = regulations.get(row.regulationId);
      const limitSource: AnalysisSource = {
        countryIso3,
        entityId: row.limit.id,
        entityType: "regulation_limit",
        isDemo: row.limit.isDemo || row.limit.sourceIsDemo,
        locator: `${row.limit.pollutantCode} ${row.limit.validFrom}–${row.limit.validTo ?? "open"}`,
        locatorDescriptor: {
          kind: "regulation_limit_period",
          pollutantCode: row.limit.pollutantCode,
          validFrom: row.limit.validFrom,
          validTo: row.limit.validTo,
        },
        publishedOn: row.limit.sourcePublishedOn,
        regulationId: row.regulationId,
        regulationStatus: row.status,
        sourceId: row.limit.sourceId,
        sourceTitle: row.limit.sourceTitle,
        sourceUrl: row.limit.sourceUrl,
        title: `${row.canonicalName} ${row.limit.pollutantCode} 限值`,
        titleDescriptor: {
          kind: "regulation_pollutant_limit",
          pollutantCode: row.limit.pollutantCode,
          regulationName: row.canonicalName,
        },
        verifiedAt: serializeTimestamp(row.limit.sourceVerifiedAt),
      };
      const jurisdictionSource: AnalysisSource = {
        countryIso3,
        entityId: row.applicability.jurisdictionId,
        entityType: "jurisdiction",
        isDemo:
          row.applicability.jurisdictionIsDemo ||
          row.applicability.jurisdictionSourceIsDemo,
        locator: row.applicability.jurisdictionCode,
        publishedOn: row.applicability.jurisdictionSourcePublishedOn,
        regulationId: row.regulationId,
        regulationStatus: row.status,
        sourceId: row.applicability.jurisdictionSourceId,
        sourceTitle: row.applicability.jurisdictionSourceTitle,
        sourceUrl: row.applicability.jurisdictionSourceUrl,
        title: row.applicability.jurisdictionName,
        verifiedAt: serializeTimestamp(
          row.applicability.jurisdictionSourceVerifiedAt,
        ),
      };
      const membershipSource: AnalysisSource = {
        countryIso3,
        entityId: row.applicability.jurisdictionId,
        entityType: "country_jurisdiction",
        isDemo:
          row.applicability.membershipIsDemo ||
          row.applicability.membershipSourceIsDemo,
        locator: `${row.applicability.membershipValidFrom}–${row.applicability.membershipValidTo ?? "open"}`,
        locatorDescriptor: {
          kind: "membership_period",
          validFrom: row.applicability.membershipValidFrom,
          validTo: row.applicability.membershipValidTo,
        },
        publishedOn: row.applicability.membershipSourcePublishedOn,
        regulationId: row.regulationId,
        regulationStatus: row.status,
        sourceId: row.applicability.membershipSourceId,
        sourceTitle: row.applicability.membershipSourceTitle,
        sourceUrl: row.applicability.membershipSourceUrl,
        title: `${row.applicability.jurisdictionName} 对 ${countryIso3} 的成员关系`,
        titleDescriptor: {
          countryIso3,
          jurisdictionName: row.applicability.jurisdictionName,
          kind: "country_jurisdiction_membership",
        },
        verifiedAt: serializeTimestamp(
          row.applicability.membershipSourceVerifiedAt,
        ),
      };
      const limit = {
        id: row.limit.id,
        isDemo: row.limit.isDemo,
        limitValue: row.limit.limitValue,
        pollutantCode: row.limit.pollutantCode,
        powerMaxKw: row.limit.powerMaxKw,
        powerMinKw: row.limit.powerMinKw,
        source: limitSource,
        unitCode: row.limit.unitCode,
        validFrom: row.limit.validFrom,
        validTo: row.limit.validTo,
        verifiedAt: serializeTimestamp(row.limit.verifiedAt),
      };

      if (existing) {
        existing.limits.push(limit);
        continue;
      }

      regulations.set(row.regulationId, {
        applicability: {
          countryIso3,
          jurisdiction: {
            code: row.applicability.jurisdictionCode,
            id: row.applicability.jurisdictionId,
            isDemo: row.applicability.jurisdictionIsDemo,
            name: row.applicability.jurisdictionName,
            source: jurisdictionSource,
            verifiedAt: serializeTimestamp(
              row.applicability.jurisdictionVerifiedAt,
            ),
          },
          membership: {
            isDemo: row.applicability.membershipIsDemo,
            source: membershipSource,
            validFrom: row.applicability.membershipValidFrom,
            validTo: row.applicability.membershipValidTo,
            verifiedAt: serializeTimestamp(
              row.applicability.membershipVerifiedAt,
            ),
          },
        },
        canonicalName: row.canonicalName,
        citationCode: row.citationCode,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        id: row.regulationId,
        isDemo: row.isDemo,
        limits: [limit],
        recordStatus: row.status,
        source: {
          countryIso3,
          entityId: row.regulationId,
          entityType: "regulation",
          isDemo: row.isDemo || row.source.isDemo,
          locator: row.citationCode,
          publishedOn: row.source.publishedOn,
          regulationId: row.regulationId,
          regulationStatus: row.status,
          sourceId: row.source.id,
          sourceTitle: row.source.title,
          sourceUrl: row.source.url,
          title: row.canonicalName,
          verifiedAt: serializeTimestamp(row.source.verifiedAt),
        },
        status: statusAtAsOf,
        verifiedAt: serializeTimestamp(row.verifiedAt),
      });
    }

    const items = Array.from(regulations.values())
      .map((regulation) => ({
        ...regulation,
        limits: regulation.limits.toSorted((left, right) => compareCanonicalText(
          [
            left.pollutantCode,
            left.powerMinKw ?? -1,
            left.powerMaxKw ?? -1,
            left.validFrom,
            left.validTo ?? "",
            left.id,
          ].join("\u0000"),
          [
            right.pollutantCode,
            right.powerMinKw ?? -1,
            right.powerMaxKw ?? -1,
            right.validFrom,
            right.validTo ?? "",
            right.id,
          ].join("\u0000"),
        )),
      }))
      .toSorted((left, right) => compareCanonicalText(
        `${left.canonicalName}\u0000${left.id}`,
        `${right.canonicalName}\u0000${right.id}`,
      ));
    return {
      countryIsDemo: countryRecord?.isDemo ?? false,
      countryIso3,
      countryName: countryRecord?.nameEn ?? null,
      countrySource: countryRecord
        ? {
            countryIso2: countryRecord.iso2,
            countryNameLocal: countryRecord.nameLocal,
            id: countryRecord.source.id,
            isDemo: countryRecord.source.isDemo,
            publishedOn: countryRecord.source.publishedOn,
            title: countryRecord.source.title,
            url: countryRecord.source.url,
            verifiedAt: serializeTimestamp(countryRecord.source.verifiedAt),
          }
        : null,
      currentEffectiveRegulations: items.filter(
        ({ status }) => status === "effective",
      ),
      futureAdoptedRegulations: items.filter(
        ({ status }) => status === "adopted",
      ),
      status:
        countryRecord && items.length > 0
          ? ("available" as const)
          : ("no_data" as const),
    };
  });
  const missingData = countries.flatMap((country) => {
    if (country.countryName === null) {
      return [`${country.countryIso3} 没有国家结构化记录。`];
    }
    if (
      country.currentEffectiveRegulations.length === 0 &&
      country.futureAdoptedRegulations.length === 0
    ) {
      return [
        `${country.countryIso3} 在所选范围、功率和日期下没有可比较法规记录。`,
      ];
    }
    return [];
  });
  const sources = uniqueSources(
    countries.flatMap((country) =>
      [
        ...country.currentEffectiveRegulations,
        ...country.futureAdoptedRegulations,
      ].flatMap((regulation) => [
        regulation.applicability.jurisdiction.source,
        regulation.applicability.membership.source,
        regulation.source,
        ...regulation.limits.map(({ source }) => source),
      ]),
    ),
  );

  const comparison = regulationComparisonSchema.parse({
    countries,
    missingData,
    query,
    sources,
  });
  if (!regulationComparisonMatchesDeterministicRules(comparison)) {
    throw new Error(
      "Regulation comparison does not match deterministic rules.",
    );
  }

  return comparison;
}

function latestObservationsByCountry(
  observations: MarketObservation[],
): MarketObservation[] {
  const groups = new Map<string, MarketObservation[]>();

  for (const observation of observations) {
    const rows = groups.get(observation.countryIso3) ?? [];
    rows.push(observation);
    groups.set(observation.countryIso3, rows);
  }

  return Array.from(groups.values()).flatMap((rows) => {
    const latestPeriodEnd = rows
      .map(({ periodEnd }) => periodEnd)
      .toSorted()
      .at(-1);
    const periodEndRows = rows.filter(
      ({ periodEnd }) => periodEnd === latestPeriodEnd,
    );
    const latestPeriodStart = periodEndRows
      .map(({ periodStart }) => periodStart)
      .toSorted()
      .at(-1);
    return periodEndRows.filter(
      ({ periodStart }) => periodStart === latestPeriodStart,
    );
  });
}

export async function compareMarkets(
  input: unknown,
  options: RequestSignalOptions = {},
) {
  throwIfRequestAborted(options.signal);
  const query = compareMarketsInputSchema.parse(input);
  const repository = await getMarketRepository(options);
  throwIfRequestAborted(options.signal);
  const rows = await repository.findForComparison(query, options);
  throwIfRequestAborted(options.signal);
  const observations = rows.map(
    (row): MarketObservation => ({
      applicationScope: row.applicationScope,
      countryIso3: row.countryIso3,
      countryName: row.countryName,
      currencyCode: row.currencyCode,
      definition: row.definition,
      id: row.id,
      isDemo: row.isDemo,
      methodologyVersion: row.methodologyVersion,
      metricCode: row.metricCode,
      metricName: row.metricName,
      periodEnd: row.periodEnd,
      periodStart: row.periodStart,
      publishedOn: row.publishedOn,
      source: {
        countryIso3: row.countryIso3,
        entityId: row.id,
        entityType: "market_metric",
        isDemo: row.isDemo || row.source.isDemo,
        locator: `${row.periodStart}–${row.periodEnd}`,
        locatorDescriptor: {
          kind: "market_period",
          periodEnd: row.periodEnd,
          periodStart: row.periodStart,
        },
        publishedOn: row.publishedOn ?? row.source.publishedOn,
        regulationId: null,
        regulationStatus: null,
        sourceId: row.source.id,
        sourceTitle: row.source.title,
        sourceUrl: row.source.url,
        title: row.metricName,
        titleDescriptor: {
          isDemo: row.isDemo,
          kind: "market_metric",
          metricCode: row.metricCode,
          metricId: row.id,
          metricName: row.metricName,
        },
        verifiedAt: serializeTimestamp(row.source.verifiedAt),
      },
      unitCode: row.unitCode,
      valueNumeric: row.valueNumeric,
      verifiedAt: serializeTimestamp(row.verifiedAt),
    }),
  );
  const metricCodes =
    query.metricCodes ??
    Array.from(new Set(observations.map(({ metricCode }) => metricCode))).sort();
  const metrics: MarketComparison["metrics"] = metricCodes.map(
    (metricCode) => {
      const countryOrder = new Map(
        query.countryIso3s.map((countryIso3, index) => [countryIso3, index]),
      );
      const metricObservations = latestObservationsByCountry(
        observations.filter(
          (observation) => observation.metricCode === metricCode,
        ),
      ).toSorted(
        (left, right) =>
          (countryOrder.get(left.countryIso3) ?? Number.MAX_SAFE_INTEGER) -
            (countryOrder.get(right.countryIso3) ??
              Number.MAX_SAFE_INTEGER) ||
          compareCanonicalText(right.periodEnd, left.periodEnd) ||
          compareCanonicalText(right.periodStart, left.periodStart) ||
          compareCanonicalText(left.id, right.id),
      );
      const issues = marketComparisonIssues(metricObservations, query.countryIso3s);
      return {
        comparisonStatus: marketComparisonStatus(issues),
        issues,
        metricCode,
        metricName:
          metricObservations[0]?.metricName ?? metricCode,
        observations: metricObservations,
      };
    },
  );
  const missingData = metrics.flatMap((metric) => {
    if (metric.comparisonStatus === "comparable") {
      return [];
    }
    return [
      `${metric.metricCode} 不可比较：${metric.issues.join(", ") || "没有观测值"}。`,
    ];
  });

  if (metrics.length === 0) {
    missingData.push("所选国家没有结构化市场指标。");
  }

  throwIfRequestAborted(options.signal);
  const comparison = marketComparisonSchema.parse({
    metrics,
    missingData,
    query,
    sources: uniqueSources(
      metrics.flatMap((metric) =>
        metric.observations.map(({ source }) => source),
      ),
    ),
  });
  if (!marketComparisonMatchesDeterministicRules(comparison)) {
    throw new Error("Market comparison does not match deterministic rules.");
  }

  return comparison;
}

export function productAnalysisSources(
  countryIso3: string,
  evaluations: ProductFitEvaluation[],
): AnalysisSource[] {
  return evaluations.flatMap((evaluation) => {
    const product = evaluation.product;
    const productSources: AnalysisSource[] = product
      ? [
          {
            countryIso3,
            entityId: product.id,
            entityType: "product",
            isDemo:
              product.isDemo || product.source.isDemo,
            locator: `${product.modelCode}; availability ${product.availableFrom ?? "unknown"}–${product.availableTo ?? "unknown"}`,
            locatorDescriptor: {
              availableFrom: product.availableFrom,
              availableTo: product.availableTo,
              kind: "product_availability",
              modelCode: product.modelCode,
              specificationVersion: product.specificationVersion,
            },
            publishedOn: product.source.publishedOn,
            regulationId: null,
            regulationStatus: null,
            sourceId: product.source.id,
            sourceTitle: product.source.title,
            sourceUrl: product.source.url,
            title: product.name,
            verifiedAt: product.source.verifiedAt,
          },
        ]
      : [];
    const certificationSources = product
      ? evaluation.regulationChecks.flatMap((regulationCheck) =>
          regulationCheck.certifications.map(({ certification }) => ({
          countryIso3,
          entityId: certification.id,
          entityType: "product_certification" as const,
          isDemo: certification.isDemo || certification.source.isDemo,
          locator: certification.certificateNumber,
          publishedOn: certification.source.publishedOn,
          productId: certification.productId,
          productModelCode: certification.productModelCode,
          regulationId: certification.regulationId,
          regulationStatus: regulationCheck.regulation.recordStatus,
          sourceId: certification.source.id,
          sourceTitle: certification.source.title,
          sourceUrl: certification.source.url,
          title:
            certification.certificateNumber ??
            `${certification.productModelCode}认证`,
          ...(certification.certificateNumber === null
            ? {
                titleDescriptor: {
                  kind: "product_certification_record" as const,
                  productModelCode: certification.productModelCode,
                },
              }
            : {}),
          verifiedAt: certification.source.verifiedAt,
          })),
        )
      : [];

    return [...productSources, ...certificationSources];
  });
}

export async function calculateOpportunityScore(
  input: unknown,
  options: RequestSignalOptions = {},
) {
  throwIfRequestAborted(options.signal);
  const query = calculateOpportunityScoreInputSchema.parse(input);
  const weights = getOpportunityScoreWeights();
  throwIfRequestAborted(options.signal);
  const regulationComparisonRead = compareRegulations(
    {
      applicationScope: query.applicationScope,
      asOf: query.asOf,
      countryIso3s: query.countryIso3s,
      powerKw: query.powerKw,
    },
    options,
  );
  const marketComparisonRead = compareMarkets(
    {
      applicationScope: query.applicationScope,
      countryIso3s: query.countryIso3s,
      metricCodes: query.metricCodes,
    },
    options,
  );
  const productEvaluationReads = query.countryIso3s.map((countryIso3) =>
    findCompatibleProducts(
      {
        applicationScope: query.applicationScope,
        asOf: query.asOf,
        countryIso3,
        powerKw: query.powerKw,
        productModelCode: query.productModelCode,
      },
      options,
    ),
  );
  const [regulationComparison, marketComparison, productEvaluations] =
    await awaitStartedOperationsInOrder([
      regulationComparisonRead,
      marketComparisonRead,
      awaitStartedOperationsInOrder(productEvaluationReads),
    ] as const);
  throwIfRequestAborted(options.signal);
  const marketScores = new Map<string, number[]>();
  const unsupportedMetricCodes: string[] = [];

  for (const metric of marketComparison.metrics) {
    const direction = opportunityMetricDirection(metric.metricCode);
    if (metric.comparisonStatus !== "comparable" || direction === null) {
      if (direction === null) {
        unsupportedMetricCodes.push(metric.metricCode);
      }
      continue;
    }

    const normalized = normalizeComparableMetric(
      metric.observations.map((observation) => ({
        countryIso3: observation.countryIso3,
        value: observation.valueNumeric,
      })),
      direction,
    );
    for (const observation of metric.observations) {
      const score = normalized.get(observation.countryIso3);
      if (score === undefined) {
        continue;
      }
      const scores = marketScores.get(observation.countryIso3) ?? [];
      scores.push(score);
      marketScores.set(observation.countryIso3, scores);
    }
  }

  const scores = query.countryIso3s.map((countryIso3, index) => {
    const evaluations = productEvaluations[index] ?? [];
    const countryMarketScores = marketScores.get(countryIso3) ?? [];
    const marketPotential =
      countryMarketScores.length === 0
        ? null
        : countryMarketScores.reduce((sum, score) => sum + score, 0) /
          countryMarketScores.length;
    const productReadiness = calculateProductReadiness(
      evaluations.map(({ commercialReadiness }) => commercialReadiness),
    );
    const regulationChecks = evaluations.flatMap((evaluation) =>
      evaluation.regulationChecks.map((check) => ({
        regulationId: check.regulation.regulationId,
        status: check.status,
      })),
    );
    const regulatoryCoverage =
      calculateRegulatoryCoverage(regulationChecks);
    const readinessUnknownCount = evaluations.filter(
      ({ commercialReadiness }) => commercialReadiness === "unknown",
    ).length;
    const gaps = [
      ...(marketPotential === null
        ? [{ code: "MARKET_DATA_UNAVAILABLE" as const }]
        : []),
      ...(productReadiness === null
        ? [{ code: "PRODUCT_DATA_UNAVAILABLE" as const }]
        : []),
      ...(regulatoryCoverage === null
        ? [{ code: "REGULATORY_DATA_UNAVAILABLE" as const }]
        : []),
      ...(readinessUnknownCount > 0
        ? [
            {
              code: "PRODUCT_READINESS_UNKNOWN" as const,
              count: readinessUnknownCount,
            },
          ]
        : []),
      ...(unsupportedMetricCodes.length > 0
        ? [
            {
              code: "UNSUPPORTED_METRIC_DIRECTION" as const,
              metricCodes: Array.from(new Set(unsupportedMetricCodes)),
            },
          ]
        : []),
    ];

    return combineOpportunityScore({
      components: [
        {
          key: "marketPotential",
          score: marketPotential,
        },
        {
          key: "productReadiness",
          score: productReadiness,
        },
        {
          key: "regulatoryCoverage",
          score: regulatoryCoverage,
        },
      ],
      countryIso3,
      gaps,
      weights,
    });
  });
  const sources = uniqueSources([
    ...regulationComparison.sources,
    ...marketComparison.sources,
    ...productEvaluations.flatMap((evaluations, index) =>
      productAnalysisSources(query.countryIso3s[index]!, evaluations),
    ),
  ]);
  const provenance: OpportunityScoreProvenance = {
    marketComparison,
    productEvaluations: query.countryIso3s.map((countryIso3, index) => ({
      countryIso3,
      evaluations: productEvaluations[index] ?? [],
    })),
    regulationComparison,
  };

  throwIfRequestAborted(options.signal);
  const scorecard = opportunityScorecardSchema.parse({
    provenance,
    query,
    rulesetVersion: OPPORTUNITY_SCORE_RULESET_VERSION,
    scores,
    sources,
    weights,
  });
  if (!opportunityScorecardMatchesTrustedProvenance(scorecard)) {
    throw new Error(
      "Opportunity scorecard does not match deterministic provenance.",
    );
  }
  return scorecard;
}

export async function generateSalesBrief(
  input: unknown,
  options: RequestSignalOptions = {},
) {
  throwIfRequestAborted(options.signal);
  const query = generateSalesBriefInputSchema.parse(input);
  throwIfRequestAborted(options.signal);
  const scorecard = await calculateOpportunityScore(
    {
      applicationScope: query.applicationScope,
      asOf: query.asOf,
      countryIso3s: query.countryIso3s,
      metricCodes: query.metricCodes,
      powerKw: query.powerKw,
      productModelCode: query.productModelCode,
    },
    options,
  );
  throwIfRequestAborted(options.signal);
  const marketScore = scorecard.scores.find(
    ({ countryIso3 }) => countryIso3 === query.targetCountryIso3,
  );

  if (!marketScore) {
    throw new Error("Target country score was not produced.");
  }
  if (!opportunityScorecardMatchesTrustedProvenance(scorecard)) {
    throw new Error(
      "Sales brief received an inconsistent opportunity scorecard.",
    );
  }
  const regulationComparison = scorecard.provenance.regulationComparison;
  const targetProductEvaluations =
    scorecard.provenance.productEvaluations.find(
      ({ countryIso3 }) => countryIso3 === query.targetCountryIso3,
    );
  if (!targetProductEvaluations) {
    throw new Error("Target country product provenance was not produced.");
  }
  const evaluations = targetProductEvaluations.evaluations;

  const recommendedProducts = evaluations.flatMap((evaluation) => {
    if (
      evaluation.status !== "fit" ||
      evaluation.commercialReadiness !== "ready" ||
      !evaluation.product
    ) {
      return [];
    }

    return [
      {
        availableFrom: evaluation.product.availableFrom,
        availableTo: evaluation.product.availableTo,
        availabilityStatus: "pass" as const,
        certifications: evaluation.regulationChecks.flatMap((check) =>
          check.certifications.flatMap(({ certification, status }) =>
            check.status === "pass" && status === "pass"
              ? [
                  {
                    id: certification.id,
                    regulationId: certification.regulationId,
                  },
                ]
              : [],
          ),
        ),
        commercialReadiness: "ready" as const,
        id: evaluation.product.id,
        isDemo: evaluation.product.isDemo,
        modelCode: evaluation.product.modelCode,
        name: evaluation.product.name,
        source: {
          id: evaluation.product.source.id,
          isDemo: evaluation.product.source.isDemo,
          title: evaluation.product.source.title,
        },
        specificationVersion: evaluation.product.specificationVersion,
        status: "fit" as const,
      },
    ];
  });
  const targetRegulations = regulationComparison.countries.find(
    ({ countryIso3 }) => countryIso3 === query.targetCountryIso3,
  );
  const futureRegulationFacts =
    targetRegulations?.futureAdoptedRegulations ?? [];
  const futureRegulationIds = futureRegulationFacts.map(({ id }) => id);
  const targetEvaluationProvenance = scorecard.provenance.productEvaluations.find(
    ({ countryIso3 }) => countryIso3 === query.targetCountryIso3,
  )?.evaluations ?? [];
  const productIdsMatching = (
    matches: (evaluation: ProductFitEvaluation) => boolean,
  ) =>
    targetEvaluationProvenance.flatMap((evaluation) =>
      evaluation.product !== null && matches(evaluation)
        ? [evaluation.product.id]
        : [],
    );
  const notFitProductIds = productIdsMatching(
    ({ status }) => status === "not_fit",
  );
  const unknownProductIds = productIdsMatching(
    ({ status }) => status === "unknown",
  );
  const unavailableFitProductIds = productIdsMatching(
    ({ productChecks, status }) =>
      status === "fit" && productChecks.availability.status === "fail",
  );
  const availabilityUnknownFitProductIds = productIdsMatching(
    ({ productChecks, status }) =>
      status === "fit" && productChecks.availability.status === "unknown",
  );
  const marketComponent = marketScore.components.find(
    ({ key }) => key === "marketPotential",
  );
  const contributingMetricCodes = scorecard.provenance.marketComparison.metrics.flatMap(
    ({ comparisonStatus, metricCode }) =>
      comparisonStatus === "comparable" &&
      opportunityMetricDirection(metricCode) !== null
        ? [metricCode]
        : [],
  );
  const opportunities = [
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
    ...(recommendedProducts.length > 0
      ? [
          {
            productIds: recommendedProducts.map(({ id }) => id),
            ruleCode: "READY_PRODUCTS_AVAILABLE" as const,
          },
        ]
      : []),
  ];
  const risks = [
    ...(futureRegulationIds.length > 0
      ? [
          {
            regulationIds: futureRegulationIds,
            ruleCode: "FUTURE_ADOPTED_REGULATION" as const,
          },
        ]
      : []),
    ...(notFitProductIds.length > 0
      ? [
          {
            productIds: notFitProductIds,
            ruleCode: "PRODUCTS_NOT_FIT" as const,
          },
        ]
      : []),
    ...(unknownProductIds.length > 0
      ? [
          {
            productIds: unknownProductIds,
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
  const gaps = marketScore.gaps;
  const salesActions = [
    ...(recommendedProducts.length > 0
      ? [
          {
            priority: "high" as const,
            productIds: recommendedProducts.map(({ id }) => id),
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
    ...(gaps.length > 0
      ? [
          {
            missingDataIndexes: gaps.map((_, index) => index),
            priority: "medium" as const,
            ruleCode: "RESOLVE_MISSING_DATA_BEFORE_COMMITMENT" as const,
          },
        ]
      : []),
  ];
  const sources = scorecard.sources;

  throwIfRequestAborted(options.signal);
  const brief = salesBriefSchema.parse({
    gaps,
    marketScore,
    opportunities,
    provenance: scorecard.provenance,
    query,
    recommendedProducts,
    risks,
    salesActions,
    sources,
  });
  if (!salesBriefMatchesDeterministicRules(brief)) {
    throw new Error("Sales brief does not match deterministic provenance.");
  }
  return brief;
}
