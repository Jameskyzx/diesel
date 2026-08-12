"use client";

import {
  AlertTriangle,
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
    <main className="mx-auto w-full max-w-[1680px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
      <section className="relative isolate overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#0b1513] text-white shadow-[0_30px_90px_rgb(11_31_26_/_0.22)]">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_18%_12%,rgb(60_121_91_/_0.34),transparent_34%),radial-gradient(circle_at_86%_18%,rgb(184_229_72_/_0.12),transparent_27%),linear-gradient(120deg,#0b1513_0%,#101e1a_52%,#09110f_100%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 opacity-[0.09] [background-image:linear-gradient(rgb(255_255_255_/_0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255_/_0.5)_1px,transparent_1px)] [background-size:52px_52px]"
        />

        <div className="grid min-h-[540px] lg:grid-cols-[1.12fr_0.88fr]">
          <div className="flex flex-col justify-between px-5 py-7 sm:px-8 sm:py-9 lg:px-11 lg:py-11 xl:px-14 xl:py-14">
            <div>
              <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-semibold tracking-[0.18em] text-[#c7ec6b]">
                <span className="inline-flex items-center gap-2 rounded-full border border-[#b8e548]/25 bg-[#b8e548]/8 px-3 py-1.5">
                  <span className="size-1.5 rounded-full bg-[#b8e548] shadow-[0_0_12px_#b8e548]" />
                  GLOBAL DIESEL INTELLIGENCE
                </span>
                <span className="whitespace-nowrap text-slate-400">
                  /&nbsp;&nbsp;FDE PORTFOLIO
                </span>
              </div>

              <h1 className="mt-7 max-w-[760px] text-[2.65rem] leading-[1.05] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-[4.25rem]">
                把全球法规，
                <span className="text-[#c7ec6b]">变成可复核的业务动作。</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
                查法规、验产品、比市场；结论带日期与来源。
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "h-12 rounded-full bg-[#b8e548] px-6 font-semibold text-[#102019] shadow-[0_12px_30px_rgb(184_229_72_/_0.18)] hover:bg-[#caef75]",
                  )}
                  href="/map"
                >
                  打开全球地图
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </Link>
                <Link
                  className={cn(
                    buttonVariants({ size: "lg", variant: "outline" }),
                    "h-12 rounded-full border-white/15 bg-white/5 px-6 text-white shadow-none hover:border-white/30 hover:bg-white/10 hover:text-white",
                  )}
                  href="/chat"
                >
                  <Bot aria-hidden="true" className="size-4" />
                  进入 AI 工作区
                </Link>
              </div>
            </div>

            <div
              className="mt-10 flex max-w-3xl items-start gap-3 border-t border-white/10 pt-5 text-xs leading-5 text-slate-400 sm:text-sm"
              data-testid="usage-boundary"
              role="note"
            >
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-amber-300"
              />
              <p>
                {demoMode
                  ? "虚构作品 Demo，不可用于可售性、报价、认证或法律结论。"
                  : "用于内部复核，不替代正式认证、法律意见或销售承诺。"}
              </p>
            </div>
          </div>

          <div className="relative hidden items-center border-l border-white/10 bg-black/10 p-10 lg:flex">
            <div className="relative mx-auto w-full max-w-[560px] overflow-hidden rounded-[1.35rem] border border-white/12 bg-[#101c19]/88 p-5 shadow-[0_25px_60px_rgb(0_0_0_/_0.28)] backdrop-blur sm:p-6">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <p className="text-[10px] font-semibold tracking-[0.2em] text-slate-500">
                    LIVE EVIDENCE SURFACE
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    全球证据网络
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/8 px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-emerald-200">
                  <span className="size-1.5 rounded-full bg-emerald-300" />
                  OPERATIONAL
                </span>
              </div>

              <div className="grid gap-5 py-6 sm:grid-cols-[1fr_0.92fr] sm:items-center">
                <div className="relative mx-auto grid aspect-square w-full max-w-[230px] place-items-center">
                  <div className="absolute inset-[7%] rounded-full border border-[#b8e548]/15" />
                  <div className="absolute inset-[20%] rounded-full border border-dashed border-white/15" />
                  <div className="absolute top-[13%] left-[22%] size-2 rounded-full bg-[#b8e548] shadow-[0_0_16px_#b8e548]" />
                  <div className="absolute right-[15%] bottom-[29%] size-1.5 rounded-full bg-sky-300 shadow-[0_0_12px_#7dd3fc]" />
                  <div className="absolute bottom-[12%] left-[33%] size-1.5 rounded-full bg-amber-300 shadow-[0_0_12px_#fcd34d]" />
                  <div className="grid size-[54%] place-items-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_35%_30%,#244d3c,#10241e_56%,#0b1714)] shadow-[0_0_55px_rgb(82_144_110_/_0.23)]">
                    <div className="text-center">
                      <Globe2
                        aria-hidden="true"
                        className="mx-auto size-7 text-[#c7ec6b]"
                      />
                      <p className="mt-2 text-3xl font-semibold tracking-tight">
                        {coverageRate === null ? "—" : `${coverageRate}%`}
                      </p>
                      <p className="mt-1 text-[9px] tracking-[0.16em] text-slate-400">
                        STRUCTURED
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <SignalRow
                    label="国家目录"
                    value={state.status === "ready" ? metrics.total : null}
                  />
                  <SignalRow
                    label="结构化覆盖"
                    value={state.status === "ready" ? metrics.covered : null}
                  />
                  <SignalRow
                    label="来源在新鲜期"
                    value={state.status === "ready" ? metrics.fresh : null}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-4 text-xs">
                <span className="text-slate-500">最近核验</span>
                <span className="font-medium text-slate-200">
                  {latestVerifiedAt ?? "同步中"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-label="覆盖概览"
        className="mt-5 grid overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_35px_rgb(24_55_45_/_0.055)] sm:grid-cols-3"
      >
        <MetricCard
          icon={Globe2}
          label="国家目录"
          loading={state.status === "loading"}
          value={state.status === "ready" ? metrics.total : null}
        />
        <MetricCard
          icon={MapIcon}
          label="结构化覆盖"
          loading={state.status === "loading"}
          value={state.status === "ready" ? metrics.covered : null}
        />
        <MetricCard
          icon={FileCheck2}
          label="来源在新鲜期"
          loading={state.status === "loading"}
          value={state.status === "ready" ? metrics.fresh : null}
        />
      </section>

      <section className="py-12 sm:py-14 lg:py-16" aria-labelledby="missions-title">
        <h2
          className="text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl"
          id="missions-title"
        >
          直接开始
        </h2>

        <div className="mt-7 grid gap-4 lg:grid-cols-3">
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

      <section className="pb-8">
        <div className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-[0_14px_40px_rgb(24_55_45_/_0.06)]">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7 sm:py-6">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-500">
                COVERAGE RADAR
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                代表市场入口
              </h2>
            </div>
            <Link
              className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-900"
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
            <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
              {featuredCountries.map((country) => (
                <Link
                  className="group flex min-h-24 items-center gap-4 bg-white px-5 py-4 transition-colors hover:bg-emerald-50/60 sm:px-7"
                  href={`/countries/${country.iso3}`}
                  key={country.iso3}
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold tracking-[0.08em] text-slate-700 transition-colors group-hover:border-emerald-300 group-hover:bg-white group-hover:text-emerald-800">
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2.5">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="font-mono text-sm font-semibold text-white">
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
    <article className="relative border-b border-slate-100 p-5 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0 xl:p-6">
      <div className="flex items-center gap-4">
        <span className="grid size-9 place-items-center rounded-full bg-emerald-50 text-emerald-800">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <p className="flex-1 text-sm font-medium text-slate-700">{label}</p>
        {loading ? (
          <span className="h-8 w-14 animate-pulse rounded-md bg-slate-100" />
        ) : (
          <span className="text-3xl font-semibold tracking-[-0.04em] text-slate-950">
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
      className="group relative flex min-h-56 flex-col overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white p-6 shadow-[0_12px_34px_rgb(24_55_45_/_0.055)] transition-all duration-300 hover:-translate-y-1 hover:border-emerald-300 hover:shadow-[0_22px_55px_rgb(24_82_59_/_0.12)] sm:p-7"
      href={href}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-11 place-items-center rounded-full bg-[#10201c] text-[#c7ec6b] transition-transform duration-300 group-hover:scale-105">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className="font-mono text-xs tracking-[0.16em] text-slate-400">
          {index}
        </span>
      </div>
      <p className="mt-7 text-[10px] font-semibold tracking-[0.18em] text-emerald-700">
        {eyebrow}
      </p>
      <h3 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-slate-950">
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
