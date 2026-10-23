import { createHash } from "node:crypto";
import { z } from "zod";

const sha = z.string().regex(/^[0-9a-f]{40}$/u);
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const fileSchema = z.strictObject({
  path: z.string().min(1).refine((path) => !path.startsWith("/") && !/[\\\x00-\x1f\x7f]/u.test(path) &&
    !path.split("/").some((part) => ["", ".", ".."].includes(part))),
  mode: z.enum(["100644", "100755"]), size: z.number().int().nonnegative(), sha256: hash,
});
export const applicationInputManifestSchema = z.strictObject({
  format: z.literal("diesel-release-input-v2"), commit: sha,
  inputDigest: hash, files: z.array(fileSchema).min(1).max(100_000),
}).refine((manifest) => new Set(manifest.files.map((file) => file.path)).size === manifest.files.length);

// Classify persistence inputs, not whether application code runs on the server.
// Runtime behaviour still needs CI and before/after database fingerprints, but
// changing a prompt or route must not republish unchanged governance fixtures.
// Unclassified roots and persistence/dependency changes remain fail-closed.
export function isApplicationOnlyInput(path: string): boolean {
  // This read-only deployment verifier is maintenance code, not an ingestion
  // or schema input. Its fingerprint SQL, DB runtime and migrations stay denied.
  if (path === "scripts/db/verify-application-release.ts") return true;
  // The fictional demo catalogue is bundled read-only, never seeded into
  // governed products/certifications. Do not allow the rest of src/data here.
  // The retired catalogue path stays listed so that its removal does not force
  // a governance republish; drop it once no deployed release contains it.
  if (path === "src/data/products/demo-engine-catalog.json" ||
    path === "src/data/products/weichai-catalog.json") return true;
  // Enumerate existing browser-test configuration, not arbitrary root inputs.
  if (["playwright.config.ts", "playwright.demo.config.ts", "playwright.fde.config.ts",
    "playwright.live.config.ts", "playwright.production.config.ts"].includes(path)) return true;
  if (path === "docs/ACCEPTANCE.md" || path.startsWith("docs/research/") ||
    path === "src/server/config/public-product-publication.ts") return false;
  return /^(?:src\/(?:app|components|domain|features|i18n|lib)\/|src\/server\/(?:ai|config|repositories|services)\/|public\/|tests\/|e2e(?:-[a-z-]+)?\/|docs\/|\.github\/)/u.test(path) ||
    /^(?:scripts\/(?:ai|deploy|ci|ops|portfolio)\/)/u.test(path) ||
    /^(?:README(?:\.[a-zA-Z-]+)?\.md|eslint\.config\.mjs)$/u.test(path);
}

export function classifyReleaseInputs(previousValue: unknown, candidateValue: unknown) {
  const previous = applicationInputManifestSchema.parse(previousValue);
  const candidate = applicationInputManifestSchema.parse(candidateValue);
  if (previous.commit === candidate.commit) throw new Error("application release must be distinct");
  const contractFiles = (manifest: typeof previous) => manifest.files.filter((file) => !isApplicationOnlyInput(file.path))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const before = contractFiles(previous);
  const after = contractFiles(candidate);
  if (!before.some((file) => file.path === "drizzle/meta/_journal.json") ||
    !before.some((file) => file.path === "src/server/db/schema/index.ts") ||
    !before.some((file) => file.path === "src/server/config/public-product-publication.ts")) {
    throw new Error("missing baseline data contract");
  }
  return {
    mode: JSON.stringify(before) === JSON.stringify(after) ? "application" as const : "full" as const,
    previousRelease: previous.commit, release: candidate.commit,
    previousInputDigest: previous.inputDigest, inputDigest: candidate.inputDigest,
    dataContractSha256: createHash("sha256").update(JSON.stringify(before)).digest("hex"),
    protectedFileCount: before.length,
  };
}

export function compareApplicationInputs(previousValue: unknown, candidateValue: unknown) {
  const { mode, ...contract } = classifyReleaseInputs(previousValue, candidateValue);
  if (mode !== "application") throw new Error("data contract changed; full release required");
  return contract;
}

export const applicationDataTables = [
  "catalog_engines", "countries", "country_jurisdictions", "data_change_logs", "data_governance_drafts",
  "data_sources", "engine_feedback", "feedback_source_files", "jurisdictions", "market_import_batches", "market_metrics",
  "regulation_limits", "regulations", "products", "product_certifications",
  "documents", "document_chunks", "drizzle.__drizzle_migrations",
] as const;
export const applicationFingerprintSchema = z.strictObject({
  format: z.literal("diesel-application-verification-v2"),
  release: sha, previousRelease: sha, inputDigest: hash, previousInputDigest: hash,
  dataContractSha256: hash, protectedFileCount: z.number().int().positive(),
  tables: z.array(z.strictObject({ table: z.enum(applicationDataTables), count: z.number().int().nonnegative().max(100_000), sha256: hash }))
    .length(applicationDataTables.length),
  checkedAt: z.iso.datetime(),
}).refine((report) => report.tables.every((row, index) => row.table === applicationDataTables[index]));

export function assertApplicationDataUnchanged(beforeValue: unknown, afterValue: unknown): void {
  const { checkedAt: beforeTime, ...before } = applicationFingerprintSchema.parse(beforeValue);
  const { checkedAt: afterTime, ...after } = applicationFingerprintSchema.parse(afterValue);
  if (Date.parse(afterTime) < Date.parse(beforeTime) || JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("application data or observation ordering changed; preserve state for review");
  }
}
