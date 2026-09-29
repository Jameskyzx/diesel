import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCountryDetails: vi.fn(),
  getCountryDirectory: vi.fn(),
  getRequestHeaders: vi.fn(),
  getRequestLocale: vi.fn(),
  isKnownCountryIso3: vi.fn(),
  listCountryMapSummaries: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: mocks.getRequestHeaders,
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

vi.mock("@/components/countries/country-explorer", () => ({
  CountryExplorer: vi.fn(() => null),
}));

vi.mock("@/components/countries/country-initial-panel", () => ({
  CountryInitialPanel: vi.fn(() => null),
}));

vi.mock("@/i18n/server", () => ({
  getRequestLocale: mocks.getRequestLocale,
}));

vi.mock("@/server/services/country-directory", () => ({
  getCountryDirectory: mocks.getCountryDirectory,
  isKnownCountryIso3: mocks.isKnownCountryIso3,
}));

vi.mock("@/server/services/country-service", () => ({
  getCountryDetails: mocks.getCountryDetails,
  listCountryMapSummaries: mocks.listCountryMapSummaries,
}));

import CountryPage from "@/app/countries/[iso3]/page";
import {
  PUBLIC_DATA_OPERATION_TIMEOUT_MS,
  resetPublicDataAdmissionForTests,
  runPublicDataRenderOperation,
} from "@/server/http/public-data-admission";

function createDeferred<T>() {
  let rejectPromise: (error: unknown) => void = () => undefined;
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

const countryDirectoryEntry = {
  hasGeometry: true,
  iso2: "CN",
  iso3: "CHN",
  name: "China",
};
const countryDetail = { iso3: "CHN", status: "no_data" } as const;
const mapResponse = { countries: [], status: "ok" } as const;
const requestHeaders = new Headers({ "x-forwarded-for": "192.0.2.30" });

function renderCountryPage() {
  return CountryPage({
    params: Promise.resolve({ iso3: "CHN" }),
    searchParams: Promise.resolve({}),
  });
}

describe("country page public-data admission", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getCountryDirectory.mockReturnValue([countryDirectoryEntry]);
    mocks.getRequestHeaders.mockResolvedValue(requestHeaders);
    mocks.getRequestLocale.mockResolvedValue("en");
    mocks.isKnownCountryIso3.mockReturnValue(true);
    mocks.notFound.mockImplementation(() => {
      throw new Error("unexpected notFound");
    });
    mocks.redirect.mockImplementation(() => {
      throw new Error("unexpected redirect");
    });
    resetPublicDataAdmissionForTests();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetPublicDataAdmissionForTests();
    consoleError.mockRestore();
  });

  it("defensively normalizes direct page calls before headers or data admission", async () => {
    await expect(CountryPage({
      params: Promise.resolve({ iso3: "chn" }),
      searchParams: Promise.resolve({
        applicationScope: "non-road",
        asOf: "invalid",
        powerKw: ["300.0", "100"],
        utm_term: ["engine", "export"],
      }),
    })).rejects.toThrow("unexpected redirect");
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      "/countries/CHN?applicationScope=non-road&powerKw=300&utm_term=engine&utm_term=export",
    );
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.getRequestHeaders).not.toHaveBeenCalled();
    expect(mocks.getCountryDetails).not.toHaveBeenCalled();
    expect(mocks.listCountryMapSummaries).not.toHaveBeenCalled();
  });

  it("keeps unknown countries at the page 404 boundary before filter normalization", async () => {
    mocks.isKnownCountryIso3.mockReturnValue(false);
    await expect(CountryPage({
      params: Promise.resolve({ iso3: "zzz" }),
      searchParams: Promise.resolve({ powerKw: "invalid" }),
    })).rejects.toThrow("unexpected notFound");
    expect(mocks.isKnownCountryIso3).toHaveBeenCalledExactlyOnceWith("ZZZ");
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getRequestHeaders).not.toHaveBeenCalled();
    expect(mocks.getCountryDetails).not.toHaveBeenCalled();
    expect(mocks.listCountryMapSummaries).not.toHaveBeenCalled();
  });

  it("passes the canonical scope, power and date into the country service", async () => {
    mocks.listCountryMapSummaries.mockResolvedValue(mapResponse);
    mocks.getCountryDetails.mockResolvedValue(countryDetail);
    await expect(CountryPage({
      params: Promise.resolve({ iso3: "CHN" }),
      searchParams: Promise.resolve({
        applicationScope: "non-road",
        asOf: "2026-01-20",
        powerKw: "300",
        productModelCode: "DEMO-ENG-300",
      }),
    })).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getCountryDetails).toHaveBeenCalledExactlyOnceWith(
      { applicationScope: "non-road", asOf: "2026-01-20", iso3: "CHN", powerKw: 300 },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("passes one operation signal to both country data services", async () => {
    const map = createDeferred<typeof mapResponse>();
    const detail = createDeferred<typeof countryDetail>();
    const receivedSignals: AbortSignal[] = [];
    mocks.listCountryMapSummaries.mockImplementation(
      (options: { signal: AbortSignal }) => {
        receivedSignals.push(options.signal);
        return map.promise;
      },
    );
    mocks.getCountryDetails.mockImplementation(
      (_input: unknown, options: { signal: AbortSignal }) => {
        receivedSignals.push(options.signal);
        return detail.promise;
      },
    );

    const pending = renderCountryPage();
    await vi.waitFor(() => {
      expect(mocks.listCountryMapSummaries).toHaveBeenCalledOnce();
      expect(mocks.getCountryDetails).toHaveBeenCalledOnce();
    });
    expect(receivedSignals).toHaveLength(2);
    expect(receivedSignals[0]).toBe(receivedSignals[1]);

    map.resolve(mapResponse);
    detail.resolve(countryDetail);
    await expect(pending).resolves.toBeTruthy();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("keeps the page lease until both branches settle after an early rejection", async () => {
    const map = createDeferred<typeof mapResponse>();
    const detail = createDeferred<typeof countryDetail>();
    const second = createDeferred<string>();
    const secondWork = vi.fn(() => second.promise);
    const excessWork = vi.fn(async () => "must-not-run");
    mocks.listCountryMapSummaries.mockReturnValue(map.promise);
    mocks.getCountryDetails.mockReturnValue(detail.promise);

    const pagePending = renderCountryPage();
    const observedPage = pagePending.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );
    await vi.waitFor(() => {
      expect(mocks.listCountryMapSummaries).toHaveBeenCalledOnce();
      expect(mocks.getCountryDetails).toHaveBeenCalledOnce();
    });

    map.reject(new Error("postgres://public:secret@example.test/database"));
    await Promise.resolve();
    let pageSettled = false;
    void observedPage.then(() => {
      pageSettled = true;
    });
    await Promise.resolve();
    expect(pageSettled).toBe(false);

    // The page's two service branches consume one outer lease, leaving one
    // slot. A third operation is rejected while the detail branch is pending.
    const secondPending = runPublicDataRenderOperation({
      headers: requestHeaders,
      route: "/api/countries",
      work: secondWork,
    });
    await vi.waitFor(() => expect(secondWork).toHaveBeenCalledOnce());
    await expect(
      runPublicDataRenderOperation({
        headers: requestHeaders,
        route: "/api/products",
        work: excessWork,
      }),
    ).resolves.toEqual({ status: "admission_rejected" });
    expect(excessWork).not.toHaveBeenCalled();

    detail.resolve(countryDetail);
    const pageResult = await observedPage;
    expect(pageResult.status).toBe("rejected");
    if (pageResult.status === "rejected") {
      expect(pageResult.error).toEqual(
        new Error("Country page data is temporarily unavailable."),
      );
    }
    expect(consoleError).toHaveBeenCalledWith(
      "Country page data request failed",
      {
        errorCode: "Error",
        route: "/countries/:iso3",
        status: "failed",
      },
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");

    second.resolve("second-finished");
    await expect(secondPending).resolves.toEqual({
      status: "fulfilled",
      value: "second-finished",
    });
  });

  it("does not start either page service when admission is full", async () => {
    const leases = [createDeferred<string>(), createDeferred<string>()];
    const occupied = leases.map((lease, index) =>
      runPublicDataRenderOperation({
        headers: requestHeaders,
        route: `/occupied/${index}`,
        work: () => lease.promise,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    await expect(renderCountryPage()).rejects.toThrow(
      "Country page data is temporarily unavailable.",
    );
    expect(mocks.listCountryMapSummaries).not.toHaveBeenCalled();
    expect(mocks.getCountryDetails).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Country page data request failed",
      {
        errorCode: "PUBLIC_DATA_ADMISSION_REJECTED",
        route: "/countries/:iso3",
        status: "admission_rejected",
      },
    );

    leases.forEach((lease, index) => lease.resolve(`released-${index}`));
    await Promise.all(occupied);
  });

  it("aborts both page branches with the shared render deadline signal", async () => {
    vi.useFakeTimers();
    const map = createDeferred<typeof mapResponse>();
    const detail = createDeferred<typeof countryDetail>();
    const receivedSignals: AbortSignal[] = [];
    mocks.listCountryMapSummaries.mockImplementation(
      (options: { signal: AbortSignal }) => {
        receivedSignals.push(options.signal);
        return map.promise;
      },
    );
    mocks.getCountryDetails.mockImplementation(
      (_input: unknown, options: { signal: AbortSignal }) => {
        receivedSignals.push(options.signal);
        return detail.promise;
      },
    );

    const pending = renderCountryPage();
    const observed = pending.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(receivedSignals).toHaveLength(2);
    expect(receivedSignals[0]).toBe(receivedSignals[1]);
    await vi.advanceTimersByTimeAsync(PUBLIC_DATA_OPERATION_TIMEOUT_MS);
    const result = await observed;
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error).toEqual(
        new Error("Country page data is temporarily unavailable."),
      );
    }
    expect(receivedSignals.every(({ aborted }) => aborted)).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      "Country page data request failed",
      {
        errorCode: "PUBLIC_DATA_TIMED_OUT",
        route: "/countries/:iso3",
        status: "timed_out",
      },
    );

    map.resolve(mapResponse);
    detail.resolve(countryDetail);
    await Promise.all([map.promise, detail.promise]);
    await Promise.resolve();
    await Promise.resolve();
  });

  it("keeps the gate at the page boundary and binds both branches to allSettled", async () => {
    const pageSource = await readFile(
      new URL("../src/app/countries/[iso3]/page.tsx", import.meta.url),
      "utf8",
    );
    expect(pageSource.match(/runPublicDataRenderOperation\(\{/g)).toHaveLength(1);
    expect(pageSource).toContain("Promise.allSettled([");
    expect(pageSource).toContain("listCountryMapSummaries({ signal })");
    expect(pageSource).toContain("getCountryDetails(input, { signal })");
    expect(pageSource).not.toContain("await Promise.all([");

    const lowerLayerPaths = [
      "../src/server/ai/sales-chat.ts",
      "../src/server/services/compatible-products-service.ts",
      "../src/server/services/country-service.ts",
      "../src/server/services/marketing-analysis-service.ts",
      "../src/server/services/product-fit-service.ts",
    ];
    for (const path of lowerLayerPaths) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      expect(source).not.toContain("@/server/http/public-data-admission");
    }
  });
});
