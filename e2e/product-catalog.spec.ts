import { expect, test } from "@playwright/test";
import { getDictionary } from "../src/i18n/dictionaries";

for (const locale of ["en", "zh-CN"] as const) {
  test(`${locale} fictional catalogue search, selected model and conversation persistence`, async ({page,context,baseURL}) => {
    const zh = locale === "zh-CN";
    await context.addCookies([{name:"diesel_locale",value:locale,url:baseURL!}]);
    await page.goto("/products?query=DEMO-H13");
    await expect(page.getByTestId("catalog-record")).toHaveCount(2);
    await expect(page.getByText(zh ? "虚构 Demo 目录：型号、参数和排放声明均为演示而编造，不代表任何制造商。排放声明不是认证，也不是市场准入结论。" : "Fictional demo catalogue: models, ratings and emission declarations are invented and represent no manufacturer. A declaration is neither certification nor market-entry approval.")).toBeVisible();
    const first = page.getByTestId("catalog-record").first();
    await expect(first).toContainText("GB 17691-2018");
    await first.getByRole("link",{name:zh ? "用此型号开始分析" : "Analyze this model"}).click();
    const copy = getDictionary(locale).chat;
    await expect(page.getByRole("textbox",{name:copy.questionInput,exact:true})).toHaveValue(/00000000-0000-4000-8000-000000000801/u);
    const response = await page.request.get("/api/product-catalog?recordIds=00000000-0000-4000-8000-000000000801");
    const data = await response.json();
    await page.route("**/api/chat", async route => {
      expect(route.request().postDataJSON().conversation.version).toBe(2);
      await route.fulfill({headers:{"content-type":"text/event-stream","x-vercel-ai-ui-message-stream":"v1"},body:[
        {type:"start",messageId:"catalog-answer"},{type:"data-productCatalog",data},
        {type:"text-start",id:"answer"},{type:"text-delta",id:"answer",delta:"Which market should we assess?"},{type:"text-end",id:"answer"},
        {type:"finish",finishReason:"stop"},
      ].map(event=>`data: ${JSON.stringify(event)}\n\n`).join("")+"data: [DONE]\n\n"});
    });
    await page.getByRole("button",{name:copy.send,exact:true}).click();
    await expect(page.getByTestId("catalog-record")).toHaveCount(1);
    await expect(page.getByTestId("save-analysis")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("catalog-record")).toHaveCount(1);
    await expect(page.getByTestId("catalog-record")).toContainText("DEMO-H13-460");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto("/products?query=DOES-NOT-EXIST");
    await expect(page.getByText(zh ? "没有匹配记录。可尝试只输入型号前缀，或取消筛选。" : "No matching records. Try a model prefix or fewer filters.")).toBeVisible();
  });

  test(`${locale} target-market selection ranks declared matches from a shareable URL`, async ({page,context,baseURL}) => {
    const zh = locale === "zh-CN";
    await context.addCookies([{name:"diesel_locale",value:locale,url:baseURL!}]);
    await page.goto("/products?market=CHN&scope=non-road&power=82&asOf=2026-10-17");
    const results = page.getByTestId("catalog-fit-results");
    await expect(results).toBeVisible();
    await expect(results.getByTestId("catalog-fit-regulation")).toHaveCount(1);
    await expect(results.getByTestId("catalog-fit-regulation")).toContainText("DEMO-CHN-NR-A");
    const cards = results.getByTestId("catalog-fit-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("data-status","declared_match");
    await expect(cards.first()).toContainText("DEMO-N4-110");
    await expect(page.getByRole("combobox",{name:zh ? "目标国家" : "Target country"})).toHaveValue("CHN");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.goto("/products?market=CHN&scope=marine&power=184&asOf=2026-10-17");
    await expect(page.getByTestId("catalog-fit-results").getByRole("status")).toBeVisible();
    await expect(page.getByTestId("catalog-fit-card").first()).toHaveAttribute("data-status","unknown");

    await page.goto("/products?market=CHN&scope=non-road&power=-1");
    await expect(page.getByRole("alert").filter({hasText: zh ? "选型条件无效" : "Invalid selection"})).toBeVisible();
  });
}

test("exports a customer brief in the selected language and prints without site navigation", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "diesel_locale", value: "en", url: baseURL! }]);
  await page.goto("/products?market=CHN&scope=non-road&power=82&asOf=2026-10-17");
  const exportForm = page.getByRole("form", { name: "Export customer brief" });
  await exportForm.getByRole("combobox", { name: "Brief language" }).selectOption("es");
  await exportForm.getByRole("button", { name: "Export customer brief" }).click();
  await expect(page).toHaveURL(/\/products\/brief\?.*lang=es/u);

  const brief = page.getByTestId("customer-brief");
  await expect(brief).toHaveAttribute("lang", "es");
  await expect(brief.getByRole("heading", { level: 1 })).toContainText("Informe de cumplimiento de emisiones — China");
  await expect(brief.getByTestId("brief-regulation")).toContainText("DEMO-CHN-NR-A");
  await expect(brief.getByTestId("brief-candidate")).toHaveCount(1);
  await expect(brief.getByTestId("brief-candidate")).toContainText("DEMO-N4-110");
  await expect(brief.getByTestId("brief-notes")).toContainText("catálogo de demostración ficticio");
  await expect(page.getByTestId("print-brief")).toBeVisible();

  await page.getByRole("link", { name: "العربية" }).click();
  await expect(brief).toHaveAttribute("dir", "rtl");
  await expect(brief.getByRole("heading", { level: 1 })).toContainText("موجز الامتثال");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("app-navigation-shell")).toBeHidden();
  await expect(page.getByTestId("print-brief")).toBeHidden();
  await expect(brief).toBeVisible();
});

test("refuses a brief without valid selection conditions", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "diesel_locale", value: "zh-CN", url: baseURL! }]);
  await page.goto("/products/brief?market=CHN&lang=ru");
  await expect(page.getByRole("alert").filter({ hasText: "简报条件无效" })).toBeVisible();
  await expect(page.getByTestId("customer-brief")).toHaveCount(0);
});

for (const locale of ["en", "zh-CN"] as const) {
  test(`${locale} model page shows fictional feedback with trend, filters and export`, async ({page,context,baseURL}) => {
    const zh = locale === "zh-CN";
    await context.addCookies([{name:"diesel_locale",value:locale,url:baseURL!}]);
    await page.goto("/products?query=DEMO-H13-460E");
    await page.getByTestId("catalog-record").getByRole("link",{name:zh ? "参数与客户反馈" : "Specs and customer feedback"}).click();
    await expect(page).toHaveURL(/\/products\/DEMO-H13-460E$/u);
    await page.goto("/products/DEMO-H13-460");
    await expect(page.getByRole("heading",{name:"DEMO-H13-460",level:1})).toBeVisible();
    await expect(page.getByTestId("feedback-record")).toHaveCount(3);
    await expect(page.getByRole("img",{name:zh ? /每月反馈数/u : /Feedback per month/u})).toBeVisible();
    await expect(page.getByTestId("feedback-record").first()).toContainText(zh ? "虚构示例" : "Fictional example");
    await page.getByRole("combobox",{name:zh ? "类别" : "Category"}).selectOption("failure");
    await page.getByRole("button",{name:zh ? "筛选" : "Filter"}).click();
    await expect(page).toHaveURL(/category=failure/u);
    await expect(page.getByTestId("feedback-record")).toHaveCount(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const csv = await page.request.get("/api/product-feedback?modelCode=DEMO-H13-460&format=csv");
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const body = await csv.text();
    expect(body.startsWith("﻿modelCode,")).toBe(true);
    expect(body.trim().split("\r\n")).toHaveLength(4);

    await page.goto("/products/feedback");
    const row = page.getByRole("row").filter({hasText:"DEMO-H13-460"}).first();
    await expect(row).toContainText("3");
    await row.getByRole("link",{name:"DEMO-H13-460"}).click();
    await expect(page).toHaveURL(/\/products\/DEMO-H13-460$/u);
    // The root loading boundary streams pages, so an unknown model renders the 404 screen.
    await page.goto("/products/DEMO-NOT-A-MODEL");
    await expect(page.getByRole("heading",{name:"404",level:1})).toBeVisible();
  });
}
