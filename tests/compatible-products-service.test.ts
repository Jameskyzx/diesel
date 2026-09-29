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
    const controller = new AbortController();

    const result = await findCompatibleProducts(
      {
        applicationScope: "non-road",
        asOf: "2026-08-12",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "demo-eng-200",
      },
      { signal: controller.signal },
    );

    expect(result).toEqual([namedEvaluation]);
    expect(serviceMocks.evaluateProductFit).toHaveBeenCalledOnce();
    expect(serviceMocks.evaluateProductFit).toHaveBeenCalledWith(
      {
        applicationScope: "non-road",
        asOf: "2026-08-12",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "DEMO-ENG-200",
      },
      { signal: controller.signal },
    );
    expect(serviceMocks.listProducts).not.toHaveBeenCalled();
  });

  it("waits for every started product evaluation before propagating an earlier failure", async () => {
    let resolveSibling!: (value: { marker: string }) => void;
    const sibling = new Promise<{ marker: string }>((resolve) => {
      resolveSibling = resolve;
    });
    const firstError = new Error("first evaluation failed");
    serviceMocks.listProducts.mockResolvedValue({
      products: [{ modelCode: "MODEL-A" }, { modelCode: "MODEL-B" }],
    });
    serviceMocks.evaluateProductFit.mockImplementation(
      ({ productModelCode }: { productModelCode: string }) =>
        productModelCode === "MODEL-A"
          ? Promise.reject(firstError)
          : sibling,
    );

    let settled = false;
    const operation = findCompatibleProducts({
      applicationScope: "non-road",
      asOf: "2026-08-12",
      countryIso3: "CHN",
      powerKw: 100,
    }).finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(serviceMocks.evaluateProductFit).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);

    resolveSibling({ marker: "sibling completed" });
    await expect(operation).rejects.toBe(firstError);
  });

  it("does not start evaluation fan-out when cancellation arrives after listing", async () => {
    const controller = new AbortController();
    serviceMocks.listProducts.mockImplementation(async () => {
      controller.abort("caller-controlled reason");
      return { products: [{ modelCode: "MODEL-A" }] };
    });

    await expect(
      findCompatibleProducts(
        {
          applicationScope: "non-road",
          asOf: "2026-08-12",
          countryIso3: "CHN",
          powerKw: 100,
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      message: "The request was canceled.",
      name: "AbortError",
    });

    expect(serviceMocks.listProducts).toHaveBeenCalledWith({
      signal: controller.signal,
    });
    expect(serviceMocks.evaluateProductFit).not.toHaveBeenCalled();
  });
});
