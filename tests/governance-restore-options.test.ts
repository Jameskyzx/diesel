import { describe, expect, it } from "vitest";

import { parseGovernanceRestoreOptions } from "../scripts/db/governance-restore-options";

const digest = "a".repeat(64);

describe("governance restore options", () => {
  it("defaults to a dry run with an absolute snapshot and explicit digest", () => {
    expect(
      parseGovernanceRestoreOptions([
        "--input=/opt/diesel/backups/release/governance-before.json",
        `--sha256=${digest.toUpperCase()}`,
      ]),
    ).toEqual({
      apply: false,
      expectedSha256: digest,
      help: false,
      inputPath: "/opt/diesel/backups/release/governance-before.json",
    });
  });

  it("only enables writes with the explicit apply flag", () => {
    expect(
      parseGovernanceRestoreOptions([
        `--sha256=${digest}`,
        "--apply",
        "--input=/private/tmp/governance.json",
      ]),
    ).toMatchObject({ apply: true, help: false });
  });

  it.each([["--help"], ["-h"]])("supports help without database options", (...args) => {
    expect(parseGovernanceRestoreOptions(args)).toEqual({ help: true });
  });

  it.each([
    [],
    ["--input=/private/tmp/governance.json"],
    [`--sha256=${digest}`],
    ["--input=relative.json", `--sha256=${digest}`],
    ["--input=/private/tmp/governance.txt", `--sha256=${digest}`],
    ["--input=/private/tmp/governance.json", "--sha256=bad"],
    [
      "--input=/private/tmp/one.json",
      "--input=/private/tmp/two.json",
      `--sha256=${digest}`,
    ],
    [
      "--input=/private/tmp/governance.json",
      `--sha256=${digest}`,
      "--force",
    ],
  ])("rejects incomplete, ambiguous, or unsafe arguments: %j", (...args) => {
    expect(() => parseGovernanceRestoreOptions(args)).toThrow();
  });
});
