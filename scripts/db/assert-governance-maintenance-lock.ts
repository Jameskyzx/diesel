import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getDatabaseUrl } from "../../src/server/db/environment";
import { assertGovernanceMaintenanceAuthorized } from "../../src/server/db/governance-maintenance-lock";

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.DATABASE_MODE !== "postgres"
  ) {
    throw new Error("Production PostgreSQL maintenance mode is required");
  }

  const client = postgres(getDatabaseUrl(), {
    connect_timeout: 5,
    idle_timeout: undefined,
    max: 1,
    max_lifetime: null,
    prepare: false,
  });
  try {
    const database = drizzle(client);
    await database.transaction((transaction) =>
      assertGovernanceMaintenanceAuthorized(transaction),
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch(() => {
  // This probe is a capability check. Never print the database URL, token, or
  // provider error details on a production deployment path.
  process.stderr.write(
    "Governance maintenance lock ownership could not be verified.\n",
  );
  process.exitCode = 70;
});
