import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("postgres transaction disconnect patch", () => {
  it.each(["esm", "cjs"].flatMap(mode =>
    ["query", "queue", "idle-continuation", "savepoint"].map(scenario => ({ mode, scenario })),
  ))("settles $mode/$scenario without a stale write, crash or poisoned pool", ({ mode, scenario }) => {
    const result = spawnSync(process.execPath, [
      resolve("tests/fixtures/postgres-disconnect.mjs"), mode, scenario,
    ], {
      encoding: "utf8", timeout: 8_000, maxBuffer: 64 * 1024,
      env: { NODE_ENV: "test", PATH: process.env.PATH },
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ mode, scenario, ok: true });
  }, 10_000);
});
