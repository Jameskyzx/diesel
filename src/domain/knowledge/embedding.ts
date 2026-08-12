export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 128;
export const KNOWLEDGE_EMBEDDING_MODEL = "local-hash-embedding-v1" as const;

export function tokenizeKnowledgeText(value: string): string[] {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en")
      .match(/[\p{Script=Han}]|[\p{Letter}\p{Number}]+/gu) ?? []
  );
}

function hashToken(value: string, seed: number): number {
  let hash = seed >>> 0;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

export function createLocalHashEmbedding(value: string): number[] {
  const vector = Array.from<number>({
    length: KNOWLEDGE_EMBEDDING_DIMENSIONS,
  }).fill(0);
  const counts = new Map<string, number>();

  for (const token of tokenizeKnowledgeText(value)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  for (const [token, count] of counts) {
    const index =
      hashToken(token, 2_166_136_261) % KNOWLEDGE_EMBEDDING_DIMENSIONS;
    const sign = hashToken(token, 1_315_423_911) % 2 === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign * Math.sqrt(count);
  }

  const magnitude = Math.sqrt(
    vector.reduce((sum, component) => sum + component * component, 0),
  );

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((component) => component / magnitude);
}

