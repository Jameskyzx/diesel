import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { productFitQuerySchema } from "@/features/database/schemas";
import * as schema from "@/server/db/schema";
import {
  throwIfRequestAborted,
  type RequestSignalOptions,
} from "@/server/http/request-signal";
import {
  dataSources,
  productCertifications,
  products,
} from "@/server/db/schema";
import {
  isPublicCertificationApproved,
  isPublicProductApproved,
} from "@/server/config/public-product-publication";
import { groupApplicableRegulationRows } from "@/server/repositories/applicable-regulations";
import { createRegulationRepository } from "@/server/repositories/regulation-repository";

export function createProductRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>) {
  const regulationRepository = createRegulationRepository(database);

  return {
    async findFitEvidence(
      input: unknown,
      options: RequestSignalOptions = {},
    ) {
      const query = productFitQuerySchema.parse(input);
      throwIfRequestAborted(options.signal);

      const productRows = await database
        .select({
          applicationScopes: products.applicationScopes,
          availableFrom: products.availableFrom,
          availableTo: products.availableTo,
          id: products.id,
          isDemo: products.isDemo,
          modelCode: products.modelCode,
          name: products.name,
          powerMaxKw: products.powerMaxKw,
          powerMinKw: products.powerMinKw,
          source: {
            id: dataSources.id,
            isDemo: dataSources.isDemo,
            publishedOn: dataSources.publishedOn,
            title: dataSources.title,
            url: dataSources.url,
            verifiedAt: dataSources.verifiedAt,
          },
          specificationVersion: products.specificationVersion,
          verifiedAt: products.verifiedAt,
        })
        .from(products)
        .innerJoin(dataSources, eq(products.dataSourceId, dataSources.id))
        .where(
          and(
            eq(products.modelCode, query.productModelCode),
            isNull(products.archivedAt),
            isNull(dataSources.archivedAt),
          ),
        )
        .limit(1);
      throwIfRequestAborted(options.signal);

      const productCandidate = productRows[0] ?? null;
      const product =
        productCandidate && isPublicProductApproved(productCandidate)
          ? productCandidate
          : null;

      const limitRows = await regulationRepository.findEffectiveByCountry(
        {
          applicationScope: query.applicationScope,
          asOf: query.asOf,
          countryIso3: query.countryIso3,
          powerKw: query.powerKw,
        },
        options,
      );
      throwIfRequestAborted(options.signal);
      const uniqueRegulations = groupApplicableRegulationRows(limitRows);
      const regulationIds = uniqueRegulations.map(
        ({ regulationId }) => regulationId,
      );

      const certificationCandidates =
        !product || regulationIds.length === 0
          ? []
          : await database
              .select({
                applicationScope: productCertifications.applicationScope,
                certificateNumber: productCertifications.certificateNumber,
                id: productCertifications.id,
                isDemo: productCertifications.isDemo,
                powerMaxKw: productCertifications.powerMaxKw,
                powerMinKw: productCertifications.powerMinKw,
                regulationId: productCertifications.regulationId,
                source: {
                  id: dataSources.id,
                  isDemo: dataSources.isDemo,
                  publishedOn: dataSources.publishedOn,
                  title: dataSources.title,
                  url: dataSources.url,
                  verifiedAt: dataSources.verifiedAt,
                },
                status: productCertifications.status,
                validFrom: productCertifications.validFrom,
                validTo: productCertifications.validTo,
                verifiedAt: productCertifications.verifiedAt,
              })
              .from(productCertifications)
              .innerJoin(
                dataSources,
                eq(productCertifications.dataSourceId, dataSources.id),
              )
              .where(
                and(
                  eq(productCertifications.productId, product.id),
                  inArray(productCertifications.regulationId, regulationIds),
                  isNull(productCertifications.archivedAt),
                  isNull(dataSources.archivedAt),
                ),
              )
              .orderBy(asc(productCertifications.certificateNumber));
      throwIfRequestAborted(options.signal);
      const certifications = certificationCandidates
        .filter(isPublicCertificationApproved)
        .map((certification) => {
          if (!product) {
            throw new Error(
              "Certification evidence cannot exist without its product.",
            );
          }
          return {
            ...certification,
            productId: product.id,
            productModelCode: product.modelCode,
          };
        });

      const coveredRegulationIds = new Set(
        certifications.map(({ regulationId }) => regulationId),
      );

      return {
        applicableRegulations: uniqueRegulations,
        certifications,
        product,
        uncoveredRegulationIds: regulationIds.filter(
          (regulationId) => !coveredRegulationIds.has(regulationId),
        ),
      };
    },
    async listProducts(options: RequestSignalOptions = {}) {
      throwIfRequestAborted(options.signal);
      const rows = await database
        .select({
          applicationScopes: products.applicationScopes,
          availableFrom: products.availableFrom,
          availableTo: products.availableTo,
          id: products.id,
          isDemo: products.isDemo,
          modelCode: products.modelCode,
          name: products.name,
          powerMaxKw: products.powerMaxKw,
          powerMinKw: products.powerMinKw,
          source: {
            id: dataSources.id,
            isDemo: dataSources.isDemo,
            publishedOn: dataSources.publishedOn,
            title: dataSources.title,
            url: dataSources.url,
            verifiedAt: dataSources.verifiedAt,
          },
          specificationVersion: products.specificationVersion,
          verifiedAt: products.verifiedAt,
        })
        .from(products)
        .innerJoin(dataSources, eq(products.dataSourceId, dataSources.id))
        .where(
          and(
            isNull(products.archivedAt),
            isNull(dataSources.archivedAt),
          ),
        )
        .orderBy(asc(products.modelCode));
      throwIfRequestAborted(options.signal);

      return rows.filter(isPublicProductApproved);
    },
  };
}
