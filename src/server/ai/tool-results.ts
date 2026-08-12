import "server-only";

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
  type CalculateOpportunityScoreResult,
  type CompareMarketsResult,
  type CompareRegulationsResult,
  type FindCompatibleProductsResult,
  type GenerateSalesBriefResult,
  type GetCountryProfileResult,
  type GetCountryProfileInput,
  type SearchKnowledgeBaseResult,
} from "@/features/ai/schemas";
import type { HybridSearchResponse } from "@/features/knowledge/schemas";
import {
  calculateOpportunityScoreInputSchema,
  compareMarketsInputSchema,
  compareRegulationsInputSchema,
  generateSalesBriefInputSchema,
  type AnalysisSource,
  type MarketComparison,
  type OpportunityScorecard,
  type RegulationComparison,
  type SalesBrief,
} from "@/features/marketing/schemas";
import type { ProductFitEvaluation } from "@/features/product-fit/schemas";

const insufficientEvidenceWarning =
  "没有足够证据支持肯定结论；请补充结构化事实或可追溯来源。";

export function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function latestVerifiedAt(citations: AiCitation[]): string | null {
  return citations.map(({ verifiedAt }) => verifiedAt).toSorted().at(-1) ?? null;
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
      isDemo: source.isDemo,
      locator: source.locator,
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
      verifiedAt: source.verifiedAt,
    })),
  );
}

function demoWarning(citations: AiCitation[]): string[] {
  return citations.some(({ isDemo }) => isDemo)
    ? ["结果包含明确标记的虚构 Demo 数据，不得作为真实法规或市场事实。"]
    : [];
}

export function buildRegulationComparisonResult(input: {
  comparison: RegulationComparison;
  informationAsOf: string;
}): CompareRegulationsResult {
  const citations = citationsFromAnalysisSources(input.comparison.sources);
  const evidenceSufficient = input.comparison.countries.filter(
    (country) =>
      country.currentEffectiveRegulations.length > 0 ||
      country.futureAdoptedRegulations.length > 0,
  ).length >= 2;

  return compareRegulationsResultSchema.parse({
    citations,
    comparison: input.comparison,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAt(citations),
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
  const evidenceSufficient = input.comparison.metrics.some(
    ({ comparisonStatus }) => comparisonStatus === "comparable",
  );

  return compareMarketsResultSchema.parse({
    citations,
    comparison: input.comparison,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAt(citations),
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
  const citations = citationsFromAnalysisSources(input.scorecard.sources);
  const evidenceSufficient =
    input.scorecard.scores.filter(({ overallScore }) => overallScore !== null)
      .length >= 2;

  return calculateOpportunityScoreResultSchema.parse({
    citations,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAt(citations),
    scorecard: input.scorecard,
    status: evidenceSufficient ? "ok" : "no_data",
    tool: "calculateOpportunityScore",
    warnings: [
      ...(evidenceSufficient ? [] : [insufficientEvidenceWarning]),
      ...input.scorecard.scores.flatMap(({ missingData }) => missingData),
      ...demoWarning(citations),
    ],
  });
}

export function buildSalesBriefResult(input: {
  brief: SalesBrief;
  informationAsOf: string;
}): GenerateSalesBriefResult {
  const citations = citationsFromAnalysisSources(input.brief.sources);
  const evidenceSufficient =
    input.brief.marketScore.overallScore !== null ||
    input.brief.recommendedProducts.length > 0;

  return generateSalesBriefResultSchema.parse({
    brief: input.brief,
    citations,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAt(citations),
    status: evidenceSufficient ? "ok" : "no_data",
    tool: "generateSalesBrief",
    warnings: [
      ...(evidenceSufficient ? [] : [insufficientEvidenceWarning]),
      ...input.brief.missingData,
      ...demoWarning(citations),
    ],
  });
}

export function buildKnowledgeResult(input: {
  informationAsOf: string;
  resolvedCountryIso3: string | null;
  search: HybridSearchResponse;
}): SearchKnowledgeBaseResult {
  const citations = uniqueCitations(
    input.search.results.map((result) => ({
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
      sourceUrl:
        result.document.source.url ?? result.document.downloadUrl,
      title: result.document.title,
      verifiedAt: result.document.source.verifiedAt,
    })),
  );
  const evidenceSufficient = input.search.results.length > 0;

  return searchKnowledgeBaseResultSchema.parse({
    citations,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAt(citations),
    resolvedCountryIso3: input.resolvedCountryIso3,
    search: input.search,
    status: evidenceSufficient ? "ok" : "no_data",
    tool: "searchKnowledgeBase",
    warnings: [
      ...(evidenceSufficient
        ? input.search.results.flatMap(({ warnings }) => warnings)
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
  const evidenceSufficient = missingTopics.length === 0;
  const includeCountryEvidence = input.requestedTopics.includes("country");
  const includeRegulationEvidence = input.requestedTopics.includes(
    "regulations",
  );
  const includeMarketEvidence = input.requestedTopics.includes("market");
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
        verifiedAt:
          regulation.applicability.jurisdiction.source.verifiedAt,
      },
      {
        chunkId: null,
        countryIso3: country.iso3,
        documentId: null,
        documentTitle: null,
        isDemo:
          regulation.applicability.jurisdiction.isDemo ||
          regulation.applicability.membership.isDemo ||
          regulation.applicability.jurisdiction.source.isDemo ||
          regulation.applicability.membership.source.isDemo,
        locator: `${regulation.applicability.membership.validFrom}–${regulation.applicability.membership.validTo ?? "open"}`,
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
        title: `${regulation.canonicalName} 对 ${country.iso3} 的成员关系`,
        verifiedAt: regulation.applicability.membership.source.verifiedAt,
      },
    ],
  );
  const marketCitations = country.marketMetrics.map(
    (metric): AiCitation => ({
      chunkId: null,
      countryIso3: country.iso3,
      documentId: null,
      documentTitle: null,
      isDemo: metric.isDemo || metric.source.isDemo,
      locator: `${metric.periodStart}–${metric.periodEnd}`,
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
    verifiedAt: country.source.verifiedAt,
  };
  const citations = uniqueCitations([
    ...(includeCountryEvidence ? [countryCitation] : []),
    ...(includeRegulationEvidence ? regulationCitations : []),
    ...(includeMarketEvidence ? marketCitations : []),
  ]);

  return getCountryProfileResultSchema.parse({
    citations,
    evidenceSufficient,
    informationAsOf: input.informationAsOf,
    latestVerifiedAt: latestVerifiedAt(citations),
    profile: input.profile,
    requestedTopics: input.requestedTopics,
    resolvedCountryIso3: input.resolvedCountryIso3,
    status: evidenceSufficient ? "ok" : "no_data",
    tool: "getCountryProfile",
    warnings: [
      ...(evidenceSufficient ? [] : [insufficientEvidenceWarning]),
      ...missingTopics.map((topic) =>
        topic === "regulations"
          ? "所请求国家没有可见的当前 effective 或未来 adopted 法规证据。"
          : "所请求国家没有结构化市场指标证据。",
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
              isDemo:
                evaluation.product.isDemo ||
                evaluation.product.source.isDemo,
              locator: evaluation.product.modelCode,
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
            isDemo:
              regulationCheck.regulation.applicability.membership.isDemo ||
              regulationCheck.regulation.applicability.membership.source
                .isDemo,
            locator: `${regulationCheck.regulation.applicability.membership.validFrom}–${regulationCheck.regulation.applicability.membership.validTo ?? "open"}`,
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
              verifiedAt: source.verifiedAt,
            }),
          ),
          ...regulationCheck.certifications.map(
            ({ certification }): AiCitation => ({
              chunkId: null,
              countryIso3: input.countryIso3,
              documentId: null,
              documentTitle: null,
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
              verifiedAt: certification.source.verifiedAt,
            }),
          ),
        ],
      );

      return [...productCitation, ...evidenceCitations];
    }),
  );
  const evidenceSufficient =
    input.evaluations.length > 0 &&
    input.evaluations.some(({ status }) => status !== "unknown");
  const unknownCount = input.evaluations.filter(
    ({ status }) => status === "unknown",
  ).length;
  const warnings = [
    ...(evidenceSufficient ? [] : [insufficientEvidenceWarning]),
    ...(unknownCount > 0
      ? [`${unknownCount} 个产品因法规或认证证据不足而标记为 unknown。`]
      : []),
    ...demoWarning(citations),
  ];

  return findCompatibleProductsResultSchema.parse({
    citations,
    evaluations: input.evaluations,
    evidenceSufficient,
    informationAsOf: input.asOf,
    latestVerifiedAt: latestVerifiedAt(citations),
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
    warnings: [
      "工具查询失败，不能据此生成法规或产品结论。请稍后重试。",
    ],
  };

  if (tool === "searchKnowledgeBase") {
    const input = searchKnowledgeBaseInputSchema.safeParse(rawInput);
    return searchKnowledgeBaseResultSchema.parse({
      ...common,
      resolvedCountryIso3: null,
      search: {
        embeddingModel: "local-hash-embedding-v1",
        filters: {
          applicationScope: null,
          asOf: null,
          countryIso3: null,
          jurisdictionId: null,
          limit: 1,
        },
        query: input.success ? input.data.query : "tool-error",
        results: [],
        scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
        status: "ok",
      },
      tool,
    });
  }
  if (tool === "getCountryProfile") {
    const input = getCountryProfileInputSchema.safeParse(rawInput);
    return getCountryProfileResultSchema.parse({
      ...common,
      profile: null,
      requestedTopics: input.success ? input.data.topics : ["country"],
      resolvedCountryIso3: null,
      tool,
    });
  }

  if (tool === "compareRegulations") {
    const input = compareRegulationsInputSchema.parse(rawInput);
    return compareRegulationsResultSchema.parse({
      ...common,
      comparison: {
        countries: input.countryIso3s.map((countryIso3) => ({
          countryIso3,
          countryName: null,
          currentEffectiveRegulations: [],
          futureAdoptedRegulations: [],
          status: "no_data",
        })),
        missingData: ["法规比较工具执行失败。"],
        query: input,
        sources: [],
      },
      tool,
    });
  }
  if (tool === "compareMarkets") {
    const input = compareMarketsInputSchema.parse(rawInput);
    return compareMarketsResultSchema.parse({
      ...common,
      comparison: {
        metrics: [],
        missingData: ["市场比较工具执行失败。"],
        query: input,
        sources: [],
      },
      tool,
    });
  }
  if (tool === "calculateOpportunityScore") {
    const input = calculateOpportunityScoreInputSchema.parse(rawInput);
    return calculateOpportunityScoreResultSchema.parse({
      ...common,
      scorecard: {
        query: input,
        rulesetVersion: "opportunity-score-v1",
        scores: input.countryIso3s.map((countryIso3) => ({
          components: [
            "marketPotential",
            "productReadiness",
            "regulatoryCoverage",
          ].map((key) => ({
            configuredWeight:
              key === "marketPotential"
                ? 0.5
                : key === "productReadiness"
                  ? 0.3
                  : 0.2,
            contribution: null,
            effectiveWeight: 0,
            explanation: "工具执行失败，本维度没有分数。",
            inputFacts: [],
            key,
            score: null,
            status: "missing",
          })),
          countryIso3,
          dataCoveragePct: 0,
          missingData: ["机会评分工具执行失败。"],
          overallScore: null,
        })),
        sources: [],
        weights: {
          marketPotential: 0.5,
          productReadiness: 0.3,
          regulatoryCoverage: 0.2,
        },
      },
      tool,
    });
  }
  if (tool === "generateSalesBrief") {
    const input = generateSalesBriefInputSchema.parse(rawInput);
    return generateSalesBriefResultSchema.parse({
      ...common,
      brief: {
        executiveSummary: "销售简报工具执行失败，没有生成结论。",
        marketScore: {
          components: [
            {
              configuredWeight: 0.5,
              contribution: null,
              effectiveWeight: 0,
              explanation: "工具执行失败，本维度没有分数。",
              inputFacts: [],
              key: "marketPotential",
              score: null,
              status: "missing",
            },
            {
              configuredWeight: 0.3,
              contribution: null,
              effectiveWeight: 0,
              explanation: "工具执行失败，本维度没有分数。",
              inputFacts: [],
              key: "productReadiness",
              score: null,
              status: "missing",
            },
            {
              configuredWeight: 0.2,
              contribution: null,
              effectiveWeight: 0,
              explanation: "工具执行失败，本维度没有分数。",
              inputFacts: [],
              key: "regulatoryCoverage",
              score: null,
              status: "missing",
            },
          ],
          countryIso3: input.targetCountryIso3,
          dataCoveragePct: 0,
          missingData: ["销售简报工具执行失败。"],
          overallScore: null,
        },
        missingData: ["销售简报工具执行失败。"],
        opportunities: [],
        recommendedProducts: [],
        risks: [],
        salesActions: [],
        sources: [],
      },
      tool,
    });
  }

  const input = findCompatibleProductsInputSchema.safeParse(rawInput);
  return findCompatibleProductsResultSchema.parse({
    ...common,
    evaluations: [],
    query: {
      applicationScope: input.success
        ? input.data.applicationScope
        : "non-road",
      asOf: input.success ? input.data.asOf : informationAsOf,
      countryIso3: input.success
        ? (input.data.countryIso3 ?? null)
        : null,
      powerKw: input.success ? input.data.powerKw : 0,
      ...(input.success && input.data.productModelCode
        ? { productModelCode: input.data.productModelCode }
        : {}),
    },
    tool,
  });
}
