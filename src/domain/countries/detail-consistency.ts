import {
  regulationComparisonMatchesDeterministicRules,
  regulationComparisonSourcesMatchVisibleFacts,
} from "@/domain/marketing/comparison-consistency";
import type { CountryDetailResponse } from "@/features/countries/schemas";
import { marketMetricDecimalSchema } from "@/features/database/schemas";
import type {
  AnalysisSource,
  RegulationComparison,
} from "@/features/marketing/schemas";

type AvailableCountryDetail = Extract<
  CountryDetailResponse,
  { status: "available" }
>;
type CountrySource = AvailableCountryDetail["country"]["source"];
type ProfileRegulation =
  AvailableCountryDetail["country"]["currentEffectiveRegulations"][number] |
  AvailableCountryDetail["country"]["futureAdoptedRegulations"][number];
type SummaryRegulation = RegulationComparison["countries"][number][
  "currentEffectiveRegulations"
][number];

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function marketMetricObservationKey(
  metric: AvailableCountryDetail["country"]["marketMetrics"][number],
): string {
  return JSON.stringify([
    metric.countryIso3,
    metric.metricCode,
    metric.applicationScope,
    metric.periodStart,
    metric.periodEnd,
    metric.source.id,
  ]);
}

function sameCountrySource(
  left: CountrySource,
  right: CountrySource,
): boolean {
  return (
    left.id === right.id &&
    left.isDemo === right.isDemo &&
    left.publishedOn === right.publishedOn &&
    left.publisher === right.publisher &&
    left.title === right.title &&
    left.url === right.url &&
    left.verifiedAt === right.verifiedAt
  );
}

function validHalfOpenRange(
  start: string | null,
  end: string | null,
): boolean {
  return end === null || (start !== null && end > start);
}

function containsDate(
  date: string,
  start: string,
  end: string | null,
): boolean {
  return start <= date && (end === null || date < end);
}

type RegulationLifecycle = {
  adoptedOn: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string;
};

/** Classifies an effective record using the visible, fail-closed lifecycle. */
export function regulationIsCurrentAt(
  regulation: RegulationLifecycle,
  asOf: string,
): boolean {
  const recordCanSupportDate =
    regulation.status === "effective" ||
    (regulation.status === "superseded" &&
      regulation.effectiveTo !== null);
  const adoptionWasKnown =
    regulation.adoptedOn !== null && regulation.adoptedOn <= asOf;
  return (
    recordCanSupportDate &&
    adoptionWasKnown &&
    validHalfOpenRange(
      regulation.effectiveFrom,
      regulation.effectiveTo,
    ) &&
    regulation.effectiveFrom !== null &&
    containsDate(
      asOf,
      regulation.effectiveFrom,
      regulation.effectiveTo,
    )
  );
}

/** Classifies an adopted future record using the same visible lifecycle. */
export function regulationIsFutureAdoptedAt(
  regulation: RegulationLifecycle,
  asOf: string,
): boolean {
  const adoptionWasKnown =
    regulation.adoptedOn !== null && regulation.adoptedOn <= asOf;
  const lifecycleIsUsable =
    regulation.status !== "superseded" || regulation.effectiveTo !== null;
  const recordHasRequiredEffectiveDate =
    regulation.status !== "effective" || regulation.effectiveFrom !== null;
  return (
    regulation.status !== "proposed" &&
    lifecycleIsUsable &&
    recordHasRequiredEffectiveDate &&
    adoptionWasKnown &&
    validHalfOpenRange(
      regulation.effectiveFrom,
      regulation.effectiveTo,
    ) &&
    (regulation.effectiveFrom === null ||
      regulation.effectiveFrom > asOf)
  );
}

function matchesLatestInstant(
  actual: string | null,
  candidates: readonly string[],
): boolean {
  if (candidates.length === 0) {
    return actual === null;
  }
  if (actual === null) {
    return false;
  }

  const actualInstant = Date.parse(actual);
  const candidateInstants = candidates.map((value) => Date.parse(value));
  if (
    !Number.isFinite(actualInstant) ||
    candidateInstants.some((value) => !Number.isFinite(value))
  ) {
    return false;
  }
  return actualInstant === Math.max(...candidateInstants);
}

function jurisdictionProjectionMatches(
  detail: AvailableCountryDetail,
  regulation: ProfileRegulation,
): boolean {
  const { country } = detail;
  const applicability = regulation.applicability;
  const jurisdiction = country.jurisdictions.find(
    ({ id }) => id === applicability.jurisdiction.id,
  );
  if (jurisdiction === undefined) {
    return false;
  }

  return (
    applicability.countryIso3 === country.iso3 &&
    applicability.jurisdiction.code === jurisdiction.code &&
    applicability.jurisdiction.isDemo === jurisdiction.isDemo &&
    applicability.jurisdiction.name === jurisdiction.name &&
    applicability.jurisdiction.verifiedAt ===
      jurisdiction.jurisdictionVerifiedAt &&
    sameCountrySource(
      applicability.jurisdiction.source,
      jurisdiction.source,
    ) &&
    applicability.membership.isDemo === jurisdiction.membershipIsDemo &&
    applicability.membership.validFrom === jurisdiction.validFrom &&
    applicability.membership.validTo === jurisdiction.validTo &&
    applicability.membership.verifiedAt === jurisdiction.verifiedAt &&
    sameCountrySource(
      applicability.membership.source,
      jurisdiction.membershipSource,
    )
  );
}

function regulationHasVisibleLifecycle(
  regulation: ProfileRegulation,
  group: "current" | "future",
  asOf: string,
): boolean {
  if (group === "current") {
    return (
      regulation.statusAtAsOf === "effective" &&
      regulationIsCurrentAt(regulation, asOf)
    );
  }

  return (
    regulation.statusAtAsOf === "adopted" &&
    regulationIsFutureAdoptedAt(regulation, asOf)
  );
}

function countrySourcesAreExact(
  detail: AvailableCountryDetail,
  regulations: readonly ProfileRegulation[],
): boolean {
  const { country } = detail;
  const nestedSources = [
    country.source,
    ...country.jurisdictions.flatMap((jurisdiction) => [
      jurisdiction.source,
      jurisdiction.membershipSource,
    ]),
    ...regulations.map(({ source }) => source),
    ...country.marketMetrics.map(({ source }) => source),
  ];
  const expectedById = new Map<string, CountrySource>();
  for (const source of nestedSources) {
    const existing = expectedById.get(source.id);
    if (existing !== undefined && !sameCountrySource(existing, source)) {
      return false;
    }
    expectedById.set(source.id, source);
  }

  if (
    hasDuplicates(country.sources.map(({ id }) => id)) ||
    country.sources.length !== expectedById.size
  ) {
    return false;
  }
  return country.sources.every((source) => {
    const expected = expectedById.get(source.id);
    return expected !== undefined && sameCountrySource(source, expected);
  });
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

function summarySourceMatchesCountrySource(input: {
  entityIsDemo: boolean;
  source: AnalysisSource;
  visibleSource: CountrySource;
}): boolean {
  const { entityIsDemo, source, visibleSource } = input;
  return (
    source.isDemo === (entityIsDemo || visibleSource.isDemo) &&
    source.publishedOn === visibleSource.publishedOn &&
    source.sourceId === visibleSource.id &&
    source.sourceTitle === visibleSource.title &&
    source.sourceUrl === visibleSource.url &&
    source.verifiedAt === visibleSource.verifiedAt
  );
}

function summaryRegulationMatchesProfile(
  summary: SummaryRegulation,
  profile: ProfileRegulation,
): boolean {
  return (
    summary.applicability.countryIso3 ===
      profile.applicability.countryIso3 &&
    summary.applicability.jurisdiction.code ===
      profile.applicability.jurisdiction.code &&
    summary.applicability.jurisdiction.id ===
      profile.applicability.jurisdiction.id &&
    summary.applicability.jurisdiction.isDemo ===
      profile.applicability.jurisdiction.isDemo &&
    summary.applicability.jurisdiction.name ===
      profile.applicability.jurisdiction.name &&
    summary.applicability.jurisdiction.verifiedAt ===
      profile.applicability.jurisdiction.verifiedAt &&
    summary.applicability.membership.isDemo ===
      profile.applicability.membership.isDemo &&
    summary.applicability.membership.validFrom ===
      profile.applicability.membership.validFrom &&
    summary.applicability.membership.validTo ===
      profile.applicability.membership.validTo &&
    summary.applicability.membership.verifiedAt ===
      profile.applicability.membership.verifiedAt &&
    summary.canonicalName === profile.canonicalName &&
    summary.citationCode === profile.citationCode &&
    summary.effectiveFrom === profile.effectiveFrom &&
    summary.effectiveTo === profile.effectiveTo &&
    summary.id === profile.id &&
    summary.isDemo === profile.isDemo &&
    summary.recordStatus === profile.status &&
    summary.verifiedAt === profile.verifiedAt &&
    summarySourceMatchesCountrySource({
      entityIsDemo: profile.isDemo,
      source: summary.source,
      visibleSource: profile.source,
    }) &&
    summarySourceMatchesCountrySource({
      entityIsDemo: profile.applicability.jurisdiction.isDemo,
      source: summary.applicability.jurisdiction.source,
      visibleSource: profile.applicability.jurisdiction.source,
    }) &&
    summarySourceMatchesCountrySource({
      entityIsDemo: profile.applicability.membership.isDemo,
      source: summary.applicability.membership.source,
      visibleSource: profile.applicability.membership.source,
    })
  );
}

function applicabilitySummaryMatches(
  detail: AvailableCountryDetail,
): boolean {
  const { applicabilitySummary: summary, asOf, country } = detail;
  if (summary === null) {
    return true;
  }
  const comparison: RegulationComparison = {
    countries: [summary.country],
    missingData: summary.missingData,
    query: summary.query,
    sources: summary.sources,
  };
  const sourceKeys = summary.sources.map(analysisSourceKey);
  const summaryCountrySource = summary.country.countrySource;
  if (
    summary.query.asOf !== asOf ||
    summary.query.countryIso3s.length !== 1 ||
    summary.query.countryIso3s[0] !== country.iso3 ||
    summary.country.countryIso3 !== country.iso3 ||
    summary.country.countryIsDemo !== country.isDemo ||
    summary.country.countryName !== country.nameEn ||
    summaryCountrySource === null ||
    summaryCountrySource.countryIso2 !== country.iso2 ||
    summaryCountrySource.countryNameLocal !== country.nameLocal ||
    summaryCountrySource.id !== country.source.id ||
    summaryCountrySource.isDemo !== country.source.isDemo ||
    summaryCountrySource.publishedOn !== country.source.publishedOn ||
    summaryCountrySource.title !== country.source.title ||
    summaryCountrySource.url !== country.source.url ||
    summaryCountrySource.verifiedAt !== country.source.verifiedAt ||
    hasDuplicates(sourceKeys) ||
    !regulationComparisonMatchesDeterministicRules(comparison) ||
    !regulationComparisonSourcesMatchVisibleFacts(comparison) ||
    !matchesLatestInstant(
      summary.lastVerifiedAt,
      summary.sources.map(({ verifiedAt }) => verifiedAt),
    )
  ) {
    return false;
  }

  return (
    summary.country.currentEffectiveRegulations.every((regulation) => {
      const profile = country.currentEffectiveRegulations.find(
        ({ id }) => id === regulation.id,
      );
      return (
        profile !== undefined &&
        summaryRegulationMatchesProfile(regulation, profile)
      );
    }) &&
    summary.country.futureAdoptedRegulations.every((regulation) => {
      const profile = country.futureAdoptedRegulations.find(
        ({ id }) => id === regulation.id,
      );
      return (
        profile !== undefined &&
        summaryRegulationMatchesProfile(regulation, profile)
      );
    })
  );
}

/**
 * Recomputes every country-detail decision supported by its public payload.
 * Database completeness, application-scope truth, a null summary's missing
 * caller context, and the runtime clock behind `isStale` remain out of scope.
 */
export function countryDetailResponseMatchesDeterministicRules(
  response: CountryDetailResponse,
): boolean {
  try {
    if (response.status === "no_data") {
      return true;
    }

    const { asOf, country } = response;
    const current = country.currentEffectiveRegulations;
    const future = country.futureAdoptedRegulations;
    const regulations = [...current, ...future];
    if (
      !(
        (country.dataCoverageStatus === "covered" && !country.isDemo) ||
        (country.dataCoverageStatus === "demo" && country.isDemo)
      ) ||
      hasDuplicates(country.jurisdictions.map(({ id }) => id)) ||
      hasDuplicates(country.marketMetrics.map(({ id }) => id)) ||
      hasDuplicates(country.marketMetrics.map(marketMetricObservationKey)) ||
      hasDuplicates(regulations.map(({ id }) => id)) ||
      country.marketMetrics.some(
        (metric) =>
          metric.countryIso3 !== country.iso3 ||
          metric.periodEnd <= metric.periodStart ||
          !marketMetricDecimalSchema.safeParse(metric.valueNumeric).success ||
          (metric.currencyCode !== null &&
            !/^[A-Z]{3}$/u.test(metric.currencyCode)),
      ) ||
      country.jurisdictions.some(
        (jurisdiction) =>
          !validHalfOpenRange(
            jurisdiction.validFrom,
            jurisdiction.validTo,
          ) ||
          !containsDate(
            asOf,
            jurisdiction.validFrom,
            jurisdiction.validTo,
          ),
      ) ||
      current.some(
        (regulation) =>
          !regulationHasVisibleLifecycle(regulation, "current", asOf) ||
          !jurisdictionProjectionMatches(response, regulation),
      ) ||
      future.some(
        (regulation) =>
          !regulationHasVisibleLifecycle(regulation, "future", asOf) ||
          !jurisdictionProjectionMatches(response, regulation),
      ) ||
      !countrySourcesAreExact(response, regulations) ||
      !matchesLatestInstant(country.lastVerifiedAt, [
        country.verifiedAt,
        ...country.jurisdictions.flatMap(
          ({ jurisdictionVerifiedAt, verifiedAt }) => [
            jurisdictionVerifiedAt,
            verifiedAt,
          ],
        ),
        ...regulations.map(({ verifiedAt }) => verifiedAt),
        ...country.marketMetrics.map(({ verifiedAt }) => verifiedAt),
        ...country.sources.map(({ verifiedAt }) => verifiedAt),
      ]) ||
      !applicabilitySummaryMatches(response)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
