import { expect, test } from "@playwright/test";

import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";
import { getDictionary } from "../src/i18n/dictionaries";

test.beforeEach(async ({ baseURL, context }) => {
  await context.addCookies([
    {
      name: "diesel_locale",
      url: baseURL ?? "http://127.0.0.1:3100",
      value: "zh-CN",
    },
  ]);
});

import { WORLD_COUNTRIES_GEOJSON_URL } from "../src/lib/geo-assets";

const worldCountriesRequest = `**${WORLD_COUNTRIES_GEOJSON_URL}`;

test("shows an explicit error and recovers when country geometry fails", async ({
  page,
}) => {
  await page.route(worldCountriesRequest, async (route) => {
    await route.fulfill({ body: "upstream unavailable", status: 503 });
  });
  await page.goto("/map");

  await expect(
    page.getByRole("alert").filter({ hasText: "国家边界加载失败" }),
  ).toBeVisible();
  const legend = getDictionary("zh-CN").map.legendData;
  await expect(page.getByText(legend, { exact: true })).toHaveCount(0);

  await page.unroute(worldCountriesRequest);
  await page.getByRole("button", { name: "重试加载地图" }).click();

  await expect(page.getByTestId("map-canvas-container")).toHaveAttribute(
    "data-map-ready",
    "true",
  );
  await expect(page.getByText(legend, { exact: true })).toBeVisible();
});

test("opens a shareable country URL by clicking the map polygon", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Pointer-coordinate polygon coverage runs in the desktop project.",
  );

  await page.goto("/map");

  const mapContainer = page.getByTestId("map-canvas-container");
  await expect(mapContainer).toHaveAttribute("data-map-ready", "true");

  const boundingBox = await mapContainer.boundingBox();
  expect(boundingBox).not.toBeNull();

  const zoom = 1.15;
  const worldSize = 512 * 2 ** zoom;
  const mercatorY = (latitude: number) =>
    (1 -
      Math.log(
        Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360),
      ) /
        Math.PI) /
    2;

  await mapContainer.click({
    position: {
      x: (boundingBox?.width ?? 0) / 2 + ((105 - 8) / 360) * worldSize,
      y:
        (boundingBox?.height ?? 0) / 2 +
        (mercatorY(35) - mercatorY(18)) * worldSize,
    },
  });

  await expect(page).toHaveURL(/\/countries\/CHN$/);
  await expect(
    page.getByRole("heading", { exact: true, name: "中国（演示数据）" }),
  ).toBeVisible();
});

test("includes a country snapshot in the server-rendered share-page HTML", async ({
  request,
}) => {
  const response = await request.get("/countries/CHN?asOf=2026-01-20");
  expect(response.ok()).toBe(true);
  const html = await response.text();

  expect(html).toContain("SERVER-RENDERED COUNTRY SNAPSHOT");
  expect(html).toContain("country-server-fallback");
  expect(html).toContain("2026-01-20");
});

test("keeps the map tooltip inside a narrow pointer viewport", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "This test uses a narrow viewport with a desktop pointer.",
  );
  await page.setViewportSize({ height: 800, width: 375 });
  await page.goto("/map");

  const mapContainer = page.getByTestId("map-canvas-container");
  await expect(mapContainer).toHaveAttribute("data-map-ready", "true");
  const mapBox = await mapContainer.boundingBox();
  expect(mapBox).not.toBeNull();

  const zoom = 1.15;
  const worldSize = 512 * 2 ** zoom;
  const mercatorY = (latitude: number) =>
    (1 -
      Math.log(
        Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360),
      ) /
        Math.PI) /
    2;
  await mapContainer.hover({
    position: {
      x: (mapBox?.width ?? 0) / 2 + ((10 - 8) / 360) * worldSize,
      y:
        (mapBox?.height ?? 0) / 2 +
        (mercatorY(51) - mercatorY(18)) * worldSize,
    },
  });

  const tooltip = page.getByTestId("map-tooltip");
  await expect(tooltip).toBeVisible();
  const tooltipBox = await tooltip.boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect((tooltipBox?.x ?? 0) + (tooltipBox?.width ?? 0)).toBeLessThanOrEqual(
    (mapBox?.x ?? 0) + (mapBox?.width ?? 0),
  );
  expect((tooltipBox?.y ?? 0) + (tooltipBox?.height ?? 0)).toBeLessThanOrEqual(
    (mapBox?.y ?? 0) + (mapBox?.height ?? 0),
  );
});

test("keeps the English country selector inside a 320px viewport", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The narrow-layout regression only needs one browser project.",
  );
  await context.clearCookies();
  await page.setViewportSize({ height: 667, width: 320 });

  for (const route of ["/map", "/countries/CHN?asOf=2026-08-12"] as const) {
    await page.goto(route);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByLabel("Select country")).toBeEnabled();

    const layout = await page.evaluate(() => {
      const selector = document.querySelector<HTMLSelectElement>(
        "#country-select",
      );
      const selectorBounds = selector?.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        selectorRight: selectorBounds?.right ?? Number.POSITIVE_INFINITY,
      };
    });

    expect(layout.selectorRight).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  }
});

test("uses governed Demo classification in both country selectors and locales", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The selector classification contract only needs one browser project.",
  );
  await context.clearCookies();
  await page.goto("/countries/CHN");

  const mainOption = page.locator('#country-select option[value="CHN"]');
  const drawerOption = page.locator(
    '#drawer-country-select option[value="CHN"]',
  );
  await expect(mainOption).toHaveText("China — demo fixture · CHN");
  await expect(drawerOption).toHaveText("China — demo fixture · CHN");
  await expect(mainOption).not.toHaveText("People's Republic of China · CHN");

  const localeResponse = await page.request.post("/api/preferences/locale", {
    data: { locale: "zh-CN" },
  });
  expect(localeResponse.ok()).toBe(true);
  await page.reload();

  await expect(mainOption).toHaveText("中国（演示数据） · CHN");
  await expect(drawerOption).toHaveText("中国（演示数据） · CHN");
  await expect(mainOption).not.toHaveText("中国 · CHN");
});

test("does not infer Demo country copy from a name when classification is real", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The fail-closed selector regression only needs one browser project.",
  );
  await page.route("**/api/countries", async (route) => {
    await route.fulfill({
      json: {
        countries: [
          {
            dataCoverageStatus: "covered",
            isDemo: false,
            iso2: "CN",
            iso3: "CHN",
            isStale: false,
            nameEn: "China — demo fixture",
            nameLocal: "中国（演示数据）",
            verifiedAt: "2026-08-31T00:00:00.000Z",
          },
        ],
        status: "ok",
      },
      status: 200,
    });
  });

  await page.goto("/map");
  const option = page.locator('#country-select option[value="CHN"]');
  await expect(option).toHaveText("China — demo fixture · CHN");
  await expect(option).not.toHaveText("中国（演示数据） · CHN");
});

test("keeps ready country details inside the 320px drawer in both locales", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The deterministic narrow drawer boundary only needs one browser project.",
  );
  await context.clearCookies();
  await page.setViewportSize({ height: 667, width: 320 });
  const route =
    "/countries/CHN?applicationScope=non-road&asOf=2026-08-12&powerKw=100&productModelCode=DEMO-ENG-100";

  const expectDrawerContentFits = async () => {
    await expect(page.getByTestId("product-fit-result")).toBeVisible();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    await expect
      .poll(() =>
        drawer.evaluate((element) => {
          const drawerBounds = element.getBoundingClientRect();
          const body = element.querySelector<HTMLElement>(
            '[data-testid="country-drawer-body"]',
          );
          const badgeBounds = Array.from(
            element.querySelectorAll<HTMLElement>("span.rounded-full"),
          )
            .map((badge) => badge.getBoundingClientRect())
            .filter(({ height, width }) => height > 0 && width > 0);

          return {
            badgeCount: badgeBounds.length,
            badgesInside:
              badgeBounds.length > 0 &&
              badgeBounds.every(
                ({ left, right }) =>
                  left >= drawerBounds.left - 0.5 &&
                  right <= drawerBounds.right + 0.5,
              ),
            bodyClientWidth: body?.clientWidth ?? 0,
            bodyScrollWidth: body?.scrollWidth ?? Number.POSITIVE_INFINITY,
          };
        }),
      )
      .toMatchObject({
        badgesInside: true,
      });

    const layout = await drawer.evaluate((element) => {
      const body = element.querySelector<HTMLElement>(
        '[data-testid="country-drawer-body"]',
      );
      return {
        badgeCount: element.querySelectorAll("span.rounded-full").length,
        bodyClientWidth: body?.clientWidth ?? 0,
        bodyScrollWidth: body?.scrollWidth ?? Number.POSITIVE_INFINITY,
      };
    });
    expect(layout.badgeCount).toBeGreaterThan(0);
    expect(layout.bodyClientWidth).toBeGreaterThan(0);
    // Vaul intentionally extends the dialog's swipe surface with a pseudo
    // element. The drawer body is the user-scrollable content boundary.
    expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.bodyClientWidth);
  };

  await page.goto(route);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expectDrawerContentFits();

  const localeResponse = await page.request.post("/api/preferences/locale", {
    data: { locale: "zh-CN" },
  });
  expect(localeResponse.ok()).toBe(true);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expectDrawerContentFits();
});

test("keeps the current destination visible in the 320px header navigation", async ({
  context,
  page,
}) => {
  await context.clearCookies();

  const expectCurrentDestinationVisible = async (label: string) => {
    const navigation = page.getByRole("navigation", {
      name: /Primary navigation|主导航/u,
    });
    const currentLink = navigation.getByRole("link", {
      exact: true,
      name: label,
    });
    await expect(currentLink).toHaveAttribute("aria-current", "page");
    await expect
      .poll(() =>
        currentLink.evaluate((link) => {
          const navigationElement = link.closest("nav");
          if (!navigationElement) return false;
          const linkBounds = link.getBoundingClientRect();
          const navigationBounds = navigationElement.getBoundingClientRect();
          return (
            linkBounds.left >= navigationBounds.left &&
            linkBounds.right <= navigationBounds.right
          );
        }),
      )
      .toBe(true);
  };

  await page.goto("/map");
  await page.setViewportSize({ height: 667, width: 320 });
  await expectCurrentDestinationVisible("Map");

  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { exact: true, name: "中文" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expectCurrentDestinationVisible("地图");

  await page.goto("/chat");
  await expectCurrentDestinationVisible("对话");
});

test("updates the tooltip across consecutive country hovers", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Pointer-coordinate hover coverage runs in the desktop project.",
  );

  await page.goto("/map");

  const mapContainer = page.getByTestId("map-canvas-container");
  await expect(mapContainer).toHaveAttribute("data-map-ready", "true");
  const mapBox = await mapContainer.boundingBox();
  expect(mapBox).not.toBeNull();

  const zoom = 1.15;
  const worldSize = 512 * 2 ** zoom;
  const mercatorY = (latitude: number) =>
    (1 -
      Math.log(
        Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360),
      ) /
        Math.PI) /
    2;
  const countryPosition = (longitude: number, latitude: number) => ({
    x: (mapBox?.width ?? 0) / 2 + ((longitude - 8) / 360) * worldSize,
    y:
      (mapBox?.height ?? 0) / 2 +
      (mercatorY(latitude) - mercatorY(18)) * worldSize,
  });
  const tooltip = page.getByTestId("map-tooltip");

  // Use a point inside mainland France in the shipped GeoJSON. (10, 51)
  // is Germany; its former FRA hit depended on the old viewport projection.
  await mapContainer.hover({ position: countryPosition(2.5, 46.5) });
  await expect(tooltip).toHaveAttribute("data-country-iso3", "FRA");
  await expect(tooltip).toContainText("法国");
  await expect(tooltip).toContainText("核验：");
  await expect(tooltip).not.toContainText("核验:");

  await mapContainer.hover({ position: countryPosition(105, 35) });
  await expect(tooltip).toHaveAttribute("data-country-iso3", "CHN");
  await expect(tooltip).toContainText("中国（演示数据）");
  await expect(tooltip).not.toContainText("法国");

  await mapContainer.hover({ position: countryPosition(-52, -10) });
  await expect(tooltip).toHaveAttribute("data-country-iso3", "BRA");
  await expect(tooltip).toContainText("巴西（演示数据）");
  await expect(tooltip).not.toContainText("中国（演示数据）");
});

test("localizes a map tooltip when the valid summary response omits that country", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Pointer-coordinate fallback coverage runs in the desktop project.",
  );
  await context.clearCookies();
  await page.route("**/api/countries", async (route) => {
    await route.fulfill({
      json: { countries: [], status: "ok" },
      status: 200,
    });
  });

  const hoverFrance = async () => {
    const mapContainer = page.getByTestId("map-canvas-container");
    await expect(mapContainer).toHaveAttribute("data-map-ready", "true");
    const mapBox = await mapContainer.boundingBox();
    expect(mapBox).not.toBeNull();
    const zoom = 1.15;
    const worldSize = 512 * 2 ** zoom;
    const mercatorY = (latitude: number) =>
      (1 -
        Math.log(
          Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360),
        ) /
          Math.PI) /
      2;
    await mapContainer.hover({
      position: {
        x: (mapBox?.width ?? 0) / 2 + ((2.5 - 8) / 360) * worldSize,
        y:
          (mapBox?.height ?? 0) / 2 +
          (mercatorY(46.5) - mercatorY(18)) * worldSize,
      },
    });
    return page.getByTestId("map-tooltip");
  };

  await page.goto("/map");
  await expect((await hoverFrance()).locator("p").first()).toHaveText("France");

  const localeResponse = await page.request.post("/api/preferences/locale", {
    data: { locale: "zh-CN" },
  });
  expect(localeResponse.ok()).toBe(true);
  await page.reload();
  const chineseTooltip = await hoverFrance();
  await expect(chineseTooltip.locator("p").first()).toHaveText("法国");
  await expect(chineseTooltip.locator("p").first()).not.toHaveText("France");
});

test("opens, restores, switches, and shows an explicit no-data country", async ({
  page,
}) => {
  await page.goto("/map");

  await page
    .getByRole("button", { name: /中国（演示数据） · CHN/ })
    .click();
  await expect(page).toHaveURL(/\/countries\/CHN$/);
  await expect(page.getByTestId("country-detail")).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "中国（演示数据）" }),
  ).toBeVisible();
  await expect(
    page.getByText("国家基础记录或其来源为虚构 Demo"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "适用司法辖区" }),
  ).toBeVisible();
  const jurisdictionSection = page.locator(
    'section[aria-labelledby="country-jurisdictions"]',
  );
  await expect(jurisdictionSection.getByText(/成员关系来源：/).first())
    .toBeVisible();
  await expect(
    jurisdictionSection
      .getByText(/Fictional emissions bulletin（虚构证据，无外部链接）/)
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Fictional emissions bulletin/ }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(/\/countries\/CHN$/);
  await expect(
    page.getByRole("heading", { exact: true, name: "中国（演示数据）" }),
  ).toBeVisible();

  await page
    .getByLabel("切换国家")
    .selectOption({ value: "BRA" });
  await expect(page).toHaveURL(/\/countries\/BRA$/);
  await expect(
    page.getByRole("heading", { exact: true, name: "巴西（演示数据）" }),
  ).toBeVisible();

  await page
    .getByLabel("切换国家")
    .selectOption({ value: "USA" });
  await expect(page).toHaveURL(/\/countries\/USA$/);
  await expect(page.getByTestId("country-no-data")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "美国（USA）暂无数据" }),
  ).toBeVisible();
});

test("preserves the complete decision context when switching countries", async ({
  page,
}) => {
  const query =
    "applicationScope=marine&asOf=2024-02-03&powerKw=321.5&productModelCode=DEMO-ENG-100&utm_source=country-switch";
  await page.goto(`/countries/CHN?${query}`);

  await expect(page.getByLabel("应用场景")).toHaveValue("marine");
  await expect(page.getByLabel("功率（kW）")).toHaveValue("321.5");
  await expect(page.getByLabel("评估日期")).toHaveValue("2024-02-03");
  await expect(page.getByTestId("product-fit-result")).toBeVisible();

  await page
    .getByLabel("切换国家")
    .selectOption({ value: "BRA" });

  await expect(page).toHaveURL(`/countries/BRA?${query}`);
  await expect(page.getByLabel("应用场景")).toHaveValue("marine");
  await expect(page.getByLabel("功率（kW）")).toHaveValue("321.5");
  await expect(page.getByLabel("评估日期")).toHaveValue("2024-02-03");
});

test("localizes the no-data country name in server-rendered HTML", async ({
  request,
}) => {
  const englishResponse = await request.get("/countries/USA", {
    headers: { cookie: "diesel_locale=en" },
  });
  expect(englishResponse.ok()).toBe(true);
  const englishHtml = (await englishResponse.text()).replaceAll(
    "<!-- -->",
    "",
  );
  expect(englishHtml).toContain("country-server-fallback");
  expect(englishHtml).toContain(
    "United States of America (USA) has no data",
  );

  const chineseResponse = await request.get("/countries/USA", {
    headers: { cookie: "diesel_locale=zh-CN" },
  });
  expect(chineseResponse.ok()).toBe(true);
  const chineseHtml = (await chineseResponse.text()).replaceAll(
    "<!-- -->",
    "",
  );
  expect(chineseHtml).toContain("country-server-fallback");
  expect(chineseHtml).toContain("美国（USA）暂无数据");
});

test("supports keyboard-focused country selection", async ({ page }) => {
  await page.goto("/map");

  const countrySelect = page.getByLabel("选择国家");
  await expect(countrySelect).toBeEnabled();
  await countrySelect.focus();
  await expect(countrySelect).toBeFocused();
  await countrySelect.selectOption({ value: "DEU" });

  await expect(page).toHaveURL(/\/countries\/DEU$/);
  await expect(
    page.getByRole("heading", { name: "德国（演示数据）" }),
  ).toBeVisible();
});

test("keeps AI access in the dedicated chat workspace", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.locator('button[aria-label="打开 AI 营销分析助手"]'),
  ).toHaveCount(0);
  await page.getByRole("link", { exact: true, name: "对话" }).click();
  await expect(page).toHaveURL(/\/chat$/);

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  await expect(assistant).toBeVisible();
  await expect(
    page.getByText(
      "通过服务端配置的模型，围绕法规、市场、产品适配与机会评分展开可追溯分析。",
    ),
  ).toBeVisible();
  await expect(page.getByText("连接你自己的兼容接口")).toHaveCount(0);
  await expect(assistant.getByText(/地图国家：未选择/)).toBeVisible();
  await expect(
    assistant.getByRole("heading", { name: "连接你的 AI 接口" }),
  ).toHaveCount(0);
  await expect(assistant.getByText("服务端 AI 已配置")).toBeVisible();
  await expect(
    assistant.getByText("信息参考，不替代正式认证或法律意见"),
  ).toHaveCount(0);
  const chatInput = assistant.getByPlaceholder(
    "输入问题，可附上文件或图片…",
  );
  await expect(chatInput).toBeEditable();
  await expect(chatInput).not.toBeFocused();
  await expect(
    assistant.getByRole("button", { name: "发送问题" }),
  ).toBeDisabled();
  await expect(
    assistant.getByRole("region", { name: "AI 对话记录" }),
  ).toBeVisible();
});

test("carries explicit country filters into the chat workspace", async ({
  page,
}) => {
  await page.goto("/countries/CHN");
  await expect(page.getByTestId("country-detail")).toBeVisible();

  const unfilteredChatLink = page.getByRole("link", {
    name: "在对话中分析",
  });
  const unfilteredHref = await unfilteredChatLink.getAttribute("href");
  expect(unfilteredHref).toMatch(
    /^\/chat\?asOf=\d{4}-\d{2}-\d{2}&countryIso3=CHN$/,
  );
  expect(unfilteredHref).not.toContain("applicationScope");
  expect(unfilteredHref).not.toContain("powerKw");
  expect(unfilteredHref).not.toContain("productModelCode");

  let releaseEvaluation = () => {};
  const evaluationRelease = new Promise<void>((resolve) => {
    releaseEvaluation = resolve;
  });
  let evaluationStarted = () => {};
  const evaluationStart = new Promise<void>((resolve) => {
    evaluationStarted = resolve;
  });
  let evaluationSettled = () => {};
  const evaluationCompletion = new Promise<void>((resolve) => {
    evaluationSettled = resolve;
  });

  await page.route("**/api/product-fit", async (route) => {
    try {
      const response = await route.fetch();
      evaluationStarted();
      await evaluationRelease;
      await route.fulfill({ response });
    } catch {
      // Entering chat intentionally aborts this stale country-page request.
    } finally {
      evaluationSettled();
    }
  });

  await page.goto(
    "/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=100&productModelCode=DEMO-ENG-100",
  );
  const applicabilitySummary = page.getByTestId(
    "country-applicability-summary",
  );
  await expect(applicabilitySummary).toContainText(
    "非道路 · 100 kW · 截止 2026年1月20日",
  );
  await expect(applicabilitySummary).toContainText("NOX：3.5 g/kWh");
  await expect(applicabilitySummary).toContainText("功率带 [0, 560) kW");
  const filteredChatLink = page.getByRole("link", {
    name: "在对话中分析",
  });
  await expect(filteredChatLink).toHaveAttribute(
    "href",
    "/chat?asOf=2026-01-20&countryIso3=CHN&applicationScope=non-road&powerKw=100&productModelCode=DEMO-ENG-100",
  );
  await evaluationStart;
  await filteredChatLink.click();

  await expect(page).toHaveURL(
    /\/chat\?asOf=2026-01-20&countryIso3=CHN&applicationScope=non-road&powerKw=100&productModelCode=DEMO-ENG-100$/,
  );
  releaseEvaluation();
  await evaluationCompletion;
  await expect(page).toHaveURL(
    /\/chat\?asOf=2026-01-20&countryIso3=CHN&applicationScope=non-road&powerKw=100&productModelCode=DEMO-ENG-100$/,
  );
  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  await expect(assistant.getByText(/地图国家：CHN/)).toBeVisible();
  await expect(assistant.getByLabel("输入问题")).toHaveValue(
    "请分析 CHN 的非道路 100 kW 法规与产品适配，重点判断产品 DEMO-ENG-100，判断日期 2026年1月20日，并明确说明证据缺口以及结果能否用于销售承诺。",
  );
});

test("uses a newly committed fit query in chat before the URL refresh completes", async ({
  page,
}) => {
  await page.goto("/countries/CHN");
  await expect(page.getByTestId("country-detail")).toBeVisible();

  await page
    .getByRole("radio", { name: /^DEMO-ENG-200/ })
    .check();
  await page.getByLabel("应用场景").selectOption("agriculture");
  await page.getByLabel("功率（kW）").fill("150");
  await page.getByLabel("评估日期").fill("2026-01-20");
  await page.getByRole("button", { name: "运行确定性匹配" }).click();
  await expect(page.getByTestId("product-fit-result")).toBeVisible();

  const chatLink = page.getByRole("link", { name: "在对话中分析" });
  await expect(chatLink).toHaveAttribute(
    "href",
    "/chat?asOf=2026-01-20&countryIso3=CHN&applicationScope=agriculture&powerKw=150&productModelCode=DEMO-ENG-200",
  );
  await chatLink.click();

  await expect(page).toHaveURL(
    /\/chat\?asOf=2026-01-20&countryIso3=CHN&applicationScope=agriculture&powerKw=150&productModelCode=DEMO-ENG-200$/,
  );
  await expect(page.getByLabel("输入问题")).toHaveValue(
    "请分析 CHN 的农业 150 kW 法规与产品适配，重点判断产品 DEMO-ENG-200，判断日期 2026年1月20日，并明确说明证据缺口以及结果能否用于销售承诺。",
  );
});

test("surfaces a sanitized chat service error after server AI configuration", async ({
  page,
}) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "AI_NOT_CONFIGURED",
          message: "AI 助手暂未启用，请稍后重试。",
        },
      }),
      contentType: "application/json",
      status: 503,
    });
  });

  await page.goto("/chat");
  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  await expect(assistant).toBeVisible();
  await assistant
    .getByPlaceholder("输入问题，可附上文件或图片…")
    .fill("测试：AI 未配置时的错误展示");
  await assistant.getByRole("button", { name: "发送问题" }).click();

  const alert = assistant.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("AI 助手暂未启用，请稍后重试。");
  // 错误信封原文（JSON、错误码、环境变量名）不得暴露给用户。
  await expect(alert).not.toContainText("RATE_LIMITED");
  await expect(alert).not.toContainText("AI_MODEL");
  await expect(alert).not.toContainText("{");
});

test("country APIs return structured database-backed states", async ({
  request,
}) => {
  const availableResponse = await request.get("/api/countries/CHN");
  expect(availableResponse.ok()).toBe(true);
  const availableBody = await availableResponse.json();
  expect(availableBody).toMatchObject({
    asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    country: {
      currentEffectiveRegulations: [
        expect.objectContaining({ status: "effective" }),
      ],
      futureAdoptedRegulations: [
        expect.objectContaining({ status: "adopted" }),
      ],
      isDemo: true,
      iso3: "CHN",
      marketMetrics: [expect.objectContaining({ isDemo: true })],
    },
    status: "available",
  });
  expect(availableBody.country).not.toHaveProperty("regulations");

  const noDataResponse = await request.get("/api/countries/USA");
  expect(noDataResponse.ok()).toBe(true);
  await expect(noDataResponse.json()).resolves.toEqual({
    iso3: "USA",
    status: "no_data",
  });

  const unknownResponse = await request.get("/api/countries/ZZZ");
  expect(unknownResponse.status()).toBe(404);
  await expect(unknownResponse.json()).resolves.toEqual({
    error: {
      code: "COUNTRY_NOT_FOUND",
      message: "No country-directory record was found for that ISO3 code.",
    },
  });

  const badAsOfResponse = await request.get(
    "/api/countries/CHN?asOf=not-a-date",
  );
  expect(badAsOfResponse.status()).toBe(400);
  await expect(badAsOfResponse.json()).resolves.toEqual({
    error: {
      code: "INVALID_AS_OF",
      message: "The as-of date must be an ISO date in YYYY-MM-DD format.",
    },
  });

  const strictProductFitResponse = await request.post("/api/product-fit", {
    data: {
      applicationScope: "non-road",
      asOf: "2026-01-20",
      countryIso3: "CHN",
      powerKw: 100,
      productModelCode: "DEMO-ENG-100",
      unexpected: "must be rejected",
    },
  });
  expect(strictProductFitResponse.status()).toBe(400);
  await expect(strictProductFitResponse.json()).resolves.toEqual({
    error: {
      code: "INVALID_INPUT",
      message:
        "The product-fit input is invalid. Check the country, application, power, date, and model.",
    },
  });

  const blankPowerResponse = await request.post("/api/product-fit", {
    data: {
      applicationScope: "non-road",
      asOf: "2026-01-20",
      countryIso3: "CHN",
      powerKw: "",
      productModelCode: "DEMO-ENG-100",
    },
  });
  expect(blankPowerResponse.status()).toBe(400);
});

test("keeps a catalog country without geometry selectable and rejects unknown pages", async ({
  page,
}) => {
  await page.goto("/map");

  const countrySelect = page.getByLabel("选择国家");
  await expect(countrySelect.locator('option[value="MUS"]')).toHaveText(
    /毛里求斯 · MUS · 暂无地图边界/,
  );
  await countrySelect.selectOption("MUS");
  await expect(page).toHaveURL(/\/countries\/MUS$/);
  await expect(page.getByText(/该目录国家暂缺地图边界/)).toBeVisible();

  await page.goto("/countries/ZZZ");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByTestId("country-no-data")).toHaveCount(0);
});

test("shows an explicit homepage empty state when no reviewed country is public", async ({
  page,
}) => {
  await page.route("**/api/countries", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ countries: [], status: "ok" }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/");
  await expect(page.getByText("暂无已核验国家入口")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "打开国家目录" }),
  ).toHaveAttribute("href", "/map");
});

test("shared filter URLs reproduce the product-fit evaluation", async ({
  page,
}) => {
  const duplicateKeyWarnings: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("Encountered two children with the same key")) {
      duplicateKeyWarnings.push(text);
    }
  });
  // 非规范化的分享链接（小写 iso3/型号、100.0、未知分析参数）一次
  // 重定向即规范化，未知参数保留，评估自动复现。
  await page.goto(
    "/countries/chn?applicationScope=non-road&powerKw=100.0&asOf=2026-01-20&productModelCode=demo-eng-100&utm_source=e2e",
  );

  await expect(page).toHaveURL(
    /\/countries\/CHN\?applicationScope=non-road&asOf=2026-01-20&powerKw=100&productModelCode=DEMO-ENG-100&utm_source=e2e$/,
  );
  await expect(page.getByTestId("product-fit-status-fit")).toBeVisible();
  await expect(
    page.getByTestId("country-applicability-summary"),
  ).toBeVisible();
  await expect(page.getByText("DEMO-CERT-CHN-100")).toBeVisible();
  await expect(page).toHaveURL(/utm_source=e2e$/);

  // 刷新后仍可复现。
  await page.reload();
  await expect(page.getByTestId("product-fit-status-fit")).toBeVisible();
  await expect(page).toHaveURL(/utm_source=e2e$/);
  expect(duplicateKeyWarnings).toEqual([]);
});

test("refreshes country regulation details when the evaluation date changes", async ({
  page,
}) => {
  await page.goto("/countries/CHN");
  await expect(page.getByTestId("country-detail")).toBeVisible();

  await page.getByLabel("评估日期").fill("2024-01-01");
  await page.getByRole("button", { name: "运行确定性匹配" }).click();

  await expect(page).toHaveURL(/asOf=2024-01-01/);
  await expect(page.getByText("详情截止日期：2024年1月1日")).toBeVisible();
});

test("keeps every product-fit control interactive inside the country drawer", async ({
  page,
}) => {
  await page.goto("/countries/CHN");
  await expect(page.getByTestId("country-detail")).toBeVisible();

  const productModel = page.getByRole("radio", {
    name: /^DEMO-ENG-200/,
  });
  const applicationScope = page.getByLabel("应用场景");
  const powerKw = page.getByLabel("功率（kW）");
  const evaluationDate = page.getByLabel("评估日期");

  await productModel.click();
  await expect(productModel).toBeFocused();
  await expect(productModel).toBeChecked();
  await applicationScope.click();
  await expect(applicationScope).toBeFocused();
  await applicationScope.selectOption("agriculture");
  await powerKw.click();
  await expect(powerKw).toBeFocused();
  await powerKw.fill("150");
  await evaluationDate.click();
  await expect(evaluationDate).toBeFocused();
  await evaluationDate.fill("2026-01-20");

  await expect(applicationScope).toHaveValue("agriculture");
  await expect(powerKw).toHaveValue("150");
  await expect(evaluationDate).toHaveValue("2026-01-20");
  await expect(page.getByRole("button", { name: "运行确定性匹配" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "关闭国家详情" })).toBeEnabled();
});

test("moves focus into the country drawer and restores it after close", async ({
  page,
}) => {
  await page.goto("/map");
  const countrySelect = page.getByLabel("选择国家");
  await countrySelect.focus();
  await countrySelect.selectOption("CHN");

  const closeButton = page.getByRole("button", { name: "关闭国家详情" });
  await expect(closeButton).toBeFocused();
  await closeButton.click();

  await expect(page).toHaveURL(/\/map$/);
  await expect(countrySelect).toBeFocused();

  const chinaShortcut = page.getByRole("button", {
    name: /中国（演示数据） · CHN/,
  });
  await chinaShortcut.focus();
  await page.keyboard.press("Enter");
  await expect(closeButton).toBeFocused();

  const drawerCountrySelect = page.getByLabel("切换国家");
  await drawerCountrySelect.focus();
  await drawerCountrySelect.selectOption("BRA");
  await expect(page).toHaveURL(/\/countries\/BRA$/);
  await expect(drawerCountrySelect).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/map$/);
  await expect(chinaShortcut).toBeFocused();
});

for (const storageFailure of [
  { label: "access is blocked", mode: "getter" },
  { label: "writes are blocked", mode: "setItem" },
] as const) {
  test(`restores country focus when session storage ${storageFailure.label}`, async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error);
    });

    await page.goto("/map");
    const mapContainer = page.getByTestId("map-canvas-container");
    const chinaShortcut = page.getByRole("button", {
      name: /中国（演示数据） · CHN/,
    });
    await expect(mapContainer).toHaveAttribute("data-map-ready", "true");
    await expect(chinaShortcut).toBeEnabled();

    await page.evaluate((mode) => {
      if (mode === "getter") {
        Object.defineProperty(window, "sessionStorage", {
          configurable: true,
          get() {
            throw new DOMException(
              "Storage disabled by privacy policy.",
              "SecurityError",
            );
          },
        });
        return;
      }

      Storage.prototype.setItem = () => {
        throw new DOMException(
          "Storage writes disabled by privacy policy.",
          "SecurityError",
        );
      };
    }, storageFailure.mode);

    await chinaShortcut.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/countries\/CHN$/);

    const drawerCountrySelect = page.getByLabel("切换国家");
    await drawerCountrySelect.focus();
    await drawerCountrySelect.selectOption("BRA");
    await expect(page).toHaveURL(/\/countries\/BRA$/);
    await expect(drawerCountrySelect).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/map$/);
    await expect(chinaShortcut).toBeFocused();
    expect(
      pageErrors
        .filter(
          (error) =>
            error.name === "SecurityError" ||
            error.message.includes("SecurityError") ||
            error.message.includes("Storage disabled by privacy policy") ||
            error.message.includes("Storage writes disabled by privacy policy"),
        )
        .map((error) => `${error.name}: ${error.message}`),
    ).toEqual([]);
  });
}

test("does not restore a previous country after a pending fit evaluation", async ({
  page,
}) => {
  let releaseResponse = () => {};
  const responseRelease = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let evaluationReady = () => {};
  const evaluationResponseReady = new Promise<void>((resolve) => {
    evaluationReady = resolve;
  });
  let routeSettled = () => {};
  const routeCompletion = new Promise<void>((resolve) => {
    routeSettled = resolve;
  });

  await page.route("**/api/product-fit", async (route) => {
    try {
      const response = await route.fetch();
      evaluationReady();
      await responseRelease;
      await route.fulfill({ response });
    } catch {
      // Switching countries aborts the intercepted browser request.
    } finally {
      routeSettled();
    }
  });

  await page.goto("/countries/CHN");
  await expect(page.getByTestId("country-detail")).toBeVisible();
  await page.getByRole("button", { name: "运行确定性匹配" }).click();
  await evaluationResponseReady;

  await page.getByLabel("切换国家").selectOption({ value: "BRA" });
  await expect(page).toHaveURL(/\/countries\/BRA$/);
  await expect(
    page.getByRole("heading", { exact: true, name: "巴西（演示数据）" }),
  ).toBeVisible();

  releaseResponse();
  await routeCompletion;
  await expect(page).toHaveURL(/\/countries\/BRA$/);
  await expect(
    page.getByRole("heading", { exact: true, name: "巴西（演示数据）" }),
  ).toBeVisible();
});

test("canonicalizes and strips invalid filter params", async ({ page }, testInfo) => {
  await checkBrowserRuntimeErrors(page, testInfo, async () => {
    await page.goto("/countries/CHN?powerKw=abc&applicationScope=non-road");

    // 无效 powerKw 被剔除，有效参数保留。
    await expect(page).toHaveURL(/\/countries\/CHN\?applicationScope=non-road$/);

    await page.goto("/countries/CHN?powerKw=300.0");
    // 规范化数值并重定向。
    await expect(page).toHaveURL(/\/countries\/CHN\?powerKw=300$/);

    await page.goto(
      "/countries/CHN?powerKw=100&powerKw=200&utm_term=engine&utm_term=export",
    );
    await expect(page).toHaveURL(
      /\/countries\/CHN\?powerKw=100&utm_term=engine&utm_term=export$/,
    );
    await expect(page.getByTestId("country-detail")).toBeVisible();
  });
});

test("shows a stale verification badge under a small threshold", async ({
  page,
}) => {
  await page.goto("/countries/CHN");

  await expect(page.getByTestId("country-detail")).toBeVisible();
  await expect(page.getByTestId("country-stale-badge")).toBeVisible();
});

test("lets touch users choose and re-evaluate product models without a native popup", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chromium",
    "This regression covers the touch interaction that the old native select did not expose.",
  );

  await page.goto("/countries/CHN");
  await expect(page.getByTestId("country-detail")).toBeVisible();

  const form = page.getByTestId("product-fit-form");
  const product200 = page.getByRole("radio", { name: /^DEMO-ENG-200/ });
  const product200Card = page.getByTestId(
    "product-model-option-DEMO-ENG-200",
  );
  await expect(product200).toBeVisible();
  await expect(product200).toBeEnabled();

  const formBox = await form.boundingBox();
  const productCardBox = await product200Card.boundingBox();
  expect(formBox).not.toBeNull();
  expect(productCardBox).not.toBeNull();
  expect(productCardBox?.x ?? 0).toBeGreaterThanOrEqual((formBox?.x ?? 0) - 1);
  expect(
    (productCardBox?.x ?? 0) + (productCardBox?.width ?? 0),
  ).toBeLessThanOrEqual(
    (formBox?.x ?? 0) + (formBox?.width ?? 0) + 1,
  );

  await product200.tap();
  await expect(product200).toBeChecked();
  await expect(
    page.getByText("仅限 Demo — 虚构发动机 200", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("DEMO ONLY — Fictional Engine 200", { exact: true }),
  ).toHaveCount(0);

  const applicationScope = page.getByLabel("应用场景");
  const powerKw = page.getByLabel("功率（kW）");
  await applicationScope.selectOption("construction");
  await page.getByRole("button", { name: "功率 150 kW" }).tap();
  await expect(powerKw).toHaveValue("150");

  await powerKw.tap();
  await page.keyboard.type("100");
  await expect(powerKw).toHaveValue("100");
  await applicationScope.selectOption("non-road");
  await page.getByRole("button", { name: "运行确定性匹配" }).click();
  await expect(page.getByTestId("product-fit-status-unknown")).toBeVisible();

  const product100 = page.getByRole("radio", { name: /^DEMO-ENG-100/ });
  await product100.tap();
  await expect(product100).toBeChecked();
  await expect(page.getByTestId("product-fit-result")).toBeHidden();
  await page.getByRole("button", { name: "运行确定性匹配" }).click();
  await expect(page.getByTestId("product-fit-status-fit")).toBeVisible();
});

test("explains deterministic fit, unknown, and upper-bound mismatch", async ({
  page,
}) => {
  await page.goto("/countries/CHN");
  await expect(page.getByTestId("country-detail")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "当前有效法规" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "未来已通过法规" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "市场指标" })).toBeVisible();
  await expect(
    page
      .getByText("仅限 Demo — 中国（演示数据）的虚构排放主管机构", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/指标发布：2026年1月4日/).first()).toBeVisible();
  const countryRegulationCard = page
    .getByTestId("country-regulation-card")
    .first();
  await expect(countryRegulationCard.getByText(/适用辖区：/)).toBeHidden();
  await countryRegulationCard.getByText("完整追溯信息").click();
  await expect(countryRegulationCard.getByText(/适用辖区：/)).toBeVisible();
  await expect(countryRegulationCard.getByText(/辖区来源：/)).toBeVisible();
  await expect(
    countryRegulationCard.getByText(/成员关系来源：/),
  ).toBeVisible();

  await page.getByRole("button", { name: "运行确定性匹配" }).click();
  await expect(page.getByTestId("product-fit-status-fit")).toHaveAttribute(
    "role",
    "status",
  );
  await expect(page.getByTestId("product-fit-status-fit")).toContainText(
    "法规/认证适配：演示匹配",
  );
  await expect(
    page.getByText("包含虚构 Demo 证据；不可用于报价、认证声明或销售承诺。"),
  ).toBeVisible();
  await expect(page.getByText("DEMO-CERT-CHN-100")).toBeVisible();
  await expect(page.getByText("产品记录追溯")).toBeVisible();
  const productTrace = page.getByTestId("product-record-trace");
  await expect(productTrace.getByText("产品供应期")).toBeVisible();
  await expect(
    productTrace.getByText("2025年1月1日 → 2030年1月1日"),
  ).toBeVisible();
  await expect(page.getByText(/法规记录 ID/).first()).toBeVisible();
  await expect(page.getByText("适用性证据").first()).toBeVisible();
  await expect(page.getByText(/辖区来源：/).first()).toBeVisible();
  await expect(page.getByText(/成员关系来源：/).first()).toBeVisible();
  await expect(page.getByText(/适用限值来源：/).first()).toBeVisible();
  await expect(
    page
      .getByTestId("product-fit-result")
      .getByText(/Fictional emissions bulletin（虚构证据，无外部链接）/)
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("product-fit-result")
      .getByRole("link", { name: /Fictional emissions bulletin/ }),
  ).toHaveCount(0);

  const product200 = page.getByRole("radio", { name: /^DEMO-ENG-200/ });
  await product200.check();
  await expect(product200).toBeChecked();
  await expect(page.getByTestId("product-fit-result")).toBeHidden();
  await page.getByRole("button", { name: "运行确定性匹配" }).click();
  await expect(page.getByTestId("product-fit-status-unknown")).toBeVisible();
  await expect(
    page.getByText(/没有可追溯认证记录将该产品与适用法规关联/).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "复制补数摘要" }),
  ).toBeVisible();
  await expect(
    page.getByText("仅复制到本机剪贴板，不会创建、发送或提交工单。"),
  ).toBeVisible();

  await page.getByRole("radio", { name: /^DEMO-ENG-100/ }).check();
  await page.getByLabel("功率（kW）").fill("150");
  await expect(page.getByTestId("product-fit-result")).toBeHidden();
  await page.getByRole("button", { name: "运行确定性匹配" }).click();
  const notFitResult = page.getByTestId("product-fit-status-not_fit");
  await expect(notFitResult).toBeVisible();
  await expect(
    notFitResult.getByText("产品功率范围不覆盖请求的功率。"),
  ).toBeVisible();
  await expect(page.getByTestId("product-record-trace")).toContainText(
    "[50, 150) kW",
  );
  await expect(page.getByLabel("功率（kW）")).toHaveValue("150");
});
