import { describe, expect, it } from "vitest";
import { marketObservationPeriod } from "@/domain/ai/market-profile-response";

describe("market observation periods are half-open, not publication years", () => {
  it.each([2022, 2023, 2024, 2025])("identifies the full %s calendar year without shifting to periodEnd", year => {
    expect(marketObservationPeriod(`${year}-01-01`, `${year + 1}-01-01`, "en"))
      .toBe(`${year} calendar year; ${year}-01-01 inclusive to ${year + 1}-01-01 exclusive`);
    expect(marketObservationPeriod(`${year}-01-01`, `${year + 1}-01-01`, "zh-CN"))
      .toBe(`${year} 年；${year}-01-01（含）至 ${year + 1}-01-01（不含）`);
  });
  it.each([["2024-02-01", "2024-03-01"], ["2022-01-01", "2024-01-01"], ["2023-07-01", "2024-07-01"]])(
    "does not label a partial or multi-year interval as a calendar year: %s to %s", (start, end) => {
      expect(marketObservationPeriod(start, end, "en")).toBe(`${start} inclusive to ${end} exclusive`);
    });
});
