import { describe, expect, it } from "vitest";

import { parseChatUrlContext } from "@/features/ai/chat-url-context";

describe("chat URL context", () => {
  it("drops only an invalid field and preserves the valid shared context", () => {
    const result = parseChatUrlContext({
      applicationScope: "non-road",
      asOf: "bad-date",
      countryIso3: "chn",
      powerKw: "100.0",
      productModelCode: "demo-eng-100",
      utm_source: "interview",
    });

    expect(result.context).toEqual({
      applicationScope: "non-road",
      countryIso3: "CHN",
      powerKw: 100,
      productModelCode: "DEMO-ENG-100",
    });
    expect(result.canonicalQuery).toBe(
      "applicationScope=non-road&countryIso3=CHN&powerKw=100&productModelCode=DEMO-ENG-100&utm_source=interview",
    );
    expect(result.needsRedirect).toBe(true);
  });
});
