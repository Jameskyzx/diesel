import { describe, expect, it } from "vitest";

import { evaluateProductFit } from "@/domain/product-fit/evaluate-product-fit";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import type { ProductFitQuery } from "@/features/database/schemas";
import {
  productSummarySchema,
  type CertificationEvidence,
  type ProductFitReasonCode,
  type ProductSummary,
  type RegulationEvidence,
} from "@/features/product-fit/schemas";
import { buildCompatibleProductsResult } from "@/server/ai/tool-results";

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
  availableTo: "2026-12-31",
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
  productId: product.id,
  productModelCode: product.modelCode,
  regulationId: regulation.regulationId,
  source: certificationSource,
  status: "active",
  validFrom: "2025-01-01",
  validTo: "2027-01-01",
  verifiedAt,
};

const failedCertificationReasonCases = [
  {
    certification: {
      ...certification,
      applicationScope: "construction",
      status: "unknown",
    },
    failureCode: "CERTIFICATION_SCOPE_MISMATCH",
    name: "unknown status before a scope mismatch",
    unknownCode: "CERTIFICATION_STATUS_UNKNOWN",
  },
  {
    certification: {
      ...certification,
      powerMaxKw: query.powerKw,
      powerMinKw: null,
    },
    failureCode: "CERTIFICATION_POWER_OUT_OF_RANGE",
    name: "unknown lower power bound at the excluded upper boundary",
    unknownCode: "CERTIFICATION_POWER_RANGE_UNKNOWN",
  },
  {
    certification: {
      ...certification,
      validFrom: null,
      validTo: query.asOf,
    },
    failureCode: "CERTIFICATION_EXPIRED",
    name: "unknown validity start at the excluded end date",
    unknownCode: "CERTIFICATION_VALIDITY_UNKNOWN",
  },
] satisfies Array<{
  certification: CertificationEvidence;
  failureCode: ProductFitReasonCode;
  name: string;
  unknownCode: ProductFitReasonCode;
}>;

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
    expect(result.commercialReadiness).toBe("ready");
    expect(result.productChecks.availability).toMatchObject({
      code: "PRODUCT_AVAILABLE",
      status: "pass",
    });
    expect(result.productChecks.power.status).toBe("pass");
    expect(result.product).toMatchObject({
      availableFrom: "2025-01-01",
      availableTo: "2026-12-31",
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

  it("uses a half-open product availability period", () => {
    const lowerBoundary = evaluateProductFit({
      applicableRegulations: [regulation],
      certifications: [certification],
      product,
      query: { ...query, asOf: product.availableFrom! },
    });
    const upperBoundary = evaluateProductFit({
      applicableRegulations: [regulation],
      certifications: [certification],
      product,
      query: { ...query, asOf: product.availableTo! },
    });

    expect(lowerBoundary.productChecks.availability).toMatchObject({
      code: "PRODUCT_AVAILABLE",
      status: "pass",
    });
    expect(lowerBoundary.commercialReadiness).toBe("ready");
    expect(upperBoundary.status).toBe("fit");
    expect(upperBoundary.productChecks.availability).toMatchObject({
      code: "PRODUCT_NO_LONGER_AVAILABLE",
      status: "fail",
    });
    expect(upperBoundary.commercialReadiness).toBe("not_ready");
  });

  it("separates not-yet-available products from compliance fit", () => {
    const result = evaluateProductFit({
      applicableRegulations: [regulation],
      certifications: [certification],
      product: { ...product, availableFrom: "2026-09-01" },
      query,
    });

    expect(result.status).toBe("fit");
    expect(result.productChecks.availability).toMatchObject({
      code: "PRODUCT_NOT_YET_AVAILABLE",
      status: "fail",
    });
    expect(result.commercialReadiness).toBe("not_ready");
  });

  it.each([
    { availableFrom: null, availableTo: null },
    { availableFrom: "2025-01-01", availableTo: null },
  ])("keeps incomplete availability evidence unknown", (availability) => {
    const result = evaluateProductFit({
      applicableRegulations: [regulation],
      certifications: [certification],
      product: { ...product, ...availability },
      query,
    });

    expect(result.status).toBe("fit");
    expect(result.productChecks.availability).toMatchObject({
      code: "PRODUCT_AVAILABILITY_UNKNOWN",
      status: "unknown",
    });
    expect(result.commercialReadiness).toBe("unknown");
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

  it.each(failedCertificationReasonCases)(
    "summarizes the explicit failure for $name",
    ({ certification: record, failureCode, unknownCode }) => {
      const result = evaluate(query, [record]);

      expect(result.status).toBe("not_fit");
      expect(result.commercialReadiness).toBe("not_ready");
      expect(result.productChecks.power.status).toBe("pass");
      expect(result.productChecks.availability.status).toBe("pass");
      expect(result.reasons).toEqual([
        expect.objectContaining({ code: failureCode, status: "fail" }),
      ]);
      expect(result.regulationChecks[0]).toMatchObject({
        code: failureCode,
        regulation,
        status: "fail",
      });
      expect(result.regulationChecks[0]?.certifications[0]).toMatchObject({
        certification: record,
        reasons: [
          { code: unknownCode, status: "unknown" },
          { code: failureCode, status: "fail" },
        ],
        status: "fail",
      });
      expect(result.product).toEqual(product);
      expect(result.sources).toEqual(evaluate(query).sources);
      expect(result.rulesetVersion).toBe("product-fit-v2");
    },
  );

  it.each(failedCertificationReasonCases)(
    "accepts the deterministic AI/client result for $name",
    ({ certification: record }) => {
      const result = buildCompatibleProductsResult({
        ...query,
        evaluations: [evaluate(query, [record])],
      });

      expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
    },
  );

  it.each([false, true])(
    "selects the first failing reason in certification order (reversed: %s)",
    (reverse) => {
      const records: CertificationEvidence[] = [
        {
          ...certification,
          applicationScope: "construction",
          powerMaxKw: query.powerKw,
          status: "unknown",
        },
        {
          ...certification,
          id: "00000000-0000-4000-8000-000000000402",
          status: "withdrawn",
        },
      ];
      if (reverse) records.reverse();
      const result = evaluate(query, records);
      const failureCode = reverse
        ? "CERTIFICATION_INACTIVE"
        : "CERTIFICATION_SCOPE_MISMATCH";

      expect(result.reasons[0]).toMatchObject({
        code: failureCode,
        status: "fail",
      });
      expect(result.regulationChecks[0]).toMatchObject({
        code: failureCode,
        status: "fail",
      });
      expect(
        result.regulationChecks[0]?.certifications.map((item) => ({
          certification: item.certification,
          status: item.status,
        })),
      ).toEqual(
        records.map((record) => ({ certification: record, status: "fail" })),
      );
    },
  );

  it.each([false, true])(
    "takes unknown evidence from the viable certification (reversed: %s)",
    (reverse) => {
      const failedRecord: CertificationEvidence = {
        ...certification,
        applicationScope: "construction",
        status: "unknown",
      };
      const unknownRecord: CertificationEvidence = {
        ...certification,
        id: "00000000-0000-4000-8000-000000000402",
        powerMinKw: null,
      };
      const records = reverse
        ? [unknownRecord, failedRecord]
        : [failedRecord, unknownRecord];
      const result = evaluate(query, records);
      const checks = result.regulationChecks[0]?.certifications;

      expect(result.status).toBe("unknown");
      expect(result.commercialReadiness).toBe("unknown");
      expect(checks?.map((item) => item.certification)).toEqual(records);
      expect(
        checks?.find((item) => item.certification.id === failedRecord.id),
      ).toMatchObject({
        certification: failedRecord,
        reasons: [
          { code: "CERTIFICATION_STATUS_UNKNOWN", status: "unknown" },
          { code: "CERTIFICATION_SCOPE_MISMATCH", status: "fail" },
        ],
        status: "fail",
      });
      expect(
        checks?.find((item) => item.certification.id === unknownRecord.id),
      ).toMatchObject({
        certification: unknownRecord,
        reasons: [
          { code: "CERTIFICATION_POWER_RANGE_UNKNOWN", status: "unknown" },
        ],
        status: "unknown",
      });
      expect(result.regulationChecks[0]).toMatchObject({
        code: "CERTIFICATION_POWER_RANGE_UNKNOWN",
        status: "unknown",
      });
      expect(result.reasons[0]).toMatchObject({
        code: "CERTIFICATION_POWER_RANGE_UNKNOWN",
        status: "unknown",
      });
    },
  );

  it("keeps all-unknown certification evidence unknown and client-valid", () => {
    const record: CertificationEvidence = {
      ...certification,
      powerMaxKw: null,
      powerMinKw: null,
      status: "unknown",
      validFrom: null,
      validTo: null,
    };
    const result = evaluate(query, [record]);

    expect(result.status).toBe("unknown");
    expect(result.commercialReadiness).toBe("unknown");
    expect(result.reasons[0]).toMatchObject({
      code: "CERTIFICATION_STATUS_UNKNOWN",
      status: "unknown",
    });
    expect(result.regulationChecks[0]).toMatchObject({
      code: "CERTIFICATION_STATUS_UNKNOWN",
      status: "unknown",
    });
    expect(result.regulationChecks[0]?.certifications[0]).toMatchObject({
      certification: record,
      reasons: [
        { code: "CERTIFICATION_STATUS_UNKNOWN", status: "unknown" },
        { code: "CERTIFICATION_POWER_RANGE_UNKNOWN", status: "unknown" },
        { code: "CERTIFICATION_VALIDITY_UNKNOWN", status: "unknown" },
      ],
      status: "unknown",
    });
    expect(
      clientAiToolResultSchema.safeParse(
        buildCompatibleProductsResult({
          ...query,
          evaluations: [result],
        }),
      ).success,
    ).toBe(true);
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
