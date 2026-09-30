import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const helper = resolve("scripts/deploy/archive-unarmed-release.mjs");
const shell = resolve("scripts/deploy/archive-unarmed-release.sh");
const failed = "9cbeeef340ca7570b7f84175451383363acc42bb";
const previous = "5b35ced1e6e52ca1df9fec9d46f355b73b033ec6";
const controller = "a".repeat(40);
const roots: string[] = [];
type Driver = (controller: string, mode: "--check" | "--apply") => Record<string, unknown>;
const archiveModule = await import(pathToFileURL(helper).href) as {
  createArchiveFixtureDriver(root: string, nginx: string, hash: string, checkpoint?: (name: string) => void): Driver;
};

function file(path: string, value: string, mode = 0o600) {
  writeFileSync(path, value, { mode });
  chmodSync(path, mode);
}

function fixture(checkpoint?: (name: string) => void) {
  const outer = realpathSync(mkdtempSync(join(tmpdir(), "diesel-unarmed-")));
  roots.push(outer);
  const root = join(outer, "deploy");
  const nginx = join(outer, "nginx");
  const backups = join(root, "backups");
  const state = join(backups, failed);
  for (const [path, mode] of [
    [root, 0o755], [nginx, 0o755], [backups, 0o700], [state, 0o700],
    [join(root, "releases"), 0o755], [join(root, "releases", failed), 0o750],
    [join(root, "releases", previous), 0o750], [join(root, "shared"), 0o750],
    [join(root, "host-migrations"), 0o700],
  ] as const) {
    mkdirSync(path);
    chmodSync(path, mode);
  }
  const protocol = join(backups, "HOST_ACTIVATION_PROTOCOL_V1");
  const protocolBytes = "immutable fixture protocol\n";
  file(protocol, protocolBytes);
  file(join(root, ".release-lifecycle.lock"), "");
  file(join(root, ".release-build.lock"), "");
  file(join(state, "previous-release"), `${join(root, "releases", previous)}\n`);
  file(join(state, "env.production.local.pre-switch"), "PRIVATE_FIXTURE_DO_NOT_LOG=value\n");
  file(join(state, "jamesky.site.pre-switch"), "primary\n");
  file(join(state, "diesel-demo.pre-switch"), "alternate\n");
  file(join(root, "shared", ".env.production.local"), "PRIVATE_FIXTURE_DO_NOT_LOG=value\n", 0o640);
  file(join(nginx, "jamesky.site"), "primary\n", 0o644);
  file(join(nginx, "diesel-demo"), "alternate\n", 0o644);
  symlinkSync(join(root, "releases", previous), join(root, "current"));
  const archive = join(root, "host-migrations", "20260930-unarmed-9cbeeef");
  const guard = join(backups, ".unarmed-archive-in-progress");
  const driver = archiveModule.createArchiveFixtureDriver(root, nginx,
    createHash("sha256").update(protocolBytes).digest("hex"), checkpoint);
  return { root, nginx, backups, state, protocol, archive, guard, driver };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("incident-specific never-activated archival", () => {
  it("checks without writing, moving or modifying any backup", () => {
    const f = fixture();
    const before = lstatSync(f.state);
    const result = f.driver(controller, "--check");
    expect(result.action).toBe("check-only");
    expect(lstatSync(f.state).ino).toBe(before.ino);
    expect(readdirSync(join(f.root, "host-migrations"))).toEqual([]);
    expect(readdirSync(f.backups).sort()).toEqual([failed, "HOST_ACTIVATION_PROTOCOL_V1"].sort());
    expect(JSON.stringify(result)).not.toContain("PRIVATE_FIXTURE_DO_NOT_LOG");
  });

  it("retains original inodes, an independent byte-equal copy and an honest receipt", () => {
    const f = fixture();
    const protocolBefore = lstatSync(f.protocol, { bigint: true });
    const before = Object.fromEntries(readdirSync(f.state).map((name) => [name, {
      bytes: readFileSync(join(f.state, name)), inode: lstatSync(join(f.state, name)).ino,
    }]));
    expect(f.driver(controller, "--apply")).toMatchObject({
      action: "archived-without-activation", originalsPreserved: true, independentCopyVerified: true,
    });
    expect(readdirSync(f.backups)).toEqual(["HOST_ACTIVATION_PROTOCOL_V1"]);
    const protocolAfter = lstatSync(f.protocol, { bigint: true });
    for (const key of ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"] as const)
      expect(protocolAfter[key]).toBe(protocolBefore[key]);
    for (const [name, value] of Object.entries(before)) {
      const original = join(f.archive, "originals", name);
      const copy = join(f.archive, "independent-copy", name);
      expect(readFileSync(original)).toEqual(value.bytes);
      expect(readFileSync(copy)).toEqual(value.bytes);
      expect(lstatSync(original).ino).toBe(value.inode);
      expect(lstatSync(copy).ino).not.toBe(value.inode);
      expect(lstatSync(copy).mode & 0o777).toBe(0o600);
    }
    const receipt = readFileSync(join(f.archive, "archived.json"), "utf8");
    expect(receipt).toContain('"classification": "never-activated"');
    expect(receipt).not.toMatch(/PRIVATE_FIXTURE_DO_NOT_LOG|ROLLED_BACK|PUBLISH_FINALIZED/u);
    expect(() => f.driver(controller, "--apply")).toThrow();
  });

  it.each(["HOST_ACTIVATION_V1", "HOST_ACTIVATION_PENDING", "HOST_ACTIVATION_COMMITTED",
    "HOST_ACTIVATION_ROLLED_BACK", "PUBLISH_COMMITTED", "RECOVERY_REQUIRED",
    "governance-before.json", "unexpected", ".temporary"])("refuses extra state %s before any writes", (name) => {
    const f = fixture();
    file(join(f.state, name), "untrusted\n");
    expect(() => f.driver(controller, "--apply")).toThrow(/four-file/u);
    expect(readdirSync(join(f.root, "host-migrations"))).toEqual([]);
    expect(readdirSync(f.backups)).not.toContain(".unarmed-archive-in-progress");
  });

  it.each(["environment", "primary nginx", "alternate nginx", "protocol", "previous release"])(
    "refuses %s drift without touching originals", (kind) => {
      const f = fixture();
      const path = {
        environment: join(f.root, "shared", ".env.production.local"),
        "primary nginx": join(f.nginx, "jamesky.site"),
        "alternate nginx": join(f.nginx, "diesel-demo"),
        protocol: f.protocol,
        "previous release": join(f.state, "previous-release"),
      }[kind]!;
      writeFileSync(path, "drift\n");
      expect(() => f.driver(controller, "--apply")).toThrow();
      expect(readdirSync(f.state)).toHaveLength(4);
      expect(readdirSync(join(f.root, "host-migrations"))).toEqual([]);
    },
  );

  it.each([".build-complete", ".deploy-ready", ".next", "node_modules"])("refuses a built candidate: %s", (name) => {
    const f = fixture();
    file(join(f.root, "releases", failed, name), "exists\n");
    expect(() => f.driver(controller, "--apply")).toThrow();
    expect(readdirSync(join(f.root, "host-migrations"))).toEqual([]);
  });

  it.each(["symlink", "hardlink", "mode"])("rejects unsafe basis %s", (kind) => {
    const f = fixture();
    const path = join(f.state, "jamesky.site.pre-switch");
    if (kind === "mode") chmodSync(path, 0o644);
    else {
      rmSync(path);
      const target = join(f.nginx, "jamesky.site");
      if (kind === "symlink") symlinkSync(target, path);
      else linkSync(target, path);
    }
    expect(() => f.driver(controller, "--apply")).toThrow();
  });

  it.each(["guard-durable", "copy-durable", "originals-renamed", "receipt-durable"])(
    "fails closed on interruption at %s and never loses the originals", (point) => {
      const f = fixture((name) => { if (name === point) throw new Error("simulated interruption"); });
      const originalInode = lstatSync(join(f.state, "previous-release")).ino;
      expect(() => f.driver(controller, "--apply")).toThrow("simulated interruption");
      expect(lstatSync(f.guard).mode & 0o777).toBe(0o600);
      const location = ["originals-renamed", "receipt-durable"].includes(point)
        ? join(f.archive, "originals") : f.state;
      expect(lstatSync(join(location, "previous-release")).ino).toBe(originalInode);
      expect(() => f.driver(controller, "--check")).toThrow();
    },
  );

  it("does not accept an inherited recovery guard or existing archive", () => {
    for (const kind of ["guard", "archive"] as const) {
      const f = fixture();
      if (kind === "guard") file(f.guard, "unknown operation\n");
      else mkdirSync(f.archive);
      expect(() => f.driver(controller, "--apply")).toThrow();
      expect(readdirSync(f.state)).toHaveLength(4);
    }
  });

  it.each(["copy", "live", "protocol", "basis", "current"])(
    "retains guard and originals if %s changes during copying", (kind) => {
      const f = fixture((point) => {
        if (point !== "copy-durable") return;
        if (kind === "current") {
          rmSync(join(f.root, "current"));
          symlinkSync(join(f.root, "releases", failed), join(f.root, "current"));
          return;
        }
        const target = {
          copy: join(f.archive, "independent-copy", "previous-release"),
          live: join(f.nginx, "jamesky.site"),
          protocol: f.protocol,
          basis: join(f.state, "previous-release"),
        }[kind as "copy" | "live" | "protocol" | "basis"];
        writeFileSync(target, "drift\n");
      });
      expect(() => f.driver(controller, "--apply")).toThrow();
      expect(readdirSync(f.state)).toHaveLength(4);
      expect(lstatSync(f.guard).isFile()).toBe(true);
    },
  );

  it("rejects a current.next link, unsafe locks and foreign backup states", () => {
    for (const kind of ["next", "lock", "foreign"] as const) {
      const f = fixture();
      if (kind === "next") symlinkSync(join(f.root, "releases", failed), join(f.root, "current.next"));
      else if (kind === "lock") chmodSync(join(f.root, ".release-build.lock"), 0o644);
      else mkdirSync(join(f.backups, "b".repeat(40)));
      expect(() => f.driver(controller, "--apply")).toThrow();
    }
  });

  it.each([[], [controller], [controller, "--reset"], [failed, "--apply"], [controller, "--apply", "/tmp"]].map((args) => ({ args })))(
    "refuses an invalid or nonproduction public invocation $args", async ({ args }) => {
      await expect(promisify(execFile)("bash", [shell, ...args])).rejects.toThrow();
    },
  );

  it("requires the fixed runtime and production script path for the helper CLI", async () => {
    await expect(promisify(execFile)(process.execPath, [helper, controller, "--apply"]))
      .rejects.toThrow();
  });
});
