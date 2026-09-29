import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expandKnowledgeSpellingQuery, prepareKnowledgeSpellingQuery } from "@/domain/knowledge/knowledge-spelling-query";

let database: PGlite;
beforeAll(async () => { database = new PGlite(); await database.waitReady; }, 15_000);
afterAll(async () => { await database?.close(); });

async function expanded(query: string): Promise<string | null> {
  const prepared = prepareKnowledgeSpellingQuery(query);
  if (!prepared) return null;
  const { rows } = await database.query<{ query: string }>("SELECT websearch_to_tsquery('simple', $1)::text AS query", [prepared.query]);
  return expandKnowledgeSpellingQuery(prepared, rows[0]!.query);
}

async function matches(query: string, content: string, nativeOnly = false): Promise<boolean> {
  const canonical = nativeOnly ? null : await expanded(query);
  const { rows } = await database.query<{ matches: boolean }>(
    "SELECT to_tsvector('simple', $1) @@ COALESCE($2::tsquery, websearch_to_tsquery('simple', $3)) AS matches",
    [content, canonical, query],
  );
  return rows[0]!.matches;
}

const spellings = ["nonroad", "non-road", "non road"];

describe("scope spelling expansion against native PostgreSQL", () => {
  it.each(spellings)("matches every standalone spelling for %s", async (query) => {
    expect(await expanded(query)).not.toBeNull();
    for (const content of spellings) expect(await matches(query, content)).toBe(true);
    for (const content of ["road", "non", "marine", "nonroadside"]) expect(await matches(query, content)).toBe(false);
  });

  it.each(spellings)("keeps whole phrase positions and negation for %s", async (scope) => {
    for (const variant of spellings) {
      for (const [query, content] of [
        [`"${scope} emissions"`, `${variant} emissions`],
        [`"emissions ${scope}"`, `emissions ${variant}`],
        [`"new ${scope} emissions"`, `new ${variant} emissions`],
      ]) {
        expect(await matches(query!, content!)).toBe(true);
        expect(await matches(`regulations -${query}`, `regulations ${content}`)).toBe(false);
      }
      for (const content of [`${variant} unrelated emissions`, `emissions unrelated ${variant}`, `emissions ${variant}`]) {
        expect(await matches(`"${scope} emissions"`, content)).toBe(false);
        expect(await matches(`regulations -"${scope} emissions"`, `regulations ${content}`)).toBe(true);
      }
    }
  });

  it.each([
    ["nonroad emissions", "non-road emissions", true],
    ["nonroad emissions", "non-road", false],
    ["nonroad OR marine", "marine", true],
    ["nonroad OR marine", "road", false],
    ["regulations -nonroad", "regulations non-road", false],
    ["regulations -non-road", "regulations nonroad", false],
    ["regulations -nonroad", "regulations non unrelated road", true],
    ["-non road", "nonroad", false],
    ["-non road", "road", true],
    ["non -road", "non", true],
    ["non road", "non unrelated road", true],
    ["nonroad", "non unrelated road", false],
    ["non-road", "road non", false],
    ["non road OR marine -nonroad", "nonroad", true],
    ["nonroad non road -marine", "non-road", true],
    ["nonroad -nonroad", "non-road", false],
    ['"nonroad and emissions"', "non-road emissions", false],
    ['"nonroad and emissions"', "non road and emissions", true],
    ['"nonroad non-road non road"', "non road nonroad non-road", true],
    ['"nonroad non-road non road"', "non road nonroad gap non-road", false],
  ] as const)("preserves native operators: %s / %s", async (query, content, expected) => {
    expect(await matches(query, content)).toBe(expected);
  });

  it.each([
    "EU_NONROAD_2026", "EU-NONROAD-2026", "nonroad-2026", "EU.NONROAD.2026",
    "EU/NONROAD/2026", "EU:NONROAD:2026", "https://example.test/nonroad",
    "https://nonroad.example.test", "?scope=nonroad", "nonroad@example.test",
    "foo–nonroad", "nonroad–2026", "préNonroad", "nonroad型", "nonroadside",
    "𠮷nonroad", "nonroad𠮷", "𝒜nonroad", "nonroad𝒜",
  ])("does not expand identifier or URL %s", async (query) => {
    expect(prepareKnowledgeSpellingQuery(query)).toBeNull();
    for (const content of [query, query.replace(/nonroad/giu, "non-road")]) {
      expect(await matches(query, content)).toBe(await matches(query, content, true));
    }
  });

  it("protects identifiers even when another occurrence is ordinary prose", async () => {
    const query = "nonroad EU_NONROAD_2026";
    expect(await matches(query, "non-road EU_NONROAD_2026")).toBe(true);
    expect(await matches(query, "non-road EU_NON_ROAD_2026")).toBe(false);
    expect(await matches(query, "nonroad EU_NONROAD_2027")).toBe(false);
  });

  it.each(["nonroad.", "nonroad?", "nonroad:", "nonroad,", "(nonroad)", '"nonroad."'])("keeps prose punctuation eligible: %s", async (query) => {
    expect(await expanded(query)).not.toBeNull();
    expect(await matches(query, "non-road")).toBe(true);
  });

  it("does not collide with user words or leak generated markers", async () => {
    const query = "dieselspellingalias0x NONROAD non\troad";
    const prepared = prepareKnowledgeSpellingQuery(query)!;
    expect(prepared.prefix).not.toBe("dieselspellingalias");
    expect(await expanded(query)).not.toContain(prepared.prefix);
    expect(await matches(query, "dieselspellingalias0x non-road")).toBe(true);
    expect(await matches(query, "non-road")).toBe(false);
  });

  it("falls back to native behavior when the bounded complete-phrase expansion is too large", async () => {
    const query = `"${Array.from({ length: 8 }, () => "nonroad").join(" ")}"`;
    expect(await expanded(query)).toBeNull();
    expect(await matches(query, "nonroad ".repeat(8))).toBe(true);
    expect(await matches(query, "non-road ".repeat(8))).toBe(false);
    expect(prepareKnowledgeSpellingQuery("nonroad ".repeat(80))).toBeNull();
  });

  it("rejects unsupported native syntax without publishing markers", () => {
    const prepared = prepareKnowledgeSpellingQuery("nonroad")!;
    expect(expandKnowledgeSpellingQuery(prepared, `'${prepared.bindings.keys().next().value}':*`)).toBeNull();
    expect(expandKnowledgeSpellingQuery(prepared, `'${prepared.prefix}unknown'`)).toBeNull();
  });
});
