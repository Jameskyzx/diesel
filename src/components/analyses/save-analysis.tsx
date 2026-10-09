"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import { savedAnalysisSchema, type AnalysisPayload } from "@/features/analyses/schemas";
import { downloadAnalysisFile, saveAnalysis } from "@/features/analyses/storage";

export function SaveAnalysis({ createPayload, defaultTitle, disabled = false }: {
  createPayload: () => AnalysisPayload | null; defaultTitle: string; disabled?: boolean;
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.analysis;
  const [title, setTitle] = useState("");
  const [notice, setNotice] = useState<"saved" | "error" | null>(null);
  function handle(exportOnly: boolean) {
    try {
      const payload = createPayload();
      if (!payload) throw new Error("Incomplete analysis");
      const analysis = savedAnalysisSchema.parse({ version: 1, id: crypto.randomUUID(),
        title: (title.trim() || defaultTitle).slice(0, 160), savedAt: new Date().toISOString(), locale, payload });
      if (exportOnly) {
        downloadAnalysisFile(`diesel-analysis-${analysis.id}.json`, JSON.stringify(analysis, null, 2), "application/json");
        setNotice(null);
      } else {
        saveAnalysis(window.localStorage, analysis);
        setNotice("saved");
      }
    } catch { setNotice("error"); }
  }
  return <div className="space-y-2 rounded-md border bg-card p-3 text-xs" data-testid="save-analysis">
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid w-full min-w-0 gap-1 sm:w-auto sm:flex-1">{copy.titleLabel}
        <input className="h-9 min-w-0 rounded-md border px-2 text-sm" maxLength={160} value={title} placeholder={defaultTitle.slice(0, 160)} onChange={event => { setTitle(event.target.value); setNotice(null); }} />
      </label>
      <Button disabled={disabled} onClick={() => handle(false)} size="sm" type="button">{copy.save}</Button>
      <Button disabled={disabled} onClick={() => handle(true)} size="sm" type="button" variant="outline">{copy.exportJson}</Button>
      <Link className="py-2 underline" href="/analyses">{copy.library}</Link>
    </div>
    <p className="text-muted-foreground">{copy.localNotice}</p>
    {notice ? <p role={notice === "error" ? "alert" : "status"}>{notice === "saved" ? copy.saved : copy.storageError}</p> : null}
  </div>;
}
