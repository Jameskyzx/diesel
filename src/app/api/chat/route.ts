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
} from "@/server/http/rate-limit";
import {
  readJsonRequest,
  RequestBodyTooLargeError,
  RequestBodyTimeoutError,
} from "@/server/http/request-body";
import { getAiAuditRepository } from "@/server/services/ai-audit-service";
import {
  MAX_CHAT_REQUEST_BODY_READ_MS,
  MAX_CHAT_REQUEST_BYTES,
  MAX_CHAT_RESPONSE_LEASE_MS,
} from "@/server/http/request-limits";
import {
  selectTrustedUserMessages,
  trustedUserPartSchema,
} from "@/server/ai/trusted-user-messages";
import {
  allowsToolFreeAttachmentResponse,
  buildDirectChatResponse,
} from "@/server/ai/chat-turn-guidance";
import { createApiRequestObserver } from "@/server/observability/structured-log";

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
      writer.write({ id, type: "text-start" });
      writer.write({ delta: text, id, type: "text-delta" });
      writer.write({ id, type: "text-end" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

async function processChatRequest(
  request: Request,
  requestId: string,
  requestStartedAtMs: number,
): Promise<Response> {
  try {
    const body = chatRequestSchema.parse(
      await readJsonRequest(
        request,
        MAX_CHAT_REQUEST_BYTES,
        MAX_CHAT_REQUEST_BODY_READ_MS,
      ),
    );
    const messageEnvelopes = z
      .array(chatMessageEnvelopeSchema)
      .parse(body.messages);
    const selectedUserMessages = selectTrustedUserMessages(messageEnvelopes);
    if (!selectedUserMessages) {
      return errorResponse(
        "INVALID_INPUT",
        "聊天请求格式无效，请检查消息和国家上下文。",
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
          selectedCountryIso3: body.selectedCountryIso3,
          text: latestUserText,
          userTexts,
        });
    if (directResponse) {
      return directChatResponse(directResponse);
    }

    const requiresMultimodalModel = latestUserMessage.parts.some(
      (part) =>
        part.type === "file" && part.mediaType.startsWith("image/"),
    );
    const { model, modelId } = getConfiguredAiModel(undefined, {
      requiresMultimodalModel,
    });
    const preparedUserMessages = await prepareTrustedUserMessagesForModel(
      trustedUserMessages,
    );
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
    const auditRepository = await getAiAuditRepository();
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: body.selectedCountryIso3,
      sessionId: body.sessionId,
      turnId: requestId,
    });
    await auditRepository.ensureSession({
      modelId,
      selectedCountryIso3: body.selectedCountryIso3,
      sessionId: body.sessionId,
    });
    const result = streamSalesChat({
      allowUnverifiedAttachmentResponse,
      auditRepository,
      hasUnverifiedAttachments: hasAttachments,
      messages: await convertToModelMessages(modelUiMessages, { tools }),
      model,
      modelId,
      requestId,
      requestStartedAtMs,
      selectedCountryIso3: body.selectedCountryIso3,
      sessionId: body.sessionId,
      tools,
      trustedUserTexts: userTexts,
      turnId: requestId,
    });

    return result.toUIMessageStreamResponse({
      originalMessages: uiMessages,
      onError: () =>
        "AI 服务暂时无法完成回答。工具事实不会被猜测补全，请稍后重试。",
    });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(
        "PAYLOAD_TOO_LARGE",
        "聊天请求过大，请减少附件数量、缩小附件或缩短消息历史后重试。",
        413,
      );
    }
    if (error instanceof RequestBodyTimeoutError) {
      return errorResponse(
        "REQUEST_TIMEOUT",
        "聊天请求上传超时，请检查网络后重试。",
        408,
      );
    }
    if (error instanceof AiConfigurationError) {
      console.error("Chat AI configuration error", {
        errorCode: getErrorCode(error),
      });
      return errorResponse(
        "AI_NOT_CONFIGURED",
        "AI 助手暂未启用，请稍后重试。",
        503,
      );
    }
    if (error instanceof ChatAttachmentProcessingError) {
      return errorResponse(
        "INVALID_INPUT",
        error.publicMessage,
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
        "聊天请求格式无效，请检查消息和国家上下文。",
        400,
      );
    }

    console.error("Chat request failed", {
      errorCode: getErrorCode(error),
    });
    return errorResponse(
      "INTERNAL_ERROR",
      "聊天服务暂时不可用，请稍后重试。",
      500,
    );
  }
}

function holdLeaseUntilResponseCompletes(
  response: Response,
  release: () => void,
): Response {
  if (!response.body || response.status >= 400) {
    release();
    return response;
  }

  const reader = response.body.getReader();
  let finished = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (finished) {
      return;
    }
    finished = true;
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    release();
  };
  const body = new ReadableStream<Uint8Array>({
    async cancel(reason: unknown) {
      try {
        await reader.cancel(reason);
      } finally {
        finish();
      }
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
        finish();
        controller.error(error);
      }
    },
    start(controller) {
      timeoutId = setTimeout(() => {
        void reader.cancel("chat-response-timeout").catch(() => undefined);
        finish();
        controller.error(new Error("Chat response exceeded its lifetime."));
      }, MAX_CHAT_RESPONSE_LEASE_MS);
    },
  });

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export async function POST(request: Request): Promise<Response> {
  const observer = createApiRequestObserver("/api/chat");
  const { requestId } = observer;
  const respond = (response: Response, errorCode?: string | null) =>
    observer.finish(response, errorCode);
  const clientIdentifier = extractClientIdentifier(request.headers);
  let rateDecision;
  try {
    rateDecision = await getAiChatRateLimiter().check(clientIdentifier);
  } catch (error: unknown) {
    console.error("AI chat rate limiter unavailable", {
      errorCode: getErrorCode(error),
    });
    return respond(errorResponse(
      "INTERNAL_ERROR",
      "AI 聊天服务暂时不可用，请稍后重试。",
      503,
      { "Retry-After": "60" },
    ), "RATE_LIMIT_UNAVAILABLE");
  }
  if (!rateDecision.allowed) {
    return respond(errorResponse(
      "RATE_LIMITED",
      "AI 聊天请求过于频繁，请稍后重试。",
      429,
      {
        "Retry-After": String(rateDecision.retryAfterSeconds),
      },
    ), "RATE_LIMITED");
  }

  const lease = getAiChatInFlightGate().tryAcquire(clientIdentifier);
  if (!lease) {
    return respond(errorResponse(
      "RATE_LIMITED",
      "AI 聊天并发请求过多，请等待当前请求完成后重试。",
      429,
      { "Retry-After": "1" },
    ), "RATE_LIMITED");
  }

  try {
    return respond(
      holdLeaseUntilResponseCompletes(
        await processChatRequest(request, requestId, observer.startedAtMs),
        lease.release,
      ),
    );
  } catch (error: unknown) {
    lease.release();
    throw error;
  }
}
