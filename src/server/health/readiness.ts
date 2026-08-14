import "server-only";

import { sql } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";

export const DATABASE_READINESS_TIMEOUT_MS = 3_000;
export const DATABASE_READINESS_STATEMENT_TIMEOUT_MS = 2_500;
export const DATABASE_READINESS_FAILURE_COOLDOWN_MS = 1_000;

async function runDatabaseProbe(): Promise<void> {
  if (getDatabaseMode() === "pglite-demo") {
    const database = await getDemoDatabase();
    await database.execute(sql`select 1`);
    return;
  }

  await getDatabase().transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('statement_timeout', ${String(DATABASE_READINESS_STATEMENT_TIMEOUT_MS)}, true)`,
    );
    await transaction.execute(sql`select 1`);
  });
}

export type DatabaseReadinessCoordinator = {
  probe: () => Promise<void>;
};

/**
 * Bounds readiness work to one database operation per process. A timed-out
 * HTTP request cannot cancel every driver/connection-pool wait, so subsequent
 * requests share the outstanding operation instead of accumulating more. Fast
 * failures also receive a short cooldown to avoid hammering an unavailable DB.
 */
export function createDatabaseReadinessCoordinator(options: {
  failureCooldownMs?: number;
  now?: () => number;
  probe: () => Promise<void>;
}): DatabaseReadinessCoordinator {
  const failureCooldownMs =
    options.failureCooldownMs ?? DATABASE_READINESS_FAILURE_COOLDOWN_MS;
  const now = options.now ?? Date.now;
  let inFlight: Promise<void> | undefined;
  let probeGeneration = 0;
  let retryAfterMs = Number.NEGATIVE_INFINITY;

  return {
    probe() {
      if (inFlight) {
        return inFlight;
      }
      if (now() < retryAfterMs) {
        return Promise.reject(
          new Error("database readiness probe is cooling down"),
        );
      }

      const generation = ++probeGeneration;
      const activeProbe = Promise.resolve()
        .then(() => options.probe())
        .then(
          () => {
            retryAfterMs = Number.NEGATIVE_INFINITY;
          },
          (error: unknown) => {
            retryAfterMs = now() + failureCooldownMs;
            throw error;
          },
        )
        .finally(() => {
          if (probeGeneration === generation) {
            inFlight = undefined;
          }
        });
      inFlight = activeProbe;
      return activeProbe;
    },
  };
}

const sharedDatabaseReadiness = createDatabaseReadinessCoordinator({
  probe: runDatabaseProbe,
});

type CheckDatabaseReadinessOptions = {
  probe?: () => Promise<void>;
  timeoutMs?: number;
};

export async function checkDatabaseReadiness({
  probe,
  timeoutMs = DATABASE_READINESS_TIMEOUT_MS,
}: CheckDatabaseReadinessOptions = {}): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      probe ? probe() : sharedDatabaseReadiness.probe(),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("database readiness probe timed out")),
          timeoutMs,
        );
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
