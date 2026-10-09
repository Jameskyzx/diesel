"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isToolUIPart } from "ai";
import { ToolResultCard } from "@/components/ai/sales-chat";
import { AssistantMarkdown } from "@/components/ai/assistant-markdown";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { ComparisonResults } from "./comparison-results";
import { comparisonSearch, type SavedAnalysis } from "@/features/analyses/schemas";
import { ANALYSES_STORAGE_KEY, readAnalyses, writeAnalyses, downloadAnalysisFile, reportHtml } from "@/features/analyses/storage";
import { toolPartPresentation } from "@/features/ai/tool-part-presentation";
import { parseReleasedAttachmentPart, formatReleasedAttachment } from "@/features/ai/released-attachment";
import { formatUtcDate } from "@/i18n/date";
import { isNavigableEvidenceUrl } from "@/lib/source-link";

export function AnalysisLibrary({ countryIso2ByIso3 }: { countryIso2ByIso3: Readonly<Record<string, string>> }) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.analysis;
  const [items, setItems] = useState<SavedAnalysis[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const refresh = () => {
      try { setItems(readAnalyses(window.localStorage)); setError(false); }
      catch { setError(true); }
      setLoaded(true);
    };
    const frame = requestAnimationFrame(refresh);
    const changed = (event: StorageEvent) => { if (event.key === ANALYSES_STORAGE_KEY || event.key === null) refresh(); };
    window.addEventListener("storage", changed);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("storage", changed); };
  }, []);
  const selected = items.find(item => item.id === selectedId) ?? null;
  function remove(id: string) {
    try {
      const remaining = readAnalyses(window.localStorage).filter(item => item.id !== id);
      writeAnalyses(window.localStorage, remaining);
      setItems(remaining); setDeleteId(null); setError(false);
      if (selectedId === id) setSelectedId(null);
    } catch { setError(true); }
  }
  return <>
    <h1 className="text-2xl font-semibold">{copy.library}</h1>
    <p className="text-sm text-muted-foreground">{copy.localNotice}</p>
    {error ? <p role="alert">{copy.storageError}</p> : null}
    {!loaded ? <p role="status">{dictionary.common.loading}</p> : items.length === 0 ? <p className="rounded-md border border-dashed p-5">{copy.empty} <Link className="underline" href="/compare">{copy.comparisonTitle}</Link> · <Link className="underline" href="/chat">{dictionary.header.chat}</Link></p> : null}
    <ul className="grid gap-3 md:grid-cols-2">{items.map(item => <li className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-4" key={item.id}>
      <button className="min-w-0 flex-1 break-words text-left font-medium underline" onClick={() => setSelectedId(item.id)} aria-pressed={selectedId === item.id}>{item.title}</button>
      <span className="text-xs text-muted-foreground">{formatUtcDate(item.savedAt, locale)}</span>
      <Button size="sm" variant="outline" onClick={() => setDeleteId(item.id)}>{copy.delete}</Button>
      {deleteId === item.id ? <div className="w-full space-y-2 text-sm"><p>{copy.deleteConfirm}</p><Button size="sm" variant="destructive" onClick={() => remove(item.id)}>{copy.confirmDelete}</Button> <Button size="sm" variant="outline" onClick={() => setDeleteId(null)}>{copy.cancel}</Button></div> : null}
    </li>)}</ul>
    {selected ? <section className="space-y-4 rounded-md border bg-card p-4" aria-label={copy.savedReport}>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => { if (reportRef.current) downloadAnalysisFile(`diesel-analysis-${selected.id}.html`, reportHtml(reportRef.current, locale), "text/html;charset=utf-8"); }}>{copy.exportHtml}</Button>
        <Button variant="outline" onClick={() => downloadAnalysisFile(`diesel-analysis-${selected.id}.json`, JSON.stringify(selected, null, 2), "application/json")}>{copy.exportJson}</Button>
        {selected.payload.kind === "comparison" ? <Link className="self-center underline" href={`/compare?${comparisonSearch(selected.payload.comparison.query)}`}>{copy.rerun}</Link> : null}
      </div>
      <p className="text-xs text-muted-foreground">{copy.exportHelp}</p>
      <div ref={reportRef} data-testid="saved-analysis-report" className="space-y-5">
        <h2 className="text-xl font-semibold">{selected.title}</h2>
        <p>{copy.savedAt}: {formatUtcDate(selected.savedAt, locale)} · {selected.savedAt}</p>
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{copy.historicalNotice}</p>
        {selected.payload.kind === "comparison" ? <ComparisonResults snapshot={selected.payload.comparison} /> : selected.payload.history.messages.map(message => {
          const urls = message.parts.flatMap(part => {
            if (!isToolUIPart(part)) return [];
            const presentation = toolPartPresentation(part);
            return presentation.kind === "result" ? presentation.result.citations.map(citation => citation.sourceUrl).filter(isNavigableEvidenceUrl) : [];
          });
          return <article className="space-y-3 rounded-md border p-3" key={message.id}>
            <h3 className="font-semibold">{message.role === "user" ? dictionary.chat.user : dictionary.chat.aiExplanation}</h3>
            {message.parts.map((part, index) => {
              if (part.type === "text") return message.role === "user" ? <p className="whitespace-pre-wrap" key={index}>{part.text}</p> : <AssistantMarkdown key={index} content={part.text} allowedExternalUrls={urls} hiddenImage={dictionary.chat.hiddenModelImage} hiddenImageWithAlt={dictionary.chat.hiddenModelImageWithAlt} />;
              if (isToolUIPart(part)) {
                const presentation = toolPartPresentation(part);
                return presentation.kind === "result" ? <ToolResultCard key={index} result={presentation.result} countryIso2ByIso3={countryIso2ByIso3} /> : <p key={index}>{dictionary.common.error}</p>;
              }
              const attachment = parseReleasedAttachmentPart(part);
              return attachment ? <p key={index}>{formatReleasedAttachment(attachment, dictionary)}</p> : null;
            })}
          </article>;
        })}
      </div>
    </section> : null}
  </>;
}
