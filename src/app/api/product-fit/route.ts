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
  RequestBodyAbortedError,
  RequestBodyTooLargeError,
  RequestBodyTimeoutError,
} from "@/server/http/request-body";
import { evaluateProductFit } from "@/server/services/product-fit-service";
import {
  MAX_NON_CHAT_REQUEST_BODY_READ_MS,
  MAX_PRODUCT_FIT_REQUEST_BYTES,
} from "@/server/http/request-limits";
import { createPublicApiRequestObserver } from "@/server/http/public-api-response";
import { runPublicDataOperation } from "@/server/http/public-data-admission";

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
  const observer = createPublicApiRequestObserver("/api/product-fit");
  const locale = localeFromRequest(request);
  const messages = getDictionary(locale).apiErrors;
  let input: ProductFitQuery;

  try {
    input = productFitQuerySchema.parse(
      await readJsonRequest(
        request,
        MAX_PRODUCT_FIT_REQUEST_BYTES,
        MAX_NON_CHAT_REQUEST_BODY_READ_MS,
        request.signal,
      ),
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
    if (
      error instanceof RequestBodyTimeoutError ||
      error instanceof RequestBodyAbortedError
    ) {
      return observer.finish(
        NextResponse.json(
          productFitApiErrorSchema.parse({
            error: {
              code: "REQUEST_TIMEOUT",
              message:
                locale === "en"
                  ? "The product-fit request upload timed out or was canceled. Please try again."
                  : "产品适配请求接收超时或已取消，请重试。",
            },
          }),
          { status: 408 },
        ),
        "REQUEST_TIMEOUT",
      );
    }
    if (error instanceof SyntaxError || error instanceof ZodError) {
      return observer.finish(invalidInputResponse(messages), "INVALID_INPUT");
    }
    return observer.finish(internalErrorResponse(error, messages), "INTERNAL_ERROR");
  }

  try {
    const operation = await runPublicDataOperation({
      request,
      route: "/api/product-fit",
      work: (signal) => evaluateProductFit(input, { signal }),
    });
    if (operation.status === "failed") {
      throw operation.error;
    }
    if (operation.status !== "fulfilled") {
      return observer.finish(
        NextResponse.json(
          productFitApiErrorSchema.parse({
            error: {
              code: "INTERNAL_ERROR",
              message: messages.productFitUnavailable,
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
    return observer.finish(
      NextResponse.json(
        productFitEvaluationSchema.parse(operation.value),
      ),
    );
  } catch (error) {
    return observer.finish(internalErrorResponse(error, messages), "INTERNAL_ERROR");
  }
}
