import { NextResponse } from "next/server";

import { feedbackQuerySchema } from "@/features/feedback/schemas";
import { handleAdminRoute } from "@/server/http/admin-route";
import { listAdminFeedback } from "@/server/services/feedback-read-service";

export const runtime = "nodejs";

/** Internal list of every published feedback record, real and demo. */
export async function GET(request: Request): Promise<Response> {
  return handleAdminRoute(request, "editor", "/api/admin/feedback", async (principal) => {
    const params = new URL(request.url).searchParams;
    const query = feedbackQuerySchema.parse(Object.fromEntries(
      ["modelCode", "category", "countryIso3", "severity"].flatMap(key => params.get(key) ? [[key, params.get(key)]] : []),
    ));
    return NextResponse.json({ records: await listAdminFeedback(query, principal), status: "ok" });
  });
}
