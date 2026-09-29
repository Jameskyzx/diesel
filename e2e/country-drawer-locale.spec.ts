import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("switches locale from an open country drawer and preserves its shared URL", async ({
  context,
  page,
}, testInfo) => {
  const route =
    "/countries/CHN?applicationScope=non-road&asOf=2026-08-12&powerKw=100&productModelCode=DEMO-ENG-100&utm_source=drawer-locale";
  const expectSharedRoute = async () => {
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return `${url.pathname}${url.search}`;
      })
      .toBe(route);
  };
  await page.goto(route);

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  const languageGroup = page.getByRole("group", { name: "Language" });
  await expect(languageGroup).toBeVisible();
  await expect(page.getByRole("group", { name: "Language" })).toHaveCount(1);

  const chineseButton = languageGroup.getByRole("button", {
    exact: true,
    name: "中文",
  });
  if (testInfo.project.name === "mobile-chromium") {
    await chineseButton.tap();
  } else {
    await chineseButton.focus();
    await expect(chineseButton).toBeFocused();
    await page.keyboard.press("Enter");
  }

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expectSharedRoute();
  await expect(
    drawer.getByRole("heading", {
      exact: true,
      name: "中国（演示数据）",
    }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("group", { name: "语言" }).getByRole("button", {
      exact: true,
      name: "中文",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    (await context.cookies()).find(({ name }) => name === "diesel_locale")
      ?.value,
  ).toBe("zh-CN");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expectSharedRoute();
  await expect(
    page.getByRole("dialog").getByRole("heading", {
      exact: true,
      name: "中国（演示数据）",
    }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "语言" })).toHaveCount(1);
});

test("keeps the header locale control usable after a stale request and drawer round trip", async ({
  page,
}) => {
  let localeRequestCount = 0;
  let markFirstRequestSettled = () => {};
  let markFirstRequestStarted = () => {};
  let releaseFirstRequest = () => {};
  const firstRequestSettled = new Promise<void>((resolve) => {
    markFirstRequestSettled = resolve;
  });
  const firstRequestStarted = new Promise<void>((resolve) => {
    markFirstRequestStarted = resolve;
  });
  const firstRequestGate = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });

  await page.route("**/api/preferences/locale", async (route) => {
    localeRequestCount += 1;
    if (localeRequestCount !== 1) {
      await route.continue();
      return;
    }

    markFirstRequestStarted();
    await firstRequestGate;
    try {
      await route.fulfill({ status: 503 });
    } catch {
      // The Drawer locale change aborts this obsolete Header request. A late
      // controlled fulfillment may therefore be rejected by Playwright.
    } finally {
      markFirstRequestSettled();
    }
  });

  await page.goto("/map");
  const headerToggle = page.getByTestId("locale-toggle");
  const headerEnglishButton = headerToggle.getByRole("button", {
    exact: true,
    name: "EN",
  });
  const headerChineseButton = headerToggle.getByRole("button", {
    exact: true,
    name: "中文",
  });

  await headerChineseButton.click();
  await firstRequestStarted;
  await expect(headerChineseButton).toBeDisabled();

  await page.locator("#country-select").selectOption("BRA");
  await expect(page).toHaveURL(/\/countries\/BRA$/u);
  const drawerToggle = page.getByTestId("country-drawer-locale-toggle");
  await expect(drawerToggle).toBeVisible();

  await drawerToggle
    .getByRole("button", { exact: true, name: "中文" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await drawerToggle
    .getByRole("button", { exact: true, name: "EN" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  releaseFirstRequest();
  await firstRequestSettled;
  await page.getByRole("button", { name: "Close country details" }).click();
  await expect(page).toHaveURL(/\/map$/u);
  await expect(headerEnglishButton).toBeEnabled();
  await expect(headerChineseButton).toBeEnabled();

  await headerChineseButton.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});
