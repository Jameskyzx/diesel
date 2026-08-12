import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getDatabaseUrl } from "@/server/db/environment";
import * as schema from "@/server/db/schema";

function createConnection() {
  const client = postgres(getDatabaseUrl(), {
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
