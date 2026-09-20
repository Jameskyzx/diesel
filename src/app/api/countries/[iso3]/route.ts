import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { countryApiErrorSchema } from "@/features/countries/schemas";
import {
  countryDetailQuerySchema,
  type CountryDetailQuery,
} from "@/features/database/schemas";
import { getErrorCode } from "@/lib/api-error";
import { getDictionary, type Dictionary } from "@/i18n/dictionaries";
import { localeFromRequest } from "@/i18n/locale";
import { isKnownCountryIso3 } from "@/server/services/country-directory";
import { getCountryDetails } from "@/server/services/country-service";
import { createPublicApiRequestObserver } from "@/server/http/public-api-response";
import { runPublicDataOperation } from "@/server/http/public-data-admission";

export const runtime = "nodejs";

type CountryRouteContext = {
  params: Promise<{
    iso3: string;
  }>;
};

function internalErrorResponse(error: unknown, messages: Dictionary["apiErrors"]) {
  console.error("Country detail request failed", {
    errorCode: getErrorCode(error),
  });
  const response = countryApiErrorSchema.parse({
    error: {
      code: "INTERNAL_ERROR",
      message: messages.countryDetailUnavailable,
    },
  });
  return NextResponse.json(response, { status: 500 });
}

export async function GET(request: Request, context: CountryRouteContext) {
  const observer = createPublicApiRequestObserver("/api/countries/:iso3");
  const messages = getDictionary(localeFromRequest(request)).apiErrors;
  let input: CountryDetailQuery;

  try {
    const { iso3 } = await context.params;
    const searchParams = new URL(request.url).searchParams;
    input = countryDetailQuerySchema.parse({
      applicationScope:
        searchParams.get("applicationScope") ?? undefined,
      asOf: searchParams.get("asOf") ?? undefined,
      iso3,
      powerKw: searchParams.get("powerKw") ?? undefined,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const failedField = String(error.issues[0]?.path[0] ?? "");
      if (failedField === "asOf") {
        return observer.finish(NextResponse.json(
          countryApiErrorSchema.parse({
            error: {
              code: "INVALID_AS_OF",
              message: messages.invalidAsOf,
            },
          }),
          { status: 400 },
        ), "INVALID_AS_OF");
      }
      if (failedField === "iso3") {
        return observer.finish(NextResponse.json(
          countryApiErrorSchema.parse({
            error: {
              code: "INVALID_ISO3",
              message: messages.invalidIso3,
            },
          }),
          { status: 400 },
        ), "INVALID_ISO3");
      }
      if (failedField === "applicationScope" || failedField === "powerKw") {
        return observer.finish(NextResponse.json(
          countryApiErrorSchema.parse({
            error: {
              code: "INVALID_FILTER",
              message: messages.invalidCountryFilter,
            },
          }),
          { status: 400 },
        ), "INVALID_FILTER");
      }
    }

    return observer.finish(internalErrorResponse(error, messages), "INTERNAL_ERROR");
  }

  if (!isKnownCountryIso3(input.iso3)) {
    return observer.finish(NextResponse.json(
      countryApiErrorSchema.parse({
        error: {
          code: "COUNTRY_NOT_FOUND",
          message: messages.countryNotFound,
        },
      }),
      { status: 404 },
    ), "COUNTRY_NOT_FOUND");
  }

  try {
    const operation = await runPublicDataOperation({
      request,
      route: "/api/countries/:iso3",
      work: (signal) => getCountryDetails(input, { signal }),
    });
    if (operation.status === "failed") {
      throw operation.error;
    }
    if (operation.status !== "fulfilled") {
      return observer.finish(
        NextResponse.json(
          countryApiErrorSchema.parse({
            error: {
              code: "INTERNAL_ERROR",
              message: messages.countryDetailUnavailable,
            },
          }),
          {
            headers: { "Retry-After": "1" },
            status: 503,
          },
        ),
        "INTERNAL_ERROR",
      );
    }
    return observer.finish(NextResponse.json(operation.value));
  } catch (error) {
    return observer.finish(internalErrorResponse(error, messages), "INTERNAL_ERROR");
  }
}
