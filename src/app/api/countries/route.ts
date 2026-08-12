import { NextResponse } from "next/server";

import { countryApiErrorSchema } from "@/features/countries/schemas";
import { getErrorCode } from "@/lib/api-error";
import { listCountryMapSummaries } from "@/server/services/country-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listCountryMapSummaries());
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

    return NextResponse.json(response, { status: 500 });
  }
}
