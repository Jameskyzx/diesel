import { describe, expect, it } from "vitest";

import {
  parseProductionVersion,
  productionVersionFromStatus,
} from "@/domain/operations/production-version";

const version = "a".repeat(40);

function statusWithSnapshot(snapshot: unknown): string {
  return [
    "# Status",
    "<!-- production-release:start -->",
    "```json",
    JSON.stringify(snapshot),
    "```",
    "<!-- production-release:end -->",
  ].join("\n");
}

describe("production version status snapshot", () => {
  it("accepts only a complete lowercase Git SHA override", () => {
    expect(parseProductionVersion(version)).toBe(version);
    for (const invalid of ["", "abc123", "A".repeat(40), `${version}x`]) {
      expect(() => parseProductionVersion(invalid)).toThrow(
        /full lowercase Git SHA/u,
      );
    }
  });

  it("reads the exact public runtime Git SHA", () => {
    expect(
      productionVersionFromStatus(
        statusWithSnapshot({
          publicRuntime: {
            readbackAt: "2026-08-20T01:29+08:00",
            status: "ok",
            version,
          },
          unrelated: { retained: true },
        }),
      ),
    ).toBe(version);
  });

  it.each([
    ["missing markers", "# Status"],
    [
      "invalid JSON",
      [
        "<!-- production-release:start -->",
        "```json",
        "{broken",
        "```",
        "<!-- production-release:end -->",
      ].join("\n"),
    ],
    [
      "short version",
      statusWithSnapshot({ publicRuntime: { version: "abc123" } }),
    ],
  ])("fails closed for %s", (_label, markdown) => {
    expect(() => productionVersionFromStatus(markdown)).toThrow();
  });
});
