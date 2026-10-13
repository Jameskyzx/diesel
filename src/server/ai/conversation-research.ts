import "server-only";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { aiToolResultSchema, findCompatibleProductsInputSchema, getCountryProfileInputSchema,
  salesChatModelKnowledgeSearchInputSchema, type AiToolResult } from "@/features/ai/schemas";
import { calculateOpportunityScoreInputSchema, compareMarketsInputSchema, compareRegulationsInputSchema,
  generateSalesBriefInputSchema } from "@/features/marketing/schemas";
import { buildEvidenceGapResponse, regulatoryDisclaimer } from "@/domain/ai/evidence-gap-response";
import { buildMarketProfileResponse } from "@/domain/ai/market-profile-response";
import { buildRegulationComparisonResponse } from "@/domain/ai/regulation-comparison-response";
import { compiledEvidenceToolCalls } from "@/server/ai/sales-chat-loop";
import { evidenceContractAllowsModelText, evidenceNeedsRegulatoryDisclaimer, evidenceQueryWasAnswered,
  type SalesChatEvidenceContract } from "@/server/ai/evidence-contract";
import { containsEmbeddedReasoningMarkupInValue, type SalesChatTools } from "@/server/ai/sales-chat";
import type { Locale } from "@/i18n/locale";
import { ZodError } from "zod";
import { getErrorCode } from "@/lib/api-error";

type CompiledCall = ReturnType<typeof compiledEvidenceToolCalls>[number];

/** Execute the existing audited read-only tools; no second model interprets
 * already-resolved arguments, no fake provider usage and no parameter repair. */
async function executeCall(call: CompiledCall, tools: SalesChatTools, signal: AbortSignal, toolCallId: string) {
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
    buildRegulationComparisonResponse(verified.filter(result => result.tool === "compareRegulations"), locale),
    buildMarketProfileResponse(verified.filter(result => result.tool === "getCountryProfile"), locale),
  ].filter(Boolean);
  let text = full ? summaries.join("\n\n") || (locale === "en"
    ? "The requested evidence checks completed. The cards show the verified records and their limitations; they do not establish any additional compliance or sale approval."
    : "本次证据查询已完成。证据卡片列出已核验记录与限制；这些记录不建立额外的合规或销售许可结论。")
    : [summaries.length ? (locale === "en" ? "Some requested evidence is still missing; verified records do not establish the missing conclusions." : "部分任务仍有证据缺口；已核验记录不能代替缺失部分的结论。") : null,
      ...summaries, buildEvidenceGapResponse(results, failed, false, locale)].filter(Boolean).join("\n\n");
  if (evidenceNeedsRegulatoryDisclaimer(contract, results) && !text.includes(regulatoryDisclaimer(locale))) text += `\n\n${regulatoryDisclaimer(locale)}`;
  return text;
}

export function conversationResearchResponse(input: {
  contract: SalesChatEvidenceContract; tools: SalesChatTools; signal: AbortSignal; locale: Locale;
  metadata: (answer: string) => unknown;
}): Response {
  const { contract, tools, signal, locale } = input;
  const stream = createUIMessageStream({
    onError: () => locale === "en" ? "The evidence query could not be completed." : "本次证据查询未能完成。",
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      const results: AiToolResult[] = [];
      let failed = false;
      const seen = new Set<string>();
      // At most four deterministic executions after one planner call; the
      // existing five-unit admission and cancellation lease are unchanged.
      for (const call of compiledEvidenceToolCalls(contract)) {
        const key = JSON.stringify(call);
        if (seen.has(key)) continue;
        if (seen.size >= 4) break;
        if (signal.aborted) throw signal.reason;
        seen.add(key);
        const toolCallId = `compiled-evidence-${seen.size}`;
        if (containsEmbeddedReasoningMarkupInValue(call.input)) { failed = true; break; }
        writer.write({ type: "tool-input-available", toolCallId, toolName: call.tool, input: call.input, dynamic: true });
        try {
          const result = aiToolResultSchema.parse(await executeCall(call, tools, signal, toolCallId));
          // This is the same provenance, determinism, sufficiency, query and
          // publication validation used by the production evidence contract.
          // No-data completes a query, never supplies affirmative evidence.
          if (containsEmbeddedReasoningMarkupInValue(result) || !evidenceQueryWasAnswered(contract, result)) throw new Error("Unverified tool result");
          results.push(result);
          writer.write({ type: "tool-output-available", toolCallId, output: result, dynamic: true });
          if (result.status === "error") { failed = true; break; }
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          console.warn("AI compiled evidence query rejected", JSON.stringify({ tool: call.tool, errorCode: getErrorCode(error),
            fields: error instanceof ZodError ? error.issues.map(issue => ({ code: issue.code, path: issue.path.join("."),
              ...(issue.code === "unrecognized_keys" ? { keys: issue.keys } : {}) })) : [] }));
          failed = true;
          writer.write({ type: "tool-output-error", toolCallId, errorText: locale === "en" ? "The query or returned evidence could not be verified." : "查询或返回证据未能通过核验。", dynamic: true });
          break;
        }
      }
      const text = compiledResearchAnswer(contract, results, failed, locale);
      const id = "compiled-research-answer";
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: text });
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish", finishReason: "stop", messageMetadata: input.metadata(text) });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
