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
      reusePath: null,
    });
  });

  it("accepts an optional absolute JSON snapshot to reuse", () => {
    expect(
      parseGovernanceSnapshotOptions([
        "--output=/opt/diesel/backups/release/governance-after.json",
        "--reuse=/opt/diesel/backups/release/governance-before.json",
      ]),
    ).toEqual({
      outputPath: "/opt/diesel/backups/release/governance-after.json",
      reusePath: "/opt/diesel/backups/release/governance-before.json",
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
    { args: ["--reuse=/private/tmp/one.json"] },
    { args: ["--output=/private/tmp/one.json", "--reuse=relative.json"] },
    {
      args: ["--output=/private/tmp/one.json", "--reuse=/private/tmp/one.json"],
    },
    {
      args: [
        "--output=/private/tmp/one.json",
        "--reuse=/private/tmp/two.json",
        "--reuse=/private/tmp/three.json",
      ],
    },
  ])("rejects unsafe or ambiguous arguments: $args", ({ args }) => {
    expect(() => parseGovernanceSnapshotOptions(args)).toThrow();
  });
});
