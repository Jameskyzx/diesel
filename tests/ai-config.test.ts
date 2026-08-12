import { describe, expect, it } from "vitest";

import { userAiConfigSchema } from "@/features/ai/schemas";
import {
  getConfiguredAiModel,
  isServerMultimodalAiConfigured,
} from "@/server/ai/model";

const validConfig = {
  apiKey: "user-secret-key",
  baseUrl: "https://api.example.com/v1/",
  model: "gpt-4o-mini",
};

describe("server AI configuration", () => {
  it("normalizes an OpenAI-compatible endpoint and creates a request model", () => {
    const config = userAiConfigSchema.parse(validConfig);
    const configured = getConfiguredAiModel(config);

    expect(config.baseUrl).toBe("https://api.example.com/v1");
    expect(configured.modelId).toBe("server-openai-compatible/gpt-4o-mini");
    expect(configured.model).toBeDefined();
  });

  it.each([
    "http://api.example.com/v1",
    "https://localhost:11434/v1",
    "https://127.0.0.1/v1",
    "https://192.168.1.20/v1",
    "https://user:password@api.example.com/v1",
  ])("rejects unsafe endpoint %s", (baseUrl) => {
    expect(() => userAiConfigSchema.parse({ ...validConfig, baseUrl })).toThrow();
  });

  it("requires a key and does not put it in the model identity", () => {
    expect(() => userAiConfigSchema.parse({ ...validConfig, apiKey: "" })).toThrow();
    expect(getConfiguredAiModel(userAiConfigSchema.parse(validConfig)).modelId).not.toContain(
      validConfig.apiKey,
    );
  });

  it("selects an explicitly configured multimodal model for image turns", () => {
    const config = {
      ...userAiConfigSchema.parse(validConfig),
      multimodalModel: "qwen3.7-plus",
    };

    expect(
      getConfiguredAiModel(config, { requiresMultimodalModel: true })
        .modelId,
    ).toBe("server-openai-compatible/qwen3.7-plus");
    expect(() =>
      getConfiguredAiModel(userAiConfigSchema.parse(validConfig), {
        requiresMultimodalModel: true,
      }),
    ).toThrow("尚未配置支持图片输入的多模态模型");
  });

  it("reports visual capability only for model names accepted by model selection", () => {
    const config = userAiConfigSchema.parse(validConfig);
    const acceptedModel = "v".repeat(160);
    const rejectedModel = "v".repeat(161);

    expect(
      isServerMultimodalAiConfigured({
        ...config,
        multimodalModel: acceptedModel,
      }),
    ).toBe(true);
    expect(
      getConfiguredAiModel(
        { ...config, multimodalModel: acceptedModel },
        { requiresMultimodalModel: true },
      ).modelId,
    ).toBe(`server-openai-compatible/${acceptedModel}`);

    expect(
      isServerMultimodalAiConfigured({
        ...config,
        multimodalModel: rejectedModel,
      }),
    ).toBe(false);
    expect(() =>
      getConfiguredAiModel(
        { ...config, multimodalModel: rejectedModel },
        { requiresMultimodalModel: true },
      ),
    ).toThrow("服务端 AI 配置无效");
  });
});
