import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Locale } from "@/i18n/locale";

const requestLocale = vi.hoisted(() => ({
  current: "en" as Locale,
}));

vi.mock("@/i18n/server", async () => {
  const { getDictionary } = await import("@/i18n/dictionaries");

  return {
    getRequestDictionary: async () => getDictionary(requestLocale.current),
  };
});

import CountryRouteLoading from "@/app/countries/[iso3]/loading";
import RootLoading from "@/app/loading";

type LoadingComponent = () => Promise<ReactElement>;

async function renderLoading(Component: LoadingComponent): Promise<string> {
  return renderToStaticMarkup(await Component());
}

const localeCases = [
  {
    countryCopy: "Loading the country detail interface…",
    forbiddenCountryCopy: "正在加载国家详情界面…",
    forbiddenRootCopy: "正在加载页面",
    locale: "en",
    rootCopy: "Loading page",
  },
  {
    countryCopy: "正在加载国家详情界面…",
    forbiddenCountryCopy: "Loading the country detail interface…",
    forbiddenRootCopy: "Loading page",
    locale: "zh-CN",
    rootCopy: "正在加载页面",
  },
] satisfies ReadonlyArray<{
  countryCopy: string;
  forbiddenCountryCopy: string;
  forbiddenRootCopy: string;
  locale: Locale;
  rootCopy: string;
}>;

describe("localized public loading states", () => {
  it.each(localeCases)(
    "renders the root loading state in $locale with status semantics",
    async ({ forbiddenRootCopy, locale, rootCopy }) => {
      requestLocale.current = locale;

      const html = await renderLoading(RootLoading);

      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('role="status"');
      expect(html).toContain(`<span class="sr-only">${rootCopy}</span>`);
      expect(html).not.toContain(forbiddenRootCopy);
    },
  );

  it.each(localeCases)(
    "renders the country loading state in $locale with status semantics",
    async ({ countryCopy, forbiddenCountryCopy, locale }) => {
      requestLocale.current = locale;

      const html = await renderLoading(CountryRouteLoading);

      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(countryCopy);
      expect(html).not.toContain(forbiddenCountryCopy);
    },
  );
});
