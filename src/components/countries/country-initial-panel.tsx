import { CalendarDays, Database, FileCheck2, MapPin } from "lucide-react";

import type { CountryDetailResponse } from "@/features/countries/schemas";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { formatOptionalUtcDate, formatUtcDate } from "@/i18n/date";
import type { Locale } from "@/i18n/locale";

export function CountryInitialPanel({
  detail,
  dictionary,
  hasGeometry,
  locale,
}: {
  detail: CountryDetailResponse;
  dictionary: Dictionary;
  hasGeometry: boolean;
  locale: Locale;
}) {
  const copy = dictionary.country;
  const coverageLabels = {
    covered: copy.coverageCovered,
    demo: copy.coverageDemo,
    no_data: copy.coverageNoData,
    none: copy.coverageNone,
    planned: copy.coveragePlanned,
  } as const;

  if (detail.status === "no_data") {
    return (
      <div className="p-6 sm:p-8">
        <p className="text-xs font-semibold tracking-[0.18em] text-primary">
          {copy.serverSnapshot}
        </p>
        <MapPin aria-hidden="true" className="mt-8 size-7 text-primary" />
        <h2 className="mt-4 text-2xl font-semibold">
          {detail.iso3} {copy.noDataSuffix}
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {hasGeometry
            ? copy.geometryNoData
            : copy.missingGeometryNoData}
        </p>
      </div>
    );
  }

  const { country } = detail;
  return (
    <div className="space-y-6 p-6 sm:p-8">
      <header>
        <p className="text-xs font-semibold tracking-[0.18em] text-primary">
          {copy.serverSnapshot}
        </p>
        <h2 className="mt-3 text-2xl font-semibold">
          {formatCountryDisplayName(country, locale)}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {country.iso3} · {coverageLabels[country.dataCoverageStatus]}
        </p>
      </header>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl border p-3">
          <dt className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays aria-hidden="true" className="size-3.5" />
            {copy.queryAsOf}
          </dt>
          <dd className="mt-1 font-semibold">
            {formatUtcDate(detail.asOf, locale)}
          </dd>
        </div>
        <div className="rounded-xl border p-3">
          <dt className="flex items-center gap-2 text-xs text-muted-foreground">
            <Database aria-hidden="true" className="size-3.5" />
            {copy.lastVerified}
          </dt>
          <dd className="mt-1 font-semibold">
            {formatUtcDate(country.lastVerifiedAt, locale)}
            {country.isStale ? ` · ${copy.staleBadge}` : ""}
          </dd>
        </div>
      </dl>

      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FileCheck2 aria-hidden="true" className="size-4 text-primary" />
          {copy.currentRegulations} ({country.currentEffectiveRegulations.length})
        </h3>
        {country.currentEffectiveRegulations.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {country.currentEffectiveRegulations.slice(0, 4).map((regulation) => (
              <li className="rounded-xl border p-3 text-sm" key={regulation.id}>
                <p className="font-semibold">{regulation.canonicalName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {regulation.citationCode ?? copy.citationMissing} ·{" "}
                  {copy.effectiveDate}{" "}
                  {formatOptionalUtcDate(
                    regulation.effectiveFrom,
                    locale,
                    dictionary.common.notRecorded,
                  )}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
            {copy.currentRegulationsEmpty}
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
        <p className="font-semibold text-foreground">{copy.recordSource}</p>
        <p className="mt-1">{country.source.title}</p>
        <p>{country.source.publisher ?? copy.noPublisher}</p>
      </section>
    </div>
  );
}
