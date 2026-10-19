import { describe, expect, it } from "vitest";

import { selectedMarketReportingPeriod } from "@/domain/marketing/reporting-period";

describe("grounded operands are separate from mentioned context and presentation", () => {
  it.each([
    "Use 2022 or 2023", "Use 2022, or 2023", "Compare 2022 and 2023", "不要2022，也不要2023",
    "not 2022, not 2023", "Report published in 2022, edition 2023", "Use 2022; use 2023",
    "2022 through 2024 or 2025", "2000 kW, report published in 2023",
  ])("cannot resolve an excluded, publication-only or multiply positive period: %s", text => {
    expect(selectedMarketReportingPeriod(text, text).period).toBeUndefined();
  });
  it("keeps a complete positive range while excluding the declined prior period", () => {
    const text = "Use 2020 through 2022, not 2023";
    expect(selectedMarketReportingPeriod(text, text)).toEqual({ ambiguous: false,
      period: { start: "2020-01-01", end: "2023-01-01" } });
  });
  it.each([
    ["Compare Brazil and China for the reporting year 2023. Keep the observation period explicit.", "2023", "2023"],
    ["Compare Brazil and China for the reporting year 2023. Keep the observation period explicit.", "reporting year 2023", "2023"],
    ["Use 2022. Do not substitute 2023.", "2022", "2022"],
    ["Do not use 2023. Use 2022.", "Use 2022", "2022"],
    ["The report was published in 2024. Compare observations for 2022.", "2022", "2022"],
    ["Use 2022... Keep both markets.", "2022", "2022"],
    ["Use 2022 - keep both markets.", "2022", "2022"],
  ])("distinguishes sentence punctuation from identifier connectors: %s", (text, expression, year) => {
    expect(selectedMarketReportingPeriod(text, expression)).toEqual({ ambiguous: false,
      period: { start: `${year}-01-01`, end: `${Number(year) + 1}-01-01` } });
  });
  it.each([
    ["Use 2022, not 2023", "2023"], ["不要2023，改为2022", "2023"],
    ["Use 2022 instead of 2023", "2023"], ["data published in 2023", "2023"],
    ["2023年发布的报告", "2023年"], ["document ISO-2023", "2023"],
    ["as of 2023-01-01", "2023"], ["2022 or 2023", "2022"],
    ["2022 through 2024", "2022"], ['document "2023"', "2023"],
    ["document ISO.2023", "2023"], ["document 2023.rev1", "2023"],
    ["document ISO/2023", "2023"], ["document 2023/24", "2023"],
    ["value 2023.5", "2023"], ["document _2023", "2023"],
    ["Do not use 2023. Use 2022.", "2023"],
    ["The report was published in 2024. Compare observations for 2022.", "2024"],
    ["BRA market data", "2023"],
  ])("rejects an ungrounded or wrongly selected period: %s / %s", (text, expression) => {
    expect(selectedMarketReportingPeriod(text, expression).period).toBeUndefined();
  });
});
