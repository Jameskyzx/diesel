import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  evaluateProductFit: vi.fn(),
  getCountryDetails: vi.fn(),
  listCountryMapSummaries: vi.fn(),
  listProducts: vi.fn(),
}));

vi.mock("@/server/services/country-service", () => ({
  getCountryDetails: mocks.getCountryDetails,
  listCountryMapSummaries: mocks.listCountryMapSummaries,
}));

vi.mock("@/server/services/product-fit-service", () => ({
  evaluateProductFit: mocks.evaluateProductFit,
  listProducts: mocks.listProducts,
}));

import { GET as getCountry } from "@/app/api/countries/[iso3]/route";
import { GET as getCountrySummaries } from "@/app/api/countries/route";
import { POST as evaluateProduct } from "@/app/api/product-fit/route";
import { GET as getProducts } from "@/app/api/products/route";

const sensitiveText = "postgres://public:secret@example.test/database";

async function expectSafeFailureLog(
  action: () => Promise<Response>,
  eventName: string,
  errorCode = "Error",
) {
  const consoleSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);

  try {
    const response = await action();

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(sensitiveText);
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(sensitiveText);
    expect(consoleSpy).toHaveBeenCalledWith(eventName, {
      errorCode,
    });
  } finally {
    consoleSpy.mockRestore();
  }
}

describe("public API error logging", () => {
  beforeEach(() => {
    mocks.evaluateProductFit.mockReset();
    mocks.getCountryDetails.mockReset();
    mocks.listCountryMapSummaries.mockReset();
    mocks.listProducts.mockReset();
  });

  it("does not log country summary service error details", async () => {
    mocks.listCountryMapSummaries.mockRejectedValue(
      new Error(`Country summary lookup failed at ${sensitiveText}`),
    );

    await expectSafeFailureLog(
      () => getCountrySummaries(),
      "Country summary request failed",
    );
  });

  it("keeps the country summary error handler safe for hostile Error proxies", async () => {
    const error = new Proxy(
      new Error(`Country summary failed at ${sensitiveText}`),
      {
        getPrototypeOf() {
          throw new Error("Prototype access is blocked.");
        },
      },
    );
    mocks.listCountryMapSummaries.mockRejectedValue(error);

    await expectSafeFailureLog(
      () => getCountrySummaries(),
      "Country summary request failed",
      "UNKNOWN_ERROR",
    );
  });

  it("does not log country service error details", async () => {
    mocks.getCountryDetails.mockRejectedValue(
      new Error(`Country lookup failed at ${sensitiveText}`),
    );

    await expectSafeFailureLog(
      () =>
        getCountry(new Request("http://localhost/api/countries/CHN"), {
          params: Promise.resolve({ iso3: "CHN" }),
        }),
      "Country detail request failed",
    );
  });

  it("keeps downstream country response validation failures as internal errors", async () => {
    const downstreamError = z
      .object({ iso3: z.never() })
      .safeParse({ iso3: "CHN" }).error;
    mocks.getCountryDetails.mockRejectedValue(downstreamError);

    await expectSafeFailureLog(
      () =>
        getCountry(new Request("http://localhost/api/countries/CHN"), {
          params: Promise.resolve({ iso3: "CHN" }),
        }),
      "Country detail request failed",
      "ZodError",
    );
  });

  it("rejects invalid country query input before calling the service", async () => {
    const invalidAsOf = await getCountry(
      new Request("http://localhost/api/countries/CHN?asOf=not-a-date"),
      { params: Promise.resolve({ iso3: "CHN" }) },
    );
    const invalidIso3 = await getCountry(
      new Request("http://localhost/api/countries/CN"),
      { params: Promise.resolve({ iso3: "CN" }) },
    );

    expect(invalidAsOf.status).toBe(400);
    await expect(invalidAsOf.json()).resolves.toMatchObject({
      error: { code: "INVALID_AS_OF" },
    });
    expect(invalidIso3.status).toBe(400);
    await expect(invalidIso3.json()).resolves.toMatchObject({
      error: { code: "INVALID_ISO3" },
    });
    expect(mocks.getCountryDetails).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown three-letter country without calling the service", async () => {
    const response = await getCountry(
      new Request("http://localhost/api/countries/ZZZ"),
      { params: Promise.resolve({ iso3: "ZZZ" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "COUNTRY_NOT_FOUND",
        message: "未找到该 ISO3 对应的国家目录记录。",
      },
    });
    expect(mocks.getCountryDetails).not.toHaveBeenCalled();
  });

  it("returns a safe error when country route parameters cannot be resolved", async () => {
    const error = new Error(`Route params failed at ${sensitiveText}`);
    error.name = sensitiveText;

    await expectSafeFailureLog(
      () =>
        getCountry(new Request("http://localhost/api/countries/CHN"), {
          params: Promise.reject(error),
        }),
      "Country detail request failed",
    );
    expect(mocks.getCountryDetails).not.toHaveBeenCalled();
  });

  it("does not log product directory error details", async () => {
    const error = new Error(`Product lookup failed at ${sensitiveText}`);
    error.name = sensitiveText;
    mocks.listProducts.mockRejectedValue(error);

    await expectSafeFailureLog(
      () => getProducts(),
      "Product list request failed",
    );
  });

  it("does not log product-fit service error details", async () => {
    mocks.evaluateProductFit.mockRejectedValue(
      new Error(`Product-fit lookup failed at ${sensitiveText}`),
    );

    await expectSafeFailureLog(
      () =>
        evaluateProduct(
          new Request("http://localhost/api/product-fit", {
            body: JSON.stringify({
              applicationScope: "non-road",
              asOf: "2026-08-06",
              countryIso3: "CHN",
              powerKw: 100,
              productModelCode: "DEMO-100",
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        ),
      "Product fit evaluation failed",
    );
  });

  it("returns a safe structured error when the product-fit request stream fails", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(`Request stream failed at ${sensitiveText}`));
      },
    });
    const requestInit = {
      body: stream,
      duplex: "half" as const,
      headers: { "content-type": "application/json" },
      method: "POST",
    };

    await expectSafeFailureLog(
      () =>
        evaluateProduct(
          new Request("http://localhost/api/product-fit", requestInit),
        ),
      "Product fit evaluation failed",
    );
    expect(mocks.evaluateProductFit).not.toHaveBeenCalled();
  });
});
