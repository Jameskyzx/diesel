import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { scoreLiveEval } from "@/domain/ai/live-eval";
import { liveEvalReportSchema } from "../scripts/portfolio/live-eval-report-schema";
import { VerificationIssues } from "../scripts/portfolio/verification-issues";
import { buildSyntheticLiveEvalReport } from "./helpers/live-eval-report-fixture";

const legacyV3ReportPath = resolve(
  process.cwd(),
  "docs/evals/archive/ai-live-eval-20260829T214221987Z-cb2fd67b-230f-4f78-a062-fcdbf4c1c54e.json",
);
const historicalV6ReportPath = resolve(
  process.cwd(),
  "docs/evals/archive/ai-live-eval-20260831T050121542Z-0c493bf0-6d16-4051-b710-45a046ddafe5.json",
);

async function readLegacyV3Report(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(legacyV3ReportPath, "utf8")) as Record<
    string,
    unknown
  >;
}

describe("portfolio versioned live-eval report schema", () => {
  it("retains the historical honest v6 initialization-failure schema", async () => {
    const report = JSON.parse(
      await readFile(historicalV6ReportPath, "utf8"),
    ) as Record<string, unknown>;

    const parsed = liveEvalReportSchema.parse(report);
    expect(parsed.version).toBe("sales-chat-live-v6");
    if (parsed.version !== "sales-chat-live-v6") {
      throw new Error("Expected the current report to use the v6 schema.");
    }
    expect(parsed.results).toEqual([]);
    expect(parsed.budget.maxRetriesPerModelCall).toBe(0);
    expect(parsed.runError).toEqual({
      code: "INITIALIZATION_ERROR",
      errorName: "AiConfigurationError",
      stage: "model_configuration",
    });
    expect(parsed.provenance.providerProfile).toBeNull();
  });

  it("parses the archived v3 observation without inventing v4 attempt counts", async () => {
    const report = await readLegacyV3Report();

    expect(liveEvalReportSchema.safeParse(report).success).toBe(true);
    expect(report.version).toBe("sales-chat-live-v3");
    expect(report).not.toHaveProperty("budget.attemptCount");
    expect(report).not.toHaveProperty("results.0.attemptCount");

    const v3WithCurrentPrompt = structuredClone(report);
    Object.assign(v3WithCurrentPrompt.provenance as Record<string, unknown>, {
      promptVersion: "sales-chat-system-v6",
    });
    expect(liveEvalReportSchema.safeParse(v3WithCurrentPrompt).success).toBe(
      false,
    );

    const v4WithoutCounts = structuredClone(report);
    v4WithoutCounts.version = "sales-chat-live-v4";
    expect(liveEvalReportSchema.safeParse(v4WithoutCounts).success).toBe(false);
  });

  it("keeps attempt fields version-specific and accepts a strict v4 failure row", async () => {
    const report = await readLegacyV3Report();
    const v4Report = structuredClone(report);
    v4Report.version = "sales-chat-live-v4";
    Object.assign(v4Report.budget as Record<string, unknown>, {
      attemptCount: 1,
      completedCount: 0,
    });
    Object.assign(
      (v4Report.results as Array<Record<string, unknown>>)[0],
      { attemptCount: 1, completedCount: 0, locale: "en" },
    );

    expect(liveEvalReportSchema.safeParse(v4Report).success).toBe(true);
    const v3WithCounts = structuredClone(v4Report);
    v3WithCounts.version = "sales-chat-live-v3";
    expect(liveEvalReportSchema.safeParse(v3WithCounts).success).toBe(false);
  });

  it("requires v5 response-contract observations while retaining strict v4 parsing", async () => {
    const report = await readLegacyV3Report();
    const v5Report = structuredClone(report);
    v5Report.version = "sales-chat-live-v5";
    Object.assign(v5Report.provenance as Record<string, unknown>, {
      providerProfile: {
        adapter: "@ai-sdk/openai-compatible",
        adapterContractVersion: 1,
        enableThinking: false,
        endpointSha256: "a".repeat(64),
        includeUsage: true,
      },
    });
    Object.assign(v5Report.budget as Record<string, unknown>, {
      attemptCount: 1,
      completedCount: 0,
    });
    Object.assign(v5Report.scores as Record<string, unknown>, {
      responseGroundingAccuracyPct: 0,
      responseLocaleAccuracyPct: 0,
    });
    Object.assign(v5Report.thresholds as Record<string, unknown>, {
      responseGroundingAccuracyPct: 100,
      responseLocaleAccuracyPct: 100,
    });
    Object.assign(
      (v5Report.results as Array<Record<string, unknown>>)[0],
      {
        attemptCount: 1,
        completedCount: 0,
        detectedResponseLocale: "indeterminate",
        locale: "en",
        matchedResponseAnchorIds: [],
        missingResponseAnchorIds: ["fact:country-chn"],
        responseGroundingPassed: false,
        responseLocalePassed: false,
      },
    );

    const parsedV5 = liveEvalReportSchema.parse(v5Report);
    expect(parsedV5.version).toBe("sales-chat-live-v5");
    if (parsedV5.version !== "sales-chat-live-v5") {
      throw new Error("Expected a v5 live-eval report fixture.");
    }
    expect(parsedV5.scores).toEqual(scoreLiveEval(parsedV5.results));
    const v5WithCurrentPrompt = structuredClone(v5Report);
    Object.assign(v5WithCurrentPrompt.provenance as Record<string, unknown>, {
      promptVersion: "sales-chat-system-v6",
    });
    expect(liveEvalReportSchema.safeParse(v5WithCurrentPrompt).success).toBe(
      true,
    );
    const v5WithoutProviderProfile = structuredClone(v5Report);
    Reflect.deleteProperty(
      v5WithoutProviderProfile.provenance as Record<string, unknown>,
      "providerProfile",
    );
    expect(
      liveEvalReportSchema.safeParse(v5WithoutProviderProfile).success,
    ).toBe(false);
    const v5WithRawEndpoint = structuredClone(v5Report);
    Object.assign(
      (v5WithRawEndpoint.provenance as Record<string, unknown>)
        .providerProfile as Record<string, unknown>,
      { endpointSha256: "https://private-provider.example/v1" },
    );
    expect(liveEvalReportSchema.safeParse(v5WithRawEndpoint).success).toBe(
      false,
    );
    const v4WithV5Observations = structuredClone(v5Report);
    v4WithV5Observations.version = "sales-chat-live-v4";
    expect(liveEvalReportSchema.safeParse(v4WithV5Observations).success).toBe(
      false,
    );

    const v6Report = structuredClone(v5Report);
    v6Report.version = "sales-chat-live-v6";
    Object.assign(v6Report.budget as Record<string, unknown>, {
      maxRetriesPerModelCall: 0,
    });
    expect(liveEvalReportSchema.safeParse(v6Report).success).toBe(true);
    const v6WithoutRetryBudget = structuredClone(v6Report);
    Reflect.deleteProperty(
      v6WithoutRetryBudget.budget as Record<string, unknown>,
      "maxRetriesPerModelCall",
    );
    expect(
      liveEvalReportSchema.safeParse(v6WithoutRetryBudget).success,
    ).toBe(false);
    const v5WithV6RetryBudget = structuredClone(v6Report);
    v5WithV6RetryBudget.version = "sales-chat-live-v5";
    expect(liveEvalReportSchema.safeParse(v5WithV6RetryBudget).success).toBe(
      false,
    );

    const v7Report = structuredClone(v6Report);
    v7Report.version = "sales-chat-live-v7";
    Object.assign(v7Report.budget as Record<string, unknown>, {
      maxOutputTokensPerCall: 1_024,
      maxPotentialOutputTokens: 18 * 5 * 1_024,
      tokenBudgetEnforcement: "post_usage_acceptance",
    });
    expect(liveEvalReportSchema.safeParse(v7Report).success).toBe(true);
    const v8Report = structuredClone(v7Report);
    v8Report.version = "sales-chat-live-v8";
    expect(liveEvalReportSchema.safeParse(v8Report).success).toBe(true);
    const v9Report = structuredClone(v8Report);
    v9Report.version = "sales-chat-live-v9";
    expect(liveEvalReportSchema.safeParse(v9Report).success).toBe(true);
    const v9WithRawQuery = structuredClone(v9Report);
    Object.assign(
      (v9WithRawQuery.results as Array<Record<string, unknown>>)[0],
      {
        normalizedArgs: [
          {
            args: {
              countryIso3: "CHN",
              query: "PRIVATE-LIVE-EVAL-QUERY",
            },
            tool: "searchKnowledgeBase",
          },
        ],
      },
    );
    expect(liveEvalReportSchema.safeParse(v9WithRawQuery).success).toBe(false);
    const v10Report = structuredClone(v9Report);
    v10Report.version = "sales-chat-live-v10";
    expect(liveEvalReportSchema.safeParse(v10Report).success).toBe(true);
    const v10WithRawQuery = structuredClone(v10Report);
    Object.assign(
      (v10WithRawQuery.results as Array<Record<string, unknown>>)[0],
      {
        normalizedArgs: [
          {
            args: {
              countryIso3: "CHN",
              query: "PRIVATE-LIVE-EVAL-QUERY",
            },
            tool: "searchKnowledgeBase",
          },
        ],
      },
    );
    expect(liveEvalReportSchema.safeParse(v10WithRawQuery).success).toBe(false);
    for (const field of [
      "maxOutputTokensPerCall",
      "maxPotentialOutputTokens",
      "tokenBudgetEnforcement",
    ] as const) {
      const v7WithoutBudgetField = structuredClone(v7Report);
      Reflect.deleteProperty(
        v7WithoutBudgetField.budget as Record<string, unknown>,
        field,
      );
      expect(
        liveEvalReportSchema.safeParse(v7WithoutBudgetField).success,
      ).toBe(false);
    }
    const v7WithZeroPerCallBudget = structuredClone(v7Report);
    Object.assign(
      v7WithZeroPerCallBudget.budget as Record<string, unknown>,
      { maxOutputTokensPerCall: 0 },
    );
    expect(
      liveEvalReportSchema.safeParse(v7WithZeroPerCallBudget).success,
    ).toBe(false);
    const v7WithWrongEnforcement = structuredClone(v7Report);
    Object.assign(
      v7WithWrongEnforcement.budget as Record<string, unknown>,
      { tokenBudgetEnforcement: "preflight_reservation" },
    );
    expect(
      liveEvalReportSchema.safeParse(v7WithWrongEnforcement).success,
    ).toBe(false);
    const v6WithV7Budget = structuredClone(v7Report);
    v6WithV7Budget.version = "sales-chat-live-v6";
    expect(liveEvalReportSchema.safeParse(v6WithV7Budget).success).toBe(false);

    const v7WithTokenLimitTermination = structuredClone(v7Report);
    v7WithTokenLimitTermination.terminationReason = "token_limit_exceeded";
    expect(
      liveEvalReportSchema.safeParse(v7WithTokenLimitTermination).success,
    ).toBe(true);
    const v6WithTokenLimitTermination = structuredClone(v6Report);
    v6WithTokenLimitTermination.terminationReason = "token_limit_exceeded";
    expect(
      liveEvalReportSchema.safeParse(v6WithTokenLimitTermination).success,
    ).toBe(false);

  });

  it("reports independent preflight drift together instead of hiding later failures", () => {
    const issues = new VerificationIssues();
    issues.equal(
      "sales-chat-live-v3",
      "sales-chat-live-v12",
      "Live eval case/report version",
    );
    issues.equal(
      { digest: "old", fileCount: 182 },
      { digest: "current", fileCount: 186 },
      "Live eval evaluated-source fingerprint",
    );

    expect(issues.list()).toHaveLength(2);
    expect(() => issues.throwIfAny("Live eval preflight")).toThrowError(
      /Live eval preflight found 2 issues:[\s\S]*case\/report version[\s\S]*source fingerprint/u,
    );
  });

  it("requires the v14 clock without rewriting historical v11/v12/v13 rows", () => {
    const current = buildSyntheticLiveEvalReport({
      commit: "a".repeat(40),
      fingerprintDigest: "b".repeat(64),
      fingerprintFileCount: 1,
    });
    expect(liveEvalReportSchema.safeParse(current).success).toBe(true);
    expect(current.version).toBe("sales-chat-live-v25");
    expect(liveEvalReportSchema.safeParse({ ...current, version: "sales-chat-live-v20" }).success).toBe(true);
    expect(liveEvalReportSchema.safeParse({ ...current, version: "sales-chat-live-v21" }).success).toBe(true);
    expect(liveEvalReportSchema.safeParse({ ...current, version: "sales-chat-live-v22" }).success).toBe(true);
    expect(liveEvalReportSchema.safeParse({ ...current, version: "sales-chat-live-v23" }).success).toBe(true);
    expect(liveEvalReportSchema.safeParse({ ...current, version: "sales-chat-live-v24" }).success).toBe(true);
    expect(liveEvalReportSchema.safeParse({ ...current, version: "sales-chat-live-v26" }).success).toBe(false);
    const historicalClockResults = current.results.map((result) => {
      const legacy = { ...result };
      Reflect.deleteProperty(legacy, "toolTraceStatus");
      return legacy;
    });
    for (const version of ["sales-chat-live-v20", "sales-chat-live-v21", "sales-chat-live-v22", "sales-chat-live-v23", "sales-chat-live-v24", "sales-chat-live-v25"]) {
      expect(liveEvalReportSchema.safeParse({ ...current, results: historicalClockResults, version }).success).toBe(false);
    }
    // Historical rows never acquire v20's trace availability interpretation.
    for (const version of ["sales-chat-live-v16", "sales-chat-live-v17", "sales-chat-live-v18", "sales-chat-live-v19"]) {
      expect(liveEvalReportSchema.safeParse({ ...current, results: historicalClockResults, version }).success).toBe(true);
      expect(liveEvalReportSchema.safeParse({ ...current, version }).success).toBe(false);
    }

    const historicalResults = historicalClockResults.map((result) => {
      const legacy = { ...result };
      Reflect.deleteProperty(legacy, "runtimeContext");
      return legacy;
    });
    const historicalV12 = { ...current, results: historicalResults, version: "sales-chat-live-v12" };
    expect(liveEvalReportSchema.safeParse(historicalV12).success).toBe(true);
    expect(liveEvalReportSchema.safeParse({
      ...historicalV12, version: "sales-chat-live-v13",
    }).success).toBe(true);
    expect(liveEvalReportSchema.safeParse({
      ...historicalV12, version: "sales-chat-live-v14",
    }).success).toBe(false);

    const historicalV11 = structuredClone(historicalV12) as Record<string, unknown>;
    historicalV11.version = "sales-chat-live-v11";
    expect(liveEvalReportSchema.safeParse(historicalV11).success).toBe(true);

    const withoutSummary = structuredClone(current) as Record<string, unknown>;
    Reflect.deleteProperty(withoutSummary, "observability");
    expect(liveEvalReportSchema.safeParse(withoutSummary).success).toBe(false);

    const mislabeledHistorical = structuredClone(current) as Record<
      string,
      unknown
    >;
    mislabeledHistorical.version = "sales-chat-live-v10";
    expect(liveEvalReportSchema.safeParse(mislabeledHistorical).success).toBe(
      false,
    );
  });
});
