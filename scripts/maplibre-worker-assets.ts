import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { MAPLIBRE_VERSION } from "../src/lib/maplibre-assets";

const assetFiles = [
  { source: "dist/maplibre-gl-worker.mjs", target: "maplibre-gl-worker.mjs" },
  { source: "dist/maplibre-gl-shared.mjs", target: "maplibre-gl-shared.mjs" },
  { source: "LICENSE.txt", target: "LICENSE.txt" },
] as const;

const installedPackageSchema = z.object({
  name: z.literal("maplibre-gl"),
  version: z.literal(MAPLIBRE_VERSION),
});

type NoticeSource = {
  name: string;
  version: string;
  file: string;
  via?: string;
  readmeSection?: true;
};

// These versions identify the installed notice sources, not the upstream
// bundler's build environment. Keep this bounded to the two shipped modules.
export const mapLibreWorkerNoticeSources: readonly NoticeSource[] = [
  { name: "@maplibre/maplibre-gl-style-spec", version: "26.4.2", file: "LICENSE.txt" },
  { name: "@mapbox/point-geometry", version: "1.1.0", file: "LICENSE" },
  { name: "@mapbox/unitbezier", version: "1.0.0", file: "LICENSE" },
  { name: "gl-matrix", version: "3.4.4", file: "LICENSE.md" },
  { name: "quickselect", version: "3.0.0", file: "LICENSE", via: "@maplibre/maplibre-gl-style-spec" },
  { name: "tinyqueue", version: "3.0.0", file: "LICENSE" },
  { name: "murmurhash-js", version: "1.0.0", file: "README.md", readmeSection: true },
  { name: "earcut", version: "3.2.3", file: "LICENSE" },
  { name: "@mapbox/vector-tile", version: "3.0.0", file: "LICENSE.txt" },
  { name: "@maplibre/geojson-vt", version: "6.1.1", file: "LICENSE" },
  { name: "bidi-js", version: "1.1.0", file: "LICENSE.txt" },
  { name: "pbf", version: "5.1.2", file: "LICENSE" },
  { name: "potpack", version: "2.1.0", file: "LICENSE" },
  { name: "@maplibre/vt-pbf", version: "4.3.2", file: "LICENSE" },
  { name: "@maplibre/mlt", version: "1.2.1", file: "LICENSE.txt" },
  { name: "kdbush", version: "4.1.0", file: "LICENSE", via: "@maplibre/geojson-vt" },
];

const sourceMapSchema = z.object({
  version: z.literal(3),
  sources: z.array(z.string()),
  sourcesContent: z.array(z.string().nullable()),
}).refine((map) => map.sources.length === map.sourcesContent.length, "Incomplete sourcemap source content");

function packageManifest(name: string, require: ReturnType<typeof createRequire>): string {
  try {
    return require.resolve(`${name}/package.json`);
  } catch {
    // Some packages export their ESM entry but not package.json. Resolve only;
    // never import or execute a third-party package to obtain its notice.
    let directory = dirname(require.resolve(name));
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = resolve(directory, "package.json");
      if (lstatSync(candidate, { throwIfNoEntry: false })?.isFile()) {
        const parsed = z.object({ name: z.string() }).parse(JSON.parse(readRegularFile(candidate).toString("utf8")) as unknown);
        if (parsed.name === name) return candidate;
      }
      directory = dirname(directory);
    }
    throw new Error(`Cannot resolve the installed notice source: ${name}`);
  }
}

function thirdPartyNotices(maplibreManifest: string): Buffer {
  const require = createRequire(maplibreManifest);
  const sources = new Map(mapLibreWorkerNoticeSources.map((source) => {
    const sourceRequire = source.via
      ? createRequire(packageManifest(source.via, require))
      : require;
    const manifest = packageManifest(source.name, sourceRequire);
    z.object({ name: z.literal(source.name), version: z.literal(source.version) })
      .parse(JSON.parse(readRegularFile(manifest).toString("utf8")) as unknown);
    return [source.name, { ...source, root: dirname(manifest) }] as const;
  }));
  const bundledPackages = new Set<string>();
  const maps = [
    [dirname(maplibreManifest), "dist/maplibre-gl-worker.mjs.map"],
    [dirname(maplibreManifest), "dist/maplibre-gl-shared.mjs.map"],
    [sources.get("@maplibre/geojson-vt")!.root, "dist/geojson-vt.mjs.map"],
    [sources.get("@maplibre/vt-pbf")!.root, "dist/index.es.js.map"],
  ];
  for (const [root, file] of maps) {
    const map = sourceMapSchema.parse(JSON.parse(readRegularFile(resolve(root, file)).toString("utf8")) as unknown);
    for (const [index, source] of map.sources.entries()) {
      if (!source.includes("node_modules/")) continue;
      const match = /^\.\.\/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/u.exec(source);
      const installed = match && sources.get(match[1]);
      if (!match || !installed || match[2].includes("\\") || match[2].split("/").some((part) => ["", ".", ".."].includes(part))) {
        throw new Error(`Unreviewed MapLibre bundled source: ${source}`);
      }
      // Includes nested dist/node_modules sources, not only the first package.
      for (const nested of source.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/gu)) {
        if (!sources.has(nested[1])) throw new Error(`Unreviewed MapLibre bundled package: ${nested[1]}`);
        bundledPackages.add(nested[1]);
      }
      const embedded = map.sourcesContent[index];
      if (embedded === null || !readRegularFile(resolve(installed.root, match[2])).equals(Buffer.from(embedded, "utf8"))) {
        throw new Error(`MapLibre bundled source differs from its installed notice source: ${source}`);
      }
    }
  }
  if (JSON.stringify([...bundledPackages].sort()) !== JSON.stringify([...sources.keys()].sort())) {
    throw new Error("MapLibre bundled package set differs from the reviewed 16 notice sources.");
  }
  const contents: Buffer[] = [Buffer.from(
    `Third-party notices for MapLibre GL JS ${MAPLIBRE_VERSION} worker/shared assets.\n` +
    "Texts are reproduced from the current pinned installation. The versions below\n" +
    "identify installed notice sources, not proof of upstream bundle build versions.\n" +
    "MapLibre's own notices remain unchanged in the adjacent LICENSE.txt.\n",
    "utf8",
  )];
  for (const source of sources.values()) {
    let notice = readRegularFile(resolve(source.root, source.file));
    if (source.readmeSection) {
      const marker = Buffer.from("## License (MIT)\n", "utf8");
      const start = notice.indexOf(marker);
      if (start < 0 || notice.indexOf(marker, start + marker.length) >= 0) {
        throw new Error("Cannot identify the complete murmurhash-js README license section.");
      }
      notice = notice.subarray(start);
    }
    if (notice.length === 0) throw new Error(`Empty MapLibre notice source: ${source.name}`);
    contents.push(Buffer.from(
      `\n===== ${source.name} | installed notice source ${source.version} | ${source.file}${source.readmeSection ? " (License section)" : ""} =====\n`,
      "utf8",
    ), notice, Buffer.from("\n", "utf8"));
  }
  return Buffer.concat(contents);
}

const argumentsSchema = z.union([
  z.tuple([]),
  z.tuple([z.literal("--verify")]),
  z.tuple([z.literal("--write")]),
]);

export function parseMapLibreWorkerAssetArgs(args: readonly string[]): "verify" | "write" {
  const parsed = argumentsSchema.parse(args);
  return parsed[0] === "--write" ? "write" : "verify";
}

function requireDirectory(path: string): void {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`MapLibre asset path must be a non-symlink directory: ${path}`);
  }
}

function readRegularFile(path: string): Buffer {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`MapLibre asset must be a regular non-symlink file: ${path}`);
  }
  return readFileSync(path);
}

function installedAssets(workspace: string) {
  const require = createRequire(resolve(workspace, "package.json"));
  const manifestPath = require.resolve("maplibre-gl/package.json");
  installedPackageSchema.parse(JSON.parse(readRegularFile(manifestPath).toString("utf8")) as unknown);
  const packageRoot = dirname(manifestPath);
  const assets = assetFiles.map(({ source, target }) => ({
    bytes: readRegularFile(resolve(packageRoot, source)),
    target,
  }));
  return [...assets, { bytes: thirdPartyNotices(manifestPath), target: "THIRD-PARTY-NOTICES.txt" }];
}

function assetPaths(workspace: string) {
  const publicRoot = resolve(workspace, "public");
  const maplibreRoot = resolve(publicRoot, "maplibre");
  return {
    publicRoot,
    maplibreRoot,
    versionRoot: resolve(maplibreRoot, MAPLIBRE_VERSION),
  };
}

/** Read-only build/dev guard: tracked assets must exactly match the installed pin. */
export function assertMapLibreWorkerAssets(workspace = process.cwd()): void {
  const assets = installedAssets(workspace);
  const paths = assetPaths(workspace);
  requireDirectory(paths.publicRoot);
  requireDirectory(paths.maplibreRoot);
  requireDirectory(paths.versionRoot);
  const expectedNames = assets.map(({ target }) => target).sort();
  if (JSON.stringify(readdirSync(paths.versionRoot).sort()) !== JSON.stringify(expectedNames)) {
    throw new Error("MapLibre version directory must contain exactly worker, shared, LICENSE.txt, and THIRD-PARTY-NOTICES.txt.");
  }
  for (const { bytes, target } of assets) {
    if (!readRegularFile(resolve(paths.versionRoot, target)).equals(bytes)) {
      throw new Error(`MapLibre tracked asset differs from the installed ${MAPLIBRE_VERSION} package: ${target}`);
    }
  }
}

/**
 * Explicit maintenance only: copy upstream ESM siblings and their complete
 * license byte-for-byte, plus the deterministically collected dependency
 * notices. Never call this from Next config, build, or dev.
 * An existing version directory is not repaired or overwritten; review drift
 * separately. A failed write leaves its new directory visible for inspection.
 */
export function prepareMapLibreWorkerAssets(workspace = process.cwd()): void {
  const assets = installedAssets(workspace);
  const paths = assetPaths(workspace);
  requireDirectory(paths.publicRoot);
  if (lstatSync(paths.maplibreRoot, { throwIfNoEntry: false })) {
    requireDirectory(paths.maplibreRoot);
  }
  if (lstatSync(paths.versionRoot, { throwIfNoEntry: false })) {
    throw new Error("Refusing to overwrite an existing MapLibre version path; use read-only verification.");
  }
  if (!lstatSync(paths.maplibreRoot, { throwIfNoEntry: false })) {
    mkdirSync(paths.maplibreRoot);
  }
  mkdirSync(paths.versionRoot);
  for (const { bytes, target } of assets) {
    writeFileSync(resolve(paths.versionRoot, target), bytes, { flag: "wx" });
  }
  assertMapLibreWorkerAssets(workspace);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const operation = parseMapLibreWorkerAssetArgs(process.argv.slice(2));
    if (operation === "write") {
      prepareMapLibreWorkerAssets();
    } else {
      assertMapLibreWorkerAssets();
    }
    process.stdout.write(`MapLibre ${MAPLIBRE_VERSION} worker assets ${operation === "write" ? "prepared and verified" : "verified"}.\n`);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : "MapLibre worker asset verification failed."}\n`);
    process.exitCode = 1;
  }
}
