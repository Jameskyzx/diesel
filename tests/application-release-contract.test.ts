import { describe, expect, it } from "vitest";
import { applicationDataTables, applicationFingerprintSchema, assertApplicationDataUnchanged, classifyReleaseInputs, compareApplicationInputs, isApplicationOnlyInput } from "../scripts/deploy/application-release-contract";

const files = ["drizzle/meta/_journal.json", "src/server/db/schema/index.ts", "src/server/config/public-product-publication.ts", "src/components/header.tsx"]
  .map((path) => ({ path, mode: "100644" as const, size: 10, sha256: "c".repeat(64) }));
const previous = { format: "diesel-release-input-v2", commit: "a".repeat(40), inputDigest: "d".repeat(64), files };
const candidate = { ...previous, commit: "b".repeat(40), inputDigest: "e".repeat(64) };
const report = () => applicationFingerprintSchema.parse({
  format: "diesel-application-verification-v2", ...compareApplicationInputs(previous, candidate),
  checkedAt: "2026-10-05T00:00:00.000Z",
  tables: applicationDataTables.map((table) => ({ table, count: 5, sha256: "f".repeat(64) })),
});

describe("versioned application-only release contract", () => {
  it("allows presentation/maintenance changes while binding both immutable input manifests", () => {
    const result = compareApplicationInputs(previous, { ...candidate, files: [...files.slice(0, -1), { ...files[3], sha256: "1".repeat(64) }] });
    expect(result.release).toBe(candidate.commit);
    expect(result.previousRelease).toBe(previous.commit);
    expect(result.inputDigest).toBe(candidate.inputDigest);
    expect(result.protectedFileCount).toBe(3);
  });
  it("allows the static browser icon", () => {
    const icon = { path: "src/app/icon.svg", mode: "100644" as const, size: 10, sha256: "c".repeat(64) };
    expect(isApplicationOnlyInput(icon.path)).toBe(true);
    expect(compareApplicationInputs(
      { ...previous, files: [...files, icon] },
      { ...candidate, files: [...files, { ...icon, sha256: "1".repeat(64) }] },
    ).protectedFileCount).toBe(3);
  });
  it.each([
    "drizzle/0010_new.sql", "src/server/db/seed/acceptance-fixtures.ts", "src/server/config/public-product-publication.ts",
    "scripts/db/ingest-accepted-fixtures.ts", "scripts/db/application-fingerprint-query.ts",
    "scripts/db/production-readback.ts", "docs/ACCEPTANCE.md", "docs/research/signoff.md",
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "patches/something.patch", "unknown/data.json",
    "src/data/products/approved.json", "src/data/products/demo-engine-catalog.json.sql",
    "src/data/products/demo-engine-catalog.json/seed.ts", "src/data/regulations.json",
    "src/server/db/seed/demo-engine-catalog.ts", "scripts/db/import-catalog.ts",
    "playwright.database.config.ts", "next.config.ts", "drizzle.config.ts",
  ])("refuses changed or newly introduced data inputs: %s", (path) => {
    expect(isApplicationOnlyInput(path)).toBe(false);
    const nextFiles = files.filter((file) => file.path !== path);
    nextFiles.push({ path, mode: "100644", size: 11, sha256: "1".repeat(64) });
    expect(() => compareApplicationInputs(previous, { ...candidate, files: nextFiles })).toThrow(/full release required/u);
    expect(classifyReleaseInputs(previous, { ...candidate, files: nextFiles }).mode).toBe("full");
  });
  it.each([
    "src/app/api/chat/route.ts", "src/app/layout.tsx", "src/domain/regulations.ts",
    "src/server/ai/sales-chat.ts", "src/server/repositories/regulations.ts",
    "src/server/services/product-fit.ts", "src/features/analyses/comparison-rows.ts",
    "scripts/db/verify-application-release.ts",
  ])("uses the verified code-only path for runtime changes: %s", (path) => {
    expect(isApplicationOnlyInput(path)).toBe(true);
    expect(classifyReleaseInputs(previous, { ...candidate, files: [...files, { ...files[0], path }] }).mode).toBe("application");
  });
  it.each([
    "src/data/products/demo-engine-catalog.json", "src/data/products/weichai-catalog.json", "playwright.config.ts", "playwright.demo.config.ts",
    "playwright.fde.config.ts", "playwright.live.config.ts", "playwright.production.config.ts",
  ])("classifies read-only catalogue and browser configuration additions, edits and removals: %s", (path) => {
    const input = { ...files[0], path };
    const beforeWithInput = { ...previous, files: [...files, input] };
    for (const [before, after] of [
      [previous, { ...candidate, files: [...files, input] }],
      [beforeWithInput, { ...candidate, files: [...files, { ...input, sha256: "1".repeat(64) }] }],
      [beforeWithInput, candidate],
    ]) {
      const classified = classifyReleaseInputs(before, after);
      expect(classified.mode).toBe("application");
      expect(classified.protectedFileCount).toBe(3);
      expect(classified.dataContractSha256).toBe(classifyReleaseInputs(previous, candidate).dataContractSha256);
      expect(classified.previousInputDigest).toBe(previous.inputDigest);
      expect(classified.inputDigest).toBe(candidate.inputDigest);
    }
  });
  it("keeps full publication mandatory when catalogue/UI changes accompany approved-product changes", () => {
    const catalogueFiles = [...files, ...[
      "src/data/products/demo-engine-catalog.json", "playwright.config.ts", "playwright.demo.config.ts",
      "playwright.fde.config.ts", "src/server/ai/catalog-harness.ts", "src/app/products/page.tsx",
    ].map(path => ({ ...files[0], path }))];
    expect(classifyReleaseInputs(previous, { ...candidate, files: catalogueFiles }).mode).toBe("application");
    const approvedFiles = catalogueFiles.map(file => file.path === "src/server/config/public-product-publication.ts"
      ? { ...file, sha256: "1".repeat(64) } : file);
    expect(classifyReleaseInputs(previous, { ...candidate, files: approvedFiles }).mode).toBe("full");
    expect(() => compareApplicationInputs(previous, { ...candidate, files: approvedFiles })).toThrow(/full release required/u);
  });
  it("rejects deletion, duplicate path, same release and absent baseline schema", () => {
    expect(() => compareApplicationInputs(previous, { ...candidate, files: files.slice(1) })).toThrow();
    expect(() => compareApplicationInputs(previous, { ...candidate, files: [...files, files[0]] })).toThrow();
    expect(() => compareApplicationInputs(previous, previous)).toThrow();
    expect(() => compareApplicationInputs({ ...previous, files: [files[3]] }, { ...candidate, files: [files[3]] })).toThrow();
  });
  it("accepts different timestamps only; row counts, hashes and release identities must agree", () => {
    const before = report();
    expect(() => assertApplicationDataUnchanged(before, { ...before, checkedAt: "2026-10-05T00:01:00.000Z" })).not.toThrow();
    for (const field of ["release", "previousRelease", "inputDigest", "dataContractSha256"] as const) {
      expect(() => assertApplicationDataUnchanged(before, { ...before, [field]: "1".repeat(before[field].length) })).toThrow();
    }
    expect(() => assertApplicationDataUnchanged(before, { ...before, tables: before.tables.map((row, i) => i === 0 ? { ...row, count: 6 } : row) })).toThrow();
    expect(() => assertApplicationDataUnchanged(before, { ...before, tables: before.tables.map((row, i) => i === 0 ? { ...row, sha256: "1".repeat(64) } : row) })).toThrow();
  });
  it("requires every governed table exactly once, with bounded counts and no raw content", () => {
    const valid = report();
    for (const tables of [valid.tables.slice(1), [...valid.tables].reverse(), valid.tables.map((row) => ({ ...row, count: 100001 })), valid.tables.map((row) => ({ ...row, content: "private" }))]) {
      expect(applicationFingerprintSchema.safeParse({ ...valid, tables }).success).toBe(false);
    }
  });
});
