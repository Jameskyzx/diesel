import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  changeLogProjection,
  collectGovernanceRowsWithVerifiedReuse,
  digestProjectedRow,
  governanceDraftProjection,
  loadReusableGovernanceRows,
  type ProjectedGovernanceRow,
  projectionDigestExpression,
  projectionSelectList,
} from "../scripts/db/governance-snapshot-reuse";

const databases: PGlite[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function rowId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function createChangeLogDatabase() {
  const database = new PGlite();
  databases.push(database);
  await database.exec(`
    create table data_change_logs (
      id uuid primary key,
      entity_type text not null,
      entity_key text not null,
      action text not null,
      actor_email text not null,
      actor_role text not null,
      draft_id uuid,
      import_batch_id uuid,
      before_data jsonb,
      after_data jsonb,
      reason text not null,
      created_at timestamptz not null
    );
    insert into data_change_logs values
      ('${rowId(1)}', 'regulation', 'CHN:non_road', 'published', 'a@example.test',
       'admin', null, null, null, '{"largeInteger":9007199254740993,"precise":1.234567890123456789}',
       '', '2026-11-01T00:00:00.123456Z'),
      ('${rowId(2)}', 'country', 'BRA', 'reviewed', 'b@example.test', 'reviewer',
       '${rowId(90)}', null, '{"名称":"巴西 🇧🇷"}', '{"名称":"巴西"}',
       '复核 — ñ', '2026-11-02T10:20:30Z'),
      ('${rowId(3)}', 'country', 'DEU', 'archived', 'c@example.test', 'editor',
       null, '${rowId(91)}', '{"a":1}', null, 'stale', '2026-11-03T00:00:00Z'),
      ('${rowId(4)}', 'country', 'IND', 'published', 'd@example.test', 'admin',
       null, null, null, '{"new":true}', 'new row', '2026-11-04T00:00:00Z');
  `);
  return database;
}

async function readProjection(database: PGlite, where = "") {
  const result = await database.query<ProjectedGovernanceRow>(
    `select ${projectionSelectList(changeLogProjection)}
       from data_change_logs ${where} order by id`,
  );
  return result.rows;
}

async function readDigests(database: PGlite) {
  const result = await database.query<{ id: string; digest: string }>(
    `select id::text as "id",
            ${projectionDigestExpression(changeLogProjection)} as "digest"
       from data_change_logs order by id`,
  );
  return result.rows;
}

describe("governance snapshot verified row reuse", () => {
  it("computes the same digest in PostgreSQL and in the exporter", async () => {
    const database = await createChangeLogDatabase();
    const rows = await readProjection(database);
    const digests = await readDigests(database);

    expect(digests).toHaveLength(4);
    for (const [index, row] of rows.entries()) {
      expect(digestProjectedRow(changeLogProjection, row)).toBe(
        digests[index]!.digest,
      );
    }
  });

  it("keeps integer columns and NULL versus empty text distinct", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(`
      create table data_governance_drafts (
        id uuid primary key, entity_type text, entity_key text, version integer,
        workflow_status text, payload jsonb, change_reason text, created_by text,
        reviewed_by text, published_by text, reviewed_at timestamptz,
        published_at timestamptz, archived_at timestamptz,
        created_at timestamptz, updated_at timestamptz
      );
      insert into data_governance_drafts values
        ('${rowId(1)}', 'country', 'CHN', 12, 'published', '{}', '', 'a', null,
         null, null, null, null, '2026-11-01Z', '2026-11-01Z'),
        ('${rowId(2)}', 'country', 'CHN', 12, 'published', '{}', null, 'a', '',
         null, null, null, null, '2026-11-01Z', '2026-11-01Z');
    `);
    const rows = (
      await database.query<ProjectedGovernanceRow>(
        `select ${projectionSelectList(governanceDraftProjection)}
           from data_governance_drafts order by id`,
      )
    ).rows;
    const digests = (
      await database.query<{ digest: string }>(
        `select ${projectionDigestExpression(governanceDraftProjection)} as "digest"
           from data_governance_drafts order by id`,
      )
    ).rows;

    expect(rows[0]!.version).toBe(12);
    expect(digestProjectedRow(governanceDraftProjection, rows[0]!)).toBe(
      digests[0]!.digest,
    );
    expect(digestProjectedRow(governanceDraftProjection, rows[1]!)).toBe(
      digests[1]!.digest,
    );
    expect(digests[0]!.digest).not.toBe(digests[1]!.digest);
    expect(
      digestProjectedRow(governanceDraftProjection, {
        ...rows[0]!,
        version: "12",
      }),
    ).toBeNull();
    expect(
      digestProjectedRow(governanceDraftProjection, {
        ...rows[0]!,
        extra: null,
      }),
    ).toBeNull();
  });

  it("returns exactly the full projection while fetching only changed or new rows", async () => {
    const database = await createChangeLogDatabase();
    const previousRows = await readProjection(database);
    await database.exec(`
      update data_change_logs set draft_id = null where id = '${rowId(2)}';
      insert into data_change_logs values
        ('${rowId(5)}', 'country', 'JPN', 'published', 'e@example.test', 'admin',
         null, null, null, '{"jp":1}', 'added', '2026-11-05T00:00:00Z');
      delete from data_change_logs where id = '${rowId(3)}';
    `);
    const fullRows = await readProjection(database);
    const reusable = new Map(previousRows.map((row) => [row.id, row]));
    // A tampered candidate with a matching id must never be reused.
    reusable.set(rowId(4), { ...previousRows[3]!, reason: "tampered" });

    const fetchedIds: string[][] = [];
    const result = await collectGovernanceRowsWithVerifiedReuse({
      columns: changeLogProjection,
      collectDigests: () => readDigests(database),
      fetchBatchSize: 1,
      fetchRows: async (ids) => {
        fetchedIds.push([...ids]);
        return readProjection(
          database,
          `where id in (${ids.map((id) => `'${id}'::uuid`).join(", ")})`,
        );
      },
      reusable,
    });

    expect(result.rows).toEqual(fullRows);
    expect(result.reusedRows).toBe(1);
    expect(result.fetchedRows).toBe(3);
    expect(fetchedIds).toEqual([[rowId(2)], [rowId(4)], [rowId(5)]]);
  });

  it("fails closed when a fetch does not return the requested rows", async () => {
    const database = await createChangeLogDatabase();
    await expect(
      collectGovernanceRowsWithVerifiedReuse({
        columns: changeLogProjection,
        collectDigests: () => readDigests(database),
        fetchBatchSize: 100,
        fetchRows: async () => (await readProjection(database)).slice(1),
        reusable: new Map(),
      }),
    ).rejects.toThrow("did not match its digests");
  });

  it("treats a missing, malformed or non-regular previous file as nothing to reuse", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-reuse-"));
    directories.push(directory);
    const valid = join(directory, "valid.json");
    const malformed = join(directory, "malformed.json");
    const linked = join(directory, "linked.json");
    await writeFile(
      valid,
      JSON.stringify({
        tables: { data_change_logs: [{ id: rowId(1), reason: "x" }, null] },
      }),
    );
    await writeFile(malformed, "{");
    await symlink(valid, linked);

    const loaded = await loadReusableGovernanceRows(valid);
    expect([...loaded.data_change_logs.keys()]).toEqual([rowId(1)]);
    expect(loaded.data_governance_drafts.size).toBe(0);
    for (const path of [
      null,
      malformed,
      linked,
      join(directory, "missing.json"),
    ]) {
      const empty = await loadReusableGovernanceRows(path);
      expect(empty.data_change_logs.size).toBe(0);
    }
  });
});

describe("governance publication reuse-source selection", () => {
  const script = resolve(
    "scripts/deploy/governance-publication-state-machine.sh",
  );

  async function select(backupsRoot: string, releaseId: string) {
    const { stdout } = await promisify(execFile)("/bin/bash", [
      "-c",
      'set -Eeuo pipefail; source "$1"; governance_find_reusable_snapshot "$2" "$3"; printf "%s" "${GOVERNANCE_REUSABLE_SNAPSHOT_PATH}"',
      "reuse-selection-fixture",
      script,
      backupsRoot,
      releaseId,
    ]);
    return stdout;
  }

  it("picks the newest earlier pre-write snapshot and never its own or a link", async () => {
    const root = await mkdtemp(join(tmpdir(), "governance-reuse-select-"));
    directories.push(root);
    expect(await select(root, "current")).toBe("");

    const snapshot = async (release: string, seconds: number) => {
      await mkdir(join(root, release), { recursive: true });
      const path = join(root, release, "governance-before.json");
      await writeFile(path, "{}");
      await utimes(path, seconds, seconds);
      return path;
    };
    await snapshot("older", 1_000);
    const newer = await snapshot("newer", 2_000);
    await snapshot("current", 3_000);
    await mkdir(join(root, "linked"));
    await symlink(newer, join(root, "linked", "governance-before.json"));

    expect(await select(root, "current")).toBe(newer);
  });
});
