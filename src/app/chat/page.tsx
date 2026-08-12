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
    <main className="page-shell flex min-h-[calc(100dvh-4.5rem)] flex-col py-8 sm:py-10">
      <section className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="section-kicker flex items-center gap-2"><Bot aria-hidden="true" className="size-4" />SALES INTELLIGENCE</div>
          <h1 className="display-title mt-4 text-4xl font-semibold tracking-[-0.045em] text-[#142821] sm:text-5xl lg:text-6xl">和数据一起讨论下一步</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">通过服务端配置的模型，围绕法规、市场、产品适配与机会评分展开可追溯分析。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={cn(buttonVariants({ variant: "outline" }), "h-11 gap-2 rounded-full border-black/[0.07] bg-white/80 px-5 text-[#23483b] hover:bg-emerald-50 hover:text-emerald-950")} href="/map"><Map aria-hidden="true" className="size-4" />先看地图</Link>
          <Link className={cn(buttonVariants(), "h-11 gap-2 rounded-full bg-[#173d31] px-5 text-white hover:bg-[#215142]")} href="/countries/CHN"><FileCheck2 aria-hidden="true" className="size-4" />示例国家资料</Link>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <SalesChat
          aiConfigured={isServerAiConfigured()}
          demoMode={demoMode}
          imageUploadsEnabled={isServerMultimodalAiConfigured()}
          initialPrompt={initialPromptForContext(context)}
          selectedCountryIso3={context.countryIso3 ?? null}
        />
        <aside className="surface-panel hidden rounded-[1.75rem] p-6 lg:block">
          <p className="section-kicker">Conversation starters</p>
          <h2 className="display-title mt-3 text-2xl font-semibold tracking-[-0.03em] text-[#17382e]">可以这样问</h2>
          <div className="mt-6 space-y-3 text-sm leading-6 text-slate-700"><p className="rounded-2xl border border-black/[0.05] bg-[#f5f7f1] px-4 py-3">CHN 目前有哪些有效法规？</p><p className="rounded-2xl border border-black/[0.05] bg-[#f5f7f1] px-4 py-3">{demoMode ? "CHN 的 non-road 100 kW 产品是否适配？" : "比较 JPN 和 KOR 的排放要求。"}</p><p className="rounded-2xl border border-black/[0.05] bg-[#f5f7f1] px-4 py-3">{demoMode ? "比较 CHN 和 BRA 的 non-road 100 kW 法规。" : "为 AUS 生成一份销售简报。"}</p></div>
          <div className="mt-7 border-t border-black/[0.07] pt-5 text-xs leading-5 text-slate-500">事实来自确定性工具；解释与建议会与证据层分开呈现。</div>
        </aside>
      </section>
    </main>
  );
}
