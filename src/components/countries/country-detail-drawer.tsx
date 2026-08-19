"use client";

import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Database,
  ExternalLink,
  FileCheck2,
  Landmark,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  Orbit,
  RotateCcw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  countryDetailResponseSchema,
  type CountryDetailResponse,
  type CountryDirectory,
} from "@/features/countries/schemas";
import type {
  ProductFitCommittedFilters,
  ProductFitInitialFilters,
} from "@/components/products/product-fit-panel";
import dynamic from "next/dynamic";
import { parseApiErrorMessage, toUserFacingErrorMessage } from "@/lib/api-error";
import { formatDecimalForDisplay } from "@/lib/decimal-format";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { formatOptionalUtcDate, formatUtcDate } from "@/i18n/date";
import { isNavigableEvidenceUrl } from "@/lib/source-link";
import { cn } from "@/lib/utils";

function ProductFitLoading() {
  const { dictionary } = useLocale();

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground"
      role="status"
    >
      {dictionary.country.productFitLoading}
    </div>
  );
}

type DetailState =
  | { status: "idle" }
  | {
      iso3: string;
      message: string;
      requestedAsOf: string | null;
      status: "error";
    }
  | {
      iso3: string;
      requestedAsOf: string | null;
      response: CountryDetailResponse;
      status: "ready";
    };

type CurrentDetailState =
  | DetailState
  | { iso3: string; status: "loading" };

type CountryDetailDrawerProps = {
  cancelPendingProductEvaluation: () => void;
  countryIndex: CountryDirectory;
  initialFilters?: ProductFitInitialFilters;
  initialResponse?: CountryDetailResponse;
  iso3: string | null;
  onClose: () => void;
  onSelectCountry: (iso3: string) => void;
  registerProductFitNavigationGuard: (
    cancelPendingEvaluation: (() => void) | null,
  ) => void;
};

const ProductFitPanel = dynamic(
  async () => {
    const productModule = await import(
      "@/components/products/product-fit-panel"
    );
    return productModule.ProductFitPanel;
  },
  {
    loading: ProductFitLoading,
  },
);

function buildChatHref({
  countryIso3,
  initialFilters,
  responseAsOf,
}: {
  countryIso3: string;
  initialFilters?: ProductFitInitialFilters;
  responseAsOf: string;
}): string {
  const params = new URLSearchParams({
    asOf: initialFilters?.asOf ?? responseAsOf,
    countryIso3,
  });

  if (initialFilters?.applicationScope) {
    params.set("applicationScope", initialFilters.applicationScope);
  }
  if (initialFilters?.powerKw !== undefined) {
    params.set("powerKw", String(initialFilters.powerKw));
  }

  if (initialFilters?.productModelCode) {
    params.set("productModelCode", initialFilters.productModelCode);
  }

  return `/chat?${params.toString()}`;
}

export function CountryDetailDrawer({
  cancelPendingProductEvaluation,
  countryIndex,
  initialFilters,
  initialResponse,
  iso3,
  onClose,
  onSelectCountry,
  registerProductFitNavigationGuard,
}: CountryDetailDrawerProps) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.country;
  const [detail, setDetail] = useState<DetailState>(() =>
    initialResponse && iso3
      ? {
          iso3,
          requestedAsOf: initialFilters?.asOf ?? null,
          response: initialResponse,
          status: "ready",
        }
      : { status: "idle" },
  );
  const [reloadKey, setReloadKey] = useState(0);
  const requestedAsOf = initialFilters?.asOf ?? null;
  const loadedResponseAlreadyMatchesRequestedAsOf =
    requestedAsOf !== null &&
    detail.status === "ready" &&
    detail.iso3 === iso3 &&
    detail.response.status === "available" &&
    detail.response.asOf === requestedAsOf;
  const fetchAsOf = loadedResponseAlreadyMatchesRequestedAsOf
    ? detail.requestedAsOf
    : requestedAsOf;
  const currentDetail: CurrentDetailState =
    !iso3
      ? { status: "idle" }
      : detail.status !== "idle" &&
          detail.iso3 === iso3 &&
          (detail.requestedAsOf === requestedAsOf ||
            loadedResponseAlreadyMatchesRequestedAsOf)
        ? detail
        : { iso3, status: "loading" };

  useEffect(() => {
    if (!iso3) {
      return;
    }

    if (initialResponse && reloadKey === 0) {
      return;
    }

    const abortController = new AbortController();
    const detailParams = new URLSearchParams();
    if (fetchAsOf) {
      detailParams.set("asOf", fetchAsOf);
    }
    if (initialFilters?.applicationScope) {
      detailParams.set("applicationScope", initialFilters.applicationScope);
    }
    if (initialFilters?.powerKw !== undefined) {
      detailParams.set("powerKw", String(initialFilters.powerKw));
    }
    const detailQuery = detailParams.size > 0 ? `?${detailParams}` : "";

    void fetch(`/api/countries/${iso3}${detailQuery}`, {
      headers: {
        accept: "application/json",
      },
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await parseApiErrorMessage(response, copy.detailRequestError),
          );
        }
        return countryDetailResponseSchema.parse(await response.json());
      })
      .then((response) => {
        setDetail({
          iso3,
          requestedAsOf: fetchAsOf,
          response,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setDetail({
          iso3,
          message: toUserFacingErrorMessage(
            error,
            copy.detailErrorFallback,
          ),
          requestedAsOf: fetchAsOf,
          status: "error",
        });
      });

    return () => {
      abortController.abort();
    };
  }, [
    fetchAsOf,
    copy.detailErrorFallback,
    copy.detailRequestError,
    initialFilters?.applicationScope,
    initialFilters?.powerKw,
    initialResponse,
    iso3,
    reloadKey,
  ]);

  return (
    <Drawer
      autoFocus
      direction="right"
      dismissible
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={Boolean(iso3)}
    >
      <DrawerContent aria-describedby="country-drawer-description">
        <DrawerHeader className="relative pr-16">
          <p className="text-xs font-semibold tracking-[0.18em] text-primary">
            {copy.profileKicker}
          </p>
          <DrawerTitle>
            {currentDetail.status === "ready" &&
            currentDetail.response.status === "available"
              ? formatCountryDisplayName(currentDetail.response.country, locale)
              : (iso3 ?? copy.unknownCountryTitle)}
          </DrawerTitle>
          <DrawerDescription id="country-drawer-description">
            {copy.baselineDescription}
          </DrawerDescription>
          <DrawerClose asChild>
            <Button
              aria-label={dictionary.map.closeCountry}
              className="absolute right-5 top-5"
              size="sm"
              variant="outline"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <div className="border-b px-5 py-4 sm:px-7">
          <label
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
            htmlFor="drawer-country-select"
          >
            {copy.switchCountry}
          </label>
          <select
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            id="drawer-country-select"
            onChange={(event) => onSelectCountry(event.target.value)}
            value={iso3 ?? ""}
          >
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
                {country.hasGeometry
                  ? ""
                  : ` · ${dictionary.map.boundaryMissingOption}`}
              </option>
            ))}
          </select>
        </div>

        <div
          aria-live="polite"
          className="flex-1 overflow-y-auto px-5 py-5 sm:px-7"
        >
          {currentDetail.status === "loading" ? (
            <div
              className="grid min-h-64 place-items-center text-center"
              data-testid="country-detail-loading"
            >
              <div>
                <LoaderCircle
                  aria-hidden="true"
                  className="mx-auto size-7 animate-spin text-primary"
                />
                <p className="mt-3 text-sm text-muted-foreground">
                  {copy.detailsLoading}
                </p>
              </div>
            </div>
          ) : null}

          {currentDetail.status === "error" ? (
            <div
              className="rounded-2xl border border-destructive/25 bg-destructive/5 p-5"
              role="alert"
            >
              <AlertTriangle
                aria-hidden="true"
                className="size-5 text-destructive"
              />
              <p className="mt-3 font-semibold">{copy.detailError}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {currentDetail.message}
              </p>
              <Button
                className="mt-4"
                onClick={() => setReloadKey((key) => key + 1)}
                size="sm"
                variant="outline"
              >
                <RotateCcw aria-hidden="true" className="size-3.5" />
                {dictionary.common.retry}
              </Button>
            </div>
          ) : null}

          {currentDetail.status === "ready" &&
          currentDetail.response.status === "no_data" ? (
            <div
              className="rounded-2xl border border-dashed bg-muted/40 p-6"
              data-testid="country-no-data"
            >
              <MapPin aria-hidden="true" className="size-6 text-primary" />
              <h2 className="mt-4 text-lg font-semibold">
                {currentDetail.response.iso3} {copy.noDataSuffix}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {countryIndex.find(({ iso3: value }) => value === iso3)
                  ?.hasGeometry
                  ? copy.geometryNoData
                  : copy.missingGeometryNoData}
              </p>
            </div>
          ) : null}

          {currentDetail.status === "ready" &&
          currentDetail.response.status === "available" ? (
            <CountryDetailContent
              cancelPendingProductEvaluation={cancelPendingProductEvaluation}
              initialFilters={initialFilters}
              registerProductFitNavigationGuard={
                registerProductFitNavigationGuard
              }
              response={currentDetail.response}
            />
          ) : null}
        </div>

        <DrawerFooter>
          <p className="text-xs leading-5 text-muted-foreground">
            {copy.shareableFooter}
          </p>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function CountryDetailContent({
  cancelPendingProductEvaluation,
  initialFilters,
  registerProductFitNavigationGuard,
  response,
}: {
  cancelPendingProductEvaluation: () => void;
  initialFilters?: ProductFitInitialFilters;
  registerProductFitNavigationGuard: (
    cancelPendingEvaluation: (() => void) | null,
  ) => void;
  response: Extract<CountryDetailResponse, { status: "available" }>;
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.country;
  const coverageLabels = {
    covered: copy.coverageCovered,
    demo: copy.coverageDemo,
    no_data: copy.coverageNoData,
    none: copy.coverageNone,
    planned: copy.coveragePlanned,
  } as const;
  const { country } = response;
  const contextKey = `${country.iso3}:${JSON.stringify(initialFilters ?? {})}`;
  const [committedFilters, setCommittedFilters] = useState<{
    contextKey: string;
    filters: ProductFitCommittedFilters;
  } | null>(null);
  const [refreshedSummary, setRefreshedSummary] = useState<{
    contextKey: string;
    summary: typeof response.applicabilitySummary;
  } | null>(null);
  const [summaryErrorState, setSummaryErrorState] = useState<{
    contextKey: string;
    message: string;
  } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const summaryAbortController = useRef<AbortController | null>(null);
  const chatFilters =
    committedFilters?.contextKey === contextKey
      ? committedFilters.filters
      : initialFilters;
  const applicabilitySummary =
    refreshedSummary?.contextKey === contextKey
      ? refreshedSummary.summary
      : response.applicabilitySummary;
  const summaryError =
    summaryErrorState?.contextKey === contextKey
      ? summaryErrorState.message
      : null;

  useEffect(
    () => () => {
      summaryAbortController.current?.abort();
    },
    [],
  );

  const handleEvaluationCommitted = useCallback(
    (filters: ProductFitCommittedFilters) => {
      setCommittedFilters({ contextKey, filters });
      summaryAbortController.current?.abort();
      const abortController = new AbortController();
      summaryAbortController.current = abortController;
      const params = new URLSearchParams({
        applicationScope: filters.applicationScope,
        asOf: filters.asOf,
        powerKw: String(filters.powerKw),
      });
      setSummaryLoading(true);
      setSummaryErrorState(null);
      void fetch(`/api/countries/${country.iso3}?${params}`, {
        headers: { accept: "application/json" },
        signal: abortController.signal,
      })
        .then(async (result) => {
          if (!result.ok) {
            throw new Error(
              await parseApiErrorMessage(result, copy.decisionSummaryRequestError),
            );
          }
          return countryDetailResponseSchema.parse(await result.json());
        })
        .then((result) => {
          if (result.status === "available") {
            setRefreshedSummary({
              contextKey,
              summary: result.applicabilitySummary,
            });
          }
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setSummaryErrorState({
            contextKey,
            message: toUserFacingErrorMessage(
              error,
              copy.decisionSummaryErrorFallback,
            ),
          });
        })
        .finally(() => {
          if (!abortController.signal.aborted) {
            setSummaryLoading(false);
          }
        });
    },
    [
      contextKey,
      copy.decisionSummaryErrorFallback,
      copy.decisionSummaryRequestError,
      country.iso3,
    ],
  );

  return (
    <div className="space-y-5" data-testid="country-detail">
      {country.isDemo || country.source.isDemo ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle aria-hidden="true" className="size-4" />
            {copy.demoCountryTitle}
          </div>
          <p className="mt-1.5 text-xs leading-5">
            {copy.demoCountryBody}
          </p>
        </div>
      ) : null}

      <ApplicabilitySummarySection
        error={summaryError}
        loading={summaryLoading}
        summary={applicabilitySummary}
      />

      <section aria-labelledby="country-basics">
        <div className="flex items-center gap-2">
          <MapPin aria-hidden="true" className="size-4 text-primary" />
          <h2 className="font-semibold" id="country-basics">
            {copy.basics}
          </h2>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <DetailItem label="ISO3" value={country.iso3} />
          <DetailItem label="ISO2" value={country.iso2} />
          <DetailItem
            label={copy.localName}
            value={country.nameLocal ?? dictionary.common.notRecorded}
          />
          <DetailItem
            label={copy.coverage}
            value={coverageLabels[country.dataCoverageStatus]}
          />
          <DetailItem
            label={copy.region}
            value={country.regionCode ?? dictionary.common.notRecorded}
          />
          <DetailItem
            label={copy.subregion}
            value={country.subregionCode ?? dictionary.common.notRecorded}
          />
        </dl>
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          {copy.coverageSemantics}
        </p>
      </section>

      <RegulationSection
        emptyMessage={copy.currentRegulationsEmpty}
        heading={copy.currentRegulations}
        id="current-regulations"
        regulations={country.currentEffectiveRegulations}
      />

      <ProductFitPanel
        asOf={response.asOf}
        countryIso3={country.iso3}
        initialFilters={initialFilters}
        key={country.iso3}
        onEvaluationCommitted={handleEvaluationCommitted}
        registerNavigationGuard={registerProductFitNavigationGuard}
      />

      <section
        aria-labelledby="country-chat-analysis"
        className="rounded-2xl border border-primary/20 bg-primary/5 p-4"
      >
        <h2 className="font-semibold" id="country-chat-analysis">
          {copy.chatTitle}
        </h2>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {copy.chatBody}
        </p>
        <a
          className={cn(buttonVariants(), "mt-3 w-full")}
          href={buildChatHref({
            countryIso3: country.iso3,
            initialFilters: chatFilters,
            responseAsOf: response.asOf,
          })}
          onClick={cancelPendingProductEvaluation}
        >
          <MessageSquareText aria-hidden="true" className="size-4" />
          {copy.chatAction}
        </a>
      </section>

      <RegulationSection
        emptyMessage={copy.futureRegulationsEmpty}
        heading={copy.futureRegulations}
        id="future-regulations"
        regulations={country.futureAdoptedRegulations}
      />

      <section aria-labelledby="country-jurisdictions">
        <div className="flex items-center gap-2">
          <Landmark aria-hidden="true" className="size-4 text-primary" />
          <h2 className="font-semibold" id="country-jurisdictions">
            {copy.jurisdiction}
          </h2>
        </div>
        {country.jurisdictions.length > 0 ? (
          <div className="mt-3 space-y-3">
            {country.jurisdictions.map((jurisdiction) => (
              <article
                className="rounded-2xl border bg-card p-4 text-sm"
                key={jurisdiction.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{jurisdiction.name}</h3>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <DataClassificationBadge
                      isDemo={
                        jurisdiction.isDemo ||
                        jurisdiction.membershipIsDemo ||
                        jurisdiction.source.isDemo ||
                        jurisdiction.membershipSource.isDemo
                      }
                    />
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold">
                      {jurisdiction.type}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {copy.code}{dictionary.common.labelSeparator}{jurisdiction.code} · {copy.membershipPeriod}{dictionary.common.labelSeparator}
                  {formatUtcDate(jurisdiction.validFrom, locale)} → {formatOptionalUtcDate(jurisdiction.validTo, locale, dictionary.common.open)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {copy.jurisdictionSource}{dictionary.common.labelSeparator}<SourceLink source={jurisdiction.source} /> · {copy.verifiedAt}{" "}
                  {formatUtcDate(jurisdiction.jurisdictionVerifiedAt, locale)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {copy.membershipSource}{dictionary.common.labelSeparator}
                  <SourceLink source={jurisdiction.membershipSource} /> · {copy.verifiedAt}{" "}
                  {formatUtcDate(jurisdiction.verifiedAt, locale)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
            {copy.jurisdictionEmpty}
          </div>
        )}
      </section>

      <section aria-labelledby="market-metrics">
        <div className="flex items-center gap-2">
          <BarChart3 aria-hidden="true" className="size-4 text-primary" />
          <h2 className="font-semibold" id="market-metrics">
            {copy.marketMetrics}
          </h2>
        </div>
        {country.marketMetrics.length > 0 ? (
          <div className="mt-3 space-y-3">
            {country.marketMetrics.map((metric) => (
              <article
                className="rounded-2xl border bg-card p-4"
                key={metric.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold leading-5">
                    {metric.metricName}
                  </h3>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <DataClassificationBadge
                      isDemo={metric.isDemo || metric.source.isDemo}
                    />
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold">
                      {metric.applicationScope ?? copy.allScopes}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-2xl font-semibold tracking-tight">
                  {formatDecimalForDisplay(metric.valueNumeric)}{" "}
                  <span className="text-sm font-medium text-muted-foreground">
                    {metric.unitCode}
                  </span>
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {metric.definition}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {copy.period}{dictionary.common.labelSeparator}{formatUtcDate(metric.periodStart, locale)} → {formatUtcDate(metric.periodEnd, locale)} · {copy.methodology}{dictionary.common.labelSeparator}
                  {metric.methodologyVersion}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {copy.metricPublished}{dictionary.common.labelSeparator}{formatOptionalUtcDate(metric.publishedOn, locale, dictionary.common.notRecorded)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dictionary.common.source}{dictionary.common.labelSeparator}<SourceLink source={metric.source} /> · {copy.verifiedAt}{dictionary.common.labelSeparator}
                  {formatUtcDate(metric.source.verifiedAt, locale)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
            {copy.marketEmpty}
          </div>
        )}
      </section>

      <section aria-labelledby="country-source">
        <div className="flex items-center gap-2">
          <Database aria-hidden="true" className="size-4 text-primary" />
          <h2 className="font-semibold" id="country-source">
            {copy.dataSources}
          </h2>
        </div>
        <div className="mt-3 space-y-2">
          {country.sources.map((source) => (
            <article
              className="rounded-2xl border bg-card p-4 text-sm"
              key={source.id}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">
                  <SourceLink source={source} />
                </p>
                <DataClassificationBadge isDemo={source.isDemo} />
              </div>
              <p className="mt-1 text-muted-foreground">
                {source.publisher ?? copy.noRecordPublisher}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarDays aria-hidden="true" className="size-3.5" />
                {copy.lastVerified}{dictionary.common.labelSeparator}{formatUtcDate(source.verifiedAt, locale)}
              </div>
            </article>
          ))}
        </div>
        <div className="mt-3 rounded-2xl bg-primary/5 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Orbit aria-hidden="true" className="size-4 text-primary" />
            {copy.detailAsOf}
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {copy.lastVerified}{dictionary.common.labelSeparator}{formatUtcDate(country.lastVerifiedAt, locale)} ·{" "}
            {copy.detailAsOf}{dictionary.common.labelSeparator}{formatUtcDate(response.asOf, locale)}
          </p>
          {country.isStale ? (
            <p
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900"
              data-testid="country-stale-badge"
            >
              <AlertTriangle aria-hidden="true" className="size-3" />
              {copy.staleBadge}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

type AvailableCountryResponse = Extract<
  CountryDetailResponse,
  { status: "available" }
>;
type ApplicabilitySummary = NonNullable<
  AvailableCountryResponse["applicabilitySummary"]
>;

function formatPowerBand(
  minimum: number | null,
  maximum: number | null,
  unknown: string,
  open: string,
): string {
  return `[${minimum ?? unknown}, ${maximum ?? open}) kW`;
}

function ApplicabilitySummarySection({
  error,
  loading,
  summary,
}: {
  error: string | null;
  loading: boolean;
  summary: ApplicabilitySummary | null;
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.country;

  if (loading) {
    return (
      <section
        aria-live="polite"
        className="rounded-2xl border bg-primary/5 p-4 text-sm"
        role="status"
      >
        {copy.applicabilitySummaryLoading}
      </section>
    );
  }

  if (error) {
    return (
      <section
        className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        role="alert"
      >
        {error}
      </section>
    );
  }

  if (!summary) {
    return (
      <section className="rounded-2xl border border-dashed bg-muted/30 p-4">
        <h2 className="font-semibold">{copy.applicabilitySummary}</h2>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {copy.applicabilitySummaryEmpty}
        </p>
      </section>
    );
  }

  const current = summary.country.currentEffectiveRegulations;
  const future = summary.country.futureAdoptedRegulations;

  return (
    <section
      aria-labelledby="country-applicability-summary"
      className="rounded-2xl border border-primary/25 bg-primary/5 p-4"
      data-testid="country-applicability-summary"
    >
      <h2 className="font-semibold" id="country-applicability-summary">
        {copy.applicabilitySummary}
      </h2>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
        {copy.queryConditions}{dictionary.common.labelSeparator}{summary.query.applicationScope} · {summary.query.powerKw} kW · {copy.queryAsOf} {formatUtcDate(summary.query.asOf, locale)}
      </p>

      {current.length > 0 ? (
        <div className="mt-3 space-y-3">
          {current.map((regulation) => (
            <article className="rounded-xl border bg-background p-3" key={regulation.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {regulation.canonicalName}
                </h3>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-900">
                  {copy.currentApplicable}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-xs">
                {regulation.limits.map((limit) => (
                  <p key={limit.id}>
                    {limit.pollutantCode}{dictionary.common.labelSeparator}{formatDecimalForDisplay(limit.limitValue)} {limit.unitCode} · {copy.powerBand} {formatPowerBand(limit.powerMinKw, limit.powerMaxKw, dictionary.common.noData, dictionary.common.open)} · {copy.limitPeriod} {formatUtcDate(limit.validFrom, locale)} → {formatOptionalUtcDate(limit.validTo, locale, dictionary.common.open)}
                  </p>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
          {copy.decisionNoCurrent}
        </div>
      )}

      {future.length > 0 ? (
        <div className="mt-3 text-xs leading-5">
          <p className="font-semibold">{copy.futureAdopted}</p>
          {future.map((regulation) => (
            <p key={regulation.id}>
              {regulation.canonicalName} · {copy.effectiveDate} {formatOptionalUtcDate(regulation.effectiveFrom, locale, dictionary.common.noData)}
            </p>
          ))}
        </div>
      ) : null}

      {summary.missingData.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
          <p className="font-semibold">{copy.evidenceGap}</p>
          {summary.missingData.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}

      <details className="mt-3 rounded-xl border bg-background/70 p-3 text-xs">
        <summary className="cursor-pointer font-semibold">
          {copy.sourceCount.replace("{count}", String(summary.sources.length))}
        </summary>
        <div className="mt-2 space-y-1 text-muted-foreground">
          <p>{copy.lastVerified}{dictionary.common.labelSeparator}{formatOptionalUtcDate(summary.lastVerifiedAt, locale, dictionary.common.notRecorded)}</p>
          {summary.sources.map((source) => (
            <p key={`${source.entityType}:${source.entityId}:${source.sourceId}`}>
              {isNavigableEvidenceUrl(source.sourceUrl) ? (
                <a
                  className="underline underline-offset-2"
                  href={source.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {source.sourceTitle}
                </a>
              ) : (
                source.sourceTitle
              )} · {source.locator ?? copy.noLocator} · {copy.verifiedAt} {formatUtcDate(source.verifiedAt, locale)}
            </p>
          ))}
        </div>
      </details>
    </section>
  );
}

type DisplayedRegulation =
  | AvailableCountryResponse["country"]["currentEffectiveRegulations"][number]
  | AvailableCountryResponse["country"]["futureAdoptedRegulations"][number];

function RegulationSection({
  emptyMessage,
  heading,
  id,
  regulations,
}: {
  emptyMessage: string;
  heading: string;
  id: string;
  regulations: DisplayedRegulation[];
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.country;
  const localizedStatusLabels = {
    adopted: copy.statusAdopted,
    effective: copy.statusEffective,
    proposed: copy.statusProposed,
    superseded: copy.statusSuperseded,
  } as const;
  const localizedStatusAtAsOfLabels = {
    adopted: copy.statusAtAdopted,
    effective: copy.statusAtEffective,
  } as const;

  return (
    <section aria-labelledby={id}>
      <div className="flex items-center gap-2">
        <FileCheck2 aria-hidden="true" className="size-4 text-primary" />
        <h2 className="font-semibold" id={id}>
          {heading}
        </h2>
      </div>
      {regulations.length > 0 ? (
        <div className="mt-3 space-y-3">
          {regulations.map((regulation) => (
            <article
              className="rounded-2xl border bg-card p-4"
              data-testid="country-regulation-card"
              key={regulation.id}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold leading-5">
                  {regulation.canonicalName}
                </h3>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  <DataClassificationBadge
                    isDemo={regulation.isDemo || regulation.source.isDemo}
                  />
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold">
                    {localizedStatusAtAsOfLabels[regulation.statusAtAsOf]}
                  </span>
                  {regulation.status !== regulation.statusAtAsOf ? (
                    <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                      {copy.archiveCurrent}{dictionary.common.labelSeparator}{localizedStatusLabels[regulation.status]}
                    </span>
                  ) : null}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <DetailItem
                  label={copy.effectiveDate}
                  value={formatOptionalUtcDate(regulation.effectiveFrom, locale, dictionary.common.notRecorded)}
                />
                <DetailItem
                  label={copy.endDate}
                  value={formatOptionalUtcDate(regulation.effectiveTo, locale, dictionary.common.notRecorded)}
                />
              </dl>
              <details className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-semibold text-foreground">
                  {copy.formalTrace}
                </summary>
                <div className="mt-2">
                  <p>{copy.regulationId}{dictionary.common.labelSeparator}{regulation.id}</p>
                  <p className="mt-1">
                    {dictionary.common.source}{dictionary.common.labelSeparator}<SourceLink source={regulation.source} /> · {copy.verifiedAt}{dictionary.common.labelSeparator}
                    {formatUtcDate(regulation.source.verifiedAt, locale)}
                  </p>
                <p>
                  {copy.applicableJurisdiction}{dictionary.common.labelSeparator}
                  {regulation.applicability.jurisdiction.name}（
                  {regulation.applicability.jurisdiction.code}) · {copy.membershipPeriod}{dictionary.common.labelSeparator}
                  {formatUtcDate(regulation.applicability.membership.validFrom, locale)} →{" "}
                  {formatOptionalUtcDate(regulation.applicability.membership.validTo, locale, dictionary.common.open)}
                </p>
                <p className="mt-1">
                  {copy.jurisdictionSource}{dictionary.common.labelSeparator}
                  <SourceLink
                    source={regulation.applicability.jurisdiction.source}
                  />
                </p>
                <p className="mt-1">
                  {copy.membershipSource}{dictionary.common.labelSeparator}
                  <SourceLink
                    source={regulation.applicability.membership.source}
                  />
                </p>
                </div>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      )}
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2.5">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function DataClassificationBadge({ isDemo }: { isDemo: boolean }) {
  const { dictionary } = useLocale();
  return (
    <span
      className={
        isDemo
          ? "shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900"
          : "shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900"
      }
    >
      {isDemo ? dictionary.country.demoBadge : dictionary.common.verifiedSource}
    </span>
  );
}

type CountrySource = AvailableCountryResponse["country"]["sources"][number];

function SourceLink({ source }: { source: CountrySource }) {
  const { dictionary } = useLocale();
  if (!isNavigableEvidenceUrl(source.url)) {
    return (
      <span>
        {source.title}
        {source.isDemo ? dictionary.country.demoNoExternalSuffix : ""}
      </span>
    );
  }

  return (
    <a
      className="inline-flex items-center gap-1 text-primary hover:underline"
      href={source.url}
      rel="noreferrer"
      target="_blank"
    >
      {source.title}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}
