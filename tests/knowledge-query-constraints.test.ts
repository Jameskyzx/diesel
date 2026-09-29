import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { resolveKnowledgeCandidateConstraint, resolveKnowledgeConstraintKey } from "@/server/repositories/knowledge-text-query";
import { knowledgeQueryConstraintKey } from "@/domain/knowledge/query-constraints";
import { appendKnowledgeQueryTerms } from "@/domain/knowledge/query-literal-spans";

let database: PGlite;
const dialect = new PgDialect();
beforeAll(async () => { database = new PGlite(); await database.waitReady; }, 15_000);
afterAll(async () => { await database?.close(); });
const parseNative = async (queries: readonly string[]) => (await database.query(
  "SELECT (ordinality - 1)::integer AS index, websearch_to_tsquery('simple', value)::text AS query FROM jsonb_array_elements_text($1::jsonb) WITH ORDINALITY ORDER BY ordinality",
  [JSON.stringify(queries)],
)).rows;

async function eligible(query: string, content: string): Promise<boolean> {
  const constraint = await resolveKnowledgeCandidateConstraint(query, parseNative);
  if (!constraint) return true;
  const compiled = dialect.sqlToQuery(sql`SELECT to_tsvector('simple', ${content}) @@ ${constraint} AS matches`);
  const result = await database.query<{ matches: boolean }>(compiled.sql, compiled.params);
  return result.rows[0]!.matches;
}

const constraintKey = (query: string) => resolveKnowledgeConstraintKey(query, parseNative, async (expression) => {
  const compiled = dialect.sqlToQuery(sql`SELECT (${expression})::text AS query`);
  return (await database.query(compiled.sql, compiled.params)).rows;
});

describe("native query constraint equivalence", () => {
  it.each(["source -", "source --", "source - \n", 'source -""', "source - ( )"])("does not manufacture a native operand in %s", async (query) => {
    expect(await constraintKey(appendKnowledgeQueryTerms(query, ["non-road"]))).toBe(await constraintKey(query));
  });
  it("adds a metadata keyword without changing an unfinished excluded phrase", async () => {
    const query = 'source -"China non-road';
    expect(await constraintKey(appendKnowledgeQueryTerms(query, ["non-road"]))).toBe(await constraintKey(query));
  });
  it.each([
    ["foo -fictional", "foo fictional", false],
    ["foo -fictional", "foo - fictional", true],
    ["foo -fictional", "foo ---fictional", true],
    ["foo -fictional", "foo --fictional", false],
    ["foo --fictional", "foo fictional", true],
    ["foo -fictional -warranty", "foo -warranty -fictional -fictional", true],
    ["foo -regulations", "foo -regulation", true],
    ["foo -EU_REGULATIONS_2026", "foo -EU_REGULATION_2026", false],
    ['foo "original text"', 'foo "text original"', false],
    ['foo "original text"', "foo original text", false],
    ['foo -"original text"', 'foo "original text"', false],
    ['foo "non-road emissions"', 'foo "nonroad emission"', true],
    ['foo "original text', 'foo "original text"', true],
    ["foo OR bar -fictional", "bar -fictional OR foo", true],
    ["foo OR bar -fictional", "foo -fictional OR bar", false],
    ["foo OR bar -fictional", "foo bar -fictional", false],
    ["foo OR bar -fictional", "(foo OR bar) -fictional", true],
    ["foo -https://example.test/a-b", "foo -https://different.test/z", true],
    ["foo –fictional", "foo fictional", true],
    ["foo -non road", "foo -non-road", false],
    ["foo non-road", "foo nonroad", true],
  ] as const)("%s / %s equivalence -> %s", async (expected, actual, matches) => {
    expect(await constraintKey(expected) === await constraintKey(actual)).toBe(matches);
  });

  it("preserves positions and rejects unsupported or oversized canonical syntax", () => {
    expect(knowledgeQueryConstraintKey("'a' <-> 'b'")).not.toBe(knowledgeQueryConstraintKey("'a' <2> 'b'"));
    expect(() => knowledgeQueryConstraintKey("'a':*" )).toThrow();
    expect(() => knowledgeQueryConstraintKey("!".repeat(200) + "'a'" )).toThrow();
    expect(knowledgeQueryConstraintKey("!".repeat(100) + "'a'" )).toBe(knowledgeQueryConstraintKey("'a'"));
  });
});

describe("hard query constraints before hybrid ranking", () => {
  it.each([
    ["emissions regulations", "语义相似的资料", true],
    ["non-road emissions", "metadata-scoped semantic match", true],
    ["foo -fictional", "fictional source", false],
    ["foo -fictional", "different relevant source", true],
    ["foo - fictional", "fictional source", false],
    ["foo --fictional", "different relevant source", true],
    ["foo ---fictional", "fictional source", false],
    ['foo "original text"', "original text", true],
    ['foo "original text"', "text original", false],
    ['foo "original text"', "original separated text", false],
    ['foo -"original text"', "original text", false],
    ['foo -"original text"', "text original", true],
    ['foo "original text', "original text", true],
    ['foo "original text', "text original", false],
    ['foo "" -fictional', "fictional", false],
    ["foo OR bar -fictional", "foo fictional", true],
    ["foo OR bar -fictional", "bar fictional", false],
    ["foo OR bar -fictional", "bar", true],
    ["foo OR bar -fictional", "unrelated", false],
    ["(foo OR bar) -fictional", "foo fictional", true],
    ["foo or bar -fictional", "bar fictional", false],
    ["foo OR OR bar", "or bar", true],
    ["foo OR OR bar", "bar", false],
    ["foo,OR,bar", "semantic candidate", true],
    ["foo -https://example.test/a-b", "https /example.test/a-b", false],
    ["foo -https://example.test/a-b", "/example.test/a-b", true],
    ["foo –fictional", "fictional", true],
    ["foo ―fictional", "fictional", true],
    ['foo -"nonroad emissions"', "non-road emission", false],
    ['foo -"nonroad emissions"', "non-road separated emission", true],
    ['foo "nonroad emissions"', "non road emission", true],
    ['foo "nonroad emissions"', "non road separated emission", false],
    // Native -non road excludes only the lexeme "non". The unquoted positive
    // "road" remains a soft hybrid term, unlike the complete native FTS query.
    ["foo -non road", "nonroad", true],
    ["foo -non road", "road", true],
    ["foo -non-road", "nonroad", false],
    ["foo -EU_REGULATIONS_2026", "EU_REGULATIONS_2026", false],
    ["foo -EU_REGULATIONS_2026", "EU_REGULATION_2026", true],
    ['foo "EU_REGULATIONS_2026"', "EU_REGULATION_2026", false],
    ['foo "EU_REGULATIONS_2026"', "EU_REGULATIONS_2026", true],
    ['dieselqueryquote0x "original text"', "original text", true],
  ] as const)("%s / %s -> %s", async (query, content, expected) => {
    expect(await eligible(query, content)).toBe(expected);
  });

  it("retains the native predicate after spelling expansion overflow", async () => {
    const query = `"${"nonroad ".repeat(8).trim()}"`;
    expect(await eligible(query, "nonroad ".repeat(8))).toBe(true);
    expect(await eligible(query, "non-road ".repeat(8))).toBe(false);
    expect(await eligible(`-${query}`, "nonroad ".repeat(8))).toBe(false);
  });

  it("keeps a native negative atom without turning soft positive terms into requirements", async () => {
    const { rows } = await database.query<{ negative: boolean; whole: boolean }>(
      "SELECT to_tsvector('simple', 'nonroad') @@ websearch_to_tsquery('simple', '-non') AS negative, to_tsvector('simple', 'nonroad') @@ websearch_to_tsquery('simple', '-non road') AS whole",
    );
    expect(rows[0]).toEqual({ negative: true, whole: false });
    expect(await eligible("foo -non road", "nonroad")).toBe(true);
    expect(await eligible("foo -non road", "non road")).toBe(false);
  });

  it("checks cancellation and rejects reordered or malformed native responses", async () => {
    for (const rows of [[], [{ index: 1, query: "'x'" }], [{ index: 0, query: null }]]) {
      await expect(resolveKnowledgeCandidateConstraint("-x", async () => rows)).rejects.toThrow();
    }
    const controller = new AbortController();
    const parser = vi.fn(async () => { controller.abort(); return [{ index: 0, query: "!'x'" }]; });
    await expect(resolveKnowledgeCandidateConstraint("-x", parser, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    parser.mockClear();
    await expect(resolveKnowledgeCandidateConstraint("-x", parser, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(parser).not.toHaveBeenCalled();
  });

  it("does not parse ordinary text or swallow native database errors", async () => {
    const error = new Error("native parse failed");
    const parser = vi.fn(async () => { throw error; });
    expect(await resolveKnowledgeCandidateConstraint("emissions regulations", parser)).toBeNull();
    expect(parser).not.toHaveBeenCalled();
    await expect(resolveKnowledgeCandidateConstraint("-fictional", parser)).rejects.toBe(error);
  });
});
