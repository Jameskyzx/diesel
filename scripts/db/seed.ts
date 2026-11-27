import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "../../src/server/db/postgres";

import { getDatabaseUrl } from "../../src/server/db/environment";
import * as schema from "../../src/server/db/schema";
import {
  seedCountryDirectory,
  seedDemoData,
} from "../../src/server/db/seed/demo-data";

async function main(): Promise<void> {
  const client = postgres(getDatabaseUrl(), {
    max: 1,
    prepare: false,
  });
  const database = drizzle(client, { schema });

  try {
    if (process.argv.slice(2).join(" ") === "--country-directory-only") {
      await seedCountryDirectory(database);
      process.stdout.write(
        "Country directory seeded (Natural Earth, public domain, non-demo).\n",
      );
      return;
    }
    if (process.argv.length > 2) {
      throw new Error("Usage: seed.ts [--country-directory-only]");
    }
    await seedDemoData(database);
    process.stdout.write(
      "Seed completed. Demo fixtures are fictional and marked is_demo; the country directory is derived from Natural Earth (public domain).\n",
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Demo seed failed: ${message}\n`);
  process.exitCode = 1;
});
