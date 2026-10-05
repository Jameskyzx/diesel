import { describe, expect, it } from "vitest";
import { applicationDataTables, applicationFingerprintSchema, assertApplicationDataUnchanged, compareApplicationInputs, isApplicationOnlyInput } from "../scripts/deploy/application-release-contract";

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
  it.each([
    "drizzle/0010_new.sql", "src/server/db/seed/acceptance-fixtures.ts", "src/server/config/public-product-publication.ts",
    "scripts/db/ingest-accepted-fixtures.ts", "src/domain/regulations.ts", "docs/ACCEPTANCE.md", "docs/research/signoff.md",
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "patches/something.patch", "unknown/data.json",
  ])("refuses changed or newly introduced data inputs: %s", (path) => {
    expect(isApplicationOnlyInput(path)).toBe(false);
    const nextFiles = files.filter((file) => file.path !== path);
    nextFiles.push({ path, mode: "100644", size: 11, sha256: "1".repeat(64) });
    expect(() => compareApplicationInputs(previous, { ...candidate, files: nextFiles })).toThrow(/full release required/u);
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
