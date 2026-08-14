const headers = [
  "country_iso3",
  "metric_code",
  "metric_name",
  "definition",
  "application_scope",
  "period_start",
  "period_end",
  "value_numeric",
  "unit_code",
  "currency_code",
  "methodology_version",
  "published_on",
  "data_source_id",
  "verified_at",
  "is_demo",
].join(",");

const shared = [
  "CHN",
  "FDE_DEMO_PIPELINE_INDEX",
  "DEMO ONLY — FDE pipeline index",
  "FICTIONAL index used only to demonstrate governed ingestion.",
  "non-road",
];
const tail = [
  "index",
  "",
  "fde-demo-v1",
  "2026-08-15",
  "00000000-0000-4000-8000-000000000004",
  "2026-08-14T00:00:00.000Z",
  "true",
];

export const invalidFdeMarketCsv = `${headers}\n${[
  ...shared,
  "2026-12-31",
  "2026-01-01",
  "not-a-number",
  ...tail,
].join(",")}\n`;

export const correctedFdeMarketCsv = `${headers}\n${[
  ...shared,
  "2026-01-01",
  "2026-12-31",
  "73.500000",
  ...tail,
].join(",")}\n`;
