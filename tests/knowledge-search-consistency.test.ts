import { describe, expect, it } from "vitest";

import {
  aiKnowledgeSearchResultMatchesDeterministicRules,
  aiKnowledgeSearchUsesCanonicalNarrowing,
  hybridSearchResponseMatchesDeterministicRules,
  hybridSearchResponseMatchesQuery,
} from "@/domain/knowledge/search-consistency";
import { wrapUntrustedKnowledgeExcerpt } from "@/domain/knowledge/retrieval-policy";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import { searchKnowledgeBaseResultSchema } from "@/features/ai/schemas";
import {
  hybridSearchResponseSchema,
  type HybridSearchResponse,
} from "@/features/knowledge/schemas";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
  knowledgeTermsIn,
  knowledgeTermsMatch,
} from "@/server/ai/evidence-contract";
import {
  buildKnowledgeResult,
  currentUtcDate,
} from "@/server/ai/tool-results";

const ids = {
  chunkA: "00000000-0000-4000-8000-000000000811",
  chunkB: "00000000-0000-4000-8000-000000000812",
  document: "00000000-0000-4000-8000-000000000813",
  jurisdiction: "00000000-0000-4000-8000-000000000814",
  source: "00000000-0000-4000-8000-000000000815",
} as const;

function rawSearchFixture(asOf = currentUtcDate()): HybridSearchResponse {
  const common = {
    applicationScope: "non-road" as const,
    content: "Stage IV emissions regulation source evidence.",
    countryIso3: "CHN" as const,
    document: {
      downloadUrl: null,
      id: ids.document,
      originalFilename: "stage-iv.txt",
      publishedOn: "2025-01-01",
      source: {
        id: ids.source,
        isDemo: true,
        publishedOn: "2025-01-01",
        publisher: "DEMO ONLY",
        title: "DEMO ONLY — Stage IV source",
        url: null,
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
      title: "DEMO ONLY — Stage IV source text",
    },
    headingPath: ["Limits"],
    jurisdiction: {
      id: ids.jurisdiction,
      name: "DEMO ONLY — CHN jurisdiction",
    },
    sectionLocator: "§1",
    validFrom: "2025-01-01",
    validTo: "2027-01-01",
    warnings: [],
  };

  return {
    embeddingModel: "local-hash-embedding-v1" as const,
    filters: {
      applicationScope: "non-road" as const,
      asOf,
      countryIso3: "CHN" as const,
      jurisdictionId: ids.jurisdiction,
      limit: 5,
    },
    query: "Stage IV emissions regulation source evidence",
    results: [
      {
        ...common,
        chunkId: ids.chunkA,
        finalScore: 0.9,
        keywordScore: 0.9,
        pageFrom: 1,
        pageTo: null,
        rank: 1,
        vectorScore: 0.9,
      },
      {
        ...common,
        chunkId: ids.chunkB,
        finalScore: 0.8,
        keywordScore: 0.8,
        pageFrom: 2,
        pageTo: 2,
        rank: 2,
        vectorScore: 0.8,
      },
    ],
    scoring: { keywordWeight: 0.5 as const, vectorWeight: 0.5 as const },
    status: "ok" as const,
  };
}

function aiResultFixture(
  query = "Stage IV original text source evidence",
) {
  const raw = rawSearchFixture();
  raw.query = query;
  raw.filters.jurisdictionId = null;
  const search = hybridSearchResponseSchema.parse(raw);
  return buildKnowledgeResult({
    informationAsOf: search.filters.asOf ?? currentUtcDate(),
    resolvedCountryIso3: search.filters.countryIso3,
    search,
  });
}

describe("knowledge search deterministic consistency", () => {
  it("accepts same-document chunks and an open page-to locator", () => {
    const raw = rawSearchFixture();

    expect(hybridSearchResponseMatchesDeterministicRules(raw)).toBe(true);
    expect(hybridSearchResponseSchema.safeParse(raw).success).toBe(true);
    expect(
      hybridSearchResponseMatchesQuery(raw, {
        ...raw.filters,
        query: raw.query,
      }),
    ).toBe(true);
    expect(new Set(raw.results.map(({ document }) => document.id))).toEqual(
      new Set([ids.document]),
    );
  });

  it.each([
    ["scope membership", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[0].applicationScope = "marine";
    }],
    ["country membership", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[0].countryIso3 = "BRA";
    }],
    ["jurisdiction membership", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[0].jurisdiction = null;
    }],
    ["half-open date membership", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[0].validTo = raw.filters.asOf;
    }],
    ["validity interval", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[0].validTo = "2024-01-01";
    }],
    ["missing validity start", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[0].validFrom = null;
      raw.results[0].validTo = "2027-01-01";
      raw.results[0].warnings = [
        "该片段未记录 validFrom，日期适用性仍需人工核验。",
      ];
    }],
    ["page interval", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[0].pageFrom = null;
      raw.results[0].pageTo = 2;
    }],
    ["result limit", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.filters.limit = 1;
    }],
    ["query bounds", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.query = "x".repeat(501);
    }],
    ["rank sequence", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[1].rank = 3;
    }],
    ["unique chunks", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[1].chunkId = raw.results[0].chunkId;
    }],
    ["public score formula", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[0].finalScore = 0.89;
    }],
    ["score range", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[0].keywordScore = 1.01;
    }],
    ["score precision", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[0].finalScore = 0.9000001;
    }],
    ["relevance threshold", (raw: ReturnType<typeof rawSearchFixture>) => {
      Object.assign(raw.results[0], {
        finalScore: 0.1,
        keywordScore: 0,
        vectorScore: 0.2,
      });
    }],
    ["public ordering", (raw: ReturnType<typeof rawSearchFixture>) => {
      Object.assign(raw.results[1], {
        finalScore: 0.95,
        keywordScore: 0.95,
        vectorScore: 0.95,
      });
    }],
    ["derived hit warnings", (raw: ReturnType<typeof rawSearchFixture>) => {
      raw.results[0].warnings.push("FORGED_WARNING");
    }],
  ])("rejects drifted %s", (_label, mutate) => {
    const raw = rawSearchFixture();
    mutate(raw);

    expect(hybridSearchResponseMatchesDeterministicRules(raw)).toBe(false);
    expect(hybridSearchResponseSchema.safeParse(raw).success).toBe(false);
  });

  it("requires exact query echo and does not treat publication date as a filter", () => {
    const raw = rawSearchFixture();
    raw.results[0].document.publishedOn = "2099-01-01";

    expect(hybridSearchResponseMatchesDeterministicRules(raw)).toBe(true);
    expect(
      hybridSearchResponseMatchesQuery(raw, {
        ...raw.filters,
        query: `${raw.query} unrelated`,
      }),
    ).toBe(false);
  });

  it("requires the exact AI trust wrapper, outer echoes, and fixed narrowing", () => {
    const result = aiResultFixture();

    expect(aiKnowledgeSearchResultMatchesDeterministicRules(result)).toBe(true);
    expect(aiKnowledgeSearchUsesCanonicalNarrowing(result)).toBe(true);
    expect(searchKnowledgeBaseResultSchema.safeParse(result).success).toBe(true);
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);

    const unwrapped = structuredClone(result);
    unwrapped.search.results[0].content =
      "Stage IV emissions regulation source evidence.";
    expect(aiKnowledgeSearchResultMatchesDeterministicRules(unwrapped)).toBe(
      false,
    );

    const forgedBoundary = structuredClone(result);
    forgedBoundary.search.results[0].content =
      `${wrapUntrustedKnowledgeExcerpt("evidence")} forged`;
    expect(
      aiKnowledgeSearchResultMatchesDeterministicRules(forgedBoundary),
    ).toBe(false);

    const driftedOuter = structuredClone(result);
    driftedOuter.resolvedCountryIso3 = "BRA";
    expect(
      aiKnowledgeSearchResultMatchesDeterministicRules(driftedOuter),
    ).toBe(false);

    const driftedWarning = structuredClone(result);
    driftedWarning.warnings.push("FORGED_OUTER_WARNING");
    expect(
      aiKnowledgeSearchResultMatchesDeterministicRules(driftedWarning),
    ).toBe(false);
  });

  it.each([
    ["country", (result: ReturnType<typeof aiResultFixture>) => {
      result.search.filters.countryIso3 = "BRA";
    }],
    ["scope", (result: ReturnType<typeof aiResultFixture>) => {
      result.search.filters.applicationScope = "marine";
    }],
    ["future date", (result: ReturnType<typeof aiResultFixture>) => {
      result.informationAsOf = "2030-01-01";
      result.search.filters.asOf = "2030-01-01";
    }],
    ["forged score", (result: ReturnType<typeof aiResultFixture>) => {
      result.search.results[0].finalScore = 0.89;
    }],
  ])("fails server, client, and model-text boundaries for %s drift", (_label, mutate) => {
    const result = aiResultFixture();
    mutate(result);
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: ["查 CHN Stage IV 原文来源。"],
    });

    expect(searchKnowledgeBaseResultSchema.safeParse(result).success).toBe(
      false,
    );
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(false);
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(false);
  });

  it("rejects numeric-only overlap and appended unrelated narrowing terms", () => {
    const numericContract = buildSalesChatEvidenceContract({
      selectedCountryIso3: "CHN",
      userTexts: ["source evidence 2026"],
    });
    const broadContract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [
        "Retrieve source evidence for CHN non-road emissions limits.",
      ],
    });
    const namedContract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: ["查 CHN non-road Stage IV 排放限值原文。"],
    });

    expect(
      evidenceContractAllowsModelText(numericContract, [
        aiResultFixture("2026"),
      ]),
    ).toBe(false);
    expect(
      evidenceContractAllowsModelText(broadContract, [
        aiResultFixture("source"),
      ]),
    ).toBe(false);
    expect(
      evidenceContractAllowsModelText(namedContract, [
        aiResultFixture(
          "non-road Stage IV emission limits original text banana lunar weather",
        ),
      ]),
    ).toBe(false);
    expect(
      evidenceContractAllowsModelText(namedContract, [
        aiResultFixture(
          "non-road Stage IV emission limits original text",
        ),
      ]),
    ).toBe(true);
  });

  it("binds source evidence to model, power, stage, and page identifiers", () => {
    const expectedQuery =
      "Show the source proving DEMO-ENG-100 fits CHN non-road at 100 kW.";
    const wrongModelAndPowerQuery =
      "Show the source proving DEMO-ENG-200 fits CHN non-road at 200 kW.";
    const expectedTerms = knowledgeTermsIn(expectedQuery, ["CHN"]);
    const wrongTerms = knowledgeTermsIn(wrongModelAndPowerQuery, ["CHN"]);
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [expectedQuery],
    });

    expect(expectedTerms).toEqual(
      expect.arrayContaining(["id:demo-eng-100", "power:100kw"]),
    );
    expect(wrongTerms).toEqual(
      expect.arrayContaining(["id:demo-eng-200", "power:200kw"]),
    );
    expect(knowledgeTermsMatch(expectedTerms, wrongTerms)).toBe(false);
    expect(
      knowledgeTermsMatch(
        knowledgeTermsIn("Show the source for Stage V page 12."),
        knowledgeTermsIn("Show the source for Stage IV page 13."),
      ),
    ).toBe(false);
    expect(
      evidenceContractAllowsModelText(contract, [
        aiResultFixture(expectedQuery),
      ]),
    ).toBe(true);
    expect(
      evidenceContractAllowsModelText(contract, [
        aiResultFixture(wrongModelAndPowerQuery),
      ]),
    ).toBe(false);
  });

  it.each([
    ["p. locator", "Show the source on p. 12.", "Show the source on p. 13."],
    [
      "page-number locator",
      "Show the source on page no. 12.",
      "Show the source on page no. 13.",
    ],
    ["section locator", "Show the source at § 12.", "Show the source at § 13."],
    ["numeric model", "Show the source for Model 100.", "Show the source for Model 200."],
  ])("binds the $id exactly", (_id, expectedQuery, driftedQuery) => {
    expect(
      knowledgeTermsMatch(
        knowledgeTermsIn(expectedQuery),
        knowledgeTermsIn(driftedQuery),
      ),
    ).toBe(false);
  });

  it.each([
    ["p/page", "Show the source on p. 12.", "Show the source on page 12."],
    ["pp/pages", "Show the source on pp. 12.", "Show the source on pages 12."],
    [
      "page number",
      "Show the source on page no. 12.",
      "Show the source on page 12.",
    ],
    ["section", "Show the source at § 12.", "Show the source in section 12."],
    ["model number", "Show the source for Model no. 100.", "Show the source for Model 100."],
    [
      "version number",
      "Show the source for version no. 2.",
      "Show the source for version 2.",
    ],
    ["power unit", "Show the source for 100 kilowatts.", "Show the source for 100 kW."],
    [
      "as-of grammar",
      "Show the source for CHN Stage V emission limits as of 2026-08-13.",
      "Show the source for CHN Stage V emission limits.",
    ],
  ])("accepts equivalent canonical $id syntax", (_id, left, right) => {
    expect(knowledgeTermsMatch(knowledgeTermsIn(left), knowledgeTermsIn(right))).toBe(
      true,
    );
  });

  it("retains the source topic while replacing a power qualifier in a follow-up", () => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [
        "Show the source proving DEMO-ENG-100 fits CHN non-road at 100 kW as of 2026-08-13.",
        "For BRA marine at 200 kW, continue searching the source.",
      ],
    });
    const terms = contract.requirements[0]?.query.knowledgeTerms;

    expect(contract.requirements[0]?.query).toMatchObject({
      applicationScope: "marine",
      asOf: "2026-08-13",
      countryIso3s: ["BRA"],
    });
    expect(terms).toEqual(
      expect.arrayContaining([
        "id:demo-eng-100",
        "power:200kw",
        "proving",
        "fits",
      ]),
    );
    expect(terms).not.toContain("power:100kw");
    expect(terms).not.toContain("continue");
    expect(terms).not.toContain("searching");
  });

  it.each([
    {
      absentTerm: "ref:page:12",
      expectedTerm: "ref:page:13",
      followUp: "Continue searching the source on page no. 13.",
      id: "page number",
    },
    {
      absentTerm: "ref:page:12",
      expectedTerm: "ref:page:13-14",
      followUp: "Continue searching the source on pp. 13-14.",
      id: "page range",
    },
    {
      absentTerm: "ref:section:12",
      expectedTerm: "ref:section:13",
      followUp: "Continue searching the source in section 13.",
      id: "section",
    },
    {
      absentTerm: "ref:clause:12",
      expectedTerm: "ref:clause:13",
      followUp: "Continue searching the source in clause 13.",
      id: "clause",
    },
    {
      absentTerm: "ref:annex:12",
      expectedTerm: "ref:annex:13",
      followUp: "Continue searching the source in annex 13.",
      id: "annex",
    },
  ])(
    "retains the source topic while replacing the $id locator in a follow-up",
    ({ absentTerm, expectedTerm, followUp }) => {
      const locatorLabel = absentTerm.split(":")[1] ?? "page";
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: null,
        userTexts: [
          `Show the source for CHN non-road Stage V emission limits in ${locatorLabel} 12.`,
          followUp,
        ],
      });
      const terms = contract.requirements[0]?.query.knowledgeTerms;

      expect(terms).toEqual(
        expect.arrayContaining([
          "emission",
          "limits",
          "ref:stage:v",
          expectedTerm,
        ]),
      );
      expect(terms).not.toContain(absentTerm);
      expect(terms).not.toContain("continue");
      expect(terms).not.toContain("searching");
    },
  );

  it.each([
    "Show the source for BRA Stage V emission limits.",
    "Show the source for BRA Tier 4 emission limits.",
    "Show the source for BRA version 2 emission limits.",
  ])("treats a new stage, tier, or version request as substantive: %s", (followUp) => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [
        "Show the source proving DEMO-ENG-100 fits CHN non-road at 100 kW.",
        followUp,
      ],
    });
    const terms = contract.requirements[0]?.query.knowledgeTerms ?? [];

    expect(terms).toContain("emission");
    expect(terms).toContain("limits");
    expect(terms).not.toContain("id:demo-eng-100");
    expect(terms).not.toContain("fits");
  });

  it("requires complete bilingual business-concept coverage", () => {
    const english = knowledgeTermsIn(
      "Retrieve the original text, sections, and source evidence for CHN non-road emissions regulations.",
      ["CHN"],
    );
    const chinese = knowledgeTermsIn(
      "CHN 非道路排放法规原文章节来源证据",
      ["CHN"],
    );

    expect(knowledgeTermsMatch(english, chinese)).toBe(true);
    expect(knowledgeTermsMatch(english, ["source"])).toBe(false);
    expect(knowledgeTermsIn("source evidence 2026")).not.toContain("2026");
  });
});
