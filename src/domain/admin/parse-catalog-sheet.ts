import { catalogImportRowSchema, type CatalogImportRow } from "@/features/admin/schemas";

/**
 * Catalogue spreadsheet columns, in template order. List cells use ";" because
 * regulation citations themselves may contain commas.
 */
export const catalogSheetHeaders = [
  "model_code",
  "series",
  "category",
  "application_scopes",
  "rated_power_kw",
  "rated_speed_rpm",
  "power_min_kw",
  "power_max_kw",
  "displacement_l",
  "cylinders",
  "aftertreatment",
  "emission_label",
  "declared_citation_codes",
  "data_source_id",
  "verified_at",
  "is_demo",
] as const;

export const MAX_CATALOG_SHEET_ROWS = 500;

type Header = (typeof catalogSheetHeaders)[number];
export type CatalogSheetValidationError = { field: string | null; message: string; rowNumber: number };
export type CatalogSheetPreviewRow = { parsed: CatalogImportRow | null; rowNumber: number };
export type CatalogSheetPreview = { errors: CatalogSheetValidationError[]; rows: CatalogSheetPreviewRow[] };

const fieldByHeader: Record<Header, keyof CatalogImportRow> = {
  aftertreatment: "aftertreatment",
  application_scopes: "applicationScopes",
  category: "category",
  cylinders: "cylinders",
  data_source_id: "dataSourceId",
  declared_citation_codes: "declaredCitationCodes",
  displacement_l: "displacementL",
  emission_label: "emissionLabel",
  is_demo: "isDemo",
  model_code: "modelCode",
  power_max_kw: "powerMaxKw",
  power_min_kw: "powerMinKw",
  rated_power_kw: "ratedPowerKw",
  rated_speed_rpm: "ratedSpeedRpm",
  series: "series",
  verified_at: "verifiedAt",
};
const headerByField = Object.fromEntries(Object.entries(fieldByHeader).map(([header, field]) => [field, header]));

function text(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString();
  return String(cell).trim();
}

function list(cell: unknown): string[] {
  return text(cell).split(";").map(value => value.trim()).filter(Boolean);
}

function booleanCell(cell: unknown): unknown {
  if (typeof cell === "boolean") return cell;
  const value = text(cell).toLowerCase();
  if (value === "" ) return undefined;
  if (["true", "yes", "1"].includes(value)) return true;
  if (["false", "no", "0"].includes(value)) return false;
  return value;
}

function cellValue(header: Header, cell: unknown): unknown {
  if (header === "application_scopes" || header === "declared_citation_codes") return list(cell);
  if (header === "is_demo") return booleanCell(cell);
  if (typeof cell === "number") return cell;
  const value = text(cell);
  return value === "" ? undefined : value;
}

/**
 * Parses spreadsheet rows (first row = headers) into validated catalogue rows.
 * It never guesses a column: unknown, missing or duplicated headers fail the
 * whole sheet, and every invalid cell is reported with its spreadsheet row.
 */
export function parseCatalogSheet(sheet: readonly (readonly unknown[])[]): CatalogSheetPreview {
  const [headerRow, ...dataRows] = sheet;
  const headers = (headerRow ?? []).map(cell => text(cell).toLowerCase());
  const missing = catalogSheetHeaders.filter(header => !headers.includes(header));
  const unknown = headers.filter(header => header && !(catalogSheetHeaders as readonly string[]).includes(header));
  const duplicated = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (missing.length || unknown.length || duplicated.length) {
    return { rows: [], errors: [{ field: null, rowNumber: 1, message: [
      missing.length ? `Missing columns: ${missing.join(", ")}.` : "",
      unknown.length ? `Unknown columns: ${unknown.join(", ")}.` : "",
      duplicated.length ? `Duplicated columns: ${[...new Set(duplicated)].join(", ")}.` : "",
    ].filter(Boolean).join(" ") }] };
  }

  const nonEmpty = dataRows
    .map((cells, index) => ({ cells, rowNumber: index + 2 }))
    .filter(({ cells }) => cells.some(cell => text(cell) !== ""));
  if (nonEmpty.length === 0) return { rows: [], errors: [{ field: null, rowNumber: 1, message: "The sheet has no data rows." }] };
  if (nonEmpty.length > MAX_CATALOG_SHEET_ROWS) {
    return { rows: [], errors: [{ field: null, rowNumber: 1, message: `The sheet has more than ${MAX_CATALOG_SHEET_ROWS} data rows.` }] };
  }

  const errors: CatalogSheetValidationError[] = [];
  const rows: CatalogSheetPreviewRow[] = nonEmpty.map(({ cells, rowNumber }) => {
    const raw = Object.fromEntries(catalogSheetHeaders.map(header => [fieldByHeader[header], cellValue(header, cells[headers.indexOf(header)])]));
    const parsed = catalogImportRowSchema.safeParse(raw);
    if (parsed.success) return { parsed: parsed.data, rowNumber };
    for (const issue of parsed.error.issues) {
      const field = typeof issue.path[0] === "string" ? headerByField[issue.path[0]] ?? issue.path[0] : null;
      errors.push({ field, message: issue.message, rowNumber });
    }
    return { parsed: null, rowNumber };
  });

  const firstRowByModel = new Map<string, number>();
  for (const row of rows) {
    if (!row.parsed) continue;
    const first = firstRowByModel.get(row.parsed.modelCode);
    if (first === undefined) firstRowByModel.set(row.parsed.modelCode, row.rowNumber);
    else errors.push({ field: "model_code", rowNumber: row.rowNumber, message: `Model ${row.parsed.modelCode} already appears on row ${first}.` });
  }
  return { rows, errors };
}
