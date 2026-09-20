import { describe, expect, it, vi } from "vitest";

const requestContext = vi.hoisted(() => ({ cookieHeader: "" }));

vi.mock("next/headers", async () => {
  const { NextRequest } = await import("next/server");
  const requestHeaders = () => new Headers(
    requestContext.cookieHeader ? { cookie: requestContext.cookieHeader } : {},
  );
  return {
    headers: async () => requestHeaders(),
    // Use Next's real cookie parser so this regression also exercises its
    // decoding and duplicate-name behavior before the shared-parser fix.
    cookies: async () => new NextRequest("http://localhost", {
      headers: requestHeaders(),
    }).cookies,
  };
});

import { getDictionary } from "@/i18n/dictionaries";
import { localeFromBrowserCookie, localeFromRequest } from "@/i18n/locale";
import { getRequestDictionary, getRequestLocale } from "@/i18n/server";

describe("shared locale Cookie semantics", () => {
  it.each([
    { cookie: "", locale: "en" },
    { cookie: "diesel_locale=en", locale: "en" },
    { cookie: "session=ignored; diesel_locale=zh-CN", locale: "zh-CN" },
    { cookie: "diesel_locale=%7Ah-CN", locale: "zh-CN" },
    { cookie: "diesel_locale=%65%6E", locale: "en" },
    { cookie: "diesel_locale=%257Ah-CN", locale: "en" },
    { cookie: "diesel_locale_extra=zh-CN; diesel_locale=en", locale: "en" },
    { cookie: "diesel_locale=zh-CN; diesel_locale=en", locale: "zh-CN" },
    { cookie: "diesel_locale=en; diesel_locale=zh-CN", locale: "en" },
    { cookie: "diesel_locale=fr; diesel_locale=zh-CN", locale: "en" },
    { cookie: "diesel_locale=%E0%A4%A; diesel_locale=zh-CN", locale: "en" },
    { cookie: "diesel_locale=zh-CN; diesel_locale=%E0%A4%A", locale: "zh-CN" },
  ] as const)("keeps server, public API and browser locale $locale for $cookie", async ({
    cookie,
    locale,
  }) => {
    requestContext.cookieHeader = cookie;
    const request = new Request("http://localhost", {
      headers: cookie ? { cookie } : {},
    });

    expect(localeFromRequest(request)).toBe(locale);
    expect(localeFromBrowserCookie(() => cookie)).toBe(locale);
    expect(await getRequestLocale()).toBe(locale);
    expect(await getRequestDictionary()).toBe(getDictionary(locale));
  });
});
