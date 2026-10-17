import { harnessEvidenceContract } from "@/server/ai/catalog-harness";
import { selectPortfolioDemoAction } from "@/server/ai/portfolio-demo-model";
import { compiledEvidenceToolCalls } from "@/server/ai/sales-chat-loop";

/**
 * The tool call the offline demo actually executes for a turn: the demo's
 * typed harness action compiled by the production harness contract.
 */
export function selectPortfolioDemoTool(
  userText: string,
  conversation: string | readonly string[] = userText,
): { toolName: string; input: Record<string, unknown> } {
  const texts = typeof conversation === "string" ? [conversation] : [...conversation];
  if (texts.at(-1) !== userText) texts.push(userText);
  const { state, action } = selectPortfolioDemoAction(texts);
  if (action.type === "catalog") return { toolName: "catalog", input: action.query };
  if (action.type !== "evidence") return { toolName: "answer", input: {} };
  try {
    const contract = harnessEvidenceContract(state, action, new Date().toISOString().slice(0, 10), texts);
    const call = compiledEvidenceToolCalls(contract)[0];
    return call ? { toolName: call.tool, input: call.input as Record<string, unknown> } : { toolName: "clarify", input: {} };
  } catch {
    return { toolName: "clarify", input: {} };
  }
}
