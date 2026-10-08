import type { ChatUrlContext } from "@/features/ai/chat-url-context";
import { getDictionary } from "@/i18n/dictionaries";
import { formatUtcDate } from "@/i18n/date";
import type { Locale } from "@/i18n/locale";
import { applicationScopeLabel } from "@/i18n/structured-labels";

export function initialPromptForContext(context: ChatUrlContext, locale: Locale): string {
  if (Object.values(context).every((value) => value === undefined)) return "";
  const country = context.countryIso3 ?? (locale === "zh-CN" ? "未指定国家（请先确认国家）" : "an unspecified country (ask me which country first)");
  const scope = context.applicationScope ? applicationScopeLabel(context.applicationScope, getDictionary(locale)) : "";
  if (locale === "zh-CN") {
    const conditions = [scope, context.powerKw !== undefined ? `${context.powerKw} kW` : ""].filter(Boolean).join(" ");
    const product = context.productModelCode ? `，重点判断产品 ${context.productModelCode}` : "";
    const date = context.asOf ? `，判断日期 ${formatUtcDate(context.asOf, locale)}` : "";
    return `请分析 ${country}${conditions ? ` 的${conditions} ` : " 当前有效"}法规${product ? "与产品适配" : ""}${product}${date}，并明确说明证据缺口以及结果能否用于销售承诺。`;
  }
  const product = context.productModelCode ? `, focusing on product ${context.productModelCode}` : "";
  const power = context.powerKw !== undefined ? ` at ${context.powerKw} kW` : "";
  const date = context.asOf ? `, as of ${formatUtcDate(context.asOf, locale)}` : "";
  return `Analyze ${scope ? `${scope} ` : "effective "}regulations${product ? " and product fit" : ""} for ${country}${power}${product}${date}. State the evidence gaps and whether the result can support a sales commitment.`;
}
