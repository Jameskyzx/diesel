import "server-only";

import {
  regulationIsCurrentAt,
  regulationIsFutureAdoptedAt,
} from "@/domain/countries/detail-consistency";
import { env } from "@/env";
import {
  countryDetailResponseSchema,
  countryMapResponseSchema,
  type CountryDetailResponse,
  type CountryMapResponse,
} from "@/features/countries/schemas";
import {
  isDemoCountryProfile,
  isDemoJurisdiction,
  isDemoMarketMetric,
  isDemoRegulation,
  isDemoRegulationComparisonRow,
  publicMapClassification,
} from "@/features/countries/publication";
import {
  countryDetailQuerySchema,
  hasDetailedCountryCoverage,
} from "@/features/database/schemas";
import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import { createCountryRepository } from "@/server/repositories/country-repository";
import { createRegulationRepository } from "@/server/repositories/regulation-repository";
import {
  compareRegulationsFromRepositories,
  type RegulationComparisonRepositories,
} from "@/server/services/marketing-analysis-service";
import {
  throwIfRequestAborted,
  type RequestSignalOptions,
} from "@/server/http/request-signal";

function serializeDate(value: Date): string {
  return value.toISOString();
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export const COUNTRY_DETAIL_READ_TRANSACTION_CONFIG = {
  accessMode: "read only",
  isolationLevel: "repeatable read",
} as const;

type CountryDetailReadQuery = Omit<
  ReturnType<typeof countryDetailQuerySchema.parse>,
  "asOf"
> & {
  asOf: string;
};

type CountryDetailReadRepositories = RegulationComparisonRepositories & {
  countryRepository: ReturnType<typeof createCountryRepository>;
};

export function isCurrentEffectiveRegulation(
  regulation: {
    adoptedOn: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    status: string;
  },
  asOf: string,
): boolean {
  return regulationIsCurrentAt(regulation, asOf);
}

export function isFutureAdoptedRegulation(
  regulation: {
    adoptedOn: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    status: string;
  },
  asOf: string,
): boolean {
  return regulationIsFutureAdoptedAt(regulation, asOf);
}

export function latestTimestamp(values: readonly string[]): string {
  if (values.length === 0) {
    return new Date(0).toISOString();
  }

  let latest: string | null = null;
  let latestInstant = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const instant = Date.parse(value);
    if (Number.isFinite(instant) && instant > latestInstant) {
      latest = value;
      latestInstant = instant;
    }
  }
  if (latest === null) {
    throw new Error("Country verification timestamps were invalid.");
  }
  return latest;
}

/**
 * ADR-045：核验新鲜度判定（纯函数，时钟可注入）。
 * 超过阈值天数未核验视为 stale（UI 仅告警，不隐藏数据）。
 */
export function isStaleVerification(
  verifiedIso: string,
  nowIso: string,
  thresholdDays: number,
): boolean {
  const ageMs = new Date(nowIso).getTime() - new Date(verifiedIso).getTime();
  return ageMs > thresholdDays * 24 * 60 * 60 * 1000;
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

export async function listCountryMapSummaries(
  options: RequestSignalOptions = {},
): Promise<CountryMapResponse> {
  const repository = await getCountryRepository(options);
  throwIfRequestAborted(options.signal);
  const rows = await repository.listMapSummaries(options);
  throwIfRequestAborted(options.signal);
  const nowIso = new Date().toISOString();
  const includeDemoData = getDatabaseMode() === "pglite-demo";

  return countryMapResponseSchema.parse({
    countries: rows.map((country) => {
      const verifiedAt = serializeDate(country.verifiedAt);
      const classification = publicMapClassification(
        country,
        includeDemoData,
      );
      return {
        ...country,
        ...classification,
        isStale: isStaleVerification(
          verifiedAt,
          nowIso,
          env.COUNTRY_STALE_AFTER_DAYS,
        ),
        verifiedAt,
      };
    }),
    status: "ok",
  });
}

export async function getCountryDetails(
  input: unknown,
  options: RequestSignalOptions = {},
): Promise<CountryDetailResponse> {
  throwIfRequestAborted(options.signal);
  const parsed = countryDetailQuerySchema.parse(input);
  const query: CountryDetailReadQuery = {
    ...parsed,
    asOf: parsed.asOf ?? currentUtcDate(),
  };
  const includeDemoData = getDatabaseMode() === "pglite-demo";

  if (includeDemoData) {
    const database = await getDemoDatabase();
    throwIfRequestAborted(options.signal);
    const result = await database.transaction(
      (transaction) =>
        getCountryDetailsFromRepositories(
          query,
          {
            countryRepository: createCountryRepository(transaction),
            regulationRepository: createRegulationRepository(transaction),
          },
          true,
          options,
        ),
      COUNTRY_DETAIL_READ_TRANSACTION_CONFIG,
    );
    throwIfRequestAborted(options.signal);
    return result;
  }

  const database = getDatabase();
  const result = await database.transaction(
    (transaction) =>
      getCountryDetailsFromRepositories(
        query,
        {
          countryRepository: createCountryRepository(transaction),
          regulationRepository: createRegulationRepository(transaction),
        },
        false,
        options,
      ),
    COUNTRY_DETAIL_READ_TRANSACTION_CONFIG,
  );
  throwIfRequestAborted(options.signal);
  return result;
}

async function getCountryDetailsFromRepositories(
  { applicationScope, asOf, iso3, powerKw }: CountryDetailReadQuery,
  repositories: CountryDetailReadRepositories,
  includeDemoData: boolean,
  options: RequestSignalOptions,
): Promise<CountryDetailResponse> {
  throwIfRequestAborted(options.signal);
  const { countryRepository } = repositories;
  const profile = await countryRepository.findByIso3({ iso3 }, options);
  throwIfRequestAborted(options.signal);

  // ADR-040：目录国家（planned/no_data/none）没有详情数据，保持 ADR-029
  // 的精确 no_data 契约；只有详情可见的覆盖状态才进入完整查询。
  if (
    !profile ||
    (!includeDemoData && isDemoCountryProfile(profile)) ||
    !hasDetailedCountryCoverage(profile.dataCoverageStatus)
  ) {
    return countryDetailResponseSchema.parse({
      iso3,
      status: "no_data",
    });
  }

  const country = await countryRepository.findDetailsByIso3(
    { asOf, iso3 },
    options,
  );
  throwIfRequestAborted(options.signal);

  if (!country) {
    return countryDetailResponseSchema.parse({
      iso3,
      status: "no_data",
    });
  }

  const {
    regulations: countryRegulationRows,
    ...countryWithoutRegulations
  } = country;
  const visibleCountryRegulationRows = includeDemoData
    ? countryRegulationRows
    : countryRegulationRows.filter(
        (regulation) => !isDemoRegulation(regulation),
      );
  const regulations = visibleCountryRegulationRows.map((regulation) => ({
    ...regulation,
    applicability: {
      countryIso3: regulation.applicability.countryIso3,
      jurisdiction: {
        code: regulation.applicability.jurisdictionCode,
        id: regulation.applicability.jurisdictionId,
        isDemo: regulation.applicability.jurisdictionIsDemo,
        name: regulation.applicability.jurisdictionName,
        source: {
          id: regulation.applicability.jurisdictionSourceId,
          isDemo: regulation.applicability.jurisdictionSourceIsDemo,
          publishedOn:
            regulation.applicability.jurisdictionSourcePublishedOn,
          publisher: regulation.applicability.jurisdictionSourcePublisher,
          title: regulation.applicability.jurisdictionSourceTitle,
          url: regulation.applicability.jurisdictionSourceUrl,
          verifiedAt: serializeDate(
            regulation.applicability.jurisdictionSourceVerifiedAt,
          ),
        },
        verifiedAt: serializeDate(
          regulation.applicability.jurisdictionVerifiedAt,
        ),
      },
      membership: {
        isDemo: regulation.applicability.membershipIsDemo,
        source: {
          id: regulation.applicability.membershipSourceId,
          isDemo: regulation.applicability.membershipSourceIsDemo,
          publishedOn: regulation.applicability.membershipSourcePublishedOn,
          publisher: regulation.applicability.membershipSourcePublisher,
          title: regulation.applicability.membershipSourceTitle,
          url: regulation.applicability.membershipSourceUrl,
          verifiedAt: serializeDate(
            regulation.applicability.membershipSourceVerifiedAt,
          ),
        },
        validFrom: regulation.applicability.membershipValidFrom,
        validTo: regulation.applicability.membershipValidTo,
        verifiedAt: serializeDate(
          regulation.applicability.membershipVerifiedAt,
        ),
      },
    },
    source: {
      ...regulation.source,
      verifiedAt: serializeDate(regulation.source.verifiedAt),
    },
    verifiedAt: serializeDate(regulation.verifiedAt),
  }));
  const visibleMarketMetricRows = includeDemoData
    ? country.marketMetrics
    : country.marketMetrics.filter(
        (metric) => !isDemoMarketMetric(metric),
      );
  const marketMetrics = visibleMarketMetricRows.map((metric) => ({
    ...metric,
    source: {
      ...metric.source,
      verifiedAt: serializeDate(metric.source.verifiedAt),
    },
    verifiedAt: serializeDate(metric.verifiedAt),
  }));
  const visibleJurisdictionRows = includeDemoData
    ? country.jurisdictions
    : country.jurisdictions.filter(
        (jurisdiction) => !isDemoJurisdiction(jurisdiction),
      );
  const jurisdictions = visibleJurisdictionRows.map((jurisdiction) => ({
    ...jurisdiction,
    jurisdictionVerifiedAt: serializeDate(
      jurisdiction.jurisdictionVerifiedAt,
    ),
    membershipSource: {
      ...jurisdiction.membershipSource,
      verifiedAt: serializeDate(jurisdiction.membershipSource.verifiedAt),
    },
    source: {
      ...jurisdiction.source,
      verifiedAt: serializeDate(jurisdiction.source.verifiedAt),
    },
    verifiedAt: serializeDate(jurisdiction.verifiedAt),
  }));
  const countrySource = {
    ...country.source,
    verifiedAt: serializeDate(country.source.verifiedAt),
  };
  const currentEffectiveRegulations = regulations
    .filter((regulation) => isCurrentEffectiveRegulation(regulation, asOf))
    .map((regulation) => ({
      ...regulation,
      statusAtAsOf: "effective" as const,
    }));
  const futureAdoptedRegulations = regulations
    .filter((regulation) => isFutureAdoptedRegulation(regulation, asOf))
    .map((regulation) => ({
      ...regulation,
      statusAtAsOf: "adopted" as const,
    }));
  const visibleRegulations = [
    ...currentEffectiveRegulations,
    ...futureAdoptedRegulations,
  ];
  const sources = Array.from(
    new Map(
      [
        countrySource,
        ...jurisdictions.flatMap(({ membershipSource, source }) => [
          source,
          membershipSource,
        ]),
        ...visibleRegulations.map(({ source }) => source),
        ...marketMetrics.map(({ source }) => source),
      ].map((source) => [source.id, source]),
    ).values(),
  );
  const lastVerifiedAt = latestTimestamp([
    serializeDate(country.verifiedAt),
    ...jurisdictions.flatMap(({ jurisdictionVerifiedAt, verifiedAt }) => [
      jurisdictionVerifiedAt,
      verifiedAt,
    ]),
    ...visibleRegulations.map(({ verifiedAt }) => verifiedAt),
    ...marketMetrics.map(({ verifiedAt }) => verifiedAt),
    ...sources.map(({ verifiedAt }) => verifiedAt),
  ]);
  const applicabilitySummary =
    applicationScope !== undefined && powerKw !== undefined
      ? await compareRegulationsFromRepositories(
          {
            applicationScope,
            asOf,
            countryIso3s: [iso3],
            powerKw,
          },
          {
            countryRepository,
            regulationRepository: {
              async findForComparison(queryInput, queryOptions) {
                const rows = await repositories.regulationRepository
                  .findForComparison(queryInput, queryOptions);
                return includeDemoData
                  ? rows
                  : rows.filter((row) => !isDemoRegulationComparisonRow(row));
              },
            },
          },
          options,
        ).then((comparison) => {
          throwIfRequestAborted(options.signal);
          const countryComparison = comparison.countries[0];
          if (!countryComparison) {
            throw new Error("Single-country applicability result was not produced.");
          }
          const verificationDates = comparison.sources.map(
            ({ verifiedAt }) => verifiedAt,
          );
          return {
            country: countryComparison,
            lastVerifiedAt:
              verificationDates.length > 0
                ? latestTimestamp(verificationDates)
                : null,
            missingData: comparison.missingData,
            query: comparison.query,
            sources: comparison.sources,
          };
        })
      : null;
  throwIfRequestAborted(options.signal);

  return countryDetailResponseSchema.parse({
    applicabilitySummary,
    asOf,
    country: {
      ...countryWithoutRegulations,
      currentEffectiveRegulations,
      futureAdoptedRegulations,
      isStale: isStaleVerification(
        lastVerifiedAt,
        new Date().toISOString(),
        env.COUNTRY_STALE_AFTER_DAYS,
      ),
      jurisdictions,
      lastVerifiedAt,
      marketMetrics,
      source: countrySource,
      sources,
      verifiedAt: serializeDate(country.verifiedAt),
    },
    status: "available",
  });
}
