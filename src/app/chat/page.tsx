import type { Metadata } from "next";
import { Bot, FileCheck2, Map } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SalesChat } from "@/components/ai/sales-chat";
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
    demoMode ? copy.starterDemoCompare : copy.starterBrief,
  ];

  return (
    <main className="page-shell flex min-h-[calc(100dvh-7rem)] flex-col py-6 sm:py-8">
      <LocaleRenderReceipt locale={locale} />
      <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="section-kicker flex items-center gap-2"><Bot aria-hidden="true" className="size-4" />{copy.kicker}</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{copy.heading}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-2 bg-card")} href="/map"><Map aria-hidden="true" className="size-4" />{copy.mapFirst}</Link>
          <Link className={cn(buttonVariants(), "h-10 gap-2")} href="/countries/CHN"><FileCheck2 aria-hidden="true" className="size-4" />{copy.exampleCountry}</Link>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <SalesChat
          aiConfigured={isServerAiConfigured()}
          countryIso2ByIso3={countryIso2ByIso3}
          demoMode={demoMode}
          imageUploadsEnabled={isServerMultimodalAiConfigured()}
          initialPrompt={initialPromptForContext(context, locale)}
          selectedCountryIso3={context.countryIso3 ?? null}
          suggestedPrompts={conversationStarters}
        />
        <aside className="surface-panel hidden self-start rounded-md p-5 xl:block">
          <p className="section-kicker">{copy.sidebarKicker}</p>
          <h2 className="mt-2 text-base font-semibold tracking-tight">{copy.sidebarHeading}</h2>
          <p className="mt-4 rounded-lg bg-muted/60 px-3 py-3 text-xs leading-6 text-muted-foreground">
            {copy.sidebarBody}
          </p>
          <div className="mt-4 border-t pt-4 text-xs leading-5 text-muted-foreground">{copy.sidebarFoot}</div>
        </aside>
      </section>
    </main>
  );
}
