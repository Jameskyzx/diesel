import { z } from "zod";

import {
  applicationScopeSchema,
  dataCoverageStatusSchema,
  httpUrlSchema,
  iso3Schema,
} from "@/features/database/schemas";

const isoTimestampSchema = z.iso.datetime({ offset: true });

export const countryGeoIndexSchema = z.array(
  z
    .object({
      iso3: iso3Schema,
      name: z.string().trim().min(1),
    })
    .strict(),
);

export const countryGeoFeaturePropertiesSchema = z
  .object({
    ISO3: iso3Schema,
    name: z.string().trim().min(1),
  })
  .passthrough();

export const countrySourceSchema = z
  .object({
    id: z.uuid(),
    isDemo: z.boolean(),
    publishedOn: z.iso.date().nullable(),
    publisher: z.string().nullable(),
    title: z.string(),
    url: httpUrlSchema.nullable(),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

export const countryMapSummarySchema = z
  .object({
    dataCoverageStatus: dataCoverageStatusSchema,
    isDemo: z.boolean(),
    iso3: iso3Schema,
    isStale: z.boolean(),
    nameEn: z.string().trim().min(1),
    nameLocal: z.string().nullable(),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

export const countryMapResponseSchema = z
  .object({
    countries: z.array(countryMapSummarySchema),
    status: z.literal("ok"),
  })
  .strict();

const jurisdictionSummarySchema = z
  .object({
    code: z.string(),
    id: z.uuid(),
    isDemo: z.boolean(),
    jurisdictionVerifiedAt: isoTimestampSchema,
    membershipIsDemo: z.boolean(),
    membershipSource: countrySourceSchema,
    name: z.string(),
    source: countrySourceSchema,
    type: z.enum(["country", "regional", "international"]),
    validFrom: z.iso.date(),
    validTo: z.iso.date().nullable(),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

const regulationApplicabilitySchema = z
  .object({
    countryIso3: iso3Schema,
    jurisdiction: z
      .object({
        code: z.string(),
        id: z.uuid(),
        isDemo: z.boolean(),
        name: z.string(),
        source: countrySourceSchema,
        verifiedAt: isoTimestampSchema,
      })
      .strict(),
    membership: z
      .object({
        isDemo: z.boolean(),
        source: countrySourceSchema,
        validFrom: z.iso.date(),
        validTo: z.iso.date().nullable(),
        verifiedAt: isoTimestampSchema,
      })
      .strict(),
  })
  .strict();

const regulationSummarySchema = z
  .object({
    applicability: regulationApplicabilitySchema,
    adoptedOn: z.iso.date().nullable(),
    canonicalName: z.string(),
    citationCode: z.string().nullable(),
    effectiveFrom: z.iso.date().nullable(),
    effectiveTo: z.iso.date().nullable(),
    id: z.uuid(),
    isDemo: z.boolean(),
    proposedOn: z.iso.date().nullable(),
    source: countrySourceSchema,
    statusAtAsOf: z.enum(["adopted", "effective"]),
    status: z.enum(["proposed", "adopted", "effective", "superseded"]),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

const currentEffectiveRegulationSummarySchema = regulationSummarySchema.extend({
  statusAtAsOf: z.literal("effective"),
});

const futureAdoptedRegulationSummarySchema = regulationSummarySchema.extend({
  statusAtAsOf: z.literal("adopted"),
});

const marketMetricSchema = z
  .object({
    applicationScope: applicationScopeSchema.nullable(),
    currencyCode: z.string().length(3).nullable(),
    definition: z.string(),
    id: z.uuid(),
    isDemo: z.boolean(),
    metricCode: z.string(),
    metricName: z.string(),
    methodologyVersion: z.string(),
    periodEnd: z.iso.date(),
    periodStart: z.iso.date(),
    publishedOn: z.iso.date().nullable(),
    source: countrySourceSchema,
    unitCode: z.string(),
    valueNumeric: z.string(),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

const countryDetailSchema = countryMapSummarySchema
  .extend({
    currentEffectiveRegulations: z.array(
      currentEffectiveRegulationSummarySchema,
    ),
    futureAdoptedRegulations: z.array(futureAdoptedRegulationSummarySchema),
    iso2: z.string().length(2),
    jurisdictions: z.array(jurisdictionSummarySchema),
    lastVerifiedAt: isoTimestampSchema,
    marketMetrics: z.array(marketMetricSchema),
    regionCode: z.string().nullable(),
    source: countrySourceSchema,
    sources: z.array(countrySourceSchema),
    subregionCode: z.string().nullable(),
  })
  .strict();

export const countryDetailResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      asOf: z.iso.date(),
      country: countryDetailSchema,
      status: z.literal("available"),
    })
    .strict(),
  z
    .object({
      iso3: iso3Schema,
      status: z.literal("no_data"),
    })
    .strict(),
]);

export const countryApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum(["INVALID_ISO3", "INVALID_AS_OF", "INTERNAL_ERROR"]),
        message: z.string(),
      })
      .strict(),
  })
  .strict();

export type CountryDetailResponse = z.infer<
  typeof countryDetailResponseSchema
>;
export type CountryGeoIndex = z.infer<typeof countryGeoIndexSchema>;
export type CountryMapResponse = z.infer<typeof countryMapResponseSchema>;
export type CountryMapSummary = z.infer<typeof countryMapSummarySchema>;
