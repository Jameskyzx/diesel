import { expect, test } from "@playwright/test";

test("renders the operational home entry and primary navigation", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "把全球法规，变成可复核的业务动作。",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "直接开始",
    }),
  ).toBeVisible();
  await expect(page.getByText("GLOBAL DIESEL INTELLIGENCE")).toBeVisible();
  await expect(page.getByText("EVIDENCE CONTRACT")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "首页" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { exact: true, name: "对话" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "地图" })).toBeVisible();
  await expect(
    page.locator('button[aria-label="打开 AI 营销分析助手"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("portfolio-disclaimer")).toHaveCount(0);
  await expect(page.getByTestId("usage-boundary")).toContainText(
    "不替代正式认证、法律意见或销售承诺",
  );
  await page.getByRole("link", { exact: true, name: "地图" }).click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId("world-map")).toBeVisible();
});

test("opens the dedicated chat workspace from primary navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { exact: true, name: "对话" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: "和数据一起讨论下一步" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "AI 营销分析助手" })).toBeVisible();
  await expect(page.getByText("连接你的 AI 接口")).toHaveCount(0);
  await expect(page.getByText("服务端 AI 已配置")).toBeVisible();
  await expect(page.getByPlaceholder("输入问题，可附上文件或图片…")).toBeEditable();
  await expect(page.getByRole("button", { name: "添加文件或图片" })).toBeEnabled();
});

test("answers a capability question without forcing a fact tool", async ({ page }) => {
  await page.goto("/chat");

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  await assistant
    .getByPlaceholder("输入问题，可附上文件或图片…")
    .fill("你好，你能帮我做什么？");
  await assistant.getByRole("button", { name: "发送问题" }).click();

  const conversation = assistant.getByRole("log", { name: "AI 对话记录" });
  await expect(conversation).toContainText("结构化事实和可追溯来源");
  await expect(conversation).toContainText("比较 2–5 个国家");
  await expect(conversation).not.toContainText("没有足够证据");
  await expect(conversation).not.toContainText("正在执行确定性查询");
  await expect(conversation).not.toContainText("国家与法规资料");
});

test("portfolio demo keeps an explicitly named product scoped to one result", async ({
  page,
}) => {
  test.skip(
    process.env.PORTFOLIO_DEMO_MODE !== "true",
    "This deterministic routing assertion only applies to portfolio Demo mode.",
  );

  await page.goto(
    "/chat?countryIso3=CHN&applicationScope=non-road&powerKw=100&asOf=2026-08-12&productModelCode=DEMO-ENG-200",
  );

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  await assistant.getByRole("button", { name: "发送问题" }).click();

  const conversation = assistant.getByRole("log", { name: "AI 对话记录" });
  await expect(conversation).toContainText("DEMO ONLY — Fictional Engine 200");
  await expect(conversation).not.toContainText("Fictional Engine 100");
  await expect(conversation).toContainText("不可用于报价、认证声明或销售承诺");
});

test("previews, removes, and validates chat attachments", async ({ page }) => {
  await page.goto("/chat");

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  const fileInput = assistant.getByLabel("选择文件或图片");
  await fileInput.setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "engine-plate.png",
  });

  await expect(assistant.getByText("engine-plate.png")).toBeVisible();
  await expect(
    assistant.getByRole("img", { name: "engine-plate.png 预览" }),
  ).toBeVisible();
  await assistant
    .getByRole("button", { name: "移除附件 engine-plate.png" })
    .click();
  await expect(assistant.getByText("engine-plate.png")).toHaveCount(0);

  await fileInput.setInputFiles({
    buffer: Buffer.from("not supported"),
    mimeType: "application/octet-stream",
    name: "unsafe.exe",
  });
  await expect(assistant.getByRole("alert")).toContainText("格式不受支持");

  await fileInput.setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "too-small.png",
  });
  await expect(assistant.getByRole("alert")).toContainText(
    "图片宽高均须为 11–8,192 像素",
  );
});

test("releases failed-send image data before the next chat request", async ({
  page,
}) => {
  const chatRequestBodies: string[] = [];
  await page.route("**/api/chat", async (route) => {
    chatRequestBodies.push(route.request().postData() ?? "");
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "AI_UPSTREAM_UNAVAILABLE",
          message: "AI 服务暂时不可用，请稍后重试。",
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
  const prompt = assistant.getByPlaceholder("输入问题，可附上文件或图片…");
  await assistant.getByLabel("选择文件或图片").setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "failed-engine-plate.png",
  });
  await prompt.fill("描述这张铭牌图片");
  await assistant.getByRole("button", { name: "发送问题" }).click();

  await expect.poll(() => chatRequestBodies.length).toBe(1);
  await expect(assistant.getByRole("alert")).toContainText(
    "AI 服务暂时不可用，请稍后重试。",
  );
  await expect(
    assistant.getByText(
      "[已发送附件：failed-engine-plate.png；后续追问请重新上传]",
    ),
  ).toBeVisible();
  await expect(
    assistant.getByRole("img", { name: "failed-engine-plate.png" }),
  ).toHaveCount(0);

  await prompt.fill("第二轮：请继续说明需要哪些信息");
  await assistant.getByRole("button", { name: "发送问题" }).click();
  await expect.poll(() => chatRequestBodies.length).toBe(2);

  const secondRequestBody = JSON.parse(chatRequestBodies[1] ?? "null") as {
    messages?: Array<{
      parts?: Array<{ text?: string; type?: string; url?: string }>;
      role?: string;
    }>;
  } | null;
  expect(secondRequestBody?.messages).toHaveLength(2);

  const historicalUserMessage = secondRequestBody?.messages?.[0];
  expect(historicalUserMessage?.role).toBe("user");
  expect(historicalUserMessage?.parts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        text: "[已发送附件：failed-engine-plate.png；后续追问请重新上传]",
        type: "text",
      }),
    ]),
  );
  expect(historicalUserMessage?.parts?.some((part) => part.type === "file")).toBe(
    false,
  );
  expect(JSON.stringify(historicalUserMessage)).not.toContain("data:image/");
  expect(JSON.stringify(historicalUserMessage)).not.toContain(";base64,");
});

test("locks attachment controls while validating image bytes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalArrayBuffer = File.prototype.arrayBuffer;
    Object.defineProperty(File.prototype, "arrayBuffer", {
      configurable: true,
      value: function arrayBuffer(this: File): Promise<ArrayBuffer> {
        if (this.name !== "slow-engine.png") {
          return originalArrayBuffer.call(this);
        }

        return new Promise<ArrayBuffer>((resolve, reject) => {
          const browserGlobal = globalThis as typeof globalThis & {
            __releaseAttachmentValidation?: () => void;
          };
          browserGlobal.__releaseAttachmentValidation = () => {
            delete browserGlobal.__releaseAttachmentValidation;
            void originalArrayBuffer.call(this).then(resolve, reject);
          };
        });
      },
    });
  });
  await page.goto("/chat");

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  const prompt = assistant.getByPlaceholder("输入问题，可附上文件或图片…");
  const fileInput = assistant.getByLabel("选择文件或图片");
  const sendButton = assistant.getByRole("button", { name: "发送问题" });
  await prompt.fill("描述图片内容");
  await fileInput.setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "slow-engine.png",
  });

  await expect(assistant.getByRole("status")).toContainText(
    "正在验证附件安全性",
  );
  await expect(fileInput).toBeDisabled();
  await expect(
    assistant.getByRole("button", { name: "正在验证附件" }),
  ).toBeDisabled();
  await expect(sendButton).toBeDisabled();

  await page.evaluate(() => {
    const browserGlobal = globalThis as typeof globalThis & {
      __releaseAttachmentValidation?: () => void;
    };
    browserGlobal.__releaseAttachmentValidation?.();
  });

  await expect(assistant.getByRole("status")).toHaveCount(0);
  await expect(assistant.getByText("slow-engine.png")).toBeVisible();
  await expect(sendButton).toBeEnabled();
});

test("returns a structured health response", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/json");

  const body: unknown = await response.json();
  expect(body).toEqual(
    expect.objectContaining({
      service: "global-diesel-regulations",
      status: "ok",
    }),
  );
});

test("serves browser and Apple touch icons without 404s", async ({ request }) => {
  for (const path of [
    "/icon.svg",
    "/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png",
  ]) {
    const response = await request.get(path);

    expect(response.ok(), `${path} should resolve`).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/");
    expect((await response.body()).byteLength).toBeGreaterThan(0);
  }
});
