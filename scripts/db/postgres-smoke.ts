import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres from "postgres";
import { z } from "zod";

import { getDatabaseUrl } from "../../src/server/db/environment";
import { normalizePostgresConstraintDefinition } from "./postgres-constraint-definition";

const expectedTables = [
  "ai_chat_sessions",
  "ai_citations",
  "ai_tool_calls",
  "api_rate_limit_buckets",
  "countries",
  "country_jurisdictions",
  "data_change_logs",
  "data_governance_drafts",
  "data_sources",
  "document_chunks",
  "documents",
  "jurisdictions",
  "market_import_batches",
  "market_metrics",
  "product_certifications",
  "products",
  "regulation_limits",
  "regulations",
] as const;

const journalSchema = z.object({
  dialect: z.literal("postgresql"),
  entries: z.array(z.object({ tag: z.string().min(1) })),
});

const nameRowsSchema = z.array(z.object({ name: z.string().min(1) }));
const countRowsSchema = z
  .array(z.object({ count: z.coerce.number().int().nonnegative() }))
  .length(1);
const definitionRowsSchema = z
  .array(z.object({ definition: z.string().min(1) }))
  .length(1);

async function main(): Promise<void> {
  const journal = journalSchema.parse(
    JSON.parse(
      await readFile(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
    ),
  );
  const client = postgres(getDatabaseUrl(), { max: 1, prepare: false });

  try {
    const extensionRows = nameRowsSchema.parse(
      await client`select extname as name from pg_extension where extname = 'vector'`,
    );
    if (extensionRows[0]?.name !== "vector") {
      throw new Error("pgvector extension is missing after migrations");
    }

    const tableRows = nameRowsSchema.parse(
      await client`
        select table_name as name
        from information_schema.tables
        where table_schema = 'public'
        order by table_name
      `,
    );
    const actualTables = new Set(tableRows.map(({ name }) => name));
    const missingTables = expectedTables.filter((name) => !actualTables.has(name));
    if (missingTables.length > 0) {
      throw new Error(`missing migrated tables: ${missingTables.join(", ")}`);
    }

    const [{ count }] = countRowsSchema.parse(
      await client`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    if (count !== journal.entries.length) {
      throw new Error(
        `migration journal/readback mismatch: expected ${journal.entries.length}, received ${count}`,
      );
    }

    const [{ definition: productPowerConstraint }] =
      definitionRowsSchema.parse(
        await client`
          select pg_get_constraintdef(oid) as definition
          from pg_constraint
          where conname = 'products_power_check'
        `,
      );
    const normalizedProductConstraint =
      normalizePostgresConstraintDefinition(productPowerConstraint);
    if (
      !normalizedProductConstraint.includes("archived_atisnotnull") ||
      !normalizedProductConstraint.includes("power_min_kw>=0") ||
      !normalizedProductConstraint.includes("power_max_kw>power_min_kw") ||
      normalizedProductConstraint.includes("power_max_kw>=power_min_kw")
    ) {
      throw new Error("latest product power constraint was not applied");
    }

    const [{ definition: membershipPrimaryKey }] =
      definitionRowsSchema.parse(
        await client`
          select pg_get_constraintdef(oid) as definition
          from pg_constraint
          where conname = 'country_jurisdictions_pk'
        `,
      );
    const normalizedMembershipPrimaryKey =
      normalizePostgresConstraintDefinition(membershipPrimaryKey);
    if (
      normalizedMembershipPrimaryKey !==
      "primarykeycountry_iso3,jurisdiction_id,valid_from"
    ) {
      throw new Error("latest temporal membership primary key was not applied");
    }

    const [{ definition: membershipExclusion }] =
      definitionRowsSchema.parse(
        await client`
          select pg_get_constraintdef(oid) as definition
          from pg_constraint
          where conname = 'country_jurisdictions_no_active_overlap'
        `,
      );
    const normalizedMembershipExclusion =
      normalizePostgresConstraintDefinition(membershipExclusion);
    if (
      !normalizedMembershipExclusion.includes("excludeusinggist") ||
      !normalizedMembershipExclusion.includes("country_iso3with=") ||
      !normalizedMembershipExclusion.includes("jurisdiction_idwith=") ||
      !normalizedMembershipExclusion.includes(
        "daterangevalid_from,valid_to,'['::textwith&&",
      ) ||
      !normalizedMembershipExclusion.includes("wherearchived_atisnull")
    ) {
      throw new Error("active membership overlap exclusion readback failed");
    }

    let overlapRejected = false;
    try {
      await client.begin(async (transaction) => {
        await transaction`
          insert into data_sources
            (id, title, source_type, verified_at, is_demo)
          values
            ('00000000-0000-4000-8000-000000000011', 'Overlap smoke source', 'other', now(), false)
        `;
        await transaction`
          insert into countries
            (iso3, iso2, name_en, data_source_id, verified_at, is_demo)
          values
            ('ZZZ', 'ZZ', 'Overlap smoke country', '00000000-0000-4000-8000-000000000011', now(), false)
        `;
        await transaction`
          insert into jurisdictions
            (id, code, name, type, country_iso3, data_source_id, verified_at, is_demo)
          values
            ('00000000-0000-4000-8000-000000000012', 'ZZZ-SMOKE', 'Overlap smoke jurisdiction',
             'country', 'ZZZ', '00000000-0000-4000-8000-000000000011', now(), false)
        `;
        await transaction`
          insert into country_jurisdictions
            (country_iso3, jurisdiction_id, valid_from, valid_to, data_source_id, verified_at, is_demo)
          values
            ('ZZZ', '00000000-0000-4000-8000-000000000012', '2025-01-01', null,
             '00000000-0000-4000-8000-000000000011', now(), false)
        `;
        await transaction`
          insert into country_jurisdictions
            (country_iso3, jurisdiction_id, valid_from, valid_to, data_source_id, verified_at, is_demo)
          values
            ('ZZZ', '00000000-0000-4000-8000-000000000012', '2025-06-01', null,
             '00000000-0000-4000-8000-000000000011', now(), false)
        `;
      });
    } catch (error: unknown) {
      overlapRejected =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23P01";
      if (!overlapRejected) {
        throw error;
      }
    }
    if (!overlapRejected) {
      throw new Error("active membership overlap exclusion accepted a conflict");
    }

    process.stdout.write(
      `PostgreSQL migration smoke passed (${count} migrations, pgvector enabled).\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`PostgreSQL migration smoke failed: ${message}\n`);
  process.exitCode = 1;
});
