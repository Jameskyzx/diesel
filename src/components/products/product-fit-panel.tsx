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

export type ProductFitInitialFilters = {
  applicationScope?: ApplicationScope;
  asOf?: string;
  powerKw?: number;
  productModelCode?: string;
};

type ProductListState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { products: ProductSummary[]; status: "ready" };

type EvaluationState =
  | { status: "idle" }
  | { status: "loading" }
  | { message: string; status: "error" }
  | { evaluation: ProductFitEvaluation; status: "ready" };

const scopeLabels: Record<ApplicationScope, string> = {
  agriculture: "农业",
  construction: "工程机械",
  "generator-set": "发电机组",
  marine: "船舶",
  "non-road": "非道路",
  "on-road": "道路",
  "on-road-bus": "客车动力",
  "on-road-truck": "卡车动力",
};

const fitPresentation = {
  fit: {
    className: "border-emerald-300 bg-emerald-50 text-emerald-950",
    icon: BadgeCheck,
    label: "明确匹配",
  },
  not_fit: {
    className: "border-rose-300 bg-rose-50 text-rose-950",
    icon: ShieldAlert,
    label: "明确不匹配",
  },
  unknown: {
    className: "border-amber-300 bg-amber-50 text-amber-950",
    icon: CircleHelp,
    label: "未知 / 证据不足",
  },
} as const;

function formatRange(minimum: number | null, maximum: number | null): string {
  if (minimum !== null && maximum !== null) {
    return `${minimum} kW（含）至 ${maximum} kW（不含），即 [${minimum}, ${maximum}) kW`;
  }
  if (minimum !== null) {
    return `${minimum} kW（含）起，上限开放`;
  }
  if (maximum !== null) {
    return `下限未记录；上限为 ${maximum} kW（不含）`;
  }
  return "功率上下限均未记录";
}

function formatDateRange(start: string | null, end: string | null): string {
  if (start === null && end === null) {
    return "未记录";
  }

  return `${start ?? "未记录"} → ${end ?? "开放"}`;
}

type ProductFitReasonCode =
  ProductFitEvaluation["reasons"][number]["code"];

function requiredFieldsForReasonCode(code: ProductFitReasonCode): string {
  if (code === "PRODUCT_NOT_FOUND") {
    return "产品型号、产品名称、规格版本、应用场景、功率范围、供应期、来源链接、发布日期、最近核验时间";
  }
  if (code === "NO_APPLICABLE_REGULATION_DATA") {
    return "法规名称、法规状态、适用国家或司法辖区、应用场景、功率区间、有效期、法规与限值来源、发布日期、最近核验时间";
  }
  if (code.startsWith("CERTIFICATION_")) {
    return "认证编号、关联法规、认证状态、应用场景、功率范围、有效期、来源链接、发布日期、最近核验时间";
  }
  return "与原因码对应的结构化记录、适用范围、有效期、来源链接和最近核验时间";
}

function buildDataGapSummary(evaluation: ProductFitEvaluation): string {
  const reasonCodes = evaluation.reasons.map(({ code }) => code);
  const requiredFields = Array.from(
    new Set(reasonCodes.map(requiredFieldsForReasonCode)),
  );
  const product = evaluation.product
    ? `${evaluation.product.modelCode} · ${evaluation.product.name}`
    : evaluation.input.productModelCode;

  return [
    "产品适配补数摘要（本地生成，尚未创建工单）",
    `国家：${evaluation.input.countryIso3}`,
    `产品：${product}`,
    `应用场景：${scopeLabels[evaluation.input.applicationScope]}（${evaluation.input.applicationScope}）`,
    `功率：${evaluation.input.powerKw} kW`,
    `评估日期（asOf）：${evaluation.asOf}`,
    `原因码：${reasonCodes.join("、")}`,
    `原因：${evaluation.reasons.map(({ message }) => message).join("；")}`,
    `所需字段：${requiredFields.join("；")}`,
  ].join("\n");
}

export function ProductFitPanel({
  asOf,
  countryIso3,
  initialFilters,
}: {
  asOf: string;
  countryIso3: string;
  initialFilters?: ProductFitInitialFilters;
}) {
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
    return () => {
      evaluationRequestIdRef.current += 1;
      evaluationAbortControllerRef.current?.abort();
      evaluationAbortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    void fetch("/api/products", {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await parseApiErrorMessage(response, "产品列表请求失败"),
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
          message: toUserFacingErrorMessage(error, "产品列表暂时无法加载。"),
          status: "error",
        });
      });

    return () => abortController.abort();
  }, [reloadKey]);

  /**
   * ADR-044：评估成功后把筛选写回 URL（replace，不污染历史），
   * 使分享链接可复现同一次评估。powerKw 按服务端相同语义规范化
   * （String(Number(...))），避免 `100.0` 之类的表示触发服务端
   * 规范化重定向并重置面板状态。
   */
  function syncFiltersToUrl(overrides?: {
    applicationScope?: ApplicationScope;
    asOf?: string;
    powerKw?: string;
    productModelCode?: string;
  }) {
    const rawPower = overrides?.powerKw ?? powerKw;
    const parsedPower = Number(rawPower);
    const params = new URLSearchParams(searchParams.toString());
    params.set(
      "applicationScope",
      overrides?.applicationScope ?? applicationScope,
    );
    params.set("asOf", overrides?.asOf ?? evaluationDate);
    params.set(
      "powerKw",
      Number.isFinite(parsedPower) ? String(parsedPower) : rawPower,
    );
    params.set(
      "productModelCode",
      overrides?.productModelCode ?? productModelCode,
    );
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
          await parseApiErrorMessage(response, "产品适配请求失败"),
        );
      }

      const parsed = productFitEvaluationSchema.parse(await response.json());
      if (
        abortController.signal.aborted ||
        evaluationRequestIdRef.current !== requestId
      ) {
        return;
      }
      setEvaluation({ evaluation: parsed, status: "ready" });
      syncFiltersToUrl(overrides);
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
          "适配评估暂时无法完成，请检查输入后重试。",
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
          产品适配结果
        </h2>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
        由 product-fit-v1 确定性规则计算；大模型不参与合规判断。
      </p>

      <form
        className="mt-3 grid gap-3 rounded-2xl border bg-card p-4"
        data-vaul-no-drag
        onSubmit={(event) => {
          event.preventDefault();
          void runEvaluation();
        }}
      >
        <label className="grid gap-1.5 text-xs font-medium">
          产品型号
          <select
            aria-label="产品型号"
            className="h-10 rounded-lg border bg-background px-3 text-sm"
            disabled={
              productList.status !== "ready" ||
              (productList.status === "ready" &&
                productList.products.length === 0)
            }
            onChange={(event) => {
              setProductModelCode(event.target.value);
              clearEvaluation();
            }}
            required
            value={productModelCode}
          >
            {productList.status === "loading" ? (
              <option value="">正在加载产品…</option>
            ) : null}
            {productList.status === "error" ? (
              <option value="">产品加载失败</option>
            ) : null}
            {productList.status === "ready" &&
            productList.products.length === 0 ? (
              <option value="">产品目录为空</option>
            ) : null}
            {productList.status === "ready"
              ? productList.products.map((product) => (
                  <option key={product.id} value={product.modelCode}>
                    {product.modelCode} · {product.name}
                  </option>
                ))
              : null}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-xs font-medium">
            应用场景
            <select
              aria-label="应用场景"
              className="h-10 rounded-lg border bg-background px-3 text-sm"
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
          <label className="grid gap-1.5 text-xs font-medium">
            功率（kW）
            <input
              aria-label="功率（kW）"
              className="h-10 rounded-lg border bg-background px-3 text-sm"
              min="0"
              onChange={(event) => {
                setPowerKw(event.target.value);
                clearEvaluation();
              }}
              required
              step="0.001"
              type="number"
              value={powerKw}
            />
          </label>
        </div>

        <p className="text-[11px] leading-5 text-muted-foreground">
          功率范围采用下限包含、上限不包含；例如 [50, 150) kW 表示 50
          kW 在范围内，150 kW 不在范围内。
        </p>

        <label className="grid gap-1.5 text-xs font-medium">
          评估日期
          <input
            aria-label="评估日期"
            className="h-10 rounded-lg border bg-background px-3 text-sm"
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
              重试
            </Button>
          </div>
        ) : null}

        {productList.status === "ready" &&
        productList.products.length === 0 ? (
          <p
            className="rounded-xl border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground"
            data-testid="product-fit-empty-catalog"
          >
            产品目录为空，暂无法运行产品适配评估。
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
          运行确定性匹配
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
  const presentation = fitPresentation[evaluation.status];
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
          {isDemoFit ? "演示匹配" : presentation.label}
        </div>
        {isDemoFit ? (
          <p className="mt-2 rounded-lg border border-amber-400/70 bg-amber-100/80 px-3 py-2 text-xs font-semibold leading-5 text-amber-950">
            包含虚构 Demo 证据；不可用于报价、认证声明或销售承诺。
          </p>
        ) : null}
        <p className="mt-2 text-sm leading-6">
          {evaluation.reasons[0]?.message}
        </p>
        <p className="mt-2 text-xs">
          规则：{evaluation.rulesetVersion} · 截止：{evaluation.asOf}
        </p>
      </div>

      {evaluation.status === "unknown" ? (
        <DataGapCopyAction evaluation={evaluation} />
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <TraceCheck
          label="应用场景"
          message={evaluation.productChecks.applicationScope.message}
          status={evaluation.productChecks.applicationScope.status}
        />
        <TraceCheck
          label="产品功率"
          message={evaluation.productChecks.power.message}
          status={evaluation.productChecks.power.status}
        />
      </div>

      {evaluation.product ? (
        <div
          className="rounded-2xl border bg-card p-4 text-xs"
          data-testid="product-record-trace"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold">产品记录追溯</p>
            <DataClassificationBadge
              isDemo={
                evaluation.product.isDemo || evaluation.product.source.isDemo
              }
            />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <TraceValue label="产品记录 ID" value={evaluation.product.id} />
            <TraceValue
              label="规格版本"
              value={evaluation.product.specificationVersion}
            />
            <TraceValue
              label="应用场景"
              value={evaluation.product.applicationScopes.join("、")}
            />
            <TraceValue
              label="产品功率"
              value={formatRange(
                evaluation.product.powerMinKw,
                evaluation.product.powerMaxKw,
              )}
            />
            <TraceValue
              label="产品供应期"
              value={formatDateRange(
                evaluation.product.availableFrom,
                evaluation.product.availableTo,
              )}
            />
          </dl>
          <SourceReference
            className="mt-3"
            label="来源"
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
                法规追溯
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
                  ? "通过"
                  : regulationCheck.status === "fail"
                    ? "不通过"
                    : "未知"}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {regulationCheck.message}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <TraceValue
              label="法规记录 ID"
              value={regulationCheck.regulation.regulationId}
            />
            <TraceValue
              label="法规有效期"
              value={`${regulationCheck.regulation.effectiveFrom ?? "未记录"} → ${regulationCheck.regulation.effectiveTo ?? "开放"}`}
            />
          </dl>

          <div className="mt-3 border-t pt-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">适用性证据</p>
                <p className="mt-1 text-muted-foreground">
                  {regulationCheck.regulation.applicability.jurisdiction.name}（
                  {regulationCheck.regulation.applicability.jurisdiction.code}
                  ）适用于{" "}
                  {regulationCheck.regulation.applicability.countryIso3}；成员有效期{" "}
                  {
                    regulationCheck.regulation.applicability.membership
                      .validFrom
                  }{" "}
                  →{" "}
                  {regulationCheck.regulation.applicability.membership
                    .validTo ?? "开放"}
                </p>
                <p className="mt-1 break-all text-muted-foreground">
                  辖区记录 ID：
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
              label="辖区来源"
              source={
                regulationCheck.regulation.applicability.jurisdiction.source
              }
            />
            <SourceReference
              className="mt-1"
              label="成员关系来源"
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
                      认证{" "}
                      {certificationCheck.certification.certificateNumber ??
                        "未编号"}
                    </p>
                    <DataClassificationBadge
                      isDemo={
                        certificationCheck.certification.isDemo ||
                        certificationCheck.certification.source.isDemo
                      }
                    />
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    状态 {certificationCheck.certification.status} · 功率{" "}
                    {formatRange(
                      certificationCheck.certification.powerMinKw,
                      certificationCheck.certification.powerMaxKw,
                    )}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    有效期{" "}
                    {certificationCheck.certification.validFrom ?? "开放"} →{" "}
                    {certificationCheck.certification.validTo ?? "开放"}
                  </p>
                  <p className="mt-2 leading-5">
                    {certificationCheck.reasons
                      .map(({ message }) => message)
                      .join("；")}
                  </p>
                  <p className="mt-2 break-all text-muted-foreground">
                    认证记录 ID：{certificationCheck.certification.id}
                  </p>
                  <SourceReference
                    className="mt-1"
                    label="来源"
                    source={certificationCheck.certification.source}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
              没有可追溯的产品认证记录，因此不会将“缺记录”解释为“不合规”。
            </div>
          )}
          <SourceReference
            className="mt-3"
            label="法规来源"
            source={regulationCheck.regulation.source}
          />
          {regulationCheck.regulation.limitSources.map((source) => (
            <SourceReference
              className="mt-1"
              key={source.id}
              label="适用限值来源"
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
  const [copyState, setCopyState] = useState<"copied" | "error" | "idle">(
    "idle",
  );

  async function copySummary() {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API is unavailable.");
      }
      await navigator.clipboard.writeText(buildDataGapSummary(evaluation));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/60 p-4 text-xs text-amber-950">
      <p className="font-semibold">需要补充结构化证据</p>
      <p className="mt-1 leading-5">
        仅复制到本机剪贴板，不会创建、发送或提交工单。
      </p>
      <Button
        className="mt-3"
        onClick={() => void copySummary()}
        size="sm"
        type="button"
        variant="outline"
      >
        <Copy aria-hidden="true" className="size-3.5" />
        {copyState === "copied" ? "补数摘要已复制" : "复制补数摘要"}
      </Button>
      {copyState === "error" ? (
        <p className="mt-2 text-destructive" role="alert">
          浏览器未允许写入剪贴板，请检查复制权限后重试。
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
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <p className="font-semibold">
        {label} ·{" "}
        {status === "pass" ? "通过" : status === "fail" ? "不通过" : "未知"}
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
  return (
    <span
      className={
        isDemo
          ? "shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900"
          : "shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-900"
      }
    >
      {isDemo ? "虚构 Demo" : "已核验来源"}
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
  return (
    <p className={`${className ?? ""} text-xs text-muted-foreground`}>
      {label}：
      {source.url ? (
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
        source.title
      )}
      {source.publishedOn ? ` · 发布 ${source.publishedOn}` : ""} · 核验{" "}
      {source.verifiedAt.slice(0, 10)}
    </p>
  );
}
