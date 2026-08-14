import { describe, expect, it } from "vitest";

import { isNavigableEvidenceUrl } from "@/lib/source-link";

describe("evidence source links", () => {
  it("accepts navigable HTTP(S) evidence locations", () => {
    expect(isNavigableEvidenceUrl("https://authority.example/document")).toBe(
      true,
    );
    expect(isNavigableEvidenceUrl("http://localhost:3000/evidence/demo")).toBe(
      true,
    );
  });

  it("keeps fictional and unsafe locations non-clickable", () => {
    expect(
      isNavigableEvidenceUrl("https://example.invalid/demo/regulations"),
    ).toBe(false);
    expect(isNavigableEvidenceUrl("javascript:alert(1)")).toBe(false);
    expect(isNavigableEvidenceUrl("not a url")).toBe(false);
    expect(isNavigableEvidenceUrl(null)).toBe(false);
  });
});
