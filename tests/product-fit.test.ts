import { describe, expect, it } from "vitest";

import { evaluateProductFit } from "@/domain/product-fit/evaluate-product-fit";
import type { ProductFitQuery } from "@/features/database/schemas";
import {
  productSummarySchema,
  type CertificationEvidence,
  type ProductSummary,
  type RegulationEvidence,
} from "@/features/product-fit/schemas";

const verifiedAt = "2026-01-15T00:00:00.000Z";
const productSource = {
  id: "00000000-0000-4000-8000-000000000003",
  isDemo: true,
  publishedOn: null,
  title: "DEMO ONLY — Product source",
  url: "https://example.invalid/demo/products",
  verifiedAt,
} as const;
const regulationSource = {
  id: "00000000-0000-4000-8000-000000000002",
  isDemo: true,
  publishedOn: null,
  title: "DEMO ONLY — Regulation source",
  url: "https://example.invalid/demo/regulations",
  verifiedAt,
} as const;
const regulationLimitSource = {
  id: "00000000-0000-4000-8000-000000000006",
  isDemo: true,
  publishedOn: null,
  title: "DEMO ONLY — Regulation limit source",
  url: "https://example.invalid/demo/limits",
  verifiedAt,
} as const;
const certificationSource = {
  id: "00000000-0000-4000-8000-000000000005",
  isDemo: true,
  publishedOn: null,
  title: "DEMO ONLY — Certification source",
  url: "https://example.invalid/demo/certifications",
  verifiedAt,
} as const;
const jurisdictionSource = {
  id: "00000000-0000-4000-8000-000000000007",
  isDemo: true,
  publishedOn: null,
  title: "DEMO ONLY — Jurisdiction source",
  url: "https://example.invalid/demo/jurisdictions",
  verifiedAt,
} as const;
const membershipSource = {
  id: "00000000-0000-4000-8000-000000000008",
  isDemo: true,
  publishedOn: null,
  title: "DEMO ONLY — Membership source",
  url: "https://example.invalid/demo/memberships",
  verifiedAt,
} as const;

const query: ProductFitQuery = {
  applicationScope: "non-road",
  asOf: "2026-07-29",
  countryIso3: "CHN",
  powerKw: 100,
  productModelCode: "DEMO-ENG-100",
};

const product: ProductSummary = {
  applicationScopes: ["non-road", "construction"],
  availableFrom: "2025-01-01",
  availableTo: null,
  id: "00000000-0000-4000-8000-000000000201",
  isDemo: true,
  modelCode: "DEMO-ENG-100",
  name: "DEMO ONLY — Engine",
  powerMaxKw: 150,
  powerMinKw: 50,
  source: productSource,
  specificationVersion: "demo-v1",
  verifiedAt,
};

const regulation: RegulationEvidence = {
  applicability: {
    countryIso3: "CHN",
    jurisdiction: {
      code: "DEMO-JUR",
      id: "00000000-0000-4000-8000-000000000009",
      isDemo: true,
      name: "DEMO ONLY — Jurisdiction",
      source: jurisdictionSource,
      verifiedAt,
    },
    membership: {
      isDemo: true,
      source: membershipSource,
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
  limitSources: [regulationLimitSource],
  recordStatus: "effective",
  regulationId: "00000000-0000-4000-8000-000000000301",
  source: regulationSource,
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
  regulationId: regulation.regulationId,
  source: certificationSource,
  status: "active",
  validFrom: "2025-01-01",
  validTo: "2027-01-01",
  verifiedAt,
};

function evaluate(
  input: ProductFitQuery,
  certificateRecords: CertificationEvidence[] = [certification],
) {
  return evaluateProductFit({
    applicableRegulations: [regulation],
    certifications: certificateRecords,
    product,
    query: input,
  });
}

describe("deterministic product-fit rules", () => {
  it("rejects invalid product power and availability intervals at the public DTO boundary", () => {
    expect(
      productSummarySchema.safeParse({
        ...product,
        powerMaxKw: product.powerMinKw,
      }).success,
    ).toBe(false);
    expect(
      productSummarySchema.safeParse({
        ...product,
        availableFrom: null,
        availableTo: "2026-01-01",
      }).success,
    ).toBe(false);
  });

  it("includes the lower power boundary and returns traceable fit evidence", () => {
    const result = evaluate({ ...query, powerKw: 50 });

    expect(result.status).toBe("fit");
    expect(result.productChecks.power.status).toBe("pass");
    expect(result.product).toMatchObject({
      availableFrom: "2025-01-01",
      availableTo: null,
    });
    expect(result.regulationChecks[0]).toMatchObject({
      regulation: { regulationId: regulation.regulationId },
      status: "pass",
    });
    expect(
      result.regulationChecks[0]?.certifications[0]?.certification.id,
    ).toBe(certification.id);
    expect(result.sources).toContainEqual(regulationLimitSource);
    expect(result.sources).toContainEqual(jurisdictionSource);
    expect(result.sources).toContainEqual(membershipSource);
  });

  it("excludes the upper product power boundary", () => {
    const result = evaluate({ ...query, powerKw: 150 });

    expect(result.status).toBe("not_fit");
    expect(result.productChecks.power).toMatchObject({
      code: "PRODUCT_POWER_OUT_OF_RANGE",
      status: "fail",
    });
  });

  it("includes the certification valid-from date", () => {
    const result = evaluate({
      ...query,
      asOf: certification.validFrom ?? query.asOf,
    });

    expect(result.status).toBe("fit");
  });

  it("excludes the certification valid-to date", () => {
    const validTo = certification.validTo ?? query.asOf;
    const result = evaluate(
      { ...query, asOf: validTo },
      [{ ...certification, validTo }],
    );

    expect(result.status).toBe("not_fit");
    expect(
      result.regulationChecks[0]?.certifications[0]?.reasons,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CERTIFICATION_EXPIRED",
          status: "fail",
        }),
      ]),
    );
  });

  it("keeps an unknown certification validity start unknown", () => {
    const result = evaluate(query, [
      { ...certification, validFrom: null, validTo: null },
    ]);

    expect(result.status).toBe("unknown");
    expect(result.reasons[0]).toMatchObject({
      code: "CERTIFICATION_VALIDITY_UNKNOWN",
      status: "unknown",
    });
    expect(result.regulationChecks[0]).toMatchObject({
      code: "CERTIFICATION_VALIDITY_UNKNOWN",
      status: "unknown",
    });
    expect(result.regulationChecks[0]?.certifications[0]?.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CERTIFICATION_VALIDITY_UNKNOWN",
          status: "unknown",
        }),
      ]),
    );
  });

  it("keeps an unknown certification power lower bound unknown", () => {
    const result = evaluate(query, [
      { ...certification, powerMinKw: null, powerMaxKw: null },
    ]);

    expect(result.status).toBe("unknown");
    expect(result.reasons[0]).toMatchObject({
      code: "CERTIFICATION_POWER_RANGE_UNKNOWN",
      status: "unknown",
    });
    expect(result.regulationChecks[0]?.certifications[0]?.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CERTIFICATION_POWER_RANGE_UNKNOWN",
          status: "unknown",
        }),
      ]),
    );
  });

  it("keeps a known certification lower bound with no maximum open-ended", () => {
    const result = evaluateProductFit({
      applicableRegulations: [regulation],
      certifications: [{ ...certification, powerMaxKw: null }],
      product: { ...product, powerMaxKw: 2_000 },
      query: { ...query, powerKw: 1_000 },
    });

    expect(result.status).toBe("fit");
  });

  it("keeps an explicit certification upper-bound mismatch not-fit", () => {
    const result = evaluate(
      { ...query, powerKw: 149 },
      [{ ...certification, powerMinKw: null, powerMaxKw: 149 }],
    );

    expect(result.status).toBe("not_fit");
    expect(result.productChecks.power.status).toBe("pass");
    expect(result.regulationChecks[0]?.certifications[0]).toMatchObject({
      status: "fail",
    });
  });

  it("treats a known validity start with no end as open-ended", () => {
    const result = evaluate(query, [{ ...certification, validTo: null }]);

    expect(result.status).toBe("fit");
  });

  it("keeps a missing certification unknown instead of guessing", () => {
    const result = evaluate(query, []);

    expect(result.status).toBe("unknown");
    expect(result.reasons[0]).toMatchObject({
      code: "CERTIFICATION_MISSING",
      status: "unknown",
    });
    expect(result.regulationChecks[0]?.regulation.regulationId).toBe(
      regulation.regulationId,
    );
  });

  it("keeps an unknown certification status unknown", () => {
    const result = evaluate(query, [
      { ...certification, status: "unknown" },
    ]);

    expect(result.status).toBe("unknown");
    expect(result.regulationChecks[0]).toMatchObject({
      code: "CERTIFICATION_STATUS_UNKNOWN",
      status: "unknown",
    });
    expect(result.regulationChecks[0]?.certifications[0]).toMatchObject({
      status: "unknown",
    });
  });

  it("keeps an explicit scope mismatch not-fit even when status is unknown", () => {
    const result = evaluate(query, [
      {
        ...certification,
        applicationScope: "construction",
        status: "unknown",
      },
    ]);

    expect(result.status).toBe("not_fit");
    expect(result.regulationChecks[0]?.certifications[0]).toMatchObject({
      status: "fail",
    });
  });

  it("preserves Demo classification when one source supports mixed facts", () => {
    const sharedSource = { ...regulationSource, isDemo: false };
    const result = evaluateProductFit({
      applicableRegulations: [
        {
          ...regulation,
          applicability: {
            ...regulation.applicability,
            jurisdiction: {
              ...regulation.applicability.jurisdiction,
              isDemo: true,
              source: sharedSource,
            },
          },
          isDemo: false,
          source: sharedSource,
        },
      ],
      certifications: [certification],
      product,
      query,
    });

    expect(
      result.sources.find(({ id }) => id === sharedSource.id),
    ).toMatchObject({ isDemo: true });
  });
});
