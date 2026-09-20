import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { formatLiveEvalArchiveFilename } from "../scripts/ai/live-eval-report";
import {
  parseReleaseEvidenceModeArguments,
  portfolioReleaseEvidenceEntrypoints,
  portfolioReleaseEvidenceExplicitPaths,
  resolveReleaseEvidenceExpectedHead,
  verifyReleaseEvidenceReadiness,
  type ReleaseEvidenceReadinessInput,
} from "../scripts/portfolio/release-evidence-readiness";

const STATUS_PATH = "docs/STATUS.md";
const {
  liveEvalLatestPath: LATEST_PATH,
  playwrightEvidencePath: PLAYWRIGHT_PATH,
  screenshotManifestPath: SCREENSHOT_MANIFEST_PATH,
} = portfolioReleaseEvidenceEntrypoints;
type LiveEvalIdentity = {
  evaluatedAt: string;
  runId: string;
};
const INITIAL_IDENTITY = {
  evaluatedAt: "2026-09-03T01:02:03.004Z",
  runId: "123e4567-e89b-42d3-a456-426614174000",
} as const satisfies LiveEvalIdentity;
const SECOND_IDENTITY = {
  evaluatedAt: "2026-09-03T02:03:04.005Z",
  runId: "223e4567-e89b-42d3-a456-426614174001",
} as const satisfies LiveEvalIdentity;
const THIRD_IDENTITY = {
  evaluatedAt: "2026-09-03T03:04:05.006Z",
  runId: "323e4567-e89b-42d3-a456-426614174002",
} as const satisfies LiveEvalIdentity;
const gitObjectFormats = ["sha1", "sha256"] as const;
type GitObjectFormat = (typeof gitObjectFormats)[number];

const temporaryRepositories: string[] = [];

function repositoryEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_EMAIL: "evidence@example.invalid",
    GIT_AUTHOR_NAME: "Evidence Test",
    GIT_COMMITTER_EMAIL: "evidence@example.invalid",
    GIT_COMMITTER_NAME: "Evidence Test",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const key of [
    "GIT_COMMON_DIR",
    "GIT_CONFIG_COUNT",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_WORK_TREE",
  ]) {
    delete environment[key];
  }
  return environment;
}

function git(workspace: string, args: readonly string[]): string {
  const result = spawnSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    env: repositoryEnvironment(),
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Fixture git ${args.join(" ")} failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

function writeRepositoryFile(
  workspace: string,
  path: string,
  contents: string | Buffer,
): void {
  const absolutePath = resolve(workspace, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function liveEvalText(
  identity: LiveEvalIdentity = INITIAL_IDENTITY,
): string {
  return `${JSON.stringify({
    complete: false,
    evaluatedAt: identity.evaluatedAt,
    runId: identity.runId,
    thresholdsPassed: false,
    version: "sales-chat-live-v11",
  }, null, 2)}\n`;
}

function archivePath(
  identity: LiveEvalIdentity = INITIAL_IDENTITY,
): string {
  return `docs/evals/archive/${formatLiveEvalArchiveFilename(
    identity.evaluatedAt,
    identity.runId,
  )}`;
}

function screenshotManifestText(): string {
  const viewport = { height: 1000, width: 1600 };
  return `${JSON.stringify({
    assets: [
      {
        capturedAt: "2026-09-03T01:00:00.000Z",
        height: 1000,
        locale: "en",
        path: "public/portfolio/live-dashboard.jpg",
        route: "/",
        sha256: "1".repeat(64),
        sourceFiles: ["src/app/page.tsx"],
        sourceFingerprint: "2".repeat(64),
        viewport,
        width: 1600,
      },
      {
        capturedAt: "2026-09-03T01:00:01.000Z",
        height: 1000,
        locale: "en",
        path: "public/portfolio/offline-evidence-chat.jpg",
        route:
          "/chat?countryIso3=CHN&applicationScope=non-road&powerKw=100&asOf=2026-08-12&productModelCode=DEMO-ENG-200",
        sha256: "3".repeat(64),
        sourceFiles: ["src/app/chat/page.tsx"],
        sourceFingerprint: "4".repeat(64),
        viewport,
        width: 1600,
      },
    ],
    version: 2,
  }, null, 2)}\n`;
}

function commitAll(workspace: string, message = "fixture"): void {
  git(workspace, ["add", "--", "."]);
  git(workspace, [
    "-c",
    "commit.gpgSign=false",
    "commit",
    "-qm",
    message,
  ]);
}

function createRepository(objectFormat: GitObjectFormat = "sha1"): string {
  const workspace = mkdtempSync(
    join(tmpdir(), "diesel-release-evidence-readiness-"),
  );
  temporaryRepositories.push(workspace);
  git(workspace, ["init", "-q", `--object-format=${objectFormat}`]);

  const reportText = liveEvalText();
  for (const path of portfolioReleaseEvidenceExplicitPaths) {
    writeRepositoryFile(workspace, path, `# ${path}\n`);
  }
  writeRepositoryFile(
    workspace,
    "vitest.config.ts",
    'export default { test: { include: ["tests/**/*.test.ts"], setupFiles: ["./tests/setup.ts"] } };\n',
  );
  writeRepositoryFile(
    workspace,
    "tests/setup.ts",
    'import "../src/test-runtime";\n',
  );
  writeRepositoryFile(
    workspace,
    "tests/example.test.ts",
    'import "../scripts/test-helper";\n',
  );
  writeRepositoryFile(workspace, "src/test-runtime.ts", "export {};\n");
  writeRepositoryFile(workspace, "scripts/test-helper.ts", "export {};\n");
  writeRepositoryFile(workspace, "src/app/page.tsx", "export default null;\n");
  writeRepositoryFile(
    workspace,
    "src/app/chat/page.tsx",
    "export default null;\n",
  );
  writeRepositoryFile(workspace, LATEST_PATH, reportText);
  writeRepositoryFile(workspace, archivePath(), reportText);
  writeRepositoryFile(
    workspace,
    SCREENSHOT_MANIFEST_PATH,
    screenshotManifestText(),
  );
  writeRepositoryFile(
    workspace,
    "public/portfolio/live-dashboard.jpg",
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  );
  writeRepositoryFile(
    workspace,
    "public/portfolio/offline-evidence-chat.jpg",
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  );
  writeRepositoryFile(
    workspace,
    PLAYWRIGHT_PATH,
    "{\n  \"version\": \"diesel-playwright-evidence-v1\"\n}\n",
  );
  commitAll(workspace);
  return workspace;
}

function readinessInput(workspace: string): ReleaseEvidenceReadinessInput {
  return {
    explicitPaths: portfolioReleaseEvidenceExplicitPaths,
    liveEvalLatestPath: LATEST_PATH,
    playwrightEvidencePath: PLAYWRIGHT_PATH,
    screenshotManifestPath: SCREENSHOT_MANIFEST_PATH,
    workspace,
  };
}

function appendLiveEvalArchive(
  workspace: string,
  identity: LiveEvalIdentity = SECOND_IDENTITY,
): void {
  const reportText = liveEvalText(identity);
  writeRepositoryFile(workspace, LATEST_PATH, reportText);
  writeRepositoryFile(workspace, archivePath(identity), reportText);
  commitAll(workspace, `append ${identity.runId}`);
}

function createShallowClone(source: string): string {
  const workspace = mkdtempSync(
    join(tmpdir(), "diesel-release-evidence-shallow-"),
  );
  temporaryRepositories.push(workspace);
  git(source, ["clone", "-q", "--depth", "1", `file://${source}`, workspace]);
  return workspace;
}

afterEach(() => {
  while (temporaryRepositories.length > 0) {
    const workspace = temporaryRepositories.pop();
    if (workspace !== undefined) rmSync(workspace, { force: true, recursive: true });
  }
});

describe("release evidence readiness", () => {
  it.each([
    { arguments: [], expected: false },
    { arguments: ["--release-evidence"], expected: true },
    { arguments: ["--", "--release-evidence"], expected: true },
  ])("parses the optional release mode from $arguments", ({
    arguments: cliArguments,
    expected,
  }) => {
    expect(parseReleaseEvidenceModeArguments(cliArguments)).toBe(expected);
  });

  it.each([
    ["unknown option", ["--unknown"]],
    ["duplicate option", ["--release-evidence", "--release-evidence"]],
    ["bare separator", ["--"]],
  ])("rejects %s", (_label, cliArguments) => {
    expect(() => parseReleaseEvidenceModeArguments(cliArguments)).toThrow(
      "accepts only the optional --release-evidence flag",
    );
  });

  it.each([
    {
      expected: "a".repeat(40),
      input: {
        configuredSha: "a".repeat(40),
        githubActions: true,
        githubSha: "a".repeat(40),
        releaseEvidenceMode: true,
      },
      label: "matching SHA-1 GitHub release binding",
    },
    {
      expected: "b".repeat(64),
      input: {
        configuredSha: "b".repeat(64),
        githubActions: true,
        githubSha: "b".repeat(64),
        releaseEvidenceMode: true,
      },
      label: "matching SHA-256 GitHub release binding",
    },
    {
      expected: undefined,
      input: {
        configuredSha: "invalid",
        githubActions: false,
        githubSha: "invalid",
        releaseEvidenceMode: true,
      },
      label: "local release verification",
    },
    {
      expected: undefined,
      input: {
        configuredSha: "invalid",
        githubActions: true,
        githubSha: "invalid",
        releaseEvidenceMode: false,
      },
      label: "non-release GitHub verification",
    },
  ])("resolves $label", ({ expected, input }) => {
    expect(resolveReleaseEvidenceExpectedHead(input)).toBe(expected);
  });

  it.each([
    {
      input: {
        configuredSha: "a".repeat(40),
        githubActions: true,
        releaseEvidenceMode: true,
      },
      label: "missing GITHUB_SHA",
    },
    {
      input: {
        configuredSha: "a".repeat(40),
        githubActions: true,
        githubSha: "HEAD",
        releaseEvidenceMode: true,
      },
      label: "non-object GITHUB_SHA",
    },
    {
      input: {
        githubActions: true,
        githubSha: "a".repeat(40),
        releaseEvidenceMode: true,
      },
      label: "missing configured SHA",
    },
    {
      input: {
        configuredSha: "A".repeat(40),
        githubActions: true,
        githubSha: "a".repeat(40),
        releaseEvidenceMode: true,
      },
      label: "non-canonical configured SHA",
    },
    {
      input: {
        configuredSha: "0".repeat(40),
        githubActions: true,
        githubSha: "0".repeat(40),
        releaseEvidenceMode: true,
      },
      label: "null object IDs",
    },
    {
      input: {
        configuredSha: "b".repeat(40),
        githubActions: true,
        githubSha: "a".repeat(40),
        releaseEvidenceMode: true,
      },
      label: "mismatched GitHub and configured SHAs",
    },
  ])("rejects $label for GitHub release evidence", ({ input }) => {
    expect(() => resolveReleaseEvidenceExpectedHead(input)).toThrow(
      /GitHub release evidence/u,
    );
  });

  it("exports the complete canonical static release-evidence inventory", () => {
    expect(portfolioReleaseEvidenceExplicitPaths).toEqual([
      ".nvmrc",
      "README.md",
      "README.zh-CN.md",
      "docs/ARCHITECTURE.md",
      "docs/DEMO.md",
      "docs/DEVELOPMENT_HISTORY.md",
      "docs/evidence/fde-development-history-human-review-2026-09-12.md",
      "docs/evals/README.md",
      "docs/FDE_CASE_STUDY.md",
      "docs/STATUS.md",
      "scripts/history/fde-development-history-audit.json",
      "docs/evidence/fde-development-history-secret-scan-2026-09-05.manifest.json",
      "docs/evidence/fde-development-history-secret-scan-2026-09-05.history-log.json",
      "docs/evidence/fde-development-history-secret-scan-2026-09-05.history-report.json",
      "docs/evidence/fde-development-history-secret-scan-2026-09-05.canary-log.json",
      "docs/evidence/fde-development-history-secret-scan-2026-09-05.canary-report.json",
      "docs/evidence/fde-development-history-dependency-licenses-2026-09-05.manifest.json",
      "docs/evidence/fde-development-history-dependency-licenses-2026-09-05.raw.json.gz",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "vitest.config.ts",
    ]);
  });

  it("rejects unrelated tracked or untracked worktree drift", () => {
    const workspace = createRepository();
    writeRepositoryFile(workspace, "src/untracked.ts", "export {};\n");

    expect(() => verifyReleaseEvidenceReadiness(readinessInput(workspace)))
      .toThrow(/clean index and working tree/u);
  });

  it.each([
    "docs/evidence/fde-development-history-dependency-licenses-2026-09-05.manifest.json",
    "docs/evidence/fde-development-history-dependency-licenses-2026-09-05.raw.json.gz",
    "docs/evidence/fde-development-history-human-review-2026-09-12.md",
  ])("binds retained history evidence to release HEAD: %s", (path) => {
    const workspace = createRepository();
    writeRepositoryFile(workspace, path, "changed evidence\n");
    git(workspace, ["add", "--", path]);
    expect(() => verifyReleaseEvidenceReadiness(readinessInput(workspace)))
      .toThrow(`Git index bytes differ from HEAD for evidence path: ${path}`);
  });

  it("rejects retained scanner output staged outside the release commit", () => {
    const workspace = createRepository();
    const path = "docs/evidence/fde-development-history-secret-scan-2026-09-05.history-log.json";
    writeRepositoryFile(workspace, path, "{}\n");
    git(workspace, ["add", "--", path]);
    expect(() => verifyReleaseEvidenceReadiness(readinessInput(workspace)))
      .toThrow(`Git index bytes differ from HEAD for evidence path: ${path}`);
  });

  it.each(gitObjectFormats)(
    "accepts a clean %s commit, binds its expected SHA, and expands every dependency",
    (objectFormat) => {
      const workspace = createRepository(objectFormat);
      const headCommit = git(workspace, ["rev-parse", "HEAD"]);
      const readiness = verifyReleaseEvidenceReadiness({
        ...readinessInput(workspace),
        expectedHeadCommit: headCommit,
      });

      expect(headCommit).toHaveLength(objectFormat === "sha1" ? 40 : 64);
      expect(readiness.headCommit).toBe(headCommit);
      expect(readiness.dynamicPaths).toEqual({
        liveEvalArchivePath: archivePath(),
        screenshotAssetPaths: [
          "public/portfolio/live-dashboard.jpg",
          "public/portfolio/offline-evidence-chat.jpg",
        ],
        screenshotSourcePaths: [
          "src/app/chat/page.tsx",
          "src/app/page.tsx",
        ],
        vitestExecutionInputPaths: [],
      });
      expect(readiness.paths.map(({ path }) => path)).toEqual(
        [...new Set([
          ...portfolioReleaseEvidenceExplicitPaths,
          LATEST_PATH,
          archivePath(),
          PLAYWRIGHT_PATH,
          "public/portfolio/live-dashboard.jpg",
          "public/portfolio/offline-evidence-chat.jpg",
          SCREENSHOT_MANIFEST_PATH,
          "src/app/chat/page.tsx",
          "src/app/page.tsx",
        ])].sort(),
      );
      expect(readiness.paths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            byteLength: Buffer.byteLength(liveEvalText(), "utf8"),
            path: LATEST_PATH,
            sha256: createHash("sha256")
              .update(liveEvalText(), "utf8")
              .digest("hex"),
          }),
        ]),
      );
    },
  );

  it.each([
    ["assume-unchanged", "--assume-unchanged", /assume-unchanged/u],
    ["skip-worktree", "--skip-worktree", /skip-worktree/u],
  ] as const)("rejects the index %s visibility flag", (_label, flag, expected) => {
    const workspace = createRepository();
    git(workspace, ["update-index", flag, STATUS_PATH]);

    expect(() => verifyReleaseEvidenceReadiness(readinessInput(workspace)))
      .toThrow(expected);
  });

  it("rejects a legacy graft in the repository Git/common directory", () => {
    const workspace = createRepository();
    writeRepositoryFile(
      workspace,
      ".git/info/grafts",
      `${git(workspace, ["rev-parse", "HEAD"])}\n`,
    );

    expect(() => verifyReleaseEvidenceReadiness(readinessInput(workspace)))
      .toThrow(/rejects legacy Git grafts/u);
  });

  it("resolves a linked worktree common directory and rejects its legacy graft", () => {
    const repository = createRepository();
    const worktreeRoot = mkdtempSync(
      join(tmpdir(), "diesel-release-evidence-linked-worktree-"),
    );
    temporaryRepositories.push(worktreeRoot);
    const workspace = resolve(worktreeRoot, "checkout");
    git(repository, [
      "worktree",
      "add",
      "-q",
      "-b",
      "release-evidence-linked-test",
      workspace,
    ]);
    const commonDirectory = git(workspace, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    writeRepositoryFile(
      commonDirectory,
      "info/grafts",
      `${git(workspace, ["rev-parse", "HEAD"])}\n`,
    );

    expect(() => verifyReleaseEvidenceReadiness(readinessInput(workspace)))
      .toThrow(/rejects legacy Git grafts/u);
  });

  it("binds manifest-declared screenshot source files to HEAD", () => {
    const workspace = createRepository();
    const sourcePath = "src/app/chat/page.tsx";
    writeRepositoryFile(workspace, sourcePath, "export default 'local drift';\n");

    expect(() => verifyReleaseEvidenceReadiness(readinessInput(workspace)))
      .toThrow(`Working-tree bytes differ from HEAD for evidence path: ${sourcePath}`);
  });

  it("conservatively binds the full tracked repository tree as Vitest execution input", () => {
    const workspace = createRepository();
    const readiness = verifyReleaseEvidenceReadiness({
      ...readinessInput(workspace),
      bindVitestExecutionInputs: true,
    });

    expect(readiness.dynamicPaths.vitestExecutionInputPaths).toEqual(
      expect.arrayContaining([
        "scripts/test-helper.ts",
        "src/test-runtime.ts",
        "tests/example.test.ts",
        "tests/setup.ts",
        "vitest.config.ts",
      ]),
    );
    expect(readiness.paths.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        "scripts/test-helper.ts",
        "src/test-runtime.ts",
        "tests/example.test.ts",
        "tests/setup.ts",
      ]),
    );
  });

  it("rejects drift in a non-test helper included by Vitest execution binding", () => {
    const workspace = createRepository();
    writeRepositoryFile(workspace, "tests/setup.ts", "// hidden setup drift\n");

    expect(() => verifyReleaseEvidenceReadiness({
      ...readinessInput(workspace),
      bindVitestExecutionInputs: true,
    })).toThrow(
      "Working-tree bytes differ from HEAD for evidence path: tests/setup.ts",
    );
  });

  it.each(gitObjectFormats)(
    "rejects a %s HEAD that differs from the configured event commit",
    (objectFormat) => {
      const workspace = createRepository(objectFormat);
      const expectedHeadCommit = git(workspace, ["rev-parse", "HEAD"]);
      writeRepositoryFile(workspace, "docs/new-release-note.md", "new commit\n");
      commitAll(workspace, "advance HEAD");

      expect(() =>
        verifyReleaseEvidenceReadiness({
          ...readinessInput(workspace),
          expectedHeadCommit,
        })
      ).toThrow(/does not match expected commit/u);
    },
  );

  it.each([
    "HEAD",
    "a".repeat(39),
    "A".repeat(40),
    "0".repeat(40),
    `${"a".repeat(40)}\n`,
  ])("rejects non-canonical expected HEAD %j", (expectedHeadCommit) => {
    const workspace = createRepository();
    expect(() =>
      verifyReleaseEvidenceReadiness({
        explicitPaths: [STATUS_PATH],
        expectedHeadCommit,
        workspace,
      })
    ).toThrow("must be a full lowercase SHA-1 or SHA-256 object ID");
  });

  it.each([
    "docs/DEVELOPMENT_HISTORY.md",
    "docs/evals/README.md",
    "docs/evidence/fde-development-history-human-review-2026-09-12.md",
  ])("rejects working-tree drift in canonical release document %s", (path) => {
    const workspace = createRepository();
    writeRepositoryFile(workspace, path, "# Local-only release prose\n");

    expect(() =>
      verifyReleaseEvidenceReadiness(readinessInput(workspace))
    ).toThrow(`Working-tree bytes differ from HEAD for evidence path: ${path}`);
  });

  it.each([
    {
      expected: /latest is staged without its selected archive/u,
      label: "latest staged while its selected archive is omitted",
      mutate(workspace: string) {
        writeRepositoryFile(workspace, LATEST_PATH, liveEvalText(SECOND_IDENTITY));
        git(workspace, ["add", "--", LATEST_PATH]);
      },
    },
    {
      expected: /archive is staged without its latest report/u,
      label: "archive staged while the matching latest update is omitted",
      mutate(workspace: string) {
        writeRepositoryFile(
          workspace,
          archivePath(SECOND_IDENTITY),
          liveEvalText(SECOND_IDENTITY),
        );
        git(workspace, ["add", "--", archivePath(SECOND_IDENTITY)]);
      },
    },
  ])("rejects $label", ({ expected, mutate }) => {
    const workspace = createRepository();
    mutate(workspace);

    expect(() =>
      verifyReleaseEvidenceReadiness(readinessInput(workspace))
    ).toThrow(expected);
  });

  it.each(gitObjectFormats)(
    "accepts an append-only live eval archive in a clean %s history",
    (objectFormat) => {
      const workspace = createRepository(objectFormat);
      appendLiveEvalArchive(workspace);
      const headCommit = git(workspace, ["rev-parse", "HEAD"]);

      const readiness = verifyReleaseEvidenceReadiness({
        ...readinessInput(workspace),
        expectedHeadCommit: headCommit,
      });

      expect(readiness.dynamicPaths.liveEvalArchivePath).toBe(
        archivePath(SECOND_IDENTITY),
      );
      expect(readiness.paths.map(({ path }) => path).filter((path) =>
        path.startsWith("docs/evals/archive/")
      )).toEqual([
        archivePath(),
        archivePath(SECOND_IDENTITY),
      ]);
    },
  );

  it.each([
    {
      expected: /removed or renamed/u,
      label: "committed deletion",
      mutate(workspace: string) {
        git(workspace, ["rm", "-q", "--", archivePath()]);
        commitAll(workspace, "delete published archive");
      },
    },
    {
      expected: /bytes or mode changed|conflicting bytes/u,
      label: "committed byte modification",
      mutate(workspace: string) {
        writeRepositoryFile(workspace, archivePath(), "tampered archive\n");
        commitAll(workspace, "modify published archive");
      },
    },
    {
      expected: /removed or renamed/u,
      label: "delete and re-add with identical bytes",
      mutate(workspace: string) {
        git(workspace, ["rm", "-q", "--", archivePath()]);
        commitAll(workspace, "delete published archive before re-add");
        writeRepositoryFile(workspace, archivePath(), liveEvalText());
        commitAll(workspace, "re-add published archive");
      },
    },
    {
      expected: /removed or renamed/u,
      label: "committed rename",
      mutate(workspace: string) {
        git(workspace, [
          "mv",
          "--",
          archivePath(),
          archivePath(THIRD_IDENTITY),
        ]);
        commitAll(workspace, "rename published archive");
      },
    },
  ])("rejects historical archive $label", ({ expected, mutate }) => {
    const workspace = createRepository();
    appendLiveEvalArchive(workspace);
    mutate(workspace);

    expect(() =>
      verifyReleaseEvidenceReadiness(readinessInput(workspace))
    ).toThrow(expected);
  });

  it("accepts the union of append-only archives from both merge parents", () => {
    const workspace = createRepository();
    const releaseBranch = git(workspace, ["branch", "--show-current"]);
    git(workspace, ["switch", "-q", "-c", "archive-feature"]);
    writeRepositoryFile(
      workspace,
      archivePath(SECOND_IDENTITY),
      liveEvalText(SECOND_IDENTITY),
    );
    commitAll(workspace, "append feature archive");

    git(workspace, ["switch", "-q", releaseBranch]);
    writeRepositoryFile(
      workspace,
      archivePath(THIRD_IDENTITY),
      liveEvalText(THIRD_IDENTITY),
    );
    commitAll(workspace, "append release archive");
    git(workspace, [
      "-c",
      "commit.gpgSign=false",
      "merge",
      "-q",
      "--no-ff",
      "-m",
      "merge archive histories",
      "archive-feature",
    ]);

    const readiness = verifyReleaseEvidenceReadiness(readinessInput(workspace));

    expect(readiness.paths.map(({ path }) => path).filter((path) =>
      path.startsWith("docs/evals/archive/")
    )).toEqual([
      archivePath(),
      archivePath(SECOND_IDENTITY),
      archivePath(THIRD_IDENTITY),
    ]);
  });

  it("ignores well-formed archives reachable only from an unrelated orphan ref", () => {
    const workspace = createRepository();
    const releaseBranch = git(workspace, ["branch", "--show-current"]);
    git(workspace, ["switch", "-q", "--orphan", "unrelated-history"]);
    writeRepositoryFile(
      workspace,
      archivePath(THIRD_IDENTITY),
      liveEvalText(THIRD_IDENTITY),
    );
    commitAll(workspace, "unrelated archive history");
    git(workspace, ["switch", "-q", releaseBranch]);

    const readiness = verifyReleaseEvidenceReadiness(readinessInput(workspace));

    expect(readiness.paths.map(({ path }) => path)).not.toContain(
      archivePath(THIRD_IDENTITY),
    );
  });

  it("fails closed in a shallow repository", () => {
    const source = createRepository();
    appendLiveEvalArchive(source);
    const workspace = createShallowClone(source);

    expect(() =>
      verifyReleaseEvidenceReadiness(readinessInput(workspace))
    ).toThrow("requires a complete, non-shallow Git history");
  });

  it("fails closed when an ancestor is absent without a shallow marker", () => {
    const source = createRepository();
    appendLiveEvalArchive(source);
    const workspace = createShallowClone(source);
    rmSync(resolve(workspace, ".git/shallow"));

    expect(() =>
      verifyReleaseEvidenceReadiness(readinessInput(workspace))
    ).toThrow(/git rev-list .* failed|missing parent commit/u);
  });

  it.each([
    {
      expected: /file not published by HEAD/u,
      label: "untracked well-formed archive",
      path: archivePath(THIRD_IDENTITY),
      write(workspace: string, path: string) {
        writeRepositoryFile(workspace, path, liveEvalText(THIRD_IDENTITY));
      },
    },
    {
      expected: /untracked, temporary, or malformed entry/u,
      label: "temporary archive file",
      path: "docs/evals/archive/.live-eval-write.tmp",
      write(workspace: string, path: string) {
        writeRepositoryFile(workspace, path, "temporary\n");
      },
    },
    {
      expected: /non-regular entry/u,
      label: "archive symlink",
      path: archivePath(THIRD_IDENTITY),
      write(workspace: string, path: string) {
        symlinkSync(resolve(workspace, archivePath()), resolve(workspace, path));
      },
    },
  ])("rejects a current worktree $label", ({ expected, path, write }) => {
    const workspace = createRepository();
    write(workspace, path);

    expect(() =>
      verifyReleaseEvidenceReadiness(readinessInput(workspace))
    ).toThrow(expected);
  });

  it.each([
    { staged: false, expected: /Working-tree bytes differ from HEAD/u },
    { staged: true, expected: /Git index differs from HEAD/u },
  ])("verifies every historical archive at index/worktree (staged=$staged)", ({
    expected,
    staged,
  }) => {
    const workspace = createRepository();
    appendLiveEvalArchive(workspace);
    if (staged) {
      const stagedReport = liveEvalText(SECOND_IDENTITY).replace(
        '"complete": false',
        '"complete": true',
      );
      writeRepositoryFile(workspace, LATEST_PATH, stagedReport);
      writeRepositoryFile(
        workspace,
        archivePath(SECOND_IDENTITY),
        stagedReport,
      );
      git(workspace, [
        "add",
        "--",
        LATEST_PATH,
        archivePath(SECOND_IDENTITY),
      ]);
    } else {
      writeRepositoryFile(workspace, archivePath(), "local drift\n");
    }

    expect(() =>
      verifyReleaseEvidenceReadiness(readinessInput(workspace))
    ).toThrow(expected);
  });

  it("rejects a completely untracked explicit evidence file", () => {
    const workspace = createRepository();
    const untrackedPath = "docs/evidence/local-only.json";
    writeRepositoryFile(workspace, untrackedPath, "{}\n");

    expect(() =>
      verifyReleaseEvidenceReadiness({
        ...readinessInput(workspace),
        explicitPaths: [STATUS_PATH, untrackedPath],
      })
    ).toThrow(`HEAD does not contain evidence path: ${untrackedPath}`);
  });

  it.each([
    {
      expected: /Working-tree bytes differ from HEAD/u,
      label: "working-tree drift from HEAD",
      mutate(workspace: string) {
        writeRepositoryFile(workspace, STATUS_PATH, "# Local-only status\n");
      },
    },
    {
      expected: /Git index bytes differ from HEAD/u,
      label: "index drift from HEAD",
      mutate(workspace: string) {
        writeRepositoryFile(workspace, STATUS_PATH, "# Staged status\n");
        git(workspace, ["add", "--", STATUS_PATH]);
      },
    },
  ])("rejects $label", ({ expected, mutate }) => {
    const workspace = createRepository();
    mutate(workspace);

    expect(() =>
      verifyReleaseEvidenceReadiness(readinessInput(workspace))
    ).toThrow(expected);
  });

  it("rejects a manifest-listed image that is absent from the index", () => {
    const workspace = createRepository();
    const imagePath = "public/portfolio/offline-evidence-chat.jpg";
    git(workspace, ["rm", "--cached", "--", imagePath]);

    expect(() =>
      verifyReleaseEvidenceReadiness(readinessInput(workspace))
    ).toThrow(`Git index does not contain evidence path: ${imagePath}`);
  });

  it("rejects clean committed latest and archive files whose bytes differ", () => {
    const workspace = createRepository();
    writeRepositoryFile(
      workspace,
      archivePath(),
      liveEvalText().replace('"complete": false', '"complete": true'),
    );
    commitAll(workspace, "drift archive");

    expect(() =>
      verifyReleaseEvidenceReadiness(readinessInput(workspace))
    ).toThrow(/archive bytes or mode changed|conflicting bytes/u);
  });

  it("passes literal command metacharacters to Git without invoking a shell", () => {
    const workspace = createRepository();
    const literalPath = "docs/evidence/$(touch should-not-exist).json";
    writeRepositoryFile(workspace, literalPath, "{}\n");
    commitAll(workspace, "literal metacharacters");

    expect(() =>
      verifyReleaseEvidenceReadiness({
        explicitPaths: [literalPath],
        workspace,
      })
    ).not.toThrow();
    expect(existsSync(resolve(workspace, "should-not-exist"))).toBe(false);
  });

  it("uses the trusted absolute Git when PATH and Git environment are hostile", () => {
    const workspace = createRepository();
    const fakeBin = mkdtempSync(join(tmpdir(), "diesel-fake-git-"));
    temporaryRepositories.push(fakeBin);
    writeFileSync(resolve(fakeBin, "git"), "#!/bin/sh\nexit 97\n", "utf8");
    chmodSync(resolve(fakeBin, "git"), 0o755);
    const inherited = {
      gitDirectory: process.env.GIT_DIR,
      gitWorkTree: process.env.GIT_WORK_TREE,
      ldPreload: process.env.LD_PRELOAD,
      path: process.env.PATH,
    };
    process.env.GIT_DIR = resolve(workspace, "missing-injected-git-dir");
    process.env.GIT_WORK_TREE = resolve(workspace, "missing-injected-worktree");
    process.env.LD_PRELOAD = resolve(workspace, "missing-injected-library.so");
    process.env.PATH = fakeBin;
    try {
      expect(() =>
        verifyReleaseEvidenceReadiness({
          explicitPaths: [STATUS_PATH],
          workspace,
        })
      ).not.toThrow();
    } finally {
      if (inherited.gitDirectory === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = inherited.gitDirectory;
      if (inherited.gitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = inherited.gitWorkTree;
      if (inherited.ldPreload === undefined) delete process.env.LD_PRELOAD;
      else process.env.LD_PRELOAD = inherited.ldPreload;
      if (inherited.path === undefined) delete process.env.PATH;
      else process.env.PATH = inherited.path;
    }
  });

  it("ignores a replacement commit for the captured HEAD", () => {
    const workspace = createRepository();
    const originalCommit = git(workspace, ["rev-parse", "HEAD"]);
    writeRepositoryFile(workspace, STATUS_PATH, "# Replacement status\n");
    commitAll(workspace, "replacement commit");
    const replacementCommit = git(workspace, ["rev-parse", "HEAD"]);
    git(workspace, ["switch", "-q", "--detach", originalCommit]);
    git(workspace, ["replace", originalCommit, replacementCommit]);

    expect(() =>
      verifyReleaseEvidenceReadiness({
        explicitPaths: [STATUS_PATH],
        expectedHeadCommit: originalCommit,
        workspace,
      })
    ).not.toThrow();
  });

  it("rejects an evidence path that traverses an in-repository symlink", () => {
    const workspace = createRepository();
    const originalDirectory = resolve(workspace, "docs");
    const relocatedDirectory = resolve(workspace, "relocated-docs");
    renameSync(originalDirectory, relocatedDirectory);
    symlinkSync(relocatedDirectory, originalDirectory);

    expect(() =>
      verifyReleaseEvidenceReadiness({
        explicitPaths: [STATUS_PATH],
        workspace,
      })
    ).toThrow(`Evidence path traverses a symbolic link: ${STATUS_PATH}`);
  });

  it.each(["../outside.json", "/absolute.json", ".git/config", "-option"])(
    "rejects unsafe repository-relative path %s",
    (path) => {
      const workspace = createRepository();
      expect(() =>
        verifyReleaseEvidenceReadiness({ explicitPaths: [path], workspace })
      ).toThrow("Unsafe repository-relative evidence path");
    },
  );

  it("requires at least one explicit or bound evidence path", () => {
    const workspace = createRepository();
    expect(() => verifyReleaseEvidenceReadiness({ workspace })).toThrow(
      "requires at least one path",
    );
  });
});
