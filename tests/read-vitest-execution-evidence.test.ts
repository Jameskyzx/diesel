import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  readVitestExecutionEvidence,
} from "../scripts/portfolio/read-vitest-execution-evidence";
import {
  EXPECTED_VITEST_VERSION,
  VITEST_EXECUTION_EVIDENCE_MAX_BYTES,
  VITEST_EXECUTION_EVIDENCE_VERSION,
  serializeCanonicalVitestExecutionEvidence,
  vitestExecutionEvidencePath,
  type VitestExecutionEvidence,
} from "../scripts/portfolio/vitest-execution-evidence";

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(
    join(realpathSync(process.env.TMPDIR ?? "/tmp"), prefix),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function canonicalEvidence(): VitestExecutionEvidence {
  return {
    command: "pnpm test",
    complete: true,
    completedAt: "2026-09-04T01:01:00.000Z",
    configPath: "vitest.config.ts",
    provenance: {
      baseHeadCommit: "a".repeat(40),
      evaluatedCommit: "a".repeat(40),
      sourceFingerprint: {
        algorithm: "sha256",
        digest: "b".repeat(64),
        fileCount: 2,
      },
      worktreeState: "clean",
    },
    runId: "123e4567-e89b-42d3-a456-426614174000",
    startedAt: "2026-09-04T01:00:00.000Z",
    tests: [
      { id: "c".repeat(64), status: "passed" },
      { id: "d".repeat(64), status: "skipped" },
    ],
    totals: {
      collectedFiles: 1,
      collectedSuites: 1,
      collectedTests: 2,
      failedTests: 0,
      passedTests: 1,
      pendingTests: 0,
      skippedTests: 1,
      todoTests: 0,
    },
    version: VITEST_EXECUTION_EVIDENCE_VERSION,
    vitestVersion: EXPECTED_VITEST_VERSION,
  };
}

function write(
  workspace: string,
  path: string,
  contents: string | Buffer,
): string {
  const absolutePath = resolve(workspace, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
  return absolutePath;
}

function writeCanonical(workspace: string): string {
  return write(
    workspace,
    vitestExecutionEvidencePath,
    serializeCanonicalVitestExecutionEvidence(canonicalEvidence()),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("readVitestExecutionEvidence", () => {
  it("returns the canonical text and parsed evidence", () => {
    const workspace = temporaryDirectory("diesel-vitest-read-");
    const expectedText = serializeCanonicalVitestExecutionEvidence(
      canonicalEvidence(),
    );
    writeCanonical(workspace);

    expect(readVitestExecutionEvidence(workspace)).toEqual({
      evidence: canonicalEvidence(),
      text: expectedText,
    });
  });

  it("fails closed when the evidence is missing", () => {
    const workspace = temporaryDirectory("diesel-vitest-read-missing-");
    mkdirSync(resolve(workspace, "docs/evidence"), { recursive: true });

    expect(() => readVitestExecutionEvidence(workspace)).toThrow(/missing/u);
  });

  it("rejects direct and parent-directory symbolic links", () => {
    const directWorkspace = temporaryDirectory("diesel-vitest-read-link-");
    const directTarget = write(
      directWorkspace,
      "real.json",
      serializeCanonicalVitestExecutionEvidence(canonicalEvidence()),
    );
    mkdirSync(resolve(directWorkspace, "docs/evidence"), { recursive: true });
    symlinkSync(
      directTarget,
      resolve(directWorkspace, vitestExecutionEvidencePath),
    );
    expect(() => readVitestExecutionEvidence(directWorkspace)).toThrow(
      /non-symlink/u,
    );

    const parentWorkspace = temporaryDirectory("diesel-vitest-read-parent-");
    const physicalParent = resolve(parentWorkspace, "physical-evidence");
    mkdirSync(physicalParent);
    write(
      parentWorkspace,
      "physical-evidence/vitest-execution-latest.json",
      serializeCanonicalVitestExecutionEvidence(canonicalEvidence()),
    );
    mkdirSync(resolve(parentWorkspace, "docs"));
    symlinkSync(physicalParent, resolve(parentWorkspace, "docs/evidence"));
    expect(() => readVitestExecutionEvidence(parentWorkspace)).toThrow(
      /parent path.*non-symlink/u,
    );
  });

  it("rejects a workspace reached through a symbolic link", () => {
    const physicalWorkspace = temporaryDirectory(
      "diesel-vitest-read-workspace-",
    );
    writeCanonical(physicalWorkspace);
    const linkContainer = temporaryDirectory(
      "diesel-vitest-read-workspace-link-",
    );
    const linkedWorkspace = resolve(linkContainer, "workspace");
    symlinkSync(physicalWorkspace, linkedWorkspace);

    expect(() => readVitestExecutionEvidence(linkedWorkspace)).toThrow(
      /workspace.*non-symlink/u,
    );
  });

  it("rejects directories, empty files, and oversized files", () => {
    const directoryWorkspace = temporaryDirectory("diesel-vitest-read-dir-");
    mkdirSync(resolve(directoryWorkspace, vitestExecutionEvidencePath), {
      recursive: true,
    });
    expect(() => readVitestExecutionEvidence(directoryWorkspace)).toThrow(
      /regular non-symlink file/u,
    );

    const emptyWorkspace = temporaryDirectory("diesel-vitest-read-empty-");
    write(emptyWorkspace, vitestExecutionEvidencePath, "");
    expect(() => readVitestExecutionEvidence(emptyWorkspace)).toThrow(
      /non-empty bounded/u,
    );

    const oversizedWorkspace = temporaryDirectory("diesel-vitest-read-big-");
    write(
      oversizedWorkspace,
      vitestExecutionEvidencePath,
      Buffer.alloc(VITEST_EXECUTION_EVIDENCE_MAX_BYTES + 1, 0x61),
    );
    expect(() => readVitestExecutionEvidence(oversizedWorkspace)).toThrow(
      /bounded/u,
    );
  });

  it("rejects invalid UTF-8 and non-canonical JSON", () => {
    const utf8Workspace = temporaryDirectory("diesel-vitest-read-utf8-");
    write(
      utf8Workspace,
      vitestExecutionEvidencePath,
      Buffer.from([0xc3, 0x28]),
    );
    expect(() => readVitestExecutionEvidence(utf8Workspace)).toThrow(
      /not valid UTF-8/u,
    );

    const jsonWorkspace = temporaryDirectory("diesel-vitest-read-json-");
    write(
      jsonWorkspace,
      vitestExecutionEvidencePath,
      JSON.stringify(canonicalEvidence()),
    );
    expect(() => readVitestExecutionEvidence(jsonWorkspace)).toThrow(
      /canonical two-space JSON/u,
    );
  });

  it("applies containment checks to the optional repository path", () => {
    const workspace = temporaryDirectory("diesel-vitest-read-path-");
    writeCanonical(workspace);
    const customPath = "fixtures/custom-evidence.json";
    const customText = serializeCanonicalVitestExecutionEvidence(
      canonicalEvidence(),
    );
    write(workspace, customPath, customText);

    expect(readVitestExecutionEvidence(workspace, customPath)).toEqual({
      evidence: canonicalEvidence(),
      text: customText,
    });

    for (const path of [
      "../outside.json",
      "/absolute.json",
      "docs//evidence.json",
      "docs/./evidence.json",
      "docs\\evidence.json",
    ]) {
      expect(() => readVitestExecutionEvidence(workspace, path)).toThrow(
        /repository-relative/u,
      );
    }
  });
});
