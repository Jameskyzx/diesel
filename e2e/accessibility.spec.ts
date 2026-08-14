import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const route of ["/", "/chat"] as const) {
  test(`${route} has no serious or critical accessibility violations`, async ({
    page,
  }) => {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .options({ runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })
      .analyze();
    const blockingViolations = results.violations.filter(({ impact }) =>
      impact === "critical" || impact === "serious",
    );

    expect(blockingViolations).toEqual([]);
  });
}
