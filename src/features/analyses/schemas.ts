import { z } from "zod";

import { chatHistorySnapshotSchema } from "@/features/ai/chat-history";
import { countryDetailResponseSchema } from "@/features/countries/schemas";
import { compareRegulationsInputSchema } from "@/features/marketing/schemas";

export const comparisonQuerySchema = compareRegulationsInputSchema.extend({
  countryIso3s: z.array(z.string().regex(/^[A-Z]{3}$/)).min(2).max(3),
}).refine(query => new Set(query.countryIso3s).size === query.countryIso3s.length);

export type ComparisonQuery = z.infer<typeof comparisonQuerySchema>;

export const comparisonSnapshotSchema = z.object({
  query: comparisonQuerySchema,
  responses: z.array(countryDetailResponseSchema).min(2).max(3),
}).strict().refine(({ query, responses }) =>
  responses.length === query.countryIso3s.length && responses.every((response, index) => {
    if (response.status === "no_data") return response.iso3 === query.countryIso3s[index];
    const actual = response.applicabilitySummary?.query;
    return response.country.iso3 === query.countryIso3s[index] && response.asOf === query.asOf &&
      actual?.countryIso3s.length === 1 && actual.countryIso3s[0] === query.countryIso3s[index] &&
      actual.applicationScope === query.applicationScope && actual.powerKw === query.powerKw && actual.asOf === query.asOf;
  }), "Comparison responses must match every requested condition");

export type ComparisonSnapshot = z.infer<typeof comparisonSnapshotSchema>;

export const analysisPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), history: chatHistorySnapshotSchema }).strict(),
  z.object({ kind: z.literal("comparison"), comparison: comparisonSnapshotSchema }).strict(),
]);

export const savedAnalysisSchema = z.object({
  version: z.literal(1), id: z.uuid(), title: z.string().trim().min(1).max(160),
  savedAt: z.iso.datetime(), locale: z.enum(["en", "zh-CN"]),
  payload: analysisPayloadSchema,
}).strict();

export type AnalysisPayload = z.infer<typeof analysisPayloadSchema>;
export type SavedAnalysis = z.infer<typeof savedAnalysisSchema>;

export function parseComparisonQuery(params: Record<string, string | string[] | undefined>): ComparisonQuery | null {
  const scalar = (key: string) => typeof params[key] === "string" ? params[key] : undefined;
  const countries = params.countryIso3s;
  const parsed = comparisonQuerySchema.safeParse({
    countryIso3s: (Array.isArray(countries) ? countries : countries ? [countries] : []).filter(Boolean),
    applicationScope: scalar("applicationScope"), powerKw: scalar("powerKw"), asOf: scalar("asOf"),
  });
  return parsed.success ? parsed.data : null;
}

export function comparisonSearch(query: ComparisonQuery): string {
  const params = new URLSearchParams({ applicationScope: query.applicationScope, powerKw: String(query.powerKw), asOf: query.asOf });
  query.countryIso3s.forEach(country => params.append("countryIso3s", country));
  return params.toString();
}
