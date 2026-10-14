import { z } from "zod";

/** Observation intervals are half-open, matching the persisted market data.
 * This is a reporting period, never a rule-validity or publication cutoff. */
export const marketReportingPeriodSchema = z.object({
  start: z.iso.date(), end: z.iso.date(),
}).strict().refine(period => period.start < period.end, "Reporting period end must follow its start");
export type MarketReportingPeriod = z.infer<typeof marketReportingPeriodSchema>;

export function observationInReportingPeriod(observation: { periodStart: string; periodEnd: string }, period?: MarketReportingPeriod): boolean {
  return !period || (observation.periodStart >= period.start && observation.periodEnd <= period.end);
}

/** Deterministic normalization of explicit calendar years/ranges, not a guess
 * from document identifiers or a full regulatory as-of date. Other temporal
 * expressions remain ungrounded and must be clarified by the planner. */
export function explicitMarketReportingPeriod(text: string): { period?: MarketReportingPeriod; ambiguous: boolean } {
  const prose = text.replace(/\b\d{4}-\d{2}-\d{2}\b/gu, " ")
    .replace(/\d+(?:\.\d+)?\s*(?:kW\b|千瓦)/giu, " ")
    .replace(/[A-Za-z0-9]+(?:[./_-][A-Za-z0-9]+)+/gu, " ")
    .replace(/["“][^"”]*["”]/gu, " ");
  const range = prose.match(/(?<!\d)((?:19|20)\d{2})\s*年?\s*(?:至|到|through|to|–|—)\s*((?:19|20)\d{2})\s*年?/iu);
  const years = [...prose.matchAll(/(?<![\dA-Za-z])((?:19|20)\d{2})(?:年|\b)/gu)].map(match => Number(match[1]));
  const unique = [...new Set(years)];
  if (unique.length === 0) return { ambiguous: false };
  if (/(?:发布|出版|签发|文件版本|\b(?:published|publication|issued|released|document version)\b)/iu.test(prose))
    return { ambiguous: true };
  const start = range ? Number(range[1]) : unique[0]!;
  const end = range ? Number(range[2]) : start;
  if ((unique.length > 1 && !range) || unique.some(year => year < start || year > end) || end < start)
    return { ambiguous: true };
  return { ambiguous: false, period: { start: `${start}-01-01`, end: `${end + 1}-01-01` } };
}
