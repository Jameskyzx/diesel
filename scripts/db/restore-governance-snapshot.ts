import { stat, readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ZodError } from "zod";

import { getDatabaseUrl } from "../../src/server/db/environment";
import {
  governanceRestoreHelp,
  parseGovernanceRestoreOptions,
} from "./governance-restore-options";
import {
  assertSnapshotSha256,
  parseGovernanceSnapshot,
} from "./governance-snapshot-format";
import { restoreGovernanceSnapshotInAuthorizedTransaction } from "./governance-snapshot-restore";

const maximumSnapshotBytes = 256 * 1024 * 1024;

async function loadAndValidateSnapshot(
  inputPath: string,
  expectedSha256: string,
) {
  const file = await stat(inputPath);
  if (!file.isFile()) {
    throw new Error("Snapshot input must be a regular file");
  }
  if (file.size > maximumSnapshotBytes) {
    throw new Error("Snapshot exceeds the 256 MiB safety limit");
  }

  const content = await readFile(inputPath);
  const sha256 = assertSnapshotSha256(content, expectedSha256);
  let decoded: unknown;
  try {
    decoded = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error("Snapshot is not valid JSON");
  }
  return {
    sha256,
    snapshot: parseGovernanceSnapshot(decoded),
  };
}

async function main() {
  const options = parseGovernanceRestoreOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(governanceRestoreHelp);
    return;
  }

  const { sha256, snapshot } = await loadAndValidateSnapshot(
    options.inputPath,
    options.expectedSha256,
  );
  if (!options.apply) {
    process.stdout.write(
      `${JSON.stringify({
        formatVersion: snapshot.formatVersion,
        mode: "dry-run",
        sha256,
        tableCounts: snapshot.tableCounts,
        valid: true,
      })}\n`,
    );
    return;
  }

  const client = postgres(getDatabaseUrl(), { max: 1, prepare: false });
  try {
    const database = drizzle(client);
    const result = await database.transaction(
      (transaction) =>
        restoreGovernanceSnapshotInAuthorizedTransaction(transaction, snapshot),
      { isolationLevel: "serializable" },
    );
    process.stdout.write(
      `${JSON.stringify({
        applied: true,
        mode: "apply",
        sha256,
        ...result,
      })}\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ZodError) {
    const issues = error.issues.slice(0, 10).map((issue) => ({
      message: issue.message,
      path: issue.path.join("."),
    }));
    process.stderr.write(
      `Governance snapshot restore rejected invalid input: ${JSON.stringify(issues)}\n`,
    );
  } else if (
    error instanceof Error &&
    [
      "Both --input and --sha256 are required",
      "Snapshot input must be a regular file",
      "Snapshot exceeds the 256 MiB safety limit",
      "Snapshot SHA-256 does not match the expected digest",
      "Snapshot is not valid JSON",
    ].includes(error.message)
  ) {
    process.stderr.write(`Governance snapshot restore rejected: ${error.message}\n`);
  } else {
    process.stderr.write(
      "Governance snapshot restore failed; no database changes were committed. Use --help to verify the command.\n",
    );
  }
  process.exitCode = 1;
});
