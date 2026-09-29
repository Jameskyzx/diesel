import { isKnowledgeResultRelevant } from "./retrieval-policy";

type RankedCandidate = {
  candidate: { chunkId: string; rankingPath?: 0 | 1 };
  finalScore: number;
  keywordScore: number;
  vectorScore: number;
};

/** Keep one already-relevant complete score pair, never mix retrieval channels. */
export function selectKnowledgeRankingCandidates<T extends RankedCandidate>(rows: readonly T[]): T[] {
  const selected = new Map<string, T>();
  for (const row of rows) {
    if (!isKnowledgeResultRelevant(row)) continue;
    const previous = selected.get(row.candidate.chunkId);
    if (!previous || row.finalScore > previous.finalScore ||
      (row.finalScore === previous.finalScore &&
        (row.candidate.rankingPath ?? 0) < (previous.candidate.rankingPath ?? 0))) {
      selected.set(row.candidate.chunkId, row);
    }
  }
  return [...selected.values()];
}
