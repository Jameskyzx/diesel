import type {
  FeedbackCategory,
  FeedbackExtraction,
  FeedbackExtractionItem,
  FeedbackPowerUnit,
  FeedbackSeverity,
  FeedbackSystem,
} from "@/features/feedback/schemas";
import { MAX_FEEDBACK_ITEMS_PER_BATCH } from "@/features/feedback/schemas";

/**
 * Keyword rules for the offline demo and tests. They stand in for a model so
 * the extraction pipeline, checks and review flow run without a provider; a
 * real deployment uses the configured model instead.
 */

type Rule = { pattern: RegExp; category: FeedbackCategory; system: FeedbackSystem; tag: string };

const rules: readonly Rule[] = [
  { pattern: /进气|intake/iu, category: "failure", system: "intake", tag: "进气" },
  { pattern: /排气|exhaust/iu, category: "failure", system: "exhaust", tag: "排气" },
  { pattern: /后处理|SCR|DPF|尿素|aftertreatment/iu, category: "failure", system: "aftertreatment", tag: "后处理" },
  { pattern: /漏油|渗油|oil leak|leak/iu, category: "failure", system: "lubrication", tag: "漏油" },
  { pattern: /水温|过热|冷却|overheat|cooling/iu, category: "failure", system: "cooling", tag: "过热" },
  { pattern: /油耗|喷油|燃油|fuel/iu, category: "quality", system: "fuel", tag: "燃油" },
  { pattern: /噪音|异响|振动|noise|vibration/iu, category: "quality", system: "structure", tag: "噪音" },
  { pattern: /故障码|ECU|电控|sensor|传感器/iu, category: "failure", system: "electronics", tag: "电控" },
  { pattern: /功率|马力|动力不足|\bhp\b|\bkW\b|more power|power/iu, category: "performance_request", system: "power_output", tag: "功率" },
  { pattern: /配件|备件|spare parts?|parts/iu, category: "service_parts", system: "other", tag: "配件" },
  { pattern: /价格|报价|交期|price|delivery/iu, category: "commercial", system: "other", tag: "商务" },
  { pattern: /证书|认证|资料|certificate|manual/iu, category: "documentation", system: "other", tag: "资料" },
];

const countryNames = [
  "巴西", "中国", "德国", "美国", "印度", "日本", "俄罗斯", "墨西哥", "南非", "沙特",
  "Brazil", "China", "Germany", "USA", "India", "Japan", "Russia", "Mexico", "South Africa", "Saudi Arabia",
];

const chineseNumerals: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

const powerUnits: Record<string, FeedbackPowerUnit> = { "马力": "hp", hp: "hp", ps: "PS", kw: "kW", "千瓦": "kW" };

function severityOf(line: string, category: FeedbackCategory): FeedbackSeverity {
  if (/起火|着火|伤人|fire|injur/iu.test(line)) return "safety";
  if (/断裂|裂|爆|停机|抛锚|crack|broke|burst|stall/iu.test(line)) return "high";
  return category === "failure" || category === "quality" ? "medium" : "low";
}

export function demoExtractFeedback(text: string): FeedbackExtraction {
  const items: FeedbackExtractionItem[] = [];
  const lines = text.split(/[\n。！？!?；;]+/u).map(line => line.trim()).filter(line => line.length >= 4);
  const documentModel = /\bDEMO-[A-Z0-9]+(?:-[A-Z0-9]+)*\b|\b[A-Z]\d{1,2}-\d{2,3}[A-Z0-9]*\b/u.exec(text)?.[0] ?? null;
  const documentCountry = countryNames.find(name => text.includes(name)) ?? null;

  for (const line of lines) {
    const matched = rules.filter(rule => rule.pattern.test(line));
    const primary = matched[0];
    if (!primary || items.length >= MAX_FEEDBACK_ITEMS_PER_BATCH) continue;
    const power = /(\d+(?:\.\d+)?)\s*(马力|hp|ps|kw|千瓦)/iu.exec(line);
    const quantity = /(\d+|[一两二三四五六七八九十])\s*(?:台|units?\b)/iu.exec(line);
    const date = /\b(20\d{2}-\d{2}-\d{2})\b/u.exec(line);
    const request = /(?:希望|要求|需要|能不能|想要|want|need|request)(.{2,80})/iu.exec(line);
    items.push({
      modelMention: /\bDEMO-[A-Z0-9]+(?:-[A-Z0-9]+)*\b|\b[A-Z]\d{1,2}-\d{2,3}[A-Z0-9]*\b/u.exec(line)?.[0] ?? documentModel,
      countryMention: countryNames.find(name => line.includes(name)) ?? documentCountry,
      occurredOn: date?.[1] ?? null,
      category: primary.category,
      system: primary.system,
      component: /进气管|排气管|油底壳|水泵|喷油器|涡轮增压器|intake pipe|turbocharger/iu.exec(line)?.[0] ?? null,
      symptom: line.slice(0, 300),
      customerRequest: request ? request[0].slice(0, 300) : null,
      requestedPower: power ? { value: Number(power[1]), unit: powerUnits[power[2]!.toLocaleLowerCase("en-US")] ?? "kW" } : null,
      quantityAffected: quantity ? chineseNumerals[quantity[1]!] ?? Number(quantity[1]) : null,
      severity: severityOf(line, primary.category),
      tags: [...new Set(matched.map(rule => rule.tag))].slice(0, 5),
      evidenceQuote: line.slice(0, 500),
      sourceLanguage: /\p{Script=Han}/u.test(line) ? "zh" : "en",
    });
  }
  return { transcript: "", items };
}
