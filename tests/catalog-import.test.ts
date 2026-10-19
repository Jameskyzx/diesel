import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogSheetHeaders, parseCatalogSheet } from "@/domain/admin/parse-catalog-sheet";
import { demoCatalogSourceId } from "@/server/db/seed/demo-engine-catalog";
import {
  archiveGovernedEntity,
  confirmCatalogImport,
  getGovernanceDashboard,
  previewCatalogSpreadsheet,
  publishGovernanceDraft,
  reviewGovernanceDraft,
} from "@/server/services/governance-service";
import { loadPublishedCatalog } from "@/server/services/product-catalog";
import { buildXlsx } from "./helpers/xlsx";

const editor = { email: "catalogue-editor@example.test", role: "editor" as const };
const reviewer = { email: "catalogue-reviewer@example.test", role: "reviewer" as const };
const admin = { email: "catalogue-admin@example.test", role: "admin" as const };

function row(model: string, overrides: Partial<Record<(typeof catalogSheetHeaders)[number], string | number | boolean>> = {}) {
  const values: Record<(typeof catalogSheetHeaders)[number], string | number | boolean> = {
    model_code: model, series: "DEMO-X", category: "construction", application_scopes: "construction; agriculture",
    rated_power_kw: 120, rated_speed_rpm: 2200, power_min_kw: 100, power_max_kw: 140, displacement_l: 6.7, cylinders: 6,
    aftertreatment: "DOC + DPF", emission_label: "EU Stage V",
    declared_citation_codes: "CELEX:32016R1628; Decreto 135/021 arts. 42, 45, 48 and Table 17",
    data_source_id: demoCatalogSourceId, verified_at: "2026-10-01T00:00:00.000Z", is_demo: true, ...overrides,
  };
  return catalogSheetHeaders.map(header => values[header]);
}

describe("catalogue spreadsheet parser", () => {
  it("parses rows, ';'-separated lists and booleans into governed payloads", () => {
    const preview = parseCatalogSheet([[...catalogSheetHeaders], row("demo-x-120")]);
    expect(preview.errors).toEqual([]);
    expect(preview.rows[0]).toMatchObject({ rowNumber: 2, parsed: {
      modelCode: "DEMO-X-120", applicationScopes: ["construction", "agriculture"], isDemo: true,
      declaredCitationCodes: ["CELEX:32016R1628", "Decreto 135/021 arts. 42, 45, 48 and Table 17"],
    } });
  });

  it("fails the whole sheet on missing, unknown or duplicated columns instead of guessing", () => {
    const headers = catalogSheetHeaders.filter(header => header !== "emission_label");
    expect(parseCatalogSheet([[...headers, "notes"], []]).errors[0]?.message).toMatch(/Missing columns: emission_label\. Unknown columns: notes\./u);
    expect(parseCatalogSheet([[...catalogSheetHeaders, "series"]]).errors[0]?.message).toMatch(/Duplicated columns: series/u);
  });

  it("reports invalid cells by spreadsheet column and rejects duplicate models", () => {
    const preview = parseCatalogSheet([[...catalogSheetHeaders], row("DEMO-X-1", { rated_power_kw: 150 }),
      row("DEMO-X-2", { category: "aircraft" }), row("DEMO-X-3"), [], row("demo-x-3")]);
    expect(preview.rows.map(({ rowNumber }) => rowNumber)).toEqual([2, 3, 4, 6]);
    expect(preview.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "rated_power_kw", rowNumber: 2 }),
      expect.objectContaining({ field: "category", rowNumber: 3 }),
      expect.objectContaining({ field: "model_code", rowNumber: 6, message: "Model DEMO-X-3 already appears on row 4." }),
    ]));
  });
});

describe("catalogue import through governance", { timeout: 30_000 }, () => {
  const originalDatabaseMode = process.env.DATABASE_MODE;
  beforeAll(() => { process.env.DATABASE_MODE = "pglite-demo"; });
  afterAll(() => {
    if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
    else process.env.DATABASE_MODE = originalDatabaseMode;
  });

  it("previews without writing, then drafts, reviews and publishes into the public catalogue", async () => {
    const workbook = buildXlsx([[...catalogSheetHeaders], row("DEMO-IMPORT-120"), row("DEMO-IMPORT-130", { rated_power_kw: 130 })]);
    const preview = await previewCatalogSpreadsheet({ content: workbook, fileName: "catalogue.xlsx" }, editor);
    expect(preview).toMatchObject({ status: "previewed", totalRows: 2, validRows: 2, invalidRows: 0 });
    expect((await loadPublishedCatalog()).records.some(record => record.model === "DEMO-IMPORT-120")).toBe(false);

    await expect(confirmCatalogImport({ actor: editor, batchId: preview.batchId, reason: "Import two demo engines." }))
      .resolves.toEqual({ createdDrafts: 2, status: "committed" });
    const drafts = (await getGovernanceDashboard(reviewer)).drafts
      .filter(draft => draft.entityType === "catalog_engine" && String(draft.payload.modelCode).startsWith("DEMO-IMPORT-"));
    expect(drafts).toHaveLength(2);
    for (const draft of drafts) {
      await reviewGovernanceDraft({ actor: reviewer, draftId: draft.id, reason: "Checked against the workbook." });
      await publishGovernanceDraft({ actor: reviewer, draftId: draft.id, reason: "Publish reviewed demo engine." });
    }
    const published = (await loadPublishedCatalog()).records.find(record => record.model === "DEMO-IMPORT-120");
    expect(published).toMatchObject({ category: "construction", declaredCitationCodes: ["CELEX:32016R1628", "Decreto 135/021 arts. 42, 45, 48 and Table 17"] });

    await archiveGovernedEntity({ actor: admin, entityKey: published!.id, entityType: "catalog_engine", reason: "Retire the test engine." });
    expect((await loadPublishedCatalog()).records.some(record => record.model === "DEMO-IMPORT-120")).toBe(false);
  });

  it("rejects a batch with invalid rows and an unreadable workbook without creating drafts", async () => {
    const invalid = await previewCatalogSpreadsheet({ content: buildXlsx([[...catalogSheetHeaders], row("DEMO-BAD-1", { power_max_kw: 90 })]), fileName: "bad.xlsx" }, editor);
    expect(invalid).toMatchObject({ invalidRows: 1, validRows: 0 });
    await expect(confirmCatalogImport({ actor: editor, batchId: invalid.batchId, reason: "Try the invalid batch." }))
      .resolves.toEqual({ createdDrafts: 0, status: "rejected" });

    const unreadable = await previewCatalogSpreadsheet({ content: new TextEncoder().encode("not a workbook"), fileName: "fake.xlsx" }, editor);
    expect(unreadable.errors).toEqual([{ field: null, rowNumber: 1, message: "The file is not a readable .xlsx workbook." }]);
    await expect(previewCatalogSpreadsheet({ content: buildXlsx([[...catalogSheetHeaders]]), fileName: "catalogue.csv" }, editor)).rejects.toThrow();
  });

  it("refuses to publish a second active entity for an existing model", async () => {
    const preview = await previewCatalogSpreadsheet({ content: buildXlsx([[...catalogSheetHeaders], row("DEMO-H13-460", { category: "truck",
      application_scopes: "on-road-truck", rated_power_kw: 338, power_min_kw: 300, power_max_kw: 360 })]), fileName: "dup.xlsx" }, editor);
    await confirmCatalogImport({ actor: editor, batchId: preview.batchId, reason: "Import a duplicate model." });
    const [draft] = (await getGovernanceDashboard(reviewer)).drafts.filter(item => item.entityType === "catalog_engine" && item.payload.modelCode === "DEMO-H13-460");
    await reviewGovernanceDraft({ actor: reviewer, draftId: draft!.id, reason: "Review the duplicate." });
    await expect(publishGovernanceDraft({ actor: reviewer, draftId: draft!.id, reason: "Publish the duplicate." })).rejects.toThrow(/already belongs to entity/u);
  });
});
