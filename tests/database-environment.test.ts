import { describe, expect, it } from "vitest";

import {
  getDatabaseMode,
  getDatabaseUrl,
} from "@/server/db/environment";

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

  it("allows ordinary PostgreSQL URL options", () => {
    expect(
      getDatabaseUrl({
        DATABASE_URL:
          "postgresql://diesel@example.test/app?sslmode=require&application_name=diesel",
      }),
    ).toContain("sslmode=require");
  });

  it.each([
    "statement_timeout=0",
    "lock_timeout=0",
    "idle_in_transaction_session_timeout=0",
    "options=-c%20statement_timeout%3D0",
    "OPTIONS=-c%20lock_timeout%3D0",
  ])("rejects DATABASE_URL timeout override %s", (query) => {
    expect(() =>
      getDatabaseUrl({
        DATABASE_URL: `postgresql://diesel@example.test/app?${query}`,
      }),
    ).toThrow(
      "DATABASE_URL must not override application-controlled database timeouts",
    );
  });

  it.each([
    "postgresql://diesel@example.test/app?search_path=public%00statement_timeout%000",
    "postgresql://diesel@example.test/app?search%00path=public",
    "postgresql://diesel%00statement_timeout%000@example.test/app",
    "postgresql://diesel:secret%00lock_timeout%000@example.test/app",
    "postgresql://diesel@example.test/app%00shadow",
  ])("rejects DATABASE_URL startup-message control injection %s", (url) => {
    expect(() => getDatabaseUrl({ DATABASE_URL: url })).toThrow(
      "DATABASE_URL must not contain control characters",
    );
  });

  it.each([
    "postgresql://die\nsel@example.test/app",
    "postgresql://diesel@example.test/ap\rp",
    "postgresql://diesel@example.test/app?application_na\tme=diesel",
  ])("rejects raw URL control characters before parser normalization %s", (url) => {
    expect(() => getDatabaseUrl({ DATABASE_URL: url })).toThrow(
      "DATABASE_URL must not contain control characters",
    );
  });
});
