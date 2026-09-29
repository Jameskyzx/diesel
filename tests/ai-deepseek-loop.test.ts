import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";

import { getConfiguredAiModel } from "@/server/ai/model";
import { createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";

const priorMode = process.env.DATABASE_MODE;
beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  await getDemoDatabase();
}, 15_000);
afterAll(() => {
  if (priorMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = priorMode;
});
afterEach(() => vi.unstubAllGlobals());

it("uses the real production loop to gather both required tools sequentially before the final answer", async () => {
  const bodies: unknown[] = [];
  const rejections: string[] = [];
  const streamErrors: unknown[] = [];
  const argumentsByTool = {
    compareRegulations: { applicationScope: "non-road", asOf: "2026-08-13", countryIso3s: ["CHN"], powerKw: 100 },
    findCompatibleProducts: { applicationScope: "non-road", asOf: "2026-08-13", countryIso3: "CHN", powerKw: 100, productModelCode: "DEMO-ENG-100" },
  };
  const fetchStub: typeof fetch = async (_url, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    bodies.push(body);
    const selected = z.object({
      tool_choice: z.union([z.literal("none"), z.object({ type: z.literal("function"), function: z.object({ name: z.enum(["compareRegulations", "findCompatibleProducts"]) }) })]).optional(),
      tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional(),
    }).parse(body);
    const name = typeof selected.tool_choice === "object" ? selected.tool_choice.function.name : null;
    if (name) expect(selected.tools?.map(t => t.function.name)).toEqual([name]);
    else expect(selected.tools).toBeUndefined();
    const chunk = (delta: unknown, finishReason: string | null, usage?: unknown) => `data: ${JSON.stringify({
      id: `test-${bodies.length}`, object: "chat.completion.chunk", created: 0, model: "deepseek-flash",
      choices: [{ index: 0, delta, finish_reason: finishReason }], ...(usage ? { usage } : {}),
    })}`;
    return new Response([
      chunk(name ? { role: "assistant", tool_calls: [{ index: 0, id: `call-${bodies.length}`, type: "function", function: { name, arguments: JSON.stringify(argumentsByTool[name]) } }] }
        : { role: "assistant", content: "法规要求已核对，DEMO-ENG-100 判定为适配；这是虚构演示，不代表真实库存。信息参考，不替代正式认证或法律意见。" }, null),
      chunk({}, name ? "tool_calls" : "stop", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
      "data: [DONE]", "",
    ].join("\n\n"), { headers: { "content-type": "text/event-stream" } });
  };
  vi.stubGlobal("fetch", vi.fn(fetchStub));
  const { model } = getConfiguredAiModel({
    apiKey: "unit-test-key", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", enableThinking: false, includeUsage: true,
  });
  const auditRepository = { recordToolCall: async () => undefined };
  const sessionId = crypto.randomUUID();
  const tools = createSalesChatTools({ auditRepository, selectedCountryIso3: null, sessionId, defaultAsOf: "2026-08-13" });
  const question = "同时核对 CHN non-road 100 kW 在 2026-08-13 的法规，并判断 DEMO-ENG-100 是否适配。";
  const generated = streamSalesChat({
    auditRepository, selectedCountryIso3: null, sessionId, tools, model, locale: "zh-CN", maxRetries: 0,
    messages: [{ role: "user", content: question }], trustedUserTexts: [question],
    onBoundaryRejection: reason => rejections.push(reason),
    onStreamError: error => streamErrors.push(error),
  });
  const text = await Promise.resolve(generated.text).catch(() => undefined);
  expect(streamErrors).toEqual([]);
  expect(text).toContain("判定为适配");
  expect((await generated.toolCalls).map(call => call.toolName)).toEqual(["findCompatibleProducts", "compareRegulations"]);
  expect((await generated.steps).length).toBe(3);
  expect(rejections).toEqual([]);
  expect(bodies).toHaveLength(3);
  expect(bodies[0]).toMatchObject({ tool_choice: { function: { name: "findCompatibleProducts" } } });
  expect(bodies[1]).toMatchObject({ tool_choice: { function: { name: "compareRegulations" } } });
  // With no active tools the SDK omits both fields (API default: no tools).
  expect(bodies[2]).not.toHaveProperty("tools");
  expect(bodies[2]).not.toHaveProperty("tool_choice");
});
