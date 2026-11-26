import type { Metadata } from "next";
import { headers } from "next/headers";

import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import { PageHeader } from "@/components/layout/page-header";
import {
  RegulationTimelineFilters,
  RegulationTimelineList,
  timelineCopy,
} from "@/components/timeline/regulation-timeline";
import {
  regulationTimelineQuerySchema,
  type RegulationTimelineQuery,
} from "@/features/regulation-timeline/schemas";
import { formatUtcDate } from "@/i18n/date";
import { getDictionary } from "@/i18n/dictionaries";
import { getRequestLocale } from "@/i18n/server";
import { getErrorCode } from "@/lib/api-error";
import { runPublicDataRenderOperation } from "@/server/http/public-data-admission";
import { getCountryDirectory } from "@/server/services/country-directory";
import {
  getRegulationTimeline,
  regulationTimelineWindow,
} from "@/server/services/regulation-timeline-service";

const ROUTE = "/timeline";

export async function generateMetadata(): Promise<Metadata> {
  return { title: timelineCopy(await getRequestLocale()).title };
}

export default async function RegulationTimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getRequestLocale();
  const dictionary = getDictionary(locale);
  const copy = timelineCopy(locale);
  const parsed = regulationTimelineQuerySchema.safeParse(await searchParams);
  // An invalid filter falls back to the unfiltered default instead of a 404.
  const query: RegulationTimelineQuery = parsed.success
    ? parsed.data
    : regulationTimelineQuerySchema.parse({});
  const today = new Date().toISOString().slice(0, 10);
  const window = regulationTimelineWindow(today, query.horizonMonths);

  const operation = await runPublicDataRenderOperation({
    headers: await headers(),
    route: ROUTE,
    work: (signal) => getRegulationTimeline(query, today, { signal }),
  });
  if (operation.status !== "fulfilled") {
    console.error("Regulation timeline read failed", {
      route: ROUTE,
      status: operation.status,
      errorCode:
        operation.status === "failed"
          ? getErrorCode(operation.error)
          : `PUBLIC_DATA_${operation.status.toUpperCase()}`,
    });
  }

  return (
    <main className="page-shell space-y-5 py-6">
      <LocaleRenderReceipt locale={locale} />
      <PageHeader
        kicker="Global Diesel"
        title={copy.title}
        description={copy.description}
      />
      <RegulationTimelineFilters
        copy={copy}
        dictionary={dictionary}
        query={query}
      />
      <p className="text-xs text-muted-foreground">
        {copy.window(
          formatUtcDate(window.from, locale),
          formatUtcDate(window.to, locale),
        )}{" "}
        · {copy.coverageNotice}
      </p>
      {operation.status !== "fulfilled" ? (
        <p className="rounded-lg border bg-card p-4 text-sm" role="alert">
          {copy.unavailable}
        </p>
      ) : (
        <RegulationTimelineList
          copy={copy}
          dictionary={dictionary}
          directory={getCountryDirectory()}
          events={operation.value.events}
          locale={locale}
          query={query}
        />
      )}
    </main>
  );
}
