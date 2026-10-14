import type { AiToolResult } from "@/features/ai/schemas";
import type { Locale } from "@/i18n/locale";
import { buildMarketProfileResponse } from "@/domain/ai/market-profile-response";

/** Render validated profile records without a second provider request. Call
 * only after the ordinary provenance, query and sufficiency boundary passes. */
export function buildCountryProfileResponse(results: readonly AiToolResult[], locale: Locale): string | null {
  if (!results.length || results.some(result => result.tool !== "getCountryProfile" ||
    result.status !== "ok" || !result.evidenceSufficient)) return null;
  const en = locale === "en";
  const sections: string[] = [];
  for (const result of results) {
    if (result.tool !== "getCountryProfile" || result.profile?.status !== "available") return null;
    const country = result.profile.country;
    sections.push(en ? `${result.resolvedCountryIso3} — records as of ${result.informationAsOf}.`
      : `${result.resolvedCountryIso3} — 查询基准日期 ${result.informationAsOf}。`);
    if (result.requestedTopics.includes("regulations")) {
      for (const [label, rows] of [
        [en ? "Effective" : "已生效", country.currentEffectiveRegulations],
        [en ? "Adopted, not yet effective" : "已采纳，尚未生效", country.futureAdoptedRegulations],
      ] as const) {
        if (!rows.length) continue;
        sections.push(`${label}:\n` + rows.map(row => `- ${row.canonicalName}${row.citationCode ? ` (${row.citationCode})` : ""}${row.isDemo ? (en ? " — fictional Demo" : " — 虚构 Demo") : ""}\n  ${row.source.url ? `[${row.source.title}](${row.source.url})` : row.source.title}`).join("\n"));
      }
      sections.push(en ? "These are recorded regulations, not an engine-specific applicability or sale approval. Application, rated power and product evidence still need assessment."
        : "以上是已收录法规，不代表具体柴油机适用性或销售许可；仍需按用途、额定功率与产品证据核对。");
    }
    if (result.requestedTopics.includes("market")) {
      const market = buildMarketProfileResponse([{ ...result, requestedTopics: ["market"] }], locale);
      if (market) sections.push(market);
    }
    if (result.requestedTopics.includes("country")) {
      sections.push(en ? `Country overview: ${country.nameEn} (${country.iso3} / ${country.iso2})${country.regionCode ? `; region ${country.regionCode}` : ""}.`
        : `国家基础概览：${country.nameLocal ?? country.nameEn}（${country.iso3} / ${country.iso2}）${country.regionCode ? `；区域 ${country.regionCode}` : ""}。`);
      if (country.jurisdictions.length) sections.push((en ? "Recorded jurisdiction memberships: " : "已收录法域成员关系：") +
        country.jurisdictions.map(item => `${item.name} (${item.code})${item.isDemo || item.membershipIsDemo ? (en ? " — fictional Demo" : " — 虚构 Demo") : ""}`).join("; "));
      sections.push(en ? "The country profile and jurisdiction memberships are shown in the evidence card. They do not establish product compliance."
        : "国家资料与法域成员关系见证据卡片，不据此建立产品合规结论。");
      sections.push(country.source.url ? `[${country.source.title}](${country.source.url})` : country.source.title);
    }
    if (country.isStale) sections.push(en ? `Verification is stale (last verified ${country.lastVerifiedAt}); recheck the original sources before relying on these records.`
      : `核验已过期（最近核验 ${country.lastVerifiedAt}），使用前需重新核对原始来源。`);
    if (country.isDemo) sections.push(en ? "Fictional Demo data, not real-world evidence." : "虚构 Demo 数据，不是现实证据。");
  }
  return sections.join("\n\n");
}
