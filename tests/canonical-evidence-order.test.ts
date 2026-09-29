import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { withCanonicalDemoRegulationNames } from "../e2e/helpers/canonical-order-demo-result";

import { compareCanonicalText } from "@/domain/canonical-order";
import { regulationComparisonMatchesDeterministicRules } from "@/domain/marketing/comparison-consistency";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import {
  regulationComparisonModelToolOutputSchema,
  regulationComparisonResultToModelOutput,
} from "@/features/ai/model-tool-output-comparisons";
import { aiToolResultSchema } from "@/features/ai/schemas";
import { buildRegulationComparisonResult } from "@/server/ai/tool-results";
import { getDemoDatabase } from "@/server/db/demo-client";
import { createCountryRepository } from "@/server/repositories/country-repository";
import { createRegulationRepository } from "@/server/repositories/regulation-repository";
import * as productRepository from "@/server/repositories/product-repository";
import { listProducts } from "@/server/services/product-fit-service";
import {
  compareRegulationsFromRepositories,
  type RegulationComparisonRepositories,
} from "@/server/services/marketing-analysis-service";

const runtimeLocales = ["en-US", "zh-CN"] as const;
const nativeLocaleCompare = String.prototype.localeCompare;
const originalDatabaseMode = process.env.DATABASE_MODE;
const query = {
  applicationScope: "non-road",
  asOf: "2026-08-20",
  countryIso3s: ["CHN", "BRA"],
  powerKw: 100,
};
const canonicalNames = ["DEMO ONLY — 中型标准", "DEMO ONLY — 阿型标准"];
let database: Awaited<ReturnType<typeof getDemoDatabase>>;
let repositories: RegulationComparisonRepositories;

function simulateDefaultLocale(locale: string) {
  vi.spyOn(String.prototype, "localeCompare").mockImplementation(
    function (this: string, other, locales, options) {
      return nativeLocaleCompare.call(this, other, locales ?? locale, options);
    },
  );
}

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  database = await getDemoDatabase();
  const originalRows = await createRegulationRepository(database).findForComparison(query);
  const original = originalRows.find(
    (row) => row.countryIso3 === "CHN" && row.status === "effective",
  );
  if (!original) throw new Error("Missing the existing Demo regulation fixture.");
  // Vary the actual Demo repository response in memory only. The extra Demo
  // identity is not inserted into the database or the accepted data corpus.
  const rows = originalRows.map((row) => row.regulationId === original.regulationId
    ? { ...row, canonicalName: canonicalNames[0]! }
    : row);
  rows.push(...originalRows.filter((row) => row.regulationId === original.regulationId)
    .map((row, index) => ({
      ...row,
      canonicalName: canonicalNames[1]!,
      regulationId: "00000000-0000-4000-8000-000000099991",
      limit: {
        ...row.limit,
        id: `00000000-0000-4000-8000-${String(99980 + index).padStart(12, "0")}`,
      },
    })));
  repositories = {
    countryRepository: createCountryRepository(database),
    regulationRepository: { findForComparison: async () => rows },
  };
}, 15_000);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
  await database?.$client.close();
});

describe("canonical evidence order is independent of runtime locale", () => {
  it.each(runtimeLocales.flatMap((producer) =>
    runtimeLocales.map((consumer) => ({ producer, consumer })),
  ))("preserves production evidence from $producer to $consumer", async ({ producer, consumer }) => {
    simulateDefaultLocale(producer);
    const comparison = await compareRegulationsFromRepositories(query, repositories);
    const result = buildRegulationComparisonResult({ comparison, informationAsOf: query.asOf });
    const projection = regulationComparisonResultToModelOutput(result);
    expect(result.status).toBe("ok");
    expect(result.evidenceSufficient).toBe(true);
    expect(comparison.countries[0]?.currentEffectiveRegulations.map((item) => item.canonicalName))
      .toEqual(canonicalNames);

    simulateDefaultLocale(consumer);
    expect(regulationComparisonMatchesDeterministicRules(comparison)).toBe(true);
    expect(aiToolResultSchema.safeParse(result).success).toBe(true);
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
    expect(regulationComparisonModelToolOutputSchema.safeParse(projection).success).toBe(true);

    const reordered = structuredClone(result);
    reordered.comparison.countries[0]!.currentEffectiveRegulations.reverse();
    expect(regulationComparisonMatchesDeterministicRules(reordered.comparison)).toBe(false);
    expect(aiToolResultSchema.safeParse(reordered).success).toBe(false);
    expect(clientAiToolResultSchema.safeParse(reordered).success).toBe(false);
  });

  it.each(runtimeLocales)("normalizes repository product order under %s", async (locale) => {
    simulateDefaultLocale(locale);
    const repository = productRepository.createProductRepository(database);
    const originalProducts = await repository.listProducts();
    expect(originalProducts).toHaveLength(2);
    const rows = originalProducts.map((product, index) => ({
      ...product,
      modelCode: index === 0 ? "阿型-DEMO" : "中型-DEMO",
    }));
    vi.spyOn(productRepository, "createProductRepository").mockReturnValue({
      ...repository,
      listProducts: async () => rows,
    });
    const response = await listProducts();
    expect(response.products.map(({ modelCode }) => modelCode)).toEqual(["中型-DEMO", "阿型-DEMO"]);
    expect(rows.map(({ modelCode }) => modelCode)).toEqual(["阿型-DEMO", "中型-DEMO"]);
    expect(response.products.map(({ id }) => id)).toEqual([rows[1]!.id, rows[0]!.id]);
  });

  it.each(runtimeLocales)("validates the browser transport fixture under %s", async (locale) => {
    simulateDefaultLocale(locale);
    const comparison = await compareRegulationsFromRepositories(query, {
      countryRepository: createCountryRepository(database),
      regulationRepository: createRegulationRepository(database),
    });
    const result = withCanonicalDemoRegulationNames(buildRegulationComparisonResult({
      comparison, informationAsOf: query.asOf,
    }));
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
    expect(result.comparison.countries[0]?.currentEffectiveRegulations.map(({ canonicalName }) => canonicalName))
      .toEqual(canonicalNames);
  });

  it.each([
    { left: "", right: "", expected: 0 },
    { left: "", right: "A", expected: -1 },
    { left: "A", right: "a", expected: -1 },
    { left: "10", right: "2", expected: -1 },
    { left: "中", right: "阿", expected: -1 },
    { left: "Å", right: "Z", expected: 1 },
    { left: "e\u0301", right: "é", expected: -1 },
    { left: "A\u0000a", right: "A\u0000b", expected: -1 },
    { left: "\u{10000}", right: "\ue000", expected: -1 },
  ])("compares exact code units: $left / $right", ({ left, right, expected }) => {
    vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => {
      throw new Error("Canonical ordering must not consult locale collation.");
    });
    expect(compareCanonicalText(left, right)).toBe(expected);
    expect(compareCanonicalText(right, left)).toBe(expected === 0 ? 0 : -expected);
    expect(compareCanonicalText(left, left)).toBe(0);
  });
});
