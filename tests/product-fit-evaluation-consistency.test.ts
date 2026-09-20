import { describe, expect, it } from "vitest";

import { productFitEvaluationMatchesDeterministicRules } from "@/domain/product-fit/evaluation-consistency";
import { evaluateProductFit } from "@/domain/product-fit/evaluate-product-fit";
import type { ProductFitQuery } from "@/features/database/schemas";
import type {
  CertificationEvidence,
  ProductFitEvaluation,
  ProductSummary,
  RegulationEvidence,
} from "@/features/product-fit/schemas";

const verifiedAt = "2026-01-15T00:00:00.000Z";

function source(id: string, title: string) {
  return {
    id,
    isDemo: true,
    publishedOn: null,
    title,
    url: "https://example.invalid/demo-evidence",
    verifiedAt,
  };
}

const product: ProductSummary = {
  applicationScopes: ["non-road"],
  availableFrom: "2025-01-01",
  availableTo: "2027-01-01",
  id: "00000000-0000-4000-8000-000000000201",
  isDemo: true,
  modelCode: "DEMO-ENG-100",
  name: "DEMO ONLY — Engine",
  powerMaxKw: 150,
  powerMinKw: 50,
  source: source(
    "00000000-0000-4000-8000-000000000202",
    "DEMO ONLY — Product source",
  ),
  specificationVersion: "demo-v1",
  verifiedAt,
};

const regulation: RegulationEvidence = {
  applicability: {
    countryIso3: "CHN",
    jurisdiction: {
      code: "DEMO-JUR",
      id: "00000000-0000-4000-8000-000000000301",
      isDemo: true,
      name: "DEMO ONLY — Jurisdiction",
      source: source(
        "00000000-0000-4000-8000-000000000302",
        "DEMO ONLY — Jurisdiction source",
      ),
      verifiedAt,
    },
    membership: {
      isDemo: true,
      source: source(
        "00000000-0000-4000-8000-000000000303",
        "DEMO ONLY — Membership source",
      ),
      validFrom: "2020-01-01",
      validTo: null,
      verifiedAt,
    },
  },
  canonicalName: "DEMO ONLY — Effective regulation",
  citationCode: "DEMO-REG",
  effectiveFrom: "2025-01-01",
  effectiveTo: null,
  isDemo: true,
  limitSources: [
    source(
      "00000000-0000-4000-8000-000000000304",
      "DEMO ONLY — Limit source",
    ),
  ],
  recordStatus: "effective",
  regulationId: "00000000-0000-4000-8000-000000000305",
  source: source(
    "00000000-0000-4000-8000-000000000306",
    "DEMO ONLY — Regulation source",
  ),
  status: "effective",
  verifiedAt,
};

const certification: CertificationEvidence = {
  applicationScope: "non-road",
  certificateNumber: "DEMO-CERT-100",
  id: "00000000-0000-4000-8000-000000000401",
  isDemo: true,
  powerMaxKw: 150,
  powerMinKw: 50,
  productId: product.id,
  productModelCode: product.modelCode,
  regulationId: regulation.regulationId,
  source: source(
    "00000000-0000-4000-8000-000000000402",
    "DEMO ONLY — Certification source",
  ),
  status: "active",
  validFrom: "2025-01-01",
  validTo: null,
  verifiedAt,
};

const query: ProductFitQuery = {
  applicationScope: "non-road",
  asOf: "2026-06-01",
  countryIso3: "CHN",
  powerKw: 100,
  productModelCode: "DEMO-ENG-100",
};

function buildEvaluation(
  overrides: {
    certifications?: CertificationEvidence[];
    product?: ProductSummary | null;
    query?: ProductFitQuery;
    regulations?: RegulationEvidence[];
  } = {},
): ProductFitEvaluation {
  return evaluateProductFit({
    applicableRegulations: overrides.regulations ?? [regulation],
    certifications: overrides.certifications ?? [certification],
    product: overrides.product === undefined ? product : overrides.product,
    query: overrides.query ?? query,
  });
}

describe("product-fit evaluation deterministic consistency", () => {
  it("accepts canonical fit, half-open boundaries and outside-supply fit", () => {
    const lowerPowerBoundary = buildEvaluation({
      query: { ...query, powerKw: product.powerMinKw },
    });
    const upperPowerBoundary = buildEvaluation({
      query: { ...query, powerKw: product.powerMaxKw },
    });
    const outsideSupply = buildEvaluation({
      query: { ...query, asOf: product.availableTo ?? query.asOf },
    });
    const historicalEffective = buildEvaluation({
      regulations: [
        {
          ...regulation,
          effectiveTo: "2027-01-01",
          recordStatus: "superseded",
        },
      ],
    });

    expect(lowerPowerBoundary).toMatchObject({
      commercialReadiness: "ready",
      status: "fit",
    });
    expect(upperPowerBoundary).toMatchObject({
      commercialReadiness: "not_ready",
      status: "not_fit",
    });
    expect(outsideSupply).toMatchObject({
      commercialReadiness: "not_ready",
      status: "fit",
    });
    expect(historicalEffective).toMatchObject({ status: "fit" });
    expect(
      [
        lowerPowerBoundary,
        upperPowerBoundary,
        outsideSupply,
        historicalEffective,
      ].every(productFitEvaluationMatchesDeterministicRules),
    ).toBe(true);
  });

  it("treats a consistently renamed visible raw source as input", () => {
    const renamed = structuredClone(buildEvaluation());
    if (!renamed.product) {
      throw new Error("Expected a product fixture.");
    }
    renamed.product.name = "DEMO ONLY — Renamed visible product";
    renamed.product.source.title = "DEMO ONLY — Renamed visible source";
    renamed.sources = renamed.sources.map((visibleSource) =>
      visibleSource.id === renamed.product?.source.id
        ? { ...visibleSource, title: "DEMO ONLY — Renamed visible source" }
        : visibleSource,
    );

    expect(productFitEvaluationMatchesDeterministicRules(renamed)).toBe(true);
  });

  const driftCases: Array<{
    mutate: (evaluation: ProductFitEvaluation) => void;
    name: string;
  }> = [
    {
      mutate: (evaluation) => {
        evaluation.sources.push(
          source(
            "00000000-0000-4000-8000-000000000999",
            "DEMO ONLY — Orphan source",
          ),
        );
      },
      name: "orphan evaluation source",
    },
    {
      mutate: (evaluation) => {
        evaluation.status = "unknown";
      },
      name: "overall fit status",
    },
    {
      mutate: (evaluation) => {
        evaluation.commercialReadiness = "not_ready";
      },
      name: "commercial readiness",
    },
    {
      mutate: (evaluation) => {
        evaluation.asOf = "2026-06-02";
      },
      name: "top-level as-of date",
    },
    {
      mutate: (evaluation) => {
        Reflect.set(evaluation, "rulesetVersion", "product-fit-v999");
      },
      name: "ruleset version",
    },
    {
      mutate: (evaluation) => {
        evaluation.productChecks.applicationScope.status = "fail";
      },
      name: "application-scope check status",
    },
    {
      mutate: (evaluation) => {
        evaluation.productChecks.power.code =
          "PRODUCT_POWER_OUT_OF_RANGE";
      },
      name: "power check code",
    },
    {
      mutate: (evaluation) => {
        evaluation.productChecks.availability.message = "forged message";
      },
      name: "availability check message",
    },
    {
      mutate: (evaluation) => {
        evaluation.reasons[0]!.message = "forged summary";
      },
      name: "summary reason message",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks[0]!.status = "unknown";
      },
      name: "regulation check status",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks[0]!.code = "CERTIFICATION_MISSING";
      },
      name: "regulation check code",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks[0]!.message = "forged regulation result";
      },
      name: "regulation check message",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks[0]!.certifications[0]!.status = "fail";
      },
      name: "certification check status",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks[0]!.certifications[0]!.reasons[0]!.code =
          "CERTIFICATION_INACTIVE";
      },
      name: "certification reason code",
    },
    {
      mutate: (evaluation) => {
        if (!evaluation.product) {
          throw new Error("Expected a product fixture.");
        }
        evaluation.product.powerMinKw = 110;
      },
      name: "visible product fact without recomputed checks",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks[0]!.certifications[0]!.certification.status =
          "expired";
      },
      name: "visible certification fact without recomputed checks",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks[0]!.regulation.applicability.countryIso3 =
          "BRA";
      },
      name: "regulation applicability country",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks[0]!.regulation.applicability.membership.validFrom =
          "2027-01-01";
      },
      name: "membership not yet valid",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks[0]!.regulation.applicability.membership.validTo =
          evaluation.input.asOf;
      },
      name: "membership excluded upper boundary",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks[0]!.regulation.effectiveFrom =
          "2027-01-01";
      },
      name: "regulation not yet effective",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks[0]!.regulation.effectiveTo =
          evaluation.input.asOf;
      },
      name: "regulation excluded effective upper boundary",
    },
    {
      mutate: (evaluation) => {
        evaluation.input.powerKw = 151;
      },
      name: "input without recomputed checks",
    },
    {
      mutate: (evaluation) => {
        evaluation.regulationChecks.push(
          structuredClone(evaluation.regulationChecks[0]!),
        );
      },
      name: "duplicate regulation id",
    },
    {
      mutate: (evaluation) => {
        const certificationCheck =
          evaluation.regulationChecks[0]!.certifications[0]!;
        evaluation.regulationChecks[0]!.certifications.push(
          structuredClone(certificationCheck),
        );
      },
      name: "duplicate certification id",
    },
  ];

  it.each(driftCases)("rejects $name drift", ({ mutate }) => {
    const drifted = structuredClone(buildEvaluation());
    mutate(drifted);

    expect(productFitEvaluationMatchesDeterministicRules(drifted)).toBe(false);
  });
});
