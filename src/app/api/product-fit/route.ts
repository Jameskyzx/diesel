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
import {
  readJsonRequest,
  RequestBodyTooLargeError,
} from "@/server/http/request-body";
import { evaluateProductFit } from "@/server/services/product-fit-service";
import { MAX_PRODUCT_FIT_REQUEST_BYTES } from "@/server/http/request-limits";
import { createApiRequestObserver } from "@/server/observability/structured-log";

export const runtime = "nodejs";

function invalidInputResponse() {
  return NextResponse.json(
    productFitApiErrorSchema.parse({
      error: {
        code: "INVALID_INPUT",
        message: "产品适配参数无效，请检查国家、场景、功率、日期和型号。",
      },
    }),
    { status: 400 },
  );
}

function internalErrorResponse(error: unknown) {
  console.error("Product fit evaluation failed", {
    errorCode: getErrorCode(error),
  });
  return NextResponse.json(
    productFitApiErrorSchema.parse({
      error: {
        code: "INTERNAL_ERROR",
        message: "产品适配评估暂时不可用，请稍后重试。",
      },
    }),
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const observer = createApiRequestObserver("/api/product-fit");
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
            message: "产品适配请求过大，请缩小请求后重试。",
          },
        }),
        { status: 413 },
      ), "PAYLOAD_TOO_LARGE");
    }
    if (error instanceof SyntaxError || error instanceof ZodError) {
      return observer.finish(invalidInputResponse(), "INVALID_INPUT");
    }
    return observer.finish(internalErrorResponse(error), "INTERNAL_ERROR");
  }

  try {
    return observer.finish(
      NextResponse.json(
        productFitEvaluationSchema.parse(await evaluateProductFit(input)),
      ),
    );
  } catch (error) {
    return observer.finish(internalErrorResponse(error), "INTERNAL_ERROR");
  }
}
