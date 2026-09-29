export const locales = ["en", "zh-CN"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";
export const localeCookieName = "diesel_locale";
export const localeCookieMaxAgeSeconds = 60 * 60 * 24 * 365;

export type BrowserLocalePreferenceRead =
  | { locale: Locale | null; status: "available" }
  | { status: "unavailable" };

export type LocaleRefreshRecoveryAction =
  | "complete"
  | "recover"
  | "show_error";
export type LocaleRollbackRecoveryAction = "reload" | "show_error";

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

  // All readers preserve wire order: the first exact name wins, is decoded
  // once, and fails closed if invalid. Do not collapse duplicates with Next's
  // last-value cookie map or fall through to a later, conflicting preference.
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

export function localeFromBrowserCookie(
  readCookieHeader: () => string,
): Locale {
  const preference = tryReadBrowserLocalePreference(readCookieHeader);
  return preference.status === "available"
    ? (preference.locale ?? defaultLocale)
    : defaultLocale;
}

export function tryReadBrowserLocalePreference(
  readCookieHeader: () => string,
): BrowserLocalePreferenceRead {
  try {
    return {
      locale: localePreferenceFromCookieHeader(readCookieHeader()),
      status: "available",
    };
  } catch {
    // Preserve the distinction between no cookie and inaccessible cookies so a
    // refresh mismatch cannot silently leave the UI and server preference split.
    return { status: "unavailable" };
  }
}

export function localeSelectionAction(input: {
  browserPreference: BrowserLocalePreferenceRead;
  pageLocale?: Locale | null;
  renderedLocale: Locale;
  targetLocale: Locale;
}): "none" | "refresh" | "persist" {
  if (
    input.browserPreference.status === "available" &&
    (input.browserPreference.locale ?? defaultLocale) === input.targetLocale
  ) {
    return input.renderedLocale === input.targetLocale &&
      (input.pageLocale == null || input.pageLocale === input.targetLocale)
      ? "none"
      : "refresh";
  }
  // A selected-looking button is still an explicit preference change when
  // another tab changed the Cookie. An unreadable Cookie cannot prove a no-op.
  return "persist";
}

export function localeSynchronizationTarget(input: {
  browserPreference: BrowserLocalePreferenceRead;
  pageLocale?: Locale | null;
  renderedLocale: Locale;
}): Locale | null {
  if (input.browserPreference.status === "unavailable") return null;
  const authoritativeLocale = input.browserPreference.locale ?? defaultLocale;
  return authoritativeLocale === input.renderedLocale &&
    (input.pageLocale == null || input.pageLocale === authoritativeLocale)
    ? null
    : authoritativeLocale;
}

export function localeRefreshRecoveryAction(input: {
  browserPreference: BrowserLocalePreferenceRead;
  refreshedLocale: Locale;
  targetLocale: Locale;
}): LocaleRefreshRecoveryAction {
  if (input.refreshedLocale === input.targetLocale) {
    return "complete";
  }
  if (input.browserPreference.status === "unavailable") {
    return "recover";
  }
  const effectiveBrowserLocale = input.browserPreference.locale ?? defaultLocale;
  return effectiveBrowserLocale === input.refreshedLocale
    ? "show_error"
    : "recover";
}

export function localeRollbackRecoveryAction(input: {
  browserPreference: BrowserLocalePreferenceRead;
  responseOk: boolean;
  sourceLocale: Locale;
}): LocaleRollbackRecoveryAction {
  return input.responseOk &&
    input.browserPreference.status === "available" &&
    input.browserPreference.locale === input.sourceLocale
    ? "show_error"
    : "reload";
}

export function localeFromRequest(request?: Request): Locale {
  return localePreferenceFromCookieHeader(request?.headers.get("cookie")) ??
    defaultLocale;
}
