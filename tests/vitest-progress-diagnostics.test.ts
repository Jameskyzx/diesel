import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  VITEST_PROGRESS_LINE_PREFIX,
  VITEST_PROGRESS_MAX_ACTIVE_CASES,
  VITEST_PROGRESS_MAX_ACTIVE_MODULES,
  VITEST_PROGRESS_MAX_LINE_BYTES,
  VITEST_PROGRESS_MAX_TOTAL_BYTES,
  VitestProgressDiagnostics,
  type VitestProgressCaseObservation,
  type VitestProgressModuleObservation,
} from "../scripts/portfolio/vitest-progress-diagnostics";

const id = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const progressSchema = z.object({
  version: z.literal("vitest-progress-diagnostics-v1"),
  diagnosticOnly: z.literal(true),
  reason: z.enum(["start", "heartbeat", "end"]),
  sequence: count,
  elapsedMs: count,
  activeModules: z.array(z.object({
    id,
    file: z.string().nullable(),
    phase: z.enum(["queued", "collected", "running"]),
    elapsedMs: count,
  }).strict()),
  activeCases: z.array(z.object({
    id,
    moduleId: id,
    file: z.string().nullable(),
    collectionOrdinal: count.nullable(),
    location: z.object({ line: count, column: count }).strict().nullable(),
    elapsedMs: count,
  }).strict()),
  counts: z.object({
    queuedModuleEvents: count,
    collectedModuleEvents: count,
    startedModuleEvents: count,
    completedModuleEvents: count,
    startedCaseEvents: count,
    completedCaseEvents: count,
    passedCaseEvents: count,
    failedCaseEvents: count,
    skippedCaseEvents: count,
  }).strict(),
  omitted: z.object({
    activeModuleRecords: count,
    activeCaseRecords: count,
    moduleEvents: count,
    caseEvents: count,
  }).strict(),
  truncated: z.boolean(),
  budgetExhausted: z.boolean(),
}).strict();

function decode(line: string | undefined) {
  expect(line).toBeDefined();
  expect(line).toMatch(/^vitest-progress-v1:/u);
  expect(line?.endsWith("\n")).toBe(true);
  return progressSchema.parse(JSON.parse(line!.slice(VITEST_PROGRESS_LINE_PREFIX.length)));
}

const workspace = resolve("/private-progress-workspace");
function moduleObservation(index = 0): VitestProgressModuleObservation {
  return {
    id: `module-native-${index}`,
    moduleId: resolve(workspace, `tests/module-${index}.test.ts`),
  };
}
function caseObservation(index = 0, module = moduleObservation()): VitestProgressCaseObservation {
  return {
    id: `case-native-${index}`,
    module,
    collectionOrdinal: index + 1,
    location: { line: index + 1, column: 3 },
  };
}
function fixture() {
  const lines: string[] = [];
  let now = 10_000;
  const diagnostics = new VitestProgressDiagnostics({
    workspace,
    sink: (line) => { lines.push(line); },
    now: () => now,
  });
  return { diagnostics, lines, time: (value: number) => { now = value; } };
}

describe("bounded Vitest progress diagnostics", () => {
  it("emits independent start, heartbeat and terminal snapshots without a result artifact", () => {
    const { diagnostics, lines, time } = fixture();
    diagnostics.emit("start");
    diagnostics.moduleQueued(moduleObservation());
    time(10_010);
    diagnostics.moduleCollected(moduleObservation());
    diagnostics.moduleStarted(moduleObservation());
    diagnostics.caseReady(caseObservation());
    time(15_000);
    diagnostics.emit("heartbeat");
    const active = decode(lines[1]);
    expect(active).toMatchObject({ reason: "heartbeat", sequence: 2, elapsedMs: 5_000 });
    expect(active.activeModules).toEqual([{
      id: expect.stringMatching(/^[a-f0-9]{64}$/u),
      file: "tests/module-0.test.ts", phase: "running", elapsedMs: 5_000,
    }]);
    expect(active.activeCases).toEqual([{
      id: expect.stringMatching(/^[a-f0-9]{64}$/u),
      moduleId: active.activeModules[0]!.id,
      collectionOrdinal: 1,
      file: "tests/module-0.test.ts", location: { line: 1, column: 3 }, elapsedMs: 4_990,
    }]);
    diagnostics.caseFinished(caseObservation(), "passed");
    diagnostics.moduleFinished(moduleObservation());
    diagnostics.emit("end");
    expect(decode(lines[2])).toMatchObject({
      reason: "end", sequence: 3, activeModules: [], activeCases: [],
      counts: {
        queuedModuleEvents: 1, collectedModuleEvents: 1, startedModuleEvents: 1,
        completedModuleEvents: 1, startedCaseEvents: 1, completedCaseEvents: 1,
        passedCaseEvents: 1, failedCaseEvents: 0, skippedCaseEvents: 0,
      },
      truncated: false, budgetExhausted: false,
    });
    diagnostics.caseReady(caseObservation(1));
    diagnostics.emit("heartbeat");
    expect(lines).toHaveLength(3);
  });

  it("retains other concurrent cases and modules when one result arrives", () => {
    const { diagnostics, lines } = fixture();
    const firstModule = moduleObservation();
    const secondModule = moduleObservation(1);
    const firstCase = caseObservation(0, firstModule);
    const secondCase = caseObservation(1, firstModule);
    const otherModuleCase = caseObservation(0, secondModule);
    diagnostics.moduleStarted(firstModule);
    diagnostics.moduleStarted(secondModule);
    diagnostics.caseReady(firstCase);
    diagnostics.caseReady(secondCase);
    diagnostics.caseReady(otherModuleCase);
    diagnostics.emit("heartbeat");
    const before = decode(lines[0]);
    expect(new Set(before.activeCases.map((test) => test.id)).size).toBe(3);
    diagnostics.caseFinished(firstCase, "failed");
    diagnostics.emit("heartbeat");
    const after = decode(lines[1]);
    expect(after.activeCases).toHaveLength(2);
    expect(after.activeModules).toHaveLength(2);
    expect(after.counts.failedCaseEvents).toBe(1);
    diagnostics.moduleFinished(firstModule);
    diagnostics.emit("heartbeat");
    expect(decode(lines[2]).activeCases).toEqual([
      expect.objectContaining({ file: "tests/module-1.test.ts" }),
    ]);
    expect(decode(lines[2]).counts.completedCaseEvents).toBe(1);
  });

  it("counts skipped result events without inventing a case-ready event", () => {
    const { diagnostics, lines } = fixture();
    diagnostics.caseFinished(caseObservation(), "skipped");
    diagnostics.emit("heartbeat");
    expect(decode(lines[0])).toMatchObject({
      activeCases: [], counts: { startedCaseEvents: 0, completedCaseEvents: 1, skippedCaseEvents: 1 },
    });
  });

  it("does not read or emit task names, errors, metadata, environment or absolute paths", () => {
    const { diagnostics, lines } = fixture();
    const testModule = { ...moduleObservation(), id: "PRIVATE_MODULE_NATIVE_ID" };
    const test = {
      ...caseObservation(0, testModule), id: "PRIVATE_CASE_NATIVE_ID",
      get name(): never { throw new Error("PRIVATE_NAME"); },
      get fullName(): never { throw new Error("PRIVATE_FULL_NAME"); },
      get errors(): never { throw new Error("PRIVATE_ERROR"); },
      get meta(): never { throw new Error("PRIVATE_METADATA"); },
      get env(): never { throw new Error("PRIVATE_ENVIRONMENT"); },
    };
    diagnostics.moduleStarted(testModule);
    diagnostics.caseReady(test);
    diagnostics.emit("heartbeat");
    expect(decode(lines[0]).activeCases).toHaveLength(1);
    expect(lines.join("")).not.toMatch(/PRIVATE_|private-progress-workspace/u);
  });

  it.each([
    "tests/valid.test.ts", "tests/nested/module_1.test.ts",
  ])("allows only a safe relative test locator: %s", (path) => {
    const { diagnostics, lines } = fixture();
    diagnostics.caseReady(caseObservation(0, { id: "module", moduleId: resolve(workspace, path) }));
    diagnostics.emit("heartbeat");
    expect(decode(lines[0]).activeCases[0]!.file).toBe(path);
  });

  it.each([
    "/outside/PRIVATE_PATH.test.ts",
    `${workspace}/tests/../PRIVATE_PATH.test.ts`,
    `${workspace}/tests/PRIVATE_PATH.js`,
    `${workspace}/tests/PRIVATE_PATH\n.test.ts`,
    `${workspace}/tests/${"a".repeat(260)}.test.ts`,
    "virtual:PRIVATE_PATH", "tests/PRIVATE_PATH.test.ts",
  ])("redacts unsafe or unsupported module locator %#", (moduleId) => {
    const { diagnostics, lines } = fixture();
    diagnostics.caseReady(caseObservation(0, { id: "module", moduleId }));
    diagnostics.emit("heartbeat");
    expect(decode(lines[0]).activeCases[0]!.file).toBeNull();
    expect(lines.join("")).not.toContain("PRIVATE_PATH");
    expect(lines.join("")).not.toContain(workspace);
  });

  it("bounds active tracking and reports both omitted records and untracked events", () => {
    const { diagnostics, lines } = fixture();
    for (let index = 0; index < VITEST_PROGRESS_MAX_ACTIVE_MODULES + 5; index += 1) {
      diagnostics.moduleStarted(moduleObservation(index));
    }
    for (let index = 0; index < VITEST_PROGRESS_MAX_ACTIVE_CASES + 7; index += 1) {
      diagnostics.caseReady(caseObservation(index));
    }
    diagnostics.emit("heartbeat");
    const output = decode(lines[0]);
    expect(output.activeModules.length + output.omitted.activeModuleRecords)
      .toBe(VITEST_PROGRESS_MAX_ACTIVE_MODULES);
    expect(output.activeCases.length + output.omitted.activeCaseRecords)
      .toBe(VITEST_PROGRESS_MAX_ACTIVE_CASES);
    expect(output.omitted.moduleEvents).toBe(5);
    expect(output.omitted.caseEvents).toBe(7);
    expect(output.truncated).toBe(true);
    expect(Buffer.byteLength(lines[0]!, "utf8")).toBeLessThanOrEqual(VITEST_PROGRESS_MAX_LINE_BYTES);
  });

  it("keeps the oldest active case when the per-line projection is full", () => {
    const { diagnostics, lines, time } = fixture();
    diagnostics.caseReady(caseObservation());
    diagnostics.emit("heartbeat");
    const oldestId = decode(lines[0]).activeCases[0]!.id;
    time(20_000);
    for (let index = 1; index < VITEST_PROGRESS_MAX_ACTIVE_CASES; index += 1) {
      diagnostics.caseReady(caseObservation(index));
    }
    diagnostics.emit("heartbeat");
    expect(decode(lines[1]).activeCases[0]!.id).toBe(oldestId);
    expect(decode(lines[1]).omitted.activeCaseRecords).toBeGreaterThan(0);
  });

  it("stops after a final budget notice without exceeding the cumulative byte limit", () => {
    let bytes = 0;
    let calls = 0;
    let lastLine: string | undefined;
    const diagnostics = new VitestProgressDiagnostics({
      workspace, now: () => 0,
      sink: (line) => {
        expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(VITEST_PROGRESS_MAX_LINE_BYTES);
        bytes += Buffer.byteLength(line, "utf8");
        calls += 1;
        lastLine = line;
      },
    });
    for (let index = 0; index < 5_000; index += 1) diagnostics.emit("heartbeat");
    expect(bytes).toBeLessThanOrEqual(VITEST_PROGRESS_MAX_TOTAL_BYTES);
    expect(calls).toBeLessThan(5_000);
    expect(decode(lastLine)).toMatchObject({ budgetExhausted: true, truncated: true });
    const previousCalls = calls;
    diagnostics.caseReady(caseObservation());
    diagnostics.emit("end");
    expect(calls).toBe(previousCalls);
  });

  it("stops diagnostic output after a sink exception without throwing", () => {
    const sink = vi.fn(() => { throw new Error("PRIVATE_SINK_ERROR"); });
    const diagnostics = new VitestProgressDiagnostics({ workspace, sink });
    expect(() => diagnostics.emit("start")).not.toThrow();
    diagnostics.caseReady(caseObservation());
    diagnostics.emit("heartbeat");
    diagnostics.emit("end");
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("does not let a backwards or invalid clock produce negative or invalid elapsed time", () => {
    const { diagnostics, lines, time } = fixture();
    diagnostics.emit("start");
    diagnostics.caseReady(caseObservation());
    time(15_000);
    diagnostics.emit("heartbeat");
    time(1);
    diagnostics.emit("heartbeat");
    time(Number.NaN);
    diagnostics.emit("heartbeat");
    expect(lines.slice(1).map((line) => decode(line).elapsedMs)).toEqual([5_000, 5_000, 5_000]);
    expect(lines.slice(1).map((line) => decode(line).activeCases[0]!.elapsedMs))
      .toEqual([5_000, 5_000, 5_000]);
  });

  it("contains a clock exception during lifecycle observations", () => {
    const lines: string[] = [];
    const diagnostics = new VitestProgressDiagnostics({
      workspace,
      sink: (line) => { lines.push(line); },
      now: () => { throw new Error("PRIVATE_CLOCK_FAILURE"); },
    });
    expect(() => {
      diagnostics.moduleStarted(moduleObservation());
      diagnostics.caseReady(caseObservation());
      diagnostics.emit("heartbeat");
    }).not.toThrow();
    expect(decode(lines[0]).elapsedMs).toBe(0);
    expect(lines[0]).not.toContain("PRIVATE_CLOCK_FAILURE");
  });

  it("omits oversized identities and invalid locations without exposing their values", () => {
    const { diagnostics, lines } = fixture();
    diagnostics.moduleStarted({ id: "x".repeat(4_097), moduleId: "PRIVATE_MODULE_PATH" });
    diagnostics.caseReady({ ...caseObservation(), id: "x".repeat(4_097) });
    diagnostics.caseReady({ ...caseObservation(1), location: { line: -1, column: Number.NaN } });
    diagnostics.emit("heartbeat");
    const output = decode(lines[0]);
    expect(output.omitted).toMatchObject({ moduleEvents: 1, caseEvents: 1 });
    expect(output.activeCases[0]!.location).toBeNull();
    expect(lines.join("")).not.toContain("PRIVATE_MODULE_PATH");
  });

  it.each([undefined, null, -1, 0, 1.5, 100_001, Number.NaN])(
    "does not invent a collection ordinal from missing or invalid input %#",
    (collectionOrdinal) => {
      const { diagnostics, lines } = fixture();
      diagnostics.caseReady({ ...caseObservation(), collectionOrdinal });
      diagnostics.emit("heartbeat");
      expect(decode(lines[0]).activeCases[0]!.collectionOrdinal).toBeNull();
    },
  );
});
