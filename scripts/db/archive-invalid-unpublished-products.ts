import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres from "postgres";

import { getDatabaseUrl } from "../../src/server/db/environment";
import {
  applyInvalidProductManifest,
  type MaintenanceSqlClient,
  type MaintenanceSqlParameter,
  readInvalidProductManifest,
} from "./invalid-product-maintenance";

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function main(): Promise<void> {
  const apply = hasFlag("apply");
  const outputPath = flagValue("output");
  const manifestPath = flagValue("manifest");
  const actorEmail = flagValue("actor-email");
  const reason = flagValue("reason");
  if (apply && (!manifestPath || !actorEmail || !reason)) {
    throw new Error(
      "--apply requires --manifest=PATH, --actor-email=EMAIL and --reason=TEXT.",
    );
  }
  if (!apply && manifestPath) {
    throw new Error("--manifest is accepted only with --apply.");
  }

  const sql = postgres(getDatabaseUrl(), { max: 1, prepare: false });
  const client: MaintenanceSqlClient = {
    async query<TRow extends Record<string, unknown>>(
      text: string,
      parameters: readonly MaintenanceSqlParameter[] = [],
    ) {
      const rows = await sql.unsafe<TRow[]>(text, [...parameters]);
      return { rows: [...rows] };
    },
  };

  try {
    if (!apply) {
      const manifest = await readInvalidProductManifest(client);
      const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
      if (outputPath) {
        await writeFile(resolve(process.cwd(), outputPath), serialized, {
          encoding: "utf8",
          mode: 0o600,
        });
      } else {
        process.stdout.write(serialized);
      }
      return;
    }

    const absoluteManifestPath = resolve(process.cwd(), manifestPath!);
    const manifestMode = (await stat(absoluteManifestPath)).mode & 0o777;
    if ((manifestMode & 0o077) !== 0) {
      throw new Error("Apply manifest must not be readable or writable by group/other.");
    }
    const expectedManifest: unknown = JSON.parse(
      await readFile(absoluteManifestPath, "utf8"),
    );
    const result = await applyInvalidProductManifest({
      actorEmail: actorEmail!,
      client,
      expectedManifest,
      reason: reason!,
    });
    process.stdout.write(`${JSON.stringify({ status: "archived", ...result })}\n`);
  } finally {
    await sql.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Invalid-product maintenance failed."}\n`,
  );
  process.exitCode = 1;
});
