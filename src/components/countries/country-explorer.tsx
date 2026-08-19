"use client";

import { Database, Globe2, LoaderCircle, RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  countryMapResponseSchema,
  type CountryDetailResponse,
  type CountryDirectory,
  type CountryMapResponse,
  type CountryMapSummary,
} from "@/features/countries/schemas";
import { selectCountryShortcuts } from "@/features/countries/country-shortcuts";
import { parseApiErrorMessage, toUserFacingErrorMessage } from "@/lib/api-error";
import type { ProductFitInitialFilters } from "@/components/products/product-fit-panel";
import { interpolate } from "@/i18n/dictionaries";
import { formatCountryDisplayName } from "@/i18n/country-name";

type ExplorerData =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      countryIndex: CountryDirectory;
      countries: CountryMapSummary[];
      status: "ready";
    };

type CountryExplorerProps = {
  initialCountryDetail?: CountryDetailResponse;
  initialCountryIso3?: string;
  initialCountryIndex: CountryDirectory;
  initialCountryPanel?: ReactNode;
  initialFilters?: ProductFitInitialFilters;
  initialMapResponse?: CountryMapResponse;
};

const emptyCountrySummaries: CountryMapSummary[] = [];
const restoreCountrySelectFocusKey =
  "diesel:restore-country-select-focus";
const countryFocusTargetKey = "diesel:country-focus-target";

function MapModuleLoading() {
  const { dictionary } = useLocale();
  return (
    <div
      className="grid h-full min-h-[30rem] place-items-center rounded-[1.75rem] border border-black/[0.06] bg-[#edf3ef]"
      data-testid="map-module-loading"
      role="status"
    >
      <div className="text-center">
        <LoaderCircle
          aria-hidden="true"
          className="mx-auto size-8 animate-spin text-primary"
        />
        <p className="mt-3 text-sm text-muted-foreground">
          {dictionary.map.initializing}
        </p>
      </div>
    </div>
  );
}

const WorldMap = dynamic(
  async () => {
    const mapModule = await import("@/components/map/world-map");
    return mapModule.WorldMap;
  },
  {
    loading: MapModuleLoading,
    ssr: false,
  },
);

function CountryDrawerLoading() {
  const { dictionary } = useLocale();
  return (
    <aside
      aria-busy="true"
      aria-live="polite"
      className="fixed inset-y-0 right-0 z-50 grid h-dvh w-[min(94vw,34rem)] place-items-center border-l bg-background p-6 shadow-2xl"
      role="status"
    >
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle
          aria-hidden="true"
          className="size-4 animate-spin motion-reduce:animate-none"
        />
        {dictionary.map.loadingDetails}
      </span>
    </aside>
  );
}

const CountryDetailDrawer = dynamic(
  async () => {
    const drawerModule = await import(
      "@/components/countries/country-detail-drawer"
    );
    return drawerModule.CountryDetailDrawer;
  },
  { loading: CountryDrawerLoading },
);

export function CountryExplorer({
  initialCountryDetail,
  initialCountryIso3,
  initialCountryIndex,
  initialCountryPanel,
  initialFilters,
  initialMapResponse,
}: CountryExplorerProps) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.map;
  const router = useRouter();
  const [data, setData] = useState<ExplorerData>(() =>
    initialMapResponse
      ? {
          countries: initialMapResponse.countries,
          countryIndex: initialCountryIndex,
          status: "ready",
        }
      : { status: "loading" },
  );
  const [reloadKey, setReloadKey] = useState(0);
  const cancelPendingProductEvaluationRef = useRef<(() => void) | null>(null);
  const selectedIso3 = initialCountryIso3 ?? null;

  const cancelPendingProductEvaluation = useCallback(() => {
    cancelPendingProductEvaluationRef.current?.();
  }, []);

  const registerProductFitNavigationGuard = useCallback(
    (cancelPendingEvaluation: (() => void) | null) => {
      cancelPendingProductEvaluationRef.current = cancelPendingEvaluation;
    },
    [],
  );

  useEffect(() => {
    if (initialMapResponse && reloadKey === 0) {
      return;
    }

    const abortController = new AbortController();

    void fetch("/api/countries", {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await parseApiErrorMessage(response, copy.errorRequest),
          );
        }
        return countryMapResponseSchema.parse(await response.json());
      })
      .then((mapResponse) => {
        setData({
          countries: mapResponse.countries,
          countryIndex: initialCountryIndex,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setData({
          message: toUserFacingErrorMessage(
            error,
            copy.errorFallback,
          ),
          status: "error",
        });
      });

    return () => abortController.abort();
  }, [copy.errorFallback, copy.errorRequest, initialCountryIndex, initialMapResponse, reloadKey]);

  const selectCountry = useCallback(
    (iso3: string) => {
      cancelPendingProductEvaluation();
      const activeElement = document.activeElement;
      const focusTarget =
        activeElement instanceof HTMLElement && activeElement.id
          ? activeElement.id
          : "country-select";
      sessionStorage.setItem(countryFocusTargetKey, focusTarget);
      router.push(`/countries/${iso3}`);
    },
    [cancelPendingProductEvaluation, router],
  );

  const closeCountry = useCallback(() => {
    cancelPendingProductEvaluation();
    sessionStorage.setItem(restoreCountrySelectFocusKey, "true");
    router.push("/map");
  }, [cancelPendingProductEvaluation, router]);

  const countryIndex =
    data.status === "ready" ? data.countryIndex : initialCountryIndex;
  const countries =
    data.status === "ready" ? data.countries : emptyCountrySummaries;
  const selectedDirectoryEntry = countryIndex.find(
    ({ iso3 }) => iso3 === selectedIso3,
  );
  const selectedName = selectedDirectoryEntry
    ? formatCountryDisplayName(
        {
          iso2: selectedDirectoryEntry.iso2,
          iso3: selectedDirectoryEntry.iso3,
          nameEn: selectedDirectoryEntry.name,
        },
        locale,
      )
    : selectedIso3;
  const countryDetailContextAsOf =
    initialCountryDetail?.status === "available"
      ? initialCountryDetail.asOf
      : (initialFilters?.asOf ?? "current");
  const countryShortcuts = selectCountryShortcuts(countries);

  useEffect(() => {
    if (selectedIso3 !== null || data.status !== "ready") {
      return;
    }
    if (sessionStorage.getItem(restoreCountrySelectFocusKey) !== "true") {
      return;
    }

    sessionStorage.removeItem(restoreCountrySelectFocusKey);
    const focusTarget =
      sessionStorage.getItem(countryFocusTargetKey) ?? "country-select";
    sessionStorage.removeItem(countryFocusTargetKey);
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(focusTarget);
      (target ?? document.getElementById("country-select"))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [data.status, selectedIso3]);

  return (
    <main className="page-shell py-8 sm:py-10">
      <section className="mb-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div>
          <div className="section-kicker flex items-center gap-2">
            <Globe2 aria-hidden="true" className="size-4" />
            {copy.kicker}
          </div>
          <h1 className="display-title mt-4 text-4xl font-semibold tracking-[-0.045em] text-[#142821] sm:text-5xl lg:text-6xl">
            {copy.heading}
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
            {copy.description}
          </p>
        </div>

        <div className="surface-panel grid min-w-72 gap-2 rounded-[1.25rem] p-4">
          <label
            className="text-[11px] font-semibold tracking-[0.12em] text-emerald-800 uppercase"
            htmlFor="country-select"
          >
            {copy.quickSelect}
          </label>
          <select
            aria-label={copy.countrySelect}
            className="h-12 rounded-xl border border-black/[0.08] bg-[#f7f8f3] px-3 text-sm font-medium text-[#17382e] shadow-none outline-none focus-visible:ring-[3px] focus-visible:ring-emerald-700/20"
            disabled={data.status !== "ready"}
            id="country-select"
            onChange={(event) => {
              if (event.target.value) {
                selectCountry(event.target.value);
              }
            }}
            value={selectedIso3 ?? ""}
          >
            <option value="">{copy.optionPlaceholder}</option>
            {countryIndex.map((country) => (
              <option key={country.iso3} value={country.iso3}>
                {formatCountryDisplayName(
                  {
                    iso2: country.iso2,
                    iso3: country.iso3,
                    nameEn: country.name,
                  },
                  locale,
                )} · {country.iso3}
                {country.hasGeometry ? "" : ` · ${copy.boundaryMissingOption}`}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section
        aria-label={copy.featuredAria}
        className="mb-5 flex min-h-10 items-center gap-2 overflow-x-auto pb-1"
      >
        <span className="mr-1 inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-emerald-900/65">
          <Database aria-hidden="true" className="size-3.5" />
          {copy.featuredLabel}
        </span>
        {countryShortcuts.map((country) => (
            <Button
              aria-pressed={selectedIso3 === country.iso3}
              id={`country-shortcut-${country.iso3}`}
              key={country.iso3}
              onClick={() => selectCountry(country.iso3)}
              size="sm"
              variant={selectedIso3 === country.iso3 ? "default" : "outline"}
              className={
                selectedIso3 === country.iso3
                  ? "rounded-full bg-[#173d31] px-4 text-white"
                  : "rounded-full border-black/[0.07] bg-white/75 px-4 text-slate-600 hover:bg-emerald-50 hover:text-emerald-900"
              }
            >
              {formatCountryDisplayName(country, locale)} · {country.iso3}
            </Button>
          ))}
        {countries.length > 0 && countryShortcuts.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {copy.noDetailedCountries}
          </span>
        ) : null}
      </section>

      <section className="min-h-[30rem] lg:h-[calc(100dvh-18rem)] lg:min-h-[34rem]">
        {data.status === "loading" ? (
          <div className="grid h-full min-h-[30rem] place-items-center rounded-[1.75rem] border border-black/[0.06] bg-white/85 shadow-[0_24px_70px_rgb(29_56_47_/_0.08)]">
            <div className="text-center">
              <LoaderCircle
                aria-hidden="true"
                className="mx-auto size-8 animate-spin text-primary"
              />
              <p className="mt-3 text-sm text-muted-foreground">
                {copy.loading}
              </p>
            </div>
          </div>
        ) : null}

        {data.status === "error" ? (
          <div
            className="grid h-full min-h-[30rem] place-items-center rounded-[1.75rem] border border-destructive/25 bg-card p-6 text-center"
            role="alert"
          >
            <div>
              <p className="font-semibold">{copy.loadErrorTitle}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {data.message}
              </p>
              <Button
                className="mt-4"
                onClick={() => {
                  setData({ status: "loading" });
                  setReloadKey((key) => key + 1);
                }}
                variant="outline"
              >
                <RotateCcw aria-hidden="true" className="size-4" />
                {copy.retryMap}
              </Button>
            </div>
          </div>
        ) : null}

        {data.status === "ready" ? (
          <WorldMap
            countries={data.countries}
            onSelectCountry={selectCountry}
            selectedIso3={selectedIso3}
          />
        ) : null}
      </section>

      <p className="mt-4 px-1 text-[11px] text-muted-foreground">
        {copy.boundaryAttribution}
        {selectedName
          ? ` ${interpolate(copy.currentSelection, { name: selectedName })}`
          : ""}
        {selectedDirectoryEntry && !selectedDirectoryEntry.hasGeometry
          ? ` ${copy.boundaryMissingSelection}`
          : ""}
      </p>

      {selectedIso3 ? (
        <CountryDetailDrawer
          cancelPendingProductEvaluation={cancelPendingProductEvaluation}
          countryIndex={countryIndex}
          initialFilters={initialFilters}
          initialResponse={initialCountryDetail}
          iso3={selectedIso3}
          key={`${selectedIso3}:${countryDetailContextAsOf}`}
          onClose={closeCountry}
          onSelectCountry={selectCountry}
          registerProductFitNavigationGuard={
            registerProductFitNavigationGuard
          }
        />
      ) : null}

      {selectedIso3 && initialCountryPanel ? (
        <aside
          aria-label={copy.serverSnapshotAria}
          className="country-server-fallback fixed inset-y-0 right-0 z-40 h-dvh w-[min(94vw,34rem)] overflow-y-auto border-l bg-background shadow-2xl"
          data-testid="country-server-initial"
          role="region"
        >
          {initialCountryPanel}
        </aside>
      ) : null}
    </main>
  );
}
