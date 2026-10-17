import { and, asc, eq, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/server/db/schema";
import { catalogEngines, dataSources } from "@/server/db/schema";
import { throwIfRequestAborted, type RequestSignalOptions } from "@/server/http/request-signal";

export function createCatalogRepository<TQueryResult extends PgQueryResultHKT>(
  database: PgDatabase<TQueryResult, typeof schema>,
) {
  return {
    /**
     * Published, active demo catalogue rows whose source is also active. Real
     * (non-demo) catalogue rows stay out of the public read until a publication
     * approval like the product manifest exists.
     */
    async listPublishedDemoEngines(options: RequestSignalOptions = {}) {
      throwIfRequestAborted(options.signal);
      const rows = await database
        .select({
          aftertreatment: catalogEngines.aftertreatment,
          applicationScopes: catalogEngines.applicationScopes,
          category: catalogEngines.category,
          cylinders: catalogEngines.cylinders,
          declaredCitationCodes: catalogEngines.declaredCitationCodes,
          displacementL: catalogEngines.displacementL,
          emissionLabel: catalogEngines.emissionLabel,
          id: catalogEngines.id,
          modelCode: catalogEngines.modelCode,
          powerMaxKw: catalogEngines.powerMaxKw,
          powerMinKw: catalogEngines.powerMinKw,
          ratedPowerKw: catalogEngines.ratedPowerKw,
          ratedSpeedRpm: catalogEngines.ratedSpeedRpm,
          series: catalogEngines.series,
        })
        .from(catalogEngines)
        .innerJoin(dataSources, eq(catalogEngines.dataSourceId, dataSources.id))
        .where(and(
          isNull(catalogEngines.archivedAt),
          isNull(dataSources.archivedAt),
          eq(catalogEngines.isDemo, true),
          eq(dataSources.isDemo, true),
        ))
        .orderBy(asc(catalogEngines.modelCode));
      throwIfRequestAborted(options.signal);
      return rows;
    },
  };
}
