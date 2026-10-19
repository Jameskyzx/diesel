import "server-only";
import { findCompatibleProductsInputSchema, getCountryProfileInputSchema,
  salesChatModelKnowledgeSearchInputSchema, type AiToolResult } from "@/features/ai/schemas";
import { calculateOpportunityScoreInputSchema, compareMarketsInputSchema, compareRegulationsInputSchema,
  generateSalesBriefInputSchema } from "@/features/marketing/schemas";
import { buildEvidenceGapResponse, regulatoryDisclaimer } from "@/domain/ai/evidence-gap-response";
import { buildMarketProfileResponse } from "@/domain/ai/market-profile-response";
import { buildRegulationComparisonResponse } from "@/domain/ai/regulation-comparison-response";
import { buildCountryProfileResponse } from "@/domain/ai/country-profile-response";
import { compiledEvidenceToolCalls } from "@/server/ai/sales-chat-loop";
import { evidenceContractAllowsModelText, evidenceNeedsRegulatoryDisclaimer, evidenceQueryWasAnswered,
  type SalesChatEvidenceContract } from "@/server/ai/evidence-contract";
import type { SalesChatTools } from "@/server/ai/sales-chat";
import type { Locale } from "@/i18n/locale";

type CompiledCall = ReturnType<typeof compiledEvidenceToolCalls>[number];

/** Execute the existing audited read-only tools; no second model interprets
 * already-resolved arguments, no fake provider usage and no parameter repair. */
export async function executeEvidenceCall(call: CompiledCall, tools: SalesChatTools, signal: AbortSignal, toolCallId: string) {
  const options = { abortSignal: signal, toolCallId, messages: [], context: {} };
  switch (call.tool) {
    case "getCountryProfile": return tools.getCountryProfile.execute!(getCountryProfileInputSchema.parse(call.input), options);
    case "compareRegulations": return tools.compareRegulations.execute!(compareRegulationsInputSchema.parse(call.input), options);
    case "compareMarkets": return tools.compareMarkets.execute!(compareMarketsInputSchema.parse(call.input), options);
    case "findCompatibleProducts": return tools.findCompatibleProducts.execute!(findCompatibleProductsInputSchema.parse(call.input), options);
    case "calculateOpportunityScore": return tools.calculateOpportunityScore.execute!(calculateOpportunityScoreInputSchema.parse(call.input), options);
    case "generateSalesBrief": return tools.generateSalesBrief.execute!(generateSalesBriefInputSchema.parse(call.input), options);
    case "searchKnowledgeBase": return tools.searchKnowledgeBase.execute!(salesChatModelKnowledgeSearchInputSchema.parse(call.input), options);
  }
}

export function compiledResearchAnswer(contract: SalesChatEvidenceContract, results: AiToolResult[], failed: boolean, locale: Locale) {
  const full = !failed && evidenceContractAllowsModelText(contract, results);
  const verified = results.filter(result => result.status === "ok" && result.evidenceSufficient &&
    evidenceQueryWasAnswered(contract, result));
  const summaries = [
    buildRegulationComparisonResponse(verified.filter(result => result.tool === "compareRegulations"), locale, { allowSingleCountry: true }),
    buildMarketProfileResponse(verified.filter(result => result.tool === "getCountryProfile"), locale) ??
      buildCountryProfileResponse(verified.filter(result => result.tool === "getCountryProfile"), locale),
  ].filter(Boolean);
  let text = full ? summaries.join("\n\n") || (locale === "en"
    ? "The requested evidence checks completed. The cards show the verified records and their limitations; they do not establish any additional compliance or sale approval."
    : "本次证据查询已完成。证据卡片列出已核验记录与限制；这些记录不建立额外的合规或销售许可结论。")
    : [summaries.length ? (locale === "en" ? "Some requested evidence is still missing; verified records do not establish the missing conclusions." : "部分任务仍有证据缺口；已核验记录不能代替缺失部分的结论。") : null,
      ...summaries, buildEvidenceGapResponse(results, failed, false, locale)].filter(Boolean).join("\n\n");
  if (evidenceNeedsRegulatoryDisclaimer(contract, results) && !text.includes(regulatoryDisclaimer(locale))) text += `\n\n${regulatoryDisclaimer(locale)}`;
  return text;
}
