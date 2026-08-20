import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("defaults to English when no locale preference exists", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Global diesel regulations and product database",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("locale-toggle").getByRole("button", {
      exact: true,
      name: "EN",
    }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("switches to Chinese without losing the path or query and persists it", async ({
  context,
  page,
}) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Hydration failed")) {
      hydrationErrors.push(message.text());
    }
  });
  await page.goto("/map?utm_source=locale-test");
  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { name: "中文", exact: true })
    .click();

  await expect(page).toHaveURL(/\/map\?utm_source=locale-test$/u);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", { level: 1, name: "全球柴油机法规地图" }),
  ).toBeVisible();
  expect(
    (await context.cookies()).find(({ name }) => name === "diesel_locale")
      ?.value,
  ).toBe("zh-CN");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await page.getByRole("link", { exact: true, name: "首页" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /全球柴油机法规.*产品数据库/u,
    }),
  ).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});

test("announces locale-change failures in the active locale", async ({ page }) => {
  await page.goto("/");
  await page.route("**/api/preferences/locale", async (route) => {
    await route.fulfill({ status: 503 });
  });

  await page.getByRole("button", { name: "中文" }).click();
  await expect(page.getByText("Language change failed.", { exact: true })).toHaveAttribute(
    "role",
    "alert",
  );

  await page.unroute("**/api/preferences/locale");
  const response = await page.request.post("/api/preferences/locale", {
    data: { locale: "zh-CN" },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await page.route("**/api/preferences/locale", async (route) => {
    await route.fulfill({ status: 503 });
  });

  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { name: "EN", exact: true })
    .click();
  await expect(page.getByText("语言切换失败。", { exact: true })).toHaveAttribute(
    "role",
    "alert",
  );
});

test("keeps the locale control reachable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ height: 667, width: 375 });
  await page.goto("/chat");

  const toggle = page.getByTestId("locale-toggle");
  await expect(toggle).toBeVisible();
  await toggle.getByRole("button", { name: "中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", { name: "和数据一起讨论下一步" }),
  ).toBeVisible();
});

test("localizes visible country names and dates while preserving the ISO query", async ({
  page,
}) => {
  await page.goto("/countries/CHN?asOf=2026-08-12");

  const detail = page.getByRole("dialog");
  await expect(
    detail.getByRole("heading", { name: "China — demo fixture" }),
  ).toBeVisible();
  await expect(detail).toContainText("Aug 12, 2026");

  const response = await page.request.post("/api/preferences/locale", {
    data: { locale: "zh-CN" },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await expect(page).toHaveURL(/\/countries\/CHN\?asOf=2026-08-12$/u);
  await expect(
    detail.getByRole("heading", { name: "中国（演示数据）" }),
  ).toBeVisible();
  await expect(detail).toContainText("2026年8月12日");
});
