import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callbackRejected: false,
  compareRegulationsFromRepositories: vi.fn(),
  createCountryRepository: vi.fn(),
  createRegulationRepository: vi.fn(),
  findByIso3: vi.fn(),
  findDetailsByIso3: vi.fn(),
  findForComparison: vi.fn(),
  transaction: vi.fn(),
  transactionObject: { marker: "country-detail-snapshot" },
}));

vi.mock("@/server/db/client", () => ({
  getDatabase: () => ({ transaction: mocks.transaction }),
}));

vi.mock("@/server/db/demo-client", () => ({
  getDemoDatabase: vi.fn(async () => {
    throw new Error("Demo database must not be initialized in this test.");
  }),
}));

vi.mock("@/server/db/environment", () => ({
  getDatabaseMode: () => "postgres",
}));

vi.mock("@/server/repositories/country-repository", () => ({
  createCountryRepository: mocks.createCountryRepository,
}));

vi.mock("@/server/repositories/regulation-repository", () => ({
  createRegulationRepository: mocks.createRegulationRepository,
}));

vi.mock("@/server/services/marketing-analysis-service", () => ({
  compareRegulationsFromRepositories:
    mocks.compareRegulationsFromRepositories,
}));

import {
  COUNTRY_DETAIL_READ_TRANSACTION_CONFIG,
  getCountryDetails,
} from "@/server/services/country-service";
import type { RegulationComparisonRepositories } from "@/server/services/marketing-analysis-service";

describe("country detail read transaction", () => {
  beforeEach(() => {
    mocks.callbackRejected = false;
    mocks.compareRegulationsFromRepositories.mockReset();
    mocks.createCountryRepository.mockReset();
    mocks.createRegulationRepository.mockReset();
    mocks.findByIso3.mockReset();
    mocks.findDetailsByIso3.mockReset();
    mocks.findForComparison.mockReset().mockResolvedValue([]);
    mocks.transaction.mockReset();

    mocks.createCountryRepository.mockReturnValue({
      findByIso3: mocks.findByIso3,
      findDetailsByIso3: mocks.findDetailsByIso3,
    });
    mocks.createRegulationRepository.mockReturnValue({
      findForComparison: mocks.findForComparison,
    });
    mocks.findByIso3.mockResolvedValue(null);
    mocks.transaction.mockImplementation(
      async (operation: (transaction: object) => Promise<unknown>) => {
        try {
          return await operation(mocks.transactionObject);
        } catch (error: unknown) {
          mocks.callbackRejected = true;
          throw error;
        }
      },
    );
  });

  it("creates both repositories from one read-only repeatable-read transaction", async () => {
    await expect(getCountryDetails({ iso3: "CHN" })).resolves.toEqual({
      iso3: "CHN",
      status: "no_data",
    });

    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      COUNTRY_DETAIL_READ_TRANSACTION_CONFIG,
    );
    expect(COUNTRY_DETAIL_READ_TRANSACTION_CONFIG).toEqual({
      accessMode: "read only",
      isolationLevel: "repeatable read",
    });
    expect(mocks.createCountryRepository).toHaveBeenCalledOnce();
    expect(mocks.createCountryRepository).toHaveBeenCalledWith(
      mocks.transactionObject,
    );
    expect(mocks.createRegulationRepository).toHaveBeenCalledOnce();
    expect(mocks.createRegulationRepository).toHaveBeenCalledWith(
      mocks.transactionObject,
    );
  });

  it("rejects the transaction callback after cancellation so the driver rolls it back", async () => {
    const controller = new AbortController();
    mocks.findByIso3.mockImplementation(async () => {
      controller.abort("untrusted-client-reason");
      return null;
    });

    await expect(
      getCountryDetails(
        { iso3: "CHN" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.callbackRejected).toBe(true);
    expect(mocks.findDetailsByIso3).not.toHaveBeenCalled();
    expect(mocks.compareRegulationsFromRepositories).not.toHaveBeenCalled();
  });

  it("keeps filtered applicability reads on the transaction-owned repositories", async () => {
    const comparisonFailure = new Error("comparison failed");
    const verifiedAt = new Date("2026-08-30T00:00:00.000Z");
    const profile = {
      dataCoverageStatus: "covered",
      isDemo: false,
      iso2: "CN",
      iso3: "CHN",
      nameEn: "China",
      nameLocal: "中国",
      regionCode: "AS",
      source: {
        id: "10000000-0000-4000-8000-000000000001",
        isDemo: false,
        publishedOn: "2026-08-30",
        publisher: "Fixture publisher",
        title: "Fixture source",
        url: "https://example.test/source",
        verifiedAt,
      },
      subregionCode: "EAS",
      verifiedAt,
    };
    mocks.findByIso3.mockResolvedValue(profile);
    mocks.findDetailsByIso3.mockResolvedValue({
      ...profile,
      jurisdictions: [],
      marketMetrics: [],
      regulations: [],
    });
    mocks.compareRegulationsFromRepositories.mockImplementation(
      async (
        input: unknown,
        repositories: RegulationComparisonRepositories,
        options: Parameters<RegulationComparisonRepositories["regulationRepository"]["findForComparison"]>[1],
      ) => {
        await repositories.regulationRepository.findForComparison(input, options);
        throw comparisonFailure;
      },
    );

    await expect(
      getCountryDetails({
        applicationScope: "non-road",
        asOf: "2026-08-30",
        iso3: "CHN",
        powerKw: 100,
      }),
    ).rejects.toBe(comparisonFailure);

    const countryRepository =
      mocks.createCountryRepository.mock.results[0]?.value;
    expect(mocks.compareRegulationsFromRepositories).toHaveBeenCalledWith(
      {
        applicationScope: "non-road",
        asOf: "2026-08-30",
        countryIso3s: ["CHN"],
        powerKw: 100,
      },
      {
        countryRepository,
        regulationRepository: { findForComparison: expect.any(Function) },
      },
      {},
    );
    expect(mocks.findForComparison).toHaveBeenCalledExactlyOnceWith(
      {
        applicationScope: "non-road",
        asOf: "2026-08-30",
        countryIso3s: ["CHN"],
        powerKw: 100,
      },
      {},
    );
    expect(mocks.callbackRejected).toBe(true);
  });

  it("validates external input before opening a transaction", async () => {
    await expect(getCountryDetails({ iso3: "not-iso3" })).rejects.toThrow();

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.createCountryRepository).not.toHaveBeenCalled();
    expect(mocks.createRegulationRepository).not.toHaveBeenCalled();
  });
});
