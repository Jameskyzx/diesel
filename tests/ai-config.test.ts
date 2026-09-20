import { streamText } from "ai";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { userAiConfigSchema } from "@/features/ai/schemas";
import {
  AiConfigurationError,
  getConfiguredAiModel,
  isServerMultimodalAiConfigured,
  parseConfiguredModelCostProfile,
} from "@/server/ai/model";

const validConfig = {
  apiKey: "user-secret-key",
  baseUrl: "https://api.example.com/v1/",
  model: "gpt-4o-mini",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

async function captureStreamingRequestBody(
  options: {
    costProfile?: unknown;
    enableThinking?: boolean;
    includeUsage: boolean;
  },
) {
  let requestBody: unknown;
  const fetchStub: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      [
        'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":0,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}',
        'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":0,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
      {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      },
    );
  };
  vi.stubGlobal("fetch", vi.fn(fetchStub));

  const result = streamText({
    model: getConfiguredAiModel({
      ...userAiConfigSchema.parse({
        ...validConfig,
        enableThinking: options.enableThinking,
      }),
      costProfile: options.costProfile,
      includeUsage: options.includeUsage,
    }).model,
    prompt: "usage request contract",
  });
  await result.text;

  return requestBody;
}

describe("server AI configuration", () => {
  it("normalizes an OpenAI-compatible endpoint and creates a request model", () => {
    const config = userAiConfigSchema.parse(validConfig);
    const configured = getConfiguredAiModel(config);

    expect(config.baseUrl).toBe("https://api.example.com/v1");
    expect(configured.modelId).toBe("server-openai-compatible/gpt-4o-mini");
    expect(configured.providerProfile).toEqual({
      adapter: "@ai-sdk/openai-compatible",
      adapterContractVersion: 1,
      enableThinking: null,
      endpointSha256: createHash("sha256")
        .update("https://api.example.com/v1", "utf8")
        .digest("hex"),
      includeUsage: false,
    });
    expect(JSON.stringify(configured.providerProfile)).not.toContain(
      "api.example.com",
    );
    expect(JSON.stringify(configured.providerProfile)).not.toContain(
      validConfig.apiKey,
    );
    expect(configured.model).toBeDefined();
  });

  it("distinguishes endpoint and transport flags without persisting secrets", () => {
    const first = getConfiguredAiModel({
      ...userAiConfigSchema.parse(validConfig),
      enableThinking: true,
      includeUsage: true,
    }).providerProfile;
    const second = getConfiguredAiModel({
      ...userAiConfigSchema.parse({
        ...validConfig,
        baseUrl: "https://other.example.com/compatible/v1",
      }),
      enableThinking: false,
      includeUsage: false,
    }).providerProfile;

    expect(first.endpointSha256).not.toBe(second.endpointSha256);
    expect(first).toMatchObject({ enableThinking: true, includeUsage: true });
    expect(second).toMatchObject({ enableThinking: false, includeUsage: false });
    expect(JSON.stringify([first, second])).not.toMatch(
      /user-secret-key|api\.example\.com|other\.example\.com/u,
    );
  });

  it("requests streaming usage only behind the explicit compatibility opt-in", async () => {
    const optedInBody = await captureStreamingRequestBody({
      costProfile: {
        privateRateMarker: "must-not-reach-provider",
      },
      includeUsage: true,
    });
    expect(optedInBody).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(JSON.stringify(optedInBody)).not.toMatch(
      /cache_control|cache_ttl|enable_caching|prompt_cache_key|prompt_cache_retention/u,
    );
    expect(JSON.stringify(optedInBody)).not.toContain(
      "must-not-reach-provider",
    );
    await expect(
      captureStreamingRequestBody({ includeUsage: false }),
    ).resolves.not.toHaveProperty("stream_options");
  });

  it.each([
    { enableThinking: undefined, label: "omitted" },
    { enableThinking: false, label: "disabled" },
    { enableThinking: true, label: "enabled" },
  ] as const)(
    "keeps provider thinking $label without requesting public reasoning",
    async ({ enableThinking }) => {
      const requestBody = await captureStreamingRequestBody({
        enableThinking,
        includeUsage: false,
      });

      if (enableThinking === undefined) {
        expect(requestBody).not.toHaveProperty("enable_thinking");
      } else {
        expect(requestBody).toHaveProperty(
          "enable_thinking",
          enableThinking,
        );
      }
      expect(JSON.stringify(requestBody)).not.toMatch(
        /send_reasoning|include_reasoning|reasoning_effort|reasoning_output/u,
      );
    },
  );

  it.each([
    "http://api.example.com/v1",
    "https://localhost:11434/v1",
    "https://127.0.0.1/v1",
    "https://192.168.1.20/v1",
    "https://user:password@api.example.com/v1",
    "https://api.example.com/v1?api_key=private-value",
    "https://api.example.com/v1#private-value",
  ])("rejects unsafe endpoint %s", (baseUrl) => {
    expect(() => userAiConfigSchema.parse({ ...validConfig, baseUrl })).toThrow();
  });

  it("requires a key and does not put it in the model identity", () => {
    expect(() => userAiConfigSchema.parse({ ...validConfig, apiKey: "" })).toThrow();
    expect(getConfiguredAiModel(userAiConfigSchema.parse(validConfig)).modelId).not.toContain(
      validConfig.apiKey,
    );
  });

  it("rejects an unsafe model name before provider construction", () => {
    expect(() =>
      userAiConfigSchema.parse({ ...validConfig, model: "deepseek v4" }),
    ).toThrow();
    expect(() =>
      getConfiguredAiModel({
        ...userAiConfigSchema.parse(validConfig),
        model: "deepseek v4",
      }),
    ).toThrow(AiConfigurationError);
  });

  it("parses an optional runtime cost profile without retaining malformed text", () => {
    const parsed = parseConfiguredModelCostProfile(
      '{"modelId":"server-openai-compatible/gpt-4o-mini"}',
    );
    const malformed = parseConfiguredModelCostProfile(
      '{"secret":"private-contract-marker"',
    );

    expect(parsed).toEqual({
      modelId: "server-openai-compatible/gpt-4o-mini",
    });
    expect(parseConfiguredModelCostProfile(undefined)).toBeNull();
    expect(JSON.stringify(malformed)).not.toContain("private-contract-marker");
  });

  it("keeps an explicitly supplied cost profile server-side for completion estimates", () => {
    const costProfile = {
      asOf: "2026-08-30",
      modelId: "server-openai-compatible/gpt-4o-mini",
      pricingMode: "flat",
      ratesMicroUsdPerMillionTokens: { input: 1, output: 2 },
      validThrough: "2026-09-30",
      version: "test-profile-v1",
    };

    expect(
      getConfiguredAiModel({
        ...userAiConfigSchema.parse(validConfig),
        costProfile,
      }).costProfile,
    ).toBe(costProfile);
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
