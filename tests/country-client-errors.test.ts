import { describe, expect, it } from "vitest";

import {
  countryDecisionSummaryErrorMessage,
  countryDetailErrorMessage,
  countryMapErrorMessage,
  parseCountryApiErrorCode,
} from "@/features/countries/client-errors";
import type { CountryApiErrorCode } from "@/features/countries/schemas";
import { getDictionary } from "@/i18n/dictionaries";

const english = getDictionary("en");
const chinese = getDictionary("zh-CN");

describe("country client error codes", () => {
  it("reads a known code without trusting the server-authored message", async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: "INVALID_AS_OF",
          message: "DO NOT RENDER stale server copy",
        },
      }),
      { headers: { "content-type": "application/json" }, status: 400 },
    );

    await expect(parseCountryApiErrorCode(response)).resolves.toBe(
      "INVALID_AS_OF",
    );
  });

  it.each([
    ["non-JSON", "<html>upstream failure</html>"],
    [
      "unknown code",
      JSON.stringify({
        error: { code: "UPSTREAM_PRIVATE_ERROR", message: "DO NOT RENDER" },
      }),
    ],
    [
      "missing message",
      JSON.stringify({ error: { code: "INTERNAL_ERROR" } }),
    ],
    ["malformed JSON", '{"error":'],
  ])("fails closed for a %s response", async (_label, body) => {
    await expect(
      parseCountryApiErrorCode(new Response(body, { status: 500 })),
    ).resolves.toBeNull();
  });

  it.each([
    ["COUNTRY_NOT_FOUND", "countryNotFound"],
    ["INTERNAL_ERROR", "countryDetailUnavailable"],
    ["INVALID_AS_OF", "invalidAsOf"],
    ["INVALID_FILTER", "invalidCountryFilter"],
    ["INVALID_ISO3", "invalidIso3"],
  ] as const)("maps %s through the active dictionary", (code, key) => {
    expect(countryDetailErrorMessage(code, english)).toBe(
      english.apiErrors[key],
    );
    expect(countryDetailErrorMessage(code, chinese)).toBe(
      chinese.apiErrors[key],
    );
  });

  it("re-localizes retained map, detail, and summary states without a new response", () => {
    const mapState: { code: CountryApiErrorCode | null } = {
      code: "INTERNAL_ERROR",
    };
    const detailState: { code: CountryApiErrorCode | null } = {
      code: "INVALID_FILTER",
    };

    expect(countryMapErrorMessage(mapState.code, english)).toBe(
      english.apiErrors.countrySummariesUnavailable,
    );
    expect(countryMapErrorMessage(mapState.code, chinese)).toBe(
      chinese.apiErrors.countrySummariesUnavailable,
    );
    expect(countryDetailErrorMessage(detailState.code, english)).toBe(
      english.apiErrors.invalidCountryFilter,
    );
    expect(countryDetailErrorMessage(detailState.code, chinese)).toBe(
      chinese.apiErrors.invalidCountryFilter,
    );
    expect(
      countryDecisionSummaryErrorMessage(mapState.code, english),
    ).toBe(english.country.decisionSummaryErrorFallback);
    expect(
      countryDecisionSummaryErrorMessage(mapState.code, chinese),
    ).toBe(chinese.country.decisionSummaryErrorFallback);
  });

  it("uses fixed surface fallbacks for unknown client failures", () => {
    expect(countryMapErrorMessage(null, english)).toBe(
      english.map.errorFallback,
    );
    expect(countryMapErrorMessage(null, chinese)).toBe(
      chinese.map.errorFallback,
    );
    expect(countryDetailErrorMessage(null, english)).toBe(
      english.country.detailErrorFallback,
    );
    expect(countryDetailErrorMessage(null, chinese)).toBe(
      chinese.country.detailErrorFallback,
    );
    expect(countryDecisionSummaryErrorMessage(null, english)).toBe(
      english.country.decisionSummaryErrorFallback,
    );
    expect(countryDecisionSummaryErrorMessage(null, chinese)).toBe(
      chinese.country.decisionSummaryErrorFallback,
    );
  });
});
