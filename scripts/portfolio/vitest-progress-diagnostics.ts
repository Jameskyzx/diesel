import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const VITEST_PROGRESS_LINE_PREFIX = "vitest-progress-v1:";
export const VITEST_PROGRESS_MAX_LINE_BYTES = 4 * 1024;
export const VITEST_PROGRESS_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const VITEST_PROGRESS_MAX_ACTIVE_MODULES = 32;
export const VITEST_PROGRESS_MAX_ACTIVE_CASES = 64;

const MAX_IDENTIFIER_LENGTH = 4_096;
const MAX_PUBLIC_PATH_LENGTH = 256;
const LIMIT_NOTICE_RESERVE_BYTES = 1_024;

export type VitestProgressModuleObservation = Readonly<{
  id: string;
  moduleId: string;
}>;

export type VitestProgressCaseObservation = Readonly<{
  id: string;
  module: VitestProgressModuleObservation;
  collectionOrdinal?: number | null;
  location?: Readonly<{ line: number; column: number }>;
}>;

type ModulePhase = "queued" | "collected" | "running";
type ProgressReason = "start" | "heartbeat" | "end";
type ActiveModule = {
  id: string;
  file: string | null;
  phase: ModulePhase;
  observedAt: number;
};
type ActiveCase = {
  id: string;
  moduleId: string;
  file: string | null;
  collectionOrdinal: number | null;
  location: { line: number; column: number } | null;
  observedAt: number;
};
type Counts = {
  queuedModuleEvents: number;
  collectedModuleEvents: number;
  startedModuleEvents: number;
  completedModuleEvents: number;
  startedCaseEvents: number;
  completedCaseEvents: number;
  passedCaseEvents: number;
  failedCaseEvents: number;
  skippedCaseEvents: number;
};

function increment(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1);
}

function elapsed(now: number, startedAt: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, now - startedAt));
}

function identifier(value: string): boolean {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH;
}

function diagnosticId(kind: "module" | "case", parts: readonly string[]): string {
  // These are local progress IDs, deliberately not canonical evidence IDs.
  return createHash("sha256")
    .update(JSON.stringify(["vitest-progress-diagnostics-v1", kind, ...parts]))
    .digest("hex");
}

function publicTestPath(workspace: string, moduleId: string): string | null {
  if (!isAbsolute(moduleId) || resolve(moduleId) !== moduleId) return null;
  const path = relative(workspace, moduleId).split(sep).join("/");
  return path.length <= MAX_PUBLIC_PATH_LENGTH &&
      /^tests\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.test\.ts$/u.test(path)
    ? path
    : null;
}

function publicLocation(
  location: VitestProgressCaseObservation["location"],
): ActiveCase["location"] {
  if (location === undefined) return null;
  const valid = (value: number) =>
    Number.isSafeInteger(value) && value > 0 && value <= 10_000_000;
  return valid(location.line) && valid(location.column)
    ? { line: location.line, column: location.column }
    : null;
}

function publicOrdinal(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) &&
      value > 0 && value <= 100_000
    ? value
    : null;
}

/**
 * Best-effort local diagnostics only: never changes test results or evidence.
 * Names, errors, metadata and environment are not accepted as observations.
 * Counts describe received events, not a canonical test inventory. Overflow
 * event counts are cumulative; they are not an exact count of unseen tasks.
 */
export class VitestProgressDiagnostics {
  private readonly modules = new Map<string, ActiveModule>();
  private readonly cases = new Map<string, ActiveCase>();
  private readonly counts: Counts = {
    queuedModuleEvents: 0,
    collectedModuleEvents: 0,
    startedModuleEvents: 0,
    completedModuleEvents: 0,
    startedCaseEvents: 0,
    completedCaseEvents: 0,
    passedCaseEvents: 0,
    failedCaseEvents: 0,
    skippedCaseEvents: 0,
  };
  private omittedModuleEvents = 0;
  private omittedCaseEvents = 0;
  private sequence = 0;
  private writtenBytes = 0;
  private stopped = false;
  private startedAt: number | undefined;
  private lastNow = 0;

  constructor(private readonly options: Readonly<{
    workspace: string;
    sink: (line: string) => void;
    now?: () => number;
  }>) {}

  private now(): number {
    try {
      const value = (this.options.now ?? Date.now)();
      if (Number.isSafeInteger(value) && value >= 0) {
        this.lastNow = Math.max(this.lastNow, value);
      }
    } catch {
      // A diagnostic clock cannot interrupt a reporter lifecycle callback.
    }
    this.startedAt ??= this.lastNow;
    return this.lastNow;
  }

  private moduleIdentity(module: VitestProgressModuleObservation) {
    if (!identifier(module.id) || !identifier(module.moduleId)) return null;
    return {
      id: diagnosticId("module", [module.moduleId, module.id]),
      file: publicTestPath(this.options.workspace, module.moduleId),
    };
  }

  private caseIdentity(test: VitestProgressCaseObservation) {
    const testModule = this.moduleIdentity(test.module);
    if (testModule === null || !identifier(test.id)) return null;
    return {
      id: diagnosticId("case", [testModule.id, test.id]),
      moduleId: testModule.id,
      file: testModule.file,
      collectionOrdinal: publicOrdinal(test.collectionOrdinal),
      location: publicLocation(test.location),
    };
  }

  private observeModule(
    observation: VitestProgressModuleObservation,
    phase: ModulePhase,
  ): void {
    const identity = this.moduleIdentity(observation);
    if (identity === null) {
      this.omittedModuleEvents = increment(this.omittedModuleEvents);
      return;
    }
    const existing = this.modules.get(identity.id);
    if (existing !== undefined) {
      existing.phase = phase;
      return;
    }
    if (this.modules.size >= VITEST_PROGRESS_MAX_ACTIVE_MODULES) {
      this.omittedModuleEvents = increment(this.omittedModuleEvents);
      return;
    }
    this.modules.set(identity.id, { ...identity, phase, observedAt: this.now() });
  }

  moduleQueued(module: VitestProgressModuleObservation): void {
    if (this.stopped) return;
    this.counts.queuedModuleEvents = increment(this.counts.queuedModuleEvents);
    this.observeModule(module, "queued");
  }

  moduleCollected(module: VitestProgressModuleObservation): void {
    if (this.stopped) return;
    this.counts.collectedModuleEvents = increment(this.counts.collectedModuleEvents);
    this.observeModule(module, "collected");
  }

  moduleStarted(module: VitestProgressModuleObservation): void {
    if (this.stopped) return;
    this.counts.startedModuleEvents = increment(this.counts.startedModuleEvents);
    this.observeModule(module, "running");
  }

  moduleFinished(module: VitestProgressModuleObservation): void {
    if (this.stopped) return;
    this.counts.completedModuleEvents = increment(this.counts.completedModuleEvents);
    const identity = this.moduleIdentity(module);
    if (identity === null) return;
    this.modules.delete(identity.id);
    for (const [id, test] of this.cases) {
      if (test.moduleId === identity.id) this.cases.delete(id);
    }
  }

  caseReady(test: VitestProgressCaseObservation): void {
    if (this.stopped) return;
    this.counts.startedCaseEvents = increment(this.counts.startedCaseEvents);
    const identity = this.caseIdentity(test);
    if (identity === null) {
      this.omittedCaseEvents = increment(this.omittedCaseEvents);
      return;
    }
    if (this.cases.has(identity.id)) return;
    if (this.cases.size >= VITEST_PROGRESS_MAX_ACTIVE_CASES) {
      this.omittedCaseEvents = increment(this.omittedCaseEvents);
      return;
    }
    this.cases.set(identity.id, { ...identity, observedAt: this.now() });
  }

  caseFinished(test: VitestProgressCaseObservation, state: string): void {
    if (this.stopped) return;
    const identity = this.caseIdentity(test);
    if (identity !== null) this.cases.delete(identity.id);
    this.counts.completedCaseEvents = increment(this.counts.completedCaseEvents);
    if (state === "passed") {
      this.counts.passedCaseEvents = increment(this.counts.passedCaseEvents);
    } else if (state === "failed") {
      this.counts.failedCaseEvents = increment(this.counts.failedCaseEvents);
    } else if (state === "skipped") {
      this.counts.skippedCaseEvents = increment(this.counts.skippedCaseEvents);
    }
  }

  private line(reason: ProgressReason, budgetExhausted = false): string {
    const now = this.now();
    const activeModules: Array<Omit<ActiveModule, "observedAt"> & {
      elapsedMs: number;
    }> = [];
    const activeCases: Array<Omit<ActiveCase, "observedAt"> & {
      elapsedMs: number;
    }> = [];
    const snapshot = () => ({
      version: "vitest-progress-diagnostics-v1",
      diagnosticOnly: true,
      reason,
      sequence: this.sequence,
      elapsedMs: elapsed(now, this.startedAt ?? now),
      activeModules,
      activeCases,
      counts: this.counts,
      omitted: {
        activeModuleRecords: this.modules.size - activeModules.length,
        activeCaseRecords: this.cases.size - activeCases.length,
        moduleEvents: this.omittedModuleEvents,
        caseEvents: this.omittedCaseEvents,
      },
      truncated: budgetExhausted || this.modules.size > activeModules.length ||
        this.cases.size > activeCases.length || this.omittedModuleEvents > 0 ||
        this.omittedCaseEvents > 0,
      budgetExhausted,
    });
    const encode = () => `${VITEST_PROGRESS_LINE_PREFIX}${JSON.stringify(snapshot())}\n`;
    if (budgetExhausted) return encode();
    const oldestFirst = (
      left: { id: string; observedAt: number },
      right: { id: string; observedAt: number },
    ) => left.observedAt - right.observedAt || left.id.localeCompare(right.id);
    // Prioritize oldest active cases over module summaries when space is scarce.
    for (const { observedAt, ...test } of [...this.cases.values()].sort(oldestFirst)) {
      activeCases.push({ ...test, elapsedMs: elapsed(now, observedAt) });
      if (Buffer.byteLength(encode(), "utf8") > VITEST_PROGRESS_MAX_LINE_BYTES) {
        activeCases.pop();
      }
    }
    for (const { observedAt, ...module } of [...this.modules.values()].sort(oldestFirst)) {
      activeModules.push({ ...module, elapsedMs: elapsed(now, observedAt) });
      if (Buffer.byteLength(encode(), "utf8") > VITEST_PROGRESS_MAX_LINE_BYTES) {
        activeModules.pop();
      }
    }
    return encode();
  }

  emit(reason: ProgressReason): void {
    if (this.stopped) return;
    try {
      this.sequence = increment(this.sequence);
      let line = this.line(reason);
      let bytes = Buffer.byteLength(line, "utf8");
      if (this.writtenBytes + bytes >
          VITEST_PROGRESS_MAX_TOTAL_BYTES - LIMIT_NOTICE_RESERVE_BYTES) {
        line = this.line(reason, true);
        bytes = Buffer.byteLength(line, "utf8");
        this.stopped = true;
      }
      if (bytes > VITEST_PROGRESS_MAX_LINE_BYTES ||
          this.writtenBytes + bytes > VITEST_PROGRESS_MAX_TOTAL_BYTES) {
        this.stopped = true;
        return;
      }
      this.options.sink(line);
      this.writtenBytes += bytes;
    } catch {
      // Diagnostic transport, encoding or clock failures cannot change a test.
      this.stopped = true;
    } finally {
      if (reason === "end") this.stopped = true;
      if (this.stopped) {
        this.modules.clear();
        this.cases.clear();
      }
    }
  }
}
