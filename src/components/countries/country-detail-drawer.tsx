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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import { LocaleToggle } from "@/components/i18n/locale-toggle";
import { localizedCitationLocator } from "@/features/ai/citation-locator-copy";
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
  countryDecisionSummaryErrorMessage,
  countryDetailErrorMessage,
  parseCountryApiErrorCode,
} from "@/features/countries/client-errors";
import {
  countryDetailResponseSchema,
  type CountryApiErrorCode,
  type CountryDetailResponse,
  type CountryDirectory,
  type CountryMapSummary,
} from "@/features/countries/schemas";
import { countryDirectoryDisplayIdentity } from "@/features/countries/directory-display";
import {
  selectCountryDetailState,
  type CountryDetailQueryIdentity,
  type CountryDetailState,
} from "@/features/countries/detail-state";
import { productFitHistoryRouteKey } from "@/features/product-fit/history-route";
import {
  buildProductFitRouteKey,
  createProductFitNavigationState,
  reconcileProductFitNavigation,
  recordProductFitOwnNavigation,
} from "@/features/product-fit/navigation-state";
import type {
  ProductFitCommittedFilters,
  ProductFitInitialFilters,
} from "@/components/products/product-fit-panel";
import dynamic from "next/dynamic";
import { formatDecimalForDisplay } from "@/lib/decimal-format";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { formatOptionalUtcDate, formatUtcDate } from "@/i18n/date";
import {
  applicationScopeLabel,
  countryApplicabilityMissingDataMessages,
  countryRegionLabel,
  countrySubregionLabel,
  jurisdictionDisplayName,
  jurisdictionTypeLabel,
  marketMetricDisplayDefinition,
  marketMetricDisplayName,
  nameWithCode,
  regulationDisplayName,
} from "@/i18n/structured-labels";
import { isNavigableEvidenceUrl } from "@/lib/source-link";
import { createPublicApiRequestDeadline } from "@/lib/public-api-request";
import { isUnmodifiedPrimaryClick } from "@/lib/public-navigation-intent";
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

type CountryDetailDrawerProps = {
  cancelPendingProductEvaluation: () => void;
  countries: CountryMapSummary[];
  consumeCountrySelectFocusRequest: () => boolean;
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
  countries,
  consumeCountrySelectFocusRequest,
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
  // SSR props are the current route snapshot, not an initializer for a cache.
  // Keep only client-fetched responses in state so an RSC filter refresh can
  // update the details without remounting the product-fit form and result.
  const [detail, setDetail] = useState<CountryDetailState>({ status: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const detailRequestIdRef = useRef(0);
  const countrySelectRef = useRef<HTMLSelectElement>(null);
  const countrySummariesByIso3 = useMemo(
    () => new Map(countries.map((country) => [country.iso3, country])),
    [countries],
  );
  const selectedDirectoryEntry = iso3
    ? countryIndex.find(({ iso3: value }) => value === iso3)
    : undefined;
  const selectedCountryName = selectedDirectoryEntry
    ? formatCountryDisplayName(
        countryDirectoryDisplayIdentity(
          selectedDirectoryEntry,
          countrySummariesByIso3.get(selectedDirectoryEntry.iso3),
        ),
        locale,
      )
    : null;
  const selectedCountryNameWithCode = selectedDirectoryEntry && selectedCountryName
    ? nameWithCode(selectedCountryName, selectedDirectoryEntry.iso3, locale)
    : (iso3 ?? copy.unknownCountryTitle);
  const requestedAsOf = initialFilters?.asOf ?? null;
  const query: CountryDetailQueryIdentity | null = iso3
    ? {
        applicationScope: initialFilters?.applicationScope ?? null,
        asOf: requestedAsOf,
        iso3,
        powerKw: initialFilters?.powerKw ?? null,
      }
    : null;
  const currentDetail = selectCountryDetailState({
    detail,
    initialResponse,
    query,
  });
  const fetchAsOf = currentDetail.status === "ready"
    ? currentDetail.query.asOf
    : requestedAsOf;

  useEffect(() => {
    if (!iso3) {
      return;
    }

    if (initialResponse) {
      return;
    }

    const abortController = new AbortController();
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    const requestIsCurrent = () =>
      !abortController.signal.aborted &&
      detailRequestIdRef.current === requestId;
    const deadline = createPublicApiRequestDeadline(abortController.signal);
    const requestQuery: CountryDetailQueryIdentity = {
      applicationScope: initialFilters?.applicationScope ?? null,
      asOf: fetchAsOf,
      iso3,
      powerKw: initialFilters?.powerKw ?? null,
    };
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
      signal: deadline.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          return {
            code: await parseCountryApiErrorCode(response),
            status: "error" as const,
          };
        }
        return {
          response: countryDetailResponseSchema.parse(await response.json()),
          status: "ready" as const,
        };
      })
      .then((result) => {
        if (!requestIsCurrent()) {
          return;
        }
        if (result.status === "error") {
          setDetail({
            code: result.code,
            query: requestQuery,
            status: "error",
          });
          return;
        }
        setDetail({
          query: requestQuery,
          response: result.response,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (
          !requestIsCurrent() ||
          (error instanceof DOMException &&
            error.name === "AbortError" &&
            !deadline.didTimeout())
        ) {
          return;
        }
        setDetail({
          code: null,
          query: requestQuery,
          status: "error",
        });
      })
      .finally(deadline.dispose);

    return () => {
      if (detailRequestIdRef.current === requestId) {
        detailRequestIdRef.current += 1;
      }
      abortController.abort();
    };
  }, [
    fetchAsOf,
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
      <DrawerContent
        aria-describedby="country-drawer-description"
        onOpenAutoFocus={(event) => {
          const target = countrySelectRef.current;
          if (!target || !consumeCountrySelectFocusRequest()) {
            return;
          }

          event.preventDefault();
          target.focus();
        }}
      >
        <DrawerHeader className="relative pr-16">
          <p className="text-xs font-semibold tracking-[0.18em] text-primary">
            {copy.profileKicker}
          </p>
          <DrawerTitle>
            {currentDetail.status === "ready" &&
            currentDetail.response.status === "available"
              ? formatCountryDisplayName(currentDetail.response.country, locale)
              : selectedCountryNameWithCode}
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
          <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
            <label
              className="min-w-0 text-xs font-medium text-muted-foreground"
              htmlFor="drawer-country-select"
            >
              {copy.switchCountry}
            </label>
            <LocaleToggle testId="country-drawer-locale-toggle" />
          </div>
          <select
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            id="drawer-country-select"
            onChange={(event) => onSelectCountry(event.target.value)}
            ref={countrySelectRef}
            value={iso3 ?? ""}
          >
            {countryIndex.map((country) => (
              <option key={country.iso3} value={country.iso3}>
                {formatCountryDisplayName(
                  countryDirectoryDisplayIdentity(
                    country,
                    countrySummariesByIso3.get(country.iso3),
                  ),
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
          className="flex-1 overflow-y-auto px-5 py-5 sm:px-7"
          data-testid="country-drawer-body"
        >
          {currentDetail.status === "loading" ? (
            <div
              aria-busy="true"
              className="grid min-h-64 place-items-center text-center"
              data-testid="country-detail-loading"
              role="status"
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
                {countryDetailErrorMessage(currentDetail.code, dictionary)}
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
              aria-atomic="true"
              aria-live="polite"
              className="rounded-2xl border border-dashed bg-muted/40 p-6"
              data-testid="country-no-data"
              role="status"
            >
              <MapPin aria-hidden="true" className="size-6 text-primary" />
              <h2 className="mt-4 text-lg font-semibold">
                {selectedCountryNameWithCode}
                {dictionary.common.wordSeparator}
                {copy.noDataSuffix}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {selectedDirectoryEntry?.hasGeometry
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
  const routeKey = buildProductFitRouteKey({
    countryIso3: country.iso3,
    asOf: response.asOf,
    initialFilters,
  });
  const [navigationState, setNavigationState] = useState(() =>
    createProductFitNavigationState(routeKey),
  );
  const [historyTarget, setHistoryTarget] = useState<string | null>(null);
  const waitingForHistoryRoute = historyTarget !== null &&
    productFitHistoryRouteKey(historyTarget, response.asOf) !== routeKey;
  const navigation = waitingForHistoryRoute
    ? navigationState
    : reconcileProductFitNavigation(navigationState, routeKey, {
        external: historyTarget !== null,
      });
  // Reconcile during render so an external route never paints the old result.
  // These are local state updates only; request cancellation stays in events
  // and effect cleanup. An own replace acknowledges without resetting drafts.
  if (navigation !== navigationState) setNavigationState(navigation);
  if (historyTarget !== null && !waitingForHistoryRoute) setHistoryTarget(null);
  const contextKey = `${routeKey}:${navigation.routeRevision}`;
  const [committedFilters, setCommittedFilters] = useState<{
    contextKey: string;
    filters: ProductFitCommittedFilters;
  } | null>(null);
  const [refreshedSummary, setRefreshedSummary] = useState<{
    contextKey: string;
    summary: typeof response.applicabilitySummary;
  } | null>(null);
  const [summaryErrorState, setSummaryErrorState] = useState<{
    code: CountryApiErrorCode | null;
    contextKey: string;
  } | null>(null);
  const [summaryLoadingContextKey, setSummaryLoadingContextKey] = useState<
    string | null
  >(null);
  const summaryLoading = summaryLoadingContextKey === contextKey;
  const summaryAbortController = useRef<AbortController | null>(null);
  const chatFilters =
    committedFilters?.contextKey === contextKey
      ? committedFilters.filters
      : initialFilters;
  const applicabilitySummary =
    refreshedSummary?.contextKey === contextKey
      ? refreshedSummary.summary
      : response.applicabilitySummary;
  const summaryErrorCode =
    summaryErrorState?.contextKey === contextKey
      ? summaryErrorState.code
      : undefined;

  useEffect(() => {
    const handleHistoryNavigation = () => {
      cancelPendingProductEvaluation();
      summaryAbortController.current?.abort();
      summaryAbortController.current = null;
      // The browser location already points to the target, but its RSC props
      // may not have arrived. Hide the old content until that target commits.
      setHistoryTarget(window.location.href);
    };
    window.addEventListener("popstate", handleHistoryNavigation);
    return () => window.removeEventListener("popstate", handleHistoryNavigation);
  }, [cancelPendingProductEvaluation]);

  useEffect(
    () => () => {
      summaryAbortController.current?.abort();
      summaryAbortController.current = null;
    },
    [contextKey],
  );

  const handleEvaluationCommitted = useCallback(
    (filters: ProductFitCommittedFilters) => {
      setNavigationState((current) => recordProductFitOwnNavigation(current,
        buildProductFitRouteKey({
          countryIso3: country.iso3,
          asOf: filters.asOf,
          initialFilters: filters,
        }),
      ));
      setCommittedFilters({ contextKey, filters });
      summaryAbortController.current?.abort();
      const abortController = new AbortController();
      summaryAbortController.current = abortController;
      const requestIsCurrent = () =>
        !abortController.signal.aborted &&
        summaryAbortController.current === abortController;
      const deadline = createPublicApiRequestDeadline(abortController.signal);
      const params = new URLSearchParams({
        applicationScope: filters.applicationScope,
        asOf: filters.asOf,
        powerKw: String(filters.powerKw),
      });
      setSummaryLoadingContextKey(contextKey);
      setSummaryErrorState(null);
      void fetch(`/api/countries/${country.iso3}?${params}`, {
        headers: { accept: "application/json" },
        signal: deadline.signal,
      })
        .then(async (result) => {
          if (!result.ok) {
            return {
              code: await parseCountryApiErrorCode(result),
              status: "error" as const,
            };
          }
          return {
            response: countryDetailResponseSchema.parse(await result.json()),
            status: "ready" as const,
          };
        })
        .then((result) => {
          if (!requestIsCurrent()) {
            return;
          }
          if (result.status === "error") {
            setSummaryErrorState({ code: result.code, contextKey });
            return;
          }
          if (result.response.status === "available") {
            setRefreshedSummary({
              contextKey,
              summary: result.response.applicabilitySummary,
            });
          }
        })
        .catch((error: unknown) => {
          if (
            !requestIsCurrent() ||
            (error instanceof DOMException &&
              error.name === "AbortError" &&
              !deadline.didTimeout())
          ) {
            return;
          }
          setSummaryErrorState({
            code: null,
            contextKey,
          });
        })
        .finally(() => {
          deadline.dispose();
          if (requestIsCurrent()) {
            setSummaryLoadingContextKey(null);
          }
        });
    },
    [
      contextKey,
      country.iso3,
    ],
  );

  if (waitingForHistoryRoute) return <ProductFitLoading />;

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
        errorCode={summaryErrorCode}
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
            value={countryRegionLabel(country.regionCode, dictionary)}
          />
          <DetailItem
            label={copy.subregion}
            value={countrySubregionLabel(country.subregionCode, dictionary)}
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
        key={`${country.iso3}:${navigation.panelGeneration}`}
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
          onClick={(event) => {
            if (isUnmodifiedPrimaryClick(event)) {
              cancelPendingProductEvaluation();
            }
          }}
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
                <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                  <h3 className="min-w-0 break-words font-semibold">
                    {jurisdictionDisplayName(
                      {
                        code: jurisdiction.code,
                        countryIso3: country.iso3,
                        id: jurisdiction.id,
                        isDemo: jurisdiction.isDemo,
                        name: jurisdiction.name,
                        sourceId: jurisdiction.source.id,
                        sourceIsDemo: jurisdiction.source.isDemo,
                        sourceTitle: jurisdiction.source.title,
                        type: jurisdiction.type,
                      },
                      dictionary,
                      locale,
                    )}
                  </h3>
                  <div className="flex max-w-full flex-wrap justify-start gap-1.5 sm:shrink-0 sm:justify-end">
                    <DataClassificationBadge
                      isDemo={
                        jurisdiction.isDemo ||
                        jurisdiction.membershipIsDemo ||
                        jurisdiction.source.isDemo ||
                        jurisdiction.membershipSource.isDemo
                      }
                    />
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold">
                      {jurisdictionTypeLabel(jurisdiction.type, dictionary)}
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
                <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                  <h3 className="min-w-0 break-words text-sm font-semibold leading-5">
                    {marketMetricDisplayName(
                      { ...metric, metricIds: [metric.id] },
                      dictionary,
                      locale,
                    )}
                  </h3>
                  <div className="flex max-w-full flex-wrap justify-start gap-1.5 sm:shrink-0 sm:justify-end">
                    <DataClassificationBadge
                      isDemo={metric.isDemo || metric.source.isDemo}
                    />
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold">
                      {metric.applicationScope
                        ? applicationScopeLabel(
                            metric.applicationScope,
                            dictionary,
                          )
                        : copy.allScopes}
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
                  {marketMetricDisplayDefinition(
                    { ...metric, metricIds: [metric.id] },
                    dictionary,
                    locale,
                  )}
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
              <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                <p className="min-w-0 break-words font-medium">
                  <SourceLink source={source} />
                </p>
                <div className="flex max-w-full flex-wrap justify-start gap-1.5 sm:shrink-0 sm:justify-end">
                  <DataClassificationBadge isDemo={source.isDemo} />
                </div>
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
  errorCode,
  loading,
  summary,
}: {
  errorCode: CountryApiErrorCode | null | undefined;
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

  if (errorCode !== undefined) {
    return (
      <section
        className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        role="alert"
      >
        {countryDecisionSummaryErrorMessage(errorCode, dictionary)}
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
  const missingDataMessages = countryApplicabilityMissingDataMessages(
    {
      countryIso3: summary.country.countryIso3,
      countryName: summary.country.countryName,
      currentEffectiveRegulationCount: current.length,
      futureAdoptedRegulationCount: future.length,
      hasMissingData: summary.missingData.length > 0,
    },
    dictionary,
  );

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
        {copy.queryConditions}{dictionary.common.labelSeparator}
        {applicationScopeLabel(summary.query.applicationScope, dictionary)} · {summary.query.powerKw} kW · {copy.queryAsOf} {formatUtcDate(summary.query.asOf, locale)}
      </p>

      {current.length > 0 ? (
        <div className="mt-3 space-y-3">
          {current.map((regulation) => (
            <article className="rounded-xl border bg-background p-3" key={regulation.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {regulationDisplayName(regulation, dictionary, locale)}
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
              {regulationDisplayName(regulation, dictionary, locale)} ·{" "}
              {copy.effectiveDate}{" "}
              {formatOptionalUtcDate(
                regulation.effectiveFrom,
                locale,
                dictionary.common.noData,
              )}
            </p>
          ))}
        </div>
      ) : null}

      {missingDataMessages.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
          <p className="font-semibold">{copy.evidenceGap}</p>
          {missingDataMessages.map((message) => (
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
            <p
              key={[
                source.countryIso3 ?? "global",
                source.entityType,
                source.entityId,
                source.regulationId ?? "none",
                source.sourceId,
              ].join(":")}
            >
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
              )} · {localizedCitationLocator(source, locale, dictionary, copy.noLocator)} · {copy.verifiedAt} {formatUtcDate(source.verifiedAt, locale)}
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
              <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                <h3 className="min-w-0 break-words text-sm font-semibold leading-5">
                  {regulationDisplayName(regulation, dictionary, locale)}
                </h3>
                <div className="flex max-w-full flex-wrap justify-start gap-1.5 sm:shrink-0 sm:justify-end">
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
                  {nameWithCode(
                    jurisdictionDisplayName(
                      {
                        code: regulation.applicability.jurisdiction.code,
                        countryIso3: regulation.applicability.countryIso3,
                        id: regulation.applicability.jurisdiction.id,
                        isDemo: regulation.applicability.jurisdiction.isDemo,
                        name: regulation.applicability.jurisdiction.name,
                        sourceId:
                          regulation.applicability.jurisdiction.source.id,
                        sourceIsDemo:
                          regulation.applicability.jurisdiction.source.isDemo,
                        sourceTitle:
                          regulation.applicability.jurisdiction.source.title,
                        type: "country",
                      },
                      dictionary,
                      locale,
                    ),
                    regulation.applicability.jurisdiction.code,
                    locale,
                  )} · {copy.membershipPeriod}{dictionary.common.labelSeparator}
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
