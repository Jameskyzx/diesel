import { describe, expect, it } from "vitest";

import { parseGovernanceSnapshotOptions } from "../scripts/db/governance-snapshot-options";

describe("governance snapshot options", () => {
  it("accepts one absolute JSON output path", () => {
    expect(
      parseGovernanceSnapshotOptions([
        "--output=/opt/diesel/backups/release/governance.json",
      ]),
    ).toEqual({
      outputPath: "/opt/diesel/backups/release/governance.json",
    });
  });

  it.each([
    { args: [] },
    { args: ["--output=relative.json"] },
    { args: ["--output=/private/tmp/governance.txt"] },
    { args: ["--country=IRN"] },
    {
      args: [
        "--output=/private/tmp/one.json",
        "--output=/private/tmp/two.json",
      ],
    },
  ])("rejects unsafe or ambiguous arguments: $args", ({ args }) => {
    expect(() => parseGovernanceSnapshotOptions(args)).toThrow();
  });
});
