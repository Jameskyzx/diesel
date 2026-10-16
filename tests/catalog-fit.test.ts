import { describe, expect, it } from "vitest";
import { evaluateCatalogFit, evaluateCatalogRecordFit } from "@/domain/products/evaluate-catalog-fit";
import type { CatalogFitRegulation, CatalogRecord, CatalogSnapshot } from "@/features/product-catalog/schemas";

const record: CatalogRecord = {
  id: "demo-cat-901", model: "DEMO-T-300", series: "DEMO-T", category: "truck", applicationScopes: ["on-road-truck"],
  ratedPowerKw: 300, ratedSpeedRpm: 1900, powerMinKw: 280, powerMaxKw: 320, displacementL: 12, cylinders: 6,
  aftertreatment: "SCR", emissionLabel: "Fictional VI", declaredCitationCodes: ["REG-A", "REG-B"],
};
const regulation = (regulationId: string, citationCode: string | null): CatalogFitRegulation => ({
  regulationId, citationCode, canonicalName: `Regulation ${regulationId}`, recordStatus: "effective",
  effectiveFrom: "2020-01-01", effectiveTo: null, jurisdictionCode: "XX", isDemo: true,
  source: { id: `source-${regulationId}`, title: "DEMO ONLY source", url: null, verifiedAt: "2026-01-01T00:00:00.000Z", isDemo: true },
});
const query = { countryIso3: "CHN", applicationScope: "on-road-truck" as const, powerKw: 300, asOf: "2026-10-17" };

describe("catalog-fit-v1 deterministic rules", () => {
  it("returns declared_match only when every applicable citation is declared", () => {
    expect(evaluateCatalogRecordFit(record, query, [regulation("a", "REG-A"), regulation("b", "REG-B")]))
      .toMatchObject({ status: "declared_match", reason: "DECLARATION_COVERS_ALL_APPLICABLE", undeclaredRegulationIds: [] });
  });

  it("reports a gap for an undeclared or code-less regulation instead of inferring equivalence", () => {
    expect(evaluateCatalogRecordFit(record, query, [regulation("a", "REG-A"), regulation("c", "REG-C"), regulation("n", null)]))
      .toMatchObject({ status: "declaration_gap", declaredRegulationIds: ["a"], undeclaredRegulationIds: ["c", "n"] });
    expect(evaluateCatalogRecordFit(record, query, [regulation("a", "reg-a")]).status).toBe("declaration_gap");
  });

  it("keeps missing regulation data unknown rather than compliant", () => {
    expect(evaluateCatalogRecordFit(record, query, [])).toMatchObject({ status: "unknown", reason: "NO_APPLICABLE_REGULATION_DATA" });
  });

  it("checks scope and the half-open power band before regulations", () => {
    expect(evaluateCatalogRecordFit(record, { ...query, applicationScope: "on-road-bus" }, [regulation("a", "REG-A")]).reason).toBe("APPLICATION_SCOPE_MISMATCH");
    expect(evaluateCatalogRecordFit(record, { ...query, powerKw: 320 }, []).reason).toBe("POWER_OUT_OF_RANGE");
    expect(evaluateCatalogRecordFit(record, { ...query, powerKw: 280 }, []).powerMatch).toBe(true);
  });

  it("orders by status then model and never claims certification", () => {
    const catalog: CatalogSnapshot = {
      version: 2, isDemo: true, title: "DEMO ONLY — test", evidenceStatus: "fictional_declaration", notice: "test",
      records: [
        { ...record, id: "demo-cat-903", model: "DEMO-Z", applicationScopes: ["on-road-bus"] },
        { ...record, id: "demo-cat-902", model: "DEMO-B", declaredCitationCodes: ["REG-A"] },
        { ...record, id: "demo-cat-901", model: "DEMO-A" },
      ],
    };
    const result = evaluateCatalogFit({ catalog, query, applicableRegulations: [regulation("b", "REG-B"), regulation("a", "REG-A")] });
    expect(result.evaluations.map(evaluation => [evaluation.record.model, evaluation.status])).toEqual([
      ["DEMO-A", "declared_match"], ["DEMO-B", "declaration_gap"], ["DEMO-Z", "not_fit"],
    ]);
    expect(result.applicableRegulations.map(item => item.citationCode)).toEqual(["REG-A", "REG-B"]);
    expect(result.counts).toEqual({ declared_match: 1, declaration_gap: 1, unknown: 0, not_fit: 1 });
    expect(result.certificationVerified).toBe(false);
  });
});
