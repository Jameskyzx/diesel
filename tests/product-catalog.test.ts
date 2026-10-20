import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import snapshot from "@/server/db/seed/demo-engine-catalog.json";
import { catalogSnapshotSchema } from "@/features/product-catalog/schemas";
import { demoEngineCatalogFixture } from "@/server/db/seed/demo-engine-catalog";
import { loadPublishedCatalog, searchProductCatalog, summarizeCatalog } from "@/server/services/product-catalog";
import { GET } from "@/app/api/product-catalog/route";
import { evaluateCatalogFitForMarket } from "@/server/services/catalog-fit-service";

const originalDatabaseMode = process.env.DATABASE_MODE;
beforeAll(() => { process.env.DATABASE_MODE = "pglite-demo"; });
afterAll(() => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
});

const [h13, h13e] = ["DEMO-H13-460", "DEMO-H13-460E"].map(model => demoEngineCatalogFixture.records.find(record => record.model === model)!);

describe("fictional demo engine catalogue fixture", () => {
  it("is explicitly fictional and names no real manufacturer", () => {
    expect(catalogSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(demoEngineCatalogFixture).toMatchObject({ isDemo: true, evidenceStatus: "fictional_declaration" });
    expect(demoEngineCatalogFixture.title).toMatch(/^DEMO ONLY/u);
    expect(demoEngineCatalogFixture.records).toHaveLength(24);
    expect(demoEngineCatalogFixture.records.every(record => record.model.startsWith("DEMO-") && record.series.startsWith("DEMO-"))).toBe(true);
    const raw = readFileSync("src/server/db/seed/demo-engine-catalog.json", "utf8");
    expect(raw).not.toMatch(/weichai|潍柴|https?:\/\//iu);
  });

  it("rejects a rated power outside the declared half-open band", () => {
    const [record] = demoEngineCatalogFixture.records;
    const broken = { ...snapshot, records: [{ ...record, ratedPowerKw: record!.powerMaxKw }] };
    expect(catalogSnapshotSchema.safeParse(broken).success).toBe(false);
  });
});

describe("published catalogue read", { timeout: 30_000 }, () => {
  it("serves the published demo rows from the governed table", async () => {
    const catalog = await loadPublishedCatalog();
    expect(catalog).toMatchObject({ isDemo: true, evidenceStatus: "fictional_declaration" });
    expect(catalog.records.map(record => record.model)).toEqual(expect.arrayContaining(demoEngineCatalogFixture.records.map(record => record.model)));
    expect(summarizeCatalog(catalog).series).toBeGreaterThanOrEqual(13);
  });

  it("searches model, series and declaration text and filters by category and rated power", async () => {
    expect((await searchProductCatalog({ query: "DEMO-H13" })).records.map(record => record.model)).toEqual(["DEMO-H13-460", "DEMO-H13-460E"]);
    expect((await searchProductCatalog({ query: "stage v" })).records.every(record => /stage v/iu.test(record.emissionLabel))).toBe(true);
    expect((await searchProductCatalog({ category: "bus" })).records.every(record => record.category === "bus")).toBe(true);
    const band = await searchProductCatalog({ minPowerKw: 200, maxPowerKw: 300, limit: 20 });
    expect(band.total).toBeGreaterThan(0);
    expect(band.records.every(record => record.ratedPowerKw >= 200 && record.ratedPowerKw <= 300)).toBe(true);
  });

  it("validates API bounds and supports exact record selection", async () => {
    expect((await GET(new Request("http://localhost/api/product-catalog?limit=1000"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/product-catalog?minPowerKw=400&maxPowerKw=100"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/product-catalog?unknown=1"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/product-catalog?recordIds=weichai-row-2"))).status).toBe(400);
    const response = await GET(new Request(`http://localhost/api/product-catalog?recordIds=${h13!.id}&recordIds=${h13e!.id}`));
    expect(response.status).toBe(200);
    expect((await response.json()).records).toHaveLength(2);
  });
});

describe("catalogue fit against the fictional demo regulations", { timeout: 30_000 }, () => {
  it("ranks declared matches first and reads only regulations in force on the query date", async () => {
    const result = await evaluateCatalogFitForMarket({ countryIso3: "CHN", applicationScope: "non-road", powerKw: 82, asOf: "2026-10-17" });
    expect(result).toMatchObject({ kind: "catalog_fit", rulesetVersion: "catalog-fit-v1", certificationVerified: false, evidenceBasis: "manufacturer_declaration" });
    // The proposed and future adopted demo regulations are never in force; the superseded one ended in 2025.
    expect(result.applicableRegulations.map(regulation => regulation.citationCode)).toEqual(["DEMO-CHN-NR-A"]);
    expect(result.evaluations[0]).toMatchObject({ status: "declared_match", record: { model: "DEMO-N4-110" } });
    expect(result.counts.declared_match).toBe(1);
    expect(result.evaluations.filter(evaluation => evaluation.status !== "not_fit").map(evaluation => evaluation.record.model)).toEqual(["DEMO-N4-110"]);
  });

  it("keeps the superseded demo regulation inside its historical interval", async () => {
    const result = await evaluateCatalogFitForMarket({ countryIso3: "CHN", applicationScope: "non-road", powerKw: 82, asOf: "2022-06-01" });
    expect(result.applicableRegulations).toEqual([expect.objectContaining({ citationCode: "DEMO-CHN-NR-Z", recordStatus: "superseded" })]);
    expect(result.evaluations.find(evaluation => evaluation.record.model === "DEMO-N4-110")).toMatchObject({ status: "declaration_gap" });
  });

  it("isolates countries and keeps missing regulation data unknown", async () => {
    const brazil = await evaluateCatalogFitForMarket({ countryIso3: "BRA", applicationScope: "non-road", powerKw: 66, asOf: "2026-10-17" });
    expect(brazil.applicableRegulations.map(regulation => regulation.citationCode)).toEqual(["DEMO-BRA-NR-A"]);
    expect(brazil.evaluations.find(evaluation => evaluation.record.model === "DEMO-A4-90")).toMatchObject({ status: "declared_match" });

    const marine = await evaluateCatalogFitForMarket({ countryIso3: "CHN", applicationScope: "marine", powerKw: 184, asOf: "2026-10-17" });
    expect(marine.applicableRegulations).toEqual([]);
    expect(marine.evaluations.find(evaluation => evaluation.record.model === "DEMO-W6-250")).toMatchObject({ status: "unknown", reason: "NO_APPLICABLE_REGULATION_DATA" });
    expect(marine.counts.declared_match).toBe(0);
  });
});
