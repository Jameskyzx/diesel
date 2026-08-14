import { execFile } from "node:child_process";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { getDatabaseUrl } from "../../src/server/db/environment";
import {
  createPostgresBackupConnection,
  sha256File,
} from "./postgres-backup";

const execFileAsync = promisify(execFile);

function outputArgument(): string {
  const prefix = "--output=";
  const output = process.argv.slice(2).find((argument) =>
    argument.startsWith(prefix)
  )?.slice(prefix.length);
  if (!output) {
    throw new Error("Usage: pnpm db:backup --output=/absolute/path/release.dump");
  }
  return resolve(process.cwd(), output);
}

async function main(): Promise<void> {
  const outputPath = outputArgument();
  if (!outputPath.endsWith(".dump")) {
    throw new Error("Backup output must use the .dump extension.");
  }
  try {
    await stat(outputPath);
    throw new Error("Backup output already exists; refusing to overwrite it.");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const connection = createPostgresBackupConnection(
    getDatabaseUrl(),
    outputPath,
  );
  const previousUmask = process.umask(0o077);
  try {
    await execFileAsync("pg_dump", [...connection.pgDumpArguments], {
      encoding: "utf8",
      env: connection.environment,
      maxBuffer: 1024 * 1024,
      timeout: 10 * 60 * 1_000,
    });
  } catch {
    throw new Error("pg_dump failed; the database URL and stderr were not printed.");
  } finally {
    process.umask(previousUmask);
  }
  await chmod(outputPath, 0o600);

  try {
    const { stdout } = await execFileAsync(
      "pg_restore",
      ["--list", outputPath],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 60_000 },
    );
    if (!stdout.trim()) {
      throw new Error("empty catalog");
    }
  } catch {
    throw new Error("pg_restore --list did not validate the custom-format backup.");
  }

  const digest = await sha256File(outputPath);
  const checksumPath = `${outputPath}.sha256`;
  await writeFile(checksumPath, `${digest}  ${basename(outputPath)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await chmod(checksumPath, 0o600);
  process.stdout.write(
    `${JSON.stringify({ backup: outputPath, catalogVerified: true, sha256: digest })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "PostgreSQL backup failed."}\n`,
  );
  process.exitCode = 1;
});
