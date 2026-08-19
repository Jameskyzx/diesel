import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  gt,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  countryQuerySchema,
  isoDateSchema,
} from "@/features/database/schemas";
import * as schema from "@/server/db/schema";
import {
  countries,
  countryJurisdictions,
  dataSources,
  jurisdictions,
  marketMetrics,
  regulations,
} from "@/server/db/schema";

const jurisdictionDataSources = aliasedTable(
  dataSources,
  "jurisdiction_data_sources",
);
const membershipDataSources = aliasedTable(
  dataSources,
  "membership_data_sources",
);

export function createCountryRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>) {
  const countryDetailsQuerySchema = countryQuerySchema
    .extend({ asOf: isoDateSchema })
    .strict();

  async function findByIso3(input: unknown) {
    const { iso3 } = countryQuerySchema.parse(input);

    const rows = await database
      .select({
        dataCoverageStatus: countries.dataCoverageStatus,
        isDemo: countries.isDemo,
        iso2: countries.iso2,
        iso3: countries.iso3,
        nameEn: countries.nameEn,
        nameLocal: countries.nameLocal,
        regionCode: countries.regionCode,
        source: {
          id: dataSources.id,
          isDemo: dataSources.isDemo,
          publishedOn: dataSources.publishedOn,
          publisher: dataSources.publisher,
          title: dataSources.title,
          url: dataSources.url,
          verifiedAt: dataSources.verifiedAt,
        },
        subregionCode: countries.subregionCode,
        verifiedAt: countries.verifiedAt,
      })
      .from(countries)
      .innerJoin(dataSources, eq(countries.dataSourceId, dataSources.id))
      .where(
        and(
          eq(countries.iso3, iso3),
          isNull(countries.archivedAt),
          isNull(dataSources.archivedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  return {
    findByIso3,
    async findDetailsByIso3(input: unknown) {
      const { asOf, iso3 } = countryDetailsQuerySchema.parse(input);
      const country = await findByIso3({ iso3 });

      if (!country) {
        return null;
      }

      const [jurisdictionRows, regulationRows, marketMetricRows] =
        await Promise.all([
        database
          .select({
            code: jurisdictions.code,
            id: jurisdictions.id,
            isDemo: jurisdictions.isDemo,
            jurisdictionVerifiedAt: jurisdictions.verifiedAt,
            membershipIsDemo: countryJurisdictions.isDemo,
            membershipSource: {
              id: membershipDataSources.id,
              isDemo: membershipDataSources.isDemo,
              publishedOn: membershipDataSources.publishedOn,
              publisher: membershipDataSources.publisher,
              title: membershipDataSources.title,
              url: membershipDataSources.url,
              verifiedAt: membershipDataSources.verifiedAt,
            },
            name: jurisdictions.name,
            source: {
              id: jurisdictionDataSources.id,
              isDemo: jurisdictionDataSources.isDemo,
              publishedOn: jurisdictionDataSources.publishedOn,
              publisher: jurisdictionDataSources.publisher,
              title: jurisdictionDataSources.title,
              url: jurisdictionDataSources.url,
              verifiedAt: jurisdictionDataSources.verifiedAt,
            },
            type: jurisdictions.type,
            validFrom: countryJurisdictions.validFrom,
            validTo: countryJurisdictions.validTo,
            verifiedAt: countryJurisdictions.verifiedAt,
          })
          .from(countryJurisdictions)
          .innerJoin(
            jurisdictions,
            eq(countryJurisdictions.jurisdictionId, jurisdictions.id),
          )
          .innerJoin(
            jurisdictionDataSources,
            eq(jurisdictions.dataSourceId, jurisdictionDataSources.id),
          )
          .innerJoin(
            membershipDataSources,
            eq(countryJurisdictions.dataSourceId, membershipDataSources.id),
          )
          .where(
            and(
              eq(countryJurisdictions.countryIso3, iso3),
              isNull(countryJurisdictions.archivedAt),
              isNull(jurisdictions.archivedAt),
              isNull(jurisdictionDataSources.archivedAt),
              isNull(membershipDataSources.archivedAt),
              lte(countryJurisdictions.validFrom, asOf),
              or(
                isNull(countryJurisdictions.validTo),
                gt(countryJurisdictions.validTo, asOf),
              ),
            ),
          )
          .orderBy(asc(jurisdictions.name)),
        database
          .select({
            applicability: {
              countryIso3: countryJurisdictions.countryIso3,
              jurisdictionCode: jurisdictions.code,
              jurisdictionId: jurisdictions.id,
              jurisdictionIsDemo: jurisdictions.isDemo,
              jurisdictionName: jurisdictions.name,
              jurisdictionSourceId: jurisdictionDataSources.id,
              jurisdictionSourceIsDemo: jurisdictionDataSources.isDemo,
              jurisdictionSourcePublishedOn:
                jurisdictionDataSources.publishedOn,
              jurisdictionSourcePublisher: jurisdictionDataSources.publisher,
              jurisdictionSourceTitle: jurisdictionDataSources.title,
              jurisdictionSourceUrl: jurisdictionDataSources.url,
              jurisdictionSourceVerifiedAt:
                jurisdictionDataSources.verifiedAt,
              jurisdictionVerifiedAt: jurisdictions.verifiedAt,
              membershipIsDemo: countryJurisdictions.isDemo,
              membershipSourceId: membershipDataSources.id,
              membershipSourceIsDemo: membershipDataSources.isDemo,
              membershipSourcePublishedOn: membershipDataSources.publishedOn,
              membershipSourcePublisher: membershipDataSources.publisher,
              membershipSourceTitle: membershipDataSources.title,
              membershipSourceUrl: membershipDataSources.url,
              membershipSourceVerifiedAt: membershipDataSources.verifiedAt,
              membershipValidFrom: countryJurisdictions.validFrom,
              membershipValidTo: countryJurisdictions.validTo,
              membershipVerifiedAt: countryJurisdictions.verifiedAt,
            },
            adoptedOn: regulations.adoptedOn,
            canonicalName: regulations.canonicalName,
            citationCode: regulations.citationCode,
            effectiveFrom: regulations.effectiveFrom,
            effectiveTo: regulations.effectiveTo,
            id: regulations.id,
            isDemo: regulations.isDemo,
            proposedOn: regulations.proposedOn,
            source: {
              id: dataSources.id,
              isDemo: dataSources.isDemo,
              publishedOn: dataSources.publishedOn,
              publisher: dataSources.publisher,
              title: dataSources.title,
              url: dataSources.url,
              verifiedAt: dataSources.verifiedAt,
            },
            status: regulations.status,
            verifiedAt: regulations.verifiedAt,
          })
          .from(regulations)
          .innerJoin(
            jurisdictions,
            eq(regulations.jurisdictionId, jurisdictions.id),
          )
          .innerJoin(
            jurisdictionDataSources,
            eq(jurisdictions.dataSourceId, jurisdictionDataSources.id),
          )
          .innerJoin(
            countryJurisdictions,
            eq(regulations.jurisdictionId, countryJurisdictions.jurisdictionId),
          )
          .innerJoin(
            membershipDataSources,
            eq(countryJurisdictions.dataSourceId, membershipDataSources.id),
          )
          .innerJoin(dataSources, eq(regulations.dataSourceId, dataSources.id))
          .where(
            and(
              eq(countryJurisdictions.countryIso3, iso3),
              isNull(countryJurisdictions.archivedAt),
              isNull(jurisdictions.archivedAt),
              isNull(jurisdictionDataSources.archivedAt),
              isNull(membershipDataSources.archivedAt),
              isNull(regulations.archivedAt),
              isNull(dataSources.archivedAt),
              lte(countryJurisdictions.validFrom, asOf),
              or(
                isNull(countryJurisdictions.validTo),
                gt(countryJurisdictions.validTo, asOf),
              ),
            ),
          )
          .orderBy(desc(regulations.effectiveFrom), asc(regulations.canonicalName)),
        database
          .select({
            applicationScope: marketMetrics.applicationScope,
            currencyCode: marketMetrics.currencyCode,
            definition: marketMetrics.definition,
            id: marketMetrics.id,
            isDemo: marketMetrics.isDemo,
            metricCode: marketMetrics.metricCode,
            metricName: marketMetrics.metricName,
            methodologyVersion: marketMetrics.methodologyVersion,
            periodEnd: marketMetrics.periodEnd,
            periodStart: marketMetrics.periodStart,
            publishedOn: marketMetrics.publishedOn,
            source: {
              id: dataSources.id,
              isDemo: dataSources.isDemo,
              publishedOn: dataSources.publishedOn,
              publisher: dataSources.publisher,
              title: dataSources.title,
              url: dataSources.url,
              verifiedAt: dataSources.verifiedAt,
            },
            unitCode: marketMetrics.unitCode,
            valueNumeric: marketMetrics.valueNumeric,
            verifiedAt: marketMetrics.verifiedAt,
          })
          .from(marketMetrics)
          .innerJoin(
            dataSources,
            eq(marketMetrics.dataSourceId, dataSources.id),
          )
          .where(
            and(
              eq(marketMetrics.countryIso3, iso3),
              isNull(marketMetrics.archivedAt),
              isNull(dataSources.archivedAt),
            ),
          )
          .orderBy(desc(marketMetrics.periodEnd), asc(marketMetrics.metricName)),
        ]);

      return {
        ...country,
        jurisdictions: jurisdictionRows,
        marketMetrics: marketMetricRows,
        regulations: regulationRows,
      };
    },
    async listMapSummaries() {
      return database
        .select({
          dataCoverageStatus: countries.dataCoverageStatus,
          isDemo: sql<boolean>`${countries.isDemo} OR ${dataSources.isDemo}`,
          iso2: countries.iso2,
          iso3: countries.iso3,
          nameEn: countries.nameEn,
          nameLocal: countries.nameLocal,
          verifiedAt: countries.verifiedAt,
        })
        .from(countries)
        .innerJoin(
          dataSources,
          and(
            eq(dataSources.id, countries.dataSourceId),
            isNull(dataSources.archivedAt),
          ),
        )
        .where(isNull(countries.archivedAt))
        .orderBy(asc(countries.nameEn));
    },
  };
}
