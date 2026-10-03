import { expect, test } from "@playwright/test";

for (const locale of ["en", "zh-CN"] as const) {
  test(`uses the Tabler workspace structure across viewports in ${locale}`, async ({ page, context }, testInfo) => {
    await context.clearCookies();
    const preference = await page.request.post("/api/preferences/locale", { data: { locale } });
    expect(preference.ok()).toBe(true);

    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByTestId("home-workspace")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const shell = page.getByTestId("app-navigation-shell");
      const sidebar = page.getByTestId("workspace-sidebar");
      const home = sidebar.getByRole("link", { exact: true, name: locale === "en" ? "Home" : "首页" });
      await expect(home).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("locale-toggle")).toBeVisible();
      const headerBounds = await shell.boundingBox();
      const sidebarBounds = await sidebar.boundingBox();
      const contentBounds = await page.getByTestId("home-workspace").boundingBox();
      if (!headerBounds || !sidebarBounds || !contentBounds) throw new Error("Workspace bounds unavailable");
      if (width >= 1024) {
        expect(sidebarBounds.x).toBe(0);
        expect(sidebarBounds.width).toBe(240);
        expect(contentBounds.x).toBeGreaterThanOrEqual(sidebarBounds.x + sidebarBounds.width);
        expect(headerBounds.x).toBeGreaterThanOrEqual(sidebarBounds.x + sidebarBounds.width);
      } else {
        expect(headerBounds.width).toBe(width);
        const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
        if (!heading) throw new Error("Heading bounds unavailable");
        expect(heading.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height);
      }
      await expect(page.getByTestId("country-evidence-table").getByRole("table")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width === 320 || width === 1440) {
        await page.screenshot({ path: testInfo.outputPath(`home-${locale}-${width}.png`), fullPage: true });
      }
    }

    const search = page.getByRole("searchbox", { name: locale === "en" ? "Search reviewed countries" : "搜索已核验国家" });
    await search.fill("CHN");
    const table = page.getByTestId("country-evidence-table").getByRole("table");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table.locator('a[href="/countries/CHN"]')).toBeVisible();
    await search.fill("NO-MATCH-ISO3");
    await expect(table.getByRole("status")).toHaveText(locale === "en" ? "No reviewed countries match this search." : "没有匹配此搜索的已核验国家。");
    await table.getByRole("button", { name: locale === "en" ? "Clear search" : "清除搜索" }).click();
    await expect(search).toHaveValue("");

    await page.getByRole("navigation").getByRole("link", { exact: true, name: locale === "en" ? "Map" : "地图" }).click();
    const map = page.getByTestId("world-map");
    await expect(map).toBeVisible();
    const controls = await page.getByTestId("map-country-toolbar").boundingBox();
    const canvas = await map.boundingBox();
    if (!controls || !canvas) throw new Error("Map workspace bounds unavailable");
    expect(canvas.y).toBeGreaterThanOrEqual(controls.y + controls.height);
    await expect(page.getByTestId("map-canvas-container")).toHaveAttribute("data-map-ready", "true");
    await page.screenshot({ path: testInfo.outputPath(`map-${locale}-1440.png`), fullPage: true });

    await page.getByLabel(locale === "en" ? "Select country" : "选择国家", { exact: true }).selectOption("CHN");
    await expect(page).toHaveURL(/\/countries\/CHN/);
    await expect(page.getByTestId("country-detail")).toBeVisible();
    await expect(page.getByTestId("country-drawer-locale-toggle")).toBeVisible();
    const panelBounds = await page.getByRole("dialog").boundingBox();
    const selectedMapBounds = await map.boundingBox();
    if (!panelBounds || !selectedMapBounds) throw new Error("Country workspace bounds unavailable");
    expect(selectedMapBounds.x + selectedMapBounds.width).toBeLessThanOrEqual(panelBounds.x);
    expect(panelBounds.y).toBeGreaterThanOrEqual(64);
    await page.getByRole("dialog").getByRole("link", { name: locale === "en" ? "Sources" : "来源", exact: true }).click();
    await expect(page.getByRole("heading", { name: locale === "en" ? "Data sources and verification" : "数据来源与核验", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`country-${locale}-1440.png`), fullPage: true });

    await page.goto("/chat?countryIso3=CHN&applicationScope=non-road&powerKw=100&asOf=2026-01-20");
    const queryContext = page.getByTestId("chat-query-context");
    await expect(queryContext).toContainText("CHN");
    await expect(queryContext).toContainText("100 kW");
    const contextBounds = await queryContext.boundingBox();
    const chatBounds = await page.locator("#sales-chat-panel").boundingBox();
    if (!contextBounds || !chatBounds) throw new Error("Chat workspace bounds unavailable");
    expect(chatBounds.x).toBeGreaterThan(contextBounds.x + contextBounds.width);
    await page.screenshot({ path: testInfo.outputPath(`chat-${locale}-1440.png`), fullPage: true });
  });
}
