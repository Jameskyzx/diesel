import { describe, expect, it } from "vitest";

import { formatDecimalForDisplay } from "@/lib/decimal-format";

describe("decimal display formatting", () => {
  it("groups large database decimals without losing precision", () => {
    expect(formatDecimalForDisplay("9007199254740993.000001")).toBe(
      "9,007,199,254,740,993.000001",
    );
  });

  it("trims only insignificant fractional zeroes", () => {
    expect(formatDecimalForDisplay("6000.000000")).toBe("6,000");
    expect(formatDecimalForDisplay("-123456789012.120000")).toBe(
      "-123,456,789,012.12",
    );
  });

  it("returns unexpected legacy values unchanged", () => {
    expect(formatDecimalForDisplay("not-a-decimal")).toBe("not-a-decimal");
  });
});
