import type { Metadata } from "next";
import { Bot, FileCheck2, Map } from "lucide-react";
import Link from "next/link";
import { z } from "zod";

import { SalesChat } from "@/components/ai/sales-chat";
import {
  applicationScopeSchema,
  iso3Schema,
  isoDateSchema,
  powerKwSchema,
} from "@/features/database/schemas";
import {
  isServerAiConfigured,
  isServerMultimodalAiConfigured,
} from "@/server/ai/model";
import { isPortfolioDemoMode } from "@/server/config/portfolio-demo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "AI 对话" };

type ChatPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const chatContextSchema = z.object({
  applicationScope: applicationScopeSchema.optional(),
  asOf: isoDateSchema.optional(),
  countryIso3: iso3Schema.optional(),
  powerKw: powerKwSchema.optional(),
  productModelCode: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .transform((value) => value.toUpperCase())
    .optional(),
});

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseChatContext(
  raw: Record<string, string | string[] | undefined>,
) {
  const parsed = chatContextSchema.safeParse({
    applicationScope: firstParam(raw.applicationScope),
    asOf: firstParam(raw.asOf),
    countryIso3: firstParam(raw.countryIso3),
    powerKw: firstParam(raw.powerKw),
    productModelCode: firstParam(raw.productModelCode),
  });

  return parsed.success ? parsed.data : {};
}

function initialPromptForContext(
  context: z.infer<typeof chatContextSchema>,
): string {
  if (!context.countryIso3) {
    return "";
  }

  if (context.applicationScope && context.powerKw !== undefined) {
    const product = context.productModelCode
      ? `，重点判断产品 ${context.productModelCode}`
      : "";
    const date = context.asOf ? `，判断日期 ${context.asOf}` : "";
    return `请分析 ${context.countryIso3} 的 ${context.applicationScope} ${context.powerKw} kW 法规与产品适配${product}${date}，并明确说明证据缺口以及结果能否用于销售承诺。`;
  }

  const date = context.asOf ? `在 ${context.asOf}` : "当前";
  return `请查询 ${context.countryIso3} ${date}的有效法规，并明确说明证据缺口以及结果能否用于销售承诺。`;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const demoMode = isPortfolioDemoMode();
  const context = parseChatContext(await searchParams);

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-[1680px] flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <section className="mb-6 flex flex-col gap-5 rounded-md border border-[#1b312b] bg-[#111918] px-5 py-6 text-white shadow-[0_16px_40px_rgb(15_32_28_/_0.12)] lg:flex-row lg:items-end lg:justify-between sm:px-7">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-[#b8e548]"><Bot aria-hidden="true" className="size-4" />SALES INTELLIGENCE CHAT</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">和数据一起讨论下一步</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">通过服务端配置的模型，围绕法规、市场、产品适配与机会评分展开可追溯分析。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={cn(buttonVariants({ variant: "outline" }), "gap-2 border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white")} href="/map"><Map aria-hidden="true" className="size-4" />先看地图</Link>
          <Link className={cn(buttonVariants({ variant: "outline" }), "gap-2 border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white")} href="/countries/CHN"><FileCheck2 aria-hidden="true" className="size-4" />示例国家资料</Link>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <SalesChat
          aiConfigured={isServerAiConfigured()}
          demoMode={demoMode}
          imageUploadsEnabled={isServerMultimodalAiConfigured()}
          initialPrompt={initialPromptForContext(context)}
          selectedCountryIso3={context.countryIso3 ?? null}
        />
        <aside className="hidden rounded-md border border-slate-200 bg-white p-5 shadow-[0_10px_26px_rgb(15_32_28_/_0.06)] lg:block">
          <p className="text-xs font-semibold tracking-[0.14em] text-emerald-700">PROMPTS</p>
          <h2 className="mt-2 text-base font-semibold text-slate-950">可以这样问</h2>
          <div className="mt-4 space-y-2 text-sm text-slate-600"><p className="rounded-lg bg-slate-50 px-3 py-2.5">CHN 目前有哪些有效法规？</p><p className="rounded-lg bg-slate-50 px-3 py-2.5">{demoMode ? "CHN 的 non-road 100 kW 产品是否适配？" : "比较 JPN 和 KOR 的排放要求。"}</p><p className="rounded-lg bg-slate-50 px-3 py-2.5">{demoMode ? "比较 CHN 和 BRA 的 non-road 100 kW 法规。" : "为 AUS 生成一份销售简报。"}</p></div>
          <div className="mt-6 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">回答中的法规、市场和产品事实只来自确定性工具结果。</div>
        </aside>
      </section>
    </main>
  );
}
