"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  FileCheck2,
  Globe2,
  LoaderCircle,
  Map as MapIcon,
  RefreshCw,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  countryMapResponseSchema,
  type CountryMapResponse,
} from "@/features/countries/schemas";
import { hasDetailedCountryCoverage } from "@/features/database/schemas";
import { cn } from "@/lib/utils";

type DashboardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: CountryMapResponse };

type DashboardMetrics = {
  covered: number;
  fresh: number;
  total: number;
};

const initialState: DashboardState = { status: "loading" };

const emptyMetrics: DashboardMetrics = {
  covered: 0,
  fresh: 0,
  total: 0,
};

const featuredCountryOrder = new Map(
  ["CHN", "USA", "DEU", "IND", "BRA", "JPN"].map((iso3, index) => [
    iso3,
    index,
  ]),
);

export function HomeDashboard({ demoMode }: { demoMode: boolean }) {
  const [state, setState] = useState<DashboardState>(initialState);

  const requestData = useCallback(() => {
    void fetch("/api/countries", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("国家摘要暂时不可用");
        return countryMapResponseSchema.parse(await response.json());
      })
      .then((data) => setState({ data, status: "ready" }))
      .catch(() =>
        setState({
          message: "国家覆盖摘要暂时无法加载，请进入地图重试。",
          status: "error",
        }),
      );
  }, []);

  const loadData = useCallback(() => {
    setState(initialState);
    requestData();
  }, [requestData]);

  useEffect(() => {
    requestData();
  }, [requestData]);

  const metrics = useMemo<DashboardMetrics>(() => {
    if (state.status !== "ready") return emptyMetrics;

    return state.data.countries.reduce<DashboardMetrics>(
      (result, country) => {
        result.total += 1;
        if (hasDetailedCountryCoverage(country.dataCoverageStatus)) {
          result.covered += 1;
          if (!country.isStale) result.fresh += 1;
        }
        return result;
      },
      { ...emptyMetrics },
    );
  }, [state]);

  const coveredCountries = useMemo(() => {
    if (state.status !== "ready") return [];

    return state.data.countries
      .filter((country) =>
        hasDetailedCountryCoverage(country.dataCoverageStatus),
      )
      .toSorted((a, b) => {
        const priorityDifference =
          (featuredCountryOrder.get(a.iso3) ?? 100) -
          (featuredCountryOrder.get(b.iso3) ?? 100);
        return priorityDifference || a.nameEn.localeCompare(b.nameEn);
      });
  }, [state]);

  const featuredCountries = coveredCountries.slice(0, 6);
  const productFitHref = coveredCountries[0]
    ? demoMode
      ? `/countries/${coveredCountries[0].iso3}?applicationScope=non-road&powerKw=100&productModelCode=DEMO-ENG-100`
      : `/countries/${coveredCountries[0].iso3}`
    : "/map";
  const coverageRate = metrics.total
    ? Math.round((metrics.covered / metrics.total) * 100)
    : null;
  const latestVerifiedAt =
    state.status === "ready"
      ? state.data.countries
          .map((country) => country.verifiedAt.slice(0, 10))
          .toSorted()
          .at(-1)
      : null;

  return (
    <main className="page-shell py-8 sm:py-12 lg:py-16">
      <section className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
        <div className="max-w-3xl">
          <p className="section-kicker flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-emerald-600" />
            GLOBAL DIESEL INTELLIGENCE
          </p>
          <h1
            aria-label="把全球法规，变成可复核的业务动作。"
            className="display-title mt-7 text-[3.4rem] leading-[1.02] font-semibold tracking-[-0.055em] text-[#142821] text-balance sm:text-[4.8rem] lg:text-[5.6rem]"
          >
            把全球法规，
            <span className="block text-emerald-700">变成可复核的业务动作。</span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-slate-600">
            查法规、验产品、比市场。每个结论都能回到日期、状态与来源。
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-12 rounded-full bg-[#173d31] px-6 text-white shadow-[0_14px_34px_rgb(23_61_49_/_0.2)] hover:bg-[#215142]",
              )}
              href="/map"
            >
              打开全球地图
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Link>
            <Link
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-[#23483b] transition-colors hover:bg-emerald-50"
              href="/chat"
            >
              进入 AI 工作区
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>

        <div className="relative lg:pl-4">
          <div className="absolute -inset-5 -z-10 rounded-[3rem] bg-[#dbe8dd]/70 blur-2xl" />
          <div className="relative overflow-hidden rounded-[2rem] bg-[#12372d] p-6 text-white shadow-[0_34px_80px_rgb(20_55_45_/_0.22)] sm:p-8">
            <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgb(255_255_255_/_0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255_/_0.5)_1px,transparent_1px)] [background-size:64px_64px]" />
            <div className="relative flex items-center justify-between border-b border-white/10 pb-5">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.2em] text-emerald-200/70 uppercase">
                  Live coverage
                </p>
                <p className="display-title mt-1 text-xl font-semibold">全球证据网络</p>
              </div>
              <span className="flex items-center gap-2 text-xs text-emerald-100">
                <span className="size-2 rounded-full bg-[#cce878] shadow-[0_0_0_5px_rgb(204_232_120_/_0.1)]" />
                在线
              </span>
            </div>
            <div className="relative grid gap-8 py-8 sm:grid-cols-[1fr_1.1fr] sm:items-end">
              <div>
                <p className="display-title text-7xl leading-none font-semibold tracking-[-0.06em] text-[#dbf1a2]">
                  {coverageRate === null ? "—" : `${coverageRate}%`}
                </p>
                <p className="mt-3 text-sm text-emerald-100/70">结构化覆盖率</p>
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-1">
                <SignalRow label="国家目录" value={state.status === "ready" ? metrics.total : null} />
                <SignalRow label="结构化覆盖" value={state.status === "ready" ? metrics.covered : null} />
                <SignalRow label="来源在新鲜期" value={state.status === "ready" ? metrics.fresh : null} />
              </div>
            </div>
            <div className="relative flex items-center justify-between border-t border-white/10 pt-5 text-xs text-emerald-100/60">
              <span>最近核验</span>
              <span className="font-medium text-white">{latestVerifiedAt ?? "同步中"}</span>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="覆盖概览" className="mt-14 grid gap-px overflow-hidden rounded-[1.5rem] border border-black/[0.06] bg-black/[0.06] sm:grid-cols-3">
        <MetricCard icon={Globe2} label="国家目录" loading={state.status === "loading"} value={state.status === "ready" ? metrics.total : null} />
        <MetricCard icon={MapIcon} label="结构化覆盖" loading={state.status === "loading"} value={state.status === "ready" ? metrics.covered : null} />
        <MetricCard icon={FileCheck2} label="来源在新鲜期" loading={state.status === "loading"} value={state.status === "ready" ? metrics.fresh : null} />
      </section>

      <section className="py-20 sm:py-24" aria-labelledby="missions-title">
        <div className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
          <div>
            <p className="section-kicker">Three ways in</p>
            <h2 className="display-title mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#142821] sm:text-5xl" id="missions-title">
              直接开始
            </h2>
          </div>
          <p className="max-w-xl text-base leading-7 text-slate-600 lg:justify-self-end">
            从国家、产品或市场任意一端进入，同一套证据结构贯穿判断与交接。
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          <MissionCard
            eyebrow="REGULATORY SCAN"
            href="/map"
            icon={Search}
            index="01"
            title="从国家切入法规边界"
          />
          <MissionCard
            eyebrow="PRODUCT FIT"
            href={productFitHref}
            icon={FileCheck2}
            index="02"
            title="运行确定性产品适配"
          />
          <MissionCard
            eyebrow="MARKET BRIEF"
            href="/chat"
            icon={Bot}
            index="03"
            title="生成有证据的市场简报"
          />
        </div>
      </section>

      <section className="pb-10">
        <div className="surface-panel overflow-hidden rounded-[1.75rem]">
          <div className="flex items-end justify-between gap-4 border-b border-black/[0.06] px-6 py-6 sm:px-8 sm:py-7">
            <div>
              <p className="section-kicker">Selected markets</p>
              <h2 className="display-title mt-2 text-3xl font-semibold tracking-[-0.03em] text-[#142821]">
                代表市场入口
              </h2>
            </div>
            <Link
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-50"
              href="/map"
            >
              全部国家
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>

          {state.status === "loading" ? (
            <div className="flex min-h-56 items-center justify-center text-sm text-slate-500">
              <LoaderCircle
                aria-hidden="true"
                className="mr-2 size-4 animate-spin"
              />
              正在同步国家摘要…
            </div>
          ) : null}
          {state.status === "error" ? (
            <div
              className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:m-7"
              role="alert"
            >
              <p>{state.message}</p>
              <button
                className="mt-3 inline-flex items-center gap-1.5 font-medium underline"
                onClick={loadData}
                type="button"
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
                重试
              </button>
            </div>
          ) : null}
          {state.status === "ready" ? (
            <div className="grid gap-px bg-black/[0.06] sm:grid-cols-2 lg:grid-cols-3">
              {featuredCountries.map((country) => (
                <Link
                  className="group flex min-h-28 items-center gap-4 bg-[#fffefa] px-6 py-5 transition-colors hover:bg-[#f0f6ed]"
                  href={`/countries/${country.iso3}`}
                  key={country.iso3}
                >
                  <span className="display-title grid size-12 shrink-0 place-items-center rounded-full border border-emerald-900/10 bg-[#eef4e9] text-xs font-semibold tracking-[0.08em] text-emerald-900 transition-transform group-hover:scale-105">
                    {country.iso3}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-950">
                      {country.nameEn}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          country.isStale ? "bg-amber-400" : "bg-emerald-500",
                        )}
                      />
                      {country.isDemo
                        ? "Demo fixture"
                        : country.isStale
                          ? "待重新核验"
                          : "来源在新鲜期"}
                    </span>
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-slate-300 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-emerald-700"
                  />
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function SignalRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 py-3">
      <span className="truncate text-[11px] text-emerald-100/60">{label}</span>
      <span className="text-sm font-semibold text-white">
        {value ?? "—"}
      </span>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  loading,
  value,
}: {
  icon: typeof Globe2;
  label: string;
  loading: boolean;
  value: number | null;
}) {
  return (
    <article className="bg-[#fffefa] p-6 sm:p-7">
      <div className="flex items-center gap-4">
        <span className="grid size-10 place-items-center rounded-full bg-[#edf3e8] text-emerald-800">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <p className="flex-1 text-sm font-medium text-slate-600">{label}</p>
        {loading ? (
          <span className="h-8 w-14 animate-pulse rounded-md bg-slate-100" />
        ) : (
          <span className="display-title text-4xl font-semibold tracking-[-0.04em] text-[#17382e]">
            {value ?? "—"}
          </span>
        )}
      </div>
    </article>
  );
}

function MissionCard({
  eyebrow,
  href,
  icon: Icon,
  index,
  title,
}: {
  eyebrow: string;
  href: string;
  icon: typeof MapIcon;
  index: string;
  title: string;
}) {
  return (
    <Link
      className="group relative flex min-h-64 flex-col overflow-hidden rounded-[1.5rem] border border-black/[0.07] bg-[#fffefa] p-7 transition-all duration-300 hover:-translate-y-1 hover:border-emerald-800/30 hover:shadow-[0_24px_60px_rgb(30_71_57_/_0.12)]"
      href={href}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-11 place-items-center rounded-full bg-[#173d31] text-[#dcf39b] transition-transform duration-300 group-hover:scale-105">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className="font-mono text-xs tracking-[0.16em] text-slate-400">
          {index}
        </span>
      </div>
      <p className="mt-8 text-[10px] font-semibold tracking-[0.18em] text-emerald-700">
        {eyebrow}
      </p>
      <h3 className="display-title mt-3 text-3xl leading-tight font-semibold tracking-[-0.035em] text-[#17382e]">
        {title}
      </h3>
      <span className="mt-auto pt-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
        开始任务
        <ArrowRight
          aria-hidden="true"
          className="size-4 transition-transform group-hover:translate-x-1"
        />
      </span>
    </Link>
  );
}
