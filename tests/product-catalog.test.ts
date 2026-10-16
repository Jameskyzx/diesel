import { describe, it, expect } from "vitest";
import snapshot from "@/data/products/weichai-catalog.json";
import { catalogSnapshotSchema } from "@/features/product-catalog/schemas";
import { importWeichaiCatalog } from "@/domain/products/import-catalog";
import { catalogSummary, searchProductCatalog } from "@/server/services/product-catalog";
import { GET } from "@/app/api/product-catalog/route";

describe("authorized source-reported product catalogue", () => {
  it("retains all source configurations, without treating repeated headers as engines", () => {
    expect(catalogSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(catalogSummary).toMatchObject({ records: 831, models: 589, families: 154, excludedHeaderRows: 32 });
    expect(new Set(snapshot.records.map(r => r.source.familyRow)).size).toBe(154);
    expect(new Set(snapshot.records.map(r => r.id)).size).toBe(831);
    expect(snapshot.records.every(r => r.model !== "型号" && !snapshot.excludedHeaderRows.includes(r.source.row))).toBe(true);
    expect(snapshot.evidenceStatus).toBe("source_reported_unverified");
  });
  it("does not combine model variants or replace their conflicting power values", () => {
    const result = searchProductCatalog({query:"WP11T480E62"});
    expect(result.modelCount).toBe(1);
    expect(new Set(result.records.map(r => r.raw.power)).size).toBeGreaterThan(1);
    expect(result.records.every(r => r.issues.includes("multiple_model_records"))).toBe(true);
  });
  it("uses explicit units only, never treats an ambiguous hyphen as power or invents an interval", () => {
    const ambiguous = searchProductCatalog({recordIds:["weichai-row-837"]}).records[0]!;
    expect(ambiguous.raw.power).toBe("140-2200");
    expect(ambiguous.ratedPowerKw).toBeNull();
    expect(searchProductCatalog({recordIds:[ambiguous.id], minPowerKw:1}).records).toEqual([]);
    expect(searchProductCatalog({recordIds:["weichai-row-2"]}).records[0]).toMatchObject({ratedPowerKw:276,ratedSpeedRpm:1900});
    expect(snapshot.records.filter(r=>r.ratedPowerKw===null)).toHaveLength(197);
  });
  it("preserves non-diesel fuels, family claims, hashes and original provenance", () => {
    const gas = searchProductCatalog({fuel:"天然气"});
    expect(gas.total).toBeGreaterThan(0);
    expect(gas.records.every(r=>r.familyFuel==="天然气")).toBe(true);
    expect(gas.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(gas.records[0]?.source.url).toMatch(/^https:\/\/www.weichaipower.com\//u);
    expect(gas.records[0]?.family).toHaveProperty("powerRange");
  });
  it("validates API bounds and supports exact row selection", async () => {
    expect(GET(new Request("http://localhost/api/product-catalog?limit=1000")).status).toBe(400);
    expect(GET(new Request("http://localhost/api/product-catalog?minPowerKw=400&maxPowerKw=100")).status).toBe(400);
    expect(GET(new Request("http://localhost/api/product-catalog?unknown=1")).status).toBe(400);
    const response = GET(new Request("http://localhost/api/product-catalog?recordIds=weichai-row-2&recordIds=weichai-row-3"));
    expect((await response.json()).records).toHaveLength(2);
  });
  it("fails closed on layout drift rather than guessing a new column mapping", () => {
    expect(()=>importWeichaiCatalog({},"a".repeat(64),"2026-10-16")).toThrow("layout");
  });
});
