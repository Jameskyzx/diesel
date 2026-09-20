import { writeSync } from "node:fs";

import { JsonReporter, type TestCase, type TestModule, type Vitest } from "vitest/node";

import {
  restoreVitestTimeoutMessages,
  type VitestReporterErrorObservations,
} from "./vitest-reporter-diagnostics";
import {
  VitestProgressDiagnostics,
  type VitestProgressCaseObservation,
} from "./vitest-progress-diagnostics";

function ancestorTitles(test: TestCase): string[] {
  const titles: string[] = [];
  let parent = test.parent;
  while (parent.type === "suite") {
    titles.unshift(parent.name);
    parent = parent.parent;
  }
  return titles;
}

/** Capture-only adapter: preserve Vitest's JSON contract and structured timeout detail. */
export default class PortfolioVitestJsonReporter extends JsonReporter {
  private observations: VitestReporterErrorObservations | null = null;
  private progress: VitestProgressDiagnostics | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private collectionOrdinals = new WeakMap<TestCase, number>();

  constructor(options: ConstructorParameters<typeof JsonReporter>[0] = {}) {
    super(options);
  }

  override onInit(ctx: Vitest): void {
    super.onInit(ctx);
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.progress = null;
    this.collectionOrdinals = new WeakMap();
    const configuredOutput = ctx.config.outputFile;
    const outputFile = this.options.outputFile ??
      (typeof configuredOutput === "string" ? configuredOutput : configuredOutput?.json);
    // Without an output file, stdout must remain the ordinary JSON transport.
    if (!outputFile) return;
    this.progress = new VitestProgressDiagnostics({
      workspace: ctx.config.root,
      sink: (line) => {
        const bytes = Buffer.from(line, "utf8");
        // Keep transport failures synchronous so diagnostics can stop quietly.
        if (writeSync(process.stdout.fd, bytes) !== bytes.byteLength) {
          throw new Error("Vitest progress output was incomplete.");
        }
      },
    });
    this.progress.emit("start");
    this.heartbeat = setInterval(() => this.progress?.emit("heartbeat"), 5_000);
    this.heartbeat.unref();
  }

  onTestModuleQueued(module: TestModule): void {
    this.progress?.moduleQueued(module);
  }

  onTestModuleCollected(module: TestModule): void {
    if (this.progress === null) return;
    this.progress?.moduleCollected(module);
    let ordinal = 0;
    for (const test of module.children.allTests()) {
      if (ordinal >= 100_000) break;
      this.collectionOrdinals.set(test, ++ordinal);
    }
  }

  onTestModuleStart(module: TestModule): void {
    this.progress?.moduleStarted(module);
  }

  onTestModuleEnd(module: TestModule): void {
    this.progress?.moduleFinished(module);
  }

  onTestCaseReady(test: TestCase): void {
    this.progress?.caseReady(this.progressCase(test));
  }

  onTestCaseResult(test: TestCase): void {
    this.progress?.caseFinished(this.progressCase(test), test.result().state);
  }

  private progressCase(test: TestCase): VitestProgressCaseObservation {
    return {
      id: test.id,
      module: test.module,
      collectionOrdinal: this.collectionOrdinals.get(test) ?? null,
      location: test.location,
    };
  }

  override async onTestRunEnd(modules: ReadonlyArray<TestModule>): Promise<void> {
    try {
      this.observations = modules.map((module) => ({
        file: module.moduleId,
        tests: [...module.children.allTests()].map((test) => {
          const result = test.result();
          return {
            ancestorTitles: ancestorTitles(test),
            title: test.name,
            location: test.location ?? null,
            state: result.state,
            firstError: result.errors?.[0],
          };
        }),
      }));
      await super.onTestRunEnd(modules);
    } finally {
      this.observations = null;
      if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      this.progress?.emit("end");
      this.progress = null;
      this.collectionOrdinals = new WeakMap();
    }
  }

  override async writeReport(report: string): Promise<void> {
    if (this.observations === null) {
      throw new Error("Vitest structured reporter observations are unavailable.");
    }
    await super.writeReport(restoreVitestTimeoutMessages(report, this.observations));
  }
}
