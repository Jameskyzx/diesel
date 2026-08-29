import { describe, expect, it } from "vitest";

import { dictionaries, getDictionary, interpolate } from "@/i18n/dictionaries";
import {
  defaultLocale,
  isLocale,
  localeFromBrowserPreferences,
  localeCookieName,
  localePreferenceFromCookieHeader,
  locales,
  parseLocale,
  localeFromRequest,
} from "@/i18n/locale";

function leafKeys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "string"
      ? [path]
      : leafKeys(child as object, path);
  });
}

describe("locale preferences", () => {
  it("uses English as the safe default and accepts only supported locales", () => {
    expect(locales).toEqual(["en", "zh-CN"]);
    expect(defaultLocale).toBe("en");
    expect(localeCookieName).toBe("diesel_locale");
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("zh")).toBe(false);
    expect(parseLocale("zh-CN")).toBe("zh-CN");
    expect(parseLocale("fr")).toBe("en");
    expect(parseLocale(undefined)).toBe("en");
  });

  it("reads the locale cookie and fails malformed values closed to English", () => {
    expect(
      localeFromRequest(
        new Request("http://localhost", {
          headers: { cookie: "session=ignored; diesel_locale=zh-CN" },
        }),
      ),
    ).toBe("zh-CN");
    expect(
      localeFromRequest(
        new Request("http://localhost", {
          headers: { cookie: "diesel_locale=%E0%A4%A" },
        }),
      ),
    ).toBe("en");
    expect(localeFromRequest()).toBe("en");
  });

  it("keeps the cookie authoritative and survives unavailable browser storage", () => {
    expect(
      localeFromBrowserPreferences({
        readCookieHeader: () => "diesel_locale=zh-CN",
        readStoredLocale: () => {
          throw new DOMException("Storage disabled", "SecurityError");
        },
      }),
    ).toBe("zh-CN");
    expect(
      localeFromBrowserPreferences({
        readCookieHeader: () => "diesel_locale=en",
        readStoredLocale: () => "zh-CN",
      }),
    ).toBe("en");
    expect(
      localeFromBrowserPreferences({
        readCookieHeader: () => {
          throw new DOMException("Cookies disabled", "SecurityError");
        },
        readStoredLocale: () => {
          throw new DOMException("Storage disabled", "SecurityError");
        },
      }),
    ).toBe("en");
    expect(localePreferenceFromCookieHeader("diesel_locale=%E0%A4%A")).toBeNull();
  });

  it("keeps English and Chinese dictionaries structurally aligned", () => {
    expect(leafKeys(dictionaries["zh-CN"]).sort()).toEqual(
      leafKeys(dictionaries.en).sort(),
    );
    expect(getDictionary("en").header.home).toBe("Home");
    expect(getDictionary("zh-CN").header.home).toBe("首页");
  });

  it("interpolates known placeholders and leaves unknown placeholders intact", () => {
    expect(interpolate("Current selection: {name} / {code}", { name: "China" })).toBe(
      "Current selection: China / {code}",
    );
  });
});
