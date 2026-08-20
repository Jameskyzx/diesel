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
