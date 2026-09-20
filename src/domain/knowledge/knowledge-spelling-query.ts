import { parsePgTsQuery, printPgTsQuery, type PgTsQuery } from "./pg-tsquery";
import { replaceStandaloneNonRoadSpellings } from "./non-road-spelling";

type Binding = { kind: "scope" } | { kind: "part"; pair: number; word: "non" | "road" };
export type KnowledgeSpellingQuery = {
  query: string;
  prefix: string;
  bindings: ReadonlyMap<string, Binding>;
};

const alternatives = [["nonroad"], ["non-road", "non", "road"], ["non", "road"]] as const;
const maxAlternatives = 128;

/** Mask only standalone prose spellings; compound IDs and URL tokens stay native. */
export function prepareKnowledgeSpellingQuery(query: string): KnowledgeSpellingQuery | null {
  if (query.length > 500) return null;
  let prefix = "dieselspellingalias";
  while (query.toLowerCase().includes(prefix)) prefix += "x";
  const bindings = new Map<string, Binding>();
  let pair = 0;
  const marker = (binding: Binding) => {
    const name = `${prefix}${bindings.size}x`;
    bindings.set(name, binding);
    return name;
  };
  const masked = replaceStandaloneNonRoadSpellings(query, (match) => {
    const space = /\s+/u.exec(match)?.[0];
    if (!space) return marker({ kind: "scope" });
    const currentPair = pair++;
    return marker({ kind: "part", pair: currentPair, word: "non" }) + space +
      marker({ kind: "part", pair: currentPair, word: "road" });
  });
  return bindings.size ? { query: masked, prefix, bindings } : null;
}

const lexeme = (value: string): PgTsQuery => ({ kind: "lexeme", value });
function join(kind: "and" | "or", terms: readonly PgTsQuery[]): PgTsQuery {
  return terms.slice(1).reduce<PgTsQuery>((left, right) => ({ kind, left, right }), terms[0]!);
}
function phrase(words: readonly string[], distances: readonly number[] = []): PgTsQuery {
  return words.slice(1).reduce<PgTsQuery>((left, word, index) => ({
    kind: "phrase", left, right: lexeme(word), distance: distances[index] ?? 1,
  }), lexeme(words[0]!));
}
function flattenAnd(tree: PgTsQuery): PgTsQuery[] {
  return tree.kind === "and" ? [...flattenAnd(tree.left), ...flattenAnd(tree.right)] : [tree];
}
function flattenPhrase(tree: PgTsQuery): { terms: PgTsQuery[]; distances: number[] } {
  if (tree.kind !== "phrase") return { terms: [tree], distances: [] };
  const left = flattenPhrase(tree.left);
  const right = flattenPhrase(tree.right);
  return { terms: [...left.terms, ...right.terms], distances: [...left.distances, tree.distance, ...right.distances] };
}

class ExpansionLimit extends Error {}

/**
 * Expand complete maximal phrases. Putting alternatives of unequal widths
 * inside FOLLOWED BY can incorrectly accept gaps; whole-phrase branches keep
 * adjacency, ordering and the enclosing NOT/AND/OR intact.
 */
export function expandKnowledgeSpellingQuery(prepared: KnowledgeSpellingQuery, nativeQuery: string): string | null {
  const root = parsePgTsQuery(nativeQuery);
  if (!root) return null;
  let work = 0;
  const binding = (term: PgTsQuery | undefined) => term?.kind === "lexeme" ? prepared.bindings.get(term.value) : undefined;
  const isPair = (first: PgTsQuery | undefined, second: PgTsQuery | undefined) => {
    const a = binding(first);
    const b = binding(second);
    return a?.kind === "part" && a.word === "non" && b?.kind === "part" && b.word === "road" && a.pair === b.pair;
  };
  const literal = (term: PgTsQuery): string => {
    if (term.kind !== "lexeme") throw new ExpansionLimit();
    const bound = binding(term);
    return bound?.kind === "part" ? bound.word : term.value;
  };
  function expand(tree: PgTsQuery): PgTsQuery {
    if (++work > 4_096) throw new ExpansionLimit();
    if (tree.kind === "not") return { kind: "not", child: expand(tree.child) };
    if (tree.kind === "or") return { kind: "or", left: expand(tree.left), right: expand(tree.right) };
    if (tree.kind === "and") {
      const terms = flattenAnd(tree);
      const result: PgTsQuery[] = [];
      for (let index = 0; index < terms.length; index++) {
        if (isPair(terms[index], terms[index + 1])) {
          // Unquoted "non road" originally means AND, not adjacency. Preserve
          // that branch; "-non road" must remain !non & road, not !(scope).
          result.push(join("or", [join("and", [lexeme("non"), lexeme("road")]), phrase(alternatives[0]), phrase(alternatives[1])]));
          index += 1;
        } else result.push(expand(terms[index]!));
      }
      return join("and", result);
    }
    if (tree.kind === "lexeme") {
      return binding(tree)?.kind === "scope" ? join("or", alternatives.map((words) => phrase(words))) : lexeme(literal(tree));
    }
    const { terms, distances } = flattenPhrase(tree);
    let branches: { words: string[]; distances: number[] }[] = [{ words: [], distances: [] }];
    for (let index = 0; index < terms.length; index++) {
      const paired = distances[index] === 1 && isPair(terms[index], terms[index + 1]);
      const choices: readonly (readonly string[])[] = paired || binding(terms[index])?.kind === "scope"
        ? alternatives : [[literal(terms[index]!)]];
      if (branches.length * choices.length > maxAlternatives) throw new ExpansionLimit();
      const gap = distances[index - 1];
      branches = branches.flatMap((branch) => choices.map((words) => {
        work += branch.words.length + words.length;
        if (work > 4_096) throw new ExpansionLimit();
        return {
          words: [...branch.words, ...words],
          distances: [...branch.distances, ...(branch.words.length ? [gap!] : []), ...words.slice(1).map(() => 1)],
        };
      }));
      if (paired) index += 1;
    }
    return join("or", branches.map((branch) => phrase(branch.words, branch.distances)));
  }
  try {
    const result = printPgTsQuery(expand(root));
    // Unknown/partially parsed markers must never reach a retrieval query.
    return result?.includes(prepared.prefix) ? null : result;
  } catch (error) {
    if (error instanceof ExpansionLimit) return null;
    throw error;
  }
}
