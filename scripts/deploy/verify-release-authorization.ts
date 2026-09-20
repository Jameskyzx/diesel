import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const RELEASE_REPOSITORY = "Jameskyzx/diesel";
const RELEASE_BRANCH = "master";
const RELEASE_BRANCH_REF = `refs/heads/${RELEASE_BRANCH}`;
const RELEASE_REMOTE_TRACKING_REF = `refs/remotes/origin/${RELEASE_BRANCH}`;
const RELEASE_WORKFLOW_NAME = "CI";
const RELEASE_WORKFLOW_PATH = ".github/workflows/ci.yml";
const RELEASE_WORKFLOW_FILE = "ci.yml";
const RELEASE_AUTHORIZATION_SCRIPT =
  "scripts/deploy/verify-release-authorization.bundle.mjs";
const REQUIRED_GATE_NAME = "Required CI gate";
const GITHUB_API_ROOT = `https://api.github.com/repos/${RELEASE_REPOSITORY}`;
const GITHUB_WEB_ROOT = `https://github.com/${RELEASE_REPOSITORY}`;
const MAX_API_ITEMS = 100;
const GITHUB_API_VERSION = "2022-11-28";
const ISOLATED_GIT_CWD = "/";
const ISOLATED_GIT_SSH_COMMAND = [
  "ssh",
  "-F /dev/null",
  "-o BatchMode=yes",
  "-o CanonicalizeHostname=no",
  "-o CheckHostIP=yes",
  "-o ClearAllForwardings=yes",
  "-o ConnectTimeout=10",
  "-o ForwardAgent=no",
  "-o ForwardX11=no",
  "-o HostKeyAlias=github.com",
  "-o KbdInteractiveAuthentication=no",
  "-o NumberOfPasswordPrompts=0",
  "-o PasswordAuthentication=no",
  "-o PermitLocalCommand=no",
  "-o RequestTTY=no",
  "-o StrictHostKeyChecking=yes",
  "-o UpdateHostKeys=no",
].join(" ");

const ALLOWED_ORIGIN_URLS = [
  `git@github.com:${RELEASE_REPOSITORY}.git`,
  `${GITHUB_WEB_ROOT}.git`,
] as const;
type AllowedOriginUrl = (typeof ALLOWED_ORIGIN_URLS)[number];
const allowedOriginUrls = new Set<string>(ALLOWED_ORIGIN_URLS);

const commitSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const githubDateTimeSchema = z.iso.datetime({ offset: true });
const positiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const githubRefSchema = z
  .object({
    object: z
      .object({
        sha: commitSchema,
        type: z.string(),
        url: z.url(),
      })
      .passthrough(),
    ref: z.string(),
    url: z.url(),
  })
  .passthrough();

const workflowSchema = z
  .object({
    html_url: z.url(),
    id: positiveIntegerSchema,
    name: z.string(),
    path: z.string(),
    state: z.string(),
    url: z.url(),
  })
  .passthrough();

const branchProtectionSchema = z
  .object({
    allow_deletions: z.object({ enabled: z.boolean() }).passthrough(),
    allow_force_pushes: z.object({ enabled: z.boolean() }).passthrough(),
    enforce_admins: z.object({ enabled: z.boolean() }).passthrough(),
    required_status_checks: z
      .object({
        checks: z.array(
          z
            .object({
              app_id: z.number().int().positive().nullable(),
              context: z.string(),
            })
            .passthrough(),
        ),
        contexts: z.array(z.string()),
        strict: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();

const workflowRunSchema = z
  .object({
    conclusion: z.string().nullable(),
    created_at: githubDateTimeSchema,
    event: z.string(),
    head_branch: z.string().nullable(),
    head_commit: z.object({ id: commitSchema }).passthrough(),
    head_repository: z.object({ full_name: z.string() }).passthrough().nullable(),
    head_sha: commitSchema,
    html_url: z.url(),
    id: positiveIntegerSchema,
    name: z.string(),
    path: z.string(),
    repository: z.object({ full_name: z.string() }).passthrough(),
    run_attempt: positiveIntegerSchema,
    status: z.string(),
    updated_at: githubDateTimeSchema,
    url: z.url(),
    workflow_id: positiveIntegerSchema,
  })
  .passthrough();

const workflowRunsSchema = z
  .object({
    total_count: z.number().int().nonnegative(),
    workflow_runs: z.array(workflowRunSchema),
  })
  .passthrough();

const workflowJobSchema = z
  .object({
    conclusion: z.string().nullable(),
    head_sha: commitSchema,
    html_url: z.url(),
    id: positiveIntegerSchema,
    name: z.string(),
    run_attempt: positiveIntegerSchema,
    run_id: positiveIntegerSchema,
    run_url: z.url(),
    status: z.string(),
    url: z.url(),
  })
  .passthrough();

const workflowJobsSchema = z
  .object({
    jobs: z.array(workflowJobSchema),
    total_count: z.number().int().nonnegative(),
  })
  .passthrough();

export type ReleaseCommandResult = {
  status: number;
  stderr: string;
  stdout: string;
};

export type ReleaseCommandRunner = (
  command: "gh" | "git",
  args: readonly string[],
  scope?: "isolated" | "repository",
) => ReleaseCommandResult;

export const releaseAuthorizationSchema = z
  .object({
    branch: z.literal(RELEASE_BRANCH),
    commit: commitSchema,
    format: z.literal("diesel-release-authorization-v1"),
    origin: z
      .object({
        fetchUrl: z.enum(ALLOWED_ORIGIN_URLS),
        pushUrl: z.enum(ALLOWED_ORIGIN_URLS),
        remoteMaster: commitSchema,
        remoteMasterReadback: commitSchema,
      })
      .strict(),
    protection: z
      .object({
        allowDeletions: z.literal(false),
        allowForcePushes: z.literal(false),
        enforceAdmins: z.literal(true),
        requiredCheck: z.literal(REQUIRED_GATE_NAME),
        requiredCheckAppId: z.null(),
        strict: z.literal(true),
      })
      .strict(),
    repository: z.literal(RELEASE_REPOSITORY),
    verifiedAt: githubDateTimeSchema,
    workflow: z
      .object({
        gateJobId: positiveIntegerSchema,
        gateJobUrl: z.url(),
        id: positiveIntegerSchema,
        name: z.literal(RELEASE_WORKFLOW_NAME),
        path: z.literal(RELEASE_WORKFLOW_PATH),
        runAttempt: positiveIntegerSchema,
        runId: positiveIntegerSchema,
        runUrl: z.url(),
        state: z.literal("active"),
      })
      .strict(),
  })
  .strict();

export type ReleaseAuthorization = z.infer<typeof releaseAuthorizationSchema>;

export function parseReleaseAuthorizationOutput(
  contents: string,
  expectedCommit: string,
): ReleaseAuthorization {
  const parsedExpectedCommit = commitSchema.safeParse(expectedCommit);
  if (!parsedExpectedCommit.success) {
    throw new Error(
      "Release commit must be one 40-character lowercase Git SHA",
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    throw new Error("Release authorization output is not valid JSON");
  }
  const parsed = releaseAuthorizationSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Release authorization output does not match its v1 schema");
  }
  const authorization = parsed.data;
  if (
    authorization.commit !== parsedExpectedCommit.data ||
    authorization.origin.remoteMaster !== authorization.commit ||
    authorization.origin.remoteMasterReadback !== authorization.commit ||
    authorization.origin.fetchUrl !== authorization.origin.pushUrl ||
    authorization.workflow.runUrl !==
      `${GITHUB_WEB_ROOT}/actions/runs/${authorization.workflow.runId}` ||
    authorization.workflow.gateJobUrl !==
      `${GITHUB_WEB_ROOT}/actions/runs/${authorization.workflow.runId}` +
        `/job/${authorization.workflow.gateJobId}`
  ) {
    throw new Error(
      "Release authorization output is not bound to the requested release commit",
    );
  }
  return authorization;
}

export function createReleaseCommandEnvironment(
  command: "gh" | "git",
  scope: "isolated" | "repository",
  sourceEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv {
  const inheritedNodeEnvironment = sourceEnvironment.NODE_ENV;
  const environment: NodeJS.ProcessEnv = {
    HOME: "/nonexistent",
    NODE_ENV:
      inheritedNodeEnvironment === "development" ||
      inheritedNodeEnvironment === "test"
        ? inheritedNodeEnvironment
        : "production",
  };
  const preservedKeys =
    command === "gh"
      ? ([
          "GH_CONFIG_DIR",
          "GH_TOKEN",
          "GITHUB_TOKEN",
          "HOME",
          "HTTPS_PROXY",
          "HTTP_PROXY",
          "LANG",
          "LC_ALL",
          "NO_PROXY",
          "PATH",
          "SSL_CERT_DIR",
          "SSL_CERT_FILE",
          "XDG_CONFIG_HOME",
        ] as const)
      : scope === "isolated"
        ? ([
            "HOME",
            "HTTPS_PROXY",
            "HTTP_PROXY",
            "LANG",
            "LC_ALL",
            "NO_PROXY",
            "PATH",
            "SSH_AUTH_SOCK",
            "SSL_CERT_DIR",
            "SSL_CERT_FILE",
          ] as const)
        : (["LANG", "LC_ALL", "PATH"] as const);
  for (const key of preservedKeys) {
    const value = sourceEnvironment[key];
    if (value !== undefined) environment[key] = value;
  }
  const sharedEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    GH_PAGER: "cat",
    GH_PROMPT_DISABLED: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    NO_COLOR: "1",
    PAGER: "cat",
  };
  if (command !== "git") return sharedEnvironment;
  return {
    ...sharedEnvironment,
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_KEY_1: "core.hooksPath",
    GIT_CONFIG_KEY_2: "diff.external",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_VALUE_1: "/dev/null",
    GIT_CONFIG_VALUE_2: "",
    GIT_NO_REPLACE_OBJECTS: "1",
    ...(scope === "isolated"
      ? {
          GIT_CEILING_DIRECTORIES: ISOLATED_GIT_CWD,
          GIT_SSH_COMMAND: ISOLATED_GIT_SSH_COMMAND,
          GIT_SSH_VARIANT: "ssh",
        }
      : {}),
  };
}

function runCommandAtRoot(
  root: string,
  command: "gh" | "git",
  args: readonly string[],
  scope: "isolated" | "repository" = "repository",
): ReleaseCommandResult {
  const result = spawnSync(command, args, {
    cwd: scope === "isolated" ? ISOLATED_GIT_CWD : root,
    encoding: "utf8",
    env: createReleaseCommandEnvironment(command, scope),
    maxBuffer: 10 * 1024 * 1024,
    timeout: 45_000,
  });
  if (result.error) throw result.error;
  if (result.signal !== null) {
    throw new Error(`${command} command was terminated by ${result.signal}`);
  }
  if (result.status === null) {
    throw new Error(`${command} command returned no exit status`);
  }
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function requireCommandSuccess(
  runCommand: ReleaseCommandRunner,
  command: "gh" | "git",
  args: readonly string[],
  label: string,
  scope: "isolated" | "repository" = "repository",
): string {
  const result = runCommand(command, args, scope);
  if (result.status !== 0) {
    throw new Error(`${label} failed (${command} exit ${result.status})`);
  }
  return result.stdout.trim();
}

function parseGithubJson(schema: z.ZodType, value: string, label: string): unknown {
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${label} did not match the required GitHub API schema`);
  }
  return parsed.data;
}

function readGithubJson<T>(
  runCommand: ReleaseCommandRunner,
  endpoint: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  const stdout = requireCommandSuccess(
    runCommand,
    "gh",
    [
      "api",
      "--hostname",
      "github.com",
      "--method",
      "GET",
      endpoint,
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      `X-GitHub-Api-Version: ${GITHUB_API_VERSION}`,
    ],
    label,
  );
  return parseGithubJson(schema, stdout, label) as T;
}

function requireOneCanonicalUrl(value: string, label: string): AllowedOriginUrl {
  const urls = value.split("\n").filter((url) => url.length > 0);
  if (urls.length !== 1 || !allowedOriginUrls.has(urls[0]!)) {
    throw new Error(`${label} must contain exactly one canonical repository URL`);
  }
  return urls[0] as AllowedOriginUrl;
}

function requireExactCommit(value: string, expected: string, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} does not equal the requested release commit`);
  }
}

function requireCompletePage<T extends { id: number }>(
  items: readonly T[],
  totalCount: number,
  label: string,
): void {
  if (
    totalCount > MAX_API_ITEMS ||
    items.length > MAX_API_ITEMS ||
    totalCount !== items.length
  ) {
    throw new Error(`${label} was truncated or has an inconsistent total_count`);
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error(`${label} contains duplicate IDs`);
  }
}

function newestWorkflowRun(
  runs: readonly z.infer<typeof workflowRunSchema>[],
): z.infer<typeof workflowRunSchema> {
  const newest = [...runs].sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  )[0];
  if (!newest) {
    throw new Error("No push CI workflow run exists for the requested release commit");
  }
  if (
    runs.some(
      (run) =>
        run.id !== newest.id &&
        Date.parse(run.created_at) === Date.parse(newest.created_at),
    )
  ) {
    throw new Error(
      "The newest GitHub CI workflow run is ambiguous because created_at is tied",
    );
  }
  return newest;
}

function workflowRunsFingerprint(
  runs: readonly z.infer<typeof workflowRunSchema>[],
): string {
  return JSON.stringify(
    [...runs]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((run) => ({
        conclusion: run.conclusion,
        createdAt: run.created_at,
        event: run.event,
        headBranch: run.head_branch,
        headCommit: run.head_commit.id,
        headRepository: run.head_repository?.full_name ?? null,
        headSha: run.head_sha,
        htmlUrl: run.html_url,
        id: run.id,
        name: run.name,
        path: run.path,
        repository: run.repository.full_name,
        runAttempt: run.run_attempt,
        status: run.status,
        updatedAt: run.updated_at,
        url: run.url,
        workflowId: run.workflow_id,
      })),
  );
}

function requireValidTimestamp(now: () => Date): string {
  const timestamp = now();
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Release authorization clock returned an invalid timestamp");
  }
  return timestamp.toISOString();
}

export function verifyReleaseAuthorizationWithRunner(input: {
  expectedCommit: string;
  now?: () => Date;
  repositoryRoot: string;
  runCommand: ReleaseCommandRunner;
}): ReleaseAuthorization {
  const parsedCommit = commitSchema.safeParse(input.expectedCommit);
  if (!parsedCommit.success) {
    throw new Error(
      "Release commit must be one 40-character lowercase Git SHA",
    );
  }
  const expectedCommit = parsedCommit.data;
  const root = realpathSync(input.repositoryRoot);
  const runCommand = input.runCommand;

  const actualRoot = requireCommandSuccess(
    runCommand,
    "git",
    ["rev-parse", "--show-toplevel"],
    "Repository root readback",
  );
  if (realpathSync(actualRoot) !== root) {
    throw new Error("Release authorization is not running in the expected repository");
  }

  const status = requireCommandSuccess(
    runCommand,
    "git",
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ],
    "Repository cleanliness readback",
  );
  if (status.length > 0) {
    throw new Error("Release authorization requires a completely clean worktree");
  }

  const branchRef = requireCommandSuccess(
    runCommand,
    "git",
    ["symbolic-ref", "--quiet", "HEAD"],
    "Release branch readback",
  );
  if (branchRef !== RELEASE_BRANCH_REF) {
    throw new Error(`Release authorization requires ${RELEASE_BRANCH_REF}`);
  }

  const headCommit = requireCommandSuccess(
    runCommand,
    "git",
    ["rev-parse", "--verify", "HEAD^{commit}"],
    "HEAD readback",
  );
  requireExactCommit(headCommit, expectedCommit, "HEAD");

  const committedAuthorizationBlob = requireCommandSuccess(
    runCommand,
    "git",
    [
      "rev-parse",
      "--verify",
      `HEAD:${RELEASE_AUTHORIZATION_SCRIPT}`,
    ],
    "Committed release authorization verifier readback",
  );
  const worktreeAuthorizationBlob = requireCommandSuccess(
    runCommand,
    "git",
    ["hash-object", "--no-filters", RELEASE_AUTHORIZATION_SCRIPT],
    "Worktree release authorization verifier readback",
  );
  if (committedAuthorizationBlob !== worktreeAuthorizationBlob) {
    throw new Error(
      "The executing release authorization verifier differs from the release commit",
    );
  }

  const remoteTrackingCommit = requireCommandSuccess(
    runCommand,
    "git",
    ["rev-parse", "--verify", `${RELEASE_REMOTE_TRACKING_REF}^{commit}`],
    "Local origin/master readback",
  );
  requireExactCommit(
    remoteTrackingCommit,
    expectedCommit,
    "Local origin/master",
  );

  const fetchUrl = requireOneCanonicalUrl(
    requireCommandSuccess(
      runCommand,
      "git",
      ["remote", "get-url", "--all", "origin"],
      "Origin fetch URL readback",
    ),
    "Origin fetch URL",
  );
  const pushUrl = requireOneCanonicalUrl(
    requireCommandSuccess(
      runCommand,
      "git",
      ["remote", "get-url", "--push", "--all", "origin"],
      "Origin push URL readback",
    ),
    "Origin push URL",
  );
  if (fetchUrl !== pushUrl) {
    throw new Error("Origin fetch and push URLs must be identical");
  }

  const remoteReadback = requireCommandSuccess(
    runCommand,
    "git",
    ["ls-remote", "--exit-code", "--refs", fetchUrl, RELEASE_BRANCH_REF],
    "Fresh origin/master readback",
    "isolated",
  );
  const remoteLines = remoteReadback.split("\n").filter((line) => line.length > 0);
  const expectedRemoteLine = `${expectedCommit}\t${RELEASE_BRANCH_REF}`;
  if (remoteLines.length !== 1 || remoteLines[0] !== expectedRemoteLine) {
    throw new Error("Fresh origin/master readback was not one exact release ref");
  }

  const githubRef = readGithubJson(
    runCommand,
    `repos/${RELEASE_REPOSITORY}/git/ref/heads/${RELEASE_BRANCH}`,
    githubRefSchema,
    "GitHub master ref readback",
  );
  if (
    githubRef.ref !== RELEASE_BRANCH_REF ||
    githubRef.object.type !== "commit" ||
    githubRef.object.sha !== expectedCommit ||
    githubRef.url !== `${GITHUB_API_ROOT}/git/refs/heads/${RELEASE_BRANCH}` ||
    githubRef.object.url !== `${GITHUB_API_ROOT}/git/commits/${expectedCommit}`
  ) {
    throw new Error("GitHub master ref is not the requested release commit");
  }

  const workflow = readGithubJson(
    runCommand,
    `repos/${RELEASE_REPOSITORY}/actions/workflows/${RELEASE_WORKFLOW_FILE}`,
    workflowSchema,
    "GitHub CI workflow identity readback",
  );
  if (
    workflow.name !== RELEASE_WORKFLOW_NAME ||
    workflow.path !== RELEASE_WORKFLOW_PATH ||
    workflow.state !== "active" ||
    workflow.url !== `${GITHUB_API_ROOT}/actions/workflows/${workflow.id}` ||
    workflow.html_url !==
      `${GITHUB_WEB_ROOT}/blob/${RELEASE_BRANCH}/${RELEASE_WORKFLOW_PATH}`
  ) {
    throw new Error("GitHub CI workflow identity or state drifted");
  }

  const protection = readGithubJson(
    runCommand,
    `repos/${RELEASE_REPOSITORY}/branches/${RELEASE_BRANCH}/protection`,
    branchProtectionSchema,
    "GitHub master branch protection readback",
  );
  const requiredChecks = protection.required_status_checks;
  if (
    !requiredChecks.strict ||
    requiredChecks.contexts.length !== 1 ||
    requiredChecks.contexts[0] !== REQUIRED_GATE_NAME ||
    requiredChecks.checks.length !== 1 ||
    requiredChecks.checks[0]?.context !== REQUIRED_GATE_NAME ||
    requiredChecks.checks[0]?.app_id !== null ||
    !protection.enforce_admins.enabled ||
    protection.allow_force_pushes.enabled ||
    protection.allow_deletions.enabled
  ) {
    throw new Error("GitHub master branch protection drifted from the release contract");
  }

  const workflowRunsEndpoint =
    `repos/${RELEASE_REPOSITORY}/actions/workflows/${workflow.id}/runs` +
    `?branch=${RELEASE_BRANCH}&event=push&head_sha=${expectedCommit}` +
    `&per_page=${MAX_API_ITEMS}`;
  const workflowRuns = readGithubJson(
    runCommand,
    workflowRunsEndpoint,
    workflowRunsSchema,
    "GitHub CI workflow runs readback",
  );
  requireCompletePage(
    workflowRuns.workflow_runs,
    workflowRuns.total_count,
    "GitHub CI workflow runs",
  );
  for (const run of workflowRuns.workflow_runs) {
    if (
      run.workflow_id !== workflow.id ||
      run.name !== RELEASE_WORKFLOW_NAME ||
      run.path !== RELEASE_WORKFLOW_PATH ||
      run.event !== "push" ||
      run.head_branch !== RELEASE_BRANCH ||
      run.head_sha !== expectedCommit ||
      run.head_commit.id !== expectedCommit ||
      run.repository.full_name !== RELEASE_REPOSITORY ||
      run.head_repository?.full_name !== RELEASE_REPOSITORY ||
      run.url !== `${GITHUB_API_ROOT}/actions/runs/${run.id}` ||
      run.html_url !== `${GITHUB_WEB_ROOT}/actions/runs/${run.id}`
    ) {
      throw new Error("A GitHub CI workflow run has invalid release provenance");
    }
  }
  const selectedRun = newestWorkflowRun(workflowRuns.workflow_runs);
  if (selectedRun.status !== "completed" || selectedRun.conclusion !== "success") {
    throw new Error("The newest GitHub CI workflow run is not successfully completed");
  }

  const workflowJobs = readGithubJson(
    runCommand,
    `repos/${RELEASE_REPOSITORY}/actions/runs/${selectedRun.id}` +
      `/attempts/${selectedRun.run_attempt}/jobs?per_page=${MAX_API_ITEMS}`,
    workflowJobsSchema,
    "GitHub CI workflow jobs readback",
  );
  requireCompletePage(
    workflowJobs.jobs,
    workflowJobs.total_count,
    "GitHub CI workflow jobs",
  );
  for (const job of workflowJobs.jobs) {
    if (
      job.run_id !== selectedRun.id ||
      job.run_attempt !== selectedRun.run_attempt ||
      job.head_sha !== expectedCommit ||
      job.run_url !== `${GITHUB_API_ROOT}/actions/runs/${selectedRun.id}` ||
      job.url !== `${GITHUB_API_ROOT}/actions/jobs/${job.id}` ||
      job.html_url !==
        `${GITHUB_WEB_ROOT}/actions/runs/${selectedRun.id}/job/${job.id}`
    ) {
      throw new Error("A GitHub CI workflow job has invalid release provenance");
    }
  }
  const gateJobs = workflowJobs.jobs.filter(
    (job) => job.name === REQUIRED_GATE_NAME,
  );
  if (gateJobs.length !== 1) {
    throw new Error("The selected CI attempt must contain exactly one Required CI gate job");
  }
  const gateJob = gateJobs[0]!;
  if (gateJob.status !== "completed" || gateJob.conclusion !== "success") {
    throw new Error("The Required CI gate job is not successfully completed");
  }

  const finalWorkflowRuns = readGithubJson(
    runCommand,
    workflowRunsEndpoint,
    workflowRunsSchema,
    "Final GitHub CI workflow runs readback",
  );
  requireCompletePage(
    finalWorkflowRuns.workflow_runs,
    finalWorkflowRuns.total_count,
    "Final GitHub CI workflow runs",
  );
  if (
    workflowRunsFingerprint(finalWorkflowRuns.workflow_runs) !==
    workflowRunsFingerprint(workflowRuns.workflow_runs)
  ) {
    throw new Error(
      "GitHub CI workflow run state changed during release authorization",
    );
  }

  const finalGithubRef = readGithubJson(
    runCommand,
    `repos/${RELEASE_REPOSITORY}/git/ref/heads/${RELEASE_BRANCH}`,
    githubRefSchema,
    "Final GitHub master ref readback",
  );
  if (
    finalGithubRef.ref !== RELEASE_BRANCH_REF ||
    finalGithubRef.object.type !== "commit" ||
    finalGithubRef.object.sha !== expectedCommit ||
    finalGithubRef.url !==
      `${GITHUB_API_ROOT}/git/refs/heads/${RELEASE_BRANCH}` ||
    finalGithubRef.object.url !==
      `${GITHUB_API_ROOT}/git/commits/${expectedCommit}`
  ) {
    throw new Error(
      "GitHub master ref changed during release authorization",
    );
  }

  const finalWorkflow = readGithubJson(
    runCommand,
    `repos/${RELEASE_REPOSITORY}/actions/workflows/${RELEASE_WORKFLOW_FILE}`,
    workflowSchema,
    "Final GitHub CI workflow identity readback",
  );
  if (
    finalWorkflow.id !== workflow.id ||
    finalWorkflow.name !== RELEASE_WORKFLOW_NAME ||
    finalWorkflow.path !== RELEASE_WORKFLOW_PATH ||
    finalWorkflow.state !== "active" ||
    finalWorkflow.url !== `${GITHUB_API_ROOT}/actions/workflows/${workflow.id}` ||
    finalWorkflow.html_url !==
      `${GITHUB_WEB_ROOT}/blob/${RELEASE_BRANCH}/${RELEASE_WORKFLOW_PATH}`
  ) {
    throw new Error(
      "GitHub CI workflow identity changed during release authorization",
    );
  }

  const finalProtection = readGithubJson(
    runCommand,
    `repos/${RELEASE_REPOSITORY}/branches/${RELEASE_BRANCH}/protection`,
    branchProtectionSchema,
    "Final GitHub master branch protection readback",
  );
  const finalRequiredChecks = finalProtection.required_status_checks;
  if (
    !finalRequiredChecks.strict ||
    finalRequiredChecks.contexts.length !== 1 ||
    finalRequiredChecks.contexts[0] !== REQUIRED_GATE_NAME ||
    finalRequiredChecks.checks.length !== 1 ||
    finalRequiredChecks.checks[0]?.context !== REQUIRED_GATE_NAME ||
    finalRequiredChecks.checks[0]?.app_id !== null ||
    !finalProtection.enforce_admins.enabled ||
    finalProtection.allow_force_pushes.enabled ||
    finalProtection.allow_deletions.enabled
  ) {
    throw new Error(
      "GitHub master branch protection changed during release authorization",
    );
  }

  const finalStatus = requireCommandSuccess(
    runCommand,
    "git",
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ],
    "Final repository cleanliness readback",
  );
  const finalBranchRef = requireCommandSuccess(
    runCommand,
    "git",
    ["symbolic-ref", "--quiet", "HEAD"],
    "Final release branch readback",
  );
  const finalHeadCommit = requireCommandSuccess(
    runCommand,
    "git",
    ["rev-parse", "--verify", "HEAD^{commit}"],
    "Final HEAD readback",
  );
  const finalRemoteTrackingCommit = requireCommandSuccess(
    runCommand,
    "git",
    ["rev-parse", "--verify", `${RELEASE_REMOTE_TRACKING_REF}^{commit}`],
    "Final local origin/master readback",
  );
  const finalFetchUrl = requireOneCanonicalUrl(
    requireCommandSuccess(
      runCommand,
      "git",
      ["remote", "get-url", "--all", "origin"],
      "Final origin fetch URL readback",
    ),
    "Final origin fetch URL",
  );
  const finalPushUrl = requireOneCanonicalUrl(
    requireCommandSuccess(
      runCommand,
      "git",
      ["remote", "get-url", "--push", "--all", "origin"],
      "Final origin push URL readback",
    ),
    "Final origin push URL",
  );
  const finalRemoteReadback = requireCommandSuccess(
    runCommand,
    "git",
    ["ls-remote", "--exit-code", "--refs", fetchUrl, RELEASE_BRANCH_REF],
    "Final fresh origin/master readback",
    "isolated",
  );
  const finalWorktreeAuthorizationBlob = requireCommandSuccess(
    runCommand,
    "git",
    ["hash-object", "--no-filters", RELEASE_AUTHORIZATION_SCRIPT],
    "Final worktree release authorization verifier readback",
  );
  if (
    finalStatus.length > 0 ||
    finalBranchRef !== RELEASE_BRANCH_REF ||
    finalHeadCommit !== expectedCommit ||
    finalRemoteTrackingCommit !== expectedCommit ||
    finalFetchUrl !== fetchUrl ||
    finalPushUrl !== pushUrl ||
    finalRemoteReadback !== expectedRemoteLine ||
    finalWorktreeAuthorizationBlob !== committedAuthorizationBlob
  ) {
    throw new Error(
      "Local release state changed during release authorization",
    );
  }

  return {
    branch: RELEASE_BRANCH,
    commit: expectedCommit,
    format: "diesel-release-authorization-v1",
    origin: {
      fetchUrl,
      pushUrl,
      remoteMaster: remoteTrackingCommit,
      remoteMasterReadback: expectedCommit,
    },
    protection: {
      allowDeletions: false,
      allowForcePushes: false,
      enforceAdmins: true,
      requiredCheck: REQUIRED_GATE_NAME,
      requiredCheckAppId: null,
      strict: true,
    },
    repository: RELEASE_REPOSITORY,
    verifiedAt: requireValidTimestamp(input.now ?? (() => new Date())),
    workflow: {
      gateJobId: gateJob.id,
      gateJobUrl: gateJob.html_url,
      id: workflow.id,
      name: RELEASE_WORKFLOW_NAME,
      path: RELEASE_WORKFLOW_PATH,
      runAttempt: selectedRun.run_attempt,
      runId: selectedRun.id,
      runUrl: selectedRun.html_url,
      state: "active",
    },
  };
}

export function verifyReleaseAuthorization(
  expectedCommit: string,
  repositoryRoot = process.cwd(),
): ReleaseAuthorization {
  return verifyReleaseAuthorizationWithRunner({
    expectedCommit,
    repositoryRoot,
    runCommand: (command, args, scope) =>
      runCommandAtRoot(repositoryRoot, command, args, scope),
  });
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(resolve(process.argv[1])) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

async function readBoundedStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > 65_536) {
      throw new Error("Release authorization output exceeds 64 KiB");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  if (args[0] === "validate-output") {
    if (args.length !== 2) {
      throw new Error(
        "Usage: verify-release-authorization.ts validate-output <40-character release commit>",
      );
    }
    const authorization = parseReleaseAuthorizationOutput(
      await readBoundedStandardInput(),
      args[1]!,
    );
    process.stdout.write(
      `Release authorization output validated for ${authorization.commit}.\n`,
    );
    return;
  }
  if (args.length !== 1) {
    throw new Error(
      "Usage: pnpm release:authorize -- <40-character release commit>",
    );
  }
  const authorization = verifyReleaseAuthorization(args[0]!);
  process.stdout.write(`${JSON.stringify(authorization, null, 2)}\n`);
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
