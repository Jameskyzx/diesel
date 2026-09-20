import { compareCanonicalText } from "@/domain/canonical-order";

import type {
  AnalysisSource,
  MarketComparison,
  MarketObservation,
  RegulationComparison,
  RegulationComparisonItem,
} from "@/features/marketing/schemas";

type MarketIssue = MarketComparison["metrics"][number]["issues"][number];
type RegulationCountry = RegulationComparison["countries"][number];

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) =>
        sameStructuredValue(value, right[index]),
      )
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).toSorted();
  const rightKeys = Object.keys(rightRecord).toSorted();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        sameStructuredValue(leftRecord[key], rightRecord[key]),
    )
  );
}

function analysisSourceKey(source: AnalysisSource): string {
  return [
    source.countryIso3 ?? "global",
    source.entityType,
    source.entityId,
    source.regulationId ?? "none",
    source.sourceId,
  ].join(":");
}

function sameAnalysisSource(
  left: AnalysisSource,
  right: AnalysisSource,
): boolean {
  return (
    left.countryIso3 === right.countryIso3 &&
    left.entityId === right.entityId &&
    left.entityType === right.entityType &&
    left.isDemo === right.isDemo &&
    left.locator === right.locator &&
    sameStructuredValue(
      left.locatorDescriptor ?? null,
      right.locatorDescriptor ?? null,
    ) &&
    left.publishedOn === right.publishedOn &&
    left.regulationId === right.regulationId &&
    left.regulationStatus === right.regulationStatus &&
    left.sourceId === right.sourceId &&
    left.sourceTitle === right.sourceTitle &&
    left.sourceUrl === right.sourceUrl &&
    left.title === right.title &&
    sameStructuredValue(
      left.titleDescriptor ?? null,
      right.titleDescriptor ?? null,
    ) &&
    left.verifiedAt === right.verifiedAt
  );
}

function analysisSourceMatches(input: {
  countryIso3: string;
  entityId: string;
  entityIsDemo: boolean;
  entityType: AnalysisSource["entityType"];
  locator: string | null;
  locatorDescriptor?: unknown;
  regulationId: string;
  regulationStatus: AnalysisSource["regulationStatus"];
  source: AnalysisSource;
  title: string;
  titleDescriptor?: unknown;
}): boolean {
  const { source } = input;
  return (
    source.countryIso3 === input.countryIso3 &&
    source.entityId === input.entityId &&
    source.entityType === input.entityType &&
    (!input.entityIsDemo || source.isDemo) &&
    source.locator === input.locator &&
    sameStructuredValue(
      source.locatorDescriptor ?? null,
      input.locatorDescriptor ?? null,
    ) &&
    source.regulationId === input.regulationId &&
    source.regulationStatus === input.regulationStatus &&
    source.title === input.title &&
    sameStructuredValue(
      source.titleDescriptor ?? null,
      input.titleDescriptor ?? null,
    )
  );
}

/**
 * Rebuilds the exact analysis-source closure owned by visible regulation
 * facts. This client-safe domain helper intentionally does not prove whether
 * a source or omitted database row is truthful or complete.
 */
export function regulationComparisonSourcesMatchVisibleFacts(
  comparison: RegulationComparison,
): boolean {
  try {
    const nestedSources: AnalysisSource[] = [];
    for (const country of comparison.countries) {
      if (!comparison.query.countryIso3s.includes(country.countryIso3)) {
        return false;
      }
      const regulations = [
        ...country.currentEffectiveRegulations,
        ...country.futureAdoptedRegulations,
      ];
      for (const regulation of regulations) {
        if (
          !analysisSourceMatches({
            countryIso3: country.countryIso3,
            entityId: regulation.id,
            entityIsDemo: regulation.isDemo,
            entityType: "regulation",
            locator: regulation.citationCode,
            regulationId: regulation.id,
            regulationStatus: regulation.recordStatus,
            source: regulation.source,
            title: regulation.canonicalName,
          }) ||
          !analysisSourceMatches({
            countryIso3: country.countryIso3,
            entityId: regulation.applicability.jurisdiction.id,
            entityIsDemo: regulation.applicability.jurisdiction.isDemo,
            entityType: "jurisdiction",
            locator: regulation.applicability.jurisdiction.code,
            regulationId: regulation.id,
            regulationStatus: regulation.recordStatus,
            source: regulation.applicability.jurisdiction.source,
            title: regulation.applicability.jurisdiction.name,
          }) ||
          !analysisSourceMatches({
            countryIso3: country.countryIso3,
            entityId: regulation.applicability.jurisdiction.id,
            entityIsDemo: regulation.applicability.membership.isDemo,
            entityType: "country_jurisdiction",
            locator: `${regulation.applicability.membership.validFrom}–${regulation.applicability.membership.validTo ?? "open"}`,
            locatorDescriptor: {
              kind: "membership_period",
              validFrom: regulation.applicability.membership.validFrom,
              validTo: regulation.applicability.membership.validTo,
            },
            regulationId: regulation.id,
            regulationStatus: regulation.recordStatus,
            source: regulation.applicability.membership.source,
            title: `${regulation.applicability.jurisdiction.name} 对 ${country.countryIso3} 的成员关系`,
            titleDescriptor: {
              countryIso3: country.countryIso3,
              jurisdictionName:
                regulation.applicability.jurisdiction.name,
              kind: "country_jurisdiction_membership",
            },
          })
        ) {
          return false;
        }
        nestedSources.push(
          regulation.source,
          regulation.applicability.jurisdiction.source,
          regulation.applicability.membership.source,
        );

        for (const limit of regulation.limits) {
          if (
            !analysisSourceMatches({
              countryIso3: country.countryIso3,
              entityId: limit.id,
              entityIsDemo: limit.isDemo,
              entityType: "regulation_limit",
              locator: `${limit.pollutantCode} ${limit.validFrom}–${limit.validTo ?? "open"}`,
              locatorDescriptor: {
                kind: "regulation_limit_period",
                pollutantCode: limit.pollutantCode,
                validFrom: limit.validFrom,
                validTo: limit.validTo,
              },
              regulationId: regulation.id,
              regulationStatus: regulation.recordStatus,
              source: limit.source,
              title: `${regulation.canonicalName} ${limit.pollutantCode} 限值`,
              titleDescriptor: {
                kind: "regulation_pollutant_limit",
                pollutantCode: limit.pollutantCode,
                regulationName: regulation.canonicalName,
              },
            })
          ) {
            return false;
          }
          nestedSources.push(limit.source);
        }
      }
    }

    const topLevelKeys = comparison.sources.map(analysisSourceKey);
    return (
      !hasDuplicates(topLevelKeys) &&
      comparison.sources.every((source) =>
        nestedSources.some((nested) =>
          sameAnalysisSource(source, nested),
        ),
      ) &&
      nestedSources.every((nested) =>
        comparison.sources.some((source) =>
          sameAnalysisSource(source, nested),
        ),
      )
    );
  } catch {
    return false;
  }
}

function isValidHalfOpenDateRange(
  start: string | null,
  end: string | null,
): boolean {
  return end === null || (start !== null && end > start);
}

function containsDate(
  value: string,
  start: string,
  end: string | null,
): boolean {
  return value >= start && (end === null || value < end);
}

function containsPower(
  value: number,
  minimum: number | null,
  maximum: number | null,
): boolean {
  return (
    (minimum === null || value >= minimum) &&
    (maximum === null || value < maximum)
  );
}

function regulationItemMatchesVisibleQuery(
  item: RegulationComparisonItem,
  expectedStatus: RegulationComparisonItem["status"],
  countryIso3: string,
  comparison: RegulationComparison,
): boolean {
  const { asOf, powerKw } = comparison.query;
  const membership = item.applicability.membership;
  const derivedStatus =
    item.effectiveFrom !== null &&
    item.effectiveFrom <= asOf &&
    (item.effectiveTo === null || item.effectiveTo > asOf)
      ? "effective"
      : "adopted";

  if (
    item.applicability.countryIso3 !== countryIso3 ||
    item.status !== expectedStatus ||
    derivedStatus !== expectedStatus ||
    !isValidHalfOpenDateRange(item.effectiveFrom, item.effectiveTo) ||
    !isValidHalfOpenDateRange(membership.validFrom, membership.validTo) ||
    !containsDate(asOf, membership.validFrom, membership.validTo) ||
    item.limits.length === 0 ||
    hasDuplicates(item.limits.map(({ id }) => id)) ||
    !sameStrings(
      item.limits.map(({ id }) => id),
      item.limits
        .toSorted((left, right) => compareCanonicalText(
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
        ))
        .map(({ id }) => id),
    )
  ) {
    return false;
  }

  if (
    expectedStatus === "effective" &&
    (item.recordStatus === "adopted" || item.effectiveFrom === null)
  ) {
    return false;
  }

  if (
    item.recordStatus === "effective" &&
    item.effectiveFrom === null
  ) {
    return false;
  }

  if (
    item.recordStatus === "superseded" &&
    item.effectiveTo === null
  ) {
    return false;
  }

  if (
    expectedStatus === "adopted" &&
    item.effectiveFrom !== null &&
    item.effectiveFrom <= asOf
  ) {
    return false;
  }

  return item.limits.every((limit) => {
    if (
      !isValidHalfOpenDateRange(limit.validFrom, limit.validTo) ||
      (limit.powerMinKw !== null &&
        limit.powerMaxKw !== null &&
        limit.powerMaxKw <= limit.powerMinKw) ||
      !containsPower(powerKw, limit.powerMinKw, limit.powerMaxKw)
    ) {
      return false;
    }

    return expectedStatus === "effective"
      ? containsDate(asOf, limit.validFrom, limit.validTo)
      : limit.validTo === null || limit.validTo > asOf;
  });
}

function regulationCountryMatchesVisibleQuery(
  country: RegulationCountry,
  comparison: RegulationComparison,
): boolean {
  const allItems = [
    ...country.currentEffectiveRegulations,
    ...country.futureAdoptedRegulations,
  ];
  const hasCountryRecord =
    country.countryName !== null && country.countrySource !== null;
  const expectedStatus =
    hasCountryRecord && allItems.length > 0 ? "available" : "no_data";

  if (
    (country.countryName === null) !== (country.countrySource === null) ||
    (!hasCountryRecord && allItems.length > 0) ||
    (!hasCountryRecord && country.countryIsDemo) ||
    country.status !== expectedStatus ||
    hasDuplicates(allItems.map(({ id }) => id)) ||
    !sameStrings(
      country.currentEffectiveRegulations.map(({ id }) => id),
      country.currentEffectiveRegulations
        .toSorted((left, right) => compareCanonicalText(
          `${left.canonicalName}\u0000${left.id}`,
          `${right.canonicalName}\u0000${right.id}`,
        ))
        .map(({ id }) => id),
    ) ||
    !sameStrings(
      country.futureAdoptedRegulations.map(({ id }) => id),
      country.futureAdoptedRegulations
        .toSorted((left, right) => compareCanonicalText(
          `${left.canonicalName}\u0000${left.id}`,
          `${right.canonicalName}\u0000${right.id}`,
        ))
        .map(({ id }) => id),
    )
  ) {
    return false;
  }

  return (
    country.currentEffectiveRegulations.every((item) =>
      regulationItemMatchesVisibleQuery(
        item,
        "effective",
        country.countryIso3,
        comparison,
      ),
    ) &&
    country.futureAdoptedRegulations.every((item) =>
      regulationItemMatchesVisibleQuery(
        item,
        "adopted",
        country.countryIso3,
        comparison,
      ),
    )
  );
}

function expectedRegulationMissingData(
  comparison: RegulationComparison,
): string[] {
  return comparison.countries.flatMap((country) => {
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
}

/**
 * Recomputes every comparison decision that is provable from the public
 * regulation payload. Application scope, adoption date and omitted database
 * rows are intentionally outside this boundary because the payload does not
 * carry those raw facts.
 */
export function regulationComparisonMatchesDeterministicRules(
  comparison: RegulationComparison,
): boolean {
  const expectedCountries = comparison.query.countryIso3s;
  const actualCountries = comparison.countries.map(
    ({ countryIso3 }) => countryIso3,
  );

  return (
    !hasDuplicates(expectedCountries) &&
    !hasDuplicates(actualCountries) &&
    sameStrings(actualCountries, expectedCountries) &&
    comparison.countries.every((country) =>
      regulationCountryMatchesVisibleQuery(country, comparison),
    ) &&
    sameStrings(
      comparison.missingData,
      expectedRegulationMissingData(comparison),
    )
  );
}

function observationIsLatestVisibleForCountry(
  observation: MarketObservation,
  observations: readonly MarketObservation[],
): boolean {
  const countryObservations = observations.filter(
    ({ countryIso3 }) => countryIso3 === observation.countryIso3,
  );
  const latestPeriodEnd = countryObservations
    .map(({ periodEnd }) => periodEnd)
    .toSorted()
    .at(-1);
  const latestPeriodStart = countryObservations
    .filter(({ periodEnd }) => periodEnd === latestPeriodEnd)
    .map(({ periodStart }) => periodStart)
    .toSorted()
    .at(-1);

  return (
    observation.periodEnd === latestPeriodEnd &&
    observation.periodStart === latestPeriodStart
  );
}

type ComparisonBasisObservation = Pick<MarketObservation,
  "countryIso3" | "applicationScope" | "unitCode" | "currencyCode" |
  "definition" | "methodologyVersion" | "periodStart" | "periodEnd"
>;

/** Missing required basis is unknown, even when every observation omits it. */
export function marketComparisonIssues(
  observations: readonly ComparisonBasisObservation[],
  countryIso3s: readonly string[],
): MarketIssue[] {
  const issues: MarketIssue[] = [];
  const observationCounts = new Map<string, number>();

  for (const observation of observations) {
    observationCounts.set(
      observation.countryIso3,
      (observationCounts.get(observation.countryIso3) ?? 0) + 1,
    );
  }
  if (countryIso3s.some((countryIso3) => !observationCounts.has(countryIso3))) {
    issues.push("MISSING_COUNTRY_OBSERVATION");
  }
  if (Array.from(observationCounts.values()).some((count) => count > 1)) {
    issues.push("AMBIGUOUS_LATEST_OBSERVATION");
  }

  const requiredBasis = [
    ["unitCode", "MISSING_UNIT"],
    ["definition", "MISSING_DEFINITION"],
    ["methodologyVersion", "MISSING_METHODOLOGY"],
  ] as const;
  for (const [field, issue] of requiredBasis) {
    if (observations.some((observation) => observation[field].trim().length === 0)) {
      issues.push(issue);
    }
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
    const isRequiredBasis = field === "unitCode" || field === "definition" || field === "methodologyVersion";
    const knownValues = observations.map((observation) => observation[field])
      .filter((value) => !isRequiredBasis || (typeof value === "string" && value.trim().length > 0));
    if (
      new Set(knownValues).size > 1 &&
      !issues.includes(issue)
    ) {
      issues.push(issue);
    }
  }

  return issues;
}

export function marketComparisonStatus(
  issues: readonly MarketIssue[],
): MarketComparison["metrics"][number]["comparisonStatus"] {
  if (issues.length === 0) {
    return "comparable";
  }

  return issues.some(
    (issue) =>
      issue === "MISSING_COUNTRY_OBSERVATION" ||
      issue === "AMBIGUOUS_LATEST_OBSERVATION" ||
      issue === "MISSING_UNIT" ||
      issue === "MISSING_DEFINITION" ||
      issue === "MISSING_METHODOLOGY",
  )
    ? "insufficient_data"
    : "incomparable";
}

function marketMetricMatchesVisibleQuery(
  metric: MarketComparison["metrics"][number],
  comparison: MarketComparison,
): boolean {
  const scopedQuery = comparison.query.applicationScope;
  const observations = metric.observations;

  if (
    hasDuplicates(observations.map(({ id }) => id)) ||
    !sameStrings(
      observations.map(({ id }) => id),
      observations
        .toSorted((left, right) => {
          const leftCountryIndex = comparison.query.countryIso3s.indexOf(
            left.countryIso3,
          );
          const rightCountryIndex = comparison.query.countryIso3s.indexOf(
            right.countryIso3,
          );
          return (
            leftCountryIndex - rightCountryIndex ||
            compareCanonicalText(right.periodEnd, left.periodEnd) ||
            compareCanonicalText(right.periodStart, left.periodStart) ||
            compareCanonicalText(left.id, right.id)
          );
        })
        .map(({ id }) => id),
    ) ||
    observations.some(
      (observation) =>
        observation.metricCode !== metric.metricCode ||
        observation.metricName !== metric.metricName ||
        !comparison.query.countryIso3s.includes(observation.countryIso3) ||
        (scopedQuery !== undefined &&
          scopedQuery !== null &&
          observation.applicationScope !== null &&
          observation.applicationScope !== scopedQuery) ||
        observation.periodEnd <= observation.periodStart ||
        !observationIsLatestVisibleForCountry(observation, observations),
    )
  ) {
    return false;
  }

  const expectedName = observations[0]?.metricName ?? metric.metricCode;
  const expectedIssues = marketComparisonIssues(
    observations,
    comparison.query.countryIso3s,
  );

  return (
    metric.metricName === expectedName &&
    sameStrings(metric.issues, expectedIssues) &&
    metric.comparisonStatus === marketComparisonStatus(expectedIssues)
  );
}

function expectedMarketMissingData(comparison: MarketComparison): string[] {
  const missingData = comparison.metrics.flatMap((metric) =>
    metric.comparisonStatus === "comparable"
      ? []
      : [
          `${metric.metricCode} 不可比较：${metric.issues.join(", ") || "没有观测值"}。`,
        ],
  );

  if (comparison.metrics.length === 0) {
    missingData.push("所选国家没有结构化市场指标。");
  }

  return missingData;
}

/**
 * Recomputes market metric selection metadata, issue codes, status and
 * missing-data text from the observations visible in the comparison payload.
 * A scoped query accepts either global observations (`null`) or observations
 * for that exact scope, mirroring the repository filter.
 */
export function marketComparisonMatchesDeterministicRules(
  comparison: MarketComparison,
): boolean {
  const queryMetricCodes = comparison.query.metricCodes;
  const metricCodes = comparison.metrics.map(({ metricCode }) => metricCode);
  const observationIds = comparison.metrics.flatMap(({ observations }) =>
    observations.map(({ id }) => id),
  );

  if (
    hasDuplicates(comparison.query.countryIso3s) ||
    hasDuplicates(metricCodes) ||
    hasDuplicates(observationIds) ||
    (queryMetricCodes !== undefined && hasDuplicates(queryMetricCodes))
  ) {
    return false;
  }

  const expectedMetricCodes =
    queryMetricCodes ??
    Array.from(
      new Set(
        comparison.metrics.flatMap(({ observations }) =>
          observations.map(({ metricCode }) => metricCode),
        ),
      ),
    ).sort();

  return (
    sameStrings(metricCodes, expectedMetricCodes) &&
    comparison.metrics.every((metric) =>
      marketMetricMatchesVisibleQuery(metric, comparison),
    ) &&
    sameStrings(
      comparison.missingData,
      expectedMarketMissingData(comparison),
    )
  );
}
