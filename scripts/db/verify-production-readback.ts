import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres from "postgres";
import { z } from "zod";

import { getDatabaseUrl } from "../../src/server/db/environment";
import { assertProductionReadback } from "./production-readback";

const journalSchema = z.object({ entries: z.array(z.object({ tag: z.string() })) });

async function main(): Promise<void> {
  const journal = journalSchema.parse(JSON.parse(await readFile(
    resolve(process.cwd(), "drizzle/meta/_journal.json"),
    "utf8",
  )));
  const sql = postgres(getDatabaseUrl(), { max: 1, prepare: false });
  try {
    const [row] = await sql<{
      activeInvalidProducts: number;
      apiRateLimitTableExists: boolean;
      membershipExclusionDefinition: string;
      migrationCount: number;
      productPowerDefinition: string;
      rateLimitCountDefinition: string;
    }[]>`
      select
        (select count(*)::int from drizzle.__drizzle_migrations) as "migrationCount",
        coalesce((select pg_get_constraintdef(oid) from pg_constraint
                  where conname = 'products_power_check'), '') as "productPowerDefinition",
        coalesce((select pg_get_constraintdef(oid) from pg_constraint
                  where conname = 'country_jurisdictions_no_active_overlap'), '')
          as "membershipExclusionDefinition",
        to_regclass('public.api_rate_limit_buckets') is not null
          as "apiRateLimitTableExists",
        coalesce((select pg_get_constraintdef(oid) from pg_constraint
                  where conname = 'api_rate_limit_buckets_count_check'), '')
          as "rateLimitCountDefinition",
        (select count(*)::int from products
          where archived_at is null
            and is_demo = false
            and power_max_kw <= power_min_kw) as "activeInvalidProducts"
    `;
    if (!row) {
      throw new Error("Production readback query returned no row.");
    }
    assertProductionReadback({
      ...row,
      expectedMigrationCount: journal.entries.length,
    });
    process.stdout.write(`${JSON.stringify({
      activeInvalidProducts: row.activeInvalidProducts,
      apiRateLimitTableExists: row.apiRateLimitTableExists,
      migrationCount: row.migrationCount,
      status: "verified",
    })}\n`);
  } finally {
    await sql.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Production readback failed."}\n`,
  );
  process.exitCode = 1;
});
