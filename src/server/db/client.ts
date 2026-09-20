import "server-only";

import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getDatabaseUrl } from "@/server/db/environment";
import * as schema from "@/server/db/schema";

export const databaseApplicationName =
  `diesel-app-${process.pid}-${randomUUID()}`;

function createConnection() {
  const client = postgres(getDatabaseUrl(), {
    connect_timeout: 10,
    connection: {
      application_name: databaseApplicationName,
      idle_in_transaction_session_timeout: 60_000,
      lock_timeout: 10_000,
      statement_timeout: 120_000,
    },
    idle_timeout: 20,
    max: 10,
    prepare: false,
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

type DatabaseConnection = ReturnType<typeof createConnection>;

let connection: DatabaseConnection | undefined;

export function getDatabase(): DatabaseConnection["db"] {
  connection ??= createConnection();
  return connection.db;
}

export async function closeDatabaseConnection(
  timeoutSeconds = 5,
): Promise<void> {
  const activeConnection = connection;
  connection = undefined;
  if (activeConnection) {
    await activeConnection.client.end({ timeout: timeoutSeconds });
  }
}
