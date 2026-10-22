import { NextResponse } from "next/server";

import { handleAdminRoute, readAdminFormDataRequest } from "@/server/http/admin-route";
import { extractEngineFeedback, MAX_FEEDBACK_UPLOAD_REQUEST_BYTES } from "@/server/services/feedback-service";

export const runtime = "nodejs";

/** AI-drafts feedback from uploads or pasted text; writes a preview batch only. */
export async function POST(request: Request): Promise<Response> {
  return handleAdminRoute(request, "editor", "/api/admin/feedback/extract", async (principal) => {
    const formData = await readAdminFormDataRequest(request, MAX_FEEDBACK_UPLOAD_REQUEST_BYTES);
    const files = await Promise.all(formData.getAll("file")
      .filter((value): value is File => value instanceof File && value.size > 0)
      .map(async file => ({ bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, type: file.type })));
    const text = formData.get("text");
    const sourceKind = formData.get("sourceKind");
    return NextResponse.json(await extractEngineFeedback({
      files,
      sourceKind: typeof sourceKind === "string" && sourceKind ? sourceKind : null,
      text: typeof text === "string" ? text : null,
    }, principal, { signal: request.signal }));
  });
}
