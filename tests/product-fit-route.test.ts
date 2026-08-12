import { describe, expect, it } from "vitest";

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
        message: "产品适配请求过大，请缩小请求后重试。",
      },
    });
  });
});
