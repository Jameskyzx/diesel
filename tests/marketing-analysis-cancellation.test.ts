import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  findCompatibleProducts: vi.fn(),
  findCountryByIso3: vi.fn(),
  findMarketForComparison: vi.fn(),
  findRegulationForComparison: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getDatabase: () => ({}),
}));

vi.mock("@/server/db/environment", () => ({
  getDatabaseMode: () => "postgres",
}));

vi.mock("@/server/repositories/country-repository", () => ({
  createCountryRepository: () => ({
    findByIso3: repositoryMocks.findCountryByIso3,
  }),
}));

vi.mock("@/server/repositories/market-repository", () => ({
  createMarketRepository: () => ({
    findForComparison: repositoryMocks.findMarketForComparison,
  }),
}));

vi.mock("@/server/repositories/regulation-repository", () => ({
  createRegulationRepository: () => ({
    findForComparison: repositoryMocks.findRegulationForComparison,
  }),
}));

vi.mock("@/server/services/compatible-products-service", () => ({
  findCompatibleProducts: repositoryMocks.findCompatibleProducts,
}));

import {
  calculateOpportunityScore,
  generateSalesBrief,
} from "@/server/services/marketing-analysis-service";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const scoreInput = {
  applicationScope: "non-road",
  asOf: "2026-07-29",
  countryIso3s: ["CHN", "BRA"],
  metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
  powerKw: 100,
} as const;

describe("marketing analysis cancellation barriers", () => {
  beforeEach(() => {
    repositoryMocks.findCompatibleProducts.mockReset();
    repositoryMocks.findCountryByIso3.mockReset();
    repositoryMocks.findMarketForComparison.mockReset();
    repositoryMocks.findRegulationForComparison.mockReset();
    repositoryMocks.findCompatibleProducts.mockResolvedValue([]);
    repositoryMocks.findCountryByIso3.mockResolvedValue(null);
    repositoryMocks.findMarketForComparison.mockResolvedValue([]);
    repositoryMocks.findRegulationForComparison.mockResolvedValue([]);
  });

  it("keeps opportunity scoring pending until a started market sibling settles", async () => {
    const countryFailure = new Error("country comparison failed");
    const marketSibling = createDeferred<readonly never[]>();
    const controller = new AbortController();
    repositoryMocks.findCountryByIso3
      .mockRejectedValueOnce(countryFailure)
      .mockResolvedValue(null);
    repositoryMocks.findMarketForComparison.mockReturnValue(
      marketSibling.promise,
    );

    let settled = false;
    const operation = calculateOpportunityScore(scoreInput, {
      signal: controller.signal,
    }).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      expect(repositoryMocks.findMarketForComparison).toHaveBeenCalledOnce();
      expect(repositoryMocks.findCountryByIso3).toHaveBeenCalledTimes(2);
    });

    expect(settled).toBe(false);
    expect(repositoryMocks.findMarketForComparison).toHaveBeenCalledWith(
      expect.objectContaining({ countryIso3s: ["CHN", "BRA"] }),
      { signal: controller.signal },
    );
    expect(repositoryMocks.findCompatibleProducts).toHaveBeenCalledWith(
      expect.objectContaining({ countryIso3: "CHN" }),
      { signal: controller.signal },
    );

    marketSibling.resolve([]);
    await expect(operation).rejects.toBe(countryFailure);
  });

  it("keeps sales-brief aggregation pending until its started score-provenance product sibling settles", async () => {
    const countryFailure = new Error("country comparison failed");
    const productSibling = createDeferred<readonly never[]>();
    repositoryMocks.findCountryByIso3.mockRejectedValue(countryFailure);
    repositoryMocks.findCompatibleProducts
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(productSibling.promise);

    let settled = false;
    const operation = generateSalesBrief({
      ...scoreInput,
      targetCountryIso3: "CHN",
    }).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      expect(repositoryMocks.findCompatibleProducts).toHaveBeenCalledTimes(2);
    });

    expect(settled).toBe(false);
    expect(
      repositoryMocks.findCompatibleProducts.mock.calls.map(
        ([input]) => input.countryIso3,
      ),
    ).toEqual(["CHN", "BRA"]);
    productSibling.resolve([]);
    await expect(operation).rejects.toBe(countryFailure);
  });
});
