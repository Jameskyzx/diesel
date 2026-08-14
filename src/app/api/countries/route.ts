import { NextResponse } from "next/server";

import { countryApiErrorSchema } from "@/features/countries/schemas";
import { getErrorCode } from "@/lib/api-error";
import { listCountryMapSummaries } from "@/server/services/country-service";
import { createApiRequestObserver } from "@/server/observability/structured-log";

export const runtime = "nodejs";

export async function GET() {
  const observer = createApiRequestObserver("/api/countries");
  try {
    return observer.finish(
      NextResponse.json(await listCountryMapSummaries()),
    );
  } catch (error) {
    console.error("Country summary request failed", {
      errorCode: getErrorCode(error),
    });
    const response = countryApiErrorSchema.parse({
      error: {
        code: "INTERNAL_ERROR",
        message: "国家摘要暂时不可用，请稍后重试。",
      },
    });

    return observer.finish(
      NextResponse.json(response, { status: 500 }),
      "INTERNAL_ERROR",
    );
  }
}
