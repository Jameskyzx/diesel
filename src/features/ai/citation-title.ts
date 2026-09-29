import { z } from "zod";

import { iso3Schema } from "@/features/database/schemas";

const titleFactSchema = z.string().trim().min(1);
const iso2Schema = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, "ISO2 must contain two uppercase ASCII letters");

export const citationTitleDescriptorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      jurisdictionName: titleFactSchema,
      kind: z.literal("regulation_jurisdiction"),
      regulationName: titleFactSchema,
    })
    .strict(),
  z
    .object({
      countryIso3: iso3Schema,
      jurisdictionName: titleFactSchema,
      kind: z.literal("country_jurisdiction_membership"),
    })
    .strict(),
  z
    .object({
      countryIsDemo: z.boolean(),
      countryIso2: iso2Schema,
      countryIso3: iso3Schema,
      countryNameEn: titleFactSchema,
      countryNameLocal: titleFactSchema.nullable(),
      countrySourceId: z.uuid(),
      countrySourceIsDemo: z.boolean(),
      countrySourceTitle: titleFactSchema,
      kind: z.literal("country_profile"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("regulation_limits"),
      regulationName: titleFactSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("regulation_pollutant_limit"),
      pollutantCode: titleFactSchema,
      regulationName: titleFactSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("product_certification_record"),
      productModelCode: titleFactSchema.nullable(),
    })
    .strict(),
  z
    .object({
      isDemo: z.boolean(),
      kind: z.literal("market_metric"),
      metricCode: titleFactSchema,
      metricId: z.uuid(),
      metricName: titleFactSchema,
    })
    .strict(),
]);

export type CitationTitleDescriptor = z.infer<
  typeof citationTitleDescriptorSchema
>;
