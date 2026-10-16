import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import { CatalogFitResults } from "@/components/products/catalog-fit-results";
import { CatalogResults, catalogCategoryLabel } from "@/components/products/catalog-results";
import { applicationScopes } from "@/features/database/schemas";
import { catalogFitQuerySchema, catalogQuerySchema } from "@/features/product-catalog/schemas";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { getDictionary } from "@/i18n/dictionaries";
import { getRequestLocale } from "@/i18n/server";
import { applicationScopeLabel } from "@/i18n/structured-labels";
import { getErrorCode } from "@/lib/api-error";
import { runPublicDataRenderOperation } from "@/server/http/public-data-admission";
import { evaluateCatalogFitForMarket } from "@/server/services/catalog-fit-service";
import { getCountryDirectory } from "@/server/services/country-directory";
import { catalogSummary, searchProductCatalog } from "@/server/services/product-catalog";

const PRODUCTS_PAGE_DATA_ROUTE = "/products";
const fitKeys = ["market", "scope", "power", "asOf"] as const;

export async function generateMetadata(): Promise<Metadata> {
  return { title: await getRequestLocale() === "zh-CN" ? "产品选型" : "Product selection" };
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getRequestLocale(); const zh = locale === "zh-CN";
  const dictionary = getDictionary(locale);
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const today = new Date().toISOString().slice(0, 10);
  const countries = getCountryDirectory().map(country => ({ iso3: country.iso3,
    name: formatCountryDisplayName({ isDemo: false, iso2: country.iso2, iso3: country.iso3, nameEn: country.name }, locale) }));

  const fitRequested = fitKeys.some(key => value(key));
  const fitQuery = fitRequested ? catalogFitQuerySchema.safeParse({ countryIso3: value("market"), applicationScope: value("scope"),
    powerKw: value("power") ? Number(value("power")) : undefined, asOf: value("asOf") || today }) : null;
  const fitOperation = fitQuery?.success ? await runPublicDataRenderOperation({ headers: await headers(), route: PRODUCTS_PAGE_DATA_ROUTE,
    work: signal => evaluateCatalogFitForMarket(fitQuery.data, { signal }) }) : null;
  if (fitOperation && fitOperation.status !== "fulfilled") {
    console.error("Catalogue fit request failed", { route: PRODUCTS_PAGE_DATA_ROUTE, status: fitOperation.status,
      errorCode: fitOperation.status === "failed" ? getErrorCode(fitOperation.error) : `PUBLIC_DATA_${fitOperation.status.toUpperCase()}` });
  }

  const parsed = catalogQuerySchema.safeParse({ query: value("query"), category: value("category"),
    minPowerKw: value("minPowerKw") ? Number(value("minPowerKw")) : undefined,
    maxPowerKw: value("maxPowerKw") ? Number(value("maxPowerKw")) : undefined,
    offset: value("offset") ? Number(value("offset")) : 0, limit: 20 });
  const result = parsed.success ? searchProductCatalog(parsed.data) : null;
  const pageUrl = (offset: number) => { const next = new URLSearchParams(); for (const key of ["query", "category", "minPowerKw", "maxPowerKw"]) if (value(key)) next.set(key, value(key)); next.set("offset", String(offset)); return `/products?${next}`; };
  const field = "block border rounded-md p-2 mt-1";

  return <main className="page-shell space-y-5 py-6">
    <LocaleRenderReceipt locale={locale} />
    <PageHeader kicker="Global Diesel" title={zh ? "产品选型" : "Product selection"} description={zh
      ? `按目标市场筛选候选型号：系统把每个型号声明的法规编号与该国查询日生效的法规逐条比对。目录为虚构 Demo，共 ${catalogSummary.series} 个系列、${catalogSummary.records} 个型号。`
      : `Find candidate models for a target market: each model's declared citation codes are compared with the regulations in force there on the query date. The catalogue is a fictional demo of ${catalogSummary.series} series and ${catalogSummary.records} models.`} />

    <form className="flex flex-wrap gap-3 rounded-lg border bg-card p-4" action="/products" aria-label={zh ? "目标市场选型" : "Target-market selection"}>
      <label className="text-sm">{zh ? "目标国家" : "Target country"}<select name="market" defaultValue={value("market")} required className={field}>
        <option value="">{zh ? "请选择" : "Select"}</option>{countries.map(country => <option key={country.iso3} value={country.iso3}>{country.name} ({country.iso3})</option>)}</select></label>
      <label className="text-sm">{zh ? "应用场景" : "Application scope"}<select name="scope" defaultValue={value("scope")} required className={field}>
        <option value="">{zh ? "请选择" : "Select"}</option>{applicationScopes.map(scope => <option key={scope} value={scope}>{applicationScopeLabel(scope, dictionary)}</option>)}</select></label>
      <label className="text-sm">{zh ? "所需功率 kW" : "Required power kW"}<input type="number" step="any" min="0" name="power" defaultValue={value("power")} required className={`${field} w-32`} /></label>
      <label className="text-sm">{zh ? "查询日期" : "As of"}<input type="date" name="asOf" defaultValue={value("asOf") || today} className={field} /></label>
      <button className="self-end rounded-md bg-primary text-primary-foreground px-4 py-2">{zh ? "查找候选型号" : "Find candidates"}</button>
    </form>
    {fitQuery && !fitQuery.success && <p role="alert">{zh ? "选型条件无效：请选择国家和应用场景，并填写有效功率与 ISO 日期。" : "Invalid selection: choose a country and application scope, and enter a valid power and ISO date."}</p>}
    {fitOperation && fitOperation.status !== "fulfilled" && <p role="alert">{zh ? "法规数据暂时不可用，请稍后重试。不能在缺少法规数据时给出选型结论。" : "Regulation data is temporarily unavailable. Please retry; no selection conclusion is given without it."}</p>}
    {fitOperation?.status === "fulfilled" && <CatalogFitResults result={fitOperation.value} locale={locale}
      countryName={countries.find(country => country.iso3 === fitOperation.value.query.countryIso3)?.name ?? fitOperation.value.query.countryIso3} />}

    <h2 className="text-lg font-semibold pt-4">{zh ? "浏览目录" : "Browse the catalogue"}</h2>
    <form className="flex flex-wrap gap-3 rounded-lg border bg-card p-4" action="/products" aria-label={zh ? "目录检索" : "Catalogue search"}>
      <label className="text-sm">{zh ? "型号 / 系列 / 排放声明" : "Model / series / declaration"}<input name="query" defaultValue={value("query")} maxLength={100} className={field} placeholder="DEMO-H13" /></label>
      <label className="text-sm">{zh ? "分类" : "Category"}<select name="category" defaultValue={value("category")} className={field}><option value="">{zh ? "全部" : "All"}</option>{catalogSummary.categories.map(c => <option key={c} value={c}>{catalogCategoryLabel(c, locale)}</option>)}</select></label>
      <label className="text-sm">{zh ? "最小额定功率 kW" : "Min rated power kW"}<input type="number" step="any" min="0" name="minPowerKw" defaultValue={value("minPowerKw")} className={`${field} w-32`} /></label>
      <label className="text-sm">{zh ? "最大额定功率 kW" : "Max rated power kW"}<input type="number" step="any" min="0" name="maxPowerKw" defaultValue={value("maxPowerKw")} className={`${field} w-32`} /></label>
      <button className="self-end rounded-md bg-primary text-primary-foreground px-4 py-2">{zh ? "检索" : "Search"}</button>
      <Link href="/products" className="self-end p-2 text-primary">{zh ? "清空" : "Clear"}</Link>
    </form>
    {result ? <><CatalogResults result={result} locale={locale} /><nav aria-label={zh ? "产品翻页" : "Catalogue pagination"} className="flex gap-4 text-primary">
      {result.query.offset > 0 && <Link href={pageUrl(Math.max(0, result.query.offset - 20))}>{zh ? "上一页" : "Previous"}</Link>}
      {result.query.offset + 20 < result.total && <Link href={pageUrl(result.query.offset + 20)}>{zh ? "下一页" : "Next"}</Link>}
    </nav></> : <p role="alert">{zh ? "筛选条件无效，请检查功率区间和页码。" : "Invalid filters. Check the power range and page offset."}</p>}
  </main>;
}
