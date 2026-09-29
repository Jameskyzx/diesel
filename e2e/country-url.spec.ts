import { expect, test } from "@playwright/test";

import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";

const normalizationCases = [
  {
    name: "lowercase country and invalid filters",
    input:
      "/countries/chn?powerKw=abc&applicationScope=non-road&asOf=2026-02-30&productModelCode=%20&utm_term=engine&utm_term=export",
    canonical:
      "/countries/CHN?applicationScope=non-road&utm_term=engine&utm_term=export",
  },
  {
    name: "first repeated known values and all unknown values",
    input:
      "/countries/chn?powerKw=300.0&powerKw=100&applicationScope=non-road&applicationScope=marine&asOf=2026-01-20&asOf=2026-03-10&productModelCode=%20demo-eng-300%20&productModelCode=DEMO-ENG-100&utm_term=engine&utm_term=export&tag=",
    canonical:
      "/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=300&productModelCode=DEMO-ENG-300&utm_term=engine&utm_term=export&tag=",
  },
  {
    name: "invalid first values despite valid later repetitions",
    input:
      "/countries/CHN?applicationScope=invalid&applicationScope=non-road&asOf=invalid&asOf=2026-01-20&powerKw=NaN&powerKw=300&productModelCode=%20&productModelCode=DEMO-ENG-300&utm_term=engine&utm_term=export",
    canonical: "/countries/CHN?utm_term=engine&utm_term=export",
  },
  {
    name: "prototype-named input without changing the filter context",
    input:
      "/countries/chn?__proto__=first&__proto__=second&powerKw=300.0&utm_term=engine&utm_term=export",
    // Next 16.3.3's query object round-trip drops __proto__ before invoking
    // proxy. This is an observed framework limitation, not application-level
    // preservation or a claimed intentional security filter. Direct parser /
    // proxy unit controls separately prove safe handling when the key arrives.
    canonical: "/countries/CHN?powerKw=300&utm_term=engine&utm_term=export",
  },
] as const;

const exactPowerNormalizationCases = [
  {
    name: "excess precision below 56 without rounding to 56",
    powerKw: "55.999999999999999999",
    canonicalPowerKw: null,
  },
  {
    name: "an exact value above the maximum without rounding into range",
    powerKw: "100000.000000000001",
    canonicalPowerKw: null,
  },
  {
    name: "negative underflow without rounding to zero",
    powerKw: "-1e-999",
    canonicalPowerKw: null,
  },
  {
    name: "positive underflow without rounding to zero",
    powerKw: "1e-999",
    canonicalPowerKw: null,
  },
  {
    name: "valid scientific notation",
    powerKw: "5.6e1",
    canonicalPowerKw: "56",
  },
  {
    name: "valid thousandth with a trailing zero",
    powerKw: "0.0010",
    canonicalPowerKw: "0.001",
  },
  {
    name: "valid integer with a trailing decimal zero",
    powerKw: "300.0",
    canonicalPowerKw: "300",
  },
].map((scenario) => ({
  ...scenario,
  input:
    `/countries/chn?powerKw=${encodeURIComponent(scenario.powerKw)}&powerKw=100` +
    "&applicationScope=non-road&asOf=2026-01-20&utm_term=engine&utm_term=export&tag=",
  canonical:
    "/countries/CHN?applicationScope=non-road&asOf=2026-01-20" +
    (scenario.canonicalPowerKw === null ? "" : `&powerKw=${scenario.canonicalPowerKw}`) +
    "&utm_term=engine&utm_term=export&tag=",
}));

const locales = [
  { name: "default English", locale: "en", heading: "China — demo fixture" },
  { name: "persisted Chinese", locale: "zh-CN", heading: "中国（演示数据）" },
] as const;

const mapQuery =
  "powerKw=300.0&applicationScope=non-road&asOf=2026-01-20&utm_term=engine&utm_term=export";
const canonicalCountryPath =
  "/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=300&utm_term=engine&utm_term=export";

test.describe("country URL request normalization", () => {
  for (const method of ["get", "head"] as const) {
    for (const scenario of [...normalizationCases, ...exactPowerNormalizationCases]) {
      test(`${method.toUpperCase()} redirects ${scenario.name} once before rendering`, async ({
        request,
      }) => {
        const response = await request[method](scenario.input, {
          maxRedirects: 0,
        });

        expect(response.status()).toBe(307);
        const location = response.headers().location;
        expect(location).toBeDefined();
        const source = new URL(response.url());
        const destination = new URL(location, source);
        expect(destination.origin).toBe(source.origin);
        expect(destination.href).toBe(new URL(scenario.canonical, source).href);

        const canonicalResponse = await request[method](destination.href, {
          maxRedirects: 0,
        });
        expect(canonicalResponse.status()).toBe(200);
        expect(canonicalResponse.headers().location).toBeUndefined();
      });
    }
  }

  for (const { name, locale, heading } of locales) {
    test.describe(name, () => {
      test.beforeEach(async ({ baseURL, context }) => {
        await context.clearCookies();
        if (locale === "zh-CN") {
          await context.addCookies([
            {
              name: "diesel_locale",
              url: baseURL ?? "http://127.0.0.1:3100",
              value: locale,
              expires: Math.floor(Date.now() / 1_000) + 86_400,
            },
          ]);
        }
      });

      test("hard navigation normalizes filters without browser runtime errors", async ({
        context,
        page,
      }, testInfo) => {
        await checkBrowserRuntimeErrors(page, testInfo, async () => {
          for (const scenario of [
            normalizationCases[0],
            {
              input: `/countries/chn?${mapQuery}`,
              canonical: canonicalCountryPath,
            },
          ]) {
            const response = await page.goto(scenario.input);
            expect(response?.status()).toBe(200);
            await expect(page).toHaveURL(new URL(scenario.canonical, page.url()).href);
            await expect(page.locator("html")).toHaveAttribute("lang", locale);
            await expect(page.getByTestId("country-detail")).toBeVisible();
            await expect(page.getByRole("heading", { exact: true, name: heading })).toBeVisible();
          }

          const localeCookies = (await context.cookies()).filter(
            (cookie) => cookie.name === "diesel_locale",
          );
          expect(localeCookies.map((cookie) => cookie.value)).toEqual(
            locale === "zh-CN" ? ["zh-CN"] : [],
          );
        });
      });

      test("normalizes exact power strings without rounding or selecting a later repeated value", async ({
        page,
      }, testInfo) => {
        await checkBrowserRuntimeErrors(page, testInfo, async () => {
          for (const scenario of exactPowerNormalizationCases) {
            await test.step(scenario.name, async () => {
              const response = await page.goto(scenario.input);
              expect(response?.status()).toBe(200);
              await expect(page).toHaveURL(new URL(scenario.canonical, page.url()).href);

              const destination = new URL(page.url());
              expect(destination.pathname).toBe("/countries/CHN");
              expect(destination.searchParams.getAll("powerKw")).toEqual(
                scenario.canonicalPowerKw === null ? [] : [scenario.canonicalPowerKw],
              );
              expect(destination.searchParams.getAll("applicationScope")).toEqual(["non-road"]);
              expect(destination.searchParams.getAll("asOf")).toEqual(["2026-01-20"]);
              expect(destination.searchParams.getAll("utm_term")).toEqual(["engine", "export"]);
              expect(destination.searchParams.getAll("tag")).toEqual([""]);
              await expect(page.locator("html")).toHaveAttribute("lang", locale);
              await expect(page.getByTestId("country-detail")).toBeVisible();
              await expect(page.getByRole("heading", { exact: true, name: heading })).toBeVisible();
            });
          }
        });
      });

      test("country selection follows a real RSC redirect without a document reload", async ({
        context,
        page,
      }, testInfo) => {
        await checkBrowserRuntimeErrors(page, testInfo, async () => {
          await page.goto(`/map?${mapQuery}`);
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          await expect(page.getByTestId("map-canvas-container")).toHaveAttribute(
            "data-map-ready",
            "true",
          );
          await expect(page.locator("#country-select")).toBeEnabled();

          // A property on the current document disappears if navigation reloads it.
          await page.evaluate(() => {
            document.documentElement.dataset.countryUrlNavigation = "same-document";
          });

          const [redirectResponse] = await Promise.all([
            page.waitForResponse((response) => {
              const url = new URL(response.url());
              return url.pathname === "/countries/CHN" &&
                url.searchParams.get("powerKw") === "300.0" &&
                response.request().headers().rsc === "1" &&
                response.status() === 307;
            }),
            page.locator("#country-select").selectOption("CHN"),
          ]);

          expect(redirectResponse.request().isNavigationRequest()).toBe(false);
          const location = redirectResponse.headers().location;
          expect(location).toBeDefined();
          const destination = new URL(location, redirectResponse.url());
          expect(destination.origin).toBe(new URL(page.url()).origin);
          // The default Next adapter strips its internal cache key before proxy.
          expect(destination.searchParams.has("_rsc")).toBe(false);
          expect(destination.href).toBe(new URL(canonicalCountryPath, page.url()).href);

          await expect(page).toHaveURL(new URL(canonicalCountryPath, page.url()).href);
          await expect(page.getByTestId("country-detail")).toBeVisible();
          await expect(page.getByRole("heading", { exact: true, name: heading })).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          await expect(page.locator("html")).toHaveAttribute(
            "data-country-url-navigation",
            "same-document",
          );
          const localeCookies = (await context.cookies()).filter(
            (cookie) => cookie.name === "diesel_locale",
          );
          expect(localeCookies.map((cookie) => cookie.value)).toEqual(
            locale === "zh-CN" ? ["zh-CN"] : [],
          );
        });
      });
    });
  }
});
