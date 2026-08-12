import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  getCountryDetails,
  isCurrentEffectiveRegulation,
  isFutureAdoptedRegulation,
  isStaleVerification,
  listCountryMapSummaries,
} from "@/server/services/country-service";
import { getDemoDatabase } from "@/server/db/demo-client";
import { demoIds } from "@/server/db/seed/demo-data";
import { createGovernanceRepository } from "@/server/repositories/governance-repository";
import { buildCountryProfileResult } from "@/server/ai/tool-results";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";

const originalDatabaseMode = process.env.DATABASE_MODE;

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

describe("country coverage gating (ADR-040)", () => {
  it(
    "returns available details for demo-coverage countries",
    async () => {
      const china = await getCountryDetails({ iso3: "CHN" });

      expect(china.status).toBe("available");
      if (china.status === "available") {
        expect(china.country.iso3).toBe("CHN");
        expect(china.country.isDemo).toBe(true);
        expect(china.country.jurisdictions[0]?.source.title).toContain(
          "DEMO ONLY",
        );
        expect(
          china.country.sources.map(({ id }) => id),
        ).toContain(china.country.jurisdictions[0]?.membershipSource.id);
        const toolResult = buildCountryProfileResult({
          informationAsOf: china.asOf,
          profile: china,
          requestedTopics: ["country", "regulations", "market"],
          resolvedCountryIso3: "CHN",
        });
        const citationSourceIds = toolResult.citations.map(
          ({ sourceId }) => sourceId,
        );

        expect(citationSourceIds).toContain(
          china.country.jurisdictions[0]?.source.id,
        );
        expect(citationSourceIds).toContain(
          china.country.jurisdictions[0]?.membershipSource.id,
        );
        expect(toolResult.warnings).toEqual(
          expect.arrayContaining([expect.stringContaining("Demo")]),
        );
        const regulation = china.country.currentEffectiveRegulations[0];
        expect(regulation?.applicability).toMatchObject({
          countryIso3: "CHN",
          jurisdiction: {
            code: "DEMO-CHN-AUTHORITY",
            source: { isDemo: true },
          },
          membership: {
            source: { isDemo: true },
            validFrom: "2000-01-01",
            validTo: null,
          },
        });
        expect(toolResult.citations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              regulationId: regulation?.id,
              sourceId: regulation?.applicability.jurisdiction.source.id,
            }),
            expect.objectContaining({
              regulationId: regulation?.id,
              sourceId: regulation?.applicability.membership.source.id,
            }),
            expect.objectContaining({
              publishedOn: china.country.marketMetrics[0]?.publishedOn,
              sourceId: china.country.marketMetrics[0]?.source.id,
              title: china.country.marketMetrics[0]?.metricName,
            }),
          ]),
        );
        const clientResult = clientAiToolResultSchema.parse(toolResult);
        expect(clientResult.tool).toBe("getCountryProfile");
        if (
          clientResult.tool !== "getCountryProfile" ||
          clientResult.profile?.status !== "available"
        ) {
          throw new Error("Expected an available country-profile result.");
        }
        expect(
          clientResult.profile.country.currentEffectiveRegulations[0]
            ?.applicability.jurisdiction.code,
        ).toBe("DEMO-CHN-AUTHORITY");

        const regulationOnlyResult = buildCountryProfileResult({
          informationAsOf: china.asOf,
          profile: china,
          requestedTopics: ["regulations"],
          resolvedCountryIso3: "CHN",
        });
        expect(regulationOnlyResult.citations.length).toBeGreaterThan(0);
        expect(
          regulationOnlyResult.citations.every(
            ({ regulationId }) => regulationId !== null,
          ),
        ).toBe(true);
        expect(
          regulationOnlyResult.citations.some(
            ({ sourceId }) =>
              sourceId === china.country.marketMetrics[0]?.source.id,
          ),
        ).toBe(false);

        const marketOnlyResult = buildCountryProfileResult({
          informationAsOf: china.asOf,
          profile: china,
          requestedTopics: ["market"],
          resolvedCountryIso3: "CHN",
        });
        expect(marketOnlyResult.citations).toHaveLength(
          china.country.marketMetrics.length,
        );
        expect(
          marketOnlyResult.citations.every(
            ({ regulationId }) => regulationId === null,
          ),
        ).toBe(true);

        const withoutMarket = {
          ...china,
          country: { ...china.country, marketMetrics: [] },
        };
        expect(
          buildCountryProfileResult({
            informationAsOf: china.asOf,
            profile: withoutMarket,
            requestedTopics: ["market"],
            resolvedCountryIso3: "CHN",
          }),
        ).toMatchObject({
          evidenceSufficient: false,
          requestedTopics: ["market"],
          status: "no_data",
          warnings: expect.arrayContaining([
            expect.stringContaining("没有结构化市场指标证据"),
          ]),
        });
        expect(
          buildCountryProfileResult({
            informationAsOf: china.asOf,
            profile: withoutMarket,
            requestedTopics: ["country"],
            resolvedCountryIso3: "CHN",
          }),
        ).toMatchObject({
          evidenceSufficient: true,
          requestedTopics: ["country"],
          status: "ok",
        });
      }
    },
    30_000,
  );

  it(
    "keeps planned and no-data catalog countries on the exact no_data contract",
    async () => {
      await expect(getCountryDetails({ iso3: "USA" })).resolves.toEqual({
        iso3: "USA",
        status: "no_data",
      });
      await expect(getCountryDetails({ iso3: "FJI" })).resolves.toEqual({
        iso3: "FJI",
        status: "no_data",
      });
    },
    30_000,
  );

  it(
    "lists the whole 178-country catalog in map summaries",
    async () => {
      const response = await listCountryMapSummaries();

      expect(response.status).toBe("ok");
      expect(response.countries).toHaveLength(178);
      const statuses = new Set(
        response.countries.map(({ dataCoverageStatus }) => dataCoverageStatus),
      );
      expect(statuses).toEqual(new Set(["demo", "planned", "no_data"]));
    },
    30_000,
  );
});

describe("coverage migration via governance publish (ADR-042)", () => {
  it(
    "a published covered country draft makes details available",
    async () => {
      const database = await getDemoDatabase();
      const governance = createGovernanceRepository(database);
      const editor = {
        email: "editor@example.test",
        role: "editor" as const,
      };
      const reviewer = {
        email: "reviewer@example.test",
        role: "reviewer" as const,
      };

      // JPN 在目录中为 planned，详情门控返回 no_data。
      await expect(getCountryDetails({ iso3: "JPN" })).resolves.toEqual({
        iso3: "JPN",
        status: "no_data",
      });

      const draft = await governance.createDraft({
        actor: editor,
        changeReason:
          "M3 test: publish signed coverage status for Japan (ADR-042).",
        entityKey: "JPN",
        entityType: "country",
        payload: {
          dataCoverageStatus: "covered",
          dataSourceId: demoIds.source.countryDirectory,
          isDemo: false,
          iso2: "JP",
          iso3: "JPN",
          nameEn: "Japan",
          nameLocal: null,
          regionCode: "ASIA",
          subregionCode: "EASTERN_ASIA",
          verifiedAt: "2026-07-30T00:00:00.000Z",
        },
      });
      await governance.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Independent review for the coverage migration test.",
      });
      await governance.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Publish the reviewed coverage migration test.",
      });

      const details = await getCountryDetails({ iso3: "JPN" });
      expect(details.status).toBe("available");
      if (details.status === "available") {
        expect(details.country.dataCoverageStatus).toBe("covered");
        expect(details.country.isDemo).toBe(false);
        expect(details.country.currentEffectiveRegulations).toEqual([]);
        expect(details.country.futureAdoptedRegulations).toEqual([]);
      }
    },
    30_000,
  );
});

describe("verification freshness (ADR-045)", () => {
  it("treats exactly the threshold age as fresh and beyond as stale", () => {
    const verified = "2026-01-15T00:00:00.000Z";
    const dayMs = 24 * 60 * 60 * 1000;
    const now90 = new Date(new Date(verified).getTime() + 90 * dayMs);
    const now91 = new Date(new Date(verified).getTime() + 90 * dayMs + 1);

    expect(
      isStaleVerification(verified, now90.toISOString(), 90),
    ).toBe(false);
    expect(
      isStaleVerification(verified, now91.toISOString(), 90),
    ).toBe(true);
  });

  it(
    "exposes isStale on responses according to the configured threshold",
    async () => {
      vi.stubEnv("COUNTRY_STALE_AFTER_DAYS", "1");
      vi.resetModules();
      const staleModule = await import("@/server/services/country-service");
      const staleDetails = await staleModule.getCountryDetails({
        iso3: "CHN",
      });
      expect(staleDetails.status).toBe("available");
      if (staleDetails.status === "available") {
        expect(staleDetails.country.isStale).toBe(true);
      }
      const staleSummaries = await staleModule.listCountryMapSummaries();
      expect(staleSummaries.countries.some((country) => country.isStale)).toBe(
        true,
      );

      vi.stubEnv("COUNTRY_STALE_AFTER_DAYS", "3650");
      vi.resetModules();
      const freshModule = await import("@/server/services/country-service");
      const freshDetails = await freshModule.getCountryDetails({
        iso3: "CHN",
      });
      expect(freshDetails.status).toBe("available");
      if (freshDetails.status === "available") {
        expect(freshDetails.country.isStale).toBe(false);
      }
    },
    30_000,
  );

  it(
    "uses the current instant instead of truncating freshness checks to UTC midnight",
    async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-16T00:00:00.001Z"));
      vi.stubEnv("COUNTRY_STALE_AFTER_DAYS", "1");
      vi.resetModules();

      try {
        const staleModule = await import("@/server/services/country-service");
        const summaries = await staleModule.listCountryMapSummaries();
        const china = summaries.countries.find(({ iso3 }) => iso3 === "CHN");
        const details = await staleModule.getCountryDetails({ iso3: "CHN" });

        expect(china?.isStale).toBe(true);
        expect(details.status).toBe("available");
        if (details.status === "available") {
          expect(details.country.isStale).toBe(true);
        }
      } finally {
        vi.useRealTimers();
      }
    },
    30_000,
  );
});

describe("country regulation status grouping", () => {
  it(
    "uses lifecycle dates for a historical as-of view",
    async () => {
      const historical = await getCountryDetails({
        asOf: "2024-12-31",
        iso3: "CHN",
      });

      expect(historical.status).toBe("available");
      if (historical.status !== "available") {
        throw new Error("Expected historical CHN details.");
      }

      expect(
        historical.country.currentEffectiveRegulations.map(
          ({ citationCode, status, statusAtAsOf }) => ({
            citationCode,
            status,
            statusAtAsOf,
          }),
        ),
      ).toEqual([
        {
          citationCode: "DEMO-CHN-NR-Z",
          status: "superseded",
          statusAtAsOf: "effective",
        },
      ]);
      expect(
        historical.country.futureAdoptedRegulations.map(
          ({ citationCode, statusAtAsOf }) => ({
            citationCode,
            statusAtAsOf,
          }),
        ),
      ).toEqual([
        {
          citationCode: "DEMO-CHN-NR-A",
          statusAtAsOf: "adopted",
        },
      ]);
      expect(
        historical.country.futureAdoptedRegulations.some(
          ({ citationCode }) => citationCode === "DEMO-CHN-NR-C-ADOPTED",
        ),
      ).toBe(false);
    },
    30_000,
  );

  it("fails closed when adoption timing or supersession end is unknown", () => {
    expect(
      isFutureAdoptedRegulation(
        { adoptedOn: null, effectiveFrom: null, status: "adopted" },
        "2026-08-05",
      ),
    ).toBe(false);
    expect(
      isFutureAdoptedRegulation(
        {
          adoptedOn: "2026-01-01",
          effectiveFrom: null,
          status: "adopted",
        },
        "2026-08-05",
      ),
    ).toBe(true);
    expect(
      isFutureAdoptedRegulation(
        {
          adoptedOn: "2026-01-01",
          effectiveFrom: "2027-01-01",
          status: "adopted",
        },
        "2026-08-05",
      ),
    ).toBe(true);
    expect(
      isFutureAdoptedRegulation(
        {
          adoptedOn: "2025-01-01",
          effectiveFrom: "2026-01-01",
          status: "adopted",
        },
        "2026-08-05",
      ),
    ).toBe(false);
    expect(
      isCurrentEffectiveRegulation(
        {
          effectiveFrom: "2020-01-01",
          effectiveTo: null,
          status: "superseded",
        },
        "2024-12-31",
      ),
    ).toBe(false);
    expect(
      isCurrentEffectiveRegulation(
        {
          effectiveFrom: "2020-01-01",
          effectiveTo: "2025-01-01",
          status: "superseded",
        },
        "2024-12-31",
      ),
    ).toBe(true);
    expect(
      isFutureAdoptedRegulation(
        { adoptedOn: null, effectiveFrom: null, status: "effective" },
        "2026-08-05",
      ),
    ).toBe(false);
    expect(
      isFutureAdoptedRegulation(
        {
          adoptedOn: "2026-01-10",
          effectiveFrom: "2030-01-01",
          status: "adopted",
        },
        "2024-12-31",
      ),
    ).toBe(false);
  });
});
