import type { CitationLocatorDescriptor } from "@/features/ai/citation-locator";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/dictionaries";
import {
  formatOptionalUtcDate,
  formatProductAvailabilityDateRange,
} from "@/i18n/date";
import type { Locale } from "@/i18n/locale";

export type LocalizableCitationLocator = {
  locator: string | null;
  locatorDescriptor?: CitationLocatorDescriptor | null;
  pageFrom?: number | null;
  pageTo?: number | null;
  sectionLocator?: string | null;
};

function localizedLocatorDateRange(
  start: string | null,
  end: string | null,
  locale: Locale,
  dictionary: Dictionary,
): string {
  return `${formatOptionalUtcDate(
    start,
    locale,
    dictionary.common.notRecorded,
  )} → ${formatOptionalUtcDate(end, locale, dictionary.common.open)}`;
}

export function localizedCitationLocator(
  citation: LocalizableCitationLocator,
  locale: Locale,
  dictionary: Dictionary,
  fallback = dictionary.chat.noSourceLocator,
): string {
  if (citation.pageFrom) {
    const pages =
      citation.pageTo && citation.pageTo !== citation.pageFrom
        ? `${citation.pageFrom}–${citation.pageTo}`
        : String(citation.pageFrom);
    return interpolate(dictionary.chat.sourcePage, { pages });
  }

  if (
    citation.sectionLocator !== null &&
    citation.sectionLocator !== undefined
  ) {
    return citation.sectionLocator;
  }

  const descriptor = citation.locatorDescriptor;
  if (descriptor) {
    switch (descriptor.kind) {
      case "market_period":
        return localizedLocatorDateRange(
          descriptor.periodStart,
          descriptor.periodEnd,
          locale,
          dictionary,
        );
      case "membership_period":
        return localizedLocatorDateRange(
          descriptor.validFrom,
          descriptor.validTo,
          locale,
          dictionary,
        );
      case "product_availability":
        return `${descriptor.modelCode} · ${
          dictionary.productFit.availablePeriod
        }${
          dictionary.common.labelSeparator
        }${formatProductAvailabilityDateRange(
          descriptor.availableFrom,
          descriptor.availableTo,
          locale,
          dictionary.common.notRecorded,
        )}`;
      case "regulation_limit_period":
        return `${descriptor.pollutantCode} · ${localizedLocatorDateRange(
          descriptor.validFrom,
          descriptor.validTo,
          locale,
          dictionary,
        )}`;
    }

    // The schema rejects unknown descriptor kinds. Keeping this assignment
    // makes a newly added typed kind a compile-time error until it has copy.
    const unhandledDescriptor: never = descriptor;
    void unhandledDescriptor;
    return fallback;
  }

  return citation.locator ?? fallback;
}
