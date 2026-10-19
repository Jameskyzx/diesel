import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import { CustomerBriefDocument } from "@/components/products/customer-brief-document";
import { PrintBriefButton } from "@/components/products/print-brief-button";
import { buildCustomerBrief } from "@/domain/products/customer-brief";
import { catalogFitQuerySchema } from "@/features/product-catalog/schemas";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { briefCountryName, briefLanguages, briefLanguageSchema, customerBriefCopy } from "@/i18n/customer-brief";
import { getRequestLocale } from "@/i18n/server";
import { getErrorCode } from "@/lib/api-error";
import { runPublicDataRenderOperation } from "@/server/http/public-data-admission";
import { evaluateCatalogFitForMarket } from "@/server/services/catalog-fit-service";
import { getCountryDirectory } from "@/server/services/country-directory";

const BRIEF_PAGE_DATA_ROUTE = "/products/brief";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await getRequestLocale() === "zh-CN" ? "客户简报" : "Customer brief" };
}

export default async function CustomerBriefPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getRequestLocale(); const zh = locale === "zh-CN";
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const today = new Date().toISOString().slice(0, 10);
  const language = briefLanguageSchema.safeParse(value("lang")).data ?? (zh ? "zh-CN" : "en");
  const query = catalogFitQuerySchema.safeParse({ countryIso3: value("market"), applicationScope: value("scope"),
    powerKw: value("power") ? Number(value("power")) : undefined, asOf: value("asOf") || today });
  const fitParams = new URLSearchParams(fitKeysFrom(value));
  const withLanguage = (lang: string) => { const next = new URLSearchParams(fitParams); next.set("lang", lang); return `/products/brief?${next}`; };

  const toolbar = <nav className="flex flex-wrap items-center gap-3 print:hidden" aria-label={zh ? "简报操作" : "Brief actions"}>
    <Link className="text-primary" href={`/products?${fitParams}`}>{zh ? "← 返回选型" : "← Back to selection"}</Link>
    <span className="text-sm text-muted-foreground">{zh ? "简报语言：" : "Brief language:"}</span>
    {briefLanguages.map(lang => <Link key={lang} href={withLanguage(lang)} aria-current={lang === language ? "true" : undefined}
      className={lang === language ? "font-semibold underline" : "text-primary"} hrefLang={lang}>{customerBriefCopy[lang].languageName}</Link>)}
    <PrintBriefButton label={zh ? "打印 / 保存为 PDF" : "Print / Save as PDF"} />
  </nav>;

  if (!query.success) {
    return <main className="page-shell space-y-4 py-6"><LocaleRenderReceipt locale={locale} />{toolbar}
      <p role="alert">{zh ? "简报条件无效：请先在选型页选择国家、应用场景和功率。" : "Invalid brief conditions: choose a country, application scope and power on the selection page first."}</p></main>;
  }

  const operation = await runPublicDataRenderOperation({ headers: await headers(), route: BRIEF_PAGE_DATA_ROUTE,
    work: signal => evaluateCatalogFitForMarket(query.data, { signal }) });
  if (operation.status !== "fulfilled") {
    console.error("Customer brief request failed", { route: BRIEF_PAGE_DATA_ROUTE, status: operation.status,
      errorCode: operation.status === "failed" ? getErrorCode(operation.error) : `PUBLIC_DATA_${operation.status.toUpperCase()}` });
    return <main className="page-shell space-y-4 py-6"><LocaleRenderReceipt locale={locale} />{toolbar}
      <p role="alert">{zh ? "法规数据暂时不可用，无法生成简报，请稍后重试。" : "Regulation data is temporarily unavailable, so the brief cannot be prepared. Please retry."}</p></main>;
  }

  const country = getCountryDirectory().find(entry => entry.iso3 === query.data.countryIso3);
  const countryName = briefCountryName({ iso2: country?.iso2 ?? null, nameEn: country?.name ?? query.data.countryIso3,
    zhName: country ? formatCountryDisplayName({ isDemo: false, iso2: country.iso2, iso3: country.iso3, nameEn: country.name }, "zh-CN") : undefined }, language);

  return <main className="page-shell space-y-5 py-6 print:p-0">
    <LocaleRenderReceipt locale={locale} />
    {toolbar}
    <p className="text-sm text-muted-foreground print:hidden">{zh
      ? "简报只包含确定性选型结果中声明覆盖全部适用法规的型号。模板译文发给客户前请由母语人员复核。"
      : "The brief lists only models whose declarations cover every applicable regulation in the deterministic selection. Have a native speaker review template translations before sending."}</p>
    <CustomerBriefDocument brief={buildCustomerBrief(operation.value)} countryName={countryName} language={language} preparedOn={today} />
  </main>;
}

function fitKeysFrom(value: (key: string) => string): Record<string, string> {
  return Object.fromEntries(["market", "scope", "power", "asOf"].flatMap(key => value(key) ? [[key, value(key)]] : []));
}
