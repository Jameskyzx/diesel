import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, realpathSync, writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readDeploymentCapacity } from "../ops/capacity-policy";

const ROOT = "/opt/diesel";
const NODE = "/opt/node-v22.22.3-linux-x64/bin/node";
const ENTRY = "scripts/deploy/durable-release.bundle.mjs";
const cleanEnvironment = {
  HOME: "/root", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", NODE_ENV: "production",
} as const;
const sha = z.string().regex(/^[0-9a-f]{40}$/u);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const invocation = z.string().regex(/^[0-9a-f]{32}$/u);
export const operationLogLimitBytes = 16 * 1024 * 1024;
const logSchema = z.strictObject({ bytes: z.number().int().nonnegative().max(operationLogLimitBytes), truncated: z.boolean(), failed: z.boolean() });

export const operationSchema = z.strictObject({
  format: z.literal("diesel-durable-release-v1"),
  release: sha,
  operationId: z.uuid(),
  mode: z.enum(["full", "application"]),
  createdAt: z.iso.datetime(),
  inputDigest: digest,
  runnerSha256: digest,
});
export type ReleaseOperation = z.infer<typeof operationSchema>;
export const startedSchema = z.strictObject({
  operationId: z.uuid(), invocationId: invocation, startedAt: z.iso.datetime(),
  workerPid: z.number().int().positive(),
});
export const completionSchema = startedSchema.extend({
  completedAt: z.iso.datetime(),
  exitCode: z.number().int().min(0).max(255).nullable(),
  signal: z.enum(["SIGTERM", "SIGINT", "SIGHUP", "SIGKILL", "SIGABRT", "SIGSEGV"]).nullable(),
  spawnFailed: z.boolean(),
  logs: z.strictObject({ stdout: logSchema, stderr: logSchema }),
});
export const unitSchema = z.strictObject({
  Id: z.string(),
  LoadState: z.enum(["loaded", "not-found", "error", "masked", "bad-setting"]),
  ActiveState: z.enum(["active", "inactive", "failed", "activating", "deactivating", "reloading"]),
  SubState: z.string(),
  Result: z.string(),
  InvocationID: z.union([invocation, z.literal("")]),
  ExecMainCode: z.coerce.number().int().nonnegative(),
  ExecMainStatus: z.coerce.number().int().nonnegative(),
  NRestarts: z.coerce.number().int().nonnegative(),
  MainPID: z.coerce.number().int().nonnegative(),
  ExecMainPID: z.coerce.number().int().nonnegative(),
});
type UnitState = z.infer<typeof unitSchema>;

export function unitName(release: string): string {
  return `diesel-release-${sha.parse(release)}.service`;
}

export function parseUnitState(text: string): UnitState {
  if (Buffer.byteLength(text) > 8192) throw new Error("unit response too large");
  const rows: Record<string, string> = {};
  for (const row of text.trimEnd().split("\n")) {
    const separator = row.indexOf("=");
    if (separator < 1) throw new Error("invalid unit property");
    const key = row.slice(0, separator);
    if (Object.hasOwn(rows, key)) throw new Error("duplicate unit property");
    rows[key] = row.slice(separator + 1);
  }
  return unitSchema.parse(rows);
}

export function classifyOperation(
  operation: ReleaseOperation,
  unit: UnitState,
  started: z.infer<typeof startedSchema> | null,
  completion: z.infer<typeof completionSchema> | null,
): "queued" | "running" | "completed" | "failed" | "unknown" {
  if (unit.Id !== unitName(operation.release) || unit.NRestarts !== 0) return "unknown";
  if (started && (started.operationId !== operation.operationId ||
    started.invocationId !== unit.InvocationID || started.workerPid !== unit.ExecMainPID)) return "unknown";
  if (completion && (!started || completion.operationId !== started.operationId ||
    completion.invocationId !== started.invocationId ||
    completion.workerPid !== started.workerPid ||
    completion.startedAt !== started.startedAt ||
    Date.parse(completion.completedAt) < Date.parse(started.startedAt))) return "unknown";
  if (unit.LoadState !== "loaded") return "unknown";
  if (unit.ActiveState === "activating") return "queued";
  if (unit.ActiveState === "active" && unit.SubState === "running") return "running";
  if (unit.ActiveState === "failed" || (completion &&
    (completion.exitCode !== 0 || completion.signal !== null || completion.spawnFailed ||
      completion.logs.stdout.failed || completion.logs.stderr.failed))) return "failed";
  // A worker receipt alone is insufficient: systemd must independently confirm
  // this same invocation exited normally. Missing receipts never become success.
  if (unit.ActiveState === "active" && unit.SubState === "exited" &&
    unit.Result === "success" && unit.ExecMainCode === 1 && unit.ExecMainStatus === 0 &&
    completion?.exitCode === 0 && completion.signal === null && !completion.spawnFailed) return "completed";
  return "unknown";
}

export function systemdStartArguments(release: string): string[] {
  sha.parse(release);
  return [
    "--quiet", `--unit=${unitName(release)}`, "--service-type=exec",
    "--property=Restart=no", "--property=RemainAfterExit=yes",
    "--property=KillMode=control-group", "--property=TimeoutStopSec=120s",
    "--property=RuntimeMaxSec=6h", "--property=UMask=0077",
    "--property=StandardInput=null", "--property=StandardOutput=null",
    "--property=StandardError=null",
    "/usr/bin/env", "-i", ...Object.entries(cleanEnvironment).map(([key, value]) => `${key}=${value}`),
    NODE, `${ROOT}/releases/${release}/${ENTRY}`, "worker", release,
  ];
}

function requireTrustedPath(path: string, kind: "file" | "directory", privateFile = false): void {
  const metadata = lstatSync(path);
  if (realpathSync(path) !== path || metadata.isSymbolicLink() || metadata.uid !== 0 ||
    (metadata.mode & 0o7022) !== 0 ||
    (kind === "directory" ? !metadata.isDirectory() : !metadata.isFile() || metadata.nlink !== 1) ||
    (privateFile && (metadata.gid !== 0 || (metadata.mode & 0o777) !== 0o600))) {
    throw new Error("untrusted operation path");
  }
}

function trustedAncestors(path: string): void {
  for (let current = path; current !== "/"; current = dirname(current)) {
    requireTrustedPath(current, "directory");
  }
}

function readPrivateJson<T>(path: string, schema: z.ZodType<T>): T | null {
  try {
    requireTrustedPath(path, "file", true);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  if (lstatSync(path).size > 16384) throw new Error("operation record too large");
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function writeRecord(path: string, value: unknown): void {
  const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT |
    constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

export function boundedLogWriter(write: (bytes: Buffer) => void, limit = operationLogLimitBytes) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > operationLogLimitBytes) throw new Error("invalid log limit");
  const state = { bytes: 0, truncated: false, failed: false };
  return {
    state,
    append(chunk: Buffer): void {
      const retained = chunk.subarray(0, Math.max(0, limit - state.bytes));
      if (retained.length !== chunk.length) state.truncated = true;
      if (state.failed || retained.length === 0) return;
      try { write(retained); state.bytes += retained.length; }
      catch { state.failed = true; }
      // Always drain later chunks even after the cap or disk error, so logging
      // cannot block recovery. Truncation is explicit in the durable receipt.
    },
  };
}

function command(file: string, args: string[], cwd?: string): string {
  const result = spawnSync(file, args, {
    cwd, env: cleanEnvironment, encoding: "utf8", timeout: 60_000, maxBuffer: 8192,
  });
  if (result.status !== 0 || result.signal || result.error) throw new Error("control command failed");
  return result.stdout;
}

function readUnit(release: string): UnitState {
  const result = spawnSync("/usr/bin/systemctl", [
    "show", unitName(release), "--no-pager",
    ...Object.keys(unitSchema.shape).map((key) => `--property=${key}`),
  ], { env: cleanEnvironment, encoding: "utf8", timeout: 15_000, maxBuffer: 8192 });
  if (result.error || result.signal) throw new Error("unit readback failed");
  const state = parseUnitState(result.stdout);
  if (result.status !== 0 && !(result.status === 1 && state.LoadState === "not-found")) {
    throw new Error("unit readback failed");
  }
  return state;
}

function validateEntrypoint(release: string): { directory: string; runnerSha256: string } {
  if (process.platform !== "linux" || process.getuid?.() !== 0 ||
    process.version !== "v22.22.3" || realpathSync(process.execPath) !== NODE ||
    fileURLToPath(import.meta.url) !== `${ROOT}/releases/${release}/${ENTRY}`) {
    throw new Error("unsupported deployment entrypoint");
  }
  const directory = `${ROOT}/releases/${release}`;
  trustedAncestors(dirname(fileURLToPath(import.meta.url)));
  trustedAncestors(dirname(NODE));
  requireTrustedPath(NODE, "file");
  requireTrustedPath(fileURLToPath(import.meta.url), "file");
  for (const executable of ["/usr/bin/env", "/usr/bin/systemctl", "/usr/bin/systemd-run"]) {
    requireTrustedPath(executable, "file");
  }
  return { directory, runnerSha256: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex") };
}

function verifyInput(directory: string, release: string): string {
  const helper = `${directory}/scripts/deploy/release-input-manifest.mjs`;
  requireTrustedPath(helper, "file");
  return digest.parse(command(NODE, [helper, "verify", release,
    `${directory}/.release-input-manifest.json`], directory).trim());
}

async function runWorker(operation: ReleaseOperation, operationRoot: string, directory: string): Promise<void> {
  const unit = readUnit(operation.release);
  const started = startedSchema.parse({
    operationId: operation.operationId, invocationId: unit.InvocationID,
    startedAt: new Date().toISOString(), workerPid: process.pid,
  });
  if (unit.Id !== unitName(operation.release) || unit.NRestarts !== 0 ||
    unit.MainPID !== process.pid || unit.ExecMainPID !== process.pid ||
    !["activating", "active"].includes(unit.ActiveState)) throw new Error("worker unit mismatch");
  writeRecord(`${operationRoot}/started.json`, started);
  const logDescriptors = ["stdout.log", "stderr.log"].map((name) => openSync(
    `${operationRoot}/${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600,
  ));
  const logs = logDescriptors.map((descriptor) => boundedLogWriter((bytes) => {
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset);
  }));
  try {
    const outcome = await new Promise<{ exitCode: number | null; signal: string | null; spawnFailed: boolean }>((settle) => {
      const child = spawn("/bin/bash", ["--noprofile", "--norc",
        `${directory}/scripts/deploy/host-release-orchestrator.sh`, operation.release,
        `${ROOT}/release-inputs/${operation.release}/env.production.local`], {
        cwd: directory, env: { ...cleanEnvironment, DIESEL_RELEASE_KIND: operation.mode }, stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk: Buffer) => logs[0].append(chunk));
      child.stderr.on("data", (chunk: Buffer) => logs[1].append(chunk));
      let spawnFailed = false;
      child.once("error", () => { spawnFailed = true; });
      const handlers = (["SIGTERM", "SIGINT", "SIGHUP"] as const).map((signal) => {
        const handler = () => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
        process.on(signal, handler);
        return { signal, handler };
      });
      child.once("close", (exitCode, signal) => {
        for (const entry of handlers) process.off(entry.signal, entry.handler);
        settle({ exitCode, signal, spawnFailed });
      });
    });
    for (const descriptor of logDescriptors) {
      if (!fstatSync(descriptor).isFile()) throw new Error("operation log drift");
      fsyncSync(descriptor);
    }
    writeRecord(`${operationRoot}/completed.json`, completionSchema.parse({
      ...started, ...outcome, logs: { stdout: logs[0].state, stderr: logs[1].state }, completedAt: new Date().toISOString(),
    }));
    process.exitCode = outcome.exitCode === 0 && !outcome.signal && !outcome.spawnFailed &&
      logs.every((log) => !log.state.failed) ? 0 : 70;
  } finally { for (const descriptor of logDescriptors) closeSync(descriptor); }
}

async function main(): Promise<void> {
  const [commandMode, release] = z.tuple([z.enum(["start", "start-application", "status", "worker", "capacity"]), sha]).parse(process.argv.slice(2));
  const mode = commandMode === "start-application" ? "start" : commandMode;
  process.umask(0o077);
  const { directory, runnerSha256 } = validateEntrypoint(release);
  if (mode === "capacity") {
    const capacity = readDeploymentCapacity();
    process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), release, ...capacity })}\n`);
    process.exitCode = capacity.warning ? 1 : 0;
    return;
  }
  const operations = `${ROOT}/operations`;
  if (mode === "start") {
    if (!readDeploymentCapacity().releaseAllowed) {
      process.stderr.write("Release blocked by free-space/inode reserve; inspect capacity. No backup was deleted.\n");
      process.exitCode = 73;
      return;
    }
    try { mkdirSync(operations, { mode: 0o700 }); } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    }
  }
  trustedAncestors(operations);
  if ((lstatSync(operations).mode & 0o777) !== 0o700) throw new Error("operation root must be private");
  const operationRoot = `${operations}/${release}`;
  if (mode === "start") {
    const inputDigest = verifyInput(directory, release);
    const candidate = `${ROOT}/release-inputs/${release}/env.production.local`;
    trustedAncestors(dirname(candidate));
    requireTrustedPath(candidate, "file", true);
    if (readUnit(release).LoadState !== "not-found") throw new Error("unit already exists");
    // Atomic one-use claim; ambiguous starts are inspected, never re-launched.
    mkdirSync(operationRoot, { mode: 0o700 });
    const operation = operationSchema.parse({
      format: "diesel-durable-release-v1", release, operationId: randomUUID(), mode: commandMode === "start-application" ? "application" : "full",
      createdAt: new Date().toISOString(), inputDigest, runnerSha256,
    });
    writeRecord(`${operationRoot}/operation.json`, operation);
    command("/usr/bin/systemd-run", systemdStartArguments(release));
    process.stdout.write(`${JSON.stringify({ operation, submitted: true, deploymentVerified: false })}\n`);
    return;
  }
  trustedAncestors(operationRoot);
  const operation = readPrivateJson(`${operationRoot}/operation.json`, operationSchema);
  if (!operation || operation.release !== release || operation.runnerSha256 !== runnerSha256) throw new Error("operation identity mismatch");
  if (mode === "worker") {
    if (verifyInput(directory, release) !== operation.inputDigest) throw new Error("release input drift");
    await runWorker(operation, operationRoot, directory);
    return;
  }
  const unit = readUnit(release);
  const started = readPrivateJson(`${operationRoot}/started.json`, startedSchema);
  const completion = readPrivateJson(`${operationRoot}/completed.json`, completionSchema);
  const state = classifyOperation(operation, unit, started, completion);
  process.stdout.write(`${JSON.stringify({ operation, state, unit, completion,
    deploymentVerified: false, requiresIndependentAcceptance: true })}\n`);
  process.exitCode = state === "failed" || state === "unknown" ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    // Never expose command stderr, environment, credentials, or application logs.
    process.stderr.write("durable release control failed; preserve operation and inspect status\n");
    process.exitCode = 70;
  });
}
