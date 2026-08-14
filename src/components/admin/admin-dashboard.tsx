"use client";

import {
  Archive,
  CheckCircle2,
  Database,
  FileCheck2,
  FileUp,
  History,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  Fragment,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { appendDocumentMetadata } from "@/domain/admin/normalize-document-form";
import {
  adminDashboardResponseSchema,
  governedEntityTypes,
  type AdminDashboardResponse,
  type AdminPrincipal,
} from "@/features/admin/schemas";
import { cn } from "@/lib/utils";
import { isNavigableEvidenceUrl } from "@/lib/source-link";

type AdminDashboardProps = {
  fdeDemoMode?: boolean;
  initialPrincipal: AdminPrincipal;
  initialUtcNow: string;
};

const previewResponseSchema = z
  .object({
    batchId: z.uuid(),
    errors: z.array(
      z.object({
        field: z.string().nullable(),
        message: z.string(),
        rowNumber: z.number().int().positive(),
      }),
    ),
    invalidRows: z.number().int().nonnegative(),
    rows: z.array(
      z
        .object({
          parsed: z.record(z.string(), z.unknown()).nullable(),
          rowNumber: z.number().int().positive(),
        })
        .strict(),
    ),
    status: z.literal("previewed"),
    totalRows: z.number().int().nonnegative(),
    validRows: z.number().int().nonnegative(),
  })
  .passthrough();

const entityLabels = {
  country: "国家数据",
  data_source: "数据来源",
  document: "文档",
  jurisdiction: "司法辖区",
  market_metric: "市场指标",
  product: "产品",
  product_certification: "产品认证",
  regulation: "法规版本",
} as const;

const demoSourceId = "00000000-0000-4000-8000-000000000001";
const demoJurisdictionId = "00000000-0000-4000-8000-000000000101";

function initialPayload(entityType: string): string {
  const verifiedAt = "2026-07-29T00:00:00.000Z";
  const samples: Record<string, object> = {
    country: {
      dataCoverageStatus: "demo",
      dataSourceId: demoSourceId,
      isDemo: true,
      iso2: "TT",
      iso3: "TST",
      nameEn: "DEMO ONLY — Test country",
      nameLocal: null,
      regionCode: "DEMO",
      subregionCode: "DEMO",
      verifiedAt,
    },
    data_source: {
      demoNotice: "FICTIONAL DEMO DATA — NOT FOR PRODUCTION.",
      isDemo: true,
      publishedOn: "2026-07-29",
      publisher: "Demo Data Steward",
      sourceType: "demo",
      title: "DEMO ONLY — Governance source",
      url: null,
      verifiedAt,
    },
    document: {
      documentId: "00000000-0000-4000-8000-000000000501",
    },
    jurisdiction: {
      code: "DEMO-TST-AUTHORITY",
      countryIso3: "TST",
      dataSourceId: demoSourceId,
      isDemo: true,
      memberships: [
        {
          countryIso3: "TST",
          dataSourceId: demoSourceId,
          isDemo: true,
          validFrom: "2000-01-01",
          validTo: null,
          verifiedAt,
        },
      ],
      name: "DEMO ONLY — Test jurisdiction",
      type: "country",
      verifiedAt,
      websiteUrl: null,
    },
    market_metric: {
      applicationScope: "non-road",
      countryIso3: "CHN",
      currencyCode: null,
      dataSourceId: demoSourceId,
      definition: "DEMO ONLY — Draft metric.",
      isDemo: true,
      methodologyVersion: "demo-v1",
      metricCode: "DEMO_DRAFT_METRIC",
      metricName: "DEMO ONLY — Draft metric",
      periodEnd: "2026-01-01",
      periodStart: "2025-01-01",
      publishedOn: "2026-07-29",
      unitCode: "units",
      valueNumeric: "1",
      verifiedAt,
    },
    product: {
      applicationScopes: ["non-road"],
      availableFrom: "2026-01-01",
      availableTo: null,
      dataSourceId: demoSourceId,
      description: "DEMO ONLY — Draft product.",
      isDemo: true,
      modelCode: "DEMO-DRAFT-ENGINE",
      name: "DEMO ONLY — Draft engine",
      parameters: {},
      powerMaxKw: 200,
      powerMinKw: 100,
      specificationVersion: "draft-v1",
      verifiedAt,
    },
    product_certification: {
      applicationScope: "non-road",
      certificateNumber: "DEMO-DRAFT-CERT",
      dataSourceId: demoSourceId,
      isDemo: true,
      powerMaxKw: 150,
      powerMinKw: 50,
      productId: "00000000-0000-4000-8000-000000000201",
      regulationId: "00000000-0000-4000-8000-000000000201",
      status: "pending",
      validFrom: "2026-01-01",
      validTo: null,
      verifiedAt,
    },
    regulation: {
      adoptedOn: "2026-01-01",
      canonicalName: "DEMO ONLY — Draft regulation version",
      citationCode: "DEMO-DRAFT-REG",
      dataSourceId: demoSourceId,
      effectiveFrom: "2027-01-01",
      effectiveTo: null,
      isDemo: true,
      jurisdictionId: demoJurisdictionId,
      limits: [
        {
          applicationScope: "non-road",
          dataSourceId: demoSourceId,
          engineTypeCode: "CI",
          isDemo: true,
          limitValue: "1",
          measurementBasis: "DEMO",
          pollutantCode: "NOX",
          powerMaxKw: 200,
          powerMinKw: 100,
          testCycleCode: "DEMO",
          unitCode: "g/kWh",
          validFrom: "2027-01-01",
          validTo: null,
          verifiedAt,
        },
      ],
      proposedOn: "2025-01-01",
      status: "adopted",
      summary: "DEMO ONLY — Not a real regulation.",
      verifiedAt,
    },
  };

  return JSON.stringify(samples[entityType] ?? {}, null, 2);
}

async function responseJson(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    throw new Error(
      response.ok ? "管理响应格式无效。" : "管理操作失败。",
    );
  }
  if (!response.ok) {
    const parsed = z
      .object({
        error: z.object({ message: z.string() }).passthrough(),
      })
      .passthrough()
      .safeParse(body);
    throw new Error(
      parsed.success ? parsed.data.error.message : "管理操作失败。",
    );
  }
  return body;
}

function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <label className="text-xs font-semibold text-muted-foreground" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40";

type PayloadDiff = {
  after: string;
  before: string;
  path: string;
};

function jsonValueText(value: unknown): string {
  if (value === undefined) return "（不存在）";
  return JSON.stringify(value);
}

function flattenPayload(
  value: unknown,
  path = "$",
  result = new Map<string, unknown>(),
): Map<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length === 0) result.set(path, value);
    value.forEach((item, index) =>
      flattenPayload(item, `${path}[${index}]`, result),
    );
    return result;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) result.set(path, value);
    for (const [key, item] of entries) {
      flattenPayload(item, `${path}.${key}`, result);
    }
    return result;
  }
  result.set(path, value);
  return result;
}

function payloadDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): PayloadDiff[] {
  const beforeValues = flattenPayload(before);
  const afterValues = flattenPayload(after);
  return Array.from(new Set([...beforeValues.keys(), ...afterValues.keys()]))
    .toSorted()
    .filter(
      (path) =>
        jsonValueText(beforeValues.get(path)) !==
        jsonValueText(afterValues.get(path)),
    )
    .map((path) => ({
      after: jsonValueText(afterValues.get(path)),
      before: jsonValueText(beforeValues.get(path)),
      path,
    }));
}


export function AdminDashboard({
  fdeDemoMode = false,
  initialPrincipal,
  initialUtcNow,
}: AdminDashboardProps) {
  const [dashboard, setDashboard] =
    useState<AdminDashboardResponse | null>(null);
  const [entityType, setEntityType] =
    useState<(typeof governedEntityTypes)[number]>("country");
  const [payload, setPayload] = useState(() => initialPayload("country"));
  const [changeReason, setChangeReason] = useState(
    "创建待审核的数据修订。",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftActionReasons, setDraftActionReasons] = useState<
    Record<string, string>
  >({});
  const [publishConfirmations, setPublishConfirmations] = useState<
    Record<string, boolean>
  >({});
  const [preview, setPreview] = useState<z.infer<
    typeof previewResponseSchema
  > | null>(null);
  const dashboardAbortControllerRef = useRef<AbortController | null>(null);
  const canReview =
    initialPrincipal.role === "reviewer" ||
    initialPrincipal.role === "admin";

  const loadDashboard = useCallback(async () => {
    dashboardAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    dashboardAbortControllerRef.current = abortController;

    try {
      const response = await fetch("/api/admin/dashboard", {
        cache: "no-store",
        signal: abortController.signal,
      });
      const parsed = adminDashboardResponseSchema.parse(
        await responseJson(response),
      );
      if (
        abortController.signal.aborted ||
        dashboardAbortControllerRef.current !== abortController
      ) {
        return;
      }
      setDashboard(parsed);
      setError(null);
    } catch (loadError: unknown) {
      if (
        abortController.signal.aborted ||
        (loadError instanceof DOMException && loadError.name === "AbortError")
      ) {
        return;
      }
      throw loadError;
    } finally {
      if (dashboardAbortControllerRef.current === abortController) {
        dashboardAbortControllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadDashboard().catch((loadError: unknown) => {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "无法加载管理数据。",
        );
      });
    }, 0);

    return () => {
      clearTimeout(timer);
      dashboardAbortControllerRef.current?.abort();
      dashboardAbortControllerRef.current = null;
    };
  }, [loadDashboard]);

  async function runAction(
    action: () => Promise<void>,
    successMessage?: string,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (actionError: unknown) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "管理操作失败。",
      );
      setBusy(false);
      return;
    }

    try {
      await loadDashboard();
    } catch (refreshError: unknown) {
      const message =
        refreshError instanceof Error
          ? refreshError.message
          : "刷新失败，请重试。";
      setError(`操作已完成，但管理数据刷新失败：${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const parsedPayload = JSON.parse(payload) as unknown;
      await responseJson(
        await fetch("/api/admin/drafts", {
          body: JSON.stringify({
            changeReason,
            entityType,
            payload: parsedPayload,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      setNotice("草稿已创建，正式查询仍使用当前已发布版本。");
    });
  }

  async function transitionDraft(
    draftId: string,
    action: "publish" | "review",
    reason: string,
  ) {
    await runAction(async () => {
      await responseJson(
        await fetch(`/api/admin/drafts/${draftId}/${action}`, {
          body: JSON.stringify({
            reason,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      setNotice(action === "review" ? "草稿已审核。" : "版本已发布。");
      setDraftActionReasons((current) => ({ ...current, [draftId]: "" }));
      setPublishConfirmations((current) => ({
        ...current,
        [draftId]: false,
      }));
    });
  }

  async function previewCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPreview(null);
    await runAction(async () => {
      const body = new FormData(form);
      const parsed = previewResponseSchema.parse(
        await responseJson(
          await fetch("/api/admin/imports/market/preview", {
            body,
            method: "POST",
          }),
        ),
      );
      setPreview(parsed);
      setNotice("CSV 只完成预览；尚未写入市场指标或草稿。");
    });
  }

  async function confirmCsv() {
    if (!preview) {
      return;
    }
    await runAction(async () => {
      const result = await responseJson(
        await fetch(
          `/api/admin/imports/market/${preview.batchId}/confirm`,
          {
            body: JSON.stringify({
              reason: "确认 CSV 预览并创建待审核市场指标草稿。",
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          },
        ),
      );
      const parsed = z
        .object({
          createdDrafts: z.number().int().nonnegative(),
          status: z.enum(["committed", "rejected"]),
        })
        .parse(result);
      setNotice(
        parsed.status === "committed"
          ? `已原子创建 ${parsed.createdDrafts} 条草稿，尚未发布。`
          : "预览包含错误，批次已拒绝且未写入任何草稿或市场事实。",
      );
      setPreview(null);
    });
  }

  const draftCounts = useMemo(() => {
    const counts = { draft: 0, published: 0, reviewed: 0 };
    for (const draft of dashboard?.drafts ?? []) {
      counts[draft.workflowStatus] += 1;
    }
    return counts;
  }, [dashboard]);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {fdeDemoMode ? (
        <section
          aria-labelledby="fde-demo-guide"
          className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 text-amber-950"
          data-testid="fde-demo-banner"
        >
          <p className="text-xs font-black tracking-[0.18em]">
            LOCAL / MUTABLE / FICTIONAL
          </p>
          <h1 className="mt-2 text-xl font-semibold" id="fde-demo-guide">
            FDE 本地实施向导
          </h1>
          <p className="mt-2 text-sm leading-6">
            此模式只运行在 loopback + development + PGlite。每次启动都是新的进程内数据库；不会连接或修改 jamesky.site 的生产数据。
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {(["editor", "reviewer", "admin"] as const).map((role) => (
              <a
                aria-current={initialPrincipal.role === role ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1.5 font-semibold",
                  initialPrincipal.role === role
                    ? "border-amber-700 bg-amber-200"
                    : "border-amber-400 bg-white",
                )}
                href={`/__fde/persona?role=${role}`}
                key={role}
              >
                切换 {role}
              </a>
            ))}
          </div>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6">
            <li>
              Editor 下载并上传
              <a className="mx-1 font-semibold underline" href="/__fde/fixtures/invalid.csv">
                错误 CSV
              </a>
              ，点击“预览并校验”，确认 value_numeric 与期间字段错误可见。
            </li>
            <li>
              再上传
              <a className="mx-1 font-semibold underline" href="/__fde/fixtures/corrected.csv">
                修正版 FDE_DEMO_PIPELINE_INDEX
              </a>
              ，预览后确认批次，生成 Draft。
            </li>
            <li>
              切换 Reviewer，展开 Draft，核对 payload、diff、依赖和来源，填写理由后 Review，再确认 Publish。
            </li>
            <li>
              打开
              <Link
                className="mx-1 font-semibold underline"
                href="/countries/CHN?applicationScope=non-road&asOf=2026-08-15&powerKw=100"
              >
                CHN 查询深链
              </Link>
              ，在市场指标区确认新指标已进入正式查询。
            </li>
            <li>
              切换 Admin，从发布队列复制该市场指标 UUID，在“软归档已发布实体”选择 market_metric 并归档；刷新深链确认恢复原状态。
            </li>
          </ol>
        </section>
      ) : null}
      <header className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-primary">
              DATA GOVERNANCE CONTROL PLANE
            </p>
            <h1 className="mt-2 text-2xl font-semibold">管理后台与发布审核</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              编辑写入独立草稿，审核后才能发布。市场 CSV 必须先预览再确认；
              删除使用归档，所有状态变化追加写入审计记录。
            </p>
          </div>
          <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">
            <p className="font-medium">{initialPrincipal.email}</p>
            <p className="text-xs text-muted-foreground">
              角色：{initialPrincipal.role}
            </p>
          </div>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
          {notice}
        </div>
      ) : null}

      {!dashboard && !error ? (
        <div
          aria-busy="true"
          aria-live="polite"
          className="grid min-h-48 place-items-center rounded-2xl border bg-card text-center"
          data-testid="admin-dashboard-loading"
          role="status"
        >
          <div>
            <LoaderCircle
              aria-hidden="true"
              className="mx-auto size-7 animate-spin text-primary"
            />
            <p className="mt-3 text-sm text-muted-foreground">
              正在加载治理数据…
            </p>
          </div>
        </div>
      ) : null}

      {dashboard ? (
        <section className="grid gap-3 sm:grid-cols-3">
          {[
            ["Draft", draftCounts.draft],
            ["Reviewed", draftCounts.reviewed],
            ["Published revisions", draftCounts.published],
          ].map(([label, value]) => (
            <div className="rounded-xl border bg-card p-4" key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2">
            <Database className="size-5 text-primary" aria-hidden="true" />
            <div>
              <h2 className="font-semibold">结构化数据修订</h2>
              <p className="text-xs text-muted-foreground">
                国家、法规版本、产品、认证、市场指标与来源
              </p>
            </div>
          </div>
          <form className="mt-5 space-y-4" onSubmit={createDraft}>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="admin-entity-type">数据类型</FieldLabel>
              <select
                className={inputClass}
                id="admin-entity-type"
                onChange={(event) => {
                  const next = event.target
                    .value as (typeof governedEntityTypes)[number];
                  setEntityType(next);
                  setPayload(initialPayload(next));
                }}
                value={entityType}
              >
                {governedEntityTypes
                  .filter((value) => value !== "document")
                  .map((value) => (
                    <option key={value} value={value}>
                      {entityLabels[value]}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="admin-change-reason">变更原因</FieldLabel>
              <input
                className={inputClass}
                id="admin-change-reason"
                onChange={(event) => setChangeReason(event.target.value)}
                required
                value={changeReason}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="admin-payload">结构化 JSON</FieldLabel>
              <textarea
                className={cn(inputClass, "min-h-80 font-mono text-xs")}
                id="admin-payload"
                onChange={(event) => setPayload(event.target.value)}
                spellCheck={false}
                value={payload}
              />
            </div>
            <Button disabled={busy} type="submit">
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
              保存 Draft
            </Button>
          </form>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-2">
              <Upload className="size-5 text-primary" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">市场指标 CSV</h2>
                <p className="text-xs text-muted-foreground">
                  预览和校验不会写入事实；确认只原子创建草稿
                </p>
              </div>
            </div>
            <form className="mt-4 space-y-3" onSubmit={previewCsv}>
              <FieldLabel htmlFor="market-csv-file">CSV 文件</FieldLabel>
              <input
                accept=".csv,text/csv"
                className={inputClass}
                id="market-csv-file"
                name="file"
                onChange={() => {
                  setPreview(null);
                  setNotice(null);
                  setError(null);
                }}
                required
                type="file"
              />
              <Button disabled={busy} type="submit" variant="outline">
                预览并校验
              </Button>
            </form>
            {preview ? (
              <div className="mt-4 rounded-xl border bg-muted/30 p-3 text-sm">
                <p>
                  总行数 {preview.totalRows} · 有效 {preview.validRows} · 错误{" "}
                  {preview.invalidRows}
                </p>
                {preview.errors.map((item) => (
                  <p className="mt-1 text-xs text-destructive" key={`${item.rowNumber}:${item.field}:${item.message}`}>
                    第 {item.rowNumber} 行 {item.field ?? "整行"}：{item.message}
                  </p>
                ))}
                <div className="mt-3 max-h-56 overflow-auto rounded-lg border bg-background">
                  <table className="w-full min-w-[620px] text-left text-xs">
                    <thead className="sticky top-0 border-b bg-background">
                      <tr>
                        <th className="px-2 py-2">行</th>
                        <th className="px-2 py-2">校验后的预览</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 20).map((row) => (
                        <tr className="border-b align-top" key={row.rowNumber}>
                          <td className="px-2 py-2">{row.rowNumber}</td>
                          <td className="px-2 py-2 font-mono">
                            {row.parsed
                              ? JSON.stringify(row.parsed)
                              : "无有效记录；请根据上方错误修正 CSV"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button
                  className="mt-3"
                  disabled={busy || preview.invalidRows > 0}
                  onClick={confirmCsv}
                  type="button"
                >
                  确认批次
                </Button>
              </div>
            ) : null}
          </div>

          <DocumentAdminForms busy={busy} runAction={runAction} />
          <SourceVerificationForm
            busy={busy}
            initialUtcNow={initialUtcNow}
            runAction={runAction}
          />
          {initialPrincipal.role === "admin" ? (
            <ArchiveEntityForm busy={busy} runAction={runAction} />
          ) : null}
        </section>
      </div>

      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            <div>
              <h2 className="font-semibold">发布队列</h2>
              <p className="text-xs text-muted-foreground">
                editor 与 reviewer 必须分离；admin 可执行紧急审核
              </p>
            </div>
          </div>
          <Button
            onClick={() =>
              void loadDashboard().catch((refreshError: unknown) => {
                setError(
                  refreshError instanceof Error
                    ? refreshError.message
                    : "刷新失败，请重试。",
                );
              })
            }
            size="sm"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            刷新
          </Button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">类型 / Key</th>
                <th className="py-2 pr-3">版本</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2 pr-3">创建人</th>
                <th className="py-2 pr-3">原因</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {dashboard && dashboard.drafts.length === 0 ? (
                <tr>
                  <td
                    className="py-6 text-center text-sm text-muted-foreground"
                    colSpan={6}
                  >
                    暂无待发布草稿
                  </td>
                </tr>
              ) : null}
              {(dashboard?.drafts ?? []).map((draft) => {
                const baseline = draft.reviewContext.publishedBaseline;
                const differences = baseline
                  ? payloadDiff(baseline.payload, draft.payload)
                  : [];
                const dependencies = draft.reviewContext.dependencies;
                const actionReason = draftActionReasons[draft.id] ?? "";
                const reasonId = `draft-action-reason-${draft.id}`;

                return (
                  <Fragment key={draft.id}>
                    <tr className="border-b align-top">
                      <td className="py-3 pr-3">
                        <p className="font-medium">
                          {entityLabels[draft.entityType]}
                        </p>
                        <p className="max-w-60 truncate text-xs text-muted-foreground">
                          {draft.entityKey}
                        </p>
                      </td>
                      <td className="py-3 pr-3">v{draft.version}</td>
                      <td className="py-3 pr-3">
                        <span className="rounded-full border px-2 py-1 text-xs">
                          {draft.workflowStatus}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        {draft.createdBy}
                      </td>
                      <td className="max-w-60 py-3 pr-3 text-xs">
                        {draft.changeReason}
                      </td>
                      <td className="py-3 text-xs text-muted-foreground">
                        展开详情后操作
                      </td>
                    </tr>
                    <tr className="border-b bg-muted/15">
                      <td className="py-3" colSpan={6}>
                        <details className="group rounded-xl border bg-background p-3">
                          <summary className="cursor-pointer font-semibold text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
                            查看 v{draft.version} payload、发布差异与依赖
                          </summary>

                          <div className="mt-4 grid gap-4 lg:grid-cols-2">
                            <section aria-label={`v${draft.version} 完整 payload`}>
                              <h3 className="text-sm font-semibold">
                                完整 payload
                              </h3>
                              <pre className="mt-2 max-h-96 overflow-auto rounded-lg border bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                                {JSON.stringify(draft.payload, null, 2)}
                              </pre>
                            </section>

                            <section aria-label={`v${draft.version} 发布版本差异`}>
                              <h3 className="text-sm font-semibold">
                                当前发布版本 diff
                              </h3>
                              {baseline ? (
                                <>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    基线：v{baseline.version} · 发布人
                                    {baseline.publishedBy ?? "未知"} ·
                                    {baseline.publishedAt ?? "发布时间未知"}
                                  </p>
                                  {draft.reviewContext.baselineStatus !==
                                  "active" ? (
                                    <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                                      最近发布 payload 已找到，但正式实体当前为
                                      {draft.reviewContext.baselineStatus ===
                                      "archived"
                                        ? "归档状态"
                                        : "不可核验状态"}
                                      ，因此禁止直接发布。
                                    </p>
                                  ) : null}
                                  {differences.length === 0 ? (
                                    <p className="mt-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                                      payload 与服务端查询到的当前发布基线一致。
                                    </p>
                                  ) : (
                                    <div className="mt-2 max-h-96 overflow-auto rounded-lg border">
                                      <table className="w-full min-w-[620px] text-left text-xs">
                                        <thead className="sticky top-0 bg-muted">
                                          <tr>
                                            <th className="p-2">字段路径</th>
                                            <th className="p-2">已发布</th>
                                            <th className="p-2">草稿</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {differences.slice(0, 250).map((item) => (
                                            <tr className="border-t align-top" key={item.path}>
                                              <td className="p-2 font-mono">{item.path}</td>
                                              <td className="max-w-72 break-all p-2 font-mono text-rose-800">
                                                {item.before}
                                              </td>
                                              <td className="max-w-72 break-all p-2 font-mono text-emerald-800">
                                                {item.after}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                      {differences.length > 250 ? (
                                        <p className="border-t p-2 text-xs text-amber-800">
                                          共 {differences.length} 项差异；此处显示前 250 项，请结合完整 payload 复核。
                                        </p>
                                      ) : null}
                                    </div>
                                  )}
                                </>
                              ) : draft.reviewContext.baselineStatus ===
                                "first_revision" ? (
                                <p className="mt-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                                  服务端已确认这是 v1 首个治理修订：它可能建立新实体，也可能把现有 active 种子数据纳入治理基线。首次发布将以此 payload 建立可审计基线。
                                </p>
                              ) : (
                                <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                                  服务端无法核验该实体的当前发布基线。为避免覆盖未知正式数据，发布已被禁止。
                                </p>
                              )}
                            </section>
                          </div>

                          <section className="mt-4" aria-label="来源与实体依赖">
                            <h3 className="text-sm font-semibold">
                              来源与实体依赖
                            </h3>
                            {dependencies.length === 0 ? (
                              <p className="mt-2 text-xs text-muted-foreground">
                                payload 未声明可识别的来源或父实体引用。
                              </p>
                            ) : (
                              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                                {dependencies.map((reference) => (
                                    <li
                                      className="rounded-lg border p-3 text-xs"
                                      key={`${reference.kind}:${reference.value}`}
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="font-semibold">
                                          {reference.kind} · {reference.value}
                                        </p>
                                        <span
                                          className={cn(
                                            "rounded-full border px-2 py-0.5 text-[11px]",
                                            reference.state === "active"
                                              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                                              : "border-amber-300 bg-amber-50 text-amber-950",
                                          )}
                                        >
                                          {reference.state === "active"
                                            ? "有效"
                                            : reference.state === "archived"
                                              ? "已归档"
                                              : "缺失"}
                                        </span>
                                      </div>
                                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                        {reference.path}
                                      </p>
                                      {reference.label ? (
                                        <p className="mt-1 text-muted-foreground">
                                          {reference.label}
                                          {reference.isDemo === null
                                            ? ""
                                            : reference.isDemo
                                              ? " · Demo"
                                              : " · 正式数据"}
                                        </p>
                                      ) : null}
                                      {reference.verifiedAt ? (
                                        <p className="mt-1 text-muted-foreground">
                                          最近核验：{reference.verifiedAt}
                                        </p>
                                      ) : null}
                                      {reference.url &&
                                      isNavigableEvidenceUrl(reference.url) ? (
                                        <a
                                          className="mt-1 inline-flex text-primary underline"
                                          href={reference.url}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          打开来源证据
                                        </a>
                                      ) : null}
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </section>

                          {draft.reviewContext.blockingReasons.length > 0 ? (
                            <section
                              aria-label="发布阻塞项"
                              className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950"
                            >
                              <h3 className="font-semibold">发布阻塞项</h3>
                              <ul className="mt-2 list-disc space-y-1 pl-5">
                                {draft.reviewContext.blockingReasons.map(
                                  (reason) => (
                                    <li key={reason}>{reason}</li>
                                  ),
                                )}
                              </ul>
                            </section>
                          ) : null}

                          {canReview &&
                          (draft.workflowStatus === "draft" ||
                            draft.workflowStatus === "reviewed") ? (
                            <fieldset className="mt-4 rounded-xl border border-primary/20 p-4">
                              <legend className="px-2 text-sm font-semibold">
                                {draft.workflowStatus === "draft"
                                  ? "审核决定"
                                  : "发布决定"}
                              </legend>
                              <FieldLabel htmlFor={reasonId}>
                                {draft.workflowStatus === "draft"
                                  ? "审核理由"
                                  : "发布理由"}
                              </FieldLabel>
                              <textarea
                                className={cn(inputClass, "mt-1 min-h-20")}
                                id={reasonId}
                                onChange={(event) =>
                                  setDraftActionReasons((current) => ({
                                    ...current,
                                    [draft.id]: event.target.value,
                                  }))
                                }
                                placeholder="记录核对了哪些字段、来源和依赖（至少 3 个字符）"
                                value={actionReason}
                              />
                              {draft.workflowStatus === "reviewed" ? (
                                <label className="mt-3 flex items-start gap-2 text-xs leading-5">
                                  <input
                                    checked={
                                      publishConfirmations[draft.id] ?? false
                                    }
                                    className="mt-0.5 size-4"
                                    onChange={(event) =>
                                      setPublishConfirmations((current) => ({
                                        ...current,
                                        [draft.id]: event.target.checked,
                                      }))
                                    }
                                    type="checkbox"
                                  />
                                  我已核对完整 payload、服务端发布基线和上方来源/依赖快照；确认发布会在事务内再次校验并立即改变正式查询结果。
                                </label>
                              ) : null}
                              <Button
                                className="mt-3"
                                disabled={
                                  busy ||
                                  actionReason.trim().length < 3 ||
                                  (draft.workflowStatus === "reviewed" &&
                                    (!publishConfirmations[draft.id] ||
                                      !draft.reviewContext.publishReady))
                                }
                                onClick={() =>
                                  void transitionDraft(
                                    draft.id,
                                    draft.workflowStatus === "draft"
                                      ? "review"
                                      : "publish",
                                    actionReason.trim(),
                                  )
                                }
                                size="sm"
                                type="button"
                                variant={
                                  draft.workflowStatus === "draft"
                                    ? "outline"
                                    : "default"
                                }
                              >
                                {draft.workflowStatus === "draft"
                                  ? "提交审核确认"
                                  : "确认发布版本"}
                              </Button>
                            </fieldset>
                          ) : null}
                        </details>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <History className="size-5 text-primary" aria-hidden="true" />
          <div>
            <h2 className="font-semibold">数据变更记录</h2>
            <p className="text-xs text-muted-foreground">
              记录操作者、角色、实体、动作、原因和时间
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {dashboard && dashboard.auditLogs.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
              暂无变更记录
            </p>
          ) : null}
          {(dashboard?.auditLogs ?? []).slice(0, 30).map((log) => (
            <article className="rounded-xl border bg-muted/20 p-3 text-xs" key={log.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-medium">
                  {log.action} · {entityLabels[log.entityType]} · {log.entityKey}
                </p>
                <p className="text-muted-foreground">{log.createdAt.slice(0, 19)}</p>
              </div>
              <p className="mt-1 text-muted-foreground">
                {log.actorEmail} ({log.actorRole}) · {log.reason}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

type ActionRunner = (
  action: () => Promise<void>,
  successMessage?: string,
) => Promise<void>;

function DocumentAdminForms({
  busy,
  runAction,
}: {
  busy: boolean;
  runAction: ActionRunner;
}) {
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    appendDocumentMetadata(formData);
    await runAction(async () => {
      await responseJson(
        await fetch("/api/admin/documents", {
          body: formData,
          method: "POST",
        }),
      );
    }, "文档已上传为 Draft；尚未进入正式检索。");
  }

  async function reprocess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const documentId = String(formData.get("documentId") ?? "");
    appendDocumentMetadata(formData, "reprocess");
    await runAction(async () => {
      await responseJson(
        await fetch(`/api/admin/documents/${documentId}/reprocess`, {
          body: formData,
          method: "POST",
        }),
      );
    }, "Draft 文档已重新处理；请复核处理结果后再审核。");
  }

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <FileUp className="size-5 text-primary" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">文档上传与重新处理</h2>
          <p className="text-xs text-muted-foreground">
            上传结果为 Draft；已发布文档不能原地重新处理
          </p>
        </div>
      </div>
      <form className="mt-4" onSubmit={upload}>
        <fieldset className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <legend className="px-2 text-sm font-semibold">上传新文档</legend>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            原始文件
            <input accept=".txt,.md,.markdown" className={inputClass} name="file" required type="file" />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            文档标题
            <input className={inputClass} name="title" required />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            来源标题
            <input className={inputClass} name="sourceTitle" required />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            上传原因
            <input className={inputClass} name="changeReason" required />
          </label>
          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-normal text-foreground">
            <input name="isDemo" type="checkbox" value="true" />
            虚构 Demo 文档
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            Demo 说明（勾选时必填）
            <input className={inputClass} name="demoNotice" />
          </label>
          <input name="documentType" type="hidden" value="other" />
          <input name="languageCode" type="hidden" value="en" />
          <input name="sourceType" type="hidden" value="other" />
          <Button className="sm:col-span-2" disabled={busy} type="submit" variant="outline">
            上传为 Draft
          </Button>
        </fieldset>
      </form>
      <form className="mt-5" onSubmit={reprocess}>
        <fieldset className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <legend className="px-2 text-sm font-semibold">重新处理 Draft 文档</legend>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            Draft 文档 UUID
            <input className={inputClass} name="documentId" required />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            文档标题
            <input className={inputClass} name="reprocesstitle" required />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            来源标题
            <input className={inputClass} name="reprocesssourceTitle" required />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            重新处理原因
            <input className={inputClass} name="reason" required />
          </label>
          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-normal text-foreground">
            <input name="reprocessisDemo" type="checkbox" value="true" />
            重新处理为虚构 Demo
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            Demo 说明（勾选时必填）
            <input className={inputClass} name="reprocessdemoNotice" />
          </label>
          <input name="reprocessdocumentType" type="hidden" value="other" />
          <input name="reprocesslanguageCode" type="hidden" value="en" />
          <input name="reprocesssourceType" type="hidden" value="other" />
          <Button className="sm:col-span-2" disabled={busy} type="submit" variant="outline">
            重新处理 Draft 文档
          </Button>
        </fieldset>
      </form>
    </div>
  );
}

function SourceVerificationForm({
  busy,
  initialUtcNow,
  runAction,
}: {
  busy: boolean;
  initialUtcNow: string;
  runAction: ActionRunner;
}) {
  const [verifiedAt, setVerifiedAt] = useState(initialUtcNow);
  const parsedVerifiedAt = z.iso.datetime({ offset: true }).safeParse(verifiedAt);
  const utcPreview = parsedVerifiedAt.success
    ? new Date(parsedVerifiedAt.data).toISOString()
    : null;

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const sourceId = String(formData.get("sourceId") ?? "");
    const verifiedAtInput = z.iso
      .datetime({ offset: true })
      .parse(String(formData.get("verifiedAt")));
    await runAction(async () => {
      await responseJson(
        await fetch(`/api/admin/sources/${sourceId}/verify`, {
          body: JSON.stringify({
            reason: formData.get("reason"),
            verifiedAt: new Date(verifiedAtInput).toISOString(),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
    }, "来源核验时间已按 UTC 更新并写入审计记录。");
  }

  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-5 text-primary" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">来源最近核验时间</h2>
          <p className="text-xs text-muted-foreground">每次更新均写入变更审计</p>
        </div>
      </div>
      <form className="mt-4" onSubmit={verify}>
        <fieldset className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <legend className="px-2 text-sm font-semibold">记录来源核验</legend>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            来源 UUID
            <input className={inputClass} name="sourceId" required />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            核验时间（ISO 8601，必须含时区）
            <input
              aria-describedby="source-verified-at-preview"
              className={inputClass}
              name="verifiedAt"
              onChange={(event) => setVerifiedAt(event.target.value)}
              required
              type="text"
              value={verifiedAt}
            />
          </label>
          <p
            className={cn(
              "text-xs sm:col-span-2",
              utcPreview ? "text-muted-foreground" : "text-destructive",
            )}
            id="source-verified-at-preview"
            role="status"
          >
            {utcPreview
              ? `将保存为 UTC：${utcPreview}`
              : "请输入带 Z 或明确偏移量的 ISO 8601 时间。"}
          </p>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            核验说明
            <input className={inputClass} name="reason" required />
          </label>
          <Button disabled={busy || !utcPreview} type="submit" variant="outline">
            更新核验时间
          </Button>
        </fieldset>
      </form>
    </div>
  );
}

function ArchiveEntityForm({
  busy,
  runAction,
}: {
  busy: boolean;
  runAction: ActionRunner;
}) {
  async function archive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const entityType = String(formData.get("entityType") ?? "");
    const entityKey = String(formData.get("entityKey") ?? "");
    await runAction(async () => {
      await responseJson(
        await fetch(
          `/api/admin/entities/${entityType}/${encodeURIComponent(entityKey)}/archive`,
          {
            body: JSON.stringify({
              reason: formData.get("reason"),
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          },
        ),
      );
    }, "实体已软归档；正式查询已隐藏该记录并保留审计历史。");
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-card p-5">
      <div className="flex items-center gap-2">
        <Archive className="size-5 text-amber-700" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">软归档已发布实体</h2>
          <p className="text-xs text-muted-foreground">
            仅 admin 可执行；归档后正式查询立即隐藏并保留审计记录
          </p>
        </div>
      </div>
      <form className="mt-4" onSubmit={archive}>
        <fieldset className="grid gap-3 rounded-xl border border-amber-300 p-4 sm:grid-cols-2">
          <legend className="px-2 text-sm font-semibold">归档目标与原因</legend>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            实体类型
            <select className={inputClass} name="entityType">
              {governedEntityTypes.map((value) => (
                <option key={value} value={value}>
                  {entityLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            实体 Key（ISO3 或 UUID）
            <input className={inputClass} name="entityKey" required />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
            归档原因
            <input className={inputClass} name="reason" required />
          </label>
          <Button disabled={busy} type="submit" variant="outline">
            确认软归档
          </Button>
        </fieldset>
      </form>
    </div>
  );
}
