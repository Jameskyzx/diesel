import { NextResponse } from "next/server";

import {
  productFitApiErrorSchema,
  productListResponseSchema,
} from "@/features/product-fit/schemas";
import { getErrorCode } from "@/lib/api-error";
import { getDictionary } from "@/i18n/dictionaries";
import { localeFromRequest } from "@/i18n/locale";
import { listProducts } from "@/server/services/product-fit-service";
import { createApiRequestObserver } from "@/server/observability/structured-log";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const observer = createApiRequestObserver("/api/products");
  const messages = getDictionary(localeFromRequest(request)).apiErrors;
  try {
    return observer.finish(
      NextResponse.json(productListResponseSchema.parse(await listProducts())),
    );
  } catch (error) {
    console.error("Product list request failed", {
      errorCode: getErrorCode(error),
    });
    return observer.finish(NextResponse.json(
      productFitApiErrorSchema.parse({
        error: {
          code: "INTERNAL_ERROR",
          message: messages.productListUnavailable,
        },
      }),
      { status: 500 },
    ), "INTERNAL_ERROR");
  }
}
