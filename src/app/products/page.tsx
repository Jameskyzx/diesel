import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import { CatalogResults } from "@/components/products/catalog-results";
import { catalogQuerySchema } from "@/features/product-catalog/schemas";
import { getRequestLocale } from "@/i18n/server";
import { catalogSummary, searchProductCatalog } from "@/server/services/product-catalog";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await getRequestLocale() === "zh-CN" ? "产品资料库" : "Product catalogue" };
}
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getRequestLocale(); const zh = locale === "zh-CN";
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const parsed = catalogQuerySchema.safeParse({ query: value("query"), category: value("category"), fuel: value("fuel"),
    minPowerKw: value("minPowerKw") ? Number(value("minPowerKw")) : undefined,
    maxPowerKw: value("maxPowerKw") ? Number(value("maxPowerKw")) : undefined,
    offset: value("offset") ? Number(value("offset")) : 0, limit: 20 });
  const result = parsed.success ? searchProductCatalog(parsed.data) : null;
  const pageUrl = (offset: number) => { const next = new URLSearchParams(); for (const key of ["query", "category", "fuel", "minPowerKw", "maxPowerKw"]) if (value(key)) next.set(key, value(key)); next.set("offset", String(offset)); return `/products?${next}`; };
  return <main className="page-shell space-y-5 py-6">
    <LocaleRenderReceipt locale={locale} />
    <PageHeader kicker="Global Diesel" title={zh ? "产品资料库" : "Product catalogue"} description={zh ? `${catalogSummary.families} 组产品 · ${catalogSummary.models} 个型号 · ${catalogSummary.records} 条配置记录。原表重复表头已排除，缺失或歧义值保留原文。` : `${catalogSummary.families} product families · ${catalogSummary.models} model codes · ${catalogSummary.records} configuration records. Repeated headers excluded; missing or ambiguous values retain source text.`} />
    <form className="flex flex-wrap gap-3 rounded-lg border bg-card p-4" action="/products">
      <label className="text-sm">{zh ? "型号 / 用途" : "Model / application"}<input name="query" defaultValue={value("query")} maxLength={100} className="block border rounded-md p-2 mt-1" placeholder="WP10H" /></label>
      <label className="text-sm">{zh ? "分类" : "Category"}<select name="category" defaultValue={value("category")} className="block border rounded-md p-2 mt-1"><option value="">{zh ? "全部" : "All"}</option>{catalogSummary.categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="text-sm">{zh ? "系列燃料" : "Family fuel"}<select name="fuel" defaultValue={value("fuel")} className="block border rounded-md p-2 mt-1"><option value="">{zh ? "全部" : "All"}</option>{catalogSummary.fuels.map(f => <option key={f}>{f}</option>)}</select></label>
      <label className="text-sm">{zh ? "最小功率 kW" : "Min power kW"}<input type="number" step="any" min="0" name="minPowerKw" defaultValue={value("minPowerKw")} className="block border rounded-md p-2 mt-1 w-32" /></label>
      <label className="text-sm">{zh ? "最大功率 kW" : "Max power kW"}<input type="number" step="any" min="0" name="maxPowerKw" defaultValue={value("maxPowerKw")} className="block border rounded-md p-2 mt-1 w-32" /></label>
      <button className="self-end rounded-md bg-primary text-primary-foreground px-4 py-2">{zh ? "检索" : "Search"}</button>
      <Link href="/products" className="self-end p-2 text-primary">{zh ? "清空" : "Clear"}</Link>
    </form>
    <p className="text-sm text-muted-foreground">{zh ? "功率筛选仅包含能从原表明确单位与数值的记录。中文来源字段保持原文。" : "Power filters include only records with explicit source units and values. Chinese source fields retain their original language."}</p>
    {result ? <><CatalogResults result={result} locale={locale} /><nav aria-label={zh ? "产品翻页" : "Catalogue pagination"} className="flex gap-4 text-primary">
      {result.query.offset > 0 && <Link href={pageUrl(Math.max(0, result.query.offset - 20))}>{zh ? "上一页" : "Previous"}</Link>}
      {result.query.offset + 20 < result.total && <Link href={pageUrl(result.query.offset + 20)}>{zh ? "下一页" : "Next"}</Link>}
    </nav></> : <p role="alert">{zh ? "筛选条件无效，请检查功率区间和页码。" : "Invalid filters. Check the power range and page offset."}</p>}
  </main>;
}
