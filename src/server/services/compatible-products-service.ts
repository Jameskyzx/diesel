import "server-only";

import { findCompatibleProductsInputSchema } from "@/features/ai/schemas";
import type { ProductFitEvaluation } from "@/features/product-fit/schemas";
import {
  evaluateProductFit,
  listProducts,
} from "@/server/services/product-fit-service";
import { awaitStartedOperationsInOrder } from "@/server/http/settled-operation-barrier";
import {
  throwIfRequestAborted,
  type RequestSignalOptions,
} from "@/server/http/request-signal";

export async function findCompatibleProducts(
  input: unknown,
  options: RequestSignalOptions = {},
): Promise<ProductFitEvaluation[]> {
  throwIfRequestAborted(options.signal);
  const parsed = findCompatibleProductsInputSchema.parse(input);
  if (!parsed.countryIso3) {
    throw new Error("findCompatibleProducts requires a resolved country.");
  }

  if (parsed.productModelCode) {
    const evaluation = await evaluateProductFit(
      {
        applicationScope: parsed.applicationScope,
        asOf: parsed.asOf,
        countryIso3: parsed.countryIso3,
        powerKw: parsed.powerKw,
        productModelCode: parsed.productModelCode,
      },
      options,
    );
    throwIfRequestAborted(options.signal);
    return [evaluation];
  }

  const { products } = await listProducts(options);
  throwIfRequestAborted(options.signal);

  const evaluations = products.map((product) =>
    evaluateProductFit(
      {
        applicationScope: parsed.applicationScope,
        asOf: parsed.asOf,
        countryIso3: parsed.countryIso3,
        powerKw: parsed.powerKw,
        productModelCode: product.modelCode,
      },
      options,
    ),
  );
  const results = await awaitStartedOperationsInOrder(evaluations);
  throwIfRequestAborted(options.signal);

  return results;
}
