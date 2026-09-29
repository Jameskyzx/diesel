import { z } from "zod";

import { containsEmbeddedReasoningMarkup } from "@/domain/ai/reasoning-markup";

/**
 * Product identifiers supplied by the model are still provider-controlled
 * text. Keep the existing catalogue-code normalization while rejecting any
 * private reasoning markup before the value can reach a service or audit.
 */
export const modelOriginatedProductModelCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .superRefine((value, context) => {
    if (containsEmbeddedReasoningMarkup(value)) {
      context.addIssue({
        code: "custom",
        message: "Product model code contains private reasoning markup.",
      });
    }
  })
  .transform((value) => value.toUpperCase());
