import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { productFitQuerySchema } from "@/features/database/schemas";
import * as schema from "@/server/db/schema";
import {
  dataSources,
  productCertifications,
  products,
} from "@/server/db/schema";
import {
  isPublicCertificationApproved,
  isPublicProductApproved,
} from "@/server/config/public-product-publication";
import { createRegulationRepository } from "@/server/repositories/regulation-repository";

export function createProductRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>) {
  const regulationRepository = createRegulationRepository(database);

  return {
    async findFitEvidence(input: unknown) {
      const query = productFitQuerySchema.parse(input);

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

      const productCandidate = productRows[0] ?? null;
      const product =
        productCandidate && isPublicProductApproved(productCandidate)
          ? productCandidate
          : null;

      const limitRows = await regulationRepository.findEffectiveByCountry({
        applicationScope: query.applicationScope,
        asOf: query.asOf,
        countryIso3: query.countryIso3,
        powerKw: query.powerKw,
      });
      const regulationsById = new Map<
        string,
        {
          applicability: {
            countryIso3: string;
            jurisdiction: {
              code: string;
              id: string;
              isDemo: boolean;
              name: string;
              source: {
                id: string;
                isDemo: boolean;
                publishedOn: string | null;
                title: string;
                url: string | null;
                verifiedAt: Date;
              };
              verifiedAt: Date;
            };
            membership: {
              isDemo: boolean;
              source: {
                id: string;
                isDemo: boolean;
                publishedOn: string | null;
                title: string;
                url: string | null;
                verifiedAt: Date;
              };
              validFrom: string;
              validTo: string | null;
              verifiedAt: Date;
            };
          };
          canonicalName: (typeof limitRows)[number]["canonicalName"];
          citationCode: (typeof limitRows)[number]["citationCode"];
          effectiveFrom: (typeof limitRows)[number]["effectiveFrom"];
          effectiveTo: (typeof limitRows)[number]["effectiveTo"];
          isDemo: (typeof limitRows)[number]["isDemo"];
          limitSources: Array<{
            id: string;
            isDemo: boolean;
            publishedOn: string | null;
            title: string;
            url: string | null;
            verifiedAt: Date;
          }>;
          regulationId: (typeof limitRows)[number]["regulationId"];
          source: (typeof limitRows)[number]["source"];
          status: (typeof limitRows)[number]["status"];
          verifiedAt: (typeof limitRows)[number]["verifiedAt"];
        }
      >();
      for (const row of limitRows) {
        const limitSource = {
          id: row.limit.sourceId,
          isDemo: row.limit.isDemo || row.limit.sourceIsDemo,
          publishedOn: row.limit.sourcePublishedOn,
          title: row.limit.sourceTitle,
          url: row.limit.sourceUrl,
          verifiedAt: row.limit.sourceVerifiedAt,
        };
        const existing = regulationsById.get(row.regulationId);
        if (existing) {
          const existingLimitSource = existing.limitSources.find(
            ({ id }) => id === limitSource.id,
          );
          if (existingLimitSource) {
            existingLimitSource.isDemo =
              existingLimitSource.isDemo || limitSource.isDemo;
          } else {
            existing.limitSources.push(limitSource);
          }
          continue;
        }

        regulationsById.set(row.regulationId, {
          applicability: {
            countryIso3: row.applicability.countryIso3,
            jurisdiction: {
              code: row.applicability.jurisdictionCode,
              id: row.applicability.jurisdictionId,
              isDemo: row.applicability.jurisdictionIsDemo,
              name: row.applicability.jurisdictionName,
              source: {
                id: row.applicability.jurisdictionSourceId,
                isDemo: row.applicability.jurisdictionSourceIsDemo,
                publishedOn:
                  row.applicability.jurisdictionSourcePublishedOn,
                title: row.applicability.jurisdictionSourceTitle,
                url: row.applicability.jurisdictionSourceUrl,
                verifiedAt:
                  row.applicability.jurisdictionSourceVerifiedAt,
              },
              verifiedAt: row.applicability.jurisdictionVerifiedAt,
            },
            membership: {
              isDemo: row.applicability.membershipIsDemo,
              source: {
                id: row.applicability.membershipSourceId,
                isDemo: row.applicability.membershipSourceIsDemo,
                publishedOn: row.applicability.membershipSourcePublishedOn,
                title: row.applicability.membershipSourceTitle,
                url: row.applicability.membershipSourceUrl,
                verifiedAt: row.applicability.membershipSourceVerifiedAt,
              },
              validFrom: row.applicability.membershipValidFrom,
              validTo: row.applicability.membershipValidTo,
              verifiedAt: row.applicability.membershipVerifiedAt,
            },
          },
          canonicalName: row.canonicalName,
          citationCode: row.citationCode,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          isDemo: row.isDemo,
          limitSources: [limitSource],
          regulationId: row.regulationId,
          source: row.source,
          status: row.status,
          verifiedAt: row.verifiedAt,
        });
      }
      const uniqueRegulations = Array.from(regulationsById.values());
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
      const certifications = certificationCandidates.filter(
        isPublicCertificationApproved,
      );

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
    async listProducts() {
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

      return rows.filter(isPublicProductApproved);
    },
  };
}
