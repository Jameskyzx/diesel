import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import { FeedbackCategoryCounts, FeedbackTrendChart, feedbackFictionalNotice } from "@/components/products/feedback-views";
import { compareModels, summarizeFeedback } from "@/domain/feedback/summarize";
import { feedbackCategoryLabels, feedbackLabel } from "@/features/feedback/labels";
import { feedbackCategories } from "@/features/feedback/schemas";
import { getRequestLocale } from "@/i18n/server";
import { getErrorCode } from "@/lib/api-error";
import { runPublicDataRenderOperation } from "@/server/http/public-data-admission";
import { listPublicFeedback } from "@/server/services/feedback-read-service";

const ROUTE = "/products/feedback";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await getRequestLocale() === "zh-CN" ? "机型反馈对比" : "Feedback by model" };
}

export default async function FeedbackComparisonPage() {
  const locale = await getRequestLocale(); const zh = locale === "zh-CN";
  const operation = await runPublicDataRenderOperation({ headers: await headers(), route: ROUTE, work: signal => listPublicFeedback({}, { signal }) });
  if (operation.status !== "fulfilled") {
    console.error("Feedback comparison read failed", { route: ROUTE, status: operation.status,
      errorCode: operation.status === "failed" ? getErrorCode(operation.error) : `PUBLIC_DATA_${operation.status.toUpperCase()}` });
  }
  const records = operation.status === "fulfilled" ? operation.value : [];
  const comparison = compareModels(records);
  const categories = feedbackCategories.filter(category => comparison.some(row => row.byCategory[category] > 0));

  return <main className="page-shell space-y-5 py-6">
    <LocaleRenderReceipt locale={locale} />
    <nav className="text-sm"><Link className="text-primary" href="/products">{zh ? "← 返回产品选型" : "← Back to product selection"}</Link></nav>
    <PageHeader kicker="Global Diesel" title={zh ? "机型反馈对比" : "Feedback by model"}
      description={zh ? "各机型已发布反馈的数量、类别和严重程度，点击型号查看明细。" : "Published feedback per model by category and severity; open a model for details."} />
    <p className="text-sm rounded-md border bg-muted/30 p-3">{feedbackFictionalNotice(locale)}</p>
    {operation.status !== "fulfilled" ? <p role="alert">{zh ? "反馈数据暂时不可用，请稍后重试。" : "Feedback data is temporarily unavailable. Please retry."}</p> : <>
      <FeedbackCategoryCounts summary={summarizeFeedback(records)} locale={locale} />
      <FeedbackTrendChart summary={summarizeFeedback(records)} locale={locale} />
      <div className="flex gap-4 text-sm text-primary">
        <a href="/api/product-feedback?format=csv" download>{zh ? "导出全部 CSV" : "Export all as CSV"}</a>
        <a href="/api/product-feedback?format=json" download>{zh ? "导出全部 JSON" : "Export all as JSON"}</a>
      </div>
      {comparison.length === 0 ? <p role="status">{zh ? "还没有已发布的反馈。" : "No feedback has been published yet."}</p> :
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">{zh ? "各机型反馈对比" : "Feedback by model"}</caption>
            <thead className="border-b"><tr>
              <th scope="col" className="px-3 py-2">{zh ? "型号" : "Model"}</th>
              <th scope="col" className="px-3 py-2">{zh ? "总数" : "Total"}</th>
              {categories.map(category => <th key={category} scope="col" className="px-3 py-2">{feedbackLabel(feedbackCategoryLabels, category, locale)}</th>)}
              <th scope="col" className="px-3 py-2">{zh ? "高 / 安全相关" : "High / safety"}</th>
            </tr></thead>
            <tbody>{comparison.map(row => <tr key={row.modelCode} className="border-b last:border-0">
              <th scope="row" className="px-3 py-2 font-medium"><Link className="text-primary" href={`/products/${encodeURIComponent(row.modelCode)}`}>{row.modelCode}</Link></th>
              <td className="px-3 py-2">{row.total}</td>
              {categories.map(category => <td key={category} className="px-3 py-2">{row.byCategory[category] || "–"}</td>)}
              <td className="px-3 py-2">{row.safetyOrHigh || "–"}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </>}
  </main>;
}
