import { spawnSync } from "node:child_process";
import { accessSync, constants, lstatSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

export const portfolioCiTrustedGitExecutable = "/usr/bin/git" as const;
export const portfolioTrustedGitEnvironmentVariable =
  "PORTFOLIO_TRUSTED_GIT" as const;

const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

export type TrustedGitRawResult = Readonly<{
  status: number | null;
  stderr: Buffer;
  stdout: Buffer;
}>;

export type ResolvePortfolioTrustedGitExecutableInput = Readonly<{
  configuredGitExecutable?: string;
  githubActions: boolean;
  /** Explicit code-level local override; environment values are never used locally. */
  localGitExecutable?: string;
  releaseEvidenceMode: boolean;
}>;

export function assertTrustedGitExecutable(executable: string): string {
  if (
    executable.length === 0 ||
    executable.includes("\0") ||
    /[\u0000-\u001f\u007f]/u.test(executable) ||
    !isAbsolute(executable) ||
    normalize(executable) !== executable
  ) {
    throw new Error("Trusted Git executable must be a normalized absolute path.");
  }

  let metadata: ReturnType<typeof lstatSync>;
  try {
    metadata = lstatSync(executable);
    accessSync(executable, constants.X_OK);
  } catch (cause: unknown) {
    throw new Error(`Trusted Git executable is missing or not executable: ${executable}`, {
      cause,
    });
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(
      `Trusted Git executable must be a regular non-symlink file: ${executable}`,
    );
  }
  return executable;
}

/**
 * GitHub release evidence has one canonical executable. Local callers may
 * explicitly trust another absolute executable through a function argument,
 * but never through process environment state.
 */
export function resolvePortfolioTrustedGitExecutable({
  configuredGitExecutable,
  githubActions,
  localGitExecutable,
  releaseEvidenceMode,
}: ResolvePortfolioTrustedGitExecutableInput): string {
  if (githubActions && releaseEvidenceMode) {
    if (configuredGitExecutable !== portfolioCiTrustedGitExecutable) {
      throw new Error(
        `GitHub release evidence requires ${portfolioTrustedGitEnvironmentVariable}=${portfolioCiTrustedGitExecutable}.`,
      );
    }
    return assertTrustedGitExecutable(portfolioCiTrustedGitExecutable);
  }
  return assertTrustedGitExecutable(
    localGitExecutable ?? portfolioCiTrustedGitExecutable,
  );
}

/** Removes Git and dynamic-loader controls before adding the fixed policy. */
export function createTrustedGitEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(source)) {
    if (
      !key.startsWith("GIT_") &&
      !key.startsWith("LD_") &&
      !key.startsWith("DYLD_") &&
      value !== undefined
    ) {
      environment[key] = value;
    }
  }
  environment.GIT_ATTR_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_LITERAL_PATHSPECS = "1";
  environment.GIT_NO_LAZY_FETCH = "1";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.NO_COLOR = "1";
  environment.PATH = "/usr/bin:/bin";
  return environment;
}

export function runTrustedGitRaw(
  workspace: string,
  args: readonly string[],
  executable: string = portfolioCiTrustedGitExecutable,
): TrustedGitRawResult {
  const trustedExecutable = assertTrustedGitExecutable(executable);
  const result = spawnSync(trustedExecutable, [
    "--no-pager",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    ...args,
  ], {
    cwd: workspace,
    encoding: "buffer",
    env: createTrustedGitEnvironment(),
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    shell: false,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
  };
}

function gitFailureMessage(
  args: readonly string[],
  result: TrustedGitRawResult,
): string {
  const diagnostics = [result.stderr, result.stdout]
    .map((value) => value.toString("utf8").trim())
    .filter((value) => value.length > 0)
    .join("\n");
  return `git ${args.join(" ")} failed with exit status ${result.status ?? "unknown"}` +
    `${diagnostics.length > 0 ? `:\n${diagnostics}` : "."}`;
}

export function runTrustedGit(
  workspace: string,
  args: readonly string[],
  executable: string = portfolioCiTrustedGitExecutable,
): Buffer {
  const result = runTrustedGitRaw(workspace, args, executable);
  if (result.status !== 0) throw new Error(gitFailureMessage(args, result));
  return result.stdout;
}

export function runTrustedGitTextResult(
  args: readonly string[],
  workspace: string,
  executable: string = portfolioCiTrustedGitExecutable,
): { ok: boolean; stdout: string } {
  const result = runTrustedGitRaw(workspace, args, executable);
  return {
    ok: result.status === 0,
    stdout: result.stdout.toString("utf8"),
  };
}

export function runTrustedGitBinaryResult(
  args: readonly string[],
  workspace: string,
  executable: string = portfolioCiTrustedGitExecutable,
): { ok: boolean; stdout: Buffer } {
  const result = runTrustedGitRaw(workspace, args, executable);
  return { ok: result.status === 0, stdout: result.stdout };
}
