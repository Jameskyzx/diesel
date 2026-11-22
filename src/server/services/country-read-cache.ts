import "server-only";

import { countryDetailQuerySchema } from "@/features/database/schemas";
import type {
  CountryDetailResponse,
  CountryMapResponse,
} from "@/features/countries/schemas";
import {
  throwIfRequestAborted,
  type RequestSignalOptions,
} from "@/server/http/request-signal";
import {
  getCountryDetails,
  listCountryMapSummaries,
} from "@/server/services/country-service";

/**
 * Process-local cache for the two public country reads (ADR-277). Published
 * facts change only through a governance write in this process, which clears
 * the cache, or through a release, which restarts the process. The TTL bounds
 * staleness for anything else, such as a second server process.
 */
export const COUNTRY_READ_CACHE_TTL_MS = 5 * 60_000;
export const COUNTRY_READ_CACHE_MAX_ENTRIES = 500;

type CacheEntry = { expiresAt: number; value: unknown };

export function createReadCache(options: {
  maxEntries: number;
  now?: () => number;
  ttlMs: number;
}) {
  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();
  let generation = 0;

  return {
    clear(): void {
      generation += 1;
      entries.clear();
    },
    async read<T>(key: string, load: () => Promise<T>): Promise<T> {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now()) {
        // Callers get their own copy, so one request cannot change another's.
        return structuredClone(cached.value) as T;
      }
      entries.delete(key);

      const loadGeneration = generation;
      const value = await load();
      // A write that landed while this read was in flight may have changed the
      // facts, so only a read that started after the last clear is stored.
      if (loadGeneration === generation) {
        if (entries.size >= options.maxEntries) {
          const oldest = entries.keys().next();
          if (!oldest.done) entries.delete(oldest.value);
        }
        entries.set(key, {
          expiresAt: now() + options.ttlMs,
          value: structuredClone(value),
        });
      }
      return value;
    },
    get size(): number {
      return entries.size;
    },
  };
}

const cache = createReadCache({
  maxEntries: COUNTRY_READ_CACHE_MAX_ENTRIES,
  ttlMs: COUNTRY_READ_CACHE_TTL_MS,
});

// Development, tests and the mutable local demo always read the database.
function cacheEnabled(): boolean {
  return process.env.NODE_ENV === "production";
}

export function clearCountryReadCache(): void {
  cache.clear();
}

export async function getCachedCountryDetails(
  input: unknown,
  options: RequestSignalOptions = {},
): Promise<CountryDetailResponse> {
  const parsed = countryDetailQuerySchema.safeParse(input);
  if (!cacheEnabled() || !parsed.success) {
    return getCountryDetails(input, options);
  }
  throwIfRequestAborted(options.signal);
  // The default date is part of the key, so an undated query rolls over at
  // UTC midnight with the service's own default.
  const asOf = parsed.data.asOf ?? new Date().toISOString().slice(0, 10);
  const key = JSON.stringify([
    "detail",
    parsed.data.iso3,
    parsed.data.applicationScope ?? null,
    parsed.data.powerKw ?? null,
    asOf,
    parsed.data.marketPeriod ?? null,
  ]);
  return cache.read(key, () =>
    getCountryDetails({ ...parsed.data, asOf }, options),
  );
}

export async function listCachedCountryMapSummaries(
  options: RequestSignalOptions = {},
): Promise<CountryMapResponse> {
  if (!cacheEnabled()) {
    return listCountryMapSummaries(options);
  }
  throwIfRequestAborted(options.signal);
  return cache.read("map", () => listCountryMapSummaries(options));
}
