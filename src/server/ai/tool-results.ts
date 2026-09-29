import "server-only";

import {
  isKnowledgeResultRelevant,
  wrapUntrustedKnowledgeExcerpt,
} from "@/domain/knowledge/retrieval-policy";
import {
  KNOWLEDGE_DEMO_WARNING,
  KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING,
  KNOWLEDGE_TOOL_EXECUTION_FAILURE_WARNING,
} from "@/domain/knowledge/search-consistency";
import { countryOpportunityScoreMatchesMath } from "@/domain/marketing/opportunity-score";
import { latestVerifiedAtFromCitations } from "@/features/ai/evidence-semantics";
import type { CountryDetailResponse } from "@/features/countries/schemas";
import {
  calculateOpportunityScoreResultSchema,
  compareMarketsResultSchema,
  compareRegulationsResultSchema,
  findCompatibleProductsInputSchema,
  findCompatibleProductsResultSchema,
  generateSalesBriefResultSchema,
  getCountryProfileInputSchema,
  getCountryProfileResultSchema,
  searchKnowledgeBaseInputSchema,
  searchKnowledgeBaseResultSchema,
  type AiCitation,
  type AiToolResult,
  type CalculateOpportunityScoreResult,
  type CompareMarketsResult,
  type CompareRegulationsResult,
  type FindCompatibleProductsResult,
  type GenerateSalesBriefResult,
  type GetCountryProfileResult,
  type GetCountryProfileInput,
  type SearchKnowledgeBaseResult,
} from "@/features/ai/schemas";
import {
  canonicalToolErrorResultMatchesNoFacts,
  COUNTRY_PROFILE_MARKET_MISSING_WARNING,
  COUNTRY_PROFILE_REGULATIONS_MISSING_WARNING,
  opportunityScoreGapWarning,
  unknownProductsEvidenceWarning,
} from "@/features/ai/tool-result-envelope";
import type { HybridSearchResponse } from "@/features/knowledge/schemas";
import {
  calculateOpportunityScoreInputSchema,
  compareMarketsInputSchema,
  compareRegulationsInputSchema,
  generateSalesBriefInputSchema,
  type AnalysisSource,
  type CalculateOpportunityScoreInput,
  type CountryOpportunityScore,
  type MarketComparison,
  type OpportunityScorecard,
  type OpportunityScoreProvenance,
  type OpportunityScoreWeights,
  type RegulationComparison,
  type SalesBrief,
} from "@/features/marketing/schemas";
import type { ProductFitEvaluation } from "@/features/product-fit/schemas";
import { getOpportunityScoreWeights } from "@/server/config/opportunity-score-config";

const insufficientEvidenceWarning =
  KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING;
const opportunityScoreRuntimeMismatchMessage =
  "Opportunity-score payload does not match the runtime configuration.";
const opportunityScoreComponentKeys = [
  "marketPotential",
  "productReadiness",
  "regulatoryCoverage",
] as const satisfies readonly (keyof OpportunityScoreWeights)[];

function runtimeOpportunityScoreWeights(): OpportunityScoreWeights {
  try {
    return getOpportunityScoreWeights();
  } catch {
    throw new Error(opportunityScoreRuntimeMismatchMessage);
  }
}

function opportunityScoreWeightsMatch(
  actual: OpportunityScoreWeights,
  expected: OpportunityScoreWeights,
): boolean {
  return opportunityScoreComponentKeys.every(
    (key) => actual[key] === expected[key],
  );
}

function requireRuntimeOpportunityScoreWeights(
  actual: OpportunityScoreWeights,
): OpportunityScoreWeights {
  const expected = runtimeOpportunityScoreWeights();
  if (!opportunityScoreWeightsMatch(actual, expected)) {
    throw new Error(opportunityScoreRuntimeMismatchMessage);
  }

  return expected;
}

function unavailableOpportunityScoreComponents(
  weights: OpportunityScoreWeights,
): CountryOpportunityScore["components"] {
  return opportunityScoreComponentKeys.map((key) => ({
    configuredWeight: weights[key],
    contribution: null,
    effectiveWeight: 0,
    key,
    score: null,
    status: "missing",
  }));
}

function unavailableOpportunityScoreProvenance(
  query: CalculateOpportunityScoreInput,
): OpportunityScoreProvenance {
  return {
    marketComparison: {
      metrics: [],
      missingData: [],
      query: {
        applicationScope: query.applicationScope,
        countryIso3s: query.countryIso3s,
        ...(query.metricCodes === undefined
          ? {}
          : { metricCodes: query.metricCodes }),
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
        countryIso3s: query.countryIso3s,
        powerKw: query.powerKw,
      },
      sources: [],
    },
  };
}

export function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function uniqueCitations(citations: AiCitation[]): AiCitation[] {
  return Array.from(
    new Map(
      citations.map((citation) => [
        [
          citation.countryIso3,
          citation.sourceId,
          citation.documentId,
          citation.chunkId,
          citation.entityType,
          citation.entityId,
          citation.regulationId,
          citation.productCertificationId,
          citation.title,
        ].join(":"),
        citation,
      ]),
    ).values(),
  );
}

function citationsFromAnalysisSources(
  sources: AnalysisSource[],
): AiCitation[] {
  return uniqueCitations(
    sources.map((source) => ({
      chunkId: null,
      countryIso3: source.countryIso3,
      documentId: null,
      documentTitle: null,
      entityId: source.entityId,
      entityType: source.entityType,
      isDemo: source.isDemo,
      locator: source.locator,
      locatorDescriptor: source.locatorDescriptor,
      pageFrom: null,
      pageTo: null,
      productCertificationId:
        source.entityType === "product_certification"
          ? source.entityId
          : null,
      publishedOn: source.publishedOn,
      regulationId: source.regulationId,
      regulationStatus: source.regulationStatus,
      sectionLocator: null,
      sourceId: source.sourceId,
      sourceTitle: source.sourceTitle,
      sourceUrl: source.sourceUrl,
      title: source.title,
      titleDescriptor: source.titleDescriptor,
      verifiedAt: source.verifiedAt,
    })),
  );
}

function demoWarning(citations: AiCitation[]): string[] {
  return citations.some(({ isDemo }) => isDemo)
    ? [KNOWLEDGE_DEMO_WARNING]
    : [];
}

export function buildRegulationComparisonResult(input: {
  comparison: RegulationComparison;
  informationAsOf: string;
}): CompareRegulationsResult {
  const countryCitations = input.comparison.countries.flatMap(
    (country): AiCitation[] => {
      const source = country.countrySource;
      if (country.countryName === null || source === null) {
        return [];
      }
      return [
        {
          chunkId: null,
          countryIso3: country.countryIso3,
          documentId: null,
          documentTitle: null,
          isDemo: country.countryIsDemo || source.isDemo,
          locator: country.countryIso3,
          pageFrom: null,
          pageTo: null,
          productCertificationId: null,
          publishedOn: source.publishedOn,
          regulationId: null,
          regulationStatus: null,
          sectionLocator: null,
          sourceId: source.id,
          sourceTitle: source.title,
          sourceUrl: source.url,
          title: `${country.countryName} 国家概览`,
          titleDescriptor: {
            countryIsDemo: country.countryIsDemo,
            countryIso2: source.countryIso2,
            countryIso3: country.countryIso3,
            countryNameEn: country.countryName,
            countryNameLocal: source.countryNameLocal,
            countrySourceId: source.id,
            countrySourceIsDemo: source.isDemo,
            countrySourceTitle: source.title,
            kind: "country_profile",
          },
          verifiedAt: source.verifiedAt,
        },
      ];
    },
  );
  const citations = uniqueCitations([
    ...countryCitations,
    ...citationsFromAnalysisSources(input.comparison.sources),
  ]);
  const countriesWithEvidence = input.comparison.countries.filter(
    (country) =>
      country.currentEffectiveRegulations.length > 0 ||
      country.futureAdoptedRegulations.length > 0,
  ).length;
  const requiredCountriesWithEvidence = Math.min(
    2,
    input.comparison.query.countryIso3s.length,
  );
  const evidenceSufficient =
    requiredCountriesWithEvidence > 0 &&
    countriesWithEvidence >= requiredCountriesWithEvidence &&
    citations.length > 0;

  return compareRegulationsResultSchema.parse({
    citations,
    comparison: input.comparison,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAtFromCitations(citations),
    status: evidenceSufficient ? "ok" : "no_data",
    tool: "compareRegulations",
    warnings: [
      ...(evidenceSufficient ? [] : [insufficientEvidenceWarning]),
      ...input.comparison.missingData,
      ...demoWarning(citations),
    ],
  });
}

export function buildMarketComparisonResult(input: {
  comparison: MarketComparison;
  informationAsOf: string;
}): CompareMarketsResult {
  const citations = citationsFromAnalysisSources(input.comparison.sources);
  const evidenceSufficient =
    citations.length > 0 &&
    input.comparison.metrics.some(
      ({ comparisonStatus }) => comparisonStatus === "comparable",
    );

  return compareMarketsResultSchema.parse({
    citations,
    comparison: input.comparison,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAtFromCitations(citations),
    status: evidenceSufficient ? "ok" : "no_data",
    tool: "compareMarkets",
    warnings: [
      ...(evidenceSufficient ? [] : [insufficientEvidenceWarning]),
      ...input.comparison.missingData,
      ...demoWarning(citations),
    ],
  });
}

export function buildOpportunityScoreResult(input: {
  informationAsOf: string;
  scorecard: OpportunityScorecard;
}): CalculateOpportunityScoreResult {
  requireRuntimeOpportunityScoreWeights(input.scorecard.weights);
  const citations = citationsFromAnalysisSources(input.scorecard.sources);
  const evidenceSufficient =
    citations.length > 0 &&
    input.scorecard.scores.filter(({ overallScore }) => overallScore !== null)
      .length >= 2;

  return calculateOpportunityScoreResultSchema.parse({
    citations,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAtFromCitations(citations),
    scorecard: input.scorecard,
    status: evidenceSufficient ? "ok" : "no_data",
    tool: "calculateOpportunityScore",
    warnings: [
      ...(evidenceSufficient ? [] : [insufficientEvidenceWarning]),
      ...input.scorecard.scores.flatMap((score) =>
        score.gaps.map((gap) =>
          opportunityScoreGapWarning(gap, score.countryIso3),
        ),
      ),
      ...demoWarning(citations),
    ],
  });
}

export function buildSalesBriefResult(input: {
  brief: SalesBrief;
  informationAsOf: string;
}): GenerateSalesBriefResult {
  const runtimeWeights = runtimeOpportunityScoreWeights();
  if (
    !countryOpportunityScoreMatchesMath(
      input.brief.marketScore,
      runtimeWeights,
    )
  ) {
    throw new Error(opportunityScoreRuntimeMismatchMessage);
  }
  const citations = citationsFromAnalysisSources(input.brief.sources);
  const evidenceSufficient =
    citations.length > 0 &&
    (input.brief.marketScore.overallScore !== null ||
      input.brief.recommendedProducts.length > 0);

  return generateSalesBriefResultSchema.parse({
    brief: input.brief,
    citations,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAtFromCitations(citations),
    status: evidenceSufficient ? "ok" : "no_data",
    tool: "generateSalesBrief",
    warnings: [
      ...(evidenceSufficient ? [] : [insufficientEvidenceWarning]),
      ...input.brief.gaps.map((gap) =>
        opportunityScoreGapWarning(gap, input.brief.marketScore.countryIso3),
      ),
      ...demoWarning(citations),
    ],
  });
}

export function buildKnowledgeResult(input: {
  informationAsOf: string;
  resolvedCountryIso3: string | null;
  search: HybridSearchResponse;
}): SearchKnowledgeBaseResult {
  const relevantResults = input.search.results
    .filter((result) => isKnowledgeResultRelevant(result))
    .map((result, index) => ({
      ...result,
      content: wrapUntrustedKnowledgeExcerpt(result.content),
      rank: index + 1,
    }));
  const search = {
    ...input.search,
    results: relevantResults,
  };
  const citations = uniqueCitations(
    relevantResults.map((result) => ({
      chunkId: result.chunkId,
      countryIso3: result.countryIso3,
      documentId: result.document.id,
      documentTitle: result.document.title,
      isDemo: result.document.source.isDemo,
      locator:
        result.sectionLocator ??
        (result.pageFrom
          ? `第 ${result.pageFrom}${result.pageTo && result.pageTo !== result.pageFrom ? `–${result.pageTo}` : ""} 页`
          : null),
      pageFrom: result.pageFrom,
      pageTo: result.pageTo,
      productCertificationId: null,
      publishedOn:
        result.document.publishedOn ?? result.document.source.publishedOn,
      regulationId: null,
      regulationStatus: null,
      sectionLocator: result.sectionLocator,
      sourceId: result.document.source.id,
      sourceTitle: result.document.source.title,
      // Internal document downloads live behind the development-only route
      // and are relative URLs. They must not be exposed as public citations
      // or parsed as externally verifiable source links.
      sourceUrl: result.document.source.url,
      title: result.document.title,
      verifiedAt: result.document.source.verifiedAt,
    })),
  );
  const evidenceSufficient =
    relevantResults.length > 0 && citations.length > 0;
  return searchKnowledgeBaseResultSchema.parse({
    citations,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAtFromCitations(citations),
    resolvedCountryIso3: input.resolvedCountryIso3,
    search,
    status: evidenceSufficient ? "ok" : "no_data",
    tool: "searchKnowledgeBase",
    warnings: [
      ...(evidenceSufficient
        ? relevantResults.flatMap(({ warnings }) => warnings)
        : [insufficientEvidenceWarning]),
      ...demoWarning(citations),
    ],
  });
}

export function buildCountryProfileResult(input: {
  informationAsOf: string;
  profile: CountryDetailResponse | null;
  requestedTopics: GetCountryProfileInput["topics"];
  resolvedCountryIso3: string | null;
}): GetCountryProfileResult {
  if (
    input.profile === null ||
    input.profile.status === "no_data" ||
    input.resolvedCountryIso3 === null
  ) {
    return getCountryProfileResultSchema.parse({
      citations: [],
      evidenceSufficient: false,
      informationAsOf: input.informationAsOf,
      latestVerifiedAt: null,
      profile: input.profile,
      requestedTopics: input.requestedTopics,
      resolvedCountryIso3: input.resolvedCountryIso3,
      status: "no_data",
      tool: "getCountryProfile",
      warnings: [insufficientEvidenceWarning],
    });
  }

  const { country } = input.profile;
  const missingTopics = input.requestedTopics.filter((topic) => {
    if (topic === "regulations") {
      return (
        country.currentEffectiveRegulations.length === 0 &&
        country.futureAdoptedRegulations.length === 0
      );
    }
    if (topic === "market") {
      return country.marketMetrics.length === 0;
    }
    return false;
  });
  const hasRequiredFacts = missingTopics.length === 0;
  const jurisdictionCitations = country.jurisdictions.flatMap(
    (jurisdiction): AiCitation[] => [
      {
        chunkId: null,
        countryIso3: country.iso3,
        documentId: null,
        documentTitle: null,
        entityId: jurisdiction.id,
        entityType: "jurisdiction",
        isDemo: jurisdiction.isDemo || jurisdiction.source.isDemo,
        locator: jurisdiction.code,
        pageFrom: null,
        pageTo: null,
        productCertificationId: null,
        publishedOn: jurisdiction.source.publishedOn,
        regulationId: null,
        regulationStatus: null,
        sectionLocator: null,
        sourceId: jurisdiction.source.id,
        sourceTitle: jurisdiction.source.title,
        sourceUrl: jurisdiction.source.url,
        title: jurisdiction.name,
        verifiedAt: jurisdiction.source.verifiedAt,
      },
      {
        chunkId: null,
        countryIso3: country.iso3,
        documentId: null,
        documentTitle: null,
        entityId: jurisdiction.id,
        entityType: "country_jurisdiction",
        isDemo:
          jurisdiction.membershipIsDemo ||
          jurisdiction.membershipSource.isDemo,
        locator: `${jurisdiction.validFrom}–${jurisdiction.validTo ?? "open"}`,
        locatorDescriptor: {
          kind: "membership_period",
          validFrom: jurisdiction.validFrom,
          validTo: jurisdiction.validTo,
        },
        pageFrom: null,
        pageTo: null,
        productCertificationId: null,
        publishedOn: jurisdiction.membershipSource.publishedOn,
        regulationId: null,
        regulationStatus: null,
        sectionLocator: null,
        sourceId: jurisdiction.membershipSource.id,
        sourceTitle: jurisdiction.membershipSource.title,
        sourceUrl: jurisdiction.membershipSource.url,
        title: `${jurisdiction.name} 对 ${country.iso3} 的成员关系`,
        titleDescriptor: {
          countryIso3: country.iso3,
          jurisdictionName: jurisdiction.name,
          kind: "country_jurisdiction_membership",
        },
        verifiedAt: jurisdiction.membershipSource.verifiedAt,
      },
    ],
  );
  const regulationCitations = [
    ...country.currentEffectiveRegulations,
    ...country.futureAdoptedRegulations,
  ].flatMap(
    (regulation): AiCitation[] => [
      {
        chunkId: null,
        countryIso3: country.iso3,
        documentId: null,
        documentTitle: null,
        entityId: regulation.id,
        entityType: "regulation",
        isDemo: regulation.isDemo || regulation.source.isDemo,
        locator: regulation.citationCode,
        pageFrom: null,
        pageTo: null,
        productCertificationId: null,
        publishedOn: regulation.source.publishedOn,
        regulationId: regulation.id,
        regulationStatus: regulation.status,
        sectionLocator: null,
        sourceId: regulation.source.id,
        sourceTitle: regulation.source.title,
        sourceUrl: regulation.source.url,
        title: regulation.canonicalName,
        verifiedAt: regulation.source.verifiedAt,
      },
      {
        chunkId: null,
        countryIso3: country.iso3,
        documentId: null,
        documentTitle: null,
        entityId: regulation.applicability.jurisdiction.id,
        entityType: "jurisdiction",
        isDemo:
          regulation.applicability.jurisdiction.isDemo ||
          regulation.applicability.jurisdiction.source.isDemo,
        locator: regulation.applicability.jurisdiction.code,
        pageFrom: null,
        pageTo: null,
        productCertificationId: null,
        publishedOn:
          regulation.applicability.jurisdiction.source.publishedOn,
        regulationId: regulation.id,
        regulationStatus: regulation.status,
        sectionLocator: null,
        sourceId: regulation.applicability.jurisdiction.source.id,
        sourceTitle: regulation.applicability.jurisdiction.source.title,
        sourceUrl: regulation.applicability.jurisdiction.source.url,
        title: `${regulation.canonicalName} 适用辖区：${regulation.applicability.jurisdiction.name}`,
        titleDescriptor: {
          jurisdictionName: regulation.applicability.jurisdiction.name,
          kind: "regulation_jurisdiction",
          regulationName: regulation.canonicalName,
        },
        verifiedAt:
          regulation.applicability.jurisdiction.source.verifiedAt,
      },
      {
        chunkId: null,
        countryIso3: country.iso3,
        documentId: null,
        documentTitle: null,
        entityId: regulation.applicability.jurisdiction.id,
        entityType: "country_jurisdiction",
        isDemo:
          regulation.applicability.jurisdiction.isDemo ||
          regulation.applicability.membership.isDemo ||
          regulation.applicability.jurisdiction.source.isDemo ||
          regulation.applicability.membership.source.isDemo,
        locator: `${regulation.applicability.membership.validFrom}–${regulation.applicability.membership.validTo ?? "open"}`,
        locatorDescriptor: {
          kind: "membership_period",
          validFrom: regulation.applicability.membership.validFrom,
          validTo: regulation.applicability.membership.validTo,
        },
        pageFrom: null,
        pageTo: null,
        productCertificationId: null,
        publishedOn: regulation.applicability.membership.source.publishedOn,
        regulationId: regulation.id,
        regulationStatus: regulation.status,
        sectionLocator: null,
        sourceId: regulation.applicability.membership.source.id,
        sourceTitle: regulation.applicability.membership.source.title,
        sourceUrl: regulation.applicability.membership.source.url,
        title: `${regulation.applicability.jurisdiction.name} 对 ${country.iso3} 的成员关系`,
        titleDescriptor: {
          countryIso3: country.iso3,
          jurisdictionName: regulation.applicability.jurisdiction.name,
          kind: "country_jurisdiction_membership",
        },
        verifiedAt: regulation.applicability.membership.source.verifiedAt,
      },
    ],
  );
  const applicabilityCitations = input.profile.applicabilitySummary
    ? citationsFromAnalysisSources(input.profile.applicabilitySummary.sources)
    : [];
  const marketCitations = country.marketMetrics.map(
    (metric): AiCitation => ({
      chunkId: null,
      countryIso3: metric.countryIso3,
      documentId: null,
      documentTitle: null,
      entityId: metric.id,
      entityType: "market_metric",
      isDemo: metric.isDemo || metric.source.isDemo,
      locator: `${metric.periodStart}–${metric.periodEnd}`,
      locatorDescriptor: {
        kind: "market_period",
        periodEnd: metric.periodEnd,
        periodStart: metric.periodStart,
      },
      pageFrom: null,
      pageTo: null,
      productCertificationId: null,
      publishedOn: metric.publishedOn ?? metric.source.publishedOn,
      regulationId: null,
      regulationStatus: null,
      sectionLocator: null,
      sourceId: metric.source.id,
      sourceTitle: metric.source.title,
      sourceUrl: metric.source.url,
      title: metric.metricName,
      titleDescriptor: {
        isDemo: metric.isDemo,
        kind: "market_metric",
        metricCode: metric.metricCode,
        metricId: metric.id,
        metricName: metric.metricName,
      },
      verifiedAt: metric.source.verifiedAt,
    }),
  );
  const countryCitation: AiCitation = {
    chunkId: null,
    countryIso3: country.iso3,
    documentId: null,
    documentTitle: null,
    isDemo: country.isDemo || country.source.isDemo,
    locator: country.iso3,
    pageFrom: null,
    pageTo: null,
    productCertificationId: null,
    publishedOn: country.source.publishedOn,
    regulationId: null,
    regulationStatus: null,
    sectionLocator: null,
    sourceId: country.source.id,
    sourceTitle: country.source.title,
    sourceUrl: country.source.url,
    title: `${country.nameEn} 国家概览`,
    titleDescriptor: {
      countryIsDemo: country.isDemo,
      countryIso2: country.iso2,
      countryIso3: country.iso3,
      countryNameEn: country.nameEn,
      countryNameLocal: country.nameLocal,
      countrySourceId: country.source.id,
      countrySourceIsDemo: country.source.isDemo,
      countrySourceTitle: country.source.title,
      kind: "country_profile",
    },
    verifiedAt: country.source.verifiedAt,
  };
  const citations = uniqueCitations([
    countryCitation,
    ...jurisdictionCitations,
    ...regulationCitations,
    ...applicabilityCitations,
    ...marketCitations,
  ]);
  const evidenceSufficient = hasRequiredFacts && citations.length > 0;

  return getCountryProfileResultSchema.parse({
    citations,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAtFromCitations(citations),
    profile: input.profile,
    requestedTopics: input.requestedTopics,
    resolvedCountryIso3: input.resolvedCountryIso3,
    status: evidenceSufficient ? "ok" : "no_data",
    tool: "getCountryProfile",
    warnings: [
      ...(evidenceSufficient ? [] : [insufficientEvidenceWarning]),
      ...missingTopics.map((topic) =>
        topic === "regulations"
          ? COUNTRY_PROFILE_REGULATIONS_MISSING_WARNING
          : COUNTRY_PROFILE_MARKET_MISSING_WARNING,
      ),
      ...demoWarning(citations),
    ],
  });
}

export function buildCompatibleProductsResult(input: {
  applicationScope: ProductFitEvaluation["input"]["applicationScope"];
  asOf: string;
  countryIso3: string | null;
  evaluations: ProductFitEvaluation[];
  powerKw: number;
  productModelCode?: string;
}): FindCompatibleProductsResult {
  const citations = uniqueCitations(
    input.evaluations.flatMap((evaluation) => {
      const productCitation: AiCitation[] = evaluation.product
        ? [
            {
              chunkId: null,
              countryIso3: input.countryIso3,
              documentId: null,
              documentTitle: null,
              entityId: evaluation.product.id,
              entityType: "product",
              isDemo:
                evaluation.product.isDemo ||
                evaluation.product.source.isDemo,
              locator: evaluation.product.modelCode,
              locatorDescriptor: {
                availableFrom: evaluation.product.availableFrom,
                availableTo: evaluation.product.availableTo,
                kind: "product_availability",
                modelCode: evaluation.product.modelCode,
                specificationVersion: evaluation.product.specificationVersion,
              },
              pageFrom: null,
              pageTo: null,
              productCertificationId: null,
              publishedOn: evaluation.product.source.publishedOn,
              regulationId: null,
              regulationStatus: null,
              sectionLocator: null,
              sourceId: evaluation.product.source.id,
              sourceTitle: evaluation.product.source.title,
              sourceUrl: evaluation.product.source.url,
              title: evaluation.product.name,
              verifiedAt: evaluation.product.source.verifiedAt,
            },
          ]
        : [];
      const evidenceCitations = evaluation.regulationChecks.flatMap(
        (regulationCheck): AiCitation[] => [
          {
            chunkId: null,
            countryIso3: input.countryIso3,
            documentId: null,
            documentTitle: null,
            entityId: regulationCheck.regulation.regulationId,
            entityType: "regulation",
            isDemo:
              regulationCheck.regulation.isDemo ||
              regulationCheck.regulation.source.isDemo,
            locator: regulationCheck.regulation.citationCode,
            pageFrom: null,
            pageTo: null,
            productCertificationId: null,
            publishedOn: regulationCheck.regulation.source.publishedOn,
            regulationId: regulationCheck.regulation.regulationId,
            regulationStatus: regulationCheck.regulation.recordStatus,
            sectionLocator: null,
            sourceId: regulationCheck.regulation.source.id,
            sourceTitle: regulationCheck.regulation.source.title,
            sourceUrl: regulationCheck.regulation.source.url,
            title: regulationCheck.regulation.canonicalName,
            verifiedAt: regulationCheck.regulation.source.verifiedAt,
          },
          {
            chunkId: null,
            countryIso3:
              regulationCheck.regulation.applicability.countryIso3,
            documentId: null,
            documentTitle: null,
            entityId:
              regulationCheck.regulation.applicability.jurisdiction.id,
            entityType: "jurisdiction",
            isDemo:
              regulationCheck.regulation.applicability.jurisdiction.isDemo ||
              regulationCheck.regulation.applicability.jurisdiction.source
                .isDemo,
            locator:
              regulationCheck.regulation.applicability.jurisdiction.code,
            pageFrom: null,
            pageTo: null,
            productCertificationId: null,
            publishedOn:
              regulationCheck.regulation.applicability.jurisdiction.source
                .publishedOn,
            regulationId: regulationCheck.regulation.regulationId,
            regulationStatus: regulationCheck.regulation.recordStatus,
            sectionLocator: null,
            sourceId:
              regulationCheck.regulation.applicability.jurisdiction.source.id,
            sourceTitle:
              regulationCheck.regulation.applicability.jurisdiction.source
                .title,
            sourceUrl:
              regulationCheck.regulation.applicability.jurisdiction.source.url,
            title:
              regulationCheck.regulation.applicability.jurisdiction.name,
            verifiedAt:
              regulationCheck.regulation.applicability.jurisdiction.source
                .verifiedAt,
          },
          {
            chunkId: null,
            countryIso3:
              regulationCheck.regulation.applicability.countryIso3,
            documentId: null,
            documentTitle: null,
            entityId:
              regulationCheck.regulation.applicability.jurisdiction.id,
            entityType: "country_jurisdiction",
            isDemo:
              regulationCheck.regulation.applicability.membership.isDemo ||
              regulationCheck.regulation.applicability.membership.source
                .isDemo,
            locator: `${regulationCheck.regulation.applicability.membership.validFrom}–${regulationCheck.regulation.applicability.membership.validTo ?? "open"}`,
            locatorDescriptor: {
              kind: "membership_period",
              validFrom:
                regulationCheck.regulation.applicability.membership.validFrom,
              validTo:
                regulationCheck.regulation.applicability.membership.validTo,
            },
            pageFrom: null,
            pageTo: null,
            productCertificationId: null,
            publishedOn:
              regulationCheck.regulation.applicability.membership.source
                .publishedOn,
            regulationId: regulationCheck.regulation.regulationId,
            regulationStatus: regulationCheck.regulation.recordStatus,
            sectionLocator: null,
            sourceId:
              regulationCheck.regulation.applicability.membership.source.id,
            sourceTitle:
              regulationCheck.regulation.applicability.membership.source.title,
            sourceUrl:
              regulationCheck.regulation.applicability.membership.source.url,
            title: `${regulationCheck.regulation.applicability.jurisdiction.name} 对 ${regulationCheck.regulation.applicability.countryIso3} 的成员关系`,
            titleDescriptor: {
              countryIso3:
                regulationCheck.regulation.applicability.countryIso3,
              jurisdictionName:
                regulationCheck.regulation.applicability.jurisdiction.name,
              kind: "country_jurisdiction_membership",
            },
            verifiedAt:
              regulationCheck.regulation.applicability.membership.source
                .verifiedAt,
          },
          ...regulationCheck.regulation.limitSources.map(
            (source): AiCitation => ({
              chunkId: null,
              countryIso3: input.countryIso3,
              documentId: null,
              documentTitle: null,
              isDemo: regulationCheck.regulation.isDemo || source.isDemo,
              locator: regulationCheck.regulation.citationCode,
              pageFrom: null,
              pageTo: null,
              productCertificationId: null,
              publishedOn: source.publishedOn,
              regulationId: regulationCheck.regulation.regulationId,
              regulationStatus: regulationCheck.regulation.recordStatus,
              sectionLocator: null,
              sourceId: source.id,
              sourceTitle: source.title,
              sourceUrl: source.url,
              title: `${regulationCheck.regulation.canonicalName} 适用限值`,
              titleDescriptor: {
                kind: "regulation_limits",
                regulationName: regulationCheck.regulation.canonicalName,
              },
              verifiedAt: source.verifiedAt,
            }),
          ),
          ...regulationCheck.certifications.map(
            ({ certification }): AiCitation => ({
              chunkId: null,
              countryIso3: input.countryIso3,
              documentId: null,
              documentTitle: null,
              entityId: certification.id,
              entityType: "product_certification",
              isDemo:
                certification.isDemo || certification.source.isDemo,
              locator: certification.certificateNumber,
              pageFrom: null,
              pageTo: null,
              productCertificationId: certification.id,
              publishedOn: certification.source.publishedOn,
              regulationId: certification.regulationId,
              regulationStatus: regulationCheck.regulation.recordStatus,
              sectionLocator: null,
              sourceId: certification.source.id,
              sourceTitle: certification.source.title,
              sourceUrl: certification.source.url,
              title:
                certification.certificateNumber ??
                `${evaluation.product?.modelCode ?? "产品"}认证记录`,
              ...(certification.certificateNumber === null
                ? {
                    titleDescriptor: {
                      kind: "product_certification_record" as const,
                      productModelCode: evaluation.product?.modelCode ?? null,
                    },
                  }
                : {}),
              verifiedAt: certification.source.verifiedAt,
            }),
          ),
        ],
      );

      return [...productCitation, ...evidenceCitations];
    }),
  );
  const evidenceSufficient =
    citations.length > 0 &&
    input.evaluations.length > 0 &&
    input.evaluations.some(({ status }) => status !== "unknown");
  const unknownCount = input.evaluations.filter(
    ({ status }) => status === "unknown",
  ).length;
  const warnings = [
    ...(evidenceSufficient ? [] : [insufficientEvidenceWarning]),
    ...(unknownCount > 0
      ? [unknownProductsEvidenceWarning(unknownCount)]
      : []),
    ...demoWarning(citations),
  ];

  return findCompatibleProductsResultSchema.parse({
    citations,
    evaluations: input.evaluations,
    evidenceSufficient,
    informationAsOf: input.asOf,
    latestVerifiedAt: latestVerifiedAtFromCitations(citations),
    query: {
      applicationScope: input.applicationScope,
      asOf: input.asOf,
      countryIso3: input.countryIso3,
      powerKw: input.powerKw,
      ...(input.productModelCode
        ? { productModelCode: input.productModelCode }
        : {}),
    },
    status: evidenceSufficient ? "ok" : "no_data",
    tool: "findCompatibleProducts",
    warnings,
  });
}

function assertCanonicalToolErrorResult<T extends AiToolResult>(
  result: T,
): T {
  if (!canonicalToolErrorResultMatchesNoFacts(result)) {
    throw new Error("Tool error result is not a canonical no-facts envelope.");
  }
  return result;
}

export function buildToolErrorResult(
  tool:
    | "searchKnowledgeBase"
    | "getCountryProfile"
    | "findCompatibleProducts"
    | "compareRegulations"
    | "compareMarkets"
    | "calculateOpportunityScore"
    | "generateSalesBrief",
  informationAsOf: string,
  rawInput: unknown,
) {
  const common = {
    citations: [],
    evidenceSufficient: false,
    informationAsOf,
    latestVerifiedAt: null,
    status: "error" as const,
    warnings: [KNOWLEDGE_TOOL_EXECUTION_FAILURE_WARNING],
  };

  if (tool === "searchKnowledgeBase") {
    const input = searchKnowledgeBaseInputSchema.parse(rawInput);
    const asOf = input.asOf ?? informationAsOf;
    if (asOf !== informationAsOf) {
      throw new Error("Knowledge error baseline does not match its query.");
    }
    const resolvedCountryIso3 = input.countryIso3 ?? null;
    return assertCanonicalToolErrorResult(searchKnowledgeBaseResultSchema.parse({
      ...common,
      resolvedCountryIso3,
      search: {
        embeddingModel: "local-hash-embedding-v1",
        filters: {
          applicationScope: input.applicationScope ?? null,
          asOf,
          countryIso3: resolvedCountryIso3,
          jurisdictionId: null,
          limit: 5,
        },
        query: input.query,
        results: [],
        scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
        status: "ok",
      },
      tool,
    }));
  }
  if (tool === "getCountryProfile") {
    const input = getCountryProfileInputSchema.parse(rawInput);
    const asOf = input.asOf ?? informationAsOf;
    if (asOf !== informationAsOf) {
      throw new Error("Country-profile error baseline does not match its query.");
    }
    return assertCanonicalToolErrorResult(getCountryProfileResultSchema.parse({
      ...common,
      profile: null,
      requestedTopics: input.topics,
      resolvedCountryIso3: input.countryIso3 ?? null,
      tool,
    }));
  }

  if (tool === "compareRegulations") {
    const input = compareRegulationsInputSchema.parse(rawInput);
    if (input.asOf !== informationAsOf) {
      throw new Error("Regulation error baseline does not match its query.");
    }
    return assertCanonicalToolErrorResult(compareRegulationsResultSchema.parse({
      ...common,
      comparison: {
        countries: input.countryIso3s.map((countryIso3) => ({
          countryIsDemo: false,
          countryIso3,
          countryName: null,
          countrySource: null,
          currentEffectiveRegulations: [],
          futureAdoptedRegulations: [],
          status: "no_data",
        })),
        missingData: [],
        query: input,
        sources: [],
      },
      tool,
    }));
  }
  if (tool === "compareMarkets") {
    const input = compareMarketsInputSchema.parse(rawInput);
    return assertCanonicalToolErrorResult(compareMarketsResultSchema.parse({
      ...common,
      comparison: {
        metrics: [],
        missingData: [],
        query: input,
        sources: [],
      },
      tool,
    }));
  }
  if (tool === "calculateOpportunityScore") {
    const input = calculateOpportunityScoreInputSchema.parse(rawInput);
    if (input.asOf !== informationAsOf) {
      throw new Error("Opportunity-score error baseline does not match its query.");
    }
    const weights = runtimeOpportunityScoreWeights();
    return assertCanonicalToolErrorResult(calculateOpportunityScoreResultSchema.parse({
      ...common,
      scorecard: {
        provenance: unavailableOpportunityScoreProvenance(input),
        query: input,
        rulesetVersion: "opportunity-score-v2",
        scores: input.countryIso3s.map((countryIso3) => ({
          components: unavailableOpportunityScoreComponents(weights),
          countryIso3,
          dataCoveragePct: 0,
          gaps: [{ code: "TOOL_EXECUTION_FAILED" as const }],
          overallScore: null,
        })),
        sources: [],
        weights,
      },
      tool,
    }));
  }
  if (tool === "generateSalesBrief") {
    const input = generateSalesBriefInputSchema.parse(rawInput);
    if (input.asOf !== informationAsOf) {
      throw new Error("Sales-brief error baseline does not match its query.");
    }
    const weights = runtimeOpportunityScoreWeights();
    return assertCanonicalToolErrorResult(generateSalesBriefResultSchema.parse({
      ...common,
      brief: {
        gaps: [{ code: "TOOL_EXECUTION_FAILED" as const }],
        marketScore: {
          components: unavailableOpportunityScoreComponents(weights),
          countryIso3: input.targetCountryIso3,
          dataCoveragePct: 0,
          gaps: [{ code: "TOOL_EXECUTION_FAILED" as const }],
          overallScore: null,
        },
        opportunities: [],
        provenance: unavailableOpportunityScoreProvenance(input),
        query: input,
        recommendedProducts: [],
        risks: [],
        salesActions: [],
        sources: [],
      },
      tool,
    }));
  }

  const input = findCompatibleProductsInputSchema.parse(rawInput);
  if (input.asOf !== informationAsOf) {
    throw new Error("Product-fit error baseline does not match its query.");
  }
  return assertCanonicalToolErrorResult(findCompatibleProductsResultSchema.parse({
    ...common,
    evaluations: [],
    query: {
      applicationScope: input.applicationScope,
      asOf: input.asOf,
      countryIso3: input.countryIso3 ?? null,
      powerKw: input.powerKw,
      ...(input.productModelCode
        ? { productModelCode: input.productModelCode }
        : {}),
    },
    tool,
  }));
}
