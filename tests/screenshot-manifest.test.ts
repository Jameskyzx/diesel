import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectDrizzleMigrationSourceTree,
  collectLocalSourceDependencyClosure,
  expectedScreenshotSourceFiles,
  fingerprintSourceFiles,
  parseScreenshotManifest,
  screenshotManifestPath,
  screenshotSpecifications,
  verifyScreenshotManifest,
} from "../scripts/portfolio/screenshot-manifest";

async function currentManifest() {
  const text = await readFile(resolve(process.cwd(), screenshotManifestPath), "utf8");
  return { manifest: parseScreenshotManifest(JSON.parse(text) as unknown), text };
}

const mapLibreScreenshotInputs = [
  "scripts/maplibre-worker-assets.ts",
  "public/maplibre/6.9.0/maplibre-gl-worker.mjs",
  "public/maplibre/6.9.0/maplibre-gl-shared.mjs",
  "public/maplibre/6.9.0/LICENSE.txt",
  "public/maplibre/6.9.0/THIRD-PARTY-NOTICES.txt",
] as const;

// Synthetic evidence fixture only: reuse image bytes, never claim a new capture.
async function mapLibreScreenshotFixture() {
  const workspace = await mkdtemp(join(tmpdir(), "diesel-screenshot-maplibre-"));
  const { manifest } = await currentManifest();
  for (const file of new Set(screenshotSpecifications.flatMap(({ sourceEntrypoints }) => sourceEntrypoints))) {
    await mkdir(dirname(resolve(workspace, file)), { recursive: true });
    await writeFile(resolve(workspace, file), "");
  }
  await mkdir(resolve(workspace, "drizzle"));
  await writeFile(resolve(workspace, "drizzle/0000_fixture.sql"), "-- fixture\n");
  await mkdir(resolve(workspace, "src/lib"), { recursive: true });
  await writeFile(resolve(workspace, "src/lib/maplibre-assets.ts"), 'export const version = "fixture";\n');
  await writeFile(resolve(workspace, "scripts/maplibre-worker-assets.ts"), 'import "../src/lib/maplibre-assets";\n');
  await writeFile(resolve(workspace, "next.config.ts"), 'import "./scripts/maplibre-worker-assets";\n');
  for (const [index, asset] of manifest.assets.entries()) {
    await mkdir(dirname(resolve(workspace, asset.path)), { recursive: true });
    await writeFile(resolve(workspace, asset.path), await readFile(resolve(process.cwd(), asset.path)));
    asset.sourceFiles = await expectedScreenshotSourceFiles(workspace, index);
    asset.sourceFingerprint = await fingerprintSourceFiles(workspace, asset.sourceFiles);
  }
  return { workspace, manifest };
}

describe("portfolio screenshot manifest", () => {
  it("recomputes canonical asset bytes, dimensions, and complete source fingerprints", async () => {
    const { text } = await currentManifest();
    await expect(verifyScreenshotManifest(process.cwd(), text)).resolves.toBeUndefined();
  });

  it("includes transitive page and chat dependencies omitted by the old root list", async () => {
    const [homeSources, chatSources] = await Promise.all([
      expectedScreenshotSourceFiles(process.cwd(), 0),
      expectedScreenshotSourceFiles(process.cwd(), 1),
    ]);

    expect(homeSources).toEqual(
      expect.arrayContaining([
        "drizzle/0000_initial_schema.sql",
        "drizzle/0013_archived_product_power_constraint.sql",
        "drizzle/meta/_journal.json",
        "next.config.ts",
        "patches/next@16.3.3.patch",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "postcss.config.mjs",
        "public/og.jpg",
        ...mapLibreScreenshotInputs,
        "scripts/format-error.ts",
        "scripts/next-environment-file.ts",
        "src/app/globals.css",
        "src/components/ui/button.tsx",
        "src/i18n/dictionaries.ts",
        "src/lib/utils.ts",
        "src/lib/maplibre-assets.ts",
      ]),
    );
    expect(chatSources).toEqual(
      expect.arrayContaining([
        "drizzle/0000_initial_schema.sql",
        "drizzle/0013_archived_product_power_constraint.sql",
        "drizzle/meta/_journal.json",
        ...mapLibreScreenshotInputs,
        "scripts/format-error.ts",
        "scripts/next-environment-file.ts",
        "src/components/ui/button.tsx",
        "src/features/ai/chat-url-context.ts",
        "src/lib/utils.ts",
        "src/lib/maplibre-assets.ts",
      ]),
    );

  });

  it.each([...mapLibreScreenshotInputs, "patches/next@16.3.3.patch"])("rejects screenshot evidence after %s changes", async (file) => {
    const { workspace, manifest } = await mapLibreScreenshotFixture();
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    await expect(verifyScreenshotManifest(workspace, text)).resolves.toBeUndefined();
    await writeFile(resolve(workspace, file), `${await readFile(resolve(workspace, file), "utf8")}\n// changed fixture\n`);
    await expect(verifyScreenshotManifest(workspace, text)).rejects.toThrow("Screenshot source drift");
  });

  it("does not allow neighboring scripts through the exact MapLibre dependency allowance", async () => {
    const { workspace } = await mapLibreScreenshotFixture();
    await writeFile(resolve(workspace, "scripts/maplibre-worker-assets-other.ts"), "export {};\n");
    await writeFile(resolve(workspace, "next.config.ts"), 'import "./scripts/maplibre-worker-assets-other";\n');
    await expect(expectedScreenshotSourceFiles(workspace, 0)).rejects.toThrow("outside allowed screenshot sources");
  });

  it("invalidates the fingerprint when a dynamically loaded migration changes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "diesel-screenshot-drizzle-"));
    await mkdir(resolve(workspace, "drizzle/meta"), { recursive: true });
    const migration = resolve(workspace, "drizzle/0000_initial.sql");
    await writeFile(migration, "select 1;\n");
    await writeFile(
      resolve(workspace, "drizzle/meta/_journal.json"),
      '{"entries":[]}\n',
    );

    const sources = await collectDrizzleMigrationSourceTree(workspace);
    const before = await fingerprintSourceFiles(workspace, sources);
    await writeFile(migration, "select 2;\n");

    expect(sources).toEqual([
      "drizzle/0000_initial.sql",
      "drizzle/meta/_journal.json",
    ]);
    await expect(fingerprintSourceFiles(workspace, sources)).resolves.not.toBe(
      before,
    );
  });

  it("rejects the legacy NUL-delimiter re-framing across two binary files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "diesel-screenshot-framing-"));
    await mkdir(resolve(workspace, "src"), { recursive: true });
    const firstPath = "src/a.png";
    const secondPath = "src/b.png";
    const first = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    const middle = Buffer.from([0xff, 0x00, 0x7f, 0x42]);
    const last = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0x00]);
    const legacyDelimiter = Buffer.from(`\0${secondPath}\0`, "utf8");
    const legacyInput = (
      firstContents: Buffer,
      secondContents: Buffer,
    ): Buffer => Buffer.concat([
      Buffer.from(`${firstPath}\0`, "utf8"),
      firstContents,
      Buffer.from(`\0${secondPath}\0`, "utf8"),
      secondContents,
      Buffer.from("\0", "utf8"),
    ]);

    const beforeFirst = first;
    const beforeSecond = Buffer.concat([middle, legacyDelimiter, last]);
    await writeFile(resolve(workspace, firstPath), beforeFirst);
    await writeFile(resolve(workspace, secondPath), beforeSecond);
    const before = await fingerprintSourceFiles(workspace, [firstPath, secondPath]);

    const afterFirst = Buffer.concat([first, legacyDelimiter, middle]);
    const afterSecond = last;
    expect(legacyInput(beforeFirst, beforeSecond)).toEqual(
      legacyInput(afterFirst, afterSecond),
    );
    await writeFile(resolve(workspace, firstPath), afterFirst);
    await writeFile(resolve(workspace, secondPath), afterSecond);

    await expect(
      fingerprintSourceFiles(workspace, [firstPath, secondPath]),
    ).resolves.not.toBe(before);
  });

  it("changes the fingerprint when a transitive dependency changes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "diesel-screenshot-graph-"));
    await mkdir(resolve(workspace, "src/fixture"), { recursive: true });
    await writeFile(
      resolve(workspace, "src/fixture/entry.ts"),
      'import { value } from "./middle";\nexport const result = value;\n',
    );
    await writeFile(
      resolve(workspace, "src/fixture/middle.ts"),
      'export { value } from "./leaf";\n',
    );
    const leaf = resolve(workspace, "src/fixture/leaf.ts");
    await writeFile(leaf, 'export const value = "before";\n');

    const sources = await collectLocalSourceDependencyClosure(workspace, [
      "src/fixture/entry.ts",
    ]);
    const before = await fingerprintSourceFiles(workspace, sources);
    await writeFile(leaf, 'export const value = "after";\n');

    expect(sources).toEqual([
      "src/fixture/entry.ts",
      "src/fixture/leaf.ts",
      "src/fixture/middle.ts",
    ]);
    await expect(fingerprintSourceFiles(workspace, sources)).resolves.not.toBe(
      before,
    );
  });

  it("handles cycles once and fails closed on unresolved local imports", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "diesel-screenshot-cycle-"));
    await mkdir(resolve(workspace, "src/fixture"), { recursive: true });
    await writeFile(
      resolve(workspace, "src/fixture/a.ts"),
      'import "./b";\nexport const a = true;\n',
    );
    await writeFile(
      resolve(workspace, "src/fixture/b.ts"),
      'import "./a";\nexport const b = true;\n',
    );

    await expect(
      collectLocalSourceDependencyClosure(workspace, ["src/fixture/a.ts"]),
    ).resolves.toEqual(["src/fixture/a.ts", "src/fixture/b.ts"]);

    await writeFile(
      resolve(workspace, "src/fixture/b.ts"),
      'import "./missing";\nexport const b = true;\n',
    );
    await expect(
      collectLocalSourceDependencyClosure(workspace, ["src/fixture/a.ts"]),
    ).rejects.toThrow('Unresolved local import "./missing"');
  });

  it.each([
    ["extra fields", (manifest: Record<string, unknown>) => ({ ...manifest, unexpected: true })],
    ["missing fields", (manifest: Record<string, unknown>) => ({ version: manifest.version })],
    ["canonical asset identity", (manifest: Record<string, unknown>) => ({ ...manifest, assets: (manifest.assets as object[]).map((asset, index) => index === 0 ? { ...asset, path: "public/portfolio/other.jpg" } : asset) })],
    ["canonical route", (manifest: Record<string, unknown>) => ({ ...manifest, assets: (manifest.assets as object[]).map((asset, index) => index === 0 ? { ...asset, route: "/map" } : asset) })],
    ["canonical viewport", (manifest: Record<string, unknown>) => ({ ...manifest, assets: (manifest.assets as object[]).map((asset, index) => index === 0 ? { ...asset, viewport: { height: 900, width: 1440 } } : asset) })],
    ["unsafe source paths", (manifest: Record<string, unknown>) => ({ ...manifest, assets: (manifest.assets as object[]).map((asset, index) => index === 0 ? { ...asset, sourceFiles: ["../secret"] } : asset) })],
    ["non-ISO capture time", (manifest: Record<string, unknown>) => ({ ...manifest, assets: (manifest.assets as object[]).map((asset, index) => index === 0 ? { ...asset, capturedAt: "0" } : asset) })],
  ])("rejects %s", async (_label, mutate) => {
    const { manifest } = await currentManifest();
    expect(() => parseScreenshotManifest(mutate(manifest as unknown as Record<string, unknown>))).toThrow();
  });

  it.each([
    ["hash drift", (manifest: Awaited<ReturnType<typeof currentManifest>>["manifest"]) => { manifest.assets[0]!.sha256 = "0".repeat(64); }],
    ["dimension drift", (manifest: Awaited<ReturnType<typeof currentManifest>>["manifest"]) => { manifest.assets[0]!.width += 1; }],
    ["source inventory drift", (manifest: Awaited<ReturnType<typeof currentManifest>>["manifest"]) => { manifest.assets[0]!.sourceFiles.pop(); }],
    ["source fingerprint drift", (manifest: Awaited<ReturnType<typeof currentManifest>>["manifest"]) => { manifest.assets[0]!.sourceFingerprint = "0".repeat(64); }],
  ])("rejects %s", async (_label, mutate) => {
    const { manifest } = await currentManifest();
    mutate(manifest);
    await expect(verifyScreenshotManifest(process.cwd(), `${JSON.stringify(manifest, null, 2)}\n`)).rejects.toThrow();
  });

  it("rejects non-canonical and duplicate-key JSON", async () => {
    const { manifest } = await currentManifest();
    await expect(verifyScreenshotManifest(process.cwd(), JSON.stringify(manifest))).rejects.toThrow("canonical JSON");
    const duplicate = `${JSON.stringify(manifest, null, 2).replace('"version": 2', '"version": 2,\n  "version": 2')}\n`;
    await expect(verifyScreenshotManifest(process.cwd(), duplicate)).rejects.toThrow("canonical JSON");
  });
});
