import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("regulation timeline", () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    const response = await page.request.post("/api/preferences/locale", {
      data: { locale: "en" },
    });
    expect(response.ok()).toBe(true);
  });

  test("lists dated events with explicit status and sources", async ({
    page,
  }) => {
    await page.goto("/timeline");
    await expect(
      page.getByRole("heading", { level: 1, name: "Regulation timeline" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Timeline", exact: true }),
    ).toHaveAttribute("aria-current", "page");

    const events = page.getByTestId("timeline-event");
    await expect(events.first()).toBeVisible();
    // The demo seed includes a proposed date; it must never read as binding.
    await expect(
      page.locator('[data-regulation-status="proposed"]').first(),
    ).toContainText("Proposed: date not adopted, not binding");
    await expect(events.first().locator("time")).toHaveAttribute(
      "datetime",
      /^\d{4}-\d{2}-\d{2}$/u,
    );
    await expect(events.first()).toContainText("Source");
    await expect(page.getByTestId("timeline-catalog-impact")).toHaveCount(0);
    await expect(
      page.getByText(
        "Choose an application and a power to see the demo engine impact.",
      ),
    ).toBeVisible();
  });

  test("filters through a shareable URL and shows demo engine impact", async ({
    page,
  }) => {
    await page.goto("/timeline");
    await page
      .getByLabel("Application", { exact: true })
      .selectOption("non-road");
    await page.getByLabel("Power (kW)", { exact: true }).fill("100");
    await page.getByRole("button", { name: "Update timeline" }).click();
    await expect(page).toHaveURL(
      /\/timeline\?applicationScope=non-road&powerKw=100&horizonMonths=60$/u,
    );
    await expect(page.getByLabel("Application", { exact: true })).toHaveValue(
      "non-road",
    );

    const impact = page.getByTestId("timeline-catalog-impact").first();
    await expect(impact).toBeVisible();
    await expect(impact).toContainText("not certification");

    const countryLink = page
      .getByTestId("timeline-event")
      .first()
      .getByRole("link")
      .first();
    await expect(countryLink).toHaveAttribute(
      "href",
      /^\/countries\/[A-Z]{3}\?asOf=\d{4}-\d{2}-\d{2}&applicationScope=non-road&powerKw=100$/u,
    );
  });

  test("falls back to the default view for invalid filters", async ({
    page,
  }) => {
    const response = await page.goto(
      "/timeline?applicationScope=rocket&horizonMonths=7",
    );
    expect(response?.status()).toBe(200);
    await expect(page.getByLabel("Application", { exact: true })).toHaveValue(
      "",
    );
    await expect(page.getByLabel("Look ahead", { exact: true })).toHaveValue(
      "60",
    );
  });

  test("has no axe violations and no horizontal scroll on a phone", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 812, width: 375 });
    await page.goto("/timeline?applicationScope=non-road&powerKw=100");
    await expect(page.getByTestId("timeline-event").first()).toBeVisible();
    // Same rule set and blocking threshold as accessibility.spec.ts.
    const results = await new AxeBuilder({ page })
      .options({ runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })
      .analyze();
    expect(
      results.violations.filter(
        ({ impact }) => impact === "critical" || impact === "serious",
      ),
    ).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
