import "server-only";

import {
  InvalidToolInputError,
  stepCountIs,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
} from "ai";

import {
  calculateOpportunityScoreResultSchema,
  compareMarketsResultSchema,
  compareRegulationsResultSchema,
  findCompatibleProductsInputSchema,
  findCompatibleProductsResultSchema,
  generateSalesBriefResultSchema,
  getCountryProfileInputSchema,
  getCountryProfileResultSchema,
  aiToolNameSchema,
  aiToolResultSchema,
  searchKnowledgeBaseInputSchema,
  searchKnowledgeBaseResultSchema,
  type AiToolResult,
  type CalculateOpportunityScoreInput,
  type CompareMarketsInput,
  type CompareRegulationsInput,
  type FindCompatibleProductsInput,
  type GenerateSalesBriefInput,
  type GetCountryProfileInput,
  type SearchKnowledgeBaseInput,
} from "@/features/ai/schemas";
import {
  calculateOpportunityScoreInputSchema,
  compareMarketsInputSchema,
  compareRegulationsInputSchema,
  generateSalesBriefInputSchema,
} from "@/features/marketing/schemas";
import type { AiAuditRepository } from "@/server/repositories/ai-audit-repository";
import {
  buildCompatibleProductsResult,
  buildCountryProfileResult,
  buildKnowledgeResult,
  buildMarketComparisonResult,
  buildOpportunityScoreResult,
  buildRegulationComparisonResult,
  buildSalesBriefResult,
  buildToolErrorResult,
  currentUtcDate,
} from "@/server/ai/tool-results";
import { getCountryDetails } from "@/server/services/country-service";
import { findCompatibleProducts } from "@/server/services/compatible-products-service";
import { hybridSearchKnowledge } from "@/server/services/knowledge-service";
import {
  calculateOpportunityScore,
  compareMarkets,
  compareRegulations,
  generateSalesBrief,
} from "@/server/services/marketing-analysis-service";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
  evidenceNeedsRegulatoryDisclaimer,
  type SalesChatEvidenceContract,
} from "@/server/ai/evidence-contract";
import { buildSalesChatInstructions } from "@/server/ai/sales-chat-prompt";
import {
  collectSalesChatStepEvidence,
  resolveSalesChatLoopPolicy,
  SALES_CHAT_TOOL_ORDER,
} from "@/server/ai/sales-chat-loop";

export const MAX_AI_TOOL_STEPS = 5;
const regulatoryDisclaimer = "信息参考，不替代正式认证或法律意见";

type SalesChatToolServices = {
  calculateOpportunityScore: typeof calculateOpportunityScore;
  compareMarkets: typeof compareMarkets;
  compareRegulations: typeof compareRegulations;
  findCompatibleProducts: typeof findCompatibleProducts;
  generateSalesBrief: typeof generateSalesBrief;
  getCountryDetails: typeof getCountryDetails;
  hybridSearchKnowledge: typeof hybridSearchKnowledge;
};

type CreateSalesChatToolsInput = {
  auditRepository: Pick<AiAuditRepository, "recordToolCall">;
  selectedCountryIso3: string | null;
  services?: Partial<SalesChatToolServices>;
  sessionId: string;
};

const defaultServices: SalesChatToolServices = {
  calculateOpportunityScore,
  compareMarkets,
  compareRegulations,
  findCompatibleProducts,
  generateSalesBrief,
  getCountryDetails,
  hybridSearchKnowledge,
};

export function resolveCountryIso3(
  explicitCountryIso3: string | null | undefined,
  selectedCountryIso3: string | null,
): string | null {
  return explicitCountryIso3 ?? selectedCountryIso3;
}

function auditInput(
  toolName: AiToolResult["tool"],
  input: object,
): Record<string, unknown> {
  const minimized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }
    if (
      toolName === "searchKnowledgeBase" &&
      key === "query" &&
      typeof value === "string"
    ) {
      minimized.queryCharacterCount = Array.from(value).length;
      continue;
    }
    minimized[key] = value;
  }

  return minimized;
}

function invalidToolInputSummary(toolInput: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(toolInput);

    if (Array.isArray(parsed)) {
      return { inputType: "array" };
    }
    if (parsed === null) {
      return { inputType: "null" };
    }
    if (typeof parsed === "object") {
      return {
        inputType: "object",
        providedFields: Object.keys(parsed).sort(),
      };
    }

    return { inputType: typeof parsed };
  } catch {
    return { inputType: "invalid_json" };
  }
}

async function auditInvalidToolInput(options: {
  auditRepository: Pick<AiAuditRepository, "recordToolCall">;
  error: InstanceType<typeof InvalidToolInputError>;
  sessionId: string;
  toolCallId: string;
  toolName: AiToolResult["tool"];
}): Promise<void> {
  const occurredAt = new Date();

  await options.auditRepository.recordToolCall({
    citations: [],
    completedAt: occurredAt,
    durationMs: 0,
    errorCode: "INVALID_TOOL_INPUT",
    input: invalidToolInputSummary(options.error.toolInput),
    resultSummary: {
      citationCount: 0,
      evidenceSufficient: false,
      status: "error",
      validation: "invalid_tool_input",
      warningCount: 0,
    },
    sessionId: options.sessionId,
    startedAt: occurredAt,
    status: "error",
    toolCallId: options.toolCallId,
    toolName: options.toolName,
  });
}

function resultSummary(result: AiToolResult): Record<string, unknown> {
  const base = {
    citationCount: result.citations.length,
    evidenceSufficient: result.evidenceSufficient,
    informationAsOf: result.informationAsOf,
    latestVerifiedAt: result.latestVerifiedAt,
    status: result.status,
    warningCount: result.warnings.length,
  };

  if (result.tool === "searchKnowledgeBase") {
    return {
      ...base,
      resultCount: result.search.results.length,
    };
  }
  if (result.tool === "getCountryProfile") {
    return {
      ...base,
      countryIso3: result.resolvedCountryIso3,
      profileStatus: result.profile?.status ?? "missing_context",
    };
  }
  if (result.tool === "compareRegulations") {
    return {
      ...base,
      countryCount: result.comparison.countries.length,
      regulationCount: result.comparison.countries.reduce(
        (sum, country) =>
          sum +
          country.currentEffectiveRegulations.length +
          country.futureAdoptedRegulations.length,
        0,
      ),
    };
  }
  if (result.tool === "compareMarkets") {
    return {
      ...base,
      comparableMetricCount: result.comparison.metrics.filter(
        ({ comparisonStatus }) => comparisonStatus === "comparable",
      ).length,
      metricCount: result.comparison.metrics.length,
    };
  }
  if (result.tool === "calculateOpportunityScore") {
    return {
      ...base,
      rulesetVersion: result.scorecard.rulesetVersion,
      scoreCount: result.scorecard.scores.filter(
        ({ overallScore }) => overallScore !== null,
      ).length,
      weights: result.scorecard.weights,
    };
  }
  if (result.tool === "generateSalesBrief") {
    return {
      ...base,
      countryIso3: result.brief.marketScore.countryIso3,
      missingDataCount: result.brief.missingData.length,
      opportunityCount: result.brief.opportunities.length,
      recommendedProductCount: result.brief.recommendedProducts.length,
      riskCount: result.brief.risks.length,
      salesActionCount: result.brief.salesActions.length,
    };
  }

  return {
    ...base,
    evaluationCount: result.evaluations.length,
    fitCount: result.evaluations.filter(({ status }) => status === "fit")
      .length,
    notFitCount: result.evaluations.filter(
      ({ status }) => status === "not_fit",
    ).length,
    unknownCount: result.evaluations.filter(
      ({ status }) => status === "unknown",
    ).length,
  };
}

async function executeAuditedTool<TInput extends object>(
  options: {
    auditRepository: Pick<AiAuditRepository, "recordToolCall">;
    execute: () => Promise<AiToolResult>;
    fallbackAsOf: string;
    input: TInput;
    sessionId: string;
    toolCallId: string;
    toolName: AiToolResult["tool"];
  },
): Promise<AiToolResult> {
  const startedAt = new Date();
  let errorCode: string | null = null;
  let result: AiToolResult;

  try {
    result = await options.execute();
  } catch (error: unknown) {
    errorCode = error instanceof Error ? error.name : "UNKNOWN_ERROR";
    console.error("AI tool execution failed", {
      errorCode,
      toolName: options.toolName,
    });
    result = buildToolErrorResult(
      options.toolName,
      options.fallbackAsOf,
      options.input,
    );
  }

  const completedAt = new Date();
  await options.auditRepository.recordToolCall({
    citations: result.citations,
    completedAt,
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    errorCode,
    input: auditInput(options.toolName, options.input),
    resultSummary: resultSummary(result),
    sessionId: options.sessionId,
    startedAt,
    status:
      result.status === "error"
        ? "error"
        : result.status === "no_data"
          ? "no_data"
          : "success",
    toolCallId: options.toolCallId,
    toolName: options.toolName,
  });

  return result;
}

export function createSalesChatTools({
  auditRepository,
  selectedCountryIso3,
  services = defaultServices,
  sessionId,
}: CreateSalesChatToolsInput) {
  const resolvedServices: SalesChatToolServices = {
    ...defaultServices,
    ...services,
  };

  return {
    calculateOpportunityScore: tool({
      description:
        "Calculate deterministic opportunity scores for a 2-5 country comparison cohort. The code-owned opportunity-score-v1 weights and structured database facts are authoritative; unknown or missing inputs are excluded rather than scored as zero. Use this for any opportunity score or ranking request. Preserve an explicitly named productModelCode instead of broadening to the full catalog. Never calculate or modify a score yourself.",
      execute: async (
        input: CalculateOpportunityScoreInput,
        { toolCallId },
      ) =>
        executeAuditedTool({
          auditRepository,
          execute: async () =>
            buildOpportunityScoreResult({
              informationAsOf: input.asOf,
              scorecard:
                await resolvedServices.calculateOpportunityScore(input),
            }),
          fallbackAsOf: input.asOf,
          input,
          sessionId,
          toolCallId,
          toolName: "calculateOpportunityScore",
        }).then((result) =>
          calculateOpportunityScoreResultSchema.parse(result),
        ),
      inputSchema: calculateOpportunityScoreInputSchema,
      outputSchema: calculateOpportunityScoreResultSchema,
    }),

    compareMarkets: tool({
      description:
        "Compare only structured market_metrics records across 2-5 countries. It checks period, unit, currency, methodology and application-scope comparability and performs no implicit conversion. Use this for market facts and comparisons.",
      execute: async (input: CompareMarketsInput, { toolCallId }) => {
        const informationAsOf = currentUtcDate();
        return executeAuditedTool({
          auditRepository,
          execute: async () =>
            buildMarketComparisonResult({
              comparison: await resolvedServices.compareMarkets(input),
              informationAsOf,
            }),
          fallbackAsOf: informationAsOf,
          input,
          sessionId,
          toolCallId,
          toolName: "compareMarkets",
        }).then((result) => compareMarketsResultSchema.parse(result));
      },
      inputSchema: compareMarketsInputSchema,
      outputSchema: compareMarketsResultSchema,
    }),

    compareRegulations: tool({
      description:
        "Query or compare database-backed regulations effective at the requested date and regulations already adopted by that date for 1-5 countries, including limits and sources. A now-superseded record may support a historical date only when its validity interval covers that date; proposed records are excluded. Use this for any regulation question that specifies application scope and power.",
      execute: async (
        input: CompareRegulationsInput,
        { toolCallId },
      ) =>
        executeAuditedTool({
          auditRepository,
          execute: async () =>
            buildRegulationComparisonResult({
              comparison:
                await resolvedServices.compareRegulations(input),
              informationAsOf: input.asOf,
            }),
          fallbackAsOf: input.asOf,
          input,
          sessionId,
          toolCallId,
          toolName: "compareRegulations",
        }).then((result) =>
          compareRegulationsResultSchema.parse(result),
        ),
      inputSchema: compareRegulationsInputSchema,
      outputSchema: compareRegulationsResultSchema,
    }),

    findCompatibleProducts: tool({
      description:
        "Deterministically evaluate a named product, or every catalog product when no model is named, against the effective regulations and certification records for a country, application scope, power and date. Use this for all product compatibility or compliance questions. Preserve an explicitly named productModelCode. An explicitly named country must be passed and overrides map context.",
      execute: async (
        input: FindCompatibleProductsInput,
        { toolCallId },
      ) =>
        executeAuditedTool({
          auditRepository,
          execute: async () => {
            const countryIso3 = resolveCountryIso3(
              input.countryIso3,
              selectedCountryIso3,
            );
            const evaluations =
              countryIso3 === null
                ? []
                : await resolvedServices.findCompatibleProducts({
                    ...input,
                    countryIso3,
                  });

            return buildCompatibleProductsResult({
              applicationScope: input.applicationScope,
              asOf: input.asOf,
              countryIso3,
              evaluations,
              powerKw: input.powerKw,
              ...(input.productModelCode
                ? { productModelCode: input.productModelCode }
                : {}),
            });
          },
          fallbackAsOf: input.asOf,
          input,
          sessionId,
          toolCallId,
          toolName: "findCompatibleProducts",
        }).then((result) =>
          findCompatibleProductsResultSchema.parse(result),
        ),
      inputSchema: findCompatibleProductsInputSchema,
      outputSchema: findCompatibleProductsResultSchema,
    }),

    getCountryProfile: tool({
      description:
        "Get structured country facts, current effective regulations, future adopted regulations, market metrics, source dates and last verification time. The required topics array must match the user's requested evidence domains; missing requested regulation or market evidence returns no_data. Use this for single-country country, regulation-status, or market-fact questions. An explicitly named country must be passed and overrides map context.",
      execute: async (input: GetCountryProfileInput, { toolCallId }) =>
        executeAuditedTool({
          auditRepository,
          execute: async () => {
            const countryIso3 = resolveCountryIso3(
              input.countryIso3,
              selectedCountryIso3,
            );
            const informationAsOf = input.asOf ?? currentUtcDate();
            const profile =
              countryIso3 === null
                ? null
                : await resolvedServices.getCountryDetails({
                    asOf: informationAsOf,
                    iso3: countryIso3,
                  });

            return buildCountryProfileResult({
              informationAsOf,
              profile,
              requestedTopics: input.topics,
              resolvedCountryIso3: countryIso3,
            });
          },
          fallbackAsOf: input.asOf ?? currentUtcDate(),
          input,
          sessionId,
          toolCallId,
          toolName: "getCountryProfile",
        }).then((result) => getCountryProfileResultSchema.parse(result)),
      inputSchema: getCountryProfileInputSchema,
      outputSchema: getCountryProfileResultSchema,
    }),

    searchKnowledgeBase: tool({
      description:
        "Search traceable source-document evidence with metadata filters and return document, source, section/page, validity and scores. Use this for regulatory wording, explanations and source-document evidence. An explicitly named country must be passed and overrides map context.",
      execute: async (input: SearchKnowledgeBaseInput, { toolCallId }) =>
        executeAuditedTool({
          auditRepository,
          execute: async () => {
            const countryIso3 = resolveCountryIso3(
              input.countryIso3,
              selectedCountryIso3,
            );
            const informationAsOf = input.asOf ?? currentUtcDate();
            const search = await resolvedServices.hybridSearchKnowledge({
              applicationScope: input.applicationScope ?? null,
              asOf: informationAsOf,
              countryIso3,
              jurisdictionId: input.jurisdictionId ?? null,
              limit: input.limit ?? 5,
              query: input.query,
            });

            return buildKnowledgeResult({
              informationAsOf,
              resolvedCountryIso3: countryIso3,
              search,
            });
          },
          fallbackAsOf: input.asOf ?? currentUtcDate(),
          input,
          sessionId,
          toolCallId,
          toolName: "searchKnowledgeBase",
        }).then((result) => searchKnowledgeBaseResultSchema.parse(result)),
      inputSchema: searchKnowledgeBaseInputSchema,
      outputSchema: searchKnowledgeBaseResultSchema,
    }),

    generateSalesBrief: tool({
      description:
        "Generate a deterministic structured JSON sales brief for one target country benchmarked against 1-4 other countries. It returns exactly the factual score, opportunities, risks, compatible products, rule-generated actions, missing data and sources. Use this for sales brief or sales strategy requests; preserve an explicitly named productModelCode instead of broadening to the full catalog, and explain the returned score without changing it.",
      execute: async (
        input: GenerateSalesBriefInput,
        { toolCallId },
      ) =>
        executeAuditedTool({
          auditRepository,
          execute: async () =>
            buildSalesBriefResult({
              brief: await resolvedServices.generateSalesBrief(input),
              informationAsOf: input.asOf,
            }),
          fallbackAsOf: input.asOf,
          input,
          sessionId,
          toolCallId,
          toolName: "generateSalesBrief",
        }).then((result) =>
          generateSalesBriefResultSchema.parse(result),
        ),
      inputSchema: generateSalesBriefInputSchema,
      outputSchema: generateSalesBriefResultSchema,
    }),
  };
}

export type SalesChatTools = ReturnType<typeof createSalesChatTools>;

export { buildSalesChatInstructions } from "@/server/ai/sales-chat-prompt";

const profileTopicLabels = {
  country: "国家基础信息",
  market: "市场指标",
  regulations: "当前或未来法规",
} as const;

export function buildEvidenceGapResponse(
  results: AiToolResult[],
  hasExecutionFailure: boolean,
): string {
  const details = new Set<string>();

  for (const result of results) {
    if (result.status === "ok" && result.evidenceSufficient) {
      continue;
    }

    if (result.tool === "getCountryProfile") {
      if (!result.resolvedCountryIso3) {
        details.add(
          "缺少国家：请写国家名称或 ISO3，例如 CHN、DEU、AUS。",
        );
      } else {
        const topics = result.requestedTopics
          .map((topic) => profileTopicLabels[topic])
          .join("、");
        details.add(
          `${result.resolvedCountryIso3} 缺少本次请求所需的${topics}证据；可以换主题、日期或国家。`,
        );
      }
      continue;
    }

    if (result.tool === "findCompatibleProducts") {
      if (!result.query.countryIso3) {
        details.add("产品适配缺少国家，请指定国家名称或 ISO3。");
      } else {
        details.add(
          `${result.query.countryIso3} 在 ${result.query.applicationScope}、${result.query.powerKw} kW、${result.query.asOf} 条件下没有确定的适配结论；请核对产品目录、认证或法规证据。`,
        );
      }
      continue;
    }

    if (result.tool === "compareRegulations") {
      details.add(
        "法规比较至少需要两个国家在同一应用场景、功率和日期下有可见的 effective 或 adopted 法规。",
      );
      continue;
    }

    if (result.tool === "compareMarkets") {
      details.add(
        "市场比较没有找到可直接比较的指标；请指定指标，并确保期间、单位、币种、口径和应用场景一致。",
      );
      continue;
    }

    if (result.tool === "calculateOpportunityScore") {
      details.add(
        "机会排名至少需要两个国家产生确定性分数；请补齐市场、产品准备度或法规覆盖数据。",
      );
      continue;
    }

    if (result.tool === "generateSalesBrief") {
      details.add(
        "销售简报缺少可评分市场或明确适配产品；请补充目标国家、对比国家、应用场景和功率。",
      );
      continue;
    }

    details.add(
      result.resolvedCountryIso3
        ? `${result.resolvedCountryIso3} 的知识库没有检索到匹配原文；请缩小法规名称、污染物、章节或日期范围。`
        : "知识库没有检索到匹配原文；请补充国家并缩小法规名称、污染物、章节或日期范围。",
    );
  }

  if (hasExecutionFailure) {
    details.add("至少一项查询执行或参数校验失败，请检查输入后重试。");
  }

  const detailLines = Array.from(details);
  const partialEvidence = results.some(
    (result) => result.status === "ok" && result.evidenceSufficient,
  );
  const lead = partialEvidence
    ? "这次请求没有足够证据支持完整的肯定结论。已成功的结构化卡片仍可单独查看。"
    : "这次请求没有足够证据，暂时不能给出肯定的法规、市场或产品结论。";

  return `${lead}${
    detailLines.length > 0
      ? `\n\n下一步：\n${detailLines.map((line, index) => `${index + 1}. ${line}`).join("\n")}`
      : "\n\n请补充国家、查询主题和必要业务参数后重试。"
  }\n\n${regulatoryDisclaimer}`;
}

function createEvidenceBoundaryTransform({
  allowUnverifiedAttachmentResponse = false,
  evidenceContract,
  hasUnverifiedAttachments = false,
}: {
  allowUnverifiedAttachmentResponse?: boolean;
  evidenceContract: SalesChatEvidenceContract;
  hasUnverifiedAttachments?: boolean;
}) {
  let hasToolResult = false;
  let hasInsufficientEvidence = false;
  let hasExecutionFailure = false;
  const toolResults: AiToolResult[] = [];
  const bufferedText: Array<{ id: string; text: string }> = [];

  const canEmitModelText = () =>
    !hasInsufficientEvidence &&
    evidenceContractAllowsModelText(evidenceContract, toolResults);

  return new TransformStream({
    transform(chunk, controller) {
      if (chunk.type === "tool-result") {
        bufferedText.length = 0;
        hasToolResult = true;
        const parsed = aiToolResultSchema.safeParse(chunk.output);
        if (parsed.success) {
          toolResults.push(parsed.data);
        }
        if (
          !parsed.success ||
          parsed.data.status !== "ok" ||
          !parsed.data.evidenceSufficient
        ) {
          hasInsufficientEvidence = true;
        }
        controller.enqueue(chunk);
        return;
      }

      if (
        chunk.type === "tool-error" ||
        chunk.type === "tool-output-denied" ||
        chunk.type === "error"
      ) {
        bufferedText.length = 0;
        hasToolResult = true;
        hasInsufficientEvidence = true;
        hasExecutionFailure = true;
        controller.enqueue(chunk);
        return;
      }

      if (chunk.type === "text-start") {
        bufferedText.push({ id: chunk.id, text: "" });
        return;
      }

      if (chunk.type === "text-delta") {
        const current = bufferedText.at(-1);
        if (current) {
          current.text += chunk.text;
        } else {
          bufferedText.push({ id: chunk.id, text: chunk.text });
        }
        return;
      }

      if (chunk.type === "text-end") {
        return;
      }

      if (chunk.type === "finish") {
        const hasBufferedText = bufferedText.some(({ text }) => text.length > 0);
        const canEmitAttachmentText =
          allowUnverifiedAttachmentResponse &&
          !hasToolResult &&
          hasBufferedText;
        const requiresAttachmentBoundary =
          hasUnverifiedAttachments || allowUnverifiedAttachmentResponse;
        if ((hasToolResult && canEmitModelText()) || canEmitAttachmentText) {
          if (requiresAttachmentBoundary) {
            const id = "unverified-attachment-boundary";
            controller.enqueue({ id, type: "text-start" });
            controller.enqueue({
              id,
              text:
                "本轮包含用户上传附件；附件尚未经过来源核验，不能作为法规、认证、产品或市场事实。\n\n",
              type: "text-delta",
            });
            controller.enqueue({ id, type: "text-end" });
          }
          for (const textPart of bufferedText) {
            if (!textPart.text) {
              continue;
            }
            controller.enqueue({ id: textPart.id, type: "text-start" });
            controller.enqueue({
              id: textPart.id,
              text: textPart.text,
              type: "text-delta",
            });
            controller.enqueue({ id: textPart.id, type: "text-end" });
          }
          if (
            hasToolResult &&
            evidenceNeedsRegulatoryDisclaimer(
              evidenceContract,
              toolResults,
            ) &&
            !bufferedText.some(({ text }) =>
              text.includes(regulatoryDisclaimer),
            )
          ) {
            const id = "regulatory-disclaimer";
            controller.enqueue({ id, type: "text-start" });
            controller.enqueue({
              id,
              text: `\n\n${regulatoryDisclaimer}`,
              type: "text-delta",
            });
            controller.enqueue({ id, type: "text-end" });
          }
        } else {
          if (requiresAttachmentBoundary) {
            const id = "unverified-attachment-boundary";
            controller.enqueue({ id, type: "text-start" });
            controller.enqueue({
              id,
              text:
                "本轮包含用户上传附件；附件尚未经过来源核验，不能作为法规、认证、产品或市场事实。\n\n",
              type: "text-delta",
            });
            controller.enqueue({ id, type: "text-end" });
          }
          const id = "evidence-boundary";
          controller.enqueue({ id, type: "text-start" });
          controller.enqueue({
            id,
            text: buildEvidenceGapResponse(
              toolResults,
              hasExecutionFailure ||
                (hasToolResult &&
                  !hasInsufficientEvidence &&
                  !evidenceContractAllowsModelText(
                    evidenceContract,
                    toolResults,
                  )),
            ),
            type: "text-delta",
          });
          controller.enqueue({ id, type: "text-end" });
        }
      }

      controller.enqueue(chunk);
    },
  });
}

export function streamSalesChat(input: {
  allowUnverifiedAttachmentResponse?: boolean;
  auditRepository: Pick<AiAuditRepository, "recordToolCall">;
  hasUnverifiedAttachments?: boolean;
  messages: ModelMessage[];
  model: LanguageModel;
  selectedCountryIso3: string | null;
  sessionId: string;
  tools: SalesChatTools;
  trustedUserTexts: readonly string[];
}) {
  const evidenceContract = buildSalesChatEvidenceContract({
    selectedCountryIso3: input.selectedCountryIso3,
    userTexts: input.trustedUserTexts,
  });

  return streamText({
    experimental_transform: () =>
      createEvidenceBoundaryTransform({
        allowUnverifiedAttachmentResponse:
          input.allowUnverifiedAttachmentResponse === true,
        evidenceContract,
        hasUnverifiedAttachments:
          input.hasUnverifiedAttachments === true,
      }),
    instructions: buildSalesChatInstructions(input.selectedCountryIso3),
    maxRetries: 1,
    messages: input.messages,
    model: input.model,
    prepareStep: ({ steps }) => {
      const stepEvidence = collectSalesChatStepEvidence(steps);
      const policy = resolveSalesChatLoopPolicy({
        allowToolFreeAttachmentResponse:
          input.allowUnverifiedAttachmentResponse === true,
        contract: evidenceContract,
        ...stepEvidence,
      });

      return {
        activeTools: policy.activeTools,
        toolChoice: policy.toolChoice,
        toolOrder: SALES_CHAT_TOOL_ORDER,
      };
    },
    repairToolCall: async ({ error, toolCall }) => {
      if (!InvalidToolInputError.isInstance(error)) {
        return null;
      }

      const toolName = aiToolNameSchema.safeParse(toolCall.toolName);
      if (!toolName.success) {
        return null;
      }

      await auditInvalidToolInput({
        auditRepository: input.auditRepository,
        error,
        sessionId: input.sessionId,
        toolCallId: toolCall.toolCallId,
        toolName: toolName.data,
      });
      return null;
    },
    stopWhen: stepCountIs(MAX_AI_TOOL_STEPS),
    temperature: 0,
    timeout: {
      stepMs: 30_000,
      totalMs: 90_000,
    },
    tools: input.tools,
  });
}
