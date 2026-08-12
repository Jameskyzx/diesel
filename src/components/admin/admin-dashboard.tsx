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
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

type AdminDashboardProps = {
  initialPrincipal: AdminPrincipal;
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
      valueNumeric: 1,
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
          limitValue: 1,
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

export function AdminDashboard({
  initialPrincipal,
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

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
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
  ) {
    await runAction(async () => {
      await responseJson(
        await fetch(`/api/admin/drafts/${draftId}/${action}`, {
          body: JSON.stringify({
            reason:
              action === "review"
                ? "审核人确认结构和来源信息。"
                : "审核完成，批准发布到正式查询。",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
      setNotice(action === "review" ? "草稿已审核。" : "版本已发布。");
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
          className="grid min-h-48 place-items-center rounded-2xl border bg-card text-center"
          data-testid="admin-dashboard-loading"
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
          <SourceVerificationForm busy={busy} runAction={runAction} />
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
              {(dashboard?.drafts ?? []).map((draft) => (
                <tr className="border-b align-top" key={draft.id}>
                  <td className="py-3 pr-3">
                    <p className="font-medium">{entityLabels[draft.entityType]}</p>
                    <p className="max-w-60 truncate text-xs text-muted-foreground">{draft.entityKey}</p>
                  </td>
                  <td className="py-3 pr-3">v{draft.version}</td>
                  <td className="py-3 pr-3">
                    <span className="rounded-full border px-2 py-1 text-xs">{draft.workflowStatus}</span>
                  </td>
                  <td className="py-3 pr-3 text-xs">{draft.createdBy}</td>
                  <td className="max-w-60 py-3 pr-3 text-xs">{draft.changeReason}</td>
                  <td className="py-3">
                    <div className="flex gap-2">
                      {canReview && draft.workflowStatus === "draft" ? (
                        <Button
                          disabled={busy}
                          onClick={() => void transitionDraft(draft.id, "review")}
                          size="sm"
                          variant="outline"
                        >
                          审核
                        </Button>
                      ) : null}
                      {canReview && draft.workflowStatus === "reviewed" ? (
                        <Button
                          disabled={busy}
                          onClick={() => void transitionDraft(draft.id, "publish")}
                          size="sm"
                        >
                          发布
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
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

type ActionRunner = (action: () => Promise<void>) => Promise<void>;

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
    });
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
    });
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
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={upload}>
        <input accept=".txt,.md,.markdown" className={inputClass} name="file" required type="file" />
        <input className={inputClass} name="title" placeholder="文档标题" required />
        <input className={inputClass} name="sourceTitle" placeholder="来源标题" required />
        <input className={inputClass} name="changeReason" placeholder="上传原因" required />
        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <input name="isDemo" type="checkbox" value="true" />
          虚构 Demo 文档
        </label>
        <input
          className={inputClass}
          name="demoNotice"
          placeholder="Demo 说明（勾选时必填）"
        />
        <input name="documentType" type="hidden" value="other" />
        <input name="languageCode" type="hidden" value="en" />
        <input name="sourceType" type="hidden" value="other" />
        <Button className="sm:col-span-2" disabled={busy} type="submit" variant="outline">
          上传为 Draft
        </Button>
      </form>
      <form className="mt-5 grid gap-3 border-t pt-5 sm:grid-cols-2" onSubmit={reprocess}>
        <input className={inputClass} name="documentId" placeholder="Draft 文档 UUID" required />
        <input className={inputClass} name="reprocesstitle" placeholder="文档标题" required />
        <input className={inputClass} name="reprocesssourceTitle" placeholder="来源标题" required />
        <input className={inputClass} name="reason" placeholder="重新处理原因" required />
        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <input name="reprocessisDemo" type="checkbox" value="true" />
          重新处理为虚构 Demo
        </label>
        <input
          className={inputClass}
          name="reprocessdemoNotice"
          placeholder="Demo 说明（勾选时必填）"
        />
        <input name="reprocessdocumentType" type="hidden" value="other" />
        <input name="reprocesslanguageCode" type="hidden" value="en" />
        <input name="reprocesssourceType" type="hidden" value="other" />
        <Button className="sm:col-span-2" disabled={busy} type="submit" variant="outline">
          重新处理 Draft 文档
        </Button>
      </form>
    </div>
  );
}

function SourceVerificationForm({
  busy,
  runAction,
}: {
  busy: boolean;
  runAction: ActionRunner;
}) {
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const sourceId = String(formData.get("sourceId") ?? "");
    await runAction(async () => {
      await responseJson(
        await fetch(`/api/admin/sources/${sourceId}/verify`, {
          body: JSON.stringify({
            reason: formData.get("reason"),
            verifiedAt: new Date(
              String(formData.get("verifiedAt")),
            ).toISOString(),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
    });
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
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={verify}>
        <input className={inputClass} name="sourceId" placeholder="来源 UUID" required />
        <input className={inputClass} name="verifiedAt" required type="datetime-local" />
        <input className={inputClass} name="reason" placeholder="核验说明" required />
        <Button disabled={busy} type="submit" variant="outline">
          更新核验时间
        </Button>
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
    });
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
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={archive}>
        <select className={inputClass} name="entityType">
          {governedEntityTypes.map((value) => (
            <option key={value} value={value}>
              {entityLabels[value]}
            </option>
          ))}
        </select>
        <input
          className={inputClass}
          name="entityKey"
          placeholder="ISO3 或实体 UUID"
          required
        />
        <input
          className={inputClass}
          name="reason"
          placeholder="归档原因"
          required
        />
        <Button disabled={busy} type="submit" variant="outline">
          确认软归档
        </Button>
      </form>
    </div>
  );
}
