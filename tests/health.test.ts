import { describe, expect, it } from "vitest";

import {
  createHealthPayload,
  createReadinessPayload,
  healthResponseSchema,
  readinessResponseSchema,
} from "@/lib/health";
import {
  checkDatabaseReadiness,
  createDatabaseReadinessCoordinator,
} from "@/server/health/readiness";

describe("createHealthPayload", () => {
  it("creates a deterministic, structured health response", () => {
    const now = new Date("2026-07-29T00:00:00.000Z");

    const payload = createHealthPayload({
      now,
      version: "test",
    });

    expect(payload).toEqual({
      service: "global-diesel-regulations",
      status: "ok",
      timestamp: "2026-07-29T00:00:00.000Z",
      version: "test",
    });
    expect(healthResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects an empty version", () => {
    expect(() =>
      createHealthPayload({
        version: "",
      }),
    ).toThrow();
  });
});

describe("readiness", () => {
  it("executes the real read-only probe against the demo PostgreSQL runtime", async () => {
    const originalMode = process.env.DATABASE_MODE;
    process.env.DATABASE_MODE = "pglite-demo";

    try {
      await expect(
        checkDatabaseReadiness({ timeoutMs: 10_000 }),
      ).resolves.toBe(true);
    } finally {
      if (originalMode === undefined) {
        delete process.env.DATABASE_MODE;
      } else {
        process.env.DATABASE_MODE = originalMode;
      }
    }
  }, 15_000);

  it("reports the database check separately from liveness", () => {
    expect(
      readinessResponseSchema.parse(
        createReadinessPayload({
          now: new Date("2026-08-15T00:00:00.000Z"),
          ready: false,
          version: "test-version",
        }),
      ),
    ).toEqual({
      service: "global-diesel-regulations",
      status: "unavailable",
      timestamp: "2026-08-15T00:00:00.000Z",
      version: "test-version",
      checks: { database: "unavailable" },
    });
  });

  it("returns ready after a successful read-only database probe", async () => {
    await expect(
      checkDatabaseReadiness({ probe: async () => undefined, timeoutMs: 50 }),
    ).resolves.toBe(true);
  });

  it("fails closed when the database probe rejects", async () => {
    await expect(
      checkDatabaseReadiness({
        probe: async () => {
          throw new Error("database unavailable");
        },
        timeoutMs: 50,
      }),
    ).resolves.toBe(false);
  });

  it("fails closed when the database probe exceeds its deadline", async () => {
    await expect(
      checkDatabaseReadiness({
        probe: () => new Promise(() => undefined),
        timeoutMs: 1,
      }),
    ).resolves.toBe(false);
  });

  it("shares a still-running database probe across readiness requests", async () => {
    let finishProbe: (() => void) | undefined;
    let probeCalls = 0;
    const coordinator = createDatabaseReadinessCoordinator({
      probe: () => {
        probeCalls += 1;
        return new Promise<void>((resolve) => {
          finishProbe = resolve;
        });
      },
    });

    const first = coordinator.probe();
    const second = coordinator.probe();

    expect(second).toBe(first);
    await Promise.resolve();
    expect(probeCalls).toBe(1);
    finishProbe?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("cools down after a fast database failure", async () => {
    let nowMs = 1_000;
    let probeCalls = 0;
    const coordinator = createDatabaseReadinessCoordinator({
      failureCooldownMs: 500,
      now: () => nowMs,
      probe: () => {
        probeCalls += 1;
        throw new Error("database unavailable");
      },
    });

    await expect(coordinator.probe()).rejects.toThrow("database unavailable");
    await expect(coordinator.probe()).rejects.toThrow("cooling down");
    expect(probeCalls).toBe(1);

    nowMs += 501;
    await expect(coordinator.probe()).rejects.toThrow("database unavailable");
    expect(probeCalls).toBe(2);
  });
});
