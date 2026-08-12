import { createHash } from "node:crypto";

import { type SQL, sql } from "drizzle-orm";

export const governanceMaintenanceTokenEnvironmentVariable =
  "DIESEL_GOVERNANCE_MAINTENANCE_TOKEN";

// Stable, application-owned PostgreSQL advisory-lock namespace. Keep this value
// unchanged across releases so old and new application processes interoperate.
export const governanceMaintenanceLockKey = "-6847213950274191183";

const maintenanceTokenSchema = /^[0-9a-f]{64}$/;

export type GovernanceLockExecutor = {
  execute(query: SQL): Promise<unknown>;
};

export class GovernanceMaintenanceError extends Error {
  constructor() {
    super("Governance writes are temporarily unavailable during maintenance.");
    this.name = "GovernanceMaintenanceError";
  }
}

export function deriveGovernanceMaintenanceTokenLockKey(token: string): string {
  if (!maintenanceTokenSchema.test(token)) {
    throw new GovernanceMaintenanceError();
  }

  const digest = createHash("sha256")
    .update("diesel-governance-maintenance-v1\0")
    .update(token)
    .digest();
  const key = digest.readBigInt64BE(0).toString();
  return key === governanceMaintenanceLockKey
    ? digest.readBigInt64BE(8).toString()
    : key;
}

export function buildGovernanceWriteLockQuery(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SQL {
  const token = environment[governanceMaintenanceTokenEnvironmentVariable];
  if (token) {
    const tokenLockKey = deriveGovernanceMaintenanceTokenLockKey(token);
    return sql`select not pg_try_advisory_xact_lock(${tokenLockKey}::bigint) as allowed`;
  }

  return sql`select pg_try_advisory_xact_lock_shared(${governanceMaintenanceLockKey}::bigint) as allowed`;
}

export function governanceWriteLocksAreSupported(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  // PGlite does not implement PostgreSQL advisory locks. It is permitted only
  // for tests and the explicit local portfolio demo, never for production.
  return !(
    environment.NODE_ENV === "test" ||
    (environment.NODE_ENV === "development" &&
      environment.DATABASE_MODE === "pglite-demo")
  );
}

function readAllowed(result: unknown): boolean {
  if (Array.isArray(result)) {
    const row = result[0];
    return (
      typeof row === "object" &&
      row !== null &&
      (row as Record<string, unknown>).allowed === true
    );
  }
  if (typeof result === "object" && result !== null && "rows" in result) {
    return readAllowed((result as { rows: unknown }).rows);
  }
  return false;
}

export async function assertGovernanceWriteAllowed(
  transaction: GovernanceLockExecutor,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  if (!governanceWriteLocksAreSupported(environment)) {
    return;
  }

  const result = await transaction.execute(
    buildGovernanceWriteLockQuery(environment),
  );
  if (!readAllowed(result)) {
    throw new GovernanceMaintenanceError();
  }
}

/**
 * Authorizes a destructive snapshot restore only when the maintenance wrapper
 * still owns the token-derived session lock. Unlike an ordinary governance
 * write, production restores may not fall back to the shared global lock.
 */
export async function assertGovernanceMaintenanceAuthorized(
  transaction: GovernanceLockExecutor,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  if (!governanceWriteLocksAreSupported(environment)) {
    return;
  }
  if (!environment[governanceMaintenanceTokenEnvironmentVariable]) {
    throw new GovernanceMaintenanceError();
  }

  const result = await transaction.execute(
    buildGovernanceWriteLockQuery(environment),
  );
  if (!readAllowed(result)) {
    throw new GovernanceMaintenanceError();
  }
}
