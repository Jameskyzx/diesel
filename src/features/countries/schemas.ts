import { z } from "zod";

import { countryDetailResponseMatchesDeterministicRules } from "@/domain/countries/detail-consistency";
import {
  applicationScopeSchema,
  dataCoverageStatusSchema,
  httpUrlSchema,
  iso3Schema,
  marketMetricDecimalSchema,
} from "@/features/database/schemas";
import {
  analysisSourceSchema,
  compareRegulationsInputSchema,
  regulationCountryComparisonSchema,
} from "@/features/marketing/schemas";

const isoTimestampSchema = z.iso.datetime({ offset: true });
const iso2Schema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/, "ISO2 must contain two uppercase ASCII letters"),
);

export const countryGeoIndexSchema = z.array(
  z
    .object({
      iso3: iso3Schema,
      name: z.string().trim().min(1),
    })
    .strict(),
);

export const countryDirectoryEntrySchema = z
  .object({
    hasGeometry: z.boolean(),
    iso2: iso2Schema,
    iso3: iso3Schema,
    name: z.string().trim().min(1),
  })
  .strict();

export const countryDirectorySchema = z.array(countryDirectoryEntrySchema);

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
    iso2: iso2Schema,
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

export const jurisdictionTypeSchema = z.enum([
  "country",
  "regional",
  "international",
]);

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
    type: jurisdictionTypeSchema,
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
    countryIso3: iso3Schema,
    currencyCode: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/, "Currency code must contain three uppercase ASCII letters")
      .nullable(),
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
    valueNumeric: marketMetricDecimalSchema,
    verifiedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((metric, context) => {
    if (metric.periodEnd <= metric.periodStart) {
      context.addIssue({
        code: "custom",
        message: "periodEnd must be after periodStart",
        path: ["periodEnd"],
      });
    }
  });

const countryDetailSchema = countryMapSummarySchema
  .extend({
    currentEffectiveRegulations: z.array(
      currentEffectiveRegulationSummarySchema,
    ),
    futureAdoptedRegulations: z.array(futureAdoptedRegulationSummarySchema),
    jurisdictions: z.array(jurisdictionSummarySchema),
    lastVerifiedAt: isoTimestampSchema,
    marketMetrics: z.array(marketMetricSchema),
    regionCode: z.string().nullable(),
    source: countrySourceSchema,
    sources: z.array(countrySourceSchema),
    subregionCode: z.string().nullable(),
  })
  .strict();

export const countryApplicabilitySummarySchema = z
  .object({
    country: regulationCountryComparisonSchema,
    lastVerifiedAt: isoTimestampSchema.nullable(),
    missingData: z.array(z.string()),
    query: compareRegulationsInputSchema,
    sources: z.array(analysisSourceSchema),
  })
  .strict();

const countryDetailResponseShapeSchema = z.discriminatedUnion("status", [
  z
    .object({
      applicabilitySummary: countryApplicabilitySummarySchema.nullable(),
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

export type CountryDetailResponse = z.infer<
  typeof countryDetailResponseShapeSchema
>;

export const countryDetailResponseSchema =
  countryDetailResponseShapeSchema.superRefine((response, context) => {
    if (!countryDetailResponseMatchesDeterministicRules(response)) {
      context.addIssue({
        code: "custom",
        message:
          "Country details do not match their deterministic lifecycle and source rules",
        path: response.status === "available" ? ["country"] : [],
      });
    }
  });

export const countryApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum([
          "COUNTRY_NOT_FOUND",
          "INVALID_ISO3",
          "INVALID_AS_OF",
          "INVALID_FILTER",
          "INTERNAL_ERROR",
        ]),
        message: z.string(),
      })
      .strict(),
  })
  .strict();

export type CountryApiErrorCode = z.infer<
  typeof countryApiErrorSchema
>["error"]["code"];
export type CountryDirectory = z.infer<typeof countryDirectorySchema>;
export type CountryGeoIndex = z.infer<typeof countryGeoIndexSchema>;
export type CountryMapResponse = z.infer<typeof countryMapResponseSchema>;
export type JurisdictionType = z.infer<typeof jurisdictionTypeSchema>;
export type CountryMapSummary = z.infer<typeof countryMapSummarySchema>;
