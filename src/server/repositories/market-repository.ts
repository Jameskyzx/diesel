import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { compareMarketsInputSchema } from "@/features/marketing/schemas";
import * as schema from "@/server/db/schema";
import {
  countries,
  dataSources,
  marketMetrics,
} from "@/server/db/schema";

const countryDataSources = aliasedTable(
  dataSources,
  "market_country_data_sources",
);

export function createMarketRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>) {
  return {
    async findForComparison(input: unknown) {
      const query = compareMarketsInputSchema.parse(input);
      const filters = [
        inArray(marketMetrics.countryIso3, query.countryIso3s),
        isNull(marketMetrics.archivedAt),
        isNull(countries.archivedAt),
        isNull(countryDataSources.archivedAt),
        isNull(dataSources.archivedAt),
      ];

      if (query.metricCodes) {
        filters.push(inArray(marketMetrics.metricCode, query.metricCodes));
      }
      if (query.applicationScope) {
        filters.push(
          or(
            eq(marketMetrics.applicationScope, query.applicationScope),
            isNull(marketMetrics.applicationScope),
          )!,
        );
      }

      return database
        .select({
          applicationScope: marketMetrics.applicationScope,
          countryIso3: marketMetrics.countryIso3,
          countryName: countries.nameEn,
          currencyCode: marketMetrics.currencyCode,
          definition: marketMetrics.definition,
          id: marketMetrics.id,
          isDemo: marketMetrics.isDemo,
          methodologyVersion: marketMetrics.methodologyVersion,
          metricCode: marketMetrics.metricCode,
          metricName: marketMetrics.metricName,
          periodEnd: marketMetrics.periodEnd,
          periodStart: marketMetrics.periodStart,
          publishedOn: marketMetrics.publishedOn,
          source: {
            id: dataSources.id,
            isDemo: dataSources.isDemo,
            publishedOn: dataSources.publishedOn,
            title: dataSources.title,
            url: dataSources.url,
            verifiedAt: dataSources.verifiedAt,
          },
          unitCode: marketMetrics.unitCode,
          valueNumeric: marketMetrics.valueNumeric,
          verifiedAt: marketMetrics.verifiedAt,
        })
        .from(marketMetrics)
        .innerJoin(countries, eq(marketMetrics.countryIso3, countries.iso3))
        .innerJoin(
          countryDataSources,
          eq(countries.dataSourceId, countryDataSources.id),
        )
        .innerJoin(
          dataSources,
          eq(marketMetrics.dataSourceId, dataSources.id),
        )
        .where(and(...filters))
        .orderBy(
          asc(marketMetrics.metricCode),
          asc(marketMetrics.countryIso3),
          desc(marketMetrics.periodEnd),
          desc(marketMetrics.periodStart),
          asc(marketMetrics.id),
        );
    },
  };
}
