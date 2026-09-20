import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { liveEvalReportSchema } from "../scripts/portfolio/live-eval-report-schema";
import { assertLiveEvalReadmeCurrentReport } from "../scripts/portfolio/verify-live-eval";

async function currentDocuments(): Promise<{
  readmeText: string;
  reportText: string;
}> {
  const workspace = process.cwd();
  const [readmeText, reportText] = await Promise.all([
    readFile(resolve(workspace, "docs/evals/README.md"), "utf8"),
    readFile(resolve(workspace, "docs/evals/ai-live-eval-latest.json"), "utf8"),
  ]);
  return { readmeText, reportText };
}

function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) {
    throw new Error(`Expected one current snapshot value: ${before}`);
  }
  return source.replace(before, after);
}

describe("live-eval README current-report snapshot", () => {
  it("matches the canonical latest report", async () => {
    const documents = await currentDocuments();
    expect(() => assertLiveEvalReadmeCurrentReport(documents)).not.toThrow();
  });

  it("rejects stale machine-ledger fields", async () => {
    const documents = await currentDocuments();
    const report = liveEvalReportSchema.parse(JSON.parse(documents.reportText));
    if (report.provenance.sourceFingerprint.status !== "captured") {
      throw new Error("The current report must have a captured fingerprint.");
    }
    const snapshotEnd = documents.readmeText.indexOf(
      "<!-- live-eval-current:end -->",
    );
    if (snapshotEnd < 0) throw new Error("Current snapshot marker is absent.");
    const prefix = documents.readmeText.slice(0, snapshotEnd);
    const mutations = [
      [
        `"runId": ${JSON.stringify(report.runId)}`,
        '"runId": "11111111-1111-4111-8111-111111111111"',
      ],
      [
        report.evaluatedAt,
        report.evaluatedAt.replace(/\d(?=Z$)/u, (digit) =>
          digit === "9" ? "8" : String(Number(digit) + 1)
        ),
      ],
      [report.provenance.sourceFingerprint.digest, "b".repeat(64)],
      [
        `"fileCount": ${report.provenance.sourceFingerprint.fileCount}`,
        `"fileCount": ${report.provenance.sourceFingerprint.fileCount + 1}`,
      ],
      [
        `"sampleCount": ${report.sampleCount}`,
        `"sampleCount": ${report.sampleCount + 1}`,
      ],
      [
        `"thresholdsPassed": ${report.thresholdsPassed}`,
        `"thresholdsPassed": ${!report.thresholdsPassed}`,
      ],
      [
        `"version": ${JSON.stringify(report.version)}`,
        '"version": "sales-chat-live-v10"',
      ],
    ] as const;

    for (const [before, after] of mutations) {
      const mutated = replaceOnce(prefix, before, after) +
        documents.readmeText.slice(snapshotEnd);
      expect(() => assertLiveEvalReadmeCurrentReport({
        readmeText: mutated,
        reportText: documents.reportText,
      })).toThrow(/current-report snapshot/u);
    }
  });

  it("rejects a visible current-result rewrite", async () => {
    const documents = await currentDocuments();
    const report = liveEvalReportSchema.parse(JSON.parse(documents.reportText));
    const before = `\`${report.sampleCount}/18 cases\``;
    const after = report.sampleCount === 18 ? "`0/18 cases`" : "`18/18 cases`";
    expect(() => assertLiveEvalReadmeCurrentReport({
      readmeText: replaceOnce(documents.readmeText, before, after),
      reportText: documents.reportText,
    })).toThrow(/current-result prose ledger drifted/u);
    for (const extraClaim of [
      "Current live eval passed 18/18 cases.",
      "当前 live-eval 报告 evaluatedAt `2099-01-01T00:00:00.000Z`。",
      "The live eval currently passed 18/18 cases.",
      "The current run passed 18/18 cases.",
      "At present, the live eval passed all eighteen cases.",
      "live-eval 当前通过 18/18 条 case。",
      "本次最新运行通过全部十八条 case。",
      "The live eval now has a 100% pass rate.",
      "The latest live eval met every acceptance threshold.",
      "本次 live-eval 所有 case 均达标。",
      "本次评估准确率为 100%。",
      "The current live eval result follows. It passed 18/18 cases.",
      "The current [live eval](evals/latest.json) passed 18/18 cases.",
      "The current **live eval** passed 18/18 cases.",
      "The current `live-eval` passed 18/18 cases.",
      "The most recent live eval passed 18/18 cases.",
      "As of today, the live eval passed 18/18 cases.",
      "截至目前的 live-eval 已通过 18/18 条 case。",
      "最近一次 live-eval 已通过 18/18 条 case。",
      "The current live eval result is shown here. It passed 18/18 cases.",
      "The current live eval recorded 18 of 18 cases.",
      "The current live eval passed 18/18; the live eval contract defines the thresholds.",
      "The live eval contract documents that the current live eval passed 18/18 cases.",
      "The current [live eval] passed 18/18 cases.",
      "The current&nbsp;live eval passed 18/18 cases.",
      "The current live‑eval passed 18/18 cases.",
      "As of now, the live eval passed 18/18 cases.",
      "Our latest attempt passed 18/18 cases.",
      "本轮 live-eval 已通过 18/18 条 case。",
      "The current live eval passed 18 out of 18 cases.",
      "The current live eval reached 100 percent.",
      "The current live eval result is shown below. Summary. It passed 18/18 cases.",
      "Current v11: passed 18/18 cases.",
      "当前 v11：18/18 条 case 通过。",
      "The current sales-chat-live-v11 run passed 18/18 cases.",
      "sales-chat-live-v11 is now passing 18/18 cases.",
      "The current live eval contract says the suite passed.",
      "According to the current live eval contract, all cases passed.",
      "The live eval just completed and passed 18/18 cases.",
      "刚跑完的 live-eval 18/18 通过。",
      "新鲜出炉的评估结果：18/18。",
      "The latest live eval is complete.",
      "The latest live eval result:\n\n18/18 cases passed.",
      "The last live eval passed 18/18 cases.",
      "The current live eval p&#97;ssed 18/18 cases.",
      "The current sales-chat-live-v12 run passed 18/18 cases.",
      "Current sales-chat-live-v42.",
    ]) {
      expect(() => assertLiveEvalReadmeCurrentReport({
        readmeText: `${documents.readmeText}\n${extraClaim}\n`,
        reportText: documents.reportText,
      })).toThrow(/only in the canonical ledger/u);
    }
    for (const historicalOrContractStatement of [
      "The current documentation explains why the historical live eval failed.",
      "The latest contract requires a failed live-eval report to be archived.",
      "当前文档不把历史 live-eval 成功记录视为现行成绩。",
      "The current live eval contract defines passed as meeting every threshold.",
      "The latest live-eval parser rejects a failed historical report.",
      "The current live eval documentation retains failed reports for audit.",
      "The current live eval contract passed its documentation review.",
      "The current live eval documentation failed its link check.",
      "The latest evaluation schema succeeded in parsing the legacy fixture.",
      "The current live eval contract requires 100% evidence accuracy.",
      "The offline harness does not claim a live-eval success rate.",
      "离线评估不冒充真实 provider 成功率评估。",
    ]) {
      expect(() => assertLiveEvalReadmeCurrentReport({
        readmeText:
          `${documents.readmeText}\n${historicalOrContractStatement}\n`,
        reportText: documents.reportText,
      })).not.toThrow();
    }
  });

  it("rejects duplicate, malformed, and noncanonical snapshots", async () => {
    const documents = await currentDocuments();
    const report = liveEvalReportSchema.parse(JSON.parse(documents.reportText));
    expect(() => assertLiveEvalReadmeCurrentReport({
      ...documents,
      readmeText: `${documents.readmeText}\n<!-- live-eval-current:start -->`,
    })).toThrow(/one current-report snapshot/u);
    expect(() => assertLiveEvalReadmeCurrentReport({
      ...documents,
      readmeText: documents.readmeText.replace("```json", "```text"),
    })).toThrow(/snapshot is malformed/u);
    expect(() => assertLiveEvalReadmeCurrentReport({
      ...documents,
      readmeText: replaceOnce(
        documents.readmeText,
        `  "version": ${JSON.stringify(report.version)}`,
        `    "version": ${JSON.stringify(report.version)}`,
      ),
    })).toThrow(/not canonical JSON/u);
    expect(() => assertLiveEvalReadmeCurrentReport({
      ...documents,
      readmeText: `${documents.readmeText}\n<!-- live-eval-current-prose:start -->`,
    })).toThrow(/one current-result prose ledger/u);
  });
});
