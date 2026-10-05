import "server-only";

import postgres from "@/server/db/postgres";
import { z } from "zod";
import { getDatabaseUrl } from "@/server/db/environment";

export const DATABASE_READINESS_STATEMENT_TIMEOUT_MS = 2_500;

// A transaction-pooling proxy may ignore startup timeout parameters. Send the
// explicit transaction and SET LOCAL in one simple-protocol packet instead.
export const DATABASE_READINESS_SQL = "BEGIN READ ONLY; SET LOCAL statement_timeout = '2500ms'; SELECT 1 AS ready; COMMIT";
const emptyCommandResult = z.array(z.unknown()).length(0);
const readinessBatchSchema = z.tuple([
  // postgres.js starts a new Result on RowDescription, not CommandComplete:
  // BEGIN/SET share the empty result; SELECT/COMMIT share the row result.
  emptyCommandResult,
  z.array(z.object({ ready: z.literal(1) })).length(1),
]);

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
  const activeConnection = connection;
  try {
    readinessBatchSchema.parse(await activeConnection.unsafe(DATABASE_READINESS_SQL).simple());
  } catch (error: unknown) {
    // A failed simple-protocol transaction skips COMMIT. Retire this bounded
    // client rather than returning a possibly aborted transaction to our pool.
    if (connection === activeConnection) connection = undefined;
    await activeConnection.end({ timeout: 1 });
    throw error;
  }
}

export async function closeReadinessConnection(): Promise<void> {
  const activeConnection = connection;
  connection = undefined;
  await activeConnection?.end({ timeout: 2 });
}
