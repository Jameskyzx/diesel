import { inspect } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { readScreenshotDemoJson } from "../scripts/portfolio/screenshot-demo-json";

const encoder = new TextEncoder();
const maximumBytes = 4_096;
const privateMarker = "PRIVATE_SCREENSHOT_RESPONSE_MARKER";

function streamFixture(
  chunks: readonly Uint8Array[],
  options: {
    cancel?: () => void | Promise<void>;
    contentLength?: string;
  } = {},
) {
  let nextChunk = 0;
  const cancel = vi.fn(options.cancel ?? (() => undefined));
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    const chunk = chunks[nextChunk++];
    if (chunk === undefined) controller.close();
    else controller.enqueue(chunk);
  });
  const stream = new ReadableStream<Uint8Array>(
    { cancel, pull },
    { highWaterMark: 0 },
  );
  const headers = new Headers();
  if (options.contentLength !== undefined) {
    headers.set("Content-Length", options.contentLength);
  }
  return { cancel, pull, response: new Response(stream, { headers }), stream };
}

function validJsonWithByteLength(byteLength: number): string {
  const emptyJsonBytes = encoder.encode(JSON.stringify({ value: "" })).byteLength;
  return JSON.stringify({ value: "x".repeat(byteLength - emptyJsonBytes) });
}

async function failureFrom(
  response: Response,
  signal = new AbortController().signal,
): Promise<Error> {
  try {
    await readScreenshotDemoJson(response, signal);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("Expected the screenshot response read to fail.");
}

function expectRedacted(error: Error): void {
  expect(error.message).not.toContain(privateMarker);
  expect(String(error)).not.toContain(privateMarker);
  expect(inspect(error, { depth: 8 })).not.toContain(privateMarker);
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("bounded screenshot Demo JSON response", () => {
  it("parses a streamed JSON object and releases its reader after successful EOF", async () => {
    const fixture = streamFixture([
      encoder.encode('{"status":'),
      encoder.encode('"ready","value":7}'),
    ]);

    await expect(
      readScreenshotDemoJson(fixture.response, new AbortController().signal),
    ).resolves.toEqual({ status: "ready", value: 7 });

    expect(fixture.pull).toHaveBeenCalledTimes(3);
    expect(fixture.cancel).not.toHaveBeenCalled();
    expect(fixture.stream.locked).toBe(false);
    const secondReader = fixture.stream.getReader();
    await expect(secondReader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    secondReader.releaseLock();
  });

  it.each([undefined, String(maximumBytes)])(
    "accepts exactly 4096 actual bytes with Content-Length %s",
    async (contentLength) => {
      const text = validJsonWithByteLength(maximumBytes);
      const bytes = encoder.encode(text);
      expect(bytes.byteLength).toBe(maximumBytes);
      const fixture = streamFixture(
        [bytes.subarray(0, 2_000), bytes.subarray(2_000)],
        { contentLength },
      );

      await expect(
        readScreenshotDemoJson(fixture.response, new AbortController().signal),
      ).resolves.toEqual(JSON.parse(text) as unknown);
      expect(fixture.stream.locked).toBe(false);
      expect(fixture.cancel).not.toHaveBeenCalled();
    },
  );

  it.each(["4097", "9999999999", "90071992547409931234567890", "00004097"])(
    "rejects and cancels a known oversized Content-Length %s before reading",
    async (contentLength) => {
      const fixture = streamFixture([encoder.encode("{}")], { contentLength });

      await failureFrom(fixture.response);

      expect(fixture.pull).not.toHaveBeenCalled();
      expect(fixture.cancel).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    undefined,
    "0",
    "2",
    "4096",
    "-1",
    "not-a-number",
    "4096, 4096",
    "4.096e3",
  ])(
    "enforces actual streamed bytes when Content-Length is absent, misleading, or malformed: %s",
    async (contentLength) => {
      const bytes = encoder.encode(validJsonWithByteLength(maximumBytes + 1));
      const fixture = streamFixture(
        [
          bytes.subarray(0, maximumBytes),
          bytes.subarray(maximumBytes),
          encoder.encode(" "),
        ],
        { contentLength },
      );

      await failureFrom(fixture.response);

      expect(fixture.cancel).toHaveBeenCalledTimes(1);
      expect(fixture.pull.mock.calls.length).toBeLessThanOrEqual(2);
    },
  );

  it("counts UTF-8 bytes rather than JavaScript string length", async () => {
    const text = JSON.stringify({ value: "🙂".repeat(1_024) });
    expect(text.length).toBeLessThan(maximumBytes);
    expect(encoder.encode(text).byteLength).toBeGreaterThan(maximumBytes);
    const fixture = streamFixture([encoder.encode(text)], {
      contentLength: String(text.length),
    });

    await failureFrom(fixture.response);

    expect(fixture.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.pull).toHaveBeenCalledTimes(1);
  });

  it("accepts UTF-8 code points split across individual byte chunks", async () => {
    const value = { value: "中🙂文é" };
    const bytes = encoder.encode(JSON.stringify(value));
    const fixture = streamFixture(Array.from(bytes, (byte) => Uint8Array.of(byte)));

    await expect(
      readScreenshotDemoJson(fixture.response, new AbortController().signal),
    ).resolves.toEqual(value);
    expect(fixture.stream.locked).toBe(false);
  });

  it.each([
    { name: "invalid continuation", bytes: [0xc3, 0x28] },
    { name: "overlong encoding", bytes: [0xc0, 0xaf] },
    { name: "encoded surrogate", bytes: [0xed, 0xa0, 0x80] },
    { name: "out-of-range code point", bytes: [0xf4, 0x90, 0x80, 0x80] },
  ])("rejects $name UTF-8 without exposing input", async ({ bytes }) => {
    const fixture = streamFixture([
      encoder.encode(`{"value":"${privateMarker}`),
      Uint8Array.from(bytes),
      encoder.encode('"}'),
    ]);

    expectRedacted(await failureFrom(fixture.response));
  });

  it("rejects a truncated UTF-8 sequence at EOF without substituting a replacement character", async () => {
    const fixture = streamFixture([
      encoder.encode(`{"value":"${privateMarker}"}`),
      Uint8Array.of(0xe2, 0x82),
    ]);

    expectRedacted(await failureFrom(fixture.response));
  });

  it("does not reject a correctly encoded literal Unicode replacement character", async () => {
    const fixture = streamFixture([encoder.encode('{"value":"�"}')]);

    await expect(
      readScreenshotDemoJson(fixture.response, new AbortController().signal),
    ).resolves.toEqual({ value: "�" });
  });

  it.each(["", `{ "private": "${privateMarker}",`, `not-json-${privateMarker}`])(
    "rejects malformed JSON without including its body in errors",
    async (text) => {
      const fixture = streamFixture([encoder.encode(text)]);

      expectRedacted(await failureFrom(fixture.response));
    },
  );

  it("rejects an absent response body", async () => {
    await failureFrom(new Response(null));
  });

  it("does not expose a stream read rejection through the error or its cause", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error(privateMarker);
      },
    });

    expectRedacted(await failureFrom(new Response(stream)));
  });

  it("honors an already-aborted signal before reading and redacts its reason", async () => {
    const controller = new AbortController();
    controller.abort(new Error(privateMarker));
    const fixture = streamFixture([encoder.encode("{}")]);

    expectRedacted(await failureFrom(fixture.response, controller.signal));

    expect(fixture.pull).not.toHaveBeenCalled();
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["hanging", "rejecting"] as const)(
    "rejects a stalled read on supplied abort even when stream cancellation is %s",
    async (cancellation) => {
      const controller = new AbortController();
      const cancel = vi.fn(() =>
        cancellation === "hanging"
          ? new Promise<void>(() => undefined)
          : Promise.reject(new Error(privateMarker)),
      );
      const pull = vi.fn(() => new Promise<void>(() => undefined));
      const stream = new ReadableStream<Uint8Array>(
        { cancel, pull },
        { highWaterMark: 0 },
      );
      let settled = false;
      const operation = failureFrom(new Response(stream), controller.signal).then(
        (error) => {
          settled = true;
          return error;
        },
      );

      await flushMicrotasks();
      expect(pull).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);
      controller.abort(new Error(privateMarker));

      expectRedacted(await operation);
      expect(cancel).toHaveBeenCalledTimes(1);
    },
    1_000,
  );

  it.each(["hanging", "rejecting"] as const)(
    "rejects actual overflow without awaiting %s stream cancellation",
    async (cancellation) => {
      const fixture = streamFixture(
        [encoder.encode(validJsonWithByteLength(maximumBytes + 1))],
        {
          cancel: () =>
            cancellation === "hanging"
              ? new Promise<void>(() => undefined)
              : Promise.reject(new Error(privateMarker)),
        },
      );

      expectRedacted(await failureFrom(fixture.response));
      expect(fixture.cancel).toHaveBeenCalledTimes(1);
    },
    1_000,
  );

  it.each(["hanging", "rejecting"] as const)(
    "rejects an oversized declared length without awaiting %s cancellation or pulling bytes",
    async (cancellation) => {
      const fixture = streamFixture([encoder.encode("{}")], {
        contentLength: "4097",
        cancel: () =>
          cancellation === "hanging"
            ? new Promise<void>(() => undefined)
            : Promise.reject(new Error(privateMarker)),
      });

      expectRedacted(await failureFrom(fixture.response));
      expect(fixture.pull).not.toHaveBeenCalled();
      expect(fixture.cancel).toHaveBeenCalledTimes(1);
    },
    1_000,
  );
});
