import "server-only";

import { MockLanguageModelV4 } from "ai/test";

import type { ConversationState } from "@/features/ai/conversation-state";
import { buildConversationBusinessContext } from "@/server/ai/conversation-context";
import { buildKnowledgeRequestContext } from "@/server/ai/knowledge-request-context";
import type { Locale } from "@/i18n/locale";

/**
 * Deterministic offline model for `pnpm demo`. It speaks the same typed `act`
 * protocol as a real provider in the harness loop: the first step derives one
 * typed operation from the user's own words, the next step finishes with
 * general guidance. Facts are always rendered by the server from tool results.
 */

const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
} as const;

type DemoAction =
  | { type: "catalog"; query: { query: string } }
  | { type: "feedback"; query: { modelCode: string } }
  | { type: "evidence"; task: ConversationState["tasks"][number]; countryIso3: string | null; sourceQuery: string | null; marketPeriod: null;
      marketScope?: ConversationState["applicationScope"]; sourceScope?: ConversationState["applicationScope"] }
  | { type: "answer"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part: unknown) => isRecord(part) && typeof part.text === "string" ? [part.text] : []).join("\n");
}

function userTextsFrom(prompt: readonly unknown[]): string[] {
  return prompt.flatMap(message => isRecord(message) && message.role === "user" ? [textOf(message.content)] : []).filter(Boolean);
}

/** The harness system prompt embeds the working context and the current request. */
function workingContextFrom(prompt: readonly unknown[]): { locale: Locale; state: ConversationState | null; currentRequest: string | null } {
  const system = prompt.flatMap(message => isRecord(message) && message.role === "system" ? [textOf(message.content)] : []).join("\n");
  const contextJson = /Working context \(intent, not facts\): (\{.*\})\./u.exec(system)?.[1];
  const currentJson = /CURRENT USER REQUEST[^:]*: ("(?:[^"\\]|\\.)*")/u.exec(system)?.[1];
  let locale: Locale = "en";
  let state: ConversationState | null = null;
  try {
    const parsed = contextJson ? JSON.parse(contextJson) as { locale?: unknown; state?: ConversationState } : {};
    if (parsed.locale === "zh-CN" || parsed.locale === "en") locale = parsed.locale;
    state = parsed.state ?? null;
  } catch { /* fall back to defaults */ }
  let currentRequest: string | null = null;
  try { currentRequest = currentJson ? JSON.parse(currentJson) as string : null; } catch { /* ignore */ }
  return { locale, state, currentRequest };
}

function lastToolResult(prompt: readonly unknown[]): unknown {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index];
    if (!isRecord(message) || message.role !== "tool" || !Array.isArray(message.content)) continue;
    const part = message.content.at(-1);
    if (isRecord(part) && isRecord(part.output)) return part.output.value;
  }
  return undefined;
}

const feedbackPattern = /反馈|投诉|客户问题|常见问题|feedback|complaint/iu;
const catalogPattern = /\b(?:catalog(?:ue)?|DEMO-[A-Z]+\d*)\b|目录|型号库/iu;

export function selectPortfolioDemoAction(userTexts: readonly string[]): { state: ConversationState; action: DemoAction } {
  const latest = userTexts.at(-1) ?? "";
  const context = buildConversationBusinessContext(userTexts);
  const state: ConversationState = {
    tasks: [], countryIso3s: context.countryIso3s.slice(0, 5), applicationScope: context.applicationScope,
    powerKw: context.powerKw, asOf: context.asOf ?? null, productModelCode: context.productModelCode,
  };
  const country = context.focusedCountryIso3 ?? context.countryIso3s[0] ?? null;
  const evidence = (task: ConversationState["tasks"][number], sourceQuery: string | null = null) => ({
    state: { ...state, tasks: [task] },
    // A market query keeps the user's scope so the harness can refuse an
    // unsupported single-country filter instead of silently broadening it.
    action: { type: "evidence" as const, task, sourceQuery, marketPeriod: null,
      // Source search, product fit and the brief's target use the country the
      // user focused on; the brief honours an explicitly named target market.
      countryIso3: task === "knowledge" || task === "product_fit" ? country : task === "sales_brief" ? context.targetCountryIso3 ?? country : null,
      ...(task === "knowledge" && context.applicationScope ? { sourceScope: context.applicationScope } : {}),
      ...(task === "market" && context.applicationScope ? { marketScope: context.applicationScope } : {}) },
  });

  if (context.hasScopeConflict) {
    return { state, action: { type: "answer", message: "scope_conflict" } };
  }
  const feedbackModel = /\bDEMO-[A-Z0-9]+(?:-[A-Z0-9]+)*/u.exec(latest)?.[0];
  if (context.activeTask === null && feedbackModel && feedbackPattern.test(latest)) {
    return { state, action: { type: "feedback", query: { modelCode: feedbackModel } } };
  }
  if (context.activeTask === null && catalogPattern.test(latest)) {
    const model = /\bDEMO-[A-Z0-9-]+/u.exec(latest)?.[0] ?? "";
    return { state, action: { type: "catalog", query: { query: model } } };
  }
  switch (context.activeTask) {
    case "sales_brief": return evidence("sales_brief");
    case "opportunity_score": return evidence("opportunity_score");
    case "market_compare": return evidence("market");
    case "regulation_compare": return evidence("regulations");
    case "product_fit": return evidence("product_fit");
    case "knowledge": {
      const knowledge = buildKnowledgeRequestContext(userTexts, context);
      if (knowledge.requiresRestatement) return { state, action: { type: "answer", message: "restate_source" } };
      return evidence("knowledge", knowledge.query);
    }
    default:
      if (context.profileTopics.includes("regulations")) return evidence("regulations");
      if (context.profileTopics.includes("market")) return evidence("market");
      if (country) return evidence("country_profile");
      return { state, action: { type: "answer", message: "" } };
  }
}

type DemoTask = ConversationState["tasks"][number] | "catalog" | "feedback";

const taskSummaries: Record<DemoTask, { en: string; zh: string }> = {
  product_fit: { en: "The product-fit-v2 deterministic match is complete. Review regulatory/certification fit, query-date availability, and commercial readiness in the structured card. The offline demo uses explicitly fictional product and certification fixtures.",
    zh: "已运行 product-fit-v2 确定性匹配。法规/认证适配、查询日供应状态和商业准备度以结构化卡片为准；离线 Demo 只使用明确标记的虚构产品与认证数据。" },
  regulations: { en: "The regulations were compared under the same application, power, and date. Review statuses, limits, and sources in the structured card. The offline demo uses explicitly fictional fixtures.",
    zh: "已按同一场景、功率和日期完成法规比较。状态、限值和来源以结构化卡片为准；离线 Demo 只使用明确标记的虚构演示数据。" },
  market: { en: "Structured market metrics were queried using aligned methodology. Review comparability, observations, and sources in the structured card. The offline demo uses explicitly fictional fixtures.",
    zh: "已按一致口径查询结构化市场指标。可比性、观测值和来源以结构化卡片为准；离线 Demo 只使用明确标记的虚构演示数据。" },
  opportunity_score: { en: "The opportunity-score-v2 deterministic calculation is complete. Product readiness includes both compliance fit and query-date availability. Review scores, weights, coverage, and gaps in the structured card; the offline demo uses explicitly fictional fixtures.",
    zh: "已运行 opportunity-score-v2 确定性评分。产品准备度同时使用合规适配和查询日供应状态；分数、权重、数据覆盖率和缺口以结构化卡片为准；离线 Demo 只使用明确标记的虚构演示数据。" },
  sales_brief: { en: "The deterministic sales brief is complete. Review opportunities, risks, products, actions, and data gaps in the structured card. The offline demo uses explicitly fictional fixtures and cannot support quotes, certification claims, or sales commitments.",
    zh: "已生成确定性的结构化销售简报。机会、风险、产品建议、下一步和数据缺口以结构化卡片为准；离线 Demo 只使用明确标记的虚构演示数据，不可用于报价、认证声明或销售承诺。" },
  knowledge: { en: "Traceable document evidence was searched. Review matched text, page or section, validity, and source in the structured card. The offline demo uses explicitly fictional fixtures.",
    zh: "已检索可追溯文档证据。命中内容、页码或章节、有效期和来源以结构化卡片为准；离线 Demo 只使用明确标记的虚构演示数据。" },
  country_profile: { en: "The country profile was queried. Review current effective rules, future adopted rules, verification time, and sources in the structured card. The offline demo uses explicitly fictional fixtures.",
    zh: "已查询国家资料。当前有效法规、未来已采纳法规、核验时间和来源以结构化卡片为准；离线 Demo 只使用明确标记的虚构演示数据。" },
  feedback: { en: "Published feedback for this model was looked up. The counts and records below come from the server; all demo feedback is fictional.",
    zh: "已查询该型号已发布的客户反馈。下方计数和记录由服务端生成；演示反馈均为虚构示例。" },
  catalog: { en: "The fictional demo catalogue was searched. Review the declared ratings and citations in the cards; declarations are not certification.",
    zh: "已检索虚构 Demo 目录。声明的参数和法规编号以卡片为准；声明不等于认证。" },
};

function finishMessage(locale: Locale, outcome: "failed" | "scope_conflict" | "restate_source" | DemoTask): string {
  const en = locale === "en";
  if (outcome === "restate_source") {
    return en
      ? "Please restate the complete source query with its topic, OR branches and exclusions in one message. I cannot safely merge this new query wording with the retained topic or OR branches. No evidence has been accepted for this refinement."
      : "请在同一条消息中重新写出完整来源查询，包含主题、OR 分支和排除条件。无法安全地将新增检索文字合并到原主题或 OR 分支中；本次追问尚未接受任何证据。";
  }
  if (outcome === "scope_conflict") {
    return en
      ? "Please specify one application scope, such as non-road or marine. The scopes in this request do not resolve to one supported filter; I cannot choose one or silently query all scopes."
      : "请明确一个应用场景，例如非道路或船用。当前用途无法确定唯一支持的筛选范围，不能替你任选一个，也不能静默查询所有用途。";
  }
  if (outcome === "failed") {
    return en
      ? "Some conditions are still missing or could not be verified. Please add the missing conditions and ask again."
      : "部分条件仍缺失或未能核验。请补充缺少的条件后再问。";
  }
  return en ? taskSummaries[outcome].en : taskSummaries[outcome].zh;
}

/** The task of the demo's own earlier action in this turn. */
function previousTask(prompt: readonly unknown[]): DemoTask | null {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index];
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!isRecord(part) || part.type !== "tool-call") continue;
      const input = typeof part.input === "string" ? JSON.parse(part.input) as unknown : part.input;
      const action = isRecord(input) && isRecord(input.action) ? input.action : null;
      if (action?.type === "catalog") return "catalog";
      if (action?.type === "feedback") return "feedback";
      if (action?.type === "evidence" && typeof action.task === "string") return action.task as DemoTask;
    }
  }
  return null;
}

export function createPortfolioDemoModel() {
  let call = 0;
  return new MockLanguageModelV4({
    modelId: "portfolio-demo-v2",
    provider: "portfolio-demo",
    doGenerate: async (options) => {
      call += 1;
      const prompt = options.prompt as readonly unknown[];
      const { locale, state: workingState, currentRequest } = workingContextFrom(prompt);
      const texts = userTextsFrom(prompt);
      if (currentRequest && texts.at(-1) !== currentRequest) texts.push(currentRequest);
      const previous = lastToolResult(prompt);

      let input: { state: ConversationState; locale: Locale; action: DemoAction };
      if (previous === undefined) {
        const selected = selectPortfolioDemoAction(texts);
        // A clarification keeps the conditions the user already gave.
        const clarification = selected.action.type === "answer" ? selected.action.message : null;
        input = clarification !== null
          ? { state: selected.state, locale, action: { type: "answer",
            message: finishMessage(locale, clarification === "scope_conflict" || clarification === "restate_source" ? clarification : "failed") } }
          : { ...selected, locale };
      } else {
        const failed = isRecord(previous) && previous.error === "invalid_action";
        input = { state: workingState ?? selectPortfolioDemoAction(texts).state, locale,
          action: { type: "answer", message: finishMessage(locale, failed ? "failed" : previousTask(prompt) ?? "failed") } };
      }
      return {
        warnings: [], usage, finishReason: { unified: "tool-calls" as const, raw: undefined },
        content: [{ type: "tool-call" as const, toolCallId: `portfolio-demo-act-${call}`, toolName: "act", input: JSON.stringify(input) }],
      };
    },
  });
}
