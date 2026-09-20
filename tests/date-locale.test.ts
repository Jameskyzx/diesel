import { describe, expect, it } from "vitest";

import {
  formatOptionalUtcDate,
  formatProductAvailabilityDateRange,
  formatUtcDate,
} from "@/i18n/date";

describe("localized UTC date formatting", () => {
  it("formats the same calendar date for each supported locale", () => {
    expect(formatUtcDate("2026-08-12", "en")).toBe("Aug 12, 2026");
    expect(formatUtcDate("2026-08-12", "zh-CN")).toBe("2026年8月12日");
  });

  it("normalizes offset timestamps to UTC before formatting", () => {
    expect(formatUtcDate("2026-08-12T23:30:00-02:00", "en")).toBe(
      "Aug 13, 2026",
    );
  });

  it("preserves non-ISO or impossible input instead of guessing", () => {
    expect(formatUtcDate("2026-02-30", "en")).toBe("2026-02-30");
    expect(formatUtcDate("August 12, 2026", "zh-CN")).toBe(
      "August 12, 2026",
    );
  });

  it("uses the caller-provided empty-state copy for absent dates", () => {
    expect(formatOptionalUtcDate(null, "en", "Not recorded")).toBe(
      "Not recorded",
    );
  });

  it("never presents an incomplete product availability period as open", () => {
    expect(
      formatProductAvailabilityDateRange(
        "2025-01-01",
        null,
        "en",
        "Not recorded",
      ),
    ).toBe("Jan 1, 2025 → Not recorded");
    expect(
      formatProductAvailabilityDateRange(
        "2025-01-01",
        null,
        "zh-CN",
        "未记录",
      ),
    ).toBe("2025年1月1日 → 未记录");
    expect(
      formatProductAvailabilityDateRange(
        null,
        "2030-01-01",
        "en",
        "Not recorded",
      ),
    ).toBe("Not recorded → Jan 1, 2030");
    expect(
      formatProductAvailabilityDateRange(
        null,
        "2030-01-01",
        "zh-CN",
        "未记录",
      ),
    ).toBe("未记录 → 2030年1月1日");
    expect(
      formatProductAvailabilityDateRange(null, null, "en", "Not recorded"),
    ).toBe("Not recorded");
    expect(
      formatProductAvailabilityDateRange(null, null, "zh-CN", "未记录"),
    ).toBe("未记录");
  });
});
