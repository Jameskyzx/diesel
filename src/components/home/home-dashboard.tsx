"use client";

import {
  ArrowRight,
  AlertTriangle,
  BarChart3,
  Bot,
  Database,
  FileCheck2,
  Globe2,
  LoaderCircle,
  Map,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { countryMapResponseSchema, type CountryMapResponse } from "@/features/countries/schemas";
import { hasDetailedCountryCoverage } from "@/features/database/schemas";
import { cn } from "@/lib/utils";

type DashboardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: CountryMapResponse };

const initialState: DashboardState = { status: "loading" };

export function HomeDashboard({ demoMode }: { demoMode: boolean }) {
  const [state, setState] = useState<DashboardState>(initialState);

  const requestData = useCallback(() => {
    void fetch("/api/countries", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("国家摘要暂时不可用");
        return countryMapResponseSchema.parse(await response.json());
      })
      .then((data) => setState({ data, status: "ready" }))
      .catch(() => setState({ message: "国家覆盖摘要暂时无法加载，请进入地图重试。", status: "error" }));
  }, []);

  const loadData = useCallback(() => {
    setState(initialState);
    requestData();
  }, [requestData]);

  useEffect(() => {
    requestData();
  }, [requestData]);

  const metrics = useMemo(() => {
    if (state.status !== "ready") return { covered: 0, noData: 0, planned: 0, total: 0 };
    return state.data.countries.reduce(
      (result, country) => {
        result.total += 1;
        if (hasDetailedCountryCoverage(country.dataCoverageStatus)) result.covered += 1;
        else if (country.dataCoverageStatus === "planned") result.planned += 1;
        else result.noData += 1;
        return result;
      },
      { covered: 0, noData: 0, planned: 0, total: 0 },
    );
  }, [state]);

  const coveredCountries =
    state.status === "ready"
      ? state.data.countries
          .filter((country) => hasDetailedCountryCoverage(country.dataCoverageStatus))
          .toSorted((a, b) => a.nameEn.localeCompare(b.nameEn))
      : [];

  return (
    <main className="mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <section className="overflow-hidden rounded-md border border-[#1b312b] bg-[#111918] px-5 py-7 text-white shadow-[0_16px_40px_rgb(15_32_28_/_0.14)] sm:px-7 sm:py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-[#b8e548]">
              <Globe2 aria-hidden="true" className="size-4" />
              GLOBAL REGULATORY WORKSPACE
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">全球柴油机业务工作台</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">把法规覆盖、产品适配与市场判断放到同一个可复核的工作面上。</p>
            <div className="mt-5 flex max-w-2xl items-start gap-2.5 rounded-md border border-amber-300/35 bg-amber-300/10 px-3.5 py-3 text-sm leading-5 text-amber-50" data-testid="usage-boundary" role="note">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-300" />
              <p>
                {demoMode
                  ? "当前为完全虚构的作品 Demo：可验证流程与追溯设计，不可用于真实可售性判断、报价、认证声明或法律结论。"
                  : "工作边界：系统输出用于事实检索与内部复核，不替代正式认证、法律意见或销售承诺。"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className={cn(buttonVariants({ size: "lg" }), "gap-2")} href="/map">
              <Map aria-hidden="true" className="size-4" />
              打开全球地图
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }), "gap-2 border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white")} href="/chat">
              <Bot aria-hidden="true" className="size-4" />
              开始对话
            </Link>
          </div>
        </div>
      </section>

      <section aria-label="覆盖概览" className="grid gap-px overflow-hidden border border-slate-200 bg-slate-200 py-0 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Globe2} label="国家目录" value={metrics.total} tone="slate" />
        <MetricCard icon={ShieldCheck} label="可查看证据边界" value={metrics.covered} tone="emerald" />
        <MetricCard icon={FileCheck2} label="计划覆盖" value={metrics.planned} tone="amber" />
        <MetricCard icon={Database} label="暂无详情数据" value={metrics.noData} tone="blue" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-md border border-slate-200 bg-white p-5 shadow-[0_10px_26px_rgb(15_32_28_/_0.06)] sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-slate-500">COVERAGE WATCHLIST</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">已覆盖国家</h2>
            </div>
            <Link className="text-sm font-medium text-emerald-700 hover:text-emerald-900" href="/map">查看地图 <ArrowRight aria-hidden="true" className="ml-1 inline size-3.5" /></Link>
          </div>
          {state.status === "loading" ? <div className="flex min-h-36 items-center justify-center text-sm text-slate-500"><LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />正在同步国家摘要…</div> : null}
          {state.status === "error" ? <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert"><p>{state.message}</p><button className="mt-3 inline-flex items-center gap-1.5 font-medium underline" onClick={loadData} type="button"><RefreshCw aria-hidden="true" className="size-3.5" />重试</button></div> : null}
          {state.status === "ready" ? <div className="mt-5 grid gap-2 sm:grid-cols-2">{coveredCountries.map((country) => <Link className="group flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-[#fbfdfc] px-3.5 py-3 transition-colors hover:border-emerald-400 hover:bg-emerald-50/50" href={`/countries/${country.iso3}`} key={country.iso3}><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{country.nameEn}</span><span className="mt-0.5 block text-xs text-slate-500">{country.iso3} · {country.isDemo ? "Demo fixture" : "已核验来源"}</span></span><ArrowRight aria-hidden="true" className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-700" /></Link>)}</div> : null}
        </div>

        <div className="rounded-md border border-[#1b312b] bg-[#111918] p-5 text-white shadow-[0_10px_26px_rgb(15_32_28_/_0.1)] sm:p-6">
          <div className="flex items-center gap-2 text-[#b8e548]"><BarChart3 aria-hidden="true" className="size-4" /><p className="text-xs font-semibold tracking-[0.14em]">WORKFLOW SHORTCUTS</p></div>
          <h2 className="mt-3 text-xl font-semibold">今天从哪里开始？</h2>
          <div className="mt-5 space-y-2">
            <ShortcutLink href="/map" icon={Map} label="查一个国家的法规与证据" />
            {coveredCountries[0] ? <ShortcutLink href={demoMode ? `/countries/${coveredCountries[0].iso3}?applicationScope=non-road&powerKw=100&productModelCode=DEMO-ENG-100` : `/countries/${coveredCountries[0].iso3}`} icon={FileCheck2} label="按场景判断一个产品是否适配" /> : null}
            <ShortcutLink href="/chat" icon={Bot} label="比较两个市场并生成内部简报" />
          </div>
          <p className="mt-6 border-t border-white/15 pt-4 text-xs leading-5 text-slate-300">来源、状态和核验时间会在国家详情与对话结果中保留，便于复核和分享。</p>
        </div>
      </section>
    </main>
  );
}

function MetricCard({ icon: Icon, label, tone, value }: { icon: typeof Globe2; label: string; tone: "amber" | "blue" | "emerald" | "slate"; value: number }) {
  const toneClasses = { amber: "bg-amber-50 text-amber-700", blue: "bg-sky-50 text-sky-700", emerald: "bg-emerald-50 text-emerald-700", slate: "bg-slate-100 text-slate-700" } as const;
  return <article className="bg-white p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><span className={cn("grid size-9 place-items-center rounded-md", toneClasses[tone])}><Icon aria-hidden="true" className="size-4" /></span><span className="text-2xl font-semibold tracking-tight text-slate-950">{value || "—"}</span></div><p className="mt-4 text-sm text-slate-600">{label}</p></article>;
}

function ShortcutLink({ href, icon: Icon, label }: { href: string; icon: typeof Map; label: string }) {
  return <Link className="group flex items-center gap-3 rounded-md border border-white/15 bg-white/5 px-3.5 py-3 text-sm transition-colors hover:border-[#b8e548]/50 hover:bg-white/10" href={href}><Icon aria-hidden="true" className="size-4 text-[#b8e548]" /><span className="flex-1">{label}</span><ArrowRight aria-hidden="true" className="size-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-white" /></Link>;
}
