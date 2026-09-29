import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertTrustedGitExecutable,
  createTrustedGitEnvironment,
  portfolioCiTrustedGitExecutable,
  resolvePortfolioTrustedGitExecutable,
  runTrustedGit,
} from "../scripts/portfolio/trusted-git";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function git(workspace: string, args: readonly string[]): string {
  return runTrustedGit(workspace, args).toString("utf8").trim();
}

function commit(workspace: string, message: string): void {
  git(workspace, ["add", "--all"]);
  git(workspace, [
    "-c",
    "commit.gpgSign=false",
    "-c",
    "user.email=trusted-git@example.invalid",
    "-c",
    "user.name=Trusted Git Test",
    "commit",
    "-qm",
    message,
  ]);
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

describe("portfolio trusted Git", () => {
  it("requires the canonical absolute Git executable for GitHub release evidence", () => {
    expect(
      resolvePortfolioTrustedGitExecutable({
        configuredGitExecutable: "/usr/bin/git",
        githubActions: true,
        releaseEvidenceMode: true,
      }),
    ).toBe(portfolioCiTrustedGitExecutable);
  });

  it.each([undefined, "git", "/tmp/fake-git", "/usr/bin/git "])(
    "rejects GitHub release executable %j",
    (configuredGitExecutable) => {
      expect(() =>
        resolvePortfolioTrustedGitExecutable({
          configuredGitExecutable,
          githubActions: true,
          releaseEvidenceMode: true,
        })
      ).toThrow("GitHub release evidence requires PORTFOLIO_TRUSTED_GIT=/usr/bin/git");
    },
  );

  it("ignores an environment-style configured override locally", () => {
    expect(
      resolvePortfolioTrustedGitExecutable({
        configuredGitExecutable: "/tmp/fake-git",
        githubActions: false,
        releaseEvidenceMode: true,
      }),
    ).toBe(portfolioCiTrustedGitExecutable);
  });

  it("accepts only an explicit executable local override", () => {
    const directory = createTemporaryDirectory("diesel-trusted-git-local-");
    const executable = join(directory, "git-fixture");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(executable, 0o755);

    expect(
      resolvePortfolioTrustedGitExecutable({
        configuredGitExecutable: "/tmp/ignored-environment-git",
        githubActions: false,
        localGitExecutable: executable,
        releaseEvidenceMode: false,
      }),
    ).toBe(executable);
  });

  it("rejects a symlink executable", () => {
    const directory = createTemporaryDirectory("diesel-trusted-git-link-");
    const linkedExecutable = join(directory, "git");
    symlinkSync(portfolioCiTrustedGitExecutable, linkedExecutable);

    expect(() => assertTrustedGitExecutable(linkedExecutable)).toThrow(
      "regular non-symlink file",
    );
  });

  it("rejects relative, missing, directory, and non-executable candidates", () => {
    const directory = createTemporaryDirectory("diesel-trusted-git-invalid-");
    const nonExecutable = join(directory, "git-no-execute");
    writeFileSync(nonExecutable, "not executable\n", "utf8");
    chmodSync(nonExecutable, 0o644);

    expect(() => assertTrustedGitExecutable("git")).toThrow(
      "normalized absolute path",
    );
    expect(() =>
      assertTrustedGitExecutable(join(directory, "missing-git"))
    ).toThrow("missing or not executable");
    expect(() => assertTrustedGitExecutable(directory)).toThrow(
      "regular non-symlink file",
    );
    expect(() => assertTrustedGitExecutable(nonExecutable)).toThrow(
      "missing or not executable",
    );
  });

  it("scrubs inherited Git and dynamic-loader controls", () => {
    const environment = createTrustedGitEnvironment({
      DYLD_INSERT_LIBRARIES: "/tmp/injected.dylib",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "alias.rev-parse",
      GIT_CONFIG_VALUE_0: "!false",
      GIT_DIR: "/tmp/other.git",
      GIT_NO_REPLACE_OBJECTS: "0",
      GIT_WORK_TREE: "/tmp/other-worktree",
      LD_AUDIT: "/tmp/injected-audit.so",
      LD_LIBRARY_PATH: "/tmp/injected-libraries",
      LD_PRELOAD: "/tmp/injected.so",
      NODE_ENV: "test",
      PATH: "/tmp/fake-path",
    });

    expect(environment).toMatchObject({
      GIT_ATTR_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_LITERAL_PATHSPECS: "1",
      GIT_NO_LAZY_FETCH: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      NODE_ENV: "test",
      NO_COLOR: "1",
      PATH: "/usr/bin:/bin",
    });
    expect(environment).not.toHaveProperty("GIT_DIR");
    expect(environment).not.toHaveProperty("GIT_WORK_TREE");
    expect(environment).not.toHaveProperty("GIT_CONFIG_COUNT");
    expect(environment).not.toHaveProperty("GIT_CONFIG_KEY_0");
    expect(environment).not.toHaveProperty("GIT_CONFIG_VALUE_0");
    expect(environment).not.toHaveProperty("LD_AUDIT");
    expect(environment).not.toHaveProperty("LD_LIBRARY_PATH");
    expect(environment).not.toHaveProperty("LD_PRELOAD");
    expect(environment).not.toHaveProperty("DYLD_INSERT_LIBRARIES");
    expect(
      Object.keys(environment).filter((key) => key.startsWith("GIT_")).sort(),
    ).toEqual([
      "GIT_ATTR_NOSYSTEM",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_LITERAL_PATHSPECS",
      "GIT_NO_LAZY_FETCH",
      "GIT_NO_REPLACE_OBJECTS",
      "GIT_OPTIONAL_LOCKS",
      "GIT_TERMINAL_PROMPT",
    ]);
  });

  it("does not resolve Git through a forged PATH", () => {
    const directory = createTemporaryDirectory("diesel-trusted-git-path-");
    const fakeGit = join(directory, "git");
    writeFileSync(fakeGit, "#!/bin/sh\nexit 97\n", "utf8");
    chmodSync(fakeGit, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = directory;
    try {
      expect(
        runTrustedGit(process.cwd(), ["--version"]).toString("utf8"),
      ).toMatch(/^git version /u);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  it("ignores inherited GIT_DIR and GIT_WORK_TREE", () => {
    const expectedRepository = createTemporaryDirectory("diesel-trusted-git-repo-");
    const injectedRepository = createTemporaryDirectory("diesel-trusted-git-injected-");
    git(expectedRepository, ["init", "-q"]);
    git(injectedRepository, ["init", "-q"]);
    const originalGitDirectory = process.env.GIT_DIR;
    const originalGitWorkTree = process.env.GIT_WORK_TREE;
    process.env.GIT_DIR = join(injectedRepository, ".git");
    process.env.GIT_WORK_TREE = injectedRepository;
    try {
      expect(git(expectedRepository, ["rev-parse", "--show-toplevel"])).toBe(
        expectedRepository,
      );
    } finally {
      if (originalGitDirectory === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = originalGitDirectory;
      if (originalGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = originalGitWorkTree;
    }
  });

  it("ignores repository replacement refs", () => {
    const workspace = createTemporaryDirectory("diesel-trusted-git-replace-");
    git(workspace, ["init", "-q"]);
    writeFileSync(join(workspace, "evidence.txt"), "original\n", "utf8");
    commit(workspace, "original evidence");
    const originalCommit = git(workspace, ["rev-parse", "HEAD"]);

    writeFileSync(join(workspace, "evidence.txt"), "replacement\n", "utf8");
    commit(workspace, "replacement evidence");
    const replacementCommit = git(workspace, ["rev-parse", "HEAD"]);
    git(workspace, ["switch", "-q", "--detach", originalCommit]);
    git(workspace, ["replace", originalCommit, replacementCommit]);

    expect(
      git(workspace, ["show-ref", "--verify", `refs/replace/${originalCommit}`]),
    ).toContain(replacementCommit);
    expect(
      git(workspace, ["show", "-s", "--format=%s", originalCommit]),
    ).toBe("original evidence");
  });
});
