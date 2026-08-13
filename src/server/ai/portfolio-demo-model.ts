import "server-only";

import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

import { generateSalesBriefResultSchema } from "@/features/ai/schemas";
import { buildConversationBusinessContext } from "@/server/ai/conversation-context";
import { currentUtcDate } from "@/server/ai/tool-results";

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

type PortfolioDemoToolCall = {
  input: Record<string, unknown>;
  toolName:
    | "calculateOpportunityScore"
    | "compareMarkets"
    | "compareRegulations"
    | "findCompatibleProducts"
    | "generateSalesBrief"
    | "getCountryProfile"
    | "searchKnowledgeBase";
};

function latestUserText(prompt: unknown): string {
  if (!Array.isArray(prompt)) {
    return "";
  }

  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index];
    if (
      typeof message !== "object" ||
      message === null ||
      !("role" in message) ||
      message.role !== "user" ||
      !("content" in message) ||
      !Array.isArray(message.content)
    ) {
      continue;
    }

    return message.content
      .flatMap((part: unknown) =>
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n");
  }

  return "";
}

function userTexts(prompt: unknown): string[] {
  if (!Array.isArray(prompt)) {
    return [];
  }

  return prompt
    .flatMap((message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("role" in message) ||
        message.role !== "user" ||
        !("content" in message) ||
        !Array.isArray(message.content)
      ) {
        return [];
      }

      return message.content.flatMap((part: unknown) =>
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof part.text === "string"
          ? [part.text]
          : [],
      );
    });
}

export function selectPortfolioDemoTool(
  userText: string,
  conversationContext: string | readonly string[] = userText,
): PortfolioDemoToolCall {
  const providedTexts =
    typeof conversationContext === "string"
      ? [conversationContext]
      : [...conversationContext];
  const userTexts =
    providedTexts.at(-1) === userText
      ? providedTexts
      : [...providedTexts, userText];
  const context = buildConversationBusinessContext(userTexts);
  const countries = context.countryIso3s;
  const applicationScope = context.applicationScope;
  const powerKw = context.powerKw;
  const asOf = context.asOf ?? currentUtcDate();
  const productModelCode = context.productModelCode;

  if (
    context.activeTask === "sales_brief" &&
    countries.length >= 2 &&
    applicationScope !== null &&
    powerKw !== null
  ) {
    return {
      input: {
        applicationScope,
        asOf,
        countryIso3s: countries.slice(0, 5),
        powerKw,
        targetCountryIso3: context.targetCountryIso3 ?? countries[0],
        ...(productModelCode ? { productModelCode } : {}),
      },
      toolName: "generateSalesBrief",
    };
  }

  if (
    context.activeTask === "opportunity_score" &&
    countries.length >= 2 &&
    applicationScope !== null &&
    powerKw !== null
  ) {
    return {
      input: {
        applicationScope,
        asOf,
        countryIso3s: countries.slice(0, 5),
        powerKw,
        ...(productModelCode ? { productModelCode } : {}),
      },
      toolName: "calculateOpportunityScore",
    };
  }

  if (context.activeTask === "market_compare" && countries.length >= 2) {
    return {
      input: {
        countryIso3s: countries.slice(0, 5),
        ...(applicationScope ? { applicationScope } : {}),
      },
      toolName: "compareMarkets",
    };
  }

  if (
    context.activeTask === "regulation_compare" &&
    countries.length >= 2 &&
    applicationScope !== null &&
    powerKw !== null
  ) {
    return {
      input: {
        applicationScope,
        asOf,
        countryIso3s: countries.slice(0, 5),
        powerKw,
      },
      toolName: "compareRegulations",
    };
  }

  if (
    context.activeTask === "product_fit" &&
    applicationScope !== null &&
    powerKw !== null
  ) {
    return {
      input: {
        applicationScope,
        asOf,
        countryIso3: context.focusedCountryIso3 ?? countries[0] ?? null,
        powerKw,
        ...(productModelCode ? { productModelCode } : {}),
      },
      toolName: "findCompatibleProducts",
    };
  }

  if (context.activeTask === "knowledge") {
    return {
      input: {
        applicationScope,
        asOf,
        countryIso3: context.focusedCountryIso3 ?? countries[0] ?? null,
        query: userText,
      },
      toolName: "searchKnowledgeBase",
    };
  }

  const topics =
    context.profileTopics.length > 0 ? context.profileTopics : ["country"];

  return {
    input: {
      asOf,
      countryIso3: context.focusedCountryIso3 ?? countries[0] ?? null,
      topics,
    },
    toolName: "getCountryProfile",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function salesBriefSummaryFromPrompt(prompt: unknown): string | null {
  if (!Array.isArray(prompt)) {
    return null;
  }

  for (let messageIndex = prompt.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = prompt[messageIndex];
    if (
      !isRecord(message) ||
      message.role !== "tool" ||
      !Array.isArray(message.content)
    ) {
      continue;
    }

    for (
      let partIndex = message.content.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.content[partIndex];
      if (
        !isRecord(part) ||
        part.type !== "tool-result" ||
        part.toolName !== "generateSalesBrief" ||
        part.toolCallId !== "portfolio-demo-generateSalesBrief" ||
        !isRecord(part.output) ||
        part.output.type !== "json"
      ) {
        continue;
      }

      const parsed = generateSalesBriefResultSchema.safeParse(
        part.output.value,
      );
      if (!parsed.success) {
        return null;
      }

      const { brief } = parsed.data;
      if (
        brief.marketScore.countryIso3 !== brief.query.targetCountryIso3
      ) {
        return null;
      }

      const score =
        brief.marketScore.overallScore === null
          ? `${brief.marketScore.countryIso3} 当前证据下不可评分`
          : `${brief.marketScore.countryIso3} 总体机会分为 ${brief.marketScore.overallScore}/100`;
      const risk = brief.risks[0]
        ? `首要风险：${brief.risks[0].title}：${brief.risks[0].text}。`
        : "结构化简报未列出风险。";
      const action = brief.salesActions[0]
        ? `第一行动：${brief.salesActions[0].action}。`
        : "结构化简报未列出行动。";

      return `${score}（数据覆盖率 ${brief.marketScore.dataCoveragePct}%）。${risk}${action}\n\n离线 Demo 仅使用明确标记的虚构 fixture，不可用于报价、认证声明或销售承诺。\n\n信息参考，不替代正式认证或法律意见`;
    }
  }

  return null;
}

function toolSummary(
  toolName: PortfolioDemoToolCall["toolName"],
  prompt: unknown,
): string {
  if (toolName === "findCompatibleProducts") {
    return "已运行 product-fit-v1 确定性匹配。适配状态、逐项理由和证据以结构化卡片为准；离线 Demo 只使用明确标记的虚构产品与认证 fixture。\n\n信息参考，不替代正式认证或法律意见";
  }
  if (toolName === "compareRegulations") {
    return "已按同一场景、功率和日期完成法规比较。状态、限值和来源以结构化卡片为准；离线 Demo 只使用明确标记的虚构 fixture。\n\n信息参考，不替代正式认证或法律意见";
  }
  if (toolName === "compareMarkets") {
    return "已按一致口径查询结构化市场指标。可比性、观测值和来源以结构化卡片为准；离线 Demo 只使用明确标记的虚构 fixture。";
  }
  if (toolName === "calculateOpportunityScore") {
    return "已运行 opportunity-score-v1 确定性评分。分数、权重、数据覆盖率和缺口以结构化卡片为准；离线 Demo 只使用明确标记的虚构 fixture。";
  }
  if (toolName === "generateSalesBrief") {
    return (
      salesBriefSummaryFromPrompt(prompt) ??
      "已生成确定性的结构化销售简报。机会、风险、产品建议、下一步和数据缺口以结构化卡片为准；离线 Demo 只使用明确标记的虚构 fixture，不可用于报价、认证声明或销售承诺。\n\n信息参考，不替代正式认证或法律意见"
    );
  }
  if (toolName === "searchKnowledgeBase") {
    return "已检索可追溯文档证据。命中内容、页码或章节、有效期和来源以结构化卡片为准；离线 Demo 只使用明确标记的虚构 fixture。\n\n信息参考，不替代正式认证或法律意见";
  }
  return "已查询国家资料。当前有效法规、未来已采纳法规、核验时间和来源以结构化卡片为准；离线 Demo 只使用明确标记的虚构 fixture。\n\n信息参考，不替代正式认证或法律意见";
}

export function createPortfolioDemoModel() {
  let selectedTool: PortfolioDemoToolCall | null = null;
  let step = 0;

  return new MockLanguageModelV3({
    modelId: "portfolio-demo-v1",
    provider: "portfolio-demo",
    doStream: async (options) => {
      step += 1;

      if (step === 1) {
        selectedTool = selectPortfolioDemoTool(
          latestUserText(options.prompt),
          userTexts(options.prompt),
        );
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              {
                input: JSON.stringify(selectedTool.input),
                toolCallId: `portfolio-demo-${selectedTool.toolName}`,
                toolName: selectedTool.toolName,
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
        };
      }

      const text = toolSummary(
        selectedTool?.toolName ?? "getCountryProfile",
        options.prompt,
      );
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { id: "portfolio-demo-answer", type: "text-start" as const },
            {
              delta: text,
              id: "portfolio-demo-answer",
              type: "text-delta" as const,
            },
            { id: "portfolio-demo-answer", type: "text-end" as const },
            {
              finishReason: { raw: undefined, unified: "stop" as const },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      };
    },
  });
}
