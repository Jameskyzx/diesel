import type { Metadata } from "next";
import { Bot, FileCheck2, Map } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SalesChat } from "@/components/ai/sales-chat";
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
import { getRequestLocale } from "@/i18n/server";
import type { Locale } from "@/i18n/locale";

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
    if (locale === "zh-CN") {
      const product = context.productModelCode
        ? `，重点判断产品 ${context.productModelCode}`
        : "";
      const date = context.asOf ? `，判断日期 ${context.asOf}` : "";
      return `请分析 ${context.countryIso3} 的 ${context.applicationScope} ${context.powerKw} kW 法规与产品适配${product}${date}，并明确说明证据缺口以及结果能否用于销售承诺。`;
    }

    const product = context.productModelCode
      ? `, focusing on product ${context.productModelCode}`
      : "";
    const date = context.asOf ? `, as of ${context.asOf}` : "";
    return `Analyze ${context.applicationScope} regulations and product fit for ${context.countryIso3} at ${context.powerKw} kW${product}${date}. State the evidence gaps and whether the result can support a sales commitment.`;
  }

  if (locale === "zh-CN") {
    const date = context.asOf ? `在 ${context.asOf}` : "当前";
    return `请查询 ${context.countryIso3} ${date}的有效法规，并明确说明证据缺口以及结果能否用于销售承诺。`;
  }

  const date = context.asOf ? ` as of ${context.asOf}` : " currently";
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
    <main className="page-shell flex min-h-[calc(100dvh-4.5rem)] flex-col py-8 sm:py-10">
      <section className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="section-kicker flex items-center gap-2"><Bot aria-hidden="true" className="size-4" />{copy.kicker}</div>
          <h1 className="display-title mt-4 text-4xl font-semibold tracking-[-0.045em] text-[#142821] sm:text-5xl lg:text-6xl">{copy.heading}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{copy.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={cn(buttonVariants({ variant: "outline" }), "h-11 gap-2 rounded-full border-black/[0.07] bg-white/80 px-5 text-[#23483b] hover:bg-emerald-50 hover:text-emerald-950")} href="/map"><Map aria-hidden="true" className="size-4" />{copy.mapFirst}</Link>
          <Link className={cn(buttonVariants(), "h-11 gap-2 rounded-full bg-[#173d31] px-5 text-white hover:bg-[#215142]")} href="/countries/CHN"><FileCheck2 aria-hidden="true" className="size-4" />{copy.exampleCountry}</Link>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <SalesChat
          aiConfigured={isServerAiConfigured()}
          demoMode={demoMode}
          imageUploadsEnabled={isServerMultimodalAiConfigured()}
          initialPrompt={initialPromptForContext(context, locale)}
          selectedCountryIso3={context.countryIso3 ?? null}
          suggestedPrompts={conversationStarters}
        />
        <aside className="surface-panel hidden rounded-[1.75rem] p-6 lg:block">
          <p className="section-kicker">{copy.sidebarKicker}</p>
          <h2 className="display-title mt-3 text-2xl font-semibold tracking-[-0.03em] text-[#17382e]">{copy.sidebarHeading}</h2>
          <p className="mt-6 rounded-2xl border border-black/[0.05] bg-[#f5f7f1] px-4 py-3 text-sm leading-6 text-slate-700">
            {copy.sidebarBody}
          </p>
          <div className="mt-7 border-t border-black/[0.07] pt-5 text-xs leading-5 text-slate-500">{copy.sidebarFoot}</div>
        </aside>
      </section>
    </main>
  );
}
