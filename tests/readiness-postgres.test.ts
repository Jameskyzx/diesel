import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

const readinessMocks = vi.hoisted(() => {
  const queries: unknown[] = [];

  return {
    execute: vi.fn(async (query: unknown) => {
      queries.push(query);
      return [];
    }),
    queries,
  };
});

vi.mock("@/server/db/client", () => ({
  getDatabase: () => ({
    transaction: async (
      callback: (transaction: {
        execute: (query: unknown) => Promise<unknown>;
      }) => Promise<unknown>,
    ) => callback({ execute: readinessMocks.execute }),
  }),
}));

vi.mock("@/server/db/environment", () => ({
  getDatabaseMode: () => "postgres",
}));

import { checkDatabaseReadiness } from "@/server/health/readiness";

describe("PostgreSQL readiness probe", () => {
  it("sets a transaction-local statement timeout before probing", async () => {
    await expect(
      checkDatabaseReadiness({ timeoutMs: 100 }),
    ).resolves.toBe(true);

    expect(readinessMocks.queries).toHaveLength(2);
    const dialect = new PgDialect();
    const [configuration, probe] = readinessMocks.queries.map((query) =>
      dialect.sqlToQuery(query as SQL).sql,
    );
    expect(configuration).toContain(
      "set_config('statement_timeout', $1, true)",
    );
    expect(probe).toContain("select 1");
  });
});
