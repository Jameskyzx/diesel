import "server-only";

import { findCompatibleProductsInputSchema } from "@/features/ai/schemas";
import type { ProductFitEvaluation } from "@/features/product-fit/schemas";
import {
  evaluateProductFit,
  listProducts,
} from "@/server/services/product-fit-service";

export async function findCompatibleProducts(
  input: unknown,
): Promise<ProductFitEvaluation[]> {
  const parsed = findCompatibleProductsInputSchema.parse(input);
  if (!parsed.countryIso3) {
    throw new Error("findCompatibleProducts requires a resolved country.");
  }

  if (parsed.productModelCode) {
    return [
      await evaluateProductFit({
        applicationScope: parsed.applicationScope,
        asOf: parsed.asOf,
        countryIso3: parsed.countryIso3,
        powerKw: parsed.powerKw,
        productModelCode: parsed.productModelCode,
      }),
    ];
  }

  const { products } = await listProducts();

  return Promise.all(
    products.map((product) =>
      evaluateProductFit({
        applicationScope: parsed.applicationScope,
        asOf: parsed.asOf,
        countryIso3: parsed.countryIso3,
        powerKw: parsed.powerKw,
        productModelCode: product.modelCode,
      }),
    ),
  );
}
