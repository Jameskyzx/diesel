import Link from "next/link";

import type { FeedbackSummary } from "@/domain/feedback/summarize";
import {
  feedbackCategoryLabels,
  feedbackLabel,
  feedbackSeverityLabels,
  feedbackSourceKindLabels,
  feedbackSystemLabels,
} from "@/features/feedback/labels";
import {
  feedbackCategories,
  feedbackSeverities,
  type FeedbackQuery,
  type PublicFeedbackRecord,
} from "@/features/feedback/schemas";
import type { Locale } from "@/i18n/locale";

export function feedbackFictionalNotice(locale: Locale) {
  return locale === "zh-CN"
    ? "以下反馈均为虚构示例，用来演示录入、汇总和查询流程，不来自任何真实客户。真实客户反馈只在内部后台查看。"
    : "All feedback below is fictional, written to demonstrate capture, summaries and lookup; none comes from a real customer. Real customer feedback is only visible in the internal workspace.";
}

export function FeedbackCategoryCounts({ summary, locale }: { summary: FeedbackSummary; locale: Locale }) {
  const zh = locale === "zh-CN";
  return <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={zh ? "按类别统计" : "Counts by category"}>
    <div className="rounded-lg border bg-card p-3"><dt className="text-xs text-muted-foreground">{zh ? "反馈总数" : "Total feedback"}</dt>
      <dd className="text-2xl font-semibold">{summary.total}</dd></div>
    {feedbackCategories.filter(category => summary.byCategory[category] > 0).map(category =>
      <div key={category} className="rounded-lg border bg-card p-3"><dt className="text-xs text-muted-foreground">{feedbackLabel(feedbackCategoryLabels, category, locale)}</dt>
        <dd className="text-2xl font-semibold">{summary.byCategory[category]}</dd></div>)}
    {summary.bySeverity.safety + summary.bySeverity.high > 0 && <div className="rounded-lg border border-destructive/40 bg-card p-3">
      <dt className="text-xs text-muted-foreground">{zh ? "高 / 安全相关" : "High / safety-related"}</dt>
      <dd className="text-2xl font-semibold">{summary.bySeverity.high + summary.bySeverity.safety}</dd></div>}
  </dl>;
}

/** Monthly bars drawn server-side; empty months stay visible as gaps in time. */
export function FeedbackTrendChart({ summary, locale }: { summary: FeedbackSummary; locale: Locale }) {
  const zh = locale === "zh-CN";
  if (summary.byMonth.length === 0) return null;
  const max = Math.max(...summary.byMonth.map(({ count }) => count), 1);
  const barWidth = 36, gap = 12, height = 120, left = 8, base = height + 16;
  const width = left * 2 + summary.byMonth.length * (barWidth + gap);
  const label = zh
    ? `每月反馈数：${summary.byMonth.map(({ month, count }) => `${month} ${count} 条`).join("，")}`
    : `Feedback per month: ${summary.byMonth.map(({ month, count }) => `${month} ${count}`).join(", ")}`;
  return <figure className="rounded-lg border bg-card p-4">
    <figcaption className="text-sm font-semibold">{zh ? "每月反馈数（按问题发生月份，无日期时按收到月份）" : "Feedback per month (by problem date, or received date when unknown)"}</figcaption>
    <div className="overflow-x-auto">
      <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${base + 20}`} className="mt-2 h-44 min-w-full" style={{ width: Math.max(width, 320) }}>
        <line x1={left} x2={width - left} y1={base} y2={base} className="stroke-border" />
        {summary.byMonth.map(({ month, count }, index) => {
          const x = left + index * (barWidth + gap);
          const barHeight = (count / max) * height;
          return <g key={month}>
            <rect x={x} y={base - barHeight} width={barWidth} height={barHeight} rx={4} className="fill-primary/70" />
            <text x={x + barWidth / 2} y={base - barHeight - 4} textAnchor="middle" className="fill-foreground text-[11px]">{count}</text>
            <text x={x + barWidth / 2} y={base + 14} textAnchor="middle" className="fill-muted-foreground text-[10px]">{month.slice(2)}</text>
          </g>;
        })}
      </svg>
    </div>
  </figure>;
}

export function FeedbackFilters({ action, query, countries, locale }: {
  action: string; query: FeedbackQuery; countries: { iso3: string; name: string }[]; locale: Locale;
}) {
  const zh = locale === "zh-CN";
  const field = "block border rounded-md p-2 mt-1";
  return <form action={action} className="flex flex-wrap gap-3 rounded-lg border bg-card p-4" aria-label={zh ? "筛选反馈" : "Filter feedback"}>
    <label className="text-sm">{zh ? "类别" : "Category"}<select name="category" defaultValue={query.category ?? ""} className={field}>
      <option value="">{zh ? "全部" : "All"}</option>{feedbackCategories.map(c => <option key={c} value={c}>{feedbackLabel(feedbackCategoryLabels, c, locale)}</option>)}</select></label>
    <label className="text-sm">{zh ? "国家" : "Country"}<select name="countryIso3" defaultValue={query.countryIso3 ?? ""} className={field}>
      <option value="">{zh ? "全部" : "All"}</option>{countries.map(c => <option key={c.iso3} value={c.iso3}>{c.name}</option>)}</select></label>
    <label className="text-sm">{zh ? "严重程度" : "Severity"}<select name="severity" defaultValue={query.severity ?? ""} className={field}>
      <option value="">{zh ? "全部" : "All"}</option>{feedbackSeverities.map(s => <option key={s} value={s}>{feedbackLabel(feedbackSeverityLabels, s, locale)}</option>)}</select></label>
    <button className="self-end rounded-md bg-primary text-primary-foreground px-4 py-2">{zh ? "筛选" : "Filter"}</button>
    <Link href={action} className="self-end p-2 text-primary">{zh ? "清空" : "Clear"}</Link>
  </form>;
}

export function FeedbackList({ records, countryName, locale }: {
  records: PublicFeedbackRecord[]; countryName: (iso3: string | null) => string; locale: Locale;
}) {
  const zh = locale === "zh-CN";
  if (records.length === 0) {
    return <p role="status" className="rounded-lg border bg-card p-4 text-sm">{zh ? "暂无符合条件的已发布反馈。" : "No published feedback matches these filters."}</p>;
  }
  return <ol className="space-y-3" aria-label={zh ? "反馈列表" : "Feedback list"}>
    {records.map(record => <li key={record.id} className="rounded-lg border bg-card p-4 space-y-2" data-testid="feedback-record">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-muted px-2 py-0.5">{feedbackLabel(feedbackCategoryLabels, record.category, locale)}</span>
        <span className="rounded-full bg-muted px-2 py-0.5">{feedbackLabel(feedbackSystemLabels, record.system, locale)}</span>
        <span className={`rounded-full px-2 py-0.5 ${record.severity === "high" || record.severity === "safety" ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
          {zh ? "严重程度：" : "Severity: "}{feedbackLabel(feedbackSeverityLabels, record.severity, locale)}</span>
        {record.isDemo && <span className="rounded-full border px-2 py-0.5">{zh ? "虚构示例" : "Fictional example"}</span>}
      </div>
      <p className="font-medium">{record.symptom}</p>
      {record.customerRequest && <p className="text-sm">{zh ? "客户诉求：" : "Customer request: "}{record.customerRequest}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <dt>{zh ? "国家" : "Country"}</dt><dd>{countryName(record.countryIso3)}</dd>
        <dt>{zh ? "日期" : "Date"}</dt><dd>{record.occurredOn ? `${zh ? "发生" : "occurred"} ${record.occurredOn} · ` : ""}{zh ? "收到" : "received"} {record.receivedOn}</dd>
        {record.component && <><dt>{zh ? "部件" : "Component"}</dt><dd>{record.component}</dd></>}
        {record.quantityAffected !== null && <><dt>{zh ? "涉及台数" : "Units affected"}</dt><dd>{record.quantityAffected}</dd></>}
        {record.requestedPowerValue !== null && <><dt>{zh ? "要求功率" : "Requested power"}</dt>
          <dd>{record.requestedPowerValue} {record.requestedPowerUnit}{record.requestedPowerUnit !== "kW" ? ` ≈ ${record.requestedPowerKw} kW` : ""}</dd></>}
        {record.tags.length > 0 && <><dt>{zh ? "标签" : "Tags"}</dt><dd>{record.tags.join(" · ")}</dd></>}
        <dt>{zh ? "来源" : "Source"}</dt><dd>{feedbackLabel(feedbackSourceKindLabels, record.sourceKind, locale)}</dd>
      </dl>
      <blockquote className="border-l-2 pl-3 text-sm italic">{record.evidenceQuote}</blockquote>
    </li>)}
  </ol>;
}
