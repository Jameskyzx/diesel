import { describe, expect, it } from "vitest";

import { dictionaries, getDictionary, interpolate } from "@/i18n/dictionaries";
import {
  type BrowserLocalePreferenceRead,
  defaultLocale,
  isLocale,
  localeRefreshRecoveryAction,
  localeRollbackRecoveryAction,
  localeSelectionAction,
  localeSynchronizationTarget,
  localeFromBrowserCookie,
  localeCookieName,
  localePreferenceFromCookieHeader,
  locales,
  parseLocale,
  tryReadBrowserLocalePreference,
  localeFromRequest,
} from "@/i18n/locale";
import { buildLocalizedOpenGraph } from "@/i18n/metadata";

function leafKeys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "string"
      ? [path]
      : leafKeys(child as object, path);
  });
}

function placeholdersByLeaf(
  value: object,
  prefix = "",
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof child !== "string") {
        return Object.entries(placeholdersByLeaf(child as object, path));
      }
      return [[
        path,
        Array.from(
          child.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu),
          (match) => match[1]!,
        ).sort(),
      ]] as const;
    }),
  );
}

describe("locale preferences", () => {
  it.each(locales.flatMap((renderedLocale) => locales.flatMap((pageLocale) =>
    locales.map((cookie) => ({ cookie, pageLocale, renderedLocale })),
  )))("checks committed page $pageLocale as well as shell $renderedLocale against Cookie $cookie", ({ cookie, pageLocale, renderedLocale }) => {
    const aligned = cookie === pageLocale && cookie === renderedLocale;
    expect(localeSynchronizationTarget({
      browserPreference: { locale: cookie, status: "available" },
      pageLocale,
      renderedLocale,
    })).toBe(aligned ? null : cookie);
    expect(localeSelectionAction({
      browserPreference: { locale: cookie, status: "available" },
      pageLocale,
      renderedLocale,
      targetLocale: cookie,
    })).toBe(aligned ? "none" : "refresh");
  });

  it.each(locales)("does not infer a Cookie preference from a committed $case page", (pageLocale) => {
    expect(localeSynchronizationTarget({
      browserPreference: { status: "unavailable" },
      pageLocale,
      renderedLocale: "en",
    })).toBeNull();
    expect(localeSelectionAction({
      browserPreference: { status: "unavailable" },
      pageLocale,
      renderedLocale: pageLocale,
      targetLocale: pageLocale,
    })).toBe("persist");
  });

  it.each([
    { renderedLocale: "en", cookie: "en", targetLocale: "en", expected: "none" },
    { renderedLocale: "en", cookie: "zh-CN", targetLocale: "en", expected: "persist" },
    { renderedLocale: "en", cookie: "zh-CN", targetLocale: "zh-CN", expected: "refresh" },
    { renderedLocale: "en", cookie: "en", targetLocale: "zh-CN", expected: "persist" },
    { renderedLocale: "zh-CN", cookie: "zh-CN", targetLocale: "zh-CN", expected: "none" },
    { renderedLocale: "zh-CN", cookie: "en", targetLocale: "zh-CN", expected: "persist" },
    { renderedLocale: "zh-CN", cookie: "en", targetLocale: "en", expected: "refresh" },
    { renderedLocale: "zh-CN", cookie: "zh-CN", targetLocale: "en", expected: "persist" },
    { renderedLocale: "en", cookie: null, targetLocale: "en", expected: "none" },
    { renderedLocale: "zh-CN", cookie: null, targetLocale: "en", expected: "refresh" },
    { renderedLocale: "en", cookie: null, targetLocale: "zh-CN", expected: "persist" },
    { renderedLocale: "zh-CN", cookie: null, targetLocale: "zh-CN", expected: "persist" },
  ] as const)(
    "chooses $expected for explicit $targetLocale selection with rendered $renderedLocale and Cookie $cookie",
    ({ renderedLocale, cookie, targetLocale, expected }) => {
      expect(localeSelectionAction({
        browserPreference: { locale: cookie, status: "available" },
        renderedLocale,
        targetLocale,
      })).toBe(expected);
    },
  );

  it.each(locales)("does not discard an explicit $case selection when Cookie access is unavailable", (targetLocale) => {
    expect(localeSelectionAction({
      browserPreference: { status: "unavailable" },
      renderedLocale: targetLocale,
      targetLocale,
    })).toBe("persist");
  });

  it.each([
    { renderedLocale: "en", cookie: "en", expected: null },
    { renderedLocale: "en", cookie: "zh-CN", expected: "zh-CN" },
    { renderedLocale: "zh-CN", cookie: "en", expected: "en" },
    { renderedLocale: "zh-CN", cookie: "zh-CN", expected: null },
    { renderedLocale: "en", cookie: null, expected: null },
    { renderedLocale: "zh-CN", cookie: null, expected: "en" },
  ] as const)(
    "reads synchronization target $expected for rendered $renderedLocale and Cookie $cookie",
    ({ renderedLocale, cookie, expected }) => {
      expect(localeSynchronizationTarget({
        browserPreference: { locale: cookie, status: "available" },
        renderedLocale,
      })).toBe(expected);
    },
  );

  it.each(locales)("does not guess a synchronization target for $case when Cookie access is unavailable", (renderedLocale) => {
    expect(localeSynchronizationTarget({
      browserPreference: { status: "unavailable" },
      renderedLocale,
    })).toBeNull();
  });

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

  it("uses only the browser cookie and fails unavailable cookie access closed", () => {
    expect(
      localeFromBrowserCookie(() => "diesel_locale=zh-CN"),
    ).toBe("zh-CN");
    expect(
      localeFromBrowserCookie(() => "diesel_locale=en"),
    ).toBe("en");
    expect(
      localeFromBrowserCookie(() => ""),
    ).toBe("en");
    expect(
      localeFromBrowserCookie(() => {
        throw new DOMException("Cookies disabled", "SecurityError");
      }),
    ).toBe("en");
    expect(localePreferenceFromCookieHeader("diesel_locale=%E0%A4%A")).toBeNull();
    expect(
      tryReadBrowserLocalePreference(() => {
        throw new DOMException("Cookies disabled", "SecurityError");
      }),
    ).toEqual({ status: "unavailable" });
  });

  it.each<{
    browserPreference: BrowserLocalePreferenceRead;
    expected: "complete" | "recover" | "show_error";
    refreshedLocale: "en" | "zh-CN";
    targetLocale: "en" | "zh-CN";
  }>([
    {
      browserPreference: { locale: "zh-CN", status: "available" },
      expected: "complete",
      refreshedLocale: "zh-CN",
      targetLocale: "zh-CN",
    },
    {
      browserPreference: { locale: null, status: "available" },
      expected: "show_error",
      refreshedLocale: "en",
      targetLocale: "zh-CN",
    },
    {
      browserPreference: { locale: null, status: "available" },
      expected: "recover",
      refreshedLocale: "zh-CN",
      targetLocale: "en",
    },
    {
      browserPreference: { locale: "en", status: "available" },
      expected: "show_error",
      refreshedLocale: "en",
      targetLocale: "zh-CN",
    },
    {
      browserPreference: { locale: "zh-CN", status: "available" },
      expected: "recover",
      refreshedLocale: "en",
      targetLocale: "zh-CN",
    },
    {
      browserPreference: { status: "unavailable" },
      expected: "recover",
      refreshedLocale: "en",
      targetLocale: "zh-CN",
    },
  ])(
    "classifies a locale refresh as $expected",
    ({ browserPreference, expected, refreshedLocale, targetLocale }) => {
      expect(
        localeRefreshRecoveryAction({
          browserPreference,
          refreshedLocale,
          targetLocale,
        }),
      ).toBe(expected);
    },
  );

  it("builds complete localized Open Graph metadata for route-specific copy", () => {
    expect(
      buildLocalizedOpenGraph("en", {
        description: "Country description",
        imageAlt: "Evidence network",
        title: "Country title",
      }),
    ).toEqual({
      description: "Country description",
      images: [
        {
          alt: "Evidence network",
          height: 675,
          url: "/og.jpg",
          width: 1200,
        },
      ],
      locale: "en_US",
      title: "Country title",
      type: "website",
    });
    expect(
      buildLocalizedOpenGraph("zh-CN", {
        description: "国家说明",
        imageAlt: "法规证据网络",
        title: "国家详情",
      }),
    ).toMatchObject({
      description: "国家说明",
      images: [{ alt: "法规证据网络" }],
      locale: "zh_CN",
      title: "国家详情",
      type: "website",
    });
  });

  it.each<{
    browserPreference: BrowserLocalePreferenceRead;
    expected: "reload" | "show_error";
    responseOk: boolean;
  }>([
    {
      browserPreference: { locale: "en", status: "available" },
      expected: "show_error",
      responseOk: true,
    },
    {
      browserPreference: { locale: "zh-CN", status: "available" },
      expected: "reload",
      responseOk: true,
    },
    {
      browserPreference: { status: "unavailable" },
      expected: "reload",
      responseOk: true,
    },
    {
      browserPreference: { locale: "en", status: "available" },
      expected: "reload",
      responseOk: false,
    },
  ])(
    "chooses $expected after locale rollback",
    ({ browserPreference, expected, responseOk }) => {
      expect(
        localeRollbackRecoveryAction({
          browserPreference,
          responseOk,
          sourceLocale: "en",
        }),
      ).toBe(expected);
    },
  );

  it("keeps English and Chinese dictionaries structurally aligned", () => {
    expect(leafKeys(dictionaries["zh-CN"]).sort()).toEqual(
      leafKeys(dictionaries.en).sort(),
    );
    expect(getDictionary("en").header.home).toBe("Home");
    expect(getDictionary("zh-CN").header.home).toBe("首页");
  });

  it("keeps interpolation placeholders aligned for every dictionary leaf", () => {
    expect(placeholdersByLeaf(dictionaries["zh-CN"])).toEqual(
      placeholdersByLeaf(dictionaries.en),
    );
  });

  it("keeps public Chinese chat examples free of raw internal enum and fixture labels", () => {
    const chinese = getDictionary("zh-CN");
    const publicChatCopy = [
      ...Object.values(chinese.chatPage).filter((value) =>
        typeof value === "string",
      ),
      chinese.chat.emptyDemo,
      chinese.chat.emptyLive,
    ].join(" ");

    expect(publicChatCopy).not.toMatch(/\bnon-road\b|\bfixture\b/u);
  });

  it("interpolates known placeholders and leaves unknown placeholders intact", () => {
    expect(interpolate("Current selection: {name} / {code}", { name: "China" })).toBe(
      "Current selection: China / {code}",
    );
  });

  it("does not reinterpret placeholder-looking text inside interpolated values", () => {
    expect(
      interpolate("{name} / {count}", {
        count: 3,
        name: "literal {count} and {name}",
      }),
    ).toBe("literal {count} and {name} / 3");
  });
});
