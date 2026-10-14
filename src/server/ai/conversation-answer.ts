import "server-only";
import type { AiToolResult } from "@/features/ai/schemas";
import type { PreparedConversationTurn } from "@/server/ai/conversation-plan";
import { contextText } from "@/server/ai/conversation-plan";
import type { ConversationMemory } from "@/features/ai/conversation-state";
import { marketObservationPeriod } from "@/domain/ai/market-profile-response";

type PreparationTopic = NonNullable<ConversationMemory["preparationTopics"]>[number];
// title, full explanation, compact essentials. Brevity may remove connective
// prose, never the dimensions to verify. Every format uses the same essentials.
const preparationCopy: Record<PreparationTopic, { en: [string, string, string]; "zh-CN": [string, string, string] }> = {
  specifications: { en: ["specification sheet", "model identity, rated power, actual application, specification version and supply dates if available", "model, power, application, version, available supply dates"],
    "zh-CN": ["规格表", "型号身份、额定功率、实际用途、规格版本及已有供应日期", "型号、功率、用途、版本及已有供应期"] },
  emission_tests: { en: ["emission test reports", "tested configuration, pollutant definitions, units, test cycles, report version and issuing body", "configuration, pollutants, units, test cycles, version, issuer"],
    "zh-CN": ["排放检测报告", "受测配置、污染物定义、单位、测试循环、报告版本与出具机构", "配置、污染物、单位、测试循环、版本、机构"] },
  certifications: { en: ["available certification documents", "certificate identity, model/configuration covered, issuer and validity dates", "certificate ID, model/configuration, issuer, validity dates"],
    "zh-CN": ["已有认证文件", "证书身份、覆盖的型号/配置、签发机构与有效期", "证书、型号/配置、机构、有效期"] },
  original_sources: { en: ["traceable originals and unresolved gaps", "source files or links, document versions, missing items and the person who can supply them", "files/links, versions, gaps, material owners"],
    "zh-CN": ["可追溯原件及未解决缺口", "来源文件或链接、版本、缺少项目以及可提供材料的负责人", "文件/链接、版本、缺项、资料负责人"] },
  market_definitions: { en: ["market statistical definitions", "metric meaning, stock versus sales/flow, units, currency and country/application coverage", "metric definition, stock/flow, units, currency, country/application coverage"],
    "zh-CN": ["市场统计定义", "指标含义、保有量与销量/流量的区别、单位、币种及国家/行业口径", "指标定义、存量/流量、单位、币种、国家/行业统计范围"] },
  market_periods: { en: ["reporting periods", "observation start/end, publication date, comparison base period and whether the data are historical", "observation start/end, publication date, base period, historical status"],
    "zh-CN": ["统计报告期", "观测起止日期、发布日期、比较基期及是否为历史数据", "观测起止、发布日期、比较基期、历史属性"] },
  market_methodology: { en: ["statistical methodology", "collection method, sample coverage, calculation definitions, revisions and cross-country comparability", "collection, sample coverage, calculations, revisions, comparability"],
    "zh-CN": ["统计方法", "采集方法、样本覆盖、计算口径、修订情况及跨国可比性", "采集、样本范围、计算口径、修订、可比性"] },
  regulatory_scope: { en: ["regulatory application, power ranges and validity dates", "original text/version, jurisdiction, application, power range, adopted/effective dates and unresolved applicability questions", "original/version, jurisdiction, adoption/effectiveness, applicability gaps"],
    "zh-CN": ["法规用途、功率范围与适用日期", "原文与版本、辖区、用途、功率范围、采纳/生效日期及待核实的适用性问题", "原文/版本、辖区、采纳/生效、适用性缺口"] },
  regulatory_test_methods: { en: ["regulatory test cycles and measurement methods", "original procedure/version, pollutant definitions, units, operating conditions and comparability limitations; not a product test result", "original/version, pollutants, units, conditions, comparability; not product results"],
    "zh-CN": ["法规测试循环与测量方法", "原始程序与版本、污染物定义、单位、运行工况及可比性限制；不是产品检测结果", "原始程序/版本、污染物、单位、工况、可比性；非产品结果"] },
};

function preparationTopics(turn: PreparedConversationTurn): PreparationTopic[] {
  if (turn.memory.preparationTopics) return turn.memory.preparationTopics;
  const tasks = turn.state.tasks;
  const topics: PreparationTopic[] = [];
  if (tasks.some(task => ["market", "opportunity_score", "sales_brief"].includes(task)))
    topics.push("market_definitions", "market_periods", "market_methodology");
  if (tasks.includes("regulations")) topics.push("regulatory_scope", "regulatory_test_methods");
  if (tasks.includes("product_fit") || tasks.length === 0)
    topics.push("specifications", "emission_tests", "certifications");
  topics.push("original_sources");
  return topics;
}

/** Document requests describe a future verification workflow, not present facts
 * or jurisdiction-specific legal requirements. Server-authored copy is the only
 * text allowed in this channel; model prose never bypasses the evidence guard. */
export function buildEvidenceRequestResponse(turn: PreparedConversationTurn): string | null {
  if (turn.outputKind === "evidence" || turn.contract.blocksModelText) return null;
  const english = turn.memory.responseLocale === "en";
  const context = [contextText(turn.state), turn.memory.marketPeriod ?
    `${english ? "reporting period" : "统计期"}: ${marketObservationPeriod(turn.memory.marketPeriod.start, turn.memory.marketPeriod.end, turn.memory.responseLocale)}` : ""].filter(Boolean).join(" · ");
  const copy = preparationTopics(turn).map(topic => preparationCopy[topic][turn.memory.responseLocale]);
  const length = turn.memory.draftLength;
  const materials = copy.map(([label, detail, essentials]) => `${label}: ${length === "standard" ? detail : essentials}`);
  const boundary = english ? "This request does not confirm compliance or permission to sell."
    : "本次索取材料不代表已合规或获准销售。";
  if (turn.outputKind === "request_email") {
    const review = length === "minimal" ? "" : english
      ? " All materials remain unverified; we will review their applicability and remaining gaps before drawing conclusions."
      : "所有材料均待核实，我们会先核对适用性和剩余缺口，再讨论结论。";
    return english ? `Hello, please share ${materials.join("; ")}${context ? ` for (${context})` : ""}.${review} ${boundary}`
      : `您好，请提供${materials.join("；")}${context ? `（${context}）` : ""}。${review}${boundary}`;
  }
  const count = Math.min(turn.memory.draftItems ?? materials.length, materials.length);
  // Group instead of silently discarding requested categories to hit a limit.
  const groups = Array.from({ length: count }, (_, index) => materials.slice(
    Math.floor(index * materials.length / count), Math.floor((index + 1) * materials.length / count)).join(english ? "; " : "；"));
  const intro = length === "minimal" ? english ? `This turn has not re-verified facts. Preparation checklist${context ? ` (${context})` : ""}:`
    : `本轮没有重新核验事实。材料准备清单${context ? `（${context}）` : ""}：`
    : english ? `This turn has not re-verified facts. This is a preparation checklist, not a statement of legally mandatory documents${context ? ` (${context})` : ""}.`
    : `本轮没有重新核验事实。这是材料准备清单，不是法定必备文件清单${context ? `（${context}）` : ""}。`;
  const detail = length === "standard" ? english ? " Refer to earlier evidence cards for what was actually checked." : "已查到的内容请以此前证据卡片为准。" : "";
  const end = english ? "None of these materials has been verified; no fit, certification or sale approval is established."
    : "以上材料均待核实，不构成产品适配、认证或销售许可结论。";
  return `${intro}${detail}\n\n${groups.map(group => `- ${group}`).join("\n")}\n\n${end}`;
}

/** Additional guard for purpose-specific prose. Cards remain the authoritative
 * facts. This checks unsupported quantities/rankings, not arbitrary entailment. */
export function conversationAnswerMatchesFacts(text: string, results: readonly AiToolResult[]): boolean {
  const allowedNumbers = new Set<string>();
  const numericFields = /^(?:powerKw|powerMinKw|powerMaxKw|limitValue|valueNumeric|score|totalScore|weight|value|informationAsOf|asOf|validFrom|validTo|periodStart|periodEnd|verifiedAt|sourceVerifiedAt|adoptedOn|effectiveOn)$/u;
  function collect(value: unknown, key = "") {
    if (numericFields.test(key) && (typeof value === "string" || typeof value === "number")) {
      for (const number of String(value).match(/\d+(?:\.\d+)?/gu) ?? []) allowedNumbers.add(String(Number(number)));
    }
    if (Array.isArray(value)) value.forEach(item => collect(item, key));
    else if (value && typeof value === "object") for (const [field, child] of Object.entries(value)) collect(child, field);
  }
  results.forEach(result => collect(result));
  const prose = text.replace(/\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/^\s*\d+[.)、]\s*/gmu, "")
    .replace(/\b(?:NO2|CO2|PM2\.5)\b/gu, "");
  // Check measured quantities and dates, not citation IDs or list numbering.
  for (const match of prose.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:kW|g\/kWh|mg\/|ppm|%|USD|CNY)|\b(\d{4})[-年]/giu)) {
    if (!allowedNumbers.has(String(Number(match[1] ?? match[2])))) return false;
  }
  for (const clause of prose.split(/[。！？.!?\n]/u)) {
    if (/(?:更严格|更宽松|\bstricter\b|\bmore stringent\b|保证.{0,8}(?:合规|销售)|合法销售|\blegally (?:sell|sold)\b|(?:测试循环|test cycles?).{0,16}(?:相同|不同|same|different|match|differ))/iu.test(clause) &&
      !/(?:不|未|无法|缺少|不能|\b(?:no|not|cannot|can't|unverified|missing|without)\b)/iu.test(clause)) return false;
  }
  return true;
}
