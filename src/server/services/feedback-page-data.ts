import "server-only";

import { formatCountryDisplayName } from "@/i18n/country-name";
import type { Locale } from "@/i18n/locale";
import { getCountryDirectory } from "@/server/services/country-directory";

/** Localized country names for feedback pages; unknown codes show as given. */
export function feedbackCountryNamer(locale: Locale) {
  const directory = new Map(getCountryDirectory().map(country => [country.iso3, country]));
  return (iso3: string | null) => {
    if (!iso3) return locale === "zh-CN" ? "未注明" : "Not stated";
    const country = directory.get(iso3);
    return country ? formatCountryDisplayName({ isDemo: false, iso2: country.iso2, iso3, nameEn: country.name }, locale) : iso3;
  };
}
