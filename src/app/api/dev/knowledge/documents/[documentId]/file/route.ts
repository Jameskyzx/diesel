import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { knowledgeApiErrorSchema } from "@/features/knowledge/schemas";
import { getErrorCode } from "@/lib/api-error";
import {
  getKnowledgeDocumentFile,
  isKnowledgeDebugEnabled,
} from "@/server/services/knowledge-service";

export const runtime = "nodejs";

type DocumentFileRouteContext = {
  params: Promise<{
    documentId: string;
  }>;
};

export async function GET(
  _request: Request,
  context: DocumentFileRouteContext,
) {
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
    const { documentId } = z
      .object({ documentId: z.uuid() })
      .strict()
      .parse(await context.params);
    const file = await getKnowledgeDocumentFile({ documentId });

    if (!file) {
      return NextResponse.json(
        knowledgeApiErrorSchema.parse({
          error: {
            code: "NOT_FOUND",
            message: "原始文件不存在或未保存。",
          },
        }),
        { status: 404 },
      );
    }

    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "content-type": file.mimeType,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        knowledgeApiErrorSchema.parse({
          error: {
            code: "INVALID_INPUT",
            message: "文档 ID 无效。",
          },
        }),
        { status: 400 },
      );
    }

    console.error("Knowledge download route failed", {
      errorCode: getErrorCode(error),
    });
    return NextResponse.json(
      knowledgeApiErrorSchema.parse({
        error: {
          code: "INTERNAL_ERROR",
          message: "原始文件暂时无法读取。",
        },
      }),
      { status: 500 },
    );
  }
}
