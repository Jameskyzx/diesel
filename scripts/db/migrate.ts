import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { getDatabaseUrl } from "../../src/server/db/environment";

async function main(): Promise<void> {
  const client = postgres(getDatabaseUrl(), {
    max: 1,
    prepare: false,
  });

  try {
    await migrate(drizzle(client), {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
    process.stdout.write("Database migrations completed.\n");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Database migration failed: ${message}\n`);
  process.exitCode = 1;
});
