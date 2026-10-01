import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";

import sharp from "sharp";
import ts from "typescript";

import { MAPLIBRE_VERSION } from "../../src/lib/maplibre-assets";

export const screenshotManifestPath =
  "public/portfolio/screenshots.manifest.json";
export const screenshotManifestVersion = 2 as const;
export const screenshotViewport = { height: 1000, width: 1600 } as const;

const screenshotSourceFingerprintDomain = Buffer.from(
  "diesel-screenshot-source-fingerprint-v2",
  "utf8",
);

const sharedScreenshotEntrypoints = [
  "scripts/portfolio/capture-screenshots.ts",
  "scripts/demo/server.ts",
  "src/app/layout.tsx",
] as const;

const sharedScreenshotBuildInputs = [
  "next.config.ts",
  "patches/next@16.3.6.patch",
  "patches/vaul@1.1.2.patch",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "postcss.config.mjs",
  "src/app/icon.svg",
  "tsconfig.json",
  // The Next guard reads these by filesystem path, not by a static import.
  `public/maplibre/${MAPLIBRE_VERSION}/maplibre-gl-worker.mjs`,
  `public/maplibre/${MAPLIBRE_VERSION}/maplibre-gl-shared.mjs`,
  `public/maplibre/${MAPLIBRE_VERSION}/LICENSE.txt`,
  `public/maplibre/${MAPLIBRE_VERSION}/THIRD-PARTY-NOTICES.txt`,
] as const;

export const screenshotSpecifications = [
  {
    path: "public/portfolio/live-dashboard.jpg",
    route: "/",
    sourceEntrypoints: [
      ...sharedScreenshotEntrypoints,
      "src/app/page.tsx",
      "src/app/api/countries/route.ts",
      ...sharedScreenshotBuildInputs,
    ],
  },
  {
    path: "public/portfolio/offline-evidence-chat.jpg",
    route:
      "/chat?countryIso3=CHN&applicationScope=non-road&powerKw=100&asOf=2026-08-12&productModelCode=DEMO-ENG-200",
    sourceEntrypoints: [
      ...sharedScreenshotEntrypoints,
      "src/app/chat/page.tsx",
      "src/app/api/chat/route.ts",
      ...sharedScreenshotBuildInputs,
    ],
  },
] as const;

const allowedSourceFiles = new Set([
  "next.config.ts",
  "patches/next@16.3.6.patch",
  "patches/vaul@1.1.2.patch",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "postcss.config.mjs",
  "scripts/format-error.ts",
  "scripts/maplibre-worker-assets.ts",
  "scripts/next-environment-file.ts",
  "tsconfig.json",
]);
const allowedSourcePrefixes = [
  "drizzle/",
  "public/",
  "scripts/demo/",
  "scripts/portfolio/",
  "src/",
] as const;
const resolvableExtensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
  ".sass",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
] as const;
const parseableModuleExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const parseableCssExtensions = new Set([".css", ".scss", ".sass"]);
const publicAssetExtensionPattern =
  /\.(?:avif|css|gif|ico|jpe?g|json|png|svg|webp|woff2?)(?:[?#].*)?$/iu;

const allowedKeys = <T extends object>(
  value: T,
  keys: readonly string[],
  label: string,
) => {
  const extras = Object.keys(value).filter((key) => !keys.includes(key));
  if (extras.length > 0) {
    throw new Error(`${label} has unexpected fields: ${extras.join(", ")}`);
  }
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function isAllowedScreenshotSourcePath(path: string): boolean {
  return (
    allowedSourceFiles.has(path) ||
    allowedSourcePrefixes.some((prefix) => path.startsWith(prefix))
  );
}

function safeWorkspacePath(
  path: unknown,
  predicate: (candidate: string) => boolean,
  label: string,
): string {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path)) {
    throw new Error(`${label} must be a relative workspace path.`);
  }
  const normalized = normalize(path).split(sep).join("/");
  if (
    normalized !== path ||
    path.includes("\\") ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    !predicate(normalized)
  ) {
    throw new Error(`${label} is outside its allowed roots.`);
  }
  return normalized;
}

export type ScreenshotManifest = {
  assets: Array<{
    capturedAt: string;
    height: number;
    locale: "en";
    path: string;
    route: string;
    sha256: string;
    sourceFiles: string[];
    sourceFingerprint: string;
    viewport: { height: number; width: number };
    width: number;
  }>;
  version: typeof screenshotManifestVersion;
};

export function parseScreenshotManifest(value: unknown): ScreenshotManifest {
  const root = record(value, "Screenshot manifest");
  allowedKeys(root, ["assets", "version"], "Screenshot manifest");
  if (
    root.version !== screenshotManifestVersion ||
    !Array.isArray(root.assets) ||
    root.assets.length !== 2
  ) {
    throw new Error(
      `Screenshot manifest must be version ${screenshotManifestVersion} with exactly two assets.`,
    );
  }
  const assets = root.assets.map((raw, index) => {
    const asset = record(raw, `Screenshot asset ${index}`);
    allowedKeys(
      asset,
      [
        "capturedAt",
        "height",
        "locale",
        "path",
        "route",
        "sha256",
        "sourceFiles",
        "sourceFingerprint",
        "viewport",
        "width",
      ],
      `Screenshot asset ${index}`,
    );
    const viewport = record(
      asset.viewport,
      `Screenshot asset ${index} viewport`,
    );
    allowedKeys(
      viewport,
      ["height", "width"],
      `Screenshot asset ${index} viewport`,
    );
    const path = safeWorkspacePath(
      asset.path,
      (candidate) => candidate.startsWith("public/portfolio/"),
      `Screenshot asset ${index} path`,
    );
    const sourceFiles = Array.isArray(asset.sourceFiles)
      ? asset.sourceFiles.map((file, fileIndex) =>
          safeWorkspacePath(
            file,
            isAllowedScreenshotSourcePath,
            `Screenshot asset ${index} sourceFiles[${fileIndex}]`,
          ),
        )
      : [];
    if (
      sourceFiles.length === 0 ||
      new Set(sourceFiles).size !== sourceFiles.length
    ) {
      throw new Error(`Screenshot asset ${index} needs unique source files.`);
    }
    const expected = screenshotSpecifications[index]!;
    if (
      path !== expected.path ||
      asset.route !== expected.route ||
      asset.locale !== "en"
    ) {
      throw new Error(
        `Screenshot asset ${index} does not match its canonical identity.`,
      );
    }
    if (
      typeof asset.capturedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(asset.capturedAt) ||
      Number.isNaN(Date.parse(asset.capturedAt)) ||
      new Date(asset.capturedAt).toISOString() !== asset.capturedAt
    ) {
      throw new Error(`Screenshot asset ${index} has an invalid capturedAt.`);
    }
    for (const [label, number] of [
      ["width", asset.width],
      ["height", asset.height],
      ["viewport.width", viewport.width],
      ["viewport.height", viewport.height],
    ] as const) {
      if (!Number.isInteger(number) || (number as number) <= 0) {
        throw new Error(
          `Screenshot asset ${index} ${label} must be a positive integer.`,
        );
      }
    }
    if (
      viewport.width !== screenshotViewport.width ||
      viewport.height !== screenshotViewport.height ||
      asset.width !== screenshotViewport.width ||
      asset.height !== screenshotViewport.height
    ) {
      throw new Error(
        `Screenshot asset ${index} does not match the canonical viewport.`,
      );
    }
    for (const [label, hash] of [
      ["sha256", asset.sha256],
      ["sourceFingerprint", asset.sourceFingerprint],
    ] as const) {
      if (typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)) {
        throw new Error(`Screenshot asset ${index} ${label} is invalid.`);
      }
    }
    return {
      ...asset,
      path,
      sourceFiles,
      viewport,
    } as ScreenshotManifest["assets"][number];
  });
  if (new Set(assets.map(({ path }) => path)).size !== assets.length) {
    throw new Error("Screenshot asset paths must be unique.");
  }
  return { assets, version: screenshotManifestVersion };
}

function staticModuleSpecifiers(source: string, file: string): string[] {
  const extension = extname(file);
  const scriptKind =
    extension === ".tsx"
      ? ts.ScriptKind.TSX
      : extension === ".jsx"
        ? ts.ScriptKind.JSX
        : extension === ".js" ||
            extension === ".mjs" ||
            extension === ".cjs"
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const specifiers = new Set<string>();
  const addLiteral = (node: ts.Expression | undefined) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addLiteral(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      addLiteral(node.arguments[0]);
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL"
    ) {
      addLiteral(node.arguments?.[0]);
    } else if (
      ts.isStringLiteralLike(node) &&
      node.text.startsWith("/") &&
      publicAssetExtensionPattern.test(node.text)
    ) {
      specifiers.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...specifiers];
}

function staticCssSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const importPattern =
    /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)')/giu;
  const urlPattern =
    /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s][^)]*))\s*\)/giu;
  for (const match of source.matchAll(importPattern)) {
    const value = match[1] ?? match[2];
    if (value) specifiers.add(value);
  }
  for (const match of source.matchAll(urlPattern)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value) specifiers.add(value.trim());
  }
  return [...specifiers];
}

function withoutQueryOrFragment(specifier: string): string {
  return specifier.split(/[?#]/u, 1)[0]!;
}

function isLocalSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("/")
  );
}

async function isFile(path: string): Promise<boolean> {
  return stat(path)
    .then((metadata) => metadata.isFile())
    .catch(() => false);
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function resolveLocalDependency(
  workspace: string,
  importer: string,
  rawSpecifier: string,
): Promise<string | null> {
  if (!isLocalSpecifier(rawSpecifier)) return null;
  const specifier = withoutQueryOrFragment(rawSpecifier);
  if (!specifier) {
    throw new Error(`Invalid local import "${rawSpecifier}" from ${importer}.`);
  }
  const workspaceRealPath = await realpath(workspace);
  const importerAbsolute = resolve(workspaceRealPath, importer);
  const unresolved = specifier.startsWith("@/")
    ? resolve(workspaceRealPath, "src", specifier.slice(2))
    : specifier.startsWith("/")
      ? resolve(workspaceRealPath, "public", specifier.slice(1))
      : resolve(dirname(importerAbsolute), specifier);
  if (!isWithin(workspaceRealPath, unresolved)) {
    throw new Error(
      `Local import "${rawSpecifier}" from ${importer} escapes the workspace.`,
    );
  }

  const extension = extname(unresolved);
  const candidates = extension
    ? [unresolved]
    : [
        unresolved,
        ...resolvableExtensions.map(
          (candidateExtension) => `${unresolved}${candidateExtension}`,
        ),
        ...resolvableExtensions.map((candidateExtension) =>
          resolve(unresolved, `index${candidateExtension}`),
        ),
      ];
  for (const candidate of candidates) {
    if (!(await isFile(candidate))) continue;
    const candidateRealPath = await realpath(candidate);
    if (!isWithin(workspaceRealPath, candidateRealPath)) {
      throw new Error(
        `Local import "${rawSpecifier}" from ${importer} resolves outside the workspace.`,
      );
    }
    const workspacePath = relative(workspaceRealPath, candidateRealPath)
      .split(sep)
      .join("/");
    if (!isAllowedScreenshotSourcePath(workspacePath)) {
      throw new Error(
        `Local import "${rawSpecifier}" from ${importer} resolves outside allowed screenshot sources.`,
      );
    }
    return workspacePath;
  }
  throw new Error(`Unresolved local import "${rawSpecifier}" from ${importer}.`);
}

/**
 * Returns the deterministic transitive closure of local dependencies. A file is
 * marked visited before descent, so legal import cycles terminate while every
 * reachable file is fingerprinted exactly once. Relevant unresolved or escaping
 * local imports fail closed instead of silently weakening screenshot evidence.
 */
export async function collectLocalSourceDependencyClosure(
  workspace: string,
  entrypoints: readonly string[],
): Promise<string[]> {
  const workspaceRealPath = await realpath(workspace);
  const visited = new Set<string>();

  const visit = async (rawFile: string): Promise<void> => {
    const file = safeWorkspacePath(
      rawFile,
      isAllowedScreenshotSourcePath,
      "Screenshot source entrypoint",
    );
    if (visited.has(file)) return;
    const absolute = resolve(workspaceRealPath, file);
    if (!(await isFile(absolute))) {
      throw new Error(`Screenshot source file is missing: ${file}`);
    }
    const sourceRealPath = await realpath(absolute);
    if (!isWithin(workspaceRealPath, sourceRealPath)) {
      throw new Error(
        `Screenshot source file resolves outside the workspace: ${file}`,
      );
    }
    visited.add(file);

    const extension = extname(file);
    if (
      !parseableModuleExtensions.has(extension) &&
      !parseableCssExtensions.has(extension)
    ) {
      return;
    }
    const source = await readFile(sourceRealPath, "utf8");
    const specifiers = parseableCssExtensions.has(extension)
      ? staticCssSpecifiers(source)
      : staticModuleSpecifiers(source, file);
    for (const specifier of specifiers) {
      const dependency = await resolveLocalDependency(
        workspaceRealPath,
        file,
        specifier,
      );
      if (dependency !== null) await visit(dependency);
    }
  };

  for (const entrypoint of entrypoints) await visit(entrypoint);
  return [...visited].sort();
}

export async function expectedScreenshotSourceFiles(
  workspace: string,
  index: number,
): Promise<string[]> {
  const specification = screenshotSpecifications[index];
  if (specification === undefined) {
    throw new Error(`Unknown screenshot asset index ${index}.`);
  }
  const [dependencyClosure, applicationTree, migrationTree] = await Promise.all([
    collectLocalSourceDependencyClosure(
      workspace,
      specification.sourceEntrypoints,
    ),
    collectRegularSourceTree(workspace, "src"),
    // createDemoConnection() resolves this folder dynamically from
    // process.cwd(), so TypeScript import traversal cannot discover it. Bind
    // every migration and Drizzle metadata file that can shape the rendered
    // demo database.
    collectDrizzleMigrationSourceTree(workspace),
  ]);
  return [
    ...new Set([...dependencyClosure, ...applicationTree, ...migrationTree]),
  ].sort();
}

export async function collectDrizzleMigrationSourceTree(
  workspace: string,
): Promise<string[]> {
  return collectRegularSourceTree(workspace, "drizzle");
}

async function collectRegularSourceTree(
  workspace: string,
  root: string,
): Promise<string[]> {
  const workspaceRealPath = await realpath(workspace);
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(resolve(workspaceRealPath, directory), {
      withFileTypes: true,
    });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new Error(`Screenshot source tree contains a symbolic link: ${path}`);
      }
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        safeWorkspacePath(path, isAllowedScreenshotSourcePath, "Screenshot source tree file");
        files.push(path);
      } else {
        throw new Error(`Screenshot source tree contains a non-file entry: ${path}`);
      }
    }
  };
  await visit(root);
  if (files.length === 0) {
    throw new Error("Screenshot source tree is empty.");
  }
  return files;
}

export async function fingerprintSourceFiles(
  workspace: string,
  files: readonly string[],
): Promise<string> {
  const hash = createHash("sha256");
  const sortedFiles = [...files].sort();
  const lengthPrefix = (length: number): Buffer => {
    const prefix = Buffer.allocUnsafe(8);
    prefix.writeBigUInt64BE(BigInt(length));
    return prefix;
  };
  hash
    .update(lengthPrefix(screenshotSourceFingerprintDomain.byteLength))
    .update(screenshotSourceFingerprintDomain)
    .update(lengthPrefix(sortedFiles.length));
  for (const file of sortedFiles) {
    const pathBytes = Buffer.from(file, "utf8");
    const contents = await readFile(resolve(workspace, file));
    hash
      .update(lengthPrefix(pathBytes.byteLength))
      .update(pathBytes)
      .update(lengthPrefix(contents.byteLength))
      .update(contents);
  }
  return hash.digest("hex");
}

export async function verifyScreenshotManifest(
  workspace: string,
  text: string,
  options: { assetRoot?: string } = {},
): Promise<void> {
  const manifest = parseScreenshotManifest(JSON.parse(text) as unknown);
  if (`${JSON.stringify(manifest, null, 2)}\n` !== text) {
    throw new Error("Screenshot manifest must use canonical JSON encoding.");
  }
  const workspaceRealPath = await realpath(workspace);
  const assetRootRealPath = await realpath(options.assetRoot ?? workspaceRealPath);
  if (!isWithin(workspaceRealPath, assetRootRealPath)) {
    throw new Error("Screenshot asset root is outside the workspace.");
  }
  for (const [index, asset] of manifest.assets.entries()) {
    const expectedSources = await expectedScreenshotSourceFiles(workspace, index);
    if (JSON.stringify(asset.sourceFiles) !== JSON.stringify(expectedSources)) {
      throw new Error(`Screenshot source inventory drift: ${asset.path}`);
    }
    const assetPath = resolve(assetRootRealPath, asset.path);
    const assetMetadata = await lstat(assetPath);
    const resolvedAssetPath = await realpath(assetPath);
    if (
      assetMetadata.isSymbolicLink() ||
      !assetMetadata.isFile() ||
      assetMetadata.size <= 0 ||
      assetMetadata.size > 16 * 1024 * 1024 ||
      !isWithin(assetRootRealPath, resolvedAssetPath)
    ) {
      throw new Error(`Screenshot asset is not a bounded contained file: ${asset.path}`);
    }
    const bytes = await readFile(resolvedAssetPath);
    const metadata = await sharp(bytes).metadata();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (
      sha256 !== asset.sha256 ||
      metadata.format !== "jpeg" ||
      metadata.width !== asset.width ||
      metadata.height !== asset.height
    ) {
      throw new Error(`Screenshot asset drift: ${asset.path}`);
    }
    if (
      (await fingerprintSourceFiles(workspace, asset.sourceFiles)) !==
      asset.sourceFingerprint
    ) {
      throw new Error(`Screenshot source drift: ${asset.path}`);
    }
  }
}
