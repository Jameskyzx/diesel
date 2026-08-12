import { describe, expect, it } from "vitest";

import { parseMarketCsv } from "@/domain/admin/parse-market-csv";

const header =
  "country_iso3,metric_code,metric_name,definition,application_scope,period_start,period_end,value_numeric,unit_code,currency_code,methodology_version,published_on,data_source_id,verified_at,is_demo";

describe("market-metric CSV parsing", () => {
  it("parses quoted cells and validates every structured field", () => {
    const result = parseMarketCsv(
      [
        header,
        'CHN,DEMO_PIPELINE,"Pipeline, demo","DEMO ONLY, fictional.",non-road,2025-01-01,2026-01-01,42,units,,demo-v1,2026-01-02,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,true',
      ].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.parsed).toMatchObject({
      countryIso3: "CHN",
      definition: "DEMO ONLY, fictional.",
      isDemo: true,
      metricName: "Pipeline, demo",
      valueNumeric: 42,
    });
  });

  it("returns row and field errors instead of accepting a partial record", () => {
    const result = parseMarketCsv(
      [
        header,
        "CHN,BROKEN,Broken metric,Missing fields,non-road,2026-01-01,2025-01-01,not-a-number,units,,demo-v1,,bad-id,bad-date,false",
      ].join("\n"),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.parsed).toBeNull();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "valueNumeric",
          rowNumber: 2,
        }),
        expect.objectContaining({
          field: "dataSourceId",
          rowNumber: 2,
        }),
        expect.objectContaining({
          field: "verifiedAt",
          rowNumber: 2,
        }),
      ]),
    );
  });

  it("checks validity-period ordering after field parsing succeeds", () => {
    const result = parseMarketCsv(
      [
        header,
        "CHN,DEMO_PERIOD,Period metric,DEMO ONLY.,non-road,2026-01-01,2025-01-01,1,units,,demo-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,true",
      ].join("\n"),
    );

    expect(result.rows[0]?.parsed).toBeNull();
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "periodEnd",
        rowNumber: 2,
      }),
    );
  });

  it("rejects missing or misspelled demo flags instead of treating them as real", () => {
    for (const isDemo of ["", "tru", "0"]) {
      const result = parseMarketCsv(
        [
          header,
          `CHN,REAL_FLAG,Real flag,Real metric.,non-road,2025-01-01,2026-01-01,1,units,,real-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,${isDemo}`,
        ].join("\n"),
      );

      expect(result.rows[0]?.parsed).toBeNull();
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "isDemo",
          rowNumber: 2,
        }),
      );
    }
  });

  it("rejects a missing numeric value instead of coercing it to zero", () => {
    const result = parseMarketCsv(
      [
        header,
        "CHN,MISSING_VALUE,Missing value,Real metric.,non-road,2025-01-01,2026-01-01,,units,,real-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,false",
      ].join("\n"),
    );

    expect(result.rows[0]?.parsed).toBeNull();
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "valueNumeric",
        rowNumber: 2,
      }),
    );
  });

  it("rejects non-decimal JavaScript numeric syntax", () => {
    const result = parseMarketCsv(
      [
        header,
        "CHN,NON_DECIMAL,Non-decimal value,Real metric.,non-road,2025-01-01,2026-01-01,0x10,units,,real-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,false",
      ].join("\n"),
    );

    expect(result.rows[0]?.parsed).toBeNull();
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "valueNumeric",
        rowNumber: 2,
      }),
    );
  });

  it("rejects a header-only CSV instead of confirming an empty batch", () => {
    const result = parseMarketCsv(header);

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      {
        field: null,
        message: "CSV 至少需要一行数据。",
        rowNumber: 2,
      },
    ]);
  });

  it("rejects unexpected or reordered headers", () => {
    const result = parseMarketCsv("metric_code,country_iso3\nDEMO,CHN");

    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toMatchObject({
      field: null,
      rowNumber: 1,
    });
  });

  it("returns structured errors for malformed quoted fields", () => {
    for (const [row, message] of [
      [
        'CHN,DEMO_QUOTE,"Unclosed metric,DEMO ONLY.,non-road,2025-01-01,2026-01-01,1,units,,demo-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,true',
        "未闭合",
      ],
      [
        'CHN,DEMO_QUOTE,Bad"quote,DEMO ONLY.,non-road,2025-01-01,2026-01-01,1,units,,demo-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,true',
        "未加引号字段",
      ],
      [
        'CHN,DEMO_QUOTE,"Closed"suffix,DEMO ONLY.,non-road,2025-01-01,2026-01-01,1,units,,demo-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,true',
        "引号字段结束后",
      ],
    ] as const) {
      const result = parseMarketCsv([header, row].join("\n"));

      expect(result.rows).toEqual([]);
      expect(result.errors).toEqual([
        expect.objectContaining({
          field: null,
          message: expect.stringContaining(message),
          rowNumber: 2,
        }),
      ]);
    }
  });

  it("rejects NUL characters before preview rows reach JSONB storage", () => {
    const result = parseMarketCsv(
      [
        header,
        "CHN,NUL_VALUE,NUL metric,Real\0metric.,non-road,2025-01-01,2026-01-01,1,units,,real-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,false",
      ].join("\n"),
    );

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      {
        field: null,
        message: "CSV 不能包含 NUL 字符。",
        rowNumber: 2,
      },
    ]);
  });

  it("rejects bare carriage returns instead of deleting input characters", () => {
    for (const row of [
      "CHN,BARE_CR,Bare CR,Real\rmetric.,non-road,2025-01-01,2026-01-01,1,units,,real-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,false",
      'CHN,BARE_CR,Bare CR,"Real"\r,non-road,2025-01-01,2026-01-01,1,units,,real-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,false',
    ]) {
      const result = parseMarketCsv([header, row].join("\n"));

      expect(result.rows).toEqual([]);
      expect(result.errors).toEqual([
        {
          field: null,
          message: "CSV 中的回车必须与换行组成 CRLF。",
          rowNumber: 2,
        },
      ]);
    }
  });

  it("continues to accept standard CRLF record separators", () => {
    const result = parseMarketCsv(
      [
        header,
        "CHN,CRLF,CRLF metric,Real metric.,non-road,2025-01-01,2026-01-01,1,units,,real-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,false",
      ].join("\r\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.parsed?.metricCode).toBe("CRLF");
  });

  it("rejects duplicate observations within one import batch", () => {
    const row =
      "CHN,DEMO_DUPLICATE,Duplicate metric,DEMO ONLY.,non-road,2025-01-01,2026-01-01,1,units,,demo-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,true";
    const result = parseMarketCsv([header, row, row].join("\n"));

    expect(result.rows[0]?.parsed).not.toBeNull();
    expect(result.rows[1]?.parsed).toBeNull();
    expect(result.errors).toEqual([
      {
        field: null,
        message: "与第 2 行的市场观测重复。",
        rowNumber: 3,
      },
    ]);
  });

  it("reports physical row numbers when blank lines are present", () => {
    const result = parseMarketCsv(
      [
        header,
        "",
        "CHN,BROKEN_ROW,Broken row,Real metric.,non-road,2025-01-01,2026-01-01,not-a-number,units,,real-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,false",
      ].join("\n"),
    );

    expect(result.rows[0]?.rowNumber).toBe(3);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: "valueNumeric",
        rowNumber: 3,
      }),
    );
  });

  it("tracks record start lines across quoted multiline fields", () => {
    const firstRow =
      'CHN,MULTILINE,Multiline metric,"Real metric line one\nline two.",non-road,2025-01-01,2026-01-01,1,units,,real-v1,,00000000-0000-4000-8000-000000000001,2026-07-29T00:00:00.000Z,false';
    const duplicateRow = firstRow.replace(
      "Real metric line one\nline two.",
      "Real metric duplicate.",
    );
    const result = parseMarketCsv(
      [header, firstRow, duplicateRow].join("\n"),
    );

    expect(result.rows.map(({ rowNumber }) => rowNumber)).toEqual([2, 4]);
    expect(result.errors).toEqual([
      {
        field: null,
        message: "与第 2 行的市场观测重复。",
        rowNumber: 4,
      },
    ]);
  });
});
