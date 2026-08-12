import "server-only";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";

import * as schema from "@/server/db/schema";
import { seedDemoData } from "@/server/db/seed/demo-data";

export async function createDemoConnection() {
  const client = new PGlite({ extensions: { vector } });
  const database = drizzle(client, { schema });

  await migrate(database, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  await seedDemoData(database);

  return {
    client,
    database,
  };
}

type DemoConnection = Awaited<ReturnType<typeof createDemoConnection>>;

const runtime = globalThis as typeof globalThis & {
  __demoDatabaseConnection?: Promise<DemoConnection>;
};

export function getDemoDatabase(): Promise<DemoConnection["database"]> {
  runtime.__demoDatabaseConnection ??= createDemoConnection();

  return runtime.__demoDatabaseConnection.then(({ database }) => database);
}
