import "server-only";

import { evaluateProductFit as evaluateProductFitFacts } from "@/domain/product-fit/evaluate-product-fit";
import { productFitQuerySchema } from "@/features/database/schemas";
import {
  productFitEvaluationSchema,
  productListResponseSchema,
  type ProductFitEvaluation,
  type ProductListResponse,
} from "@/features/product-fit/schemas";
import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import { createProductRepository } from "@/server/repositories/product-repository";

function serializeDate(value: Date): string {
  return value.toISOString();
}

async function getProductRepository() {
  if (getDatabaseMode() === "pglite-demo") {
    return createProductRepository(await getDemoDatabase());
  }

  return createProductRepository(getDatabase());
}

export async function listProducts(): Promise<ProductListResponse> {
  const repository = await getProductRepository();
  const rows = await repository.listProducts();

  return productListResponseSchema.parse({
    products: rows.map((product) => ({
      ...product,
      source: {
        ...product.source,
        verifiedAt: serializeDate(product.source.verifiedAt),
      },
      verifiedAt: serializeDate(product.verifiedAt),
    })),
    status: "ok",
  });
}

export async function evaluateProductFit(
  input: unknown,
): Promise<ProductFitEvaluation> {
  const query = productFitQuerySchema.parse(input);
  const repository = await getProductRepository();
  const evidence = await repository.findFitEvidence(query);

  return productFitEvaluationSchema.parse(
    evaluateProductFitFacts({
      applicableRegulations: evidence.applicableRegulations.map(
        (regulation) => {
          if (
            regulation.status !== "effective" &&
            regulation.status !== "superseded"
          ) {
            throw new Error(
              "Product-fit evidence contained a regulation that was not effective at the query date.",
            );
          }

          return {
            ...regulation,
            applicability: {
              ...regulation.applicability,
              jurisdiction: {
                ...regulation.applicability.jurisdiction,
                source: {
                  ...regulation.applicability.jurisdiction.source,
                  verifiedAt: serializeDate(
                    regulation.applicability.jurisdiction.source.verifiedAt,
                  ),
                },
                verifiedAt: serializeDate(
                  regulation.applicability.jurisdiction.verifiedAt,
                ),
              },
              membership: {
                ...regulation.applicability.membership,
                source: {
                  ...regulation.applicability.membership.source,
                  verifiedAt: serializeDate(
                    regulation.applicability.membership.source.verifiedAt,
                  ),
                },
                verifiedAt: serializeDate(
                  regulation.applicability.membership.verifiedAt,
                ),
              },
            },
            limitSources: regulation.limitSources.map((source) => ({
              ...source,
              verifiedAt: serializeDate(source.verifiedAt),
            })),
            source: {
              ...regulation.source,
              verifiedAt: serializeDate(regulation.source.verifiedAt),
            },
            recordStatus: regulation.status,
            status: "effective" as const,
            verifiedAt: serializeDate(regulation.verifiedAt),
          };
        },
      ),
      certifications: evidence.certifications.map((certification) => ({
        ...certification,
        source: {
          ...certification.source,
          verifiedAt: serializeDate(certification.source.verifiedAt),
        },
        verifiedAt: serializeDate(certification.verifiedAt),
      })),
      product: evidence.product
        ? {
            ...evidence.product,
            source: {
              ...evidence.product.source,
              verifiedAt: serializeDate(evidence.product.source.verifiedAt),
            },
            verifiedAt: serializeDate(evidence.product.verifiedAt),
          }
        : null,
      query,
    }),
  );
}
