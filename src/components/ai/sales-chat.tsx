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
  Square,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  DefaultChatTransport,
  isToolUIPart,
  type FileUIPart,
} from "ai";
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AssistantMarkdown } from "@/components/ai/assistant-markdown";
import { MarketComparisonFacts } from "@/components/ai/market-comparison-facts";
import { useLocale } from "@/components/i18n/locale-provider";
import { unwrapUntrustedKnowledgeExcerpt } from "@/domain/knowledge/retrieval-policy";
import { Button } from "@/components/ui/button";
import { isNavigableEvidenceUrl } from "@/lib/source-link";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_DOCUMENT_ATTACHMENT_ACCEPT,
  formatChatAttachmentBytes,
  normalizeChatAttachmentFilename,
  resolveChatAttachmentMediaType,
  type ChatAttachmentMediaType,
} from "@/features/ai/attachments";
import {
  formatChatAttachmentError,
  imageInvalidAttachmentError,
  validateChatAttachments,
  type ChatAttachmentErrorDescriptor,
} from "@/features/ai/attachment-errors";
import {
  hasStructurallyValidChatImage,
} from "@/features/ai/image-attachments";
import {
  formatReleasedAttachment,
  parseReleasedAttachmentPart,
  prepareSalesChatRequestMessages,
  releaseSalesChatMessageAttachments,
  type SalesChatUiMessage,
} from "@/features/ai/released-attachment";
import {
  type ClientAiCitation,
  type ClientAiToolResult,
} from "@/features/ai/client-schemas";
import {
  countryProfileTopicLabel,
  localizedCitationLocator,
  localizedCitationTitle,
  localizedRegulationComparisonCountryName,
  localizedSalesBriefAction,
  localizedSalesBriefItem,
  localizedSalesBriefSummary,
  localizedScoreComponentContent,
  localizedToolWarnings,
  productFitReasonMessage,
  toolPartErrorMessage,
} from "@/features/ai/client-tool-copy";
import { toolPartPresentation } from "@/features/ai/tool-part-presentation";
import { MAX_CHAT_USER_MESSAGE_CHARACTERS } from "@/features/ai/constants";
import {
  parseSerializedApiErrorCode,
  type SafeApiErrorCode,
} from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { interpolate, type Dictionary } from "@/i18n/dictionaries";
import {
  formatOptionalUtcDate,
  formatProductAvailabilityDateRange,
  formatUtcDate,
} from "@/i18n/date";
import type { Locale } from "@/i18n/locale";
import {
  applicationScopeLabel,
  jurisdictionDisplayName,
  localizedList,
  nameWithCode,
  productDisplayName,
  regulationDisplayName,
} from "@/i18n/structured-labels";

type SalesChatProps = {
  aiConfigured: boolean;
  countryIso2ByIso3: Readonly<Record<string, string>>;
  demoMode?: boolean;
  imageUploadsEnabled: boolean;
  initialPrompt?: string;
  selectedCountryIso3: string | null;
  suggestedPrompts?: readonly string[];
};

type PendingAttachment = {
  file: File;
  filename: string;
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

class AttachmentMessageReleaseCoordinator {
  #fileParts: FileUIPart[] | null = null;
  #release: () => void = () => undefined;

  connect(release: () => void): () => void {
    this.#release = release;
    return () => {
      if (this.#release === release) {
        this.#release = () => undefined;
        this.#fileParts?.splice(0);
        this.#fileParts = null;
      }
    };
  }

  run(): void {
    this.#release();
    this.#fileParts?.splice(0);
    this.#fileParts = null;
  }

  trackFileParts(fileParts: FileUIPart[]): void {
    this.#fileParts?.splice(0);
    this.#fileParts = fileParts;
  }
}

function fileToUiPart({
  file,
  filename,
  mediaType,
}: PendingAttachment): Promise<FileUIPart> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onabort = () => reject(new Error("FileReader aborted."));
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
        filename,
        mediaType,
        type: "file",
        url: `data:${mediaType};base64,${reader.result.slice(separatorIndex + 1)}`,
      });
    };
    reader.readAsDataURL(file);
  });
}

function PendingImagePreview({ attachment }: { attachment: PendingAttachment }) {
  const { dictionary } = useLocale();
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
      alt={interpolate(dictionary.chat.filePreview, {
        name: attachment.filename,
      })}
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
export function chatErrorMessage(
  error: Error,
  dictionary: Dictionary,
): string {
  // Parse on every render so a retained failed submission immediately follows
  // the active locale. Unknown envelopes never expose their raw text.
  const code = parseSerializedApiErrorCode(error.message);
  if (code === null) return dictionary.chat.chatError;
  const messages: Record<SafeApiErrorCode, string> = {
    AI_NOT_CONFIGURED: dictionary.apiErrors.chatAiNotConfigured,
    INTERNAL_ERROR: dictionary.apiErrors.chatUnavailable,
    INVALID_INPUT: dictionary.apiErrors.chatInvalidInput,
    PAYLOAD_TOO_LARGE: dictionary.apiErrors.chatPayloadTooLarge,
    RATE_LIMITED: dictionary.apiErrors.chatRateLimited,
    REQUEST_TIMEOUT: dictionary.apiErrors.chatRequestTimeout,
  };
  return messages[code];
}

function toolLabels(
  copy: Dictionary["chat"],
): Record<ClientAiToolResult["tool"], string> {
  return {
    calculateOpportunityScore: copy.toolCalculateOpportunityScore,
    compareMarkets: copy.toolCompareMarkets,
    compareRegulations: copy.toolCompareRegulations,
    findCompatibleProducts: copy.toolFindCompatibleProducts,
    generateSalesBrief: copy.toolGenerateSalesBrief,
    getCountryProfile: copy.toolGetCountryProfile,
    searchKnowledgeBase: copy.toolSearchKnowledgeBase,
  };
}

function statusLabels(copy: Dictionary["chat"]) {
  return {
    error: copy.toolStatusError,
    no_data: copy.toolStatusNoData,
    ok: copy.toolStatusOk,
  } as const;
}

function regulationStatusLabels(dictionary: Dictionary) {
  return {
    adopted: dictionary.country.statusAdopted,
    effective: dictionary.country.statusEffective,
    proposed: dictionary.country.statusProposed,
    superseded: dictionary.country.statusSuperseded,
  } as const;
}

function fitStatusLabels(dictionary: Dictionary) {
  return {
    fit: dictionary.productFit.fit,
    not_fit: dictionary.productFit.notFit,
    unknown: dictionary.productFit.unknownFit,
  } as const;
}

function commercialReadinessLabels(dictionary: Dictionary) {
  return {
    not_ready: dictionary.productFit.commercialNotReady,
    ready: dictionary.productFit.commercialReady,
    unknown: dictionary.productFit.commercialUnknown,
  } as const;
}

function scoreComponentLabels(copy: Dictionary["chat"]) {
  return {
    marketPotential: copy.scoreMarketPotential,
    productReadiness: copy.scoreProductReadiness,
    regulatoryCoverage: copy.scoreRegulatoryCoverage,
  } as const;
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
  dictionary: Dictionary,
): string {
  const labels = regulationStatusLabels(dictionary);
  if (status === recordStatus) {
    return `${dictionary.chat.queryDate}${dictionary.common.labelSeparator}${labels[status]}`;
  }

  return `${dictionary.chat.queryDate}${dictionary.common.labelSeparator}${labels[status]} · ${dictionary.country.archiveCurrent}${dictionary.common.labelSeparator}${labels[recordStatus]}`;
}

function resultContainsDemoEvidence(result: ClientAiToolResult): boolean {
  return result.citations.some((citation) => citation.isDemo);
}

function CitationList({
  citations,
}: {
  citations: ClientAiCitation[];
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.chat;
  const statusCopy = regulationStatusLabels(dictionary);

  if (citations.length === 0) {
    return (
      <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        {copy.noCitations}
      </p>
    );
  }

  return (
    <details className="rounded-lg border bg-background/40 p-2">
      <summary className="cursor-pointer text-[11px] font-semibold tracking-wide text-muted-foreground">
        {interpolate(copy.viewSources, { count: citations.length })}
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
              <p className="font-medium">
                {localizedCitationTitle(
                  citation,
                  locale,
                  dictionary,
                )}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {citation.sourceTitle} ·{" "}
                {localizedCitationLocator(citation, locale, dictionary)}
              </p>
            </div>
            {isNavigableEvidenceUrl(citation.sourceUrl) ? (
              <a
                aria-label={interpolate(copy.openSource, {
                  title: citation.sourceTitle,
                })}
                className="shrink-0 text-primary hover:underline"
                href={citation.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            ) : citation.isDemo ? (
              <span className="shrink-0 text-[10px] text-amber-800">
                {dictionary.country.demoNoExternalLink}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {citation.regulationStatus ? (
              <span>
                {copy.regulationStatus}{dictionary.common.labelSeparator}
                {statusCopy[citation.regulationStatus]}
              </span>
            ) : null}
            <span>
              {dictionary.common.verified}{dictionary.common.labelSeparator}
              {formatOptionalUtcDate(
                citation.verifiedAt,
                locale,
                dictionary.common.notRecorded,
              )}
            </span>
            {citation.publishedOn ? (
              <span>
                {copy.published}{dictionary.common.labelSeparator}
                {formatUtcDate(citation.publishedOn, locale)}
              </span>
            ) : null}
            {citation.isDemo ? (
              <span className="font-semibold text-amber-700">
                {dictionary.common.demo}
              </span>
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
  const { dictionary, locale } = useLocale();
  const copy = dictionary.chat;
  const components = scoreComponentLabels(copy);

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
        {copy.dataCoverage} {score.dataCoveragePct}%
      </p>
      <div className="mt-2 space-y-2">
        {score.components.map((component) => {
          const content = localizedScoreComponentContent(
            component,
            locale,
            copy,
          );
          return (
            <div
              className="rounded-md border bg-background p-2"
              key={component.key}
            >
              <p className="flex justify-between gap-2">
                <span className="font-medium">{components[component.key]}</span>
                <span>
                  {component.score ?? copy.missing} · {copy.effectiveWeight}{" "}
                  {(component.effectiveWeight * 100).toFixed(0)}% · {copy.contribution}{" "}
                  {component.contribution ?? "—"}
                </span>
              </p>
              <p className="mt-1 leading-4 text-muted-foreground">
                {content.explanation}
              </p>
              {content.inputSummary ? (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {copy.inputFacts}{dictionary.common.labelSeparator}
                  {content.inputSummary}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type QuerySummaryResult = ClientAiToolResult;

function ToolQuerySummary({ result }: { result: QuerySummaryResult }) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.chat;
  const labels = toolLabels(copy);
  let fields: Array<{ label: string; value: string; fullMobileRow?: boolean }>;

  if (result.tool === "searchKnowledgeBase") {
    fields = [
      {
        label: copy.country,
        value: result.resolvedCountryIso3 ?? copy.unspecified,
      },
      {
        label: copy.scope,
        value: result.search.filters.applicationScope
          ? applicationScopeLabel(
              result.search.filters.applicationScope,
              dictionary,
            )
          : copy.unspecified,
      },
      {
        label: copy.date,
        value: formatUtcDate(result.informationAsOf, locale),
      },
      { label: copy.queryConditions, value: result.search.query },
    ];
  } else if (result.tool === "getCountryProfile") {
    fields = [
      {
        label: copy.country,
        value: result.resolvedCountryIso3 ?? copy.unspecified,
      },
      {
        label: copy.date,
        value: formatUtcDate(result.informationAsOf, locale),
      },
      {
        label: copy.queryConditions,
        value: localizedList(
          result.requestedTopics.map((topic) =>
            countryProfileTopicLabel(topic, dictionary),
          ),
          locale,
        ),
      },
    ];
  } else if (result.tool === "findCompatibleProducts") {
    fields = [
      { label: copy.country, value: result.query.countryIso3 ?? copy.unspecified },
      {
        label: copy.scope,
        value: applicationScopeLabel(
          result.query.applicationScope,
          dictionary,
        ),
      },
      { label: copy.power, value: `${result.query.powerKw} kW` },
      { label: copy.date, value: formatUtcDate(result.query.asOf, locale) },
      ...(result.query.productModelCode
        ? [{ label: copy.product, value: result.query.productModelCode }]
        : []),
    ];
  } else if (result.tool === "compareMarkets") {
    fields = [
      {
        label: copy.country,
        value: localizedList(
          result.comparison.query.countryIso3s,
          locale,
        ),
      },
      {
        label: copy.scope,
        value: result.comparison.query.applicationScope
          ? applicationScopeLabel(
              result.comparison.query.applicationScope,
              dictionary,
            )
          : copy.unspecified,
      },
      ...(result.comparison.query.metricCodes
        ? [
            {
              label: copy.marketMetricCodes,
              fullMobileRow: true,
              value: localizedList(
                result.comparison.query.metricCodes,
                locale,
              ),
            },
          ]
        : []),
    ];
  } else if (result.tool === "generateSalesBrief") {
    const { query } = result.brief;
    fields = [
      { label: copy.targetCountry, value: query.targetCountryIso3 },
      {
        label: copy.comparisonCountries,
        value: localizedList(query.countryIso3s, locale),
      },
      {
        label: copy.scope,
        value: applicationScopeLabel(query.applicationScope, dictionary),
      },
      { label: copy.power, value: `${query.powerKw} kW` },
      { label: copy.date, value: formatUtcDate(query.asOf, locale) },
      ...(query.productModelCode
        ? [{ label: copy.product, value: query.productModelCode }]
        : []),
    ];
  } else {
    const query =
      result.tool === "compareRegulations"
        ? result.comparison.query
        : result.scorecard.query;
    const productModelCode =
      result.tool === "calculateOpportunityScore"
        ? result.scorecard.query.productModelCode
        : undefined;
    fields = [
      {
        label: copy.country,
        value: localizedList(query.countryIso3s, locale),
      },
      {
        label: copy.scope,
        value: applicationScopeLabel(query.applicationScope, dictionary),
      },
      { label: copy.power, value: `${query.powerKw} kW` },
      { label: copy.date, value: formatUtcDate(query.asOf, locale) },
      ...(productModelCode
        ? [{ label: copy.product, value: productModelCode }]
        : []),
    ];
  }

  return (
    <dl
      aria-label={`${labels[result.tool]}${dictionary.common.wordSeparator}${copy.queryConditions}`}
      className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-primary/15 bg-background/80 p-2.5 text-xs sm:grid-cols-3"
    >
      {fields.map((field) => (
        <div className={cn("min-w-0", field.fullMobileRow && "col-span-2 sm:col-span-1")} key={field.label}>
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

function ToolFacts({
  countryIso2ByIso3,
  result,
}: {
  countryIso2ByIso3: Readonly<Record<string, string>>;
  result: ClientAiToolResult;
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.chat;
  const fitCopy = fitStatusLabels(dictionary);
  const readinessCopy = commercialReadinessLabels(dictionary);
  const regulationCopy = regulationStatusLabels(dictionary);

  if (result.tool === "getCountryProfile") {
    if (!result.profile || result.profile.status === "no_data") {
      return <p className="text-xs">{copy.countryNoData}</p>;
    }

    return (
      <div className="space-y-2 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-background/70 p-2">
            <span className="text-muted-foreground">
              {copy.currentEffectiveCount}
            </span>
            <strong className="mt-1 block text-base">
              {result.profile.country.currentEffectiveRegulations.length}
            </strong>
          </div>
          <div className="rounded-lg bg-background/70 p-2">
            <span className="text-muted-foreground">
              {copy.futureAdoptedCount}
            </span>
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
            {regulationDisplayName(regulation, dictionary, locale)} ·{" "}
            {copy.queryDate}
            {dictionary.common.labelSeparator}
            {regulationCopy[regulation.statusAtAsOf]}
            {regulation.status !== regulation.statusAtAsOf
              ? ` · ${dictionary.country.archiveCurrent}${dictionary.common.labelSeparator}${regulationCopy[regulation.status]}`
              : ""}
            {" · "}{dictionary.country.applicableJurisdiction}
            {dictionary.common.labelSeparator}
            {nameWithCode(
              jurisdictionDisplayName(
                {
                  code: regulation.applicability.jurisdiction.code,
                  countryIso3: regulation.applicability.countryIso3,
                  id: regulation.applicability.jurisdiction.id,
                  isDemo: regulation.applicability.jurisdiction.isDemo,
                  name: regulation.applicability.jurisdiction.name,
                  sourceId: regulation.applicability.jurisdiction.source.id,
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
            )} ·
            {dictionary.country.membershipPeriod}
            {dictionary.common.labelSeparator}
            {formatUtcDate(
              regulation.applicability.membership.validFrom,
              locale,
            )} →{" "}
            {formatOptionalUtcDate(
              regulation.applicability.membership.validTo,
              locale,
              dictionary.common.open,
            )}
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
              {unwrapUntrustedKnowledgeExcerpt(item.content)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {copy.finalScore} {item.finalScore.toFixed(3)}
            </p>
          </div>
        ))}
      </div>
    ) : (
      <p className="text-xs">{copy.noKnowledgeResults}</p>
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
                {evaluation.product
                  ? productDisplayName(
                      evaluation.product,
                      dictionary,
                      locale,
                    )
                  : evaluation.input.productModelCode}
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
                {fitCopy[evaluation.status]}
              </span>
            </div>
            <p className="mt-1 font-medium">
              {dictionary.productFit.fitAxis}
              {dictionary.common.labelSeparator}{fitCopy[evaluation.status]} ·{" "}
              {readinessCopy[evaluation.commercialReadiness]}
            </p>
            <p className="mt-1 text-muted-foreground">
              {evaluation.reasons
                .map((reason) => productFitReasonMessage(reason, locale))
                .join(copy.listSeparator)}
            </p>
            <p className="mt-1 text-muted-foreground">
              {dictionary.productFit.availability}
              {dictionary.common.labelSeparator}
              {productFitReasonMessage(
                evaluation.productChecks.availability,
                locale,
              )}
            </p>
            {evaluation.product ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {dictionary.productFit.availablePeriod}
                {dictionary.common.labelSeparator}
                {formatProductAvailabilityDateRange(
                  evaluation.product.availableFrom,
                  evaluation.product.availableTo,
                  locale,
                  dictionary.common.notRecorded,
                )}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    ) : (
      <p className="text-xs">{copy.noProductFitResults}</p>
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
          <p className="font-semibold">{copy.comparisonBasis}</p>
          <p>{copy.comparisonBasisBody}</p>
        </div>
        {result.comparison.countries.map((country) => (
          <div
            className="rounded-lg bg-background/70 p-2 text-xs"
            key={country.countryIso3}
          >
            <p className="font-semibold">
              {country.countryIso3} · {localizedRegulationComparisonCountryName(
                country,
                locale,
                countryIso2ByIso3,
              ) ?? copy.noCountryRecord}
            </p>
            <p className="mt-1 text-muted-foreground">
              {copy.currentEffectiveCount} {country.currentEffectiveRegulations.length} ·{" "}
              {copy.futureAdoptedCount} {country.futureAdoptedRegulations.length}
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
                  {interpolate(copy.regulationMissingLimits, {
                    pollutants: localizedList(missing, locale),
                  })}
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
                    {regulationDisplayName(regulation, dictionary, locale)} ·{" "}
                    {dictionary.country.applicableJurisdiction}
                    {dictionary.common.labelSeparator}
                    {nameWithCode(
                      jurisdictionDisplayName(
                        {
                          code: regulation.applicability.jurisdiction.code,
                          countryIso3: regulation.applicability.countryIso3,
                          id: regulation.applicability.jurisdiction.id,
                          isDemo: regulation.applicability.jurisdiction.isDemo,
                          name: regulation.applicability.jurisdiction.name,
                          sourceId:
                            regulation.applicability.jurisdiction.source
                              .sourceId,
                          sourceIsDemo:
                            regulation.applicability.jurisdiction.source.isDemo,
                          sourceTitle:
                            regulation.applicability.jurisdiction.source
                              .sourceTitle,
                          type: "country",
                        },
                        dictionary,
                        locale,
                      ),
                      regulation.applicability.jurisdiction.code,
                      locale,
                    )}
                  </p>
                  <p className="pl-2 text-[11px] font-medium">
                    {regulationStatusNote(
                      regulation.status,
                      regulation.recordStatus,
                      dictionary,
                    )}
                  </p>
                  {regulation.limits.map((limit) => (
                    <p className="pl-2 text-[11px]" key={limit.id}>
                      {limit.pollutantCode} ≤ {formatDecimal(limit.limitValue)}{" "}
                      {limit.unitCode} · {formatUtcDate(limit.validFrom, locale)} →{" "}
                      {formatOptionalUtcDate(
                        limit.validTo,
                        locale,
                        dictionary.common.open,
                      )}
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
    return <MarketComparisonFacts comparison={result.comparison} locale={locale} />;
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
        <p className="font-semibold text-sky-950">{copy.deterministicData}</p>
        <div className="mt-2">
          <ScoreBreakdown score={brief.marketScore} />
        </div>
        <div className="mt-2 space-y-1">
          {brief.recommendedProducts.map((product) => (
            <p key={product.modelCode}>
              {copy.commerciallyReady}{dictionary.common.labelSeparator}
              {product.modelCode} · {productDisplayName(
                product,
                dictionary,
                locale,
              )} · {dictionary.productFit.fitAxis}{" "}
              {dictionary.productFit.fit} · {dictionary.productFit.availability}{" "}
              {dictionary.productFit.pass} · {dictionary.productFit.availablePeriod}
              {dictionary.common.labelSeparator}
              {formatProductAvailabilityDateRange(
                product.availableFrom,
                product.availableTo,
                locale,
                dictionary.common.notRecorded,
              )}
            </p>
          ))}
          {brief.risks.map((risk, index) => (
            <p key={`${risk.ruleCode}:${index}`}>
              {copy.risk}{dictionary.common.labelSeparator}
              {localizedSalesBriefItem(
                risk,
                index,
                "risk",
                locale,
                copy,
              )}
            </p>
          ))}
        </div>
      </section>
      <section className="rounded-lg border border-violet-200 bg-violet-50/80 p-2.5 text-xs">
        <p className="font-semibold text-violet-950">
          {copy.ruleGeneratedAdvice}
        </p>
        <p className="mt-1 text-violet-900">
          {localizedSalesBriefSummary(brief, locale, copy)}
        </p>
        <div className="mt-2 space-y-1">
          {brief.opportunities.map((opportunity, index) => (
            <p key={`${opportunity.ruleCode}:${index}`}>
              {copy.opportunity}{dictionary.common.labelSeparator}
              {localizedSalesBriefItem(
                opportunity,
                index,
                "opportunity",
                locale,
                copy,
              )}
            </p>
          ))}
          {brief.salesActions.map((action, index) => (
            <p key={`${action.ruleCode}:${index}`}>
              {localizedSalesBriefAction(
                action,
                index,
                locale,
                copy,
              )}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}

export function toolResultMayRenderFacts(
  result: Pick<ClientAiToolResult, "status">,
): boolean {
  return result.status !== "error";
}

function ToolResultCard({
  countryIso2ByIso3,
  result,
}: {
  countryIso2ByIso3: Readonly<Record<string, string>>;
  result: ClientAiToolResult;
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.chat;
  const labels = toolLabels(copy);
  const statuses = statusLabels(copy);
  const mayRenderFacts = toolResultMayRenderFacts(result);
  const hasDemoEvidence = resultContainsDemoEvidence(result);
  const warnings = localizedToolWarnings(result, locale, copy);

  return (
    <section
      aria-label={labels[result.tool]}
      className={cn(
        "my-2 space-y-3 rounded-md border p-3",
        result.status === "ok"
          ? "border-primary/20 bg-primary/5"
          : "border-amber-300/60 bg-amber-50/80",
      )}
    >
      <header className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <FileText aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 break-words">
            <p className="text-xs font-semibold">{labels[result.tool]}</p>
            <p className="text-[11px] text-muted-foreground">
              {mayRenderFacts ? (
                <>
                  {copy.deterministicFacts} · {result.tool === "compareMarkets" ? copy.resultGeneratedOn : copy.queryAsOf}{dictionary.common.labelSeparator}{formatUtcDate(result.informationAsOf, locale)} · {copy.latestVerified}{dictionary.common.labelSeparator}
                  {formatOptionalUtcDate(
                    result.latestVerifiedAt,
                    locale,
                    dictionary.common.notRecorded,
                  )}
                </>
              ) : copy.queryConditions}
            </p>
          </div>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full border bg-background px-2 py-0.5 text-[10px] font-semibold">
          {statuses[result.status]}
        </span>
      </header>

      {result.status === "error" ||
      result.tool === "searchKnowledgeBase" ||
      result.tool === "findCompatibleProducts" ||
      result.tool === "compareRegulations" ||
      result.tool === "compareMarkets" ||
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
          {copy.demoEvidenceWarning}
        </div>
      ) : null}

      {mayRenderFacts ? (
        <ToolFacts countryIso2ByIso3={countryIso2ByIso3} result={result} />
      ) : null}

      {warnings.length > 0 ? (
        <div className="space-y-1 rounded-lg bg-amber-100/80 p-2 text-xs text-amber-950">
          {warnings.map((warning) => (
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

      {mayRenderFacts ? (
        <CitationList citations={result.citations} />
      ) : null}
    </section>
  );
}

type ChatMessagePart = SalesChatUiMessage["parts"][number];

function citationUrlsForMessage(parts: readonly ChatMessagePart[]): string[] {
  const urls = new Set<string>();

  for (const part of parts) {
    if (!isToolUIPart(part)) {
      continue;
    }
    const presentation = toolPartPresentation(part);
    if (presentation.kind !== "result") {
      continue;
    }
    for (const citation of presentation.result.citations) {
      if (isNavigableEvidenceUrl(citation.sourceUrl)) {
        urls.add(citation.sourceUrl);
      }
    }
  }

  return Array.from(urls);
}

function AttachmentPart({ part }: { part: FileUIPart }) {
  const { dictionary } = useLocale();
  const filename = part.filename ?? dictionary.chat.unnamedAttachment;

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

function ReleasedAttachmentPart({
  attachment,
}: {
  attachment: NonNullable<
    ReturnType<typeof parseReleasedAttachmentPart>
  >;
}) {
  const { dictionary } = useLocale();

  return (
    <p className="my-2 text-xs opacity-80">
      [{formatReleasedAttachment(attachment, dictionary)}]
    </p>
  );
}

function ToolPart({
  countryIso2ByIso3,
  part,
}: {
  countryIso2ByIso3: Readonly<Record<string, string>>;
  part: ChatMessagePart;
}) {
  const { dictionary } = useLocale();
  if (!isToolUIPart(part)) {
    return null;
  }
  const presentation = toolPartPresentation(part);
  if (presentation.kind === "result") {
    return (
      <ToolResultCard
        countryIso2ByIso3={countryIso2ByIso3}
        result={presentation.result}
      />
    );
  }
  if (presentation.kind === "error") {
    return (
      <div
        className="my-2 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        role="alert"
      >
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {toolPartErrorMessage(presentation.code, dictionary.chat)}
      </div>
    );
  }

  return (
    <div className="my-2 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      {dictionary.chat.deterministicQuery}
    </div>
  );
}

export function SalesChat({
  aiConfigured,
  countryIso2ByIso3,
  demoMode = false,
  imageUploadsEnabled,
  initialPrompt = "",
  selectedCountryIso3,
  suggestedPrompts = [],
}: SalesChatProps) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.chat;
  const [sessionId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState(initialPrompt);
  const initialPromptPristineRef = useRef(true);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [failedSubmission, setFailedSubmission] =
    useState<FailedSubmission | null>(null);
  const [attachmentError, setAttachmentError] =
    useState<ChatAttachmentErrorDescriptor | null>(null);
  const [submissionPending, setSubmissionPending] = useState(false);
  const [validatingAttachments, setValidatingAttachments] = useState(false);
  const validatingAttachmentsRef = useRef(false);
  const activeSubmissionRef = useRef<ActiveSubmission | null>(null);
  const activeSubmissionLocaleRef = useRef(locale);
  const submissionPendingRef = useRef(false);
  const [settledChatMessages, setSettledChatMessages] = useState<
    SalesChatUiMessage[]
  >([]);
  const [activeChatRequest, setActiveChatRequest] = useState<{
    locale: Locale;
  } | null>(null);
  const [attachmentMessageRelease] = useState(
    () => new AttachmentMessageReleaseCoordinator(),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<SalesChatUiMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({
          body,
          id,
          messageId,
          messages,
          trigger,
        }) => {
          const requestMessages = prepareSalesChatRequestMessages(messages);
          attachmentMessageRelease.run();

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
    [attachmentMessageRelease],
  );
  const chatId =
    activeChatRequest !== null && activeChatRequest.locale !== locale
      ? `${sessionId}:retired:${locale}`
      : sessionId;
  const {
    clearError,
    error,
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
  } = useChat<SalesChatUiMessage>({
    id: chatId,
    messages: settledChatMessages,
    onFinish: ({ isAbort, isError, messages: finishedMessages }) => {
      const activeSubmission = activeSubmissionRef.current;
      if (!activeSubmission || activeSubmissionLocaleRef.current !== locale) {
        return;
      }

      if (!isAbort) {
        // The locale hand-off snapshot must never retain attachment bytes even
        // though the live Chat releases them a moment later in sendSubmission.
        setSettledChatMessages(
          releaseSalesChatMessageAttachments(finishedMessages),
        );
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

  useEffect(() => {
    return attachmentMessageRelease.connect(() => {
      setMessages(releaseSalesChatMessageAttachments);
    });
  }, [attachmentMessageRelease, setMessages]);
  useEffect(
    () => () => {
      // `useChat` does not abort its transport when React retires the instance.
      // A locale change rotates the id above, while an SPA navigation unmounts
      // the component; both paths must stop the old provider/tool stream.
      void stop();
    },
    [stop],
  );
  const messageLogRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const waiting = status === "submitted" || status === "streaming";
  const recoveryPending = error !== undefined && failedSubmission !== null;

  useEffect(() => {
    // A retired locale-owned Chat may still invoke its completion callback.
    // It no longer owns retry state in the newly localized conversation.
    activeSubmissionRef.current = null;
  }, [locale]);

  useEffect(() => {
    if (initialPromptPristineRef.current) {
      setInput(initialPrompt);
    }
  }, [initialPrompt]);

  useEffect(() => {
    const messageLog = messageLogRef.current;
    if (!messageLog || !shouldAutoScrollRef.current) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      messageLog.scrollTop = messageLog.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, status]);

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
        const prospectiveValidationError = validateChatAttachments([
          ...pendingAttachments,
          ...additions,
          { file },
        ]);
        if (prospectiveValidationError) {
          setAttachmentError(prospectiveValidationError);
          return;
        }

        const filename = normalizeChatAttachmentFilename(file.name);

        const mediaType = resolveChatAttachmentMediaType(file);
        if (!mediaType) {
          setAttachmentError({
            kind: "unsupported_file",
            name: filename,
          });
          return;
        }
        if (mediaType.startsWith("image/") && !imageUploadsEnabled) {
          setAttachmentError({ kind: "image_model_unavailable" });
          return;
        }
        const addition = {
          file,
          filename,
          id: crypto.randomUUID(),
          mediaType,
        };
        if (mediaType.startsWith("image/")) {
          let bytes: Uint8Array;
          try {
            bytes = new Uint8Array(await file.arrayBuffer());
          } catch {
            setAttachmentError({
              kind: "image_read_failed",
              name: filename,
            });
            return;
          }
          if (!hasStructurallyValidChatImage(mediaType, bytes)) {
            setAttachmentError(imageInvalidAttachmentError(filename));
            return;
          }
        }
        additions.push(addition);
      }

      const nextAttachments = [...pendingAttachments, ...additions];
      const validationError = validateChatAttachments(nextAttachments);
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
      setAttachmentError({ kind: "attachment_read_failed" });
      return null;
    }
  }

  async function sendSubmission(
    submission: ActiveSubmission,
    files: FileUIPart[],
  ) {
    const chatRequestOwner = { locale };
    activeSubmissionRef.current = submission;
    activeSubmissionLocaleRef.current = locale;
    setActiveChatRequest(chatRequestOwner);
    attachmentMessageRelease.trackFileParts(files);
    try {
      await sendMessage(
        submission.messageId
          ? { files, messageId: submission.messageId, text: submission.text }
          : { files, text: submission.text },
        {
          body: {
            locale,
            selectedCountryIso3,
            sessionId,
          },
        },
      );
    } finally {
      attachmentMessageRelease.run();
      if (activeSubmissionRef.current === submission) {
        activeSubmissionRef.current = null;
      }
      setActiveChatRequest((currentOwner) =>
        currentOwner === chatRequestOwner ? null : currentOwner,
      );
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
    initialPromptPristineRef.current = false;
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
    initialPromptPristineRef.current = false;
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
      className="surface-panel flex h-full min-w-0 min-h-[34rem] flex-col overflow-hidden rounded-md"
      data-sales-chat-root
      id="sales-chat-panel"
      role="complementary"
    >
      <header className="flex items-center justify-between border-b bg-card px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-primary">
            <Bot aria-hidden="true" className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground" id="sales-chat-heading">
              {copy.title}
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {demoMode
                ? copy.demoAi
                : aiConfigured
                  ? copy.aiConfigured
                  : copy.aiNotConfigured} · {copy.mapCountry}{dictionary.common.labelSeparator}
              {selectedCountryIso3 ?? copy.noSelection}
            </p>
          </div>
        </div>
      </header>

      <p
        aria-busy={status === "submitted" || status === "streaming"}
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {status === "submitted"
          ? copy.statusSubmitted
          : status === "streaming"
            ? copy.statusGenerating
            : status === "ready" && messages.length > 0
              ? copy.statusComplete
              : ""}
      </p>

      <div
        aria-label={copy.roleLabel}
        className="min-h-56 flex-1 space-y-5 overflow-y-auto bg-muted/30 p-4 sm:p-6"
        onScroll={(event) => {
          const messageLog = event.currentTarget;
          shouldAutoScrollRef.current =
            messageLog.scrollHeight -
              messageLog.scrollTop -
              messageLog.clientHeight <
            80;
        }}
        ref={messageLogRef}
        role="region"
      >
        {messages.length === 0 ? (
          <div className="mx-auto max-w-xl py-8 text-sm sm:py-12">
            <div aria-hidden="true" className="mb-5 grid size-14 place-items-center rounded-xl border bg-card text-primary"><Bot className="size-7" /></div>
            <h3 className="mb-3 text-lg font-semibold">{dictionary.chatPage.sidebarHeading}</h3>
            <p className="text-xs leading-6 text-muted-foreground">
              {demoMode
                ? copy.emptyDemo
                : copy.emptyLive}
            </p>
            {suggestedPrompts.length > 0 ? (
              <div className="mt-5 grid gap-2">
                {suggestedPrompts.map((prompt) => (
                  <button
                    className="rounded-md border bg-card px-4 py-3 text-left text-sm leading-5 font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    key={prompt}
                    onClick={() => {
                      initialPromptPristineRef.current = false;
                      setInput(prompt);
                      inputRef.current?.focus();
                    }}
                    type="button"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {messages.map((message) => {
          const allowedExternalUrls =
            message.role === "assistant"
              ? citationUrlsForMessage(message.parts)
              : [];

          return (
            <article
            className={cn(
              "rounded-md px-4 py-3 text-sm shadow-sm",
              message.role === "user"
                ? "ml-8 bg-primary text-primary-foreground sm:ml-24"
                : "mr-2 border border-black/[0.06] bg-white sm:mr-12",
            )}
            key={message.id}
          >
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-70">
              {message.role === "user" ? copy.user : copy.assistant}
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
                        {copy.aiExplanation}
                      </p>
                    ) : null}
                    {message.role === "assistant" ? (
                      <AssistantMarkdown
                        allowedExternalUrls={allowedExternalUrls}
                        content={part.text}
                        hiddenImage={copy.hiddenModelImage}
                        hiddenImageWithAlt={copy.hiddenModelImageWithAlt}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap leading-6">
                        {part.text}
                      </p>
                    )}
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

              const releasedAttachment = parseReleasedAttachmentPart(part);
              if (releasedAttachment) {
                return (
                  <ReleasedAttachmentPart
                    attachment={releasedAttachment}
                    key={`${message.id}-released-file-${index}`}
                  />
                );
              }

              if (part.type === "data-releasedAttachment") {
                return null;
              }

              return (
                <ToolPart
                  countryIso2ByIso3={countryIso2ByIso3}
                  key={`${message.id}-part-${index}`}
                  part={part}
                />
              );
            })}
            </article>
          );
        })}

        {status === "submitted" ? (
          <div
            aria-hidden="true"
            className="flex items-center gap-2 px-2 text-xs text-muted-foreground"
          >
            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
            {copy.pendingTools}
          </div>
        ) : null}

        {error ? (
          <div
            className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
            role="alert"
          >
            <p>{chatErrorMessage(error, dictionary)}</p>
            {failedSubmission ? (
              <div className="space-y-2 rounded-lg border border-destructive/20 bg-background/70 p-2.5 text-foreground">
                <p className="font-semibold">{copy.attachmentFailedBody}</p>
                <p className="line-clamp-3 text-muted-foreground">
                  {copy.failedQuestion}{dictionary.common.labelSeparator}{failedSubmission.text}
                </p>
                {failedSubmission.attachments.length > 0 ? (
                  <p className="break-words text-muted-foreground">
                    {copy.attachment}{dictionary.common.labelSeparator}
                    {failedSubmission.attachments
                      .map(({ filename }) => filename)
                      .join(locale === "en" ? ", " : "、")}
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
                    {copy.rawRetry}
                  </Button>
                  <Button
                    className="h-8 gap-1.5 px-3 text-xs"
                    disabled={waiting || submissionPending}
                    onClick={editFailedSubmission}
                    type="button"
                    variant="outline"
                  >
                    <PencilLine aria-hidden="true" className="size-3.5" />
                    {copy.editRetry}
                  </Button>
                </div>
                <p className="text-[10px] leading-4 text-muted-foreground">
                  {copy.recoveryPolicy}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="border-t bg-card p-3 sm:p-4">
        <form
          aria-busy={validatingAttachments || submissionPending}
          className="space-y-2"
          onSubmit={submit}
        >
          {pendingAttachments.length > 0 ? (
            <ul
              aria-label={copy.attachmentList}
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
                      {attachment.filename}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatChatAttachmentBytes(attachment.file.size, locale)}
                    </p>
                  </div>
                  <Button
                    aria-label={interpolate(copy.removeAttachment, {
                      name: attachment.filename,
                    })}
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
              {formatChatAttachmentError(
                attachmentError,
                dictionary,
                locale,
              )}
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
              {copy.attachmentValidating}
            </p>
          ) : null}

          <div className="flex gap-2 rounded-md border bg-white p-2 shadow-sm focus-within:ring-[3px] focus-within:ring-ring/20">
            <input
              accept={
                imageUploadsEnabled
                  ? CHAT_ATTACHMENT_ACCEPT
                  : CHAT_DOCUMENT_ATTACHMENT_ACCEPT
              }
              aria-label={
                imageUploadsEnabled
                  ? copy.attachmentInputImage
                  : copy.attachmentInput
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
                  ? copy.validating
                  : imageUploadsEnabled
                    ? copy.addFileOrImage
                    : copy.addFile
              }
              className="size-11 rounded-lg border-0 bg-muted p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-primary"
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
              {copy.questionInput}
            </label>
            <textarea
              className="min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-slate-400"
              id="sales-chat-input"
              maxLength={MAX_CHAT_USER_MESSAGE_CHARACTERS}
              onChange={(event) => {
                initialPromptPristineRef.current = false;
                setInput(event.target.value);
              }}
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
                  ? copy.placeholderImage
                  : copy.placeholder
              }
              readOnly={recoveryPending || submissionPending}
              rows={2}
              ref={inputRef}
              value={input}
            />
            {waiting ? (
              <Button
                aria-label={copy.stopGenerating}
                className="h-11 shrink-0 gap-1.5 rounded-md bg-red-800 px-3 text-white shadow-none hover:bg-red-900"
                onClick={() => void stop()}
                type="button"
              >
                <Square aria-hidden="true" className="size-3.5 fill-current" />
                <span>{copy.stopGenerating}</span>
              </Button>
            ) : (
              <Button
                aria-label={copy.send}
                className="size-11 rounded-lg bg-primary p-0 text-primary-foreground shadow-none hover:bg-primary/90"
                disabled={
                  recoveryPending ||
                  submissionPending ||
                  validatingAttachments ||
                  !input.trim() ||
                  !aiConfigured
                }
                type="submit"
              >
                {submissionPending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-4 animate-spin"
                  />
                ) : (
                  <Send aria-hidden="true" className="size-4" />
                )}
              </Button>
            )}
          </div>
        </form>
      </div>
    </aside>
  );
}
