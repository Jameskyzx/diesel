import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  expandKnowledgeSpellingQuery,
  prepareKnowledgeSpellingQuery,
} from "@/domain/knowledge/knowledge-spelling-query";
import { printPgTsQuery, tsQueryLimits } from "@/domain/knowledge/pg-tsquery";
import { knowledgeQueryConstraintKey, knowledgeQueryMayHaveConstraints, prepareKnowledgeQueryConstraints, projectKnowledgeQueryConstraints } from "@/domain/knowledge/query-constraints";
import { throwIfRequestAborted, type RequestSignalOptions } from "@/server/http/request-signal";

// Deliberately bounded inflections, not stemming, translation or synonyms.
// The stored `simple` tsvector and local-hash embeddings remain unchanged.
const knowledgeInflections = [
  ["emission", "emissions"],
  ["regulation", "regulations"],
  ["section", "sections"],
  ["citation", "citations"],
  ["source", "sources"],
  ["requirement", "requirements"],
  ["limit", "limits"],
] as const;

function identifierLexemes(query: string): ReadonlySet<string> {
  const normalized = query.normalize("NFKC").toLocaleLowerCase("en")
    .replace(/[\u2010-\u2015\u2212]/gu, "-");
  const compounds = normalized.match(
    /[\p{Letter}\p{Number}]+(?:[-_./:][\p{Letter}\p{Number}]+)+/gu,
  ) ?? [];
  return new Set(compounds.flatMap((compound) => compound.split(/[-_./:]/u)));
}

/**
 * Expands exact parsed lexemes in the keyword query only. Rewriting the tsquery
 * tree preserves phrase order, conjunctions and negation; rewriting raw search
 * text could turn an excluded word into an unrelated positive alternative.
 * Every value is parameterized. Only the fixed inflection table supplies
 * tsquery syntax, never caller text. The parsed/echoed query and metadata filters
 * continue to use the original Zod-validated input.
 */
export function buildKnowledgeTextQuery(query: string, initialExpression?: SQL): SQL {
  let expression = initialExpression ?? sql`websearch_to_tsquery('simple', ${query})`;
  const queryWords = new Set(
    query.toLocaleLowerCase("en").match(/[\p{Letter}\p{Number}]+/gu) ?? [],
  );
  const protectedLexemes = identifierLexemes(query);
  for (const [singular, plural] of knowledgeInflections) {
    if (!queryWords.has(singular) && !queryWords.has(plural)) continue;
    // PostgreSQL can split codes such as EU_REGULATIONS_2026 into a phrase.
    // Global ts_rewrite cannot distinguish that occurrence from ordinary prose,
    // so protect the entire pair whenever it also appears inside a compound.
    if (protectedLexemes.has(singular) || protectedLexemes.has(plural)) continue;
    // First collapse both spellings to one lexeme, then expand it once. This
    // avoids recursively rewriting an alternative inserted by the same pair.
    expression = sql`ts_rewrite(
      ts_rewrite(${expression}, ${plural}::tsquery, ${singular}::tsquery),
      ${singular}::tsquery,
      ${`${singular} | ${plural}`}::tsquery
    )`;
  }
  return expression;
}

const nativeSpellingQueryRows = z.array(z.object({
  query: z.string().max(tsQueryLimits.characters),
}).strict()).length(1);

/** One extra, data-independent native parse only for eligible scope spellings. */
export async function resolveKnowledgeTextQuery(
  query: string,
  parseNative: (maskedQuery: string) => Promise<unknown>,
  options: RequestSignalOptions = {},
): Promise<SQL> {
  throwIfRequestAborted(options.signal);
  const prepared = prepareKnowledgeSpellingQuery(query);
  if (!prepared) return buildKnowledgeTextQuery(query);
  const rows = await parseNative(prepared.query);
  throwIfRequestAborted(options.signal);
  const canonical = nativeSpellingQueryRows.parse(rows)[0]!.query;
  const expanded = expandKnowledgeSpellingQuery(prepared, canonical);
  return buildKnowledgeTextQuery(query, expanded === null ? undefined : sql`${expanded}::tsquery`);
}

const nativeConstraintRows = z.array(z.object({
  index: z.number().int().nonnegative(),
  query: z.string().max(tsQueryLimits.characters),
}).strict()).max(251);

/** One bounded, data-independent native batch; only operator queries need it. */
export async function resolveKnowledgeCandidateConstraint(
  query: string,
  parseNative: (queries: readonly string[]) => Promise<unknown>,
  options: RequestSignalOptions = {},
): Promise<SQL | null> {
  throwIfRequestAborted(options.signal);
  // A conservative fast path, not syntax interpretation. Compound hyphens may
  // cause a harmless parse, but only the native AST can produce an exclusion.
  if (!knowledgeQueryMayHaveConstraints(query)) return null;
  for (const expandSpelling of [true, false]) {
    const prepared = prepareKnowledgeQueryConstraints(query, expandSpelling);
    const input = [prepared.masked, ...prepared.quotes.map((quote) => quote.query)];
    const rows = nativeConstraintRows.parse(await parseNative(input));
    throwIfRequestAborted(options.signal);
    if (rows.length !== input.length || rows.some((row, index) => row.index !== index)) {
      throw new Error("Native constraint response order mismatch");
    }
    const constraint = projectKnowledgeQueryConstraints(prepared, rows.map((row) => row.query));
    if (!constraint) return null;
    const canonical = printPgTsQuery(constraint);
    if (canonical === null) throw new Error("Native constraint serialization limit");
    const expanded = prepared.spelling ? expandKnowledgeSpellingQuery(prepared.spelling, canonical) : canonical;
    // On bounded spelling overflow, re-project the original native spelling.
    // Never drop the predicate or send private markers to candidate retrieval.
    if (expanded === null) continue;
    return buildKnowledgeTextQuery(query, sql`${expanded}::tsquery`);
  }
  throw new Error("Native query constraint could not be preserved");
}

/** Compare the same inflection/spelling-expanded predicate used by retrieval. */
export async function resolveKnowledgeConstraintKey(
  query: string,
  parseNative: (queries: readonly string[]) => Promise<unknown>,
  readCanonical: (expression: SQL) => Promise<unknown>,
  options: RequestSignalOptions = {},
): Promise<string | null> {
  const expression = await resolveKnowledgeCandidateConstraint(query, parseNative, options);
  if (!expression) return null;
  const rows = nativeSpellingQueryRows.parse(await readCanonical(expression));
  throwIfRequestAborted(options.signal);
  return knowledgeQueryConstraintKey(rows[0]!.query);
}
