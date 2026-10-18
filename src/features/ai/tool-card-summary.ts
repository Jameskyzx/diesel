import type { ClientAiToolResult } from "@/features/ai/client-schemas";
import { countryProfileTopicLabel, productFitReasonMessage } from "@/features/ai/client-tool-copy";
import { marketObservationPeriod } from "@/domain/ai/market-profile-response";
import { formatUtcDate } from "@/i18n/date";
import { getDictionary, type Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locale";
import { applicationScopeLabel, localizedList, productDisplayName } from "@/i18n/structured-labels";

export function toolLabels(
  copy: Dictionary["chat"],
): Record<ClientAiToolResult["tool"], string> {
  return {
    calculateOpportunityScore: copy.toolCalculateOpportunityScore,
    compareMarkets: copy.toolCompareMarkets,
    compareRegulations: copy.toolCompareRegulations,
    findCompatibleProducts: copy.toolFindCompatibleProducts,
    generateSalesBrief: copy.toolGenerateSalesBrief,
    getCountryProfile: copy.toolGetCountryProfile,
    searchKnowledgeBase: copy.toolSearchKnowledgeBase,
  };
}

export function toolStatusLabels(copy: Dictionary["chat"]) {
  return {
    error: copy.toolStatusError,
    no_data: copy.toolStatusNoData,
    ok: copy.toolStatusOk,
  } as const;
}

export function fitStatusLabels(dictionary: Dictionary) {
  return {
    fit: dictionary.productFit.fit,
    not_fit: dictionary.productFit.notFit,
    unknown: dictionary.productFit.unknownFit,
  } as const;
}

export function commercialReadinessLabels(dictionary: Dictionary) {
  return {
    not_ready: dictionary.productFit.commercialNotReady,
    ready: dictionary.productFit.commercialReady,
    unknown: dictionary.productFit.commercialUnknown,
  } as const;
}

export function toolResultCardLabel(result: ClientAiToolResult, dictionary: Dictionary): string {
  return result.tool === "getCountryProfile"
    ? result.requestedTopics.map((topic) => countryProfileTopicLabel(topic, dictionary)).join(dictionary.chat.listSeparator)
    : toolLabels(dictionary.chat)[result.tool];
}

/** The query conditions shown at the top of every result card. */
export function toolQuerySummaryFields(
  result: ClientAiToolResult,
  dictionary: Dictionary,
  locale: Locale,
): Array<{ label: string; value: string }> {
  const copy = dictionary.chat;
  let fields: Array<{ label: string; value: string }>;

  if (result.tool === "searchKnowledgeBase") {
    fields = [
      { label: copy.country, value: result.resolvedCountryIso3 ?? copy.unspecified },
      {
        label: copy.scope,
        value: result.search.filters.applicationScope
          ? applicationScopeLabel(result.search.filters.applicationScope, dictionary)
          : copy.unspecified,
      },
      { label: copy.date, value: formatUtcDate(result.informationAsOf, locale) },
      { label: copy.queryConditions, value: result.search.query },
    ];
  } else if (result.tool === "getCountryProfile") {
    fields = [
      { label: copy.country, value: result.resolvedCountryIso3 ?? copy.unspecified },
      { label: copy.date, value: formatUtcDate(result.informationAsOf, locale) },
      {
        label: copy.queryConditions,
        value: localizedList(result.requestedTopics.map((topic) => countryProfileTopicLabel(topic, dictionary)), locale),
      },
    ];
  } else if (result.tool === "findCompatibleProducts") {
    fields = [
      { label: copy.country, value: result.query.countryIso3 ?? copy.unspecified },
      { label: copy.scope, value: applicationScopeLabel(result.query.applicationScope, dictionary) },
      { label: copy.power, value: `${result.query.powerKw} kW` },
      { label: copy.date, value: formatUtcDate(result.query.asOf, locale) },
      ...(result.query.productModelCode ? [{ label: copy.product, value: result.query.productModelCode }] : []),
    ];
  } else if (result.tool === "compareMarkets") {
    fields = [
      { label: copy.country, value: localizedList(result.comparison.query.countryIso3s, locale) },
      {
        label: copy.scope,
        value: result.comparison.query.applicationScope
          ? applicationScopeLabel(result.comparison.query.applicationScope, dictionary)
          : copy.unspecified,
      },
      ...(result.comparison.query.metricCodes
        ? [{ label: copy.marketMetricCodes, value: localizedList(result.comparison.query.metricCodes, locale) }]
        : []),
    ];
  } else if (result.tool === "generateSalesBrief") {
    const { query } = result.brief;
    fields = [
      { label: copy.targetCountry, value: query.targetCountryIso3 },
      { label: copy.comparisonCountries, value: localizedList(query.countryIso3s, locale) },
      { label: copy.scope, value: applicationScopeLabel(query.applicationScope, dictionary) },
      { label: copy.power, value: `${query.powerKw} kW` },
      { label: copy.date, value: formatUtcDate(query.asOf, locale) },
      ...(query.productModelCode ? [{ label: copy.product, value: query.productModelCode }] : []),
    ];
  } else {
    const query = result.tool === "compareRegulations" ? result.comparison.query : result.scorecard.query;
    const productModelCode = result.tool === "calculateOpportunityScore" ? result.scorecard.query.productModelCode : undefined;
    fields = [
      { label: copy.country, value: localizedList(query.countryIso3s, locale) },
      { label: copy.scope, value: applicationScopeLabel(query.applicationScope, dictionary) },
      { label: copy.power, value: `${query.powerKw} kW` },
      { label: copy.date, value: formatUtcDate(query.asOf, locale) },
      ...(productModelCode ? [{ label: copy.product, value: productModelCode }] : []),
    ];
  }

  const marketPeriod = result.tool === "getCountryProfile" ? result.marketPeriod
    : result.tool === "compareMarkets" ? result.comparison.query.marketPeriod : undefined;
  if (marketPeriod) fields.push({ label: locale === "en" ? "Reporting period" : "统计期",
    value: marketObservationPeriod(marketPeriod.start, marketPeriod.end, locale) });
  return fields;
}

/**
 * Plain text of the deterministic card fields a user sees for one validated
 * result: title, status, query conditions and, for product fit, each
 * evaluation's fit, readiness and availability. It omits retrieved excerpts
 * and citations. The live eval grounds its anchors on this text;
 * tests/tool-card-summary.test.ts keeps it bound to the rendered card.
 */
export function toolResultCardText(result: ClientAiToolResult, locale: Locale): string {
  const dictionary = getDictionary(locale);
  // The card shows labels and values in separate cells; a space keeps a
  // full-width "：" from joining them into one identifier after NFKC.
  const separator = `${dictionary.common.labelSeparator} `;
  const lines = [
    toolResultCardLabel(result, dictionary),
    toolStatusLabels(dictionary.chat)[result.status],
    ...toolQuerySummaryFields(result, dictionary, locale).map(({ label, value }) => `${label}${separator}${value}`),
  ];
  if (result.tool === "findCompatibleProducts" && result.status !== "error") {
    const fit = fitStatusLabels(dictionary);
    const readiness = commercialReadinessLabels(dictionary);
    for (const evaluation of result.evaluations) {
      lines.push(
        evaluation.product ? productDisplayName(evaluation.product, dictionary, locale) : evaluation.input.productModelCode,
        `${dictionary.productFit.fitAxis}${separator}${fit[evaluation.status]} · ${readiness[evaluation.commercialReadiness]}`,
        `${dictionary.productFit.availability}${separator}${productFitReasonMessage(evaluation.productChecks.availability, locale)}`,
      );
    }
  }
  return lines.join("\n");
}
