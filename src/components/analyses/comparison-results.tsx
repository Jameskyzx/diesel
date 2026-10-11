"use client";

import { useLocale } from "@/components/i18n/locale-provider";
import { AnalysisSources } from "./source-review";
import type { ComparisonSnapshot } from "@/features/analyses/schemas";
import { comparisonSearch } from "@/features/analyses/schemas";
import { buildComparisonRows, formatRecordedLimit } from "@/features/analyses/comparison-rows";
import { applicationScopeLabel, regulationDisplayName } from "@/i18n/structured-labels";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { formatOptionalUtcDate, formatUtcDate } from "@/i18n/date";

export function ComparisonResults({ snapshot, allowRefine = false }: { snapshot: ComparisonSnapshot; allowRefine?: boolean }) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.analysis;
  const { query, responses } = snapshot;
  const rows = buildComparisonRows(snapshot);
  const shared = rows.filter(row => row.cells.every(cell => cell.length > 0));
  const partial = rows.filter(row => row.cells.some(cell => cell.length === 0));
  const hasGaps = responses.some(response => response.status !== "available" || !response.applicabilitySummary || response.applicabilitySummary.missingData.length > 0);
  const describeRows = (items: typeof rows) => items.map(row => `${row.pollutant} (${row.unit})`).join(" · ");
  return <section className="space-y-4" data-testid="comparison-results">
    <h2 className="text-lg font-semibold">{copy.comparisonTitle}</h2>
    <p className="text-sm">{applicationScopeLabel(query.applicationScope, dictionary)} · {query.powerKw} kW · {formatUtcDate(query.asOf, locale)}</p>
    <p className="text-sm text-muted-foreground">{copy.comparisonNotice}</p>
    {rows.length > 0 ? <div className="space-y-2 rounded-md border bg-background p-4 text-sm" data-testid="comparison-summary">
      <h3 className="font-semibold">{copy.comparisonSummary}</h3>
      {shared.length > 0 ? <p>{copy.sharedMetrics}: {describeRows(shared)}</p> : null}
      {partial.length > 0 ? <p>{copy.partialMetrics}: {describeRows(partial)}</p> : null}
      <p className="text-muted-foreground">{copy.metricAlignmentNotice}</p>
    </div> : null}
    {allowRefine && hasGaps && query.applicationScope === "non-road" ? <section className="space-y-3 rounded-md border p-4 text-sm" aria-label={copy.refineScope}>
      <h3 className="font-semibold">{copy.refineScope}</h3>
      <p>{copy.scopeHelp}</p>
      <div className="flex flex-wrap gap-2">{(["construction", "agriculture", "generator-set"] as const).map(applicationScope => <a key={applicationScope} className="rounded-md border px-3 py-2 font-medium underline underline-offset-4" href={`/compare?${comparisonSearch({ ...query, applicationScope })}`}>
        {applicationScopeLabel(applicationScope, dictionary)}
      </a>)}</div>
    </section> : null}
    <p className="text-xs text-muted-foreground sm:hidden">{copy.scrollHint}</p>
    <div className="overflow-x-auto rounded-md border" role="region" aria-label={copy.comparisonTitle} tabIndex={0}>
      <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
        <caption className="sr-only">{copy.comparisonTitle}</caption>
        <thead><tr><th className="sticky left-0 z-10 w-32 border-b bg-muted p-3" scope="col">{copy.dimension}</th>{responses.map((response, index) => <th className="border-b bg-muted p-3" scope="col" key={query.countryIso3s[index]}>
          {response.status === "available" ? formatCountryDisplayName(response.country, locale) : query.countryIso3s[index]} · {query.countryIso3s[index]}
        </th>)}</tr></thead>
        <tbody>
          <tr><th className="border-b p-3 align-top" scope="row">{copy.evidenceState}</th>{responses.map((response, index) => <td className="border-b p-3 align-top" key={index}>
            {response.status === "no_data" ? <p>{copy.noCountryData}</p> : <>
              <p>{response.applicabilitySummary?.missingData.length ? copy.gaps : copy.recordedEvidence}</p>
              {(response.country.isDemo || response.applicabilitySummary?.sources.some(source => source.isDemo)) ? <p className="font-semibold text-amber-800">{dictionary.chat.demoEvidenceWarning}</p> : null}
              {response.country.isStale ? <p className="text-amber-800">{copy.stale}</p> : null}
              <p>{dictionary.common.verified}: {formatOptionalUtcDate(response.applicabilitySummary?.lastVerifiedAt, locale, dictionary.common.notRecorded)}</p>
              {response.applicabilitySummary?.missingData.length ? <p className="mt-2">{dictionary.queryEditor.regulationEvidence}</p> : null}
            </>}
          </td>)}</tr>
          <tr><th className="border-b p-3 align-top" scope="row">{copy.currentLimits}</th>{responses.map((response, index) => <td className="border-b p-3 align-top" key={index}>
            {response.status !== "available" || !response.applicabilitySummary?.country.currentEffectiveRegulations.length ? <p>{copy.noLimits}</p> : response.applicabilitySummary.country.currentEffectiveRegulations.map(regulation => <article className="mb-4 space-y-2" key={regulation.id}>
              <h3 className="font-semibold">{regulationDisplayName(regulation, dictionary, locale)}</h3>
              <p>{dictionary.country.effectiveDate}: {formatOptionalUtcDate(regulation.effectiveFrom, locale, dictionary.common.notRecorded)} → {formatOptionalUtcDate(regulation.effectiveTo, locale, dictionary.common.open)}</p>
              {regulation.isDemo ? <p>{dictionary.common.demo}</p> : null}
              {!regulation.limits.length ? <p>{copy.noLimits}</p> : null}
            </article>)}
          </td>)}</tr>
          {rows.map(row => <tr key={row.key} data-testid="comparison-pollutant-row">
            <th scope="row" className="sticky left-0 z-10 border-b bg-background p-3 align-top">{row.pollutant}<span className="block text-xs font-normal">{row.unit}</span></th>
            {row.cells.map((entries, index) => <td key={query.countryIso3s[index]} className="border-b p-3 align-top">
              {entries.length === 0 ? <p className="text-sm text-muted-foreground">{copy.missingMetric}</p> : entries.map(({ regulation, limit }) => <div key={`${regulation.id}:${limit.id}`} className="mb-3 space-y-1 last:mb-0">
                <p className="text-base font-semibold tabular-nums">{formatRecordedLimit(limit.limitValue)} <span className="text-xs font-normal">{limit.unitCode}</span></p>
                <p className="text-xs">{dictionary.chat.power}: [{limit.powerMinKw ?? "—"}, {limit.powerMaxKw ?? "∞"}) kW</p>
                <p className="text-xs">{formatUtcDate(limit.validFrom, locale)} → {formatOptionalUtcDate(limit.validTo, locale, dictionary.common.open)}</p>
                {limit.isDemo ? <p className="text-xs">{dictionary.common.demo}</p> : null}
                <details className="text-xs"><summary className="cursor-pointer underline underline-offset-4">{copy.applicabilityDetails}</summary>
                  <p>{regulationDisplayName(regulation, dictionary, locale)}</p>
                  <p>{dictionary.common.source}: {limit.source.sourceTitle}</p>
                </details>
              </div>)}
            </td>)}
          </tr>)}
          <tr><th className="border-b p-3 align-top" scope="row">{dictionary.country.futureAdopted}</th>{responses.map((response, index) => <td className="border-b p-3 align-top" key={index}>
            {response.status === "available" && response.applicabilitySummary?.country.futureAdoptedRegulations.length ? response.applicabilitySummary.country.futureAdoptedRegulations.map(regulation => <p key={regulation.id}>{regulationDisplayName(regulation, dictionary, locale)} · {formatOptionalUtcDate(regulation.effectiveFrom, locale, dictionary.common.notRecorded)}</p>) : copy.noneRecorded}
          </td>)}</tr>
          <tr><th className="p-3 align-top" scope="row">{dictionary.common.source}</th>{responses.map((response, index) => <td className="p-3 align-top" key={index}>
            {response.status === "available" && response.applicabilitySummary ? <AnalysisSources sources={response.applicabilitySummary.sources} /> : copy.noCountryData}
          </td>)}</tr>
        </tbody>
      </table>
    </div>
  </section>;
}
