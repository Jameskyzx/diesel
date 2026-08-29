import { NextResponse } from "next/server";

import { countryApiErrorSchema } from "@/features/countries/schemas";
import { getErrorCode } from "@/lib/api-error";
import { getDictionary } from "@/i18n/dictionaries";
import { localeFromRequest } from "@/i18n/locale";
import { listCountryMapSummaries } from "@/server/services/country-service";
import { createApiRequestObserver } from "@/server/observability/structured-log";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const observer = createApiRequestObserver("/api/countries");
  const messages = getDictionary(localeFromRequest(request)).apiErrors;
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
        message: messages.countrySummariesUnavailable,
      },
    });

    return observer.finish(
      NextResponse.json(response, { status: 500 }),
      "INTERNAL_ERROR",
    );
  }
}
