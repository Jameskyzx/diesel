import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { getDemoDatabase } from "@/server/db/demo-client";
import {
  COUNTRY_DETAIL_READ_TRANSACTION_CONFIG,
  getCountryDetails,
} from "@/server/services/country-service";

const originalDatabaseMode = process.env.DATABASE_MODE;

beforeAll(() => {
  process.env.DATABASE_MODE = "pglite-demo";
});

afterAll(() => {
  if (originalDatabaseMode === undefined) {
    delete process.env.DATABASE_MODE;
  } else {
    process.env.DATABASE_MODE = originalDatabaseMode;
  }
});

function postgresErrorCode(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return null;
    }
    if ("code" in current && typeof current.code === "string") {
      return current.code;
    }
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

describe("country detail PGlite read transaction", () => {
  it("applies repeatable-read and read-only settings in the demo runtime", async () => {
    const database = await getDemoDatabase();
    const settings = await database.transaction(
      async (transaction) => {
        const result = await transaction.execute<{
          isolationLevel: string;
          readOnly: string;
        }>(sql`
          select
            current_setting('transaction_isolation') as "isolationLevel",
            current_setting('transaction_read_only') as "readOnly"
        `);
        return result.rows[0];
      },
      COUNTRY_DETAIL_READ_TRANSACTION_CONFIG,
    );

    expect(settings).toEqual({
      isolationLevel: "repeatable read",
      readOnly: "on",
    });
  });

  it("rejects writes and leaves the singleton connection reusable", async () => {
    const database = await getDemoDatabase();
    let writeError: unknown;
    try {
      await database.transaction(
        async (transaction) => {
          await transaction.execute(sql`
            update countries
            set name_en = name_en
            where iso3 = 'CHN'
          `);
        },
        COUNTRY_DETAIL_READ_TRANSACTION_CONFIG,
      );
    } catch (error: unknown) {
      writeError = error;
    }

    expect(postgresErrorCode(writeError)).toBe("25006");
    await expect(getCountryDetails({ iso3: "CHN" })).resolves.toMatchObject({
      status: "available",
    });
  });
});
