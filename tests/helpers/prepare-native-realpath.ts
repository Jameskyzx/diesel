import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type CommandResult = { code: number | null; stdout: string };
type CommandRunner = (
  file: string,
  args: string[],
) => Promise<CommandResult>;

async function runCommand(file: string, args: string[]): Promise<CommandResult> {
  try {
    const result = await execFileAsync(file, args);
    return { code: 0, stdout: result.stdout };
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && "stdout" in error) {
      return {
        code: typeof error.code === "number" ? error.code : null,
        stdout: typeof error.stdout === "string" ? error.stdout : "",
      };
    }
    return { code: null, stdout: "" };
  }
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Test-only command selection; no resolved fixture paths are cached or replayed. */
export async function createPrepareRealpathShim(
  lifecycleLock: string,
  probeDirectory: string,
  options: {
    fd8LogPath?: string;
    platform?: NodeJS.Platform;
    runCommand?: CommandRunner;
  } = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const candidate = platform === "darwin"
    ? { file: "/bin/realpath", args: ["--"] }
    : platform === "linux"
      ? { file: "/usr/bin/realpath", args: ["-e", "--"] }
      : undefined;
  const nodeCommand = `${quoteShell(process.execPath)} -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1])+"\\n")'`;
  const fd8LogCommand = options.fd8LogPath === undefined
    ? ""
    : `  printf 'realpath-fd8\\n' >>${quoteShell(options.fd8LogPath)}\n`;
  let nativeCommand: string | undefined;

  if (candidate) {
    const run = options.runCommand ?? runCommand;
    const canonicalDirectory = await realpath(probeDirectory);
    const missingLeaf = join(canonicalDirectory, `.realpath-probe-${randomUUID()}`);
    // GNU's default permits a missing last component. Verify strict existence
    // before selecting a native backend; BSD and GNU intentionally use different flags.
    try {
      const existing = await run(candidate.file, [...candidate.args, probeDirectory]);
      const missing = await run(candidate.file, [...candidate.args, missingLeaf]);
      if (
        existing.code === 0 && existing.stdout === `${canonicalDirectory}\n`
        && missing.code === 1 && missing.stdout === ""
      ) {
        nativeCommand = [candidate.file, ...candidate.args].map(quoteShell).join(" ");
      }
    } catch {
      // An unavailable or incompatible native command keeps the original Node behavior.
    }
  }

  return `#!/bin/bash
set -euo pipefail
path="\${!#}"
if [[ "$path" == /proc/*/fd/8 ]]; then
  printf '%s\\n' ${quoteShell(lifecycleLock)}
${fd8LogCommand}${nativeCommand ? `# Node normalizes before resolving links; native realpath need not do so.
# Only an unchanged, fresh canonical absolute result can bypass Node.
elif [[ "$path" == /* && "$path" != */ && "$path" != *//*
        && "/$path/" != */./* && "/$path/" != */../* ]] \\
  && native_path="$(${nativeCommand} "$path" 2>/dev/null)" \\
  && [[ "$native_path" == "$path" ]]; then
  printf '%s\\n' "$native_path"
` : ""}\
else
  exec ${nodeCommand} "$path"
fi
`;
}
