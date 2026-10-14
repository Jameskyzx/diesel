import { z } from "zod";
import { applicationScopeSchema } from "@/features/database/schemas";
import { marketReportingPeriodSchema } from "@/domain/marketing/reporting-period";

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

export const preparationTopicSchema = z.enum([
  "specifications", "emission_tests", "certifications", "original_sources",
  "market_definitions", "market_periods", "market_methodology", "regulatory_scope",
]);

// Working memory contains intent and presentation only, never retrieved facts.
// It survives the bounded prose history, and is authoritative only when signed.
export const conversationMemorySchema = z.object({
  sourceRequest: z.string().min(1).max(2_000).nullable(),
  sourceRefinements: z.array(z.string().min(1).max(2_000)).max(8).default([]),
  marketScope: applicationScopeSchema.nullable(),
  marketPeriod: marketReportingPeriodSchema.optional(),
  responseLocale: z.enum(["en", "zh-CN"]),
  draftLength: z.enum(["standard", "brief", "minimal"]),
  outputKind: z.enum(["evidence", "request_checklist", "request_email"]),
  preparationTopics: z.array(preparationTopicSchema).min(1).max(8).optional(),
  draftItems: z.number().int().min(1).max(8).nullable().optional(),
}).strict().refine(memory => (memory.sourceRequest?.length ?? 0) +
  memory.sourceRefinements.reduce((size, text) => size + text.length, 0) <= 4_000,
"Source task context exceeds its bounded capacity");
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
