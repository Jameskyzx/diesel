import { describe, expect, it } from "vitest";

import { getDatabaseMode } from "@/server/db/environment";

describe("database runtime environment", () => {
  it("defaults to postgres and permits the explicit local demo outside production", () => {
    expect(getDatabaseMode({ NODE_ENV: "production" })).toBe("postgres");
    expect(
      getDatabaseMode({
        DATABASE_MODE: "pglite-demo",
        NODE_ENV: "development",
      }),
    ).toBe("pglite-demo");
  });

  it("fails closed when a production process inherits demo database mode", () => {
    expect(() =>
      getDatabaseMode({
        DATABASE_MODE: "pglite-demo",
        NODE_ENV: "production",
      }),
    ).toThrow(
      "DATABASE_MODE=pglite-demo is forbidden when NODE_ENV=production",
    );
  });
});
