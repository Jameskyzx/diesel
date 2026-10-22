import { NextResponse } from "next/server";

import { feedbackToCsv } from "@/domain/feedback/summarize";
import { feedbackQuerySchema } from "@/features/feedback/schemas";
import { getErrorCode } from "@/lib/api-error";
import { createPublicApiRequestObserver } from "@/server/http/public-api-response";
import { runPublicDataOperation } from "@/server/http/public-data-admission";
import { listPublicFeedback } from "@/server/services/feedback-read-service";

export const runtime = "nodejs";

/** Public export of fictional demo feedback as JSON or CSV. */
export async function GET(request: Request) {
  const observer = createPublicApiRequestObserver("/api/product-feedback");
  const params = new URL(request.url).searchParams;
  const format = params.get("format") ?? "json";
  const parsed = feedbackQuerySchema.safeParse(Object.fromEntries(
    ["modelCode", "category", "countryIso3", "severity"].flatMap(key => params.get(key) ? [[key, params.get(key)]] : []),
  ));
  if (!parsed.success || !["json", "csv"].includes(format)) {
    return observer.finish(NextResponse.json({ error: "INVALID_FEEDBACK_QUERY" }, { status: 400 }), "INVALID_INPUT");
  }
  try {
    const operation = await runPublicDataOperation({ request, route: "/api/product-feedback",
      work: signal => listPublicFeedback(parsed.data, { signal }) });
    if (operation.status === "failed") throw operation.error;
    if (operation.status !== "fulfilled") {
      return observer.finish(NextResponse.json({ error: "FEEDBACK_UNAVAILABLE" }, { headers: { "Retry-After": "1" }, status: 503 }), "INTERNAL_ERROR");
    }
    const name = `feedback-${parsed.data.modelCode ?? "all"}`.replace(/[^A-Za-z0-9-]/gu, "_");
    if (format === "csv") {
      return observer.finish(new NextResponse(feedbackToCsv(operation.value), { headers: {
        "Content-Disposition": `attachment; filename="${name}.csv"`, "Content-Type": "text/csv; charset=utf-8",
      } }));
    }
    return observer.finish(NextResponse.json({ isDemo: true, records: operation.value, total: operation.value.length }, {
      headers: { "Content-Disposition": `attachment; filename="${name}.json"` },
    }));
  } catch (error) {
    console.error("Feedback export failed", { errorCode: getErrorCode(error) });
    return observer.finish(NextResponse.json({ error: "FEEDBACK_UNAVAILABLE" }, { status: 500 }), "INTERNAL_ERROR");
  }
}
