import { NextResponse } from "next/server";

import { handleAdminRoute, readAdminJsonRequest } from "@/server/http/admin-route";
import { confirmEngineFeedback } from "@/server/services/feedback-service";

export const runtime = "nodejs";

/** Saves the items a person checked as drafts, or publishes them at once. */
export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }): Promise<Response> {
  return handleAdminRoute(request, "editor", "/api/admin/feedback/batches/:batchId/confirm", async (principal) => {
    const { batchId } = await context.params;
    return NextResponse.json(await confirmEngineFeedback({ batchId, request: await readAdminJsonRequest(request) }, principal));
  });
}
