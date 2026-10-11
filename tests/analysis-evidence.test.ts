import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ComparisonResults } from "@/components/analyses/comparison-results";
import { SourceExcerpt } from "@/components/analyses/source-review";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { comparisonSnapshotSchema, type ComparisonSnapshot } from "@/features/analyses/schemas";
import { getDictionary } from "@/i18n/dictionaries";
import { getCountryDetails } from "@/server/services/country-service";
import { buildComparisonRows, formatRecordedLimit } from "@/features/analyses/comparison-rows";

const previousMode = process.env.DATABASE_MODE;
let snapshot: ComparisonSnapshot;
beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  const query = { countryIso3s: ["CHN", "BRA"], applicationScope: "non-road", powerKw: 120, asOf: "2026-08-13" };
  const responses = await Promise.all(query.countryIso3s.map(iso3 => getCountryDetails({ iso3, applicationScope: query.applicationScope, powerKw: query.powerKw, asOf: query.asOf })));
  snapshot = comparisonSnapshotSchema.parse({ query, responses });
}, 15_000);
afterAll(() => {
  if (previousMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = previousMode;
});

it("rejects individually valid responses for the wrong country, date, scope or power", () => {
  expect(comparisonSnapshotSchema.safeParse({ ...snapshot, responses: [...snapshot.responses].reverse() }).success).toBe(false);
  for (const variation of [{ powerKw: 121 }, { asOf: "2026-08-14" }, { applicationScope: "marine" }]) {
    expect(comparisonSnapshotSchema.safeParse({ ...snapshot, query: { ...snapshot.query, ...variation } }).success).toBe(false);
  }
  expect(comparisonSnapshotSchema.safeParse({ ...snapshot, responses: snapshot.responses.slice(1) }).success).toBe(false);
});

it.each(["en", "zh-CN"] as const)("shows dates, units, demo labels and sources in %s", locale => {
  const dictionary = getDictionary(locale);
  const html = renderToStaticMarkup(createElement(LocaleProvider,
    { locale, dictionary } as Parameters<typeof LocaleProvider>[0],
    createElement(ComparisonResults, { snapshot })));
  expect(html).toContain("120 kW");
  expect(html).toContain(dictionary.chat.demoEvidenceWarning);
  expect(html).toContain("g/kWh");
  expect(html).toContain(dictionary.analysis.comparisonNotice);
  expect(html).toContain(dictionary.analysis.noExcerpt);
  expect(html).not.toContain('href="https://example.invalid');
});

it("preserves original excerpts as escaped text and keeps real page and section locators", () => {
  const html = renderToStaticMarkup(createElement(SourceExcerpt, { excerpt: '<script>alert("not instructions")</script> 原文', pageFrom: 12, pageTo: 13, section: "Annex II", url: "https://example.org/regulation.pdf", countryIso3: "CHN", scope: "non-road", validFrom: "2026-01-01", validTo: "2027-01-01" }));
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("12–13");
  expect(html).toContain("Annex II");
  expect(html).toContain("regulation.pdf#page=12");
  expect(html).toContain("原文");
  expect(html).toContain("CHN");
  expect(html).toContain("Jan 1, 2026");
  expect(html).toContain("Jan 1, 2027");
});

it("aligns pollutants AND units, retains multiple records and never merges HC with HC+NOx", () => {
  const candidate = structuredClone(snapshot);
  for (const [index, response] of candidate.responses.entries()) {
    if (response.status !== "available" || !response.applicabilitySummary) throw new Error("Missing fixture");
    const regulations = response.applicabilitySummary.country.currentEffectiveRegulations;
    const regulation = regulations[0]!;
    const limit = regulation.limits[0]!;
    response.applicabilitySummary.country.currentEffectiveRegulations = [regulation];
    regulation.limits = [
      { ...limit, id: "first", pollutantCode: index === 0 ? "HC" : "HC+NOx", unitCode: "g/kWh" },
      { ...limit, id: "pm", pollutantCode: "PM", unitCode: "g/kWh" },
      { ...limit, id: "different-unit", pollutantCode: "PM", unitCode: index === 0 ? "mg/kWh" : "g/kWh" },
    ];
  }
  const rows = buildComparisonRows(candidate);
  expect(rows.map(({ pollutant, unit }) => [pollutant, unit])).toEqual([["HC", "g/kWh"], ["HC+NOx", "g/kWh"], ["PM", "g/kWh"], ["PM", "mg/kWh"]]);
  expect(rows.map(row => row.cells.map(cell => cell.length))).toEqual([[1, 0], [0, 1], [1, 2], [1, 0]]);
});

it("trims display padding without recalculation or loss of decimal precision", () => {
  expect(formatRecordedLimit("5.000000")).toBe("5");
  expect(formatRecordedLimit("0.025000")).toBe("0.025");
  expect(formatRecordedLimit("5000")).toBe("5000");
  expect(formatRecordedLimit("9007199254740993.0000000000000010")).toBe("9007199254740993.000000000000001");
});

it("does not invent excerpts or PDF page links for missing, non-PDF or unsafe sources", () => {
  for (const url of [null, "javascript:alert(1)", "https://demo.invalid/test.pdf", "https://example.org/index.html", "https://example.org/test.pdf#existing"]) {
    const html = renderToStaticMarkup(createElement(SourceExcerpt, { pageFrom: 12, url }));
    expect(html).toContain(getDictionary("en").analysis.noExcerpt);
    expect(html).not.toContain("href=");
  }
});
