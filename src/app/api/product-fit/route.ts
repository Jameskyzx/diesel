import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  productFitApiErrorSchema,
  productFitEvaluationSchema,
} from "@/features/product-fit/schemas";
import {
  productFitQuerySchema,
  type ProductFitQuery,
} from "@/features/database/schemas";
import { getErrorCode } from "@/lib/api-error";
import { getDictionary, type Dictionary } from "@/i18n/dictionaries";
import { localeFromRequest } from "@/i18n/locale";
import {
  readJsonRequest,
  RequestBodyTooLargeError,
} from "@/server/http/request-body";
import { evaluateProductFit } from "@/server/services/product-fit-service";
import { MAX_PRODUCT_FIT_REQUEST_BYTES } from "@/server/http/request-limits";
import { createApiRequestObserver } from "@/server/observability/structured-log";

export const runtime = "nodejs";

function invalidInputResponse(messages: Dictionary["apiErrors"]) {
  return NextResponse.json(
    productFitApiErrorSchema.parse({
      error: {
        code: "INVALID_INPUT",
        message: messages.invalidProductFit,
      },
    }),
    { status: 400 },
  );
}

function internalErrorResponse(error: unknown, messages: Dictionary["apiErrors"]) {
  console.error("Product fit evaluation failed", {
    errorCode: getErrorCode(error),
  });
  return NextResponse.json(
    productFitApiErrorSchema.parse({
      error: {
        code: "INTERNAL_ERROR",
        message: messages.productFitUnavailable,
      },
    }),
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const observer = createApiRequestObserver("/api/product-fit");
  const messages = getDictionary(localeFromRequest(request)).apiErrors;
  let input: ProductFitQuery;

  try {
    input = productFitQuerySchema.parse(
      await readJsonRequest(request, MAX_PRODUCT_FIT_REQUEST_BYTES),
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return observer.finish(NextResponse.json(
        productFitApiErrorSchema.parse({
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: messages.productFitPayloadTooLarge,
          },
        }),
        { status: 413 },
      ), "PAYLOAD_TOO_LARGE");
    }
    if (error instanceof SyntaxError || error instanceof ZodError) {
      return observer.finish(invalidInputResponse(messages), "INVALID_INPUT");
    }
    return observer.finish(internalErrorResponse(error, messages), "INTERNAL_ERROR");
  }

  try {
    return observer.finish(
      NextResponse.json(
        productFitEvaluationSchema.parse(await evaluateProductFit(input)),
      ),
    );
  } catch (error) {
    return observer.finish(internalErrorResponse(error, messages), "INTERNAL_ERROR");
  }
}
