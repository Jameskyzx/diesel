import { describe, expect, it, vi } from "vitest";

import { throwIfRequestAborted } from "@/server/http/request-signal";
import { createCountryRepository } from "@/server/repositories/country-repository";
import { createProductRepository } from "@/server/repositories/product-repository";
import { createRegulationRepository } from "@/server/repositories/regulation-repository";
import {
  getCountryDetails,
  listCountryMapSummaries,
} from "@/server/services/country-service";
import {
  evaluateProductFit,
  listProducts,
} from "@/server/services/product-fit-service";

function createDeferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function createDeferredSelectDatabase() {
  const queries: Array<ReturnType<typeof createDeferred<unknown[]>>> = [];
  const select = vi.fn(() => {
    const deferred = createDeferred<unknown[]>();
    queries.push(deferred);
    const query: object = new Proxy({}, {
      get(_target, property) {
        if (property === "then") {
          return deferred.promise.then.bind(deferred.promise);
        }
        return () => query;
      },
    });
    return query;
  });
  const database = { select } as unknown as Parameters<
    typeof createProductRepository
  >[0];
  return { database, queries, select };
}

const fitInput = {
  applicationScope: "non-road",
  asOf: "2026-08-30",
  countryIso3: "CHN",
  powerKw: 100,
  productModelCode: "DEMO-100",
};

describe("public data request signal", () => {
  it("uses a fixed AbortError instead of exposing the AbortSignal reason", () => {
    const abortController = new AbortController();
    abortController.abort("postgres://user:secret@example.test/database");

    let error: unknown;
    try {
      throwIfRequestAborted(abortController.signal);
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: "AbortError" });
    expect(String(error)).not.toContain("secret");
  });

  it("lets an active signal pass", () => {
    expect(() => throwIfRequestAborted(new AbortController().signal)).not.toThrow();
    expect(() => throwIfRequestAborted()).not.toThrow();
  });

  it("prevents country repository fan-out after its first query is canceled", async () => {
    const fake = createDeferredSelectDatabase();
    const repository = createCountryRepository(fake.database);
    const abortController = new AbortController();
    const pending = repository.findDetailsByIso3(
      { asOf: "2026-08-30", iso3: "CHN" },
      { signal: abortController.signal },
    );
    expect(fake.select).toHaveBeenCalledOnce();

    abortController.abort("client-disconnected");
    // A truthy row makes the uncanceled path enter the three-query detail
    // fan-out; the abort check must stop it before those selects are created.
    fake.queries[0]!.resolve([{}]);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.select).toHaveBeenCalledOnce();
  });

  it("prevents product-fit regulation and certification queries after cancellation", async () => {
    const fake = createDeferredSelectDatabase();
    const repository = createProductRepository(fake.database);
    const abortController = new AbortController();
    const pending = repository.findFitEvidence(fitInput, {
      signal: abortController.signal,
    });
    expect(fake.select).toHaveBeenCalledOnce();

    abortController.abort("client-disconnected");
    fake.queries[0]!.resolve([]);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.select).toHaveBeenCalledOnce();
  });

  it("checks regulation repository cancellation after an active query", async () => {
    const fake = createDeferredSelectDatabase();
    const repository = createRegulationRepository(fake.database);
    const abortController = new AbortController();
    const pending = repository.findEffectiveByCountry(
      {
        applicationScope: "non-road",
        asOf: "2026-08-30",
        countryIso3: "CHN",
        powerKw: 100,
      },
      { signal: abortController.signal },
    );
    expect(fake.select).toHaveBeenCalledOnce();

    abortController.abort("client-disconnected");
    fake.queries[0]!.resolve([]);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.select).toHaveBeenCalledOnce();
  });

  it("fails all four public services before database initialization when pre-aborted", async () => {
    const abortController = new AbortController();
    abortController.abort("client-disconnected");
    const options = { signal: abortController.signal };

    const results = await Promise.allSettled([
      listCountryMapSummaries(options),
      getCountryDetails({ iso3: "CHN" }, options),
      listProducts(options),
      evaluateProductFit(fitInput, options),
    ]);

    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ name: "AbortError" });
      }
    }
  });
});
