import { NextResponse } from "next/server";
import { catalogQuerySchema } from "@/features/product-catalog/schemas";
import { searchProductCatalog } from "@/server/services/product-catalog";
import { createPublicApiRequestObserver } from "@/server/http/public-api-response";

export function GET(request: Request) {
  const observer = createPublicApiRequestObserver("/api/product-catalog");
  const params = new URL(request.url).searchParams;
  const input: Record<string, unknown> = Object.fromEntries(params);
  for (const key of ["minPowerKw", "maxPowerKw", "offset", "limit"]) if (key in input) input[key] = input[key] === "" ? undefined : Number(input[key]);
  if (params.has("recordIds")) input.recordIds = params.getAll("recordIds");
  const parsed = catalogQuerySchema.safeParse(input);
  if (!parsed.success) return observer.finish(NextResponse.json({ error: "INVALID_CATALOG_QUERY" }, { status: 400 }), "INVALID_INPUT");
  return observer.finish(NextResponse.json(searchProductCatalog(parsed.data)));
}
