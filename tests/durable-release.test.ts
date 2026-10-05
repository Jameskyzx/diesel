import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  boundedLogWriter, classifyOperation, completionSchema, operationSchema, parseUnitState,
  startedSchema, systemdStartArguments, unitName, unitSchema,
} from "../scripts/deploy/durable-release";

const execute = promisify(execFile);
const release = "a".repeat(40);
const operationId = "79872015-4a1b-4baf-ae39-53bb8b2963db";
const invocationId = "b".repeat(32);
const operation = operationSchema.parse({
  format: "diesel-durable-release-v1", release, operationId, mode: "full",
  createdAt: "2026-10-05T00:00:00.000Z", inputDigest: "c".repeat(64), runnerSha256: "d".repeat(64),
});
const started = startedSchema.parse({ operationId, invocationId, workerPid: 1234, startedAt: "2026-10-05T00:00:01.000Z" });
const completed = completionSchema.parse({
  ...started, completedAt: "2026-10-05T00:01:00.000Z", exitCode: 0, signal: null, spawnFailed: false,
  logs: { stdout: { bytes: 0, truncated: false, failed: false }, stderr: { bytes: 0, truncated: false, failed: false } },
});
const successUnit = unitSchema.parse({
  Id: unitName(release), LoadState: "loaded", ActiveState: "active", SubState: "exited",
  Result: "success", InvocationID: invocationId, ExecMainCode: 1, ExecMainStatus: 0, NRestarts: 0,
  MainPID: 0, ExecMainPID: 1234,
});

describe("durable release operation identity", () => {
  it.each(["", "../current", "a".repeat(39), "A".repeat(40), `${release}; true`])(
    "rejects invalid release %s", (value) => expect(() => unitName(value)).toThrow(),
  );
  it("rejects undeclared paths, commands, or modes", () => {
    expect(() => operationSchema.parse({ ...operation, command: "true" })).toThrow();
    expect(() => operationSchema.parse({ ...operation, mode: "skip-publication" })).toThrow();
  });
  it("starts a system service without attaching its lifetime or output to SSH", () => {
    const args = systemdStartArguments(release);
    expect(args).not.toContain("--scope");
    expect(args).not.toContain("--wait");
    expect(args).not.toContain("--pipe");
    expect(args).toContain("--service-type=exec");
    expect(args).toContain("--property=Restart=no");
    expect(args).toContain("--property=KillMode=control-group");
    expect(args).toContain("--property=RuntimeMaxSec=6h");
    expect(args).toContain("--property=StandardInput=null");
    expect(args).toContain("--property=StandardOutput=null");
    expect(args).toContain("--property=StandardError=null");
    expect(args).toContain("/usr/bin/env");
    expect(args).toContain("-i");
    expect(args.slice(-3)).toEqual([`/opt/diesel/releases/${release}/scripts/deploy/durable-release.bundle.mjs`, "worker", release]);
  });
});

describe("durable release result classification", () => {
  it("requires both same-invocation receipt and independent systemd completion", () => {
    expect(classifyOperation(operation, successUnit, started, completed)).toBe("completed");
    expect(classifyOperation(operation, successUnit, started, null)).toBe("unknown");
    expect(classifyOperation(operation, successUnit, null, completed)).toBe("unknown");
  });
  it("an interrupted SSH client does not change a still-running host outcome", () => {
    const running = { ...successUnit, SubState: "running", ExecMainCode: 0 };
    expect(classifyOperation(operation, running, started, null)).toBe("running");
    expect(classifyOperation(operation, running, started, completed)).toBe("running");
  });
  it.each([
    { Id: unitName("f".repeat(40)) }, { InvocationID: "e".repeat(32) }, { NRestarts: 1 }, { ExecMainPID: 9876 },
    { LoadState: "not-found" as const }, { Result: "timeout" }, { ExecMainCode: 2 }, { ExecMainStatus: 1 },
  ])("does not infer success after unit drift %j", (change) => {
    expect(classifyOperation(operation, { ...successUnit, ...change }, started, completed)).not.toBe("completed");
  });
  it.each([
    { operationId: "93b7a7d3-c1b0-4599-8d92-fd6b5c4af16a" },
    { invocationId: "f".repeat(32) },
    { workerPid: 9876 },
    { startedAt: "2026-10-05T00:00:02.000Z" },
    { completedAt: "2026-10-04T00:00:00.000Z" },
  ])("rejects a mismatched completion %j", (change) => {
    expect(classifyOperation(operation, successUnit, started, { ...completed, ...change })).toBe("unknown");
  });
  it.each([
    { exitCode: 70 }, { exitCode: null, signal: "SIGTERM" as const }, { spawnFailed: true },
  ])("preserves the real failed child result %j", (change) => {
    expect(classifyOperation(operation, successUnit, started, { ...completed, ...change })).toBe("failed");
  });
  it("does not call a killed worker successful without its receipt", () => {
    expect(classifyOperation(operation, { ...successUnit, ActiveState: "failed", Result: "signal" }, started, null)).toBe("failed");
  });
  it("parses only an exact bounded property record", () => {
    const text = Object.entries(successUnit).map(([key, value]) => `${key}=${value}`).join("\n");
    expect(parseUnitState(`${text}\n`)).toEqual(successUnit);
    expect(() => parseUnitState(`${text}\nResult=success`)).toThrow();
    expect(() => parseUnitState(`${text}\nEnvironment=PRIVATE`)).toThrow();
    expect(() => parseUnitState(" ".repeat(8193))).toThrow();
    expect(() => parseUnitState(text.replace("NRestarts=0", "NRestarts=NaN"))).toThrow();
  });
});

describe("durable release bundled entrypoint", () => {
  it("caps each private log while draining excess bytes and records disk failures", () => {
    const chunks: Buffer[] = [];
    const writer = boundedLogWriter((chunk) => chunks.push(chunk), 5);
    writer.append(Buffer.from("abc"));
    writer.append(Buffer.from("defghi"));
    writer.append(Buffer.from("jkl"));
    expect(Buffer.concat(chunks).toString()).toBe("abcde");
    expect(writer.state).toEqual({ bytes: 5, truncated: true, failed: false });
    const broken = boundedLogWriter(() => { throw new Error("disk full"); });
    expect(() => broken.append(Buffer.from("private"))).not.toThrow();
    expect(broken.state.failed).toBe(true);
    expect(classifyOperation(operation, successUnit, started, {
      ...completed, logs: { ...completed.logs, stderr: broken.state },
    })).toBe("failed");
  });
  it("is byte-for-byte reproducible from reviewed source and contains its bundled Zod license", async () => {
    const directory = await mkdtemp(join(tmpdir(), "diesel-durable-bundle-"));
    try {
      const output = join(directory, "runner.mjs");
      await execute(process.execPath, ["scripts/deploy/build-durable-release.mjs", `--outfile=${output}`], { timeout: 30_000 });
      expect(await readFile(output)).toEqual(await readFile("scripts/deploy/durable-release.bundle.mjs"));
      const text = await readFile(output, "utf8");
      expect(text).not.toMatch(/from ["']zod/u);
      expect(text.includes("Permission is hereby granted")).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("rejects the local CLI before creating any host operation", async () => {
    await expect(execute(process.execPath, [resolve("scripts/deploy/durable-release.bundle.mjs"), "start", release]))
      .rejects.toMatchObject({ code: 70, stderr: expect.stringContaining("durable release control failed") });
  });
});
