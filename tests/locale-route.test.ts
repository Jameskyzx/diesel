import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/preferences/locale/route";

function localeRequest(body: string): Request {
  return new Request("http://localhost/api/preferences/locale", {
    body,
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/preferences/locale", () => {
  it("sets a one-year HttpOnly SameSite locale cookie", async () => {
    const response = await POST(
      localeRequest(JSON.stringify({ locale: "zh-CN" })),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      locale: "zh-CN",
      status: "ok",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("diesel_locale=zh-CN");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
  });

  it.each([
    JSON.stringify({ locale: "zh" }),
    JSON.stringify({ locale: "en", unexpected: true }),
    "not-json",
  ])("rejects malformed or unsupported input without setting a cookie", async (body) => {
    const response = await POST(localeRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_LOCALE",
        message: "Locale must be either en or zh-CN.",
      },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
