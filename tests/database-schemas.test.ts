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

  it.each([
    "55.999999999999999999",
    "56.000000000000000001",
    "99999.99999999999999999",
    "100000.000000000001",
    "0.001000000000000000000001",
    "0.000999999999999999999999",
    "-1e-999",
    "1e-999",
    "-0.0000000000000000000000001",
    "1e999",
    "1e99999999999999999999999999999999",
    "1e-99999999999999999999999999999999",
    "560000000000000000001e-19",
  ])("rejects the exact invalid power string %j before floating-point conversion", (value) => {
    expect(powerKwSchema.safeParse(value).success).toBe(false);
    expect(countryDetailFiltersSchema.safeParse({ powerKw: value }).success).toBe(false);
    expect(productFitQuerySchema.safeParse({
      applicationScope: "non-road",
      asOf: "2026-01-20",
      countryIso3: "CHN",
      powerKw: value,
      productModelCode: "DEMO-ENG-100",
    }).success).toBe(false);
  });

  it.each([
    { input: "5.6e1", expected: 56 },
    { input: "56000e-3", expected: 56 },
    { input: "00056.000000000000000000", expected: 56 },
    { input: "+.0010", expected: 0.001 },
    { input: "1.000000000000e-3", expected: 0.001 },
    { input: "300.0", expected: 300 },
    { input: "3.e2", expected: 300 },
    { input: "  +100000.00000  ", expected: 100000 },
    { input: "1e5", expected: 100000 },
    { input: "99999999e-3", expected: 99999.999 },
    { input: "000.000e9999999999999999999999999999", expected: 0 },
    { input: "000.000e-9999999999999999999999999999", expected: 0 },
    { input: "-0.000e-999", expected: -0 },
  ])("keeps the exact valid decimal/scientific power $input", ({ input, expected }) => {
    expect(powerKwSchema.parse(input)).toBe(expected);
  });

  it("handles long cancelling coefficients and exponents without expanding powers of ten", () => {
    expect(powerKwSchema.parse(`1${"0".repeat(4096)}e-4096`)).toBe(1);
    expect(powerKwSchema.parse(`0.${"0".repeat(4096)}1e4097`)).toBe(1);
    expect(powerKwSchema.safeParse(`1${"0".repeat(4096)}1e-4097`).success).toBe(false);
  });

  it("matches a bounded independent rational oracle across decimal and exponent placements", () => {
    // Only this test uses powers of ten, with fixed small bounds. The production
    // parser must not expand an exponent from arbitrary request text.
    const coefficients = [
      0n, 1n, 9n, 10n, 999n, 1000n, 55999n, 56000n, 56001n,
      99999999n, 100000000n, 100000001n, 123456789012345678901n,
    ];
    for (const coefficient of coefficients) {
      for (const decimalPlaces of [0, 1, 3, 6, 12]) {
        const digits = coefficient.toString().padStart(decimalPlaces + 1, "0");
        const mantissa = decimalPlaces === 0 ? `${digits}.` :
          `${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}`;
        for (const exponent of [-15, -6, -3, 0, 3, 6, 15]) {
          const scale = exponent - decimalPlaces + 3;
          const numerator = coefficient * 10n ** BigInt(Math.max(0, scale));
          const denominator = 10n ** BigInt(Math.max(0, -scale));
          for (const sign of ["", "+", "-"]) {
            const exactNonnegative = sign !== "-" || coefficient === 0n;
            const valid = exactNonnegative && numerator % denominator === 0n &&
              numerator / denominator <= 100_000_000n;
            const input = `${sign}00${mantissa}e${exponent >= 0 ? "+" : ""}${exponent}`;
            const parsed = powerKwSchema.safeParse(input);
            expect(parsed.success, input).toBe(valid);
            if (parsed.success) expect(parsed.data, input).toBe(Number(input));
          }
        }
      }
    }
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
