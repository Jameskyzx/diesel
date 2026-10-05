import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applicationFingerprintQuery } from "../scripts/db/application-fingerprint-query";
import { applicationDataTables, applicationFingerprintSchema } from "../scripts/deploy/application-release-contract";
import { createTestDatabase } from "./helpers/database";

describe("application-only database fingerprint SQL", () => {
  it("executes against every actual migrated governed table inside a read-only transaction", async () => {
    const { client } = await createTestDatabase();
    try {
      await client.exec("begin isolation level repeatable read read only; set local timezone = 'UTC'; set local extra_float_digits = 3");
      for (const table of applicationDataTables) {
        const { rows } = await client.query<{ count: number; sha256: string }>(applicationFingerprintQuery(table));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.sha256).toMatch(/^[0-9a-f]{64}$/u);
        expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["count", "sha256"]);
        if (table !== "drizzle.__drizzle_migrations") expect(rows[0]?.count).toBe(0);
        else expect(rows[0]?.count).toBeGreaterThan(0);
      }
      await client.exec("rollback");
    } finally { await client.close(); }
  }, 30_000);

  it("is order-independent but detects duplicate, content and deletion changes without returning content", async () => {
    const client = new PGlite();
    try {
      await client.exec("create table documents (id integer, content text, metadata jsonb)");
      const fingerprint = async () => (await client.query(applicationFingerprintQuery("documents"))).rows[0];
      expect(await fingerprint()).toEqual({ count: 0, sha256: createHash("sha256").update("").digest("hex") });
      await client.exec("insert into documents values (2, 'private-B', '{\"b\": 2}'), (1, 'private-A', '{\"a\": 1}')");
      const before = await fingerprint();
      await client.exec("delete from documents; insert into documents values (1, 'private-A', '{\"a\": 1}'), (2, 'private-B', '{\"b\": 2}')");
      expect(await fingerprint()).toEqual(before);
      expect(JSON.stringify(before)).not.toContain("private");
      await client.exec("update documents set content = 'changed' where id = 1");
      expect(await fingerprint()).not.toEqual(before);
      await client.exec("update documents set content = 'private-A' where id = 1; insert into documents select * from documents where id = 1");
      expect(await fingerprint()).not.toEqual(before);
      await client.exec("delete from documents where id = 1");
      expect(await fingerprint()).not.toEqual(before);
    } finally { await client.close(); }
  }, 30_000);

  it("exposes the overflow row so the report fails closed rather than accepting a partial table", async () => {
    const client = new PGlite();
    try {
      await client.exec("create table countries (id integer); insert into countries select generate_series(1, 100002)");
      const { rows } = await client.query<{ count: number; sha256: string }>(applicationFingerprintQuery("countries"));
      expect(rows[0]?.count).toBe(100001);
      const tableSchema = applicationFingerprintSchema.shape.tables.element;
      expect(tableSchema.safeParse({ table: "countries", ...rows[0] }).success).toBe(false);
    } finally { await client.close(); }
  }, 30_000);

  it.each(["documents; drop table countries", "ai_chat_sessions", "public.countries", "unapproved_table", null])(
    "rejects an unapproved table before SQL execution: %s", (value) => {
      expect(() => applicationFingerprintQuery(value)).toThrow();
    },
  );
});
