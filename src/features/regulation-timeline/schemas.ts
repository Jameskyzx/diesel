import { z } from "zod";

import {
  applicationScopeSchema,
  isoDateSchema,
} from "@/features/database/schemas";

export const regulationTimelineHorizons = [12, 36, 60] as const;
export const defaultRegulationTimelineHorizon = 60;
// Events in this many months before today stay visible as "recently changed".
export const regulationTimelineLookbackMonths = 12;

export const regulationTimelineWindowSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .strict()
  .refine((window) => window.from <= window.to, "Window must not be reversed");
export type RegulationTimelineWindow = z.infer<
  typeof regulationTimelineWindowSchema
>;

const firstValue = (value: unknown) =>
  Array.isArray(value) ? value[0] : value;
const blankToUndefined = (value: unknown) => {
  const first = firstValue(value);
  return typeof first === "string" && first.trim() === "" ? undefined : first;
};

/** URL filters for `/timeline`. Power only matters together with an application. */
export const regulationTimelineQuerySchema = z
  .object({
    applicationScope: z.preprocess(
      blankToUndefined,
      applicationScopeSchema.optional(),
    ),
    powerKw: z.preprocess(
      blankToUndefined,
      z.coerce.number().positive().max(100_000).optional(),
    ),
    horizonMonths: z.preprocess(
      blankToUndefined,
      z.coerce
        .number()
        .pipe(
          z.union(
            regulationTimelineHorizons.map((months) => z.literal(months)) as [
              z.ZodLiteral<12>,
              z.ZodLiteral<36>,
              z.ZodLiteral<60>,
            ],
          ),
        )
        .default(defaultRegulationTimelineHorizon),
    ),
  })
  .strip();
export type RegulationTimelineQuery = z.infer<
  typeof regulationTimelineQuerySchema
>;
