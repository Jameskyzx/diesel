import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MarketComparisonFacts } from "@/components/ai/market-comparison-facts";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import { toolPartPresentation } from "@/features/ai/tool-part-presentation";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locale";
import { buildMarketComparisonResult } from "@/server/ai/tool-results";
import { getDemoDatabase } from "@/server/db/demo-client";
import * as marketRepository from "@/server/repositories/market-repository";
import { compareMarkets } from "@/server/services/marketing-analysis-service";

type Rows = Awaited<ReturnType<ReturnType<typeof marketRepository.createMarketRepository>["findForComparison"]>>;
const query = { countryIso3s: ["CHN", "BRA"], metricCodes: ["DEMO_ADDRESSABLE_UNITS"] };
const originalDatabaseMode = process.env.DATABASE_MODE;
let database: Awaited<ReturnType<typeof getDemoDatabase>>;
let demoRows: Rows;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  database = await getDemoDatabase();
  demoRows = await marketRepository.createMarketRepository(database).findForComparison(query);
}, 15_000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
  await database?.$client.close();
});

// Only the repository observation is varied in memory. The production service,
// tool DTO, client validation, and React rendering remain real; no rows are written.
async function renderRows(rows: Rows, locale: Locale, metricCodes: string[] | undefined = query.metricCodes) {
  vi.spyOn(marketRepository, "createMarketRepository").mockReturnValue({ findForComparison: async () => rows });
  const comparison = await compareMarkets({ countryIso3s: query.countryIso3s, metricCodes });
  const result = clientAiToolResultSchema.parse(buildMarketComparisonResult({ comparison, informationAsOf: "2026-08-20" }));
  if (result.tool !== "compareMarkets") throw new Error("Expected market comparison");
  return { result, html: renderToStaticMarkup(createElement(MarketComparisonFacts, { comparison: result.comparison, locale })) };
}

const issueCases = [
  { code: "MISSING_COUNTRY_OBSERVATION", key: "marketIssueMissingCountry", vary: (rows: Rows) => rows.slice(0, 1) },
  { code: "AMBIGUOUS_LATEST_OBSERVATION", key: "marketIssueAmbiguousLatest", vary: (rows: Rows) => [...rows, { ...rows[0]!, id: "00000000-0000-4000-8000-000000000799", source: { ...rows[0]!.source, id: "00000000-0000-4000-8000-000000000899", title: "DEMO ONLY — Independent fixture source" } }] },
  { code: "MISSING_UNIT", key: "marketIssueMissingUnit", vary: (rows: Rows) => rows.map((row) => ({ ...row, unitCode: " \t\n" })) },
  { code: "MISSING_DEFINITION", key: "marketIssueMissingDefinition", vary: (rows: Rows) => rows.map((row) => ({ ...row, definition: " \t\n" })) },
  { code: "MISSING_METHODOLOGY", key: "marketIssueMissingMethodology", vary: (rows: Rows) => rows.map((row) => ({ ...row, methodologyVersion: " \t\n" })) },
  { code: "APPLICATION_SCOPE_MISMATCH", key: "marketIssueApplication", vary: (rows: Rows) => rows.map((row, index) => index ? { ...row, applicationScope: "marine" as const } : row) },
  { code: "UNIT_MISMATCH", key: "marketIssueUnit", vary: (rows: Rows) => rows.map((row, index) => index ? { ...row, unitCode: "kW" } : row) },
  { code: "CURRENCY_MISMATCH", key: "marketIssueCurrency", vary: (rows: Rows) => rows.map((row, index) => index ? { ...row, currencyCode: "USD" } : row) },
  { code: "DEFINITION_MISMATCH", key: "marketIssueDefinition", vary: (rows: Rows) => rows.map((row, index) => index ? { ...row, definition: "DEMO ONLY — Different observation definition" } : row) },
  { code: "METHODOLOGY_MISMATCH", key: "marketIssueMethodology", vary: (rows: Rows) => rows.map((row, index) => index ? { ...row, methodologyVersion: "demo-v2" } : row) },
  { code: "PERIOD_MISMATCH", key: "marketIssuePeriod", vary: (rows: Rows) => rows.map((row, index) => index ? { ...row, periodStart: "2024-01-01", periodEnd: "2025-01-01" } : row) },
] as const;

for (const locale of ["en", "zh-CN"] as const) {
  describe(`market comparison facts in ${locale}`, () => {
    it("renders actual Demo observations with their basis and original source titles", async () => {
      const { html, result } = await renderRows(demoRows, locale);
      const dictionary = getDictionary(locale);
      expect(result.status).toBe("ok");
      expect(result.evidenceSufficient).toBe(true);
      expect(html).toContain("12,345 units");
      expect(html).toContain("6,789 units");
      expect(html).toContain(dictionary.chat.marketPeriodStart);
      expect(html).toContain(dictionary.chat.marketPeriodEnd);
      expect(html).toContain(locale === "en" ? "Jan 1, 2025" : "2025年1月1日");
      expect(html).toContain(locale === "en" ? "Jan 1, 2026" : "2026年1月1日");
      expect(html).not.toContain(locale === "en" ? "Aug 20, 2026" : "2026年8月20日");
      expect(html).toContain(dictionary.country.demoMarketMetricDefinition);
      expect(html).toContain("demo-v1");
      expect(html).toContain(demoRows[0]!.source.title);
      expect(html).not.toContain(dictionary.chat.marketComparisonIssues);
      expect(html.match(/role="group"/gu)).toHaveLength(2);
    });

    it.each(issueCases)("explains $code without overriding its deterministic failure", async ({ code, key, vary }) => {
      const { result, html } = await renderRows(vary(structuredClone(demoRows)), locale);
      expect(result.status).toBe("no_data");
      expect(result.evidenceSufficient).toBe(false);
      expect(result.comparison.metrics[0]!.issues).toEqual([code]);
      expect(html).toContain(getDictionary(locale).chat[key]);
      expect(html).toContain(`aria-label="${getDictionary(locale).chat.marketComparisonIssues}"`);
      expect(html).not.toContain(code);
      if (code === "MISSING_UNIT") expect(html).toContain(getDictionary(locale).chat.marketUnitNotRecorded);
    });

    it.each([query.metricCodes, undefined])("shows the empty observation state without inventing a basis: %s", async (metricCodes) => {
      // Omitting the code is separate from renderRows' default argument.
      vi.spyOn(marketRepository, "createMarketRepository").mockReturnValue({ findForComparison: async () => [] });
      const comparison = await compareMarkets({ countryIso3s: query.countryIso3s, metricCodes });
      const result = clientAiToolResultSchema.parse(buildMarketComparisonResult({ comparison, informationAsOf: "2026-08-20" }));
      expect(result.status).toBe("no_data");
      expect(result.evidenceSufficient).toBe(false);
      if (result.tool !== "compareMarkets") throw new Error("Expected market comparison");
      expect(toolPartPresentation({ type: "tool-compareMarkets", state: "output-available", input: { countryIso3s: query.countryIso3s, metricCodes }, output: result }).kind).toBe("result");
      const html = renderToStaticMarkup(createElement(MarketComparisonFacts, { comparison: result.comparison, locale }));
      expect(html).toContain(getDictionary(locale).chat.noObservations);
      expect(html).not.toContain("role=\"group\"");
      if (result.comparison.metrics.length > 0) {
        const forgedName = structuredClone(result);
        forgedName.comparison.metrics[0]!.metricName = "Invented forecast label";
        expect(clientAiToolResultSchema.safeParse(forgedName).success).toBe(false);
        expect(clientAiToolResultSchema.safeParse({ ...result, status: "ok", evidenceSufficient: true }).success).toBe(false);
      }
    });

    it.each([1, 2])("still requires citations for %s actual observation(s)", async (count) => {
      const { result } = await renderRows(demoRows.slice(0, count), locale);
      const parsed = clientAiToolResultSchema.safeParse({ ...result, citations: [], latestVerifiedAt: null });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.some(({ message }) => message === "Visible structured facts require a citation")).toBe(true);
    });

    it.each(["", " \t\n"])("marks missing observation metadata as unrecorded, not not-applicable: [%s]", async (blank) => {
      const rows = demoRows.map((row) => ({ ...row, applicationScope: null, currencyCode: null, methodologyVersion: blank, definition: blank }));
      const { html, result } = await renderRows(rows, locale);
      expect(result).toMatchObject({ status: "no_data", evidenceSufficient: false });
      const missing = getDictionary(locale).common.notRecorded;
      expect(html.match(new RegExp(`<dd(?: [^>]*)?>${missing}</dd>`, "gu"))).toHaveLength(8);
      expect(html).not.toMatch(/Not applicable|不适用/u);
    });

    it("preserves unknown definitions and decimal precision without rendering raw HTML", async () => {
      const rows = demoRows.map((row) => ({ ...row,
        definition: "DEMO ONLY <img src=x onerror=alert(1)> raw definition",
        valueNumeric: "9007199254740993.123456",
      }));
      const { html } = await renderRows(rows, locale);
      expect(html).toContain("9,007,199,254,740,993.123456");
      expect(html).toContain("DEMO ONLY &lt;img");
      expect(html).toContain("raw definition");
      expect(html).not.toContain("<img");
    });
  });
}
