import { expect, test } from "@playwright/test";
import { getDictionary } from "../src/i18n/dictionaries";

for (const locale of ["en", "zh-CN"] as const) {
  test(`${locale} catalogue filters, provenance, selected configuration and conversation persistence`, async ({page,context,baseURL}) => {
    const zh = locale === "zh-CN";
    await context.addCookies([{name:"diesel_locale",value:locale,url:baseURL!}]);
    await page.goto("/products?query=WP10H375E62");
    await expect(page.getByTestId("catalog-record")).toHaveCount(4);
    await expect(page.getByText(zh ? "授权展示的来源资料，尚未独立核验。排放等级是目录宣称，不是认证或市场准入结论。同一型号的不同配置不可合并。" : "Authorized source-reported data, not independently verified. Emission labels are catalogue claims, not certification or market-entry approval. Keep different configurations separate.")).toBeVisible();
    const first = page.getByTestId("catalog-record").first();
    await first.locator("summary").click();
    await expect(first).toContainText("型谱表明细");
    await expect(first).toContainText("SHA256");
    await first.getByRole("link",{name:zh ? "用此配置开始分析" : "Analyze this configuration"}).click();
    const copy = getDictionary(locale).chat;
    await expect(page.getByRole("textbox",{name:copy.questionInput,exact:true})).toHaveValue(/weichai-row-2/u);
    const response = await page.request.get("/api/product-catalog?recordIds=weichai-row-2");
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
    await expect(page.getByTestId("catalog-record")).toContainText("WP10H375E62");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto("/products?query=DOES-NOT-EXIST");
    await expect(page.getByText(zh ? "没有匹配记录。可尝试只输入型号前缀，或取消筛选；这不代表市场上不存在该产品。" : "No matching records. Try a model prefix or fewer filters; this does not establish that the product does not exist.")).toBeVisible();
  });
}
