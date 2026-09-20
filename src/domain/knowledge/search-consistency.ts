import { compareCanonicalText } from "@/domain/canonical-order";

import {
  isKnowledgeResultRelevant,
  unwrapUntrustedKnowledgeExcerpt,
  wrapUntrustedKnowledgeExcerpt,
} from "@/domain/knowledge/retrieval-policy";

const scorePrecision = 6;

type KnowledgeSearchFilters = {
  applicationScope: string | null;
  asOf: string | null;
  countryIso3: string | null;
  jurisdictionId: string | null;
  limit: number;
};

type KnowledgeSearchHit = {
  applicationScope: string | null;
  chunkId: string;
  content: string;
  countryIso3: string | null;
  document: { source: { isDemo: boolean } };
  finalScore: number;
  jurisdiction: { id: string } | null;
  keywordScore: number;
  pageFrom: number | null;
  pageTo: number | null;
  rank: number;
  validFrom: string | null;
  validTo: string | null;
  vectorScore: number;
  warnings: readonly string[];
};

type KnowledgeSearchResponse = {
  filters: KnowledgeSearchFilters;
  query: string;
  results: readonly KnowledgeSearchHit[];
  scoring: {
    keywordWeight: number;
    vectorWeight: number;
  };
};

type KnowledgeSearchQuery = KnowledgeSearchFilters & { query: string };

type AiKnowledgeSearchResult = {
  informationAsOf: string;
  resolvedCountryIso3: string | null;
  search: KnowledgeSearchResponse;
  status: "error" | "no_data" | "ok";
  tool: "searchKnowledgeBase";
  warnings: readonly string[];
};

export const CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT = 5;
export const KNOWLEDGE_APPLICATION_SCOPE_MISSING_WARNING =
  "该片段未记录应用场景 metadata。";
export const KNOWLEDGE_COUNTRY_MISSING_WARNING =
  "该片段未记录国家 metadata。";
export const KNOWLEDGE_DEMO_WARNING =
  "结果包含明确标记的虚构 Demo 数据，不得作为真实法规或市场事实。";
export const KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING =
  "没有足够证据支持肯定结论；请补充结构化事实或可追溯来源。";
export const KNOWLEDGE_TOOL_EXECUTION_FAILURE_WARNING =
  "工具查询失败，不能据此生成法规或产品结论。请稍后重试。";
export const KNOWLEDGE_VALID_FROM_MISSING_WARNING =
  "该片段未记录 validFrom，日期适用性仍需人工核验。";

export function roundKnowledgeScore(value: number): number {
  return Number(value.toFixed(scorePrecision));
}

/** Recomputes the public fused score only from the public component scores. */
export function recomputeKnowledgeFinalScore(input: {
  keywordScore: number;
  keywordWeight: number;
  vectorScore: number;
  vectorWeight: number;
}): number {
  return roundKnowledgeScore(
    input.keywordScore * input.keywordWeight +
      input.vectorScore * input.vectorWeight,
  );
}

function isCanonicalPublicScore(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1 &&
    roundKnowledgeScore(value) === value
  );
}

export function expectedKnowledgeHitWarnings(input: {
  applicationScope: string | null;
  countryIso3: string | null;
  validFrom: string | null;
}): string[] {
  return [
    ...(input.validFrom === null
      ? [KNOWLEDGE_VALID_FROM_MISSING_WARNING]
      : []),
    ...(input.countryIso3 === null
      ? [KNOWLEDGE_COUNTRY_MISSING_WARNING]
      : []),
    ...(input.applicationScope === null
      ? [KNOWLEDGE_APPLICATION_SCOPE_MISSING_WARNING]
      : []),
  ];
}

function sameStrings(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function hasValidHalfOpenInterval(hit: KnowledgeSearchHit): boolean {
  if (hit.validTo === null) {
    return true;
  }
  return hit.validFrom !== null && hit.validTo > hit.validFrom;
}

function appliesAt(
  hit: KnowledgeSearchHit,
  asOf: string | null,
): boolean {
  if (asOf === null) {
    return true;
  }

  return (
    (hit.validFrom === null || hit.validFrom <= asOf) &&
    (hit.validTo === null || asOf < hit.validTo)
  );
}

function hasValidPageInterval(hit: KnowledgeSearchHit): boolean {
  if (hit.pageFrom === null) {
    return hit.pageTo === null;
  }
  if (hit.pageTo === null) {
    return true;
  }
  if (hit.pageTo < hit.pageFrom) {
    return false;
  }
  return true;
}

function hitMatchesFilters(
  hit: KnowledgeSearchHit,
  filters: KnowledgeSearchFilters,
): boolean {
  return (
    (filters.applicationScope === null ||
      hit.applicationScope === filters.applicationScope) &&
    (filters.countryIso3 === null ||
      hit.countryIso3 === filters.countryIso3) &&
    (filters.jurisdictionId === null ||
      hit.jurisdiction?.id === filters.jurisdictionId) &&
    appliesAt(hit, filters.asOf)
  );
}

function hitScoresMatch(
  hit: KnowledgeSearchHit,
  response: KnowledgeSearchResponse,
): boolean {
  if (
    !isCanonicalPublicScore(hit.keywordScore) ||
    !isCanonicalPublicScore(hit.vectorScore) ||
    !isCanonicalPublicScore(hit.finalScore)
  ) {
    return false;
  }

  return (
    hit.finalScore ===
      recomputeKnowledgeFinalScore({
        keywordScore: hit.keywordScore,
        keywordWeight: response.scoring.keywordWeight,
        vectorScore: hit.vectorScore,
        vectorWeight: response.scoring.vectorWeight,
      }) &&
    isKnowledgeResultRelevant(hit)
  );
}

/**
 * Recomputes the invariants visible in a raw hybrid-search response. Database
 * completeness and the correctness of source metadata remain outside this
 * payload-only boundary.
 */
export function hybridSearchResponseMatchesDeterministicRules(
  value: unknown,
): boolean {
  try {
    const response = value as KnowledgeSearchResponse;
    if (
      typeof response.query !== "string" ||
      response.query !== response.query.trim() ||
      response.query.length === 0 ||
      response.query.length > 500 ||
      response.scoring.keywordWeight !== 0.5 ||
      response.scoring.vectorWeight !== 0.5 ||
      !Number.isInteger(response.filters.limit) ||
      response.filters.limit < 1 ||
      response.results.length > response.filters.limit
    ) {
      return false;
    }

    const seenChunkIds = new Set<string>();
    for (const [index, hit] of response.results.entries()) {
      if (
        typeof hit.chunkId !== "string" ||
        hit.chunkId.length === 0 ||
        seenChunkIds.has(hit.chunkId) ||
        hit.rank !== index + 1 ||
        !hasValidPageInterval(hit) ||
        !hasValidHalfOpenInterval(hit) ||
        !hitMatchesFilters(hit, response.filters) ||
        !hitScoresMatch(hit, response) ||
        !sameStrings(hit.warnings, expectedKnowledgeHitWarnings(hit))
      ) {
        return false;
      }
      seenChunkIds.add(hit.chunkId);

      const next = response.results[index + 1];
      if (
        next &&
        (next.finalScore > hit.finalScore ||
          (next.finalScore === hit.finalScore &&
            compareCanonicalText(next.chunkId, hit.chunkId) < 0))
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/** Requires the service response to echo every canonical parsed query field. */
export function hybridSearchResponseMatchesQuery(
  response: unknown,
  query: KnowledgeSearchQuery,
): boolean {
  if (!hybridSearchResponseMatchesDeterministicRules(response)) {
    return false;
  }

  const parsed = response as KnowledgeSearchResponse;
  return (
    parsed.query === query.query &&
    parsed.filters.applicationScope === query.applicationScope &&
    parsed.filters.asOf === query.asOf &&
    parsed.filters.countryIso3 === query.countryIso3 &&
    parsed.filters.jurisdictionId === query.jurisdictionId &&
    parsed.filters.limit === query.limit
  );
}

/** True only when the model-visible excerpt has the exact outer boundary. */
export function hasExactUntrustedKnowledgeExcerptBoundary(
  content: string,
): boolean {
  const unwrapped = unwrapUntrustedKnowledgeExcerpt(content);
  return unwrapped !== content && wrapUntrustedKnowledgeExcerpt(unwrapped) === content;
}

/** Adds AI-only wrapper and outer query-echo rules to the raw response rules. */
export function aiKnowledgeSearchResultMatchesDeterministicRules(
  value: unknown,
): boolean {
  try {
    const result = value as AiKnowledgeSearchResult;
    if (
      result.tool !== "searchKnowledgeBase" ||
      !hybridSearchResponseMatchesDeterministicRules(result.search) ||
      !result.search.results.every(({ content }) =>
        hasExactUntrustedKnowledgeExcerptBoundary(content),
      )
    ) {
      return false;
    }

    const expectedWarnings =
      result.status === "error"
        ? [KNOWLEDGE_TOOL_EXECUTION_FAILURE_WARNING]
        : result.search.results.length === 0
          ? [KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING]
          : [
              ...result.search.results.flatMap(({ warnings }) => warnings),
              ...(result.search.results.some(
                ({ document }) => document.source.isDemo,
              )
                ? [KNOWLEDGE_DEMO_WARNING]
                : []),
            ];
    if (!sameStrings(result.warnings, expectedWarnings)) {
      return false;
    }

    return (
      result.status === "error" ||
      (result.informationAsOf === result.search.filters.asOf &&
        result.resolvedCountryIso3 === result.search.filters.countryIso3 &&
        aiKnowledgeSearchUsesCanonicalNarrowing(result))
    );
  } catch {
    return false;
  }
}

/**
 * AI search never trusts provider-chosen jurisdiction or result-count
 * narrowing. The executor uses these fixed values for every model call.
 */
export function aiKnowledgeSearchUsesCanonicalNarrowing(
  value: unknown,
): boolean {
  try {
    const result = value as AiKnowledgeSearchResult;
    return (
      result.search.filters.jurisdictionId === null &&
      result.search.filters.limit === CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT
    );
  } catch {
    return false;
  }
}
