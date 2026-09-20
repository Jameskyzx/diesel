import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  selectCountryDetailState,
  type CountryDetailQueryIdentity,
  type CountryDetailState,
} from "@/features/countries/detail-state";
import type { CountryDetailResponse } from "@/features/countries/schemas";
import { getCountryDetails } from "@/server/services/country-service";

type AvailableCountryDetail = Extract<
  CountryDetailResponse,
  { status: "available" }
>;

const asOf = "2026-01-20";
const query: CountryDetailQueryIdentity = {
  applicationScope: "non-road",
  asOf,
  iso3: "CHN",
  powerKw: 100,
};
const nextQuery: CountryDetailQueryIdentity = {
  ...query,
  applicationScope: "marine",
  powerKw: 150,
};
const noData: CountryDetailResponse = { iso3: "CHN", status: "no_data" };
const originalDatabaseMode = process.env.DATABASE_MODE;
let originalResponse: AvailableCountryDetail;
let latestResponse: AvailableCountryDetail;

function requireAvailable(
  response: CountryDetailResponse,
): AvailableCountryDetail {
  if (response.status !== "available") {
    throw new Error("Expected an available Demo country detail fixture.");
  }
  return response;
}

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  [originalResponse, latestResponse] = await Promise.all([
    getCountryDetails({
      applicationScope: "non-road",
      asOf,
      iso3: "CHN",
      powerKw: 100,
    }).then(requireAvailable),
    getCountryDetails({
      applicationScope: "marine",
      asOf,
      iso3: "CHN",
      powerKw: 150,
    }).then(requireAvailable),
  ]);
});

afterAll(() => {
  if (originalDatabaseMode === undefined) {
    delete process.env.DATABASE_MODE;
  } else {
    process.env.DATABASE_MODE = originalDatabaseMode;
  }
});

function ready(
  identity: CountryDetailQueryIdentity = query,
  response: CountryDetailResponse = originalResponse,
): CountryDetailState {
  return { query: identity, response, status: "ready" };
}

function error(
  identity: CountryDetailQueryIdentity = query,
): CountryDetailState {
  return { code: "INTERNAL_ERROR", query: identity, status: "error" };
}

describe("country-detail render state", () => {
  it("returns idle without a selected query even when older data exists", () => {
    expect(selectCountryDetailState({
      detail: ready(),
      initialResponse: latestResponse,
      query: null,
    })).toEqual({ status: "idle" });
  });

  it("returns loading when a selected query has neither SSR nor local data", () => {
    expect(selectCountryDetailState({
      detail: { status: "idle" },
      query,
    })).toEqual({ iso3: "CHN", status: "loading" });
  });

  it("uses each latest SSR response instead of retaining an older local snapshot", () => {
    const detail = ready();
    expect(selectCountryDetailState({
      detail,
      initialResponse: originalResponse,
      query,
    })).toEqual({ query, response: originalResponse, status: "ready" });

    const current = selectCountryDetailState({
      detail,
      initialResponse: latestResponse,
      query: nextQuery,
    });
    expect(current).toEqual({
      query: nextQuery,
      response: latestResponse,
      status: "ready",
    });
    if (current.status !== "ready") throw new Error("Expected current SSR data.");
    expect(current.response).toBe(latestResponse);
    expect(detail).toEqual(ready(query, originalResponse));
  });

  it("prefers a successful SSR response over a matching local error", () => {
    expect(selectCountryDetailState({
      detail: error(),
      initialResponse: originalResponse,
      query,
    })).toEqual({ query, response: originalResponse, status: "ready" });
  });

  it("can switch available SSR data to no-data and back without a remount", () => {
    expect(selectCountryDetailState({
      detail: ready(),
      initialResponse: noData,
      query,
    })).toEqual({ query, response: noData, status: "ready" });
    expect(selectCountryDetailState({
      detail: ready(query, noData),
      initialResponse: originalResponse,
      query,
    })).toEqual({ query, response: originalResponse, status: "ready" });
  });

  it("reuses an exact local ready, no-data, or error state", () => {
    for (const detail of [ready(), ready(query, noData), error()]) {
      expect(selectCountryDetailState({ detail, query })).toBe(detail);
    }
  });

  it.each([
    { change: { iso3: "BRA" }, label: "country" },
    { change: { applicationScope: "marine" }, label: "scope" },
    { change: { applicationScope: null }, label: "missing scope" },
    { change: { powerKw: 150 }, label: "power" },
    { change: { powerKw: null }, label: "missing power" },
    { change: { asOf: "2026-01-21" }, label: "date" },
    { change: { asOf: null }, label: "removed explicit date" },
  ] satisfies Array<{
    change: Partial<CountryDetailQueryIdentity>;
    label: string;
  }>)("does not reuse local results or errors across a changed $label", ({ change }) => {
    const changedQuery = { ...query, ...change };
    for (const detail of [ready(), ready(query, noData), error()]) {
      expect(selectCountryDetailState({ detail, query: changedQuery })).toEqual({
        iso3: changedQuery.iso3,
        status: "loading",
      });
    }
  });

  it("reuses a default-date available response when its resolved date enters the URL", () => {
    const detail = ready({ ...query, asOf: null });
    expect(selectCountryDetailState({ detail, query })).toBe(detail);
  });

  it.each([
    { change: { iso3: "BRA" }, label: "country" },
    { change: { applicationScope: "marine" }, label: "scope" },
    { change: { applicationScope: null }, label: "missing scope" },
    { change: { powerKw: 150 }, label: "power" },
    { change: { powerKw: null }, label: "missing power" },
  ] satisfies Array<{
    change: Partial<CountryDetailQueryIdentity>;
    label: string;
  }>)("does not use default-date equivalence across a changed $label", ({ change }) => {
    const changedQuery = { ...query, ...change };
    expect(selectCountryDetailState({
      detail: ready({ ...query, asOf: null }),
      query: changedQuery,
    })).toEqual({ iso3: changedQuery.iso3, status: "loading" });
  });

  it("does not treat an error or no-data response as a resolved default date", () => {
    const defaultDateQuery = { ...query, asOf: null };
    for (const detail of [error(defaultDateQuery), ready(defaultDateQuery, noData)]) {
      expect(selectCountryDetailState({ detail, query })).toEqual({
        iso3: "CHN",
        status: "loading",
      });
    }
  });

  it("does not reuse a default-date response for a different explicit date", () => {
    expect(selectCountryDetailState({
      detail: ready({ ...query, asOf: null }),
      query: { ...query, asOf: "2026-01-21" },
    })).toEqual({ iso3: "CHN", status: "loading" });
  });

  it("does not use response.asOf to forgive a different explicit local query date", () => {
    expect(selectCountryDetailState({
      detail: ready({ ...query, asOf: "2026-01-19" }),
      query,
    })).toEqual({ iso3: "CHN", status: "loading" });
  });

  it("reuses a matching all-default query without guessing scope or power", () => {
    const defaultQuery: CountryDetailQueryIdentity = {
      applicationScope: null,
      asOf: null,
      iso3: "CHN",
      powerKw: null,
    };
    const detail = ready(defaultQuery);
    expect(selectCountryDetailState({ detail, query: defaultQuery })).toBe(detail);
  });
});
