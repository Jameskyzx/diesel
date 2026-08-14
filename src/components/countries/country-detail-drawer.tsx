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
import { useCallback, useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
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
  type CountryGeoIndex,
} from "@/features/countries/schemas";
import {
  ProductFitPanel,
  type ProductFitCommittedFilters,
  type ProductFitInitialFilters,
} from "@/components/products/product-fit-panel";
import { parseApiErrorMessage, toUserFacingErrorMessage } from "@/lib/api-error";
import { isNavigableEvidenceUrl } from "@/lib/source-link";
import { cn } from "@/lib/utils";

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
  countryIndex: CountryGeoIndex;
  initialFilters?: ProductFitInitialFilters;
  iso3: string | null;
  onClose: () => void;
  onSelectCountry: (iso3: string) => void;
  registerProductFitNavigationGuard: (
    cancelPendingEvaluation: (() => void) | null,
  ) => void;
};

const statusLabels = {
  adopted: "已采纳",
  effective: "已生效",
  proposed: "拟议",
  superseded: "已被取代",
} as const;

const statusAtAsOfLabels = {
  adopted: "查询日已采纳",
  effective: "查询日已生效",
} as const;

const coverageLabels = {
  covered: "已发布证据边界",
  demo: "虚构演示记录",
  no_data: "暂无详情数据",
  none: "未设置",
  planned: "计划覆盖",
} as const;

function formatDate(value: string | null) {
  return value ?? "未记录";
}

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
  iso3,
  onClose,
  onSelectCountry,
  registerProductFitNavigationGuard,
}: CountryDetailDrawerProps) {
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
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

    const abortController = new AbortController();
    const asOfParam = fetchAsOf
      ? `?asOf=${encodeURIComponent(fetchAsOf)}`
      : "";

    void fetch(`/api/countries/${iso3}${asOfParam}`, {
      headers: {
        accept: "application/json",
      },
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await parseApiErrorMessage(response, "国家详情请求失败"),
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
            "国家详情暂时无法加载，请关闭后重试。",
          ),
          requestedAsOf: fetchAsOf,
          status: "error",
        });
      });

    return () => {
      abortController.abort();
    };
  }, [fetchAsOf, iso3, reloadKey]);

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
            COUNTRY PROFILE
          </p>
          <DrawerTitle>
            {currentDetail.status === "ready" &&
            currentDetail.response.status === "available"
              ? currentDetail.response.country.nameEn
              : (iso3 ?? "国家详情")}
          </DrawerTitle>
          <DrawerDescription id="country-drawer-description">
            按查询日期展示结构化事实与来源；本页不会把 Demo 记录描述为真实法规。
          </DrawerDescription>
          <DrawerClose asChild>
            <Button
              aria-label="关闭国家详情"
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
            切换国家
          </label>
          <select
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            id="drawer-country-select"
            onChange={(event) => onSelectCountry(event.target.value)}
            value={iso3 ?? ""}
          >
            {countryIndex.map((country) => (
              <option key={country.iso3} value={country.iso3}>
                {country.name} · {country.iso3}
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
                  正在从国家 API 获取详情…
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
              <p className="mt-3 font-semibold">详情加载失败</p>
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
                重试
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
                {currentDetail.response.iso3} 暂无数据
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                地图中包含该国家边界，但数据库尚未录入国家资料。系统不会用空白内容或模型推测代替事实。
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
            当前 URL 可直接复制分享；刷新后仍会恢复此国家。
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
  const { country } = response;
  const contextKey = `${country.iso3}:${JSON.stringify(initialFilters ?? {})}`;
  const [committedFilters, setCommittedFilters] = useState<{
    contextKey: string;
    filters: ProductFitCommittedFilters;
  } | null>(null);
  const chatFilters =
    committedFilters?.contextKey === contextKey
      ? committedFilters.filters
      : initialFilters;
  const handleEvaluationCommitted = useCallback(
    (filters: ProductFitCommittedFilters) => {
      setCommittedFilters({ contextKey, filters });
    },
    [contextKey],
  );

  return (
    <div className="space-y-5" data-testid="country-detail">
      {country.isDemo || country.source.isDemo ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle aria-hidden="true" className="size-4" />
            国家基础记录或其来源为虚构 Demo
          </div>
          <p className="mt-1.5 text-xs leading-5">
            国家名称与基础资料用于测试交互；法规、市场、产品和来源请以每条卡片的分类徽标与核验日期为准。
          </p>
        </div>
      ) : null}

      <section aria-labelledby="country-basics">
        <div className="flex items-center gap-2">
          <MapPin aria-hidden="true" className="size-4 text-primary" />
          <h2 className="font-semibold" id="country-basics">
            国家概览
          </h2>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <DetailItem label="ISO3" value={country.iso3} />
          <DetailItem label="ISO2" value={country.iso2} />
          <DetailItem label="本地名称" value={country.nameLocal ?? "未记录"} />
          <DetailItem
            label="数据覆盖"
            value={coverageLabels[country.dataCoverageStatus]}
          />
          <DetailItem label="区域" value={country.regionCode ?? "未记录"} />
          <DetailItem
            label="子区域"
            value={country.subregionCode ?? "未记录"}
          />
        </dl>
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          “已发布证据边界”只表示存在经治理发布、可追溯的资料，不保证每个应用场景都有数值；“最近核验”表示来源核对时间，不等于外部法规专家或法律签核。虚构 Demo 仅用于验证流程。
        </p>
      </section>

      <RegulationSection
        emptyMessage="在本次截止日期没有结构化的当前有效法规。"
        heading="当前有效法规"
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
          继续形成销售分析
        </h2>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          将当前国家、用途、功率、日期及已选择的产品型号带入对话；对话结果仍需复核来源，不能替代正式认证或销售审批。
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
          在对话中分析
        </a>
      </section>

      <RegulationSection
        emptyMessage="没有已通过且将在未来生效的结构化法规。拟议法规不会列入此处。"
        heading="未来已通过法规"
        id="future-regulations"
        regulations={country.futureAdoptedRegulations}
      />

      <section aria-labelledby="country-jurisdictions">
        <div className="flex items-center gap-2">
          <Landmark aria-hidden="true" className="size-4 text-primary" />
          <h2 className="font-semibold" id="country-jurisdictions">
            适用司法辖区
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
                  编码：{jurisdiction.code} · 成员有效期：
                  {jurisdiction.validFrom} → {jurisdiction.validTo ?? "开放"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  辖区来源：<SourceLink source={jurisdiction.source} /> · 核验{" "}
                  {jurisdiction.jurisdictionVerifiedAt.slice(0, 10)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  成员关系来源：
                  <SourceLink source={jurisdiction.membershipSource} /> · 核验{" "}
                  {jurisdiction.verifiedAt.slice(0, 10)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
            当前截止日期没有可展示的适用司法辖区。
          </div>
        )}
      </section>

      <section aria-labelledby="market-metrics">
        <div className="flex items-center gap-2">
          <BarChart3 aria-hidden="true" className="size-4 text-primary" />
          <h2 className="font-semibold" id="market-metrics">
            市场指标
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
                      {metric.applicationScope ?? "全场景"}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-2xl font-semibold tracking-tight">
                  {Number(metric.valueNumeric).toLocaleString()}{" "}
                  <span className="text-sm font-medium text-muted-foreground">
                    {metric.unitCode}
                  </span>
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {metric.definition}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  期间：{metric.periodStart} → {metric.periodEnd} · 方法版本：
                  {metric.methodologyVersion}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  指标发布：{metric.publishedOn ?? "未记录"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  来源：<SourceLink source={metric.source} /> · 核验：
                  {metric.source.verifiedAt.slice(0, 10)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
            尚无可展示的结构化市场指标。
          </div>
        )}
      </section>

      <section aria-labelledby="country-source">
        <div className="flex items-center gap-2">
          <Database aria-hidden="true" className="size-4 text-primary" />
          <h2 className="font-semibold" id="country-source">
            数据来源与核验
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
                {source.publisher ?? "未记录发布机构"}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarDays aria-hidden="true" className="size-3.5" />
                最近核验：{source.verifiedAt.slice(0, 10)}
              </div>
            </article>
          ))}
        </div>
        <div className="mt-3 rounded-2xl bg-primary/5 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Orbit aria-hidden="true" className="size-4 text-primary" />
            详情核验时间
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            最近核验：{country.lastVerifiedAt.slice(0, 10)} ·
            详情截止日期：{response.asOf}
          </p>
          {country.isStale ? (
            <p
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900"
              data-testid="country-stale-badge"
            >
              <AlertTriangle aria-hidden="true" className="size-3" />
              核验可能过期，引用前请核实最新来源
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
                    {statusAtAsOfLabels[regulation.statusAtAsOf]}
                  </span>
                  {regulation.status !== regulation.statusAtAsOf ? (
                    <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                      当前记录：{statusLabels[regulation.status]}
                    </span>
                  ) : null}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <DetailItem
                  label="生效日期"
                  value={formatDate(regulation.effectiveFrom)}
                />
                <DetailItem
                  label="结束日期"
                  value={formatDate(regulation.effectiveTo)}
                />
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                法规记录 ID：{regulation.id}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                来源：<SourceLink source={regulation.source} /> · 核验：
                {regulation.source.verifiedAt.slice(0, 10)}
              </p>
              <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                <p>
                  适用辖区：
                  {regulation.applicability.jurisdiction.name}（
                  {regulation.applicability.jurisdiction.code}） · 成员有效期：
                  {regulation.applicability.membership.validFrom} →{" "}
                  {regulation.applicability.membership.validTo ?? "开放"}
                </p>
                <p className="mt-1">
                  辖区来源：
                  <SourceLink
                    source={regulation.applicability.jurisdiction.source}
                  />
                </p>
                <p className="mt-1">
                  成员关系来源：
                  <SourceLink
                    source={regulation.applicability.membership.source}
                  />
                </p>
              </div>
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
  return (
    <span
      className={
        isDemo
          ? "shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900"
          : "shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900"
      }
    >
      {isDemo ? "虚构 Demo" : "已核验来源"}
    </span>
  );
}

type CountrySource = AvailableCountryResponse["country"]["sources"][number];

function SourceLink({ source }: { source: CountrySource }) {
  if (!isNavigableEvidenceUrl(source.url)) {
    return (
      <span>
        {source.title}
        {source.isDemo ? "（虚构证据，无外部链接）" : ""}
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
