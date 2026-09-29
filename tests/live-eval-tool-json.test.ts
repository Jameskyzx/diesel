import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createSalesChatTools } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";
import { aiToolResultSchema } from "@/features/ai/schemas";
import { projectLiveEvalToolJson, liveEvalObservedToolResultSchema } from "../scripts/ai/live-eval-observations";

describe("lossless JSON tool observations", () => {
  it("omits only undefined object fields without changing the original or JSON bytes", () => {
    const original = { citations: [{ title: "source", titleDescriptor: undefined }], query: { metricCodes: undefined }, values: [null, 0, false, ""] };
    const projected = projectLiveEvalToolJson(original);
    expect(projected).toEqual({ citations: [{ title: "source" }], query: {}, values: [null, 0, false, ""] });
    expect(JSON.stringify(projected)).toBe(JSON.stringify(original));
    expect(Object.hasOwn(original.query, "metricCodes")).toBe(true);
    expect(z.json().safeParse(projected).success).toBe(true);
  });

  it.each([
    ["root undefined", undefined], ["array undefined", [undefined]],
    ["sparse array", Array(2)], ["NaN", { value: NaN }],
    ["infinity", { value: Infinity }], ["bigint", { value: BigInt(1) }],
    ["function", { value: () => 1 }], ["symbol", { value: Symbol("private") }],
    ["Date", { value: new Date("2026-01-01") }], ["Map", new Map()],
    ["hidden property", Object.defineProperty({}, "value", { value: 1 })],
    ["symbol key", { [Symbol("private")]: 1 }],
    ["extra array property", Object.assign([1], { hidden: 2 })],
  ])("rejects %s rather than silently coercing or dropping it", (_label, value) => {
    expect(() => projectLiveEvalToolJson(value)).toThrow("bounded JSON data");
  });

  it("does not execute getters or toJSON hooks", () => {
    const getter = vi.fn(() => "PRIVATE_MARKER");
    const hook = vi.fn(() => null);
    expect(() => projectLiveEvalToolJson(Object.defineProperty({}, "value", { enumerable: true, get: getter }))).toThrow();
    expect(() => projectLiveEvalToolJson({ toJSON: hook })).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
  });

  it("rejects cycles and bounded-work overflows but allows repeated plain references", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => projectLiveEvalToolJson(cycle)).toThrow();
    let deep: unknown = null;
    for (let index = 0; index < 66; index += 1) deep = { nested: deep };
    expect(() => projectLiveEvalToolJson(deep)).toThrow();
    expect(() => projectLiveEvalToolJson(Array(100_001).fill(null))).toThrow();
    const shared = { value: 1 };
    expect(projectLiveEvalToolJson([shared, shared])).toEqual([{ value: 1 }, { value: 1 }]);
  });

  it("preserves literal prototype-shaped keys without modifying prototypes", () => {
    const value: unknown = JSON.parse('{"__proto__":{"isInjected":true},"constructor":0}');
    const projected = projectLiveEvalToolJson(value);
    expect(JSON.stringify(projected)).toBe(JSON.stringify(value));
    expect(Object.prototype).not.toHaveProperty("isInjected");
  });
});

describe("real demo tool results cross the observation JSON boundary", () => {
  const previousMode = process.env.DATABASE_MODE;
  beforeAll(async () => {
    process.env.DATABASE_MODE = "pglite-demo";
    await getDemoDatabase();
  }, 15_000);
  afterAll(() => {
    if (previousMode === undefined) delete process.env.DATABASE_MODE;
    else process.env.DATABASE_MODE = previousMode;
  });

  it.each(["compareRegulations", "calculateOpportunityScore", "generateSalesBrief"] as const)(
    "retains %s citation and query semantics after optional-field omission", async (toolName) => {
      const tools = createSalesChatTools({
        auditRepository: { recordToolCall: async () => undefined },
        selectedCountryIso3: null, sessionId: crypto.randomUUID(),
      });
      const input = { applicationScope: "non-road" as const, asOf: "2026-08-13", countryIso3s: ["CHN", "BRA"], powerKw: 100 };
      const options = { toolCallId: "offline-observation", messages: [], context: undefined as never };
      const output = toolName === "compareRegulations"
        ? await tools.compareRegulations.execute!(input, options)
        : toolName === "calculateOpportunityScore"
          ? await tools.calculateOpportunityScore.execute!(input, options)
          : await tools.generateSalesBrief.execute!({ ...input, targetCountryIso3: "CHN" }, options);
      expect(z.json().safeParse(output).success).toBe(false);
      const normalized = projectLiveEvalToolJson(output);
      expect(JSON.stringify(normalized)).toBe(JSON.stringify(output));
      expect(aiToolResultSchema.parse(normalized)).toEqual(aiToolResultSchema.parse(JSON.parse(JSON.stringify(output))));
      expect(liveEvalObservedToolResultSchema.safeParse({ output: normalized, toolCallId: "offline-observation", toolName }).success).toBe(true);
    },
  );
});
