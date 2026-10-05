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

// Deliberately deny by default. New source roots, server/domain code, migration,
// ingestion, seed/signoff and dependency changes require the full data protocol.
// This first fast path covers presentation and engineering-only maintenance.
export function isApplicationOnlyInput(path: string): boolean {
  if (path === "docs/ACCEPTANCE.md" || path.startsWith("docs/research/")) return false;
  return /^(?:src\/components\/|src\/i18n\/|public\/|tests\/|e2e(?:-[a-z-]+)?\/|docs\/|\.github\/)/u.test(path) ||
    /^(?:scripts\/(?:deploy|ci|ops|portfolio)\/)/u.test(path) ||
    /^(?:README(?:\.[a-zA-Z-]+)?\.md|eslint\.config\.mjs)$/u.test(path);
}

export function compareApplicationInputs(previousValue: unknown, candidateValue: unknown) {
  const previous = applicationInputManifestSchema.parse(previousValue);
  const candidate = applicationInputManifestSchema.parse(candidateValue);
  if (previous.commit === candidate.commit) throw new Error("application release must be distinct");
  const contractFiles = (manifest: typeof previous) => manifest.files.filter((file) => !isApplicationOnlyInput(file.path))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const before = contractFiles(previous);
  const after = contractFiles(candidate);
  if (!before.some((file) => file.path === "drizzle/meta/_journal.json") ||
    !before.some((file) => file.path === "src/server/db/schema/index.ts") ||
    !before.some((file) => file.path === "src/server/config/public-product-publication.ts") ||
    JSON.stringify(before) !== JSON.stringify(after)) throw new Error("data contract changed; full release required");
  return {
    previousRelease: previous.commit, release: candidate.commit,
    previousInputDigest: previous.inputDigest, inputDigest: candidate.inputDigest,
    dataContractSha256: createHash("sha256").update(JSON.stringify(before)).digest("hex"),
    protectedFileCount: before.length,
  };
}

export const applicationDataTables = [
  "countries", "country_jurisdictions", "data_change_logs", "data_governance_drafts",
  "data_sources", "jurisdictions", "market_import_batches", "market_metrics",
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
