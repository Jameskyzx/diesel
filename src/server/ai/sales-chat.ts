import "server-only";

import { createHash } from "node:crypto";

import {
  tool,
} from "ai";

import {
  captureChatRuntimeContext,
  chatRuntimeContextSchema,
  type ChatRuntimeContext,
} from "@/domain/ai/chat-runtime-context";
import {
  calculateOpportunityScoreResultSchema,
  compareMarketsResultSchema,
  compareRegulationsResultSchema,
  findCompatibleProductsInputSchema,
  findCompatibleProductsResultSchema,
  generateSalesBriefResultSchema,
  getCountryProfileInputSchema,
  getCountryProfileResultSchema,
  salesChatModelKnowledgeSearchInputSchema,
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
  salesChatToolResultToSdkModelOutput,
} from "@/features/ai/model-tool-output-dispatch";
import {
  CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT,
  hybridSearchResponseMatchesQuery,
} from "@/domain/knowledge/search-consistency";
import { hybridSearchQuerySchema } from "@/features/knowledge/schemas";
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
} from "@/server/ai/tool-results";
import { getCountryDetails } from "@/server/services/country-service";
import { findCompatibleProducts } from "@/server/services/compatible-products-service";
import {
  hybridSearchKnowledge,
} from "@/server/services/knowledge-service";
import {
  calculateOpportunityScore,
  compareMarkets,
  compareRegulations,
  generateSalesBrief,
} from "@/server/services/marketing-analysis-service";
import { getErrorCode } from "@/lib/api-error";
import { throwIfRequestAborted } from "@/server/http/request-signal";
import { containsEmbeddedReasoningMarkup } from "@/domain/ai/reasoning-markup";

export function containsEmbeddedReasoningMarkupInValue(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value === "string") {
    return containsEmbeddedReasoningMarkup(value);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (value instanceof Error) {
    return (
      containsEmbeddedReasoningMarkup(value.name) ||
      containsEmbeddedReasoningMarkup(value.message) ||
      containsEmbeddedReasoningMarkupInValue(value.cause, seen)
    );
  }

  try {
    return Object.entries(value).some(
      ([key, nestedValue]) =>
        containsEmbeddedReasoningMarkup(key) ||
        containsEmbeddedReasoningMarkupInValue(nestedValue, seen),
    );
  } catch {
    // Provider-owned objects must be inspectable before they can cross the
    // public stream boundary.
    return true;
  }
}

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
  beginDeferredWork?: () => (() => void) | null;
  defaultAsOf?: string;
  runtimeContext?: ChatRuntimeContext;
  selectedCountryIso3: string | null;
  services?: Partial<SalesChatToolServices>;
  sessionId: string;
  turnId?: string;
};

async function executeWithinToolResourceBoundary<T>(options: {
  abortSignal?: AbortSignal;
  beginDeferredWork?: () => (() => void) | null;
  execute: (signal: AbortSignal | undefined) => Promise<T>;
}): Promise<T> {
  throwIfRequestAborted(options.abortSignal);
  const finish = options.beginDeferredWork
    ? options.beginDeferredWork()
    : () => undefined;
  if (!finish) {
    throw new DOMException("The request was canceled.", "AbortError");
  }

  try {
    // Close the synchronous precheck/token-acquisition boundary before any
    // service, audit, or output parsing work is allowed to start.
    throwIfRequestAborted(options.abortSignal);
    return await options.execute(options.abortSignal);
  } finally {
    finish();
  }
}

export function buildAuditToolCallId(
  turnId: string,
  providerToolCallId: string,
): string {
  return `${turnId}:${providerToolCallId}`;
}

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
    if (key === "productModelCode" && typeof value === "string") {
      minimized.productModelCode = {
        algorithm: "sha256",
        characterCount: Array.from(value).length,
        digest: createHash("sha256").update(value, "utf8").digest("hex"),
      };
      continue;
    }
    minimized[key] = value;
  }

  return minimized;
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
      missingDataCount: result.brief.gaps.length,
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
    errorInput?: object;
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
    errorCode = getErrorCode(error);
    console.error("AI tool execution failed", {
      errorCode,
      toolName: options.toolName,
    });
    result = buildToolErrorResult(
      options.toolName,
      options.fallbackAsOf,
      options.errorInput ?? options.input,
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
  beginDeferredWork,
  defaultAsOf,
  runtimeContext: capturedRuntimeContext = captureChatRuntimeContext(),
  selectedCountryIso3,
  services = defaultServices,
  sessionId,
  turnId = crypto.randomUUID(),
}: CreateSalesChatToolsInput) {
  const runtimeContext = chatRuntimeContextSchema.parse(capturedRuntimeContext);
  const resolvedServices: SalesChatToolServices = {
    ...defaultServices,
    ...services,
  };
  const countryProfileInputSchema = getCountryProfileInputSchema.transform(
    (input) =>
      getCountryProfileInputSchema.parse({
        ...input,
        ...(input.asOf || !defaultAsOf ? {} : { asOf: defaultAsOf }),
      }),
  );

  return {
    calculateOpportunityScore: tool({
      description:
        "Return code-owned opportunity-score-v2 results for 2-5 countries. Product readiness includes query-date availability; missing inputs stay unknown. Preserve an explicit productModelCode; never recalculate scores.",
      execute: async (
        input: CalculateOpportunityScoreInput,
        { abortSignal, toolCallId },
      ) =>
        executeWithinToolResourceBoundary({
          abortSignal,
          beginDeferredWork,
          execute: (signal) =>
            executeAuditedTool({
              auditRepository,
              execute: async () => {
                const result = buildOpportunityScoreResult({
                  informationAsOf: input.asOf,
                  scorecard:
                    await resolvedServices.calculateOpportunityScore(input, {
                      signal,
                    }),
                });
                return result;
              },
              fallbackAsOf: input.asOf,
              input,
              sessionId,
              toolCallId: buildAuditToolCallId(turnId, toolCallId),
              toolName: "calculateOpportunityScore",
            }).then((result) =>
              calculateOpportunityScoreResultSchema.parse(result),
            ),
      }),
      inputSchema: calculateOpportunityScoreInputSchema,
      outputSchema: calculateOpportunityScoreResultSchema,
      toModelOutput: salesChatToolResultToSdkModelOutput,
    }),

    compareMarkets: tool({
      description:
        "Compare structured market metrics for 2-5 countries, including period, unit, currency, methodology and scope comparability. No implicit conversion.",
      execute: async (
        input: CompareMarketsInput,
        { abortSignal, toolCallId },
      ) => {
        const informationAsOf = runtimeContext.utcDate;
        return executeWithinToolResourceBoundary({
          abortSignal,
          beginDeferredWork,
          execute: (signal) =>
            executeAuditedTool({
              auditRepository,
              execute: async () =>
                buildMarketComparisonResult({
                  comparison: await resolvedServices.compareMarkets(input, {
                    signal,
                  }),
                  informationAsOf,
                }),
              fallbackAsOf: informationAsOf,
              input,
              sessionId,
              toolCallId: buildAuditToolCallId(turnId, toolCallId),
              toolName: "compareMarkets",
            }).then((result) => compareMarketsResultSchema.parse(result)),
        });
      },
      inputSchema: compareMarketsInputSchema,
      outputSchema: compareMarketsResultSchema,
      toModelOutput: salesChatToolResultToSdkModelOutput,
    }),

    compareRegulations: tool({
      description:
        "Query 1-5 countries by date, application scope and power. Returns applicable effective/historical regulations, future adopted rules, limits and sources; excludes proposed rules.",
      execute: async (
        input: CompareRegulationsInput,
        { abortSignal, toolCallId },
      ) =>
        executeWithinToolResourceBoundary({
          abortSignal,
          beginDeferredWork,
          execute: (signal) =>
            executeAuditedTool({
              auditRepository,
              execute: async () =>
                buildRegulationComparisonResult({
                  comparison:
                    await resolvedServices.compareRegulations(input, { signal }),
                  informationAsOf: input.asOf,
                }),
              fallbackAsOf: input.asOf,
              input,
              sessionId,
              toolCallId: buildAuditToolCallId(turnId, toolCallId),
              toolName: "compareRegulations",
            }).then((result) =>
              compareRegulationsResultSchema.parse(result),
            ),
        }),
      inputSchema: compareRegulationsInputSchema,
      outputSchema: compareRegulationsResultSchema,
      toModelOutput: salesChatToolResultToSdkModelOutput,
    }),

    findCompatibleProducts: tool({
      description:
        "Evaluate product compliance, certification and query-date availability for one country, scope, power and date. Preserve an explicit productModelCode and country; otherwise evaluate the public catalog.",
      execute: async (
        input: FindCompatibleProductsInput,
        { abortSignal, toolCallId },
      ) => {
        const countryIso3 = resolveCountryIso3(
          input.countryIso3,
          selectedCountryIso3,
        );
        const canonicalInput = findCompatibleProductsInputSchema.parse({
          ...input,
          countryIso3,
        });
        return executeWithinToolResourceBoundary({
          abortSignal,
          beginDeferredWork,
          execute: (signal) =>
            executeAuditedTool({
              auditRepository,
              execute: async () => {
                const evaluations =
                  countryIso3 === null
                    ? []
                    : await resolvedServices.findCompatibleProducts(
                        canonicalInput,
                        { signal },
                      );

                return buildCompatibleProductsResult({
                  applicationScope: canonicalInput.applicationScope,
                  asOf: canonicalInput.asOf,
                  countryIso3,
                  evaluations,
                  powerKw: canonicalInput.powerKw,
                  ...(canonicalInput.productModelCode
                    ? { productModelCode: canonicalInput.productModelCode }
                    : {}),
                });
              },
              fallbackAsOf: canonicalInput.asOf,
              errorInput: canonicalInput,
              input,
              sessionId,
              toolCallId: buildAuditToolCallId(turnId, toolCallId),
              toolName: "findCompatibleProducts",
            }).then((result) =>
              findCompatibleProductsResultSchema.parse(result),
            ),
        });
      },
      inputSchema: findCompatibleProductsInputSchema,
      outputSchema: findCompatibleProductsResultSchema,
      toModelOutput: salesChatToolResultToSdkModelOutput,
    }),

    getCountryProfile: tool({
      description:
        "Get one country's requested structured topics, sources and verification dates. topics must contain only the explicit domains: country, regulations and/or market. An explicit country overrides map context.",
      execute: async (
        input: GetCountryProfileInput,
        { abortSignal, toolCallId },
      ) => {
        const countryIso3 = resolveCountryIso3(
          input.countryIso3,
          selectedCountryIso3,
        );
        const informationAsOf = input.asOf ?? runtimeContext.utcDate;
        const canonicalInput = getCountryProfileInputSchema.parse({
          ...input,
          asOf: informationAsOf,
          countryIso3,
        });
        return executeWithinToolResourceBoundary({
          abortSignal,
          beginDeferredWork,
          execute: (signal) =>
            executeAuditedTool({
              auditRepository,
              execute: async () => {
                const profile =
                  countryIso3 === null
                    ? null
                    : await resolvedServices.getCountryDetails(
                        {
                          asOf: informationAsOf,
                          iso3: countryIso3,
                          ...(input.marketPeriod ? { marketPeriod: input.marketPeriod } : {}),
                        },
                        { signal },
                      );

                return buildCountryProfileResult({
                  informationAsOf,
                  ...(input.marketPeriod ? { marketPeriod: input.marketPeriod } : {}),
                  profile,
                  requestedTopics: canonicalInput.topics,
                  resolvedCountryIso3: countryIso3,
                });
              },
              fallbackAsOf: informationAsOf,
              errorInput: canonicalInput,
              input,
              sessionId,
              toolCallId: buildAuditToolCallId(turnId, toolCallId),
              toolName: "getCountryProfile",
            }).then((result) => getCountryProfileResultSchema.parse(result)),
        });
      },
      inputSchema: countryProfileInputSchema,
      outputSchema: getCountryProfileResultSchema,
      toModelOutput: salesChatToolResultToSdkModelOutput,
    }),

    searchKnowledgeBase: tool({
      description:
        "Search traceable source documents with metadata filters, section/page locators, validity and scores. When the current or inherited user request specifies a scope, pass that exact applicationScope; scope words in query do not replace this metadata filter. Correct missing filters without inventing different topics, pollutants or stages. Select concise business keywords from the user's wording and preserve explicit country. Do not append unrequested translations or synonyms: ordinary keyword terms are combined with AND, not treated as semantic alternatives. Preserve meaningful English, Chinese, or mixed-language terms the user actually supplied, including identifiers, quoted phrases, OR branches and exclusions. The local-hash vector path is not semantic translation, and the simple keyword path does not segment Chinese compounds. Never delete user-supplied terms just to obtain a hit.",
      execute: async (
        input: SearchKnowledgeBaseInput,
        { abortSignal, toolCallId },
      ) => {
        const countryIso3 = resolveCountryIso3(
          input.countryIso3,
          selectedCountryIso3,
        );
        const informationAsOf = input.asOf ?? runtimeContext.utcDate;
        const canonicalInput = searchKnowledgeBaseInputSchema.parse({
          ...input,
          asOf: informationAsOf,
          countryIso3,
          jurisdictionId: null,
          limit: CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT,
        });
        return executeWithinToolResourceBoundary({
          abortSignal,
          beginDeferredWork,
          execute: (signal) =>
            executeAuditedTool({
              auditRepository,
              execute: async () => {
                const searchQuery = hybridSearchQuerySchema.parse({
                  applicationScope:
                    canonicalInput.applicationScope ?? null,
                  asOf: informationAsOf,
                  countryIso3,
                  // Provider-generated UUID and count narrowing cannot be
                  // derived from trusted user intent, so AI search fixes both.
                  jurisdictionId: null,
                  limit: CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT,
                  query: canonicalInput.query,
                });
                const search = await resolvedServices.hybridSearchKnowledge(
                  searchQuery,
                  { signal, deliveryCueRanking: true },
                );
                if (!hybridSearchResponseMatchesQuery(search, searchQuery)) {
                  throw new Error(
                    "Knowledge search response does not match its query.",
                  );
                }

                return buildKnowledgeResult({
                  informationAsOf,
                  resolvedCountryIso3: countryIso3,
                  search,
                });
              },
              fallbackAsOf: informationAsOf,
              errorInput: canonicalInput,
              input,
              sessionId,
              toolCallId: buildAuditToolCallId(turnId, toolCallId),
              toolName: "searchKnowledgeBase",
            }).then((result) => searchKnowledgeBaseResultSchema.parse(result)),
        });
      },
      inputSchema: salesChatModelKnowledgeSearchInputSchema,
      outputSchema: searchKnowledgeBaseResultSchema,
      toModelOutput: salesChatToolResultToSdkModelOutput,
    }),

    generateSalesBrief: tool({
      description:
        "Return a deterministic sales brief for one target and 1-4 benchmarks: score, opportunities, risks, ready products, rule actions, gaps and sources. Preserve an explicit productModelCode; never alter the score.",
      execute: async (
        input: GenerateSalesBriefInput,
        { abortSignal, toolCallId },
      ) =>
        executeWithinToolResourceBoundary({
          abortSignal,
          beginDeferredWork,
          execute: (signal) =>
            executeAuditedTool({
              auditRepository,
              execute: async () => {
                const result = buildSalesBriefResult({
                  brief: await resolvedServices.generateSalesBrief(input, {
                    signal,
                  }),
                  informationAsOf: input.asOf,
                });
                return result;
              },
              fallbackAsOf: input.asOf,
              input,
              sessionId,
              toolCallId: buildAuditToolCallId(turnId, toolCallId),
              toolName: "generateSalesBrief",
            }).then((result) =>
              generateSalesBriefResultSchema.parse(result),
            ),
      }),
      inputSchema: generateSalesBriefInputSchema,
      outputSchema: generateSalesBriefResultSchema,
      toModelOutput: salesChatToolResultToSdkModelOutput,
    }),
  };
}

export type SalesChatTools = ReturnType<typeof createSalesChatTools>;
