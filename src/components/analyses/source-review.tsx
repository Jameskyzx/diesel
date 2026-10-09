"use client";

import { useLocale } from "@/components/i18n/locale-provider";
import type { AnalysisSource } from "@/features/marketing/schemas";
import type { ApplicationScope } from "@/features/database/schemas";
import { localizedCitationLocator } from "@/features/ai/citation-locator-copy";
import { formatOptionalUtcDate, formatUtcDate } from "@/i18n/date";
import { applicationScopeLabel } from "@/i18n/structured-labels";
import { isNavigableEvidenceUrl } from "@/lib/source-link";

/** Only supplied, retrieved text is shown as an excerpt. Never synthesize one. */
export function SourceExcerpt({ excerpt, pageFrom, pageTo, section, url, countryIso3, scope, validFrom, validTo }: {
  excerpt?: string; pageFrom?: number | null; pageTo?: number | null; section?: string | null; url?: string | null;
  countryIso3?: string | null; scope?: ApplicationScope | null; validFrom?: string | null; validTo?: string | null;
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.analysis;
  let pageUrl: string | null = null;
  if (pageFrom && isNavigableEvidenceUrl(url)) {
    const parsed = new URL(url);
    if (parsed.pathname.toLowerCase().endsWith(".pdf") && !parsed.hash) {
      parsed.hash = `page=${pageFrom}`;
      pageUrl = parsed.href;
    }
  }
  return <div className="mt-2 space-y-2 rounded-md border bg-background p-3 text-xs leading-5" data-testid="source-review">
    <p className="font-semibold">{copy.originalEvidence}</p>
    <p>{pageFrom ? `${dictionary.chat.sourcePage.replace("{pages}", pageTo && pageTo !== pageFrom ? `${pageFrom}–${pageTo}` : String(pageFrom))} · ` : ""}{section || (!pageFrom ? dictionary.chat.noSourceLocator : "")}</p>
    {excerpt ? <>
      <p>{dictionary.chat.country}: {countryIso3 ?? dictionary.common.notRecorded} · {dictionary.chat.scope}: {scope ? applicationScopeLabel(scope, dictionary) : dictionary.common.notRecorded}</p>
      <p>{copy.sourceValidity}: {formatOptionalUtcDate(validFrom, locale, dictionary.common.notRecorded)} → {formatOptionalUtcDate(validTo, locale, dictionary.common.notRecorded)}</p>
      <blockquote className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-l-2 pl-3" tabIndex={0}>{excerpt}</blockquote>
      <p className="text-muted-foreground">{copy.excerptNotice}</p>
    </> : <p className="text-muted-foreground">{copy.noExcerpt}</p>}
    {pageUrl ? <a className="underline" href={pageUrl} target="_blank" rel="noreferrer">{copy.openPage}</a> : null}
  </div>;
}

export function AnalysisSources({ sources }: { sources: AnalysisSource[] }) {
  const { dictionary, locale } = useLocale();
  return <details className="mt-3 text-xs leading-5">
    <summary className="cursor-pointer font-semibold">{dictionary.chat.viewSources.replace("{count}", String(sources.length))}</summary>
    {sources.map((source, index) => <article className="my-3 break-words rounded-md border p-3" key={`${source.sourceId}:${source.entityId}:${index}`}>
      <p className="font-semibold">{source.title}</p>
      {isNavigableEvidenceUrl(source.sourceUrl) ? <a className="underline" href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceTitle}</a> : <p>{source.sourceTitle}</p>}
      <p>{localizedCitationLocator(source, locale, dictionary)}</p>
      <p>{dictionary.common.verified}: {formatUtcDate(source.verifiedAt, locale)}</p>
      {source.isDemo ? <p className="font-semibold text-amber-800">{dictionary.common.demo}</p> : null}
      <SourceExcerpt url={source.sourceUrl} />
    </article>)}
  </details>;
}
