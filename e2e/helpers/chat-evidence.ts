import { clientAiToolResultSchema } from "../../src/features/ai/client-schemas";
import { KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING } from "../../src/domain/knowledge/search-consistency";

/** Transport fixture: an honest structured no-data query, not live evidence. */
export function noDataChatEvents() {
  const input = { countryIso3: "CHN", asOf: "2026-08-13", topics: ["regulations"] };
  const output = clientAiToolResultSchema.parse({
    citations: [], evidenceSufficient: false, informationAsOf: input.asOf, latestVerifiedAt: null,
    profile: { iso3: "CHN", status: "no_data" }, requestedTopics: input.topics, resolvedCountryIso3: "CHN",
    status: "no_data", tool: "getCountryProfile", warnings: [KNOWLEDGE_INSUFFICIENT_EVIDENCE_WARNING],
  });
  return [
    { type: "tool-input-available", toolCallId: "recorded-query", toolName: "getCountryProfile", input },
    { type: "tool-output-available", toolCallId: "recorded-query", output },
  ];
}
