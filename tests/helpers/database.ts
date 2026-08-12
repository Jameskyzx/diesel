import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@/server/db/schema";

export async function createTestDatabase() {
  const client = new PGlite({ extensions: { vector } });
  const database = drizzle(client, { schema });

  await migrate(database, {
    migrationsFolder: "drizzle",
  });

  return {
    client,
    database,
  };
}
