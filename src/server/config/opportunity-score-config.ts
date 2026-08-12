import "server-only";

import { z } from "zod";

import {
  opportunityScoreWeightsSchema,
  type OpportunityScoreWeights,
} from "@/features/marketing/schemas";

const opportunityScoreEnvironmentSchema = z
  .object({
    OPPORTUNITY_SCORE_MARKET_WEIGHT: z.coerce
      .number()
      .min(0)
      .max(1)
      .default(0.5),
    OPPORTUNITY_SCORE_PRODUCT_WEIGHT: z.coerce
      .number()
      .min(0)
      .max(1)
      .default(0.3),
    OPPORTUNITY_SCORE_REGULATORY_WEIGHT: z.coerce
      .number()
      .min(0)
      .max(1)
      .default(0.2),
  })
  .passthrough();

export function getOpportunityScoreWeights(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): OpportunityScoreWeights {
  const parsed = opportunityScoreEnvironmentSchema.parse(environment);

  return opportunityScoreWeightsSchema.parse({
    marketPotential: parsed.OPPORTUNITY_SCORE_MARKET_WEIGHT,
    productReadiness: parsed.OPPORTUNITY_SCORE_PRODUCT_WEIGHT,
    regulatoryCoverage: parsed.OPPORTUNITY_SCORE_REGULATORY_WEIGHT,
  });
}

export const opportunityMetricDirections = {
  DEMO_ADDRESSABLE_UNITS: "higher_is_better",
} as const satisfies Record<
  string,
  "higher_is_better" | "lower_is_better"
>;
