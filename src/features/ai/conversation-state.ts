import { z } from "zod";
import { applicationScopeSchema } from "@/features/database/schemas";

export const conversationTaskSchema = z.enum([
  "country_profile", "regulations", "market", "product_fit",
  "opportunity_score", "sales_brief", "knowledge",
]);
export const conversationStateSchema = z.object({
  tasks: z.array(conversationTaskSchema).max(7),
  countryIso3s: z.array(z.string().regex(/^[A-Z]{3}$/u)).max(5),
  applicationScope: applicationScopeSchema.nullable(),
  powerKw: z.number().positive().max(100_000).nullable(),
  asOf: z.iso.date().nullable(),
  productModelCode: z.string().min(1).max(100).nullable(),
}).strict();
export type ConversationState = z.infer<typeof conversationStateSchema>;

// A receipt is opaque to the browser. Display state is never server evidence.
export const conversationMetadataSchema = z.object({
  conversation: z.object({
    receipt: z.string().min(1).max(64_000),
    state: conversationStateSchema,
    mode: z.enum(["research", "explain", "compose", "general", "clarify"]),
  }).strict(),
}).strict();

export function readConversationMetadata(metadata: unknown) {
  const parsed = conversationMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}
