import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import { CatalogRecordSpecs, catalogCategoryLabel, catalogFictionalNotice } from "@/components/products/catalog-results";
import {
  FeedbackCategoryCounts,
  FeedbackFilters,
  FeedbackList,
  FeedbackTrendChart,
  feedbackFictionalNotice,
} from "@/components/products/feedback-views";
import { summarizeFeedback } from "@/domain/feedback/summarize";
import { feedbackQuerySchema } from "@/features/feedback/schemas";
import { getRequestLocale } from "@/i18n/server";
import { getErrorCode } from "@/lib/api-error";
import { runPublicDataRenderOperation } from "@/server/http/public-data-admission";
import { listPublicFeedback } from "@/server/services/feedback-read-service";
import { feedbackCountryNamer } from "@/server/services/feedback-page-data";
import { loadPublishedCatalog } from "@/server/services/product-catalog";

const ROUTE = "/products/[model]";

export async function generateMetadata({ params }: { params: Promise<{ model: string }> }): Promise<Metadata> {
  const model = decodeURIComponent((await params).model);
  return { title: await getRequestLocale() === "zh-CN" ? `${model} 机型详情` : `${model} model details` };
}

export default async function ModelPage({ params, searchParams }: {
  params: Promise<{ model: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getRequestLocale(); const zh = locale === "zh-CN";
  const modelCode = decodeURIComponent((await params).model);
  const search = await searchParams;
  const value = (key: string) => typeof search[key] === "string" ? search[key] as string : "";
  const filters = feedbackQuerySchema.safeParse(Object.fromEntries(
    ["category", "countryIso3", "severity"].flatMap(key => value(key) ? [[key, value(key)]] : []),
  ));

  const requestHeaders = await headers();
  const catalog = await runPublicDataRenderOperation({ headers: requestHeaders, route: ROUTE, work: signal => loadPublishedCatalog({ signal }) });
  if (catalog.status !== "fulfilled") {
    console.error("Model page catalogue read failed", { route: ROUTE, status: catalog.status,
      errorCode: catalog.status === "failed" ? getErrorCode(catalog.error) : `PUBLIC_DATA_${catalog.status.toUpperCase()}` });
    return <main className="page-shell py-6"><p role="alert">{zh ? "目录数据暂时不可用，请稍后重试。" : "Catalogue data is temporarily unavailable. Please retry."}</p></main>;
  }
  const record = catalog.value.records.find(candidate => candidate.model === modelCode);
  if (!record) notFound();

  const feedback = await runPublicDataRenderOperation({ headers: requestHeaders, route: ROUTE,
    work: signal => listPublicFeedback({ modelCode: record.model }, { signal }) });
  const countryName = feedbackCountryNamer(locale);
  const all = feedback.status === "fulfilled" ? feedback.value : [];
  const query = filters.success ? filters.data : {};
  const shown = all.filter(item => (!query.category || item.category === query.category) &&
    (!query.countryIso3 || item.countryIso3 === query.countryIso3) && (!query.severity || item.severity === query.severity));
  const countries = [...new Set(all.flatMap(item => item.countryIso3 ? [item.countryIso3] : []))]
    .map(iso3 => ({ iso3, name: countryName(iso3) })).sort((left, right) => left.name.localeCompare(right.name));
  const exportBase = `/api/product-feedback?modelCode=${encodeURIComponent(record.model)}`;

  return <main className="page-shell space-y-5 py-6">
    <LocaleRenderReceipt locale={locale} />
    <nav className="text-sm"><Link className="text-primary" href="/products">{zh ? "← 返回产品选型" : "← Back to product selection"}</Link></nav>
    <PageHeader kicker={`${record.series} · ${catalogCategoryLabel(record.category, locale)}`} title={record.model}
      description={zh ? "机型参数、排放声明，以及已发布的客户反馈。" : "Ratings, emission declaration and published customer feedback."} />
    <section className="rounded-lg border bg-card p-4 space-y-3" aria-label={zh ? "机型参数" : "Model specifications"}>
      <p className="text-sm rounded-md border bg-muted/30 p-3">{catalogFictionalNotice(locale)}</p>
      <CatalogRecordSpecs record={record} locale={locale} />
    </section>

    <section className="space-y-4" aria-labelledby="feedback-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="feedback-heading" className="text-lg font-semibold">{zh ? "客户反馈" : "Customer feedback"}</h2>
        <div className="flex gap-4 text-sm text-primary">
          <a href={`${exportBase}&format=csv`} download>{zh ? "导出 CSV" : "Export CSV"}</a>
          <a href={`${exportBase}&format=json`} download>{zh ? "导出 JSON" : "Export JSON"}</a>
          <Link href="/products/feedback">{zh ? "各机型对比" : "Compare models"}</Link>
        </div>
      </div>
      <p className="text-sm rounded-md border bg-muted/30 p-3">{feedbackFictionalNotice(locale)}</p>
      {feedback.status !== "fulfilled" ? <p role="alert">{zh ? "反馈数据暂时不可用，请稍后重试。" : "Feedback data is temporarily unavailable. Please retry."}</p> : <>
        <FeedbackCategoryCounts summary={summarizeFeedback(all)} locale={locale} />
        <FeedbackTrendChart summary={summarizeFeedback(all)} locale={locale} />
        {all.length > 0 && <FeedbackFilters action={`/products/${encodeURIComponent(record.model)}`} query={query} countries={countries} locale={locale} />}
        {!filters.success && <p role="alert">{zh ? "筛选条件无效，已显示全部反馈。" : "Invalid filters; showing all feedback."}</p>}
        <FeedbackList records={shown} countryName={countryName} locale={locale} />
      </>}
    </section>
  </main>;
}
