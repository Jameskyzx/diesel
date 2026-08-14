import { describe, expect, it } from "vitest";

import { parseMarketCsv } from "@/domain/admin/parse-market-csv";
import { isFdeImplementationDemoMode } from "@/server/demo/fde-demo-mode";
import {
  correctedFdeMarketCsv,
  invalidFdeMarketCsv,
} from "../scripts/demo/fde-fixtures";

describe("FDE implementation demo boundaries", () => {
  it("requires every local mutable demo guard", () => {
    const valid = {
      DATABASE_MODE: "pglite-demo",
      FDE_IMPLEMENTATION_DEMO_MODE: "true",
      NODE_ENV: "development",
      PORTFOLIO_DEMO_MODE: "true",
    };
    expect(isFdeImplementationDemoMode(valid)).toBe(true);

    for (const key of Object.keys(valid)) {
      expect(
        isFdeImplementationDemoMode({ ...valid, [key]: undefined }),
      ).toBe(false);
    }
    expect(
      isFdeImplementationDemoMode({ ...valid, NODE_ENV: "production" }),
    ).toBe(false);
  });

  it("ships one field-invalid fixture and one valid governed metric", () => {
    const invalid = parseMarketCsv(invalidFdeMarketCsv);
    const corrected = parseMarketCsv(correctedFdeMarketCsv);

    expect(invalid.errors.map(({ field }) => field)).toEqual(
      expect.arrayContaining(["periodEnd", "valueNumeric"]),
    );
    expect(corrected.errors).toEqual([]);
    expect(corrected.rows[0]?.parsed).toMatchObject({
      countryIso3: "CHN",
      isDemo: true,
      metricCode: "FDE_DEMO_PIPELINE_INDEX",
      valueNumeric: "73.500000",
    });
  });
});
