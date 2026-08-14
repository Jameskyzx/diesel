import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const severitySchema = z.enum(["low", "moderate", "high", "critical"]);

const auditReportSchema = z.object({
  advisories: z.record(
    z.string(),
    z.object({
      github_advisory_id: z.string().regex(/^GHSA-[a-z0-9-]+$/),
      severity: severitySchema,
      title: z.string().min(1),
    }),
  ),
});

export const auditPolicySchema = z.object({
  reviewedAt: z.iso.date(),
  advisories: z.array(
    z.object({
      expiresOn: z.iso.date(),
      id: z.string().regex(/^GHSA-[a-z0-9-]+$/),
      owner: z.string().trim().min(1),
      reason: z.string().trim().min(20),
      severity: z.literal("high"),
    }),
  ),
});

export type AuditPolicy = z.infer<typeof auditPolicySchema>;
export type AuditReport = z.infer<typeof auditReportSchema>;

export function evaluateAuditPolicy(input: {
  policy: AuditPolicy;
  report: AuditReport;
  today: string;
}): string[] {
  const policyById = new Map(
    input.policy.advisories.map((advisory) => [advisory.id, advisory]),
  );
  const failures: string[] = [];

  for (const advisory of Object.values(input.report.advisories)) {
    if (advisory.severity === "critical") {
      failures.push(
        `${advisory.github_advisory_id} is critical and cannot be allowlisted`,
      );
      continue;
    }
    if (advisory.severity !== "high") {
      continue;
    }

    const exception = policyById.get(advisory.github_advisory_id);
    if (!exception) {
      failures.push(
        `${advisory.github_advisory_id} is high and has no registered exception`,
      );
    } else if (exception.expiresOn < input.today) {
      failures.push(
        `${advisory.github_advisory_id} exception expired on ${exception.expiresOn}`,
      );
    }
  }

  return failures;
}

async function runPnpmAudit(): Promise<AuditReport> {
  const output = await new Promise<string>((resolveOutput, reject) => {
    const child = spawn("pnpm", ["audit", "--json"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", () => {
      const text = Buffer.concat(stdout).toString("utf8").trim();
      if (!text) {
        reject(
          new Error(
            `pnpm audit returned no JSON: ${Buffer.concat(stderr).toString("utf8")}`,
          ),
        );
        return;
      }
      resolveOutput(text);
    });
  });

  return auditReportSchema.parse(JSON.parse(output));
}

async function main(): Promise<void> {
  const policy = auditPolicySchema.parse(
    JSON.parse(
      await readFile(
        resolve(process.cwd(), ".github/dependency-audit-allowlist.json"),
        "utf8",
      ),
    ),
  );
  const report = await runPnpmAudit();
  const today = new Date().toISOString().slice(0, 10);
  const failures = evaluateAuditPolicy({ policy, report, today });

  if (failures.length > 0) {
    throw new Error(`Dependency advisory policy failed:\n- ${failures.join("\n- ")}`);
  }

  const highCount = Object.values(report.advisories).filter(
    ({ severity }) => severity === "high",
  ).length;
  process.stdout.write(
    `Dependency advisory policy passed (${highCount} registered high advisories, no critical advisories).\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
