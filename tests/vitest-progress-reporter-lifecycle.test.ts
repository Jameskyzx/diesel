import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsonReporter, TestCase, TestModule, Vitest } from "vitest/node";
import { z } from "zod";

import PortfolioVitestJsonReporter from "../scripts/portfolio/vitest-json-reporter";

type ReporterOptions = NonNullable<ConstructorParameters<typeof JsonReporter>[0]>;
const json = '{"stubJsonReport":true}\n';
const hooks = vi.hoisted(() => ({
  init: vi.fn<(ctx: Vitest) => void>(),
  end: vi.fn<(modules: ReadonlyArray<TestModule>) => Promise<void>>(),
  write: vi.fn<(report: string) => Promise<void>>(),
  restore: vi.fn<(report: string, observations: unknown) => string>(),
  progress: vi.fn<(descriptor: number, bytes: Buffer) => number>(),
}));

vi.mock("vitest/node", () => ({
  JsonReporter: class {
    constructor(protected options: ReporterOptions = {}) {}
    onInit(ctx: Vitest) { hooks.init(ctx); }
    async onTestRunEnd(modules: ReadonlyArray<TestModule>) {
      await hooks.end(modules);
      await this.writeReport(json);
    }
    async writeReport(report: string) { await hooks.write(report); }
  },
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  writeSync: hooks.progress,
}));
vi.mock("../scripts/portfolio/vitest-reporter-diagnostics", () => ({
  restoreVitestTimeoutMessages: hooks.restore,
}));

const snapshot = z.object({
  reason: z.enum(["start", "heartbeat", "end"]),
  sequence: z.number().int().positive(),
  activeCases: z.array(z.object({ collectionOrdinal: z.number().int().nullable() })),
});
const snapshots = () => hooks.progress.mock.calls.map(([descriptor, bytes]) => {
  expect(descriptor).toBe(process.stdout.fd);
  const line = bytes.toString("utf8");
  expect(line).toMatch(/^vitest-progress-v1:/u);
  return snapshot.parse(JSON.parse(line.slice("vitest-progress-v1:".length)));
});
// Only the runner fields consumed by the adapter are needed for lifecycle tests.
const context = (outputFile?: Vitest["config"]["outputFile"]): Vitest => ({
  config: { root: resolve("."), outputFile },
}) as Vitest;

function tasks() {
  const cases: TestCase[] = [];
  const testModule = {
    id: "fixture-module", type: "module", moduleId: resolve("tests/lifecycle.test.ts"),
    children: { *allTests() { yield* cases; } },
  } as TestModule;
  cases.push(...["first", "second"].map((id) => ({
    id, name: id, module: testModule, parent: testModule,
    result: () => ({ state: "passed" as const, errors: undefined }),
  }) as TestCase));
  return { cases, testModule };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  hooks.end.mockResolvedValue(undefined);
  hooks.write.mockResolvedValue(undefined);
  hooks.restore.mockImplementation((report) => report);
  hooks.progress.mockImplementation((_descriptor, bytes) => bytes.byteLength);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("capture reporter progress lifecycle", () => {
  it("keeps the ordinary JSON path free of progress and timers without an output file", async () => {
    const reporter = new PortfolioVitestJsonReporter();
    const ctx = context();
    reporter.onInit(ctx);
    vi.advanceTimersByTime(15_000);
    await reporter.onTestRunEnd([]);
    expect(hooks.init).toHaveBeenCalledWith(ctx);
    expect(hooks.write).toHaveBeenCalledExactlyOnceWith(json);
    expect(hooks.progress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { name: "reporter options", options: { outputFile: "report.json" }, output: undefined },
    { name: "CLI string", options: {}, output: "report.json" },
    { name: "CLI reporter map", options: {}, output: { json: "report.json" } },
  ])("starts progress for $name", async ({ options, output }) => {
    const reporter = new PortfolioVitestJsonReporter(options);
    reporter.onInit(context(output));
    expect(snapshots().map(({ reason }) => reason)).toEqual(["start"]);
    expect(vi.getTimerCount()).toBe(1);
    await reporter.onTestRunEnd([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unrefs its heartbeat and does not emit before five seconds", async () => {
    const intervals = vi.spyOn(globalThis, "setInterval");
    const reporter = new PortfolioVitestJsonReporter({ outputFile: "report.json" });
    reporter.onInit(context());
    const timer = intervals.mock.results[0];
    if (timer?.type !== "return") throw new Error("Heartbeat was not created");
    expect(timer.value.hasRef()).toBe(false);
    vi.advanceTimersByTime(4_999);
    expect(snapshots().map(({ reason }) => reason)).toEqual(["start"]);
    vi.advanceTimersByTime(1);
    expect(snapshots().map(({ reason }) => reason)).toEqual(["start", "heartbeat"]);
    await reporter.onTestRunEnd([]);
    const calls = hooks.progress.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(hooks.progress).toHaveBeenCalledTimes(calls);
  });

  it("clears the old timer on reinitialization, including return to stdout JSON", async () => {
    const reporter = new PortfolioVitestJsonReporter();
    reporter.onInit(context("report.json"));
    vi.advanceTimersByTime(4_000);
    reporter.onInit(context("second.json"));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(snapshots().map(({ reason }) => reason)).toEqual(["start", "start"]);
    vi.advanceTimersByTime(4_000);
    expect(snapshots().at(-1)?.reason).toBe("heartbeat");
    reporter.onInit(context());
    expect(vi.getTimerCount()).toBe(0);
    const calls = hooks.progress.mock.calls.length;
    vi.advanceTimersByTime(5_000);
    await reporter.onTestRunEnd([]);
    expect(hooks.progress).toHaveBeenCalledTimes(calls);
  });

  it.each(["throw", "short write"] as const)(
    "keeps normal JSON and timer cleanup intact after a progress %s", async (failure) => {
      hooks.progress.mockImplementation((_descriptor, bytes) => {
        if (failure === "throw") throw new Error("controlled progress transport failure");
        return bytes.byteLength - 1;
      });
      const reporter = new PortfolioVitestJsonReporter({ outputFile: "report.json" });
      expect(() => reporter.onInit(context())).not.toThrow();
      expect(() => vi.advanceTimersByTime(5_000)).not.toThrow();
      expect(hooks.progress).toHaveBeenCalledTimes(1);
      await expect(reporter.onTestRunEnd([])).resolves.toBeUndefined();
      expect(hooks.write).toHaveBeenCalledExactlyOnceWith(json);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(hooks.progress).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["success", "base reporter error", "collection error"] as const)(
    "always clears terminal state without swallowing %s", async (outcome) => {
      const reporter = new PortfolioVitestJsonReporter({ outputFile: "report.json" });
      reporter.onInit(context());
      const failure = new Error(outcome);
      const { testModule } = tasks();
      if (outcome === "base reporter error") hooks.end.mockRejectedValueOnce(failure);
      if (outcome === "collection error") {
        vi.spyOn(testModule.children, "allTests").mockImplementation(() => { throw failure; });
      }
      const end = reporter.onTestRunEnd([testModule]);
      if (outcome === "success") await expect(end).resolves.toBeUndefined();
      else await expect(end).rejects.toBe(failure);
      expect(hooks.end).toHaveBeenCalledTimes(outcome === "collection error" ? 0 : 1);
      expect(vi.getTimerCount()).toBe(0);
      expect(snapshots().map(({ reason }) => reason)).toEqual(["start", "end"]);
      await expect(reporter.writeReport(json)).rejects.toThrow("observations are unavailable");
      const calls = hooks.progress.mock.calls.length;
      vi.advanceTimersByTime(10_000);
      expect(hooks.progress).toHaveBeenCalledTimes(calls);
    },
  );

  it("assigns collection ordinals only after collection and resets them for a new run", async () => {
    const reporter = new PortfolioVitestJsonReporter({ outputFile: "report.json" });
    const { cases, testModule } = tasks();
    const test = cases[1]!;
    reporter.onInit(context());
    reporter.onTestCaseReady(test);
    vi.advanceTimersByTime(5_000);
    expect(snapshots().at(-1)?.activeCases).toEqual([{ collectionOrdinal: null }]);
    reporter.onTestCaseResult(test);
    reporter.onTestModuleCollected(testModule);
    reporter.onTestCaseReady(test);
    vi.advanceTimersByTime(5_000);
    expect(snapshots().at(-1)?.activeCases).toEqual([{ collectionOrdinal: 2 }]);
    await reporter.onTestRunEnd([testModule]);
    reporter.onInit(context());
    reporter.onTestCaseReady(test);
    vi.advanceTimersByTime(5_000);
    expect(snapshots().at(-1)?.activeCases).toEqual([{ collectionOrdinal: null }]);
    await reporter.onTestRunEnd([]);
  });
});
