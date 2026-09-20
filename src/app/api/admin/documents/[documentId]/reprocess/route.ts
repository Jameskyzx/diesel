import { NextResponse } from "next/server";

import {
  handleAdminRoute,
  readAdminFormDataRequest,
} from "@/server/http/admin-route";
import {
  parseDocumentReprocessFormData,
} from "@/server/services/knowledge-service";
import { reprocessGovernedDocument } from "@/server/services/governance-service";
import { MAX_DOCUMENT_REPROCESS_REQUEST_BYTES } from "@/server/http/request-limits";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  return handleAdminRoute(
    request,
    "editor",
    "/api/admin/documents/:documentId/reprocess",
    async (principal) => {
      const { documentId } = await context.params;
      const formData = await readAdminFormDataRequest(
        request,
        MAX_DOCUMENT_REPROCESS_REQUEST_BYTES,
      );

      const result = await reprocessGovernedDocument({
        actor: principal,
        documentId,
        metadata: parseDocumentReprocessFormData(formData),
        reason: formData.get("reason"),
      });

      return NextResponse.json({ status: result.status });
    },
  );
}
