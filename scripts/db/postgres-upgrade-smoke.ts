import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres, { type Sql } from "postgres";

import { getDatabaseUrl } from "../../src/server/db/environment";
import { normalizePostgresConstraintDefinition } from "./postgres-constraint-definition";

const statementSeparator = "--> statement-breakpoint";

async function applyMigrationFile(client: Sql, tag: string): Promise<void> {
  const contents = await readFile(
    resolve(process.cwd(), "drizzle", `${tag}.sql`),
    "utf8",
  );
  const statements = contents
    .split(statementSeparator)
    .map((statement) => statement.trim())
    .filter(Boolean);

  await client.begin(async (transaction) => {
    for (const statement of statements) {
      await transaction.unsafe(statement);
    }
  });
}

async function constraintDefinition(
  client: Sql,
  constraintName: string,
): Promise<string> {
  const rows = await client<{ definition: string }[]>`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conname = ${constraintName}
  `;
  if (rows.length !== 1 || !rows[0]?.definition) {
    throw new Error(`constraint readback failed: ${constraintName}`);
  }
  return normalizePostgresConstraintDefinition(rows[0].definition);
}

async function main(): Promise<void> {
  const baseUrl = new URL(getDatabaseUrl());
  const databaseName = `diesel_upgrade_smoke_${process.pid}`;
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = "/postgres";
  const smokeUrl = new URL(baseUrl);
  smokeUrl.pathname = `/${databaseName}`;
  const admin = postgres(adminUrl.toString(), { max: 1, prepare: false });
  let client: Sql | undefined;

  try {
    await admin.unsafe(`create database "${databaseName}"`);
    client = postgres(smokeUrl.toString(), { max: 1, prepare: false });

    for (let index = 0; index <= 10; index += 1) {
      const prefix = index.toString().padStart(4, "0");
      const tags = [
        "0000_initial_schema",
        "0001_knowledge_hybrid_search",
        "0002_ai_chat_audit",
        "0003_marketing_analysis_tools",
        "0004_admin_data_governance",
        "0005_on_road_truck_bus_scopes",
        "0006_governance_jurisdiction_entity",
        "0007_market_metric_scope_uniqueness",
        "0008_panoramic_hannibal_king",
        "0009_breezy_reptil",
        "0010_military_wilson_fisk",
      ].filter((tag) => tag.startsWith(prefix));
      if (tags.length !== 1 || !tags[0]) {
        throw new Error(`migration tag lookup failed for ${prefix}`);
      }
      await applyMigrationFile(client, tags[0]);
    }

    // Reproduce the legacy 0010 production constraint that admitted an
    // equal-width product. The current bootstrap migration is stricter, so
    // this explicit replacement keeps the upgrade test about real drift.
    await client`
      alter table products drop constraint products_power_check
    `;
    await client`
      alter table products add constraint products_power_check
      check (power_min_kw >= 0 and power_max_kw >= power_min_kw)
    `;
    await client`
      insert into data_sources
        (id, title, source_type, verified_at, is_demo)
      values
        ('00000000-0000-4000-8000-000000000001', 'Upgrade smoke source', 'other', now(), false)
    `;
    await client`
      insert into products
        (id, model_code, name, application_scopes, power_min_kw, power_max_kw,
         specification_version, data_source_id, verified_at, is_demo)
      values
        ('00000000-0000-4000-8000-000000000002', 'UPGRADE-SMOKE', 'Upgrade smoke product',
         array['non-road']::application_scope[], 10, 10, 'legacy-0010',
         '00000000-0000-4000-8000-000000000001', now(), false)
    `;

    let blocked = false;
    try {
      await applyMigrationFile(
        client,
        "0011_temporal_memberships_and_product_power",
      );
    } catch {
      blocked = true;
    }
    if (!blocked) {
      throw new Error("0011 accepted an equal-width legacy product");
    }

    const legacyProductConstraint = await constraintDefinition(
      client,
      "products_power_check",
    );
    if (!legacyProductConstraint.includes("power_max_kw>=power_min_kw")) {
      throw new Error("failed 0011 attempt partially replaced the legacy constraint");
    }
    const legacyMembershipPrimaryKey = await constraintDefinition(
      client,
      "country_jurisdictions_pk",
    );
    if (
      legacyMembershipPrimaryKey !==
      "primarykey(country_iso3,jurisdiction_id)"
    ) {
      throw new Error("failed 0011 attempt partially changed the membership key");
    }
    const dirtyRows = await client<{ count: number }[]>`
      select count(*)::int as count
      from products
      where model_code = 'UPGRADE-SMOKE' and power_min_kw = power_max_kw
    `;
    if (dirtyRows[0]?.count !== 1) {
      throw new Error("failed 0011 attempt did not preserve the legacy row");
    }

    await client`
      update products
      set power_max_kw = 11
      where model_code = 'UPGRADE-SMOKE'
    `;

    // Reproduce a drifted target with no membership key so duplicate starts
    // can be detected before 0011 attempts any DDL.
    await client`
      alter table country_jurisdictions drop constraint country_jurisdictions_pk
    `;
    await client`
      insert into countries
        (iso3, iso2, name_en, data_source_id, verified_at, is_demo)
      values
        ('ZZZ', 'ZZ', 'Upgrade overlap country',
         '00000000-0000-4000-8000-000000000001', now(), false)
    `;
    await client`
      insert into jurisdictions
        (id, code, name, type, country_iso3, data_source_id, verified_at, is_demo)
      values
        ('00000000-0000-4000-8000-000000000003', 'ZZZ-UPGRADE',
         'Upgrade overlap jurisdiction', 'country', 'ZZZ',
         '00000000-0000-4000-8000-000000000001', now(), false)
    `;
    await client`
      insert into country_jurisdictions
        (country_iso3, jurisdiction_id, valid_from, valid_to, data_source_id, verified_at, is_demo)
      values
        ('ZZZ', '00000000-0000-4000-8000-000000000003', '2025-01-01', null,
         '00000000-0000-4000-8000-000000000001', now(), false),
        ('ZZZ', '00000000-0000-4000-8000-000000000003', '2025-01-01', null,
         '00000000-0000-4000-8000-000000000001', now(), false)
    `;

    let duplicateStartBlocked = false;
    try {
      await applyMigrationFile(
        client,
        "0011_temporal_memberships_and_product_power",
      );
    } catch {
      duplicateStartBlocked = true;
    }
    if (!duplicateStartBlocked) {
      throw new Error("0011 accepted duplicate membership start dates");
    }
    const keyAfterDuplicateFailure = await client<{ count: number }[]>`
      select count(*)::int as count
      from pg_constraint
      where conname = 'country_jurisdictions_pk'
    `;
    if (keyAfterDuplicateFailure[0]?.count !== 0) {
      throw new Error("duplicate-blocked 0011 attempt partially created a key");
    }
    const duplicateRows = await client<{ count: number }[]>`
      select count(*)::int as count
      from country_jurisdictions
      where country_iso3 = 'ZZZ'
        and jurisdiction_id = '00000000-0000-4000-8000-000000000003'
        and valid_from = '2025-01-01'
    `;
    if (duplicateRows[0]?.count !== 2) {
      throw new Error("duplicate-blocked 0011 attempt did not preserve both rows");
    }
    if (
      (await constraintDefinition(client, "products_power_check")).includes(
        "power_max_kw>power_min_kw",
      )
    ) {
      throw new Error("duplicate-blocked 0011 attempt partially changed products");
    }

    await client`
      delete from country_jurisdictions
      where ctid in (
        select ctid
        from country_jurisdictions
        where country_iso3 = 'ZZZ'
          and jurisdiction_id = '00000000-0000-4000-8000-000000000003'
          and valid_from = '2025-01-01'
        limit 1
      )
    `;
    await client`
      alter table country_jurisdictions add constraint country_jurisdictions_pk
      primary key (country_iso3, jurisdiction_id, valid_from)
    `;
    await client`
      insert into country_jurisdictions
        (country_iso3, jurisdiction_id, valid_from, valid_to, data_source_id, verified_at, is_demo)
      values
        ('ZZZ', '00000000-0000-4000-8000-000000000003', '2025-06-01', null,
         '00000000-0000-4000-8000-000000000001', now(), false)
    `;

    let overlapBlocked = false;
    try {
      await applyMigrationFile(
        client,
        "0011_temporal_memberships_and_product_power",
      );
    } catch {
      overlapBlocked = true;
    }
    if (!overlapBlocked) {
      throw new Error("0011 accepted overlapping active membership periods");
    }
    if (
      (await constraintDefinition(client, "products_power_check")).includes(
        "power_max_kw>power_min_kw",
      )
    ) {
      throw new Error("overlap-blocked 0011 attempt partially changed products");
    }
    if (
      (await constraintDefinition(client, "country_jurisdictions_pk")) !==
      "primarykey(country_iso3,jurisdiction_id,valid_from)"
    ) {
      throw new Error("overlap-blocked 0011 attempt partially changed the key");
    }

    await client`
      update country_jurisdictions
      set archived_at = now()
      where country_iso3 = 'ZZZ'
        and jurisdiction_id = '00000000-0000-4000-8000-000000000003'
        and valid_from = '2025-01-01'
    `;
    await applyMigrationFile(
      client,
      "0011_temporal_memberships_and_product_power",
    );

    const strictProductConstraint = await constraintDefinition(
      client,
      "products_power_check",
    );
    if (
      !strictProductConstraint.includes("power_min_kw>=0") ||
      !strictProductConstraint.includes("power_max_kw>power_min_kw") ||
      strictProductConstraint.includes("power_max_kw>=power_min_kw")
    ) {
      throw new Error("0011 strict product constraint readback failed");
    }
    const temporalMembershipPrimaryKey = await constraintDefinition(
      client,
      "country_jurisdictions_pk",
    );
    if (
      temporalMembershipPrimaryKey !==
      "primarykey(country_iso3,jurisdiction_id,valid_from)"
    ) {
      throw new Error("0011 temporal membership key readback failed");
    }
    const overlapExclusion = await constraintDefinition(
      client,
      "country_jurisdictions_no_active_overlap",
    );
    if (
      !overlapExclusion.includes("excludeusinggist") ||
      !overlapExclusion.includes(
        "daterangevalid_from,valid_to,'['::textwith&&",
      ) ||
      !overlapExclusion.includes("wherearchived_atisnull")
    ) {
      throw new Error("0011 active overlap exclusion readback failed");
    }

    process.stdout.write(
      "PostgreSQL 0010 -> 0011 dirty-data upgrade smoke passed.\n",
    );
  } finally {
    if (client) {
      await client.end();
    }
    await admin.unsafe(`drop database if exists "${databaseName}"`);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`PostgreSQL upgrade smoke failed: ${message}\n`);
  process.exitCode = 1;
});
