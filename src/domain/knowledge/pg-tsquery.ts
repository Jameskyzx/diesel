// A deliberately small reader for PostgreSQL's canonical websearch tsquery
// output, not a second parser for the user's search language. Unsupported
// syntax is rejected so callers can keep the original native query.
export type PgTsQuery =
  | { kind: "lexeme"; value: string }
  | { kind: "not"; child: PgTsQuery }
  | { kind: "and" | "or"; left: PgTsQuery; right: PgTsQuery }
  | { kind: "phrase"; left: PgTsQuery; right: PgTsQuery; distance: number };

export const tsQueryLimits = { characters: 32_768, nodes: 4_096, depth: 128 } as const;

class UnsupportedTsQuery extends Error {}

export function parsePgTsQuery(text: string): PgTsQuery | null {
  if (text.length > tsQueryLimits.characters) return null;
  let offset = 0;
  let nodes = 0;
  const heights = new WeakMap<PgTsQuery, number>();
  const skip = () => { while (/\s/u.test(text[offset] ?? "")) offset += 1; };
  const node = <T extends PgTsQuery>(value: T): T => {
    if (++nodes > tsQueryLimits.nodes) throw new UnsupportedTsQuery();
    const height = value.kind === "lexeme" ? 1 : value.kind === "not"
      ? 1 + (heights.get(value.child) ?? 0)
      : 1 + Math.max(heights.get(value.left) ?? 0, heights.get(value.right) ?? 0);
    if (height > tsQueryLimits.depth) throw new UnsupportedTsQuery();
    heights.set(value, height);
    return value;
  };
  function atom(depth: number): PgTsQuery {
    if (depth > tsQueryLimits.depth) throw new UnsupportedTsQuery();
    skip();
    if (text[offset] === "!") {
      offset += 1;
      return node({ kind: "not", child: atom(depth + 1) });
    }
    if (text[offset] === "(") {
      offset += 1;
      const value = expression(0, depth + 1);
      skip();
      if (text[offset++] !== ")") throw new UnsupportedTsQuery();
      return value;
    }
    if (text[offset++] !== "'") throw new UnsupportedTsQuery();
    let value = "";
    while (offset < text.length) {
      const character = text[offset++];
      if (character === "'") {
        if (text[offset] === "'") { value += "'"; offset += 1; }
        else {
          if (!value || value.includes("\0")) throw new UnsupportedTsQuery();
          return node({ kind: "lexeme", value });
        }
      } else if (character === "\\") {
        if (offset >= text.length) throw new UnsupportedTsQuery();
        value += text[offset++];
      } else value += character;
    }
    throw new UnsupportedTsQuery();
  }
  function expression(minimum: number, depth: number): PgTsQuery {
    let left = atom(depth);
    for (;;) {
      skip();
      const token = /^(\||&|<->|<\d+>)/u.exec(text.slice(offset))?.[0];
      if (!token) return left;
      const precedence = token === "|" ? 1 : token === "&" ? 2 : 3;
      if (precedence < minimum) return left;
      offset += token.length;
      const right = expression(precedence + 1, depth + 1);
      if (token === "|" || token === "&") {
        left = node({ kind: token === "|" ? "or" : "and", left, right });
      } else {
        const distance = token === "<->" ? 1 : Number(token.slice(1, -1));
        if (!Number.isSafeInteger(distance) || distance > 16_384) throw new UnsupportedTsQuery();
        left = node({ kind: "phrase", left, right, distance });
      }
    }
  }
  try {
    const result = expression(0, 0);
    skip();
    return offset === text.length ? result : null;
  } catch (error) {
    if (error instanceof UnsupportedTsQuery) return null;
    throw error;
  }
}

export function printPgTsQuery(root: PgTsQuery): string | null {
  // Iterative traversal also bounds deeply left-associated AND/phrase trees.
  const work: (PgTsQuery | string)[] = [root];
  const parts: string[] = [];
  let nodes = 0;
  let characters = 0;
  while (work.length) {
    const item = work.pop()!;
    if (typeof item === "string") {
      characters += item.length;
      if (characters > tsQueryLimits.characters) return null;
      parts.push(item);
      continue;
    }
    if (++nodes > tsQueryLimits.nodes) return null;
    if (item.kind === "lexeme") {
      if (!item.value || item.value.includes("\0") || item.value.length > tsQueryLimits.characters) return null;
      work.push(`'${item.value.replace(/\\/gu, "\\\\").replace(/'/gu, "''")}'`);
    } else if (item.kind === "not") work.push(")", item.child, "!(");
    else {
      if (item.kind === "phrase" && (!Number.isSafeInteger(item.distance) || item.distance < 0 || item.distance > 16_384)) return null;
      const operator = item.kind === "phrase" ? `<${item.distance}>` : item.kind === "and" ? "&" : "|";
      work.push(")", item.right, ` ${operator} `, item.left, "(");
    }
  }
  return parts.join("");
}
