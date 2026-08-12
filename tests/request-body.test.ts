import { describe, expect, it } from "vitest";

import {
  readFormDataRequest,
  readJsonRequest,
  readUtf8File,
  RequestBodyTooLargeError,
} from "@/server/http/request-body";

describe("multipart request body limits", () => {
  it("parses a bounded multipart request", async () => {
    const body = new FormData();
    body.set("field", "value");
    body.set(
      "file",
      new File(["document"], "document.txt", { type: "text/plain" }),
    );

    const parsed = await readFormDataRequest(
      new Request("http://localhost/upload", {
        body,
        method: "POST",
      }),
      1024,
    );

    expect(parsed.get("field")).toBe("value");
    expect(parsed.get("file")).toBeInstanceOf(File);
  });

  it("uses actual streamed bytes when Content-Length is understated", async () => {
    const boundary = "request-body-test";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="field"',
      "",
      "x".repeat(128),
      `--${boundary}--`,
      "",
    ].join("\r\n");

    await expect(
      readFormDataRequest(
        new Request("http://localhost/upload", {
          body,
          headers: {
            "content-length": "1",
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
          method: "POST",
        }),
        64,
      ),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});

describe("uploaded text encoding", () => {
  it("decodes valid UTF-8 without replacing malformed bytes", async () => {
    await expect(
      readUtf8File(new File(["市场数据"], "market.csv")),
    ).resolves.toBe("市场数据");

    await expect(
      readUtf8File(
        new File([Uint8Array.from([0x63, 0x61, 0x66, 0xc3, 0x28])], "market.csv"),
      ),
    ).rejects.toThrow("not valid UTF-8");
  });
});

describe("JSON request media types", () => {
  it("accepts application/json and structured JSON suffixes", async () => {
    await expect(
      readJsonRequest(
        new Request("http://localhost/json", {
          body: '{"ok":true}',
          headers: { "content-type": "application/json; charset=utf-8" },
          method: "POST",
        }),
        1024,
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      readJsonRequest(
        new Request("http://localhost/json", {
          body: '{"ok":true}',
          headers: { "content-type": "application/problem+json" },
          method: "POST",
        }),
        1024,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects text/plain JSON before reading it", async () => {
    await expect(
      readJsonRequest(
        new Request("http://localhost/json", {
          body: '{"ok":true}',
          headers: { "content-type": "text/plain" },
          method: "POST",
        }),
        1024,
      ),
    ).rejects.toThrow("not JSON content");
  });
});
