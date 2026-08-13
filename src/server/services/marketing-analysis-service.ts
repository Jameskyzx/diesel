import "server-only";

import {
  calculateProductReadiness,
  calculateRegulatoryCoverage,
  combineOpportunityScore,
  normalizeComparableMetric,
} from "@/domain/marketing/opportunity-score";
import type { ProductFitEvaluation } from "@/features/product-fit/schemas";
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
  type RegulationComparisonItem,
} from "@/features/marketing/schemas";
import {
  getOpportunityScoreWeights,
  opportunityMetricDirections,
} from "@/server/config/opportunity-score-config";
import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import { createCountryRepository } from "@/server/repositories/country-repository";
import { createMarketRepository } from "@/server/repositories/market-repository";
import { createRegulationRepository } from "@/server/repositories/regulation-repository";
import { findCompatibleProducts } from "@/server/services/compatible-products-service";

function serializeTimestamp(value: Date): string {
  return value.toISOString();
}

function uniqueSources(sources: AnalysisSource[]): AnalysisSource[] {
  return Array.from(
    new Map(
      sources.map((source) => [
        `${source.countryIso3 ?? "global"}:${source.entityType}:${source.entityId}:${source.sourceId}`,
        source,
      ]),
    ).values(),
  );
}

async function getCountryRepository() {
  if (getDatabaseMode() === "pglite-demo") {
    return createCountryRepository(await getDemoDatabase());
  }

  return createCountryRepository(getDatabase());
}

async function getMarketRepository() {
  if (getDatabaseMode() === "pglite-demo") {
    return createMarketRepository(await getDemoDatabase());
  }

  return createMarketRepository(getDatabase());
}

async function getRegulationRepository() {
  if (getDatabaseMode() === "pglite-demo") {
    return createRegulationRepository(await getDemoDatabase());
  }

  return createRegulationRepository(getDatabase());
}

function metricDirection(
  metricCode: string,
): "higher_is_better" | "lower_is_better" | null {
  if (metricCode in opportunityMetricDirections) {
    return opportunityMetricDirections[
      metricCode as keyof typeof opportunityMetricDirections
    ];
  }

  return null;
}

export async function compareRegulations(input: unknown) {
  const query = compareRegulationsInputSchema.parse(input);
  const [countryRepository, regulationRepository] = await Promise.all([
    getCountryRepository(),
    getRegulationRepository(),
  ]);
  const [countryRecords, rows] = await Promise.all([
    Promise.all(
      query.countryIso3s.map((iso3) =>
        countryRepository.findByIso3({ iso3 }),
      ),
    ),
    regulationRepository.findForComparison(query),
  ]);

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
        publishedOn: row.limit.sourcePublishedOn,
        regulationId: row.regulationId,
        regulationStatus: row.status,
        sourceId: row.limit.sourceId,
        sourceTitle: row.limit.sourceTitle,
        sourceUrl: row.limit.sourceUrl,
        title: `${row.canonicalName} ${row.limit.pollutantCode} 限值`,
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
        publishedOn: row.applicability.membershipSourcePublishedOn,
        regulationId: row.regulationId,
        regulationStatus: row.status,
        sourceId: row.applicability.membershipSourceId,
        sourceTitle: row.applicability.membershipSourceTitle,
        sourceUrl: row.applicability.membershipSourceUrl,
        title: `${row.applicability.jurisdictionName} 对 ${countryIso3} 的成员关系`,
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

    const items = Array.from(regulations.values());
    return {
      countryIso3,
      countryName: countryRecord?.nameEn ?? null,
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

  return regulationComparisonSchema.parse({
    countries,
    missingData,
    query,
    sources,
  });
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

export async function compareMarkets(input: unknown) {
  const query = compareMarketsInputSchema.parse(input);
  const repository = await getMarketRepository();
  const rows = await repository.findForComparison(query);
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
        publishedOn: row.publishedOn ?? row.source.publishedOn,
        regulationId: null,
        regulationStatus: null,
        sourceId: row.source.id,
        sourceTitle: row.source.title,
        sourceUrl: row.source.url,
        title: row.metricName,
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
      const metricObservations = latestObservationsByCountry(
        observations.filter(
          (observation) => observation.metricCode === metricCode,
        ),
      );
      const issues: MarketComparison["metrics"][number]["issues"] = [];
      const observationCounts = new Map<string, number>();

      for (const observation of metricObservations) {
        observationCounts.set(
          observation.countryIso3,
          (observationCounts.get(observation.countryIso3) ?? 0) + 1,
        );
      }
      if (
        query.countryIso3s.some(
          (countryIso3) => !observationCounts.has(countryIso3),
        )
      ) {
        issues.push("MISSING_COUNTRY_OBSERVATION");
      }
      if (
        Array.from(observationCounts.values()).some((count) => count > 1)
      ) {
        issues.push("AMBIGUOUS_LATEST_OBSERVATION");
      }

      const comparableFields = [
        ["applicationScope", "APPLICATION_SCOPE_MISMATCH"],
        ["unitCode", "UNIT_MISMATCH"],
        ["currencyCode", "CURRENCY_MISMATCH"],
        ["definition", "DEFINITION_MISMATCH"],
        ["methodologyVersion", "METHODOLOGY_MISMATCH"],
        ["periodStart", "PERIOD_MISMATCH"],
        ["periodEnd", "PERIOD_MISMATCH"],
      ] as const;
      for (const [field, issue] of comparableFields) {
        if (
          new Set(
            metricObservations.map((observation) => observation[field]),
          ).size > 1 &&
          !issues.includes(issue)
        ) {
          issues.push(issue);
        }
      }

      const hasInsufficientData = issues.some((issue) =>
        [
          "MISSING_COUNTRY_OBSERVATION",
          "AMBIGUOUS_LATEST_OBSERVATION",
        ].includes(issue),
      );
      return {
        comparisonStatus:
          issues.length === 0
            ? ("comparable" as const)
            : hasInsufficientData
              ? ("insufficient_data" as const)
              : ("incomparable" as const),
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

  return marketComparisonSchema.parse({
    metrics,
    missingData,
    query,
    sources: uniqueSources(
      metrics.flatMap((metric) =>
        metric.observations.map(({ source }) => source),
      ),
    ),
  });
}

function productAnalysisSources(
  countryIso3: string,
  evaluations: ProductFitEvaluation[],
): AnalysisSource[] {
  return evaluations.flatMap((evaluation) => {
    const productSources: AnalysisSource[] = evaluation.product
      ? [
          {
            countryIso3,
            entityId: evaluation.product.id,
            entityType: "product",
            isDemo:
              evaluation.product.isDemo || evaluation.product.source.isDemo,
            locator: `${evaluation.product.modelCode}; availability ${evaluation.product.availableFrom ?? "unknown"}–${evaluation.product.availableTo ?? "open"}`,
            publishedOn: evaluation.product.source.publishedOn,
            regulationId: null,
            regulationStatus: null,
            sourceId: evaluation.product.source.id,
            sourceTitle: evaluation.product.source.title,
            sourceUrl: evaluation.product.source.url,
            title: evaluation.product.name,
            verifiedAt: evaluation.product.source.verifiedAt,
          },
        ]
      : [];
    const certificationSources = evaluation.regulationChecks.flatMap(
      (regulationCheck) =>
        regulationCheck.certifications.map(({ certification }) => ({
          countryIso3,
          entityId: certification.id,
          entityType: "product_certification" as const,
          isDemo: certification.isDemo || certification.source.isDemo,
          locator: certification.certificateNumber,
          publishedOn: certification.source.publishedOn,
          regulationId: certification.regulationId,
          regulationStatus: "effective" as const,
          sourceId: certification.source.id,
          sourceTitle: certification.source.title,
          sourceUrl: certification.source.url,
          title:
            certification.certificateNumber ??
            `${evaluation.product?.modelCode ?? "产品"}认证`,
          verifiedAt: certification.source.verifiedAt,
        })),
    );

    return [...productSources, ...certificationSources];
  });
}

export async function calculateOpportunityScore(input: unknown) {
  const query = calculateOpportunityScoreInputSchema.parse(input);
  const weights = getOpportunityScoreWeights();
  const [regulationComparison, marketComparison, productEvaluations] =
    await Promise.all([
      compareRegulations({
        applicationScope: query.applicationScope,
        asOf: query.asOf,
        countryIso3s: query.countryIso3s,
        powerKw: query.powerKw,
      }),
      compareMarkets({
        applicationScope: query.applicationScope,
        countryIso3s: query.countryIso3s,
        metricCodes: query.metricCodes,
      }),
      Promise.all(
        query.countryIso3s.map((countryIso3) =>
          findCompatibleProducts({
            applicationScope: query.applicationScope,
            asOf: query.asOf,
            countryIso3,
            powerKw: query.powerKw,
            productModelCode: query.productModelCode,
          }),
        ),
      ),
    ]);
  const marketScores = new Map<string, number[]>();
  const marketFacts = new Map<string, string[]>();
  const unsupportedMetricCodes: string[] = [];

  for (const metric of marketComparison.metrics) {
    const direction = metricDirection(metric.metricCode);
    if (metric.comparisonStatus !== "comparable" || direction === null) {
      if (direction === null) {
        unsupportedMetricCodes.push(metric.metricCode);
      }
      continue;
    }

    const normalized = normalizeComparableMetric(
      metric.observations.map((observation) => ({
        countryIso3: observation.countryIso3,
        value: Number(observation.valueNumeric),
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
      const facts = marketFacts.get(observation.countryIso3) ?? [];
      facts.push(
        `${metric.metricCode}=${observation.valueNumeric} ${observation.unitCode}，组内归一化=${score}`,
      );
      marketFacts.set(observation.countryIso3, facts);
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
      evaluations.map(({ status }) => status),
    );
    const regulationChecks = evaluations.flatMap((evaluation) =>
      evaluation.regulationChecks.map((check) => ({
        regulationId: check.regulation.regulationId,
        status: check.status,
      })),
    );
    const regulatoryCoverage =
      calculateRegulatoryCoverage(regulationChecks);
    const fitCount = evaluations.filter(({ status }) => status === "fit").length;
    const notFitCount = evaluations.filter(
      ({ status }) => status === "not_fit",
    ).length;
    const unknownCount = evaluations.filter(
      ({ status }) => status === "unknown",
    ).length;
    const missingData = [
      ...(marketPotential === null
        ? [
            `${countryIso3} 没有同时满足可比性和评分方向配置的市场指标。`,
          ]
        : []),
      ...(productReadiness === null
        ? [`${countryIso3} 没有可确定的产品适配结果。`]
        : []),
      ...(regulatoryCoverage === null
        ? [`${countryIso3} 没有可确定的法规认证覆盖结果。`]
        : []),
      ...(unknownCount > 0
        ? [`${countryIso3} 有 ${unknownCount} 个 unknown 产品结果，未按 0 计分。`]
        : []),
      ...marketComparison.missingData.filter((message) =>
        message.includes(countryIso3),
      ),
    ];

    return combineOpportunityScore({
      components: [
        {
          explanation:
            marketPotential === null
              ? "市场指标缺失、不可比或未配置评分方向，因此本维度不计入总分。"
              : "对同口径市场指标在本次国家比较组内做 min-max 归一化后取平均；数值方向由代码登记表固定。",
          inputFacts: marketFacts.get(countryIso3) ?? [],
          key: "marketPotential",
          score: marketPotential,
        },
        {
          explanation:
            productReadiness === null
              ? "没有明确 fit/not_fit 结果；unknown 不作为 0。"
              : "产品准备度=fit 数量/(fit+not_fit 数量)；unknown 从分母排除并单列缺失。",
          inputFacts: [
            `fit=${fitCount}`,
            `not_fit=${notFitCount}`,
            `unknown=${unknownCount}`,
          ],
          key: "productReadiness",
          score: productReadiness,
        },
        {
          explanation:
            regulatoryCoverage === null
              ? "法规覆盖检查全部为 unknown 或不存在，因此本维度不计入总分。"
              : "逐项有效法规检查：至少一个产品明确 pass 记 100，存在明确 fail 且无 pass 记 0，只有 unknown 时排除；再取平均。",
          inputFacts: [
            `法规检查=${regulationChecks.length}`,
            `可确定检查=${regulationChecks.filter(({ status }) => status !== "unknown").length}`,
          ],
          key: "regulatoryCoverage",
          score: regulatoryCoverage,
        },
      ],
      countryIso3,
      missingData,
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

  if (unsupportedMetricCodes.length > 0) {
    for (const score of scores) {
      score.missingData.push(
        `指标 ${Array.from(new Set(unsupportedMetricCodes)).join(", ")} 未在 opportunity-score-v1 中配置方向，未参与评分。`,
      );
    }
  }

  return opportunityScorecardSchema.parse({
    query,
    rulesetVersion: "opportunity-score-v1",
    scores,
    sources,
    weights,
  });
}

export async function generateSalesBrief(input: unknown) {
  const query = generateSalesBriefInputSchema.parse(input);
  const [scorecard, regulationComparison, evaluations] = await Promise.all([
    calculateOpportunityScore({
      applicationScope: query.applicationScope,
      asOf: query.asOf,
      countryIso3s: query.countryIso3s,
      metricCodes: query.metricCodes,
      powerKw: query.powerKw,
      productModelCode: query.productModelCode,
    }),
    compareRegulations({
      applicationScope: query.applicationScope,
      asOf: query.asOf,
      countryIso3s: query.countryIso3s,
      powerKw: query.powerKw,
    }),
    findCompatibleProducts({
      applicationScope: query.applicationScope,
      asOf: query.asOf,
      countryIso3: query.targetCountryIso3,
      powerKw: query.powerKw,
      productModelCode: query.productModelCode,
    }),
  ]);
  const marketScore = scorecard.scores.find(
    ({ countryIso3 }) => countryIso3 === query.targetCountryIso3,
  );

  if (!marketScore) {
    throw new Error("Target country score was not produced.");
  }

  const recommendedProducts = evaluations.flatMap((evaluation) => {
    if (evaluation.status !== "fit" || !evaluation.product) {
      return [];
    }

    return [
      {
        availableFrom: evaluation.product.availableFrom,
        availableTo: evaluation.product.availableTo,
        certificationIds: Array.from(
          new Set(
            evaluation.regulationChecks.flatMap((check) =>
              check.certifications
                .filter(({ status }) => status === "pass")
                .map(({ certification }) => certification.id),
            ),
          ),
        ),
        modelCode: evaluation.product.modelCode,
        name: evaluation.product.name,
        reasons: evaluation.reasons.map(({ message }) => message),
        regulationIds: Array.from(
          new Set(
            evaluation.regulationChecks
              .filter(({ status }) => status === "pass")
              .map(({ regulation }) => regulation.regulationId),
          ),
        ),
        status: "fit" as const,
      },
    ];
  });
  const targetRegulations = regulationComparison.countries.find(
    ({ countryIso3 }) => countryIso3 === query.targetCountryIso3,
  );
  const futureRegulations =
    targetRegulations?.futureAdoptedRegulations ?? [];
  const notFitProducts = evaluations.filter(
    ({ status }) => status === "not_fit",
  );
  const unknownProducts = evaluations.filter(
    ({ status }) => status === "unknown",
  );
  const marketComponent = marketScore.components.find(
    ({ key }) => key === "marketPotential",
  );
  const opportunities = [
    ...(marketComponent?.score !== null &&
    marketComponent?.score !== undefined &&
    marketComponent.score >= 50
      ? [
          {
            evidenceIds: marketComponent.inputFacts,
            text: `目标国家在本次比较组中的市场潜力维度为 ${marketComponent.score}/100。`,
            title: "结构化市场指标相对占优",
          },
        ]
      : []),
    ...(recommendedProducts.length > 0
      ? [
          {
            evidenceIds: recommendedProducts.flatMap(
              ({ certificationIds }) => certificationIds,
            ),
            text: `${recommendedProducts.length} 个产品具有明确 fit 结论。`,
            title: "已有确定性适配产品",
          },
        ]
      : []),
  ];
  const risks = [
    ...futureRegulations.map((regulation) => ({
      evidenceIds: [regulation.id],
      text: `${regulation.canonicalName} 状态为 adopted，预计生效日期 ${regulation.effectiveFrom ?? "未知"}。`,
      title: "未来已通过法规",
    })),
    ...(notFitProducts.length > 0
      ? [
          {
            evidenceIds: notFitProducts.flatMap((evaluation) =>
              evaluation.regulationChecks.map(
                ({ regulation }) => regulation.regulationId,
              ),
            ),
            text: `${notFitProducts.length} 个产品存在明确 not_fit 结论。`,
            title: "产品明确不匹配",
          },
        ]
      : []),
    ...(unknownProducts.length > 0
      ? [
          {
            evidenceIds: [],
            text: `${unknownProducts.length} 个产品因证据不足为 unknown，不能视为不合规或零机会。`,
            title: "产品证据缺口",
          },
        ]
      : []),
  ];
  const missingData = Array.from(
    new Set([
      ...marketScore.missingData,
      ...regulationComparison.missingData.filter((message) =>
        message.includes(query.targetCountryIso3),
      ),
    ]),
  );
  const salesActions = [
    ...(recommendedProducts.length > 0
      ? [
          {
            action: `为 ${recommendedProducts.map(({ modelCode }) => modelCode).join("、")} 准备法规与认证证据包。`,
            kind: "rule_generated" as const,
            priority: "high" as const,
            rationale: "这些产品具有可追溯的明确 fit 结论。",
          },
        ]
      : []),
    ...(futureRegulations.length > 0
      ? [
          {
            action: "在未来法规生效前重新核验认证覆盖和产品配置。",
            kind: "rule_generated" as const,
            priority: "high" as const,
            rationale: "adopted 法规不能当作当前 effective，但会形成前置准备窗口。",
          },
        ]
      : []),
    ...(missingData.length > 0
      ? [
          {
            action: "补齐 missingData 中列出的市场、法规或认证事实后再做商业承诺。",
            kind: "rule_generated" as const,
            priority: "medium" as const,
            rationale: "opportunity-score-v1 会排除缺失维度并降低数据覆盖率。",
          },
        ]
      : []),
  ];
  const scoreText =
    marketScore.overallScore === null
      ? "当前结构化证据不足，未生成总分"
      : `确定性机会分为 ${marketScore.overallScore}/100，数据覆盖率 ${marketScore.dataCoveragePct}%`;
  const sources = uniqueSources([
    ...scorecard.sources,
    ...regulationComparison.sources,
    ...productAnalysisSources(query.targetCountryIso3, evaluations),
  ]);

  return salesBriefSchema.parse({
    executiveSummary: `${query.targetCountryIso3}：${scoreText}。该简报使用 ${scorecard.rulesetVersion}，建议文本由固定规则生成，不是事实来源。`,
    marketScore,
    missingData,
    opportunities,
    query,
    recommendedProducts,
    risks,
    salesActions,
    sources,
  });
}
