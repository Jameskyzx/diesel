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
import { PageHeader } from "@/components/layout/page-header";
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
  const [countrySearch, setCountrySearch] = useState("");
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

  const searchQuery = countrySearch.trim().toLocaleLowerCase(locale);
  const featuredCountries = searchQuery
    ? evidenceReviewedCountries.filter((country) =>
        [country.iso3, country.nameEn, formatCountryDisplayName(country, locale)]
          .some((value) => value.toLocaleLowerCase(locale).includes(searchQuery)),
      )
    : evidenceReviewedCountries.slice(0, 6);
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
    <main className="page-shell py-6" data-testid="home-workspace">
      <PageHeader
        kicker={dictionary.workspace.overview}
        title={<>{copy.heroLine1} {copy.heroLine2}</>}
        titleLabel={copy.heroAria}
        description={copy.audience}
        actions={<>
          <Link className={cn(buttonVariants({ variant: "outline" }), "gap-2 bg-card")} href="/chat">
            {copy.enterAi}<ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link className={cn(buttonVariants(), "gap-2")} href="/map">
            {copy.openMap}<ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </>}
      />

      <section aria-label={copy.coverageAria} className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard icon={Globe2} label={copy.catalog} loading={state.status === "loading"} value={state.status === "ready" ? metrics.total : null} />
        <MetricCard icon={MapIcon} label={reviewedLabel} loading={state.status === "loading"} value={state.status === "ready" ? metrics.evidenceReviewed : null} />
        <MetricCard icon={FileCheck2} label={freshLabel} loading={state.status === "loading"} value={state.status === "ready" ? metrics.evidenceReviewFresh : null} />
        <MetricCard icon={Search} label={demoMode ? dictionary.workspace.unreviewedDemo : dictionary.workspace.unreviewed} loading={state.status === "loading"} value={state.status === "ready" ? metrics.total - metrics.evidenceReviewed : null} />
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="surface-panel min-w-0 overflow-hidden rounded-md" data-testid="country-evidence-table">
          <div className="workspace-card-header">
            <div>
              <h2 className="text-base font-semibold">{copy.selectedMarkets}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{copy.selectedMarketsKicker}</p>
            </div>
            <Link className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" href="/map">
              {copy.allCountries}<ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
          <div className="border-b px-5 py-3">
            <label className="relative flex items-center gap-2 rounded-md border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="sr-only">{dictionary.workspace.searchCountries}</span>
              <input className="h-9 w-full min-w-0 bg-transparent text-sm outline-none" onChange={(event) => setCountrySearch(event.target.value)} placeholder={dictionary.workspace.searchCountries} type="search" value={countrySearch} />
            </label>
          </div>
          {state.status === "loading" ? (
            <div aria-busy="true" aria-live="polite" className="flex min-h-60 items-center justify-center text-sm text-muted-foreground" role="status">
              <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin" />{copy.syncingCountries}
            </div>
          ) : null}
          {state.status === "error" ? (
            <div className="m-5 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
              <p>{copy.errorCountries}</p>
              <button className="mt-3 inline-flex items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 font-medium" onClick={loadData} type="button">
                <RefreshCw aria-hidden="true" className="size-3.5" />{dictionary.common.retry}
              </button>
            </div>
          ) : null}
          {state.status === "ready" && evidenceReviewedCountries.length === 0 ? (
            <div className="m-5 rounded-md border border-dashed bg-muted/40 p-6 text-center" role="status">
              <p className="font-semibold">{copy.emptyCountriesTitle}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.emptyCountriesBody}</p>
              <Link className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline" href="/map">{copy.openCatalog}<ArrowRight aria-hidden="true" className="size-4" /></Link>
            </div>
          ) : null}
          {state.status === "ready" && evidenceReviewedCountries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="workspace-table w-full" role="table">
                <caption className="sr-only">{copy.featuredAria}</caption>
                <thead><tr role="row">
                  <th scope="col">{dictionary.workspace.country}</th>
                  <th scope="col">{dictionary.workspace.reviewStatus}</th>
                  <th scope="col">{dictionary.workspace.verifiedAt}</th>
                </tr></thead>
                <tbody>
                  {featuredCountries.map((country) => (
                    <tr key={country.iso3} role="row">
                      <td role="cell">
                        <Link className="group flex items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" href={"/countries/" + country.iso3}>
                          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent font-mono text-[11px] font-semibold text-accent-foreground">{country.iso3}</span>
                          <span className="font-medium group-hover:text-primary">{formatCountryDisplayName(country, locale)}</span>
                          <ArrowUpRight aria-hidden="true" className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                        </Link>
                      </td>
                      <td role="cell"><EvidenceBadge country={country} /></td>
                      <td className="whitespace-nowrap text-muted-foreground" role="cell">{formatUtcDate(country.verifiedAt, locale)}</td>
                    </tr>
                  ))}
                  {featuredCountries.length === 0 ? <tr><td colSpan={3}>
                    <p role="status" className="py-6 text-center text-muted-foreground">{dictionary.workspace.noSearchResults}</p>
                    <button className="mx-auto block text-sm font-medium text-primary hover:underline" onClick={() => setCountrySearch("")} type="button">{dictionary.workspace.clearSearch}</button>
                  </td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="border-t bg-muted/30 px-5 py-3 text-xs leading-5 text-muted-foreground">{copy.description}</p>
        </section>

        <div className="space-y-6">
          <section className="surface-panel overflow-hidden rounded-md">
            <div className="workspace-card-header">
              <h2 className="text-sm font-semibold">{coverageTitle}</h2>
              <span className={cn("inline-flex items-center gap-1.5 text-xs", state.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                <span aria-hidden="true" className={cn("size-1.5 rounded-full", state.status === "ready" ? "bg-emerald-600" : state.status === "error" ? "bg-destructive" : "animate-pulse bg-slate-400")} />
                {state.status === "ready" ? copy.online : state.status === "error" ? copy.offline : copy.syncing}
              </span>
            </div>
            <div className="p-5">
              <p className="section-kicker">{coverageKicker}</p>
              <p className="mt-3 text-4xl font-semibold tabular-nums tracking-tight">{evidenceReviewRate === null ? "—" : evidenceReviewRate + "%"}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground" data-screenshot-label>{coverageRateLabel}</p>
              <div className="mt-3">{evidenceReviewRate !== null ? <progress aria-label={coverageRateLabel} className="evidence-progress" max={100} value={evidenceReviewRate} /> : <div aria-hidden="true" className="h-1.5 rounded-full bg-muted" />}</div>
              <p className="mt-4 text-xs leading-5 text-muted-foreground">{coverageExplanation}</p>
              <dl className="mt-4 border-t pt-3 text-xs"><dt className="text-muted-foreground">{copy.latestVerification}</dt><dd className="mt-1 font-medium">{latestVerificationLabel}</dd></dl>
            </div>
          </section>
          <section className="surface-panel overflow-hidden rounded-md" aria-labelledby="missions-title">
            <div className="workspace-card-header">
              <h2 className="text-sm font-semibold" id="missions-title">{copy.directStart}</h2>
              <span className="text-xs text-muted-foreground">{copy.threeWays}</span>
            </div>
            <MissionRow href="/map" icon={Search} title={copy.missionRegulation} label={copy.missionRegulationEyebrow} />
            <MissionRow href={productFitHref} icon={FileCheck2} title={copy.missionProduct} label={copy.missionProductEyebrow} />
            <MissionRow href="/chat" icon={Bot} title={copy.missionMarket} label={copy.missionMarketEyebrow} />
          </section>
        </div>
      </div>
    </main>
  );
}

function MetricCard({ icon: Icon, label, loading, value }: {
  icon: typeof Globe2;
  label: string;
  loading: boolean;
  value: number | null;
}) {
  return (
    <article className="surface-panel flex flex-col items-start gap-3 rounded-md p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-primary sm:size-12"><Icon aria-hidden="true" className="size-5 sm:size-6" /></span>
      <div className="min-w-0">
        {loading ? <span aria-label={label} className="block h-7 w-12 animate-pulse rounded bg-muted" /> : <p className="text-2xl font-semibold tabular-nums">{value ?? "—"}</p>}
        <p className="mt-1 text-xs leading-5 text-muted-foreground" data-screenshot-label>{label}</p>
      </div>
    </article>
  );
}

function EvidenceBadge({ country }: { country: CountryMapResponse["countries"][number] }) {
  const { dictionary } = useLocale();
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium", country.isDemo ? "bg-blue-50 text-blue-800" : country.isStale ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800")}>
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", country.isDemo ? "bg-blue-600" : country.isStale ? "bg-amber-600" : "bg-emerald-600")} />
      {country.isDemo ? dictionary.home.demoFixture : country.isStale ? dictionary.home.pendingReview : dictionary.home.freshSource}
    </span>
  );
}

function MissionRow({ href, icon: Icon, label, title }: { href: string; icon: typeof Globe2; label: string; title: string }) {
  return (
    <Link className="flex items-center gap-3 border-t px-5 py-4 outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" href={href}>
      <Icon aria-hidden="true" className="size-5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold text-muted-foreground">{label}</span><span className="mt-1 block text-sm leading-5">{title}</span></span>
      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
