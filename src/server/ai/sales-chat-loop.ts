import "server-only";
import { knowledgeSearchSuggestion } from "@/server/ai/knowledge-request-context";

import type { AiToolResult } from "@/features/ai/schemas";
import {
  remainingEvidenceRequirements,
  type SalesChatEvidenceContract,
} from "@/server/ai/evidence-contract";

/** Compiles a resolved evidence contract into exact, schema-shaped tool calls. */
export function compiledEvidenceToolCalls(contract: SalesChatEvidenceContract, results: readonly AiToolResult[] = [], requestedAsOf?: string | null) {
  if (contract.blocksModelText || contract.missingRequiredParameters.length > 0) return [];
  return remainingEvidenceRequirements(contract, results).flatMap(requirement => requirement.acceptedTools.map(tool => {
    const q = requirement.query;
    return { tool, input: {
      ...(tool === "getCountryProfile" || tool === "findCompatibleProducts" || tool === "searchKnowledgeBase"
        ? { countryIso3: q.countryIso3s?.[0] ?? null } : { countryIso3s: q.countryIso3s }),
      // A missing optional constraint must be absent in the in-process DTO too,
      // not merely disappear when JSON is serialized for a model. Strict tool
      // schemas intentionally reject unsupported own keys, even if undefined.
      ...(q.asOf == null || (tool === "searchKnowledgeBase" && requestedAsOf === null) ? {} : { asOf: q.asOf }),
      ...(q.applicationScope == null ? {} : { applicationScope: q.applicationScope }),
      ...(q.powerKw === undefined ? {} : { powerKw: q.powerKw }),
      ...(q.productModelCode == null ? {} : { productModelCode: q.productModelCode }),
      ...(q.metricCodes === undefined ? {} : { metricCodes: q.metricCodes }),
      ...(q.marketPeriod === undefined ? {} : { marketPeriod: q.marketPeriod }),
      ...(q.targetCountryIso3 === undefined ? {} : { targetCountryIso3: q.targetCountryIso3 }),
      ...(q.knowledgeQuery === undefined ? {} : { query: knowledgeSearchSuggestion(q.knowledgeQuery, q.knowledgeTerms ?? [], q.knowledgeOptionalTerms) }),
      ...(requirement.requiredProfileTopics === undefined ? {} : { topics: requirement.requiredProfileTopics }),
    } };
  }));
}
