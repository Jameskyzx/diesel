import type { Metadata } from "next";
import { FileCheck2, Map, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SalesChat } from "@/components/ai/sales-chat";
import { QueryContextForm } from "@/components/countries/query-context-form";
import { PageHeader } from "@/components/layout/page-header";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import {
  parseChatUrlContext,
} from "@/features/ai/chat-url-context";
import { initialPromptForContext } from "@/features/ai/chat-context-prompt";
import {
  isServerAiConfigured,
  isServerMultimodalAiConfigured,
} from "@/server/ai/model";
import { isPortfolioDemoMode } from "@/server/config/portfolio-demo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getDictionary } from "@/i18n/dictionaries";
import { formatUtcDate } from "@/i18n/date";
import { applicationScopeLabel } from "@/i18n/structured-labels";
import { getRequestLocale } from "@/i18n/server";
import { getCountryDirectory } from "@/server/services/country-directory";

const countryIso2ByIso3 = Object.fromEntries(
  getCountryDirectory().map(({ iso2, iso3 }) => [iso3, iso2]),
);

export async function generateMetadata(): Promise<Metadata> {
  return { title: getDictionary(await getRequestLocale()).chatPage.title };
}

type ChatPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const locale = await getRequestLocale();
  const dictionary = getDictionary(locale);
  const copy = dictionary.chatPage;
  const demoMode = isPortfolioDemoMode();
  const { canonicalQuery, context, needsRedirect } = parseChatUrlContext(
    await searchParams,
  );
  if (needsRedirect) {
    redirect(canonicalQuery ? `/chat?${canonicalQuery}` : "/chat");
  }
  const conversationStarters = [
    copy.starterCurrent,
    demoMode ? copy.starterDemoFit : copy.starterCompare,
    demoMode ? copy.starterDemoCompare : copy.starterMarket,
  ];

  return (
    <main className="page-shell py-6">
      <LocaleRenderReceipt locale={locale} />
      <PageHeader kicker={copy.kicker} title={copy.heading} description={copy.description} actions={<>
          <Link className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-2 bg-card")} href="/map"><Map aria-hidden="true" className="size-4" />{copy.mapFirst}</Link>
          <Link className={cn(buttonVariants(), "h-10 gap-2")} href="/countries/CHN"><FileCheck2 aria-hidden="true" className="size-4" />{copy.exampleCountry}</Link>
      </>} />

      <section className="chat-workbench grid min-h-0 gap-5 xl:grid-cols-[17rem_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]" data-testid="chat-workbench">
        <aside className="surface-panel min-h-0 self-start overflow-hidden rounded-md xl:max-h-full xl:overflow-y-auto" data-testid="chat-query-context">
          <div className="workspace-card-header"><h2 className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal aria-hidden="true" className="size-4 text-primary" />{dictionary.workspace.queryContext}</h2></div>
          <div className="p-5">
            <p className="text-xs leading-5 text-muted-foreground">
              {[context.countryIso3, context.applicationScope ? applicationScopeLabel(context.applicationScope, dictionary) : null, context.powerKw !== undefined ? `${context.powerKw} kW` : null, context.asOf ? formatUtcDate(context.asOf, locale) : null, context.productModelCode].filter(Boolean).join(" · ") || dictionary.workspace.noContext}
            </p>
            <details className="mt-3" key={canonicalQuery}>
              <summary className="cursor-pointer text-sm font-semibold text-primary">{dictionary.queryEditor.editConditions}</summary>
              <div className="mt-3"><QueryContextForm context={context} countries={getCountryDirectory()} mode="chat" /></div>
            </details>
          </div>
          <div className="border-t bg-muted/30 p-5">
            <h3 className="text-xs font-semibold">{dictionary.workspace.evidenceWorkflow}</h3>
            <ol className="mt-3 space-y-3 text-xs text-muted-foreground">
              {[dictionary.workspace.regulations, dictionary.workspace.productFit, dictionary.workspace.sources].map((step, index) => <li className="flex items-center gap-3" key={step}><span className="grid size-5 shrink-0 place-items-center rounded-full border bg-card text-[10px] font-semibold text-primary">{index + 1}</span>{step}</li>)}
            </ol>
            <p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground">{copy.sidebarFoot}</p>
          </div>
        </aside>
        <SalesChat
          key={JSON.stringify({ demoMode, ...context })}
          historyKey={JSON.stringify({ demoMode, ...context })}
          aiConfigured={isServerAiConfigured()}
          countryIso2ByIso3={countryIso2ByIso3}
          demoMode={demoMode}
          imageUploadsEnabled={isServerMultimodalAiConfigured()}
          initialPrompt={initialPromptForContext(context, locale)}
          selectedCountryIso3={context.countryIso3 ?? null}
          suggestedPrompts={conversationStarters}
        />
      </section>
    </main>
  );
}
