import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  documentImportResponseSchema,
  knowledgeApiErrorSchema,
} from "@/features/knowledge/schemas";
import { getErrorCode } from "@/lib/api-error";
import {
  importKnowledgeDocument,
  isKnowledgeDebugEnabled,
  KnowledgeInputError,
  parseDocumentImportFormData,
} from "@/server/services/knowledge-service";
import {
  readFormDataRequest,
  RequestBodyTooLargeError,
} from "@/server/http/request-body";
import { MAX_KNOWLEDGE_IMPORT_REQUEST_BYTES } from "@/server/http/request-limits";

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
    const formData = await readFormDataRequest(
      request,
      MAX_KNOWLEDGE_IMPORT_REQUEST_BYTES,
    );
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        knowledgeApiErrorSchema.parse({
          error: {
            code: "INVALID_INPUT",
            message: "请选择需要导入的文件。",
          },
        }),
        { status: 400 },
      );
    }

    const response = await importKnowledgeDocument({
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      governanceStatus: "published",
      metadata: parseDocumentImportFormData(formData),
      mimeType: file.type,
    });

    return NextResponse.json(documentImportResponseSchema.parse(response));
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        knowledgeApiErrorSchema.parse({
          error: {
            code: "FILE_TOO_LARGE",
            message: "上传请求不得超过 6 MiB。",
          },
        }),
        { status: 413 },
      );
    }
    if (error instanceof KnowledgeInputError) {
      return NextResponse.json(
        knowledgeApiErrorSchema.parse({
          error: {
            code: error.code,
            message: error.message,
          },
        }),
        { status: error.code === "FILE_TOO_LARGE" ? 413 : 400 },
      );
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        knowledgeApiErrorSchema.parse({
          error: {
            code: "INVALID_INPUT",
            message: "文档 metadata 无效，请检查来源、日期和过滤字段。",
          },
        }),
        { status: 400 },
      );
    }

    console.error("Knowledge import route failed", {
      errorCode: getErrorCode(error),
    });
    return NextResponse.json(
      knowledgeApiErrorSchema.parse({
        error: {
          code: "INTERNAL_ERROR",
          message: "文档导入暂时不可用。",
        },
      }),
      { status: 500 },
    );
  }
}
