import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createCanaryChecks,
  runCanaryCheck,
  validateCanaryBaseUrl,
} from "../../src/domain/operations/synthetic-canary";

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const baseUrl = validateCanaryBaseUrl(
    process.env.CANARY_BASE_URL ?? "http://127.0.0.1:3000",
  );
  const includeAi = process.env.CANARY_CHECK_AI === "true";
  const timeoutMs = Number(process.env.CANARY_TIMEOUT_MS ?? "15000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 90_000) {
    throw new Error("CANARY_TIMEOUT_MS must be an integer from 1000 to 90000.");
  }

  const results = [];
  for (const check of createCanaryChecks({ asOf: utcDate(), includeAi })) {
    results.push(await runCanaryCheck({ baseUrl, check, timeoutMs }));
  }
  const report = {
    checkedAt: new Date().toISOString(),
    includeAi,
    pass: results.every(({ pass }) => pass),
    results,
    targetOrigin: baseUrl.origin,
    version: "synthetic-canary-v1",
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  if (process.env.CANARY_REPORT_PATH) {
    const reportPath = resolve(process.cwd(), process.env.CANARY_REPORT_PATH);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, serialized, { encoding: "utf8", mode: 0o600 });
  }
  process.stdout.write(serialized);
  if (!report.pass) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Synthetic canary failed."}\n`,
  );
  process.exitCode = 1;
});
