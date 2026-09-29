import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { createHash } from "node:crypto";

import {
  aiModelIdSchema,
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
  costProfile: unknown | null;
  model: LanguageModel;
  modelId: string;
  providerProfile: AiProviderProfile;
};

export type AiProviderProfile = {
  adapter: "@ai-sdk/openai-compatible" | "portfolio-demo";
  adapterContractVersion: 1 | 2;
  enableThinking: boolean | null;
  endpointSha256: string | null;
  includeUsage: boolean;
};

export type ServerAiConfig = UserAiConfig & {
  costProfile?: unknown;
  includeUsage?: boolean;
  multimodalModel?: string;
};

const invalidModelCostProfile = Object.freeze({ invalid: true });

function endpointSha256(baseUrl: string): string {
  return createHash("sha256").update(baseUrl, "utf8").digest("hex");
}

function isOfficialDeepSeekEndpoint(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  return url.origin === "https://api.deepseek.com" &&
    (url.pathname === "/" || url.pathname === "/v1");
}

function finalModelId(value: string): string {
  const parsed = aiModelIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AiConfigurationError("服务端 AI 配置无效，请检查模型标识。");
  }
  return parsed.data;
}

export function parseConfiguredModelCostProfile(
  value: string | undefined,
): unknown | null {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    // Do not retain malformed configuration text because it may contain
    // private commercial terms. The strict estimator will reject this marker.
    return invalidModelCostProfile;
  }
}

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
        costProfile: parseConfiguredModelCostProfile(
          env.AI_COST_PROFILE_JSON,
        ),
        includeUsage: env.AI_INCLUDE_USAGE,
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
      costProfile: null,
      model: createPortfolioDemoModel(),
      modelId: finalModelId("portfolio-demo/deterministic-v1"),
      providerProfile: {
        adapter: "portfolio-demo",
        adapterContractVersion: 1,
        enableThinking: null,
        endpointSha256: null,
        includeUsage: false,
      },
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

  const usesDeepSeekContract = isOfficialDeepSeekEndpoint(parsedConfig.data.baseUrl);
  const enableThinking = usesDeepSeekContract
    ? parsedConfig.data.enableThinking ?? false
    : parsedConfig.data.enableThinking;
  if (usesDeepSeekContract && enableThinking) {
    // DeepSeek thinking mode rejects the required tool choice used by this
    // application; do not silently downgrade an explicitly enabled setting.
    throw new AiConfigurationError(
      "当前 DeepSeek 工具流程要求 AI_ENABLE_THINKING=false。",
    );
  }

  const provider = createOpenAICompatible({
    apiKey: parsedConfig.data.apiKey,
    baseURL: parsedConfig.data.baseUrl,
    includeUsage: resolvedConfig.includeUsage === true,
    name: "server-openai-compatible",
    transformRequestBody: (body) =>
      enableThinking === undefined
        ? body
        : {
            ...body,
            ...(usesDeepSeekContract
              ? { thinking: { type: "disabled" } }
              : { enable_thinking: enableThinking }),
          },
  });

  return {
    costProfile: resolvedConfig.costProfile ?? null,
    model: provider(parsedConfig.data.model),
    modelId: finalModelId(
      `server-openai-compatible/${parsedConfig.data.model}`,
    ),
    providerProfile: {
      adapter: "@ai-sdk/openai-compatible",
      adapterContractVersion: usesDeepSeekContract ? 2 : 1,
      enableThinking: enableThinking ?? null,
      endpointSha256: endpointSha256(parsedConfig.data.baseUrl),
      includeUsage: resolvedConfig.includeUsage === true,
    },
  };
}
