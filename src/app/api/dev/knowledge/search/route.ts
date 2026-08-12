import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  hybridSearchResponseSchema,
  knowledgeApiErrorSchema,
} from "@/features/knowledge/schemas";
import { getErrorCode } from "@/lib/api-error";
import {
  hybridSearchKnowledge,
  isKnowledgeDebugEnabled,
} from "@/server/services/knowledge-service";
import {
  readJsonRequest,
  RequestBodyTooLargeError,
} from "@/server/http/request-body";
import { MAX_KNOWLEDGE_SEARCH_REQUEST_BYTES } from "@/server/http/request-limits";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isKnowledgeDebugEnabled()) {
    return NextResponse.json(
      knowledgeApiErrorSchema.parse({
        error: {
          code: "DEVELOPER_ONLY",
          message: "知识库调试接口仅在开发环境开放。",
        },
      }),
      { status: 404 },
    );
  }

  try {
    const input = await readJsonRequest(
      request,
      MAX_KNOWLEDGE_SEARCH_REQUEST_BYTES,
    );
    return NextResponse.json(
      hybridSearchResponseSchema.parse(await hybridSearchKnowledge(input)),
    );
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        knowledgeApiErrorSchema.parse({
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "检索请求过大，请缩小请求后重试。",
          },
        }),
        { status: 413 },
      );
    }
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        knowledgeApiErrorSchema.parse({
          error: {
            code: "INVALID_INPUT",
            message: "检索文本或 metadata filter 无效。",
          },
        }),
        { status: 400 },
      );
    }

    console.error("Knowledge search route failed", {
      errorCode: getErrorCode(error),
    });
    return NextResponse.json(
      knowledgeApiErrorSchema.parse({
        error: {
          code: "INTERNAL_ERROR",
          message: "混合检索暂时不可用。",
        },
      }),
      { status: 500 },
    );
  }
}
