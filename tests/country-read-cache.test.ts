import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCountryDetails: vi.fn(),
  listCountryMapSummaries: vi.fn(),
}));

vi.mock("@/server/services/country-service", () => ({
  getCountryDetails: mocks.getCountryDetails,
  listCountryMapSummaries: mocks.listCountryMapSummaries,
}));

import {
  clearCountryReadCache,
  createReadCache,
  getCachedCountryDetails,
  listCachedCountryMapSummaries,
} from "@/server/services/country-read-cache";

describe("createReadCache", () => {
  it("serves a stored value until the TTL passes", async () => {
    let now = 1_000;
    const cache = createReadCache({
      maxEntries: 10,
      now: () => now,
      ttlMs: 100,
    });
    const load = vi.fn(async () => ({ rows: [1] }));

    await cache.read("k", load);
    now += 99;
    expect(await cache.read("k", load)).toEqual({ rows: [1] });
    expect(load).toHaveBeenCalledTimes(1);

    now += 1;
    await cache.read("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("gives each caller its own copy", async () => {
    const cache = createReadCache({ maxEntries: 10, ttlMs: 1_000 });
    const first = await cache.read("k", async () => ({ rows: [1] }));
    first.rows.push(2);
    const second = await cache.read("k", async () => ({ rows: [9] }));
    second.rows.push(3);

    expect(await cache.read("k", async () => ({ rows: [9] }))).toEqual({
      rows: [1],
    });
  });

  it("does not store a failed read", async () => {
    const cache = createReadCache({ maxEntries: 10, ttlMs: 1_000 });
    await expect(
      cache.read("k", async () => {
        throw new Error("database unavailable");
      }),
    ).rejects.toThrow("database unavailable");

    expect(await cache.read("k", async () => "ok")).toBe("ok");
  });

  it("does not store a read that was in flight when the cache was cleared", async () => {
    const cache = createReadCache({ maxEntries: 10, ttlMs: 1_000 });
    let release: (value: string) => void = () => undefined;
    const pending = cache.read(
      "k",
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    cache.clear();
    release("before the write");

    expect(await pending).toBe("before the write");
    expect(await cache.read("k", async () => "after the write")).toBe(
      "after the write",
    );
  });

  it("evicts the oldest entry at the size limit", async () => {
    const cache = createReadCache({ maxEntries: 2, ttlMs: 1_000 });
    await cache.read("a", async () => 1);
    await cache.read("b", async () => 2);
    await cache.read("c", async () => 3);

    expect(cache.size).toBe(2);
    const reload = vi.fn(async () => 10);
    await cache.read("a", reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("cached country reads", () => {
  beforeEach(() => {
    mocks.getCountryDetails.mockReset();
    mocks.listCountryMapSummaries.mockReset();
    clearCountryReadCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("always reads the database outside production", async () => {
    mocks.getCountryDetails.mockResolvedValue({
      iso3: "CHN",
      status: "no_data",
    });
    const input = { iso3: "CHN" };

    await getCachedCountryDetails(input);
    await getCachedCountryDetails(input);

    expect(mocks.getCountryDetails).toHaveBeenCalledTimes(2);
    expect(mocks.getCountryDetails).toHaveBeenLastCalledWith(input, {});
  });

  it("reuses a production read for the same query and clears on demand", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.getCountryDetails.mockResolvedValue({
      iso3: "CHN",
      status: "no_data",
    });
    mocks.listCountryMapSummaries.mockResolvedValue({
      countries: [],
      status: "ok",
    });
    const query = {
      applicationScope: "non-road",
      asOf: "2026-08-13",
      iso3: "CHN",
      powerKw: 100,
    };

    await getCachedCountryDetails(query);
    await getCachedCountryDetails(query);
    await getCachedCountryDetails({ ...query, powerKw: 130 });
    await listCachedCountryMapSummaries();
    await listCachedCountryMapSummaries();
    expect(mocks.getCountryDetails).toHaveBeenCalledTimes(2);
    expect(mocks.listCountryMapSummaries).toHaveBeenCalledTimes(1);

    clearCountryReadCache();
    await getCachedCountryDetails(query);
    await listCachedCountryMapSummaries();
    expect(mocks.getCountryDetails).toHaveBeenCalledTimes(3);
    expect(mocks.listCountryMapSummaries).toHaveBeenCalledTimes(2);
  });

  it("keys an undated query by the current UTC date", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T23:59:30Z"));
    mocks.getCountryDetails.mockResolvedValue({
      iso3: "DEU",
      status: "no_data",
    });

    await getCachedCountryDetails({ iso3: "DEU" });
    vi.setSystemTime(new Date("2026-11-11T00:00:10Z"));
    await getCachedCountryDetails({ iso3: "DEU" });

    expect(mocks.getCountryDetails).toHaveBeenCalledTimes(2);
    expect(
      mocks.getCountryDetails.mock.calls.map(([input]) => input.asOf),
    ).toEqual(["2026-11-10", "2026-11-11"]);
  });

  it("does not answer an aborted request from the cache", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.listCountryMapSummaries.mockResolvedValue({
      countries: [],
      status: "ok",
    });
    await listCachedCountryMapSummaries();
    const controller = new AbortController();
    controller.abort();

    await expect(
      listCachedCountryMapSummaries({ signal: controller.signal }),
    ).rejects.toThrow();
  });
});
