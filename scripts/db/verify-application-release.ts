import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "../../src/server/db/postgres";
import { z } from "zod";
import { getDatabaseUrl } from "../../src/server/db/environment";
import { applicationDataTables, applicationFingerprintSchema, assertApplicationDataUnchanged, compareApplicationInputs } from "../deploy/application-release-contract";
import { assertProductionMigrationLineage, type MigrationIdentity } from "./production-readback";
import { applicationFingerprintQuery } from "./application-fingerprint-query";

const fixedNode = "/opt/node-v22.22.3-linux-x64/bin/node";
function readTrusted(path: string, maximumBytes: number, privateFile = false): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== 0 ||
    (stat.mode & 0o7022) !== 0 || stat.size > maximumBytes || realpathSync(path) !== path ||
    (privateFile && (stat.gid !== 0 || (stat.mode & 0o777) !== 0o600))) throw new Error("untrusted verification input");
  return readFileSync(path, "utf8");
}

async function main(): Promise<void> {
  const [mode, release] = z.tuple([z.enum(["before", "after", "revalidate"]), z.string().regex(/^[0-9a-f]{40}$/u)]).parse(process.argv.slice(2));
  const directory = `/opt/diesel/releases/${release}`;
  const state = `/opt/diesel/backups/${release}`;
  if (process.platform !== "linux" || process.getuid?.() !== 0 || realpathSync(process.execPath) !== fixedNode ||
    fileURLToPath(import.meta.url) !== `${directory}/scripts/db/verify-application-release.ts` ||
    process.env.DIESEL_RELEASE_LIFECYCLE_LOCK_FD !== "8") throw new Error("unsupported application verifier entrypoint");
  const previousDirectory = readTrusted(`${state}/previous-release`, 256, true).trimEnd();
  const previousRelease = z.string().regex(/^[0-9a-f]{40}$/u).parse(previousDirectory.split("/").at(-1));
  if (previousDirectory !== `/opt/diesel/releases/${previousRelease}`) throw new Error("invalid previous release");
  const readManifest = (root: string, commit: string) => {
    const helper = `${directory}/scripts/deploy/release-input-manifest.mjs`;
    readTrusted(helper, 64 * 1024);
    const result = spawnSync(fixedNode, [helper, "verify", commit, `${root}/.release-input-manifest.json`], {
      cwd: root, env: { HOME: "/root", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", NODE_ENV: "production" },
      timeout: 60_000, maxBuffer: 8192, encoding: "utf8",
    });
    if (result.status !== 0 || result.signal || result.error) throw new Error("release input verification failed");
    return JSON.parse(readTrusted(`${root}/.release-input-manifest.json`, 64 * 1024 * 1024)) as unknown;
  };
  const contract = compareApplicationInputs(readManifest(previousDirectory, previousRelease), readManifest(directory, release));
  const journal = z.object({ entries: z.array(z.object({ tag: z.string().regex(/^[a-z0-9_]+$/u), when: z.number().int() })) })
    .parse(JSON.parse(readTrusted(`${directory}/drizzle/meta/_journal.json`, 64 * 1024)));
  const expectedMigrations = journal.entries.map((entry) => ({
    createdAt: String(entry.when), hash: createHash("sha256").update(readTrusted(`${directory}/drizzle/${entry.tag}.sql`, 4 * 1024 * 1024)).digest("hex"),
  }));
  const sql = postgres(getDatabaseUrl(), { max: 1, prepare: false, fetch_types: false, connect_timeout: 10, connection: { application_name: "diesel-application-verification" } });
  try {
    const tables = await sql.begin("isolation level repeatable read read only", async (transaction) => {
      await transaction`set local statement_timeout = '15s'`;
      await transaction`set local lock_timeout = '1500ms'`;
      await transaction`set local idle_in_transaction_session_timeout = '20s'`;
      await transaction`set local timezone = 'UTC'`;
      await transaction`set local extra_float_digits = 3`;
      const actual = await transaction<MigrationIdentity[]>`select created_at::text as "createdAt", hash from drizzle.__drizzle_migrations order by created_at, id`;
      assertProductionMigrationLineage({ actual, expected: expectedMigrations });
      const rows = [];
      for (const table of applicationDataTables) {
        const [row] = await transaction.unsafe<{ count: number; sha256: string }[]>(applicationFingerprintQuery(table));
        if (!row) throw new Error("missing fingerprint");
        rows.push({ table, ...row });
      }
      return rows;
    });
    const report = applicationFingerprintSchema.parse({ format: "diesel-application-verification-v2", ...contract, tables, checkedAt: new Date().toISOString() });
    if (mode !== "before") {
      assertApplicationDataUnchanged(JSON.parse(readTrusted(`${state}/application-before.json`, 16384, true)), report);
    }
    if (mode === "revalidate") {
      assertApplicationDataUnchanged(JSON.parse(readTrusted(`${state}/application-after.json`, 16384, true)), report);
    } else {
      const descriptor = openSync(`${state}/application-${mode}.json`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(descriptor, `${JSON.stringify(report)}\n`); fsyncSync(descriptor); }
      finally { closeSync(descriptor); }
      const parent = openSync(state, constants.O_RDONLY | constants.O_DIRECTORY);
      try { fsyncSync(parent); } finally { closeSync(parent); }
    }
    process.stdout.write(`Application-only ${mode} verification passed; no governance publication performed.\n`);
  } finally { await sql.end({ timeout: 2 }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    process.stderr.write("Application-only verification failed; preserve receipts and inspect the contract.\n");
    process.exitCode = 75;
  });
}
