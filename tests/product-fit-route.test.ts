import { describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/product-fit/route";
import { MAX_PRODUCT_FIT_REQUEST_BYTES } from "@/server/http/request-limits";

describe("POST /api/product-fit request limits", () => {
  it("returns a structured 413 before parsing an oversized body", async () => {
    const response = await POST(
      new Request("http://localhost/api/product-fit", {
        body: "{}",
        headers: {
          "content-length": String(MAX_PRODUCT_FIT_REQUEST_BYTES + 1),
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "The product-fit request is too large. Reduce it and try again.",
      },
    });
  });

  it("uses the Chinese locale cookie without changing the error contract", async () => {
    const response = await POST(
      new Request("http://localhost/api/product-fit", {
        body: "{}",
        headers: {
          "content-length": String(MAX_PRODUCT_FIT_REQUEST_BYTES + 1),
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
        message: "产品适配请求过大，请缩小请求后重试。",
      },
    });
  });

  it("returns a structured 408 and cancels the body when the client disconnects", async () => {
    const abortController = new AbortController();
    const cancel = vi.fn();
    const requestInit: RequestInit & { duplex: "half" } = {
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: "half",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: abortController.signal,
    };
    const responsePending = POST(
      new Request("http://localhost/api/product-fit", requestInit),
    );

    abortController.abort("client-disconnected");
    const response = await responsePending;

    expect(response.status).toBe(408);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "REQUEST_TIMEOUT",
        message:
          "The product-fit request upload timed out or was canceled. Please try again.",
      },
    });
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(cancel).toHaveBeenCalledWith("request-body-aborted");
  });
});
