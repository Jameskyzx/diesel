import { Buffer } from "node:buffer";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_CHAT_SETUP_MS } from "@/server/http/request-limits";

const mocks = vi.hoisted(() => ({
  ensureSession: vi.fn(async () => undefined),
  getAiAuditRepository: vi.fn(),
  getConfiguredAiModel: vi.fn(),
}));

type GetResolvedPdfJs = typeof import("unpdf")["getResolvedPDFJS"];
type PdfJsModule = Awaited<ReturnType<GetResolvedPdfJs>>;
type PdfLoadingTask = ReturnType<PdfJsModule["getDocument"]>;
type PdfDocument = Awaited<PdfLoadingTask["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
type SharpFactory = typeof import("sharp")["default"];
type SharpInstance = ReturnType<SharpFactory>;
type SharpMetadata = Awaited<ReturnType<SharpInstance["metadata"]>>;

const unpdfMock = vi.hoisted(() => ({
  actualGetResolvedPdfJs: undefined as GetResolvedPdfJs | undefined,
  getResolvedPDFJS: vi.fn<GetResolvedPdfJs>(),
}));

const sharpMock = vi.hoisted(() => ({
  actualSharp: undefined as SharpFactory | undefined,
  sharp: vi.fn<SharpFactory>(),
}));

vi.mock("unpdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("unpdf")>();
  unpdfMock.actualGetResolvedPdfJs = actual.getResolvedPDFJS;
  return { ...actual, getResolvedPDFJS: unpdfMock.getResolvedPDFJS };
});

vi.mock("sharp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sharp")>();
  sharpMock.actualSharp = actual.default;
  return { ...actual, default: sharpMock.sharp };
});

vi.mock("@/server/ai/model", () => ({
  AiConfigurationError: class AiConfigurationError extends Error {},
  getConfiguredAiModel: mocks.getConfiguredAiModel,
}));

vi.mock("@/server/services/ai-audit-service", () => ({
  getAiAuditRepository: mocks.getAiAuditRepository,
}));

import { POST } from "@/app/api/chat/route";
import { validateUiMessageSse } from "@/domain/operations/synthetic-canary";

function mockPdfLoadingTask(
  promise: Promise<PdfDocument>,
  destroy: () => Promise<void> = vi.fn(async () => undefined),
) {
  const loadingTask = {
    destroy,
    promise,
  } as unknown as PdfLoadingTask;
  const getDocument = vi.fn(() => loadingTask);
  unpdfMock.getResolvedPDFJS.mockResolvedValueOnce({
    getDocument,
  } as unknown as PdfJsModule);
  return { destroy, getDocument, loadingTask };
}

describe("POST /api/chat validation ordering", () => {
  beforeEach(() => {
    const actualGetResolvedPdfJs = unpdfMock.actualGetResolvedPdfJs;
    if (actualGetResolvedPdfJs === undefined) {
      throw new Error("The real unpdf getResolvedPDFJS export was not loaded.");
    }
    unpdfMock.getResolvedPDFJS
      .mockReset()
      .mockImplementation(actualGetResolvedPdfJs);
    const actualSharp = sharpMock.actualSharp;
    if (actualSharp === undefined) {
      throw new Error("The real sharp default export was not loaded.");
    }
    sharpMock.sharp.mockReset().mockImplementation(actualSharp);
    mocks.ensureSession.mockClear();
    mocks.getAiAuditRepository.mockReset();
    mocks.getConfiguredAiModel.mockReset();
    mocks.getAiAuditRepository.mockResolvedValue({
      ensureSession: mocks.ensureSession,
      recordToolCall: async () => undefined,
    });
    mocks.getConfiguredAiModel.mockReturnValue({
      model: {},
      modelId: "mock/validation-only",
    });
  });

  it("keeps the release-verification capability request off the model path", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "release-verification",
              parts: [{ text: "What can you do?", type: "text" }],
              role: "user",
            },
          ],
          locale: "en",
          sessionId: "00000000-0000-4000-8000-000000000001",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    const body = await response.text();
    expect(body).toContain("structured facts and traceable sources");
    await expect(validateUiMessageSse(body)).resolves.toBe(true);
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it.each([
    {
      expectedText: "rated power in kW",
      locale: "en",
      text: "Check current CHN non-road regulations.",
    },
    {
      expectedText: "不能按应用场景过滤",
      locale: "zh-CN",
      text: "不做跨国比较，只看 CHN non-road 市场数据。",
    },
  ])(
    "fails a partial $locale query closed before model and audit setup",
    async ({ expectedText, locale, text }) => {
      const response = await POST(
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            locale,
            messages: [
              {
                id: crypto.randomUUID(),
                parts: [{ text, type: "text" }],
                role: "user",
              },
            ],
            sessionId: crypto.randomUUID(),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain(expectedText);
      await expect(validateUiMessageSse(body)).resolves.toBe(true);
      expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
      expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
      expect(mocks.ensureSession).not.toHaveBeenCalled();
    },
  );

  it.each([
    { cookie: "diesel_locale=zh-CN", locale: "zh-CN" },
    { cookie: "diesel_locale=%7Ah-CN", locale: "zh-CN" },
    { cookie: "diesel_locale=%65%6E", locale: "en" },
    { cookie: "diesel_locale=%257Ah-CN", locale: "en" },
    { cookie: "diesel_locale=zh-CN; diesel_locale=en", locale: "zh-CN" },
    { cookie: "diesel_locale=en; diesel_locale=zh-CN", locale: "en" },
    { cookie: "diesel_locale=fr; diesel_locale=zh-CN", locale: "en" },
    { cookie: "diesel_locale=%E0%A4%A; diesel_locale=zh-CN", locale: "en" },
  ])("uses the shared $locale cookie semantics for $cookie when the body omits locale", async ({ cookie, locale }) => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "cookie-locale",
              parts: [{ text: "What can you do?", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          cookie,
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(locale === "en"
      ? "structured facts and traceable sources"
      : "结构化事实和可追溯来源");
    await expect(validateUiMessageSse(body)).resolves.toBe(true);
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it.each([
    {
      cookie: "diesel_locale=%7Ah-CN",
      message: "聊天请求格式无效，请检查消息和国家上下文。",
    },
    {
      cookie: "diesel_locale=%E0%A4%A; diesel_locale=zh-CN",
      message: "The chat request is invalid. Check the messages and country context.",
    },
  ])("uses the shared Cookie semantics for an invalid request with $cookie", async ({ cookie, message }) => {
    const response = await POST(new Request("http://localhost/api/chat", {
      body: "not-json",
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_INPUT", message },
    });
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it("keeps an explicit body locale authoritative over the locale cookie", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          locale: "en",
          messages: [
            {
              id: "body-locale",
              parts: [{ text: "What can you do?", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          cookie: "diesel_locale=zh-CN",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      "structured facts and traceable sources",
    );
  });

  it("does not create an audit session for a remote attachment URL", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "attachment-message",
              parts: [
                { text: "分析这个附件", type: "text" },
                {
                  filename: "untrusted.txt",
                  mediaType: "text/plain",
                  type: "file",
                  url: "https://example.invalid/untrusted.txt",
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it("rejects images below the provider-compatible 11 pixel boundary before setup", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "tiny-image-message",
              parts: [
                { text: "描述图片内容", type: "text" },
                {
                  filename: "tiny.png",
                  mediaType: "image/png",
                  type: "file",
                  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it("rejects an unreadable inline PDF after capability check but before audit setup", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "broken-pdf-message",
              parts: [
                { text: "分析这个 PDF", type: "text" },
                {
                  filename: "broken.pdf",
                  mediaType: "application/pdf",
                  type: "file",
                  url: `data:application/pdf;base64,${Buffer.from("%PDF-not-a-document").toString("base64")}`,
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "INVALID_INPUT",
        message: expect.stringContaining("could not be processed"),
      },
    });
    expect(mocks.getConfiguredAiModel).toHaveBeenCalledWith(undefined, {
      requiresMultimodalModel: false,
    });
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it("propagates client abort through PDF preparation and releases resources", async () => {
    const cancel = vi.fn(async () => undefined);
    const cleanup = vi.fn(() => true);
    const destroy = vi.fn(async () => undefined);
    let resolveRead!: (result: ReadableStreamReadResult<unknown>) => void;
    const pendingRead = new Promise<ReadableStreamReadResult<unknown>>(
      (resolve) => {
        resolveRead = resolve;
      },
    );
    const read = vi.fn(() => pendingRead);
    const reader = {
      cancel,
      read,
    } as unknown as ReadableStreamDefaultReader<unknown>;
    const page = {
      cleanup,
      streamTextContent: () =>
        ({ getReader: () => reader }) as unknown as ReadableStream<unknown>,
    } as unknown as PdfPage;
    const pdf = {
      getPage: vi.fn(async () => page),
      numPages: 1,
    } as unknown as PdfDocument;
    mockPdfLoadingTask(Promise.resolve(pdf), destroy);
    const abortController = new AbortController();
    const responsePromise = POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "aborted-pdf-message",
              parts: [
                { text: "分析这个 PDF", type: "text" },
                {
                  filename: "stalled.pdf",
                  mediaType: "application/pdf",
                  type: "file",
                  url: `data:application/pdf;base64,${Buffer.from("%PDF-mocked").toString("base64")}`,
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: abortController.signal,
      }),
    );

    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    abortController.abort("client-disconnected");

    const response = await responsePromise;
    expect(response.status).toBe(408);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();

    resolveRead({ done: true, value: undefined });
    await pendingRead;
  });

  it("retains admission until the original PDF loading task settles", async () => {
    const resolveDestroyers: Array<() => void> = [];
    const settleDocuments: Array<() => void> = [];
    const destroyers = [
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveDestroyers.push(resolve);
          }),
      ),
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveDestroyers.push(resolve);
          }),
      ),
    ];
    const pendingDocuments = Array.from({ length: 2 }, (_, index) =>
      new Promise<PdfDocument>((resolve, reject) => {
        settleDocuments.push(() => {
          if (index === 0) {
            resolve({ numPages: 0 } as PdfDocument);
            return;
          }
          reject(new Error("late-pdf-secret-must-not-escape"));
        });
      }),
    );
    const loadingTasks = pendingDocuments.map((promise, index) =>
      mockPdfLoadingTask(promise, destroyers[index]),
    );
    const clientIp = "203.0.113.61";
    const pendingPdfRequest = (signal: AbortSignal) =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [
                { text: "分析这个 PDF", type: "text" },
                {
                  filename: "pending.pdf",
                  mediaType: "application/pdf",
                  type: "file",
                  url: `data:application/pdf;base64,${Buffer.from("%PDF-pending").toString("base64")}`,
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
        method: "POST",
        signal,
      });
    const greetingRequest = () =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [{ text: "你好", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
        method: "POST",
      });

    const firstAbort = new AbortController();
    const firstPromise = POST(pendingPdfRequest(firstAbort.signal));
    await vi.waitFor(() =>
      expect(loadingTasks[0]?.getDocument).toHaveBeenCalledOnce(),
    );
    firstAbort.abort("client-disconnected");
    expect((await firstPromise).status).toBe(408);
    expect(destroyers[0]).toHaveBeenCalledOnce();

    const secondAbort = new AbortController();
    const secondPromise = POST(pendingPdfRequest(secondAbort.signal));
    await vi.waitFor(() =>
      expect(loadingTasks[1]?.getDocument).toHaveBeenCalledOnce(),
    );
    secondAbort.abort("client-disconnected");
    expect((await secondPromise).status).toBe(408);
    expect(destroyers[1]).toHaveBeenCalledOnce();

    const blocked = await POST(greetingRequest());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("1");

    for (const resolveDestroyer of resolveDestroyers) {
      resolveDestroyer();
    }
    await Promise.all(
      destroyers.map((destroy) => destroy.mock.results[0]?.value),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const stillBlockedAfterCleanup = await POST(greetingRequest());
    expect(stillBlockedAfterCleanup.status).toBe(429);

    for (const settleDocument of settleDocuments) {
      settleDocument();
    }
    await Promise.allSettled(pendingDocuments);
    for (let microtask = 0; microtask < 4; microtask += 1) {
      await Promise.resolve();
    }

    const afterOriginalWork = await POST(greetingRequest());
    expect(afterOriginalWork.status).toBe(200);
    await afterOriginalWork.text();
  });

  it("retains admission until an aborted PDF getPage operation settles", async () => {
    const resolvePages: Array<(page: PdfPage) => void> = [];
    const getPages = Array.from({ length: 2 }, () =>
      vi.fn(
        () =>
          new Promise<PdfPage>((resolve) => {
            resolvePages.push(resolve);
          }),
      ),
    );
    const documents = getPages.map(
      (getPage) => ({ getPage, numPages: 1 }) as unknown as PdfDocument,
    );
    const destroyers = Array.from({ length: 2 }, () =>
      vi.fn(async () => undefined),
    );
    documents.map((document, index) =>
      mockPdfLoadingTask(Promise.resolve(document), destroyers[index]),
    );
    const clientIp = "203.0.113.62";
    const pdfRequest = (signal: AbortSignal) =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [
                { text: "分析这个 PDF", type: "text" },
                {
                  filename: "pending-page.pdf",
                  mediaType: "application/pdf",
                  type: "file",
                  url: `data:application/pdf;base64,${Buffer.from("%PDF-pending-page").toString("base64")}`,
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
        method: "POST",
        signal,
      });
    const greetingRequest = () =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [{ text: "你好", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
        method: "POST",
      });

    const abortControllers = [new AbortController(), new AbortController()];
    const requests = abortControllers.map((controller) =>
      POST(pdfRequest(controller.signal)),
    );
    await vi.waitFor(() =>
      expect(getPages.every((getPage) => getPage.mock.calls.length === 1)).toBe(
        true,
      ),
    );
    for (const controller of abortControllers) {
      controller.abort("client-disconnected");
    }

    const responses = await Promise.all(requests);
    expect(responses.every((response) => response.status === 408)).toBe(true);
    expect(destroyers.every((destroy) => destroy.mock.calls.length === 1)).toBe(
      true,
    );
    expect((await POST(greetingRequest())).status).toBe(429);

    const unusedPage = {
      cleanup: vi.fn(() => true),
      streamTextContent: vi.fn(),
    } as unknown as PdfPage;
    for (const resolvePage of resolvePages) {
      resolvePage(unusedPage);
    }
    for (let microtask = 0; microtask < 4; microtask += 1) {
      await Promise.resolve();
    }

    const afterOriginalWork = await POST(greetingRequest());
    expect(afterOriginalWork.status).toBe(200);
    await afterOriginalWork.text();
  });

  it("retains admission until an aborted PDF reader operation settles", async () => {
    const resolveReads: Array<
      (result: ReadableStreamReadResult<unknown>) => void
    > = [];
    const reads = Array.from({ length: 2 }, () =>
      vi.fn(
        () =>
          new Promise<ReadableStreamReadResult<unknown>>((resolve) => {
            resolveReads.push(resolve);
          }),
      ),
    );
    const cancels = Array.from({ length: 2 }, () =>
      vi.fn(async () => undefined),
    );
    const cleanups = Array.from({ length: 2 }, () => vi.fn(() => true));
    const pages = reads.map((read, index) => {
      const reader = {
        cancel: cancels[index],
        read,
      } as unknown as ReadableStreamDefaultReader<unknown>;
      return {
        cleanup: cleanups[index],
        streamTextContent: () =>
          ({ getReader: () => reader }) as unknown as ReadableStream<unknown>,
      } as unknown as PdfPage;
    });
    const documents = pages.map(
      (page) =>
        ({ getPage: vi.fn(async () => page), numPages: 1 }) as unknown as PdfDocument,
    );
    const destroyers = Array.from({ length: 2 }, () =>
      vi.fn(async () => undefined),
    );
    documents.forEach((document, index) => {
      mockPdfLoadingTask(Promise.resolve(document), destroyers[index]);
    });
    const clientIp = "203.0.113.67";
    const pdfRequest = (signal: AbortSignal) =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [
                { text: "分析这个 PDF", type: "text" },
                {
                  filename: "pending-read.pdf",
                  mediaType: "application/pdf",
                  type: "file",
                  url: `data:application/pdf;base64,${Buffer.from("%PDF-pending-read").toString("base64")}`,
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
        method: "POST",
        signal,
      });
    const greetingRequest = () =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [{ text: "你好", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
        method: "POST",
      });

    const controllers = [new AbortController(), new AbortController()];
    const requests = controllers.map((controller) =>
      POST(pdfRequest(controller.signal)),
    );
    await vi.waitFor(() =>
      expect(reads.every((read) => read.mock.calls.length === 1)).toBe(true),
    );
    for (const controller of controllers) {
      controller.abort("client-disconnected");
    }

    const responses = await Promise.all(requests);
    expect(responses.every((response) => response.status === 408)).toBe(true);
    expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(true);
    expect(cleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(
      true,
    );
    expect(destroyers.every((destroy) => destroy.mock.calls.length === 1)).toBe(
      true,
    );
    expect((await POST(greetingRequest())).status).toBe(429);

    for (const resolveRead of resolveReads) {
      resolveRead({ done: true, value: undefined });
    }
    for (let microtask = 0; microtask < 4; microtask += 1) {
      await Promise.resolve();
    }

    const afterOriginalWork = await POST(greetingRequest());
    expect(afterOriginalWork.status).toBe(200);
    await afterOriginalWork.text();
  });

  it.each(["metadata", "pixels"] as const)(
    "retains admission until aborted Sharp %s work settles",
    async (pendingStage) => {
      const settlePending: Array<() => void> = [];
      const metadataCalls: Array<ReturnType<typeof vi.fn>> = [];
      const pixelCalls: Array<ReturnType<typeof vi.fn>> = [];
      const destroyed: Array<ReturnType<typeof vi.fn>> = [];

      for (let requestIndex = 0; requestIndex < 2; requestIndex += 1) {
        const metadataPromise =
          pendingStage === "metadata"
            ? new Promise<SharpMetadata>((resolve) => {
                settlePending.push(() =>
                  resolve({
                    format: "png",
                    height: 16,
                    pages: 1,
                    width: 16,
                  } as SharpMetadata),
                );
              })
            : Promise.resolve({
                format: "png",
                height: 16,
                pages: 1,
                width: 16,
              } as SharpMetadata);
        const metadata = vi.fn(() => metadataPromise);
        const metadataDestroy = vi.fn();
        const pixelPromise =
          pendingStage === "pixels"
            ? new Promise<Buffer>((resolve) => {
                settlePending.push(() => resolve(Buffer.from([0])));
              })
            : Promise.resolve(Buffer.from([0]));
        const toBuffer = vi.fn(() => pixelPromise);
        const pixelDestroy = vi.fn();
        const pixelDecoder: SharpInstance = {
          destroy: pixelDestroy,
          raw: vi.fn(() => pixelDecoder),
          resize: vi.fn(() => pixelDecoder),
          toBuffer,
        } as unknown as SharpInstance;
        const metadataDecoder = {
          destroy: metadataDestroy,
          metadata,
        } as unknown as SharpInstance;

        sharpMock.sharp
          .mockReturnValueOnce(metadataDecoder)
          .mockReturnValueOnce(pixelDecoder);
        metadataCalls.push(metadata);
        pixelCalls.push(toBuffer);
        destroyed.push(metadataDestroy, pixelDestroy);
      }

      const clientIp = pendingStage === "metadata" ? "203.0.113.63" : "203.0.113.64";
      const imageUrl =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=";
      const imageRequest = (signal: AbortSignal) =>
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            messages: [
              {
                id: crypto.randomUUID(),
                parts: [
                  { text: "读取铭牌", type: "text" },
                  {
                    filename: "plate.png",
                    mediaType: "image/png",
                    type: "file",
                    url: imageUrl,
                  },
                ],
                role: "user",
              },
            ],
            sessionId: crypto.randomUUID(),
          }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": clientIp,
          },
          method: "POST",
          signal,
        });
      const greetingRequest = () =>
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            messages: [
              {
                id: crypto.randomUUID(),
                parts: [{ text: "你好", type: "text" }],
                role: "user",
              },
            ],
            sessionId: crypto.randomUUID(),
          }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": clientIp,
          },
          method: "POST",
        });

      const controllers = [new AbortController(), new AbortController()];
      const requests = controllers.map((controller) =>
        POST(imageRequest(controller.signal)),
      );
      const pendingCalls =
        pendingStage === "metadata" ? metadataCalls : pixelCalls;
      await vi.waitFor(() =>
        expect(pendingCalls.every((call) => call.mock.calls.length === 1)).toBe(
          true,
        ),
      );
      for (const controller of controllers) {
        controller.abort("client-disconnected");
      }

      const responses = await Promise.all(requests);
      expect(responses.every((response) => response.status === 408)).toBe(true);
      expect(destroyed.every((destroy) => destroy.mock.calls.length === 1)).toBe(
        true,
      );
      expect((await POST(greetingRequest())).status).toBe(429);

      for (const settle of settlePending) {
        settle();
      }
      for (let microtask = 0; microtask < 4; microtask += 1) {
        await Promise.resolve();
      }

      const afterOriginalWork = await POST(greetingRequest());
      expect(afterOriginalWork.status).toBe(200);
      await afterOriginalWork.text();
    },
  );

  it("returns promptly on abort while audit repository setup retains admission", async () => {
    const auditRepository = {
      ensureSession: mocks.ensureSession,
      recordToolCall: async () => undefined,
    };
    const resolveRepositories: Array<
      (repository: typeof auditRepository) => void
    > = [];
    const pendingRepositories = Array.from(
      { length: 2 },
      () =>
        new Promise<typeof auditRepository>((resolve) => {
          resolveRepositories.push(resolve);
        }),
    );
    mocks.getAiAuditRepository
      .mockImplementationOnce(() => pendingRepositories[0])
      .mockImplementationOnce(() => pendingRepositories[1]);
    const clientIp = "203.0.113.65";
    const setupRequest = (signal?: AbortSignal) =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [
                {
                  text:
                    "核对 CHN non-road 100 kW 在 2026-08-30 的现行法规与限值。",
                  type: "text",
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
        method: "POST",
        signal,
      });
    const greetingRequest = () =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [{ text: "你好", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
        method: "POST",
      });

    const controllers = [new AbortController(), new AbortController()];
    const requests = controllers.map((controller) =>
      POST(setupRequest(controller.signal)),
    );
    await vi.waitFor(() =>
      expect(mocks.getAiAuditRepository).toHaveBeenCalledTimes(2),
    );
    for (const controller of controllers) {
      controller.abort("caller-controlled-secret");
    }

    const responses = await Promise.all(requests);
    expect(responses.every((response) => response.status === 408)).toBe(true);
    expect((await POST(greetingRequest())).status).toBe(429);
    expect(mocks.ensureSession).not.toHaveBeenCalled();

    for (const resolveRepository of resolveRepositories) {
      resolveRepository(auditRepository);
    }
    await Promise.all(pendingRepositories);
    for (let microtask = 0; microtask < 4; microtask += 1) {
      await Promise.resolve();
    }

    const afterOriginalWork = await POST(greetingRequest());
    expect(afterOriginalWork.status).toBe(200);
    await afterOriginalWork.text();
  });

  it("times out audit-session setup but retains admission until late failures settle", async () => {
    vi.useFakeTimers();
    const sensitiveText = "postgres://audit:secret@example.test/database";
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const rejectSessions: Array<(error: Error) => void> = [];
    const pendingSessions = Array.from(
      { length: 2 },
      () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectSessions.push(reject);
        }),
    );
    mocks.ensureSession
      .mockImplementationOnce(() => pendingSessions[0])
      .mockImplementationOnce(() => pendingSessions[1]);
    const clientIp = "203.0.113.66";
    const setupRequest = () =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [
                {
                  text:
                    "核对 CHN non-road 100 kW 在 2026-08-30 的现行法规与限值。",
                  type: "text",
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
        method: "POST",
      });
    const greetingRequest = () =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [{ text: "你好", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
        method: "POST",
      });

    try {
      const requests = [POST(setupRequest()), POST(setupRequest())];
      await vi.waitFor(() => expect(mocks.ensureSession).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(MAX_CHAT_SETUP_MS);

      const responses = await Promise.all(requests);
      expect(responses.every((response) => response.status === 503)).toBe(true);
      for (const response of responses) {
        expect(response.headers.get("Cache-Control")).toBe(
          "private, no-store, max-age=0",
        );
        expect(response.headers.get("Pragma")).toBe("no-cache");
        expect(response.headers.get("Retry-After")).toBe(
          String(Math.ceil(MAX_CHAT_SETUP_MS / 1_000)),
        );
        expect(JSON.stringify(await response.json())).not.toContain(
          sensitiveText,
        );
      }
      expect((await POST(greetingRequest())).status).toBe(429);

      for (const rejectSession of rejectSessions) {
        rejectSession(new Error(sensitiveText));
      }
      await Promise.all(
        pendingSessions.map((session) => session.catch(() => undefined)),
      );
      for (let microtask = 0; microtask < 4; microtask += 1) {
        await Promise.resolve();
      }

      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(sensitiveText);
      expect(consoleSpy).toHaveBeenCalledWith(
        "AI chat setup failed after request completion",
        { errorCode: "Error", stage: "audit_session" },
      );
      const afterOriginalWork = await POST(greetingRequest());
      expect(afterOriginalWork.status).toBe(200);
      await afterOriginalWork.text();
    } finally {
      for (const rejectSession of rejectSessions) {
        rejectSession(new Error("test-cleanup"));
      }
      consoleSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not start attachment work for a pre-aborted request", async () => {
    const controller = new AbortController();
    controller.abort("caller-controlled-secret");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [
                { text: "读取铭牌", type: "text" },
                {
                  filename: "plate.png",
                  mediaType: "image/png",
                  type: "file",
                  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=",
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      }),
    );

    expect(response.status).toBe(408);
    expect(sharpMock.sharp).not.toHaveBeenCalled();
    expect(unpdfMock.getResolvedPDFJS).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
  });

  it("rejects client-supplied AI configuration", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          aiConfig: {
            apiKey: "client-secret-must-not-be-accepted",
            baseUrl: "https://api.example.com/v1",
            model: "gpt-4o-mini",
          },
          messages: [
            {
              id: "valid-message",
              parts: [{ text: "查询法规", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(
      "client-secret-must-not-be-accepted",
    );
  });

  it("rejects client provider metadata before model or database setup", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "provider-metadata-message",
              parts: [
                {
                  providerMetadata: {
                    provider: { untrustedOption: "client-controlled" },
                  },
                  text: "普通用户文本",
                  type: "text",
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it("releases synchronous setup failures without logging sensitive details", async () => {
    const sensitiveText = "postgres://user:secret@example.test/database";
    const clientIp = "203.0.113.68";
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.getAiAuditRepository.mockImplementationOnce(() => {
      throw new Error(`Audit setup failed for ${sensitiveText}`);
    });

    try {
      const response = await POST(
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            messages: [
              {
                id: "valid-message",
                parts: [{ text: "查询 CHN 法规", type: "text" }],
                role: "user",
              },
            ],
            sessionId: crypto.randomUUID(),
          }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": clientIp,
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain(
        sensitiveText,
      );
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(
        sensitiveText,
      );
      expect(consoleSpy).toHaveBeenCalledWith("Chat request failed", {
        errorCode: "Error",
      });

      const afterSynchronousFailure = await POST(
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            messages: [
              {
                id: crypto.randomUUID(),
                parts: [{ text: "你好", type: "text" }],
                role: "user",
              },
            ],
            sessionId: crypto.randomUUID(),
          }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": clientIp,
          },
          method: "POST",
        }),
      );
      expect(afterSynchronousFailure.status).toBe(200);
      await afterSynchronousFailure.text();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
