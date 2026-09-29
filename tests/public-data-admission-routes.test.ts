import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { GET as getCountries } from "@/app/api/countries/route";
import { POST as evaluateProduct } from "@/app/api/product-fit/route";
import { GET as getProducts } from "@/app/api/products/route";
import {
  PUBLIC_DATA_OPERATION_TIMEOUT_MS,
  resetPublicDataAdmissionForTests,
} from "@/server/http/public-data-admission";
import { PUBLIC_API_CACHE_CONTROL } from "@/server/http/public-api-response";

function createDeferred<T>() {
  let rejectPromise: (error: unknown) => void = () => undefined;
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
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

const routeCases = [
  {
    invoke: (signal?: AbortSignal) =>
      getCountries(new Request("http://localhost/api/countries", {
        headers: { "x-forwarded-for": "192.0.2.10" },
        signal,
      })),
    name: "country summaries",
    service: "listCountryMapSummaries" as const,
    value: { countries: [], status: "ok" },
  },
  {
    invoke: (signal?: AbortSignal) =>
      getCountry(
        new Request("http://localhost/api/countries/CHN", {
          headers: { "x-forwarded-for": "192.0.2.10" },
          signal,
        }),
        { params: Promise.resolve({ iso3: "CHN" }) },
      ),
    name: "country detail",
    service: "getCountryDetails" as const,
    value: { iso3: "CHN", status: "no_data" },
  },
  {
    invoke: (signal?: AbortSignal) =>
      getProducts(new Request("http://localhost/api/products", {
        headers: { "x-forwarded-for": "192.0.2.10" },
        signal,
      })),
    name: "product list",
    service: "listProducts" as const,
    value: { products: [], status: "ok" },
  },
  {
    invoke: (signal?: AbortSignal) =>
      evaluateProduct(new Request("http://localhost/api/product-fit", {
        body: JSON.stringify(productFitInput),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.10",
        },
        method: "POST",
        signal,
      })),
    name: "product fit",
    service: "evaluateProductFit" as const,
    value: {
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
    },
  },
] as const;

describe("public data route admission", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleInfo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    resetPublicDataAdmissionForTests();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetPublicDataAdmissionForTests();
    consoleError.mockRestore();
    consoleInfo.mockRestore();
  });

  it.each(routeCases)(
    "rejects excess $name work before a third service call",
    async ({ invoke, service: serviceName, value }) => {
      const service = mocks[serviceName];
      const deferreds = [createDeferred<unknown>(), createDeferred<unknown>()];
      service
        .mockImplementationOnce(() => deferreds[0]!.promise)
        .mockImplementationOnce(() => deferreds[1]!.promise);

      const first = invoke();
      const second = invoke();
      await vi.waitFor(() => expect(service).toHaveBeenCalledTimes(2));

      const rejected = await invoke();
      expect(rejected.status).toBe(503);
      expect(rejected.headers.get("Retry-After")).toBe("1");
      expect(rejected.headers.get("Cache-Control")).toBe(
        PUBLIC_API_CACHE_CONTROL,
      );
      expect(rejected.headers.get("X-Request-Id")).toBeTruthy();
      await expect(rejected.json()).resolves.toMatchObject({
        error: { code: "INTERNAL_ERROR" },
      });
      expect(service).toHaveBeenCalledTimes(2);

      deferreds.forEach((deferred) => deferred.resolve(value));
      const responses = await Promise.all([first, second]);
      expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    },
  );

  it.each([
    "55.999999999999999999",
    "100000.000000000001",
    "-1e-999",
    "1e-999",
  ])("rejects power string %s before country or product-fit service access", async (powerKw) => {
    const countryQuery = new URLSearchParams({
      applicationScope: productFitInput.applicationScope,
      asOf: productFitInput.asOf,
      powerKw,
    });
    const country = await getCountry(
      new Request(`http://localhost/api/countries/CHN?${countryQuery}`),
      { params: Promise.resolve({ iso3: "CHN" }) },
    );
    // Preserve the string on the wire: raw JSON numbers have already lost their
    // lexical precision after JSON.parse and are outside this input contract.
    const productFit = await evaluateProduct(new Request(
      "http://localhost/api/product-fit",
      {
        body: JSON.stringify({ ...productFitInput, powerKw }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(country.status).toBe(400);
    await expect(country.json()).resolves.toMatchObject({
      error: { code: "INVALID_FILTER" },
    });
    expect(productFit.status).toBe(400);
    await expect(productFit.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    for (const response of [country, productFit]) {
      expect(response.headers.get("Cache-Control")).toBe(PUBLIC_API_CACHE_CONTROL);
      expect(response.headers.get("X-Request-Id")).toBeTruthy();
    }
    expect(mocks.getCountryDetails).not.toHaveBeenCalled();
    expect(mocks.evaluateProductFit).not.toHaveBeenCalled();
  });

  it.each([
    ["5.6e1", 56],
    ["0.0010", 0.001],
    ["300.0", 300],
  ] as const)("preserves exact power string %s in both public API paths", async (rawPower, powerKw) => {
    const input = { ...productFitInput, powerKw };
    const countryValue = routeCases[1].value;
    const productFitValue = { ...routeCases[3].value, input };
    mocks.getCountryDetails.mockResolvedValue(countryValue);
    mocks.evaluateProductFit.mockResolvedValue(productFitValue);
    const countryQuery = new URLSearchParams({
      applicationScope: input.applicationScope,
      asOf: input.asOf,
      powerKw: rawPower,
    });

    const country = await getCountry(
      new Request(`http://localhost/api/countries/CHN?${countryQuery}`),
      { params: Promise.resolve({ iso3: "CHN" }) },
    );
    const productFit = await evaluateProduct(new Request(
      "http://localhost/api/product-fit",
      {
        body: JSON.stringify({ ...input, powerKw: rawPower }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(country.status).toBe(200);
    await expect(country.json()).resolves.toEqual(countryValue);
    expect(productFit.status).toBe(200);
    await expect(productFit.json()).resolves.toEqual(productFitValue);
    expect(mocks.getCountryDetails).toHaveBeenCalledExactlyOnceWith(
      {
        applicationScope: input.applicationScope,
        asOf: input.asOf,
        iso3: input.countryIso3,
        powerKw,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(mocks.evaluateProductFit).toHaveBeenCalledExactlyOnceWith(
      input,
      { signal: expect.any(AbortSignal) },
    );
  });

  it("validates the product-fit body before attempting database admission", async () => {
    const deferreds = [createDeferred<unknown>(), createDeferred<unknown>()];
    mocks.listProducts
      .mockImplementationOnce(() => deferreds[0]!.promise)
      .mockImplementationOnce(() => deferreds[1]!.promise);
    const first = routeCases[2].invoke();
    const second = routeCases[2].invoke();
    await vi.waitFor(() => expect(mocks.listProducts).toHaveBeenCalledTimes(2));

    const invalid = await evaluateProduct(new Request(
      "http://localhost/api/product-fit",
      {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(mocks.evaluateProductFit).not.toHaveBeenCalled();

    deferreds.forEach((deferred) => deferred.resolve(routeCases[2].value));
    await Promise.all([first, second]);
  });

  it("keeps aborted product work admitted until late settlement and sanitizes failure", async () => {
    const controllers = [new AbortController(), new AbortController()];
    const deferreds = [
      createDeferred<(typeof routeCases)[2]["value"]>(),
      createDeferred<(typeof routeCases)[2]["value"]>(),
      createDeferred<(typeof routeCases)[2]["value"]>(),
    ];
    const receivedSignals: AbortSignal[] = [];
    mocks.listProducts.mockImplementation(
      (options: { signal: AbortSignal }) => {
        receivedSignals.push(options.signal);
        return deferreds[receivedSignals.length - 1]!.promise;
      },
    );

    const first = routeCases[2].invoke(controllers[0]!.signal);
    const second = routeCases[2].invoke(controllers[1]!.signal);
    await vi.waitFor(() => expect(mocks.listProducts).toHaveBeenCalledTimes(2));
    controllers.forEach((controller) => controller.abort("client-disconnected"));

    const abortedResponses = await Promise.all([first, second]);
    expect(abortedResponses.map(({ status }) => status)).toEqual([503, 503]);
    expect(receivedSignals.every(({ aborted }) => aborted)).toBe(true);

    const stillRejected = await routeCases[2].invoke();
    expect(stillRejected.status).toBe(503);
    expect(mocks.listProducts).toHaveBeenCalledTimes(2);

    deferreds[0]!.reject(
      new Error("postgres://public:secret@example.test/database"),
    );
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "Public data operation failed after request completion",
        { errorCode: "Error", route: "/api/products" },
      );
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");

    const admittedAfterSettlement = routeCases[2].invoke();
    await vi.waitFor(() => expect(mocks.listProducts).toHaveBeenCalledTimes(3));
    deferreds[1]!.resolve(routeCases[2].value);
    deferreds[2]!.resolve(routeCases[2].value);
    await expect(admittedAfterSettlement).resolves.toMatchObject({ status: 200 });
  });

  it("returns at the 15 second server deadline without releasing pending work", async () => {
    vi.useFakeTimers();
    const deferreds = [
      createDeferred<(typeof routeCases)[0]["value"]>(),
      createDeferred<(typeof routeCases)[0]["value"]>(),
    ];
    mocks.listCountryMapSummaries
      .mockImplementationOnce(() => deferreds[0]!.promise)
      .mockImplementationOnce(() => deferreds[1]!.promise);

    const first = routeCases[0].invoke();
    const second = routeCases[0].invoke();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.listCountryMapSummaries).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(PUBLIC_DATA_OPERATION_TIMEOUT_MS);
    const timedOut = await Promise.all([first, second]);
    expect(timedOut.map(({ status }) => status)).toEqual([503, 503]);
    expect(timedOut.every((response) => response.headers.get("Retry-After") === "1"))
      .toBe(true);

    const rejected = await routeCases[0].invoke();
    expect(rejected.status).toBe(503);
    expect(mocks.listCountryMapSummaries).toHaveBeenCalledTimes(2);

    deferreds.forEach((deferred) => deferred.resolve(routeCases[0].value));
    await Promise.all(deferreds.map(({ promise }) => promise));
    await Promise.resolve();
    await Promise.resolve();
  });
});
