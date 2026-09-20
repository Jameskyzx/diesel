import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkDatabaseReadiness: vi.fn(),
  evaluateProductFit: vi.fn(),
  getCountryDetails: vi.fn(),
  listCountryMapSummaries: vi.fn(),
  listProducts: vi.fn(),
  validateAiChatAdmissionBudgetConfiguration: vi.fn(),
}));

vi.mock("@/server/health/readiness", () => ({
  checkDatabaseReadiness: mocks.checkDatabaseReadiness,
}));

vi.mock("@/server/http/ai-admission-budget", () => ({
  validateAiChatAdmissionBudgetConfiguration:
    mocks.validateAiChatAdmissionBudgetConfiguration,
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
import { GET as getCountries } from "@/app/api/countries/route";
import { GET as getHealth } from "@/app/api/health/route";
import { GET as getLiveness } from "@/app/api/health/live/route";
import { GET as getReadiness } from "@/app/api/health/ready/route";
import { POST as updateLocale } from "@/app/api/preferences/locale/route";
import { POST as evaluateProduct } from "@/app/api/product-fit/route";
import { GET as getProducts } from "@/app/api/products/route";
import { PUBLIC_API_CACHE_CONTROL } from "@/server/http/public-api-response";

function expectPublicNoStore(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe(
    PUBLIC_API_CACHE_CONTROL,
  );
  expect(response.headers.get("Pragma")).toBe("no-cache");
}

const productFitInput = {
  applicationScope: "non-road" as const,
  asOf: "2026-08-30",
  countryIso3: "CHN",
  powerKw: 100,
  productModelCode: "DEMO-100",
};

const productNotFoundCheck = {
  code: "PRODUCT_NOT_FOUND" as const,
  message: "No published product evidence was found.",
  status: "unknown" as const,
};

describe("public API route cache policy", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleInfo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.validateAiChatAdmissionBudgetConfiguration.mockImplementation(
      () => undefined,
    );
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleInfo.mockRestore();
  });

  it("prevents caching successful country, product and product-fit responses", async () => {
    mocks.listCountryMapSummaries.mockResolvedValue({
      countries: [],
      status: "ok",
    });
    mocks.getCountryDetails.mockResolvedValue({
      iso3: "CHN",
      status: "no_data",
    });
    mocks.listProducts.mockResolvedValue({ products: [], status: "ok" });
    mocks.evaluateProductFit.mockResolvedValue({
      asOf: productFitInput.asOf,
      commercialReadiness: "unknown",
      input: productFitInput,
      product: null,
      productChecks: {
        applicationScope: productNotFoundCheck,
        availability: productNotFoundCheck,
        power: productNotFoundCheck,
      },
      reasons: [productNotFoundCheck],
      regulationChecks: [],
      rulesetVersion: "product-fit-v2",
      sources: [],
      status: "unknown",
    });

    // Cache policy is independent of the shared public-data concurrency gate;
    // exercise each successful response serially so this test does not
    // intentionally trigger the gate's global limit of two.
    const responses = [
      await getCountries(new Request("http://localhost/api/countries")),
      await getCountry(new Request("http://localhost/api/countries/CHN"), {
        params: Promise.resolve({ iso3: "CHN" }),
      }),
      await getProducts(new Request("http://localhost/api/products")),
      await evaluateProduct(new Request("http://localhost/api/product-fit", {
        body: JSON.stringify(productFitInput),
        headers: { "content-type": "application/json" },
        method: "POST",
      })),
    ];

    responses.forEach(expectPublicNoStore);
    expect(responses.map((response) => response.status)).toEqual([
      200,
      200,
      200,
      200,
    ]);
  });

  it("prevents caching localized validation and service-error envelopes", async () => {
    mocks.listProducts.mockRejectedValue(new Error("database unavailable"));

    const invalidCountry = await getCountry(
      new Request("http://localhost/api/countries/CN", {
        headers: { cookie: "diesel_locale=zh-CN" },
      }),
      { params: Promise.resolve({ iso3: "CN" }) },
    );
    const failedProducts = await getProducts(new Request(
      "http://localhost/api/products",
      { headers: { cookie: "diesel_locale=zh-CN" } },
    ));
    const invalidProductFit = await evaluateProduct(new Request(
      "http://localhost/api/product-fit",
      {
        body: "{}",
        headers: {
          "content-type": "application/json",
          cookie: "diesel_locale=zh-CN",
        },
        method: "POST",
      },
    ));

    [invalidCountry, failedProducts, invalidProductFit].forEach(
      expectPublicNoStore,
    );
    expect(invalidCountry.status).toBe(400);
    expect(failedProducts.status).toBe(500);
    expect(invalidProductFit.status).toBe(400);
  });

  it("prevents caching locale success and error responses", async () => {
    const success = await updateLocale(new Request(
      "http://localhost/api/preferences/locale",
      {
        body: JSON.stringify({ locale: "zh-CN" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));
    const error = await updateLocale(new Request(
      "http://localhost/api/preferences/locale",
      {
        body: "not-json",
        headers: {
          "content-type": "application/json",
          cookie: "diesel_locale=zh-CN",
        },
        method: "POST",
      },
    ));

    expectPublicNoStore(success);
    expectPublicNoStore(error);
    expect(success.status).toBe(200);
    expect(error.status).toBe(400);
  });

  it("prevents caching liveness, health and either readiness outcome", async () => {
    mocks.checkDatabaseReadiness
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const responses = [
      getHealth(),
      getLiveness(),
      await getReadiness(),
      await getReadiness(),
    ];

    responses.forEach(expectPublicNoStore);
    expect(responses.map((response) => response.status)).toEqual([
      200,
      200,
      200,
      503,
    ]);
  });
});
