import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { countryApiErrorSchema } from "@/features/countries/schemas";
import {
  countryDetailQuerySchema,
  type CountryDetailQuery,
} from "@/features/database/schemas";
import { getErrorCode } from "@/lib/api-error";
import { isKnownCountryIso3 } from "@/server/services/country-directory";
import { getCountryDetails } from "@/server/services/country-service";

export const runtime = "nodejs";

type CountryRouteContext = {
  params: Promise<{
    iso3: string;
  }>;
};

function internalErrorResponse(error: unknown) {
  console.error("Country detail request failed", {
    errorCode: getErrorCode(error),
  });
  const response = countryApiErrorSchema.parse({
    error: {
      code: "INTERNAL_ERROR",
      message: "国家详情暂时不可用，请稍后重试。",
    },
  });
  return NextResponse.json(response, { status: 500 });
}

export async function GET(request: Request, context: CountryRouteContext) {
  let input: CountryDetailQuery;

  try {
    const { iso3 } = await context.params;
    const asOf = new URL(request.url).searchParams.get("asOf") ?? undefined;
    input = countryDetailQuerySchema.parse({ asOf, iso3 });
  } catch (error) {
    if (error instanceof ZodError) {
      const failedField = String(error.issues[0]?.path[0] ?? "");
      if (failedField === "asOf") {
        return NextResponse.json(
          countryApiErrorSchema.parse({
            error: {
              code: "INVALID_AS_OF",
              message: "截止日期必须是 YYYY-MM-DD 格式的 ISO 日期。",
            },
          }),
          { status: 400 },
        );
      }
      if (failedField === "iso3") {
        return NextResponse.json(
          countryApiErrorSchema.parse({
            error: {
              code: "INVALID_ISO3",
              message: "国家代码必须是三个英文字母组成的 ISO3 代码。",
            },
          }),
          { status: 400 },
        );
      }
    }

    return internalErrorResponse(error);
  }

  if (!isKnownCountryIso3(input.iso3)) {
    return NextResponse.json(
      countryApiErrorSchema.parse({
        error: {
          code: "COUNTRY_NOT_FOUND",
          message: "未找到该 ISO3 对应的国家目录记录。",
        },
      }),
      { status: 404 },
    );
  }

  try {
    return NextResponse.json(await getCountryDetails(input));
  } catch (error) {
    return internalErrorResponse(error);
  }
}
