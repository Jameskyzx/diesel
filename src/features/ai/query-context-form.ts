import { z } from "zod";

import { applicationScopeSchema, iso3Schema, isoDateSchema, powerKwSchema } from "@/features/database/schemas";
import { parseChatUrlContext } from "@/features/ai/chat-url-context";

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => value === "" ? undefined : value, schema.optional());

const contextFormSchema = z.object({
  applicationScope: optional(applicationScopeSchema),
  asOf: optional(isoDateSchema),
  countryIso3: optional(iso3Schema),
  powerKw: optional(powerKwSchema),
  productModelCode: optional(z.string().trim().min(1).max(100)),
});

/** Preserve unrelated/repeated URL parameters, but never carry a product into a regulation-only query. */
export function buildQueryContextSearch(
  raw: Record<string, unknown>,
  original: string,
  mode: "chat" | "regulations",
): string | null {
  const parsed = contextFormSchema.safeParse(raw);
  if (!parsed.success) return null;
  const values = parsed.data;
  if (mode === "regulations" && (!values.applicationScope || values.powerKw === undefined || !values.asOf)) return null;
  const params = new URLSearchParams(original);
  for (const key of Object.keys(contextFormSchema.shape)) params.delete(key);
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || (mode === "regulations" && (key === "countryIso3" || key === "productModelCode"))) continue;
    params.set(key, String(value));
  }
  const rawParams: Record<string, string[]> = {};
  for (const key of params.keys()) rawParams[key] = params.getAll(key);
  return parseChatUrlContext(rawParams).canonicalQuery;
}
