import {
  aliasedTable,
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { applicableRegulationsQuerySchema } from "@/features/database/schemas";
import { compareRegulationsInputSchema } from "@/features/marketing/schemas";
import * as schema from "@/server/db/schema";
import {
  countries,
  countryJurisdictions,
  dataSources,
  jurisdictions,
  regulationLimits,
  regulations,
} from "@/server/db/schema";

const limitDataSources = aliasedTable(dataSources, "limit_data_sources");
const jurisdictionDataSources = aliasedTable(
  dataSources,
  "regulation_jurisdiction_data_sources",
);
const membershipDataSources = aliasedTable(
  dataSources,
  "regulation_membership_data_sources",
);
const countryDataSources = aliasedTable(
  dataSources,
  "regulation_country_data_sources",
);

export function createRegulationRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>) {
  return {
    async findForComparison(input: unknown) {
      const query = compareRegulationsInputSchema.parse(input);

      return database
        .select({
          applicability: {
            countryIso3: countryJurisdictions.countryIso3,
            jurisdictionCode: jurisdictions.code,
            jurisdictionId: jurisdictions.id,
            jurisdictionIsDemo: jurisdictions.isDemo,
            jurisdictionName: jurisdictions.name,
            jurisdictionSourceId: jurisdictionDataSources.id,
            jurisdictionSourceIsDemo: jurisdictionDataSources.isDemo,
            jurisdictionSourcePublishedOn: jurisdictionDataSources.publishedOn,
            jurisdictionSourceTitle: jurisdictionDataSources.title,
            jurisdictionSourceUrl: jurisdictionDataSources.url,
            jurisdictionSourceVerifiedAt: jurisdictionDataSources.verifiedAt,
            jurisdictionVerifiedAt: jurisdictions.verifiedAt,
            membershipIsDemo: countryJurisdictions.isDemo,
            membershipSourceId: membershipDataSources.id,
            membershipSourceIsDemo: membershipDataSources.isDemo,
            membershipSourcePublishedOn: membershipDataSources.publishedOn,
            membershipSourceTitle: membershipDataSources.title,
            membershipSourceUrl: membershipDataSources.url,
            membershipSourceVerifiedAt: membershipDataSources.verifiedAt,
            membershipValidFrom: countryJurisdictions.validFrom,
            membershipValidTo: countryJurisdictions.validTo,
            membershipVerifiedAt: countryJurisdictions.verifiedAt,
          },
          applicationScope: regulationLimits.applicationScope,
          adoptedOn: regulations.adoptedOn,
          canonicalName: regulations.canonicalName,
          citationCode: regulations.citationCode,
          countryIso3: countryJurisdictions.countryIso3,
          effectiveFrom: regulations.effectiveFrom,
          effectiveTo: regulations.effectiveTo,
          isDemo: regulations.isDemo,
          limit: {
            id: regulationLimits.id,
            isDemo: regulationLimits.isDemo,
            limitValue: regulationLimits.limitValue,
            pollutantCode: regulationLimits.pollutantCode,
            powerMaxKw: regulationLimits.powerMaxKw,
            powerMinKw: regulationLimits.powerMinKw,
            sourceId: limitDataSources.id,
            sourceIsDemo: limitDataSources.isDemo,
            sourcePublishedOn: limitDataSources.publishedOn,
            sourceTitle: limitDataSources.title,
            sourceUrl: limitDataSources.url,
            sourceVerifiedAt: limitDataSources.verifiedAt,
            testCycleCode: regulationLimits.testCycleCode,
            unitCode: regulationLimits.unitCode,
            validFrom: regulationLimits.validFrom,
            validTo: regulationLimits.validTo,
            verifiedAt: regulationLimits.verifiedAt,
          },
          regulationId: regulations.id,
          source: {
            id: dataSources.id,
            isDemo: dataSources.isDemo,
            publishedOn: dataSources.publishedOn,
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
          countries,
          eq(countryJurisdictions.countryIso3, countries.iso3),
        )
        .innerJoin(
          countryDataSources,
          eq(countries.dataSourceId, countryDataSources.id),
        )
        .innerJoin(
          membershipDataSources,
          eq(countryJurisdictions.dataSourceId, membershipDataSources.id),
        )
        .innerJoin(
          regulationLimits,
          eq(regulationLimits.regulationId, regulations.id),
        )
        .innerJoin(dataSources, eq(regulations.dataSourceId, dataSources.id))
        .innerJoin(
          limitDataSources,
          eq(regulationLimits.dataSourceId, limitDataSources.id),
        )
        .where(
          and(
            inArray(countryJurisdictions.countryIso3, query.countryIso3s),
            isNull(countries.archivedAt),
            isNull(countryDataSources.archivedAt),
            isNull(countryJurisdictions.archivedAt),
            isNull(jurisdictions.archivedAt),
            isNull(jurisdictionDataSources.archivedAt),
            isNull(membershipDataSources.archivedAt),
            isNull(regulations.archivedAt),
            isNull(regulationLimits.archivedAt),
            isNull(dataSources.archivedAt),
            isNull(limitDataSources.archivedAt),
            lte(countryJurisdictions.validFrom, query.asOf),
            or(
              isNull(countryJurisdictions.validTo),
              gt(countryJurisdictions.validTo, query.asOf),
            ),
            inArray(regulations.status, [
              "adopted",
              "effective",
              "superseded",
            ]),
            or(
              and(
                or(
                  eq(regulations.status, "effective"),
                  and(
                    eq(regulations.status, "superseded"),
                    isNotNull(regulations.effectiveTo),
                  ),
                ),
                lte(regulations.effectiveFrom, query.asOf),
                or(
                  isNull(regulations.effectiveTo),
                  gt(regulations.effectiveTo, query.asOf),
                ),
                lte(regulationLimits.validFrom, query.asOf),
                or(
                  isNull(regulationLimits.validTo),
                  gt(regulationLimits.validTo, query.asOf),
                ),
              ),
              and(
                or(
                  eq(regulations.status, "adopted"),
                  eq(regulations.status, "effective"),
                  and(
                    eq(regulations.status, "superseded"),
                    isNotNull(regulations.effectiveTo),
                  ),
                ),
                lte(regulations.adoptedOn, query.asOf),
                or(
                  isNull(regulations.effectiveFrom),
                  gt(regulations.effectiveFrom, query.asOf),
                ),
                or(
                  isNull(regulationLimits.validTo),
                  gt(regulationLimits.validTo, query.asOf),
                ),
              ),
            ),
            eq(regulationLimits.applicationScope, query.applicationScope),
            or(
              isNull(regulationLimits.powerMinKw),
              lte(regulationLimits.powerMinKw, query.powerKw),
            ),
            or(
              isNull(regulationLimits.powerMaxKw),
              gt(regulationLimits.powerMaxKw, query.powerKw),
            ),
          ),
        )
        .orderBy(
          asc(countryJurisdictions.countryIso3),
          asc(regulations.canonicalName),
          asc(regulationLimits.pollutantCode),
        );
    },

    async findEffectiveByCountry(input: unknown) {
      const query = applicableRegulationsQuerySchema.parse(input);

      return database
        .select({
          applicability: {
            countryIso3: countryJurisdictions.countryIso3,
            jurisdictionCode: jurisdictions.code,
            jurisdictionId: jurisdictions.id,
            jurisdictionIsDemo: jurisdictions.isDemo,
            jurisdictionName: jurisdictions.name,
            jurisdictionSourceId: jurisdictionDataSources.id,
            jurisdictionSourceIsDemo: jurisdictionDataSources.isDemo,
            jurisdictionSourcePublishedOn: jurisdictionDataSources.publishedOn,
            jurisdictionSourceTitle: jurisdictionDataSources.title,
            jurisdictionSourceUrl: jurisdictionDataSources.url,
            jurisdictionSourceVerifiedAt: jurisdictionDataSources.verifiedAt,
            jurisdictionVerifiedAt: jurisdictions.verifiedAt,
            membershipIsDemo: countryJurisdictions.isDemo,
            membershipSourceId: membershipDataSources.id,
            membershipSourceIsDemo: membershipDataSources.isDemo,
            membershipSourcePublishedOn: membershipDataSources.publishedOn,
            membershipSourceTitle: membershipDataSources.title,
            membershipSourceUrl: membershipDataSources.url,
            membershipSourceVerifiedAt: membershipDataSources.verifiedAt,
            membershipValidFrom: countryJurisdictions.validFrom,
            membershipValidTo: countryJurisdictions.validTo,
            membershipVerifiedAt: countryJurisdictions.verifiedAt,
          },
          applicationScope: regulationLimits.applicationScope,
          canonicalName: regulations.canonicalName,
          citationCode: regulations.citationCode,
          effectiveFrom: regulations.effectiveFrom,
          effectiveTo: regulations.effectiveTo,
          isDemo: regulations.isDemo,
          limit: {
            dataSourceId: regulationLimits.dataSourceId,
            id: regulationLimits.id,
            isDemo: regulationLimits.isDemo,
            limitValue: regulationLimits.limitValue,
            pollutantCode: regulationLimits.pollutantCode,
            powerMaxKw: regulationLimits.powerMaxKw,
            powerMinKw: regulationLimits.powerMinKw,
            sourceId: limitDataSources.id,
            sourceIsDemo: limitDataSources.isDemo,
            sourcePublishedOn: limitDataSources.publishedOn,
            sourceTitle: limitDataSources.title,
            sourceUrl: limitDataSources.url,
            sourceVerifiedAt: limitDataSources.verifiedAt,
            testCycleCode: regulationLimits.testCycleCode,
            unitCode: regulationLimits.unitCode,
            validFrom: regulationLimits.validFrom,
            validTo: regulationLimits.validTo,
            verifiedAt: regulationLimits.verifiedAt,
          },
          regulationId: regulations.id,
          source: {
            id: dataSources.id,
            isDemo: dataSources.isDemo,
            publishedOn: dataSources.publishedOn,
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
          countries,
          eq(countryJurisdictions.countryIso3, countries.iso3),
        )
        .innerJoin(
          countryDataSources,
          eq(countries.dataSourceId, countryDataSources.id),
        )
        .innerJoin(
          membershipDataSources,
          eq(countryJurisdictions.dataSourceId, membershipDataSources.id),
        )
        .innerJoin(
          regulationLimits,
          eq(regulationLimits.regulationId, regulations.id),
        )
        .innerJoin(dataSources, eq(regulations.dataSourceId, dataSources.id))
        .innerJoin(
          limitDataSources,
          eq(regulationLimits.dataSourceId, limitDataSources.id),
        )
        .where(
          and(
            eq(countryJurisdictions.countryIso3, query.countryIso3),
            isNull(countries.archivedAt),
            isNull(countryDataSources.archivedAt),
            isNull(countryJurisdictions.archivedAt),
            isNull(jurisdictions.archivedAt),
            isNull(jurisdictionDataSources.archivedAt),
            isNull(membershipDataSources.archivedAt),
            isNull(regulations.archivedAt),
            isNull(regulationLimits.archivedAt),
            isNull(dataSources.archivedAt),
            isNull(limitDataSources.archivedAt),
            lte(countryJurisdictions.validFrom, query.asOf),
            or(
              isNull(countryJurisdictions.validTo),
              gt(countryJurisdictions.validTo, query.asOf),
            ),
            or(
              eq(regulations.status, "effective"),
              and(
                eq(regulations.status, "superseded"),
                isNotNull(regulations.effectiveTo),
              ),
            ),
            lte(regulations.effectiveFrom, query.asOf),
            or(
              isNull(regulations.effectiveTo),
              gt(regulations.effectiveTo, query.asOf),
            ),
            eq(regulationLimits.applicationScope, query.applicationScope),
            lte(regulationLimits.validFrom, query.asOf),
            or(
              isNull(regulationLimits.validTo),
              gt(regulationLimits.validTo, query.asOf),
            ),
            or(
              isNull(regulationLimits.powerMinKw),
              lte(regulationLimits.powerMinKw, query.powerKw),
            ),
            or(
              isNull(regulationLimits.powerMaxKw),
              gt(regulationLimits.powerMaxKw, query.powerKw),
            ),
          ),
        )
        .orderBy(regulations.canonicalName, regulationLimits.pollutantCode);
    },
  };
}
