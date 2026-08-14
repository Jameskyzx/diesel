import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyInvalidProductManifest,
  assertValidInvalidProductManifest,
  INVALID_PRODUCT_EXPECTED_COUNT,
  type MaintenanceSqlClient,
  type MaintenanceSqlParameter,
  readInvalidProductManifest,
} from "../scripts/db/invalid-product-maintenance";

const databases: PGlite[] = [];
const sourceId = "00000000-0000-4000-8000-000000000500";

function productId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function createDatabase(productCount = INVALID_PRODUCT_EXPECTED_COUNT) {
  const database = new PGlite();
  databases.push(database);
  await database.exec(`
    create table data_sources (
      id uuid primary key,
      title text not null,
      source_type text not null,
      url text,
      is_demo boolean not null,
      archived_at timestamptz
    );
    create table products (
      id uuid primary key,
      model_code text not null,
      power_min_kw numeric not null,
      power_max_kw numeric not null,
      specification_version text not null,
      verified_at timestamptz not null,
      is_demo boolean not null,
      data_source_id uuid not null references data_sources(id),
      archived_at timestamptz,
      updated_at timestamptz not null
    );
    create table product_certifications (
      id uuid primary key,
      product_id uuid not null references products(id),
      regulation_id uuid not null,
      application_scope text not null,
      certificate_number text,
      status text not null,
      power_min_kw numeric,
      power_max_kw numeric,
      valid_from date,
      valid_to date,
      verified_at timestamptz not null,
      is_demo boolean not null,
      data_source_id uuid not null references data_sources(id),
      archived_at timestamptz,
      updated_at timestamptz not null
    );
    create table data_change_logs (
      id uuid primary key,
      entity_type text not null,
      entity_key text not null,
      action text not null,
      actor_email text not null,
      actor_role text not null,
      before_data jsonb,
      after_data jsonb,
      reason text not null,
      created_at timestamptz not null
    );
  `);
  await database.query(
    `insert into data_sources (id, title, source_type, url, is_demo)
     values ($1, 'Unapproved product spreadsheet', 'other', 'https://example.com/source', false)`,
    [sourceId],
  );
  for (let index = 1; index <= productCount; index += 1) {
    await database.query(
      `insert into products
         (id, model_code, power_min_kw, power_max_kw, specification_version,
          verified_at, is_demo, data_source_id, updated_at)
       values ($1, $2, $3, $3, 'v1', '2026-08-14T00:00:00Z', false, $4, now())`,
      [productId(index), `WP-DEMO-${index}`, 100 + index, sourceId],
    );
  }
  if (productCount > 0) {
    await database.query(
      `insert into product_certifications
         (id, product_id, regulation_id, application_scope, certificate_number,
          status, power_min_kw, power_max_kw, valid_from, valid_to, verified_at,
          is_demo, data_source_id, updated_at)
       values ('00000000-0000-4000-8000-000000000600', $1,
               '00000000-0000-4000-8000-000000000700', 'non-road', 'CERT-1',
               'certified', 0, 200, '2025-01-01', '2030-01-01',
               '2026-08-14T00:00:00Z', false, $2, now())`,
      [productId(1), sourceId],
    );
  }
  const client: MaintenanceSqlClient = {
    async query<TRow extends Record<string, unknown>>(
      text: string,
      parameters: readonly MaintenanceSqlParameter[] = [],
    ) {
      return {
        rows: (await database.query<TRow>(text, [...parameters])).rows,
      };
    },
  };
  return { client, database };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("invalid unpublished product maintenance", () => {
  it("creates an exact eight-product dry-run manifest", async () => {
    const { client } = await createDatabase();
    const manifest = await readInvalidProductManifest(
      client,
      new Date("2026-08-15T00:00:00Z"),
    );

    expect(manifest.products).toHaveLength(8);
    expect(manifest.products[0]).toMatchObject({
      certifications: [expect.objectContaining({ certificateNumber: "CERT-1" })],
      isDemo: false,
      modelCode: "WP-DEMO-1",
      powerMaxKw: "101",
      powerMinKw: "101",
    });
    expect(assertValidInvalidProductManifest(manifest)).toEqual(manifest);
  });

  it("archives certifications before products and appends one audit per entity", async () => {
    const { client, database } = await createDatabase();
    const manifest = await readInvalidProductManifest(client);
    const result = await applyInvalidProductManifest({
      actorEmail: "operator@example.com",
      client,
      expectedManifest: manifest,
      now: new Date("2026-08-15T01:00:00Z"),
      reason: "Archive unsigned invalid production rows after exact dry-run review.",
    });

    expect(result).toEqual({ archivedCertifications: 1, archivedProducts: 8 });
    const [counts] = (await database.query<{
      activeCertifications: number;
      activeProducts: number;
      audits: number;
    }>(`select
      (select count(*)::int from products where archived_at is null) as "activeProducts",
      (select count(*)::int from product_certifications where archived_at is null) as "activeCertifications",
      (select count(*)::int from data_change_logs) as "audits"`)).rows;
    expect(counts).toEqual({ activeCertifications: 0, activeProducts: 0, audits: 9 });
  });

  it("rolls back when the live rows drift from the reviewed manifest", async () => {
    const { client, database } = await createDatabase();
    const manifest = await readInvalidProductManifest(client);
    await database.query(
      "update data_sources set title = 'Changed after dry run' where id = $1",
      [sourceId],
    );

    await expect(applyInvalidProductManifest({
      actorEmail: "operator@example.com",
      client,
      expectedManifest: manifest,
      reason: "Expected to fail.",
    })).rejects.toThrow(/do not exactly match/);
    const [counts] = (await database.query<{ active: number; audits: number }>(
      `select
         (select count(*)::int from products where archived_at is null) as active,
         (select count(*)::int from data_change_logs) as audits`,
    )).rows;
    expect(counts).toEqual({ active: 8, audits: 0 });
  });

  it(
    "fails closed on count or manifest hash drift",
    async () => {
      const { client } = await createDatabase(7);
      await expect(readInvalidProductManifest(client)).rejects.toThrow(
        /Expected exactly 8/,
      );

      const valid = await readInvalidProductManifest(
        (await createDatabase()).client,
      );
      const changed = structuredClone(valid);
      changed.products[0]!.modelCode = "CHANGED";
      expect(() => assertValidInvalidProductManifest(changed)).toThrow(/SHA256/);
    },
    15_000,
  );
});
