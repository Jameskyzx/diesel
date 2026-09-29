import {
  CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT,
  KNOWLEDGE_DEMO_WARNING,
  KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING,
  KNOWLEDGE_TOOL_EXECUTION_FAILURE_WARNING,
} from "@/domain/knowledge/search-consistency";
import { OPPORTUNITY_SCORE_RULESET_VERSION } from "@/features/marketing/constants";
import type {
  AiCitation,
  AiToolResult,
} from "@/features/ai/schemas";
import type {
  OpportunityScoreGap,
  OpportunityScoreWeights,
} from "@/features/marketing/schemas";

export const COUNTRY_PROFILE_REGULATIONS_MISSING_WARNING =
  "所请求国家没有可见的当前 effective 或未来 adopted 法规证据。";
export const COUNTRY_PROFILE_MARKET_MISSING_WARNING =
  "所请求国家没有结构化市场指标证据。";

const canonicalKnowledgeEmbeddingModel = "local-hash-embedding-v1";
const canonicalScoreComponentKeys = [
  "marketPotential",
  "productReadiness",
  "regulatoryCoverage",
] as const satisfies readonly (keyof OpportunityScoreWeights)[];

function exactSequence(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function exactValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => exactValue(value, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).toSorted();
  const rightKeys = Object.keys(rightRecord).toSorted();
  return (
    exactSequence(leftKeys, rightKeys) &&
    leftKeys.every((key) => exactValue(leftRecord[key], rightRecord[key]))
  );
}

function citationsContainDemo(citations: readonly AiCitation[]): boolean {
  return citations.some(({ isDemo }) => isDemo);
}

export function opportunityScoreGapWarning(
  gap: OpportunityScoreGap,
  countryIso3: string,
): string {
  if (gap.code === "PRODUCT_READINESS_UNKNOWN") {
    return `${countryIso3}: PRODUCT_READINESS_UNKNOWN (${gap.count})`;
  }
  if (gap.code === "UNSUPPORTED_METRIC_DIRECTION") {
    return `${countryIso3}: UNSUPPORTED_METRIC_DIRECTION (${gap.metricCodes.join(", ")})`;
  }
  return `${countryIso3}: ${gap.code}`;
}

export function unknownProductsEvidenceWarning(count: number): string {
  return `${count} 个产品因当前可见证据不足而标记为 unknown。`;
}

/**
 * Rebuilds the exact server-authored warning sequence from public structured
 * state. Raw warning text is never accepted as an independent fact channel.
 */
export function expectedAiToolResultWarnings(
  result: AiToolResult,
): string[] {
  if (result.status === "error") {
    return [KNOWLEDGE_TOOL_EXECUTION_FAILURE_WARNING];
  }

  const insufficient = result.evidenceSufficient
    ? []
    : [KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING];
  const demo = citationsContainDemo(result.citations)
    ? [KNOWLEDGE_DEMO_WARNING]
    : [];

  if (result.tool === "searchKnowledgeBase") {
    return result.search.results.length === 0
      ? [KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING]
      : [
          ...result.search.results.flatMap(({ warnings }) => warnings),
          ...demo,
        ];
  }
  if (result.tool === "getCountryProfile") {
    if (
      result.profile === null ||
      result.profile.status === "no_data" ||
      result.resolvedCountryIso3 === null
    ) {
      return [KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING];
    }
    const missingTopics = result.requestedTopics.flatMap((topic) => {
      if (
        topic === "regulations" &&
        result.profile?.status === "available" &&
        result.profile.country.currentEffectiveRegulations.length === 0 &&
        result.profile.country.futureAdoptedRegulations.length === 0
      ) {
        return [COUNTRY_PROFILE_REGULATIONS_MISSING_WARNING];
      }
      if (
        topic === "market" &&
        result.profile?.status === "available" &&
        result.profile.country.marketMetrics.length === 0
      ) {
        return [COUNTRY_PROFILE_MARKET_MISSING_WARNING];
      }
      return [];
    });
    return [...insufficient, ...missingTopics, ...demo];
  }
  if (result.tool === "findCompatibleProducts") {
    const unknownCount = result.evaluations.filter(
      ({ status }) => status === "unknown",
    ).length;
    return [
      ...insufficient,
      ...(unknownCount > 0
        ? [unknownProductsEvidenceWarning(unknownCount)]
        : []),
      ...demo,
    ];
  }
  if (result.tool === "compareRegulations") {
    return [
      ...insufficient,
      ...result.comparison.missingData,
      ...demo,
    ];
  }
  if (result.tool === "compareMarkets") {
    return [
      ...insufficient,
      ...result.comparison.missingData,
      ...demo,
    ];
  }
  if (result.tool === "calculateOpportunityScore") {
    return [
      ...insufficient,
      ...result.scorecard.scores.flatMap((score) =>
        score.gaps.map((gap) =>
          opportunityScoreGapWarning(gap, score.countryIso3),
        ),
      ),
      ...demo,
    ];
  }
  return [
    ...insufficient,
    ...result.brief.gaps.map((gap) =>
      opportunityScoreGapWarning(
        gap,
        result.brief.marketScore.countryIso3,
      ),
    ),
    ...demo,
  ];
}

export function aiToolResultWarningsMatchFacts(value: unknown): boolean {
  try {
    const result = value as AiToolResult;
    return exactSequence(
      result.warnings,
      expectedAiToolResultWarnings(result),
    );
  } catch {
    return false;
  }
}

function unavailableScoreComponents(weights: OpportunityScoreWeights) {
  return canonicalScoreComponentKeys.map((key) => ({
    configuredWeight: weights[key],
    contribution: null,
    effectiveWeight: 0,
    key,
    score: null,
    status: "missing" as const,
  }));
}

function canonicalAnalysisQuery(query: {
  applicationScope: string;
  asOf: string;
  countryIso3s: readonly string[];
  metricCodes?: readonly string[];
  powerKw: number;
  productModelCode?: string;
}) {
  return {
    applicationScope: query.applicationScope,
    asOf: query.asOf,
    countryIso3s: [...query.countryIso3s],
    ...(query.metricCodes === undefined
      ? {}
      : { metricCodes: [...query.metricCodes] }),
    powerKw: query.powerKw,
    ...(query.productModelCode === undefined
      ? {}
      : { productModelCode: query.productModelCode }),
  };
}

function unavailableProvenance(query: ReturnType<typeof canonicalAnalysisQuery>) {
  return {
    marketComparison: {
      metrics: [],
      missingData: [],
      query: {
        applicationScope: query.applicationScope,
        countryIso3s: [...query.countryIso3s],
        ...(query.metricCodes === undefined
          ? {}
          : { metricCodes: [...query.metricCodes] }),
      },
      sources: [],
    },
    productEvaluations: query.countryIso3s.map((countryIso3) => ({
      countryIso3,
      evaluations: [],
    })),
    regulationComparison: {
      countries: query.countryIso3s.map((countryIso3) => ({
        countryIsDemo: false,
        countryIso3,
        countryName: null,
        countrySource: null,
        currentEffectiveRegulations: [],
        futureAdoptedRegulations: [],
        status: "no_data" as const,
      })),
      missingData: [],
      query: {
        applicationScope: query.applicationScope,
        asOf: query.asOf,
        countryIso3s: [...query.countryIso3s],
        powerKw: query.powerKw,
      },
      sources: [],
    },
  };
}

/**
 * Returns the only substantive payload allowed for an error envelope. It is
 * intentionally derived from the embedded, already-canonical request fields.
 */
export function expectedCanonicalToolErrorPayload(
  result: AiToolResult,
): unknown {
  if (result.tool === "searchKnowledgeBase") {
    return {
      resolvedCountryIso3: result.search.filters.countryIso3,
      search: {
        embeddingModel: canonicalKnowledgeEmbeddingModel,
        filters: {
          applicationScope: result.search.filters.applicationScope,
          asOf: result.informationAsOf,
          countryIso3: result.search.filters.countryIso3,
          jurisdictionId: null,
          limit: CANONICAL_AI_KNOWLEDGE_RESULT_LIMIT,
        },
        query: result.search.query,
        results: [],
        scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
        status: "ok" as const,
      },
    };
  }
  if (result.tool === "getCountryProfile") {
    return {
      profile: null,
      requestedTopics: [...result.requestedTopics],
      resolvedCountryIso3: result.resolvedCountryIso3,
    };
  }
  if (result.tool === "findCompatibleProducts") {
    return {
      evaluations: [],
      query: {
        applicationScope: result.query.applicationScope,
        asOf: result.informationAsOf,
        countryIso3: result.query.countryIso3,
        powerKw: result.query.powerKw,
        ...(result.query.productModelCode === undefined
          ? {}
          : { productModelCode: result.query.productModelCode }),
      },
    };
  }
  if (result.tool === "compareRegulations") {
    const query = {
      applicationScope: result.comparison.query.applicationScope,
      asOf: result.comparison.query.asOf,
      countryIso3s: [...result.comparison.query.countryIso3s],
      powerKw: result.comparison.query.powerKw,
    };
    return {
      comparison: {
        countries: query.countryIso3s.map((countryIso3) => ({
          countryIsDemo: false,
          countryIso3,
          countryName: null,
          countrySource: null,
          currentEffectiveRegulations: [],
          futureAdoptedRegulations: [],
          status: "no_data" as const,
        })),
        missingData: [],
        query,
        sources: [],
      },
    };
  }
  if (result.tool === "compareMarkets") {
    return {
      comparison: {
        metrics: [],
        missingData: [],
        query: {
          ...(result.comparison.query.applicationScope === undefined
            ? {}
            : {
                applicationScope:
                  result.comparison.query.applicationScope,
              }),
          countryIso3s: [...result.comparison.query.countryIso3s],
          ...(result.comparison.query.metricCodes === undefined
            ? {}
            : { metricCodes: [...result.comparison.query.metricCodes] }),
        },
        sources: [],
      },
    };
  }
  if (result.tool === "calculateOpportunityScore") {
    const query = canonicalAnalysisQuery(result.scorecard.query);
    return {
      scorecard: {
        provenance: unavailableProvenance(query),
        query,
        rulesetVersion: OPPORTUNITY_SCORE_RULESET_VERSION,
        scores: query.countryIso3s.map((countryIso3) => ({
          components: unavailableScoreComponents(result.scorecard.weights),
          countryIso3,
          dataCoveragePct: 0,
          gaps: [{ code: "TOOL_EXECUTION_FAILED" as const }],
          overallScore: null,
        })),
        sources: [],
        weights: result.scorecard.weights,
      },
    };
  }

  const query = canonicalAnalysisQuery(result.brief.query);
  return {
    brief: {
      gaps: [{ code: "TOOL_EXECUTION_FAILED" as const }],
      marketScore: {
        components: unavailableScoreComponents(
          Object.fromEntries(
            result.brief.marketScore.components.map(
              ({ configuredWeight, key }) => [key, configuredWeight],
            ),
          ) as OpportunityScoreWeights,
        ),
        countryIso3: result.brief.query.targetCountryIso3,
        dataCoveragePct: 0,
        gaps: [{ code: "TOOL_EXECUTION_FAILED" as const }],
        overallScore: null,
      },
      opportunities: [],
      provenance: unavailableProvenance(query),
      query: {
        ...query,
        targetCountryIso3: result.brief.query.targetCountryIso3,
      },
      recommendedProducts: [],
      risks: [],
      salesActions: [],
      sources: [],
    },
  };
}

function actualToolPayload(result: AiToolResult): unknown {
  if (result.tool === "searchKnowledgeBase") {
    return {
      resolvedCountryIso3: result.resolvedCountryIso3,
      search: result.search,
    };
  }
  if (result.tool === "getCountryProfile") {
    return {
      profile: result.profile,
      requestedTopics: result.requestedTopics,
      resolvedCountryIso3: result.resolvedCountryIso3,
    };
  }
  if (result.tool === "findCompatibleProducts") {
    return { evaluations: result.evaluations, query: result.query };
  }
  if (result.tool === "compareRegulations") {
    return { comparison: result.comparison };
  }
  if (result.tool === "compareMarkets") {
    return { comparison: result.comparison };
  }
  if (result.tool === "calculateOpportunityScore") {
    return { scorecard: result.scorecard };
  }
  return { brief: result.brief };
}

/** Rejects every error envelope that carries facts, advice, or query drift. */
export function canonicalToolErrorResultMatchesNoFacts(
  value: unknown,
): boolean {
  try {
    const result = value as AiToolResult;
    if (result.status !== "error") return true;
    if (
      result.evidenceSufficient ||
      result.citations.length !== 0 ||
      result.latestVerifiedAt !== null ||
      !aiToolResultWarningsMatchFacts(result)
    ) {
      return false;
    }
    return exactValue(
      actualToolPayload(result),
      expectedCanonicalToolErrorPayload(result),
    );
  } catch {
    return false;
  }
}
