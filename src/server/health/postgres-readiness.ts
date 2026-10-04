import "server-only";

import postgres from "postgres";
import { getDatabaseUrl } from "@/server/db/environment";

export const DATABASE_READINESS_STATEMENT_TIMEOUT_MS = 2_500;

function createReadinessConnection() {
  return postgres(getDatabaseUrl(), {
    connect_timeout: 10,
    connection: {
      application_name: `diesel-readiness-${process.pid}`,
      statement_timeout: DATABASE_READINESS_STATEMENT_TIMEOUT_MS,
      lock_timeout: DATABASE_READINESS_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: DATABASE_READINESS_STATEMENT_TIMEOUT_MS,
    },
    // SELECT 1 needs no custom-type discovery. Keep one reusable connection
    // across idle health checks; never share its short timeout with business SQL.
    fetch_types: false,
    idle_timeout: 0,
    max: 1,
    max_lifetime: 1_800,
    prepare: false,
  });
}

let connection: ReturnType<typeof createReadinessConnection> | undefined;

export async function probePostgresReadiness(): Promise<void> {
  connection ??= createReadinessConnection();
  const rows = await connection.unsafe("select 1 as ready");
  if (rows.length !== 1 || rows[0]?.ready !== 1) {
    throw new Error("Database readiness returned an unexpected result");
  }
}

export async function closeReadinessConnection(): Promise<void> {
  const activeConnection = connection;
  connection = undefined;
  await activeConnection?.end({ timeout: 2 });
}
