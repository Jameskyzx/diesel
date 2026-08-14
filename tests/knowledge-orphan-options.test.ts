import { describe, expect, it } from "vitest";

import { parseKnowledgeOrphanOptions } from "../scripts/db/knowledge-orphan-options";

describe("knowledge orphan scan options", () => {
  it("defaults to a 24-hour dry run", () => {
    expect(parseKnowledgeOrphanOptions([])).toEqual({
      deleteFiles: false,
      minimumAgeHours: 24,
    });
  });

  it("requires an explicit delete flag and accepts a bounded minimum age", () => {
    expect(
      parseKnowledgeOrphanOptions(["--minimum-age-hours=48", "--delete"]),
    ).toEqual({ deleteFiles: true, minimumAgeHours: 48 });
  });

  it.each([
    ["--minimum-age-hours=0"],
    ["--minimum-age-hours=1.5"],
    ["--minimum-age-hours=abc"],
    ["--delete", "--delete"],
    ["--unknown"],
  ])("rejects unsafe or ambiguous options: %j", (...args) => {
    expect(() => parseKnowledgeOrphanOptions(args)).toThrow();
  });
});
