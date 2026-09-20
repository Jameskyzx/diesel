import { describe, expect, it } from "vitest";

import { wrapUntrustedKnowledgeExcerpt } from "@/domain/knowledge/retrieval-policy";
import { toolResultMayRenderFacts } from "@/components/ai/sales-chat";
import { toolPartPresentation } from "@/features/ai/tool-part-presentation";
import { buildToolErrorResult } from "@/server/ai/tool-results";

const validCitation = {
  chunkId: "chunk-1",
  countryIso3: "CHN",
  documentId: "document-1",
  documentTitle: "Original source document title",
  isDemo: false,
  locator: null,
  pageFrom: 1,
  pageTo: 2,
  productCertificationId: null,
  publishedOn: "2026-01-01",
  regulationId: null,
  regulationStatus: null,
  sectionLocator: null,
  sourceId: "source-1",
  sourceTitle: "Original source title",
  sourceUrl: "https://example.com/evidence",
  title: "Original evidence title",
  verifiedAt: "2026-01-02T00:00:00.000Z",
} as const;

const knowledgeIds = {
  chunk: "00000000-0000-4000-8000-000000000821",
  document: "00000000-0000-4000-8000-000000000822",
  source: "00000000-0000-4000-8000-000000000823",
} as const;

const countrySourceId = "00000000-0000-4000-8000-000000000101";
const countryCitation = {
  ...validCitation,
  chunkId: null,
  countryIso3: "CHN",
  documentId: null,
  documentTitle: null,
  pageFrom: null,
  pageTo: null,
  sourceId: countrySourceId,
  sourceTitle: "Country source",
  title: "China country profile",
  titleDescriptor: {
    countryIsDemo: false,
    countryIso2: "CN",
    countryIso3: "CHN",
    countryNameEn: "China",
    countryNameLocal: "中国",
    countrySourceId,
    countrySourceIsDemo: false,
    countrySourceTitle: "Country source",
    kind: "country_profile",
  },
} as const;

function analysisSource(input: {
  countryIso3: "BRA" | "CHN";
  entityId: string;
  entityType:
    | "market_metric"
    | "product"
    | "product_certification"
    | "regulation";
  regulationId?: string;
  sourceId: string;
}) {
  return {
    countryIso3: input.countryIso3,
    entityId: input.entityId,
    entityType: input.entityType,
    isDemo: false,
    locatorDescriptor:
      input.entityType === "product"
        ? {
            availableFrom: "2025-01-01",
            availableTo: "2027-01-01",
            kind: "product_availability" as const,
            modelCode: "ENGINE-100",
            specificationVersion: "v1",
          }
        : null,
    regulationId: input.regulationId ?? null,
    regulationStatus: input.regulationId ? ("effective" as const) : null,
    sourceId: input.sourceId,
    sourceTitle: `Source ${input.sourceId}`,
  } as const;
}

function citationForSource(source: ReturnType<typeof analysisSource>) {
  return {
    ...validCitation,
    chunkId: null,
    countryIso3: source.countryIso3,
    documentId: null,
    documentTitle: null,
    entityId: source.entityId,
    entityType: source.entityType,
    isDemo: source.isDemo,
    locatorDescriptor: source.locatorDescriptor,
    productCertificationId:
      source.entityType === "product_certification"
        ? source.entityId
        : null,
    regulationId: source.regulationId,
    regulationStatus: source.regulationStatus,
    sourceId: source.sourceId,
    sourceTitle: source.sourceTitle,
    title: `Evidence ${source.entityId}`,
  } as const;
}

const chnMarketSource = analysisSource({
  countryIso3: "CHN",
  entityId: "metric-1",
  entityType: "market_metric",
  sourceId: "source-market-chn",
});
const braMarketSource = analysisSource({
  countryIso3: "BRA",
  entityId: "metric-2",
  entityType: "market_metric",
  sourceId: "source-market-bra",
});
const briefProductSource = analysisSource({
  countryIso3: "BRA",
  entityId: "product-1",
  entityType: "product",
  sourceId: "source-product",
});
const chnProductSource = analysisSource({
  countryIso3: "CHN",
  entityId: "product-1",
  entityType: "product",
  sourceId: "source-product",
});
const briefRegulationSource = analysisSource({
  countryIso3: "BRA",
  entityId: "regulation-1",
  entityType: "regulation",
  regulationId: "regulation-1",
  sourceId: "source-regulation",
});
const briefCertificationSource = analysisSource({
  countryIso3: "BRA",
  entityId: "certification-1",
  entityType: "product_certification",
  regulationId: "regulation-1",
  sourceId: "source-certification",
});

const validKnowledgeResult = {
  citations: [],
  evidenceSufficient: false,
  informationAsOf: "2026-08-12",
  latestVerifiedAt: null,
  resolvedCountryIso3: "CHN",
  search: {
    embeddingModel: "local-hash-embedding-v1",
    filters: {
      applicationScope: null,
      asOf: "2026-08-12",
      countryIso3: "CHN",
      jurisdictionId: null,
      limit: 5,
    },
    query: "source evidence",
    results: [],
    scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
    status: "ok",
  },
  status: "no_data",
  tool: "searchKnowledgeBase",
  warnings: [
    "没有足够证据支持肯定结论；请补充结构化事实或可追溯来源。",
  ],
} as const;

const validKnowledgeWithCitation = {
  ...validKnowledgeResult,
  citations: [
    {
      ...validCitation,
      chunkId: knowledgeIds.chunk,
      documentId: knowledgeIds.document,
      locator: "第 1–2 页",
      sourceId: knowledgeIds.source,
      title: "Original source document title",
    },
  ],
  evidenceSufficient: true,
  latestVerifiedAt: validCitation.verifiedAt,
  search: {
    ...validKnowledgeResult.search,
    results: [
      {
        applicationScope: "non-road",
        chunkId: knowledgeIds.chunk,
        content: wrapUntrustedKnowledgeExcerpt(
          "Original knowledge excerpt.",
        ),
        countryIso3: "CHN",
        document: {
          downloadUrl: null,
          id: knowledgeIds.document,
          originalFilename: null,
          publishedOn: "2026-01-01",
          source: {
            id: knowledgeIds.source,
            isDemo: false,
            publishedOn: "2026-01-01",
            publisher: null,
            title: "Original source title",
            url: "https://example.com/evidence",
            verifiedAt: "2026-01-02T00:00:00.000Z",
          },
          title: "Original source document title",
        },
        finalScore: 0.8,
        headingPath: null,
        jurisdiction: null,
        keywordScore: 0.8,
        pageFrom: 1,
        pageTo: 2,
        rank: 1,
        sectionLocator: null,
        validFrom: "2025-01-01",
        validTo: null,
        vectorScore: 0.8,
        warnings: [],
      },
    ],
  },
  status: "ok",
  warnings: [],
} as const;

const partialKnowledgeResult = {
  ...validKnowledgeWithCitation,
  search: {
    ...validKnowledgeWithCitation.search,
    results: validKnowledgeWithCitation.search.results.map((hit) => ({
      ...hit,
      document: {
        ...hit.document,
        source: {
          id: hit.document.source.id,
          isDemo: hit.document.source.isDemo,
          title: hit.document.source.title,
        },
      },
    })),
  },
} as const;

const availableComponents = [
  {
    configuredWeight: 0.5,
    contribution: 25,
    effectiveWeight: 0.5,
    explanation: "Opaque market explanation",
    inputFacts: ["market=1"],
    key: "marketPotential",
    score: 50,
    status: "available",
  },
  {
    configuredWeight: 0.3,
    contribution: 15,
    effectiveWeight: 0.3,
    explanation: "Opaque product explanation",
    inputFacts: ["ready=1"],
    key: "productReadiness",
    score: 50,
    status: "available",
  },
  {
    configuredWeight: 0.2,
    contribution: 10,
    effectiveWeight: 0.2,
    explanation: "Opaque regulation explanation",
    inputFacts: ["pass=1"],
    key: "regulatoryCoverage",
    score: 50,
    status: "available",
  },
] as const;

function countryScore(countryIso3: string) {
  return {
    components: availableComponents,
    countryIso3,
    dataCoveragePct: 100,
    missingData: [],
    overallScore: 50,
  } as const;
}

function missingCountryScore(countryIso3: string) {
  return {
    components: [
      {
        configuredWeight: 0.5,
        contribution: null,
        effectiveWeight: 0,
        explanation: "Opaque missing market explanation",
        inputFacts: [],
        key: "marketPotential",
        score: null,
        status: "missing",
      },
      {
        configuredWeight: 0.3,
        contribution: null,
        effectiveWeight: 0,
        explanation: "Opaque missing product explanation",
        inputFacts: [],
        key: "productReadiness",
        score: null,
        status: "missing",
      },
      {
        configuredWeight: 0.2,
        contribution: null,
        effectiveWeight: 0,
        explanation: "Opaque missing regulation explanation",
        inputFacts: [],
        key: "regulatoryCoverage",
        score: null,
        status: "missing",
      },
    ],
    countryIso3,
    dataCoveragePct: 0,
    missingData: ["Opaque evidence gap"],
    overallScore: null,
  } as const;
}

const analysisQuery = {
  applicationScope: "non-road",
  asOf: "2026-08-12",
  countryIso3s: ["CHN", "BRA"],
  powerKw: 100,
} as const;

const validMarketResult = {
  citations: [
    citationForSource(chnMarketSource),
    citationForSource(braMarketSource),
  ],
  comparison: {
    metrics: [
      {
        comparisonStatus: "comparable",
        issues: [],
        metricCode: "ADDRESSABLE_UNITS",
        metricName: "Addressable units",
        observations: [
          {
            applicationScope: "non-road",
            countryIso3: "CHN",
            id: "metric-1",
            isDemo: false,
            metricCode: "ADDRESSABLE_UNITS",
            metricName: "Addressable units",
            source: chnMarketSource,
            unitCode: "units",
            valueNumeric: "100.000000",
          },
          {
            applicationScope: "non-road",
            countryIso3: "BRA",
            id: "metric-2",
            isDemo: false,
            metricCode: "ADDRESSABLE_UNITS",
            metricName: "Addressable units",
            source: braMarketSource,
            unitCode: "units",
            valueNumeric: "80.000000",
          },
        ],
      },
    ],
    missingData: [],
    query: {
      applicationScope: "non-road",
      countryIso3s: ["CHN", "BRA"],
      metricCodes: ["ADDRESSABLE_UNITS"],
    },
    sources: [chnMarketSource, braMarketSource],
  },
  evidenceSufficient: true,
  informationAsOf: "2026-08-12",
  latestVerifiedAt: validCitation.verifiedAt,
  status: "ok",
  tool: "compareMarkets",
  warnings: [],
} as const;

const validScoreResult = {
  citations: [
    citationForSource(chnMarketSource),
    citationForSource(braMarketSource),
  ],
  evidenceSufficient: true,
  informationAsOf: "2026-08-12",
  latestVerifiedAt: validCitation.verifiedAt,
  scorecard: {
    query: analysisQuery,
    rulesetVersion: "opportunity-score-v2",
    scores: [countryScore("CHN"), countryScore("BRA")],
    sources: [chnMarketSource, braMarketSource],
    weights: {
      marketPotential: 0.5,
      productReadiness: 0.3,
      regulatoryCoverage: 0.2,
    },
  },
  status: "ok",
  tool: "calculateOpportunityScore",
  warnings: [],
} as const;

const validSalesBriefResult = {
  brief: {
    executiveSummary: "Opaque summary",
    marketScore: countryScore("BRA"),
    missingData: [],
    opportunities: [],
    query: { ...analysisQuery, targetCountryIso3: "BRA" },
    recommendedProducts: [
      {
        availableFrom: "2025-01-01",
        availableTo: "2027-01-01",
        availabilityStatus: "pass",
        certificationIds: ["certification-1"],
        commercialReadiness: "ready",
        id: "product-1",
        isDemo: false,
        modelCode: "ENGINE-100",
        name: "Engine 100",
        reasons: [],
        regulationIds: ["regulation-1"],
        source: {
          id: "source-product",
          isDemo: false,
          title: "Product manual",
        },
        specificationVersion: "v1",
        status: "fit",
      },
    ],
    risks: [],
    salesActions: [],
    sources: [
      braMarketSource,
      briefProductSource,
      briefRegulationSource,
      briefCertificationSource,
    ],
  },
  citations: [
    citationForSource(braMarketSource),
    citationForSource(briefProductSource),
    citationForSource(briefRegulationSource),
    citationForSource(briefCertificationSource),
  ],
  evidenceSufficient: true,
  informationAsOf: "2026-08-12",
  latestVerifiedAt: validCitation.verifiedAt,
  status: "ok",
  tool: "generateSalesBrief",
  warnings: [],
} as const;

const partialCountryProfileResult = {
  citations: [countryCitation],
  evidenceSufficient: false,
  informationAsOf: "2026-08-12",
  latestVerifiedAt: validCitation.verifiedAt,
  profile: {
    asOf: "2026-08-12",
    country: {
      currentEffectiveRegulations: [],
      futureAdoptedRegulations: [],
      isDemo: false,
      iso2: "CN",
      iso3: "CHN",
      jurisdictions: [],
      marketMetrics: [],
      nameEn: "China",
      nameLocal: "中国",
      source: {
        id: countrySourceId,
        isDemo: false,
        title: "Country source",
      },
    },
    status: "available",
  },
  requestedTopics: ["regulations"],
  resolvedCountryIso3: "CHN",
  status: "no_data",
  tool: "getCountryProfile",
  warnings: ["Opaque evidence gap"],
} as const;

const partialProductResult = {
  citations: [citationForSource(chnProductSource)],
  evaluations: [
    {
      asOf: "2026-08-12",
      commercialReadiness: "unknown",
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-12",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "ENGINE-100",
      },
      product: {
        availableFrom: "2025-01-01",
        availableTo: "2027-01-01",
        id: "product-1",
        isDemo: false,
        modelCode: "ENGINE-100",
        name: "Engine 100",
        source: {
          id: "source-product",
          isDemo: false,
          title: "Product manual",
        },
        specificationVersion: "v1",
      },
      productChecks: {
        availability: {
          code: "PRODUCT_AVAILABLE",
          message: "Opaque availability message",
          status: "pass",
        },
      },
      reasons: [
        {
          code: "CERTIFICATION_MISSING",
          message: "Opaque certification gap",
          status: "unknown",
        },
      ],
      regulationChecks: [],
      sources: [
        {
          id: "source-product",
          isDemo: false,
          title: "Product manual",
        },
      ],
      status: "unknown",
    },
  ],
  evidenceSufficient: false,
  informationAsOf: "2026-08-12",
  latestVerifiedAt: validCitation.verifiedAt,
  query: {
    applicationScope: "non-road",
    asOf: "2026-08-12",
    countryIso3: "CHN",
    powerKw: 100,
  },
  status: "no_data",
  tool: "findCompatibleProducts",
  warnings: ["Opaque evidence gap"],
} as const;

const partialRegulationResult = {
  citations: [countryCitation],
  comparison: {
    countries: [
      {
        countryIsDemo: false,
        countryIso3: "CHN",
        countryName: "China",
        countrySource: {
          countryIso2: "CN",
          countryNameLocal: "中国",
          id: countrySourceId,
          isDemo: false,
          publishedOn: "2026-01-01",
          title: "Country source",
          url: "https://example.com/evidence",
          verifiedAt: "2026-01-02T00:00:00.000Z",
        },
        currentEffectiveRegulations: [],
        futureAdoptedRegulations: [],
        status: "no_data",
      },
      {
        countryIsDemo: false,
        countryIso3: "BRA",
        countryName: null,
        countrySource: null,
        currentEffectiveRegulations: [],
        futureAdoptedRegulations: [],
        status: "no_data",
      },
    ],
    missingData: ["Opaque evidence gap"],
    query: analysisQuery,
    sources: [],
  },
  evidenceSufficient: false,
  informationAsOf: "2026-08-12",
  latestVerifiedAt: validCitation.verifiedAt,
  status: "no_data",
  tool: "compareRegulations",
  warnings: ["Opaque evidence gap"],
} as const;

const partialMarketResult = {
  ...validMarketResult,
  comparison: {
    ...validMarketResult.comparison,
    metrics: [
      {
        ...validMarketResult.comparison.metrics[0],
        comparisonStatus: "incomparable",
        issues: ["UNIT_MISMATCH"],
      },
    ],
  },
  evidenceSufficient: false,
  status: "no_data",
} as const;

const partialScoreResult = {
  ...validScoreResult,
  evidenceSufficient: false,
  scorecard: {
    ...validScoreResult.scorecard,
    scores: [countryScore("CHN"), missingCountryScore("BRA")],
  },
  status: "no_data",
} as const;

const partialSalesBriefResult = {
  ...validSalesBriefResult,
  brief: {
    ...validSalesBriefResult.brief,
    marketScore: missingCountryScore("BRA"),
    opportunities: [
      {
        evidenceIds: ["source-1"],
        text: "Opaque opportunity",
        title: "Opportunity",
      },
    ],
    recommendedProducts: [],
  },
  evidenceSufficient: false,
  status: "no_data",
} as const;

function toolInputForOutput(output: unknown): unknown {
  const result = output as {
    brief?: { query: unknown };
    comparison?: { query: unknown };
    informationAsOf?: string;
    query?: unknown;
    requestedTopics?: unknown;
    resolvedCountryIso3?: unknown;
    scorecard?: { query: unknown };
    search?: {
      filters: { applicationScope?: unknown };
      query: unknown;
    };
    tool?: string;
  };
  if (result.tool === "searchKnowledgeBase") {
    return {
      applicationScope: result.search?.filters.applicationScope,
      asOf: result.informationAsOf,
      countryIso3: result.resolvedCountryIso3,
      query: result.search?.query,
    };
  }
  if (result.tool === "getCountryProfile") {
    return {
      asOf: result.informationAsOf,
      countryIso3: result.resolvedCountryIso3,
      topics: result.requestedTopics,
    };
  }
  if (result.tool === "findCompatibleProducts") {
    return result.query;
  }
  if (
    result.tool === "compareRegulations" ||
    result.tool === "compareMarkets"
  ) {
    return result.comparison?.query;
  }
  if (result.tool === "calculateOpportunityScore") {
    return result.scorecard?.query;
  }
  if (result.tool === "generateSalesBrief") {
    return result.brief?.query;
  }
  return undefined;
}

function toolPartTypeForOutput(output: unknown): string | undefined {
  const tool = (output as { tool?: unknown }).tool;
  return typeof tool === "string" ? `tool-${tool}` : undefined;
}

function expectInvalidResult(output: unknown): void {
  const presentation = toolPartPresentation({
    input: toolInputForOutput(output),
    output,
    state: "output-available",
    type: toolPartTypeForOutput(output),
  });
  expect(presentation).toEqual({
    code: "invalid_result",
    kind: "error",
  });
  expect(JSON.stringify(presentation)).not.toContain("DO_NOT_RENDER");
}

describe("AI tool-part presentation", () => {
  it("keeps only active tool states loading", () => {
    expect(toolPartPresentation({ state: "input-streaming" })).toEqual({
      kind: "loading",
    });
    expect(toolPartPresentation({ state: "input-available" })).toEqual({
      kind: "loading",
    });
    expect(toolPartPresentation({ state: "approval-requested" })).toEqual({
      kind: "loading",
    });
    expect(toolPartPresentation({ state: "approval-responded" })).toEqual({
      kind: "loading",
    });
  });

  it.each(["output-error", "output-denied"] as const)(
    "renders %s as a terminal error instead of an infinite spinner",
    (state) => {
      expect(toolPartPresentation({ state })).toMatchObject({
        kind: "error",
      });
    },
  );

  it("returns typed terminal error codes for locale-aware rendering", () => {
    expect(toolPartPresentation({ state: "output-error" })).toEqual({
      code: "execution_error",
      kind: "error",
    });
    expect(toolPartPresentation({ state: "output-denied" })).toEqual({
      code: "permission_denied",
      kind: "error",
    });
    expect(
      toolPartPresentation({ output: {}, state: "output-available" }),
    ).toEqual({ code: "invalid_result", kind: "error" });
  });

  it("fails closed when a completed output does not match the client schema", () => {
    expect(
      toolPartPresentation({ output: { status: "ok" }, state: "output-available" }),
    ).toMatchObject({ kind: "error" });
  });

  it("accepts a no-facts result without requiring source metadata", () => {
    expect(
      toolPartPresentation({
        input: toolInputForOutput(validKnowledgeResult),
        output: validKnowledgeResult,
        state: "output-available",
        type: toolPartTypeForOutput(validKnowledgeResult),
      }).kind,
    ).toBe("result");
  });

  it.each([
    { extra: { jurisdictionId: null }, label: "null jurisdictionId" },
    {
      extra: { jurisdictionId: "00000000-0000-4000-8000-000000000899" },
      label: "UUID jurisdictionId",
    },
    { extra: { limit: 1 }, label: "limit 1" },
    { extra: { limit: 5 }, label: "limit 5" },
    { extra: { limit: 8 }, label: "limit 8" },
  ])("rejects a completed knowledge part with $label", ({ extra }) => {
    const input = {
      applicationScope: validKnowledgeResult.search.filters.applicationScope,
      asOf: validKnowledgeResult.informationAsOf,
      countryIso3: validKnowledgeResult.resolvedCountryIso3,
      query: validKnowledgeResult.search.query,
    };
    const part = {
      input,
      output: validKnowledgeResult,
      state: "output-available" as const,
      type: toolPartTypeForOutput(validKnowledgeResult),
    };

    expect(toolPartPresentation(part).kind).toBe("result");
    expect(
      toolPartPresentation({ ...part, input: { ...input, ...extra } }),
    ).toEqual({ code: "invalid_result", kind: "error" });
  });

  it.each([
    { label: "knowledge", output: partialKnowledgeResult },
    { label: "country profile", output: partialCountryProfileResult },
    { label: "product fit", output: partialProductResult },
    { label: "regulation comparison", output: partialRegulationResult },
    { label: "market comparison", output: partialMarketResult },
    { label: "opportunity score", output: partialScoreResult },
    { label: "sales brief", output: partialSalesBriefResult },
  ])("rejects cited $label facts with stripped source metadata", ({ output }) => {
    expectInvalidResult(output);
  });

  it.each([
    { label: "knowledge", output: validKnowledgeWithCitation },
    { label: "country profile", output: partialCountryProfileResult },
    { label: "product fit", output: partialProductResult },
    { label: "regulation comparison", output: partialRegulationResult },
    { label: "market comparison", output: partialMarketResult },
    { label: "opportunity score", output: partialScoreResult },
    { label: "sales brief", output: partialSalesBriefResult },
  ])("rejects uncited visible $label facts", ({ output }) => {
    expectInvalidResult({
      ...output,
      citations: [],
      latestVerifiedAt: null,
    });
  });

  it("accepts only no-facts placeholders for failed tools", () => {
    const noFactErrors = [
      buildToolErrorResult("searchKnowledgeBase", "2026-08-12", {
        asOf: "2026-08-12",
        countryIso3: "CHN",
        query: validKnowledgeResult.search.query,
      }),
      buildToolErrorResult("getCountryProfile", "2026-08-12", {
        asOf: "2026-08-12",
        countryIso3: "CHN",
        topics: partialCountryProfileResult.requestedTopics,
      }),
      buildToolErrorResult(
        "findCompatibleProducts",
        "2026-08-12",
        partialProductResult.query,
      ),
      buildToolErrorResult(
        "compareRegulations",
        "2026-08-12",
        partialRegulationResult.comparison.query,
      ),
      buildToolErrorResult(
        "compareMarkets",
        "2026-08-12",
        partialMarketResult.comparison.query,
      ),
      buildToolErrorResult(
        "calculateOpportunityScore",
        analysisQuery.asOf,
        analysisQuery,
      ),
      buildToolErrorResult("generateSalesBrief", analysisQuery.asOf, {
        ...analysisQuery,
        targetCountryIso3: "BRA",
      }),
    ];

    for (const output of noFactErrors) {
      expect(
        toolPartPresentation({
          input: toolInputForOutput(output),
          output,
          state: "output-available",
          type: toolPartTypeForOutput(output),
        }).kind,
        output.tool,
      ).toBe("result");
      expect(toolResultMayRenderFacts(output)).toBe(false);
    }
  });

  it("rejects a valid result when its completed tool input does not match", () => {
    expect(
      toolPartPresentation({
        input: {
          ...validMarketResult.comparison.query,
          countryIso3s: ["CHN", "DEU"],
        },
        output: validMarketResult,
        state: "output-available",
        type: toolPartTypeForOutput(validMarketResult),
      }),
    ).toEqual({ code: "invalid_result", kind: "error" });

    const profileError = buildToolErrorResult(
      "getCountryProfile",
      "2026-08-12",
      {
        asOf: "2026-08-12",
        countryIso3: "CHN",
        topics: ["country"],
      },
    );
    expect(
      toolPartPresentation({
        input: {
          asOf: "2026-08-11",
          countryIso3: "CHN",
          topics: ["country"],
        },
        output: profileError,
        state: "output-available",
        type: toolPartTypeForOutput(profileError),
      }),
    ).toEqual({ code: "invalid_result", kind: "error" });
  });

  it("rejects a valid output attached to a different SDK tool identity", () => {
    expect(
      toolPartPresentation({
        input: validSalesBriefResult.brief.query,
        output: validSalesBriefResult,
        state: "output-available",
        type: "tool-calculateOpportunityScore",
      }),
    ).toEqual({ code: "invalid_result", kind: "error" });

    expect(
      toolPartPresentation({
        input: validMarketResult.comparison.query,
        output: validMarketResult,
        state: "output-available",
        toolName: "compareRegulations",
        type: "dynamic-tool",
      }),
    ).toEqual({ code: "invalid_result", kind: "error" });
  });

  it.each([
    {
      label: "regulation country shells",
      output: {
        ...partialRegulationResult,
        citations: [],
        comparison: {
          ...partialRegulationResult.comparison,
          countries: [
            {
              countryIsDemo: false,
              countryIso3: "BRA",
              countryName: null,
              countrySource: null,
              currentEffectiveRegulations: [],
              futureAdoptedRegulations: [],
              status: "no_data",
            },
            {
              countryIsDemo: false,
              countryIso3: "CHN",
              countryName: null,
              countrySource: null,
              currentEffectiveRegulations: [],
              futureAdoptedRegulations: [],
              status: "no_data",
            },
          ],
        },
        latestVerifiedAt: null,
        status: "error",
      },
    },
    {
      label: "score country shells",
      output: {
        ...partialScoreResult,
        citations: [],
        latestVerifiedAt: null,
        scorecard: {
          ...partialScoreResult.scorecard,
          scores: [
            missingCountryScore("BRA"),
            missingCountryScore("CHN"),
          ],
        },
        status: "error",
      },
    },
  ])("rejects failed $label that drift from the query", ({ output }) => {
    expectInvalidResult(output);
  });

  it.each([
    {
      label: "regulation country shells",
      output: {
        ...partialRegulationResult,
        citations: [],
        comparison: {
          ...partialRegulationResult.comparison,
          countries: [
            {
              countryIsDemo: false,
              countryIso3: "BRA",
              countryName: null,
              countrySource: null,
              currentEffectiveRegulations: [],
              futureAdoptedRegulations: [],
              status: "no_data",
            },
            {
              countryIsDemo: false,
              countryIso3: "CHN",
              countryName: null,
              countrySource: null,
              currentEffectiveRegulations: [],
              futureAdoptedRegulations: [],
              status: "no_data",
            },
          ],
        },
        latestVerifiedAt: null,
      },
    },
    {
      label: "score country shells",
      output: {
        ...partialScoreResult,
        citations: [],
        evidenceSufficient: false,
        latestVerifiedAt: null,
        scorecard: {
          ...partialScoreResult.scorecard,
          scores: [
            missingCountryScore("BRA"),
            missingCountryScore("CHN"),
          ],
        },
      },
    },
  ])("rejects no-data $label that drift from the query", ({ output }) => {
    expectInvalidResult(output);
  });

  it.each([
    { label: "country profile", output: partialCountryProfileResult },
    { label: "product fit", output: partialProductResult },
    { label: "regulation comparison", output: partialRegulationResult },
    { label: "market comparison", output: partialMarketResult },
    { label: "opportunity score", output: partialScoreResult },
    { label: "sales brief", output: partialSalesBriefResult },
  ])("rejects failed $label output that retains structured facts", ({ output }) => {
    expectInvalidResult({
      ...output,
      status: "error",
    });
  });

  it("rejects cited failed outputs even when they contain no facts", () => {
    expectInvalidResult({
      ...validKnowledgeResult,
      citations: [validCitation],
      latestVerifiedAt: validCitation.verifiedAt,
      status: "error",
    });
  });

  it.each([
    {
      label: "status/evidence mismatch",
      output: {
        ...validKnowledgeResult,
        evidenceSufficient: true,
      },
    },
    {
      label: "invalid public query date",
      output: {
        ...validKnowledgeResult,
        informationAsOf: "DO_NOT_RENDER_INTERNAL_DATE",
      },
    },
    {
      label: "latest verification not backed by citations",
      output: {
        ...validKnowledgeResult,
        latestVerifiedAt: "2026-01-02T00:00:00.000Z",
      },
    },
  ])("fails closed for $label", ({ output }) => {
    expectInvalidResult(output);
  });

  it("recomputes evidence sufficiency from the public structured result", () => {
    expectInvalidResult({
      ...validMarketResult,
      comparison: {
        ...validMarketResult.comparison,
        metrics: [
          {
            ...validMarketResult.comparison.metrics[0],
            comparisonStatus: "incomparable",
            issues: ["UNIT_MISMATCH"],
          },
        ],
      },
    });
  });

  it.each([
    {
      label: "non-HTTP source link",
      mutation: { sourceUrl: "javascript:DO_NOT_RENDER" },
    },
    {
      label: "invalid publication date",
      mutation: { publishedOn: "DO_NOT_RENDER_DATE" },
    },
    {
      label: "reversed page range",
      mutation: { pageFrom: 10, pageTo: 2 },
    },
  ])("rejects a citation with $label", ({ mutation }) => {
    expectInvalidResult({
      ...validKnowledgeWithCitation,
      citations: [{ ...validCitation, ...mutation }],
    });
  });

  it.each([
    {
      label: "unknown market issue code",
      metric: {
        ...validMarketResult.comparison.metrics[0],
        issues: ["DO_NOT_RENDER_INTERNAL_ISSUE"],
      },
    },
    {
      label: "comparison status that contradicts issues",
      metric: {
        ...validMarketResult.comparison.metrics[0],
        comparisonStatus: "comparable",
        issues: ["UNIT_MISMATCH"],
      },
    },
    {
      label: "non-decimal observation",
      metric: {
        ...validMarketResult.comparison.metrics[0],
        observations: [
          {
            ...validMarketResult.comparison.metrics[0].observations[0],
            valueNumeric: "DO_NOT_RENDER_PROVIDER_VALUE",
          },
          validMarketResult.comparison.metrics[0].observations[1],
        ],
      },
    },
  ])("rejects $label", ({ metric }) => {
    expectInvalidResult({
      ...validMarketResult,
      comparison: {
        ...validMarketResult.comparison,
        metrics: [metric],
      },
    });
  });

  it("rejects a missing score component that still claims a score", () => {
    expectInvalidResult({
      ...validScoreResult,
      scorecard: {
        ...validScoreResult.scorecard,
        scores: [
          {
            ...validScoreResult.scorecard.scores[0],
            components: [
              {
                ...availableComponents[0],
                contribution: null,
                score: 99,
                status: "missing",
              },
              availableComponents[1],
              availableComponents[2],
            ],
          },
          validScoreResult.scorecard.scores[1],
        ],
      },
    });
  });

  it("rejects a product recommendation that is not commercially ready", () => {
    expectInvalidResult({
      ...validSalesBriefResult,
      brief: {
        ...validSalesBriefResult.brief,
        recommendedProducts: [
          {
            ...validSalesBriefResult.brief.recommendedProducts[0],
            commercialReadiness: "not_ready",
          },
        ],
      },
    });
  });

  it("requires visible Demo entities to carry a Demo citation", () => {
    expectInvalidResult({
      citations: [validCitation],
      evaluations: [
        {
          asOf: "2026-08-12",
          commercialReadiness: "unknown",
          input: {
            applicationScope: "non-road",
            asOf: "2026-08-12",
            countryIso3: "CHN",
            powerKw: 100,
            productModelCode: "DEMO-ENGINE",
          },
          product: {
            availableFrom: "2025-01-01",
            availableTo: "2027-01-01",
            id: "demo-product",
            isDemo: true,
            modelCode: "DEMO-ENGINE",
            name: "DO_NOT_RENDER_FAKE_PRODUCT",
            source: {
              id: "demo-source",
              isDemo: true,
              title: "Demo source",
            },
            specificationVersion: "demo-v1",
          },
          productChecks: {
            availability: {
              code: "PRODUCT_AVAILABLE",
              message: "Opaque availability message",
              status: "pass",
            },
          },
          reasons: [
            {
              code: "CERTIFICATION_MISSING",
              message: "Opaque evidence gap",
              status: "unknown",
            },
          ],
          status: "unknown",
        },
      ],
      evidenceSufficient: false,
      informationAsOf: "2026-08-12",
      latestVerifiedAt: validCitation.verifiedAt,
      query: {
        applicationScope: "non-road",
        asOf: "2026-08-12",
        countryIso3: "CHN",
        powerKw: 100,
      },
      status: "no_data",
      tool: "findCompatibleProducts",
      warnings: ["Opaque Demo warning"],
    });
  });

  it("requires Demo country-profile facts to carry a Demo citation", () => {
    expectInvalidResult({
      citations: [validCitation],
      evidenceSufficient: true,
      informationAsOf: "2026-08-12",
      latestVerifiedAt: validCitation.verifiedAt,
      profile: {
        asOf: "2026-08-12",
        country: {
          currentEffectiveRegulations: [],
          futureAdoptedRegulations: [],
          isDemo: false,
          iso3: "CHN",
          marketMetrics: [
            {
              id: "00000000-0000-4000-8000-000000000701",
              isDemo: true,
              metricCode: "DEMO_ADDRESSABLE_UNITS",
              metricName: "DO_NOT_RENDER_DEMO_METRIC",
            },
          ],
          source: {
            id: "country-source",
            isDemo: false,
            title: "Country source",
          },
        },
        status: "available",
      },
      requestedTopics: ["market"],
      resolvedCountryIso3: "CHN",
      status: "ok",
      tool: "getCountryProfile",
      warnings: [],
    });
  });

  it("rejects a failed tool result that carries substantive public facts", () => {
    expectInvalidResult({
      ...validMarketResult,
      evidenceSufficient: false,
      status: "error",
      warnings: ["Opaque execution failure"],
    });
  });

  it("rejects a product availability code that contradicts its dated evidence", () => {
    expectInvalidResult({
      citations: [validCitation],
      evaluations: [
        {
          asOf: "2026-08-12",
          commercialReadiness: "ready",
          input: {
            applicationScope: "non-road",
            asOf: "2026-08-12",
            countryIso3: "CHN",
            powerKw: 100,
            productModelCode: "ENGINE-100",
          },
          product: {
            availableFrom: "2025-01-01",
            availableTo: "2026-01-01",
            id: "product-1",
            isDemo: false,
            modelCode: "ENGINE-100",
            name: "DO_NOT_RENDER_STALE_PRODUCT",
            source: {
              id: "source-product",
              isDemo: false,
              title: "Product manual",
            },
            specificationVersion: "v1",
          },
          productChecks: {
            availability: {
              code: "PRODUCT_AVAILABLE",
              message: "Opaque availability message",
              status: "pass",
            },
          },
          reasons: [
            {
              code: "APPLICATION_SCOPE_MATCH",
              message: "Opaque fit reason",
              status: "pass",
            },
          ],
          status: "fit",
        },
      ],
      evidenceSufficient: true,
      informationAsOf: "2026-08-12",
      latestVerifiedAt: validCitation.verifiedAt,
      query: {
        applicationScope: "non-road",
        asOf: "2026-08-12",
        countryIso3: "CHN",
        powerKw: 100,
      },
      status: "ok",
      tool: "findCompatibleProducts",
      warnings: [],
    });
  });
});
