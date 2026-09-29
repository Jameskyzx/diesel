import { describe, expect, it, vi } from "vitest";

import {
  readFormDataRequest,
  readJsonRequest,
  readUtf8File,
  RequestBodyAbortedError,
  RequestBodyTooLargeError,
  RequestBodyTimeoutError,
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

  it("applies the size boundary before rejecting a non-multipart media type", async () => {
    const cancel = vi.fn();
    const requestInit: RequestInit & { duplex: "half" } = {
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: "half",
      headers: {
        "content-length": "2048",
        "content-type": "text/plain",
      },
      method: "POST",
    };

    let error: unknown;
    try {
      await readFormDataRequest(
        new Request("http://localhost/upload", requestInit),
        1024,
      );
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledWith("request-body-too-large");
    await (error as RequestBodyTooLargeError).cleanup;
  });

  it("times out and cancels a stalled multipart upload", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const requestInit: RequestInit & { duplex: "half" } = {
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: "half",
      headers: { "content-type": "multipart/form-data; boundary=stalled" },
      method: "POST",
    };

    try {
      const reading = readFormDataRequest(
        new Request("http://localhost/upload", requestInit),
        1024,
        25,
      );
      const rejection = expect(reading).rejects.toBeInstanceOf(
        RequestBodyTimeoutError,
      );

      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(cancel).toHaveBeenCalledWith("request-body-timeout");
    } finally {
      vi.useRealTimers();
    }
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

  it("rejects a bounded text/plain body after applying transport limits", async () => {
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

  it("cancels an oversized text/plain body before media-type rejection", async () => {
    const cancel = vi.fn();
    const requestInit: RequestInit & { duplex: "half" } = {
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: "half",
      headers: {
        "content-length": "2048",
        "content-type": "text/plain",
      },
      method: "POST",
    };

    let error: unknown;
    try {
      await readJsonRequest(
        new Request("http://localhost/json", requestInit),
        1024,
      );
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledWith("request-body-too-large");
    await (error as RequestBodyTooLargeError).cleanup;
  });

  it("starts cancellation for a declared oversized body without delaying 413 handling", async () => {
    let finishCancel: (() => void) | undefined;
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCancel = resolve;
        }),
    );
    const requestInit: RequestInit & { duplex: "half" } = {
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: "half",
      headers: {
        "content-length": "2048",
        "content-type": "application/json",
      },
      method: "POST",
    };

    let error: unknown;
    try {
      await readJsonRequest(
        new Request("http://localhost/json", requestInit),
        1024,
      );
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledWith("request-body-too-large");
    finishCancel?.();
    await (error as RequestBodyTooLargeError).cleanup;
  });

  it("does not await a stalled cancellation after streamed bytes exceed the limit", async () => {
    let finishCancel: (() => void) | undefined;
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCancel = resolve;
        }),
    );
    const requestInit: RequestInit & { duplex: "half" } = {
      body: new ReadableStream<Uint8Array>({
        cancel,
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`{"value":"${"x".repeat(128)}"}`));
        },
      }),
      duplex: "half",
      headers: { "content-type": "application/json" },
      method: "POST",
    };

    let error: unknown;
    try {
      await readJsonRequest(
        new Request("http://localhost/json", requestInit),
        64,
      );
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledWith("request-body-too-large");
    finishCancel?.();
    await (error as RequestBodyTooLargeError).cleanup;
  });

  it("cancels a pending body read when the client disconnects", async () => {
    const abortController = new AbortController();
    const cancel = vi.fn();
    const requestInit: RequestInit & { duplex: "half" } = {
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: "half",
      headers: { "content-type": "application/json" },
      method: "POST",
    };
    const reading = readJsonRequest(
      new Request("http://localhost/json", requestInit),
      1024,
      30_000,
      abortController.signal,
    );

    abortController.abort("client-disconnected");

    await expect(reading).rejects.toBeInstanceOf(RequestBodyAbortedError);
    expect(cancel).toHaveBeenCalledWith("request-body-aborted");
  });
});
