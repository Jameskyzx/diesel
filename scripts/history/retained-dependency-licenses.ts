import { createHash } from "node:crypto";

import { z } from "zod";

import { decodeRetainedLicenseArchive } from "./retained-license-archive";

const prefix = "docs/evidence/fde-development-history-dependency-licenses-2026-09-05";
export const retainedDependencyLicenseManifestContract = {
  path: `${prefix}.manifest.json`,
  byteLength: 3592,
  sha256: "c972c2e9d4db4748d6d3cc8a0f9447eb9dedcf4ede2646b5282c9c1133bfd186",
} as const;
export const retainedDependencyLicenseArchiveContract = {
  path: `${prefix}.raw.json.gz`,
  byteLength: 4499471,
  sha256: "9cef91ee2d5becb83ad925b14abff0469f8142ba31ce6daf9a30bb6820c89f50",
} as const;
export const retainedDependencyLicensePaths = [
  retainedDependencyLicenseManifestContract.path,
  retainedDependencyLicenseArchiveContract.path,
] as const;
const sourceCommit = "6be02895643a3fdf8dcee1a5876c5f3d70d03036";
const fullRun = "runs/04-completed-platform-installs";
const registryRun = "runs/06-completed-cross-platform-declarations";
const fullOriginalRoot = "/private/tmp/diesel-fde-license-20260905.7pntbV";
const registryOriginalRoot = "/private/tmp/diesel-fde-license-cross-platform-20260905.P6mmOE";
const node = "/Users/jamesky/.hermes/node/bin/node";
const pnpm = "/Users/jamesky/.hermes/node/lib/node_modules/pnpm/bin/pnpm.mjs";
const fullRunPnpmFlags = [pnpm, "--config.pm-on-fail=ignore", "--config.runtime-on-fail=error",
  "--config.ignore-pnpmfile=true", "--config.ignore-scripts=true", "--config.update-notifier=false",
  "--config.offline=true", "--config.verify-deps-before-run=false", "--config.registry=https://registry.npmjs.org",
  "--config.node-experimental-package-map=false", "--config.enable-global-virtual-store=false",
  "--config.side-effects-cache=false", "--config.verify-store-integrity=true",
  `--config.store-dir=${fullOriginalRoot}/store`, `--config.cache-dir=${fullOriginalRoot}/cache`,
  `--config.state-dir=${fullOriginalRoot}/state`, `--config.global-dir=${fullOriginalRoot}/global`,
  `--config.global-bin-dir=${fullOriginalRoot}/bin`];
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const pathSchema = z.string().min(1).max(512).regex(/^[a-zA-Z0-9._/-]+$/u).refine(
  (path) => path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
);
const descriptorSchema = z.object({
  byteLength: z.number().int().nonnegative().max(8 * 1024 * 1024),
  sha256: shaSchema,
}).strict();
const fileDescriptorSchema = descriptorSchema.extend({ path: pathSchema }).strict();
const integritySchema = z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/u);
const identitySchema = z.string().max(240).regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+@\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u);
const outputSchema = z.object({ stdout: fileDescriptorSchema, stderr: fileDescriptorSchema }).strict();
const commandSchema = z.object({
  label: z.string().min(1).max(100), executable: z.string().max(300),
  args: z.array(z.string().max(500)).max(50), cwd: z.string().max(500),
  startedAt: z.iso.datetime(), completedAt: z.iso.datetime(),
  exitCode: z.literal(0), signal: z.null(), errorCode: z.null(), output: outputSchema,
}).strict();
const registryReceiptSchema = commandSchema.omit({ label: true }).extend({ identity: identitySchema }).strict();
const requestSchema = z.object({
  identity: identitySchema, name: z.string().min(1).max(200),
  version: z.string().min(1).max(100), integrity: integritySchema,
}).strict();
const registryRowSchema = z.object({
  name: z.string().min(1), version: z.string().min(1),
  "dist.integrity": integritySchema, license: z.string().min(1).max(200),
}).strict();
const graphSchema = z.object({
  graph: z.enum(["L1", "L2", "L3"]), representativeState: z.enum(["S1", "S3", "S6"]),
  platformIdentities: z.number().int().positive(), productionPlatformIdentities: z.number().int().positive(),
  registryIdentities: z.literal(175), lockedIdentities: z.number().int().positive(),
  mplDeclaredIdentities: z.number().int().nonnegative(), lgplContainingDeclaredIdentities: z.number().int().nonnegative(),
}).strict();
const observedSchema = z.object({
  successfulFrozenInstalls: z.literal(6), platformLicenseReports: z.literal(12), registryQueries: z.literal(175),
  graphs: z.array(graphSchema).length(3),
  registryDeclarations: z.array(z.object({ license: z.string().min(1), identities: z.number().int().positive() }).strict()).max(175),
}).strict();
export type RetainedDependencyLicenseObserved = z.infer<typeof observedSchema>;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Retained dependency licenses: ${message}`);
}
function bytesAt(files: ReadonlyMap<string, Uint8Array>, path: string): Uint8Array {
  const bytes = files.get(path);
  check(bytes !== undefined, "required raw file is missing");
  return bytes;
}
function text(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
function json(bytes: Uint8Array): unknown { return JSON.parse(text(bytes)) as unknown; }
function assertBytes(bytes: Uint8Array, descriptor: z.infer<typeof descriptorSchema>): void {
  check(bytes.byteLength === descriptor.byteLength && hash(bytes) === descriptor.sha256, "raw byte binding drifted");
}
function checkedOutput(files: ReadonlyMap<string, Uint8Array>, run: string, output: z.infer<typeof outputSchema>): string {
  const stdout = bytesAt(files, `${run}/${output.stdout.path}`);
  const stderr = bytesAt(files, `${run}/${output.stderr.path}`);
  assertBytes(stdout, output.stdout); assertBytes(stderr, output.stderr);
  check(stderr.byteLength === 0, "completed command has stderr diagnostics");
  return text(stdout);
}
function same(left: unknown, right: unknown, message: string): void {
  check(JSON.stringify(left) === JSON.stringify(right), message);
}

/** Deliberately accepts only the reviewed pnpm v9 packages/inline-SRI shape, not arbitrary YAML. */
export function parseRetainedLockIdentities(contents: string): ReadonlyMap<string, string> {
  check(contents.startsWith("lockfileVersion: '9.0'\n"), "unexpected historical lock version");
  const parts = contents.split("\npackages:\n");
  check(parts.length === 2, "lock lacks a unique packages section");
  const sections = parts[1]!.split("\nsnapshots:\n");
  check(sections.length === 2, "lock lacks a unique snapshots section");
  const result = new Map<string, string>();
  let current: string | undefined;
  let integrity: string | undefined;
  function finish(): void {
    if (current === undefined) return;
    check(integrity !== undefined && !result.has(current), "duplicate package or missing integrity");
    result.set(current, integrity);
  }
  for (const line of sections[0]!.split("\n")) {
    if (/^ {2}\S/u.test(line)) {
      finish();
      const match = /^ {2}(?:'([^']+)'|([^'\s]+)):\s*$/u.exec(line);
      check(match !== null, "unsupported lock package key");
      current = identitySchema.parse(match[1] ?? match[2]); integrity = undefined;
    } else if (/^ {4}resolution:/u.test(line)) {
      const match = /^ {4}resolution: \{integrity: (sha512-[A-Za-z0-9+/]{86}==)\}$/u.exec(line);
      check(current !== undefined && integrity === undefined && match !== null, "unsupported or duplicate resolution");
      integrity = integritySchema.parse(match[1]);
    }
  }
  finish(); check(result.size > 0, "empty lock identity set");
  return result;
}

/** Preserves complete license expressions; no legal classification or approval. */
export function summarizeRetainedPlatformLicenseReport(value: unknown): ReadonlyMap<string, string> {
  const rowSchema = z.object({
    name: z.string().min(1).max(200), versions: z.array(z.string().min(1)).min(1).max(20),
    paths: z.array(z.string().min(1).max(1000)).min(1).max(20), license: z.string().min(1).max(200),
    author: z.string().optional(), homepage: z.string().optional(), description: z.string().optional(),
  }).strict();
  const report = z.record(z.string().min(1).max(200), z.array(rowSchema).min(1).max(1000)).parse(value);
  const identities = new Map<string, string>();
  for (const [license, rows] of Object.entries(report)) for (const row of rows) {
    check(license === row.license && row.versions.length === row.paths.length, "license bucket/path mismatch");
    for (const version of row.versions) {
      const identity = identitySchema.parse(`${row.name}@${version}`);
      check(!identities.has(identity), "duplicate platform identity");
      identities.set(identity, license);
    }
  }
  check(identities.size > 0, "empty platform license report"); return identities;
}

export function validateRetainedRegistryDeclaration(input: {
  request: unknown; receipt: unknown; response: unknown;
}): { identity: string; license: string } {
  const request = requestSchema.parse(input.request);
  const receipt = registryReceiptSchema.parse(input.receipt);
  const response = registryRowSchema.parse(input.response);
  check(request.identity === `${request.name}@${request.version}`, "request identity fields disagree");
  check(receipt.identity === request.identity && receipt.executable === node && receipt.cwd === registryOriginalRoot, "registry receipt identity drift");
  const flags = [pnpm, "--config.pm-on-fail=ignore", "--config.runtime-on-fail=error",
    "--config.ignore-pnpmfile=true", "--config.ignore-scripts=true", "--config.update-notifier=false",
    "--config.verify-deps-before-run=false", "--config.registry=https://registry.npmjs.org",
    "--config.node-experimental-package-map=false", `--config.cache-dir=${registryOriginalRoot}/cache`,
    `--config.state-dir=${registryOriginalRoot}/state`];
  same(receipt.args, [...flags, "view", request.identity, "name", "version", "license", "licenses", "dist.integrity", "--json"], "registry command arguments drifted");
  check(receipt.completedAt >= receipt.startedAt, "registry time order is invalid");
  check(response.name === request.name && response.version === request.version && response["dist.integrity"] === request.integrity, "registry response does not match locked identity/integrity");
  check(response.license.trim().length > 0, "registry license declaration is blank");
  return { identity: request.identity, license: response.license };
}

/** Recomputes observations from decoded raw files, independent of the outer dated-record hash. */
export function summarizeRetainedDependencyLicenseOutput(files: ReadonlyMap<string, Uint8Array>): RetainedDependencyLicenseObserved {
  const full = z.object({
    sourceCommit: z.literal(sourceCommit), includesLicenseFullText: z.literal(false),
    executionMode: z.literal("cached-packages-with-registry-supply-chain-metadata"),
    licenseApproval: z.literal("not-performed"), publicationEffect: z.literal("none"),
    outcome: z.literal("commands-completed-metadata-collected"),
    commands: z.array(commandSchema).length(21),
    states: z.array(z.object({
      id: z.enum(["S1", "S2", "S3", "S4", "S5", "S6"]), dependencyGraph: z.enum(["L1", "L2", "L3"]),
      reachableCommitCount: z.number().int().positive(), lockPackageEntries: z.number().int().positive(),
      files: z.record(z.string(), descriptorSchema.extend({ gitBlob: z.string().regex(/^[a-f0-9]{40}$/u) }).strict()),
      install: z.object({ completed: z.literal(true), modulesManifest: descriptorSchema, storeDir: z.literal(`${fullOriginalRoot}/store/v11`) }).strict(),
    })).length(6),
  }).parse(json(bytesAt(files, `${fullRun}/manifest.json`)));
  const allCommands = new Map<string, z.infer<typeof commandSchema>>();
  for (const command of full.commands) {
    check(!allCommands.has(command.label), "duplicate completed command");
    const rawReceipt = commandSchema.parse(json(bytesAt(files, `${fullRun}/raw/${command.label}.receipt.json`)));
    same(rawReceipt, command, "raw receipt differs from run record");
    checkedOutput(files, fullRun, command.output);
    check(command.completedAt >= command.startedAt, "completed command time order is invalid");
    allCommands.set(command.label, command);
  }
  check(checkedOutput(files, fullRun, allCommands.get("pnpm-version")!.output).trim() === "11.9.0", "pnpm version drifted");
  const scope = z.object({ sourceCommit: z.literal(sourceCommit), requests: z.array(requestSchema).length(175) }).parse(
    json(bytesAt(files, `${registryRun}/request-scope.json`)),
  );
  const registry = z.object({
    sourceCommit: z.literal(sourceCommit), includesLicenseFullText: z.literal(false),
    licenseApproval: z.literal("not-performed"), publicationEffect: z.literal("none"),
    outcome: z.literal("collected"), collectedCount: z.literal(175), declaredStringCount: z.literal(175),
    missingOrNonStringCount: z.literal(0), failures: z.array(z.unknown()).length(0),
    results: z.array(z.object({
      identity: identitySchema, lockedIntegrity: integritySchema, declaredLicense: z.string().min(1),
      legacyLicenses: z.null(), declarationState: z.literal("string-present"),
      receipt: fileDescriptorSchema, output: outputSchema,
    }).strict()).length(175),
  }).parse(json(bytesAt(files, `${registryRun}/manifest.json`)));
  const requests = new Map(scope.requests.map((row) => [row.identity, row]));
  check(requests.size === 175, "duplicate registry request");
  const registryLicenses = new Map<string, string>();
  for (const result of registry.results) {
    const request = requests.get(result.identity);
    check(request !== undefined && !registryLicenses.has(result.identity), "missing or duplicate registry result");
    const receiptBytes = bytesAt(files, `${registryRun}/${result.receipt.path}`);
    assertBytes(receiptBytes, result.receipt);
    const receipt = registryReceiptSchema.parse(json(receiptBytes));
    same(receipt.output, result.output, "registry result output binding drifted");
    const response = JSON.parse(checkedOutput(files, registryRun, result.output)) as unknown;
    const declaration = validateRetainedRegistryDeclaration({ request, receipt, response });
    check(declaration.license === result.declaredLicense && request.integrity === result.lockedIntegrity, "registry declaration summary drifted");
    registryLicenses.set(declaration.identity, declaration.license);
  }
  const expectedStates = ["S1", "S2", "S3", "S4", "S5", "S6"];
  same(full.states.map((state) => state.id), expectedStates, "historical input states drifted");
  check(full.states.reduce((total, state) => total + state.reachableCommitCount, 0) === 50, "historical input coverage drifted");
  const graphs = new Map<string, z.infer<typeof graphSchema>>();
  let successfulFrozenInstalls = 0, platformLicenseReports = 0;
  for (const state of full.states) {
    same(Object.keys(state.files).sort(), [".nvmrc", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].sort(), "historical file scope drifted");
    for (const [path, descriptor] of Object.entries(state.files)) {
      const bytes = bytesAt(files, `${fullRun}/snapshots/${state.id}/${path}`);
      assertBytes(bytes, descriptor);
      check(createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex") === descriptor.gitBlob, "historical Git blob mismatch");
    }
    assertBytes(bytesAt(files, `${fullRun}/snapshots/${state.id}/node_modules/.modules.yaml`), state.install.modulesManifest);
    const lock = parseRetainedLockIdentities(text(bytesAt(files, `${fullRun}/snapshots/${state.id}/pnpm-lock.yaml`)));
    check(lock.size === state.lockPackageEntries, "lock identity count mismatch");
    const install = allCommands.get(`${state.id}-install`);
    check(install !== undefined && install.executable === node && install.cwd === `${fullOriginalRoot}/snapshots/${state.id}`, "missing or misdirected install");
    same(install.args, [...fullRunPnpmFlags, "install", "--offline", "--frozen-lockfile", "--frozen-store", "--ignore-scripts", "--ignore-pnpmfile", "--no-runtime", "--package-import-method=copy", "--reporter=append-only"], "install safety flags drifted");
    const log = checkedOutput(files, fullRun, install.output);
    check(!/\b(?:ERR|WARN|ERROR|ENOTFOUND)\b|failed/iu.test(log), "install error diagnostic");
    check(/Done in [^\n]+ using pnpm v11\.9\.0/u.test(log) && /, downloaded 0, added \d+, done/u.test(log), "install lacks completion");
    successfulFrozenInstalls += 1;
    const reports = new Map<string, ReadonlyMap<string, string>>();
    for (const mode of ["prod", "all"] as const) {
      const receipt = allCommands.get(`${state.id}-licenses-${mode}`);
      check(receipt !== undefined && receipt.executable === node && receipt.cwd === install.cwd, "license command scope drifted");
      same(receipt.args, [...fullRunPnpmFlags, "licenses", "list", "--long", "--json", ...(mode === "prod" ? ["--prod"] : [])], "license command arguments drifted");
      reports.set(mode, summarizeRetainedPlatformLicenseReport(JSON.parse(checkedOutput(files, fullRun, receipt.output)) as unknown));
      platformLicenseReports += 1;
    }
    const all = reports.get("all")!, prod = reports.get("prod")!;
    for (const [identity, license] of prod) check(all.get(identity) === license, "production report is not a matching all-dependency subset");
    const combined = new Map(all);
    for (const [identity, license] of registryLicenses) {
      check(!combined.has(identity) && requests.get(identity)?.integrity === lock.get(identity), "registry/platform overlap or locked integrity mismatch");
      combined.set(identity, license);
    }
    same([...combined.keys()].sort(), [...lock.keys()].sort(), "combined evidence does not close the locked identity set");
    const representativeState = state.dependencyGraph === "L1" ? "S1" : state.dependencyGraph === "L2" ? "S3" : "S6";
    const graph = graphSchema.parse({
      graph: state.dependencyGraph, representativeState,
      platformIdentities: all.size, productionPlatformIdentities: prod.size,
      registryIdentities: registryLicenses.size, lockedIdentities: lock.size,
      mplDeclaredIdentities: [...combined.values()].filter((license) => license === "MPL-2.0").length,
      lgplContainingDeclaredIdentities: [...combined.values()].filter((license) => license.includes("LGPL-3.0-or-later")).length,
    });
    if (graphs.has(graph.graph)) same(graphs.get(graph.graph), graph, "same-graph observations differ");
    else graphs.set(graph.graph, graph);
  }
  const counts = new Map<string, number>();
  for (const license of registryLicenses.values()) counts.set(license, (counts.get(license) ?? 0) + 1);
  return observedSchema.parse({ successfulFrozenInstalls, platformLicenseReports, registryQueries: registryLicenses.size,
    graphs: [...graphs.values()].sort((left, right) => left.graph.localeCompare(right.graph)),
    registryDeclarations: [...counts].sort(([left], [right]) => left.localeCompare(right)).map(([license, identities]) => ({ license, identities })),
  });
}

export function verifyRetainedDependencyLicenses(input: { manifestText: string; archiveBytes: Uint8Array }): RetainedDependencyLicenseObserved {
  assertBytes(Buffer.from(input.manifestText, "utf8"), retainedDependencyLicenseManifestContract);
  assertBytes(input.archiveBytes, retainedDependencyLicenseArchiveContract);
  const manifest = z.object({
    schemaVersion: z.literal("diesel-fde-development-history-dependency-license-evidence-v1"),
    evidenceLevel: z.literal("repository-contained-dated-run-record"), sourceCommit: z.literal(sourceCommit),
    archive: fileDescriptorSchema.extend({ fileCount: z.literal(810), totalByteLength: z.literal(13876718) }).strict(),
    originalBundle: fileDescriptorSchema.extend({ inventoryFileCount: z.literal(807), inventoryByteLength: z.literal(13550916) }).strict(),
    supportingFiles: z.array(fileDescriptorSchema).length(2), observed: observedSchema,
    licenseApproval: z.literal("not-performed"), includesLicenseFullText: z.literal(false),
    crossPlatformInstallationVerified: z.literal(false), historicalApplicationRuntimeVerified: z.literal(false),
    publicationPermitted: z.literal(false), publicationEffect: z.literal("none"),
  }).parse(JSON.parse(input.manifestText) as unknown);
  same({ path: manifest.archive.path, byteLength: manifest.archive.byteLength, sha256: manifest.archive.sha256 }, retainedDependencyLicenseArchiveContract, "archive contract drifted");
  const files = decodeRetainedLicenseArchive(input.archiveBytes);
  const originalBytes = bytesAt(files, manifest.originalBundle.path);
  assertBytes(originalBytes, manifest.originalBundle);
  const original = z.object({
    publicationPermitted: z.literal(false), repositoryFilesChanged: z.literal(false),
    licenseFullTextReview: z.literal("not-performed"), fileCount: z.literal(807), totalByteLength: z.literal(13550916),
    packagingScript: fileDescriptorSchema,
    files: z.array(fileDescriptorSchema.extend({ originalPath: z.string().min(1).max(1000) }).strict()).length(807),
  }).parse(json(originalBytes));
  const expected = new Set([manifest.originalBundle.path]);
  let total = 0;
  for (const descriptor of [...original.files, ...manifest.supportingFiles]) {
    check(!expected.has(descriptor.path), "duplicate original/supporting file"); expected.add(descriptor.path);
    assertBytes(bytesAt(files, descriptor.path), descriptor);
  }
  for (const descriptor of original.files) total += descriptor.byteLength;
  check(total === original.totalByteLength, "original inventory byte total drifted");
  same([...expected].sort(), [...files.keys()].sort(), "original inventory is not the complete archive");
  assertBytes(bytesAt(files, original.packagingScript.path), original.packagingScript);
  const observed = summarizeRetainedDependencyLicenseOutput(files);
  same(observed, manifest.observed, "saved summary differs from raw observations");
  return observed;
}
