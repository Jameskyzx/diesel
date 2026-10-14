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

// Working memory contains intent and presentation only, never retrieved facts.
// It survives the bounded prose history, and is authoritative only when signed.
export const conversationMemorySchema = z.object({
  sourceRequest: z.string().min(1).max(2_000).nullable(),
  marketScope: applicationScopeSchema.nullable(),
  responseLocale: z.enum(["en", "zh-CN"]),
  draftLength: z.enum(["standard", "brief", "minimal"]),
  outputKind: z.enum(["evidence", "request_checklist", "request_email"]),
}).strict();
export type ConversationMemory = z.infer<typeof conversationMemorySchema>;

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
