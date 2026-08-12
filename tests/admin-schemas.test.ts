import { describe, expect, it } from "vitest";

import {
  countryDraftPayloadSchema,
  dataSourceDraftPayloadSchema,
  governedEntityReferenceSchema,
  jurisdictionDraftPayloadSchema,
  marketMetricDraftPayloadSchema,
  productCertificationDraftPayloadSchema,
  productDraftPayloadSchema,
  regulationDraftPayloadSchema,
  sourceVerificationInputSchema,
} from "@/features/admin/schemas";

const productPayload = {
  applicationScopes: ["on-road-truck"],
  availableFrom: "2026-01-01",
  availableTo: "2027-01-01",
  dataSourceId: "00000000-0000-4000-8000-000000000001",
  description: null,
  id: "00000000-0000-4000-8000-000000000101",
  isDemo: false,
  modelCode: "WP-DEMO",
  name: "Schema test product",
  parameters: {},
  powerMaxKw: 300,
  powerMinKw: 200,
  specificationVersion: "2026-01",
  verifiedAt: "2026-08-05T13:00:00.000Z",
} as const;

const certificationPayload = {
  applicationScope: "on-road-truck",
  certificateNumber: "SCHEMA-TEST",
  dataSourceId: "00000000-0000-4000-8000-000000000001",
  id: "00000000-0000-4000-8000-000000000201",
  isDemo: false,
  powerMaxKw: 300,
  powerMinKw: 200,
  productId: "00000000-0000-4000-8000-000000000101",
  regulationId: "00000000-0000-4000-8000-000000000301",
  status: "active",
  validFrom: "2026-01-01",
  validTo: "2027-01-01",
  verifiedAt: "2026-08-05T13:00:00.000Z",
} as const;

const regulationPayload = {
  adoptedOn: "2026-01-01",
  canonicalName: "Schema test regulation",
  citationCode: "SCHEMA-REG",
  dataSourceId: "00000000-0000-4000-8000-000000000001",
  effectiveFrom: "2027-01-01",
  effectiveTo: "2028-01-01",
  id: "00000000-0000-4000-8000-000000000301",
  isDemo: false,
  jurisdictionId: "00000000-0000-4000-8000-000000000401",
  limits: [
    {
      applicationScope: "on-road-truck",
      dataSourceId: "00000000-0000-4000-8000-000000000001",
      engineTypeCode: "CI",
      id: "00000000-0000-4000-8000-000000000501",
      isDemo: false,
      limitValue: 1,
      measurementBasis: null,
      pollutantCode: "NOX",
      powerMaxKw: 300,
      powerMinKw: 200,
      testCycleCode: "TEST",
      unitCode: "g/kWh",
      validFrom: "2027-01-01",
      validTo: null,
      verifiedAt: "2026-08-05T13:00:00.000Z",
    },
  ],
  proposedOn: "2025-01-01",
  status: "adopted",
  summary: null,
  verifiedAt: "2026-08-05T13:00:00.000Z",
} as const;

const marketMetricPayload = {
  applicationScope: null,
  countryIso3: "CHN",
  currencyCode: "USD",
  dataSourceId: "00000000-0000-4000-8000-000000000001",
  definition: "Schema test market metric.",
  id: "00000000-0000-4000-8000-000000000601",
  isDemo: false,
  methodologyVersion: "schema-v1",
  metricCode: "SCHEMA_MARKET",
  metricName: "Schema market metric",
  periodEnd: "2026-01-01",
  periodStart: "2025-01-01",
  publishedOn: null,
  unitCode: "USD",
  valueNumeric: 1,
  verifiedAt: "2026-08-05T13:00:00.000Z",
} as const;

function issuePaths(result: { error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map(({ path }) => path.join(".")) ?? [];
}

describe("admin product governance schemas", () => {
  it("accepts valid half-open product and certification periods", () => {
    expect(productDraftPayloadSchema.safeParse(productPayload).success).toBe(true);
    expect(
      productCertificationDraftPayloadSchema.safeParse(certificationPayload)
        .success,
    ).toBe(true);
  });

  it("requires a product availability start when an end is provided", () => {
    const result = productDraftPayloadSchema.safeParse({
      ...productPayload,
      availableFrom: null,
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("availableFrom");
  });

  it("rejects reversed product availability periods", () => {
    const result = productDraftPayloadSchema.safeParse({
      ...productPayload,
      availableTo: productPayload.availableFrom,
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("availableTo");
  });

  it("rejects duplicate product application scopes", () => {
    const result = productDraftPayloadSchema.safeParse({
      ...productPayload,
      applicationScopes: ["on-road-truck", "on-road-truck"],
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("applicationScopes.1");
  });

  it("requires a certification validity start when an end is provided", () => {
    const result = productCertificationDraftPayloadSchema.safeParse({
      ...certificationPayload,
      validFrom: null,
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("validFrom");
  });

  it("rejects reversed certification validity periods", () => {
    const result = productCertificationDraftPayloadSchema.safeParse({
      ...certificationPayload,
      validTo: certificationPayload.validFrom,
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("validTo");
  });

  it("rejects null for required numeric facts instead of coercing to zero", () => {
    const productResult = productDraftPayloadSchema.safeParse({
      ...productPayload,
      powerMinKw: null,
    });
    const regulationResult = regulationDraftPayloadSchema.safeParse({
      ...regulationPayload,
      limits: [{ ...regulationPayload.limits[0], limitValue: null }],
    });
    const marketResult = marketMetricDraftPayloadSchema.safeParse({
      ...marketMetricPayload,
      valueNumeric: null,
    });

    expect(productResult.success).toBe(false);
    expect(issuePaths(productResult)).toContain("powerMinKw");
    expect(regulationResult.success).toBe(false);
    expect(issuePaths(regulationResult)).toContain("limits.0.limitValue");
    expect(marketResult.success).toBe(false);
    expect(issuePaths(marketResult)).toContain("valueNumeric");
  });

  it("rejects non-numeric JSON types instead of applying JavaScript coercion", () => {
    for (const valueNumeric of [true, false, [], [1]]) {
      const result = marketMetricDraftPayloadSchema.safeParse({
        ...marketMetricPayload,
        valueNumeric,
      });

      expect(result.success).toBe(false);
      expect(issuePaths(result)).toContain("valueNumeric");
    }
  });

  it("rejects JavaScript-specific non-decimal numeric strings", () => {
    for (const value of ["0x10", "0b10", "0o10"]) {
      const marketResult = marketMetricDraftPayloadSchema.safeParse({
        ...marketMetricPayload,
        valueNumeric: value,
      });
      const productResult = productDraftPayloadSchema.safeParse({
        ...productPayload,
        powerMinKw: value,
      });

      expect(marketResult.success).toBe(false);
      expect(issuePaths(marketResult)).toContain("valueNumeric");
      expect(productResult.success).toBe(false);
      expect(issuePaths(productResult)).toContain("powerMinKw");
    }
  });
});

describe("admin source URL schemas", () => {
  const verifiedAt = "2026-08-05T13:00:00.000Z";

  it("rejects future verification timestamps", () => {
    const futureVerifiedAt = "2999-01-01T00:00:00.000Z";
    const sourceResult = dataSourceDraftPayloadSchema.safeParse({
      demoNotice: null,
      isDemo: false,
      publishedOn: null,
      publisher: "Schema publisher",
      sourceType: "government-notice",
      title: "Schema source",
      url: null,
      verifiedAt: futureVerifiedAt,
    });
    const verificationResult = sourceVerificationInputSchema.safeParse({
      reason: "Future timestamps must be rejected.",
      verifiedAt: futureVerifiedAt,
    });

    expect(sourceResult.success).toBe(false);
    expect(issuePaths(sourceResult)).toContain("verifiedAt");
    expect(verificationResult.success).toBe(false);
    expect(issuePaths(verificationResult)).toContain("verifiedAt");
  });

  it("keeps source type and Demo classification consistent", () => {
    const base = {
      demoNotice: null,
      publishedOn: null,
      publisher: "Schema publisher",
      title: "Schema source",
      url: null,
      verifiedAt,
    };

    for (const classification of [
      { isDemo: false, sourceType: "demo" },
      {
        demoNotice: "DEMO ONLY — classification mismatch.",
        isDemo: true,
        sourceType: "government-notice",
      },
    ]) {
      const result = dataSourceDraftPayloadSchema.safeParse({
        ...base,
        ...classification,
      });

      expect(result.success).toBe(false);
      expect(issuePaths(result)).toContain("sourceType");
    }
  });

  it("rejects malformed data-source URLs at the draft boundary", () => {
    const result = dataSourceDraftPayloadSchema.safeParse({
      demoNotice: null,
      isDemo: false,
      publishedOn: null,
      publisher: "Schema publisher",
      sourceType: "government-notice",
      title: "Schema source",
      url: "not-a-url",
      verifiedAt,
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("url");
  });

  it("rejects source URLs that would expose embedded credentials", () => {
    const result = dataSourceDraftPayloadSchema.safeParse({
      demoNotice: null,
      isDemo: false,
      publishedOn: null,
      publisher: "Schema publisher",
      sourceType: "government-notice",
      title: "Schema source",
      url: "https://reader:secret@example.com/source",
      verifiedAt,
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("url");
  });

  it("rejects malformed jurisdiction website URLs", () => {
    const result = jurisdictionDraftPayloadSchema.safeParse({
      code: "SCHEMA-JURISDICTION",
      countryIso3: null,
      dataSourceId: "00000000-0000-4000-8000-000000000001",
      isDemo: false,
      memberships: [],
      name: "Schema jurisdiction",
      type: "regional",
      verifiedAt,
      websiteUrl: "not-a-url",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("websiteUrl");
  });
});

describe("admin jurisdiction governance schemas", () => {
  const membership = {
    countryIso3: "CHN",
    dataSourceId: "00000000-0000-4000-8000-000000000001",
    isDemo: false,
    validFrom: "2026-01-01",
    validTo: null,
    verifiedAt: "2026-08-05T13:00:00.000Z",
  } as const;
  const jurisdictionPayload = {
    code: "SCHEMA-JURISDICTION",
    countryIso3: null,
    dataSourceId: "00000000-0000-4000-8000-000000000001",
    isDemo: false,
    memberships: [membership],
    name: "Schema jurisdiction",
    type: "regional",
    verifiedAt: "2026-08-05T13:00:00.000Z",
    websiteUrl: null,
  } as const;

  it("requires an explicit membership snapshot", () => {
    const withoutMemberships: Record<string, unknown> = {
      ...jurisdictionPayload,
    };
    delete withoutMemberships.memberships;
    const result = jurisdictionDraftPayloadSchema.safeParse(
      withoutMemberships,
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("memberships");
  });

  it("rejects duplicate countries in a membership snapshot", () => {
    const result = jurisdictionDraftPayloadSchema.safeParse({
      ...jurisdictionPayload,
      memberships: [membership, membership],
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("memberships.1.countryIso3");
  });

  it("requires a country jurisdiction to have one matching membership", () => {
    const withoutMembership = jurisdictionDraftPayloadSchema.safeParse({
      ...jurisdictionPayload,
      countryIso3: "CHN",
      memberships: [],
      type: "country",
    });
    const mismatchedMembership = jurisdictionDraftPayloadSchema.safeParse({
      ...jurisdictionPayload,
      countryIso3: "USA",
      type: "country",
    });

    expect(withoutMembership.success).toBe(false);
    expect(issuePaths(withoutMembership)).toContain("memberships");
    expect(mismatchedMembership.success).toBe(false);
    expect(issuePaths(mismatchedMembership)).toContain(
      "memberships.0.countryIso3",
    );
  });

  it("rejects countryIso3 on regional and international jurisdictions", () => {
    const result = jurisdictionDraftPayloadSchema.safeParse({
      ...jurisdictionPayload,
      countryIso3: "CHN",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("countryIso3");
  });
});

describe("admin governance entity references", () => {
  it("normalizes country keys and validates UUID-backed entity keys", () => {
    expect(
      governedEntityReferenceSchema.parse({
        entityKey: " chn ",
        entityType: "country",
      }),
    ).toEqual({ entityKey: "CHN", entityType: "country" });
    expect(
      governedEntityReferenceSchema.safeParse({
        entityKey: "not-a-uuid",
        entityType: "regulation",
      }).success,
    ).toBe(false);
  });

  it("does not accept UUID keys for countries or ISO3 keys for other entities", () => {
    expect(
      governedEntityReferenceSchema.safeParse({
        entityKey: "00000000-0000-4000-8000-000000000001",
        entityType: "country",
      }).success,
    ).toBe(false);
    expect(
      governedEntityReferenceSchema.safeParse({
        entityKey: "CHN",
        entityType: "data_source",
      }).success,
    ).toBe(false);
  });
});

describe("admin country coverage schemas", () => {
  const countryPayload = {
    dataCoverageStatus: "covered",
    dataSourceId: "00000000-0000-4000-8000-000000000001",
    isDemo: false,
    iso2: "CN",
    iso3: "CHN",
    nameEn: "China",
    nameLocal: "China",
    regionCode: "ASIA",
    subregionCode: "EASTERN_ASIA",
    verifiedAt: "2026-08-05T13:00:00.000Z",
  } as const;

  it("rejects unknown coverage vocabulary values", () => {
    const result = countryDraftPayloadSchema.safeParse({
      ...countryPayload,
      dataCoverageStatus: "coverd",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("dataCoverageStatus");
  });

  it("keeps demo classification aligned with coverage status", () => {
    const coveredDemo = countryDraftPayloadSchema.safeParse({
      ...countryPayload,
      isDemo: true,
    });
    const unmarkedDemo = countryDraftPayloadSchema.safeParse({
      ...countryPayload,
      dataCoverageStatus: "demo",
    });

    expect(coveredDemo.success).toBe(false);
    expect(issuePaths(coveredDemo)).toContain("isDemo");
    expect(unmarkedDemo.success).toBe(false);
    expect(issuePaths(unmarkedDemo)).toContain("isDemo");
  });
});

describe("admin regulation governance schemas", () => {
  it("requires an explicit unavailable-limits state for zero-limit regulations", () => {
    const implicit = regulationDraftPayloadSchema.safeParse({
      ...regulationPayload,
      limits: [],
    });
    const documented = regulationDraftPayloadSchema.safeParse({
      ...regulationPayload,
      limits: [],
      limitsUnavailable: true,
      summary: "The official numeric table has a signed-off source conflict.",
    });

    expect(implicit.success).toBe(false);
    expect(issuePaths(implicit)).toContain("limits");
    expect(documented.success).toBe(true);
  });

  it("rejects unavailable-limits state without an explanation or with numeric rows", () => {
    const unexplained = regulationDraftPayloadSchema.safeParse({
      ...regulationPayload,
      limits: [],
      limitsUnavailable: true,
      summary: null,
    });
    const contradictory = regulationDraftPayloadSchema.safeParse({
      ...regulationPayload,
      limitsUnavailable: true,
      summary: "Contradictory state.",
    });

    expect(unexplained.success).toBe(false);
    expect(issuePaths(unexplained)).toContain("summary");
    expect(contradictory.success).toBe(false);
    expect(issuePaths(contradictory)).toContain("limitsUnavailable");
  });

  it("requires an effective start when an effective end is provided", () => {
    const result = regulationDraftPayloadSchema.safeParse({
      ...regulationPayload,
      effectiveFrom: null,
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("effectiveFrom");
  });

  it("reports one start-date issue for an effective regulation without a start", () => {
    const result = regulationDraftPayloadSchema.safeParse({
      ...regulationPayload,
      effectiveFrom: null,
      status: "effective",
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.filter(({ path }) => path.join(".") === "effectiveFrom"),
    ).toHaveLength(1);
  });

  it("rejects reversed regulation effective periods", () => {
    const result = regulationDraftPayloadSchema.safeParse({
      ...regulationPayload,
      effectiveTo: regulationPayload.effectiveFrom,
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("effectiveTo");
  });
});

describe("admin governance numeric inputs", () => {
  it("rejects blank regulation limit values instead of coercing them to zero", () => {
    const result = regulationDraftPayloadSchema.safeParse({
      ...regulationPayload,
      limits: [{ ...regulationPayload.limits[0], limitValue: "" }],
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("limits.0.limitValue");
  });

  it("rejects blank product power bounds", () => {
    const result = productDraftPayloadSchema.safeParse({
      ...productPayload,
      powerMinKw: "",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("powerMinKw");
  });

  it("rejects blank optional certification power bounds", () => {
    const result = productCertificationDraftPayloadSchema.safeParse({
      ...certificationPayload,
      powerMinKw: "",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("powerMinKw");
  });

  it("rejects blank market values instead of coercing them to zero", () => {
    const result = marketMetricDraftPayloadSchema.safeParse({
      ...marketMetricPayload,
      valueNumeric: "",
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("valueNumeric");
  });
});
