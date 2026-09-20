import { NextResponse } from "next/server";

import {
  handleAdminRoute,
  readAdminFormDataRequest,
} from "@/server/http/admin-route";
import { parseDocumentImportFormData } from "@/server/services/knowledge-service";
import { uploadGovernedDocument } from "@/server/services/governance-service";
import { MAX_DOCUMENT_UPLOAD_REQUEST_BYTES } from "@/server/http/request-limits";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleAdminRoute(
    request,
    "editor",
    "/api/admin/documents",
    async (principal) => {
      const formData = await readAdminFormDataRequest(
        request,
        MAX_DOCUMENT_UPLOAD_REQUEST_BYTES,
      );
      const file = formData.get("file");
      const changeReason = formData.get("changeReason");

      if (!(file instanceof File) || typeof changeReason !== "string") {
        return NextResponse.json(
          {
            error: {
              code: "INVALID_INPUT",
              message: "文件和变更原因均为必填。",
            },
          },
          { status: 400 },
        );
      }

      const result = await uploadGovernedDocument({
        actor: principal,
        bytes: new Uint8Array(await file.arrayBuffer()),
        changeReason,
        fileName: file.name,
        metadata: parseDocumentImportFormData(formData),
        mimeType: file.type,
      });

      return NextResponse.json(
        {
          draftCreated: result.draft !== null,
          status: result.import.status,
        },
        { status: 201 },
      );
    },
  );
}
