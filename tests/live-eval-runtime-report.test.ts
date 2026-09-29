import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { liveEvalReportSchema } from "../scripts/portfolio/live-eval-report-schema";
import { verifyLiveEvalReportConsistency } from "../scripts/portfolio/verify-live-eval";
import { buildSyntheticLiveEvalReport } from "./helpers/live-eval-report-fixture";

const buildReport = () => buildSyntheticLiveEvalReport({
  commit: "a".repeat(40), fingerprintDigest: "b".repeat(64), fingerprintFileCount: 1,
});
afterEach(() => vi.useRealTimers());

describe("captured-clock report recomputation (v14 onward)", () => {
  it("recomputes a full passing synthetic report after UTC midnight and years later", async () => {
    const report = buildReport();
    expect(report.evaluatedAt.slice(0, 10)).toBe("2026-08-30");
    expect(report.results[0]?.runtimeContext.utcDate).toBe("2026-08-29");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2042-01-01T00:00:00.000Z"));
    await expect(verifyLiveEvalReportConsistency(report)).resolves.toEqual({
      sampleCount: 18, suiteCaseCount: 18, thresholdsPassed: true,
    });
  });

  it("does not score the report completion day as the case's default date", async () => {
    const report = buildReport();
    const result = report.results.find(({ id }) => id === "single-country-market-profile");
    if (!result?.normalizedArgs[0]) throw new Error("Missing canonical profile case");
    result.normalizedArgs[0].args.asOf = "2026-08-30";
    await expect(verifyLiveEvalReportConsistency(report)).rejects.toThrow(/argument judgement/u);
  });

  it("rejects a missing case clock instead of reconstructing one from the current clock", () => {
    const report = buildReport();
    Reflect.deleteProperty(report.results[0]!, "runtimeContext");
    expect(liveEvalReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects a clock whose timestamp and UTC day disagree", () => {
    const report = buildReport();
    report.results[0]!.runtimeContext = {
      ...report.results[0]!.runtimeContext, utcDate: "2026-08-30",
    };
    expect(liveEvalReportSchema.safeParse(report).success).toBe(false);
  });

  it("rejects a case captured after report completion", () => {
    const report = buildReport();
    report.results[0]!.runtimeContext = {
      capturedAt: "2026-08-30T00:00:00.001Z", utcDate: "2026-08-30",
    };
    expect(() => liveEvalReportSchema.parse(report)).toThrow(/no later than report completion/u);
  });

  it("rejects out-of-order case clocks", () => {
    const report = buildReport();
    report.results[1]!.runtimeContext = {
      capturedAt: "2026-08-28T00:00:00.000Z", utcDate: "2026-08-28",
    };
    expect(() => liveEvalReportSchema.parse(report)).toThrow(/ordered/u);
  });

  it.each([
    "sales-chat-live-v14", "sales-chat-live-v15", "sales-chat-live-v16", "sales-chat-live-v17",
    "sales-chat-live-v18", "sales-chat-live-v19", "sales-chat-live-v20", "sales-chat-live-v21", "sales-chat-live-v22", "sales-chat-live-v23", "sales-chat-live-v24",
  ] as const)("keeps a synthetic %s shape readable without treating it as current scoring evidence", async (version) => {
    const input = buildReport();
    const results = input.results.map((result) => {
      const legacy = { ...result };
      if (version !== "sales-chat-live-v20" && version !== "sales-chat-live-v21" && version !== "sales-chat-live-v22" && version !== "sales-chat-live-v23" && version !== "sales-chat-live-v24") {
        Reflect.deleteProperty(legacy, "toolTraceStatus");
      }
      return legacy;
    });
    const historical = liveEvalReportSchema.parse({ ...input, results, version });
    expect(historical.version).toBe(version);
    expect(historical.results[0]).toHaveProperty("runtimeContext.utcDate", "2026-08-29");
    await expect(verifyLiveEvalReportConsistency(historical)).rejects.toThrow(/incompatible report version/u);
  });

  it("keeps the actual v13 archive readable without reinterpreting its scores as current", async () => {
    const text = await readFile(resolve(process.cwd(),
      "docs/evals/archive/ai-live-eval-20260906T142319289Z-0767c185-9dd2-474b-a9b2-f4c898992282.json"), "utf8");
    const report = liveEvalReportSchema.parse(JSON.parse(text) as unknown);
    expect(report.version).toBe("sales-chat-live-v13");
    expect(report.results.every((result) => !Object.hasOwn(result, "runtimeContext"))).toBe(true);
    expect(report.results.filter(({ pass }) => pass)).toHaveLength(6);
    await expect(verifyLiveEvalReportConsistency(report)).rejects.toThrow(/incompatible report version/u);
  });

  it("preserves the actual v21 nested-list false negative without rescoring the historical report", async () => {
    const text = await readFile(resolve(process.cwd(),
      "docs/evals/archive/ai-live-eval-20260913T130615335Z-828326f9-615e-454b-8d80-84c7cda21f41.json"), "utf8");
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(
      "6a4310920a1d87442ee830ff342a868b9800bbcc28eb8b871d5b04952b3f1769",
    );
    const report = liveEvalReportSchema.parse(JSON.parse(text) as unknown);
    expect(report.version).toBe("sales-chat-live-v21");
    expect(report.provenance.promptVersion).toBe("sales-chat-system-v6");
    expect(report.results).toHaveLength(18);
    expect(report.results.filter(({ pass }) => pass)).toHaveLength(13);
    expect(report.results.find(({ id }) => id === "mixed-regulation-and-product-intent")).toMatchObject({
      missingResponseAnchorIds: ["decision:regulation-comparison"],
      pass: false,
      responseGroundingPassed: false,
      toolTraceStatus: "complete",
    });
    expect(report.complete).toBe(true);
    expect(report.thresholdsPassed).toBe(false);
    await expect(verifyLiveEvalReportConsistency(report)).rejects.toThrow(/incompatible report version/u);
  });

  it("preserves the actual failed v22 report byte-for-byte without current rescoring", async () => {
    const text = await readFile(resolve(process.cwd(),
      "docs/evals/archive/ai-live-eval-20260913T142352283Z-e65628f1-14ce-4985-bb21-5b35f733e2c3.json"), "utf8");
    expect(Buffer.byteLength(text, "utf8")).toBe(111_988);
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(
      "01298d2faf914f92fcd4e2300c912002f0c7ab3d5851794e82aa60dfaa2f8a7a",
    );
    const report = liveEvalReportSchema.parse(JSON.parse(text) as unknown);
    expect(report.version).toBe("sales-chat-live-v22");
    expect(report.provenance.promptVersion).toBe("sales-chat-system-v6");
    expect(report.results).toHaveLength(18);
    expect(report.results.filter(({ pass }) => pass)).toHaveLength(14);
    expect(report.budget.totalTokens).toBe(90_407);
    expect(report.results.every((result) => "toolTraceStatus" in result && result.toolTraceStatus === "complete")).toBe(true);
    expect(report.complete).toBe(true);
    expect(report.thresholdsPassed).toBe(false);
    await expect(verifyLiveEvalReportConsistency(report)).rejects.toThrow(/incompatible report version/u);
  });

  it("preserves the actual failed v23 report byte-for-byte without current rescoring", async () => {
    const text = await readFile(resolve(process.cwd(),
      "docs/evals/archive/ai-live-eval-20260913T145816280Z-c436f8a3-5bd9-47af-b011-54e2bae4fad6.json"), "utf8");
    expect(Buffer.byteLength(text, "utf8")).toBe(111_952);
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(
      "f15caf9c836a10e89d063714ecbca53536c71c8d93c1889b589e5b90b0c1d99b",
    );
    const report = liveEvalReportSchema.parse(JSON.parse(text) as unknown);
    expect(report.version).toBe("sales-chat-live-v23");
    expect(report.provenance.promptVersion).toBe("sales-chat-system-v6");
    expect(report.results).toHaveLength(18);
    expect(report.results.filter(({ pass }) => pass)).toHaveLength(16);
    expect(report.budget.totalTokens).toBe(90_231);
    expect(report.results.every((result) => "toolTraceStatus" in result && result.toolTraceStatus === "complete")).toBe(true);
    expect(report.complete).toBe(true);
    expect(report.thresholdsPassed).toBe(false);
    await expect(verifyLiveEvalReportConsistency(report)).rejects.toThrow(/incompatible report version/u);
  });

  it("preserves the actual failed v24 report byte-for-byte without current rescoring", async () => {
    const text = await readFile(resolve(process.cwd(),
      "docs/evals/archive/ai-live-eval-20260913T161301320Z-1a779346-c4b2-42fd-b741-1c957b872fa4.json"), "utf8");
    expect(Buffer.byteLength(text, "utf8")).toBe(108_007);
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(
      "aa1dcb09ad26e73046f30a2e562628b35b299950829fa9f576ba5beb9025e983",
    );
    const report = liveEvalReportSchema.parse(JSON.parse(text) as unknown);
    expect(report.version).toBe("sales-chat-live-v24");
    expect(report.provenance.promptVersion).toBe("sales-chat-system-v6");
    expect(report.results).toHaveLength(18);
    expect(report.results.filter(({ pass }) => pass)).toHaveLength(13);
    expect(report.budget.totalTokens).toBe(88_408);
    expect(report.results.every((result) => "toolTraceStatus" in result && result.toolTraceStatus === "complete")).toBe(true);
    expect(report.results.find(({ id }) => id === "multi-turn-country-conflict")).toMatchObject({
      missingResponseAnchorIds: ["decision:regulation-comparison"],
      pass: false,
      responseGroundingPassed: false,
    });
    expect(report.complete).toBe(true);
    expect(report.thresholdsPassed).toBe(false);
    await expect(verifyLiveEvalReportConsistency(report)).rejects.toThrow(/incompatible report version/u);
  });

  it("keeps the actual failed v17 observation byte-identical and readable without rescoring it", async () => {
    const text = await readFile(resolve(process.cwd(),
      "docs/evals/archive/ai-live-eval-20260913T093752629Z-6b04bbc6-d54a-4baf-a714-bd3179336f46.json"), "utf8");
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(
      "e49142f5d42d6665fa5e8921ccea6166deb21483aa440973805738a84926f700",
    );
    const report = liveEvalReportSchema.parse(JSON.parse(text) as unknown);
    expect(report.version).toBe("sales-chat-live-v17");
    expect(report.provenance.promptVersion).toBe("sales-chat-system-v6");
    expect(report.results).toHaveLength(18);
    expect(report.results.filter(({ pass }) => pass)).toHaveLength(8);
    expect(report.complete).toBe(false);
    expect(report.thresholdsPassed).toBe(false);
    await expect(verifyLiveEvalReportConsistency(report)).rejects.toThrow(/incompatible report version/u);
  });

  it("keeps the actual failed v18 observation byte-identical and readable without rescoring it", async () => {
    const text = await readFile(resolve(process.cwd(),
      "docs/evals/archive/ai-live-eval-20260913T110350026Z-cdedc249-10c4-48bb-aa14-2ebffbbc777c.json"), "utf8");
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(
      "82e092258777db8c0a8f463f35508a18d3faea59bf2573d40ef84fbab969bf00",
    );
    const report = liveEvalReportSchema.parse(JSON.parse(text) as unknown);
    expect(report.version).toBe("sales-chat-live-v18");
    expect(report.provenance.promptVersion).toBe("sales-chat-system-v6");
    expect(report.results).toHaveLength(18);
    expect(report.results.filter(({ pass }) => pass)).toHaveLength(15);
    expect(report.complete).toBe(true);
    expect(report.thresholdsPassed).toBe(false);
    await expect(verifyLiveEvalReportConsistency(report)).rejects.toThrow(/incompatible report version/u);
  });

  it("preserves the original v19 timeout-report inconsistency as historical evidence", async () => {
    const text = await readFile(resolve(process.cwd(),
      "docs/evals/archive/ai-live-eval-20260913T112357083Z-4ee46fb7-ad6b-444a-9159-49605d88224d.json"), "utf8");
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(
      "bc80a52bea42e367600e2eb2494a5a834a2f01dbbba2efd8b690f95522af0a1f",
    );
    const report = liveEvalReportSchema.parse(JSON.parse(text) as unknown);
    expect(report.version).toBe("sales-chat-live-v19");
    expect(report.results).toHaveLength(15);
    expect(report.results.filter(({ pass }) => pass)).toHaveLength(9);
    expect(report.results.at(-1)).toMatchObject({
      errorCode: "EVAL_CASE_ERROR", loopSteps: 1, toolBearingSteps: 1,
      toolSequence: [], normalizedArgs: [],
    });
    expect(report.results.at(-1)).not.toHaveProperty("toolTraceStatus");
    expect(report.complete).toBe(false);
    expect(report.thresholdsPassed).toBe(false);
    await expect(verifyLiveEvalReportConsistency(report)).rejects.toThrow(/incompatible report version/u);
  });

  it.each([
    {
      filename: "ai-live-eval-20260913T113840664Z-d43a1d0d-d320-4d4d-ad72-8ee10592eb08.json",
      sha256: "54e7f315aa5e1aedc044b3c713ec6eeb921dbd3bc225b57c817ae446c5b9f1eb",
      passed: 15,
    },
    {
      filename: "ai-live-eval-20260913T124034904Z-759491f1-a601-429f-b96b-8fa971bdae5d.json",
      sha256: "bbb4b0615aa2590bc863bef8672b5ae3a69ab7bb94f04395c37fd841b4deb00c",
      passed: 14,
    },
  ])("preserves v20 $filename without applying current scoring", async ({ filename, sha256, passed }) => {
    const text = await readFile(resolve(process.cwd(), "docs/evals/archive", filename), "utf8");
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(sha256);
    const report = liveEvalReportSchema.parse(JSON.parse(text) as unknown);
    expect(report.version).toBe("sales-chat-live-v20");
    expect(report.results).toHaveLength(18);
    expect(report.results.filter(({ pass }) => pass)).toHaveLength(passed);
    expect(report.results.every((result) => "toolTraceStatus" in result && result.toolTraceStatus === "complete")).toBe(true);
    expect(report.complete).toBe(true);
    expect(report.thresholdsPassed).toBe(false);
    await expect(verifyLiveEvalReportConsistency(report)).rejects.toThrow(/incompatible report version/u);
  });
});
