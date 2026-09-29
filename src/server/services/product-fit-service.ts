import "server-only";

import { compareCanonicalText } from "@/domain/canonical-order";
import { productFitEvaluationMatchesDeterministicRules } from "@/domain/product-fit/evaluation-consistency";
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
import {
  throwIfRequestAborted,
  type RequestSignalOptions,
} from "@/server/http/request-signal";

function serializeDate(value: Date): string {
  return value.toISOString();
}

async function getProductRepository(options: RequestSignalOptions = {}) {
  throwIfRequestAborted(options.signal);
  if (getDatabaseMode() === "pglite-demo") {
    const database = await getDemoDatabase();
    throwIfRequestAborted(options.signal);
    return createProductRepository(database);
  }

  return createProductRepository(getDatabase());
}

export async function listProducts(
  options: RequestSignalOptions = {},
): Promise<ProductListResponse> {
  const repository = await getProductRepository(options);
  throwIfRequestAborted(options.signal);
  const rows = await repository.listProducts(options);
  throwIfRequestAborted(options.signal);

  return productListResponseSchema.parse({
    // SQL collation is not the canonical evidence order consumed by JS clients.
    products: rows.toSorted((left, right) => compareCanonicalText(
      `${left.modelCode}\u0000${left.id}`,
      `${right.modelCode}\u0000${right.id}`,
    )).map((product) => ({
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
  options: RequestSignalOptions = {},
): Promise<ProductFitEvaluation> {
  throwIfRequestAborted(options.signal);
  const query = productFitQuerySchema.parse(input);
  const repository = await getProductRepository(options);
  throwIfRequestAborted(options.signal);
  const evidence = await repository.findFitEvidence(query, options);
  throwIfRequestAborted(options.signal);

  const evaluation = productFitEvaluationSchema.parse(
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
  if (!productFitEvaluationMatchesDeterministicRules(evaluation)) {
    throw new Error("Product-fit evaluation does not match deterministic rules.");
  }

  return evaluation;
}
