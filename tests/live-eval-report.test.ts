import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildLiveEvalGitEnvironment,
  captureLiveEvalRepositoryState,
  captureLiveEvalSourceFingerprint,
  captureLiveEvalSourceFingerprintAtRevision,
  formatLiveEvalArchiveFilename,
  isTrustedLiveEvalGitBinary,
  liveEvalRunCanSucceed,
  parseCanonicalLiveEvalJson,
  persistLiveEvalReport,
  reconcileLiveEvalRepositoryStates,
  reconcileLiveEvalSourceFingerprints,
  resolveTrustedLiveEvalGitBinary,
  type RepositoryCommandRunner,
  type RepositoryBinaryCommandRunner,
  serializeCanonicalLiveEvalJson,
  verifyLiveEvalArchiveMatchesLatest,
} from "../scripts/ai/live-eval-report";
import {
  fingerprintLiveEvalQuery,
  sanitizeLiveEvalReportArgs,
} from "../scripts/ai/live-eval-report-args";
import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { buildSyntheticLiveEvalReport } from "./helpers/live-eval-report-fixture";

const firstRunId = "11111111-1111-4111-8111-111111111111";
const secondRunId = "22222222-2222-4222-8222-222222222222";
const thirdRunId = "33333333-3333-4333-8333-333333333333";
const fourthRunId = "44444444-4444-4444-8444-444444444444";

describe("live eval report provenance", () => {
  it("uses only executable absolute system Git paths and a closed environment", () => {
    expect(isTrustedLiveEvalGitBinary("git")).toBe(false);
    expect(isTrustedLiveEvalGitBinary("/tmp/git")).toBe(false);
    expect(isTrustedLiveEvalGitBinary("/usr/bin/git")).toBe(true);
    expect(resolveTrustedLiveEvalGitBinary("git")).toBeNull();
    expect(resolveTrustedLiveEvalGitBinary("/tmp/git")).toBeNull();

    const environment = buildLiveEvalGitEnvironment();
    expect(environment).toMatchObject({
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    });
    expect(environment).not.toHaveProperty("AI_API_KEY");
    expect(environment).not.toHaveProperty("NODE_OPTIONS");
    expect(environment).not.toHaveProperty("LD_PRELOAD");
    expect(environment).not.toHaveProperty("DYLD_INSERT_LIBRARIES");
  });

  it("fails repository capture closed for an invalid explicit Git path", () => {
    const previousGitBinary = process.env.LIVE_EVAL_GIT_BINARY;
    process.env.LIVE_EVAL_GIT_BINARY = "git";
    try {
      expect(captureLiveEvalRepositoryState(process.cwd())).toEqual({
        baseHeadCommit: null,
        evaluatedCommit: null,
        worktreeState: "unavailable",
      });
    } finally {
      if (previousGitBinary === undefined) {
        delete process.env.LIVE_EVAL_GIT_BINARY;
      } else {
        process.env.LIVE_EVAL_GIT_BINARY = previousGitBinary;
      }
    }
  });

  it("persists query fingerprints without leaking raw query text", async () => {
    const temporaryWorkspace = await mkdtemp(
      resolve(tmpdir(), "diesel-live-eval-query-redaction-"),
    );
    const marker = "PRIVATE-LIVE-EVAL-QUERY-7f607b2c";

    try {
      const report = buildSyntheticLiveEvalReport({
        commit: "a".repeat(40),
        fingerprintDigest: "b".repeat(64),
        fingerprintFileCount: 1,
        runId: "77777777-7777-4777-8777-777777777777",
      });
      const searchCall = report.results
        .flatMap(({ normalizedArgs }) => normalizedArgs)
        .find(({ tool }) => tool === "searchKnowledgeBase");
      if (!searchCall) {
        throw new Error("Expected a synthetic searchKnowledgeBase call.");
      }
      const searchCase = salesChatLiveCases.find(
        ({ id }) => id === "source-document-retrieval",
      );
      if (!searchCase?.knowledgeQueryContract) {
        throw new Error("Expected a source-query contract.");
      }
      const sanitized = sanitizeLiveEvalReportArgs({
        args: { countryIso3: "CHN", query: marker },
        knowledgeQueryContract: searchCase.knowledgeQueryContract,
        tool: "searchKnowledgeBase",
      });
      searchCall.args = sanitized;
      expect(
        sanitizeLiveEvalReportArgs({
          args: { query: marker, rawPrompt: marker },
          knowledgeQueryContract: searchCase.knowledgeQueryContract,
          tool: "searchKnowledgeBase",
        }),
      ).toEqual({});

      const persisted = await persistLiveEvalReport(
        temporaryWorkspace,
        report,
      );
      const [latestText, archiveText] = await Promise.all([
        readFile(persisted.latestPath, "utf8"),
        readFile(persisted.archivePath, "utf8"),
      ]);
      const expectedFingerprint = fingerprintLiveEvalQuery(marker);
      const expectedReportText = serializeCanonicalLiveEvalJson(report);

      expect(persisted.latestUpdated).toBe(true);
      expect(persisted.reportReceipt).toEqual({
        byteLength: Buffer.byteLength(expectedReportText, "utf8"),
        evaluatedAt: report.evaluatedAt,
        runId: report.runId,
        sha256: createHash("sha256")
          .update(expectedReportText, "utf8")
          .digest("hex"),
      });
      expect(latestText).toBe(archiveText);
      expect(latestText).not.toContain(marker);
      expect(archiveText).not.toContain(marker);
      expect(latestText).not.toContain("rawPrompt");
      expect(JSON.parse(latestText)).toMatchObject({
        results: expect.arrayContaining([
          expect.objectContaining({
            normalizedArgs: expect.arrayContaining([
              expect.objectContaining({
                args: expect.objectContaining({
                  query: expect.objectContaining(expectedFingerprint),
                }),
                tool: "searchKnowledgeBase",
              }),
            ]),
          }),
        ]),
        version: "sales-chat-live-v26",
      });
    } finally {
      await rm(temporaryWorkspace, { force: true, recursive: true });
    }
  });

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
        "pnpm-workspace.yaml",
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
        fileCount: 9,
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
      expect(calls.every((args) => args.includes("scripts/portfolio"))).toBe(
        true,
      );
      expect(calls.every((args) => args.includes(".nvmrc"))).toBe(true);
      expect(calls.every((args) => args.includes("package.json"))).toBe(true);
      expect(calls.every((args) => args.includes("pnpm-workspace.yaml"))).toBe(
        true,
      );
      expect(calls.every((args) => args.includes("vitest.config.ts"))).toBe(
        true,
      );

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

  it("reconstructs a clean source fingerprint from the claimed commit tree", async () => {
    const revision = "a".repeat(40);
    const contents = new Map([
      [".nvmrc", Buffer.from("22\n")],
      ["evals/cases.ts", Buffer.from("export const cases = [];\n")],
      ["scripts/portfolio/verify.ts", Buffer.from("export {};\n")],
      ["src/example.ts", Buffer.from("export const value = 1;\n")],
    ]);
    const objectId = (content: Buffer) =>
      createHash("sha1")
        .update(`blob ${content.byteLength}\0`, "utf8")
        .update(content)
        .digest("hex");
    const textRunner: RepositoryCommandRunner = () => ({
      ok: true,
      stdout: `${revision}\n`,
    });
    const binaryRunner: RepositoryBinaryCommandRunner = (args) => {
      if (args[0] === "ls-tree") {
        return {
          ok: true,
          stdout: Buffer.from(
            [...contents.entries()]
              .map(([path, content]) =>
                `100644 blob ${objectId(content)}\t${path}\0`
              )
              .join(""),
          ),
        };
      }
      const path = args[1]?.slice(revision.length + 1) ?? "";
      const content = contents.get(path);
      return { ok: content !== undefined, stdout: content ?? Buffer.alloc(0) };
    };

    const first = await captureLiveEvalSourceFingerprintAtRevision(
      "/workspace",
      revision,
      textRunner,
      binaryRunner,
    );
    expect(first).toMatchObject({ fileCount: 4, status: "captured" });

    contents.set("scripts/portfolio/verify.ts", Buffer.from("changed\n"));
    const changed = await captureLiveEvalSourceFingerprintAtRevision(
      "/workspace",
      revision,
      textRunner,
      binaryRunner,
    );
    expect(changed.status).toBe("captured");
    expect(changed.digest).not.toBe(first.digest);
  });

  it("fails closed when a claimed commit tree returns bytes for another blob", async () => {
    const revision = "b".repeat(40);
    const textRunner: RepositoryCommandRunner = () => ({
      ok: true,
      stdout: `${revision}\n`,
    });
    const binaryRunner: RepositoryBinaryCommandRunner = (args) =>
      args[0] === "ls-tree"
        ? {
            ok: true,
            stdout: Buffer.from(
              `100644 blob ${"c".repeat(40)}\tsrc/example.ts\0`,
            ),
          }
        : { ok: true, stdout: Buffer.from("different bytes") };

    await expect(
      captureLiveEvalSourceFingerprintAtRevision(
        "/workspace",
        revision,
        textRunner,
        binaryRunner,
      ),
    ).resolves.toMatchObject({ status: "unavailable" });
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

describe("live eval canonical JSON", () => {
  it("uses two-space JSON with exactly one trailing newline", () => {
    const value = { nested: { enabled: true }, version: 1 };
    const serialized = serializeCanonicalLiveEvalJson(value);

    expect(serialized).toBe(
      '{\n  "nested": {\n    "enabled": true\n  },\n  "version": 1\n}\n',
    );
    expect(parseCanonicalLiveEvalJson(serialized)).toEqual(value);
  });

  it.each([
    '{"thresholdsPassed":true}\n',
    '{\n  "thresholdsPassed": false,\n  "thresholdsPassed": true\n}\n',
    '{\n  "thresholdsPassed": true\n}\n\n',
  ])("rejects non-canonical or duplicate-key bytes", (reportText) => {
    expect(() => parseCanonicalLiveEvalJson(reportText)).toThrow(
      /canonical JSON bytes/u,
    );
  });
});

describe("live eval report retention", () => {
  it("accepts only a passing run that became the latest report", () => {
    expect(
      liveEvalRunCanSucceed({ latestUpdated: true, thresholdsPassed: true }),
    ).toBe(true);
    expect(
      liveEvalRunCanSucceed({ latestUpdated: false, thresholdsPassed: true }),
    ).toBe(false);
    expect(
      liveEvalRunCanSucceed({ latestUpdated: true, thresholdsPassed: false }),
    ).toBe(false);
  });

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

  it("syncs archive publication, archive cleanup, and latest publication directories", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      const report = {
        evaluatedAt: "2026-08-30T01:02:03.456Z",
        runId: firstRunId,
      };
      const evalDirectory = resolve(workspace, "docs/evals");
      const archiveDirectory = resolve(evalDirectory, "archive");
      const syncedDirectories: string[] = [];

      const persisted = await persistLiveEvalReport(workspace, report, {
        afterDirectorySync: (path) => {
          syncedDirectories.push(path);
        },
      });

      expect(persisted.latestUpdated).toBe(true);
      expect(syncedDirectories).toEqual([
        evalDirectory,
        archiveDirectory,
        archiveDirectory,
        evalDirectory,
      ]);
      expect(await readFile(persisted.archivePath, "utf8")).toBe(
        await readFile(persisted.latestPath, "utf8"),
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails closed when a post-rename directory durability check fails", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      const report = {
        evaluatedAt: "2026-08-30T01:02:03.456Z",
        runId: firstRunId,
      };
      const evalDirectory = resolve(workspace, "docs/evals");
      let evalDirectorySyncCount = 0;

      await expect(
        persistLiveEvalReport(workspace, report, {
          afterDirectorySync: (path) => {
            if (path === evalDirectory) {
              evalDirectorySyncCount += 1;
            }
            if (path === evalDirectory && evalDirectorySyncCount === 2) {
              throw new Error("synthetic directory sync failure");
            }
          },
        }),
      ).rejects.toThrow("synthetic directory sync failure");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("uses the run ID tie-breaker, ignores legacy names, and rejects a restored stale latest", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      const first = {
        evaluatedAt: "2026-08-30T01:02:03.456Z",
        runId: firstRunId,
      };
      const second = {
        evaluatedAt: first.evaluatedAt,
        runId: secondRunId,
      };
      const firstPaths = await persistLiveEvalReport(workspace, first);
      const firstText = await readFile(firstPaths.archivePath, "utf8");
      const secondPaths = await persistLiveEvalReport(workspace, second);
      const secondText = await readFile(secondPaths.latestPath, "utf8");
      await writeFile(
        resolve(
          workspace,
          "docs/evals/archive/ai-live-eval-2026-08-14-scorer-v1-flawed.json",
        ),
        `${JSON.stringify({ version: "sales-chat-live-v1" }, null, 2)}\n`,
        "utf8",
      );

      await expect(
        verifyLiveEvalArchiveMatchesLatest(workspace, second, secondText),
      ).resolves.toBeUndefined();
      await writeFile(firstPaths.latestPath, firstText, "utf8");

      await expect(
        verifyLiveEvalArchiveMatchesLatest(
          workspace,
          first,
          await readFile(firstPaths.latestPath, "utf8"),
        ),
      ).rejects.toThrow(/not the newest modern archive/u);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it.each([
    {
      target:
        "docs/evals/archive/ai-live-eval-2026-08-30-renamed-modern.json",
      expectedError: /archive filename is malformed/u,
      label: "an unapproved legacy-like basename",
    },
    {
      target:
        "docs/evals/archive/ai-live-eval-2026-08-14-scorer-v1-flawed.json",
      expectedError: /invalid legacy identity/u,
      label: "an approved pre-run-ID basename",
    },
  ])("rejects a newer run renamed to $label", async ({ expectedError, target }) => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      const first = {
        evaluatedAt: "2026-08-30T01:02:03.456Z",
        runId: firstRunId,
      };
      const second = {
        evaluatedAt: "2026-08-30T01:03:04.567Z",
        runId: secondRunId,
      };
      const firstPaths = await persistLiveEvalReport(workspace, first);
      const firstText = await readFile(firstPaths.archivePath, "utf8");
      const secondPaths = await persistLiveEvalReport(workspace, second);
      await rename(
        secondPaths.archivePath,
        resolve(workspace, target),
      );
      await writeFile(firstPaths.latestPath, firstText, "utf8");

      await expect(
        verifyLiveEvalArchiveMatchesLatest(workspace, first, firstText),
      ).rejects.toThrow(expectedError);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("rejects a modern archive whose filename and report identity differ", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      const report = {
        evaluatedAt: "2026-08-30T01:02:03.456Z",
        runId: firstRunId,
      };
      const paths = await persistLiveEvalReport(workspace, report);
      const driftedText = `${JSON.stringify({
        ...report,
        runId: secondRunId,
      }, null, 2)}\n`;
      await Promise.all([
        writeFile(paths.archivePath, driftedText, "utf8"),
        writeFile(paths.latestPath, driftedText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalArchiveMatchesLatest(workspace, report, driftedText),
      ).rejects.toThrow(/filename does not match its report identity/u);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it.each([
    {
      filename: "ai-live-eval-20260830T010203456Z-not-a-uuid.json",
      label: "invalid run ID",
    },
    {
      filename:
        `ai-live-eval-2026083T010203456Z-${secondRunId}.json`,
      label: "short compact date",
    },
  ])("fails closed for a modern archive with $label", async ({ filename }) => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      const report = {
        evaluatedAt: "2026-08-30T01:02:03.456Z",
        runId: firstRunId,
      };
      const paths = await persistLiveEvalReport(workspace, report);
      const reportText = await readFile(paths.latestPath, "utf8");
      await writeFile(
        resolve(workspace, "docs/evals/archive", filename),
        "{}\n",
        "utf8",
      );

      await expect(
        verifyLiveEvalArchiveMatchesLatest(workspace, report, reportText),
      ).rejects.toThrow(/archive filename is malformed/u);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails closed when a modern archive has invalid JSON", async () => {
    const workspace = await mkdtemp(resolve(tmpdir(), "diesel-live-report-"));
    try {
      const report = {
        evaluatedAt: "2026-08-30T01:02:03.456Z",
        runId: firstRunId,
      };
      const paths = await persistLiveEvalReport(workspace, report);
      const reportText = await readFile(paths.latestPath, "utf8");
      await writeFile(
        resolve(
          workspace,
          "docs/evals/archive",
          formatLiveEvalArchiveFilename(
            "2026-08-30T01:03:04.567Z",
            secondRunId,
          ),
        ),
        "not-json\n",
        "utf8",
      );

      await expect(
        verifyLiveEvalArchiveMatchesLatest(workspace, report, reportText),
      ).rejects.toThrow(/archive .*has invalid JSON/u);
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
