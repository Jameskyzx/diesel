import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  calculateProductReadiness,
  calculateRegulatoryCoverage,
  combineOpportunityScore,
} from "@/domain/marketing/opportunity-score";
import { salesBriefMatchesDeterministicRules } from "@/domain/marketing/sales-brief-consistency";
import {
  salesBriefSchema,
  type OpportunityScoreGap,
  type SalesBrief,
} from "@/features/marketing/schemas";
import { generateSalesBrief } from "@/server/services/marketing-analysis-service";

const originalDatabaseMode = process.env.DATABASE_MODE;
const input = {
  applicationScope: "non-road" as const,
  asOf: "2026-08-13",
  countryIso3s: ["CHN", "BRA"],
  metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
  powerKw: 100,
  targetCountryIso3: "CHN",
};

beforeAll(() => {
  process.env.DATABASE_MODE = "pglite-demo";
});

afterAll(() => {
  if (originalDatabaseMode === undefined) {
    delete process.env.DATABASE_MODE;
  } else {
    process.env.DATABASE_MODE = originalDatabaseMode;
  }
});

async function buildBrief(): Promise<SalesBrief> {
  return generateSalesBrief(input);
}

function replaceComponentScore(
  brief: SalesBrief,
  key: SalesBrief["marketScore"]["components"][number]["key"],
  score: number | null,
  gaps: OpportunityScoreGap[] = brief.marketScore.gaps,
): void {
  const weights = Object.fromEntries(
    brief.marketScore.components.map(
      ({ configuredWeight, key: componentKey }) => [
        componentKey,
        configuredWeight,
      ],
    ),
  ) as {
    marketPotential: number;
    productReadiness: number;
    regulatoryCoverage: number;
  };
  brief.marketScore = combineOpportunityScore({
    components: brief.marketScore.components.map((component) => ({
      key: component.key,
      score: component.key === key ? score : component.score,
    })),
    countryIso3: brief.marketScore.countryIso3,
    gaps,
    weights,
  });
  brief.gaps = gaps;
}

function targetEvaluations(brief: SalesBrief) {
  const country = brief.provenance.productEvaluations.find(
    ({ countryIso3 }) => countryIso3 === brief.query.targetCountryIso3,
  );
  if (!country) throw new Error("Expected target-country evaluations.");
  return country.evaluations;
}

function readyEvaluation(brief: SalesBrief) {
  const evaluation = targetEvaluations(brief).find(
    ({ commercialReadiness }) => commercialReadiness === "ready",
  );
  if (!evaluation?.product) throw new Error("Expected a ready Demo product.");
  return evaluation;
}

describe("sales-brief replayable typed provenance", () => {
  it("accepts the exact deterministic recommendation and ordered rule projection", async () => {
    const brief = await buildBrief();
    expect(salesBriefMatchesDeterministicRules(brief)).toBe(true);
  });

  it("rejects a coordinated comparable-to-incomparable score drift", async () => {
    const brief = await buildBrief();
    const metric = brief.provenance.marketComparison.metrics[0]!;
    metric.comparisonStatus = "incomparable";
    metric.issues = ["UNIT_MISMATCH"];
    replaceComponentScore(brief, "marketPotential", null, [
      { code: "MARKET_DATA_UNAVAILABLE" },
    ]);
    brief.opportunities = brief.opportunities.filter(
      ({ ruleCode }) => ruleCode !== "MARKET_POTENTIAL_AT_LEAST_50",
    );

    expect(salesBriefMatchesDeterministicRules(brief)).toBe(false);
  });

  it("rejects a coordinated ready-to-not-ready score drift", async () => {
    const brief = await buildBrief();
    const evaluation = readyEvaluation(brief);
    if (!evaluation.product) throw new Error("Expected a ready Demo product.");
    const productId = evaluation.product.id;
    evaluation.commercialReadiness = "not_ready";
    replaceComponentScore(
      brief,
      "productReadiness",
      calculateProductReadiness(
        targetEvaluations(brief).map(
          ({ commercialReadiness }) => commercialReadiness,
        ),
      ),
    );
    brief.recommendedProducts = brief.recommendedProducts.filter(
      ({ id }) => id !== productId,
    );
    brief.opportunities = brief.opportunities.filter(
      ({ ruleCode }) => ruleCode !== "READY_PRODUCTS_AVAILABLE",
    );
    brief.salesActions = brief.salesActions.filter(
      ({ ruleCode }) => ruleCode !== "PREPARE_PRODUCT_EVIDENCE_PACK",
    );

    expect(salesBriefMatchesDeterministicRules(brief)).toBe(false);
  });

  it("rejects a coordinated certification-pass-to-fail score drift", async () => {
    const brief = await buildBrief();
    const evaluation = readyEvaluation(brief);
    const check = evaluation.regulationChecks.find(
      ({ certifications }) => certifications.length > 0,
    );
    if (!check) throw new Error("Expected Demo certification evidence.");
    check.status = "fail";
    check.code = "CERTIFICATION_INACTIVE";
    check.message = "forged coordinated failure";
    check.certifications[0]!.status = "fail";
    replaceComponentScore(
      brief,
      "regulatoryCoverage",
      calculateRegulatoryCoverage(
        targetEvaluations(brief).flatMap(({ regulationChecks }) =>
          regulationChecks.map(({ regulation, status }) => ({
            regulationId: regulation.regulationId,
            status,
          })),
        ),
      ),
    );

    expect(salesBriefMatchesDeterministicRules(brief)).toBe(false);
  });

  const mutationCases: Array<{
    mutate: (brief: SalesBrief) => void;
    name: string;
  }> = [
    {
      name: "wrong source type",
      mutate: (brief) => {
        brief.sources[0]!.entityType = "country";
      },
    },
    {
      name: "missing source",
      mutate: (brief) => {
        brief.sources = brief.sources.slice(1);
      },
    },
    {
      name: "unknown recommendation product",
      mutate: (brief) => {
        brief.recommendedProducts[0]!.id =
          "00000000-0000-4000-8000-000000009901";
      },
    },
    {
      name: "partial certification set",
      mutate: (brief) => {
        brief.recommendedProducts[0]!.certifications = [];
      },
    },
    {
      name: "cross-product certification swap",
      mutate: (brief) => {
        const evaluation = readyEvaluation(brief);
        if (!evaluation.product) {
          throw new Error("Expected a ready Demo product.");
        }
        const evaluatedProductId = evaluation.product.id;
        const other = targetEvaluations(brief).find(
          ({ product }) =>
            product !== null && product.id !== evaluatedProductId,
        );
        const certification =
          evaluation.regulationChecks[0]!.certifications[0]!.certification;
        if (!other?.product) throw new Error("Expected a second Demo product.");
        certification.productId = other.product.id;
        certification.productModelCode = other.product.modelCode;
      },
    },
    {
      name: "cross-product certification source descriptor",
      mutate: (brief) => {
        const source = brief.sources.find(
          ({ entityType }) => entityType === "product_certification",
        );
        if (!source) throw new Error("Expected a certification source.");
        source.productId = "00000000-0000-4000-8000-000000009904";
        source.productModelCode = "OTHER-MODEL";
      },
    },
    {
      name: "forged product title descriptor",
      mutate: (brief) => {
        const source = brief.sources.find(
          ({ entityType }) => entityType === "product",
        );
        if (!source) throw new Error("Expected a product source.");
        source.titleDescriptor = {
          kind: "product_certification_record",
          productModelCode: "DEMO-ENG-100",
        };
      },
    },
    {
      name: "forged certification locator descriptor",
      mutate: (brief) => {
        const source = brief.sources.find(
          ({ entityType }) => entityType === "product_certification",
        );
        if (!source) throw new Error("Expected a certification source.");
        source.locatorDescriptor = {
          kind: "membership_period",
          validFrom: "2025-01-01",
          validTo: null,
        };
      },
    },
    {
      name: "coordinated market metric descriptor reassignment",
      mutate: (brief) => {
        const observation =
          brief.provenance.marketComparison.metrics[0]?.observations[0];
        if (!observation) throw new Error("Expected a market observation.");
        const descriptor = {
          isDemo: observation.isDemo,
          kind: "market_metric" as const,
          metricCode: "OTHER_METRIC",
          metricId: observation.id,
          metricName: observation.metricName,
        };
        observation.source.titleDescriptor = descriptor;
        for (const source of [
          ...brief.provenance.marketComparison.sources,
          ...brief.sources,
        ]) {
          if (
            source.entityType === "market_metric" &&
            source.entityId === observation.id
          ) {
            source.titleDescriptor = descriptor;
          }
        }
      },
    },
    {
      name: "orphan evaluation source",
      mutate: (brief) => {
        const evaluation = readyEvaluation(brief);
        evaluation.sources.push({
          ...evaluation.sources[0]!,
          id: "00000000-0000-4000-8000-000000009902",
        });
      },
    },
    {
      name: "duplicate comparison source",
      mutate: (brief) => {
        brief.provenance.marketComparison.sources.push(
          structuredClone(brief.provenance.marketComparison.sources[0]!),
        );
      },
    },
    {
      name: "deleted future-regulation risk",
      mutate: (brief) => {
        brief.risks = brief.risks.filter(
          ({ ruleCode }) => ruleCode !== "FUTURE_ADOPTED_REGULATION",
        );
      },
    },
    {
      name: "forged future-regulation risk",
      mutate: (brief) => {
        const risk = brief.risks.find(
          ({ ruleCode }) => ruleCode === "FUTURE_ADOPTED_REGULATION",
        );
        if (!risk || risk.ruleCode !== "FUTURE_ADOPTED_REGULATION") {
          throw new Error("Expected a future-regulation risk.");
        }
        risk.regulationIds = [
          "00000000-0000-4000-8000-000000009903",
        ];
      },
    },
    {
      name: "reordered score components",
      mutate: (brief) => {
        brief.marketScore.components.reverse();
      },
    },
    {
      name: "reordered product evaluations",
      mutate: (brief) => {
        targetEvaluations(brief).reverse();
      },
    },
  ];

  it.each(mutationCases)("rejects $name", async ({ mutate }) => {
    const brief = structuredClone(await buildBrief());
    mutate(brief);
    expect(salesBriefMatchesDeterministicRules(brief)).toBe(false);
  });

  it("rejects removed narrative fields instead of exposing arbitrary prose", async () => {
    const brief = await buildBrief();
    expect(
      salesBriefSchema.safeParse({
        ...brief,
        executiveSummary: "forged model-visible narrative",
      }).success,
    ).toBe(false);
  });
});
