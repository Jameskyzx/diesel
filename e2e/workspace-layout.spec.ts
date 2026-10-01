import { expect, test } from "@playwright/test";

for (const locale of ["en", "zh-CN"] as const) {
  test(`keeps the redesigned navigation and content usable in ${locale}`, async ({ page, context }, testInfo) => {
    await context.clearCookies();
    const preference = await page.request.post("/api/preferences/locale", { data: { locale } });
    expect(preference.ok()).toBe(true);

    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByTestId("home-workspace")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const shell = page.getByTestId("app-navigation-shell");
      const home = page.getByRole("navigation").getByRole("link", { exact: true, name: locale === "en" ? "Home" : "首页" });
      await expect(home).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("locale-toggle")).toBeVisible();

      const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
      const navigation = await shell.boundingBox();
      expect(heading).not.toBeNull();
      expect(navigation).not.toBeNull();
      if (!heading || !navigation) throw new Error("Workspace bounds unavailable");
      expect(navigation.width).toBe(width);
      expect(heading.y).toBeGreaterThanOrEqual(navigation.y + navigation.height);
      const homeBounds = await home.boundingBox();
      const languageBounds = await page.getByTestId("locale-toggle").boundingBox();
      if (!homeBounds || !languageBounds) throw new Error("Header row bounds unavailable");
      expect(homeBounds.y).toBeGreaterThanOrEqual(languageBounds.y + languageBounds.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width === 320 || width === 1440) {
        await page.screenshot({ path: testInfo.outputPath(`home-${locale}-${width}.png`), fullPage: true });
      }
    }

    await page.getByRole("navigation").getByRole("link", { exact: true, name: locale === "en" ? "Map" : "地图" }).click();
    const workspace = page.getByTestId("map-workspace");
    const map = page.getByTestId("world-map");
    await expect(map).toBeVisible();
    const controls = await workspace.locator("aside").boundingBox();
    const canvas = await map.boundingBox();
    expect(controls).not.toBeNull();
    expect(canvas).not.toBeNull();
    if (!controls || !canvas) throw new Error("Map workspace bounds unavailable");
    expect(canvas.x).toBeGreaterThan(controls.x + controls.width);
    expect(canvas.width).toBeGreaterThan(controls.width);
    await expect(page.getByTestId("map-canvas-container")).toHaveAttribute("data-map-ready", "true");
    await page.screenshot({ path: testInfo.outputPath(`map-${locale}-1440.png`), fullPage: true });

    await page.getByLabel(locale === "en" ? "Select country" : "选择国家", { exact: true }).selectOption("CHN");
    await expect(page).toHaveURL(/\/countries\/CHN/);
    await expect(page.getByTestId("country-detail")).toBeVisible();
    await expect(page.getByTestId("country-drawer-locale-toggle")).toBeVisible();
  });
}
