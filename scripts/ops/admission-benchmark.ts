import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import { admissionConnectionOptions } from "../../src/server/db/admission-client";
import { getDatabaseUrl } from "../../src/server/db/environment";
import * as schema from "../../src/server/db/schema";
import { MAX_CHAT_RATE_LIMIT_CHECK_MS } from "../../src/server/http/request-limits";
import { createRateLimitRepository } from "../../src/server/repositories/rate-limit-repository";

export const benchmarkSampleSchema = z.strictObject({
  phase: z.enum(["cold", "warm", "after-idle", "concurrent"]),
  durationMs: z.number().nonnegative().finite(),
  passed: z.boolean(),
  error: z.enum(["database_error", "decision_mismatch", "application_deadline"]).nullable(),
});
type Sample = z.infer<typeof benchmarkSampleSchema>;
const optionsSchema = z.strictObject({
  samples: z.coerce.number().int().min(20).max(200).default(40),
  idleSeconds: z.coerce.number().int().min(25).max(60).default(25),
  output: z.string().min(1),
});

export function summarizeBenchmark(samples: readonly Sample[]) {
  const valid = z.array(benchmarkSampleSchema).parse(samples);
  const durations = valid.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const percentile = (p: number) => durations.length === 0 ? null : durations[Math.ceil(p * durations.length) - 1];
  const phases = Object.fromEntries(benchmarkSampleSchema.shape.phase.options.map((phase) => [
    phase, valid.filter((sample) => sample.phase === phase).length,
  ]));
  return {
    sampleCount: valid.length,
    failedCount: valid.filter((sample) => !sample.passed).length,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    maximumMs: durations.at(-1) ?? null,
    phases,
    // This is a bounded benchmark gate, not a claim about a long-term SLO.
    passed: valid.length >= 20 && Object.values(phases).every((count) => count > 0) &&
      valid.every((sample) => sample.passed && sample.error === null && sample.durationMs < MAX_CHAT_RATE_LIMIT_CHECK_MS),
  };
}

class BenchmarkRollback extends Error {}
class DecisionMismatch extends Error {}

export async function runAdmissionBenchmark(options: z.infer<typeof optionsSchema>) {
  options = optionsSchema.parse(options);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const scopes = { global: `maintenance-benchmark-global-${runId}`, client: `maintenance-benchmark-client-${runId}` };
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const samples: Sample[] = [];
  const clients = new Set<ReturnType<typeof postgres>>();
  let runError: "benchmark_failed" | "benchmark_timeout" | "benchmark_interrupted" | "rollback_verification_failed" | "connection_close_failed" | null = null;
  let stopped = false;
  const stop = (reason: "benchmark_timeout" | "benchmark_interrupted") => {
    stopped = true;
    runError ??= reason;
    for (const client of clients) void client.end({ timeout: 2 }).catch(() => undefined);
  };
  const interrupt = () => stop("benchmark_interrupted");
  const deadline = setTimeout(() => stop("benchmark_timeout"), 180_000);
  deadline.unref();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const createClient = () => {
    if (stopped) throw new Error("benchmark stopped");
    const client = postgres(getDatabaseUrl(), {
      ...admissionConnectionOptions,
      connection: { application_name: "diesel-maintenance-benchmark" },
    });
    clients.add(client);
    return client;
  };
  const close = async (client: ReturnType<typeof postgres>) => {
    await client.end({ timeout: 2 });
    clients.delete(client);
  };
  const sample = async (client: ReturnType<typeof postgres>, phase: Sample["phase"], index: number) => {
    if (stopped) throw new Error("benchmark stopped");
    const start = performance.now();
    let error: Sample["error"] = null;
    let rolledBack = false;
    try {
      await drizzle(client, { schema }).transaction(async (transaction) => {
        const now = new Date();
        const windowStart = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
        const result = await createRateLimitRepository(transaction).reserveAiChatHourlyRequest({
          now, windowStart, expiresAt: new Date(windowStart.getTime() + 3_600_000),
          global: { scope: scopes.global, keyHash: hash(`${runId}:global`), limit: 100 },
          client: { scope: scopes.client, keyHash: hash(`${runId}:client:${index}`), limit: 100 },
        });
        if (!result.allowed || result.globalCount !== 1 || result.clientCount !== 1) throw new DecisionMismatch();
        // Exercise the actual production repository, then unconditionally undo
        // this run's isolated synthetic counters. Never consume public quotas.
        throw new BenchmarkRollback();
      });
      error = "database_error";
    } catch (cause) {
      if (cause instanceof BenchmarkRollback) rolledBack = true;
      else error = cause instanceof DecisionMismatch ? "decision_mismatch" : "database_error";
    }
    const durationMs = Math.round((performance.now() - start) * 1000) / 1000;
    if (error === null && durationMs >= MAX_CHAT_RATE_LIMIT_CHECK_MS) error = "application_deadline";
    samples.push(benchmarkSampleSchema.parse({ phase, durationMs, passed: rolledBack && error === null, error }));
  };
  try {
    let retainedClient: ReturnType<typeof postgres> | undefined;
    for (let i = 0; i < 3; i += 1) {
      const client = createClient();
      await sample(client, "cold", i);
      if (i === 2) retainedClient = client;
      else await close(client);
    }
    const client = retainedClient;
    if (!client) throw new Error("retained client unavailable");
    for (let i = 0; i < 4; i += 1) await sample(client, "warm", i);
    await new Promise((settle) => setTimeout(settle, options.idleSeconds * 1000));
    await sample(client, "after-idle", 0);
    let remaining = options.samples - samples.length;
    while (remaining > 0) {
      const count = Math.min(4, remaining);
      await Promise.all(Array.from({ length: count }, (_, index) => sample(client, "concurrent", index)));
      remaining -= count;
    }
    const result = await client<{ count: number }[]>`
      select count(*)::integer as count from api_rate_limit_buckets
      where scope in (${scopes.global}, ${scopes.client})
    `;
    if (result.length !== 1 || result[0].count !== 0) runError = "rollback_verification_failed";
  } catch { runError ??= "benchmark_failed"; }
  finally {
    clearTimeout(deadline);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    for (const client of clients) {
      try { await close(client); } catch { runError ??= "connection_close_failed"; }
    }
  }
  const summary = summarizeBenchmark(samples);
  return {
    version: "diesel-admission-benchmark-v1", runId, startedAt, completedAt: new Date().toISOString(),
    configuredSamples: options.samples, idleSeconds: options.idleSeconds,
    poolSize: admissionConnectionOptions.max, concurrency: 4,
    applicationDeadlineMs: MAX_CHAT_RATE_LIMIT_CHECK_MS,
    providerCalls: 0, persistentFixtureWritesExpected: 0,
    measurementBoundary: "repository transaction, connection setup, nested savepoint and forced rollback; not HTTP/model latency or an availability SLO",
    samples, summary, runError,
    passed: runError === null && samples.length === options.samples && summary.passed,
  };
}

async function main(): Promise<void> {
  if (process.env.DIESEL_RUN_ADMISSION_BENCHMARK !== "true") throw new Error("explicit benchmark opt-in required");
  const parsed: Record<string, string> = {};
  for (const argument of process.argv.slice(2)) {
    const match = /^--(samples|idleSeconds|output)=(.+)$/u.exec(argument);
    if (!match || Object.hasOwn(parsed, match[1])) throw new Error("invalid benchmark option");
    parsed[match[1]] = match[2];
  }
  const options = optionsSchema.parse(parsed);
  const output = resolve(options.output);
  // Claim output before touching PostgreSQL; never overwrite prior evidence.
  const descriptor = await open(output, "wx", 0o600);
  let report: Awaited<ReturnType<typeof runAdmissionBenchmark>>;
  try {
    report = await runAdmissionBenchmark(options);
    await descriptor.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    await descriptor.sync();
  }
  finally { await descriptor.close(); }
  process.stdout.write(`${JSON.stringify({ output, summary: report.summary, runError: report.runError, passed: report.passed })}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(() => {
    process.stderr.write("Admission benchmark failed; no database URL or raw error was printed.\n");
    process.exitCode = 1;
  });
}
