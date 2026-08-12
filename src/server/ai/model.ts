import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import {
  userAiConfigSchema,
  type UserAiConfig,
} from "@/features/ai/schemas";
import { env } from "@/env";
import { createPortfolioDemoModel } from "@/server/ai/portfolio-demo-model";
import { isPortfolioDemoMode } from "@/server/config/portfolio-demo";

export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

export type ConfiguredAiModel = {
  model: LanguageModel;
  modelId: string;
};

export type ServerAiConfig = UserAiConfig & {
  multimodalModel?: string;
};

function parseServerAiConfigForModel(
  config: ServerAiConfig,
  model: string,
) {
  return userAiConfigSchema.safeParse({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    enableThinking: config.enableThinking,
    model,
  });
}

export function getServerAiConfig(): ServerAiConfig | null {
  if (env.NODE_ENV === "test" || env.AI_PROVIDER !== "openai-compatible") {
    return null;
  }
  if (!env.AI_API_KEY || !env.AI_BASE_URL || !env.AI_MODEL) {
    return null;
  }

  const parsedConfig = userAiConfigSchema.safeParse({
    apiKey: env.AI_API_KEY,
    baseUrl: env.AI_BASE_URL,
    enableThinking: env.AI_ENABLE_THINKING,
    model: env.AI_MODEL,
  });
  return parsedConfig.success
    ? {
        ...parsedConfig.data,
        multimodalModel: env.AI_MULTIMODAL_MODEL,
      }
    : null;
}

export function isServerAiConfigured(): boolean {
  return isPortfolioDemoMode() || getServerAiConfig() !== null;
}

export function isServerMultimodalAiConfigured(
  config?: ServerAiConfig | null,
): boolean {
  if (config === undefined && isPortfolioDemoMode()) {
    return false;
  }

  const resolvedConfig =
    config === undefined ? getServerAiConfig() : config;
  if (!resolvedConfig?.multimodalModel) {
    return false;
  }

  return parseServerAiConfigForModel(
    resolvedConfig,
    resolvedConfig.multimodalModel,
  ).success;
}

/**
 * Creates a provider for one request only. The key is never included in the
 * model id, audit payload, error response, or any client-rendered value.
 */
export function getConfiguredAiModel(
  config?: ServerAiConfig | null,
  options: { requiresMultimodalModel?: boolean } = {},
): ConfiguredAiModel {
  if (config === undefined && isPortfolioDemoMode()) {
    if (options.requiresMultimodalModel) {
      throw new AiConfigurationError(
        "服务端尚未配置支持图片输入的多模态模型。",
      );
    }

    return {
      model: createPortfolioDemoModel(),
      modelId: "portfolio-demo/deterministic-v1",
    };
  }

  const resolvedConfig = config ?? getServerAiConfig();
  if (!resolvedConfig) {
    throw new AiConfigurationError("服务端尚未配置 OpenAI-compatible AI 接口。");
  }

  const selectedModel = options.requiresMultimodalModel
    ? resolvedConfig.multimodalModel
    : resolvedConfig.model;
  if (!selectedModel) {
    throw new AiConfigurationError(
      "服务端尚未配置支持图片输入的多模态模型。",
    );
  }

  const parsedConfig = parseServerAiConfigForModel(
    resolvedConfig,
    selectedModel,
  );
  if (!parsedConfig.success) {
    throw new AiConfigurationError("服务端 AI 配置无效，请检查接口地址和模型名。");
  }

  const provider = createOpenAICompatible({
    apiKey: parsedConfig.data.apiKey,
    baseURL: parsedConfig.data.baseUrl,
    name: "server-openai-compatible",
    transformRequestBody: (body) =>
      parsedConfig.data.enableThinking === undefined
        ? body
        : {
            ...body,
            enable_thinking: parsedConfig.data.enableThinking,
          },
  });

  return {
    model: provider(parsedConfig.data.model),
    modelId: `server-openai-compatible/${parsedConfig.data.model}`,
  };
}
