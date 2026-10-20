import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CustomerBriefDocument } from "@/components/products/customer-brief-document";
import { buildCustomerBrief } from "@/domain/products/customer-brief";
import { evaluateCatalogFit } from "@/domain/products/evaluate-catalog-fit";
import { applicationScopes } from "@/features/database/schemas";
import { catalogCategories, type CatalogFitRegulation, type CatalogRecord, type CatalogSnapshot } from "@/features/product-catalog/schemas";
import { briefCountryName, briefDirection, briefLanguages, customerBriefCopy, formatBriefDate } from "@/i18n/customer-brief";
import { evaluateCatalogFitForMarket } from "@/server/services/catalog-fit-service";

const record: CatalogRecord = {
  id: "00000000-0000-4000-8000-000000000901", model: "DEMO-T-300", series: "DEMO-T", category: "truck", applicationScopes: ["on-road-truck"],
  ratedPowerKw: 300, ratedSpeedRpm: 1900, powerMinKw: 280, powerMaxKw: 320, displacementL: 12, cylinders: 6,
  aftertreatment: "SCR", emissionLabel: "Fictional VI", declaredCitationCodes: ["REG-A", "REG-B"],
};
const regulation = (regulationId: string, citationCode: string, isDemo = true): CatalogFitRegulation => ({
  regulationId, citationCode, canonicalName: `Regulation ${regulationId}`, recordStatus: "effective",
  effectiveFrom: "2020-01-01", effectiveTo: null, jurisdictionCode: "XX", isDemo,
  source: { id: `source-${regulationId}`, title: "Official gazette", url: "https://example.gov/reg", verifiedAt: "2026-01-01T00:00:00.000Z", isDemo },
});
const catalog: CatalogSnapshot = { version: 2, isDemo: true, title: "DEMO ONLY — test", evidenceStatus: "fictional_declaration", notice: "test",
  records: [record, { ...record, id: "00000000-0000-4000-8000-000000000902", model: "DEMO-T-GAP", declaredCitationCodes: ["REG-A"] }, { ...record, id: "00000000-0000-4000-8000-000000000903", model: "DEMO-BUS", applicationScopes: ["on-road-bus"] }] };
const query = { countryIso3: "BRA", applicationScope: "on-road-truck" as const, powerKw: 300, asOf: "2026-10-17" };

describe("customer brief template", () => {
  it("is complete in every language", () => {
    for (const language of briefLanguages) {
      const copy = customerBriefCopy[language];
      expect(Object.keys(copy.scopes).toSorted()).toEqual([...applicationScopes].toSorted());
      expect(Object.keys(copy.categories).toSorted()).toEqual([...catalogCategories].toSorted());
      expect(copy.nextSteps).toHaveLength(4);
      expect(copy.title("X")).toContain("X");
      expect(copy.gapNote(3)).toContain("3");
      expect(copy.regulation.validity("A", "B")).toMatch(/A[\s\S]*B/u);
      for (const text of Object.values(copy.notes)) expect(text.trim().length).toBeGreaterThan(10);
    }
  });

  it("lays out Arabic right to left and localizes dates and country names", () => {
    expect(briefDirection("ar")).toBe("rtl");
    expect(briefLanguages.filter(language => briefDirection(language) === "rtl")).toEqual(["ar"]);
    expect(formatBriefDate("2026-10-17", "es")).toBe("17 de octubre de 2026");
    expect(briefCountryName({ iso2: "BR", nameEn: "Brazil" }, "pt-BR")).toBe("Brasil");
    expect(briefCountryName({ iso2: null, nameEn: "Somewhere" }, "ru")).toBe("Somewhere");
  });
});

describe("customer brief content", () => {
  it("lists only declared matches and copies their covered citations", () => {
    const brief = buildCustomerBrief(evaluateCatalogFit({ catalog, query, applicableRegulations: [regulation("a", "REG-A"), regulation("b", "REG-B", false)] }));
    expect(brief.candidates.map(candidate => [candidate.record.model, candidate.coveredCitations])).toEqual([["DEMO-T-300", ["REG-A", "REG-B"]]]);
    expect(brief.declarationGapCount).toBe(1);
    expect(brief).toMatchObject({ noRegulationData: false, realRegulationData: true, fictionalCatalogue: true });
  });

  it("states missing regulation data instead of recommending anything", () => {
    const brief = buildCustomerBrief(evaluateCatalogFit({ catalog, query, applicableRegulations: [] }));
    expect(brief.candidates).toEqual([]);
    expect(brief.noRegulationData).toBe(true);
    const html = renderToStaticMarkup(CustomerBriefDocument({ brief, countryName: "Brasil", language: "pt-BR", preparedOn: "2026-10-17" }));
    expect(html).toContain(customerBriefCopy["pt-BR"].noRegulations);
    expect(html).toContain(customerBriefCopy["pt-BR"].notes.noData);
  });

  it("renders the selected language with source-language regulation names", () => {
    const brief = buildCustomerBrief(evaluateCatalogFit({ catalog, query, applicableRegulations: [regulation("a", "REG-A"), regulation("b", "REG-B", false)] }));
    const html = renderToStaticMarkup(CustomerBriefDocument({ brief, countryName: "البرازيل", language: "ar", preparedOn: "2026-10-17" }));
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain(customerBriefCopy.ar.title("البرازيل"));
    expect(html).toContain("Regulation a");
    expect(html).toContain(customerBriefCopy.ar.notes.realRegulations);
    expect(html).not.toContain("DEMO-T-GAP");
  });
});

describe("customer brief from the demo database", { timeout: 30_000 }, () => {
  const originalDatabaseMode = process.env.DATABASE_MODE;
  beforeAll(() => { process.env.DATABASE_MODE = "pglite-demo"; });
  afterAll(() => {
    if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
    else process.env.DATABASE_MODE = originalDatabaseMode;
  });

  it("builds the brief from the deterministic selection", async () => {
    const brief = buildCustomerBrief(await evaluateCatalogFitForMarket({ countryIso3: "CHN", applicationScope: "non-road", powerKw: 82, asOf: "2026-10-17" }));
    expect(brief.candidates.map(candidate => candidate.record.model)).toEqual(["DEMO-N4-110"]);
    expect(brief.candidates[0]?.coveredCitations).toEqual(["DEMO-CHN-NR-A"]);
    expect(brief.realRegulationData).toBe(false);
  });
});
