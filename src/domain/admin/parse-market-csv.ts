import { ZodError } from "zod";

import {
  marketCsvRowSchema,
  type MarketCsvRow,
} from "@/features/admin/schemas";

export const marketCsvHeaders = [
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
] as const;

export type MarketCsvValidationError = {
  field: string | null;
  message: string;
  rowNumber: number;
};

export type MarketCsvPreviewRow = {
  parsed: MarketCsvRow | null;
  rowNumber: number;
};

class CsvSyntaxError extends Error {
  constructor(
    message: string,
    readonly rowNumber: number,
  ) {
    super(message);
    this.name = "CsvSyntaxError";
  }
}

type CsvGridRow = {
  cells: string[];
  rowNumber: number;
};

function parseCsvGrid(content: string): CsvGridRow[] {
  const rows: CsvGridRow[] = [];
  let row: string[] = [];
  let cell = "";
  let cellStarted = false;
  let closedQuote = false;
  let quoted = false;
  let physicalLine = 1;
  let rowStartLine = 1;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;

    if (character === "\0") {
      throw new CsvSyntaxError(
        "CSV 不能包含 NUL 字符。",
        physicalLine,
      );
    }

    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        cell += character;
        if (character === "\n") {
          physicalLine += 1;
        }
      }
      continue;
    }

    if (closedQuote) {
      if (character === ",") {
        row.push(cell);
        cell = "";
        cellStarted = false;
        closedQuote = false;
      } else if (character === "\n") {
        row.push(cell);
        rows.push({ cells: row, rowNumber: rowStartLine });
        row = [];
        cell = "";
        cellStarted = false;
        closedQuote = false;
        physicalLine += 1;
        rowStartLine = physicalLine;
      } else if (character === "\r") {
        if (content[index + 1] !== "\n") {
          throw new CsvSyntaxError(
            "CSV 中的回车必须与换行组成 CRLF。",
            physicalLine,
          );
        }
      } else {
        throw new CsvSyntaxError(
          "CSV 引号字段结束后只能出现逗号或换行。",
          physicalLine,
        );
      }
    } else if (character === '"') {
      if (cellStarted) {
        throw new CsvSyntaxError(
          "CSV 未加引号字段中不能包含引号。",
          physicalLine,
        );
      }
      cellStarted = true;
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
      cellStarted = false;
    } else if (character === "\n") {
      row.push(cell);
      rows.push({ cells: row, rowNumber: rowStartLine });
      row = [];
      cell = "";
      cellStarted = false;
      physicalLine += 1;
      rowStartLine = physicalLine;
    } else if (character === "\r") {
      if (content[index + 1] !== "\n") {
        throw new CsvSyntaxError(
          "CSV 中的回车必须与换行组成 CRLF。",
          physicalLine,
        );
      }
    } else {
      cell += character;
      cellStarted = true;
    }
  }

  if (quoted) {
    throw new CsvSyntaxError("CSV 包含未闭合的引号字段。", rowStartLine);
  }
  if (cellStarted || row.length > 0) {
    row.push(cell);
    rows.push({ cells: row, rowNumber: rowStartLine });
  }

  return rows.filter(({ cells }) =>
    cells.some((value) => value.trim().length > 0),
  );
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function required(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function strictBoolean(value: string): boolean | string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return value.trim();
}

function rowInput(
  headers: string[],
  values: string[],
): Record<string, unknown> {
  const cells = Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ""]),
  );

  return {
    applicationScope: nullable(cells.application_scope ?? ""),
    countryIso3: cells.country_iso3,
    currencyCode: nullable(cells.currency_code ?? ""),
    dataSourceId: cells.data_source_id,
    definition: cells.definition,
    isDemo: strictBoolean(cells.is_demo),
    methodologyVersion: cells.methodology_version,
    metricCode: cells.metric_code,
    metricName: cells.metric_name,
    periodEnd: cells.period_end,
    periodStart: cells.period_start,
    publishedOn: nullable(cells.published_on ?? ""),
    unitCode: cells.unit_code,
    valueNumeric: required(cells.value_numeric),
    verifiedAt: cells.verified_at,
  };
}

function observationKey(row: MarketCsvRow): string {
  return JSON.stringify([
    row.countryIso3,
    row.metricCode,
    row.applicationScope ?? null,
    row.periodStart,
    row.periodEnd,
    row.dataSourceId,
  ]);
}

export function parseMarketCsv(content: string): {
  errors: MarketCsvValidationError[];
  rows: MarketCsvPreviewRow[];
} {
  let grid: CsvGridRow[];
  try {
    grid = parseCsvGrid(content.replace(/^\uFEFF/, ""));
  } catch (error: unknown) {
    if (error instanceof CsvSyntaxError) {
      return {
        errors: [
          {
            field: null,
            message: error.message,
            rowNumber: error.rowNumber,
          },
        ],
        rows: [],
      };
    }
    throw error;
  }
  const [headerRow, ...dataRows] = grid;

  if (!headerRow) {
    return {
      errors: [
        {
          field: null,
          message: "CSV 为空。",
          rowNumber: 1,
        },
      ],
      rows: [],
    };
  }

  const headers = headerRow.cells.map((header) => header.trim());
  const headerMatches =
    headers.length === marketCsvHeaders.length &&
    headers.every((header, index) => header === marketCsvHeaders[index]);

  if (!headerMatches) {
    return {
      errors: [
        {
          field: null,
          message: `CSV 表头必须严格为：${marketCsvHeaders.join(",")}`,
          rowNumber: headerRow.rowNumber,
        },
      ],
      rows: [],
    };
  }

  if (dataRows.length === 0) {
    return {
      errors: [
        {
          field: null,
          message: "CSV 至少需要一行数据。",
          rowNumber: headerRow.rowNumber + 1,
        },
      ],
      rows: [],
    };
  }

  const errors: MarketCsvValidationError[] = [];
  const observationRows = new Map<string, number>();
  const rows = dataRows.map(({ cells: values, rowNumber }): MarketCsvPreviewRow => {

    if (values.length !== headers.length) {
      errors.push({
        field: null,
        message: `列数应为 ${headers.length}，实际为 ${values.length}。`,
        rowNumber,
      });
      return { parsed: null, rowNumber };
    }

    try {
      const parsed = marketCsvRowSchema.parse(rowInput(headers, values));
      const key = observationKey(parsed);
      const firstRowNumber = observationRows.get(key);
      if (firstRowNumber !== undefined) {
        errors.push({
          field: null,
          message: `与第 ${firstRowNumber} 行的市场观测重复。`,
          rowNumber,
        });
        return { parsed: null, rowNumber };
      }
      observationRows.set(key, rowNumber);

      return {
        parsed,
        rowNumber,
      };
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        for (const issue of error.issues) {
          errors.push({
            field: issue.path.length > 0 ? issue.path.join(".") : null,
            message: issue.message,
            rowNumber,
          });
        }
      } else {
        errors.push({
          field: null,
          message: "无法解析该行。",
          rowNumber,
        });
      }

      return { parsed: null, rowNumber };
    }
  });

  return { errors, rows };
}
