"use client";

import { Database, Globe2, LoaderCircle, RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { CountryDetailDrawer } from "@/components/countries/country-detail-drawer";
import { Button } from "@/components/ui/button";
import {
  countryGeoIndexSchema,
  countryMapResponseSchema,
  type CountryGeoIndex,
  type CountryMapSummary,
} from "@/features/countries/schemas";
import { hasDetailedCountryCoverage } from "@/features/database/schemas";
import { parseApiErrorMessage, toUserFacingErrorMessage } from "@/lib/api-error";
import type { ProductFitInitialFilters } from "@/components/products/product-fit-panel";

type ExplorerData =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      countryIndex: CountryGeoIndex;
      countries: CountryMapSummary[];
      status: "ready";
    };

type CountryExplorerProps = {
  initialCountryIso3?: string;
  initialFilters?: ProductFitInitialFilters;
};

const emptyCountryIndex: CountryGeoIndex = [];
const emptyCountrySummaries: CountryMapSummary[] = [];

function MapModuleLoading() {
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
          正在初始化交互地图…
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

export function CountryExplorer({
  initialCountryIso3,
  initialFilters,
}: CountryExplorerProps) {
  const router = useRouter();
  const [data, setData] = useState<ExplorerData>({ status: "loading" });
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
    const abortController = new AbortController();

    void Promise.all([
      fetch("/api/countries", {
        headers: { accept: "application/json" },
        signal: abortController.signal,
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await parseApiErrorMessage(response, "国家摘要请求失败"),
          );
        }
        return countryMapResponseSchema.parse(await response.json());
      }),
      fetch("/geo/world-countries-index.json", {
        signal: abortController.signal,
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("国家索引请求失败");
        }
        return countryGeoIndexSchema.parse(await response.json());
      }),
    ])
      .then(([mapResponse, countryIndex]) => {
        setData({
          countries: mapResponse.countries,
          countryIndex,
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
            "地图数据暂时无法加载，请重试。",
          ),
          status: "error",
        });
      });

    return () => abortController.abort();
  }, [reloadKey]);

  const selectCountry = useCallback(
    (iso3: string) => {
      cancelPendingProductEvaluation();
      router.push(`/countries/${iso3}`);
    },
    [cancelPendingProductEvaluation, router],
  );

  const closeCountry = useCallback(() => {
    cancelPendingProductEvaluation();
    router.push("/map");
  }, [cancelPendingProductEvaluation, router]);

  const countryIndex =
    data.status === "ready" ? data.countryIndex : emptyCountryIndex;
  const countries =
    data.status === "ready" ? data.countries : emptyCountrySummaries;
  const selectedName =
    countryIndex.find(({ iso3 }) => iso3 === selectedIso3)?.name ??
    selectedIso3;

  return (
    <main className="page-shell py-8 sm:py-10">
      <section className="mb-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div>
          <div className="section-kicker flex items-center gap-2">
            <Globe2 aria-hidden="true" className="size-4" />
            GLOBAL COUNTRY INTELLIGENCE
          </div>
          <h1 className="display-title mt-4 text-4xl font-semibold tracking-[-0.045em] text-[#142821] sm:text-5xl lg:text-6xl">
            全球柴油机法规地图
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
            悬停查看覆盖，选择国家进入可分享、可追溯的法规与产品判断。
          </p>
        </div>

        <div className="surface-panel grid min-w-72 gap-2 rounded-[1.25rem] p-4">
          <label
            className="text-[11px] font-semibold tracking-[0.12em] text-emerald-800 uppercase"
            htmlFor="country-select"
          >
            快速选择国家
          </label>
          <select
            aria-label="选择国家"
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
            <option value="">请选择国家</option>
            {countryIndex.map((country) => (
              <option key={country.iso3} value={country.iso3}>
                {country.name} · {country.iso3}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section
        aria-label="已录入国家快捷入口"
        className="mb-5 flex min-h-10 items-center gap-2 overflow-x-auto pb-1"
      >
        <span className="mr-1 inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-emerald-900/65">
          <Database aria-hidden="true" className="size-3.5" />
          已录入
        </span>
        {countries
          .filter((country) =>
            hasDetailedCountryCoverage(country.dataCoverageStatus),
          )
          .map((country) => (
            <Button
              aria-pressed={selectedIso3 === country.iso3}
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
              {country.nameEn} · {country.iso3}
            </Button>
          ))}
        {countries.length > 0 &&
        countries.every(
          (country) =>
            !hasDetailedCountryCoverage(country.dataCoverageStatus),
        ) ? (
          <span className="text-xs text-muted-foreground">
            暂无已录入详情的国家
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
                正在加载世界地图与国家摘要…
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
              <p className="font-semibold">地图加载失败</p>
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
                重试
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
        边界数据：Natural Earth 1:110m（公共领域）。国家详情以 ISO3
        与数据库连接。
        {selectedName ? ` 当前选择：${selectedName}。` : ""}
      </p>

      <CountryDetailDrawer
        cancelPendingProductEvaluation={cancelPendingProductEvaluation}
        countryIndex={countryIndex}
        initialFilters={initialFilters}
        iso3={selectedIso3}
        onClose={closeCountry}
        onSelectCountry={selectCountry}
        registerProductFitNavigationGuard={
          registerProductFitNavigationGuard
        }
      />
    </main>
  );
}
