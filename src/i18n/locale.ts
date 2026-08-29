export const locales = ["en", "zh-CN"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";
export const localeCookieName = "diesel_locale";
export const localeCookieMaxAgeSeconds = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale);
}

export function parseLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}

export function localePreferenceFromCookieHeader(
  cookieHeader: string | null | undefined,
): Locale | null {
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === localeCookieName) {
      try {
        const value = decodeURIComponent(rawValue.join("="));
        return isLocale(value) ? value : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function localeFromBrowserPreferences(input: {
  readCookieHeader: () => string;
  readStoredLocale: () => unknown;
}): Locale {
  try {
    const cookieLocale = localePreferenceFromCookieHeader(
      input.readCookieHeader(),
    );
    if (cookieLocale !== null) return cookieLocale;
  } catch {
    // Browser privacy controls may make cookie access unavailable.
  }

  try {
    return parseLocale(input.readStoredLocale());
  } catch {
    return defaultLocale;
  }
}

export function localeFromRequest(request?: Request): Locale {
  return localePreferenceFromCookieHeader(request?.headers.get("cookie")) ??
    defaultLocale;
}
