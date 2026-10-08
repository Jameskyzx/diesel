import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, it } from "vitest";

import { ToolFacts, ToolResultCard } from "@/components/ai/sales-chat";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import { getDictionary } from "@/i18n/dictionaries";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getCountryDetails } from "@/server/services/country-service";
import { buildCountryProfileResult, buildToolErrorResult } from "@/server/ai/tool-results";
import { toolDisplayEvidence } from "@/features/ai/tool-display-evidence";
import { formatUtcDate } from "@/i18n/date";

const previousMode = process.env.DATABASE_MODE;
beforeAll(async () => { process.env.DATABASE_MODE = "pglite-demo"; await getDemoDatabase(); }, 15_000);
afterAll(() => {
  if (previousMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = previousMode;
});

it.each(["en", "zh-CN"] as const)("renders only requested market facts in %s, with periods, units and sources", async (locale) => {
  const dictionary = getDictionary(locale);
  const profile = await getCountryDetails({ iso3: "CHN", asOf: "2026-08-13" });
  const result = clientAiToolResultSchema.parse(buildCountryProfileResult({
    informationAsOf: "2026-08-13", profile, requestedTopics: ["market"], resolvedCountryIso3: "CHN",
  }));
  // React supplies the required children through createElement's third argument.
  const html = renderToStaticMarkup(createElement(LocaleProvider,
    { dictionary, locale } as Parameters<typeof LocaleProvider>[0],
    createElement(ToolFacts, { countryIso2ByIso3: { CHN: "CN" }, result })));
  expect(html).toContain("profile-market-facts");
  expect(html).toContain(dictionary.chat.marketPeriodStart);
  expect(html).toContain(dictionary.chat.marketPeriodEnd);
  expect(html).toContain(dictionary.chat.marketHistoricalNotice);
  expect(html).toContain(dictionary.common.source);
  expect(html).not.toContain(dictionary.chat.currentEffectiveCount);
  expect(html).not.toContain(dictionary.chat.futureAdoptedCount);
  expect(html).not.toContain("DEMO-CHN-AUTHORITY");
});

it("does not add market facts to a regulatory-status request", async () => {
  const result = clientAiToolResultSchema.parse(buildCountryProfileResult({
    informationAsOf: "2026-08-13", profile: await getCountryDetails({ iso3: "CHN", asOf: "2026-08-13" }),
    requestedTopics: ["regulations"], resolvedCountryIso3: "CHN",
  }));
  const html = renderToStaticMarkup(createElement(ToolFacts, { countryIso2ByIso3: { CHN: "CN" }, result }));
  expect(html).toContain(getDictionary("en").chat.currentEffectiveCount);
  expect(html).not.toContain("profile-market-facts");
});

it.each(["en", "zh-CN"] as const)("uses only displayed-topic sources and freshness for the %s market card", async (locale) => {
  const dictionary = getDictionary(locale);
  const parsed = clientAiToolResultSchema.parse(buildCountryProfileResult({
    informationAsOf: "2026-08-13", profile: await getCountryDetails({ iso3: "CHN", asOf: "2026-08-13" }),
    requestedTopics: ["market"], resolvedCountryIso3: "CHN",
  }));
  if (parsed.tool !== "getCountryProfile") throw new Error("Expected country profile");
  // Synthetic dates test the display projection, not server evidence admission.
  const result = {
    ...parsed,
    citations: parsed.citations.map((citation) => ({
      ...citation,
      verifiedAt: citation.entityType == null || citation.entityType === "market_metric"
        ? "2026-08-03T00:00:00Z" : "2026-08-11T00:00:00Z",
    })),
    latestVerifiedAt: "2026-08-11T00:00:00Z",
  };
  const original = structuredClone(result);
  const displayed = toolDisplayEvidence(result);
  expect(displayed.latestVerifiedAt).toBe("2026-08-03T00:00:00Z");
  expect(displayed.citations.length).toBeGreaterThan(1);
  expect(displayed.citations.every((citation) => citation.entityType == null || citation.entityType === "market_metric")).toBe(true);
  expect(result).toEqual(original);

  const html = renderToStaticMarkup(createElement(LocaleProvider,
    { dictionary, locale } as Parameters<typeof LocaleProvider>[0],
    createElement(ToolResultCard, { countryIso2ByIso3: { CHN: "CN" }, result })));
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  expect(html).toContain(dictionary.chat.queryConditions);
  expect(header).toContain(formatUtcDate("2026-08-03", locale));
  expect(header).not.toContain(formatUtcDate("2026-08-11", locale));
  expect(html).not.toContain("DEMO-CHN-AUTHORITY");
});

it.each([
  { topics: ["country"] as const, market: false, regulations: false },
  { topics: ["regulations"] as const, market: false, regulations: true },
  { topics: ["market", "regulations"] as const, market: true, regulations: true },
])("keeps country identity and the selected sources for $topics", async ({ topics, market, regulations }) => {
  const result = clientAiToolResultSchema.parse(buildCountryProfileResult({
    informationAsOf: "2026-08-13", profile: await getCountryDetails({ iso3: "CHN", asOf: "2026-08-13" }),
    requestedTopics: [...topics], resolvedCountryIso3: "CHN",
  }));
  const displayed = toolDisplayEvidence(result);
  expect(displayed.citations.some((citation) => citation.entityType == null)).toBe(true);
  expect(displayed.citations.some((citation) => citation.entityType === "market_metric")).toBe(market);
  expect(displayed.citations.some((citation) => citation.entityType === "regulation")).toBe(regulations);
});

it("handles no-data and execution-error country profiles without inventing display evidence", async () => {
  const noData = clientAiToolResultSchema.parse(buildCountryProfileResult({
    informationAsOf: "2026-08-13", profile: await getCountryDetails({ iso3: "FJI", asOf: "2026-08-13" }),
    requestedTopics: ["market"], resolvedCountryIso3: "FJI",
  }));
  const error = clientAiToolResultSchema.parse(buildToolErrorResult("getCountryProfile", "2026-08-13", {
    countryIso3: "CHN", asOf: "2026-08-13", topics: ["market"],
  }));
  for (const result of [noData, error]) {
    expect(toolDisplayEvidence(result)).toEqual({ citations: [], latestVerifiedAt: null });
    expect(() => renderToStaticMarkup(createElement(ToolResultCard,
      { countryIso2ByIso3: {}, result }))).not.toThrow();
  }
  const noDataHtml = renderToStaticMarkup(createElement(ToolResultCard, { countryIso2ByIso3: {}, result: noData }));
  expect(noDataHtml).toContain(getDictionary("en").queryEditor.marketEvidence);
  expect(noDataHtml).not.toContain(getDictionary("en").queryEditor.certificationEvidence);
  const errorHtml = renderToStaticMarkup(createElement(ToolResultCard, { countryIso2ByIso3: {}, result: error }));
  expect(errorHtml).not.toContain("evidence-next-steps");
});
