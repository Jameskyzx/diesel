import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildKnowledgeTextQuery, resolveKnowledgeTextQuery } from "@/server/repositories/knowledge-text-query";

let database: PGlite;
const dialect = new PgDialect();

beforeAll(async () => {
  database = new PGlite();
  await database.waitReady;
}, 15_000);

afterAll(async () => {
  await database?.close();
});

describe("native scope spelling query resolution", () => {
  const parseNative = async (query: string) => (await database.query<{ query: string }>(
    "SELECT websearch_to_tsquery('simple', $1)::text AS query", [query],
  )).rows;

  it.each([
    ['"nonroad emissions regulations"', "non-road emission regulation", true],
    ['"nonroad emissions regulations"', "non-road unrelated emission regulation", false],
    ['regulations -"nonroad emissions"', "regulation non-road emission", false],
    ['regulations -"nonroad emissions"', "regulation non-road unrelated emission", true],
    ["nonroad EU_REGULATIONS_2026", "non-road EU_REGULATIONS_2026", true],
    ["nonroad EU_REGULATIONS_2026", "nonroad EU_REGULATION_2026", false],
  ] as const)("composes scope and equal-width inflections: %s", async (query, content, expected) => {
    const parser = vi.fn(parseNative);
    const expression = await resolveKnowledgeTextQuery(query, parser);
    const compiled = dialect.sqlToQuery(sql`SELECT to_tsvector('simple', ${content}) @@ ${expression} AS matches`);
    const result = await database.query<{ matches: boolean }>(compiled.sql, compiled.params);
    expect(result.rows[0]!.matches).toBe(expected);
    expect(parser).toHaveBeenCalledTimes(1);
  });

  it.each(["非道路排放法规", "emissions sources", "EU_NONROAD_2026", "non road-2026"])("keeps %s on the original single-read path", async (query) => {
    const parser = vi.fn(parseNative);
    const expression = await resolveKnowledgeTextQuery(query, parser);
    expect(parser).not.toHaveBeenCalled();
    expect(dialect.sqlToQuery(expression)).toEqual(dialect.sqlToQuery(buildKnowledgeTextQuery(query)));
  });

  it("uses the original query, not masked text, after expansion overflow", async () => {
    const query = `"${"nonroad ".repeat(8)}"`;
    expect(dialect.sqlToQuery(await resolveKnowledgeTextQuery(query, parseNative)))
      .toEqual(dialect.sqlToQuery(buildKnowledgeTextQuery(query)));
  });

  it.each([[], [{ query: null }], [{ query: "'a'", extra: true }], [{ query: "'a'" }, { query: "'b'" }]].map((rows) => ({ rows })))("rejects an invalid native parse response %#", async ({ rows }) => {
    await expect(resolveKnowledgeTextQuery("nonroad", async () => rows)).rejects.toThrow();
  });

  it("does not swallow database errors", async () => {
    const error = new Error("native parse failure");
    await expect(resolveKnowledgeTextQuery("nonroad", async () => { throw error; })).rejects.toBe(error);
  });

  it("checks cancellation before and after native parsing", async () => {
    const controller = new AbortController();
    const parser = vi.fn(async () => { controller.abort(); return []; });
    await expect(resolveKnowledgeTextQuery("nonroad", parser, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(parser).toHaveBeenCalledTimes(1);
    parser.mockClear();
    await expect(resolveKnowledgeTextQuery("nonroad", parser, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(parser).not.toHaveBeenCalled();
  });

  it("parameterizes every caller-controlled lexeme through both reads", async () => {
    const query = "nonroad'); SELECT pg_sleep(100); --";
    const parser = vi.fn(parseNative);
    const compiled = dialect.sqlToQuery(await resolveKnowledgeTextQuery(query, parser));
    expect(compiled.sql).not.toContain("pg_sleep");
    expect(compiled.sql).not.toContain("SELECT");
    const result = await database.query<{ matches: boolean }>(
      `SELECT to_tsvector('simple', 'non-road source') @@ ${compiled.sql} AS matches`, compiled.params,
    );
    expect(result.rows[0]!.matches).toBe(false);
    expect(parser).toHaveBeenCalledTimes(1);
  });
});

async function matches(query: string, content: string): Promise<boolean> {
  const statement = dialect.sqlToQuery(sql`
    SELECT to_tsvector('simple', ${content}) @@
      ${buildKnowledgeTextQuery(query)} AS matches
  `);
  const result = await database.query<{ matches: boolean }>(
    statement.sql,
    statement.params,
  );
  return result.rows[0]?.matches === true;
}

describe("bounded knowledge keyword inflections", () => {
  it.each([
    ["emission", "emissions"],
    ["regulation", "regulations"],
    ["section", "sections"],
    ["citation", "citations"],
    ["source", "sources"],
    ["requirement", "requirements"],
    ["limit", "limits"],
  ])("matches both %s and %s in either direction", async (singular, plural) => {
    for (const query of [singular, plural]) {
      for (const content of [singular, plural]) {
        expect(await matches(query, content)).toBe(true);
      }
    }
  });

  it.each([
    { content: "regulation source", expected: true, query: "regulations sources" },
    { content: "regulation", expected: false, query: "regulations sources" },
    { content: "source", expected: true, query: "regulations OR sources" },
    { content: "regulation", expected: true, query: "regulations -sources" },
    { content: "regulation source", expected: false, query: "regulations -sources" },
    { content: "regulations sources", expected: false, query: "regulations -source" },
    { content: "emission regulation", expected: true, query: '"emissions regulations"' },
    { content: "regulation emission", expected: false, query: '"emissions regulations"' },
    { content: "emission unrelated regulation", expected: false, query: '"emissions regulations"' },
    { content: "regulation original text", expected: true, query: 'regulations -"source evidence"' },
    { content: "regulation source evidence", expected: false, query: 'regulations -"sources evidence"' },
  ])("preserves syntax: $query / $content", async ({ query, content, expected }) => {
    expect(await matches(query, content)).toBe(expected);
  });

  it.each([
    { content: "deregulation", query: "regulations" },
    { content: "regulation", query: "deregulations" },
    { content: "source", query: "resource" },
    { content: "regulation source", query: "ZZZ_QUANTUM_BANANA_98765" },
    { content: "EU-REGULATION-2026", query: "EU-REGULATIONS-2026" },
    { content: "EU_REGULATION_2026", query: "EU_REGULATIONS_2026" },
    { content: "EU.REGULATION.2026", query: "EU.REGULATIONS.2026" },
    { content: "EU/REGULATION/2026", query: "EU/REGULATIONS/2026" },
    { content: "EU:REGULATION:2026", query: "EU:REGULATIONS:2026" },
    { content: "regulations EU_REGULATION_2026", query: "regulations EU_REGULATIONS_2026" },
  ])("does not erase distinct terms or identifiers: $query", async ({ query, content }) => {
    expect(await matches(query, content)).toBe(false);
  });

  it("still matches an exact compound identifier without rewriting it", async () => {
    expect(await matches("regulations EU_REGULATIONS_2026", "regulations EU_REGULATIONS_2026")).toBe(true);
    expect(await matches("EU_REGULATIONS_2026 sections", "EU_REGULATIONS_2026 section")).toBe(true);
  });

  it("keeps Chinese terms intact without inventing translation aliases", async () => {
    expect(await matches("非道路排放法规", "中国 非道路排放法规 原文")).toBe(true);
    expect(await matches("非道路排放法规", "non-road emissions regulation")).toBe(false);
  });

  it("only adds rewrites for applicable unprotected inflections", () => {
    for (const query of ["非道路排放法规", "ZZZ_QUANTUM_BANANA_98765", "EU_REGULATIONS_2026"]) {
      const statement = dialect.sqlToQuery(buildKnowledgeTextQuery(query));
      expect(statement.sql).not.toContain("ts_rewrite");
      expect(statement.params).toEqual([query]);
    }
    const statement = dialect.sqlToQuery(buildKnowledgeTextQuery("regulations"));
    expect(statement.sql.match(/ts_rewrite\(/gu)).toHaveLength(2);
    expect(statement.params).toHaveLength(5);
  });

  it("parameterizes caller syntax instead of interpolating it as SQL", async () => {
    const query = "regulations'); SELECT pg_sleep(100); --";
    const statement = dialect.sqlToQuery(buildKnowledgeTextQuery(query));
    expect(statement.sql).not.toContain(query);
    expect(statement.params.filter((value) => value === query)).toHaveLength(1);
    expect(await matches(query, "regulation source evidence")).toBe(false);
    expect(await matches("regulations", "regulation")).toBe(true);
  });

  it("bounds expansion independently of repeated words in the 500-character input", async () => {
    const query = "emissions regulations sections citations sources requirements limits ".repeat(8).slice(0, 500);
    const expression = buildKnowledgeTextQuery(query);
    const statement = dialect.sqlToQuery(sql`
      SELECT numnode(${expression}) AS expanded,
        numnode(websearch_to_tsquery('simple', ${query})) AS original
    `);
    const result = await database.query<{ expanded: number; original: number }>(
      statement.sql,
      statement.params,
    );
    expect(result.rows[0]?.expanded).toBeGreaterThan(0);
    expect(result.rows[0]?.expanded).toBeLessThanOrEqual(
      (result.rows[0]?.original ?? 0) * 3,
    );
    const compiled = dialect.sqlToQuery(expression);
    expect(compiled.sql.match(/ts_rewrite\(/gu)).toHaveLength(14);
    expect(compiled.params).toHaveLength(29);
    expect(compiled.sql.length).toBeLessThan(2_048);
  });
});
