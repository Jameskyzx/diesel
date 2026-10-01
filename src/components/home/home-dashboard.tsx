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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  countryMapResponseSchema,
  type CountryMapResponse,
} from "@/features/countries/schemas";
import { hasDetailedCountryCoverage } from "@/features/database/schemas";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { formatUtcDate } from "@/i18n/date";
import { createPublicApiRequestDeadline } from "@/lib/public-api-request";
import { cn } from "@/lib/utils";

type DashboardState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: CountryMapResponse };

type DashboardMetrics = {
  evidenceReviewed: number;
  evidenceReviewFresh: number;
  total: number;
};

const initialState: DashboardState = { status: "loading" };

const emptyMetrics: DashboardMetrics = {
  evidenceReviewed: 0,
  evidenceReviewFresh: 0,
  total: 0,
};

const featuredCountryOrder = new Map(
  ["CHN", "USA", "DEU", "IND", "BRA", "JPN"].map((iso3, index) => [
    iso3,
    index,
  ]),
);

export function HomeDashboard({ demoMode }: { demoMode: boolean }) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.home;
  const [state, setState] = useState<DashboardState>(initialState);
  const requestAbortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const requestData = useCallback(() => {
    requestAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestAbortControllerRef.current = abortController;
    requestIdRef.current = requestId;
    const deadline = createPublicApiRequestDeadline(abortController.signal);

    void fetch("/api/countries", {
      headers: { accept: "application/json" },
      signal: deadline.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Country coverage request failed.");
        return countryMapResponseSchema.parse(await response.json());
      })
      .then((data) => {
        if (
          abortController.signal.aborted ||
          requestId !== requestIdRef.current
        ) {
          return;
        }
        setState({ data, status: "ready" });
      })
      .catch(() => {
        if (
          abortController.signal.aborted ||
          requestId !== requestIdRef.current
        ) {
          return;
        }
        setState({ status: "error" });
      })
      .finally(() => {
        deadline.dispose();
        if (requestAbortControllerRef.current === abortController) {
          requestAbortControllerRef.current = null;
        }
      });
  }, []);

  const loadData = useCallback(() => {
    setState(initialState);
    requestData();
  }, [requestData]);

  useEffect(() => {
    requestData();
    return () => {
      requestIdRef.current += 1;
      requestAbortControllerRef.current?.abort();
      requestAbortControllerRef.current = null;
    };
  }, [locale, requestData]);

  const metrics = useMemo<DashboardMetrics>(() => {
    if (state.status !== "ready") return emptyMetrics;

    return state.data.countries.reduce<DashboardMetrics>(
      (result, country) => {
        result.total += 1;
        if (hasDetailedCountryCoverage(country.dataCoverageStatus)) {
          result.evidenceReviewed += 1;
          if (!country.isStale) result.evidenceReviewFresh += 1;
        }
        return result;
      },
      { ...emptyMetrics },
    );
  }, [state]);

  const evidenceReviewedCountries = useMemo(() => {
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

  const featuredCountries = evidenceReviewedCountries.slice(0, 6);
  const productFitHref = evidenceReviewedCountries[0]
    ? demoMode
      ? `/countries/${evidenceReviewedCountries[0].iso3}?applicationScope=non-road&powerKw=100&productModelCode=DEMO-ENG-100`
      : `/countries/${evidenceReviewedCountries[0].iso3}`
    : "/map";
  const evidenceReviewRate = metrics.total
    ? Math.round((metrics.evidenceReviewed / metrics.total) * 100)
    : null;
  const latestVerifiedAt =
    state.status === "ready"
      ? state.data.countries
          .map((country) => country.verifiedAt)
          .toSorted()
          .at(-1)
      : null;
  const coverageKicker = demoMode
    ? copy.coverageDemoKicker
    : copy.coverageKicker;
  const coverageTitle = demoMode
    ? copy.coverageDemoTitle
    : copy.coverageTitle;
  const coverageRateLabel = demoMode
    ? copy.coverageDemoRate
    : copy.coverageRate;
  const reviewedLabel = demoMode ? copy.reviewedDemo : copy.reviewed;
  const freshLabel = demoMode ? copy.freshDemo : copy.fresh;
  const latestVerificationLabel =
    state.status === "ready"
      ? latestVerifiedAt
        ? formatUtcDate(latestVerifiedAt, locale)
        : copy.noVerification
      : state.status === "error"
        ? copy.noVerification
        : copy.syncing;
  const coverageExplanation = demoMode
    ? copy.coverageDemoExplanation
    : copy.coverageExplanation;

  return (
    <main className="page-shell space-y-6 py-6 sm:py-7" data-testid="home-workspace">
      <section className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
        <div className="max-w-2xl">
          <p className="section-kicker">{copy.audience}</p>
          <h1 aria-label={copy.heroAria} className="mt-2 text-2xl leading-tight font-semibold tracking-tight text-foreground sm:text-3xl">
            {copy.heroLine1}<br className="hidden sm:block" />{" "}{copy.heroLine2}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{copy.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={cn(buttonVariants({ size: "lg" }), "gap-2")} href="/map">
            {copy.openMap}<ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
          <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }), "gap-2 bg-card")} href="/chat">
            {copy.enterAi}<ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </section>

      <section aria-label={copy.coverageAria} className="grid gap-4 md:grid-cols-3">
        <MetricCard icon={Globe2} label={copy.catalog} loading={state.status === "loading"} value={state.status === "ready" ? metrics.total : null} />
        <MetricCard icon={MapIcon} label={reviewedLabel} loading={state.status === "loading"} value={state.status === "ready" ? metrics.evidenceReviewed : null} />
        <MetricCard icon={FileCheck2} label={freshLabel} loading={state.status === "loading"} value={state.status === "ready" ? metrics.evidenceReviewFresh : null} />
      </section>

      <section className="surface-panel grid gap-6 rounded-md p-5 sm:p-6 xl:grid-cols-[1fr_1fr] xl:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="section-kicker">{coverageKicker}</p>
            <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", state.status === "error" ? "text-destructive" : "text-muted-foreground")}>
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", state.status === "ready" ? "bg-emerald-600" : state.status === "error" ? "bg-destructive" : "animate-pulse bg-slate-400")} />
              {state.status === "ready" ? copy.online : state.status === "error" ? copy.offline : copy.syncing}
            </span>
          </div>
          <h2 className="mt-2 text-base font-semibold">{coverageTitle}</h2>
          <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">{coverageExplanation}</p>
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <span className="text-sm text-muted-foreground" data-screenshot-label>{coverageRateLabel}</span>
            <span className="text-2xl font-semibold tabular-nums tracking-tight">{evidenceReviewRate === null ? "—" : evidenceReviewRate + "%"}</span>
          </div>
          {evidenceReviewRate !== null ? (
            <progress aria-label={coverageRateLabel} className="evidence-progress" max={100} value={evidenceReviewRate} />
          ) : <div aria-hidden="true" className="h-1.5 rounded-full bg-muted" />}
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <span>{copy.latestVerification}</span>
            <span>{latestVerificationLabel}</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="missions-title">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-kicker">{copy.threeWays}</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight" id="missions-title">{copy.directStart}</h2>
          </div>
          <p className="max-w-lg text-xs leading-5 text-muted-foreground">{copy.missionDescription}</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <MissionCard eyebrow={copy.missionRegulationEyebrow} href="/map" icon={Search} index="01" startLabel={copy.missionStart} title={copy.missionRegulation} />
          <MissionCard eyebrow={copy.missionProductEyebrow} href={productFitHref} icon={FileCheck2} index="02" startLabel={copy.missionStart} title={copy.missionProduct} />
          <MissionCard eyebrow={copy.missionMarketEyebrow} href="/chat" icon={Bot} index="03" startLabel={copy.missionStart} title={copy.missionMarket} />
        </div>
      </section>

      <section className="surface-panel overflow-hidden rounded-md">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-5 sm:px-6">
          <div>
            <p className="section-kicker">{copy.selectedMarketsKicker}</p>
            <h2 className="mt-1.5 text-lg font-semibold tracking-tight">{copy.selectedMarkets}</h2>
          </div>
          <Link className="inline-flex items-center gap-2 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline" href="/map">
            {copy.allCountries}<ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        {state.status === "loading" ? (
          <div aria-busy="true" aria-live="polite" className="flex min-h-40 items-center justify-center text-sm text-muted-foreground" role="status">
            <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />{copy.syncingCountries}
          </div>
        ) : null}
        {state.status === "error" ? (
          <div className="m-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
            <p>{copy.errorCountries}</p>
            <button className="mt-3 inline-flex items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 font-medium" onClick={loadData} type="button">
              <RefreshCw aria-hidden="true" className="size-3.5" />{dictionary.common.retry}
            </button>
          </div>
        ) : null}
        {state.status === "ready" && featuredCountries.length === 0 ? (
          <div className="m-5 rounded-lg border border-dashed bg-muted/40 p-6 text-center" role="status">
            <p className="font-semibold">{copy.emptyCountriesTitle}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.emptyCountriesBody}</p>
            <Link className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline" href="/map">
              {copy.openCatalog}<ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        ) : null}
        {state.status === "ready" && featuredCountries.length > 0 ? (
          <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
            {featuredCountries.map((country) => (
              <Link className="group flex min-h-24 items-center gap-3 bg-card px-5 py-4 transition-colors hover:bg-accent/40 sm:px-6" href={"/countries/" + country.iso3} key={country.iso3}>
                <span className="grid size-10 shrink-0 place-items-center rounded-lg border bg-muted/50 font-mono text-xs font-medium text-muted-foreground">{country.iso3}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{formatCountryDisplayName(country, locale)}</span>
                  <span className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden="true" className={cn("mt-1 size-1.5 shrink-0 rounded-full", country.isStale ? "bg-amber-500" : "bg-emerald-600")} />
                    {country.isDemo ? copy.demoFixture : country.isStale ? copy.pendingReview : copy.freshSource}
                  </span>
                </span>
                <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </main>
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
    <article className="surface-panel relative rounded-md border-t-2 border-t-primary/60 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-md bg-accent text-primary">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-xs leading-5 font-medium text-muted-foreground" data-screenshot-label>{label}</p>
      </div>
      <div className="mt-4">
        {loading ? (
          <span className="block h-8 w-14 animate-pulse rounded-md bg-slate-100" />
        ) : (
          <span className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
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
  startLabel,
  title,
}: {
  eyebrow: string;
  href: string;
  icon: typeof MapIcon;
  index: string;
  startLabel: string;
  title: string;
}) {
  return (
    <Link
      className="group flex flex-col rounded-md border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={href}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-9 place-items-center rounded-md border bg-muted/60 text-primary">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className="font-mono text-xs tracking-[0.16em] text-slate-600">
          {index}
        </span>
      </div>
      <p className="mt-4 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">
        {eyebrow}
      </p>
      <h3 className="mt-2 text-base leading-6 font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      <span className="mt-auto inline-flex items-center gap-2 pt-5 text-xs font-medium text-primary">
        {startLabel}
        <ArrowRight
          aria-hidden="true"
          className="size-4 transition-transform group-hover:translate-x-1"
        />
      </span>
    </Link>
  );
}
