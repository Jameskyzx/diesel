import "server-only";

import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

import type { ApplicationScope } from "@/features/database/schemas";
import { countryCatalog } from "@/server/db/seed/country-catalog";
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

const countryCodes = new Set(countryCatalog.map(({ iso3 }) => iso3));

const scopeMatchers: ReadonlyArray<{
  pattern: RegExp;
  scope: ApplicationScope;
}> = [
  { pattern: /on-road-truck|卡车|货车/iu, scope: "on-road-truck" },
  { pattern: /on-road-bus|客车|公交/iu, scope: "on-road-bus" },
  { pattern: /construction|工程机械|建筑机械/iu, scope: "construction" },
  { pattern: /agriculture|农业|农机/iu, scope: "agriculture" },
  { pattern: /generator-set|发电机组/iu, scope: "generator-set" },
  { pattern: /marine|船用/iu, scope: "marine" },
  { pattern: /non-road|非道路/iu, scope: "non-road" },
  { pattern: /on-road|道路/iu, scope: "on-road" },
];

type PortfolioDemoToolCall = {
  input: Record<string, unknown>;
  toolName:
    | "compareRegulations"
    | "findCompatibleProducts"
    | "generateSalesBrief"
    | "getCountryProfile";
};

function countryCodesIn(text: string): string[] {
  const matches = text.toUpperCase().match(/(?:^|[^A-Z])([A-Z]{3})(?=$|[^A-Z])/gu);
  if (!matches) {
    return [];
  }

  const countries = matches
    .map((match) => match.replace(/[^A-Z]/gu, ""))
    .filter((iso3) => countryCodes.has(iso3));
  return Array.from(new Set(countries));
}

function applicationScopeIn(text: string): ApplicationScope | null {
  return scopeMatchers.find(({ pattern }) => pattern.test(text))?.scope ?? null;
}

function powerKwIn(text: string): number | null {
  const match = text.match(/(?:^|\D)(\d+(?:\.\d+)?)\s*(?:kw|千瓦)(?:\D|$)/iu);
  return match ? Number(match[1]) : null;
}

function explicitAsOfIn(text: string): string | null {
  return text.match(/\b\d{4}-\d{2}-\d{2}\b/u)?.[0] ?? null;
}

function productModelCodeIn(text: string): string | null {
  const match = text
    .toUpperCase()
    .match(/\b(?=[A-Z0-9-]*\d)([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/u);
  return match?.[1] ?? null;
}

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

function latestCompleteAnalysisContext(messages: readonly string[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] ?? "";
    if (
      countryCodesIn(message).length >= 2 &&
      applicationScopeIn(message) !== null &&
      powerKwIn(message) !== null
    ) {
      return message;
    }
  }

  return messages.at(-1) ?? "";
}

export function selectPortfolioDemoTool(
  userText: string,
  conversationContext: string | readonly string[] = userText,
): PortfolioDemoToolCall {
  const contextText =
    typeof conversationContext === "string"
      ? conversationContext
      : latestCompleteAnalysisContext(conversationContext);
  const countriesFromLatestTurn = countryCodesIn(userText);
  const countries =
    countriesFromLatestTurn.length > 0
      ? countriesFromLatestTurn
      : countryCodesIn(contextText);
  const applicationScope =
    applicationScopeIn(userText) ?? applicationScopeIn(contextText);
  const powerKw = powerKwIn(userText) ?? powerKwIn(contextText);
  const asOf =
    explicitAsOfIn(userText) ??
    explicitAsOfIn(contextText) ??
    currentUtcDate();
  const productModelCode =
    productModelCodeIn(userText) ?? productModelCodeIn(contextText);

  if (
    /销售简报|客户复述|下一步建议|sales\s*brief/iu.test(userText) &&
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
        targetCountryIso3: countries[0],
      },
      toolName: "generateSalesBrief",
    };
  }

  if (
    /比较|对比|compare/iu.test(userText) &&
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
    /产品|适配|兼容|product|fit/iu.test(userText) &&
    applicationScope !== null &&
    powerKw !== null
  ) {
    return {
      input: {
        applicationScope,
        asOf,
        countryIso3: countries[0] ?? null,
        powerKw,
        ...(productModelCode ? { productModelCode } : {}),
      },
      toolName: "findCompatibleProducts",
    };
  }

  const topics = /市场|销量|market/iu.test(userText)
    ? ["market"]
    : /法规|排放|regulation|emission/iu.test(userText)
      ? ["regulations"]
      : ["country"];

  return {
    input: {
      asOf,
      countryIso3: countries[0] ?? null,
      topics,
    },
    toolName: "getCountryProfile",
  };
}

function toolSummary(toolName: PortfolioDemoToolCall["toolName"]): string {
  if (toolName === "findCompatibleProducts") {
    return "已运行 product-fit-v1 确定性匹配。适配状态、逐项理由和证据以结构化卡片为准；离线 Demo 只使用明确标记的虚构产品与认证 fixture。\n\n信息参考，不替代正式认证或法律意见";
  }
  if (toolName === "compareRegulations") {
    return "已按同一场景、功率和日期完成法规比较。状态、限值和来源以结构化卡片为准；离线 Demo 只使用明确标记的虚构 fixture。\n\n信息参考，不替代正式认证或法律意见";
  }
  if (toolName === "generateSalesBrief") {
    return "已生成确定性的结构化销售简报。机会、风险、产品建议、下一步和数据缺口以结构化卡片为准；离线 Demo 只使用明确标记的虚构 fixture，不可用于客户承诺。\n\n信息参考，不替代正式认证或法律意见";
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

      const text = toolSummary(selectedTool?.toolName ?? "getCountryProfile");
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
