import { describe, expect, it } from "vitest";

import {
  countryDetailFiltersSchema,
  httpUrlSchema,
  powerKwSchema,
  productFitQuerySchema,
} from "@/features/database/schemas";

describe("database request schemas", () => {
  it("accepts finite nonnegative power numbers and non-empty numeric strings", () => {
    expect(powerKwSchema.parse(0)).toBe(0);
    expect(powerKwSchema.parse("100.5")).toBe(100.5);
    expect(powerKwSchema.parse("1e3")).toBe(1_000);
    expect(powerKwSchema.parse(560.001)).toBe(560.001);
  });

  it("rejects power precision beyond the database's three-decimal boundary", () => {
    expect(() => powerKwSchema.parse(560.0001)).toThrow();
    expect(() => powerKwSchema.parse("560.0001")).toThrow();
  });

  it.each(["", "   ", null, true])(
    "rejects missing or non-numeric power input %j",
    (value) => {
      expect(() => powerKwSchema.parse(value)).toThrow();
    },
  );

  it("does not turn blank power values into zero in API or URL DTOs", () => {
    expect(() =>
      productFitQuerySchema.parse({
        applicationScope: "non-road",
        asOf: "2026-01-20",
        countryIso3: "CHN",
        powerKw: "",
        productModelCode: "DEMO-ENG-100",
      }),
    ).toThrow();
    expect(() => countryDetailFiltersSchema.parse({ powerKw: "" })).toThrow();
  });

  it("rejects JavaScript-specific non-decimal power strings", () => {
    for (const value of ["0x10", "0b10", "0o10"]) {
      expect(() => powerKwSchema.parse(value)).toThrow();
    }
  });

  it("accepts only HTTP(S) source URLs", () => {
    expect(httpUrlSchema.parse("https://example.com/source")).toBe(
      "https://example.com/source",
    );
    expect(httpUrlSchema.parse("http://localhost:3000/source")).toBe(
      "http://localhost:3000/source",
    );

    for (const value of [
      "javascript:alert(1)",
      "data:text/plain,source",
      "ftp://example.com/source",
      "https://reader:secret@example.com/source",
    ]) {
      expect(() => httpUrlSchema.parse(value)).toThrow();
    }
  });
});
