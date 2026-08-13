"use client";

import { useChat } from "@ai-sdk/react";
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  FileText,
  LoaderCircle,
  Paperclip,
  PencilLine,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  DefaultChatTransport,
  isToolUIPart,
  type FileUIPart,
  type UIMessage,
} from "ai";
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_DOCUMENT_ATTACHMENT_ACCEPT,
  formatChatAttachmentBytes,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENTS_TOTAL_BYTES,
  resolveChatAttachmentMediaType,
  type ChatAttachmentMediaType,
} from "@/features/ai/attachments";
import {
  hasStructurallyValidChatImage,
  MAX_CHAT_IMAGE_DIMENSION,
  MAX_CHAT_IMAGE_PIXELS,
  MIN_CHAT_IMAGE_DIMENSION,
} from "@/features/ai/image-attachments";
import {
  clientAiToolResultSchema,
  type ClientAiCitation,
  type ClientAiToolResult,
} from "@/features/ai/client-schemas";
import { MAX_CHAT_USER_MESSAGE_CHARACTERS } from "@/features/ai/constants";
import { parseSerializedApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";

type SalesChatProps = {
  aiConfigured: boolean;
  demoMode?: boolean;
  imageUploadsEnabled: boolean;
  initialPrompt?: string;
  selectedCountryIso3: string | null;
};

type PendingAttachment = {
  file: File;
  id: string;
  mediaType: ChatAttachmentMediaType;
};

type FailedSubmission = {
  attachments: PendingAttachment[];
  messageId: string;
  text: string;
};

type ActiveSubmission = Omit<FailedSubmission, "messageId"> & {
  messageId?: string;
};

function attachmentValidationMessage(
  attachments: readonly PendingAttachment[],
): string | null {
  if (attachments.length > MAX_CHAT_ATTACHMENTS) {
    return `每轮最多上传 ${MAX_CHAT_ATTACHMENTS} 个附件。`;
  }

  for (const { file } of attachments) {
    const filename = file.name.trim();
    if (
      !filename ||
      filename.length > MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS ||
      /[\u0000-\u001f\u007f/\\]/u.test(filename)
    ) {
      return `文件名无效或超过 ${MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS} 个字符。`;
    }
    if (file.size === 0) {
      return `${filename} 是空文件，无法上传。`;
    }
    if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
      return `${filename} 超过单文件 3 MiB 限制。`;
    }
  }

  const totalBytes = attachments.reduce(
    (total, attachment) => total + attachment.file.size,
    0,
  );
  if (totalBytes > MAX_CHAT_ATTACHMENTS_TOTAL_BYTES) {
    return "本轮附件合计不能超过 6 MiB。";
  }

  return null;
}

function fileToUiPart({
  file,
  mediaType,
}: PendingAttachment): Promise<FileUIPart> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FileReader failed."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("FileReader returned an invalid result."));
        return;
      }

      const separatorIndex = reader.result.indexOf(",");
      if (separatorIndex < 0) {
        reject(new Error("FileReader returned an invalid data URL."));
        return;
      }

      resolve({
        filename: file.name.trim(),
        mediaType,
        type: "file",
        url: `data:${mediaType};base64,${reader.result.slice(separatorIndex + 1)}`,
      });
    };
    reader.readAsDataURL(file);
  });
}

function PendingImagePreview({ attachment }: { attachment: PendingAttachment }) {
  const [previewUrl] = useState(() =>
    attachment.mediaType.startsWith("image/")
      ? URL.createObjectURL(attachment.file)
      : null,
  );

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  return previewUrl ? (
    <Image
      alt={`${attachment.file.name} 预览`}
      className="size-12 rounded-md object-cover"
      height={48}
      src={previewUrl}
      unoptimized
      width={48}
    />
  ) : (
    <span className="grid size-12 shrink-0 place-items-center rounded-md bg-muted">
      <FileText aria-hidden="true" className="size-5 text-muted-foreground" />
    </span>
  );
}

/**
 * AI SDK 客户端把非 2xx 响应的原始 body 文本塞进 `error.message`。
 * 服务端返回 schema 校验的 `{error:{code,message}}` 信封（ADR-041），
 * 这里解出通用消息展示，解不出时退回固定文案，不把 JSON 直接给用户。
 */
function chatErrorMessage(error: Error): string {
  const fallback =
    "聊天请求失败。不会使用模型记忆补全法规事实，请稍后重试。";
  return parseSerializedApiErrorMessage(error.message, fallback);
}

const toolLabels: Record<ClientAiToolResult["tool"], string> = {
  calculateOpportunityScore: "确定性机会评分",
  compareMarkets: "结构化市场比较",
  compareRegulations: "数据库法规比较",
  findCompatibleProducts: "确定性产品适配",
  generateSalesBrief: "结构化销售简报",
  getCountryProfile: "国家与法规资料",
  searchKnowledgeBase: "知识库证据",
};

const statusLabels = {
  error: "查询失败",
  no_data: "证据不足",
  ok: "已取得证据",
} as const;

const regulationStatusLabels = {
  adopted: "已采纳",
  effective: "已生效",
  proposed: "拟议",
  superseded: "已被取代",
} as const;

const fitStatusLabels = {
  fit: "匹配",
  not_fit: "不匹配",
  unknown: "证据不足",
} as const;

const marketComparisonStatusLabels = {
  comparable: "可比较",
  incomparable: "不可比较",
  insufficient_data: "数据不足",
} as const;

function formatTimestamp(value: string | null): string {
  return value ? value.slice(0, 10) : "未记录";
}

function formatDecimal(value: string): string {
  const match = value.match(/^([+-]?\d+)(?:\.(\d*))?$/u);
  if (!match) {
    return value;
  }

  const fractional = (match[2] ?? "").replace(/0+$/u, "");
  return fractional.length > 0 ? `${match[1]}.${fractional}` : match[1];
}

function regulationStatusNote(
  status: "adopted" | "effective",
  recordStatus: "adopted" | "effective" | "superseded",
): string {
  if (status === recordStatus) {
    return `查询日：${regulationStatusLabels[status]}`;
  }

  return `查询日：${regulationStatusLabels[status]} · 当前记录：${regulationStatusLabels[recordStatus]}`;
}

function resultContainsDemoEvidence(result: ClientAiToolResult): boolean {
  return result.citations.some((citation) => citation.isDemo);
}

function citationLocator(citation: ClientAiCitation): string {
  if (citation.pageFrom) {
    const pages =
      citation.pageTo && citation.pageTo !== citation.pageFrom
        ? `${citation.pageFrom}–${citation.pageTo}`
        : String(citation.pageFrom);
    return `第 ${pages} 页`;
  }

  return citation.sectionLocator ?? citation.locator ?? "未记录页码/章节";
}

function CitationList({
  citations,
}: {
  citations: ClientAiCitation[];
}) {
  if (citations.length === 0) {
    return (
      <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        本次工具没有返回可引用来源。
      </p>
    );
  }

  return (
    <details className="rounded-lg border bg-background/40 p-2">
      <summary className="cursor-pointer text-[11px] font-semibold tracking-wide text-muted-foreground">
        查看来源与定位（{citations.length}）
      </summary>
      <div className="mt-2 space-y-2">
      {citations.map((citation, index) => (
        <article
          className="rounded-lg border bg-background/70 p-2.5 text-xs"
          key={[
            citation.sourceId,
            citation.chunkId,
            citation.regulationId,
            citation.productCertificationId,
            index,
          ].join(":")}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium">{citation.title}</p>
              <p className="mt-0.5 text-muted-foreground">
                {citation.sourceTitle} · {citationLocator(citation)}
              </p>
            </div>
            {citation.sourceUrl ? (
              <a
                aria-label={`打开来源：${citation.sourceTitle}`}
                className="shrink-0 text-primary hover:underline"
                href={citation.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {citation.regulationStatus ? (
              <span>
                法规状态：{regulationStatusLabels[citation.regulationStatus]}
              </span>
            ) : null}
            <span>核验：{formatTimestamp(citation.verifiedAt)}</span>
            {citation.publishedOn ? (
              <span>发布：{citation.publishedOn}</span>
            ) : null}
            {citation.isDemo ? (
              <span className="font-semibold text-amber-700">DEMO</span>
            ) : null}
          </div>
        </article>
      ))}
      </div>
    </details>
  );
}

type ClientOpportunityScore = Extract<
  ClientAiToolResult,
  { tool: "calculateOpportunityScore" }
>["scorecard"]["scores"][number];

function ScoreBreakdown({ score }: { score: ClientOpportunityScore }) {
  return (
    <div className="rounded-lg bg-background/70 p-2 text-xs">
      <div className="flex items-end justify-between gap-2">
        <p className="font-semibold">{score.countryIso3}</p>
        <p className="text-right">
          <strong className="text-lg">{score.overallScore ?? "—"}</strong>
          <span className="text-muted-foreground"> / 100</span>
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground">
        数据覆盖率 {score.dataCoveragePct}%
      </p>
      <div className="mt-2 space-y-2">
        {score.components.map((component) => (
          <div className="rounded-md border bg-background p-2" key={component.key}>
            <p className="flex justify-between gap-2">
              <span className="font-medium">{component.key}</span>
              <span>
                {component.score ?? "缺失"} · 有效权重{" "}
                {(component.effectiveWeight * 100).toFixed(0)}% · 贡献{" "}
                {component.contribution ?? "—"}
              </span>
            </p>
            <p className="mt-1 leading-4 text-muted-foreground">
              {component.explanation}
            </p>
            {component.inputFacts.length > 0 ? (
              <p className="mt-1 text-[10px] text-muted-foreground">
                输入：{component.inputFacts.join(" · ")}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

type QuerySummaryResult = Extract<
  ClientAiToolResult,
  {
    tool:
      | "calculateOpportunityScore"
      | "compareRegulations"
      | "findCompatibleProducts"
      | "generateSalesBrief";
  }
>;

function ToolQuerySummary({ result }: { result: QuerySummaryResult }) {
  let fields: Array<{ label: string; value: string }>;

  if (result.tool === "findCompatibleProducts") {
    fields = [
      { label: "国家", value: result.query.countryIso3 ?? "未指定" },
      { label: "场景", value: result.query.applicationScope },
      { label: "功率", value: `${result.query.powerKw} kW` },
      { label: "日期", value: result.query.asOf },
      ...(result.query.productModelCode
        ? [{ label: "产品", value: result.query.productModelCode }]
        : []),
    ];
  } else if (result.tool === "generateSalesBrief") {
    const { query } = result.brief;
    fields = [
      { label: "目标国家", value: query.targetCountryIso3 },
      { label: "比较国家", value: query.countryIso3s.join("、") },
      { label: "场景", value: query.applicationScope },
      { label: "功率", value: `${query.powerKw} kW` },
      { label: "日期", value: query.asOf },
      ...(query.productModelCode
        ? [{ label: "产品", value: query.productModelCode }]
        : []),
    ];
  } else {
    const query =
      result.tool === "compareRegulations"
        ? result.comparison.query
        : result.scorecard.query;
    fields = [
      {
        label: "国家",
        value: query.countryIso3s.join("、"),
      },
      { label: "场景", value: query.applicationScope },
      { label: "功率", value: `${query.powerKw} kW` },
      { label: "日期", value: query.asOf },
      ...(query.productModelCode
        ? [{ label: "产品", value: query.productModelCode }]
        : []),
    ];
  }

  return (
    <dl
      aria-label={`${toolLabels[result.tool]}查询条件`}
      className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-primary/15 bg-background/80 p-2.5 text-xs sm:grid-cols-3"
    >
      {fields.map((field) => (
        <div className="min-w-0" key={field.label}>
          <dt className="text-[10px] font-semibold tracking-wide text-muted-foreground">
            {field.label}
          </dt>
          <dd className="mt-0.5 break-words font-medium text-foreground">
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ToolFacts({ result }: { result: ClientAiToolResult }) {
  if (result.tool === "getCountryProfile") {
    if (!result.profile || result.profile.status === "no_data") {
      return <p className="text-xs">该国家暂无结构化资料。</p>;
    }

    return (
      <div className="space-y-2 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-background/70 p-2">
            <span className="text-muted-foreground">查询日有效法规</span>
            <strong className="mt-1 block text-base">
              {result.profile.country.currentEffectiveRegulations.length}
            </strong>
          </div>
          <div className="rounded-lg bg-background/70 p-2">
            <span className="text-muted-foreground">查询日已采纳法规</span>
            <strong className="mt-1 block text-base">
              {result.profile.country.futureAdoptedRegulations.length}
            </strong>
          </div>
        </div>
        {[
          ...result.profile.country.currentEffectiveRegulations,
          ...result.profile.country.futureAdoptedRegulations,
        ].map((regulation) => (
          <p
            className="rounded-lg bg-background/70 p-2 text-muted-foreground"
            key={regulation.id}
          >
            {regulation.canonicalName} · 查询日：
            {regulationStatusLabels[regulation.statusAtAsOf]}
            {regulation.status !== regulation.statusAtAsOf
              ? ` · 当前记录：${regulationStatusLabels[regulation.status]}`
              : ""}
            {" · "}适用辖区
            {regulation.applicability.jurisdiction.name}（
            {regulation.applicability.jurisdiction.code}） · 成员期
            {regulation.applicability.membership.validFrom} →{" "}
            {regulation.applicability.membership.validTo ?? "开放"}
          </p>
        ))}
      </div>
    );
  }

  if (result.tool === "searchKnowledgeBase") {
    return result.search.results.length > 0 ? (
      <div className="space-y-2">
        {result.search.results.slice(0, 3).map((item) => (
          <div
            className="rounded-lg bg-background/70 p-2 text-xs"
            key={item.chunkId}
          >
            <p className="font-medium">
              #{item.rank} {item.document.title}
            </p>
            <p className="mt-1 line-clamp-2 text-muted-foreground">
              {item.content}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              最终得分 {item.finalScore.toFixed(3)}
            </p>
          </div>
        ))}
      </div>
    ) : (
      <p className="text-xs">知识库检索没有命中可用片段。</p>
    );
  }

  if (result.tool === "findCompatibleProducts") {
    return result.evaluations.length > 0 ? (
      <div className="space-y-2">
        {result.evaluations.map((evaluation) => (
          <div
            className="rounded-lg bg-background/70 p-2 text-xs"
            key={evaluation.product?.id ?? evaluation.input.productModelCode}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">
                {evaluation.product?.name ??
                  evaluation.input.productModelCode}
              </p>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  evaluation.status === "fit" &&
                    "bg-emerald-100 text-emerald-800",
                  evaluation.status === "not_fit" &&
                    "bg-rose-100 text-rose-800",
                  evaluation.status === "unknown" &&
                    "bg-amber-100 text-amber-800",
                )}
              >
                {fitStatusLabels[evaluation.status]}
              </span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {evaluation.reasons.map(({ message }) => message).join("；")}
            </p>
            {evaluation.product ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                供应期：
                {evaluation.product.availableFrom === null &&
                evaluation.product.availableTo === null
                  ? "未记录"
                  : `${evaluation.product.availableFrom ?? "未记录"} → ${evaluation.product.availableTo ?? "开放"}`}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    ) : (
      <p className="text-xs">没有产品适配结果。</p>
    );
  }

  if (result.tool === "compareRegulations") {
    const currentPollutants = Array.from(
      new Set(
        result.comparison.countries.flatMap((country) =>
          country.currentEffectiveRegulations.flatMap((regulation) =>
            regulation.limits.map(({ pollutantCode }) => pollutantCode),
          ),
        ),
      ),
    ).toSorted();

    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-sky-200 bg-sky-50/80 p-2 text-xs leading-5 text-sky-950">
          <p className="font-semibold">比较口径</p>
          <p>
            差异只反映本次同场景、功率和日期下返回的结构化记录；未返回某项不能解释为当地没有该要求。
          </p>
        </div>
        {result.comparison.countries.map((country) => (
          <div
            className="rounded-lg bg-background/70 p-2 text-xs"
            key={country.countryIso3}
          >
            <p className="font-semibold">
              {country.countryIso3} · {country.countryName ?? "无国家记录"}
            </p>
            <p className="mt-1 text-muted-foreground">
              查询日有效 {country.currentEffectiveRegulations.length} ·
              查询日已采纳 {country.futureAdoptedRegulations.length}
            </p>
            {(() => {
              const available = new Set(
                country.currentEffectiveRegulations.flatMap((regulation) =>
                  regulation.limits.map(({ pollutantCode }) => pollutantCode),
                ),
              );
              const missing = currentPollutants.filter(
                (pollutantCode) => !available.has(pollutantCode),
              );

              return missing.length > 0 ? (
                <p className="mt-1 rounded-md bg-amber-100/80 px-2 py-1 text-[11px] leading-4 text-amber-950">
                  当前结果未返回结构化 {missing.join("、")} 限值；不能解释为当地没有相关要求。
                </p>
              ) : null;
            })()}
            <div className="mt-1.5 space-y-1 text-muted-foreground">
              {[
                ...country.currentEffectiveRegulations,
                ...country.futureAdoptedRegulations,
              ].map((regulation) => (
                <div className="space-y-0.5" key={regulation.id}>
                  <p>
                    {regulation.canonicalName} · 适用辖区{" "}
                    {regulation.applicability.jurisdiction.name}（
                    {regulation.applicability.jurisdiction.code}）
                  </p>
                  <p className="pl-2 text-[11px] font-medium">
                    {regulationStatusNote(
                      regulation.status,
                      regulation.recordStatus,
                    )}
                  </p>
                  {regulation.limits.map((limit) => (
                    <p className="pl-2 text-[11px]" key={limit.id}>
                      {limit.pollutantCode} ≤ {formatDecimal(limit.limitValue)}{" "}
                      {limit.unitCode} · {limit.validFrom} →{" "}
                      {limit.validTo ?? "开放"}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (result.tool === "compareMarkets") {
    return (
      <div className="space-y-2">
        {result.comparison.metrics.map((metric) => (
          <div
            className="rounded-lg bg-background/70 p-2 text-xs"
            key={metric.metricCode}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{metric.metricName}</p>
              <span className="text-[10px] text-muted-foreground">
                {marketComparisonStatusLabels[metric.comparisonStatus]}
              </span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {metric.observations
                .map(
                  (observation) =>
                    `${observation.countryIso3} ${formatDecimal(observation.valueNumeric)} ${observation.unitCode}`,
                )
                .join(" · ") || "没有观测值"}
            </p>
          </div>
        ))}
      </div>
    );
  }

  if (result.tool === "calculateOpportunityScore") {
    return (
      <div className="space-y-2">
        {result.scorecard.scores.map((score) => (
          <ScoreBreakdown key={score.countryIso3} score={score} />
        ))}
      </div>
    );
  }

  const { brief } = result;
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-sky-200 bg-sky-50/80 p-2.5 text-xs">
        <p className="font-semibold text-sky-950">确定性事实数据</p>
        <div className="mt-2">
          <ScoreBreakdown score={brief.marketScore} />
        </div>
        <div className="mt-2 space-y-1">
          {brief.recommendedProducts.map((product) => (
            <p key={product.modelCode}>
              规则匹配：{product.modelCode} · {product.name} · 供应期
              {product.availableFrom === null && product.availableTo === null
                ? "未记录"
                : `${product.availableFrom ?? "未记录"} → ${product.availableTo ?? "开放"}`}
            </p>
          ))}
          {brief.risks.map((risk) => (
            <p key={`${risk.title}:${risk.text}`}>
              风险：{risk.title} — {risk.text}
            </p>
          ))}
        </div>
      </section>
      <section className="rounded-lg border border-violet-200 bg-violet-50/80 p-2.5 text-xs">
        <p className="font-semibold text-violet-950">
          规则生成建议（非事实层）
        </p>
        <p className="mt-1 text-violet-900">{brief.executiveSummary}</p>
        <div className="mt-2 space-y-1">
          {brief.opportunities.map((opportunity) => (
            <p key={`${opportunity.title}:${opportunity.text}`}>
              机会：{opportunity.title} — {opportunity.text}
            </p>
          ))}
          {brief.salesActions.map((action) => (
            <p key={`${action.priority}:${action.action}`}>
              [{action.priority}] {action.action}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}

function ToolResultCard({ result }: { result: ClientAiToolResult }) {
  const hasDemoEvidence = resultContainsDemoEvidence(result);

  return (
    <section
      aria-label={toolLabels[result.tool]}
      className={cn(
        "my-2 space-y-3 rounded-xl border p-3",
        result.status === "ok"
          ? "border-primary/20 bg-primary/5"
          : "border-amber-300/60 bg-amber-50/80",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText aria-hidden="true" className="size-4 text-primary" />
          <div>
            <p className="text-xs font-semibold">{toolLabels[result.tool]}</p>
            <p className="text-[11px] text-muted-foreground">
              确定性事实层 · 查询基准：{result.informationAsOf} · 最近核验：
              {formatTimestamp(result.latestVerifiedAt)}
            </p>
          </div>
        </div>
        <span className="rounded-full border bg-background px-2 py-0.5 text-[10px] font-semibold">
          {statusLabels[result.status]}
        </span>
      </header>

      {result.tool === "findCompatibleProducts" ||
      result.tool === "compareRegulations" ||
      result.tool === "calculateOpportunityScore" ||
      result.tool === "generateSalesBrief" ? (
        <ToolQuerySummary result={result} />
      ) : null}

      {hasDemoEvidence ? (
        <div
          className="flex gap-1.5 rounded-lg border border-amber-400 bg-amber-100 p-2 text-xs font-semibold text-amber-950"
          role="alert"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          该结果包含虚构 Demo 证据，不可用于报价、认证声明或销售承诺。
        </div>
      ) : null}

      <ToolFacts result={result} />

      {result.warnings.length > 0 ? (
        <div className="space-y-1 rounded-lg bg-amber-100/80 p-2 text-xs text-amber-950">
          {result.warnings.map((warning) => (
            <p className="flex gap-1.5" key={warning}>
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0"
              />
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <CitationList citations={result.citations} />
    </section>
  );
}

type ChatMessagePart = UIMessage["parts"][number];

function AttachmentPart({ part }: { part: FileUIPart }) {
  const filename = part.filename ?? "未命名附件";

  if (part.mediaType.startsWith("image/")) {
    return (
      <figure className="my-2 w-fit max-w-full rounded-lg border border-white/20 bg-black/10 p-1.5">
        <Image
          alt={filename}
          className="max-h-48 w-auto rounded-md object-contain"
          height={192}
          src={part.url}
          unoptimized
          width={288}
        />
        <figcaption className="mt-1 max-w-72 truncate px-1 text-[11px] opacity-80">
          {filename}
        </figcaption>
      </figure>
    );
  }

  return (
    <div className="my-2 flex max-w-full items-center gap-2 rounded-lg border border-white/20 bg-black/10 px-3 py-2 text-xs">
      <FileText aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{filename}</span>
      <span className="shrink-0 opacity-70">{part.mediaType}</span>
    </div>
  );
}

function ToolPart({ part }: { part: ChatMessagePart }) {
  if (!isToolUIPart(part)) {
    return null;
  }
  if ("output" in part) {
    const parsed = clientAiToolResultSchema.safeParse(part.output);
    if (parsed.success) {
      return <ToolResultCard result={parsed.data} />;
    }
  }

  return (
    <div className="my-2 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      正在执行确定性查询…
    </div>
  );
}

export function SalesChat({
  aiConfigured,
  demoMode = false,
  imageUploadsEnabled,
  initialPrompt = "",
  selectedCountryIso3,
}: SalesChatProps) {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState(initialPrompt);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [failedSubmission, setFailedSubmission] =
    useState<FailedSubmission | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submissionPending, setSubmissionPending] = useState(false);
  const [validatingAttachments, setValidatingAttachments] = useState(false);
  const validatingAttachmentsRef = useRef(false);
  const activeSubmissionRef = useRef<ActiveSubmission | null>(null);
  const submissionPendingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({
          body,
          id,
          messageId,
          messages,
          trigger,
        }) => {
          const latestUserMessageIndex = messages.findLastIndex(
            (message) => message.role === "user",
          );
          const requestMessages = messages.map((message, index) =>
            message.role === "user" && index !== latestUserMessageIndex
              ? {
                  ...message,
                  parts: message.parts.filter(
                    (part) => part.type !== "file",
                  ),
                }
              : message,
          );

          return {
            body: {
              ...body,
              id,
              messageId,
              messages: requestMessages,
              trigger,
            },
          };
        },
      }),
    [],
  );
  const {
    clearError,
    error,
    messages,
    sendMessage,
    setMessages,
    status,
  } = useChat({
    onFinish: ({ isError, messages: finishedMessages }) => {
      const activeSubmission = activeSubmissionRef.current;
      if (!activeSubmission) {
        return;
      }

      if (!isError) {
        setFailedSubmission(null);
        return;
      }

      const messageId =
        activeSubmission.messageId ??
        finishedMessages.findLast((message) => message.role === "user")?.id;
      if (messageId) {
        setFailedSubmission({
          attachments: activeSubmission.attachments,
          messageId,
          text: activeSubmission.text,
        });
      }
    },
    transport,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const waiting = status === "submitted" || status === "streaming";
  const recoveryPending = error !== undefined && failedSubmission !== null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function selectAttachments(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selectedFiles.length === 0) {
      return;
    }

    if (
      validatingAttachmentsRef.current ||
      submissionPendingRef.current
    ) {
      return;
    }
    validatingAttachmentsRef.current = true;
    setValidatingAttachments(true);

    try {
      const additions: PendingAttachment[] = [];
      for (const file of selectedFiles) {
        const mediaType = resolveChatAttachmentMediaType(file);
        if (!mediaType) {
          setAttachmentError(
            `${file.name || "所选文件"} 的格式不受支持。请选择 PNG、JPEG、WebP、PDF、TXT、Markdown 或 CSV。`,
          );
          return;
        }
        if (mediaType.startsWith("image/") && !imageUploadsEnabled) {
          setAttachmentError(
            "当前服务端未配置视觉模型；请上传 PDF、TXT、Markdown 或 CSV，或联系管理员启用图片分析。",
          );
          return;
        }
        const addition = {
          file,
          id: crypto.randomUUID(),
          mediaType,
        };
        const prospectiveValidationError = attachmentValidationMessage([
          ...pendingAttachments,
          ...additions,
          addition,
        ]);
        if (prospectiveValidationError) {
          setAttachmentError(prospectiveValidationError);
          return;
        }
        if (mediaType.startsWith("image/")) {
          let bytes: Uint8Array;
          try {
            bytes = new Uint8Array(await file.arrayBuffer());
          } catch {
            setAttachmentError(
              `${file.name || "所选图片"} 无法读取，请重新选择。`,
            );
            return;
          }
          if (!hasStructurallyValidChatImage(mediaType, bytes)) {
            setAttachmentError(
              `${file.name || "所选图片"} 损坏、截断或像素尺寸不受支持。图片宽高均须为 ${MIN_CHAT_IMAGE_DIMENSION.toLocaleString("en-US")}–${MAX_CHAT_IMAGE_DIMENSION.toLocaleString("en-US")} 像素、总计最多 ${MAX_CHAT_IMAGE_PIXELS.toLocaleString("en-US")} 像素。`,
            );
            return;
          }
        }
        additions.push(addition);
      }

      const nextAttachments = [...pendingAttachments, ...additions];
      const validationError = attachmentValidationMessage(nextAttachments);
      if (validationError) {
        setAttachmentError(validationError);
        return;
      }

      setPendingAttachments(nextAttachments);
      setAttachmentError(null);
    } finally {
      validatingAttachmentsRef.current = false;
      setValidatingAttachments(false);
    }
  }

  function removeAttachment(id: string) {
    if (
      validatingAttachmentsRef.current ||
      submissionPendingRef.current
    ) {
      return;
    }

    setPendingAttachments((attachments) =>
      attachments.filter((attachment) => attachment.id !== id),
    );
    setAttachmentError(null);
  }

  async function submissionFiles(
    attachments: readonly PendingAttachment[],
  ): Promise<FileUIPart[] | null> {
    try {
      return await Promise.all(
        attachments.map((attachment) => fileToUiPart(attachment)),
      );
    } catch {
      setAttachmentError("附件读取失败，请重新选择后再试。");
      return null;
    }
  }

  function releaseMessageAttachmentData() {
    setMessages((currentMessages) =>
      currentMessages.map((message) => ({
        ...message,
        parts: message.parts.flatMap((part) =>
          part.type === "file"
            ? [
                {
                  text: `[已发送附件：${part.filename ?? "未命名附件"}；后续追问请重新上传]`,
                  type: "text" as const,
                },
              ]
            : [part],
        ),
      })),
    );
  }

  async function sendSubmission(
    submission: ActiveSubmission,
    files: FileUIPart[],
  ) {
    activeSubmissionRef.current = submission;
    try {
      await sendMessage(
        submission.messageId
          ? { files, messageId: submission.messageId, text: submission.text }
          : { files, text: submission.text },
        {
          body: {
            selectedCountryIso3,
            sessionId,
          },
        },
      );
    } finally {
      releaseMessageAttachmentData();
      if (activeSubmissionRef.current === submission) {
        activeSubmissionRef.current = null;
      }
    }
  }

  async function retryFailedSubmission() {
    if (!failedSubmission || waiting || submissionPendingRef.current) {
      return;
    }

    submissionPendingRef.current = true;
    setSubmissionPending(true);
    try {
      const files = await submissionFiles(failedSubmission.attachments);
      if (!files) {
        return;
      }

      clearError();
      setAttachmentError(null);
      await sendSubmission(failedSubmission, files);
    } finally {
      submissionPendingRef.current = false;
      setSubmissionPending(false);
    }
  }

  function editFailedSubmission() {
    if (!failedSubmission || waiting || submissionPendingRef.current) {
      return;
    }

    setMessages((currentMessages) => {
      const failedMessageIndex = currentMessages.findIndex(
        (message) => message.id === failedSubmission.messageId,
      );
      return failedMessageIndex >= 0
        ? currentMessages.slice(0, failedMessageIndex)
        : currentMessages;
    });
    setInput(failedSubmission.text);
    setPendingAttachments(failedSubmission.attachments);
    setFailedSubmission(null);
    setAttachmentError(null);
    clearError();
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (
      !text ||
      waiting ||
      recoveryPending ||
      validatingAttachmentsRef.current ||
      submissionPendingRef.current ||
      !aiConfigured
    ) {
      return;
    }

    submissionPendingRef.current = true;
    setSubmissionPending(true);
    try {
      const attachments = pendingAttachments;
      const files = await submissionFiles(attachments);
      if (!files) {
        return;
      }

      setInput("");
      setPendingAttachments([]);
      setFailedSubmission(null);
      setAttachmentError(null);
      await sendSubmission({ attachments, text }, files);
    } finally {
      submissionPendingRef.current = false;
      setSubmissionPending(false);
    }
  }

  return (
    <aside
      aria-labelledby="sales-chat-heading"
      className="surface-panel flex h-full min-h-[34rem] flex-col overflow-hidden rounded-[1.75rem]"
      data-sales-chat-root
      id="sales-chat-panel"
      role="complementary"
    >
      <header className="flex items-center justify-between border-b border-black/[0.06] bg-[#fffefa]/85 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-[#173d31] text-[#dff29d] shadow-sm">
            <Bot aria-hidden="true" className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[#17382e]" id="sales-chat-heading">
              AI 营销分析助手
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {demoMode
                ? "离线 Demo AI（确定性模拟）"
                : aiConfigured
                  ? "服务端 AI 已配置"
                  : "服务端 AI 未配置"} · 地图国家：
              {selectedCountryIso3 ?? "未选择"}
            </p>
          </div>
        </div>
      </header>

      <div
        aria-label="AI 对话记录"
        aria-live="polite"
        aria-relevant="additions text"
        className="min-h-56 flex-1 space-y-4 overflow-y-auto bg-[#fafaf6]/65 p-4 sm:p-6"
        role="log"
      >
        {messages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-emerald-900/15 bg-[#f1f5ec] p-5 text-sm">
            <p className="text-xs leading-6 text-muted-foreground">
              {demoMode
                ? "离线 Demo 可尝试：“CHN 目前有哪些有效法规？”或“CHN 的 non-road 100 kW 产品是否适配？”；只查询明确标记的虚构 fixture。"
                : "例如：“CHN 目前有哪些有效法规？”或“DEU 的 non-road 120 kW 产品是否适配？”也可以比较 CHN 与 BRA 并生成结构化销售简报。"}
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <article
            className={cn(
              "rounded-2xl px-4 py-3 text-sm shadow-sm",
              message.role === "user"
                ? "ml-8 bg-[#173d31] text-white sm:ml-24"
                : "mr-2 border border-black/[0.06] bg-white sm:mr-12",
            )}
            key={message.id}
          >
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-70">
              {message.role === "user" ? "你" : "助手"}
            </p>
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                return (
                  <div
                    className="space-y-1"
                    key={`${message.id}-text-${index}`}
                  >
                    {message.role === "assistant" ? (
                      <p className="text-[10px] font-semibold tracking-wide text-violet-700">
                        AI 解释/建议（非事实层）
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap leading-6">
                      {part.text}
                    </p>
                  </div>
                );
              }

              if (part.type === "file") {
                return (
                  <AttachmentPart
                    key={`${message.id}-file-${index}`}
                    part={part}
                  />
                );
              }

              return (
                <ToolPart
                  key={`${message.id}-part-${index}`}
                  part={part}
                />
              );
            })}
          </article>
        ))}

        {status === "submitted" ? (
          <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
            正在选择确定性工具…
          </div>
        ) : null}

        {error ? (
          <div
            className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
            role="alert"
          >
            <p>{chatErrorMessage(error)}</p>
            {failedSubmission ? (
              <div className="space-y-2 rounded-lg border border-destructive/20 bg-background/70 p-2.5 text-foreground">
                <p className="font-semibold">失败的问题和附件已在本页保留。</p>
                <p className="line-clamp-3 text-muted-foreground">
                  问题：{failedSubmission.text}
                </p>
                {failedSubmission.attachments.length > 0 ? (
                  <p className="break-words text-muted-foreground">
                    附件：
                    {failedSubmission.attachments
                      .map(({ file }) => file.name)
                      .join("、")}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="h-8 gap-1.5 px-3 text-xs"
                    disabled={waiting || submissionPending}
                    onClick={() => void retryFailedSubmission()}
                    type="button"
                    variant="outline"
                  >
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                    原样重试
                  </Button>
                  <Button
                    className="h-8 gap-1.5 px-3 text-xs"
                    disabled={waiting || submissionPending}
                    onClick={editFailedSubmission}
                    type="button"
                    variant="outline"
                  >
                    <PencilLine aria-hidden="true" className="size-3.5" />
                    编辑后重试
                  </Button>
                </div>
                <p className="text-[10px] leading-4 text-muted-foreground">
                  系统不会自动重复请求；仅在你选择重试时再次发送。
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-black/[0.06] bg-[#f2f4ee] p-3 sm:p-4">
        <form
          aria-busy={validatingAttachments || submissionPending}
          className="space-y-2"
          onSubmit={submit}
        >
          {pendingAttachments.length > 0 ? (
            <ul
              aria-label="待发送附件"
              className="grid gap-2 sm:grid-cols-2"
            >
              {pendingAttachments.map((attachment) => (
                <li
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"
                  key={attachment.id}
                >
                  <PendingImagePreview attachment={attachment} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {attachment.file.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatChatAttachmentBytes(attachment.file.size)}
                    </p>
                  </div>
                  <Button
                    aria-label={`移除附件 ${attachment.file.name}`}
                    className="size-8 p-0"
                    disabled={
                      waiting || submissionPending || validatingAttachments
                    }
                    onClick={() => removeAttachment(attachment.id)}
                    type="button"
                    variant="outline"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          {attachmentError ? (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
              role="alert"
            >
              {attachmentError}
            </p>
          ) : null}

          {validatingAttachments ? (
            <p
              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-muted-foreground"
              role="status"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-3.5 animate-spin"
              />
              正在验证附件安全性…
            </p>
          ) : null}

          <div className="flex gap-2 rounded-2xl border border-black/[0.07] bg-white p-2 shadow-sm focus-within:ring-[3px] focus-within:ring-emerald-700/15">
            <input
              accept={
                imageUploadsEnabled
                  ? CHAT_ATTACHMENT_ACCEPT
                  : CHAT_DOCUMENT_ATTACHMENT_ACCEPT
              }
              aria-label={
                imageUploadsEnabled ? "选择文件或图片" : "选择文件"
              }
              className="sr-only"
              disabled={
                waiting ||
                recoveryPending ||
                submissionPending ||
                validatingAttachments ||
                !aiConfigured
              }
              multiple
              onChange={selectAttachments}
              ref={fileInputRef}
              type="file"
            />
            <Button
              aria-label={
                validatingAttachments
                  ? "正在验证附件"
                  : imageUploadsEnabled
                    ? "添加文件或图片"
                    : "添加文件"
              }
              className="size-11 rounded-xl border-0 bg-[#f1f4ee] p-0 text-emerald-900 shadow-none hover:bg-[#e6eee2]"
              disabled={
                waiting ||
                recoveryPending ||
                submissionPending ||
                validatingAttachments ||
                !aiConfigured
              }
              onClick={() => fileInputRef.current?.click()}
              type="button"
              variant="outline"
            >
              {validatingAttachments ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
              ) : (
                <Paperclip aria-hidden="true" className="size-4" />
              )}
            </Button>
            <label className="sr-only" htmlFor="sales-chat-input">
              输入问题
            </label>
            <textarea
              className="min-h-11 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-slate-400"
              id="sales-chat-input"
              maxLength={MAX_CHAT_USER_MESSAGE_CHARACTERS}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                imageUploadsEnabled
                  ? "输入问题，可附上文件或图片…"
                  : "输入问题，可附上文件…"
              }
              readOnly={recoveryPending || submissionPending}
              rows={2}
              ref={inputRef}
              value={input}
            />
            <Button
              aria-label="发送问题"
              className="size-11 rounded-xl bg-[#173d31] p-0 text-white shadow-none hover:bg-[#215142]"
              disabled={
                waiting ||
                recoveryPending ||
                submissionPending ||
                validatingAttachments ||
                !input.trim() ||
                !aiConfigured
              }
              type="submit"
            >
              {waiting || submissionPending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
              ) : (
                <Send aria-hidden="true" className="size-4" />
              )}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
