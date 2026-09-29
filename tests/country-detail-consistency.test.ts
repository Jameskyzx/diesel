import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countryDetailResponseMatchesDeterministicRules } from "@/domain/countries/detail-consistency";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import {
  getCountryProfileResultSchema,
  type AiToolResult,
} from "@/features/ai/schemas";
import {
  countryDetailResponseSchema,
  type CountryDetailResponse,
} from "@/features/countries/schemas";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
} from "@/server/ai/evidence-contract";
import { buildCountryProfileResult } from "@/server/ai/tool-results";
import {
  getCountryDetails,
  latestTimestamp,
} from "@/server/services/country-service";

type AvailableCountryDetail = Extract<
  CountryDetailResponse,
  { status: "available" }
>;

const asOf = "2026-08-13";
const originalDatabaseMode = process.env.DATABASE_MODE;
let broad: AvailableCountryDetail;
let scoped: AvailableCountryDetail;
let noData: CountryDetailResponse;

function requireAvailable(
  response: CountryDetailResponse,
): AvailableCountryDetail {
  if (response.status !== "available") {
    throw new Error("Expected an available Demo country detail fixture.");
  }
  return response;
}

function sameInstantAtPlusEight(value: string): string {
  const shifted = new Date(Date.parse(value) + 8 * 60 * 60 * 1_000)
    .toISOString()
    .replace(/Z$/u, "+08:00");
  return shifted;
}

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  [broad, scoped, noData] = await Promise.all([
    getCountryDetails({ asOf, iso3: "CHN" }).then(requireAvailable),
    getCountryDetails({
      applicationScope: "non-road",
      asOf,
      iso3: "CHN",
      powerKw: 100,
    }).then(requireAvailable),
    getCountryDetails({ asOf, iso3: "USA" }),
  ]);
});

afterAll(() => {
  if (originalDatabaseMode === undefined) {
    delete process.env.DATABASE_MODE;
  } else {
    process.env.DATABASE_MODE = originalDatabaseMode;
  }
});

describe("country-detail deterministic consistency", () => {
  it("accepts real Demo broad, scoped, and no-data service fixtures", () => {
    expect(countryDetailResponseMatchesDeterministicRules(broad)).toBe(true);
    expect(countryDetailResponseMatchesDeterministicRules(scoped)).toBe(true);
    expect(countryDetailResponseMatchesDeterministicRules(noData)).toBe(true);
  });

  it("treats source arrays as sets and freshness timestamps as instants", () => {
    const reordered = structuredClone(scoped);
    reordered.country.sources.reverse();
    reordered.applicabilitySummary?.sources.reverse();
    reordered.country.lastVerifiedAt = sameInstantAtPlusEight(
      reordered.country.lastVerifiedAt,
    );
    const summary = reordered.applicabilitySummary;
    if (summary !== null && summary.lastVerifiedAt !== null) {
      summary.lastVerifiedAt = sameInstantAtPlusEight(
        summary.lastVerifiedAt,
      );
    }

    expect(countryDetailResponseMatchesDeterministicRules(reordered)).toBe(
      true,
    );
  });

  it("selects the actual latest pre-epoch verification instant", () => {
    expect(
      latestTimestamp([
        "1960-01-01T00:00:00.000Z",
        "1969-12-31T23:59:59.000Z",
      ]),
    ).toBe("1969-12-31T23:59:59.000Z");
    expect(latestTimestamp([])).toBe("1970-01-01T00:00:00.000Z");
    expect(() => latestTimestamp(["not-a-timestamp"])).toThrow(
      "Country verification timestamps were invalid.",
    );
  });

  it("preserves valid historical future lifecycle states and coverage pairs", () => {
    for (const status of ["effective", "superseded"] as const) {
      const candidate = structuredClone(broad);
      const future = candidate.country.futureAdoptedRegulations[0]!;
      future.status = status;
      if (status === "superseded") {
        future.effectiveTo = "2035-01-01";
      }
      expect(countryDetailResponseMatchesDeterministicRules(candidate)).toBe(
        true,
      );
    }

    const covered = structuredClone(broad);
    covered.country.dataCoverageStatus = "covered";
    covered.country.isDemo = false;
    expect(countryDetailResponseMatchesDeterministicRules(covered)).toBe(true);
  });

  const broadMutationCases: {
    label: string;
    mutate: (detail: AvailableCountryDetail) => void;
  }[] = [
    {
      label: "duplicate jurisdiction ID",
      mutate: (detail) => {
        detail.country.jurisdictions.push(
          structuredClone(detail.country.jurisdictions[0]!),
        );
      },
    },
    {
      label: "duplicate market metric ID",
      mutate: (detail) => {
        detail.country.marketMetrics.push(
          structuredClone(detail.country.marketMetrics[0]!),
        );
      },
    },
    {
      label: "duplicate market metric database identity",
      mutate: (detail) => {
        const duplicate = structuredClone(detail.country.marketMetrics[0]!);
        duplicate.id = "00000000-0000-4000-8000-000000000999";
        detail.country.marketMetrics.push(duplicate);
      },
    },
    {
      label: "market metric country drift",
      mutate: (detail) => {
        detail.country.marketMetrics[0]!.countryIso3 = "BRA";
      },
    },
    {
      label: "non-positive market metric period",
      mutate: (detail) => {
        detail.country.marketMetrics[0]!.periodEnd =
          detail.country.marketMetrics[0]!.periodStart;
      },
    },
    {
      label: "duplicate regulation ID",
      mutate: (detail) => {
        detail.country.currentEffectiveRegulations.push(
          structuredClone(
            detail.country.currentEffectiveRegulations[0]!,
          ),
        );
      },
    },
    {
      label: "regulation applicability country drift",
      mutate: (detail) => {
        detail.country.currentEffectiveRegulations[0]!.applicability.countryIso3 =
          "BRA";
      },
    },
    {
      label: "nested jurisdiction projection drift",
      mutate: (detail) => {
        detail.country.currentEffectiveRegulations[0]!.applicability.jurisdiction.code =
          "DRIFTED";
      },
    },
    {
      label: "inactive membership at the half-open end",
      mutate: (detail) => {
        detail.country.jurisdictions[0]!.validTo = detail.asOf;
        detail.country.currentEffectiveRegulations[0]!.applicability.membership.validTo =
          detail.asOf;
      },
    },
    {
      label: "unknown current adoption date",
      mutate: (detail) => {
        detail.country.currentEffectiveRegulations[0]!.adoptedOn = null;
      },
    },
    {
      label: "current regulation after the query date",
      mutate: (detail) => {
        detail.country.currentEffectiveRegulations[0]!.effectiveFrom =
          "2030-01-01";
      },
    },
    {
      label: "future regulation adopted after the query date",
      mutate: (detail) => {
        detail.country.futureAdoptedRegulations[0]!.adoptedOn =
          "2030-01-01";
      },
    },
    {
      label: "future effective date at the half-open query boundary",
      mutate: (detail) => {
        detail.country.futureAdoptedRegulations[0]!.effectiveFrom =
          detail.asOf;
      },
    },
    {
      label: "effective future record without an effective date",
      mutate: (detail) => {
        const future = detail.country.futureAdoptedRegulations[0]!;
        future.status = "effective";
        future.effectiveFrom = null;
      },
    },
    {
      label: "available response with a no-data coverage label",
      mutate: (detail) => {
        detail.country.dataCoverageStatus = "no_data";
      },
    },
    {
      label: "Demo coverage without a Demo country flag",
      mutate: (detail) => {
        detail.country.isDemo = false;
      },
    },
    {
      label: "missing source from the exact closure",
      mutate: (detail) => {
        detail.country.sources.pop();
      },
    },
    {
      label: "duplicate source in the exact closure",
      mutate: (detail) => {
        detail.country.sources.push(
          structuredClone(detail.country.sources[0]!),
        );
      },
    },
    {
      label: "source metadata drift inside the closure",
      mutate: (detail) => {
        detail.country.sources[0]!.title = "DRIFTED SOURCE";
      },
    },
    {
      label: "country freshness drift",
      mutate: (detail) => {
        detail.country.lastVerifiedAt = "1970-01-01T00:00:00.000Z";
      },
    },
  ];

  it.each(broadMutationCases)("rejects $label", ({ mutate }) => {
    const candidate = structuredClone(broad);
    mutate(candidate);

    expect(countryDetailResponseMatchesDeterministicRules(candidate)).toBe(
      false,
    );
  });

  it.each([
    {
      label: "non-decimal market metric value",
      mutate: (detail: AvailableCountryDetail) => {
        detail.country.marketMetrics[0]!.valueNumeric = "not-a-number";
      },
    },
    {
      label: "lowercase currency code",
      mutate: (detail: AvailableCountryDetail) => {
        detail.country.marketMetrics[0]!.currencyCode = "usd";
      },
    },
  ])("rejects $label at the public schema", ({ mutate }) => {
    const candidate = structuredClone(broad);
    mutate(candidate);
    expect(countryDetailResponseSchema.safeParse(candidate).success).toBe(
      false,
    );
  });

  const scopedMutationCases: {
    label: string;
    mutate: (detail: AvailableCountryDetail) => void;
  }[] = [
    {
      label: "summary as-of drift",
      mutate: (detail) => {
        detail.applicabilitySummary!.query.asOf = "2026-08-14";
      },
    },
    {
      label: "summary country drift",
      mutate: (detail) => {
        detail.applicabilitySummary!.query.countryIso3s = ["BRA"];
      },
    },
    {
      label: "summary country projection drift",
      mutate: (detail) => {
        detail.applicabilitySummary!.country.countryName = "Drifted China";
      },
    },
    {
      label: "duplicate summary source identity",
      mutate: (detail) => {
        detail.applicabilitySummary!.sources.push(
          structuredClone(detail.applicabilitySummary!.sources[0]!),
        );
      },
    },
    {
      label: "missing summary source identity",
      mutate: (detail) => {
        detail.applicabilitySummary!.sources.pop();
      },
    },
    {
      label: "summary freshness drift",
      mutate: (detail) => {
        detail.applicabilitySummary!.lastVerifiedAt =
          "1970-01-01T00:00:00.000Z";
      },
    },
    {
      label: "summary deterministic status drift",
      mutate: (detail) => {
        detail.applicabilitySummary!.country.status = "no_data";
      },
    },
    {
      label: "summary regulation-to-profile name drift",
      mutate: (detail) => {
        detail.applicabilitySummary!.country.currentEffectiveRegulations[0]!.canonicalName =
          "DRIFTED REGULATION";
      },
    },
    {
      label: "summary power outside every visible limit",
      mutate: (detail) => {
        for (const limit of detail.applicabilitySummary!.country
          .currentEffectiveRegulations[0]!.limits) {
          limit.powerMinKw = 101;
        }
      },
    },
  ];

  it.each(scopedMutationCases)(
    "rejects $label",
    ({ mutate }) => {
      const candidate = structuredClone(scoped);
      mutate(candidate);

      expect(countryDetailResponseMatchesDeterministicRules(candidate)).toBe(
        false,
      );
    },
  );

  it("leaves explicit unprovable fields outside the payload-only boundary", () => {
    const candidate = structuredClone(scoped);
    candidate.country.isStale = !candidate.country.isStale;
    candidate.applicabilitySummary!.query.applicationScope = "marine";

    expect(countryDetailResponseMatchesDeterministicRules(candidate)).toBe(
      true,
    );
  });

  it("wires the boundary through public, server AI, client AI, and model-text schemas", () => {
    const toolResult = buildCountryProfileResult({
      informationAsOf: asOf,
      profile: broad,
      requestedTopics: ["country"],
      resolvedCountryIso3: "CHN",
    });
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [
        "As of 2026-08-13, return only the CHN country overview.",
      ],
    });

    expect(countryDetailResponseSchema.safeParse(broad).success).toBe(true);
    expect(getCountryProfileResultSchema.safeParse(toolResult).success).toBe(
      true,
    );
    expect(clientAiToolResultSchema.safeParse(toolResult).success).toBe(true);
    expect(
      evidenceContractAllowsModelText(contract, [toolResult]),
    ).toBe(true);

    const driftedDetail = structuredClone(broad);
    driftedDetail.country.lastVerifiedAt = "1970-01-01T00:00:00.000Z";
    expect(countryDetailResponseSchema.safeParse(driftedDetail).success).toBe(
      false,
    );

    const driftedToolResult = structuredClone(toolResult);
    if (driftedToolResult.profile?.status !== "available") {
      throw new Error("Expected an available country-profile result.");
    }
    driftedToolResult.profile.country.lastVerifiedAt =
      "1970-01-01T00:00:00.000Z";
    expect(
      getCountryProfileResultSchema.safeParse(driftedToolResult).success,
    ).toBe(false);
    expect(clientAiToolResultSchema.safeParse(driftedToolResult).success).toBe(
      false,
    );
    expect(
      evidenceContractAllowsModelText(contract, [
        driftedToolResult as AiToolResult,
      ]),
    ).toBe(false);

    for (const mutate of [
      (result: typeof toolResult) => {
        if (result.profile?.status === "available") {
          result.profile.country.marketMetrics[0]!.countryIso3 = "BRA";
        }
      },
      (result: typeof toolResult) => {
        if (result.profile?.status === "available") {
          result.profile.country.marketMetrics[0]!.valueNumeric =
            "not-a-number";
        }
      },
      (result: typeof toolResult) => {
        if (result.profile?.status === "available") {
          result.profile.country.dataCoverageStatus = "no_data";
        }
      },
    ]) {
      const drifted = structuredClone(toolResult);
      mutate(drifted);
      expect(getCountryProfileResultSchema.safeParse(drifted).success).toBe(
        false,
      );
      expect(clientAiToolResultSchema.safeParse(drifted).success).toBe(false);
      expect(
        evidenceContractAllowsModelText(contract, [drifted as AiToolResult]),
      ).toBe(false);
    }
  });
});
