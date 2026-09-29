import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type InferUITools,
  InvalidArgumentError,
  MessageConversionError,
  TypeValidationError,
  type UIDataTypes,
  type UIMessage,
  validateUIMessages,
} from "ai";
import { z, ZodError } from "zod";

import { captureChatRuntimeContext } from "@/domain/ai/chat-runtime-context";
import {
  chatApiErrorSchema,
  chatRequestSchema,
} from "@/features/ai/schemas";
import { getErrorCode } from "@/lib/api-error";
import {
  createSalesChatTools,
  streamSalesChat,
  type SalesChatTools,
} from "@/server/ai/sales-chat";
import {
  AiConfigurationError,
  getConfiguredAiModel,
} from "@/server/ai/model";
import {
  ChatAttachmentProcessingError,
  prepareTrustedUserMessagesForModel,
} from "@/server/ai/attachment-content";
import {
  extractClientIdentifier,
  getAiChatInFlightGate,
  getAiChatRateLimiter,
  type RateLimitDecision,
} from "@/server/http/rate-limit";
import {
  getAiChatAdmissionBudget,
  validateAiChatAdmissionBudgetConfiguration,
} from "@/server/http/ai-admission-budget";
import {
  readJsonRequest,
  RequestBodyAbortedError,
  RequestBodyTooLargeError,
  RequestBodyTimeoutError,
} from "@/server/http/request-body";
import { getAiAuditRepository } from "@/server/services/ai-audit-service";
import {
  MAX_CHAT_RATE_LIMIT_CHECK_MS,
  MAX_CHAT_REQUEST_BODY_READ_MS,
  MAX_CHAT_REQUEST_BYTES,
  MAX_CHAT_RESPONSE_LEASE_MS,
  MAX_CHAT_SETUP_MS,
} from "@/server/http/request-limits";
import {
  selectTrustedUserMessages,
  trustedUserPartSchema,
} from "@/server/ai/trusted-user-messages";
import {
  allowsToolFreeAttachmentResponse,
  buildDirectChatResponse,
} from "@/server/ai/chat-turn-guidance";
import { buildSalesChatEvidenceContract } from "@/server/ai/evidence-contract";
import { createPublicApiRequestObserver } from "@/server/http/public-api-response";
import { localeFromRequest, type Locale } from "@/i18n/locale";

export const runtime = "nodejs";

type SalesChatUiMessage = UIMessage<
  unknown,
  UIDataTypes,
  InferUITools<SalesChatTools>
>;

const chatMessageEnvelopeSchema = z
  .object({
    parts: z.array(z.unknown()),
    role: z.string(),
  })
  .passthrough();

const trustedUserMessageSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    parts: z.array(trustedUserPartSchema).min(1),
    role: z.literal("user"),
  })
  .strict();

function errorResponse(
  code:
    | "INVALID_INPUT"
    | "PAYLOAD_TOO_LARGE"
    | "REQUEST_TIMEOUT"
    | "AI_NOT_CONFIGURED"
    | "RATE_LIMITED"
    | "INTERNAL_ERROR",
  message: string,
  status: number,
  headers?: Record<string, string>,
): Response {
  return Response.json(
    chatApiErrorSchema.parse({
      error: { code, message },
    }),
    { headers, status },
  );
}

function directChatResponse(text: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const id = crypto.randomUUID();
      writer.write({ type: "start" });
      writer.write({ id, type: "text-start" });
      writer.write({ delta: text, id, type: "text-delta" });
      writer.write({ id, type: "text-end" });
      writer.write({ finishReason: "stop", type: "finish" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

function throwIfChatRequestAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new RequestBodyAbortedError();
  }
}

class ChatSetupTimeoutError extends Error {
  constructor() {
    super("AI chat setup exceeded its deadline.");
    this.name = "ChatSetupTimeoutError";
  }
}

type DeferredCleanupTracker = {
  begin: () => (() => void) | null;
  sealAndReleaseWhenSettled: (release: () => void) => void;
  track: (cleanup: Promise<void>) => void;
};

function createDeferredCleanupTracker(): DeferredCleanupTracker {
  let active = 0;
  let releaseCallback: (() => void) | undefined;
  let released = false;
  let sealed = false;

  const releaseIfSettled = () => {
    if (!sealed || active !== 0 || released || !releaseCallback) {
      return;
    }
    released = true;
    releaseCallback();
  };
  const begin = (): (() => void) | null => {
    if (sealed) {
      return null;
    }
    active += 1;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      active = Math.max(0, active - 1);
      releaseIfSettled();
    };
  };

  return {
    begin,
    sealAndReleaseWhenSettled(release) {
      releaseCallback ??= release;
      sealed = true;
      releaseIfSettled();
    },
    track(cleanup) {
      const finish = begin();
      if (!finish) {
        // A sealed tracker cannot retain a new lease. Still observe a cleanup
        // supplied by a buggy late caller so it cannot reject unhandled.
        void Promise.resolve(cleanup).catch(() => undefined);
        return;
      }
      void Promise.resolve(cleanup).then(finish, finish);
    },
  };
}

type ChatSetupStage =
  | "admission_budget"
  | "audit_repository"
  | "audit_session";

type ChatSetupOperationOutcome<T> =
  | { status: "completed"; value: T }
  | { error: unknown; status: "failed" };

async function runOwnedChatSetupOperation<T>(input: {
  deadlineAtMs: number;
  deferredCleanup: DeferredCleanupTracker;
  operation: () => Promise<T>;
  signal: AbortSignal;
  stage: ChatSetupStage;
}): Promise<T> {
  throwIfChatRequestAborted(input.signal);
  if (Date.now() >= input.deadlineAtMs) {
    throw new ChatSetupTimeoutError();
  }

  const finish = input.deferredCleanup.begin();
  if (!finish) {
    throw new RequestBodyAbortedError();
  }

  let operation: Promise<T>;
  try {
    // The second precheck closes the begin-to-operation boundary. No real
    // repository or SQL Promise may start without an admission-owned token.
    throwIfChatRequestAborted(input.signal);
    if (Date.now() >= input.deadlineAtMs) {
      throw new ChatSetupTimeoutError();
    }
    operation = input.operation();
  } catch (error: unknown) {
    finish();
    throw error;
  }

  const settled = Promise.resolve(operation).then<
    ChatSetupOperationOutcome<T>,
    ChatSetupOperationOutcome<T>
  >(
    (value) => ({ status: "completed", value }),
    (error: unknown) => ({ error, status: "failed" }),
  );
  void settled.then(finish);

  let abortListener: (() => void) | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const aborted = new Promise<"aborted">((resolve) => {
    abortListener = () => resolve("aborted");
    input.signal.addEventListener("abort", abortListener, { once: true });
    if (input.signal.aborted) {
      abortListener();
    }
  });
  const timedOut = new Promise<"timed_out">((resolve) => {
    timeoutId = setTimeout(
      () => resolve("timed_out"),
      Math.max(0, input.deadlineAtMs - Date.now()),
    );
  });

  let outcome: ChatSetupOperationOutcome<T> | "aborted" | "timed_out";
  try {
    outcome = await Promise.race([settled, aborted, timedOut]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (abortListener !== undefined) {
      input.signal.removeEventListener("abort", abortListener);
    }
  }

  if (outcome === "aborted" || outcome === "timed_out") {
    // Observe and safely classify a rejection that arrives after the HTTP
    // request has already failed. The token is released only by `settled`.
    void settled.then((lateOutcome) => {
      if (lateOutcome.status === "failed") {
        console.error("AI chat setup failed after request completion", {
          errorCode: getErrorCode(lateOutcome.error),
          stage: input.stage,
        });
      }
    });
    if (outcome === "aborted") {
      throw new RequestBodyAbortedError();
    }
    throw new ChatSetupTimeoutError();
  }

  if (outcome.status === "failed") {
    throw outcome.error;
  }
  return outcome.value;
}

async function processChatRequest(
  request: Request,
  requestId: string,
  requestStartedAtMs: number,
  fallbackLocale: Locale,
  clientIdentifier: string,
  abortSignal: AbortSignal,
  deferredCleanup: DeferredCleanupTracker,
): Promise<Response> {
  let locale = fallbackLocale;
  try {
    const body = chatRequestSchema.parse(
      await readJsonRequest(
        request,
        MAX_CHAT_REQUEST_BYTES,
        MAX_CHAT_REQUEST_BODY_READ_MS,
        abortSignal,
      ),
    );
    throwIfChatRequestAborted(abortSignal);
    locale = body.locale ?? fallbackLocale;
    const messageEnvelopes = z
      .array(chatMessageEnvelopeSchema)
      .parse(body.messages);
    const selectedUserMessages = selectTrustedUserMessages(messageEnvelopes);
    if (!selectedUserMessages) {
      return errorResponse(
        "INVALID_INPUT",
        locale === "en"
          ? "The chat request is invalid. Check the messages and country context."
          : "聊天请求格式无效，请检查消息和国家上下文。",
        400,
      );
    }
    const trustedUserMessages = z
      .array(trustedUserMessageSchema)
      .parse(selectedUserMessages);
    const uiMessages = await validateUIMessages<SalesChatUiMessage>({
      messages: trustedUserMessages,
    });
    const latestUserMessage = trustedUserMessages.at(-1)!;
    const hasAttachments = latestUserMessage.parts.some(
      (part) => part.type === "file",
    );
    const userTexts = trustedUserMessages.map((message) =>
      message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
    );
    const latestUserText = userTexts.at(-1)!;
    const allowUnverifiedAttachmentResponse =
      hasAttachments && allowsToolFreeAttachmentResponse(latestUserText);
    const directResponse = hasAttachments
      ? null
      : buildDirectChatResponse({
          locale,
          selectedCountryIso3: body.selectedCountryIso3,
          text: latestUserText,
          userTexts,
        });
    if (directResponse) {
      throwIfChatRequestAborted(abortSignal);
      return directChatResponse(directResponse);
    }

    try {
      validateAiChatAdmissionBudgetConfiguration();
    } catch (error: unknown) {
      console.error("AI chat admission budget configuration invalid", {
        errorCode: getErrorCode(error),
      });
      return errorResponse(
        "INTERNAL_ERROR",
        locale === "en"
          ? "The AI chat service is temporarily unavailable. Please try again later."
          : "AI 聊天服务暂时不可用，请稍后重试。",
        503,
        { "Retry-After": "60" },
      );
    }
    throwIfChatRequestAborted(abortSignal);

    const requiresMultimodalModel = latestUserMessage.parts.some(
      (part) =>
        part.type === "file" && part.mediaType.startsWith("image/"),
    );
    const { costProfile, model, modelId } = getConfiguredAiModel(undefined, {
      requiresMultimodalModel,
    });
    throwIfChatRequestAborted(abortSignal);
    const preparedUserMessages = await prepareTrustedUserMessagesForModel(
      trustedUserMessages,
      {
        beginDeferredWork: deferredCleanup.begin,
        signal: abortSignal,
        trackDeferredCleanup: deferredCleanup.track,
      },
    );
    throwIfChatRequestAborted(abortSignal);
    const setupDeadlineAtMs = Date.now() + MAX_CHAT_SETUP_MS;
    const modelUiMessages = await validateUIMessages<SalesChatUiMessage>({
      messages: preparedUserMessages.messages,
    });
    if (
      preparedUserMessages.requiresMultimodalModel !==
      requiresMultimodalModel
    ) {
      throw new ChatAttachmentProcessingError(
        "附件模型能力检查失败，请重新选择附件后再试。",
      );
    }

    let admissionDecision;
    try {
      admissionDecision = await runOwnedChatSetupOperation({
        deadlineAtMs: setupDeadlineAtMs,
        deferredCleanup,
        operation: () =>
          getAiChatAdmissionBudget().reserve(clientIdentifier),
        signal: abortSignal,
        stage: "admission_budget",
      });
    } catch (error: unknown) {
      if (
        error instanceof RequestBodyAbortedError ||
        error instanceof ChatSetupTimeoutError
      ) {
        throw error;
      }
      console.error("AI chat admission budget unavailable", {
        errorCode: getErrorCode(error),
      });
      return errorResponse(
        "INTERNAL_ERROR",
        locale === "en"
          ? "The AI chat service is temporarily unavailable. Please try again later."
          : "AI 聊天服务暂时不可用，请稍后重试。",
        503,
        { "Retry-After": "60" },
      );
    }
    if (!admissionDecision.allowed) {
      return errorResponse(
        "RATE_LIMITED",
        locale === "en"
          ? "The daily AI admission budget has been reached. Please try again after the next UTC day begins."
          : "今日 AI 准入预算已用完，请在下一个 UTC 日开始后重试。",
        429,
        { "Retry-After": String(admissionDecision.retryAfterSeconds) },
      );
    }
    throwIfChatRequestAborted(abortSignal);

    const auditRepository = await runOwnedChatSetupOperation({
      deadlineAtMs: setupDeadlineAtMs,
      deferredCleanup,
      operation: getAiAuditRepository,
      signal: abortSignal,
      stage: "audit_repository",
    });
    throwIfChatRequestAborted(abortSignal);
    const runtimeContext = captureChatRuntimeContext();
    const evidenceContract = buildSalesChatEvidenceContract({
      runtimeContext,
      selectedCountryIso3: body.selectedCountryIso3,
      userTexts,
    });
    const tools = createSalesChatTools({
      auditRepository,
      beginDeferredWork: deferredCleanup.begin,
      ...(evidenceContract.asOf ? { defaultAsOf: evidenceContract.asOf } : {}),
      runtimeContext,
      selectedCountryIso3: body.selectedCountryIso3,
      sessionId: body.sessionId,
      turnId: requestId,
    });
    await runOwnedChatSetupOperation({
      deadlineAtMs: setupDeadlineAtMs,
      deferredCleanup,
      operation: () =>
        auditRepository.ensureSession(
          {
            modelId,
            selectedCountryIso3: body.selectedCountryIso3,
            sessionId: body.sessionId,
          },
          { signal: abortSignal },
        ),
      signal: abortSignal,
      stage: "audit_session",
    });
    throwIfChatRequestAborted(abortSignal);
    const modelMessages = await convertToModelMessages(modelUiMessages, {
      tools,
    });
    throwIfChatRequestAborted(abortSignal);
    const result = streamSalesChat({
      abortSignal,
      allowUnverifiedAttachmentResponse,
      auditRepository,
      beginDeferredWork: deferredCleanup.begin,
      costProfile,
      hasUnverifiedAttachments: hasAttachments,
      messages: modelMessages,
      maxRetries: 0,
      model,
      modelId,
      requestId,
      requestStartedAtMs,
      runtimeContext,
      selectedCountryIso3: body.selectedCountryIso3,
      sessionId: body.sessionId,
      tools,
      trustedUserTexts: userTexts,
      turnId: requestId,
      locale,
    });

    return result.toUIMessageStreamResponse({
      originalMessages: uiMessages,
      onError: () =>
        locale === "en"
          ? "The AI service could not complete this answer. Tool facts will not be guessed; please try again later."
          : "AI 服务暂时无法完成回答。工具事实不会被猜测补全，请稍后重试。",
      sendReasoning: false,
    });
  } catch (error: unknown) {
    if (
      error instanceof RequestBodyAbortedError ||
      error instanceof RequestBodyTimeoutError ||
      error instanceof RequestBodyTooLargeError
    ) {
      deferredCleanup.track(error.cleanup);
    }
    if (error instanceof RequestBodyAbortedError || abortSignal.aborted) {
      return errorResponse(
        "REQUEST_TIMEOUT",
        locale === "en"
          ? "The chat request was canceled before processing completed."
          : "聊天请求已在处理完成前取消。",
        408,
      );
    }
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(
        "PAYLOAD_TOO_LARGE",
        locale === "en"
          ? "The chat request is too large. Remove attachments, reduce their size, or shorten the message history."
          : "聊天请求过大，请减少附件数量、缩小附件或缩短消息历史后重试。",
        413,
      );
    }
    if (error instanceof RequestBodyTimeoutError) {
      return errorResponse(
        "REQUEST_TIMEOUT",
        locale === "en"
          ? "The chat upload timed out. Check the connection and try again."
          : "聊天请求上传超时，请检查网络后重试。",
        408,
      );
    }
    if (error instanceof AiConfigurationError) {
      console.error("Chat AI configuration error", {
        errorCode: getErrorCode(error),
      });
      return errorResponse(
        "AI_NOT_CONFIGURED",
        locale === "en"
          ? "The AI assistant is not configured. Please try again later."
          : "AI 助手暂未启用，请稍后重试。",
        503,
      );
    }
    if (error instanceof ChatSetupTimeoutError) {
      console.error("AI chat setup timed out", {
        errorCode: "ChatSetupTimeoutError",
      });
      return errorResponse(
        "INTERNAL_ERROR",
        locale === "en"
          ? "The AI chat service is temporarily unavailable. Please try again later."
          : "AI 聊天服务暂时不可用，请稍后重试。",
        503,
        { "Retry-After": String(Math.ceil(MAX_CHAT_SETUP_MS / 1_000)) },
      );
    }
    if (error instanceof ChatAttachmentProcessingError) {
      return errorResponse(
        "INVALID_INPUT",
        locale === "en"
          ? "The attachment could not be processed. Check the file and try again."
          : error.publicMessage,
        400,
      );
    }
    if (
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      InvalidArgumentError.isInstance(error) ||
      TypeValidationError.isInstance(error) ||
      MessageConversionError.isInstance(error)
    ) {
      return errorResponse(
        "INVALID_INPUT",
        locale === "en"
          ? "The chat request is invalid. Check the messages and country context."
          : "聊天请求格式无效，请检查消息和国家上下文。",
        400,
      );
    }

    console.error("Chat request failed", {
      errorCode: getErrorCode(error),
    });
    return errorResponse(
      "INTERNAL_ERROR",
      locale === "en"
        ? "The chat service is temporarily unavailable. Please try again later."
        : "聊天服务暂时不可用，请稍后重试。",
      500,
    );
  }
}

function holdLeaseUntilResponseCompletes(
  response: Response,
  release: () => void,
  abortModel: (reason: unknown) => void,
  disposeAbortBridge: () => void,
  trackDeferredCleanup: (cleanup: Promise<void>) => void,
): Response {
  if (!response.body || response.status >= 400) {
    disposeAbortBridge();
    release();
    return response;
  }

  const reader = response.body.getReader();
  let finished = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const finish = (): boolean => {
    if (finished) {
      return false;
    }
    finished = true;
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    disposeAbortBridge();
    release();
    return true;
  };
  const body = new ReadableStream<Uint8Array>({
    async cancel(reason: unknown) {
      abortModel(reason);
      const cancellation = reader.cancel(reason);
      trackDeferredCleanup(cancellation);
      // Seal immediately after aborting so no provider callback can start new
      // tool or audit work while reader cancellation is still pending.
      finish();
      await cancellation;
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error: unknown) {
        abortModel(error);
        if (finish()) {
          controller.error(error);
        }
      }
    },
    start(controller) {
      timeoutId = setTimeout(() => {
        abortModel("chat-response-timeout");
        const cancellation = Promise.resolve()
          .then(() => reader.cancel("chat-response-timeout"))
          .then(
            () => undefined,
            () => undefined,
          );
        trackDeferredCleanup(cancellation);
        if (finish()) {
          controller.error(new Error("Chat response exceeded its lifetime."));
        }
      }, MAX_CHAT_RESPONSE_LEASE_MS);
    },
  });

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

type RateLimitCheckResult =
  | { decision: RateLimitDecision; status: "completed" }
  | { error: unknown; status: "failed" }
  | { status: "aborted" }
  | { status: "timed_out" };

async function waitForRateLimitCheck(
  check: Promise<RateLimitDecision>,
  signal: AbortSignal,
): Promise<RateLimitCheckResult> {
  if (signal.aborted) {
    return { status: "aborted" };
  }

  let abortListener: (() => void) | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const settledCheck = check.then<
    RateLimitCheckResult,
    RateLimitCheckResult
  >(
    (decision) => ({ decision, status: "completed" }),
    (error: unknown) => ({ error, status: "failed" }),
  );
  const aborted = new Promise<RateLimitCheckResult>((resolve) => {
    abortListener = () => resolve({ status: "aborted" });
    signal.addEventListener("abort", abortListener, { once: true });
    if (signal.aborted) {
      abortListener();
    }
  });
  const timedOut = new Promise<RateLimitCheckResult>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({ status: "timed_out" }),
      MAX_CHAT_RATE_LIMIT_CHECK_MS,
    );
  });

  try {
    return await Promise.race([settledCheck, aborted, timedOut]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (abortListener) {
      signal.removeEventListener("abort", abortListener);
    }
  }
}

function releaseLeaseWhenRateLimitCheckSettles(
  check: Promise<RateLimitDecision>,
  release: () => void,
): void {
  void check.then(
    () => release(),
    (error: unknown) => {
      console.error("AI chat rate limiter failed after request completion", {
        errorCode: getErrorCode(error),
      });
      release();
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  const requestLocale = localeFromRequest(request);
  const observer = createPublicApiRequestObserver("/api/chat");
  const { requestId } = observer;
  const respond = (response: Response, errorCode?: string | null) =>
    observer.finish(response, errorCode);
  const clientIdentifier = extractClientIdentifier(request.headers);

  // Admission must happen before any database work. A degraded shared limiter
  // can otherwise consume the entire connection pool outside this bound.
  const lease = getAiChatInFlightGate().tryAcquire(clientIdentifier);
  if (!lease) {
    return respond(errorResponse(
      "RATE_LIMITED",
      requestLocale === "en"
        ? "Too many AI chat requests are in flight. Wait for the current request to finish and retry."
        : "AI 聊天并发请求过多，请等待当前请求完成后重试。",
      429,
      { "Retry-After": "1" },
    ), "RATE_LIMITED");
  }

  const modelAbortController = new AbortController();
  const abortModel = (reason: unknown) => {
    if (!modelAbortController.signal.aborted) {
      modelAbortController.abort(reason);
    }
  };
  const abortFromRequest = () => abortModel(request.signal.reason);
  let requestAbortListenerAttached = false;
  if (request.signal.aborted) {
    abortFromRequest();
  } else {
    request.signal.addEventListener("abort", abortFromRequest, { once: true });
    requestAbortListenerAttached = true;
  }
  const disposeAbortBridge = () => {
    if (!requestAbortListenerAttached) {
      return;
    }
    requestAbortListenerAttached = false;
    request.signal.removeEventListener("abort", abortFromRequest);
  };

  let rateLimitCheck: Promise<RateLimitDecision>;
  try {
    rateLimitCheck = getAiChatRateLimiter().check(clientIdentifier);
  } catch (error: unknown) {
    disposeAbortBridge();
    lease.release();
    console.error("AI chat rate limiter unavailable", {
      errorCode: getErrorCode(error),
    });
    return respond(errorResponse(
      "INTERNAL_ERROR",
      requestLocale === "en"
        ? "The AI chat service is temporarily unavailable. Please try again later."
        : "AI 聊天服务暂时不可用，请稍后重试。",
      503,
      { "Retry-After": "60" },
    ), "RATE_LIMIT_UNAVAILABLE");
  }

  const rateLimitResult = await waitForRateLimitCheck(
    rateLimitCheck,
    request.signal,
  );
  if (
    rateLimitResult.status === "aborted" ||
    rateLimitResult.status === "timed_out"
  ) {
    disposeAbortBridge();
    // The driver operation is not safely cancellable. Keep the admission slot
    // until it settles so repeated timeouts cannot accumulate database work.
    releaseLeaseWhenRateLimitCheckSettles(rateLimitCheck, lease.release);
    if (rateLimitResult.status === "aborted") {
      return respond(errorResponse(
        "REQUEST_TIMEOUT",
        requestLocale === "en"
          ? "The chat request was canceled before processing completed."
          : "聊天请求已在处理完成前取消。",
        408,
      ), "REQUEST_ABORTED");
    }
    return respond(errorResponse(
      "INTERNAL_ERROR",
      requestLocale === "en"
        ? "The AI chat service is temporarily unavailable. Please try again later."
        : "AI 聊天服务暂时不可用，请稍后重试。",
      503,
      { "Retry-After": "60" },
    ), "RATE_LIMIT_TIMEOUT");
  }

  if (rateLimitResult.status === "failed") {
    disposeAbortBridge();
    lease.release();
    console.error("AI chat rate limiter unavailable", {
      errorCode: getErrorCode(rateLimitResult.error),
    });
    return respond(errorResponse(
      "INTERNAL_ERROR",
      requestLocale === "en"
        ? "The AI chat service is temporarily unavailable. Please try again later."
        : "AI 聊天服务暂时不可用，请稍后重试。",
      503,
      { "Retry-After": "60" },
    ), "RATE_LIMIT_UNAVAILABLE");
  }

  const rateDecision = rateLimitResult.decision;
  if (!rateDecision.allowed) {
    disposeAbortBridge();
    lease.release();
    return respond(errorResponse(
      "RATE_LIMITED",
      requestLocale === "en"
        ? "AI chat requests are arriving too quickly. Please try again later."
        : "AI 聊天请求过于频繁，请稍后重试。",
      429,
      {
        "Retry-After": String(rateDecision.retryAfterSeconds),
      },
    ), "RATE_LIMITED");
  }

  if (request.signal.aborted) {
    disposeAbortBridge();
    lease.release();
    return respond(errorResponse(
      "REQUEST_TIMEOUT",
      requestLocale === "en"
        ? "The chat request was canceled before processing completed."
        : "聊天请求已在处理完成前取消。",
      408,
    ), "REQUEST_ABORTED");
  }

  const deferredCleanup = createDeferredCleanupTracker();
  const releaseAfterDeferredCleanup = () =>
    deferredCleanup.sealAndReleaseWhenSettled(lease.release);

  try {
    return respond(
      holdLeaseUntilResponseCompletes(
        await processChatRequest(
          request,
          requestId,
          observer.startedAtMs,
          requestLocale,
          clientIdentifier,
          modelAbortController.signal,
          deferredCleanup,
        ),
        releaseAfterDeferredCleanup,
        abortModel,
        disposeAbortBridge,
        deferredCleanup.track,
      ),
    );
  } catch (error: unknown) {
    abortModel(error);
    disposeAbortBridge();
    releaseAfterDeferredCleanup();
    throw error;
  }
}
