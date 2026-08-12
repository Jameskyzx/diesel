import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  evaluateProductFit: vi.fn(),
  listProducts: vi.fn(),
}));

vi.mock("@/server/services/product-fit-service", () => ({
  evaluateProductFit: serviceMocks.evaluateProductFit,
  listProducts: serviceMocks.listProducts,
}));

import { findCompatibleProducts } from "@/server/services/compatible-products-service";

describe("compatible products service", () => {
  beforeEach(() => {
    serviceMocks.evaluateProductFit.mockReset();
    serviceMocks.listProducts.mockReset();
  });

  it("evaluates only an explicitly named model and preserves not-found evidence", async () => {
    const namedEvaluation = { marker: "named-evaluation" };
    serviceMocks.evaluateProductFit.mockResolvedValue(namedEvaluation);

    const result = await findCompatibleProducts({
      applicationScope: "non-road",
      asOf: "2026-08-12",
      countryIso3: "CHN",
      powerKw: 100,
      productModelCode: "demo-eng-200",
    });

    expect(result).toEqual([namedEvaluation]);
    expect(serviceMocks.evaluateProductFit).toHaveBeenCalledOnce();
    expect(serviceMocks.evaluateProductFit).toHaveBeenCalledWith({
      applicationScope: "non-road",
      asOf: "2026-08-12",
      countryIso3: "CHN",
      powerKw: 100,
      productModelCode: "DEMO-ENG-200",
    });
    expect(serviceMocks.listProducts).not.toHaveBeenCalled();
  });
});
