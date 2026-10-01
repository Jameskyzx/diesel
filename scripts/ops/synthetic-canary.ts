import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createCanaryChecks,
  runCanaryCheck,
  validateCanaryBaseUrl,
} from "../../src/domain/operations/synthetic-canary";
import {
  parseProductionVersion,
  productionVersionFromStatus,
} from "../../src/domain/operations/production-version";

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type CanaryRunError = {
  code: "INITIALIZATION_ERROR";
  stage:
    | "base_url"
    | "checks"
    | "expected_version"
    | "report_persistence"
    | "timeout";
};

async function writeReportAtomically(
  reportPath: string,
  serialized: string,
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, reportPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function serializeReport(report: unknown): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

async function main(): Promise<void> {
  const reportPath = process.env.CANARY_REPORT_PATH
    ? resolve(process.cwd(), process.env.CANARY_REPORT_PATH)
    : null;
  const includeProviderAi = process.env.CANARY_CHECK_AI === "true";
  const results = [];
  let expectedVersion: string | null = null;
  let stage: CanaryRunError["stage"] = "base_url";
  let targetOrigin: string | null = null;

  try {
    const configuredBaseUrl = process.env.CANARY_BASE_URL;
    const baseUrl = validateCanaryBaseUrl(
      configuredBaseUrl ?? "http://127.0.0.1:3000",
    );
    targetOrigin = baseUrl.origin;

    stage = "timeout";
    const timeoutMs = Number(process.env.CANARY_TIMEOUT_MS ?? "15000");
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1_000 ||
      timeoutMs > 90_000
    ) {
      throw new Error("Invalid canary timeout.");
    }

    stage = "expected_version";
    const expectedVersionOverride = process.env.CANARY_EXPECTED_VERSION;
    expectedVersion = expectedVersionOverride !== undefined
      ? parseProductionVersion(expectedVersionOverride)
      : configuredBaseUrl
        ? productionVersionFromStatus(
            await readFile(
              resolve(
                process.cwd(),
                process.env.CANARY_STATUS_PATH ?? "docs/STATUS.md",
              ),
              "utf8",
            )
          )
        : null;

    stage = "checks";
    for (const check of createCanaryChecks({
      asOf: utcDate(),
      ...(expectedVersion !== null ? { expectedVersion } : {}),
      includeProviderAi,
    })) {
      results.push(await runCanaryCheck({ baseUrl, check, timeoutMs }));
    }
    const report = {
      checkedAt: new Date().toISOString(),
      expectedVersion,
      includeProviderAi,
      pass: results.every(({ pass }) => pass),
      results,
      runError: null,
      targetOrigin,
      version: "synthetic-canary-v4",
    };
    const serialized = serializeReport(report);

    stage = "report_persistence";
    if (reportPath) {
      await writeReportAtomically(reportPath, serialized);
    }
    process.stdout.write(serialized);
    if (!report.pass) {
      process.exitCode = 1;
    }
  } catch {
    const runError: CanaryRunError = {
      code: "INITIALIZATION_ERROR",
      stage,
    };
    const report = {
      checkedAt: new Date().toISOString(),
      expectedVersion,
      includeProviderAi,
      pass: false,
      results,
      runError,
      targetOrigin,
      version: "synthetic-canary-v4",
    };
    const serialized = serializeReport(report);
    if (reportPath) {
      await writeReportAtomically(reportPath, serialized);
    }
    process.stdout.write(serialized);
    process.stderr.write(
      `Synthetic canary initialization failed at ${runError.stage}.\n`,
    );
    process.exitCode = 1;
  }
}

void main().catch(() => {
  process.stderr.write("Synthetic canary report persistence failed.\n");
  process.exitCode = 1;
});
