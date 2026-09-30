import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const fromRepository = createRequire(resolve("package.json"));
const fromShadcn = createRequire(fromRepository.resolve("shadcn"));
const consumers = [
  ["shadcn", fromShadcn],
  ["dotenvx", createRequire(fromShadcn.resolve("@dotenvx/dotenvx"))],
] as const;

type Options = { connect?: unknown; tls?: unknown };
type Pool = { destroy(): Promise<void> };
type Undici = {
  Pool: new (origin: string) => Pool;
  BalancedPool: new (origins: string[], options: Options & {
    factory(origin: string, options: Options): Pool;
  }) => Pool;
};

describe.each(consumers)("installed undici security boundary: %s", (_label, consumer) => {
  const undici: Undici = consumer("undici");

  it("resolves the patched version through the installed consumer", () => {
    expect(() => z.object({ version: z.literal("7.29.1") }).parse(JSON.parse(
      readFileSync(consumer.resolve("undici/package.json"), "utf8"),
    ))).not.toThrow();
  });

  it.each(["connect", "tls"] as const)("preserves %s certificate verification callbacks", async (key) => {
    const checkServerIdentity = () => new Error("fixture rejects certificate");
    const options = { checkServerIdentity };
    let observed: unknown;
    const pool = new undici.BalancedPool(["https://example.invalid"], {
      [key]: options,
      factory(origin, passed) {
        observed = passed[key];
        return new undici.Pool(origin);
      },
    });
    try {
      expect(observed).toEqual(options);
      expect(observed).not.toBe(options);
    } finally {
      await pool.destroy();
    }
  });

  it("preserves a custom connector function", async () => {
    const connect = () => { throw new Error("must never connect in this fixture"); };
    let observed: unknown;
    const pool = new undici.BalancedPool(["https://example.invalid"], {
      connect,
      factory(origin, options) {
        observed = options.connect;
        return new undici.Pool(origin);
      },
    });
    try {
      expect(observed).toBe(connect);
    } finally {
      await pool.destroy();
    }
  });
});
