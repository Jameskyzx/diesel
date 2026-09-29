import { compareCanonicalText } from "@/domain/canonical-order";

type EvidenceBase = {
  citations: readonly unknown[];
};

export const evidenceEntityTypes = [
  "country",
  "country_jurisdiction",
  "jurisdiction",
  "regulation",
  "regulation_limit",
  "market_metric",
  "product",
  "product_certification",
] as const;

export type EvidenceEntityType = (typeof evidenceEntityTypes)[number];

type EvidenceCitationIdentity = {
  chunkId: string | null;
  countryIso3: string | null;
  documentId: string | null;
  documentTitle: string | null;
  entityId?: string | null;
  entityType?: EvidenceEntityType | null;
  isDemo: boolean;
  locator: string | null;
  locatorDescriptor?: unknown;
  pageFrom: number | null;
  pageTo: number | null;
  productCertificationId: string | null;
  publishedOn: string | null;
  regulationId: string | null;
  regulationStatus: string | null;
  sectionLocator: string | null;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string | null;
  title: string;
  titleDescriptor?: unknown;
  verifiedAt: string;
};

type AnalysisSourceIdentity = {
  countryIso3: string | null;
  entityId: string;
  entityType: EvidenceEntityType;
  isDemo: boolean;
  locator: string | null;
  locatorDescriptor?: unknown;
  publishedOn: string | null;
  productId?: string;
  productModelCode?: string;
  regulationId: string | null;
  regulationStatus: string | null;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string | null;
  title: string;
  titleDescriptor?: unknown;
  verifiedAt: string;
};

type SimpleSourceIdentity = {
  id: string;
  isDemo: boolean;
  publishedOn: string | null;
  title: string;
  url: string | null;
  verifiedAt: string;
};

type BriefProductSourceIdentity = Pick<
  SimpleSourceIdentity,
  "id" | "isDemo" | "title"
>;

type RegulationFactIdentity = {
  applicability: {
    countryIso3: string;
    jurisdiction: {
      code: string;
      id: string;
      isDemo: boolean;
      name: string;
      source: AnalysisSourceIdentity;
    };
    membership: {
      isDemo: boolean;
      source: AnalysisSourceIdentity;
      validFrom: string;
      validTo: string | null;
    };
  };
  canonicalName: string;
  citationCode: string | null;
  id: string;
  isDemo: boolean;
  recordStatus: string;
  limits: readonly {
    id: string;
    isDemo: boolean;
    pollutantCode: string;
    powerMaxKw: number | null;
    powerMinKw: number | null;
    source: AnalysisSourceIdentity;
    validFrom: string;
    validTo: string | null;
  }[];
  source: AnalysisSourceIdentity;
};

type RegulationComparisonIdentity = {
  countries: readonly {
    countryIsDemo: boolean;
    countryName: string | null;
    countrySource: null | {
      countryIso2: string;
      countryNameLocal: string | null;
      id: string;
      isDemo: boolean;
      publishedOn: string | null;
      title: string;
      url: string | null;
      verifiedAt: string;
    };
    countryIso3: string;
    currentEffectiveRegulations: readonly RegulationFactIdentity[];
    futureAdoptedRegulations: readonly RegulationFactIdentity[];
  }[];
  query: {
    asOf: string;
    countryIso3s: readonly string[];
  };
  sources: readonly AnalysisSourceIdentity[];
};

type MarketComparisonIdentity = {
  metrics: readonly {
    comparisonStatus: string;
    metricCode: string;
    metricName: string;
    observations: readonly {
      applicationScope: string | null;
      countryIso3: string;
      id: string;
      isDemo: boolean;
      metricCode: string;
      metricName: string;
      periodEnd: string;
      periodStart: string;
      source: AnalysisSourceIdentity;
    }[];
  }[];
  query: {
    applicationScope?: string | null;
    countryIso3s: readonly string[];
    metricCodes?: readonly string[];
  };
  sources: readonly AnalysisSourceIdentity[];
};

type CountryProfileIdentityResult = {
  citations: readonly EvidenceCitationIdentity[];
  profile:
    | null
    | { status: "no_data" }
    | {
        applicabilitySummary?: null | {
          country: RegulationComparisonIdentity["countries"][number];
          query: RegulationComparisonIdentity["query"];
          sources: readonly AnalysisSourceIdentity[];
        };
        asOf: string;
        country: {
          isDemo: boolean;
          iso2: string;
          nameEn: string;
          nameLocal: string | null;
          currentEffectiveRegulations: readonly {
            applicability: {
              countryIso3: string;
              jurisdiction: {
                code: string;
                id: string;
                isDemo: boolean;
                name: string;
                source: SimpleSourceIdentity;
              };
              membership: {
                isDemo: boolean;
                source: SimpleSourceIdentity;
                validFrom: string;
                validTo: string | null;
              };
            };
            canonicalName: string;
            citationCode: string | null;
            id: string;
            isDemo: boolean;
            source: SimpleSourceIdentity;
            status: string;
          }[];
          futureAdoptedRegulations: readonly {
            applicability: {
              countryIso3: string;
              jurisdiction: {
                code: string;
                id: string;
                isDemo: boolean;
                name: string;
                source: SimpleSourceIdentity;
              };
              membership: {
                isDemo: boolean;
                source: SimpleSourceIdentity;
                validFrom: string;
                validTo: string | null;
              };
            };
            canonicalName: string;
            citationCode: string | null;
            id: string;
            isDemo: boolean;
            source: SimpleSourceIdentity;
            status: string;
          }[];
          iso3: string;
          jurisdictions: readonly {
            code: string;
            id: string;
            isDemo: boolean;
            membershipIsDemo: boolean;
            membershipSource: SimpleSourceIdentity;
            name: string;
            source: SimpleSourceIdentity;
            validFrom: string;
            validTo: string | null;
          }[];
          marketMetrics: readonly {
            countryIso3: string;
            id: string;
            isDemo: boolean;
            metricCode: string;
            metricName: string;
            periodEnd: string;
            periodStart: string;
            publishedOn: string | null;
            source: SimpleSourceIdentity;
          }[];
          source: SimpleSourceIdentity;
          sources: readonly SimpleSourceIdentity[];
        };
        status: "available";
      };
  requestedTopics: readonly ("country" | "market" | "regulations")[];
  tool: "getCountryProfile";
};

type ProductIdentityResult = {
  citations: readonly EvidenceCitationIdentity[];
  evaluations: readonly {
    input: { countryIso3: string };
    product: null | {
      availableFrom: string | null;
      availableTo: string | null;
      id: string;
      isDemo: boolean;
      modelCode: string;
      name: string;
      source: SimpleSourceIdentity;
      specificationVersion: string;
    };
    regulationChecks: readonly {
      certifications: readonly {
        certification: {
          certificateNumber: string | null;
          id: string;
          isDemo: boolean;
          productId: string;
          productModelCode: string;
          regulationId: string;
          source: SimpleSourceIdentity;
        };
      }[];
      regulation: {
        applicability: {
          countryIso3: string;
          jurisdiction: {
            code: string;
            id: string;
            isDemo: boolean;
            name: string;
            source: SimpleSourceIdentity;
          };
          membership: {
            isDemo: boolean;
            source: SimpleSourceIdentity;
            validFrom: string;
            validTo: string | null;
          };
        };
        canonicalName: string;
        citationCode: string | null;
        isDemo: boolean;
        limitSources: readonly SimpleSourceIdentity[];
        recordStatus: string;
        regulationId: string;
        source: SimpleSourceIdentity;
      };
    }[];
    sources: readonly SimpleSourceIdentity[];
  }[];
  tool: "findCompatibleProducts";
};

type KnowledgeIdentityResult = {
  citations: readonly EvidenceCitationIdentity[];
  search: {
    results: readonly {
      chunkId: string;
      countryIso3: string | null;
      document: {
        id: string;
        publishedOn: string | null;
        source: SimpleSourceIdentity;
        title: string;
      };
      pageFrom: number | null;
      pageTo: number | null;
      sectionLocator: string | null;
    }[];
  };
  tool: "searchKnowledgeBase";
};

type RegulationComparisonIdentityResult = {
  citations: readonly EvidenceCitationIdentity[];
  comparison: RegulationComparisonIdentity;
  informationAsOf: string;
  tool: "compareRegulations";
};

type MarketComparisonIdentityResult = {
  citations: readonly EvidenceCitationIdentity[];
  comparison: MarketComparisonIdentity;
  tool: "compareMarkets";
};

type ScoreIdentityResult = {
  citations: readonly EvidenceCitationIdentity[];
  informationAsOf: string;
  scorecard: {
    query: {
      asOf: string;
      countryIso3s: readonly string[];
      productModelCode?: string;
    };
    scores: readonly {
      countryIso3: string;
      overallScore: number | null;
    }[];
    sources: readonly AnalysisSourceIdentity[];
  };
  tool: "calculateOpportunityScore";
};

type BriefIdentityResult = {
  brief: {
    marketScore: {
      countryIso3: string;
      overallScore: number | null;
    };
    query: {
      asOf: string;
      countryIso3s: readonly string[];
      productModelCode?: string;
      targetCountryIso3: string;
    };
    recommendedProducts: readonly {
      availableFrom: string | null;
      availableTo: string | null;
      certifications: readonly {
        id: string;
        regulationId: string;
      }[];
      id: string;
      isDemo: boolean;
      modelCode: string;
      name: string;
      source: BriefProductSourceIdentity;
      specificationVersion: string;
    }[];
    sources: readonly AnalysisSourceIdentity[];
  };
  citations: readonly EvidenceCitationIdentity[];
  informationAsOf: string;
  tool: "generateSalesBrief";
};

type AiEvidenceIdentityResult = (
  | KnowledgeIdentityResult
  | CountryProfileIdentityResult
  | ProductIdentityResult
  | RegulationComparisonIdentityResult
  | MarketComparisonIdentityResult
  | ScoreIdentityResult
  | BriefIdentityResult
) & { latestVerifiedAt: string | null };

type CountryProfileRegulation = {
  applicability: {
    countryIso3: string;
  };
};

type CountryProfileEvidenceResult = EvidenceBase & {
  informationAsOf: string;
  profile:
    | null
    | {
        iso3: string;
        status: "no_data";
      }
    | {
        asOf: string;
        country: {
          currentEffectiveRegulations: readonly CountryProfileRegulation[];
          futureAdoptedRegulations: readonly CountryProfileRegulation[];
          iso3: string;
          marketMetrics: readonly { countryIso3: string }[];
        };
        status: "available";
      };
  requestedTopics: readonly ("country" | "market" | "regulations")[];
  resolvedCountryIso3: string | null;
  tool: "getCountryProfile";
};

type CompatibleProductEvaluation = {
  asOf: string;
  input: {
    applicationScope: string;
    asOf: string;
    countryIso3: string;
    powerKw: number;
    productModelCode: string;
  };
  product: null | {
    modelCode: string;
  };
  status: "fit" | "not_fit" | "unknown";
};

type CompatibleProductsEvidenceResult = EvidenceBase & {
  evaluations: readonly CompatibleProductEvaluation[];
  informationAsOf: string;
  query: {
    applicationScope: string;
    asOf: string;
    countryIso3: string | null;
    powerKw: number;
    productModelCode?: string;
  };
  status: "ok" | "no_data" | "error";
  tool: "findCompatibleProducts";
};

type AiEvidenceSemanticResult =
  | (EvidenceBase & {
      search: { results: readonly unknown[] };
      tool: "searchKnowledgeBase";
    })
  | CountryProfileEvidenceResult
  | CompatibleProductsEvidenceResult
  | (EvidenceBase & {
      comparison: {
        countries: readonly {
          currentEffectiveRegulations: readonly unknown[];
          futureAdoptedRegulations: readonly unknown[];
        }[];
        query: { countryIso3s: readonly string[] };
      };
      tool: "compareRegulations";
    })
  | (EvidenceBase & {
      comparison: {
        metrics: readonly { comparisonStatus: string }[];
      };
      tool: "compareMarkets";
    })
  | (EvidenceBase & {
      scorecard: {
        scores: readonly { overallScore: number | null }[];
      };
      tool: "calculateOpportunityScore";
    })
  | (EvidenceBase & {
      brief: {
        marketScore: { overallScore: number | null };
        recommendedProducts: readonly unknown[];
      };
      tool: "generateSalesBrief";
    });

function sameModelCode(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase();
}

/**
 * Recomputes the evidence claim from the structured facts that are visible to
 * the model and browser. Callers must never trust a provider-owned boolean.
 */
export function expectedAiEvidenceSufficiency(
  result: AiEvidenceSemanticResult,
): boolean {
  if (result.citations.length === 0) {
    return false;
  }
  if (result.tool === "searchKnowledgeBase") {
    return result.search.results.length > 0;
  }
  if (result.tool === "getCountryProfile") {
    if (result.profile?.status !== "available") {
      return false;
    }
    const { country } = result.profile;
    return result.requestedTopics.every((topic) => {
      if (topic === "regulations") {
        return (
          country.currentEffectiveRegulations.length > 0 ||
          country.futureAdoptedRegulations.length > 0
        );
      }
      if (topic === "market") {
        return country.marketMetrics.length > 0;
      }
      return true;
    });
  }
  if (result.tool === "findCompatibleProducts") {
    return (
      result.evaluations.length > 0 &&
      result.evaluations.some(({ status }) => status !== "unknown")
    );
  }
  if (result.tool === "compareRegulations") {
    const countriesWithEvidence = result.comparison.countries.filter(
      (country) =>
        country.currentEffectiveRegulations.length > 0 ||
        country.futureAdoptedRegulations.length > 0,
    ).length;
    return (
      countriesWithEvidence >=
      Math.min(2, result.comparison.query.countryIso3s.length)
    );
  }
  if (result.tool === "compareMarkets") {
    return result.comparison.metrics.some(
      ({ comparisonStatus }) => comparisonStatus === "comparable",
    );
  }
  if (result.tool === "calculateOpportunityScore") {
    return (
      result.scorecard.scores.filter(
        ({ overallScore }) => overallScore !== null,
      ).length >= 2
    );
  }
  return (
    result.brief.marketScore.overallScore !== null ||
    result.brief.recommendedProducts.length > 0
  );
}

/** Selects the citation with the latest verification instant. */
export function latestVerifiedAtFromCitations(
  citations: readonly { verifiedAt: string }[],
): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const { verifiedAt } of citations) {
    const timestamp = Date.parse(verifiedAt);
    if (!Number.isFinite(timestamp)) {
      return null;
    }
    if (
      timestamp > latestTime ||
      (timestamp === latestTime &&
        latest !== null &&
        verifiedAt > latest)
    ) {
      latest = verifiedAt;
      latestTime = timestamp;
    }
  }
  return latest;
}

/** Recomputes source freshness from citations instead of trusting the envelope. */
export function latestVerifiedAtMatchesCitations(result: {
  citations: readonly { verifiedAt: string }[];
  latestVerifiedAt: string | null;
}): boolean {
  if (
    result.citations.some(
      ({ verifiedAt }) => !Number.isFinite(Date.parse(verifiedAt)),
    )
  ) {
    return false;
  }
  return (
    result.latestVerifiedAt ===
    latestVerifiedAtFromCitations(result.citations)
  );
}

/** Binds the country-profile envelope to the returned country and query date. */
export function countryProfilePayloadMatchesQuery(
  result: CountryProfileEvidenceResult,
): boolean {
  if (result.profile === null) {
    return true;
  }
  if (result.resolvedCountryIso3 === null) {
    return false;
  }
  if (result.profile.status === "no_data") {
    return result.profile.iso3 === result.resolvedCountryIso3;
  }

  const countryIso3 = result.profile.country.iso3;
  const regulations = [
    ...result.profile.country.currentEffectiveRegulations,
    ...result.profile.country.futureAdoptedRegulations,
  ];
  return (
    countryIso3 === result.resolvedCountryIso3 &&
    result.profile.asOf === result.informationAsOf &&
    result.profile.country.marketMetrics.every(
      (metric) => metric.countryIso3 === countryIso3,
    ) &&
    regulations.every(
      (regulation) =>
        regulation.applicability.countryIso3 === countryIso3,
    )
  );
}

/** Binds every product evaluation to the public query echoed beside it. */
export function compatibleProductPayloadMatchesQuery(
  result: CompatibleProductsEvidenceResult,
): boolean {
  if (result.informationAsOf !== result.query.asOf) {
    return false;
  }
  if (
    result.status !== "error" &&
    result.query.productModelCode !== undefined &&
    result.evaluations.length !== 1
  ) {
    return false;
  }
  if (result.query.countryIso3 === null && result.evaluations.length > 0) {
    return false;
  }

  return result.evaluations.every((evaluation) => {
    const inputMatchesQuery =
      evaluation.asOf === result.query.asOf &&
      evaluation.input.asOf === result.query.asOf &&
      evaluation.input.applicationScope === result.query.applicationScope &&
      evaluation.input.countryIso3 === result.query.countryIso3 &&
      evaluation.input.powerKw === result.query.powerKw;
    const productMatchesEvaluation =
      evaluation.product === null ||
      sameModelCode(
        evaluation.product.modelCode,
        evaluation.input.productModelCode,
      );
    const exactModelMatches =
      result.query.productModelCode === undefined ||
      sameModelCode(
        evaluation.input.productModelCode,
        result.query.productModelCode,
      );

    return inputMatchesQuery && productMatchesEvaluation && exactModelMatches;
  });
}

function hasRecordShape(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function descriptorHasFields(
  descriptor: unknown,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  return (
    hasRecordShape(descriptor) &&
    Object.entries(expected).every(
      ([key, value]) => descriptor[key] === value,
    )
  );
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) =>
        sameStructuredValue(value, right[index]),
      )
    );
  }
  if (!hasRecordShape(left) || !hasRecordShape(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        sameStructuredValue(left[key], right[key]),
    )
  );
}

function sameStringSequence(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function citationMatchesSourceMetadata(
  citation: EvidenceCitationIdentity,
  source: SimpleSourceIdentity,
): boolean {
  return (
    citation.sourceId === source.id &&
    citation.sourceTitle === source.title &&
    citation.sourceUrl === source.url &&
    citation.verifiedAt === source.verifiedAt
  );
}

function sameSimpleSourceIdentity(
  left: SimpleSourceIdentity,
  right: SimpleSourceIdentity,
): boolean {
  return (
    left.id === right.id &&
    left.isDemo === right.isDemo &&
    left.publishedOn === right.publishedOn &&
    left.title === right.title &&
    left.url === right.url &&
    left.verifiedAt === right.verifiedAt
  );
}

function citationHasNoDocumentContext(
  citation: EvidenceCitationIdentity,
): boolean {
  return (
    citation.chunkId === null &&
    citation.documentId === null &&
    citation.documentTitle === null &&
    citation.pageFrom === null &&
    citation.pageTo === null &&
    citation.sectionLocator === null
  );
}

export function citationHasPairedEntityIdentity(
  citation: {
    entityId?: string | null;
    entityType?: EvidenceEntityType | null;
  },
): boolean {
  return (
    (citation.entityId === undefined || citation.entityId === null) ===
    (citation.entityType === undefined || citation.entityType === null)
  );
}

function analysisSourceMatches(
  source: AnalysisSourceIdentity,
  expected: {
    countryIso3: string;
    entityId: string;
    entityType: EvidenceEntityType;
    regulationId: string | null;
    regulationStatus: string | null;
  },
): boolean {
  return (
    source.countryIso3 === expected.countryIso3 &&
    source.entityId === expected.entityId &&
    source.entityType === expected.entityType &&
    source.regulationId === expected.regulationId &&
    source.regulationStatus === expected.regulationStatus
  );
}

function analysisSourcePresentationMatches(
  source: AnalysisSourceIdentity,
  expected: {
    entityIsDemo: boolean;
    locator: string | null;
    locatorDescriptor?: unknown;
    title: string;
    titleDescriptor?: unknown;
  },
): boolean {
  return (
    (!expected.entityIsDemo || source.isDemo) &&
    source.locator === expected.locator &&
    sameStructuredValue(
      source.locatorDescriptor ?? null,
      expected.locatorDescriptor ?? null,
    ) &&
    source.title === expected.title &&
    sameStructuredValue(
      source.titleDescriptor ?? null,
      expected.titleDescriptor ?? null,
    )
  );
}

function sameAnalysisSourceIdentity(
  left: AnalysisSourceIdentity,
  right: AnalysisSourceIdentity,
): boolean {
  return (
    left.countryIso3 === right.countryIso3 &&
    left.entityId === right.entityId &&
    left.entityType === right.entityType &&
    left.isDemo === right.isDemo &&
    left.locator === right.locator &&
    sameStructuredValue(
      left.locatorDescriptor ?? null,
      right.locatorDescriptor ?? null,
    ) &&
    left.publishedOn === right.publishedOn &&
    left.productId === right.productId &&
    left.productModelCode === right.productModelCode &&
    left.regulationId === right.regulationId &&
    left.regulationStatus === right.regulationStatus &&
    left.sourceId === right.sourceId &&
    left.sourceTitle === right.sourceTitle &&
    left.sourceUrl === right.sourceUrl &&
    left.title === right.title &&
    sameStructuredValue(
      left.titleDescriptor ?? null,
      right.titleDescriptor ?? null,
    ) &&
    left.verifiedAt === right.verifiedAt
  );
}

function analysisSourcesCover(
  sources: readonly AnalysisSourceIdentity[],
  requiredSources: readonly AnalysisSourceIdentity[],
): boolean {
  return (
    sources.every(
      (source, index) =>
        !sources
          .slice(index + 1)
          .some((other) => sameAnalysisSourceIdentity(source, other)),
    ) &&
    requiredSources.every((required) =>
      sources.some((source) => sameAnalysisSourceIdentity(source, required)),
    ) &&
    sources.every((source) =>
      requiredSources.some((required) =>
        sameAnalysisSourceIdentity(source, required),
      ),
    )
  );
}

function citationMatchesAnalysisSource(
  citation: EvidenceCitationIdentity,
  source: AnalysisSourceIdentity,
): boolean {
  return (
    citationHasPairedEntityIdentity(citation) &&
    citation.countryIso3 === source.countryIso3 &&
    citation.entityId === source.entityId &&
    citation.entityType === source.entityType &&
    citation.isDemo === source.isDemo &&
    citation.locator === source.locator &&
    sameStructuredValue(
      citation.locatorDescriptor ?? null,
      source.locatorDescriptor ?? null,
    ) &&
    citation.publishedOn === source.publishedOn &&
    citation.regulationId === source.regulationId &&
    citation.regulationStatus === source.regulationStatus &&
    (source.entityType === "product_certification"
      ? citation.productCertificationId === source.entityId
      : citation.productCertificationId === null) &&
    citation.sourceId === source.sourceId &&
    citation.sourceTitle === source.sourceTitle &&
    citation.sourceUrl === source.sourceUrl &&
    citation.title === source.title &&
    sameStructuredValue(
      citation.titleDescriptor ?? null,
      source.titleDescriptor ?? null,
    ) &&
    citation.verifiedAt === source.verifiedAt &&
    citationHasNoDocumentContext(citation)
  );
}

function citationCoversAnalysisSource(
  citations: readonly EvidenceCitationIdentity[],
  source: AnalysisSourceIdentity,
): boolean {
  return citations.some((citation) =>
    citationMatchesAnalysisSource(citation, source),
  );
}

function citationsCoverAnalysisSources(
  citations: readonly EvidenceCitationIdentity[],
  sources: readonly AnalysisSourceIdentity[],
): boolean {
  return sources.every((source) =>
    citationCoversAnalysisSource(citations, source),
  );
}

function citationsExactlyMatchAnalysisSources(
  citations: readonly EvidenceCitationIdentity[],
  sources: readonly AnalysisSourceIdentity[],
): boolean {
  return (
    citationsCoverAnalysisSources(citations, sources) &&
    citations.every((citation) =>
      sources.some((source) =>
        citationMatchesAnalysisSource(citation, source),
      ),
    )
  );
}

type EntityCitationExpectation = {
  countryIso3: string;
  entityId: string;
  entityType: EvidenceEntityType;
  expectedIsDemo: boolean;
  locator: string | null;
  locatorDescriptor?: unknown;
  publishedOn: string | null;
  regulationId: string | null;
  regulationStatus: string | null;
  source: SimpleSourceIdentity;
  title: string;
  titleDescriptor?: unknown;
};

function citationMatchesEntityIdentity(
  citation: EvidenceCitationIdentity,
  input: EntityCitationExpectation,
): boolean {
  return (
    citationHasPairedEntityIdentity(citation) &&
    citation.countryIso3 === input.countryIso3 &&
    citation.entityId === input.entityId &&
    citation.entityType === input.entityType &&
    citation.isDemo === input.expectedIsDemo &&
    citation.locator === input.locator &&
    sameStructuredValue(
      citation.locatorDescriptor ?? null,
      input.locatorDescriptor ?? null,
    ) &&
    citation.publishedOn === input.publishedOn &&
    citation.regulationId === input.regulationId &&
    citation.regulationStatus === input.regulationStatus &&
    (input.entityType === "product_certification"
      ? citation.productCertificationId === input.entityId
      : citation.productCertificationId === null) &&
    citationMatchesSourceMetadata(citation, input.source) &&
    citation.title === input.title &&
    sameStructuredValue(
      citation.titleDescriptor ?? null,
      input.titleDescriptor ?? null,
    ) &&
    citationHasNoDocumentContext(citation)
  );
}

function citationMatchesEntity(input: {
  citations: readonly EvidenceCitationIdentity[];
} & EntityCitationExpectation): boolean {
  const { citations, ...expectation } = input;
  return citations.some((citation) =>
    citationMatchesEntityIdentity(citation, expectation),
  );
}

/** Ensures each regulation fact owns its nested source and top-level source. */
export function regulationComparisonSourcesMatchFacts(
  value: unknown,
): boolean {
  try {
    const comparison = value as RegulationComparisonIdentity;
    const nestedSources: AnalysisSourceIdentity[] = [];
    for (const country of comparison.countries) {
      if (!comparison.query.countryIso3s.includes(country.countryIso3)) {
        return false;
      }
      if (
        (country.countrySource === null) !== (country.countryName === null)
      ) {
        return false;
      }
      const regulations = [
        ...country.currentEffectiveRegulations,
        ...country.futureAdoptedRegulations,
      ];
      if (
        !sameStringSequence(
          country.currentEffectiveRegulations.map(({ id }) => id),
          country.currentEffectiveRegulations
            .toSorted((left, right) => compareCanonicalText(
              `${left.canonicalName}\u0000${left.id}`,
              `${right.canonicalName}\u0000${right.id}`,
            ))
            .map(({ id }) => id),
        ) ||
        !sameStringSequence(
          country.futureAdoptedRegulations.map(({ id }) => id),
          country.futureAdoptedRegulations
            .toSorted((left, right) => compareCanonicalText(
              `${left.canonicalName}\u0000${left.id}`,
              `${right.canonicalName}\u0000${right.id}`,
            ))
            .map(({ id }) => id),
        )
      ) {
        return false;
      }
      for (const regulation of regulations) {
        if (
          !sameStringSequence(
            regulation.limits.map(({ id }) => id),
            regulation.limits
              .toSorted((left, right) => compareCanonicalText(
                [
                  left.pollutantCode,
                  left.powerMinKw ?? -1,
                  left.powerMaxKw ?? -1,
                  left.validFrom,
                  left.validTo ?? "",
                  left.id,
                ].join("\u0000"),
                [
                  right.pollutantCode,
                  right.powerMinKw ?? -1,
                  right.powerMaxKw ?? -1,
                  right.validFrom,
                  right.validTo ?? "",
                  right.id,
                ].join("\u0000"),
              ))
              .map(({ id }) => id),
          ) ||
          regulation.applicability.countryIso3 !== country.countryIso3 ||
          !analysisSourceMatches(regulation.source, {
            countryIso3: country.countryIso3,
            entityId: regulation.id,
            entityType: "regulation",
            regulationId: regulation.id,
            regulationStatus: regulation.recordStatus,
          }) ||
          !analysisSourcePresentationMatches(regulation.source, {
            entityIsDemo: regulation.isDemo,
            locator: regulation.citationCode,
            title: regulation.canonicalName,
          }) ||
          !analysisSourceMatches(
            regulation.applicability.jurisdiction.source,
            {
              countryIso3: country.countryIso3,
              entityId: regulation.applicability.jurisdiction.id,
              entityType: "jurisdiction",
              regulationId: regulation.id,
              regulationStatus: regulation.recordStatus,
            },
          ) ||
          !analysisSourcePresentationMatches(
            regulation.applicability.jurisdiction.source,
            {
              entityIsDemo: regulation.applicability.jurisdiction.isDemo,
              locator: regulation.applicability.jurisdiction.code,
              title: regulation.applicability.jurisdiction.name,
            },
          ) ||
          !analysisSourceMatches(
            regulation.applicability.membership.source,
            {
              countryIso3: country.countryIso3,
              entityId: regulation.applicability.jurisdiction.id,
              entityType: "country_jurisdiction",
              regulationId: regulation.id,
              regulationStatus: regulation.recordStatus,
            },
          ) ||
          !analysisSourcePresentationMatches(
            regulation.applicability.membership.source,
            {
              entityIsDemo: regulation.applicability.membership.isDemo,
              locator: `${regulation.applicability.membership.validFrom}–${regulation.applicability.membership.validTo ?? "open"}`,
              locatorDescriptor: {
                kind: "membership_period",
                validFrom: regulation.applicability.membership.validFrom,
                validTo: regulation.applicability.membership.validTo,
              },
              title: `${regulation.applicability.jurisdiction.name} 对 ${country.countryIso3} 的成员关系`,
              titleDescriptor: {
                countryIso3: country.countryIso3,
                jurisdictionName:
                  regulation.applicability.jurisdiction.name,
                kind: "country_jurisdiction_membership",
              },
            },
          )
        ) {
          return false;
        }
        nestedSources.push(
          regulation.source,
          regulation.applicability.jurisdiction.source,
          regulation.applicability.membership.source,
        );
        for (const limit of regulation.limits) {
          if (
            !analysisSourceMatches(limit.source, {
              countryIso3: country.countryIso3,
              entityId: limit.id,
              entityType: "regulation_limit",
              regulationId: regulation.id,
              regulationStatus: regulation.recordStatus,
            }) ||
            !analysisSourcePresentationMatches(limit.source, {
              entityIsDemo: limit.isDemo,
              locator: `${limit.pollutantCode} ${limit.validFrom}–${limit.validTo ?? "open"}`,
              locatorDescriptor: {
                kind: "regulation_limit_period",
                pollutantCode: limit.pollutantCode,
                validFrom: limit.validFrom,
                validTo: limit.validTo,
              },
              title: `${regulation.canonicalName} ${limit.pollutantCode} 限值`,
              titleDescriptor: {
                kind: "regulation_pollutant_limit",
                pollutantCode: limit.pollutantCode,
                regulationName: regulation.canonicalName,
              },
            })
          ) {
            return false;
          }
          nestedSources.push(limit.source);
        }
      }
    }
    return analysisSourcesCover(comparison.sources, nestedSources);
  } catch {
    return false;
  }
}

function citationMatchesRegulationCountry(
  citation: EvidenceCitationIdentity,
  country: RegulationComparisonIdentity["countries"][number],
): boolean {
  if (country.countryName === null || country.countrySource === null) {
    return false;
  }
  const source = country.countrySource;
  return (
    citationHasPairedEntityIdentity(citation) &&
    citation.entityId == null &&
    citation.entityType == null &&
    citation.countryIso3 === country.countryIso3 &&
    citation.locator === country.countryIso3 &&
    citation.locatorDescriptor == null &&
    citation.publishedOn === source.publishedOn &&
    citation.regulationId === null &&
    citation.regulationStatus === null &&
    citation.productCertificationId === null &&
    citation.isDemo === (country.countryIsDemo || source.isDemo) &&
    citationMatchesSourceMetadata(citation, source) &&
    citation.title === `${country.countryName} 国家概览` &&
    sameStructuredValue(citation.titleDescriptor, {
      countryIsDemo: country.countryIsDemo,
      countryIso2: source.countryIso2,
      countryIso3: country.countryIso3,
      countryNameEn: country.countryName,
      countryNameLocal: source.countryNameLocal,
      countrySourceId: source.id,
      countrySourceIsDemo: source.isDemo,
      countrySourceTitle: source.title,
      kind: "country_profile",
    }) &&
    citationHasNoDocumentContext(citation)
  );
}

function regulationCountryCitationsMatchFacts(input: {
  citations: readonly EvidenceCitationIdentity[];
  comparison: RegulationComparisonIdentity;
}): boolean {
  return input.comparison.countries.every((country) => {
    if (country.countryName === null || country.countrySource === null) {
      return country.countryName === null && country.countrySource === null;
    }
    return input.citations.some((citation) =>
      citationMatchesRegulationCountry(citation, country),
    );
  });
}

function regulationCitationsAreOwned(input: {
  citations: readonly EvidenceCitationIdentity[];
  comparison: RegulationComparisonIdentity;
}): boolean {
  return input.citations.every(
    (citation) =>
      input.comparison.sources.some((source) =>
        citationMatchesAnalysisSource(citation, source),
      ) ||
      input.comparison.countries.some((country) =>
        citationMatchesRegulationCountry(citation, country),
      ),
  );
}

/** Ensures each market observation owns the metric source exported beside it. */
export function marketComparisonSourcesMatchFacts(value: unknown): boolean {
  try {
    const comparison = value as MarketComparisonIdentity;
    const nestedSources: AnalysisSourceIdentity[] = [];
    if (
      comparison.query.metricCodes !== undefined &&
      comparison.metrics.length > 0 &&
      (comparison.metrics.length !== comparison.query.metricCodes.length ||
        comparison.metrics.some(
          (metric, index) =>
            metric.metricCode !== comparison.query.metricCodes?.[index],
        ))
    ) {
      return false;
    }
    for (const metric of comparison.metrics) {
      const seenCountries = new Set<string>();
      if (
        !sameStringSequence(
          metric.observations.map(({ id }) => id),
          metric.observations
            .toSorted((left, right) => {
              const leftCountryIndex = comparison.query.countryIso3s.indexOf(
                left.countryIso3,
              );
              const rightCountryIndex =
                comparison.query.countryIso3s.indexOf(right.countryIso3);
              return (
                leftCountryIndex - rightCountryIndex ||
                compareCanonicalText(right.periodEnd, left.periodEnd) ||
                compareCanonicalText(right.periodStart, left.periodStart) ||
                compareCanonicalText(left.id, right.id)
              );
            })
            .map(({ id }) => id),
        )
      ) {
        return false;
      }
      for (const observation of metric.observations) {
        if (
          observation.metricCode !== metric.metricCode ||
          observation.metricName !== metric.metricName ||
          !comparison.query.countryIso3s.includes(
            observation.countryIso3,
          ) ||
          (comparison.query.applicationScope != null &&
            observation.applicationScope != null &&
            observation.applicationScope !==
              comparison.query.applicationScope) ||
          !analysisSourceMatches(observation.source, {
            countryIso3: observation.countryIso3,
            entityId: observation.id,
            entityType: "market_metric",
            regulationId: null,
            regulationStatus: null,
          }) ||
          !analysisSourcePresentationMatches(observation.source, {
            entityIsDemo: observation.isDemo,
            locator: `${observation.periodStart}–${observation.periodEnd}`,
            locatorDescriptor: {
              kind: "market_period",
              periodEnd: observation.periodEnd,
              periodStart: observation.periodStart,
            },
            title: observation.metricName,
            titleDescriptor: {
              isDemo: observation.isDemo,
              kind: "market_metric",
              metricCode: observation.metricCode,
              metricId: observation.id,
              metricName: observation.metricName,
            },
          })
        ) {
          return false;
        }
        seenCountries.add(observation.countryIso3);
        nestedSources.push(observation.source);
      }
      if (
        metric.comparisonStatus === "comparable" &&
        (seenCountries.size !== comparison.query.countryIso3s.length ||
          comparison.query.countryIso3s.some(
            (countryIso3) => !seenCountries.has(countryIso3),
          ))
      ) {
        return false;
      }
    }
    return analysisSourcesCover(comparison.sources, nestedSources);
  } catch {
    return false;
  }
}

function knowledgeCitationMatchesHit(
  citation: EvidenceCitationIdentity,
  hit: KnowledgeIdentityResult["search"]["results"][number],
): boolean {
  const expectedLocator =
    hit.sectionLocator ??
    (hit.pageFrom
      ? `第 ${hit.pageFrom}${hit.pageTo && hit.pageTo !== hit.pageFrom ? `–${hit.pageTo}` : ""} 页`
      : null);
  return (
    citationHasPairedEntityIdentity(citation) &&
    citation.entityId == null &&
    citation.entityType == null &&
    citation.chunkId === hit.chunkId &&
    citation.countryIso3 === hit.countryIso3 &&
    citation.documentId === hit.document.id &&
    citation.documentTitle === hit.document.title &&
    citation.isDemo === hit.document.source.isDemo &&
    citation.locator === expectedLocator &&
    citation.locatorDescriptor == null &&
    citation.pageFrom === hit.pageFrom &&
    citation.pageTo === hit.pageTo &&
    citation.productCertificationId === null &&
    citation.publishedOn ===
      (hit.document.publishedOn ?? hit.document.source.publishedOn) &&
    citation.regulationId === null &&
    citation.regulationStatus === null &&
    citation.sectionLocator === hit.sectionLocator &&
    citationMatchesSourceMetadata(citation, hit.document.source) &&
    citation.title === hit.document.title &&
    citation.titleDescriptor == null
  );
}

function knowledgeCitationsMatchFacts(
  result: KnowledgeIdentityResult,
): boolean {
  return (
    result.search.results.every((hit) =>
      result.citations.some((citation) =>
        knowledgeCitationMatchesHit(citation, hit),
      ),
    ) &&
    result.citations.every((citation) =>
      result.search.results.some((hit) =>
        knowledgeCitationMatchesHit(citation, hit),
      ),
    )
  );
}

function countryProfileCitationsMatchFacts(
  result: CountryProfileIdentityResult,
): boolean {
  if (result.profile?.status !== "available") {
    return result.citations.length === 0;
  }
  const { citations } = result;
  const { country } = result.profile;
  const entityExpectations: EntityCitationExpectation[] = [];
  const summarySources: AnalysisSourceIdentity[] = [];
  const citationMatchesCountry = (
    citation: EvidenceCitationIdentity,
  ): boolean =>
    citationHasPairedEntityIdentity(citation) &&
    citation.entityId == null &&
    citation.entityType == null &&
    citation.countryIso3 === country.iso3 &&
    citation.isDemo === (country.isDemo || country.source.isDemo) &&
    citation.locator === country.iso3 &&
    citation.locatorDescriptor == null &&
    citation.publishedOn === country.source.publishedOn &&
    citation.regulationId === null &&
    citation.regulationStatus === null &&
    citation.productCertificationId === null &&
    citationMatchesSourceMetadata(citation, country.source) &&
    citation.title === `${country.nameEn} 国家概览` &&
    sameStructuredValue(citation.titleDescriptor, {
      countryIsDemo: country.isDemo,
      countryIso2: country.iso2,
      countryIso3: country.iso3,
      countryNameEn: country.nameEn,
      countryNameLocal: country.nameLocal,
      countrySourceId: country.source.id,
      countrySourceIsDemo: country.source.isDemo,
      countrySourceTitle: country.source.title,
      kind: "country_profile",
    }) &&
    citationHasNoDocumentContext(citation);
  if (
    !citations.some(citationMatchesCountry)
  ) {
    return false;
  }

  for (const jurisdiction of country.jurisdictions) {
    const jurisdictionExpectation: EntityCitationExpectation = {
      countryIso3: country.iso3,
      entityId: jurisdiction.id,
      entityType: "jurisdiction",
      expectedIsDemo: jurisdiction.isDemo || jurisdiction.source.isDemo,
      locator: jurisdiction.code,
      publishedOn: jurisdiction.source.publishedOn,
      regulationId: null,
      regulationStatus: null,
      source: jurisdiction.source,
      title: jurisdiction.name,
    };
    const membershipExpectation: EntityCitationExpectation = {
      countryIso3: country.iso3,
      entityId: jurisdiction.id,
      entityType: "country_jurisdiction",
      expectedIsDemo:
        jurisdiction.membershipIsDemo ||
        jurisdiction.membershipSource.isDemo,
      locator: `${jurisdiction.validFrom}–${jurisdiction.validTo ?? "open"}`,
      locatorDescriptor: {
        kind: "membership_period",
        validFrom: jurisdiction.validFrom,
        validTo: jurisdiction.validTo,
      },
      publishedOn: jurisdiction.membershipSource.publishedOn,
      regulationId: null,
      regulationStatus: null,
      source: jurisdiction.membershipSource,
      title: `${jurisdiction.name} 对 ${country.iso3} 的成员关系`,
      titleDescriptor: {
        countryIso3: country.iso3,
        jurisdictionName: jurisdiction.name,
        kind: "country_jurisdiction_membership",
      },
    };
    entityExpectations.push(jurisdictionExpectation, membershipExpectation);
    if (
      !citationMatchesEntity({
        citations,
        ...jurisdictionExpectation,
      }) ||
      !citationMatchesEntity({
        citations,
        ...membershipExpectation,
      })
    ) {
      return false;
    }
  }

  const regulations = [
    ...country.currentEffectiveRegulations,
    ...country.futureAdoptedRegulations,
  ];
  for (const regulation of regulations) {
    const countryIso3 = regulation.applicability.countryIso3;
    const regulationExpectation: EntityCitationExpectation = {
      countryIso3,
      entityId: regulation.id,
      entityType: "regulation",
      expectedIsDemo: regulation.isDemo || regulation.source.isDemo,
      locator: regulation.citationCode,
      publishedOn: regulation.source.publishedOn,
      regulationId: regulation.id,
      regulationStatus: regulation.status,
      source: regulation.source,
      title: regulation.canonicalName,
    };
    const jurisdictionExpectation: EntityCitationExpectation = {
      countryIso3,
      entityId: regulation.applicability.jurisdiction.id,
      entityType: "jurisdiction",
      expectedIsDemo:
        regulation.applicability.jurisdiction.isDemo ||
        regulation.applicability.jurisdiction.source.isDemo,
      locator: regulation.applicability.jurisdiction.code,
      publishedOn:
        regulation.applicability.jurisdiction.source.publishedOn,
      regulationId: regulation.id,
      regulationStatus: regulation.status,
      source: regulation.applicability.jurisdiction.source,
      title: `${regulation.canonicalName} 适用辖区：${regulation.applicability.jurisdiction.name}`,
      titleDescriptor: {
        jurisdictionName: regulation.applicability.jurisdiction.name,
        kind: "regulation_jurisdiction",
        regulationName: regulation.canonicalName,
      },
    };
    const membershipExpectation: EntityCitationExpectation = {
      countryIso3,
      entityId: regulation.applicability.jurisdiction.id,
      entityType: "country_jurisdiction",
      expectedIsDemo:
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
      publishedOn: regulation.applicability.membership.source.publishedOn,
      regulationId: regulation.id,
      regulationStatus: regulation.status,
      source: regulation.applicability.membership.source,
      title: `${regulation.applicability.jurisdiction.name} 对 ${countryIso3} 的成员关系`,
      titleDescriptor: {
        countryIso3,
        jurisdictionName: regulation.applicability.jurisdiction.name,
        kind: "country_jurisdiction_membership",
      },
    };
    entityExpectations.push(
      regulationExpectation,
      jurisdictionExpectation,
      membershipExpectation,
    );
    if (
      !citationMatchesEntity({
        citations,
        ...regulationExpectation,
      }) ||
      !citationMatchesEntity({
        citations,
        ...jurisdictionExpectation,
      }) ||
      !citationMatchesEntity({
        citations,
        ...membershipExpectation,
      })
    ) {
      return false;
    }
  }

  const summary = result.profile.applicabilitySummary;
  if (summary != null) {
    if (
      summary.query.asOf !== result.profile.asOf ||
      summary.query.countryIso3s.length !== 1 ||
      summary.query.countryIso3s[0] !== country.iso3 ||
      summary.country.countryIso3 !== country.iso3
    ) {
      return false;
    }
    const comparison: RegulationComparisonIdentity = {
      countries: [summary.country],
      query: summary.query,
      sources: summary.sources,
    };
    if (
      !regulationComparisonSourcesMatchFacts(comparison) ||
      !regulationCountryCitationsMatchFacts({ citations, comparison }) ||
      !citationsCoverAnalysisSources(citations, summary.sources)
    ) {
      return false;
    }
    summarySources.push(...summary.sources);
  }

  const nestedProfileSources = [
    country.source,
    ...country.jurisdictions.flatMap((jurisdiction) => [
      jurisdiction.source,
      jurisdiction.membershipSource,
    ]),
    ...regulations.flatMap((regulation) => [
      regulation.source,
      regulation.applicability.jurisdiction.source,
      regulation.applicability.membership.source,
    ]),
    ...country.marketMetrics.map(({ source }) => source),
  ];
  if (
    !country.sources.every((source) =>
      nestedProfileSources.some((nested) =>
        sameSimpleSourceIdentity(source, nested),
      ),
    ) ||
    !nestedProfileSources.every((nested) =>
      country.sources.some((source) =>
        sameSimpleSourceIdentity(source, nested),
      ),
    ) ||
    !country.sources.every((source) =>
      citations.some((citation) =>
        citationMatchesSourceMetadata(citation, source),
      ),
    )
  ) {
    return false;
  }

  for (const metric of country.marketMetrics) {
    if (metric.countryIso3 !== country.iso3) {
      return false;
    }
    const expectation: EntityCitationExpectation = {
      countryIso3: metric.countryIso3,
      entityId: metric.id,
      entityType: "market_metric",
      expectedIsDemo: metric.isDemo || metric.source.isDemo,
      locator: `${metric.periodStart}–${metric.periodEnd}`,
      locatorDescriptor: {
        kind: "market_period",
        periodEnd: metric.periodEnd,
        periodStart: metric.periodStart,
      },
      publishedOn: metric.publishedOn ?? metric.source.publishedOn,
      regulationId: null,
      regulationStatus: null,
      source: metric.source,
      title: metric.metricName,
      titleDescriptor: {
        isDemo: metric.isDemo,
        kind: "market_metric",
        metricCode: metric.metricCode,
        metricId: metric.id,
        metricName: metric.metricName,
      },
    };
    entityExpectations.push(expectation);
    if (!citationMatchesEntity({ citations, ...expectation })) {
      return false;
    }
  }

  return citations.every(
    (citation) =>
      citationMatchesCountry(citation) ||
      entityExpectations.some((expectation) =>
        citationMatchesEntityIdentity(citation, expectation),
      ) ||
      summarySources.some((source) =>
        citationMatchesAnalysisSource(citation, source),
      ) ||
      (summary != null &&
        citationMatchesRegulationCountry(citation, summary.country)),
  );
}

type ProductLimitCitationExpectation = {
  countryIso3: string;
  expectedIsDemo: boolean;
  locator: string | null;
  publishedOn: string | null;
  regulationId: string;
  regulationName: string;
  regulationStatus: string;
  source: SimpleSourceIdentity;
};

function citationMatchesProductLimitSource(
  citation: EvidenceCitationIdentity,
  input: ProductLimitCitationExpectation,
): boolean {
  return (
    citationHasPairedEntityIdentity(citation) &&
    citation.entityId == null &&
    citation.entityType == null &&
    citation.countryIso3 === input.countryIso3 &&
    citation.isDemo === input.expectedIsDemo &&
    citation.locator === input.locator &&
    citation.locatorDescriptor == null &&
    citation.publishedOn === input.publishedOn &&
    citation.regulationId === input.regulationId &&
    citation.regulationStatus === input.regulationStatus &&
    citation.productCertificationId === null &&
    citationMatchesSourceMetadata(citation, input.source) &&
    citation.title === `${input.regulationName} 适用限值` &&
    sameStructuredValue(citation.titleDescriptor, {
      kind: "regulation_limits",
      regulationName: input.regulationName,
    }) &&
    citationHasNoDocumentContext(citation)
  );
}

function productCitationsMatchFacts(result: ProductIdentityResult): boolean {
  const { citations } = result;
  const entityExpectations: EntityCitationExpectation[] = [];
  const limitExpectations: ProductLimitCitationExpectation[] = [];
  const requireEntityCitation = (
    expectation: EntityCitationExpectation,
  ): boolean => {
    entityExpectations.push(expectation);
    return citationMatchesEntity({ citations, ...expectation });
  };
  const requireLimitCitation = (
    expectation: ProductLimitCitationExpectation,
  ): boolean => {
    limitExpectations.push(expectation);
    return citations.some((citation) =>
      citationMatchesProductLimitSource(citation, expectation),
    );
  };
  for (const evaluation of result.evaluations) {
    const countryIso3 = evaluation.input.countryIso3;
    if (
      evaluation.product !== null &&
      !requireEntityCitation({
        countryIso3,
        entityId: evaluation.product.id,
        entityType: "product",
        expectedIsDemo:
          evaluation.product.isDemo || evaluation.product.source.isDemo,
        locator: evaluation.product.modelCode,
        locatorDescriptor: {
          availableFrom: evaluation.product.availableFrom,
          availableTo: evaluation.product.availableTo,
          kind: "product_availability",
          modelCode: evaluation.product.modelCode,
          specificationVersion: evaluation.product.specificationVersion,
        },
        publishedOn: evaluation.product.source.publishedOn,
        regulationId: null,
        regulationStatus: null,
        source: evaluation.product.source,
        title: evaluation.product.name,
      })
    ) {
      return false;
    }

    for (const regulationCheck of evaluation.regulationChecks) {
      const { regulation } = regulationCheck;
      if (
        !requireEntityCitation({
          countryIso3,
          entityId: regulation.regulationId,
          entityType: "regulation",
          expectedIsDemo: regulation.isDemo || regulation.source.isDemo,
          locator: regulation.citationCode,
          publishedOn: regulation.source.publishedOn,
          regulationId: regulation.regulationId,
          regulationStatus: regulation.recordStatus,
          source: regulation.source,
          title: regulation.canonicalName,
        }) ||
        !requireEntityCitation({
          countryIso3,
          entityId: regulation.applicability.jurisdiction.id,
          entityType: "jurisdiction",
          expectedIsDemo:
            regulation.applicability.jurisdiction.isDemo ||
            regulation.applicability.jurisdiction.source.isDemo,
          locator: regulation.applicability.jurisdiction.code,
          publishedOn:
            regulation.applicability.jurisdiction.source.publishedOn,
          regulationId: regulation.regulationId,
          regulationStatus: regulation.recordStatus,
          source: regulation.applicability.jurisdiction.source,
          title: regulation.applicability.jurisdiction.name,
        }) ||
        !requireEntityCitation({
          countryIso3,
          entityId: regulation.applicability.jurisdiction.id,
          entityType: "country_jurisdiction",
          expectedIsDemo:
            regulation.applicability.membership.isDemo ||
            regulation.applicability.membership.source.isDemo,
          locator: `${regulation.applicability.membership.validFrom}–${regulation.applicability.membership.validTo ?? "open"}`,
          locatorDescriptor: {
            kind: "membership_period",
            validFrom: regulation.applicability.membership.validFrom,
            validTo: regulation.applicability.membership.validTo,
          },
          publishedOn:
            regulation.applicability.membership.source.publishedOn,
          regulationId: regulation.regulationId,
          regulationStatus: regulation.recordStatus,
          source: regulation.applicability.membership.source,
          title: `${regulation.applicability.jurisdiction.name} 对 ${regulation.applicability.countryIso3} 的成员关系`,
          titleDescriptor: {
            countryIso3: regulation.applicability.countryIso3,
            jurisdictionName: regulation.applicability.jurisdiction.name,
            kind: "country_jurisdiction_membership",
          },
        }) ||
        !regulation.limitSources.every((source) =>
          requireLimitCitation({
            countryIso3,
            expectedIsDemo: regulation.isDemo || source.isDemo,
            locator: regulation.citationCode,
            publishedOn: source.publishedOn,
            regulationId: regulation.regulationId,
            regulationName: regulation.canonicalName,
            regulationStatus: regulation.recordStatus,
            source,
          }),
        )
      ) {
        return false;
      }
      for (const { certification } of regulationCheck.certifications) {
        if (
          evaluation.product === null ||
          certification.productId !== evaluation.product.id ||
          certification.productModelCode !== evaluation.product.modelCode ||
          !requireEntityCitation({
            countryIso3,
            entityId: certification.id,
            entityType: "product_certification",
            expectedIsDemo:
              certification.isDemo || certification.source.isDemo,
            locator: certification.certificateNumber,
            publishedOn: certification.source.publishedOn,
            regulationId: certification.regulationId,
            regulationStatus: regulation.recordStatus,
            source: certification.source,
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
          })
        ) {
          return false;
        }
      }
    }

    const nestedEvaluationSources = [
      ...(evaluation.product === null
        ? []
        : [
            {
              ...evaluation.product.source,
              isDemo:
                evaluation.product.isDemo ||
                evaluation.product.source.isDemo,
            },
          ]),
      ...evaluation.regulationChecks.flatMap(
        ({ certifications, regulation }) => [
          {
            ...regulation.source,
            isDemo: regulation.isDemo || regulation.source.isDemo,
          },
          {
            ...regulation.applicability.jurisdiction.source,
            isDemo:
              regulation.applicability.jurisdiction.isDemo ||
              regulation.applicability.jurisdiction.source.isDemo,
          },
          {
            ...regulation.applicability.membership.source,
            isDemo:
              regulation.applicability.membership.isDemo ||
              regulation.applicability.membership.source.isDemo,
          },
          ...regulation.limitSources,
          ...certifications.map(({ certification }) => ({
            ...certification.source,
            isDemo: certification.isDemo || certification.source.isDemo,
          })),
        ],
      ),
    ];
    if (
      !evaluation.sources.every(
        (source) =>
          nestedEvaluationSources.some((nested) =>
            sameSimpleSourceIdentity(source, nested),
          ) &&
          citations.some(
            (citation) =>
              citation.countryIso3 === countryIso3 &&
              citationMatchesSourceMetadata(citation, source),
          ),
      ) ||
      !nestedEvaluationSources.every((nested) =>
        evaluation.sources.some((source) =>
          sameSimpleSourceIdentity(source, nested),
        ),
      )
    ) {
      return false;
    }
  }
  return citations.every(
    (citation) =>
      entityExpectations.some((expectation) =>
        citationMatchesEntityIdentity(citation, expectation),
      ) ||
      limitExpectations.some((expectation) =>
        citationMatchesProductLimitSource(citation, expectation),
      ),
  );
}

function scoredCountriesHaveSources(input: {
  countryIso3s: readonly string[];
  productModelCode?: string;
  scores: readonly { countryIso3: string; overallScore: number | null }[];
  sources: readonly AnalysisSourceIdentity[];
}): boolean {
  return (
    input.sources.every(
      ({ countryIso3 }) =>
        countryIso3 !== null && input.countryIso3s.includes(countryIso3),
    ) &&
    (input.productModelCode === undefined ||
      input.sources.every(
        (source) =>
          source.entityType !== "product" ||
          descriptorHasFields(source.locatorDescriptor, {
            kind: "product_availability",
            modelCode: input.productModelCode,
          }),
      )) &&
    input.scores.every(
      (score) =>
        score.overallScore === null ||
        input.sources.some(
          ({ countryIso3 }) => countryIso3 === score.countryIso3,
        ),
    )
  );
}

function scoreCitationsMatchFacts(result: ScoreIdentityResult): boolean {
  return (
    result.informationAsOf === result.scorecard.query.asOf &&
    scoredCountriesHaveSources({
      countryIso3s: result.scorecard.query.countryIso3s,
      productModelCode: result.scorecard.query.productModelCode,
      scores: result.scorecard.scores,
      sources: result.scorecard.sources,
    }) &&
    citationsExactlyMatchAnalysisSources(
      result.citations,
      result.scorecard.sources,
    )
  );
}

function briefCitationsMatchFacts(result: BriefIdentityResult): boolean {
  const { brief, citations } = result;
  if (
    result.informationAsOf !== brief.query.asOf ||
    !brief.sources.every(
      ({ countryIso3 }) =>
        countryIso3 !== null &&
        brief.query.countryIso3s.includes(countryIso3),
    ) ||
    !citationsExactlyMatchAnalysisSources(citations, brief.sources) ||
    (brief.marketScore.overallScore !== null &&
      !brief.sources.some(
        ({ countryIso3 }) =>
          countryIso3 === brief.marketScore.countryIso3,
      ))
  ) {
    return false;
  }

  return brief.recommendedProducts.every((product) => {
    const productSource = brief.sources.find(
      (source) =>
        source.countryIso3 === brief.query.targetCountryIso3 &&
        source.entityId === product.id &&
        source.entityType === "product" &&
        source.isDemo === (product.isDemo || product.source.isDemo) &&
        source.locator ===
          `${product.modelCode}; availability ${product.availableFrom ?? "unknown"}–${product.availableTo ?? "unknown"}` &&
        source.regulationId === null &&
        source.sourceId === product.source.id &&
        source.sourceTitle === product.source.title &&
        source.title === product.name &&
        descriptorHasFields(source.locatorDescriptor, {
          availableFrom: product.availableFrom,
          availableTo: product.availableTo,
          kind: "product_availability",
          modelCode: product.modelCode,
          specificationVersion: product.specificationVersion,
        }),
    );
    if (!productSource) {
      return false;
    }
    const certificationsCovered = product.certifications.every(
      (certification) =>
        brief.sources.some(
          (source) =>
            source.countryIso3 === brief.query.targetCountryIso3 &&
            source.entityId === certification.id &&
            source.entityType === "product_certification" &&
            source.productId === product.id &&
            source.productModelCode === product.modelCode &&
            source.regulationId === certification.regulationId,
        ),
    );
    const regulationsCovered = product.certifications.every(
      ({ regulationId }) =>
        brief.sources.some(
          (source) =>
            source.countryIso3 === brief.query.targetCountryIso3 &&
            source.entityId === regulationId &&
            source.entityType === "regulation" &&
            source.regulationId === regulationId,
        ),
    );
    return certificationsCovered && regulationsCovered;
  });
}

/**
 * Verifies typed entity/source identities for structured facts. Every
 * citation must be owned by a visible fact/source; owned duplicates are valid.
 * Score dimensions and brief rule projections carry separate typed
 * provenance and are recomputed by their deterministic domain validators.
 */
export function aiEvidenceCitationsMatchFacts(value: unknown): boolean {
  try {
    const result = value as AiEvidenceIdentityResult;
    if (
      !latestVerifiedAtMatchesCitations(result) ||
      !result.citations.every(citationHasPairedEntityIdentity)
    ) {
      return false;
    }
    if (result.tool === "searchKnowledgeBase") {
      return knowledgeCitationsMatchFacts(result);
    }
    if (result.tool === "getCountryProfile") {
      return countryProfileCitationsMatchFacts(result);
    }
    if (result.tool === "findCompatibleProducts") {
      return productCitationsMatchFacts(result);
    }
    if (result.tool === "compareRegulations") {
      return (
        result.informationAsOf === result.comparison.query.asOf &&
        regulationComparisonSourcesMatchFacts(result.comparison) &&
        regulationCountryCitationsMatchFacts({
          citations: result.citations,
          comparison: result.comparison,
        }) &&
        regulationCitationsAreOwned({
          citations: result.citations,
          comparison: result.comparison,
        }) &&
        citationsCoverAnalysisSources(
          result.citations,
          result.comparison.sources,
        )
      );
    }
    if (result.tool === "compareMarkets") {
      return (
        marketComparisonSourcesMatchFacts(result.comparison) &&
        citationsExactlyMatchAnalysisSources(
          result.citations,
          result.comparison.sources,
        )
      );
    }
    if (result.tool === "calculateOpportunityScore") {
      return scoreCitationsMatchFacts(result);
    }
    return briefCitationsMatchFacts(result);
  } catch {
    return false;
  }
}
