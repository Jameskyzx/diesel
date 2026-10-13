import type { AiToolResult } from "@/features/ai/schemas";
import type { Locale } from "@/i18n/locale";
import { getDictionary } from "@/i18n/dictionaries";
import { applicationScopeLabel } from "@/i18n/structured-labels";
import { formatDecimalForDisplay } from "@/lib/decimal-format";
import { regulatoryDisclaimer } from "@/domain/ai/evidence-gap-response";

/** Comparative explanations are facts too. Derive them only after the
 * evidence gate passes; never let generated rankings or band claims replace
 * the returned limits. Other conversational tasks keep the model explanation. */
export function buildRegulationComparisonResponse(results: readonly AiToolResult[], locale: Locale, options: { allowSingleCountry?: boolean } = {}): string | null {
  if (results.length === 0) return null;
  if (results.some(result => result.tool !== "compareRegulations" || result.status !== "ok" || !result.evidenceSufficient ||
    result.comparison.countries.length < (options.allowSingleCountry ? 1 : 2) || result.comparison.countries.some(country => country.currentEffectiveRegulations.length === 0))) return null;
  const dictionary = getDictionary(locale);
  return results.map(result => {
    if (result.tool !== "compareRegulations") return "";
    const { countries, query } = result.comparison;
    const limits = countries.map(country => country.currentEffectiveRegulations.flatMap(regulation => regulation.limits));
    const keys = [...new Set(limits.flatMap(items => items.map(limit => JSON.stringify([limit.pollutantCode, limit.unitCode]))))].sort();
    const equal: string[] = [], different: string[] = [], missing: string[] = [];
    for (const key of keys) {
      const values = limits.map(items => [...new Set(items.filter(limit => JSON.stringify([limit.pollutantCode, limit.unitCode]) === key)
        .map(limit => formatDecimalForDisplay(limit.limitValue)))].sort());
      const identity = limits.flat().find(limit => JSON.stringify([limit.pollutantCode, limit.unitCode]) === key)!;
      const label = `${identity.pollutantCode} (${identity.unitCode})`;
      const absent = countries.filter((_, index) => values[index]!.length === 0).map(country => country.countryIso3);
      if (absent.length > 0) missing.push(`${absent.join("/")}: ${label}`);
      else (values.every(value => JSON.stringify(value) === JSON.stringify(values[0])) ? equal : different).push(label);
    }
    const bands = limits.map(items => [...new Set(items.map(limit => `${limit.powerMinKw}–${limit.powerMaxKw}`))].sort());
    const completeBounds = limits.every(items => items.length > 0 && items.every(limit => limit.powerMinKw !== null && limit.powerMaxKw !== null));
    const sameBounds = completeBounds && bands.every(band => JSON.stringify(band) === JSON.stringify(bands[0]));
    const bandDetail = countries.map((country, index) => `${country.countryIso3} ${bands[index]!.join("/")} kW`).join("; ");
    const en = locale === "en";
    const none = en ? "none" : "无";
    const bandText = !completeBounds ? (en ? "some power-band bounds were not recorded" : "部分功率段边界未记录，不能判断是否相同")
      : sameBounds ? (en ? `the recorded power-band bounds match (${bands[0]!.join("/")} kW)` : `记录中的功率段边界相同（${bands[0]!.join("/")} kW）`)
        : en ? `the recorded power-band bounds differ (${bandDetail})` : `记录中的功率段边界不同（${bandDetail}）`;
    const combined = limits.flat().map(limit => limit.pollutantCode).find(code => code.includes("+") &&
      limits.flat().some(limit => code.split("+").some(component => component.toUpperCase() === limit.pollutantCode.toUpperCase())));
    const definition = combined ? (en ? `${combined} is a combined pollutant measure, not interchangeable with an individual component`
      : `${combined} 是合并指标，不能与单项污染物直接等同或换算`) : (en ? "Matching numbers do not establish legal equivalence" : "相同数值也不等于法规或认证要求等同");
    const comparisonSummary = en
      ? `Regulatory comparison: for ${query.countryIso3s.join(" / ")} ${applicationScopeLabel(query.applicationScope, dictionary)} at ${query.powerKw} kW as of ${query.asOf}, the effective records have equal numeric values for ${equal.join(", ") || none}, differing values for ${different.join(", ") || none}${missing.length ? `, and missing rows for ${missing.join("; ")}` : ""}; ${bandText}.\n\n${definition}; test cycles were not returned, so no stricter/weaker ranking or sales approval follows—next, obtain the original test-cycle and certification requirements.`
      : `法规比较：按 ${query.asOf}、${applicationScopeLabel(query.applicationScope, dictionary)} ${query.powerKw} kW 比较 ${query.countryIso3s.join(" / ")} 的已生效记录：数值相同的项目为${equal.join("、") || none}，数值不同的项目为${different.join("、") || none}${missing.length ? `；未返回的项目为 ${missing.join("；")}` : ""}；${bandText}。\n\n${definition}；本次未返回测试循环，不能据此排名哪国更严或批准销售，下一步请索取原始测试循环与认证要求。`;
    const regulations = countries[0]!.currentEffectiveRegulations;
    const summary = countries.length > 1 ? comparisonSummary : en
      ? `Effective regulation lookup: ${query.countryIso3s[0]}, ${applicationScopeLabel(query.applicationScope, dictionary)}, ${query.powerKw} kW, as of ${query.asOf}. This query returned ${regulations.length} effective record(s): ${regulations.map(regulation => regulation.canonicalName).join("; ")}. The cards show the recorded pollutant limits and applicability; this is not proof of complete legal coverage, equivalent test cycles or approval of any engine model.`
      : `有效法规查询：${query.countryIso3s[0]}，${applicationScopeLabel(query.applicationScope, dictionary)}，${query.powerKw} kW，基准日期 ${query.asOf}。本次返回 ${regulations.length} 条已生效记录：${regulations.map(regulation => regulation.canonicalName).join("；")}。已记录的污染物限值和适用条件见证据卡片；这不证明法规覆盖完整、测试循环等同或任何型号已获准销售。`;
    const sources = [...new Map(countries.flatMap(country => country.currentEffectiveRegulations.map(regulation => [regulation.source.sourceId, regulation.source] as const))).values()];
    const demo = result.citations.some(citation => citation.isDemo) ? (en ? "Fictional Demo evidence; not real regulatory approval.\n\n" : "以下含虚构 Demo 证据，不代表真实法规准入。\n\n") : "";
    const future = countries.some(country => country.futureAdoptedRegulations.length > 0) ? (en ? "\n\nAdopted but not yet effective records remain separate in the cards; they are not included in this effective-record comparison." : "\n\n已采纳但尚未生效的记录在卡片中单独列示，不纳入本段已生效记录比较。") : "";
    return demo + summary + future + "\n\n" + regulatoryDisclaimer(locale) + "\n\n" + sources.map(source => source.sourceUrl ? `[${source.sourceTitle}](${source.sourceUrl})` : source.sourceTitle).join("\n");
  }).join("\n\n");
}
