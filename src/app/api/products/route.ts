import { NextResponse } from "next/server";

import {
  productFitApiErrorSchema,
  productListResponseSchema,
} from "@/features/product-fit/schemas";
import { getErrorCode } from "@/lib/api-error";
import { getDictionary } from "@/i18n/dictionaries";
import { localeFromRequest } from "@/i18n/locale";
import { listProducts } from "@/server/services/product-fit-service";
import { createPublicApiRequestObserver } from "@/server/http/public-api-response";
import { runPublicDataOperation } from "@/server/http/public-data-admission";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const observer = createPublicApiRequestObserver("/api/products");
  const messages = getDictionary(localeFromRequest(request)).apiErrors;
  try {
    const operation = await runPublicDataOperation({
      request,
      route: "/api/products",
      work: (signal) => listProducts({ signal }),
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
              message: messages.productListUnavailable,
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
      NextResponse.json(productListResponseSchema.parse(operation.value)),
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
