import type { ClientAiToolResult } from "./client-schemas";
import { latestVerifiedAtFromCitations } from "./evidence-semantics";

/** Presentation only: the validated tool result and evidence gate stay intact. */
export function toolDisplayEvidence(result: ClientAiToolResult) {
  if (result.tool !== "getCountryProfile" || result.profile?.status !== "available") {
    return {
      citations: result.citations,
      latestVerifiedAt: result.latestVerifiedAt,
    };
  }

  const country = result.profile.country;
  const includeMarket = result.requestedTopics.includes("market");
  const includeRegulations = result.requestedTopics.includes("regulations");
  const citations = result.citations.filter((citation) => {
    const countryIdentity =
      (citation.entityType == null || citation.entityType === "country") &&
      citation.sourceId === country.source.id &&
      citation.countryIso3 === country.iso3;
    if (countryIdentity) return true;
    if (includeMarket && citation.entityType === "market_metric") return true;
    return includeRegulations && (
      citation.entityType === "regulation" ||
      citation.entityType === "regulation_limit" ||
      citation.entityType === "jurisdiction" ||
      citation.entityType === "country_jurisdiction"
    );
  });

  return {
    citations,
    latestVerifiedAt: latestVerifiedAtFromCitations(citations),
  };
}
