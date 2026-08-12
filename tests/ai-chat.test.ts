import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { evaluateProductFit } from "@/domain/product-fit/evaluate-product-fit";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import type { ProductFitQuery } from "@/features/database/schemas";
import {
  buildEvidenceGapResponse,
  buildSalesChatInstructions,
  createSalesChatTools,
  MAX_AI_TOOL_STEPS,
  resolveCountryIso3,
  streamSalesChat,
} from "@/server/ai/sales-chat";
import {
  allowsToolFreeAttachmentResponse,
  buildDirectChatResponse,
} from "@/server/ai/chat-turn-guidance";
import {
  getCountryProfileInputSchema,
  searchKnowledgeBaseResultSchema,
} from "@/features/ai/schemas";
import {
  buildCompatibleProductsResult,
  buildCountryProfileResult,
  buildKnowledgeResult,
  buildRegulationComparisonResult,
} from "@/server/ai/tool-results";
import {
  hybridSearchQuerySchema,
  hybridSearchResponseSchema,
} from "@/features/knowledge/schemas";
import type {
  CertificationEvidence,
  ProductSummary,
  RegulationEvidence,
} from "@/features/product-fit/schemas";

const emptyUsage = {
  inputTokens: {
    cacheRead: 0,
    cacheWrite: 0,
    noCache: 1,
    total: 1,
  },
  outputTokens: {
    reasoning: 0,
    text: 1,
    total: 1,
  },
} as const;

function attachmentSummaryMockModel() {
  return new MockLanguageModelV3({
    modelId: "mock-attachment-summary-model",
    provider: "mock",
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { id: "attachment-answer", type: "text-start" as const },
          {
            delta: "图片中可见一块发动机铭牌。",
            id: "attachment-answer",
            type: "text-delta" as const,
          },
          { id: "attachment-answer", type: "text-end" as const },
          {
            finishReason: { raw: undefined, unified: "stop" as const },
            type: "finish" as const,
            usage: emptyUsage,
          },
        ],
      }),
    },
  });
}

function noDataMockModel() {
  return new MockLanguageModelV3({
    modelId: "mock-regulation-model",
    provider: "mock",
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            {
              input: JSON.stringify({
                countryIso3: "BRA",
                topics: ["regulations"],
              }),
              toolCallId: "country-profile-call",
              toolName: "getCountryProfile",
              type: "tool-call" as const,
            },
            {
              finishReason: {
                raw: undefined,
                unified: "tool-calls" as const,
              },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { id: "answer", type: "text-start" as const },
            {
              delta:
                "BRA 已生效法规是 MOCK-FAKE-99，限值为 0.01。",
              id: "answer",
              type: "text-delta" as const,
            },
            { id: "answer", type: "text-end" as const },
            {
              finishReason: { raw: undefined, unified: "stop" as const },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
    ],
  });
}

function compatibleProductsMockModel() {
  return new MockLanguageModelV3({
    modelId: "mock-product-model",
    provider: "mock",
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            {
              input: JSON.stringify({
                applicationScope: "non-road",
                asOf: "2026-07-29",
                countryIso3: "CHN",
                powerKw: 100,
              }),
              toolCallId: "compatible-products-call",
              toolName: "findCompatibleProducts",
              type: "tool-call" as const,
            },
            {
              finishReason: {
                raw: undefined,
                unified: "tool-calls" as const,
              },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { id: "answer", type: "text-start" as const },
            {
              delta:
                "DEMO-ENG-100 的确定性结果为 fit。信息参考，不替代正式认证或法律意见",
              id: "answer",
              type: "text-delta" as const,
            },
            { id: "answer", type: "text-end" as const },
            {
              finishReason: { raw: undefined, unified: "stop" as const },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
    ],
  });
}

function mixedEvidenceMockModel() {
  return new MockLanguageModelV3({
    modelId: "mock-mixed-evidence-model",
    provider: "mock",
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            {
              input: JSON.stringify({
                countryIso3: "BRA",
                topics: ["regulations"],
              }),
              toolCallId: "mixed-country-profile-call",
              toolName: "getCountryProfile",
              type: "tool-call" as const,
            },
            {
              input: JSON.stringify({
                applicationScope: "non-road",
                asOf: "2026-07-29",
                countryIso3: "CHN",
                powerKw: 100,
              }),
              toolCallId: "mixed-product-fit-call",
              toolName: "findCompatibleProducts",
              type: "tool-call" as const,
            },
            {
              finishReason: {
                raw: undefined,
                unified: "tool-calls" as const,
              },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { id: "mixed-answer", type: "text-start" as const },
            {
              delta:
                "BRA 已生效法规是 MOCK-FAKE-99；DEMO-ENG-100 已确定适配。",
              id: "mixed-answer",
              type: "text-delta" as const,
            },
            { id: "mixed-answer", type: "text-end" as const },
            {
              finishReason: { raw: undefined, unified: "stop" as const },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
    ],
  });
}

function invalidToolInputMixedModel() {
  return new MockLanguageModelV3({
    modelId: "mock-invalid-tool-input-model",
    provider: "mock",
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            {
              input: JSON.stringify({
                applicationScope: "non-road",
                asOf: "2026-07-29",
                countryIso3: "CHN",
                powerKw: 100,
              }),
              toolCallId: "invalid-input-product-fit-call",
              toolName: "findCompatibleProducts",
              type: "tool-call" as const,
            },
            {
              input: JSON.stringify({ countryIso3: "BRA" }),
              toolCallId: "invalid-country-profile-call",
              toolName: "getCountryProfile",
              type: "tool-call" as const,
            },
            {
              finishReason: {
                raw: undefined,
                unified: "tool-calls" as const,
              },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { id: "invalid-tool-answer", type: "text-start" as const },
            {
              delta:
                "DEMO-ENG-100 已确定适配；BRA 已生效法规是 MOCK-FAKE-99。",
              id: "invalid-tool-answer",
              type: "text-delta" as const,
            },
            { id: "invalid-tool-answer", type: "text-end" as const },
            {
              finishReason: { raw: undefined, unified: "stop" as const },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
    ],
  });
}

function sequentialMixedEvidenceMockModel() {
  return new MockLanguageModelV3({
    modelId: "mock-sequential-mixed-evidence-model",
    provider: "mock",
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            {
              input: JSON.stringify({
                applicationScope: "non-road",
                asOf: "2026-07-29",
                countryIso3: "CHN",
                powerKw: 100,
              }),
              toolCallId: "sequential-product-fit-call",
              toolName: "findCompatibleProducts",
              type: "tool-call" as const,
            },
            {
              finishReason: {
                raw: undefined,
                unified: "tool-calls" as const,
              },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { id: "premature-answer", type: "text-start" as const },
            {
              delta: "DEMO-ENG-100 已确定适配。",
              id: "premature-answer",
              type: "text-delta" as const,
            },
            { id: "premature-answer", type: "text-end" as const },
            {
              input: JSON.stringify({
                countryIso3: "BRA",
                topics: ["regulations"],
              }),
              toolCallId: "sequential-country-profile-call",
              toolName: "getCountryProfile",
              type: "tool-call" as const,
            },
            {
              finishReason: {
                raw: undefined,
                unified: "tool-calls" as const,
              },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { id: "final-answer", type: "text-start" as const },
            {
              delta: "BRA 已生效法规是 MOCK-FAKE-99。",
              id: "final-answer",
              type: "text-delta" as const,
            },
            { id: "final-answer", type: "text-end" as const },
            {
              finishReason: { raw: undefined, unified: "stop" as const },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
    ],
  });
}

function sequentialSuccessfulToolsMockModel() {
  return new MockLanguageModelV3({
    modelId: "mock-sequential-success-model",
    provider: "mock",
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            {
              input: JSON.stringify({
                applicationScope: "non-road",
                asOf: "2026-07-29",
                countryIso3: "CHN",
                powerKw: 100,
              }),
              toolCallId: "sequential-success-first-call",
              toolName: "findCompatibleProducts",
              type: "tool-call" as const,
            },
            {
              finishReason: {
                raw: undefined,
                unified: "tool-calls" as const,
              },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { id: "premature-success-answer", type: "text-start" as const },
            {
              delta: "PREMATURE-CLAIM-BEFORE-SECOND-RESULT",
              id: "premature-success-answer",
              type: "text-delta" as const,
            },
            { id: "premature-success-answer", type: "text-end" as const },
            {
              input: JSON.stringify({
                applicationScope: "non-road",
                asOf: "2026-07-29",
                countryIso3: "CHN",
                powerKw: 200,
              }),
              toolCallId: "sequential-success-second-call",
              toolName: "findCompatibleProducts",
              type: "tool-call" as const,
            },
            {
              finishReason: {
                raw: undefined,
                unified: "tool-calls" as const,
              },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { id: "final-success-answer", type: "text-start" as const },
            {
              delta: "FINAL-SUMMARY-AFTER-ALL-TOOLS",
              id: "final-success-answer",
              type: "text-delta" as const,
            },
            { id: "final-success-answer", type: "text-end" as const },
            {
              finishReason: { raw: undefined, unified: "stop" as const },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
    ],
  });
}

function createFitEvaluation() {
  const verifiedAt = "2026-01-15T00:00:00.000Z";
  const query: ProductFitQuery = {
    applicationScope: "non-road",
    asOf: "2026-07-29",
    countryIso3: "CHN",
    powerKw: 100,
    productModelCode: "DEMO-ENG-100",
  };
  const productSource = {
    id: "00000000-0000-4000-8000-000000000003",
    isDemo: true,
    publishedOn: null,
    title: "DEMO ONLY — Product source",
    url: "https://example.invalid/demo/products",
    verifiedAt,
  };
  const regulationSource = {
    id: "00000000-0000-4000-8000-000000000002",
    isDemo: true,
    publishedOn: null,
    title: "DEMO ONLY — Regulation source",
    url: "https://example.invalid/demo/regulations",
    verifiedAt,
  };
  const regulationLimitSource = {
    id: "00000000-0000-4000-8000-000000000006",
    isDemo: true,
    publishedOn: null,
    title: "DEMO ONLY — Regulation limit source",
    url: "https://example.invalid/demo/limits",
    verifiedAt,
  };
  const certificationSource = {
    id: "00000000-0000-4000-8000-000000000005",
    isDemo: true,
    publishedOn: null,
    title: "DEMO ONLY — Certification source",
    url: "https://example.invalid/demo/certifications",
    verifiedAt,
  };
  const jurisdictionSource = {
    id: "00000000-0000-4000-8000-000000000007",
    isDemo: true,
    publishedOn: null,
    title: "DEMO ONLY — Jurisdiction source",
    url: "https://example.invalid/demo/jurisdictions",
    verifiedAt,
  };
  const membershipSource = {
    id: "00000000-0000-4000-8000-000000000008",
    isDemo: true,
    publishedOn: null,
    title: "DEMO ONLY — Membership source",
    url: "https://example.invalid/demo/memberships",
    verifiedAt,
  };
  const product: ProductSummary = {
    applicationScopes: ["non-road"],
    availableFrom: "2025-01-01",
    availableTo: null,
    id: "00000000-0000-4000-8000-000000000201",
    isDemo: true,
    modelCode: "DEMO-ENG-100",
    name: "DEMO ONLY — Engine",
    powerMaxKw: 150,
    powerMinKw: 50,
    source: productSource,
    specificationVersion: "demo-v1",
    verifiedAt,
  };
  const regulation: RegulationEvidence = {
    applicability: {
      countryIso3: "CHN",
      jurisdiction: {
        code: "DEMO-JUR",
        id: "00000000-0000-4000-8000-000000000009",
        isDemo: true,
        name: "DEMO ONLY — Jurisdiction",
        source: jurisdictionSource,
        verifiedAt,
      },
      membership: {
        isDemo: true,
        source: membershipSource,
        validFrom: "2020-01-01",
        validTo: null,
        verifiedAt,
      },
    },
    canonicalName: "DEMO ONLY — Effective regulation",
    citationCode: "DEMO-REG",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    isDemo: true,
    limitSources: [regulationLimitSource],
    recordStatus: "effective",
    regulationId: "00000000-0000-4000-8000-000000000201",
    source: regulationSource,
    status: "effective",
    verifiedAt,
  };
  const certification: CertificationEvidence = {
    applicationScope: "non-road",
    certificateNumber: "DEMO-CERT-100",
    id: "00000000-0000-4000-8000-000000000401",
    isDemo: true,
    powerMaxKw: 150,
    powerMinKw: 50,
    regulationId: regulation.regulationId,
    source: certificationSource,
    status: "active",
    validFrom: "2025-01-01",
    validTo: "2027-01-01",
    verifiedAt,
  };

  return evaluateProductFit({
    applicableRegulations: [regulation],
    certifications: [certification],
    product,
    query,
  });
}

describe("single-agent sales chat", () => {
  it("handles conversation and missing parameters before forcing a fact tool", () => {
    expect(
      buildDirectChatResponse({
        selectedCountryIso3: null,
        text: "你好，你能帮我做什么？",
      }),
    ).toContain("结构化事实和可追溯来源");
    expect(
      buildDirectChatResponse({
        selectedCountryIso3: "DEU",
        text: "帮我推荐适配产品",
      }),
    ).toContain("应用场景");
    expect(
      buildDirectChatResponse({
        selectedCountryIso3: null,
        text: "比较中国的法规",
      }),
    ).toContain("至少需要两个明确国家");
    expect(
      buildDirectChatResponse({
        selectedCountryIso3: "CHN",
        text: "比较中国的法规",
      }),
    ).toContain("至少需要两个明确国家");
    expect(
      buildDirectChatResponse({
        selectedCountryIso3: null,
        text: "比较 Germany 和 France 的法规",
      }),
    ).toBeNull();
    expect(
      buildDirectChatResponse({
        selectedCountryIso3: "CHN",
        text: "比较 Germany 的法规",
      }),
    ).toBeNull();
    expect(
      buildDirectChatResponse({
        selectedCountryIso3: null,
        text: "比较 USA and 市场",
      }),
    ).toContain("至少需要两个明确国家");
    expect(
      buildDirectChatResponse({
        selectedCountryIso3: null,
        text: "CHN 目前有哪些有效法规？",
      }),
    ).toBeNull();
    expect(
      buildDirectChatResponse({
        selectedCountryIso3: null,
        text: "CHN non-road 120 kW 推荐适配产品",
      }),
    ).toBeNull();
    expect(allowsToolFreeAttachmentResponse("请概述我上传的图片")).toBe(true);
    expect(allowsToolFreeAttachmentResponse("提取这份 PDF 的文字")).toBe(true);
    expect(
      allowsToolFreeAttachmentResponse(
        "结合这张图片告诉我中国当前有效法规和排放限值",
      ),
    ).toBe(false);
    expect(
      allowsToolFreeAttachmentResponse("看附件并推荐适配产品"),
    ).toBe(false);
    expect(
      allowsToolFreeAttachmentResponse(
        "请识别图片并判断这台发动机是否符合国六",
      ),
    ).toBe(false);
    expect(
      allowsToolFreeAttachmentResponse(
        "Read this file and tell me whether it is legal for sale",
      ),
    ).toBe(false);
    expect(
      allowsToolFreeAttachmentResponse("Extract the text from this PDF"),
    ).toBe(true);
  });

  it("turns an evidence gap into an actionable follow-up", () => {
    const response = buildEvidenceGapResponse(
      [
        buildCountryProfileResult({
          informationAsOf: "2026-08-08",
          profile: null,
          requestedTopics: ["regulations"],
          resolvedCountryIso3: null,
        }),
      ],
      false,
    );

    expect(response).toContain("缺少国家");
    expect(response).toContain("CHN、DEU、AUS");
    expect(response).toContain("信息参考，不替代正式认证或法律意见");
  });

  it("requires explicit, unique country-profile evidence topics", () => {
    expect(
      getCountryProfileInputSchema.safeParse({ countryIso3: "CHN" }).success,
    ).toBe(false);
    expect(
      getCountryProfileInputSchema.safeParse({
        countryIso3: "CHN",
        topics: ["regulations", "regulations"],
      }).success,
    ).toBe(false);
    expect(
      getCountryProfileInputSchema.safeParse({
        countryIso3: "CHN",
        topics: ["country", "regulations"],
      }).success,
    ).toBe(true);
  });

  it("keeps an explicitly specified country ahead of map context", () => {
    expect(resolveCountryIso3("BRA", "CHN")).toBe("BRA");
    expect(resolveCountryIso3(undefined, "CHN")).toBe("CHN");
    expect(resolveCountryIso3(null, null)).toBeNull();
  });

  it("requires tool facts and the regulatory disclaimer in instructions", () => {
    const instructions = buildSalesChatInstructions("CHN");

    expect(instructions).toContain("明确国家永远优先于地图默认国家");
    expect(instructions).toContain("禁止使用模型记忆补充");
    expect(instructions).toContain(
      "信息参考，不替代正式认证或法律意见",
    );
    expect(instructions).toContain(
      "禁止自行计算、补零、改权重或修改分数",
    );
    expect(instructions).toContain("调用最少且最直接的工具");
    expect(instructions).toContain("先用 1–2 句直接回答用户问题");
    expect(instructions).toContain("当前 UTC 日期");
    expect(MAX_AI_TOOL_STEPS).toBe(5);
  });

  it("registers all deterministic stage-7 tools on the same agent", () => {
    const tools = createSalesChatTools({
      auditRepository: {
        recordToolCall: async () => undefined,
      },
      selectedCountryIso3: "CHN",
      sessionId: "00000000-0000-4000-8000-000000000904",
    });

    expect(Object.keys(tools).sort()).toEqual([
      "calculateOpportunityScore",
      "compareMarkets",
      "compareRegulations",
      "findCompatibleProducts",
      "generateSalesBrief",
      "getCountryProfile",
      "searchKnowledgeBase",
    ]);
  });

  it("defaults AI knowledge retrieval to the reported current date", async () => {
    const auditInputs: Array<Record<string, unknown>> = [];
    const hybridSearchKnowledge = vi.fn(async (input: unknown) => {
      const query = hybridSearchQuerySchema.parse(input);

      return hybridSearchResponseSchema.parse({
        embeddingModel: "local-hash-embedding-v1",
        filters: {
          applicationScope: query.applicationScope,
          asOf: query.asOf,
          countryIso3: query.countryIso3,
          jurisdictionId: query.jurisdictionId,
          limit: query.limit,
        },
        query: query.query,
        results: [],
        scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
        status: "ok",
      });
    });
    const tools = createSalesChatTools({
      auditRepository: {
        recordToolCall: async ({ input }) => {
          auditInputs.push(input);
        },
      },
      selectedCountryIso3: "CHN",
      services: { hybridSearchKnowledge },
      sessionId: "00000000-0000-4000-8000-000000000906",
    });

    if (!tools.searchKnowledgeBase.execute) {
      throw new Error("Expected searchKnowledgeBase to be executable.");
    }
    const result = searchKnowledgeBaseResultSchema.parse(
      await tools.searchKnowledgeBase.execute(
        { query: "当前排放法规原文" },
        {
          context: undefined as never,
          messages: [],
          toolCallId: "knowledge-current-date",
        },
      ),
    );

    expect(hybridSearchKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        asOf: result.informationAsOf,
        countryIso3: "CHN",
      }),
    );
    expect(result.search.filters.asOf).toBe(result.informationAsOf);
    expect(auditInputs).toEqual([
      {
        queryCharacterCount: Array.from("当前排放法规原文").length,
      },
    ]);
    expect(JSON.stringify(auditInputs)).not.toContain("当前排放法规原文");
  });

  it("does not write failed knowledge queries into tool logs or audits", async () => {
    const sensitiveQuery = "CONFIDENTIAL-CUSTOMER-QUERY";
    const auditCalls: Array<{
      errorCode: string | null;
      input: Record<string, unknown>;
      status: string;
    }> = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const tools = createSalesChatTools({
        auditRepository: {
          recordToolCall: async ({ errorCode, input, status }) => {
            auditCalls.push({ errorCode, input, status });
          },
        },
        selectedCountryIso3: "CHN",
        services: {
          hybridSearchKnowledge: async () => {
            throw new Error(`Database failed for ${sensitiveQuery}`);
          },
        },
        sessionId: "00000000-0000-4000-8000-000000000910",
      });

      if (!tools.searchKnowledgeBase.execute) {
        throw new Error("Expected searchKnowledgeBase to be executable.");
      }
      const result = searchKnowledgeBaseResultSchema.parse(
        await tools.searchKnowledgeBase.execute(
          { query: sensitiveQuery },
          {
            context: undefined as never,
            messages: [],
            toolCallId: "knowledge-error-redaction",
          },
        ),
      );

      expect(result.status).toBe("error");
      expect(consoleError).toHaveBeenCalledWith(
        "AI tool execution failed",
        {
          errorCode: "Error",
          toolName: "searchKnowledgeBase",
        },
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        sensitiveQuery,
      );
      expect(auditCalls).toEqual([
        {
          errorCode: "Error",
          input: {
            queryCharacterCount: sensitiveQuery.length,
          },
          status: "error",
        },
      ]);
      expect(JSON.stringify(auditCalls)).not.toContain(sensitiveQuery);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("uses a mock model and reports insufficient evidence after an empty tool result", async () => {
    const auditCalls: Array<{
      status: string;
      toolName: string;
    }> = [];
    const getCountryDetails = vi.fn(async () => ({
      iso3: "BRA",
      status: "no_data" as const,
    }));
    const model = noDataMockModel();
    const auditRepository = {
      recordToolCall: async (input: {
        status: string;
        toolName: string;
      }) => {
        auditCalls.push({
          status: input.status,
          toolName: input.toolName,
        });
      },
    };
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: "CHN",
      services: {
        findCompatibleProducts: async () => [],
        getCountryDetails,
        hybridSearchKnowledge: async (input) =>
          hybridSearchResponseSchema.parse({
            embeddingModel: "local-hash-embedding-v1",
            filters: {
              applicationScope: null,
              asOf: null,
              countryIso3: null,
              jurisdictionId: null,
              limit: 5,
            },
            query:
              typeof input === "object" &&
              input !== null &&
              "query" in input &&
              typeof input.query === "string"
                ? input.query
                : "empty",
            results: [],
            scoring: {
              keywordWeight: 0.5,
              vectorWeight: 0.5,
            },
            status: "ok",
          }),
      },
      sessionId: "00000000-0000-4000-8000-000000000902",
    });
    const result = streamSalesChat({
      auditRepository,
      messages: [
        {
          content: "巴西当前有哪些柴油机排放法规？",
          role: "user",
        },
      ],
      model,
      selectedCountryIso3: "CHN",
      sessionId: "00000000-0000-4000-8000-000000000902",
      tools,
    });
    const text = await result.text;

    expect(text).toContain("没有足够证据");
    expect(text).not.toContain("MOCK-FAKE-99");
    expect(text).not.toMatch(/已生效法规是|限值为/);
    expect(text).toContain("信息参考，不替代正式认证或法律意见");
    expect(getCountryDetails).toHaveBeenCalledWith(
      expect.objectContaining({ iso3: "BRA" }),
    );
    expect(auditCalls).toEqual([
      {
        status: "no_data",
        toolName: "getCountryProfile",
      },
    ]);
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({
      type: "required",
    });
  });

  it("allows attachment summaries behind an explicit unverified-content boundary", async () => {
    const model = attachmentSummaryMockModel();
    const auditRepository = {
      recordToolCall: vi.fn(async () => undefined),
    };
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000910",
    });
    const result = streamSalesChat({
      allowUnverifiedAttachmentResponse: true,
      auditRepository,
      messages: [
        {
          content: "请概述我上传的图片。",
          role: "user",
        },
      ],
      model,
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000910",
      tools,
    });
    const text = await result.text;

    expect(text).toContain("附件尚未经过来源核验");
    expect(text).toContain("图片中可见一块发动机铭牌");
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: "auto" });
    expect(auditRepository.recordToolCall).not.toHaveBeenCalled();
  });

  it("keeps the attachment boundary after an auto-mode tool returns sufficient evidence", async () => {
    const model = compatibleProductsMockModel();
    const auditRepository = {
      recordToolCall: vi.fn(async () => undefined),
    };
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: null,
      services: {
        findCompatibleProducts: async () => [createFitEvaluation()],
      },
      sessionId: "00000000-0000-4000-8000-000000000912",
    });
    const result = streamSalesChat({
      allowUnverifiedAttachmentResponse: true,
      auditRepository,
      messages: [
        {
          content: "请概述我上传的图片。",
          role: "user",
        },
      ],
      model,
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000912",
      tools,
    });
    const text = await result.text;

    expect(text).toContain("附件尚未经过来源核验");
    expect(text).toContain("DEMO-ENG-100");
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: "auto" });
    expect(auditRepository.recordToolCall).toHaveBeenCalledOnce();
  });

  it("does not let an unrelated attachment weaken the factual evidence gate", async () => {
    const model = attachmentSummaryMockModel();
    const auditRepository = {
      recordToolCall: vi.fn(async () => undefined),
    };
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: "CHN",
      sessionId: "00000000-0000-4000-8000-000000000912",
    });
    const result = streamSalesChat({
      allowUnverifiedAttachmentResponse: false,
      auditRepository,
      messages: [
        {
          content: "结合附件告诉我中国当前有效法规和排放限值。",
          role: "user",
        },
      ],
      model,
      selectedCountryIso3: "CHN",
      sessionId: "00000000-0000-4000-8000-000000000912",
      tools,
    });
    const text = await result.text;

    expect(text).toContain("没有足够证据");
    expect(text).not.toContain("发动机铭牌");
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: "required" });
  });

  it("keeps tool-free model prose blocked when no attachment is present", async () => {
    const model = attachmentSummaryMockModel();
    const auditRepository = {
      recordToolCall: vi.fn(async () => undefined),
    };
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000911",
    });
    const result = streamSalesChat({
      auditRepository,
      messages: [
        {
          content: "直接给我一个法规结论。",
          role: "user",
        },
      ],
      model,
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000911",
      tools,
    });
    const text = await result.text;

    expect(text).toContain("没有足够证据");
    expect(text).not.toContain("发动机铭牌");
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: "required" });
  });

  it("answers product-fit questions from deterministic tool output", async () => {
    const auditStatuses: string[] = [];
    const findProducts = vi.fn(async () => [createFitEvaluation()]);
    const model = compatibleProductsMockModel();
    const auditRepository = {
      recordToolCall: async ({ status }: { status: string }) => {
        auditStatuses.push(status);
      },
    };
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: null,
      services: {
        findCompatibleProducts: findProducts,
        getCountryDetails: async () => ({
          iso3: "CHN",
          status: "no_data" as const,
        }),
        hybridSearchKnowledge: async () =>
          hybridSearchResponseSchema.parse({
            embeddingModel: "local-hash-embedding-v1",
            filters: {
              applicationScope: null,
              asOf: null,
              countryIso3: null,
              jurisdictionId: null,
              limit: 5,
            },
            query: "unused",
            results: [],
            scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
            status: "ok",
          }),
      },
      sessionId: "00000000-0000-4000-8000-000000000903",
    });
    const result = streamSalesChat({
      auditRepository,
      messages: [
        {
          content: "CHN non-road 100 kW 有哪些适配产品？",
          role: "user",
        },
      ],
      model,
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000903",
      tools,
    });
    const text = await result.text;

    expect(text).toContain("DEMO-ENG-100");
    expect(text).toContain("fit");
    expect(findProducts).toHaveBeenCalledWith({
      applicationScope: "non-road",
      asOf: "2026-07-29",
      countryIso3: "CHN",
      powerKw: 100,
    });
    expect(auditStatuses).toEqual(["success"]);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      '"status":"fit"',
    );
  });

  it("fails closed when one of several tool results lacks evidence", async () => {
    const auditStatuses: string[] = [];
    const model = mixedEvidenceMockModel();
    const auditRepository = {
      recordToolCall: async ({ status }: { status: string }) => {
        auditStatuses.push(status);
      },
    };
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: null,
      services: {
        findCompatibleProducts: async () => [createFitEvaluation()],
        getCountryDetails: async () => ({
          iso3: "BRA",
          status: "no_data" as const,
        }),
        hybridSearchKnowledge: async () =>
          hybridSearchResponseSchema.parse({
            embeddingModel: "local-hash-embedding-v1",
            filters: {
              applicationScope: null,
              asOf: null,
              countryIso3: null,
              jurisdictionId: null,
              limit: 5,
            },
            query: "unused",
            results: [],
            scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
            status: "ok",
          }),
      },
      sessionId: "00000000-0000-4000-8000-000000000905",
    });
    const result = streamSalesChat({
      auditRepository,
      messages: [
        {
          content: "比较 BRA 法规并推荐 CHN 适配产品。",
          role: "user",
        },
      ],
      model,
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000905",
      tools,
    });
    const text = await result.text;

    expect(text).toContain("没有足够证据");
    expect(text).not.toContain("MOCK-FAKE-99");
    expect(text).not.toContain("已确定适配");
    expect(auditStatuses.sort()).toEqual(["no_data", "success"]);
  });

  it("fails closed when a later tool call has invalid input", async () => {
    const auditCalls: Array<{
      errorCode: string | null;
      input: Record<string, unknown>;
      status: string;
      toolCallId: string;
      toolName: string;
    }> = [];
    const auditRepository = {
      recordToolCall: async (input: {
        errorCode: string | null;
        input: Record<string, unknown>;
        status: string;
        toolCallId: string;
        toolName: string;
      }) => {
        auditCalls.push({
          errorCode: input.errorCode,
          input: input.input,
          status: input.status,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
        });
      },
    };
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: null,
      services: {
        findCompatibleProducts: async () => [createFitEvaluation()],
      },
      sessionId: "00000000-0000-4000-8000-000000000908",
    });
    const result = streamSalesChat({
      auditRepository,
      messages: [
        {
          content: "推荐 CHN 产品并核对 BRA 法规。",
          role: "user",
        },
      ],
      model: invalidToolInputMixedModel(),
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000908",
      tools,
    });
    const text = await result.text;

    expect(text).toContain("没有足够证据");
    expect(text).not.toContain("已确定适配");
    expect(text).not.toContain("MOCK-FAKE-99");
    expect(auditCalls).toHaveLength(2);
    expect(auditCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          errorCode: null,
          status: "success",
          toolCallId: "invalid-input-product-fit-call",
          toolName: "findCompatibleProducts",
        }),
        {
          errorCode: "INVALID_TOOL_INPUT",
          input: {
            inputType: "object",
            providedFields: ["countryIso3"],
          },
          status: "error",
          toolCallId: "invalid-country-profile-call",
          toolName: "getCountryProfile",
        },
      ]),
    );
  });

  it("buffers prose until sequential tool calls all pass the evidence gate", async () => {
    const auditStatuses: string[] = [];
    const auditRepository = {
      recordToolCall: async ({ status }: { status: string }) => {
        auditStatuses.push(status);
      },
    };
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: null,
      services: {
        findCompatibleProducts: async () => [createFitEvaluation()],
        getCountryDetails: async () => ({
          iso3: "BRA",
          status: "no_data" as const,
        }),
      },
      sessionId: "00000000-0000-4000-8000-000000000907",
    });
    const result = streamSalesChat({
      auditRepository,
      messages: [
        {
          content: "先推荐 CHN 产品，再核对 BRA 法规。",
          role: "user",
        },
      ],
      model: sequentialMixedEvidenceMockModel(),
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000907",
      tools,
    });
    const text = await result.text;

    expect(text).toContain("没有足够证据");
    expect(text).not.toContain("已确定适配");
    expect(text).not.toContain("MOCK-FAKE-99");
    expect(auditStatuses).toEqual(["success", "no_data"]);
  });

  it("emits only prose generated after the final successful tool result", async () => {
    const auditStatuses: string[] = [];
    const auditRepository = {
      recordToolCall: async ({ status }: { status: string }) => {
        auditStatuses.push(status);
      },
    };
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: null,
      services: {
        findCompatibleProducts: async () => [createFitEvaluation()],
      },
      sessionId: "00000000-0000-4000-8000-000000000909",
    });
    const result = streamSalesChat({
      auditRepository,
      messages: [
        {
          content: "分两步核对 CHN 产品适配。",
          role: "user",
        },
      ],
      model: sequentialSuccessfulToolsMockModel(),
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000909",
      tools,
    });
    const text = await result.text;

    expect(text).toContain("FINAL-SUMMARY-AFTER-ALL-TOOLS");
    expect(text).not.toContain("PREMATURE-CLAIM-BEFORE-SECOND-RESULT");
    expect(auditStatuses).toEqual(["success", "success"]);
  });

  it("propagates Demo classification into product-fit warnings", () => {
    const result = buildCompatibleProductsResult({
      applicationScope: "non-road",
      asOf: "2026-07-29",
      countryIso3: "CHN",
      evaluations: [createFitEvaluation()],
      powerKw: 100,
    });

    expect(result.citations.some(({ isDemo }) => isDemo)).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Demo")]),
    );
    expect(
      result.citations.map(({ sourceTitle }) => sourceTitle),
    ).toEqual(
      expect.arrayContaining([
        "DEMO ONLY — Jurisdiction source",
        "DEMO ONLY — Membership source",
      ]),
    );
    const clientResult = clientAiToolResultSchema.parse(result);
    expect(clientResult.tool).toBe("findCompatibleProducts");
    if (clientResult.tool !== "findCompatibleProducts") {
      throw new Error("Expected a compatible-products client result.");
    }
    expect(clientResult.evaluations[0]?.product).toMatchObject({
      availableFrom: "2025-01-01",
      availableTo: null,
    });
    expect(
      clientAiToolResultSchema.safeParse({
        ...result,
        evaluations: result.evaluations.map((evaluation) => ({
          ...evaluation,
          product: evaluation.product
            ? { ...evaluation.product, availableFrom: "not-a-date" }
            : null,
        })),
      }).success,
    ).toBe(false);
  });

  it("preserves a historical regulation record status in product-fit citations", () => {
    const evaluation = createFitEvaluation();
    const historicalEvaluation = {
      ...evaluation,
      regulationChecks: evaluation.regulationChecks.map((check) => ({
        ...check,
        regulation: {
          ...check.regulation,
          effectiveTo: "2025-01-01",
          recordStatus: "superseded" as const,
        },
      })),
    };
    const result = buildCompatibleProductsResult({
      applicationScope: "non-road",
      asOf: "2024-12-31",
      countryIso3: "CHN",
      evaluations: [historicalEvaluation],
      powerKw: 100,
    });
    const regulationCitations = result.citations.filter(
      ({ regulationId }) => regulationId !== null,
    );

    expect(regulationCitations.length).toBeGreaterThan(0);
    expect(
      regulationCitations.every(
        ({ regulationStatus }) => regulationStatus === "superseded",
      ),
    ).toBe(true);
  });

  it("reports no_data when compatible-product evidence is empty", () => {
    const result = buildCompatibleProductsResult({
      applicationScope: "non-road",
      asOf: "2026-07-29",
      countryIso3: "CHN",
      evaluations: [],
      powerKw: 100,
    });

    expect(result).toMatchObject({
      evidenceSufficient: false,
      status: "no_data",
    });
    expect(result.warnings).toContain(
      "没有足够证据支持肯定结论；请补充结构化事实或可追溯来源。",
    );
  });

  it("keeps shared regulation citations distinct by country context", () => {
    const source = {
      countryIso3: "CHN" as const,
      entityId: "00000000-0000-4000-8000-000000000301",
      entityType: "regulation" as const,
      isDemo: true,
      locator: "DEMO-REG",
      publishedOn: "2026-01-01",
      regulationId: "00000000-0000-4000-8000-000000000301",
      regulationStatus: "effective" as const,
      sourceId: "00000000-0000-4000-8000-000000000302",
      sourceTitle: "DEMO ONLY - Shared regulation source",
      sourceUrl: "https://example.invalid/demo/shared-regulation",
      title: "DEMO ONLY - Shared regional regulation",
      verifiedAt: "2026-01-15T00:00:00.000Z",
    };
    const result = buildRegulationComparisonResult({
      comparison: {
        countries: [
          {
            countryIso3: "CHN",
            countryName: "China",
            currentEffectiveRegulations: [],
            futureAdoptedRegulations: [],
            status: "no_data",
          },
          {
            countryIso3: "BRA",
            countryName: "Brazil",
            currentEffectiveRegulations: [],
            futureAdoptedRegulations: [],
            status: "no_data",
          },
        ],
        missingData: [],
        query: {
          applicationScope: "non-road",
          asOf: "2026-07-29",
          countryIso3s: ["CHN", "BRA"],
          powerKw: 100,
        },
        sources: [source, { ...source, countryIso3: "BRA" }],
      },
      informationAsOf: "2026-07-29",
    });

    expect(
      result.citations.map(({ countryIso3 }) => countryIso3).sort(),
    ).toEqual(["BRA", "CHN"]);
  });

  it("propagates Demo classification into knowledge warnings", () => {
    const search = hybridSearchResponseSchema.parse({
      embeddingModel: "local-hash-embedding-v1",
      filters: {
        applicationScope: "non-road",
        asOf: "2026-07-29",
        countryIso3: "CHN",
        jurisdictionId: null,
        limit: 5,
      },
      query: "排放法规",
      results: [
        {
          applicationScope: "non-road",
          chunkId: "00000000-0000-4000-8000-000000000601",
          content: "DEMO ONLY — regulation excerpt",
          countryIso3: "CHN",
          document: {
            downloadUrl: null,
            id: "00000000-0000-4000-8000-000000000602",
            originalFilename: "demo-regulation.txt",
            publishedOn: "2025-02-01",
            source: {
              id: "00000000-0000-4000-8000-000000000603",
              isDemo: true,
              publishedOn: "2025-01-15",
              publisher: "Demo publisher",
              title: "DEMO ONLY — Document source",
              url: "https://example.invalid/demo/document",
              verifiedAt: "2026-01-15T00:00:00.000Z",
            },
            title: "DEMO ONLY — Regulation document",
          },
          finalScore: 0.8,
          headingPath: ["Demo section"],
          jurisdiction: null,
          keywordScore: 0.8,
          pageFrom: 1,
          pageTo: 1,
          rank: 1,
          sectionLocator: "§1",
          validFrom: "2025-01-01",
          validTo: null,
          vectorScore: 0.8,
          warnings: [],
        },
      ],
      scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
      status: "ok",
    });
    const result = buildKnowledgeResult({
      informationAsOf: "2026-07-29",
      resolvedCountryIso3: "CHN",
      search,
    });

    expect(result.citations.some(({ isDemo }) => isDemo)).toBe(true);
    expect(result.citations[0]?.publishedOn).toBe("2025-02-01");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Demo")]),
    );
  });
});
