"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSearch,
  FileUp,
  Filter,
  LoaderCircle,
  RefreshCcw,
  Search,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { applicationScopes } from "@/features/database/schemas";
import {
  documentImportResponseSchema,
  documentTypes,
  hybridSearchResponseSchema,
  knowledgeOptionsResponseSchema,
  sourceTypes,
  type DocumentImportResponse,
  type HybridSearchResponse,
  type KnowledgeOptionsResponse,
} from "@/features/knowledge/schemas";
import {
  parseApiErrorMessage,
  toUserFacingErrorMessage,
} from "@/lib/api-error";

type OptionsState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { data: KnowledgeOptionsResponse; status: "ready" };

type ImportState =
  | { status: "idle" }
  | { status: "loading" }
  | { message: string; status: "error" }
  | { response: DocumentImportResponse; status: "ready" };

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { message: string; status: "error" }
  | { response: HybridSearchResponse; status: "ready" };

const statusLabels = {
  failed: "处理失败",
  pending: "等待处理",
  processing: "处理中",
  ready: "可检索",
} as const;

function documentStatusLabel(document: {
  governanceStatus: "draft" | "reviewed" | "published";
  processingStatus: keyof typeof statusLabels;
}): string {
  if (document.processingStatus !== "ready") {
    return statusLabels[document.processingStatus];
  }
  if (document.governanceStatus === "published") {
    return "可检索";
  }
  return document.governanceStatus === "reviewed"
    ? "处理完成，待发布"
    : "处理完成，待审核";
}

const typeLabels: Record<(typeof documentTypes)[number], string> = {
  certificate: "认证证书",
  "government-notice": "政府公告",
  "industry-report": "行业报告",
  other: "其他",
  "product-manual": "产品手册",
  "regulation-text": "法规原文",
};

export function KnowledgeDebugConsole() {
  const [options, setOptions] = useState<OptionsState>({ status: "loading" });
  const [importState, setImportState] = useState<ImportState>({
    status: "idle",
  });
  const [searchState, setSearchState] = useState<SearchState>({
    status: "idle",
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    void fetch("/api/dev/knowledge/options", {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            await parseApiErrorMessage(response, "调试选项加载失败。"),
          );
        }
        return knowledgeOptionsResponseSchema.parse(await response.json());
      })
      .then((data) => setOptions({ data, status: "ready" }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setOptions({
          message: toUserFacingErrorMessage(error, "调试选项加载失败。"),
          status: "error",
        });
      });

    return () => abortController.abort();
  }, [reloadKey]);

  async function importDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImportState({ status: "loading" });

    try {
      const form = event.currentTarget;
      const response = await fetch("/api/dev/knowledge/documents", {
        body: new FormData(form),
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(
          await parseApiErrorMessage(response, "文档导入失败。"),
        );
      }

      const parsed = documentImportResponseSchema.parse(await response.json());
      setImportState({ response: parsed, status: "ready" });
      setReloadKey((value) => value + 1);
    } catch (error: unknown) {
      setImportState({
        message: toUserFacingErrorMessage(error, "文档导入失败。"),
        status: "error",
      });
    }
  }

  async function searchKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchState({ status: "loading" });
    const formData = new FormData(event.currentTarget);
    const nullable = (name: string) => {
      const value = formData.get(name);
      return typeof value === "string" && value ? value : null;
    };

    try {
      const response = await fetch("/api/dev/knowledge/search", {
        body: JSON.stringify({
          applicationScope: nullable("applicationScope"),
          asOf: nullable("asOf"),
          countryIso3: nullable("countryIso3"),
          jurisdictionId: nullable("jurisdictionId"),
          limit: 10,
          query: nullable("query"),
        }),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(
          await parseApiErrorMessage(response, "混合检索失败。"),
        );
      }

      setSearchState({
        response: hybridSearchResponseSchema.parse(await response.json()),
        status: "ready",
      });
    } catch (error: unknown) {
      setSearchState({
        message: toUserFacingErrorMessage(error, "混合检索失败。"),
        status: "error",
      });
    }
  }

  const optionData = options.status === "ready" ? options.data : null;

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="rounded-[2rem] border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
            DEVELOPMENT ONLY
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-950">
            非生产检索质量
          </span>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          知识库导入与混合检索调试
        </h1>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-muted-foreground">
          上传 UTF-8 TXT/Markdown，检查哈希去重、处理状态、章节切块、全文与向量得分及
          metadata filter。当前 embedding 是可替换的确定性开发实现，不代表生产语义检索质量。
        </p>
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section
          aria-labelledby="knowledge-import-heading"
          className="rounded-[1.75rem] border bg-card p-5 shadow-sm sm:p-6"
        >
          <div className="flex items-center gap-2">
            <FileUp aria-hidden="true" className="size-5 text-primary" />
            <h2 className="text-lg font-semibold" id="knowledge-import-heading">
              文档导入
            </h2>
          </div>

          <form className="mt-5 space-y-4" onSubmit={importDocument}>
            <label className="grid gap-1.5 text-sm font-medium">
              原始文件
              <input
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                className="rounded-xl border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1.5"
                name="file"
                required
                type="file"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="文档标题" name="title" required />
              <SelectInput
                label="文档类型"
                name="documentType"
                options={documentTypes.map((value) => ({
                  label: typeLabels[value],
                  value,
                }))}
              />
              <TextInput
                defaultValue="DEMO ONLY — Developer upload source"
                label="来源名称"
                name="sourceTitle"
                required
              />
              <SelectInput
                label="来源类型"
                name="sourceType"
                options={sourceTypes.map((value) => ({
                  label: value,
                  value,
                }))}
                value="demo"
              />
              <TextInput label="发布机构" name="sourcePublisher" />
              <TextInput
                defaultValue="zh-CN"
                label="语言代码"
                name="languageCode"
                required
              />
              <SelectInput
                emptyLabel="不限定国家"
                label="国家"
                name="countryIso3"
                options={(optionData?.countries ?? []).map((country) => ({
                  label: `${country.name} · ${country.iso3}`,
                  value: country.iso3,
                }))}
              />
              <SelectInput
                emptyLabel="不限定管辖区域"
                label="管辖区域"
                name="jurisdictionId"
                options={(optionData?.jurisdictions ?? []).map(
                  (jurisdiction) => ({
                    label: jurisdiction.name,
                    value: jurisdiction.id,
                  }),
                )}
              />
              <SelectInput
                emptyLabel="不限定应用场景"
                label="应用场景"
                name="applicationScope"
                options={applicationScopes.map((value) => ({
                  label: value,
                  value,
                }))}
              />
              <TextInput label="发布日期" name="publishedOn" type="date" />
              <TextInput label="有效期开始" name="validFrom" type="date" />
              <TextInput label="有效期结束" name="validTo" type="date" />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                defaultChecked
                className="size-4"
                name="isDemo"
                type="checkbox"
                value="true"
              />
              将此记录明确标记为 Demo
            </label>
            <TextInput
              defaultValue="FICTIONAL DEMO DATA — NOT A REAL REGULATION OR SOURCE."
              label="Demo 提示"
              name="demoNotice"
            />

            <Button
              className="w-full"
              disabled={importState.status === "loading"}
              type="submit"
            >
              {importState.status === "loading" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
              ) : (
                <FileUp aria-hidden="true" className="size-4" />
              )}
              保存并处理文档
            </Button>
          </form>

          <ImportFeedback state={importState} />
        </section>

        <section
          aria-labelledby="knowledge-search-heading"
          className="rounded-[1.75rem] border bg-card p-5 shadow-sm sm:p-6"
        >
          <div className="flex items-center gap-2">
            <FileSearch aria-hidden="true" className="size-5 text-primary" />
            <h2 className="text-lg font-semibold" id="knowledge-search-heading">
              检索调试
            </h2>
          </div>

          <form className="mt-5 space-y-4" onSubmit={searchKnowledge}>
            <label className="grid gap-1.5 text-sm font-medium">
              查询文本
              <textarea
                className="min-h-24 rounded-xl border bg-background px-3 py-2 text-sm"
                name="query"
                placeholder="例如：非道路柴油机排放要求"
                required
              />
            </label>

            <fieldset className="rounded-2xl border bg-muted/30 p-4">
              <legend className="flex items-center gap-2 px-2 text-sm font-semibold">
                <Filter aria-hidden="true" className="size-4 text-primary" />
                Metadata filter
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <SelectInput
                  emptyLabel="全部国家"
                  label="国家"
                  name="countryIso3"
                  options={(optionData?.countries ?? []).map((country) => ({
                    label: `${country.name} · ${country.iso3}`,
                    value: country.iso3,
                  }))}
                />
                <SelectInput
                  emptyLabel="全部管辖区域"
                  label="管辖区域"
                  name="jurisdictionId"
                  options={(optionData?.jurisdictions ?? []).map(
                    (jurisdiction) => ({
                      label: jurisdiction.name,
                      value: jurisdiction.id,
                    }),
                  )}
                />
                <SelectInput
                  emptyLabel="全部应用场景"
                  label="应用场景"
                  name="applicationScope"
                  options={applicationScopes.map((value) => ({
                    label: value,
                    value,
                  }))}
                />
                <TextInput label="有效日期" name="asOf" type="date" />
              </div>
            </fieldset>

            <Button
              className="w-full"
              disabled={searchState.status === "loading"}
              type="submit"
            >
              {searchState.status === "loading" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
              ) : (
                <Search aria-hidden="true" className="size-4" />
              )}
              运行混合检索
            </Button>
          </form>

          <SearchFeedback state={searchState} />
        </section>
      </div>

      <section className="mt-6 rounded-[1.75rem] border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Database aria-hidden="true" className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">最近文档与处理状态</h2>
          </div>
          <Button
            onClick={() => {
              setOptions({ status: "loading" });
              setReloadKey((value) => value + 1);
            }}
            size="sm"
            variant="outline"
          >
            <RefreshCcw aria-hidden="true" className="size-4" />
            刷新
          </Button>
        </div>
        <DocumentList state={options} />
      </section>
    </main>
  );
}

function ImportFeedback({ state }: { state: ImportState }) {
  if (state.status === "idle" || state.status === "loading") {
    return null;
  }

  if (state.status === "error") {
    return (
      <div
        className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        role="alert"
      >
        <AlertTriangle
          aria-hidden="true"
          className="size-5 text-destructive"
        />
        <p className="mt-2">{state.message}</p>
      </div>
    );
  }

  const failed = state.response.status === "failed";
  return (
    <div
      className={`mt-4 rounded-2xl border p-4 text-sm ${
        failed
          ? "border-destructive/30 bg-destructive/5"
          : "border-emerald-300 bg-emerald-50"
      }`}
      data-testid={`document-import-${state.response.status}`}
      role="status"
    >
      {failed ? (
        <AlertTriangle
          aria-hidden="true"
          className="size-5 text-destructive"
        />
      ) : (
        <CheckCircle2
          aria-hidden="true"
          className="size-5 text-emerald-700"
        />
      )}
      <p className="mt-2 font-semibold">
        {state.response.status === "duplicate"
          ? "检测到重复文档"
          : documentStatusLabel(state.response.document)}
      </p>
      <p className="mt-1 text-muted-foreground">
        SHA-256：{state.response.document.contentSha256}
      </p>
      {state.response.document.processingError ? (
        <p className="mt-2 text-destructive">
          {state.response.document.processingError}
        </p>
      ) : null}
    </div>
  );
}

function SearchFeedback({ state }: { state: SearchState }) {
  if (state.status === "idle" || state.status === "loading") {
    return null;
  }
  if (state.status === "error") {
    return (
      <p
        className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        role="alert"
      >
        {state.message}
      </p>
    );
  }

  return (
    <div className="mt-5" data-testid="hybrid-search-results">
      <div className="rounded-2xl bg-muted/50 p-4 text-xs">
        <p className="font-semibold">查询文本：{state.response.query}</p>
        <p className="mt-2 font-semibold">Metadata filter</p>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
          {JSON.stringify(state.response.filters, null, 2)}
        </pre>
        <p className="mt-2 text-muted-foreground">
          Embedding：{state.response.embeddingModel} · 关键词权重 0.5 ·
          向量权重 0.5
        </p>
      </div>

      {state.response.results.length > 0 ? (
        <div className="mt-4 space-y-3">
          {state.response.results.map((result) => (
            <article
              className="rounded-2xl border p-4"
              key={result.chunkId}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  #{result.rank} · {result.document.title}
                </h3>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  最终 {result.finalScore.toFixed(4)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <Score label="关键词得分" value={result.keywordScore} />
                <Score label="向量得分" value={result.vectorScore} />
                <Score label="最终排序" value={result.rank} />
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                {result.content}
              </p>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <Trace
                  label="章节"
                  value={
                    result.sectionLocator ??
                    result.headingPath?.join(" > ") ??
                    "未记录"
                  }
                />
                <Trace
                  label="页码"
                  value={
                    result.pageFrom
                      ? `${result.pageFrom}${result.pageTo && result.pageTo !== result.pageFrom ? `–${result.pageTo}` : ""}`
                      : "未记录"
                  }
                />
                <Trace
                  label="Metadata"
                  value={`${result.countryIso3 ?? "无国家"} · ${result.jurisdiction?.name ?? "无管辖区域"} · ${result.applicationScope ?? "无场景"}`}
                />
                <Trace
                  label="有效期"
                  value={`${result.validFrom ?? "开放"} → ${result.validTo ?? "开放"}`}
                />
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                文档来源：{result.document.source.title} · 核验{" "}
                {result.document.source.verifiedAt.slice(0, 10)}
              </p>
              {result.document.downloadUrl ? (
                <a
                  className="mt-2 inline-flex text-xs font-semibold text-primary underline-offset-4 hover:underline"
                  href={result.document.downloadUrl}
                >
                  下载原始文件
                </a>
              ) : null}
              {result.warnings.map((warning) => (
                <p className="mt-2 text-xs text-amber-800" key={warning}>
                  警告：{warning}
                </p>
              ))}
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
          当前查询和 metadata filter 没有命中结果。
        </p>
      )}
    </div>
  );
}

function DocumentList({ state }: { state: OptionsState }) {
  if (state.status === "loading") {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        正在加载处理状态…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <p className="mt-4 text-sm text-destructive" role="alert">
        {state.message}
      </p>
    );
  }

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {state.data.documents.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground lg:col-span-2">
          还没有文档，使用左上方表单导入第一篇。
        </p>
      ) : null}
      {state.data.documents.map((document) => (
        <article className="rounded-2xl border p-4" key={document.id}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold">{document.title}</h3>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                document.processingStatus === "failed"
                  ? "bg-destructive/10 text-destructive"
                  : document.processingStatus === "ready" &&
                      document.governanceStatus === "published"
                    ? "bg-emerald-100 text-emerald-900"
                    : document.processingStatus === "ready"
                      ? "bg-amber-100 text-amber-950"
                    : "bg-secondary"
              }`}
            >
              {documentStatusLabel(document)}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {document.originalFilename ?? "无原始文件"} · {document.chunkCount}{" "}
            chunks · {document.sourceTitle}
          </p>
          {document.processingError ? (
            <p className="mt-2 text-xs text-destructive">
              {document.processingError}
            </p>
          ) : null}
          {document.downloadUrl ? (
            <a
              className="mt-2 inline-flex text-xs font-semibold text-primary underline-offset-4 hover:underline"
              href={document.downloadUrl}
            >
              原始文件
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function TextInput({
  defaultValue,
  label,
  name,
  required,
  type = "text",
}: {
  defaultValue?: string;
  label: string;
  name: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <input
        className="h-10 rounded-xl border bg-background px-3 text-sm"
        defaultValue={defaultValue}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}

function SelectInput({
  emptyLabel,
  label,
  name,
  options,
  value,
}: {
  emptyLabel?: string;
  label: string;
  name: string;
  options: { label: string; value: string }[];
  value?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      <select
        className="h-10 rounded-xl border bg-background px-3 text-sm"
        defaultValue={value ?? (emptyLabel ? "" : options[0]?.value)}
        name={name}
      >
        {emptyLabel ? <option value="">{emptyLabel}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/60 p-2.5 text-center">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono font-semibold">{value}</p>
    </div>
  );
}

function Trace({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium">{value}</dd>
    </div>
  );
}
