import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/preferences/locale/route";
import { MAX_LOCALE_PREFERENCE_REQUEST_BYTES } from "@/server/http/request-limits";

function localeRequest(body: string, locale?: "en" | "zh-CN"): Request {
  return new Request("http://localhost/api/preferences/locale", {
    body,
    headers: {
      ...(locale ? { cookie: `diesel_locale=${locale}` } : {}),
      "content-type": "application/json",
    },
    method: "POST",
  });
}

describe("POST /api/preferences/locale", () => {
  it("sets a one-year SameSite locale cookie readable by the global fallback", async () => {
    const response = await POST(
      localeRequest(JSON.stringify({ locale: "zh-CN" })),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      locale: "zh-CN",
      status: "ok",
    });
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("diesel_locale=zh-CN");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).not.toContain("HttpOnly");
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
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("localizes invalid-input errors from the existing locale cookie", async () => {
    const response = await POST(localeRequest("not-json", "zh-CN"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_LOCALE",
        message: "语言必须为 en 或 zh-CN。",
      },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("returns a structured 413 without setting a cookie", async () => {
    const response = await POST(
      new Request("http://localhost/api/preferences/locale", {
        body: "{}",
        headers: {
          "content-length": String(MAX_LOCALE_PREFERENCE_REQUEST_BYTES + 1),
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "The locale preference request is too large.",
      },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("localizes oversized-request errors from the existing locale cookie", async () => {
    const response = await POST(
      new Request("http://localhost/api/preferences/locale", {
        body: "{}",
        headers: {
          "content-length": String(MAX_LOCALE_PREFERENCE_REQUEST_BYTES + 1),
          "content-type": "application/json",
          cookie: "diesel_locale=zh-CN",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "语言偏好请求过大。",
      },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });
});
