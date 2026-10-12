import "server-only";
import type { AiToolResult } from "@/features/ai/schemas";

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
