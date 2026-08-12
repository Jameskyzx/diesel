import { NextResponse } from "next/server";

import {
  productFitApiErrorSchema,
  productListResponseSchema,
} from "@/features/product-fit/schemas";
import { getErrorCode } from "@/lib/api-error";
import { listProducts } from "@/server/services/product-fit-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(
      productListResponseSchema.parse(await listProducts()),
    );
  } catch (error) {
    console.error("Product list request failed", {
      errorCode: getErrorCode(error),
    });
    return NextResponse.json(
      productFitApiErrorSchema.parse({
        error: {
          code: "INTERNAL_ERROR",
          message: "产品列表暂时不可用，请稍后重试。",
        },
      }),
      { status: 500 },
    );
  }
}
