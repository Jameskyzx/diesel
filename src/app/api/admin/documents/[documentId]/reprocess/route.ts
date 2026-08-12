import { NextResponse } from "next/server";

import { handleAdminRoute } from "@/server/http/admin-route";
import { readFormDataRequest } from "@/server/http/request-body";
import {
  parseDocumentImportFormData,
} from "@/server/services/knowledge-service";
import { reprocessGovernedDocument } from "@/server/services/governance-service";
import { MAX_DOCUMENT_REPROCESS_REQUEST_BYTES } from "@/server/http/request-limits";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  return handleAdminRoute(request, "editor", async (principal) => {
    const { documentId } = await context.params;
    const formData = await readFormDataRequest(
      request,
      MAX_DOCUMENT_REPROCESS_REQUEST_BYTES,
    );

    return NextResponse.json(
      await reprocessGovernedDocument({
        actor: principal,
        documentId,
        metadata: parseDocumentImportFormData(formData),
        reason: formData.get("reason"),
      }),
    );
  });
}
