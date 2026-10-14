import type { AiToolResult } from "@/features/ai/schemas";
import type { Locale } from "@/i18n/locale";
import { getDictionary } from "@/i18n/dictionaries";
import { applicationScopeLabel } from "@/i18n/structured-labels";
import { formatDecimalForDisplay } from "@/lib/decimal-format";

export function marketObservationPeriod(start: string, endExclusive: string, locale: Locale): string {
  const year = Number(start.slice(0, 4));
  const fullYear = start === `${year}-01-01` && endExclusive === `${year + 1}-01-01`;
  return locale === "en"
    ? `${fullYear ? `${year} calendar year; ` : ""}${start} inclusive to ${endExclusive} exclusive`
    : `${fullYear ? `${year} 年；` : ""}${start}（含）至 ${endExclusive}（不含）`;
}

/** Single-country market facts are rendered from validated observations, not
 * generated prose: periodEnd is exclusive, not the observation's year. Call
 * only AFTER the ordinary evidence/provenance contract has passed. */
export function buildMarketProfileResponse(results: readonly AiToolResult[], locale: Locale): string | null {
  if (results.length === 0 || results.some(result => result.tool !== "getCountryProfile" ||
    result.status !== "ok" || !result.evidenceSufficient || result.requestedTopics.length !== 1 || result.requestedTopics[0] !== "market")) return null;
  const sections: string[] = [];
  const dictionary = getDictionary(locale);
  for (const result of results) {
    if (result.tool !== "getCountryProfile" || result.profile?.status !== "available") return null;
    const metrics = result.profile.country.marketMetrics;
    const year = result.informationAsOf.slice(0, 4);
    const historicalOnly = metrics.every(metric => metric.periodEnd <= `${year}-01-01`);
    sections.push(locale === "en"
      ? `${result.resolvedCountryIso3} market metrics below refer to their recorded observation periods, not the query year.`
      : `${result.resolvedCountryIso3} 的市场指标按实际统计期列示，不能把查询年份当作数据年份。`);
    if (result.marketPeriod) sections.push((locale === "en" ? "Requested reporting period: " : "请求的统计期：") +
      marketObservationPeriod(result.marketPeriod.start, result.marketPeriod.end, locale));
    sections.push(metrics.map(metric => {
      const scope = metric.applicationScope === null ? (locale === "en" ? "all applications" : "全口径")
        : applicationScopeLabel(metric.applicationScope, dictionary);
      return `- ${scope} · ${metric.metricName}: ${formatDecimalForDisplay(metric.valueNumeric)} ${metric.unitCode} — ${marketObservationPeriod(metric.periodStart, metric.periodEnd, locale)}${metric.isDemo ? (locale === "en" ? " (fictional Demo)" : "（虚构 Demo）") : ""}`;
    }).join("\n"));
    sections.push(locale === "en"
      ? `${historicalOnly ? `These are historical observations, not ${year} data. ` : ""}Publication and verification dates do not change the observation period. Do not extrapolate these values to current sales or forecasts; check each metric's definition and obtain a newer observation for a current-year decision.`
      : `${historicalOnly ? `这些是历史观测，不能当作 ${year} 年的数据。` : ""}发布日期和核验日期不改变统计期，也不能据此推算今年销量或预测。请按卡片中的指标定义使用数据；今年的判断需要补充新一期观测。`);
    const sources = [...new Map(metrics.map(metric => [metric.source.id, metric.source])).values()];
    sections.push(sources.map(source => source.url ? `[${source.title}](${source.url})` : source.title).join("\n"));
  }
  return sections.filter(Boolean).join("\n\n");
}
