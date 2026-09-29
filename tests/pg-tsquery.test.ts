import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parsePgTsQuery, printPgTsQuery } from "@/domain/knowledge/pg-tsquery";

let database: PGlite;
beforeAll(async () => { database = new PGlite(); await database.waitReady; }, 15_000);
afterAll(async () => { await database?.close(); });

describe("bounded canonical PostgreSQL query reader", () => {
  it.each([
    "non-road emissions -source OR marine", 'regulations -"non-road emissions"',
    "EU_NONROAD_2026 OR 'source'", "non -road", '"non-road and emissions"',
    "非道路排放法规 原文", "source'); SELECT pg_sleep(100); --",
    "https://example.test/nonroad?scope=marine", '"oops unfinished',
  ])("round trips native websearch syntax for %s", async (query) => {
    const native = await database.query<{ query: string }>("SELECT websearch_to_tsquery('simple', $1)::text AS query", [query]);
    const ast = parsePgTsQuery(native.rows[0]!.query);
    expect(ast).not.toBeNull();
    const text = printPgTsQuery(ast!);
    expect(text).not.toBeNull();
    const result = await database.query<{ equal: boolean }>("SELECT $1::tsquery = $2::tsquery AS equal", [native.rows[0]!.query, text]);
    expect(result.rows[0]!.equal).toBe(true);
  });

  it.each(["'a' <2> 'b'", "'a' <0> 'b'", "'can''t'", "'back\\\\slash'", "!'a' & 'b' | 'c'", "'a' <-> ('b' <-> 'c')"])("keeps canonical lexemes/precedence: %s", async (query) => {
    const ast = parsePgTsQuery(query);
    expect(ast).not.toBeNull();
    const result = await database.query<{ equal: boolean }>("SELECT $1::tsquery = $2::tsquery AS equal", [query, printPgTsQuery(ast!)]);
    expect(result.rows[0]!.equal).toBe(true);
  });

  it.each(["", "a", "'a", "'a' 'b'", "('a'", "'a')", "'a' &", "'a':*", "'a':AB", "'a' <-1> 'b'", "'a' <16385> 'b'", "''", "'\0'", "!".repeat(200) + "'a'", Array.from({ length: 200 }, () => "'a'").join(" & "), "'a'".repeat(12_000)])("rejects unsupported or unbounded text %#", (query) => {
    expect(parsePgTsQuery(query)).toBeNull();
  });
});
