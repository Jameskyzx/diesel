import {
  feedbackCategories,
  feedbackSeverities,
  type FeedbackCategory,
  type FeedbackSeverity,
  type PublicFeedbackRecord,
} from "@/features/feedback/schemas";

export type FeedbackSummary = {
  total: number;
  byCategory: Record<FeedbackCategory, number>;
  bySeverity: Record<FeedbackSeverity, number>;
  byCountry: { countryIso3: string | null; count: number }[];
  /** Count per calendar month of the problem date (or received date), oldest first. */
  byMonth: { month: string; count: number }[];
  topTags: { tag: string; count: number }[];
};

const zeroCounts = <T extends string>(keys: readonly T[]) =>
  Object.fromEntries(keys.map(key => [key, 0])) as Record<T, number>;

export function feedbackMonth(record: Pick<PublicFeedbackRecord, "occurredOn" | "receivedOn">): string {
  return (record.occurredOn ?? record.receivedOn).slice(0, 7);
}

function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  let [year, month] = first.split("-").map(Number) as [number, number];
  const [lastYear, lastMonth] = last.split("-").map(Number) as [number, number];
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

export function summarizeFeedback(records: readonly PublicFeedbackRecord[]): FeedbackSummary {
  const byCategory = zeroCounts(feedbackCategories);
  const bySeverity = zeroCounts(feedbackSeverities);
  const countries = new Map<string | null, number>();
  const months = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const record of records) {
    byCategory[record.category] += 1;
    bySeverity[record.severity] += 1;
    countries.set(record.countryIso3, (countries.get(record.countryIso3) ?? 0) + 1);
    months.set(feedbackMonth(record), (months.get(feedbackMonth(record)) ?? 0) + 1);
    for (const tag of new Set(record.tags)) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  const sortedMonths = [...months.keys()].sort();
  return {
    byCategory,
    byCountry: [...countries].map(([countryIso3, count]) => ({ count, countryIso3 }))
      .sort((left, right) => right.count - left.count || String(left.countryIso3).localeCompare(String(right.countryIso3))),
    // Empty months stay in the series so a trend is not drawn across a gap.
    byMonth: sortedMonths.length
      ? monthsBetween(sortedMonths[0]!, sortedMonths.at(-1)!).map(month => ({ count: months.get(month) ?? 0, month }))
      : [],
    bySeverity,
    topTags: [...tags].map(([tag, count]) => ({ count, tag }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag)).slice(0, 8),
    total: records.length,
  };
}

export type ModelFeedbackComparison = {
  modelCode: string;
  total: number;
  byCategory: Record<FeedbackCategory, number>;
  safetyOrHigh: number;
}[];

export function compareModels(records: readonly PublicFeedbackRecord[]): ModelFeedbackComparison {
  const models = new Map<string, PublicFeedbackRecord[]>();
  for (const record of records) models.set(record.modelCode, [...(models.get(record.modelCode) ?? []), record]);
  return [...models].map(([modelCode, rows]) => {
    const summary = summarizeFeedback(rows);
    return { byCategory: summary.byCategory, modelCode, safetyOrHigh: summary.bySeverity.high + summary.bySeverity.safety, total: summary.total };
  }).sort((left, right) => right.total - left.total || left.modelCode.localeCompare(right.modelCode));
}

const csvColumns = [
  "modelCode", "receivedOn", "occurredOn", "countryIso3", "category", "system", "component", "symptom",
  "customerRequest", "requestedPowerValue", "requestedPowerUnit", "requestedPowerKw", "quantityAffected",
  "severity", "tags", "evidenceQuote", "sourceKind", "isDemo",
] as const satisfies readonly (keyof PublicFeedbackRecord)[];

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("; ") : String(value);
  // A leading formula character would run as a formula in a spreadsheet.
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/** UTF-8 CSV with a byte-order mark so spreadsheet apps read Chinese text. */
export function feedbackToCsv(records: readonly PublicFeedbackRecord[]): string {
  const lines = [csvColumns.join(","), ...records.map(record => csvColumns.map(column => csvCell(record[column])).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
