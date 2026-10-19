import { NextResponse } from "next/server";
import { catalogQuerySchema } from "@/features/product-catalog/schemas";
import { getErrorCode } from "@/lib/api-error";
import { searchProductCatalog } from "@/server/services/product-catalog";
import { createPublicApiRequestObserver } from "@/server/http/public-api-response";
import { runPublicDataOperation } from "@/server/http/public-data-admission";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const observer = createPublicApiRequestObserver("/api/product-catalog");
  const params = new URL(request.url).searchParams;
  const input: Record<string, unknown> = Object.fromEntries(params);
  for (const key of ["minPowerKw", "maxPowerKw", "offset", "limit"]) if (key in input) input[key] = input[key] === "" ? undefined : Number(input[key]);
  if (params.has("recordIds")) input.recordIds = params.getAll("recordIds");
  const parsed = catalogQuerySchema.safeParse(input);
  if (!parsed.success) return observer.finish(NextResponse.json({ error: "INVALID_CATALOG_QUERY" }, { status: 400 }), "INVALID_INPUT");
  try {
    const operation = await runPublicDataOperation({ request, route: "/api/product-catalog",
      work: signal => searchProductCatalog(parsed.data, { signal }) });
    if (operation.status === "fulfilled") return observer.finish(NextResponse.json(operation.value));
    if (operation.status === "failed") throw operation.error;
    return observer.finish(NextResponse.json({ error: "CATALOG_UNAVAILABLE" }, { headers: { "Retry-After": "1" }, status: 503 }), "INTERNAL_ERROR");
  } catch (error) {
    console.error("Catalogue search failed", { errorCode: getErrorCode(error) });
    return observer.finish(NextResponse.json({ error: "CATALOG_UNAVAILABLE" }, { status: 500 }), "INTERNAL_ERROR");
  }
}
