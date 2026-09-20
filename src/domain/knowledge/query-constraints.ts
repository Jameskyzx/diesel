import { prepareKnowledgeSpellingQuery } from "./knowledge-spelling-query";
import { parsePgTsQuery, printPgTsQuery, type PgTsQuery } from "./pg-tsquery";

// This is not a parser for websearch operators. PostgreSQL still decides
// negation, OR precedence, punctuation and implicit compound-word phrases.
// Quote markers only distinguish explicitly requested phrases from the soft
// unquoted terms used by hybrid retrieval.
export function prepareKnowledgeQueryConstraints(query: string, expandSpelling = true) {
  if (query.length > 500) throw new RangeError("Knowledge query exceeds its bound");
  const spelling = expandSpelling ? prepareKnowledgeSpellingQuery(query) : null;
  const source = spelling?.query ?? query;
  let prefix = "dieselqueryquote";
  while (source.toLowerCase().includes(prefix)) prefix += "x";
  const quotes: Array<{ marker: string; query: string }> = [];
  const masked = source.replace(/"[^"]*(?:"|$)/gu, (quoted) => {
    if (!/[\p{L}\p{N}]/u.test(quoted)) return quoted;
    const marker = `${prefix}${quotes.length}x`;
    quotes.push({ marker, query: quoted });
    return `"${marker}"`;
  });
  return { masked, prefix, quotes, spelling };
}

export type PreparedKnowledgeQueryConstraints = ReturnType<typeof prepareKnowledgeQueryConstraints>;

/** Conservative parse hint only; known scope aliases are unquoted soft terms. */
export function knowledgeQueryMayHaveConstraints(query: string): boolean {
  const source = prepareKnowledgeSpellingQuery(query)?.query ?? query;
  return /["-]|\bor\b/iu.test(source);
}

/**
 * A bounded structural equivalence key, not a Boolean theorem prover. Native
 * AND/OR association, order and duplication are irrelevant; phrase positions
 * and odd negation remain significant. Unsupported syntax fails closed.
 */
export function knowledgeQueryConstraintKey(canonical: string): string {
  const root = parsePgTsQuery(canonical);
  if (!root) throw new Error("Unsupported native query constraint key");
  let work = 0;
  const key = (node: PgTsQuery): string => {
    if (++work > 16_384) throw new Error("Native constraint key work limit");
    if (node.kind === "lexeme") return `L${JSON.stringify(node.value)}`;
    if (node.kind === "not") {
      return node.child.kind === "not" ? key(node.child.child)
        : `N(${key(node.child)})`;
    }
    if (node.kind === "phrase") return `P${node.distance}(${key(node.left)},${key(node.right)})`;
    const kind = node.kind;
    const children: string[] = [];
    const collect = (child: PgTsQuery) => {
      if (++work > 16_384) throw new Error("Native constraint key work limit");
      if (child.kind === kind) { collect(child.left); collect(child.right); }
      else children.push(key(child));
    };
    collect(node.left); collect(node.right);
    const unique = [...new Set(children)].sort();
    return unique.length === 1 ? unique[0]! : `${kind === "and" ? "A" : "O"}(${unique.join(",")})`;
  };
  const result = key(root);
  if (result.length > 262_144) throw new Error("Native constraint key size limit");
  return result;
}

/** Null means no hard predicate; unsupported nonempty syntax is an error. */
export function projectKnowledgeQueryConstraints(
  prepared: PreparedKnowledgeQueryConstraints,
  canonicalQueries: readonly string[],
): PgTsQuery | null {
  if (canonicalQueries.length !== prepared.quotes.length + 1) {
    throw new Error("Native query binding count mismatch");
  }
  const parse = (text: string): PgTsQuery | null => {
    if (text === "") return null;
    const parsed = parsePgTsQuery(text);
    if (!parsed) throw new Error("Unsupported native query constraints");
    return parsed;
  };
  const root = parse(canonicalQueries[0]!);
  if (!root) return null;
  const quotes = new Map(prepared.quotes.map(({ marker }, index) => [marker, parse(canonicalQueries[index + 1]!)]));
  let work = 0;
  const tick = () => { if (++work > 16_384) throw new Error("Native query constraint work limit"); };
  const containsQuote = (node: PgTsQuery): boolean => {
    tick();
    if (node.kind === "lexeme") return quotes.has(node.value);
    if (node.kind === "not") return containsQuote(node.child);
    return containsQuote(node.left) || containsQuote(node.right);
  };
  const materialize = (node: PgTsQuery): PgTsQuery => {
    tick();
    if (node.kind === "lexeme") {
      if (!quotes.has(node.value)) return node;
      const quote = quotes.get(node.value);
      if (!quote) throw new Error("Empty native quote binding");
      return quote;
    }
    if (node.kind === "not") return { ...node, child: materialize(node.child) };
    return { ...node, left: materialize(node.left), right: materialize(node.right) };
  };
  const project = (node: PgTsQuery): PgTsQuery | null => {
    tick();
    if (node.kind === "not") {
      // --term has the same hybrid semantics as the unquoted positive term.
      return node.child.kind === "not" ? project(node.child.child) : materialize(node);
    }
    // An OR branch needs its positive anchors; stripping them would make the
    // disjunction trivially true and allow exclusions to be bypassed.
    if (node.kind === "or") return materialize(node);
    if (node.kind === "and") {
      const left = project(node.left), right = project(node.right);
      return left && right ? { kind: "and", left, right } : left ?? right;
    }
    return containsQuote(node) ? materialize(node) : null;
  };
  const result = project(root);
  if (result) {
    const printed = printPgTsQuery(result);
    if (!printed || printed.includes(prepared.prefix)) throw new Error("Unresolved native query constraint");
  }
  return result;
}
