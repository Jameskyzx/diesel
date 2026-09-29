import { NextResponse } from "next/server";

import { countryApiErrorSchema } from "@/features/countries/schemas";
import { getErrorCode } from "@/lib/api-error";
import { getDictionary } from "@/i18n/dictionaries";
import { localeFromRequest } from "@/i18n/locale";
import { listCountryMapSummaries } from "@/server/services/country-service";
import { createPublicApiRequestObserver } from "@/server/http/public-api-response";
import { runPublicDataOperation } from "@/server/http/public-data-admission";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const observer = createPublicApiRequestObserver("/api/countries");
  const messages = getDictionary(localeFromRequest(request)).apiErrors;
  try {
    const operation = await runPublicDataOperation({
      request,
      route: "/api/countries",
      work: (signal) => listCountryMapSummaries({ signal }),
    });
    if (operation.status === "failed") {
      throw operation.error;
    }
    if (operation.status !== "fulfilled") {
      const response = countryApiErrorSchema.parse({
        error: {
          code: "INTERNAL_ERROR",
          message: messages.countrySummariesUnavailable,
        },
      });
      return observer.finish(
        NextResponse.json(response, {
          headers: { "Retry-After": "1" },
          status: 503,
        }),
        "INTERNAL_ERROR",
      );
    }

    return observer.finish(
      NextResponse.json(operation.value),
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
