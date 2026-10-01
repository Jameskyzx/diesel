import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const brandHomeNames = {
  en: "GD · Global Diesel — Home",
  "zh-CN": "GD · Global Diesel — 首页",
} as const;

const analysisLinkCopy = {
  en: { description: "Open AI chat", name: "Start analysis" },
  "zh-CN": { description: "打开 AI 对话", name: "开始分析" },
} as const;

for (const locale of ["en", "zh-CN"] as const) {
  test(`names header links in ${locale} across viewport changes and keyboard navigation`, async (
    { context, page },
    testInfo,
  ) => {
    await context.clearCookies();
    const response = await page.request.post("/api/preferences/locale", {
      data: { locale },
    });
    expect(response.ok()).toBe(true);
    await page.setViewportSize({ height: 720, width: 320 });
    await page.goto("/chat?countryIso3=CHN");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);

    // Locate the brand link even before it has a descriptive accessible name.
    // The separate Home navigation link is intentionally not the target.
    const brandLink = page.getByRole("banner").locator('a[href="/"]').first();
    const brandIcon = brandLink.getByTestId("brand-engine-icon");
    await expect(brandIcon).toBeVisible();
    await expect(brandIcon).toHaveAttribute("alt", "");
    await expect(brandIcon).toHaveAttribute("aria-hidden", "true");
    await expect(brandIcon).toHaveAttribute("width", "44");
    await expect(brandIcon).toHaveAttribute("height", "44");
    await expect(brandIcon).toHaveAttribute("src", /diesel-chibi\.png/u);
    await expect.poll(() => brandIcon.evaluate(
      (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
    )).toBe(true);
    for (const width of [320, 640, 767, 768, 1024]) {
      await page.setViewportSize({ height: 720, width });
      await expect(brandLink).toHaveAccessibleName(brandHomeNames[locale]);
      await expect(brandLink).toHaveAttribute("href", "/");
    }

    const analysisLink = page.getByRole("banner")
      .getByRole("link", { exact: true, name: analysisLinkCopy[locale].name });
    await expect(analysisLink).toBeVisible();
    await expect(analysisLink).toHaveText(analysisLinkCopy[locale].name);
    await expect(analysisLink).toHaveAccessibleName(analysisLinkCopy[locale].name);
    await expect(analysisLink).toHaveAccessibleDescription(
      analysisLinkCopy[locale].description,
    );

    // Start at the document boundary so focus is reached by keyboard, not .focus().
    await page.setViewportSize({ height: 720, width: 320 });
    await page.goto("about:blank");
    await page.goto("/chat?countryIso3=CHN");
    const tabKey = testInfo.project.name === "core-webkit" ? "Alt+Tab" : "Tab";
    await page.keyboard.press(tabKey);
    await expect(page.getByRole("link", {
      exact: true,
      name: locale === "en" ? "Skip to main content" : "跳到主要内容",
    })).toBeFocused();
    await page.keyboard.press(tabKey);
    await expect(brandLink).toBeFocused();
    await expect(brandLink).toHaveAccessibleName(brandHomeNames[locale]);
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);

    const nextLocale = locale === "en" ? "zh-CN" : "en";
    await page.getByTestId("locale-toggle").getByRole("button", {
      exact: true,
      name: nextLocale === "en" ? "EN" : "中文",
    }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
    await expect(brandLink).toHaveAccessibleName(brandHomeNames[nextLocale]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
    await expect(brandLink).toHaveAccessibleName(brandHomeNames[nextLocale]);

    await page.setViewportSize({ height: 720, width: 1024 });
    const localizedAnalysisLink = page.getByRole("banner")
      .getByRole("link", { exact: true, name: analysisLinkCopy[nextLocale].name });
    await expect(localizedAnalysisLink).toHaveAccessibleName(
      analysisLinkCopy[nextLocale].name,
    );
    await expect(localizedAnalysisLink).toHaveAccessibleDescription(
      analysisLinkCopy[nextLocale].description,
    );
    await localizedAnalysisLink.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/chat");
    await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
  });
}

test("keeps non-modal country navigation keyboard-accessible in both locales", async ({
  page,
}, testInfo) => {
  const tabKey = testInfo.project.name === "core-webkit" ? "Alt+Tab" : "Tab";
  for (const locale of ["en", "zh-CN"] as const) {
    const response = await page.request.post("/api/preferences/locale", { data: { locale } });
    expect(response.ok()).toBe(true);
    await page.goto("/countries/CHN");
    await expect(page.getByTestId("country-detail")).toBeVisible();
    const drawer = page.getByRole("dialog");
    const home = page.getByRole("banner").getByRole("link", { name: brandHomeNames[locale], exact: true });
    // Moving focus outside must not be pulled back into a hidden modal scope.
    await home.focus();
    await expect(home).toBeFocused();
    await page.keyboard.press(tabKey);
    await expect(page.getByTestId("locale-toggle").getByRole("button", { name: "EN", exact: true })).toBeFocused();
    await expect(drawer).toBeVisible();
    await home.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect(drawer).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  }
});

for (const route of [
  "/",
  "/chat",
  "/map",
  "/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=100&productModelCode=DEMO-ENG-100",
] as const) {
  test(`${route} has no serious or critical accessibility violations`, async (
    { page },
  ) => {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    if (route.startsWith("/countries/")) {
      await expect(page.getByTestId("product-fit-result")).toBeVisible();
      // This is a non-modal workspace panel: visible navigation and map
      // controls must remain in the accessibility tree while it is open.
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
      await expect(page.getByRole("group", { name: "Language", exact: true })).toHaveCount(2);
      await expect(page.locator("#main-content")).not.toHaveAttribute("aria-hidden", "true");
      await expect(page.locator("#main-content")).not.toHaveAttribute("inert");
      const expectedTitle =
        "People's Republic of China (CHN) country details · Global Regulations & Market Intelligence";
      await expect(page).toHaveTitle(expectedTitle);
      await expect(page.locator("head > title")).toHaveCount(1);
      await expect
        .poll(() =>
          page
            .locator("head > title")
            .evaluate((title: HTMLTitleElement) => title.text),
        )
        .toBe(expectedTitle);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        "content",
        "People's Republic of China (CHN) country details",
      );
    } else {
      // Next.js may stream route metadata after the first body bytes. Scan the
      // settled document so axe does not report a transient empty <title>.
      await expect(page).toHaveTitle(/\S/u);
      await expect(page.locator("head > title")).toHaveCount(1);
      await expect
        .poll(() =>
          page
            .locator("head > title")
            .evaluate((title: HTMLTitleElement) => title.text),
        )
        .toMatch(/\S/u);
    }

    const results = await new AxeBuilder({ page })
      .options({ runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })
      .analyze();
    const hasIndependentlyVerifiedCountryTitle =
      route.startsWith("/countries/");
    const blockingViolations = results.violations.filter(({ id, impact }) => {
      if (impact !== "critical" && impact !== "serious") {
        return false;
      }

      // axe-core can miss Next.js's streamed country title even after
      // document.title, the DOM title, and Open Graph title all settle. Those
      // three assertions above remain the source of truth for this rule.
      return !(
        hasIndependentlyVerifiedCountryTitle && id === "document-title"
      );
    });

    expect(blockingViolations).toEqual([]);
  });
}
