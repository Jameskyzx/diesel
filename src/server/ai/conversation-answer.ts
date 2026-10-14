import "server-only";
import { z } from "zod";
import type { AiToolResult } from "@/features/ai/schemas";
import type { PreparedConversationTurn } from "@/server/ai/conversation-plan";
import { contextText } from "@/server/ai/conversation-plan";
import type { Locale } from "@/i18n/locale";

function latestAnswer(turn: PreparedConversationTurn): string | null {
  try {
    const history = z.array(z.object({ answer: z.string() })).safeParse(JSON.parse(turn.previousAnswer ?? "null"));
    return history.success ? history.data.at(-1)?.answer ?? null : null;
  } catch { return null; }
}

function materialsLocale(text: string, locale: Locale, previousAnswer: string | null): Locale {
  // Presentation instructions do not change the confirmed query or facts.
  const requests = [...text.matchAll(/(?:用|使用|以|改成|改为|译成|译为|翻译成|翻译为)\s*(?:简体)?(?:中文|英文)|\b(?:in|into|to|use)\s+(?:simplified\s+)?(?:Chinese|English)\b|(?:中文|英文)(?=.{0,8}(?:邮件|清单))/giu)]
    .filter(match => !/(?:\bnot|\bdon['’]t|不要|别|不)\s*$/iu.test(text.slice(0, match.index)));
  const requested = requests.at(-1)?.[0];
  if (requested) return /(?:English|英文)/iu.test(requested) ? "en" : "zh-CN";
  // A follow-up rewrite keeps the draft's language, not the UI's language.
  // Only a known neutral-draft prefix is used; no earlier facts are reused.
  if (/(?:缩短|精简|再短|改写|重写|翻译|\b(?:shorten|shorter|more concise|rewrite|translate)\b)/iu.test(text)) {
    if (previousAnswer?.startsWith("您好，请") || previousAnswer?.startsWith("本轮没有重新核验事实")) return "zh-CN";
    if (previousAnswer?.startsWith("Hello, please") || previousAnswer?.startsWith("This turn has not re-verified facts")) return "en";
  }
  return locale;
}

/** Document requests describe a future verification workflow, not present facts
 * or jurisdiction-specific legal requirements. Server-authored copy is the only
 * text allowed in this channel; model prose never bypasses the evidence guard. */
export function buildEvidenceRequestResponse(turn: PreparedConversationTurn, locale: Locale, latestUserText: string): string | null {
  if (turn.outputKind === "evidence" || turn.contract.blocksModelText) return null;
  const previousAnswer = latestAnswer(turn);
  const english = materialsLocale(latestUserText, locale, previousAnswer) === "en";
  const context = contextText(turn.state);
  if (turn.outputKind === "request_email") {
    const brief = /(?:缩短|精简|简短|再短|短一点|\b(?:shorten|shorter|short|brief|concise)\b)/iu.test(latestUserText);
    const briefText = english
      ? `Hello, please share the specification sheet, test reports and available certificates${context ? ` for (${context})` : ""}. Please include document versions and traceable originals. We will verify applicability and remaining gaps; this request does not confirm compliance or permission to sell.`
      : `您好，请提供规格表、检测报告及已有证书${context ? `，用于核对（${context}）` : ""}。请附上文件版本与可追溯原件。我们会核验适用性和剩余缺口，本次索取材料不代表已合规或获准销售。`;
    if (brief) {
      // Previous prose may determine presentation length, never current facts.
      // A second shortening request must not repeat the same short template.
      const minimalText = english
        ? `Hello, please send versioned, traceable specifications, test reports and available certificates${context ? ` for (${context})` : ""}. This request does not confirm compliance or permission to sell.`
        : `您好，请提供带版本、可追溯的规格表、检测报告及已有证书${context ? `（${context}）` : ""}。本次索取不代表已合规或获准销售。`;
      if (previousAnswer === briefText || previousAnswer === minimalText) return minimalText;
      return briefText;
    }
    return english
      ? `Hello, please share the specification sheet, emission test reports and any available certification documents${context ? ` for the assessment context (${context})` : ""}. Please include document versions, the tested application and power, test cycles, issuer, validity dates and traceable originals where available. We will review their applicability and outstanding gaps before drawing any conclusion; this request does not confirm compliance or permission to sell.`
      : `您好，请提供规格表、排放检测报告及已有认证文件${context ? `，用于核对这些查询条件（${context}）` : ""}。请尽可能附上文件版本、测试用途与功率、测试循环、签发机构、有效期及可追溯原件。我们会先核对适用性与未解决缺口，再讨论结论，本次索取材料不代表已合规或获准销售。`;
  }
  return english
    ? `This turn has not re-verified facts; refer to the earlier evidence cards for what was actually checked. The following is a preparation checklist, not a statement of legally mandatory documents${context ? ` (assessment context: ${context})` : ""}.\n\n- Specification sheet: model identity, rated power, actual application, specification version and supply dates if available.\n- Emission test reports: tested configuration, pollutant definitions, units, test cycles, report version and issuing body.\n- Available certification documents: certificate identity, model/configuration covered, issuer and validity dates.\n- Traceable originals and unresolved gaps: source files/links, missing items and who can supply them.\n\nNone of these materials has been verified by this checklist; no fit, certification or sale approval is established.`
    : `本轮没有重新核验事实；已查到的内容请以此前证据卡片为准。以下是材料准备清单，不是当地法定必备文件清单${context ? `（查询条件：${context}）` : ""}。\n\n- 规格表：型号身份、额定功率、实际用途、规格版本及已有供应日期。\n- 排放检测报告：受测配置、污染物定义、单位、测试循环、报告版本与出具机构。\n- 已有认证文件：证书身份、覆盖的型号/配置、签发机构与有效期。\n- 可追溯原件及未解决缺口：来源文件或链接、缺少项目以及可提供材料的负责人。\n\n这份清单没有核验任何材料，不构成产品适配、认证或销售许可结论。`;
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
