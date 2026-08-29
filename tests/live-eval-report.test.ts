import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  captureLiveEvalRepositoryState,
  captureLiveEvalSourceFingerprint,
  formatLiveEvalArchiveFilename,
  persistLiveEvalReport,
  reconcileLiveEvalRepositoryStates,
  reconcileLiveEvalSourceFingerprints,
  type RepositoryCommandRunner,
  verifyLiveEvalArchiveMatchesLatest,
} from "../scripts/ai/live-eval-report";

const firstRunId = "11111111-1111-4111-8111-111111111111";
const secondRunId = "22222222-2222-4222-8222-222222222222";
const thirdRunId = "33333333-3333-4333-8333-333333333333";
const fourthRunId = "44444444-4444-4444-8444-444444444444";

describe("live eval report provenance", () => {
  it("distinguishes a clean exact commit from a dirty base commit", () => {
    const headCommit = "a".repeat(40);
    const cleanRunner: RepositoryCommandRunner = (args) => ({
      ok: true,
      stdout: args[0] === "rev-parse" ? `${headCommit}\n` : "",
    });
    const dirtyStatus = " M config/secret-name.env\n?? private-file.txt\n";
    const dirtyRunner: RepositoryCommandRunner = (args) => ({
      ok: true,
      stdout: args[0] === "rev-parse" ? `${headCommit}\n` : dirtyStatus,
    });

    expect(captureLiveEvalRepositoryState("/workspace", cleanRunner)).toEqual({
      baseHeadCommit: headCommit,
      evaluatedCommit: headCommit,
      worktreeState: "clean",
    });
    const dirty = captureLiveEvalRepositoryState("/workspace", dirtyRunner);
    expect(dirty).toEqual({
      baseHeadCommit: headCommit,
      evaluatedCommit: null,
      worktreeState: "dirty",
    });
    expect(JSON.stringify(dirty)).not.toContain("secret-name");
    expect(JSON.stringify(dirty)).not.toContain("private-file");
  });

  it("fails closed when HEAD changes around status or across the run", () => {
    const firstHead = "a".repeat(40);
    const secondHead = "b".repeat(40);
    let headReadCount = 0;
    const changingRunner: RepositoryCommandRunner = (args) => ({
      ok: true,
      stdout: args[0] === "rev-parse"
        ? `${headReadCount++ === 0 ? firstHead : secondHead}\n`
        : "",
    });

    expect(
      captureLiveEvalRepositoryState("/workspace", changingRunner),
    ).toEqual({
      baseHeadCommit: null,
      evaluatedCommit: null,
      worktreeState: "unavailable",
    });
    expect(
      reconcileLiveEvalRepositoryStates(
        {
          baseHeadCommit: firstHead,
          evaluatedCommit: firstHead,
          worktreeState: "clean",
        },
        {
          baseHeadCommit: secondHead,
          evaluatedCommit: secondHead,
          worktreeState: "clean",
        },
      ),
    ).toEqual({
      baseHeadCommit: null,
      evaluatedCommit: null,
      worktreeState: "unavailable",
    });
  });

  it("marks a stable base dirty when either run boundary is dirty", () => {
    const headCommit = "a".repeat(40);
    expect(
      reconcileLiveEvalRepositoryStates(
        {
          baseHeadCommit: headCommit,
          evaluatedCommit: headCommit,
          worktreeState: "clean",
        },
        {
          baseHeadCommit: headCommit,
          evaluatedCommit: null,
          worktreeState: "dirty",
        },
      ),
    ).toEqual({
      baseHeadCommit: headCommit,
      evaluatedCommit: null,
      worktreeState: "dirty",
    });
  });

  it.each([
    {
      runner: (() => ({ ok: false, stdout: "fatal: not a repository" })) satisfies RepositoryCommandRunner,
    },
    {
      runner: ((args) => ({
        ok: args[0] === "rev-parse",
        stdout: args[0] === "rev-parse" ? `${"b".repeat(40)}\n` : "fatal",
      })) satisfies RepositoryCommandRunner,
    },
    {
      runner: (() => ({ ok: true, stdout: "not-a-sha\n" })) satisfies RepositoryCommandRunner,
    },
  ])("fails closed when Git provenance is unavailable", ({ runner }) => {
    expect(captureLiveEvalRepositoryState("/workspace", runner)).toEqual({
      baseHeadCommit: null,
      evaluatedCommit: null,
      worktreeState: "unavailable",
    });
  });

  it("uses a colon-free timestamp and rejects unsafe archive identity fields", () => {
    expect(
      formatLiveEvalArchiveFilename(
        "2026-08-30T01:02:03.456Z",
        firstRunId,
      ),
    ).toBe(
      `ai-live-eval-20260830T010203456Z-${firstRunId}.json`,
    );
    expect(() =>
      formatLiveEvalArchiveFilename("2026-08-30", firstRunId)
    ).toThrow("invalid archive identity");
    expect(() =>
      formatLiveEvalArchiveFilename(
        "2026-08-30T01:02:03.456Z",
        "../../latest",
      )
    ).toThrow("invalid archive identity");
  });
});

describe("live eval evaluated-source fingerprint", () => {
  it("hashes stable sorted paths and bytes across tracked and unignored files", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-source-"));
    try {
      const trackedPaths = [
        "src/example.ts",
        "drizzle/0001.sql",
        "scripts/ai/live-eval.ts",
        "package.json",
        "pnpm-lock.yaml",
        "tsconfig.json",
      ];
      const untrackedPaths = [
        "evals/new-case.ts",
        "scripts/ai/live-eval-report.ts",
      ];
      for (const path of [...trackedPaths, ...untrackedPaths]) {
        await mkdir(resolve(workspace, ...path.split("/").slice(0, -1)), {
          recursive: true,
        });
        await writeFile(
          resolve(workspace, ...path.split("/")),
          path === "evals/new-case.ts" ? "TOP_SECRET_VALUE" : `bytes:${path}`,
          "utf8",
        );
      }

      let reverseOutput = false;
      const calls: string[][] = [];
      const runner: RepositoryCommandRunner = (args) => {
        calls.push([...args]);
        const paths = args.includes("--others") ? untrackedPaths : trackedPaths;
        const ordered = reverseOutput ? [...paths].reverse() : paths;
        return { ok: true, stdout: `${ordered.join("\0")}\0` };
      };
      const first = await captureLiveEvalSourceFingerprint(workspace, runner);
      reverseOutput = true;
      const reordered = await captureLiveEvalSourceFingerprint(workspace, runner);

      expect(first).toEqual(reordered);
      expect(first).toMatchObject({
        algorithm: "sha256",
        fileCount: 8,
        status: "captured",
      });
      expect(first.digest).toMatch(/^[0-9a-f]{64}$/u);
      expect(JSON.stringify(first)).not.toContain("TOP_SECRET_VALUE");
      expect(JSON.stringify(first)).not.toContain("evals/new-case.ts");
      expect(calls.some((args) => args.includes("--exclude-standard"))).toBe(
        true,
      );
      expect(calls.every((args) => args.includes("src"))).toBe(true);
      expect(calls.every((args) => args.includes("drizzle"))).toBe(true);
      expect(calls.every((args) => args.includes("scripts/ai"))).toBe(true);
      expect(calls.every((args) => args.includes("package.json"))).toBe(true);

      await writeFile(
        resolve(workspace, "evals/new-case.ts"),
        "changed bytes",
        "utf8",
      );
      const changed = await captureLiveEvalSourceFingerprint(workspace, runner);
      expect(changed.status).toBe("captured");
      expect(changed.digest).not.toBe(first.digest);
      expect(reconcileLiveEvalSourceFingerprints(first, reordered)).toEqual(
        first,
      );
      expect(reconcileLiveEvalSourceFingerprints(first, changed)).toEqual({
        algorithm: "sha256",
        digest: null,
        fileCount: null,
        status: "unstable",
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails closed for Git errors, unsafe paths, and empty source sets", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-source-"));
    try {
      const failed: RepositoryCommandRunner = () => ({ ok: false, stdout: "" });
      const unsafe: RepositoryCommandRunner = () => ({
        ok: true,
        stdout: "../outside-secret\0",
      });
      const empty: RepositoryCommandRunner = () => ({ ok: true, stdout: "" });

      for (const runner of [failed, unsafe, empty]) {
        await expect(
          captureLiveEvalSourceFingerprint(workspace, runner),
        ).resolves.toEqual({
          algorithm: "sha256",
          digest: null,
          fileCount: null,
          status: "unavailable",
        });
      }
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects symlinks instead of hashing bytes outside the source tree", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-source-"));
    try {
      const outsidePath = resolve(workspace, "outside-secret.txt");
      const sourcePath = resolve(workspace, "src/linked.ts");
      await mkdir(resolve(workspace, "src"), { recursive: true });
      await writeFile(outsidePath, "OUTSIDE_SECRET_VALUE", "utf8");
      await symlink(outsidePath, sourcePath, "file");
      const runner: RepositoryCommandRunner = (args) => ({
        ok: true,
        stdout: args.includes("--others") ? "" : "src/linked.ts\0",
      });

      const fingerprint = await captureLiveEvalSourceFingerprint(
        workspace,
        runner,
      );
      expect(fingerprint).toEqual({
        algorithm: "sha256",
        digest: null,
        fileCount: null,
        status: "unavailable",
      });
      expect(JSON.stringify(fingerprint)).not.toContain("OUTSIDE_SECRET_VALUE");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

describe("live eval report retention", () => {
  it("retains every report before advancing latest", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      const first = {
        evaluatedAt: "2026-08-30T01:02:03.456Z",
        outcome: "failed",
        runId: firstRunId,
      };
      const second = {
        evaluatedAt: "2026-08-30T01:03:04.567Z",
        outcome: "passed",
        runId: secondRunId,
      };
      const firstPaths = await persistLiveEvalReport(workspace, first);
      expect(firstPaths.latestUpdated).toBe(true);
      const firstText = await readFile(firstPaths.archivePath, "utf8");
      const secondPaths = await persistLiveEvalReport(workspace, second);
      expect(secondPaths.latestUpdated).toBe(true);
      const stale = {
        evaluatedAt: "2026-08-30T01:01:02.345Z",
        outcome: "completed later but evaluated earlier",
        runId: thirdRunId,
      };
      const stalePaths = await persistLiveEvalReport(workspace, stale);
      expect(stalePaths.latestUpdated).toBe(false);

      expect(JSON.parse(firstText)).toEqual(first);
      expect(await readFile(firstPaths.archivePath, "utf8")).toBe(firstText);
      expect(await readFile(secondPaths.archivePath, "utf8")).toBe(
        `${JSON.stringify(second, null, 2)}\n`,
      );
      expect(await readFile(secondPaths.latestPath, "utf8")).toBe(
        await readFile(secondPaths.archivePath, "utf8"),
      );
      expect(JSON.parse(await readFile(stalePaths.archivePath, "utf8"))).toEqual(
        stale,
      );
      await expect(
        verifyLiveEvalArchiveMatchesLatest(
          workspace,
          second,
          await readFile(secondPaths.latestPath, "utf8"),
        ),
      ).resolves.toBeUndefined();
      await expect(
        verifyLiveEvalArchiveMatchesLatest(workspace, second, "tampered\n"),
      ).rejects.toThrow("does not byte-match its append-only archive");
      expect(
        (await readdir(resolve(workspace, "docs/evals/archive"))).sort(),
      ).toEqual([
        formatLiveEvalArchiveFilename(first.evaluatedAt, first.runId),
        formatLiveEvalArchiveFilename(stale.evaluatedAt, stale.runId),
        formatLiveEvalArchiveFilename(second.evaluatedAt, second.runId),
      ].sort());
      expect(await readdir(resolve(workspace, "docs/evals"))).not.toContain(
        `.ai-live-eval-latest-${second.runId}.tmp`,
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("serializes concurrent latest updates and keeps the newest evaluation", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      const reports = [
        {
          evaluatedAt: "2026-08-30T02:00:00.000Z",
          runId: firstRunId,
        },
        {
          evaluatedAt: "2026-08-30T02:00:02.000Z",
          runId: secondRunId,
        },
        {
          evaluatedAt: "2026-08-30T02:00:01.000Z",
          runId: thirdRunId,
        },
        {
          evaluatedAt: "2026-08-30T01:59:59.999Z",
          runId: fourthRunId,
        },
      ];

      await Promise.all(
        reports.map((report) => persistLiveEvalReport(workspace, report)),
      );
      expect(
        JSON.parse(
          await readFile(
            resolve(workspace, "docs/evals/ai-live-eval-latest.json"),
            "utf8",
          ),
        ),
      ).toEqual(reports[1]);
      expect(
        await readdir(resolve(workspace, "docs/evals/archive")),
      ).toHaveLength(reports.length);
      expect(await readdir(resolve(workspace, "docs/evals"))).not.toContain(
        ".ai-live-eval-latest.lock",
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("does not steal a held latest lock", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      await mkdir(resolve(workspace, "docs/evals/archive"), { recursive: true });
      await mkdir(resolve(workspace, "docs/evals/.ai-live-eval-latest.lock"));
      const report = {
        evaluatedAt: "2026-08-30T02:00:00.000Z",
        runId: firstRunId,
      };

      await expect(
        persistLiveEvalReport(workspace, report, {
          latestLockRetryMs: 1,
          latestLockTimeoutMs: 5,
        }),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(
        JSON.parse(
          await readFile(
            resolve(
              workspace,
              "docs/evals/archive",
              formatLiveEvalArchiveFilename(report.evaluatedAt, report.runId),
            ),
            "utf8",
          ),
        ),
      ).toEqual(report);
      await expect(
        readFile(
          resolve(workspace, "docs/evals/ai-live-eval-latest.json"),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("never overwrites an existing append-only run archive", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      const original = {
        evaluatedAt: "2026-08-30T01:02:03.456Z",
        outcome: "first",
        runId: firstRunId,
      };
      const paths = await persistLiveEvalReport(workspace, original);
      const latestBefore = await readFile(paths.latestPath, "utf8");

      await expect(
        persistLiveEvalReport(workspace, {
          ...original,
          outcome: "replacement",
        }),
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(paths.archivePath, "utf8")).toBe(latestBefore);
      expect(await readFile(paths.latestPath, "utf8")).toBe(latestBefore);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("keeps the archive when updating latest fails", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      await mkdir(
        resolve(workspace, "docs/evals/ai-live-eval-latest.json"),
        { recursive: true },
      );
      const report = {
        evaluatedAt: "2026-08-30T01:02:03.456Z",
        outcome: "failed",
        runId: firstRunId,
      };

      await expect(persistLiveEvalReport(workspace, report)).rejects.toBeDefined();
      const archiveFiles = await readdir(
        resolve(workspace, "docs/evals/archive"),
      );
      expect(archiveFiles).toEqual([
        formatLiveEvalArchiveFilename(report.evaluatedAt, report.runId),
      ]);
      expect(await readdir(resolve(workspace, "docs/evals"))).not.toContain(
        `.ai-live-eval-latest-${report.runId}.tmp`,
      );
      expect(
        JSON.parse(
          await readFile(
            resolve(workspace, "docs/evals/archive", archiveFiles[0] ?? ""),
            "utf8",
          ),
        ),
      ).toEqual(report);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
