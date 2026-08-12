import { NextResponse } from "next/server";

import {
  knowledgeApiErrorSchema,
  knowledgeOptionsResponseSchema,
} from "@/features/knowledge/schemas";
import { getErrorCode } from "@/lib/api-error";
import {
  getKnowledgeOptions,
  isKnowledgeDebugEnabled,
} from "@/server/services/knowledge-service";

export const runtime = "nodejs";

export async function GET() {
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
    return NextResponse.json(
      knowledgeOptionsResponseSchema.parse(await getKnowledgeOptions()),
    );
  } catch (error: unknown) {
    console.error("Knowledge options route failed", {
      errorCode: getErrorCode(error),
    });
    return NextResponse.json(
      knowledgeApiErrorSchema.parse({
        error: {
          code: "INTERNAL_ERROR",
          message: "知识库调试选项暂时不可用。",
        },
      }),
      { status: 500 },
    );
  }
}
