import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "@/server/db/postgres";

import { getDatabaseUrl } from "@/server/db/environment";
import * as schema from "@/server/db/schema";

// Admission only uses built-in scalar PostgreSQL types. Avoid catalog discovery
// and 20-second idle eviction on the latency-critical admission path.
// Keep it separate from long-running business queries and the readiness probe.
export const admissionConnectionOptions = {
  connect_timeout: 10,
  fetch_types: false,
  idle_timeout: 0,
  max: 2,
  max_lifetime: 1_800,
  prepare: false,
} as const;

function createAdmissionConnection() {
  const client = postgres(getDatabaseUrl(), {
    ...admissionConnectionOptions,
    connection: { application_name: `diesel-admission-${process.pid}` },
  });
  return { client, db: drizzle(client, { schema }) };
}

let connection: ReturnType<typeof createAdmissionConnection> | undefined;

export function getAdmissionDatabase() {
  connection ??= createAdmissionConnection();
  return connection.db;
}

export async function closeAdmissionConnection(): Promise<void> {
  const activeConnection = connection;
  connection = undefined;
  await activeConnection?.client.end({ timeout: 2 });
}
