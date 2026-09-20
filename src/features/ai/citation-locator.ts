import { z } from "zod";

import { isoDateSchema } from "@/features/database/schemas";

export const citationLocatorDescriptorSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("membership_period"),
        validFrom: isoDateSchema,
        validTo: isoDateSchema.nullable(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("market_period"),
        periodEnd: isoDateSchema,
        periodStart: isoDateSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("regulation_limit_period"),
        pollutantCode: z.string().trim().min(1),
        validFrom: isoDateSchema,
        validTo: isoDateSchema.nullable(),
      })
      .strict(),
    z
      .object({
        availableFrom: isoDateSchema.nullable(),
        availableTo: isoDateSchema.nullable(),
        kind: z.literal("product_availability"),
        modelCode: z.string().trim().min(1),
        specificationVersion: z.string().trim().min(1).optional(),
      })
      .strict(),
  ])
  .superRefine((descriptor, context) => {
    const requireAscendingDates = (
      start: string | null,
      end: string | null,
      endPath: string,
    ) => {
      if (start !== null && end !== null && start > end) {
        context.addIssue({
          code: "custom",
          message: `${endPath} must be on or after the range start`,
          path: [endPath],
        });
      }
    };

    switch (descriptor.kind) {
      case "market_period":
        requireAscendingDates(
          descriptor.periodStart,
          descriptor.periodEnd,
          "periodEnd",
        );
        break;
      case "membership_period":
      case "regulation_limit_period":
        requireAscendingDates(
          descriptor.validFrom,
          descriptor.validTo,
          "validTo",
        );
        break;
      case "product_availability":
        requireAscendingDates(
          descriptor.availableFrom,
          descriptor.availableTo,
          "availableTo",
        );
        break;
    }
  });

export type CitationLocatorDescriptor = z.infer<
  typeof citationLocatorDescriptorSchema
>;
