import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { decodeRetainedLicenseArchive } from "../scripts/history/retained-license-archive";
import {
  parseRetainedLockIdentities,
  retainedDependencyLicenseArchiveContract,
  retainedDependencyLicenseManifestContract,
  summarizeRetainedDependencyLicenseOutput,
  summarizeRetainedPlatformLicenseReport,
  validateRetainedRegistryDeclaration,
  verifyRetainedDependencyLicenses,
} from "../scripts/history/retained-dependency-licenses";

const [manifestText, archiveBytes] = await Promise.all([
  readFile(resolve(process.cwd(), retainedDependencyLicenseManifestContract.path), "utf8"),
  readFile(resolve(process.cwd(), retainedDependencyLicenseArchiveContract.path)),
]);
const rawFiles = decodeRetainedLicenseArchive(archiveBytes);
const fullManifestPath = "runs/04-completed-platform-installs/manifest.json";
const registryManifestPath = "runs/06-completed-cross-platform-declarations/manifest.json";
const scopePath = "runs/06-completed-cross-platform-declarations/request-scope.json";
const objectSchema = z.record(z.string(), z.unknown());
const integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
const otherIntegrity = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;
const compoundLicense = "Apache-2.0 AND LGPL-3.0-or-later AND MIT";

function changedJson(
  path: string,
  change: (value: Record<string, unknown>) => void,
): ReadonlyMap<string, Uint8Array> {
  const bytes = rawFiles.get(path);
  if (bytes === undefined) throw new Error("Test requires a retained JSON file.");
  const value = objectSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown);
  change(value);
  const changed = new Map(rawFiles);
  changed.set(path, Buffer.from(JSON.stringify(value), "utf8"));
  return changed;
}

function lock(packages: string, version = "9.0"): string {
  return `lockfileVersion: '${version}'\n\npackages:\n${packages}\nsnapshots:\n`;
}

function packageEntry(identity: string, sri = integrity): string {
  return `  '${identity}':\n    resolution: {integrity: ${sri}}\n`;
}

function platformRow(versions = ["1.0.0"], license = "MIT") {
  return {
    name: "example", versions,
    paths: versions.map((version) => `/retained/example-${version}`),
    license,
  };
}

function registryFixture() {
  const root = "/private/tmp/diesel-fde-license-cross-platform-20260905.P6mmOE";
  const identity = "@scope/example@1.0.0";
  return {
    request: { identity, name: "@scope/example", version: "1.0.0", integrity },
    receipt: {
      identity,
      executable: "/Users/jamesky/.hermes/node/bin/node",
      args: [
        "/Users/jamesky/.hermes/node/lib/node_modules/pnpm/bin/pnpm.mjs",
        "--config.pm-on-fail=ignore", "--config.runtime-on-fail=error",
        "--config.ignore-pnpmfile=true", "--config.ignore-scripts=true",
        "--config.update-notifier=false", "--config.verify-deps-before-run=false",
        "--config.registry=https://registry.npmjs.org",
        "--config.node-experimental-package-map=false",
        `--config.cache-dir=${root}/cache`, `--config.state-dir=${root}/state`,
        "view", identity, "name", "version", "license", "licenses", "dist.integrity", "--json",
      ],
      cwd: root, startedAt: "2026-09-05T13:43:30.000Z", completedAt: "2026-09-05T13:43:31.000Z",
      exitCode: 0, signal: null, errorCode: null,
      output: {
        stdout: { path: "raw/example.stdout", byteLength: 1, sha256: "a".repeat(64) },
        stderr: { path: "raw/example.stderr", byteLength: 0, sha256: "b".repeat(64) },
      },
    },
    response: { name: "@scope/example", version: "1.0.0", "dist.integrity": integrity, license: compoundLicense },
  };
}

describe("retained dependency-license evidence", () => {
  it("verifies the real archive and recomputes all three locked identity sets", () => {
    const observed = verifyRetainedDependencyLicenses({ manifestText, archiveBytes });
    expect(observed).toMatchObject({
      successfulFrozenInstalls: 6, platformLicenseReports: 12, registryQueries: 175,
      graphs: [
        { graph: "L1", representativeState: "S1", platformIdentities: 680, productionPlatformIdentities: 403, registryIdentities: 175, lockedIdentities: 855 },
        { graph: "L2", representativeState: "S3", platformIdentities: 681, productionPlatformIdentities: 404, registryIdentities: 175, lockedIdentities: 856 },
        { graph: "L3", representativeState: "S6", platformIdentities: 682, productionPlatformIdentities: 405, registryIdentities: 175, lockedIdentities: 857 },
      ],
    });
    expect(observed.registryDeclarations).toEqual([
      { license: "Apache-2.0", identities: 9 },
      { license: "Apache-2.0 AND LGPL-3.0-or-later", identities: 3 },
      { license: compoundLicense, identities: 1 },
      { license: "LGPL-3.0-or-later", identities: 9 },
      { license: "MIT", identities: 133 },
      { license: "MPL-2.0", identities: 20 },
    ]);
  });

  it("recomputes the saved observations without using the outer summary or its hash", () => {
    const manifest = objectSchema.parse(JSON.parse(manifestText) as unknown);
    expect(summarizeRetainedDependencyLicenseOutput(rawFiles)).toEqual(manifest.observed);
    expect(manifest).toMatchObject({
      licenseApproval: "not-performed", includesLicenseFullText: false,
      crossPlatformInstallationVerified: false, historicalApplicationRuntimeVerified: false,
      publicationPermitted: false, publicationEffect: "none",
    });
  });

  it("rejects changed outer record bytes even when JSON still parses", () => {
    expect(() => verifyRetainedDependencyLicenses({ manifestText: `${manifestText} `, archiveBytes }))
      .toThrow(/byte binding/u);
  });

  it("rejects equal-length gzip tampering", () => {
    const changed = Buffer.from(archiveBytes);
    changed[100] = (changed[100] ?? 0) ^ 1;
    expect(() => verifyRetainedDependencyLicenses({ manifestText, archiveBytes: changed }))
      .toThrow(/byte binding/u);
  });
});

describe("reviewed lock identity shape", () => {
  it("retains exact scoped and unscoped package-version identities with their SRI", () => {
    const result = parseRetainedLockIdentities(lock(
      packageEntry("@scope/example@1.0.0") + packageEntry("example@2.0.0", otherIntegrity),
    ));
    expect([...result]).toEqual([
      ["@scope/example@1.0.0", integrity], ["example@2.0.0", otherIntegrity],
    ]);
  });

  it("rejects duplicate identities even with identical integrity", () => {
    expect(() => parseRetainedLockIdentities(lock(packageEntry("example@1.0.0").repeat(2))))
      .toThrow(/duplicate package/u);
  });

  it("rejects lock versions other than the reviewed 9.0 format", () => {
    expect(() => parseRetainedLockIdentities(lock(packageEntry("example@1.0.0"), "8.0")))
      .toThrow(/lock version/u);
  });

  it("rejects missing package integrity", () => {
    expect(() => parseRetainedLockIdentities(lock("  'example@1.0.0':\n    dev: true\n")))
      .toThrow(/missing integrity/u);
  });

  it("rejects non-inline resolution YAML", () => {
    expect(() => parseRetainedLockIdentities(lock(`  'example@1.0.0':\n    resolution:\n      integrity: ${integrity}\n`)))
      .toThrow(/unsupported or duplicate resolution/u);
  });

  it("rejects duplicated resolution fields", () => {
    expect(() => parseRetainedLockIdentities(lock(`${packageEntry("example@1.0.0")}    resolution: {integrity: ${integrity}}\n`)))
      .toThrow(/duplicate resolution/u);
  });

  it("rejects an empty lock identity set", () => {
    expect(() => parseRetainedLockIdentities(lock(""))).toThrow(/empty lock/u);
  });
});

describe("platform metadata summary", () => {
  it("keeps versions distinct and preserves the complete compound license", () => {
    const result = summarizeRetainedPlatformLicenseReport({
      [compoundLicense]: [platformRow(["1.0.0", "2.0.0"], compoundLicense)],
    });
    expect([...result]).toEqual([["example@1.0.0", compoundLicense], ["example@2.0.0", compoundLicense]]);
  });

  it("rejects an empty report", () => {
    expect(() => summarizeRetainedPlatformLicenseReport({})).toThrow(/empty platform/u);
  });

  it("rejects a duplicate package-version identity", () => {
    expect(() => summarizeRetainedPlatformLicenseReport({ MIT: [platformRow(), platformRow()] }))
      .toThrow(/duplicate platform/u);
  });

  it("rejects disagreement between bucket and row license", () => {
    expect(() => summarizeRetainedPlatformLicenseReport({ MIT: [platformRow(["1.0.0"], "ISC")] }))
      .toThrow(/license bucket/u);
  });

  it("requires one retained path per version", () => {
    expect(() => summarizeRetainedPlatformLicenseReport({ MIT: [{ ...platformRow(["1.0.0", "2.0.0"]), paths: ["/only-one"] }] }))
      .toThrow(/path mismatch/u);
  });
});

describe("exact-version registry declaration", () => {
  it("returns the full declared license expression, not an approval", () => {
    expect(validateRetainedRegistryDeclaration(registryFixture()))
      .toEqual({ identity: "@scope/example@1.0.0", license: compoundLicense });
  });

  it.each(["name", "version"] as const)("rejects inconsistent request %s", (field) => {
    const input = registryFixture();
    input.request[field] = field === "name" ? "@scope/other" : "2.0.0";
    expect(() => validateRetainedRegistryDeclaration(input)).toThrow(/request identity fields/u);
  });

  it.each([
    ["name", "@scope/other"], ["version", "2.0.0"], ["dist.integrity", otherIntegrity],
  ] as const)("rejects registry response %s drift", (field, value) => {
    const input = registryFixture();
    input.response[field] = value;
    expect(() => validateRetainedRegistryDeclaration(input)).toThrow(/locked identity\/integrity/u);
  });

  it.each([
    { exitCode: 1 }, { signal: "SIGKILL" }, { errorCode: "ETIMEDOUT" },
  ])("never accepts failed or interrupted receipt %j", (patch) => {
    const input = registryFixture();
    expect(() => validateRetainedRegistryDeclaration({ ...input, receipt: { ...input.receipt, ...patch } }))
      .toThrow();
  });

  it.each(["extra flag", "different requested version", "different registry"])(
    "rejects wrong argv: %s",
    (change) => {
      const input = registryFixture();
      if (change === "extra flag") input.receipt.args.push("--offline");
      if (change === "different requested version") input.receipt.args[12] = "@scope/example@2.0.0";
      if (change === "different registry") input.receipt.args[7] = "--config.registry=https://other.invalid";
      expect(() => validateRetainedRegistryDeclaration(input)).toThrow(/arguments drifted/u);
    },
  );

  it("rejects a receipt for a different identity", () => {
    const input = registryFixture();
    input.receipt.identity = "@scope/other@1.0.0";
    expect(() => validateRetainedRegistryDeclaration(input)).toThrow(/receipt identity/u);
  });

  it("rejects blank license declarations", () => {
    const input = registryFixture();
    input.response.license = "  ";
    expect(() => validateRetainedRegistryDeclaration(input)).toThrow(/declaration is blank/u);
  });
});

describe("raw-record semantic failures independent of archive pinning", () => {
  it.each([
    ["licenseApproval", "approved"], ["includesLicenseFullText", true],
    ["publicationEffect", "published"], ["outcome", "failed"],
  ] as const)("rejects changed full-run %s", (field, value) => {
    const files = changedJson(fullManifestPath, (record) => { record[field] = value; });
    expect(() => summarizeRetainedDependencyLicenseOutput(files)).toThrow();
  });

  it("does not count an explicitly incomplete installation", () => {
    const files = changedJson(fullManifestPath, (record) => {
      const states = z.array(objectSchema).parse(record.states);
      const first = states[0];
      if (first === undefined) throw new Error("Test needs the first state.");
      first.install = { ...objectSchema.parse(first.install), completed: false };
      record.states = states;
    });
    expect(() => summarizeRetainedDependencyLicenseOutput(files)).toThrow();
  });

  it("does not upgrade registry declarations to license approval", () => {
    const files = changedJson(registryManifestPath, (record) => { record.licenseApproval = "approved"; });
    expect(() => summarizeRetainedDependencyLicenseOutput(files)).toThrow();
  });

  it("does not count a failed completed-command record", () => {
    const files = changedJson(fullManifestPath, (record) => {
      const commands = z.array(objectSchema).parse(record.commands);
      const first = commands[0];
      if (first === undefined) throw new Error("Test needs the first command.");
      first.exitCode = 1;
      record.commands = commands;
    });
    expect(() => summarizeRetainedDependencyLicenseOutput(files)).toThrow();
  });

  it("requires raw process receipts in addition to manifest claims", () => {
    const files = new Map(rawFiles);
    files.delete("runs/04-completed-platform-installs/raw/S1-install.receipt.json");
    expect(() => summarizeRetainedDependencyLicenseOutput(files)).toThrow(/required raw file is missing/u);
  });

  it.each([
    ["S1-install", /install safety flags/u],
    ["S1-licenses-prod", /license command arguments/u],
  ] as const)("rejects a changed config prefix for %s even with a matching raw receipt", (label, message) => {
    let changedReceipt: Record<string, unknown> | undefined;
    const files = new Map(changedJson(fullManifestPath, (record) => {
      const commands = z.array(objectSchema).parse(record.commands);
      const command = commands.find((item) => item.label === label);
      if (command === undefined) throw new Error("Test needs the named command.");
      const args = z.array(z.string()).parse(command.args);
      expect(args).toContain("--config.registry=https://registry.npmjs.org");
      command.args = args.map((argument) => argument.startsWith("--config.registry=")
        ? "--config.registry=https://other.invalid"
        : argument);
      changedReceipt = command;
      record.commands = commands;
    }));
    if (changedReceipt === undefined) throw new Error("Test needs a mutated receipt.");
    files.set(`runs/04-completed-platform-installs/raw/${label}.receipt.json`,
      Buffer.from(JSON.stringify(changedReceipt), "utf8"));
    expect(() => summarizeRetainedDependencyLicenseOutput(files)).toThrow(message);
  });

  it("rejects duplicate registry requests despite a count of 175", () => {
    const files = changedJson(scopePath, (record) => {
      const requests = z.array(objectSchema).parse(record.requests);
      const first = requests[0];
      if (first === undefined) throw new Error("Test needs the first registry request.");
      requests[1] = { ...first };
      record.requests = requests;
    });
    expect(() => summarizeRetainedDependencyLicenseOutput(files)).toThrow(/duplicate registry request/u);
  });
});
