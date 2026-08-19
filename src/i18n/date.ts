import type { Locale } from "@/i18n/locale";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const englishDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function parseUtcDate(value: string): Date | null {
  if (isoDatePattern.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
      ? null
      : date;
  }

  if (!isoTimestampPattern.test(value)) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Formats validated ISO dates or timestamps as a calendar date in UTC. */
export function formatUtcDate(value: string, locale: Locale): string {
  const date = parseUtcDate(value);
  if (!date) {
    return value;
  }
  if (locale === "zh-CN") {
    return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  }
  return englishDateFormatter.format(date);
}

export function formatOptionalUtcDate(
  value: string | null | undefined,
  locale: Locale,
  fallback: string,
): string {
  return value ? formatUtcDate(value, locale) : fallback;
}
