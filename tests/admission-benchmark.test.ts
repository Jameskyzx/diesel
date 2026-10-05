import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { benchmarkSampleSchema, summarizeBenchmark } from "../scripts/ops/admission-benchmark";

const validSamples = Array.from({ length: 20 }, (_, index) => benchmarkSampleSchema.parse({
  phase: index < 3 ? "cold" : index < 7 ? "warm" : index === 7 ? "after-idle" : "concurrent",
  durationMs: (index + 1) * 100, passed: true, error: null,
}));

describe("admission benchmark evidence", () => {
  it("recomputes percentiles from every sample, including failures", () => {
    expect(summarizeBenchmark(validSamples)).toMatchObject({
      sampleCount: 20, failedCount: 0, p50Ms: 1000, p95Ms: 1900, p99Ms: 2000,
      phases: { cold: 3, warm: 4, "after-idle": 1, concurrent: 12 }, passed: true,
    });
    const samples = [...validSamples, { ...validSamples[0], durationMs: 9000, passed: false, error: "application_deadline" as const }];
    expect(summarizeBenchmark(samples)).toMatchObject({ failedCount: 1, p99Ms: 9000, maximumMs: 9000, passed: false });
  });
  it("does not count zero, incomplete or missing-phase samples as successful", () => {
    expect(summarizeBenchmark([])).toMatchObject({ p95Ms: null, passed: false });
    expect(summarizeBenchmark(validSamples.slice(0, 19)).passed).toBe(false);
    expect(summarizeBenchmark(validSamples.map((sample) => ({ ...sample, phase: "warm" }))).passed).toBe(false);
  });
  it("enforces the actual application deadline and refuses inconsistent success", () => {
    expect(summarizeBenchmark(validSamples.map((sample) => ({ ...sample, durationMs: 8000 }))).passed).toBe(false);
    expect(summarizeBenchmark(validSamples.map((sample) => ({ ...sample, error: "database_error" }))).passed).toBe(false);
  });
  it("rejects non-finite timings, extra private fields and unknown outcomes", () => {
    expect(() => benchmarkSampleSchema.parse({ ...validSamples[0], durationMs: Number.NaN })).toThrow();
    expect(() => benchmarkSampleSchema.parse({ ...validSamples[0], databaseUrl: "PRIVATE" })).toThrow();
    expect(() => benchmarkSampleSchema.parse({ ...validSamples[0], error: "private raw error" })).toThrow();
  });
});
