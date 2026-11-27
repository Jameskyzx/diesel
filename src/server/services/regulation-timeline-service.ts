import "server-only";

import {
  buildRegulationTimeline,
  type RegulationTimelineEvent,
} from "@/domain/regulation-timeline/build-timeline";
import {
  regulationTimelineLookbackMonths,
  type RegulationTimelineQuery,
  type RegulationTimelineWindow,
} from "@/features/regulation-timeline/schemas";
import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import {
  throwIfRequestAborted,
  type RequestSignalOptions,
} from "@/server/http/request-signal";
import { createRegulationRepository } from "@/server/repositories/regulation-repository";
import { loadPublishedCatalog } from "@/server/services/product-catalog";

async function getRegulationRepository(options: RequestSignalOptions) {
  throwIfRequestAborted(options.signal);
  if (getDatabaseMode() === "pglite-demo") {
    const database = await getDemoDatabase();
    throwIfRequestAborted(options.signal);
    return createRegulationRepository(database);
  }
  return createRegulationRepository(getDatabase());
}

/** Adds whole UTC calendar months, clamping to the last day of short months. */
export function addUtcMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function regulationTimelineWindow(
  today: string,
  horizonMonths: number,
): RegulationTimelineWindow {
  return {
    from: addUtcMonths(today, -regulationTimelineLookbackMonths),
    to: addUtcMonths(today, horizonMonths),
  };
}

export type RegulationTimelineResult = {
  window: RegulationTimelineWindow;
  today: string;
  events: RegulationTimelineEvent[];
  /** True when catalogue impact was evaluated (application and power given). */
  catalogEvaluated: boolean;
};

export async function getRegulationTimeline(
  query: RegulationTimelineQuery,
  today: string,
  options: RequestSignalOptions = {},
): Promise<RegulationTimelineResult> {
  const window = regulationTimelineWindow(today, query.horizonMonths);
  const repository = await getRegulationRepository(options);
  const rows = await repository.findTimelineRows(window, options);
  throwIfRequestAborted(options.signal);

  const catalogEvaluated =
    query.applicationScope !== undefined && query.powerKw !== undefined;
  const catalog = catalogEvaluated
    ? (await loadPublishedCatalog(options)).records
    : undefined;
  throwIfRequestAborted(options.signal);

  return {
    window,
    today,
    catalogEvaluated,
    events: buildRegulationTimeline({
      rows,
      window,
      today,
      filter: {
        applicationScope: query.applicationScope,
        powerKw: query.powerKw,
      },
      catalog,
    }),
  };
}
