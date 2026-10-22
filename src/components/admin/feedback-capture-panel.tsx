"use client";

import { MessageSquareText } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import type { AdminPrincipal } from "@/features/admin/schemas";
import {
  feedbackCategoryLabels,
  feedbackSeverityLabels,
  feedbackSourceKindLabels,
  feedbackSystemLabels,
} from "@/features/feedback/labels";
import {
  feedbackCategories,
  feedbackPowerUnits,
  feedbackPreviewSchema,
  feedbackSeverities,
  feedbackSourceKinds,
  feedbackSystems,
  publicFeedbackRecordSchema,
  type FeedbackDraftItem,
  type FeedbackPreview,
} from "@/features/feedback/schemas";

type ActionRunner = <T>(
  action: (principal: AdminPrincipal) => Promise<T>,
  successMessage?: string,
  onSuccess?: (result: T) => string | void,
  isOperationCurrent?: () => boolean,
) => Promise<void>;

export type AdminJsonRequest = <T>(principal: AdminPrincipal, url: string, init: RequestInit, schema: z.ZodType<T>) => Promise<T>;

const confirmResponseSchema = z.object({
  createdDrafts: z.number().int(),
  published: z.number().int(),
  status: z.enum(["committed", "rejected"]),
}).strict();

const adminFeedbackListSchema = z.object({
  records: z.array(publicFeedbackRecordSchema.extend({
    customerRef: z.string().nullable(),
    sourceFiles: z.array(z.object({ filename: z.string(), id: z.uuid(), mediaType: z.string() }).strict()),
  }).strict()),
  status: z.literal("ok"),
}).strict();

type EditableItem = FeedbackDraftItem & { key: string; issues: FeedbackPreview["items"][number]["issues"]; originalQuote: string | null };

const inputClass = "w-full rounded-lg border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40";
const zh = (labels: Record<string, { zh: string }>, key: string) => labels[key]?.zh ?? key;

function blankItem(key: string): EditableItem {
  return {
    catalogEngineId: null, category: "failure", component: null, countryIso3: null, countryMention: null, customerRequest: null,
    evidenceQuote: "", evidenceVerified: false, issues: [], key, modelCode: null, modelMention: null, occurredOn: null,
    originalQuote: null, quantityAffected: null, requestedPowerKw: null, requestedPowerUnit: null, requestedPowerValue: null,
    severity: "medium", sourceLanguage: null, symptom: "", system: "other", tags: [],
  };
}

function itemStatus(item: EditableItem): "ready" | "needs-choice" | "no-evidence" {
  if (!item.evidenceQuote.trim() || !item.symptom.trim()) return "no-evidence";
  if (!item.catalogEngineId) return "needs-choice";
  return item.originalQuote !== null && item.evidenceQuote === item.originalQuote && item.evidenceVerified ? "ready" : "needs-choice";
}

export function FeedbackCapturePanel({ busy, canPublish, request, runAction }: {
  busy: boolean;
  canPublish: boolean;
  request: AdminJsonRequest;
  runAction: ActionRunner;
}) {
  const [preview, setPreview] = useState<FeedbackPreview | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [customerRef, setCustomerRef] = useState("");
  const [published, setPublished] = useState<z.infer<typeof adminFeedbackListSchema>["records"] | null>(null);
  const [listModel, setListModel] = useState("");

  async function extract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    setPreview(null);
    setItems([]);
    await runAction(principal => request(principal, "/api/admin/feedback/extract", { body, method: "POST" }, feedbackPreviewSchema),
      undefined, (parsed) => {
        setPreview(parsed);
        setItems(parsed.items.map(({ item, issues }, index) => ({ ...item, issues, key: `ai-${index}`, originalQuote: item.evidenceQuote })));
        return parsed.items.length
          ? `AI 识别出 ${parsed.items.length} 条反馈；请逐条核对后保存。尚未写入任何反馈。`
          : "AI 没有识别出反馈；可以手动添加一条。尚未写入任何反馈。";
      });
  }

  function update(key: string, patch: Partial<EditableItem>) {
    setItems(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  }

  async function confirm(publish: boolean) {
    if (!preview) return;
    const payload = {
      customerRef: customerRef.trim() || null,
      items: items.map(item => ({
        catalogEngineId: item.catalogEngineId, category: item.category, component: item.component?.trim() || null,
        countryIso3: item.countryIso3, countryMention: item.countryMention, customerRequest: item.customerRequest?.trim() || null,
        evidenceQuote: item.evidenceQuote.trim(), modelMention: item.modelMention, occurredOn: item.occurredOn || null,
        quantityAffected: item.quantityAffected, requestedPowerUnit: item.requestedPowerValue === null ? null : item.requestedPowerUnit ?? "kW",
        requestedPowerValue: item.requestedPowerValue, severity: item.severity, sourceLanguage: item.sourceLanguage,
        symptom: item.symptom.trim(), system: item.system, tags: item.tags,
      })),
      publish,
      reason: publish ? "核对客户原始资料后录入并发布客户反馈。" : "核对客户原始资料后保存客户反馈草稿。",
      receivedOn,
    };
    await runAction(principal => request(principal, `/api/admin/feedback/batches/${preview.batchId}/confirm`, {
      body: JSON.stringify(payload), headers: { "content-type": "application/json" }, method: "POST",
    }, confirmResponseSchema), undefined, (result) => {
      setPreview(null);
      setItems([]);
      return result.published > 0 ? `已发布 ${result.published} 条客户反馈。` : `已保存 ${result.createdDrafts} 条反馈草稿，待审核发布。`;
    });
  }

  async function loadPublished(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = listModel.trim() ? `?modelCode=${encodeURIComponent(listModel.trim())}` : "";
    await runAction(principal => request(principal, `/api/admin/feedback${query}`, { method: "GET" }, adminFeedbackListSchema),
      undefined, (parsed) => { setPublished(parsed.records); });
  }

  const blocked = items.length === 0 || items.some(item => itemStatus(item) === "no-evidence" || !item.catalogEngineId);
  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4" data-testid="feedback-capture">
      <div className="flex items-center gap-2">
        <MessageSquareText className="size-5 text-primary" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">客户反馈录入</h2>
          <p className="text-xs text-muted-foreground">上传聊天截图、纸质单据照片、PDF（含扫描件）、.eml 邮件或粘贴文字；AI 只生成草稿，核对后才入库。原始文件仅内部可见。</p>
        </div>
      </div>
      <form className="space-y-3" onSubmit={extract}>
        <label className="block text-xs font-semibold text-muted-foreground" htmlFor="feedback-files">文件（最多 8 个，单个不超过 5 MB）</label>
        <input id="feedback-files" name="file" type="file" multiple className={inputClass}
          accept=".png,.jpg,.jpeg,.webp,.pdf,.eml,.txt,image/png,image/jpeg,image/webp,application/pdf,message/rfc822,text/plain" />
        <label className="block text-xs font-semibold text-muted-foreground" htmlFor="feedback-text">或粘贴文字</label>
        <textarea id="feedback-text" name="text" rows={4} maxLength={20_000} className={inputClass} placeholder="例如：巴西客户反映 DEMO-H13-460 两台车进气管断裂……" />
        <label className="block text-xs font-semibold text-muted-foreground" htmlFor="feedback-source-kind">来源类型</label>
        <select id="feedback-source-kind" name="sourceKind" className={inputClass} defaultValue="">
          <option value="">自动判断</option>
          {feedbackSourceKinds.map(kind => <option key={kind} value={kind}>{zh(feedbackSourceKindLabels, kind)}</option>)}
        </select>
        <Button disabled={busy} type="submit" variant="outline">AI 识别反馈</Button>
      </form>

      {preview ? <div className="space-y-3 rounded-xl border bg-muted/30 p-3 text-sm">
        <p>识别模型：{preview.extractionModel} · 来源：{zh(feedbackSourceKindLabels, preview.sourceKind)}</p>
        {preview.files.length > 0 && <p>原始文件：{preview.files.map(file =>
          <a key={file.id} className="mr-3 text-primary underline" href={`/api/admin/feedback/files/${file.id}`} target="_blank" rel="noreferrer">{file.filename}</a>)}</p>}
        {preview.transcript && <details><summary className="cursor-pointer">图片转写原文</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-xs">{preview.transcript}</pre></details>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-muted-foreground">收到日期<input type="date" className={inputClass} value={receivedOn} onChange={event => setReceivedOn(event.target.value)} /></label>
          <label className="text-xs font-semibold text-muted-foreground">客户内部编号（可选，不填客户名）<input className={inputClass} maxLength={60} value={customerRef} onChange={event => setCustomerRef(event.target.value)} /></label>
        </div>

        {items.map((item, index) => {
          const status = itemStatus(item);
          return <fieldset key={item.key} className={`space-y-2 rounded-lg border bg-background p-3 ${status === "ready" ? "border-emerald-500/50" : status === "needs-choice" ? "border-amber-500/60" : "border-destructive/60"}`} data-testid="feedback-item">
            <legend className="px-1 text-xs font-semibold">第 {index + 1} 条 · {status === "ready" ? "依据已核对" : status === "needs-choice" ? "需要确认" : "缺少依据，不能保存"}</legend>
            {item.issues.map(issue => <p key={issue.code} className="text-xs text-amber-700 dark:text-amber-300">{issue.message}</p>)}
            {item.originalQuote !== null && item.evidenceQuote !== item.originalQuote && <p className="text-xs text-amber-700 dark:text-amber-300">摘录已人工修改，将记为“未经原文核对”。</p>}
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-xs">机型<select aria-label="机型" className={inputClass} value={item.catalogEngineId ?? ""} onChange={event => update(item.key, { catalogEngineId: event.target.value || null })}>
                <option value="">请选择{item.modelMention ? `（原文：${item.modelMention}）` : ""}</option>
                {preview.engineOptions.map(engine => <option key={engine.id} value={engine.id}>{engine.model}</option>)}</select></label>
              <label className="text-xs">国家<select aria-label="国家" className={inputClass} value={item.countryIso3 ?? ""} onChange={event => update(item.key, { countryIso3: event.target.value || null })}>
                <option value="">未注明{item.countryMention ? `（原文：${item.countryMention}）` : ""}</option>
                {preview.countryOptions.map(country => <option key={country.iso3} value={country.iso3}>{country.name}</option>)}</select></label>
              <label className="text-xs">发生日期<input type="date" className={inputClass} value={item.occurredOn ?? ""} onChange={event => update(item.key, { occurredOn: event.target.value || null })} /></label>
              <label className="text-xs">类别<select aria-label="类别" className={inputClass} value={item.category} onChange={event => update(item.key, { category: event.target.value as EditableItem["category"] })}>
                {feedbackCategories.map(value => <option key={value} value={value}>{zh(feedbackCategoryLabels, value)}</option>)}</select></label>
              <label className="text-xs">系统<select aria-label="系统" className={inputClass} value={item.system} onChange={event => update(item.key, { system: event.target.value as EditableItem["system"] })}>
                {feedbackSystems.map(value => <option key={value} value={value}>{zh(feedbackSystemLabels, value)}</option>)}</select></label>
              <label className="text-xs">严重程度<select aria-label="严重程度" className={inputClass} value={item.severity} onChange={event => update(item.key, { severity: event.target.value as EditableItem["severity"] })}>
                {feedbackSeverities.map(value => <option key={value} value={value}>{zh(feedbackSeverityLabels, value)}</option>)}</select></label>
              <label className="text-xs">部件<input className={inputClass} maxLength={80} value={item.component ?? ""} onChange={event => update(item.key, { component: event.target.value || null })} /></label>
              <label className="text-xs">涉及台数<input type="number" min={1} className={inputClass} value={item.quantityAffected ?? ""}
                onChange={event => update(item.key, { quantityAffected: event.target.value ? Number(event.target.value) : null })} /></label>
              <label className="text-xs">要求功率
                <span className="flex gap-1"><input type="number" min={0} step="any" aria-label="要求功率数值" className={inputClass} value={item.requestedPowerValue ?? ""}
                  onChange={event => update(item.key, { requestedPowerValue: event.target.value ? Number(event.target.value) : null })} />
                <select aria-label="功率单位" className={inputClass} value={item.requestedPowerUnit ?? "kW"} onChange={event => update(item.key, { requestedPowerUnit: event.target.value as EditableItem["requestedPowerUnit"] })}>
                  {feedbackPowerUnits.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></span></label>
            </div>
            <label className="block text-xs">现象<input className={inputClass} maxLength={300} value={item.symptom} onChange={event => update(item.key, { symptom: event.target.value })} /></label>
            <label className="block text-xs">客户诉求<input className={inputClass} maxLength={300} value={item.customerRequest ?? ""} onChange={event => update(item.key, { customerRequest: event.target.value || null })} /></label>
            <label className="block text-xs">标签（用逗号分隔）<input className={inputClass} value={item.tags.join("，")}
              onChange={event => update(item.key, { tags: event.target.value.split(/[,，]/u).map(tag => tag.trim()).filter(Boolean).slice(0, 5) })} /></label>
            <label className="block text-xs">原文摘录<textarea rows={2} maxLength={500} className={inputClass} value={item.evidenceQuote} onChange={event => update(item.key, { evidenceQuote: event.target.value })} /></label>
            <Button size="sm" type="button" variant="secondary" onClick={() => setItems(current => current.filter(candidate => candidate.key !== item.key))}>删除这一条</Button>
          </fieldset>;
        })}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setItems(current => [...current, blankItem(`manual-${Date.now()}`)])}>手动添加一条</Button>
          <Button type="button" disabled={busy || blocked} onClick={() => confirm(false)}>保存为草稿</Button>
          {canPublish && <Button type="button" disabled={busy || blocked} onClick={() => confirm(true)}>保存并发布</Button>}
        </div>
        {blocked && items.length > 0 && <p className="text-xs text-destructive">每条都需要选择机型，并填写现象和原文摘录后才能保存。</p>}
      </div> : null}

      <form className="space-y-2 border-t pt-4" onSubmit={loadPublished}>
        <h3 className="text-sm font-semibold">已发布的反馈（内部，含真实客户反馈）</h3>
        <div className="flex gap-2">
          <input aria-label="按型号筛选" className={inputClass} placeholder="型号，如 DEMO-H13-460；留空查看全部" value={listModel} onChange={event => setListModel(event.target.value)} />
          <Button disabled={busy} type="submit" variant="outline">查询</Button>
        </div>
      </form>
      {published && (published.length === 0 ? <p className="text-sm">没有已发布的反馈。</p> :
        <ul className="max-h-96 space-y-2 overflow-auto text-sm">{published.map(record => <li key={record.id} className="rounded-lg border p-2">
          <p className="font-medium">{record.modelCode} · {zh(feedbackCategoryLabels, record.category)} · {record.receivedOn}{record.isDemo ? " · 虚构示例" : ""}</p>
          <p>{record.symptom}</p>
          <p className="text-xs text-muted-foreground">{record.customerRef ? `客户编号 ${record.customerRef} · ` : ""}{record.sourceFiles.map(file =>
            <a key={file.id} className="mr-2 text-primary underline" href={`/api/admin/feedback/files/${file.id}`} target="_blank" rel="noreferrer">{file.filename}</a>)}</p>
        </li>)}</ul>)}
    </div>
  );
}
