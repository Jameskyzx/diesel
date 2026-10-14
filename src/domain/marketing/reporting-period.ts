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

/** Ground the planner's selected operand, not every number mentioned in a
 * compound edit. Selection cannot turn an excluded/publication/identifier year
 * into a requested observation period or slice a range into a different one. */
export function selectedMarketReportingPeriod(text: string, expression: string) {
  const parsed = explicitMarketReportingPeriod(expression);
  if (!parsed.period) return parsed;
  let offset = text.indexOf(expression);
  while (offset >= 0) {
    const before = text.slice(0, offset);
    const after = text.slice(offset + expression.length);
    const clauseBefore = before.split(/[,，。;；!?！？\n]/u).at(-1) ?? "";
    const clauseAfter = after.split(/[,，。;；!?！？\n]/u)[0] ?? "";
    const clause = clauseBefore + expression + clauseAfter;
    const invalidRole = /(?:不要|不使用|别用|而非|不是|发布|出版|签发|文件版本|\b(?:not|instead of|rather than|published|publication|issued|released|document version)\b)/iu
      .test(clauseBefore + expression) || /^\s*(?:年)?\s*(?:发布|出版|签发|\b(?:publication|release|edition)\b)/iu.test(clauseAfter);
    const splitToken = /[A-Za-z0-9_./-]$/u.test(before) || /^[A-Za-z0-9_./-]/u.test(after);
    const quoted = [...text.matchAll(/["“][^"”]*["”]/gu)]
      .some(match => offset >= match.index && offset < match.index + match[0].length);
    const positiveAlternative = /(?:或者|或是|\bor\b)/iu.test(clause) && explicitMarketReportingPeriod(clause).ambiguous;
    const whole = explicitMarketReportingPeriod(clause);
    const splitsRange = whole.period && (whole.period.start !== parsed.period.start || whole.period.end !== parsed.period.end);
    if (!invalidRole && !splitToken && !quoted && !positiveAlternative && !splitsRange) return parsed;
    offset = text.indexOf(expression, offset + 1);
  }
  return { ambiguous: true };
}
