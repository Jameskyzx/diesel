import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";

export type PostgresBackupConnection = {
  environment: NodeJS.ProcessEnv;
  pgDumpArguments: readonly string[];
};

export function createPostgresBackupConnection(
  databaseUrl: string,
  outputPath: string,
): PostgresBackupConnection {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !databaseName || !url.username) {
    throw new Error("DATABASE_URL must include host, database and user.");
  }
  const sslMode = url.searchParams.get("sslmode") ?? "prefer";
  const environment: NodeJS.ProcessEnv = {
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    PGDATABASE: databaseName,
    PGHOST: url.hostname,
    PGPASSWORD: decodeURIComponent(url.password),
    PGPORT: url.port || "5432",
    PGSSLMODE: sslMode,
    PGUSER: decodeURIComponent(url.username),
  };
  return {
    environment,
    pgDumpArguments: [
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--file",
      outputPath,
    ],
  };
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}
