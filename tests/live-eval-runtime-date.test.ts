import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import {
  matchesExpectedLiveEvalReportArgs,
  sanitizeLiveEvalReportArgs,
} from "../scripts/ai/live-eval-report-args";
import { buildSalesChatEvidenceContract } from "@/server/ai/evidence-contract";
import { buildSalesChatInstructions, createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";
import { countryDetailResponseSchema } from "@/features/countries/schemas";

const runtimeContext = {
  capturedAt: "2026-09-06T23:59:59.900Z",
  utcDate: "2026-09-06",
} as const;
const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
} as const;

function countryProfileModel(input: Readonly<Record<string, unknown>>) {
  return new MockLanguageModelV3({
    modelId: "omitted-date-regression",
    provider: "mock",
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              input: JSON.stringify(input),
              toolCallId: "omitted-date",
              toolName: "getCountryProfile",
              type: "tool-call",
            },
            { finishReason: { raw: undefined, unified: "tool-calls" }, type: "finish", usage },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { id: "answer", type: "text-start" },
            { delta: "There is not enough evidence for this country profile.", id: "answer", type: "text-delta" },
            { id: "answer", type: "text-end" },
            { finishReason: { raw: undefined, unified: "stop" }, type: "finish", usage },
          ],
        }),
      },
    ],
  });
}

beforeEach(() => {
  // Only freeze Date: the real SDK stream and timer scheduling still execute.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(runtimeContext.capturedAt));
});
afterEach(() => vi.useRealTimers());

describe("live eval scores the production default date, not raw provider keys", () => {
  it.each([
    "single-country-market-profile",
    "explicit-country-overrides-map",
    "market-no-data-fails-closed",
  ])("accepts the application-added date for %s", async (caseId) => {
    const testCase = salesChatLiveCases.find(({ id }) => id === caseId);
    if (!testCase) throw new Error("Missing canonical live case");
    const providerInput = testCase.expectedArgs.getCountryProfile;
    if (!providerInput) throw new Error("Expected a country-profile case");
    expect(providerInput).not.toHaveProperty("asOf");
    const contract = buildSalesChatEvidenceContract({
      runtimeContext,
      selectedCountryIso3: testCase.selectedCountryIso3,
      userTexts: testCase.userTexts,
    });
    const auditRepository = { recordToolCall: async () => undefined };
    const getCountryDetails = vi.fn(async () => countryDetailResponseSchema.parse({
      iso3: providerInput.countryIso3,
      status: "no_data",
    }));
    const sessionId = "00000000-0000-4000-8000-000000000939";
    const tools = createSalesChatTools({
      auditRepository,
      defaultAsOf: contract.asOf ?? undefined,
      runtimeContext,
      selectedCountryIso3: testCase.selectedCountryIso3,
      services: { getCountryDetails },
      sessionId,
    });
    // Simulate a turn which enters the provider loop after UTC midnight.
    vi.setSystemTime(new Date("2026-09-07T00:00:00.100Z"));
    const model = countryProfileModel(providerInput);
    const generated = streamSalesChat({
      auditRepository,
      locale: testCase.locale,
      messages: testCase.userTexts.map((content) => ({ content, role: "user" as const })),
      model,
      runtimeContext,
      selectedCountryIso3: testCase.selectedCountryIso3,
      sessionId,
      tools,
      trustedUserTexts: testCase.userTexts,
    });
    const [, calls] = await Promise.all([generated.text, generated.toolCalls]);
    expect(model.doStreamCalls[0]?.prompt).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "system", content: expect.stringContaining(runtimeContext.utcDate) }),
    ]));
    const call = calls.find(({ toolName }) => toolName === "getCountryProfile");
    expect(call?.input).toEqual({ ...providerInput, asOf: runtimeContext.utcDate });
    const args = sanitizeLiveEvalReportArgs({ args: call?.input, tool: "getCountryProfile" });
    const evaluation = {
      actual: args,
      expected: providerInput,
      runtimeContext,
      tool: "getCountryProfile" as const,
    };
    expect(matchesExpectedLiveEvalReportArgs(evaluation)).toBe(true);
    expect(getCountryDetails).toHaveBeenCalledWith(
      { asOf: runtimeContext.utcDate, iso3: providerInput.countryIso3 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each(["2026-09-05", "2026-09-07", "2031-01-01"])(
    "still rejects the wrong default date %s", (asOf) => {
      const evaluation = {
        actual: { asOf, countryIso3: "CHN", topics: ["country"] },
        expected: { countryIso3: "CHN", topics: ["country"] },
        runtimeContext,
        tool: "getCountryProfile" as const,
      };
      expect(matchesExpectedLiveEvalReportArgs(evaluation)).toBe(false);
    },
  );

  it("requires the default in the post-schema observation", () => {
    const expected = { countryIso3: "CHN", topics: ["country"] };
    const evaluation = { actual: expected, expected, runtimeContext, tool: "getCountryProfile" as const };
    expect(matchesExpectedLiveEvalReportArgs(evaluation)).toBe(false);
  });

  it("retains the historical exact-key result when no v14 runtime context exists", () => {
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { asOf: runtimeContext.utcDate, countryIso3: "CHN", topics: ["country"] },
      expected: { countryIso3: "CHN", topics: ["country"] },
      tool: "getCountryProfile",
    })).toBe(false);
  });

  it("keeps an explicit user date instead of replacing it with the runtime date", () => {
    const expected = { asOf: "2026-08-13", countryIso3: "CHN", topics: ["country"] };
    expect(matchesExpectedLiveEvalReportArgs({
      actual: expected, expected, runtimeContext, tool: "getCountryProfile",
    })).toBe(true);
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { ...expected, asOf: runtimeContext.utcDate }, expected, runtimeContext, tool: "getCountryProfile",
    })).toBe(false);
  });

  it("replays the captured date after the current clock crosses UTC midnight", () => {
    vi.setSystemTime(new Date("2026-09-07T00:00:00.100Z"));
    const expected = { countryIso3: "CHN", topics: ["country"] };
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { ...expected, asOf: runtimeContext.utcDate }, expected, runtimeContext, tool: "getCountryProfile",
    })).toBe(true);
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { ...expected, asOf: "2026-09-07" }, expected, runtimeContext, tool: "getCountryProfile",
    })).toBe(false);
  });

  it("does not permit another undeclared field when accepting the runtime date", () => {
    const expected = { countryIso3: "CHN", topics: ["country"] };
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { ...expected, asOf: runtimeContext.utcDate, applicationScope: "non-road" },
      expected, runtimeContext, tool: "getCountryProfile",
    })).toBe(false);
  });

  it("rejects an inconsistent runtime clock rather than trusting its date", () => {
    const expected = { countryIso3: "CHN", topics: ["country"] };
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { ...expected, asOf: "2026-09-07" }, expected,
      runtimeContext: { ...runtimeContext, utcDate: "2026-09-07" }, tool: "getCountryProfile",
    })).toBe(false);
  });

  it.each(["en", "zh-CN"] as const)("keeps the %s prompt and evidence contract on the captured UTC day", (locale) => {
    vi.setSystemTime(new Date("2026-09-07T00:00:00.100Z"));
    const prompt = buildSalesChatInstructions(null, locale, runtimeContext);
    expect(prompt).toContain(runtimeContext.utcDate);
    expect(prompt).not.toContain("2026-09-07");
    expect(buildSalesChatEvidenceContract({
      runtimeContext, selectedCountryIso3: null, userTexts: ["China country profile"],
    }).asOf).toBe(runtimeContext.utcDate);
    expect(buildSalesChatEvidenceContract({
      runtimeContext, selectedCountryIso3: null, userTexts: ["China country profile as of 2026-08-13"],
    }).asOf).toBe("2026-08-13");
  });
});
