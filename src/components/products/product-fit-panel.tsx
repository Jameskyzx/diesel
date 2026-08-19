"use client";

import {
  AlertCircle,
  BadgeCheck,
  CircleHelp,
  Copy,
  ExternalLink,
  LoaderCircle,
  PackageCheck,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  buildProductFitDataGapSummary,
  productFitReasonMessage,
} from "@/features/ai/client-tool-copy";
import {
  applicationScopes,
  type ApplicationScope,
} from "@/features/database/schemas";
import {
  productFitEvaluationSchema,
  productListResponseSchema,
  type ProductFitEvaluation,
  type ProductSummary,
} from "@/features/product-fit/schemas";
import { parseApiErrorMessage, toUserFacingErrorMessage } from "@/lib/api-error";
import { isNavigableEvidenceUrl } from "@/lib/source-link";
import { formatOptionalUtcDate, formatUtcDate } from "@/i18n/date";
import type { Locale } from "@/i18n/locale";

export type ProductFitInitialFilters = {
  applicationScope?: ApplicationScope;
  asOf?: string;
  powerKw?: number;
  productModelCode?: string;
};

export type ProductFitCommittedFilters = Required<ProductFitInitialFilters>;

type ProductListState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { products: ProductSummary[]; status: "ready" };

type EvaluationState =
  | { status: "idle" }
  | { status: "loading" }
  | { message: string; status: "error" }
  | { evaluation: ProductFitEvaluation; status: "ready" };

const quickPowerValues = [50, 100, 150, 300] as const;

const fitPresentation = {
  fit: {
    className: "border-emerald-300 bg-emerald-50 text-emerald-950",
    icon: BadgeCheck,
  },
  not_fit: {
    className: "border-rose-300 bg-rose-50 text-rose-950",
    icon: ShieldAlert,
  },
  unknown: {
    className: "border-amber-300 bg-amber-50 text-amber-950",
    icon: CircleHelp,
  },
} as const;

const readinessPresentation = {
  not_ready: {
    className: "border-rose-300 bg-rose-50 text-rose-950",
  },
  ready: {
    className: "border-emerald-300 bg-emerald-50 text-emerald-950",
  },
  unknown: {
    className: "border-amber-300 bg-amber-50 text-amber-950",
  },
} as const;

function formatRange(
  minimum: number | null,
  maximum: number | null,
  missing: string,
  open: string,
): string {
  return `[${minimum ?? missing}, ${maximum ?? open}) kW`;
}

function formatDateRange(
  start: string | null,
  end: string | null,
  locale: Locale,
  notRecorded: string,
  open: string,
): string {
  if (start === null && end === null) {
    return notRecorded;
  }

  return `${formatOptionalUtcDate(start, locale, notRecorded)} → ${formatOptionalUtcDate(end, locale, open)}`;
}

export function ProductFitPanel({
  asOf,
  countryIso3,
  initialFilters,
  onEvaluationCommitted,
  registerNavigationGuard,
}: {
  asOf: string;
  countryIso3: string;
  initialFilters?: ProductFitInitialFilters;
  onEvaluationCommitted?: (filters: ProductFitCommittedFilters) => void;
  registerNavigationGuard?: (
    cancelPendingEvaluation: (() => void) | null,
  ) => void;
}) {
  const { dictionary } = useLocale();
  const copy = dictionary.productFit;
  const scopeLabels: Record<ApplicationScope, string> = {
    agriculture: copy.scopeAgriculture,
    construction: copy.scopeConstruction,
    "generator-set": copy.scopeGenerator,
    marine: copy.scopeMarine,
    "non-road": copy.scopeNonRoad,
    "on-road": copy.scopeOnRoad,
    "on-road-bus": copy.scopeBus,
    "on-road-truck": copy.scopeTruck,
  };
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [productList, setProductList] = useState<ProductListState>({
    status: "loading",
  });
  const [evaluation, setEvaluation] = useState<EvaluationState>({
    status: "idle",
  });
  const [productModelCode, setProductModelCode] = useState(
    initialFilters?.productModelCode ?? "",
  );
  const [applicationScope, setApplicationScope] = useState<ApplicationScope>(
    initialFilters?.applicationScope ?? "non-road",
  );
  const [powerKw, setPowerKw] = useState(
    initialFilters?.powerKw !== undefined
      ? String(initialFilters.powerKw)
      : "100",
  );
  const [evaluationDate, setEvaluationDate] = useState(
    initialFilters?.asOf ?? asOf,
  );
  const [reloadKey, setReloadKey] = useState(0);
  // Only filters present on the initial request may auto-run. A successful
  // manual evaluation writes its filters into the URL; treating that later
  // router update as a fresh shared-link load can race with the next user edit
  // and restore a stale result.
  const autoRanRef = useRef(!initialFilters?.productModelCode);
  const evaluationAbortControllerRef = useRef<AbortController | null>(null);
  const evaluationRequestIdRef = useRef(0);

  function clearEvaluation() {
    evaluationRequestIdRef.current += 1;
    evaluationAbortControllerRef.current?.abort();
    evaluationAbortControllerRef.current = null;
    setEvaluation({ status: "idle" });
  }

  useEffect(() => {
    const cancelPendingEvaluation = () => {
      evaluationRequestIdRef.current += 1;
      evaluationAbortControllerRef.current?.abort();
      evaluationAbortControllerRef.current = null;
    };

    registerNavigationGuard?.(cancelPendingEvaluation);
    return () => {
      cancelPendingEvaluation();
      registerNavigationGuard?.(null);
    };
  }, [registerNavigationGuard]);

  useEffect(() => {
    const abortController = new AbortController();

    void fetch("/api/products", {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await parseApiErrorMessage(response, copy.productLoadRequest),
          );
        }
        return productListResponseSchema.parse(await response.json());
      })
      .then((response) => {
        setProductList({ products: response.products, status: "ready" });
        // URL 携带未知型号（如已下架）时回退到第一个产品，避免
        // select 显示与状态不一致。
        setProductModelCode((current) =>
          response.products.some((product) => product.modelCode === current)
            ? current
            : (response.products[0]?.modelCode ?? ""),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setProductList({
          message: toUserFacingErrorMessage(error, copy.productLoadFallback),
          status: "error",
        });
      });

    return () => abortController.abort();
  }, [copy.productLoadFallback, copy.productLoadRequest, reloadKey]);

  /**
   * ADR-044：评估成功后把筛选写回 URL（replace，不污染历史），
   * 使分享链接可复现同一次评估。powerKw 按服务端相同语义规范化
   * （String(Number(...))），避免 `100.0` 之类的表示触发服务端
   * 规范化重定向并重置面板状态。
   */
  function syncFiltersToUrl(filters: ProductFitCommittedFilters) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("applicationScope", filters.applicationScope);
    params.set("asOf", filters.asOf);
    params.set("powerKw", String(filters.powerKw));
    params.set("productModelCode", filters.productModelCode);
    router.replace(`${pathname}?${params.toString()}`);
  }

  async function runEvaluation(overrides?: {
    applicationScope?: ApplicationScope;
    asOf?: string;
    powerKw?: string;
    productModelCode?: string;
  }) {
    evaluationAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    evaluationAbortControllerRef.current = abortController;
    const requestId = evaluationRequestIdRef.current + 1;
    evaluationRequestIdRef.current = requestId;
    setEvaluation({ status: "loading" });

    try {
      const response = await fetch("/api/product-fit", {
        body: JSON.stringify({
          applicationScope: overrides?.applicationScope ?? applicationScope,
          asOf: overrides?.asOf ?? evaluationDate,
          countryIso3,
          powerKw: overrides?.powerKw ?? powerKw,
          productModelCode:
            overrides?.productModelCode ?? productModelCode,
        }),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        method: "POST",
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(
          await parseApiErrorMessage(response, copy.productLoadError),
        );
      }

      const parsed = productFitEvaluationSchema.parse(await response.json());
      if (
        abortController.signal.aborted ||
        evaluationRequestIdRef.current !== requestId
      ) {
        return;
      }
      const committedFilters: ProductFitCommittedFilters = {
        applicationScope: parsed.input.applicationScope,
        asOf: parsed.asOf,
        powerKw: parsed.input.powerKw,
        productModelCode: parsed.input.productModelCode,
      };
      setEvaluation({ evaluation: parsed, status: "ready" });
      onEvaluationCommitted?.(committedFilters);
      syncFiltersToUrl(committedFilters);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      if (evaluationRequestIdRef.current !== requestId) {
        return;
      }
      setEvaluation({
        message: toUserFacingErrorMessage(
          error,
          copy.errorFallback,
        ),
        status: "error",
      });
    } finally {
      if (evaluationAbortControllerRef.current === abortController) {
        evaluationAbortControllerRef.current = null;
      }
    }
  }

  // 分享链接携带完整筛选（含产品型号）时，产品列表就绪后自动复现评估。
  useEffect(() => {
    if (
      autoRanRef.current ||
      !initialFilters?.productModelCode ||
      productList.status !== "ready"
    ) {
      return;
    }
    const known = productList.products.some(
      (product) => product.modelCode === initialFilters.productModelCode,
    );
    if (!known) {
      return;
    }
    autoRanRef.current = true;
    // 延迟到当前渲染后执行，避免 effect 内同步 setState 触发级联渲染。
    const timer = setTimeout(() => {
      void runEvaluation();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productList, initialFilters?.productModelCode]);

  return (
    <section aria-labelledby="product-fit-heading">
      <div className="flex items-center gap-2">
        <PackageCheck aria-hidden="true" className="size-4 text-primary" />
        <h2 className="font-semibold" id="product-fit-heading">
          {copy.heading}
        </h2>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
        {copy.formDescription}
      </p>

      <form
        className="mt-3 grid min-w-0 gap-3 rounded-2xl border bg-card p-4"
        data-testid="product-fit-form"
        data-vaul-no-drag
        onSubmit={(event) => {
          event.preventDefault();
          void runEvaluation();
        }}
      >
        <fieldset
          aria-describedby="product-model-help"
          className="grid min-w-0 gap-1.5"
          disabled={
            productList.status !== "ready" ||
            (productList.status === "ready" &&
              productList.products.length === 0)
          }
        >
          <legend className="text-xs font-medium">{copy.productModel}</legend>
          {productList.status === "loading" ? (
            <p className="rounded-xl border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
              {copy.loadingProducts}
            </p>
          ) : null}
          {productList.status === "error" ? (
            <p className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-3 text-xs text-destructive">
              {copy.productLoadError}
            </p>
          ) : null}
          {productList.status === "ready" &&
          productList.products.length === 0 ? (
            <p className="rounded-xl border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
              {copy.emptyCatalog}
            </p>
          ) : null}
          {productList.status === "ready" &&
          productList.products.length > 0 ? (
            <div className="grid min-w-0 gap-2">
              {productList.products.map((product) => {
                const selected = product.modelCode === productModelCode;

                return (
                  <label
                    className={`flex min-h-14 min-w-0 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "bg-background hover:border-primary/40"
                    }`}
                    data-testid={`product-model-option-${product.modelCode}`}
                    key={product.id}
                  >
                    <input
                      aria-label={`${product.modelCode} · ${product.name}`}
                      checked={selected}
                      className="mt-1 size-4 shrink-0 accent-primary"
                      name="productModelCode"
                      onChange={() => {
                        setProductModelCode(product.modelCode);
                        clearEvaluation();
                      }}
                      required
                      type="radio"
                      value={product.modelCode}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block break-all text-sm font-semibold">
                        {product.modelCode}
                      </span>
                      <span className="mt-0.5 block break-words text-[11px] font-normal leading-4 text-muted-foreground">
                        {product.name}
                      </span>
                    </span>
                    {selected ? (
                      <span className="shrink-0 text-[11px] font-medium text-primary">
                        {copy.selected}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          ) : null}
          <p
            className="text-[11px] font-normal leading-5 text-muted-foreground"
            id="product-model-help"
          >
            {copy.selectionHelp}
          </p>
        </fieldset>

        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1.5 text-xs font-medium">
            {copy.application}
            <select
              aria-label={copy.application}
              className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"
              onChange={(event) => {
                setApplicationScope(event.target.value as ApplicationScope);
                clearEvaluation();
              }}
              value={applicationScope}
            >
              {applicationScopes.map((scope) => (
                <option key={scope} value={scope}>
                  {scopeLabels[scope]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium">
            {copy.power}
            <input
              aria-label={copy.power}
              className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"
              inputMode="decimal"
              min="0"
              onClick={(event) => event.currentTarget.select()}
              onChange={(event) => {
                setPowerKw(event.target.value);
                clearEvaluation();
              }}
              onFocus={(event) => event.currentTarget.select()}
              required
              step="0.001"
              type="number"
              value={powerKw}
            />
          </label>
        </div>

        <fieldset className="min-w-0">
          <legend className="text-[11px] font-medium text-muted-foreground">
            {copy.quickPower}
          </legend>
          <div className="mt-1.5 grid grid-cols-4 gap-2">
            {quickPowerValues.map((value) => {
              const selected = powerKw === String(value);

              return (
                <Button
                  aria-label={copy.quickPowerOption.replace(
                    "{value}",
                    String(value),
                  )}
                  aria-pressed={selected}
                  className="h-11 min-w-0 px-1.5 text-xs"
                  key={value}
                  onClick={() => {
                    setPowerKw(String(value));
                    clearEvaluation();
                  }}
                  type="button"
                  variant={selected ? "default" : "outline"}
                >
                  {value}
                </Button>
              );
            })}
          </div>
        </fieldset>

        <p className="text-[11px] leading-5 text-muted-foreground">
          {copy.powerBandHelp}
        </p>

        <label className="grid min-w-0 gap-1.5 text-xs font-medium">
          {copy.date}
          <input
            aria-label={copy.date}
            className="h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm"
            onChange={(event) => {
              setEvaluationDate(event.target.value);
              clearEvaluation();
            }}
            required
            type="date"
            value={evaluationDate}
          />
        </label>

        {productList.status === "error" ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-destructive" role="alert">
              {productList.message}
            </p>
            <Button
              onClick={() => setReloadKey((key) => key + 1)}
              size="sm"
              type="button"
              variant="outline"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              {copy.retry}
            </Button>
          </div>
        ) : null}

        {productList.status === "ready" &&
        productList.products.length === 0 ? (
          <p
            className="rounded-xl border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground"
            data-testid="product-fit-empty-catalog"
          >
            {copy.emptyCatalogBody}
          </p>
        ) : null}

        <Button
          disabled={
            productList.status !== "ready" ||
            (productList.status === "ready" &&
              productList.products.length === 0) ||
            evaluation.status === "loading"
          }
          type="submit"
        >
          {evaluation.status === "loading" ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <PackageCheck aria-hidden="true" className="size-4" />
          )}
          {copy.run}
        </Button>
      </form>

      {evaluation.status === "error" ? (
        <div
          className="mt-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm"
          role="alert"
        >
          <AlertCircle aria-hidden="true" className="size-4 text-destructive" />
          <p className="mt-2">{evaluation.message}</p>
        </div>
      ) : null}

      {evaluation.status === "ready" ? (
        <ProductFitResult evaluation={evaluation.evaluation} />
      ) : null}
    </section>
  );
}

function ProductFitResult({
  evaluation,
}: {
  evaluation: ProductFitEvaluation;
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.productFit;
  const presentation = fitPresentation[evaluation.status];
  const readiness = readinessPresentation[evaluation.commercialReadiness];
  const fitLabel = {
    fit: copy.fit,
    not_fit: copy.notFit,
    unknown: copy.unknownFit,
  }[evaluation.status];
  const readinessLabel = {
    not_ready: copy.commercialNotReady,
    ready: copy.commercialReady,
    unknown: copy.commercialUnknown,
  }[evaluation.commercialReadiness];
  const StatusIcon = presentation.icon;
  const isDemoFit =
    evaluation.status === "fit" &&
    evaluation.sources.some(({ isDemo }) => isDemo);

  return (
    <div className="mt-3 space-y-3" data-testid="product-fit-result">
      <div
        aria-live="polite"
        className={`rounded-2xl border p-4 ${presentation.className}`}
        data-testid={`product-fit-status-${evaluation.status}`}
        role="status"
      >
        <div className="flex items-center gap-2 font-semibold">
          <StatusIcon aria-hidden="true" className="size-5" />
          {copy.fitAxis}{dictionary.common.labelSeparator}{isDemoFit ? copy.demoFit : fitLabel}
        </div>
        {isDemoFit ? (
          <p className="mt-2 rounded-lg border border-amber-400/70 bg-amber-100/80 px-3 py-2 text-xs font-semibold leading-5 text-amber-950">
            {copy.demoEvidenceWarning}
          </p>
        ) : null}
        <p className="mt-2 text-sm leading-6">
          {evaluation.reasons[0]
            ? productFitReasonMessage(evaluation.reasons[0], locale)
            : null}
        </p>
        <p className="mt-2 text-xs">
          {copy.resultRule}{dictionary.common.labelSeparator}{evaluation.rulesetVersion} · {copy.resultAsOf}{dictionary.common.labelSeparator}{formatUtcDate(evaluation.asOf, locale)}
        </p>
      </div>

      <div
        className={`rounded-2xl border p-4 ${readiness.className}`}
        data-testid={`commercial-readiness-${evaluation.commercialReadiness}`}
      >
        <p className="font-semibold">{readinessLabel}</p>
        <p className="mt-2 text-sm leading-6">
          {copy.availability}{dictionary.common.labelSeparator}
          {productFitReasonMessage(
            evaluation.productChecks.availability,
            locale,
          )}
        </p>
      </div>

      {evaluation.status === "unknown" ? (
        <DataGapCopyAction evaluation={evaluation} />
      ) : null}

      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <TraceCheck
          label={copy.traceApplication}
          message={productFitReasonMessage(
            evaluation.productChecks.applicationScope,
            locale,
          )}
          status={evaluation.productChecks.applicationScope.status}
        />
        <TraceCheck
          label={copy.tracePower}
          message={productFitReasonMessage(
            evaluation.productChecks.power,
            locale,
          )}
          status={evaluation.productChecks.power.status}
        />
        <TraceCheck
          label={copy.traceAvailability}
          message={productFitReasonMessage(
            evaluation.productChecks.availability,
            locale,
          )}
          status={evaluation.productChecks.availability.status}
        />
      </div>

      {evaluation.product ? (
        <div
          className="rounded-2xl border bg-card p-4 text-xs"
          data-testid="product-record-trace"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold">{copy.productTrace}</p>
            <DataClassificationBadge
              isDemo={
                evaluation.product.isDemo || evaluation.product.source.isDemo
              }
            />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <TraceValue label={copy.productId} value={evaluation.product.id} />
            <TraceValue
              label={copy.specification}
              value={evaluation.product.specificationVersion}
            />
            <TraceValue
              label={copy.application}
              value={evaluation.product.applicationScopes.join(", ")}
            />
            <TraceValue
              label={copy.productPower}
              value={formatRange(
                evaluation.product.powerMinKw,
                evaluation.product.powerMaxKw,
                copy.noNumber,
                dictionary.common.open,
              )}
            />
            <TraceValue
              label={copy.availablePeriod}
              value={formatDateRange(
                evaluation.product.availableFrom,
                evaluation.product.availableTo,
                locale,
                dictionary.common.notRecorded,
                dictionary.common.open,
              )}
            />
          </dl>
          <SourceReference
            className="mt-3"
            label={copy.recordSource}
            source={evaluation.product.source}
          />
        </div>
      ) : null}

      {evaluation.regulationChecks.map((regulationCheck) => (
        <article
          className="rounded-2xl border bg-card p-4"
          key={regulationCheck.regulation.regulationId}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-primary">
                {copy.regulationTrace}
              </p>
              <h3 className="mt-1 text-sm font-semibold">
                {regulationCheck.regulation.canonicalName}
              </h3>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
              <DataClassificationBadge
                isDemo={
                  regulationCheck.regulation.isDemo ||
                  regulationCheck.regulation.source.isDemo ||
                  regulationCheck.regulation.limitSources.some(
                    ({ isDemo }) => isDemo,
                  )
                }
              />
              <span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-semibold">
                {regulationCheck.status === "pass"
                  ? copy.pass
                  : regulationCheck.status === "fail"
                    ? copy.fail
                    : copy.unknown}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {productFitReasonMessage(regulationCheck, locale)}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <TraceValue
              label={copy.regulationId}
              value={regulationCheck.regulation.regulationId}
            />
            <TraceValue
              label={copy.regulationPeriod}
              value={formatDateRange(
                regulationCheck.regulation.effectiveFrom,
                regulationCheck.regulation.effectiveTo,
                locale,
                dictionary.common.notRecorded,
                dictionary.common.open,
              )}
            />
          </dl>

          <div className="mt-3 border-t pt-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{dictionary.country.applicabilityEvidence}</p>
                <p className="mt-1 text-muted-foreground">
                  {regulationCheck.regulation.applicability.jurisdiction.name}（
                  {regulationCheck.regulation.applicability.jurisdiction.code}
                  ） · {dictionary.country.applicableJurisdiction}
                  {dictionary.common.labelSeparator}
                  {regulationCheck.regulation.applicability.countryIso3} ·{" "}
                  {dictionary.country.membershipPeriod}
                  {dictionary.common.labelSeparator}
                  {formatUtcDate(
                    regulationCheck.regulation.applicability.membership
                      .validFrom,
                    locale,
                  )}{" "}
                  →{" "}
                  {formatOptionalUtcDate(
                    regulationCheck.regulation.applicability.membership
                      .validTo,
                    locale,
                    dictionary.common.open,
                  )}
                </p>
                <p className="mt-1 break-all text-muted-foreground">
                  {copy.jurisdictionId}{dictionary.common.labelSeparator}
                  {regulationCheck.regulation.applicability.jurisdiction.id}
                </p>
              </div>
              <DataClassificationBadge
                isDemo={
                  regulationCheck.regulation.applicability.jurisdiction
                    .isDemo ||
                  regulationCheck.regulation.applicability.jurisdiction.source
                    .isDemo ||
                  regulationCheck.regulation.applicability.membership.isDemo ||
                  regulationCheck.regulation.applicability.membership.source
                    .isDemo
                }
              />
            </div>
            <SourceReference
              className="mt-2"
              label={copy.jurisdictionSource}
              source={
                regulationCheck.regulation.applicability.jurisdiction.source
              }
            />
            <SourceReference
              className="mt-1"
              label={copy.membershipSource}
              source={regulationCheck.regulation.applicability.membership.source}
            />
          </div>

          {regulationCheck.certifications.length > 0 ? (
            <div className="mt-3 space-y-2">
              {regulationCheck.certifications.map((certificationCheck) => (
                <div
                  className="rounded-xl bg-muted/60 p-3 text-xs"
                  key={certificationCheck.certification.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold">
                      {copy.certification}{" "}
                      {certificationCheck.certification.certificateNumber ??
                        copy.noNumber}
                    </p>
                    <DataClassificationBadge
                      isDemo={
                        certificationCheck.certification.isDemo ||
                        certificationCheck.certification.source.isDemo
                      }
                    />
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {copy.status} {certificationCheck.certification.status} · {copy.power}{" "}
                    {formatRange(
                      certificationCheck.certification.powerMinKw,
                      certificationCheck.certification.powerMaxKw,
                      copy.noNumber,
                      dictionary.common.open,
                    )}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {copy.validPeriod}{" "}
                    {formatOptionalUtcDate(
                      certificationCheck.certification.validFrom,
                      locale,
                      dictionary.common.open,
                    )} →{" "}
                    {formatOptionalUtcDate(
                      certificationCheck.certification.validTo,
                      locale,
                      dictionary.common.open,
                    )}
                  </p>
                  <p className="mt-2 leading-5">
                    {certificationCheck.reasons
                      .map((reason) =>
                        productFitReasonMessage(reason, locale),
                      )
                      .join(locale === "en" ? "; " : "；")}
                  </p>
                  <p className="mt-2 break-all text-muted-foreground">
                    {copy.certificationId}{dictionary.common.labelSeparator}{certificationCheck.certification.id}
                  </p>
                  <SourceReference
                    className="mt-1"
                    label={copy.recordSource}
                    source={certificationCheck.certification.source}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
              {copy.certificationMissing}
            </div>
          )}
          <SourceReference
            className="mt-3"
            label={copy.regulationSource}
            source={regulationCheck.regulation.source}
          />
          {regulationCheck.regulation.limitSources.map((source) => (
            <SourceReference
              className="mt-1"
              key={source.id}
              label={copy.limitSource}
              source={source}
            />
          ))}
        </article>
      ))}
    </div>
  );
}

function DataGapCopyAction({
  evaluation,
}: {
  evaluation: ProductFitEvaluation;
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.productFit;
  const [copyState, setCopyState] = useState<"copied" | "error" | "idle">(
    "idle",
  );

  async function copySummary() {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API is unavailable.");
      }
      const scopeLabel = {
        agriculture: copy.scopeAgriculture,
        construction: copy.scopeConstruction,
        "generator-set": copy.scopeGenerator,
        marine: copy.scopeMarine,
        "non-road": copy.scopeNonRoad,
        "on-road": copy.scopeOnRoad,
        "on-road-bus": copy.scopeBus,
        "on-road-truck": copy.scopeTruck,
      }[evaluation.input.applicationScope];
      await navigator.clipboard.writeText(
        buildProductFitDataGapSummary({
          dictionary,
          evaluation,
          locale,
          scopeLabel,
        }),
      );
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/60 p-4 text-xs text-amber-950">
      <p className="font-semibold">{copy.dataGapTitle}</p>
      <p className="mt-1 leading-5">
        {copy.dataGapBody}
      </p>
      <Button
        className="mt-3"
        onClick={() => void copySummary()}
        size="sm"
        type="button"
        variant="outline"
      >
        <Copy aria-hidden="true" className="size-3.5" />
        {copyState === "copied" ? copy.copied : copy.copy}
      </Button>
      {copyState === "error" ? (
        <p className="mt-2 text-destructive" role="alert">
          {copy.copyDenied}
        </p>
      ) : null}
    </div>
  );
}

function TraceCheck({
  label,
  message,
  status,
}: {
  label: string;
  message: string;
  status: "pass" | "fail" | "unknown";
}) {
  const { dictionary } = useLocale();
  const copy = dictionary.productFit;
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <p className="font-semibold">
        {label} ·{" "}
        {status === "pass" ? copy.pass : status === "fail" ? copy.fail : copy.unknown}
      </p>
      <p className="mt-1 leading-5 text-muted-foreground">{message}</p>
    </div>
  );
}

function TraceValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-medium">{value}</dd>
    </div>
  );
}

function DataClassificationBadge({ isDemo }: { isDemo: boolean }) {
  const { dictionary } = useLocale();
  return (
    <span
      className={
        isDemo
          ? "shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900"
          : "shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-900"
      }
    >
      {isDemo ? dictionary.common.demo : dictionary.productFit.verifiedBadge}
    </span>
  );
}

type FitEvidenceSource = ProductFitEvaluation["sources"][number];

function SourceReference({
  className,
  label,
  source,
}: {
  className?: string;
  label: string;
  source: FitEvidenceSource;
}) {
  const { dictionary, locale } = useLocale();
  return (
    <p className={`${className ?? ""} text-xs text-muted-foreground`}>
      {label}{dictionary.common.labelSeparator}
      {isNavigableEvidenceUrl(source.url) ? (
        <a
          className="inline-flex items-center gap-1 text-primary hover:underline"
          href={source.url}
          rel="noreferrer"
          target="_blank"
        >
          {source.title}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      ) : (
        <span>
          {source.title}
          {source.isDemo ? dictionary.country.demoNoExternalSuffix : ""}
        </span>
      )}
      {source.publishedOn
        ? ` · ${dictionary.country.metricPublished} ${formatUtcDate(source.publishedOn, locale)}`
        : ""} · {dictionary.country.verifiedAt}{" "}
      {formatUtcDate(source.verifiedAt, locale)}
    </p>
  );
}
