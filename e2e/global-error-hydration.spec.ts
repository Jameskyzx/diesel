import { expect, test } from "@playwright/test";

test("renders the default-English global error in the real root boundary", async ({
  context,
  page,
}) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      text.includes("Hydration failed") ||
      text.includes("A tree hydrated but some attributes")
    ) {
      hydrationErrors.push(text);
    }
  });
  await context.addCookies([
    {
      domain: "127.0.0.1",
      name: "__e2e_global_error",
      path: "/",
      value: "1",
    },
  ]);

  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", {
      name: "The application is temporarily unavailable",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveAttribute("aria-atomic", "true");
  await expect(
    page.getByRole("heading", { name: "应用暂时不可用" }),
  ).toHaveCount(0);
  await expect(page).toHaveTitle("The application is temporarily unavailable");
  await expect(page.locator("head > title")).toHaveCount(1);
  await expect.poll(() => page.locator("head > title")
    .evaluate((title: HTMLTitleElement) => title.text))
    .toBe("The application is temporarily unavailable");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("The application is temporarily unavailable");
  await expect(page.locator("head > title")).toHaveCount(1);
  expect(hydrationErrors).toEqual([]);
});

test("recovers the global error from the authoritative locale cookie", async ({
  context,
  page,
}) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      text.includes("Hydration failed") ||
      text.includes("A tree hydrated but some attributes")
    ) {
      hydrationErrors.push(text);
    }
  });

  await context.addCookies([
    {
      domain: "127.0.0.1",
      name: "diesel_locale",
      path: "/",
      value: "zh-CN",
    },
    {
      domain: "127.0.0.1",
      name: "__e2e_global_error",
      path: "/",
      value: "1",
    },
  ]);

  const serverResponse = await context.request.get("/");
  const serverHtml = await serverResponse.text();
  expect(serverResponse.status()).toBe(500);
  expect(serverHtml).toContain("app/global-error");
  expect(serverHtml).not.toContain(
    "The application is temporarily unavailable",
  );
  expect(serverHtml).not.toContain("应用暂时不可用");

  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", { name: "应用暂时不可用" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "请稍后重试。服务恢复前不会展示未经核验的数据。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveAttribute("aria-atomic", "true");
  await expect(
    page.getByText("The application is temporarily unavailable", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page).toHaveTitle("应用暂时不可用");
  await expect(page.locator("head > title")).toHaveCount(1);
  await expect.poll(() => page.locator("head > title")
    .evaluate((title: HTMLTitleElement) => title.text)).toBe("应用暂时不可用");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page).toHaveTitle("应用暂时不可用");
  await expect(page.locator("head > title")).toHaveCount(1);
  expect(hydrationErrors).toEqual([]);
});
