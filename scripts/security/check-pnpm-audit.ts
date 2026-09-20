import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

export const PNPM_AUDIT_TIMEOUT_MS = 60_000;
const PNPM_AUDIT_FORCE_KILL_GRACE_MS = 5_000;

const severitySchema = z.enum([
  "info",
  "low",
  "moderate",
  "high",
  "critical",
]);

const auditAdvisorySchema = z
  .object({
    github_advisory_id: z.string().regex(/^GHSA-[a-z0-9-]+$/),
    severity: severitySchema,
    title: z.string().min(1),
  })
  .strict();

const auditAdvisoriesSchema = z.record(z.string(), auditAdvisorySchema);

const auditReportSchema = z
  .object({
    advisories: auditAdvisoriesSchema,
  })
  .strict();

const pnpmAuditFindingSchema = z
  .object({
    bundled: z.boolean(),
    dev: z.boolean(),
    optional: z.boolean(),
    paths: z.array(z.string()),
    version: z.string().min(1),
  })
  .passthrough();

const pnpmAuditAdvisorySchema = z
  .object({
    cwe: z.string(),
    findings: z.array(pnpmAuditFindingSchema),
    github_advisory_id: z.string().regex(/^GHSA-[a-z0-9-]+$/),
    id: z.number().finite(),
    module_name: z.string().min(1),
    patched_versions: z.string().optional(),
    severity: severitySchema,
    title: z.string().min(1),
    url: z.string(),
    vulnerable_versions: z.string().min(1),
  })
  .passthrough();

const vulnerabilityCountsSchema = z
  .object({
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    moderate: z.number().int().nonnegative(),
  })
  .passthrough();

const pnpmAuditReportSchema = z
  .object({
    actions: z.array(z.unknown()).optional(),
    advisories: z.record(z.string(), pnpmAuditAdvisorySchema),
    metadata: z
      .object({
        dependencies: z.number().int().nonnegative(),
        devDependencies: z.number().int().nonnegative(),
        optionalDependencies: z.number().int().nonnegative(),
        totalDependencies: z.number().int().nonnegative(),
        vulnerabilities: vulnerabilityCountsSchema,
      })
      .passthrough(),
    muted: z.array(z.unknown()).optional(),
  })
  .strict();

export const auditPolicySchema = z
  .object({
    reviewedAt: z.iso.date(),
    advisories: z.array(
      z
        .object({
          expiresOn: z.iso.date(),
          id: z.string().regex(/^GHSA-[a-z0-9-]+$/),
          owner: z.string().trim().min(1),
          reason: z.string().trim().min(20),
          severity: z.literal("high"),
        })
        .strict(),
    ),
  })
  .strict();

export type AuditPolicy = z.infer<typeof auditPolicySchema>;
export type AuditReport = z.infer<typeof auditReportSchema>;

export type PnpmAuditProcessResult = {
  signal: NodeJS.Signals | null;
  status: number | null;
  stderr: string;
  stdout: string;
};

export function interpretPnpmAuditProcessResult(
  result: PnpmAuditProcessResult,
): AuditReport {
  if (result.signal !== null) {
    throw new Error(`pnpm audit was terminated by signal ${result.signal}`);
  }
  if (result.status === null || !Number.isSafeInteger(result.status)) {
    throw new Error("pnpm audit did not report a valid exit status");
  }

  const output = result.stdout.trim();
  if (output.length === 0) {
    throw new Error("pnpm audit returned no JSON report");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(output) as unknown;
  } catch {
    throw new Error("pnpm audit returned malformed JSON");
  }

  const parsed = pnpmAuditReportSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("pnpm audit returned an incomplete or unexpected JSON report");
  }

  const advisoryCount = Object.keys(parsed.data.advisories).length;
  const reportedSeverityCounts = parsed.data.metadata.vulnerabilities;
  const recomputedSeverityCounts: Record<
    z.infer<typeof severitySchema>,
    number
  > = {
    critical: 0,
    high: 0,
    info: 0,
    low: 0,
    moderate: 0,
  };
  for (const advisory of Object.values(parsed.data.advisories)) {
    recomputedSeverityCounts[advisory.severity] += 1;
  }
  for (const severity of severitySchema.options) {
    if (reportedSeverityCounts[severity] !== recomputedSeverityCounts[severity]) {
      throw new Error(
        `pnpm audit ${severity} vulnerability count does not match its advisories`,
      );
    }
  }

  if (result.status === 0) {
    if (advisoryCount !== 0) {
      throw new Error("pnpm audit returned advisories with a successful exit status");
    }
  } else if (result.status === 1) {
    if (advisoryCount === 0) {
      throw new Error("pnpm audit failed without reporting an advisory");
    }
  } else {
    throw new Error(`pnpm audit failed with exit status ${result.status}`);
  }

  return auditReportSchema.parse({
    advisories: Object.fromEntries(
      Object.entries(parsed.data.advisories).map(([id, advisory]) => [
        id,
        {
          github_advisory_id: advisory.github_advisory_id,
          severity: advisory.severity,
          title: advisory.title,
        },
      ]),
    ),
  });
}

export function evaluateAuditPolicy(input: {
  policy: AuditPolicy;
  report: AuditReport;
  today: string;
}): string[] {
  const policyById = new Map(
    input.policy.advisories.map((advisory) => [advisory.id, advisory]),
  );
  const failures = input.policy.advisories.flatMap((exception) =>
    exception.expiresOn < input.today
      ? [`${exception.id} exception expired on ${exception.expiresOn}`]
      : [],
  );

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
    }
  }

  return failures;
}

async function runPnpmAudit(): Promise<AuditReport> {
  const result = await new Promise<PnpmAuditProcessResult>((resolveResult, reject) => {
    const child = spawn("pnpm", ["audit", "--json"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | null = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, PNPM_AUDIT_FORCE_KILL_GRACE_MS);
      forceKillTimer.unref();
    }, PNPM_AUDIT_TIMEOUT_MS);
    timeout.unref();
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (timedOut) {
        reject(
          new Error(`pnpm audit timed out after ${PNPM_AUDIT_TIMEOUT_MS} ms`),
        );
        return;
      }
      resolveResult({
        signal,
        status,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });

  return interpretPnpmAuditProcessResult(result);
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
