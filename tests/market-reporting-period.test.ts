import { describe, expect, it } from "vitest";
import { explicitMarketReportingPeriod, marketReportingPeriodSchema, observationInReportingPeriod } from "@/domain/marketing/reporting-period";

const period = { start: "2023-01-01", end: "2024-01-01" };
describe("reporting-period semantics independent of regulatory asOf", () => {
  it.each(["巴西2023年的市场数据", "BRA market data for 2023", "Instead use 2023"])("normalizes an explicit calendar year: %s", text => {
    expect(explicitMarketReportingPeriod(text)).toEqual({ period, ambiguous: false });
  });
  it.each(["EU 2016/1628", "as of 2023-12-31", "型号M2023", "2000 kW", 'document "2023"'])("does not reinterpret a date, identifier or quantity: %s", text => {
    expect(explicitMarketReportingPeriod(text)).toEqual({ ambiguous: false });
  });
  it.each(["2022 or 2023", "2023年发布的报告", "data published in 2023"])("does not silently choose an ambiguous or publication year: %s", text => {
    expect(explicitMarketReportingPeriod(text)).toEqual({ ambiguous: true });
  });
  it("normalizes a year range and applies half-open containment, not overlap or latest-year substitution", () => {
    expect(explicitMarketReportingPeriod("2022至2024年").period).toEqual({ start: "2022-01-01", end: "2025-01-01" });
    expect(marketReportingPeriodSchema.safeParse({ start: period.end, end: period.start }).success).toBe(false);
    for (const [periodStart, periodEnd, expected] of [
      ["2023-01-01", "2024-01-01", true], ["2023-04-01", "2023-07-01", true],
      ["2022-01-01", "2023-01-01", false], ["2024-01-01", "2025-01-01", false],
      ["2022-01-01", "2024-01-01", false],
    ] as const) expect(observationInReportingPeriod({ periodStart, periodEnd }, period)).toBe(expected);
  });
});
