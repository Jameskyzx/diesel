import { execFile, spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createReleaseCommandEnvironment,
  type ReleaseCommandResult,
  type ReleaseCommandRunner,
  parseReleaseAuthorizationOutput,
  verifyReleaseAuthorizationWithRunner,
} from "../scripts/deploy/verify-release-authorization";

const execFileAsync = promisify(execFile);
const RELEASE_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const SCRIPT_BLOB = "c".repeat(40);
const ROOT = realpathSync(process.cwd());
const REPOSITORY = "Jameskyzx/diesel";
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`;
const WEB_ROOT = `https://github.com/${REPOSITORY}`;
const WORKFLOW_ID = 332_591_937;
const RUN_ID = 318_700_000;
const GATE_JOB_ID = 900_000_008;
const MAX_AUTHORIZATION_OUTPUT_BYTES = 65_536;

const bundleMetafileSchema = z
  .object({
    inputs: z.record(z.string(), z.unknown()),
    outputs: z.record(
      z.string(),
      z
        .object({
          imports: z.array(
            z
              .object({
                external: z.literal(true),
                kind: z.literal("import-statement"),
                path: z.enum([
                  "node:child_process",
                  "node:fs",
                  "node:path",
                  "node:url",
                ]),
              })
              .strict(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

type JsonRecord = Record<string, unknown>;

type RunnerState = {
  branchRef: string;
  calls: string[];
  commandScopes: Array<{
    args: string[];
    command: "gh" | "git";
    scope: "isolated" | "repository";
  }>;
  committedScriptBlob: string;
  dirtyStatus: string;
  fetchUrls: string;
  finalBranchRef?: string;
  finalDirtyStatus?: string;
  finalGithubRef?: JsonRecord;
  finalHead?: string;
  finalLsRemote?: string;
  finalFetchUrls?: string;
  finalProtection?: JsonRecord;
  finalPushUrls?: string;
  finalRemoteTracking?: string;
  finalRuns?: JsonRecord;
  finalWorkflow?: JsonRecord;
  finalWorktreeScriptBlob?: string;
  githubRef: JsonRecord;
  head: string;
  jobs: JsonRecord;
  lsRemote: string;
  protection: JsonRecord;
  pushUrls: string;
  remoteTracking: string;
  runs: JsonRecord;
  throwOn?: string;
  workflow: JsonRecord;
  worktreeScriptBlob: string;
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

function githubRef(sha = RELEASE_SHA): JsonRecord {
  return {
    object: {
      sha,
      type: "commit",
      url: `${API_ROOT}/git/commits/${sha}`,
    },
    ref: "refs/heads/master",
    url: `${API_ROOT}/git/refs/heads/master`,
  };
}

function workflow(): JsonRecord {
  return {
    html_url: `${WEB_ROOT}/blob/master/.github/workflows/ci.yml`,
    id: WORKFLOW_ID,
    name: "CI",
    path: ".github/workflows/ci.yml",
    state: "active",
    url: `${API_ROOT}/actions/workflows/${WORKFLOW_ID}`,
  };
}

function protection(): JsonRecord {
  return {
    allow_deletions: { enabled: false },
    allow_force_pushes: { enabled: false },
    enforce_admins: { enabled: true },
    required_status_checks: {
      checks: [{ app_id: null, context: "Required CI gate" }],
      contexts: ["Required CI gate"],
      strict: true,
    },
  };
}

function run(
  overrides: Partial<{
    conclusion: string | null;
    created_at: string;
    event: string;
    head_branch: string | null;
    head_sha: string;
    id: number;
    path: string;
    repository: string;
    run_attempt: number;
    status: string;
    updated_at: string;
    workflow_id: number;
  }> = {},
): JsonRecord {
  const id = overrides.id ?? RUN_ID;
  const sha = overrides.head_sha ?? RELEASE_SHA;
  return {
    conclusion: overrides.conclusion ?? "success",
    created_at: overrides.created_at ?? "2026-09-01T01:00:00Z",
    event: overrides.event ?? "push",
    head_branch:
      overrides.head_branch === undefined ? "master" : overrides.head_branch,
    head_commit: { id: sha },
    head_repository: { full_name: overrides.repository ?? REPOSITORY },
    head_sha: sha,
    html_url: `${WEB_ROOT}/actions/runs/${id}`,
    id,
    name: "CI",
    path: overrides.path ?? ".github/workflows/ci.yml",
    repository: { full_name: overrides.repository ?? REPOSITORY },
    run_attempt: overrides.run_attempt ?? 1,
    status: overrides.status ?? "completed",
    updated_at: overrides.updated_at ?? "2026-09-01T01:20:00Z",
    url: `${API_ROOT}/actions/runs/${id}`,
    workflow_id: overrides.workflow_id ?? WORKFLOW_ID,
  };
}

function runs(items: JsonRecord[] = [run()]): JsonRecord {
  return {
    total_count: items.length,
    workflow_runs: items,
  };
}

function job(
  overrides: Partial<{
    conclusion: string | null;
    head_sha: string;
    id: number;
    name: string;
    run_attempt: number;
    run_id: number;
    status: string;
  }> = {},
): JsonRecord {
  const id = overrides.id ?? GATE_JOB_ID;
  const runId = overrides.run_id ?? RUN_ID;
  return {
    conclusion: overrides.conclusion ?? "success",
    head_sha: overrides.head_sha ?? RELEASE_SHA,
    html_url: `${WEB_ROOT}/actions/runs/${runId}/job/${id}`,
    id,
    name: overrides.name ?? "Required CI gate",
    run_attempt: overrides.run_attempt ?? 1,
    run_id: runId,
    run_url: `${API_ROOT}/actions/runs/${runId}`,
    status: overrides.status ?? "completed",
    url: `${API_ROOT}/actions/jobs/${id}`,
  };
}

function jobs(items: JsonRecord[] = [job()]): JsonRecord {
  return { jobs: items, total_count: items.length };
}

function baselineState(): RunnerState {
  return {
    branchRef: "refs/heads/master",
    calls: [],
    commandScopes: [],
    committedScriptBlob: SCRIPT_BLOB,
    dirtyStatus: "",
    fetchUrls: "git@github.com:Jameskyzx/diesel.git",
    githubRef: githubRef(),
    head: RELEASE_SHA,
    jobs: jobs(),
    lsRemote: `${RELEASE_SHA}\trefs/heads/master`,
    protection: protection(),
    pushUrls: "git@github.com:Jameskyzx/diesel.git",
    remoteTracking: RELEASE_SHA,
    runs: runs(),
    workflow: workflow(),
    worktreeScriptBlob: SCRIPT_BLOB,
  };
}

function commandResult(stdout: string): ReleaseCommandResult {
  return { status: 0, stderr: "", stdout };
}

function jsonResult(value: unknown): ReleaseCommandResult {
  return commandResult(JSON.stringify(value));
}

function runnerFor(state: RunnerState): ReleaseCommandRunner {
  let statusReads = 0;
  let branchReads = 0;
  let headReads = 0;
  let hashReads = 0;
  let lsRemoteReads = 0;
  let refReads = 0;
  let remoteTrackingReads = 0;
  let runReads = 0;
  let fetchUrlReads = 0;
  let protectionReads = 0;
  let pushUrlReads = 0;
  let workflowReads = 0;

  return (command, args, scope = "repository") => {
    const key = `${command} ${args.join(" ")}`;
    state.calls.push(key);
    state.commandScopes.push({
      args: [...args],
      command,
      scope,
    });
    if (state.throwOn && key.includes(state.throwOn)) {
      throw new Error("synthetic command failure");
    }

    if (command === "git") {
      const joined = args.join("\0");
      if (joined === "rev-parse\0--show-toplevel") return commandResult(ROOT);
      if (joined.includes("status\0--porcelain=v1")) {
        statusReads += 1;
        return commandResult(
          statusReads === 1
            ? state.dirtyStatus
            : (state.finalDirtyStatus ?? state.dirtyStatus),
        );
      }
      if (joined === "symbolic-ref\0--quiet\0HEAD") {
        branchReads += 1;
        return commandResult(
          branchReads === 1
            ? state.branchRef
            : (state.finalBranchRef ?? state.branchRef),
        );
      }
      if (joined === "rev-parse\0--verify\0HEAD^{commit}") {
        headReads += 1;
        return commandResult(
          headReads === 1 ? state.head : (state.finalHead ?? state.head),
        );
      }
      if (
        joined ===
        "rev-parse\0--verify\0HEAD:scripts/deploy/verify-release-authorization.bundle.mjs"
      ) {
        return commandResult(state.committedScriptBlob);
      }
      if (
        joined ===
        "hash-object\0--no-filters\0scripts/deploy/verify-release-authorization.bundle.mjs"
      ) {
        hashReads += 1;
        return commandResult(
          hashReads === 1
            ? state.worktreeScriptBlob
            : (state.finalWorktreeScriptBlob ?? state.worktreeScriptBlob),
        );
      }
      if (
        joined ===
        "rev-parse\0--verify\0refs/remotes/origin/master^{commit}"
      ) {
        remoteTrackingReads += 1;
        return commandResult(
          remoteTrackingReads === 1
            ? state.remoteTracking
            : (state.finalRemoteTracking ?? state.remoteTracking),
        );
      }
      if (joined === "remote\0get-url\0--all\0origin") {
        fetchUrlReads += 1;
        return commandResult(
          fetchUrlReads === 1
            ? state.fetchUrls
            : (state.finalFetchUrls ?? state.fetchUrls),
        );
      }
      if (joined === "remote\0get-url\0--push\0--all\0origin") {
        pushUrlReads += 1;
        return commandResult(
          pushUrlReads === 1
            ? state.pushUrls
            : (state.finalPushUrls ?? state.pushUrls),
        );
      }
      if (
        joined ===
        "ls-remote\0--exit-code\0--refs\0git@github.com:Jameskyzx/diesel.git\0refs/heads/master"
      ) {
        lsRemoteReads += 1;
        return commandResult(
          lsRemoteReads === 1
            ? state.lsRemote
            : (state.finalLsRemote ?? state.lsRemote),
        );
      }
      return { status: 2, stderr: "unexpected git command", stdout: "" };
    }

    const endpoint = args[5] ?? "";
    if (endpoint.endsWith("/git/ref/heads/master")) {
      refReads += 1;
      return jsonResult(
        refReads === 1
          ? state.githubRef
          : (state.finalGithubRef ?? state.githubRef),
      );
    }
    if (endpoint.endsWith("/actions/workflows/ci.yml")) {
      workflowReads += 1;
      return jsonResult(
        workflowReads === 1
          ? state.workflow
          : (state.finalWorkflow ?? state.workflow),
      );
    }
    if (endpoint.endsWith("/branches/master/protection")) {
      protectionReads += 1;
      return jsonResult(
        protectionReads === 1
          ? state.protection
          : (state.finalProtection ?? state.protection),
      );
    }
    if (endpoint.includes(`/actions/workflows/${WORKFLOW_ID}/runs?`)) {
      runReads += 1;
      return jsonResult(
        runReads === 1 ? state.runs : (state.finalRuns ?? state.runs),
      );
    }
    if (endpoint.includes(`/actions/runs/${RUN_ID}/attempts/1/jobs?`)) {
      return jsonResult(state.jobs);
    }
    return { status: 2, stderr: "unexpected gh command", stdout: "" };
  };
}

function verify(state: RunnerState = baselineState()) {
  return verifyReleaseAuthorizationWithRunner({
    expectedCommit: RELEASE_SHA,
    now: () => new Date("2026-09-01T02:30:00Z"),
    repositoryRoot: ROOT,
    runCommand: runnerFor(state),
  });
}

function authorizationNodeArgs(script: string, ...args: string[]): string[] {
  return [script, ...args];
}

function expectRejected(
  mutate: (state: RunnerState) => void,
  message: RegExp,
): void {
  const state = baselineState();
  mutate(state);
  expect(() => verify(state)).toThrow(message);
}

describe("release authorization", () => {
  it("separates repository Git, GitHub API, and isolated remote credentials", () => {
    const inheritedEnvironment: NodeJS.ProcessEnv = {
      DATABASE_URL: "postgres://private.invalid",
      GH_CONFIG_DIR: "/private/gh",
      GH_TOKEN: "github-token",
      GITHUB_TOKEN: "github-actions-token",
      HOME: "/private/home",
      HTTPS_PROXY: "https://proxy.invalid",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      NODE_ENV: "test",
      NODE_OPTIONS: "--require=/private/startup.cjs",
      PATH: "/trusted/bin",
      SSH_AUTH_SOCK: "/private/ssh-agent.sock",
      SSL_CERT_FILE: "/private/ca.pem",
      XDG_CONFIG_HOME: "/private/xdg",
    };

    const repositoryGit = createReleaseCommandEnvironment(
      "git",
      "repository",
      inheritedEnvironment,
    );
    expect(repositoryGit).toMatchObject({
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_KEY_2: "diff.external",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_VALUE_1: "/dev/null",
      GIT_CONFIG_VALUE_2: "",
      GIT_NO_REPLACE_OBJECTS: "1",
      HOME: "/nonexistent",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      PATH: "/trusted/bin",
    });
    for (const secret of [
      "DATABASE_URL",
      "GH_CONFIG_DIR",
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "HTTPS_PROXY",
      "NODE_OPTIONS",
      "SSH_AUTH_SOCK",
      "SSL_CERT_FILE",
      "XDG_CONFIG_HOME",
    ]) {
      expect(repositoryGit).not.toHaveProperty(secret);
    }

    const githubApi = createReleaseCommandEnvironment(
      "gh",
      "repository",
      inheritedEnvironment,
    );
    expect(githubApi).toMatchObject({
      GH_CONFIG_DIR: "/private/gh",
      GH_TOKEN: "github-token",
      GITHUB_TOKEN: "github-actions-token",
      HOME: "/private/home",
      HTTPS_PROXY: "https://proxy.invalid",
      SSL_CERT_FILE: "/private/ca.pem",
      XDG_CONFIG_HOME: "/private/xdg",
    });
    expect(githubApi).not.toHaveProperty("DATABASE_URL");
    expect(githubApi).not.toHaveProperty("NODE_OPTIONS");
    expect(githubApi).not.toHaveProperty("SSH_AUTH_SOCK");

    const isolatedGit = createReleaseCommandEnvironment(
      "git",
      "isolated",
      inheritedEnvironment,
    );
    expect(isolatedGit).toMatchObject({
      GIT_CEILING_DIRECTORIES: "/",
      GIT_SSH_VARIANT: "ssh",
      HOME: "/private/home",
      HTTPS_PROXY: "https://proxy.invalid",
      SSH_AUTH_SOCK: "/private/ssh-agent.sock",
      SSL_CERT_FILE: "/private/ca.pem",
    });
    expect(isolatedGit.GIT_SSH_COMMAND).toContain("-F /dev/null");
    expect(isolatedGit.GIT_SSH_COMMAND).toContain(
      "-o StrictHostKeyChecking=yes",
    );
    expect(isolatedGit).not.toHaveProperty("GH_TOKEN");
    expect(isolatedGit).not.toHaveProperty("GITHUB_TOKEN");
    expect(isolatedGit).not.toHaveProperty("NODE_OPTIONS");
  });

  it("binds one clean release commit to strict protection and its newest gate", () => {
    const state = baselineState();
    const result = verify(state);

    expect(result).toEqual({
      branch: "master",
      commit: RELEASE_SHA,
      format: "diesel-release-authorization-v1",
      origin: {
        fetchUrl: "git@github.com:Jameskyzx/diesel.git",
        pushUrl: "git@github.com:Jameskyzx/diesel.git",
        remoteMaster: RELEASE_SHA,
        remoteMasterReadback: RELEASE_SHA,
      },
      protection: {
        allowDeletions: false,
        allowForcePushes: false,
        enforceAdmins: true,
        requiredCheck: "Required CI gate",
        requiredCheckAppId: null,
        strict: true,
      },
      repository: REPOSITORY,
      verifiedAt: "2026-09-01T02:30:00.000Z",
      workflow: {
        gateJobId: GATE_JOB_ID,
        gateJobUrl: `${WEB_ROOT}/actions/runs/${RUN_ID}/job/${GATE_JOB_ID}`,
        id: WORKFLOW_ID,
        name: "CI",
        path: ".github/workflows/ci.yml",
        runAttempt: 1,
        runId: RUN_ID,
        runUrl: `${WEB_ROOT}/actions/runs/${RUN_ID}`,
        state: "active",
      },
    });
    expect(
      parseReleaseAuthorizationOutput(JSON.stringify(result), RELEASE_SHA),
    ).toEqual(result);
    const runQueries = state.calls.filter((call) =>
      call.includes(`/actions/workflows/${WORKFLOW_ID}/runs?`),
    );
    expect(runQueries).toHaveLength(2);
    expect(runQueries[0]).toContain(
      `branch=master&event=push&head_sha=${RELEASE_SHA}&per_page=100`,
    );
    expect(runQueries[0]).not.toContain("status=");
    expect(state.calls).toContainEqual(
      expect.stringContaining(`/runs/${RUN_ID}/attempts/1/jobs?per_page=100`),
    );
    for (const call of state.calls.filter((value) => value.startsWith("gh api"))) {
      expect(call).toContain("Accept: application/vnd.github+json");
      expect(call).toContain("X-GitHub-Api-Version: 2022-11-28");
    }
    expect(
      state.commandScopes.filter(
        ({ args, command }) =>
          command === "git" && args[0] === "ls-remote",
      ),
    ).toEqual([
      {
        args: [
          "ls-remote",
          "--exit-code",
          "--refs",
          "git@github.com:Jameskyzx/diesel.git",
          "refs/heads/master",
        ],
        command: "git",
        scope: "isolated",
      },
      {
        args: [
          "ls-remote",
          "--exit-code",
          "--refs",
          "git@github.com:Jameskyzx/diesel.git",
          "refs/heads/master",
        ],
        command: "git",
        scope: "isolated",
      },
    ]);
  });

  it.each([
    ["dirty worktree", (state: RunnerState) => (state.dirtyStatus = "?? rogue"), /clean worktree/u],
    ["wrong branch", (state: RunnerState) => (state.branchRef = "refs/heads/release"), /requires refs\/heads\/master/u],
    ["wrong HEAD", (state: RunnerState) => (state.head = OTHER_SHA), /HEAD does not equal/u],
    ["stale tracking ref", (state: RunnerState) => (state.remoteTracking = OTHER_SHA), /Local origin\/master/u],
    ["modified verifier", (state: RunnerState) => (state.worktreeScriptBlob = OTHER_SHA), /verifier differs/u],
    ["multiple fetch URLs", (state: RunnerState) => (state.fetchUrls += "\nhttps://github.com/Jameskyzx/diesel.git"), /exactly one canonical/u],
    ["different push URL", (state: RunnerState) => (state.pushUrls = "https://github.com/Jameskyzx/diesel.git"), /must be identical/u],
    ["wrong fresh remote", (state: RunnerState) => (state.lsRemote = `${OTHER_SHA}\trefs/heads/master`), /not one exact release ref/u],
  ])("rejects %s", (_label, mutate, message) => {
    expectRejected(mutate, message);
  });

  it.each([
    ["ref commit drift", (state: RunnerState) => (state.githubRef = githubRef(OTHER_SHA)), /GitHub master ref/u],
    ["inactive workflow", (state: RunnerState) => ((state.workflow.state as string) = "disabled_manually"), /workflow identity or state/u],
    ["workflow path drift", (state: RunnerState) => ((state.workflow.path as string) = ".github/workflows/other.yml"), /workflow identity or state/u],
    ["non-strict checks", (state: RunnerState) => (((state.protection.required_status_checks as JsonRecord).strict as boolean) = false), /branch protection drifted/u],
    ["extra context", (state: RunnerState) => (((state.protection.required_status_checks as JsonRecord).contexts as unknown[]) = ["Required CI gate", "legacy"]), /branch protection drifted/u],
    ["admins bypass", (state: RunnerState) => (((state.protection.enforce_admins as JsonRecord).enabled as boolean) = false), /branch protection drifted/u],
    ["force pushes", (state: RunnerState) => (((state.protection.allow_force_pushes as JsonRecord).enabled as boolean) = true), /branch protection drifted/u],
    ["deletions", (state: RunnerState) => (((state.protection.allow_deletions as JsonRecord).enabled as boolean) = true), /branch protection drifted/u],
    ["unexpected app binding", (state: RunnerState) => ((((state.protection.required_status_checks as JsonRecord).checks as JsonRecord[])[0]!.app_id as number | null) = 123), /branch protection drifted/u],
  ])("rejects GitHub configuration drift: %s", (_label, mutate, message) => {
    expectRejected(mutate, message);
  });

  it("rejects a truncated run page", () => {
    expectRejected(
      (state) => {
        state.runs.total_count = 2;
      },
      /truncated or has an inconsistent total_count/u,
    );
  });

  it("rejects duplicate run IDs", () => {
    expectRejected(
      (state) => {
        state.runs = runs([
          run(),
          run({ created_at: "2026-08-31T23:00:00Z" }),
        ]);
      },
      /duplicate IDs/u,
    );
  });

  it("rejects every returned run when any provenance field drifts", () => {
    expectRejected(
      (state) => {
        state.runs = runs([run({ repository: "attacker/fork" })]);
      },
      /invalid release provenance/u,
    );
  });

  it("rejects no exact-SHA push run", () => {
    expectRejected((state) => (state.runs = runs([])), /No push CI workflow run/u);
  });

  it("does not hide a newer failed run behind an older successful rerun", () => {
    expectRejected(
      (state) => {
        state.runs = runs([
          run({
            created_at: "2026-09-01T01:00:00Z",
            id: RUN_ID,
            updated_at: "2026-09-01T03:00:00Z",
          }),
          run({
            conclusion: "failure",
            created_at: "2026-09-01T02:00:00Z",
            id: RUN_ID + 1,
            status: "completed",
            updated_at: "2026-09-01T02:20:00Z",
          }),
        ]);
      },
      /newest GitHub CI workflow run is not successfully completed/u,
    );
  });

  it("rejects a newer in-progress run", () => {
    expectRejected(
      (state) => {
        state.runs = runs([
          run(),
          run({
            conclusion: null,
            created_at: "2026-09-01T02:00:00Z",
            id: RUN_ID + 1,
            status: "in_progress",
          }),
        ]);
      },
      /not successfully completed/u,
    );
  });

  it("rejects ambiguous newest-run timestamps instead of guessing by ID", () => {
    expectRejected(
      (state) => {
        state.runs = runs([run(), run({ id: RUN_ID + 1 })]);
      },
      /created_at is tied/u,
    );
  });

  it("treats equivalent RFC3339 instants as an ambiguous newest-run tie", () => {
    expectRejected(
      (state) => {
        state.runs = runs([
          run({ created_at: "2026-09-01T01:00:00Z" }),
          run({ created_at: "2026-09-01T09:00:00+08:00", id: RUN_ID + 1 }),
        ]);
      },
      /created_at is tied/u,
    );
  });

  it("accepts the newer success after an older failed run", () => {
    const state = baselineState();
    state.runs = runs([
      run({
        conclusion: "failure",
        created_at: "2026-08-31T23:00:00Z",
        id: RUN_ID - 1,
      }),
      run(),
    ]);
    expect(verify(state).workflow.runId).toBe(RUN_ID);
  });

  it.each([
    ["missing gate", [job({ id: GATE_JOB_ID - 1, name: "Lint" })], /exactly one Required CI gate/u],
    ["duplicate gate", [job(), job({ id: GATE_JOB_ID + 1 })], /exactly one Required CI gate/u],
    ["wrong attempt", [job({ run_attempt: 2 })], /invalid release provenance/u],
    ["wrong SHA", [job({ head_sha: OTHER_SHA })], /invalid release provenance/u],
    ["failed gate", [job({ conclusion: "failure" })], /gate job is not successfully completed/u],
    ["running gate", [job({ conclusion: null, status: "in_progress" })], /gate job is not successfully completed/u],
  ])("rejects attempt job evidence: %s", (_label, jobItems, message) => {
    expectRejected((state) => (state.jobs = jobs(jobItems)), message);
  });

  it("rejects the live legacy shape: successful workflow with no gate job", () => {
    expectRejected(
      (state) => {
        state.jobs = jobs([
          job({ id: GATE_JOB_ID - 2, name: "Quality" }),
          job({ id: GATE_JOB_ID - 1, name: "Playwright" }),
        ]);
      },
      /exactly one Required CI gate/u,
    );
  });

  it("rejects an attempt rerun race after reading jobs", () => {
    expectRejected(
      (state) => {
        state.finalRuns = runs([run({ run_attempt: 2 })]);
      },
      /run state changed during release authorization/u,
    );
  });

  it("rejects a newly indexed run after reading jobs", () => {
    expectRejected(
      (state) => {
        state.finalRuns = runs([
          run(),
          run({
            conclusion: "failure",
            created_at: "2026-09-01T02:00:00Z",
            id: RUN_ID + 1,
          }),
        ]);
      },
      /run state changed during release authorization/u,
    );
  });

  it("rejects a GitHub master ref race", () => {
    expectRejected(
      (state) => (state.finalGithubRef = githubRef(OTHER_SHA)),
      /GitHub master ref changed/u,
    );
  });

  it("rejects a workflow identity race", () => {
    expectRejected(
      (state) => {
        state.finalWorkflow = { ...workflow(), state: "disabled_manually" };
      },
      /workflow identity changed/u,
    );
  });

  it("rejects a branch-protection race", () => {
    expectRejected(
      (state) => {
        const changed = protection();
        (changed.enforce_admins as JsonRecord).enabled = false;
        state.finalProtection = changed;
      },
      /branch protection changed/u,
    );
  });

  it.each([
    ["worktree", (state: RunnerState) => (state.finalDirtyStatus = " M package.json")],
    ["HEAD", (state: RunnerState) => (state.finalHead = OTHER_SHA)],
    ["remote", (state: RunnerState) => (state.finalLsRemote = `${OTHER_SHA}\trefs/heads/master`)],
    ["tracking ref", (state: RunnerState) => (state.finalRemoteTracking = OTHER_SHA)],
    ["origin config", (state: RunnerState) => (state.finalFetchUrls = "https://github.com/Jameskyzx/diesel.git")],
    ["verifier bytes", (state: RunnerState) => (state.finalWorktreeScriptBlob = OTHER_SHA)],
  ])("rejects a local %s race", (_label, mutate) => {
    expectRejected(mutate, /Local release state changed/u);
  });

  it("rejects command failure without accepting residual evidence", () => {
    expectRejected(
      (state) => (state.throwOn = "ls-remote"),
      /synthetic command failure/u,
    );
  });

  it("rejects malformed external JSON", () => {
    const state = baselineState();
    const defaultRunner = runnerFor(state);
    const runner: ReleaseCommandRunner = (command, args) =>
      command === "gh" && (args[5] ?? "").endsWith("/actions/workflows/ci.yml")
        ? commandResult("not-json")
        : defaultRunner(command, args);
    expect(() =>
      verifyReleaseAuthorizationWithRunner({
        expectedCommit: RELEASE_SHA,
        repositoryRoot: ROOT,
        runCommand: runner,
      }),
    ).toThrow(/did not return valid JSON/u);
  });

  it("rejects unsafe numeric GitHub IDs", () => {
    expectRejected(
      (state) => {
        state.workflow.id = Number.MAX_SAFE_INTEGER + 1;
      },
      /required GitHub API schema/u,
    );
  });

  it.each([
    ["empty JSON", "", /not valid JSON/u],
    [
      "an extra field",
      JSON.stringify({ ...verify(), unexpected: true }),
      /does not match its v1 schema/u,
    ],
    [
      "a different requested commit",
      JSON.stringify(verify()),
      /not bound to the requested release commit/u,
      OTHER_SHA,
    ],
    [
      "a run URL outside the bound run",
      JSON.stringify({
        ...verify(),
        workflow: {
          ...verify().workflow,
          runUrl: `${WEB_ROOT}/actions/runs/${RUN_ID + 1}`,
        },
      }),
      /not bound to the requested release commit/u,
    ],
  ])("rejects release authorization output with %s", (_label, contents, message, expected = RELEASE_SHA) => {
    expect(() => parseReleaseAuthorizationOutput(contents, expected)).toThrow(
      message,
    );
  });
});

describe("release authorization CLI", () => {
  it("keeps the committed bundle byte-for-byte generated from the TypeScript source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "diesel-release-auth-build-"));
    temporaryDirectories.push(directory);
    const generatedBundle = join(directory, "verify-release-authorization.bundle.mjs");
    const generatedMetafile = join(directory, "verify-release-authorization.meta.json");
    const result = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), "scripts/deploy/build-release-authorization.mjs"),
        `--metafile=${generatedMetafile}`,
        `--outfile=${generatedBundle}`,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          ESBUILD_BINARY_PATH: undefined,
          NODE_OPTIONS: undefined,
          PATH: directory,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    await expect(readFile(generatedBundle)).resolves.toEqual(
      await readFile(
        resolve(
          process.cwd(),
          "scripts/deploy/verify-release-authorization.bundle.mjs",
        ),
      ),
    );
    const metafile = bundleMetafileSchema.parse(
      JSON.parse(await readFile(generatedMetafile, "utf8")),
    );
    expect(Object.keys(metafile.inputs)).toContain(
      "scripts/deploy/verify-release-authorization.ts",
    );
    expect(
      Object.keys(metafile.inputs).some((path) =>
        path.includes("/node_modules/zod/"),
      ),
    ).toBe(true);
    expect(Object.values(metafile.outputs)).toHaveLength(1);
    expect(Object.values(metafile.outputs)[0]?.imports).toEqual([
      {
        external: true,
        kind: "import-statement",
        path: "node:child_process",
      },
      { external: true, kind: "import-statement", path: "node:fs" },
      { external: true, kind: "import-statement", path: "node:path" },
      { external: true, kind: "import-statement", path: "node:url" },
    ]);

    const packageJson = JSON.parse(
      await readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, unknown> };
    expect(packageJson.scripts?.["release:authorize:bundle"]).toBe(
      "env -u ESBUILD_BINARY_PATH -u NODE_OPTIONS node scripts/deploy/build-release-authorization.mjs",
    );
  });

  it("rejects an inherited esbuild binary override before creating output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "diesel-release-auth-esbuild-"));
    temporaryDirectories.push(directory);
    const generatedBundle = join(directory, "authorization.mjs");
    const result = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), "scripts/deploy/build-release-authorization.mjs"),
        `--outfile=${generatedBundle}`,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          ESBUILD_BINARY_PATH: process.execPath,
          NODE_OPTIONS: undefined,
          PATH: directory,
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ESBUILD_BINARY_PATH must not be set/u);
    await expect(access(generatedBundle)).rejects.toThrow();
  });

  it.each([
    ["unknown", ["--wat"]],
    ["empty outfile", ["--outfile="]],
    ["empty metafile", ["--metafile="]],
    [
      "duplicate outfile",
      [
        `--outfile=${resolve(process.cwd(), "scripts/deploy/verify-release-authorization.bundle.mjs")}`,
        "--outfile=another.mjs",
      ],
    ],
    ["duplicate metafile", ["--metafile=one.json", "--metafile=two.json"]],
    ["shared output", ["--outfile=same", "--metafile=same"]],
  ])("rejects %s build arguments", (_label, arguments_) => {
    const result = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), "scripts/deploy/build-release-authorization.mjs"),
        ...arguments_,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ESBUILD_BINARY_PATH: undefined,
          NODE_OPTIONS: undefined,
        },
      },
    );

    expect(result.status).not.toBe(0);
  });

  it("rejects a missing release commit before running repository checks", async () => {
    const script = resolve(
      process.cwd(),
      "scripts/deploy/verify-release-authorization.bundle.mjs",
    );
    await expect(
      execFileAsync(process.execPath, authorizationNodeArgs(script)),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Usage: pnpm release:authorize"),
    });
  });

  it("accepts pnpm's literal separator before validating the one SHA", async () => {
    const script = resolve(
      process.cwd(),
      "scripts/deploy/verify-release-authorization.bundle.mjs",
    );
    await expect(
      execFileAsync(
        process.execPath,
        authorizationNodeArgs(script, "--", "invalid"),
      ),
    ).rejects.toMatchObject({
      stderr: expect.not.stringContaining("Usage: pnpm release:authorize"),
    });
  });

  it("does not let inherited NODE_OPTIONS bypass an explicitly sanitized pnpm convenience call", async () => {
    await expect(
      execFileAsync(
        "env",
        [
          "-u",
          "NODE_OPTIONS",
          "npm_config_node_options=",
          "pnpm",
          "--silent",
          "release:authorize",
          "--",
          "invalid",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_OPTIONS:
              "--import=data:text/javascript,process.exit%280%29",
          },
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Release commit must be one 40-character lowercase Git SHA",
      ),
    });
  });

  it("validates the captured authorization JSON through the bounded CLI mode", () => {
    const script = resolve(
      process.cwd(),
      "scripts/deploy/verify-release-authorization.bundle.mjs",
    );
    const authorization = verify();
    const environment = { ...process.env };
    delete environment.NODE_OPTIONS;
    const result = spawnSync(
      process.execPath,
      authorizationNodeArgs(script, "validate-output", RELEASE_SHA),
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: environment,
        input: JSON.stringify(authorization),
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      `Release authorization output validated for ${RELEASE_SHA}.`,
    );
  });

  it("accepts a valid authorization payload at exactly the 64 KiB byte limit", () => {
    const script = resolve(
      process.cwd(),
      "scripts/deploy/verify-release-authorization.bundle.mjs",
    );
    const serialized = JSON.stringify(verify());
    const input = serialized.padEnd(
      MAX_AUTHORIZATION_OUTPUT_BYTES,
      " ",
    );
    const environment = { ...process.env };
    delete environment.NODE_OPTIONS;

    expect(Buffer.byteLength(input)).toBe(MAX_AUTHORIZATION_OUTPUT_BYTES);
    const result = spawnSync(
      process.execPath,
      authorizationNodeArgs(script, "validate-output", RELEASE_SHA),
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: environment,
        input,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it.each([
    [
      "one ASCII byte above the limit",
      () => {
        const serialized = JSON.stringify(verify());
        return serialized.padEnd(MAX_AUTHORIZATION_OUTPUT_BYTES + 1, " ");
      },
    ],
    [
      "a multibyte payload above the byte limit",
      () => JSON.stringify("界".repeat(21_846)),
    ],
  ])("rejects %s before parsing", (_label, createInput) => {
    const script = resolve(
      process.cwd(),
      "scripts/deploy/verify-release-authorization.bundle.mjs",
    );
    const input = createInput();
    const environment = { ...process.env };
    delete environment.NODE_OPTIONS;

    expect(Buffer.byteLength(input)).toBeGreaterThan(
      MAX_AUTHORIZATION_OUTPUT_BYTES,
    );
    const result = spawnSync(
      process.execPath,
      authorizationNodeArgs(script, "validate-output", RELEASE_SHA),
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: environment,
        input,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Release authorization output exceeds 64 KiB",
    );
  });

  it("runs the validator from an archive-shaped committed bundle without node_modules", async () => {
    const directory = await mkdtemp(join(tmpdir(), "diesel-release-auth-archive-"));
    temporaryDirectories.push(directory);
    const sourceBundle = resolve(
      process.cwd(),
      "scripts/deploy/verify-release-authorization.bundle.mjs",
    );
    const committedBundle = join(
      directory,
      "scripts/deploy/verify-release-authorization.bundle.mjs",
    );
    await mkdir(join(directory, "scripts/deploy"), { recursive: true });
    await copyFile(sourceBundle, committedBundle);
    const authorization = verify();
    const environment = { ...process.env };
    delete environment.NODE_OPTIONS;
    const result = spawnSync(
      process.execPath,
      authorizationNodeArgs(
        committedBundle,
        "validate-output",
        RELEASE_SHA,
      ),
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: environment,
        input: JSON.stringify(authorization),
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(RELEASE_SHA);
  });

  it("does not load a malicious archive-local zod package before validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "diesel-release-auth-hostile-"));
    temporaryDirectories.push(directory);
    const committedBundle = join(
      directory,
      "scripts/deploy/verify-release-authorization.bundle.mjs",
    );
    const hostilePackageDirectory = join(directory, "node_modules/zod");
    await mkdir(join(directory, "scripts/deploy"), { recursive: true });
    await mkdir(hostilePackageDirectory, { recursive: true });
    await copyFile(
      resolve(
        process.cwd(),
        "scripts/deploy/verify-release-authorization.bundle.mjs",
      ),
      committedBundle,
    );
    await writeFile(
      join(hostilePackageDirectory, "package.json"),
      JSON.stringify({ exports: "./index.mjs", type: "module" }),
      "utf8",
    );
    await writeFile(
      join(hostilePackageDirectory, "index.mjs"),
      'process.stdout.write("HOSTILE_ZOD_LOADED\\n"); process.exit(0);',
      "utf8",
    );
    const environment = { ...process.env };
    delete environment.NODE_OPTIONS;
    const result = spawnSync(
      process.execPath,
      authorizationNodeArgs(
        committedBundle,
        "validate-output",
        RELEASE_SHA,
      ),
      {
        cwd: directory,
        encoding: "utf8",
        env: environment,
        input: "not-json",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("HOSTILE_ZOD_LOADED");
    expect(result.stderr).toContain(
      "Release authorization output is not valid JSON",
    );
  });

  it("enters the CLI main path through a symlink", async () => {
    const directory = await mkdtemp(join(tmpdir(), "diesel-release-auth-cli-"));
    temporaryDirectories.push(directory);
    const script = resolve(
      process.cwd(),
      "scripts/deploy/verify-release-authorization.bundle.mjs",
    );
    const linkedScript = join(directory, "release-authorize.mjs");
    await symlink(script, linkedScript);

    await expect(
      execFileAsync(process.execPath, authorizationNodeArgs(linkedScript)),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Usage: pnpm release:authorize"),
    });
  });
});
