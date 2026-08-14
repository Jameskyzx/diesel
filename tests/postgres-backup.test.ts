import { describe, expect, it } from "vitest";

import { createPostgresBackupConnection } from "../scripts/db/postgres-backup";

describe("production PostgreSQL backup command", () => {
  it("keeps credentials out of pg_dump arguments", () => {
    const result = createPostgresBackupConnection(
      "postgresql://diesel:p%40ss@example.com:6543/app?sslmode=require",
      "/secure/release.dump",
    );

    expect(result.pgDumpArguments).toEqual([
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--file",
      "/secure/release.dump",
    ]);
    expect(result.pgDumpArguments.join(" ")).not.toContain("p@ss");
    expect(result.environment).toMatchObject({
      PGDATABASE: "app",
      PGHOST: "example.com",
      PGPASSWORD: "p@ss",
      PGPORT: "6543",
      PGSSLMODE: "require",
      PGUSER: "diesel",
    });
    expect(result.environment.DATABASE_URL).toBeUndefined();
  });

  it("rejects incomplete and non-PostgreSQL URLs", () => {
    expect(() => createPostgresBackupConnection(
      "https://example.com/database",
      "/secure/release.dump",
    )).toThrow(/postgres/);
    expect(() => createPostgresBackupConnection(
      "postgresql://example.com",
      "/secure/release.dump",
    )).toThrow(/host, database and user/);
  });
});
