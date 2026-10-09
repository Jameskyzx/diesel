"use client";

import { useLocale } from "@/components/i18n/locale-provider";
import { AnalysisSources } from "./source-review";
import type { ComparisonSnapshot } from "@/features/analyses/schemas";
import { applicationScopeLabel, regulationDisplayName } from "@/i18n/structured-labels";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { formatOptionalUtcDate, formatUtcDate } from "@/i18n/date";

export function ComparisonResults({ snapshot }: { snapshot: ComparisonSnapshot }) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.analysis;
  const { query, responses } = snapshot;
  return <section className="space-y-4" data-testid="comparison-results">
    <h2 className="text-lg font-semibold">{copy.comparisonTitle}</h2>
    <p className="text-sm">{applicationScopeLabel(query.applicationScope, dictionary)} · {query.powerKw} kW · {formatUtcDate(query.asOf, locale)}</p>
    <p className="text-sm text-muted-foreground">{copy.comparisonNotice}</p>
    <p className="text-xs text-muted-foreground sm:hidden">{copy.scrollHint}</p>
    <div className="overflow-x-auto rounded-md border" role="region" aria-label={copy.comparisonTitle} tabIndex={0}>
      <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
        <caption className="sr-only">{copy.comparisonTitle}</caption>
        <thead><tr><th className="w-32 border-b bg-muted p-3" scope="col">{copy.dimension}</th>{responses.map((response, index) => <th className="border-b bg-muted p-3" scope="col" key={query.countryIso3s[index]}>
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
              {regulation.limits.length ? <ul className="space-y-3">{regulation.limits.map(limit => <li className="rounded-md bg-muted/40 p-2" key={limit.id}>
                <p className="font-medium">{limit.pollutantCode}: {limit.limitValue} {limit.unitCode}</p>
                <p className="text-xs">{dictionary.chat.power}: [{limit.powerMinKw ?? "—"}, {limit.powerMaxKw ?? "∞"}) kW</p>
                <p className="text-xs">{formatUtcDate(limit.validFrom, locale)} → {formatOptionalUtcDate(limit.validTo, locale, dictionary.common.open)}</p>
                <p className="text-xs">{dictionary.common.source}: {limit.source.sourceTitle}</p>
                {limit.isDemo ? <p>{dictionary.common.demo}</p> : null}
              </li>)}</ul> : <p>{copy.noLimits}</p>}
            </article>)}
          </td>)}</tr>
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
