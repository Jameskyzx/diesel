import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertMapLibreWorkerAssets,
  assertSelfContainedMapLibreWorker,
  mapLibreWorkerNoticeSources,
  parseMapLibreWorkerAssetArgs,
  prepareMapLibreWorkerAssets,
} from "../scripts/maplibre-worker-assets";
import { MAPLIBRE_VERSION, MAPLIBRE_WORKER_URL } from "../src/lib/maplibre-assets";

const workspaces: string[] = [];
const fixtureFiles = [
  ["dist/maplibre-gl-worker.mjs", "maplibre-gl-worker.mjs", "async function plugin(e){await import(e)}export{plugin as default};\n"],
  ["LICENSE.txt", "LICENSE.txt", "Upstream license fixture\r\n\u00a9 preserved\n"],
] as const;
const noticesFile = "THIRD-PARTY-NOTICES.txt";

function noticeRoot(workspace: string, name: string) {
  return resolve(workspace, "node_modules", name);
}

function writeSourceMap(path: string, sources: readonly string[], sourcesContent: readonly string[]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 3, sources, sourcesContent }));
}

function fixture(version: string = MAPLIBRE_VERSION) {
  const workspace = mkdtempSync(resolve(tmpdir(), "diesel-maplibre-assets-"));
  workspaces.push(workspace);
  const packageRoot = resolve(workspace, "node_modules/maplibre-gl");
  const publicRoot = resolve(workspace, "public");
  const versionRoot = resolve(publicRoot, "maplibre", MAPLIBRE_VERSION);
  mkdirSync(resolve(packageRoot, "dist"), { recursive: true });
  mkdirSync(publicRoot);
  writeFileSync(resolve(workspace, "package.json"), "{}\n");
  writeFileSync(resolve(packageRoot, "package.json"), JSON.stringify({ name: "maplibre-gl", version }));
  for (const [source, , bytes] of fixtureFiles) {
    writeFileSync(resolve(packageRoot, source), bytes);
  }
  for (const source of mapLibreWorkerNoticeSources) {
    const root = noticeRoot(workspace, source.name);
    mkdirSync(root, { recursive: true });
    writeFileSync(resolve(root, "package.json"), JSON.stringify({ name: source.name, version: source.version }));
    writeFileSync(resolve(root, source.file),
      `${source.readmeSection ? "# Fixture README\n\n## License (MIT)\n" : ""}Copyright fixture for ${source.name}\r\nPermission and disclaimer preserved.\n`);
    writeFileSync(resolve(root, "bundled.js"), `// bundled ${source.name}\n`);
  }
  const topLevel = mapLibreWorkerNoticeSources.filter(({ name }) => name !== "kdbush" && name !== "quickselect");
  const workerSources = topLevel.map(({ name }) => `../node_modules/${name}/bundled.js`);
  const workerContent = topLevel.map(({ name }) => `// bundled ${name}\n`);
  const styleRoot = noticeRoot(workspace, "@maplibre/maplibre-gl-style-spec");
  for (const name of ["@mapbox/unitbezier", "quickselect", "tinyqueue"]) {
    const relative = `dist/node_modules/${name}/bundled.mjs`;
    const path = resolve(styleRoot, relative);
    const contents = `// nested ${name}\n`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    workerSources.push(`../node_modules/@maplibre/maplibre-gl-style-spec/${relative}`);
    workerContent.push(contents);
  }
  writeSourceMap(resolve(packageRoot, "dist/maplibre-gl-worker.mjs.map"), workerSources, workerContent);
  writeSourceMap(resolve(noticeRoot(workspace, "@maplibre/geojson-vt"), "dist/geojson-vt.mjs.map"),
    ["../node_modules/kdbush/bundled.js"], ["// bundled kdbush\n"]);
  writeSourceMap(resolve(noticeRoot(workspace, "@maplibre/vt-pbf"), "dist/index.es.js.map"), [], []);
  return { workspace, packageRoot, publicRoot, versionRoot };
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("versioned MapLibre worker assets", () => {
  it("pins the same-origin ESM worker and verifies the real installed assets", () => {
    expect(MAPLIBRE_VERSION).toBe("6.14.0");
    expect(MAPLIBRE_WORKER_URL).toBe("/maplibre/6.14.0/maplibre-gl-worker.mjs");
    expect(mapLibreWorkerNoticeSources).toHaveLength(16);
    expect(() => assertMapLibreWorkerAssets()).not.toThrow();
  });

  it("defaults to verification and accepts only one explicit operation", () => {
    expect(parseMapLibreWorkerAssetArgs([])).toBe("verify");
    expect(parseMapLibreWorkerAssetArgs(["--verify"])).toBe("verify");
    expect(parseMapLibreWorkerAssetArgs(["--write"])).toBe("write");
    for (const args of [["--force"], ["--write", "--write"], ["--verify", "--write"], ["--write", "elsewhere"]]) {
      expect(() => parseMapLibreWorkerAssetArgs(args)).toThrow();
    }
  });

  it("copies the unmodified worker and the complete license only on explicit prepare", () => {
    const { workspace, packageRoot, publicRoot, versionRoot } = fixture();
    expect(() => assertMapLibreWorkerAssets(workspace)).toThrow();
    expect(readdirSync(publicRoot)).toEqual([]);
    prepareMapLibreWorkerAssets(workspace);
    const expectedNames = [...fixtureFiles.map(([, target]) => target), noticesFile].sort();
    expect(readdirSync(versionRoot).sort()).toEqual(expectedNames);
    const before = expectedNames.map((target) => lstatSync(resolve(versionRoot, target)).mtimeMs);
    assertMapLibreWorkerAssets(workspace);
    for (const [source, target] of fixtureFiles) {
      expect(readFileSync(resolve(versionRoot, target))).toEqual(readFileSync(resolve(packageRoot, source)));
    }
    expect(expectedNames.map((target) => lstatSync(resolve(versionRoot, target)).mtimeMs)).toEqual(before);
  });

  it("retains all 16 original notice texts in fixed order without asserting upstream build versions", () => {
    const { workspace, versionRoot } = fixture();
    prepareMapLibreWorkerAssets(workspace);
    const notices = readFileSync(resolve(versionRoot, noticesFile));
    let previousSection = -1;
    for (const source of mapLibreWorkerNoticeSources) {
      const section = notices.indexOf(Buffer.from(`===== ${source.name} | installed notice source ${source.version} | ${source.file}`));
      expect(section).toBeGreaterThan(previousSection);
      previousSection = section;
      const original = readFileSync(resolve(noticeRoot(workspace, source.name), source.file));
      const retained = source.readmeSection ? original.subarray(original.indexOf("## License (MIT)\n")) : original;
      expect(notices.includes(retained)).toBe(true);
    }
    expect(notices.toString("utf8")).toContain("not proof of upstream bundle build versions");
    expect(notices.toString("utf8")).not.toContain("# Fixture README");
  });

  it("detects a changed generated notice and does not repair it", () => {
    const { workspace, versionRoot } = fixture();
    prepareMapLibreWorkerAssets(workspace);
    const path = resolve(versionRoot, noticesFile);
    writeFileSync(path, "changed notice");
    expect(() => assertMapLibreWorkerAssets(workspace)).toThrow(/differs/);
    expect(readFileSync(path, "utf8")).toBe("changed notice");
  });

  it("recomputes notices from current source bytes and rejects source identity drift", () => {
    const { workspace } = fixture();
    prepareMapLibreWorkerAssets(workspace);
    const root = noticeRoot(workspace, "bidi-js");
    writeFileSync(resolve(root, "LICENSE.txt"), "updated notice");
    expect(() => assertMapLibreWorkerAssets(workspace)).toThrow(/differs/);
    writeFileSync(resolve(root, "package.json"), JSON.stringify({ name: "bidi-js", version: "1.1.1" }));
    expect(() => assertMapLibreWorkerAssets(workspace)).toThrow();
  });

  it.each(["missing", "empty", "symlink"] as const)("fails before writing when an installed notice is %s", (kind) => {
    const { workspace, packageRoot, publicRoot } = fixture();
    const path = resolve(noticeRoot(workspace, "bidi-js"), "LICENSE.txt");
    rmSync(path);
    if (kind === "empty") writeFileSync(path, "");
    if (kind === "symlink") symlinkSync(resolve(packageRoot, "LICENSE.txt"), path);
    expect(() => prepareMapLibreWorkerAssets(workspace)).toThrow();
    expect(readdirSync(publicRoot)).toEqual([]);
  });

  it("rejects an absent or ambiguous README license section", () => {
    const { workspace, publicRoot } = fixture();
    const path = resolve(noticeRoot(workspace, "murmurhash-js"), "README.md");
    for (const contents of ["no license marker", "## License (MIT)\nfirst\n## License (MIT)\nsecond\n"]) {
      writeFileSync(path, contents);
      expect(() => prepareMapLibreWorkerAssets(workspace)).toThrow(/README license section/);
      expect(readdirSync(publicRoot)).toEqual([]);
    }
  });

  it("rejects a new nested bundled package without resolving its files", () => {
    const { workspace, packageRoot, publicRoot } = fixture();
    writeSourceMap(resolve(packageRoot, "dist/maplibre-gl-worker.mjs.map"),
      ["../node_modules/@maplibre/maplibre-gl-style-spec/dist/node_modules/unreviewed/index.mjs"], ["unreviewed"]);
    expect(() => prepareMapLibreWorkerAssets(workspace)).toThrow(/Unreviewed MapLibre bundled package/);
    expect(readdirSync(publicRoot)).toEqual([]);
  });

  it("requires the nested geojson-vt kdbush source as well as the top-level maps", () => {
    const { workspace, publicRoot } = fixture();
    writeSourceMap(resolve(noticeRoot(workspace, "@maplibre/geojson-vt"), "dist/geojson-vt.mjs.map"), [], []);
    expect(() => prepareMapLibreWorkerAssets(workspace)).toThrow(/package set differs/);
    expect(readdirSync(publicRoot)).toEqual([]);
  });

  it.each([
    ["a static named import", "import{a as b}from\"./maplibre-gl-shared.mjs\";self.worker=b;"],
    ["a side-effect import", "/** banner */\nimport\"./maplibre-gl-shared.mjs\";"],
    ["a namespace import", "import * as s from './maplibre-gl-shared.mjs';"],
    ["a re-export", "export{a}from\"./maplibre-gl-shared.mjs\";"],
    ["a star re-export", "export * from './chunk.mjs';"],
    ["a literal dynamic import", "async function f(){await import(\"./chunk.mjs\")}"],
  ])("rejects a worker that loads another module through %s", (_kind, worker) => {
    expect(() => assertSelfContainedMapLibreWorker(Buffer.from(worker))).toThrow(/imports another module/);
    const { workspace, packageRoot, publicRoot } = fixture();
    writeFileSync(resolve(packageRoot, "dist/maplibre-gl-worker.mjs"), worker);
    expect(() => prepareMapLibreWorkerAssets(workspace)).toThrow(/imports another module/);
    expect(readdirSync(publicRoot)).toEqual([]);
  });

  it("accepts the worker's variable plugin import and import wording in strings", () => {
    for (const worker of [
      "async function LS(e){if(e.endsWith(`.mjs`)){await import(\n/* @vite-ignore */\ne);return}}",
      "Error(`RTL Text Plugin failed to import scripts from ${n}`);/^[ \\t]*(import|export)\\s/m.test(n);",
      "export{RS as default};\n//# sourceMappingURL=maplibre-gl-worker.mjs.map\n",
    ]) {
      expect(() => assertSelfContainedMapLibreWorker(Buffer.from(worker))).not.toThrow();
    }
  });

  it("rejects embedded source content that differs from the installed source", () => {
    const { workspace, packageRoot, publicRoot } = fixture();
    writeSourceMap(resolve(packageRoot, "dist/maplibre-gl-worker.mjs.map"),
      ["../node_modules/@maplibre/maplibre-gl-style-spec/bundled.js"], ["different embedded source"]);
    expect(() => prepareMapLibreWorkerAssets(workspace)).toThrow(/bundled source differs/);
    expect(readdirSync(publicRoot)).toEqual([]);
  });

  it.each(fixtureFiles)("rejects changed bytes in %s without repairing them", (_source, target) => {
    const { workspace, versionRoot } = fixture();
    prepareMapLibreWorkerAssets(workspace);
    const path = resolve(versionRoot, target);
    writeFileSync(path, "changed\n");
    expect(() => assertMapLibreWorkerAssets(workspace)).toThrow(/differs/);
    expect(readFileSync(path, "utf8")).toBe("changed\n");
  });

  it("rejects installed version drift before creating any asset directory", () => {
    const { workspace, publicRoot } = fixture("6.4.0");
    expect(() => prepareMapLibreWorkerAssets(workspace)).toThrow();
    expect(() => assertMapLibreWorkerAssets(workspace)).toThrow();
    expect(readdirSync(publicRoot)).toEqual([]);
  });

  it("requires every installed source before writing any asset", () => {
    const { workspace, packageRoot, publicRoot } = fixture();
    rmSync(resolve(packageRoot, "LICENSE.txt"));
    expect(() => prepareMapLibreWorkerAssets(workspace)).toThrow(/regular/);
    expect(readdirSync(publicRoot)).toEqual([]);
  });

  it.each(["empty directory", "unknown file", "symlink"] as const)("does not overwrite an existing version path: %s", (kind) => {
    const { workspace, publicRoot, versionRoot } = fixture();
    mkdirSync(resolve(publicRoot, "maplibre"));
    if (kind === "empty directory") mkdirSync(versionRoot);
    if (kind === "unknown file") writeFileSync(versionRoot, "unknown");
    if (kind === "symlink") symlinkSync(publicRoot, versionRoot, "dir");
    const before = lstatSync(versionRoot);
    expect(() => prepareMapLibreWorkerAssets(workspace)).toThrow(/Refusing to overwrite/);
    expect(lstatSync(versionRoot).ino).toBe(before.ino);
    expect(readdirSync(publicRoot)).toEqual(["maplibre"]);
  });

  it("rejects a symlinked output parent rather than writing through it", () => {
    const { workspace, packageRoot, publicRoot } = fixture();
    symlinkSync(packageRoot, resolve(publicRoot, "maplibre"), "dir");
    expect(() => prepareMapLibreWorkerAssets(workspace)).toThrow(/non-symlink directory/);
    expect(lstatSync(resolve(packageRoot, MAPLIBRE_VERSION), { throwIfNoEntry: false })).toBeUndefined();
  });

  it("rejects missing, extra, and symlinked tracked assets", () => {
    const { workspace, packageRoot, versionRoot } = fixture();
    prepareMapLibreWorkerAssets(workspace);
    const workerPath = resolve(versionRoot, "maplibre-gl-worker.mjs");
    rmSync(workerPath);
    expect(() => assertMapLibreWorkerAssets(workspace)).toThrow(/exactly/);
    symlinkSync(resolve(packageRoot, "dist/maplibre-gl-worker.mjs"), workerPath);
    expect(() => assertMapLibreWorkerAssets(workspace)).toThrow(/regular/);
    rmSync(workerPath);
    writeFileSync(workerPath, readFileSync(resolve(packageRoot, "dist/maplibre-gl-worker.mjs")));
    writeFileSync(resolve(versionRoot, "maplibre-gl-shared.mjs"), "");
    expect(() => assertMapLibreWorkerAssets(workspace)).toThrow(/exactly/);
  });
});
