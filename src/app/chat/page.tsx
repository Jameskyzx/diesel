import type { Metadata } from "next";
import { FileCheck2, Map, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SalesChat } from "@/components/ai/sales-chat";
import { PageHeader } from "@/components/layout/page-header";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import {
  parseChatUrlContext,
  type ChatUrlContext,
} from "@/features/ai/chat-url-context";
import {
  isServerAiConfigured,
  isServerMultimodalAiConfigured,
} from "@/server/ai/model";
import { isPortfolioDemoMode } from "@/server/config/portfolio-demo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getDictionary } from "@/i18n/dictionaries";
import { formatUtcDate } from "@/i18n/date";
import { getRequestLocale } from "@/i18n/server";
import type { Locale } from "@/i18n/locale";
import { applicationScopeLabel } from "@/i18n/structured-labels";
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

function initialPromptForContext(
  context: ChatUrlContext,
  locale: Locale,
): string {
  if (!context.countryIso3) {
    return "";
  }

  if (context.applicationScope && context.powerKw !== undefined) {
    const scope = applicationScopeLabel(
      context.applicationScope,
      getDictionary(locale),
    );
    if (locale === "zh-CN") {
      const product = context.productModelCode
        ? `，重点判断产品 ${context.productModelCode}`
        : "";
      const date = context.asOf
        ? `，判断日期 ${formatUtcDate(context.asOf, locale)}`
        : "";
      return `请分析 ${context.countryIso3} 的${scope} ${context.powerKw} kW 法规与产品适配${product}${date}，并明确说明证据缺口以及结果能否用于销售承诺。`;
    }

    const product = context.productModelCode
      ? `, focusing on product ${context.productModelCode}`
      : "";
    const date = context.asOf
      ? `, as of ${formatUtcDate(context.asOf, locale)}`
      : "";
    return `Analyze ${scope} regulations and product fit for ${context.countryIso3} at ${context.powerKw} kW${product}${date}. State the evidence gaps and whether the result can support a sales commitment.`;
  }

  if (locale === "zh-CN") {
    const date = context.asOf
      ? `在 ${formatUtcDate(context.asOf, locale)}`
      : "当前";
    return `请查询 ${context.countryIso3} ${date}的有效法规，并明确说明证据缺口以及结果能否用于销售承诺。`;
  }

  const date = context.asOf
    ? ` as of ${formatUtcDate(context.asOf, locale)}`
    : " currently";
  return `Find the regulations effective in ${context.countryIso3}${date}. State the evidence gaps and whether the result can support a sales commitment.`;
}

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

      <section className="chat-workbench grid min-h-0 gap-5 xl:grid-cols-[17rem_minmax(0,1fr)]" data-testid="chat-workbench">
        <aside className="surface-panel self-start overflow-hidden rounded-md" data-testid="chat-query-context">
          <div className="workspace-card-header"><h2 className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal aria-hidden="true" className="size-4 text-primary" />{dictionary.workspace.queryContext}</h2></div>
          <div className="p-5">
            <p className="section-kicker">{dictionary.workspace.parameters}</p>
            {context.countryIso3 ? <dl className="mt-4 divide-y text-xs">
              <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-muted-foreground">{dictionary.workspace.contextCountry}</dt><dd className="font-mono font-semibold">{context.countryIso3}</dd></div>
              {context.applicationScope ? <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-muted-foreground">{dictionary.workspace.contextScope}</dt><dd className="font-medium">{applicationScopeLabel(context.applicationScope, dictionary)}</dd></div> : null}
              {context.powerKw !== undefined ? <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-muted-foreground">{dictionary.workspace.contextPower}</dt><dd className="font-medium">{context.powerKw} kW</dd></div> : null}
              {context.asOf ? <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-muted-foreground">{dictionary.workspace.contextDate}</dt><dd className="font-medium">{formatUtcDate(context.asOf, locale)}</dd></div> : null}
              {context.productModelCode ? <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-muted-foreground">{dictionary.workspace.contextProduct}</dt><dd className="break-all font-mono font-medium">{context.productModelCode}</dd></div> : null}
            </dl> : <p className="mt-3 text-xs leading-6 text-muted-foreground">{dictionary.workspace.noContext}</p>}
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
