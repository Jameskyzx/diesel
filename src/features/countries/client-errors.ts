import {
  countryApiErrorSchema,
  type CountryApiErrorCode,
} from "@/features/countries/schemas";
import type { Dictionary } from "@/i18n/dictionaries";

const detailApiErrorKeys = {
  COUNTRY_NOT_FOUND: "countryNotFound",
  INTERNAL_ERROR: "countryDetailUnavailable",
  INVALID_AS_OF: "invalidAsOf",
  INVALID_FILTER: "invalidCountryFilter",
  INVALID_ISO3: "invalidIso3",
} as const satisfies Readonly<
  Record<CountryApiErrorCode, keyof Dictionary["apiErrors"]>
>;

export async function parseCountryApiErrorCode(
  response: Response,
): Promise<CountryApiErrorCode | null> {
  try {
    const parsed = countryApiErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error.code : null;
  } catch {
    return null;
  }
}

export function countryMapErrorMessage(
  code: CountryApiErrorCode | null,
  dictionary: Dictionary,
): string {
  return code === "INTERNAL_ERROR"
    ? dictionary.apiErrors.countrySummariesUnavailable
    : dictionary.map.errorFallback;
}

export function countryDetailErrorMessage(
  code: CountryApiErrorCode | null,
  dictionary: Dictionary,
): string {
  return code === null
    ? dictionary.country.detailErrorFallback
    : dictionary.apiErrors[detailApiErrorKeys[code]];
}

export function countryDecisionSummaryErrorMessage(
  code: CountryApiErrorCode | null,
  dictionary: Dictionary,
): string {
  if (code === null || code === "INTERNAL_ERROR") {
    return dictionary.country.decisionSummaryErrorFallback;
  }

  return dictionary.apiErrors[detailApiErrorKeys[code]];
}
