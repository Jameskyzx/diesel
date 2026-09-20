import type { ClientAiToolResult } from "@/features/ai/client-schemas";
import { getDictionary, interpolate, type Dictionary } from "@/i18n/dictionaries";
import { formatUtcDate } from "@/i18n/date";
import type { Locale } from "@/i18n/locale";
import { applicationScopeLabel, marketMetricDisplayDefinition, marketMetricDisplayName } from "@/i18n/structured-labels";
import { formatDecimalForDisplay } from "@/lib/decimal-format";

type MarketComparison = Extract<ClientAiToolResult, { tool: "compareMarkets" }>["comparison"];
type MarketIssue = MarketComparison["metrics"][number]["issues"][number];

const issueCopyKeys = {
  MISSING_COUNTRY_OBSERVATION: "marketIssueMissingCountry",
  AMBIGUOUS_LATEST_OBSERVATION: "marketIssueAmbiguousLatest",
  MISSING_UNIT: "marketIssueMissingUnit",
  MISSING_DEFINITION: "marketIssueMissingDefinition",
  MISSING_METHODOLOGY: "marketIssueMissingMethodology",
  APPLICATION_SCOPE_MISMATCH: "marketIssueApplication",
  UNIT_MISMATCH: "marketIssueUnit",
  CURRENCY_MISMATCH: "marketIssueCurrency",
  DEFINITION_MISMATCH: "marketIssueDefinition",
  METHODOLOGY_MISMATCH: "marketIssueMethodology",
  PERIOD_MISMATCH: "marketIssuePeriod",
} as const satisfies Record<MarketIssue, keyof Dictionary["chat"]>;

export function MarketComparisonFacts({ comparison, locale }: {
  comparison: MarketComparison;
  locale: Locale;
}) {
  const dictionary = getDictionary(locale);
  const copy = dictionary.chat;
  const statuses = {
    comparable: copy.marketComparable,
    incomparable: copy.marketIncomparable,
    insufficient_data: copy.marketInsufficientData,
  } as const;

  return (
    <div className="min-w-0 space-y-3 text-xs">
      <p className="text-muted-foreground">{copy.marketComparisonBasisBody}</p>
      {comparison.metrics.length === 0 ? <p>{copy.noObservations}</p> : null}
      {comparison.metrics.map((metric) => {
        const displayIdentity = {
          isDemo: metric.observations.length > 0 && metric.observations.every(({ isDemo }) => isDemo),
          metricCode: metric.metricCode,
          metricIds: metric.observations.map(({ id }) => id),
          metricName: metric.metricName,
        };
        const name = marketMetricDisplayName(displayIdentity, dictionary, locale);
        return (
          <section aria-label={`${name} (${metric.metricCode})`} className="min-w-0 space-y-2 rounded-lg bg-background/70 p-2" key={metric.metricCode}>
            <div className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-2">
              <div className="min-w-0 break-words">
                <h4 className="font-semibold">{name}</h4>
                <p className="text-muted-foreground">{metric.metricCode}</p>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{statuses[metric.comparisonStatus]}</span>
            </div>
            {metric.issues.length > 0 ? (
              <ul aria-label={copy.marketComparisonIssues} className="list-disc space-y-1 rounded-md bg-amber-50 p-2 pl-6 text-amber-950">
                {metric.issues.map((issue) => <li key={issue}>{copy[issueCopyKeys[issue]]}</li>)}
              </ul>
            ) : null}
            {metric.observations.length === 0 ? <p>{copy.noObservations}</p> : null}
            {metric.observations.map((observation) => {
              const fields = [
                { label: copy.scope, value: observation.applicationScope ? applicationScopeLabel(observation.applicationScope, dictionary) : dictionary.common.notRecorded },
                { label: copy.marketCurrency, value: observation.currencyCode ?? dictionary.common.notRecorded },
                { label: copy.marketPeriodStart, value: formatUtcDate(observation.periodStart, locale) },
                { label: copy.marketPeriodEnd, value: formatUtcDate(observation.periodEnd, locale) },
                { label: dictionary.country.methodology, value: observation.methodologyVersion.trim() ? observation.methodologyVersion : dictionary.common.notRecorded },
              ];
              const definition = marketMetricDisplayDefinition({
                ...displayIdentity,
                isDemo: observation.isDemo,
                metricIds: [observation.id],
                definition: observation.definition,
              }, dictionary, locale);
              return (
                <div role="group" aria-label={interpolate(copy.marketObservation, { country: observation.countryIso3, metric: metric.metricCode })} className="min-w-0 space-y-2 rounded-md border border-border/70 p-2" key={observation.id}>
                  <p className="flex flex-wrap items-baseline justify-between gap-2 font-medium">
                    <span>{observation.countryIso3}</span>
                    <span className="min-w-0 break-words">{formatDecimalForDisplay(observation.valueNumeric)} {observation.unitCode.trim() ? observation.unitCode : copy.marketUnitNotRecorded}</span>
                  </p>
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {fields.map(({ label, value }) => (
                      <div className="min-w-0 break-words" key={label}>
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                    <div className="min-w-0 break-words sm:col-span-2">
                      <dt className="text-muted-foreground">{copy.marketDefinition}</dt>
                      <dd className="whitespace-pre-wrap">{definition.trim() ? definition : dictionary.common.notRecorded}</dd>
                    </div>
                    <div className="min-w-0 break-words sm:col-span-2">
                      <dt className="text-muted-foreground">{dictionary.common.source}</dt>
                      <dd>{observation.source.sourceTitle}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
