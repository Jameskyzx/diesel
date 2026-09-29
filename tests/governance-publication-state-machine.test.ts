import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createFixtureSha256sumShim } from "./helpers/fixture-sha256sum";
import { createPrepareRealpathShim } from "./helpers/prepare-native-realpath";
import { createPublicationStatShim } from "./helpers/publication-stat-shim";

const execFileAsync = promisify(execFile);
const publicationStateMachineScript = resolve(
  process.cwd(),
  "scripts/deploy/governance-publication-state-machine.sh",
);
const hostActivationLedgerScript = resolve(
  process.cwd(),
  "scripts/deploy/host-activation-ledger.sh",
);
const RELEASE_ID = "a".repeat(40);
const HISTORICAL_RELEASE_ID = "d".repeat(40);
const LEGACY_RELEASE_ID = "20260812031745";
const SNAPSHOT = '{"tableCounts":{"countries":1},"tables":{"countries":[]}}\n';

type PublicationMode =
  | "finalize-committed"
  | "publish"
  | "recover-required";

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type PublicationFixture = {
  backupRoot: string;
  commitMarker: string;
  completedHostRollbackMarker: string;
  currentLink: string;
  deployRoot: string;
  fakePath: string;
  finalizedMarker: string;
  hostActivationAnchor: string;
  hostActivationCommitted: string;
  hostActivationPending: string;
  hostActivationRolledBack: string;
  hostRollbackMarker: string;
  lifecycleLock: string;
  lifecycleLogPath: string;
  liveEnvironment: string;
  logPath: string;
  previousRelease: string;
  protocolManifest: string;
  recoveryMarker: string;
  releaseDir: string;
  root: string;
  snapshotPath: string;
  environmentBackup: string;
};

const fixtureRoots = new Set<string>();

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function writeExecutable(path: string, source: string): Promise<void> {
  await writeFile(path, source, "utf8");
  await chmod(path, 0o755);
}

async function execute(
  file: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(file, args, {
      cwd: options?.cwd,
      env: options?.env,
    });
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

async function createPublicationFixture(): Promise<PublicationFixture> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "diesel-governance-publication-")),
  );
  fixtureRoots.add(root);
  const deployRoot = join(root, "deploy");
  const releaseRoot = join(deployRoot, "releases");
  const releaseDir = join(releaseRoot, RELEASE_ID);
  const backupRoot = join(deployRoot, "backups");
  const stateDir = join(backupRoot, RELEASE_ID);
  const protocolManifest = join(backupRoot, "HOST_ACTIVATION_PROTOCOL_V1");
  const hostActivationAnchor = join(stateDir, "HOST_ACTIVATION_V1");
  const hostActivationPending = join(stateDir, "HOST_ACTIVATION_PENDING");
  const hostActivationRolledBack = join(
    stateDir,
    "HOST_ACTIVATION_ROLLED_BACK",
  );
  const hostActivationCommitted = join(
    stateDir,
    "HOST_ACTIVATION_COMMITTED",
  );
  const fakeBin = join(root, "fake-bin");
  const fakeFindProgram = join(root, "fake-find.mjs");
  const lifecycleLock = join(deployRoot, ".release-lifecycle.lock");
  const lifecycleLogPath = join(root, "lifecycle.log");
  const logPath = join(root, "operations.log");
  const snapshotPath = join(stateDir, "governance-before.json");
  const sharedRoot = join(deployRoot, "shared");
  const liveEnvironment = join(sharedRoot, ".env.production.local");
  const environmentBackup = join(
    stateDir,
    "env.production.local.pre-switch",
  );
  const recoveryMarker = join(stateDir, "RECOVERY_REQUIRED");
  const hostRollbackMarker = join(stateDir, "HOST_ROLLBACK_REQUIRED");
  const completedHostRollbackMarker = join(
    stateDir,
    "HOST_ROLLBACK_COMPLETED",
  );
  const commitMarker = join(stateDir, "PUBLISH_COMMITTED");
  const finalizedMarker = join(stateDir, "PUBLISH_FINALIZED");
  const currentLink = join(deployRoot, "current");
  const previousRelease = join(releaseRoot, LEGACY_RELEASE_ID);

  await Promise.all([
    mkdir(join(releaseDir, "scripts", "db"), { recursive: true }),
    mkdir(join(releaseDir, "scripts", "deploy"), { recursive: true }),
    mkdir(join(previousRelease, "scripts", "deploy"), { recursive: true }),
    mkdir(stateDir, { recursive: true }),
    mkdir(sharedRoot, { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);
  await Promise.all([
    chmod(deployRoot, 0o755),
    chmod(releaseRoot, 0o755),
    chmod(releaseDir, 0o750),
    chmod(previousRelease, 0o750),
    chmod(backupRoot, 0o700),
    chmod(stateDir, 0o700),
    chmod(sharedRoot, 0o750),
  ]);
  await symlink(releaseDir, currentLink);
  await Promise.all([
    writeFile(lifecycleLock, "", "utf8").then(() =>
      chmod(lifecycleLock, 0o600),
    ),
    writeFile(join(stateDir, "previous-release"), `${previousRelease}\n`, "utf8").then(
      () => chmod(join(stateDir, "previous-release"), 0o600),
    ),
    writeFile(
      environmentBackup,
      "DATABASE_URL=postgresql://fixture:fixture@database.invalid/diesel\n",
      "utf8",
    ).then(() => chmod(environmentBackup, 0o600)),
    writeFile(
      liveEnvironment,
      "DATABASE_URL=postgresql://fixture:fixture@database.invalid/diesel\n",
      "utf8",
    ).then(() => chmod(liveEnvironment, 0o640)),
    ...["jamesky.site.pre-switch", "diesel-demo.pre-switch"].map((filename) =>
      writeFile(join(stateDir, filename), `${filename}\n`, "utf8").then(() =>
        chmod(join(stateDir, filename), 0o600),
      ),
    ),
    writeFile(join(releaseDir, ".deploy-ready"), "ready\n", "utf8").then(
      () => chmod(join(releaseDir, ".deploy-ready"), 0o640),
    ),
    writeFile(
      join(
        releaseDir,
        "scripts",
        "db",
        "assert-governance-maintenance-lock.ts",
      ),
      "// fixture\n",
      "utf8",
    ).then(() =>
      chmod(
        join(
          releaseDir,
          "scripts",
          "db",
          "assert-governance-maintenance-lock.ts",
        ),
        0o640,
      ),
    ),
    writeFile(
      join(releaseDir, "scripts", "db", "export-governance-snapshot.ts"),
      "// fixture\n",
      "utf8",
    ).then(() =>
      chmod(
        join(releaseDir, "scripts", "db", "export-governance-snapshot.ts"),
        0o640,
      ),
    ),
    writeFile(
      join(releaseDir, "scripts", "db", "restore-governance-snapshot.ts"),
      "// fixture\n",
      "utf8",
    ).then(() =>
      chmod(
        join(releaseDir, "scripts", "db", "restore-governance-snapshot.ts"),
        0o640,
      ),
    ),
    writeFile(
      join(previousRelease, ".deploy-ready"),
      "legacy-ready\n",
      "utf8",
    ).then(() => chmod(join(previousRelease, ".deploy-ready"), 0o640)),
  ]);

  const versionedHostActivationLedger = join(
    releaseDir,
    "scripts",
    "deploy",
    "host-activation-ledger.sh",
  );
  await copyFile(hostActivationLedgerScript, versionedHostActivationLedger);
  await chmod(versionedHostActivationLedger, 0o750);
  const hashPath = async (path: string): Promise<string> =>
    createHash("sha256").update(await readFile(path)).digest("hex");
  const previousReleaseState = join(stateDir, "previous-release");
  const nginxPrimaryBackup = join(stateDir, "jamesky.site.pre-switch");
  const nginxAlternateBackup = join(stateDir, "diesel-demo.pre-switch");
  const anchorPayload = [
    `${RELEASE_ID}\t${previousRelease}`,
    `${await hashPath(previousReleaseState)}\t${previousReleaseState}`,
    `${await hashPath(environmentBackup)}\t${environmentBackup}`,
    `${await hashPath(nginxPrimaryBackup)}\t${nginxPrimaryBackup}`,
    `${await hashPath(nginxAlternateBackup)}\t${nginxAlternateBackup}`,
  ].join("\n");
  await Promise.all([
    writeFile(
      protocolManifest,
      `HOST_ACTIVATION_PROTOCOL_V1\t1\t${RELEASE_ID}\n`,
      "utf8",
    ).then(() => chmod(protocolManifest, 0o600)),
    writeFile(hostActivationAnchor, `${anchorPayload}\n`, "utf8").then(() =>
      chmod(hostActivationAnchor, 0o600),
    ),
  ]);
  await writeFile(
    hostActivationPending,
    `${await hashPath(hostActivationAnchor)}\t${hostActivationAnchor}\n`,
    "utf8",
  );
  await chmod(hostActivationPending, 0o600);

  const quotedLog = quoteShell(logPath);
  const quotedLifecycleLog = quoteShell(lifecycleLogPath);
  const quotedSnapshot = quoteShell(SNAPSHOT);
  const quotedNode = quoteShell(process.execPath);

  await writeExecutable(
    join(releaseDir, "scripts", "deploy", "publish-governance-country-fixtures.sh"),
    `#!/usr/bin/env bash
if [[ "\${BASH_SOURCE[0]}" == "$0" ]]; then exit 64; fi
publish_governance_country_fixtures_for_root() {
  printf 'queue:%s:%s\\n' "$1" "$2" >>${quotedLog}
  fault=''
  if [[ -f ${quoteShell(join(root, "fault"))} ]]; then fault="$(<${quoteShell(join(root, "fault"))})"; fi
  case "$fault" in
    queue) return 81 ;;
    queue-term) kill -TERM "$$"; return 143 ;;
  esac
}
`,
  );
  await chmod(
    join(
      releaseDir,
      "scripts",
      "deploy",
      "publish-governance-country-fixtures.sh",
    ),
    0o750,
  );
  await writeExecutable(
    join(releaseDir, "scripts", "deploy", "validate-public-governance.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'validator:%s\\n' "$1" >>${quotedLog}
fault=''
if [[ -f ${quoteShell(join(root, "fault"))} ]]; then fault="$(<${quoteShell(join(root, "fault"))})"; fi
if [[ "$fault" == 'inspect-isolated-env' ]]; then
  unexpected=''
  while IFS='=' read -r name _; do
    case "$name" in HOME|PATH|PWD|SHLVL|_) ;; *) unexpected+="$name " ;; esac
  done < <(env)
  if [[ -n "\${DIESEL_GOVERNANCE_MAINTENANCE_TOKEN:-}" ||
        -n "\${GOVERNANCE_SECRET_CANARY:-}" || -n "$unexpected" ]] ||
     { true <&8; } 2>/dev/null; then
    printf 'env-leak:validator:%s\\n' "$unexpected" >>${quotedLog}
    exit 94
  fi
  printf 'env-clean:validator\\n' >>${quotedLog}
fi
if [[ "$fault" == 'finalize-current-drift' ]]; then
  /bin/rm -f ${quoteShell(join(deployRoot, "current"))}
  /bin/ln -s ${quoteShell(join(releaseRoot, LEGACY_RELEASE_ID))} ${quoteShell(join(deployRoot, "current"))}
fi
if [[ "$fault" == 'validator' ]]; then exit 82; fi
if [[ "$fault" == 'validator-term' ]]; then
  kill -TERM "$PPID"
  exit 143
fi
`,
  );
  await chmod(
    join(releaseDir, "scripts", "deploy", "validate-public-governance.sh"),
    0o750,
  );
  await writeExecutable(
    join(releaseDir, "scripts", "deploy", "rollback-host-release.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
host_marker=${quoteShell(hostRollbackMarker)}
completed_marker=${quoteShell(completedHostRollbackMarker)}
previous_release_file=${quoteShell(join(stateDir, "previous-release"))}
current_link=${quoteShell(currentLink)}
printf 'rollback:%s:%s\\n' "$1" "$2" >>${quotedLog}
if [[ -f ${quoteShell(join(root, "fault"))} ]] &&
   [[ "$(<${quoteShell(join(root, "fault"))})" == 'inspect-isolated-env' ]]; then
  unexpected=''
  while IFS='=' read -r name _; do
    case "$name" in DIESEL_RELEASE_LIFECYCLE_LOCK_FD|HOME|PATH|PWD|SHLVL|_) ;; *) unexpected+="$name " ;; esac
  done < <(env)
  if [[ -n "\${DIESEL_GOVERNANCE_MAINTENANCE_TOKEN:-}" ||
        -n "\${GOVERNANCE_SECRET_CANARY:-}" || -n "$unexpected" ||
        "\${DIESEL_RELEASE_LIFECYCLE_LOCK_FD:-}" != '8' ]] ||
     ! { true <&8; } 2>/dev/null; then
    printf 'env-leak:rollback:%s\\n' "$unexpected" >>${quotedLog}
    exit 95
  fi
  printf 'env-clean:rollback\\n' >>${quotedLog}
fi
if [[ -f ${quoteShell(join(root, "fault"))} ]] &&
   [[ "$(<${quoteShell(join(root, "fault"))})" == 'rollback-validation' ]]; then exit 83; fi
case "$2" in
  --restore-governance-host)
    if [[ -e "$host_marker" && -e "$completed_marker" ]]; then exit 70; fi
    if [[ -e "$host_marker" ]]; then
      :
    else
      exit 70
    fi
    previous_release="$(<"$previous_release_file")"
    previous_release_id="\${previous_release##*/}"
    /bin/rm -f "$current_link"
    /bin/ln -s "$previous_release" "$current_link"
    env -i HOME=/var/lib/diesel PATH="$PATH" \
      "$previous_release/scripts/deploy/verify-release.sh" \
      https://jamesky.site "$previous_release_id" 8>&-
    ;;
  --validate-committed) ;;
  *) exit 64 ;;
esac
`,
  );
  await chmod(
    join(releaseDir, "scripts", "deploy", "rollback-host-release.sh"),
    0o750,
  );
  await writeExecutable(
    join(releaseDir, "scripts", "deploy", "verify-release.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'verify:%s:%s\\n' "$1" "$2" >>${quotedLog}
fault=''
if [[ -f ${quoteShell(join(root, "fault"))} ]]; then fault="$(<${quoteShell(join(root, "fault"))})"; fi
if [[ "$fault" == 'inspect-isolated-env' ]]; then
  unexpected=''
  while IFS='=' read -r name _; do
    case "$name" in HOME|PATH|PWD|SHLVL|_) ;; *) unexpected+="$name " ;; esac
  done < <(env)
  if [[ -n "\${DIESEL_GOVERNANCE_MAINTENANCE_TOKEN:-}" ||
        -n "\${GOVERNANCE_SECRET_CANARY:-}" || -n "$unexpected" ]] ||
     { true <&8; } 2>/dev/null; then
    printf 'env-leak:verify:%s\\n' "$unexpected" >>${quotedLog}
    exit 96
  fi
  printf 'env-clean:verify\\n' >>${quotedLog}
fi
if [[ "$fault" == 'recover-current-drift' ]]; then
  /bin/rm -f ${quoteShell(join(deployRoot, "current"))}
  /bin/ln -s ${quoteShell(releaseDir)} ${quoteShell(join(deployRoot, "current"))}
fi
if [[ -f ${quoteShell(join(root, "fault"))} ]] &&
   [[ "$(<${quoteShell(join(root, "fault"))})" == 'verify' ]]; then exit 84; fi
`,
  );
  await chmod(
    join(releaseDir, "scripts", "deploy", "verify-release.sh"),
    0o750,
  );
  await copyFile(
    join(releaseDir, "scripts", "deploy", "verify-release.sh"),
    join(previousRelease, "scripts", "deploy", "verify-release.sh"),
  );
  await chmod(
    join(previousRelease, "scripts", "deploy", "verify-release.sh"),
    0o750,
  );

  await writeExecutable(
    join(fakeBin, "id"),
    `#!/usr/bin/env bash
[[ "\${1:-}" == '-u' ]]
printf '0\\n'
`,
  );
  await writeExecutable(
    join(fakeBin, "flock"),
    `#!/usr/bin/env bash
set -euo pipefail
[[ "$#" -eq 2 && "$1" == '-n' && "$2" == '8' ]]
printf 'flock:%s:%s\\n' "$1" "$2" >>${quotedLifecycleLog}
`,
  );
  await writeExecutable(
    join(fakeBin, "runuser"),
    `#!/usr/bin/env bash
set -euo pipefail
[[ "\${1:-}" == '-u' && "\${2:-}" == 'diesel' && "\${3:-}" == '--' ]]
printf 'runuser:diesel\\n' >>${quotedLifecycleLog}
shift 3
exec "$@"
`,
  );
  await writeExecutable(
    join(fakeBin, "stat"),
    createPublicationStatShim({ releaseRoot, sharedRoot, faultRoot: root }),
  );
  await writeExecutable(
    join(fakeBin, "chown"),
    `#!/usr/bin/env bash
exit 0
`,
  );
  await writeExecutable(
    join(fakeBin, "chmod"),
    `#!/usr/bin/env bash
set -euo pipefail
mode="$1"
shift
[[ "\${1:-}" != '--' ]] || shift
/bin/chmod "$mode" "$@"
`,
  );
  await writeFile(
    fakeFindProgram,
    `import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const rootIndex = args[0] === "--" ? 1 : 0;
const searchRoot = args[rootIndex];
const joined = args.join(" ");
const entries = [];
const walk = (directory) => {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const info = lstatSync(path);
    entries.push({ info, name, path });
    if (info.isDirectory() && !info.isSymbolicLink()) walk(path);
  }
};
walk(searchRoot);
const immediate = entries.filter(({ path }) => !path.slice(searchRoot.length + 1).includes("/"));
const recognized = new Set([
  "HOST_ACTIVATION_PROTOCOL_V1", "HOST_ACTIVATION_V1",
  "HOST_ACTIVATION_PENDING", "HOST_ACTIVATION_ROLLED_BACK",
  "HOST_ACTIVATION_COMMITTED", "RECOVERY_REQUIRED",
  "HOST_ROLLBACK_REQUIRED", "HOST_ROLLBACK_COMPLETED",
  "PUBLISH_COMMITTED", "PUBLISH_FINALIZED",
]);
let selected = [];
let separator = "\\n";
if (args.includes("-print0")) {
  selected = immediate.filter(({ info, name }) =>
    info.isSymbolicLink() || name.startsWith(".") ||
    name.startsWith("HOST_ACTIVATION_") || name.startsWith("HOST_ROLLBACK_") ||
    name.startsWith("PUBLISH_") || name.startsWith("RECOVERY_")
  );
  separator = "\\0";
} else if (args.includes("-printf")) {
  selected = immediate.filter(({ info }) => info.isDirectory());
  process.stdout.write(selected.map(({ name }) => name).join("\\n") + (selected.length ? "\\n" : ""));
  process.exit(0);
} else if (joined.includes("HOST_ACTIVATION_PROTOCOL_V1") && joined.includes("-type l")) {
  selected = entries.filter(({ info, name, path }) =>
    info.isSymbolicLink() || name.startsWith(".") ||
    (name === "HOST_ACTIVATION_PROTOCOL_V1" && path !== join(searchRoot, "HOST_ACTIVATION_PROTOCOL_V1")) ||
    ((name.startsWith("HOST_ACTIVATION_") || name.startsWith("HOST_ROLLBACK_") ||
      name.startsWith("PUBLISH_") || name.startsWith("RECOVERY_")) && !recognized.has(name))
  ).slice(0, 1);
} else if (joined.includes("-name RECOVERY_REQUIRED") && joined.includes("-name PUBLISH_COMMITTED") && !joined.includes("HOST_ACTIVATION_V1")) {
  selected = entries.filter(({ info, name }) => info.isSymbolicLink() ||
    name === "RECOVERY_REQUIRED" || name === "HOST_ROLLBACK_REQUIRED" ||
    name === "PUBLISH_COMMITTED");
} else if (joined.includes("-name HOST_ROLLBACK_COMPLETED") && !joined.includes("HOST_ACTIVATION_V1")) {
  selected = entries.filter(({ name }) => name === "HOST_ROLLBACK_COMPLETED");
} else if (joined.includes("-name PUBLISH_FINALIZED") && !joined.includes("HOST_ACTIVATION_V1")) {
  selected = entries.filter(({ name }) => name === "PUBLISH_FINALIZED");
} else if (joined.includes("! -name HOST_ACTIVATION_V1") && !joined.includes("HOST_ACTIVATION_PROTOCOL_V1")) {
  selected = immediate.filter(({ name }) => name.startsWith("HOST_ACTIVATION_") && !recognized.has(name)).slice(0, 1);
} else if (joined.includes("HOST_ACTIVATION_V1")) {
  selected = entries.filter(({ name }) => recognized.has(name) && name !== "HOST_ACTIVATION_PROTOCOL_V1");
} else {
  selected = entries.filter(({ name }) =>
    name.startsWith("HOST_ACTIVATION_") || name.startsWith("HOST_ROLLBACK_") ||
    name.startsWith("PUBLISH_") || name.startsWith("RECOVERY_")
  );
}
process.stdout.write(selected.map(({ path }) => path).join(separator) + (selected.length ? separator : ""));
`,
    "utf8",
  );
  await writeExecutable(
    join(fakeBin, "find"),
    `#!/usr/bin/env bash
exec ${quotedNode} ${quoteShell(fakeFindProgram)} "$@"
`,
  );
  await writeExecutable(
    join(fakeBin, "mktemp"),
    `#!/usr/bin/env bash
set -euo pipefail
directory=0
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -d) directory=1; shift ;;
    --) shift; break ;;
    -*) shift ;;
    *) break ;;
  esac
done
[[ "$#" -eq 1 ]]
path="\${1%XXXXXX}fixture-$$"
if [[ "$directory" -eq 1 ]]; then
  /bin/mkdir "$path"
  /bin/chmod 700 "$path"
else
  : >"$path"
  /bin/chmod 600 "$path"
fi
printf '%s\\n' "$path"
`,
  );
  await writeExecutable(
    join(fakeBin, "sha256sum"),
    createFixtureSha256sumShim(),
  );
  await writeExecutable(
    join(fakeBin, "install"),
    `#!/usr/bin/env bash
set -euo pipefail
mode=''
directory=0
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -d) directory=1; shift ;;
    -m) mode="$2"; shift 2 ;;
    -o|-g) shift 2 ;;
    --) shift; break ;;
    -*) shift ;;
    *) break ;;
  esac
done
if [[ "$directory" -eq 1 ]]; then
  /bin/mkdir -p -- "$@"
  [[ -z "$mode" ]] || /bin/chmod "$mode" -- "$@"
  exit 0
fi
[[ "$#" -eq 2 ]]
/bin/cp -- "$1" "$2"
[[ -z "$mode" ]] || /bin/chmod "$mode" "$2"
printf 'install:%s\\n' "$2" >>${quotedLog}
`,
  );
  await writeExecutable(
    join(fakeBin, "mv"),
    `#!/usr/bin/env bash
set -euo pipefail
fault=''
if [[ -f ${quoteShell(join(root, "fault"))} ]]; then fault="$(<${quoteShell(join(root, "fault"))})"; fi
while [[ "$#" -gt 0 && "$1" == -* ]]; do shift; done
[[ "$#" -eq 2 ]]
if [[ "$2" == */PUBLISH_FINALIZED && "$fault" == 'finalize-rename' ]]; then
  exit 90
fi
/bin/mv -f "$1" "$2"
if [[ "$2" == */PUBLISH_COMMITTED ]]; then
  printf 'commit:%s\\n' "$2" >>${quotedLog}
  if [[ "$fault" == 'after-commit' ]]; then exit 85; fi
  if [[ "$fault" == 'publish-finalized-trap' ]]; then
    finalized="\${2%PUBLISH_COMMITTED}PUBLISH_FINALIZED"
    /bin/mv -f "$2" "$finalized"
    printf 'publish-finalized:%s\\n' "$finalized" >>${quotedLog}
    exit 93
  fi
fi
if [[ "$2" == */PUBLISH_FINALIZED ]]; then
  printf 'finalize:%s\\n' "$2" >>${quotedLog}
  if [[ "$fault" == 'finalize-rename-after' ]]; then exit 91; fi
fi
if [[ "$2" == */HOST_ROLLBACK_REQUIRED ]]; then
  printf 'host-required:%s\\n' "$2" >>${quotedLog}
fi
if [[ "$2" == */HOST_ROLLBACK_COMPLETED ]]; then
  printf 'host-completed:%s\\n' "$2" >>${quotedLog}
fi
`,
  );
  await writeExecutable(
    join(fakeBin, "date"),
    `#!/usr/bin/env bash
printf '20260901010203\\n'
`,
  );
  await writeExecutable(
    join(fakeBin, "readlink"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == '-f' ]]; then
  shift
  [[ "\${1:-}" != '--' ]] || shift
  if [[ "$1" == /proc/*/fd/8 ]]; then
    printf '%s\\n' ${quoteShell(lifecycleLock)}
    printf 'readlink-fd8\\n' >>${quotedLifecycleLog}
  else
    ${quotedNode} -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1])+"\\n")' "$1"
  fi
else
  /usr/bin/readlink "$@"
fi
`,
  );
  await writeExecutable(
    join(fakeBin, "realpath"),
    await createPrepareRealpathShim(lifecycleLock, root, {
      fd8LogPath: lifecycleLogPath,
    }),
  );
  await writeExecutable(
    join(fakeBin, "node"),
    `#!/usr/bin/env bash
set -euo pipefail
fault=''
if [[ -f ${quoteShell(join(root, "fault"))} ]]; then fault="$(<${quoteShell(join(root, "fault"))})"; fi
if [[ "$*" == *fsyncSync* ]]; then
  after_separator=0
  joined_paths=''
  for argument in "$@"; do
    if [[ "$after_separator" -eq 1 ]]; then
      if [[ -n "$joined_paths" ]]; then joined_paths+="|"; fi
      joined_paths+="$argument"
    elif [[ "$argument" == '--' ]]; then
      after_separator=1
    fi
  done
  count_path=${quoteShell(join(root, "fsync-count"))}
  count=0
  if [[ -f "$count_path" ]]; then count="$(<"$count_path")"; fi
  count=$((count + 1))
  printf '%s' "$count" >"$count_path"
  printf 'fsync:%d:%s\\n' "$count" "$joined_paths" >>${quotedLog}
  if [[ "$fault" == 'fsync-before-commit' &&
        -e ${quoteShell(recoveryMarker)} &&
        ! -e ${quoteShell(commitMarker)} &&
        ! -e ${quoteShell(join(root, "fsync-before-triggered"))} ]]; then
    : >${quoteShell(join(root, "fsync-before-triggered"))}
    exit 88
  fi
  if [[ "$fault" == 'fsync-after-commit' && -e ${quoteShell(commitMarker)} ]]; then
    exit 89
  fi
  if [[ "$fault" == 'finalize-fsync' && -e ${quoteShell(finalizedMarker)} ]]; then
    exit 92
  fi
  exec ${quotedNode} "$@"
fi
compare_count_path=${quoteShell(join(root, "compare-count"))}
compare_count=0
if [[ -f "$compare_count_path" ]]; then compare_count="$(<"$compare_count_path")"; fi
compare_count=$((compare_count + 1))
printf '%s' "$compare_count" >"$compare_count_path"
printf 'node-compare\\n' >>${quotedLog}
if [[ "$fault" == 'compare' ]] ||
  [[ "$fault" == 'compare-post-host' && "$compare_count" -eq 2 ]]; then exit 86; fi
exec ${quotedNode} "$@"
`,
  );
  await writeExecutable(
    join(fakeBin, "corepack"),
    `#!/usr/bin/env bash
set -euo pipefail
fault=''
if [[ -f ${quoteShell(join(root, "fault"))} ]]; then fault="$(<${quoteShell(join(root, "fault"))})"; fi
script=''
output=''
apply=0
for argument in "$@"; do
  case "$argument" in
    *assert-governance-maintenance-lock.ts) script='lock-proof' ;;
    *export-governance-snapshot.ts) script='export' ;;
    *restore-governance-snapshot.ts) script='restore' ;;
    --output=*) output="\${argument#--output=}" ;;
    --apply) apply=1 ;;
  esac
done
case "$script" in
  lock-proof)
    count_path=${quoteShell(join(root, "lock-proof-count"))}
    count=0
    if [[ -f "$count_path" ]]; then count="$(<"$count_path")"; fi
    count=$((count + 1))
    printf '%s' "$count" >"$count_path"
    printf 'lock-proof:%d\\n' "$count" >>${quotedLog}
    if [[ "$fault" == 'lock-proof-initial' && "$count" -eq 1 ]]; then exit 97; fi
    if [[ "$fault" == 'lock-proof-final' && "$count" -eq 2 ]]; then exit 98; fi
    if [[ "$fault" == 'lock-proof-recover-final' && "$count" -eq 3 ]]; then exit 99; fi
    ;;
  export)
    printf 'export:%s\\n' "$output" >>${quotedLog}
    printf '%s' ${quotedSnapshot} >"$output"
    /bin/chmod 600 "$output"
    ;;
  restore)
    if [[ "$apply" -eq 1 ]]; then
      printf 'restore:apply\\n' >>${quotedLog}
      [[ "$fault" != 'restore' ]] || exit 87
    else
      printf 'restore:dry-run\\n' >>${quotedLog}
    fi
    ;;
  *) exit 64 ;;
esac
`,
  );

  return {
    backupRoot,
    commitMarker,
    completedHostRollbackMarker,
    currentLink,
    deployRoot,
    environmentBackup,
    fakePath: `${fakeBin}:/usr/local/bin:/usr/bin:/bin`,
    finalizedMarker,
    hostActivationAnchor,
    hostActivationCommitted,
    hostActivationPending,
    hostActivationRolledBack,
    hostRollbackMarker,
    lifecycleLock,
    lifecycleLogPath,
    liveEnvironment,
    logPath,
    previousRelease,
    protocolManifest,
    recoveryMarker,
    releaseDir,
    root,
    snapshotPath,
  };
}

async function executeStateMachine(
  fixture: PublicationFixture,
  mode: PublicationMode,
  options?: { environment?: Partial<NodeJS.ProcessEnv>; fault?: string },
): Promise<CommandResult> {
  const faultPath = join(fixture.root, "fault");
  if (options?.fault !== undefined) {
    await writeFile(faultPath, options.fault, "utf8");
  } else {
    await rm(faultPath, { force: true });
  }
  return execute(
    "/bin/bash",
    [
      "-c",
      'source "$1"; governance_publication_state_machine "$2" "$3" "$4"',
      "publication-fixture",
      publicationStateMachineScript,
      mode,
      RELEASE_ID,
      fixture.deployRoot,
    ],
    {
      cwd: fixture.releaseDir,
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://fixture:fixture@database.invalid/diesel",
        DATABASE_MODE: "postgres",
        DIESEL_GOVERNANCE_MAINTENANCE_TOKEN: "b".repeat(64),
        NODE_ENV: "production",
        PATH: fixture.fakePath,
        release_id: RELEASE_ID,
        ...options?.environment,
      },
    },
  );
}

async function executeMarkerParser(
  fixture: PublicationFixture,
  markerPath: string,
): Promise<CommandResult> {
  return execute(
    "/bin/bash",
    [
      "-c",
      'set -Eeuo pipefail; source "$1"; governance_parse_publication_marker "$2" "$3" "$4"',
      "publication-marker-parser-fixture",
      publicationStateMachineScript,
      markerPath,
      RELEASE_ID,
      fixture.deployRoot,
    ],
    {
      cwd: fixture.releaseDir,
      env: {
        ...process.env,
        PATH: fixture.fakePath,
      },
    },
  );
}

async function writeMarker(
  fixture: PublicationFixture,
  kind: "commit" | "completed-host" | "finalized" | "host" | "recovery",
): Promise<void> {
  await writeFile(fixture.snapshotPath, SNAPSHOT, "utf8");
  await chmod(fixture.snapshotPath, 0o600);
  const digest = createHash("sha256").update(SNAPSHOT).digest("hex");
  const marker = kind === "commit"
    ? fixture.commitMarker
    : kind === "completed-host"
      ? fixture.completedHostRollbackMarker
    : kind === "finalized"
      ? fixture.finalizedMarker
      : kind === "host"
        ? fixture.hostRollbackMarker
      : fixture.recoveryMarker;
  await writeFile(marker, `${digest}\t${fixture.snapshotPath}\n`, "utf8");
  await chmod(marker, 0o600);

  if (kind === "completed-host") {
    await setHostActivationState(fixture, "ROLLED_BACK");
  }
}

async function setHostActivationState(
  fixture: PublicationFixture,
  state: "COMMITTED" | "PENDING" | "ROLLED_BACK",
): Promise<void> {
  const markerByState = {
    COMMITTED: fixture.hostActivationCommitted,
    PENDING: fixture.hostActivationPending,
    ROLLED_BACK: fixture.hostActivationRolledBack,
  } as const;
  await Promise.all(
    Object.values(markerByState).map((markerPath) =>
      rm(markerPath, { force: true }),
    ),
  );
  const anchorDigest = createHash("sha256")
    .update(await readFile(fixture.hostActivationAnchor))
    .digest("hex");
  await writeFile(
    markerByState[state],
    `${anchorDigest}\t${fixture.hostActivationAnchor}\n`,
    "utf8",
  );
  await chmod(markerByState[state], 0o600);
}

async function writeHistoricalMarker(
  fixture: PublicationFixture,
  markerName: "HOST_ROLLBACK_COMPLETED" | "PUBLISH_FINALIZED",
): Promise<string> {
  const historicalDirectory = join(
    fixture.backupRoot,
    HISTORICAL_RELEASE_ID,
  );
  const historicalSnapshot = join(
    historicalDirectory,
    "governance-before.json",
  );
  const historicalMarker = join(historicalDirectory, markerName);
  const historicalAnchor = join(
    historicalDirectory,
    "HOST_ACTIVATION_V1",
  );
  const hostStateMarker = join(
    historicalDirectory,
    markerName === "HOST_ROLLBACK_COMPLETED"
      ? "HOST_ACTIVATION_ROLLED_BACK"
      : "HOST_ACTIVATION_COMMITTED",
  );
  await mkdir(historicalDirectory);
  await chmod(historicalDirectory, 0o700);
  const historicalBasis = [
    ["previous-release", `${fixture.previousRelease}\n`],
    ["env.production.local.pre-switch", "DATABASE_URL=fixture\n"],
    ["jamesky.site.pre-switch", "primary\n"],
    ["diesel-demo.pre-switch", "alternate\n"],
  ] as const;
  for (const [name, contents] of historicalBasis) {
    const path = join(historicalDirectory, name);
    await writeFile(path, contents, "utf8");
    await chmod(path, 0o600);
  }
  await writeFile(historicalSnapshot, SNAPSHOT, "utf8");
  await chmod(historicalSnapshot, 0o600);
  const digest = createHash("sha256").update(SNAPSHOT).digest("hex");
  await writeFile(
    historicalMarker,
    `${digest}\t${historicalSnapshot}\n`,
    "utf8",
  );
  await chmod(historicalMarker, 0o600);

  const hashFile = async (path: string): Promise<string> =>
    createHash("sha256").update(await readFile(path)).digest("hex");
  const previousReleaseState = join(historicalDirectory, "previous-release");
  const environmentBackup = join(
    historicalDirectory,
    "env.production.local.pre-switch",
  );
  const nginxPrimaryBackup = join(
    historicalDirectory,
    "jamesky.site.pre-switch",
  );
  const nginxAlternateBackup = join(
    historicalDirectory,
    "diesel-demo.pre-switch",
  );
  const anchorPayload = [
    `${HISTORICAL_RELEASE_ID}\t${fixture.previousRelease}`,
    `${await hashFile(previousReleaseState)}\t${previousReleaseState}`,
    `${await hashFile(environmentBackup)}\t${environmentBackup}`,
    `${await hashFile(nginxPrimaryBackup)}\t${nginxPrimaryBackup}`,
    `${await hashFile(nginxAlternateBackup)}\t${nginxAlternateBackup}`,
  ].join("\n");
  await writeFile(historicalAnchor, `${anchorPayload}\n`, "utf8");
  await chmod(historicalAnchor, 0o600);
  await writeFile(
    hostStateMarker,
    `${await hashFile(historicalAnchor)}\t${historicalAnchor}\n`,
    "utf8",
  );
  await chmod(hostStateMarker, 0o600);
  return historicalMarker;
}

async function operationLog(fixture: PublicationFixture): Promise<string[]> {
  const contents = await readFile(fixture.logPath, "utf8").catch(() => "");
  return contents.trim() === "" ? [] : contents.trimEnd().split("\n");
}

async function lifecycleLog(fixture: PublicationFixture): Promise<string[]> {
  const contents = await readFile(fixture.lifecycleLogPath, "utf8").catch(
    () => "",
  );
  return contents.trim() === "" ? [] : contents.trimEnd().split("\n");
}

async function nonFsyncOperationLog(
  fixture: PublicationFixture,
): Promise<string[]> {
  return (await operationLog(fixture)).filter(
    (entry) => !entry.startsWith("fsync:"),
  );
}

async function installSavedValidator(
  fixture: PublicationFixture,
): Promise<void> {
  const savedValidator = join(
    fixture.backupRoot,
    RELEASE_ID,
    "validate-public-governance.sh",
  );
  await copyFile(
    join(
      fixture.releaseDir,
      "scripts",
      "deploy",
      "validate-public-governance.sh",
    ),
    savedValidator,
  );
  await chmod(savedValidator, 0o700);
}

async function createLegacyRelease(
  fixture: PublicationFixture,
): Promise<string> {
  const legacyRelease = join(
    fixture.deployRoot,
    "releases",
    LEGACY_RELEASE_ID,
  );
  const legacyDeployScripts = join(legacyRelease, "scripts", "deploy");
  await mkdir(legacyDeployScripts, { recursive: true });
  await writeFile(join(legacyRelease, ".deploy-ready"), "legacy-ready\n", "utf8");
  await chmod(join(legacyRelease, ".deploy-ready"), 0o640);
  await copyFile(
    join(fixture.releaseDir, "scripts", "deploy", "verify-release.sh"),
    join(legacyDeployScripts, "verify-release.sh"),
  );
  await chmod(join(legacyDeployScripts, "verify-release.sh"), 0o750);
  return legacyRelease;
}

async function pointCurrentAtLegacyRelease(
  fixture: PublicationFixture,
): Promise<string> {
  const legacyRelease = await createLegacyRelease(fixture);
  await rm(fixture.currentLink);
  await symlink(legacyRelease, fixture.currentLink);
  return legacyRelease;
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

afterEach(async () => {
  await Promise.all(
    [...fixtureRoots].map(async (root) => {
      fixtureRoots.delete(root);
      await rm(root, { force: true, recursive: true });
    }),
  );
});

describe("governance publication state machine", { timeout: 60_000 }, () => {
  it("has valid Bash syntax and rejects invalid CLI modes and release IDs", async () => {
    await expect(
      execute("/bin/bash", ["-n", publicationStateMachineScript]),
    ).resolves.toMatchObject({ exitCode: 0, stderr: "" });

    const fixture = await createPublicationFixture();
    const invalidMode = await execute(
      "/bin/bash",
      [publicationStateMachineScript, "repair", RELEASE_ID],
      { env: { ...process.env, PATH: fixture.fakePath } },
    );
    const invalidRelease = await execute("/bin/bash", [
      publicationStateMachineScript,
      "publish",
      "../current",
    ]);

    expect(invalidMode.exitCode).toBe(64);
    expect(invalidRelease.exitCode).toBe(64);
  });

  it("rejects a valid production command from a non-release CLI entry", async () => {
    const result = await execute("/bin/bash", [
      publicationStateMachineScript,
      "publish",
      RELEASE_ID,
    ]);

    expect(result.exitCode).toBe(70);
    expect(result.stderr).toContain(
      "governance publication pre-source trust validation failed",
    );
  });

  it("propagates a sourced governance ledger failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-governance-source-"));
    fixtureRoots.add(root);
    const copiedStateMachine = join(
      root,
      "governance-publication-state-machine.sh",
    );
    await Promise.all([
      copyFile(publicationStateMachineScript, copiedStateMachine),
      writeFile(
        join(root, "host-activation-ledger.sh"),
        "return 23\n",
        "utf8",
      ),
    ]);

    const result = await execute("/bin/bash", [
      "--noprofile",
      "--norc",
      "-c",
      'source -- "$1"',
      "governance-source-failure-fixture",
      copiedStateMachine,
    ]);

    expect(result).toEqual({ exitCode: 23, stderr: "", stdout: "" });
  });

  it("rejects the production governance main when the script is sourced", async () => {
    const result = await execute("/bin/bash", [
      "--noprofile",
      "--norc",
      "-c",
      'source -- "$1"; governance_publication_state_machine_main publish "$2"',
      "governance-sourced-main-fixture",
      publicationStateMachineScript,
      RELEASE_ID,
    ]);

    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain(
      "production governance main is unavailable when sourced",
    );
  });

  it.each(["/opt/diesel", "/opt/diesel/", "/opt//diesel"])(
    "rejects sourced governance seam root %s",
    async (deployRoot) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; governance_publication_state_machine publish "$2" "$3"',
        "governance-sourced-production-root-fixture",
        publicationStateMachineScript,
        RELEASE_ID,
        deployRoot,
      ]);

      expect(result.exitCode).toBe(64);
      expect(result.stderr).toContain(
        "governance test seam cannot target the production deployment root",
      );
    },
  );

  it.each([
    ["system directory", "directory", "root:root:755", 0],
    ["normalized directory", "directory", "root:diesel:750", 0],
    ["normalized executable", "executable", "root:diesel:750:1", 0],
    ["staged executable", "executable", "root:root:755:1", 1],
    ["hard-linked executable", "executable", "root:diesel:750:2", 1],
  ] as const)(
    "classifies %s at the direct governance source boundary",
    async (_name, objectType, metadata, expectedStatus) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; governance_cli_bootstrap_metadata_is_allowed "$2" "$3"',
        "governance-cli-metadata-fixture",
        publicationStateMachineScript,
        objectType,
        metadata,
      ]);

      expect(result).toEqual({
        exitCode: expectedStatus,
        stderr: "",
        stdout: "",
      });
    },
  );

  it("binds the target release before sourcing the versioned ledger", async () => {
    const source = await readFile(publicationStateMachineScript, "utf8");
    const argumentBoundary = source.indexOf('if [[ "$#" -ne 2 ||');
    const entryBoundary = source.indexOf(
      'governance_expected_entry="/opt/diesel/releases/$2/scripts/deploy/governance-publication-state-machine.sh"',
    );
    const ledgerSource = source.indexOf(
      'source -- "${BASH_SOURCE[0]%/*}/host-activation-ledger.sh"',
    );
    const ledgerValidation = source.indexOf(
      '"${governance_expected_ledger}" executable',
    );
    const rootPath = source.indexOf(
      'export PATH="/usr/sbin:/usr/bin:/sbin:/bin"',
    );

    expect(argumentBoundary).toBeGreaterThanOrEqual(0);
    expect(entryBoundary).toBeGreaterThan(argumentBoundary);
    expect(ledgerValidation).toBeGreaterThan(entryBoundary);
    expect(rootPath).toBeGreaterThan(ledgerValidation);
    expect(ledgerSource).toBeGreaterThan(rootPath);
  });

  it("publishes in snapshot, marker, rehearsal, queue, validator, commit order", async () => {
    const fixture = await createPublicationFixture();

    const result = await executeStateMachine(fixture, "publish");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const log = await nonFsyncOperationLog(fixture);
    expect(log).toEqual([
      `install:${join(fixture.backupRoot, RELEASE_ID, "validate-public-governance.sh")}`,
      `export:${fixture.snapshotPath}`,
      "restore:dry-run",
      "restore:apply",
      `export:${join(fixture.backupRoot, RELEASE_ID, "governance-after-rehearsal.json")}`,
      "node-compare",
      `queue:${RELEASE_ID}:${fixture.deployRoot}`,
      `validator:${RELEASE_ID}`,
      "lock-proof:1",
      `commit:${fixture.commitMarker}`,
    ]);
    const stateDirectory = join(fixture.backupRoot, RELEASE_ID);
    const fsyncLog = (await operationLog(fixture)).filter((entry) =>
      entry.startsWith("fsync:"),
    );
    expect(fsyncLog).toHaveLength(7);
    expect(fsyncLog[0]).toBe(
      `fsync:1:${fixture.environmentBackup}|${fixture.liveEnvironment}|${join(
        fixture.deployRoot,
        "shared",
      )}`,
    );
    expect(fsyncLog[1]).toBe(
      `fsync:2:${[
        join(stateDirectory, "previous-release"),
        fixture.environmentBackup,
        join(stateDirectory, "jamesky.site.pre-switch"),
        join(stateDirectory, "diesel-demo.pre-switch"),
        stateDirectory,
        fixture.backupRoot,
        fixture.deployRoot,
      ].join("|")}`,
    );
    expect(fsyncLog[2]).toBe(
      `fsync:3:${join(
        stateDirectory,
        "validate-public-governance.sh",
      )}|${stateDirectory}`,
    );
    expect(fsyncLog[3]).toBe(
      `fsync:4:${fixture.snapshotPath}|${stateDirectory}`,
    );
    expect(fsyncLog[4]).toMatch(
      new RegExp(
        `^fsync:5:${stateDirectory}/\\.RECOVERY_REQUIRED\\.fixture-[0-9]+$`,
        "u",
      ),
    );
    expect(fsyncLog.slice(5)).toEqual([
      `fsync:6:${stateDirectory}`,
      `fsync:7:${fixture.commitMarker}|${stateDirectory}`,
    ]);
    expect((await lstat(fixture.commitMarker)).isFile()).toBe(true);
    await expect(lstat(fixture.recoveryMarker)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each([
    "publish",
    "recover-required",
    "finalize-committed",
  ] as const)(
    "rejects runtime database identity drift before %s mutation",
    async (mode) => {
      const fixture = await createPublicationFixture();
      const secret = `database-secret-${mode}`;
      let retainedMarker: string | null = null;
      if (mode === "recover-required") {
        await writeMarker(fixture, "recovery");
        retainedMarker = fixture.recoveryMarker;
      } else if (mode === "finalize-committed") {
        await writeMarker(fixture, "commit");
        await installSavedValidator(fixture);
        retainedMarker = fixture.commitMarker;
      }
      await writeFile(
        fixture.liveEnvironment,
        `DATABASE_URL=postgresql://fixture:${secret}@database.invalid/diesel\n`,
        "utf8",
      );

      const result = await executeStateMachine(fixture, mode);

      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain(
        "runtime database identity changed across the release boundary",
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(secret);
      expect(await nonFsyncOperationLog(fixture)).toEqual([]);
      if (retainedMarker !== null) {
        expect(await pathExists(retainedMarker)).toBe(true);
      }
    },
  );

  it.each([
    "publish",
    "recover-required",
    "finalize-committed",
  ] as const)(
    "rejects a mismatched maintenance DATABASE_URL before any %s database or terminal mutation",
    async (mode) => {
      const fixture = await createPublicationFixture();
      let retainedMarker: string | null = null;
      if (mode === "recover-required") {
        await writeMarker(fixture, "recovery");
        retainedMarker = fixture.recoveryMarker;
      } else if (mode === "finalize-committed") {
        await writeMarker(fixture, "commit");
        await installSavedValidator(fixture);
        retainedMarker = fixture.commitMarker;
      }
      const secret = `maintenance-only-${mode}`;

      const result = await executeStateMachine(fixture, mode, {
        environment: {
          DATABASE_URL:
            `postgresql://fixture:${secret}@database.invalid/diesel`,
        },
      });

      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain(
        "runtime database identity changed across the release boundary",
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(secret);
      expect(await nonFsyncOperationLog(fixture)).toEqual([]);
      if (retainedMarker === null) {
        expect(await pathExists(fixture.snapshotPath)).toBe(false);
      } else {
        expect(await pathExists(retainedMarker)).toBe(true);
      }
      expect(await pathExists(fixture.finalizedMarker)).toBe(false);
      expect(await pathExists(fixture.completedHostRollbackMarker)).toBe(false);
    },
  );

  it.each([
    "HOST_ROLLBACK_COMPLETED",
    "PUBLISH_FINALIZED",
  ] as const)(
    "allows a strict historical %s tombstone during the stale-state scan",
    async (markerName) => {
      const fixture = await createPublicationFixture();
      const historicalMarker = await writeHistoricalMarker(
        fixture,
        markerName,
      );

      const result = await executeStateMachine(fixture, "publish");

      expect(result.exitCode).toBe(0);
      expect((await lstat(historicalMarker)).isFile()).toBe(true);
      expect((await lstat(fixture.commitMarker)).isFile()).toBe(true);
    },
  );

  it("rejects a historical symlinked finalized tombstone before publication work", async () => {
    const fixture = await createPublicationFixture();
    const historicalDirectory = join(
      fixture.backupRoot,
      HISTORICAL_RELEASE_ID,
    );
    await mkdir(historicalDirectory);
    await chmod(historicalDirectory, 0o700);
    await symlink(
      fixture.releaseDir,
      join(historicalDirectory, "PUBLISH_FINALIZED"),
    );

    const result = await executeStateMachine(fixture, "publish");

    expect(result.exitCode).toBe(70);
    await expect(operationLog(fixture)).resolves.toEqual([]);
  });

  it.each([
    {
      corrupt: async (fixture: PublicationFixture) => {
        await rm(fixture.recoveryMarker);
        await symlink(fixture.snapshotPath, fixture.recoveryMarker);
      },
      name: "a symlinked marker",
    },
    {
      corrupt: async (fixture: PublicationFixture) => {
        await writeFile(
          join(fixture.root, "bad-marker-owner"),
          "",
          "utf8",
        );
      },
      name: "an untrusted marker owner",
    },
    {
      corrupt: async (fixture: PublicationFixture) => {
        await writeFile(join(fixture.root, "bad-marker-mode"), "", "utf8");
      },
      name: "loose marker permissions",
    },
    {
      corrupt: async (fixture: PublicationFixture) => {
        const valid = await readFile(fixture.recoveryMarker, "utf8");
        await writeFile(
          fixture.recoveryMarker,
          valid.replace("\n", "\textra\n"),
          "utf8",
        );
      },
      name: "an extra marker field",
    },
    {
      corrupt: async (fixture: PublicationFixture) => {
        const valid = await readFile(fixture.recoveryMarker, "utf8");
        await writeFile(fixture.recoveryMarker, `${valid}second-line\n`, "utf8");
      },
      name: "multiple marker records",
    },
    {
      corrupt: async (fixture: PublicationFixture) => {
        const digest = createHash("sha256").update(SNAPSHOT).digest("hex");
        await writeFile(
          fixture.recoveryMarker,
          `${digest}\t${join(fixture.backupRoot, RELEASE_ID, "other.json")}\n`,
          "utf8",
        );
      },
      name: "a noncanonical snapshot path",
    },
    {
      corrupt: async (fixture: PublicationFixture) => {
        await writeFile(fixture.snapshotPath, '{"tampered":true}\n', "utf8");
      },
      name: "snapshot hash drift",
    },
  ] as const)(
    "fails closed before recovery work for $name",
    async ({ corrupt }) => {
      const fixture = await createPublicationFixture();
      await writeMarker(fixture, "recovery");
      await corrupt(fixture);

      const result = await executeMarkerParser(
        fixture,
        fixture.recoveryMarker,
      );

      expect(result.exitCode).toBe(70);
      await expect(operationLog(fixture)).resolves.toEqual([]);
      expect(
        await lstat(fixture.recoveryMarker).then(
          () => true,
          () => false,
        ),
      ).toBe(true);
    },
  );

  it.each([
    { fault: "queue", status: 81 },
    { fault: "validator", status: 82 },
  ] as const)(
    "restores exactly once and advances to required host rollback after $fault failure",
    async ({ fault, status }) => {
      const fixture = await createPublicationFixture();

      const result = await executeStateMachine(fixture, "publish", { fault });

      expect(result.exitCode).toBe(status);
      const log = await operationLog(fixture);
      expect(log.filter((entry) => entry === "restore:apply")).toHaveLength(2);
      expect(log.filter((entry) => entry === "restore:dry-run")).toHaveLength(1);
      await expect(lstat(fixture.recoveryMarker)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(lstat(fixture.commitMarker)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await pathExists(fixture.hostRollbackMarker)).toBe(true);
      expect(await pathExists(fixture.completedHostRollbackMarker)).toBe(false);
    },
  );

  it("uses the TERM recovery trap once and preserves the signal exit status", async () => {
    const fixture = await createPublicationFixture();

    const result = await executeStateMachine(fixture, "publish", {
      fault: "validator-term",
    });

    expect(result.exitCode).toBe(143);
    const log = await operationLog(fixture);
    expect(log.filter((entry) => entry === "restore:apply")).toHaveLength(2);
    await expect(lstat(fixture.recoveryMarker)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(lstat(fixture.commitMarker)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await pathExists(fixture.hostRollbackMarker)).toBe(true);
  });

  it("never restores once the commit marker exists", async () => {
    const fixture = await createPublicationFixture();

    const result = await executeStateMachine(fixture, "publish", {
      fault: "after-commit",
    });

    expect(result.exitCode).toBe(85);
    const log = await operationLog(fixture);
    expect(log.filter((entry) => entry === "restore:apply")).toHaveLength(1);
    expect((await lstat(fixture.commitMarker)).isFile()).toBe(true);
    await expect(lstat(fixture.recoveryMarker)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("treats a finalized marker created during the publish trap window as irrevocable", async () => {
    const fixture = await createPublicationFixture();

    const result = await executeStateMachine(fixture, "publish", {
      fault: "publish-finalized-trap",
    });

    expect(result.exitCode).toBe(93);
    const log = await operationLog(fixture);
    expect(log.filter((entry) => entry === "restore:apply")).toHaveLength(1);
    expect(await pathExists(fixture.commitMarker)).toBe(false);
    expect(await pathExists(fixture.finalizedMarker)).toBe(true);
    expect(log).toContain(`publish-finalized:${fixture.finalizedMarker}`);
  });

  it("restores when recovery-marker directory fsync fails before commit", async () => {
    const fixture = await createPublicationFixture();

    const result = await executeStateMachine(fixture, "publish", {
      fault: "fsync-before-commit",
    });

    expect(result.exitCode).toBe(88);
    const log = await operationLog(fixture);
    expect(log.filter((entry) => entry === "restore:apply")).toHaveLength(1);
    expect(log).toContain(`fsync:6:${join(fixture.backupRoot, RELEASE_ID)}`);
    await expect(lstat(fixture.recoveryMarker)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(lstat(fixture.commitMarker)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await pathExists(fixture.hostRollbackMarker)).toBe(true);
  });

  it("preserves committed state when the post-rename directory fsync fails", async () => {
    const fixture = await createPublicationFixture();

    const result = await executeStateMachine(fixture, "publish", {
      fault: "fsync-after-commit",
    });

    expect(result.exitCode).toBe(89);
    const log = await operationLog(fixture);
    expect(log.filter((entry) => entry === "restore:apply")).toHaveLength(1);
    expect(log).toContain(
      `fsync:7:${fixture.commitMarker}|${join(fixture.backupRoot, RELEASE_ID)}`,
    );
    expect((await lstat(fixture.commitMarker)).isFile()).toBe(true);
    await expect(lstat(fixture.recoveryMarker)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("recovers the database and host, rechecks both, then durably records completion", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "recovery");

    const result = await executeStateMachine(fixture, "recover-required");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const log = await nonFsyncOperationLog(fixture);
    expect(log[0]).toBe("restore:apply");
    expect(log[1]?.startsWith(
      `export:${fixture.deployRoot}/.governance-recovery-${RELEASE_ID}.fixture-`,
    )).toBe(true);
    expect(log[1]?.endsWith("/after.json")).toBe(true);
    expect(log.slice(2)).toEqual([
      "node-compare",
      "lock-proof:1",
      `host-required:${fixture.hostRollbackMarker}`,
      `rollback:${RELEASE_ID}:--restore-governance-host`,
      `verify:https://jamesky.site:${LEGACY_RELEASE_ID}`,
      log[1],
      "node-compare",
      "lock-proof:2",
      "lock-proof:3",
      `host-completed:${fixture.completedHostRollbackMarker}`,
    ]);
    expect(await pathExists(fixture.recoveryMarker)).toBe(false);
    expect(await pathExists(fixture.hostRollbackMarker)).toBe(false);
    expect(await pathExists(fixture.completedHostRollbackMarker)).toBe(true);
    await expect(realpath(fixture.currentLink)).resolves.toBe(
      fixture.previousRelease,
    );
    const lifecycle = await lifecycleLog(fixture);
    expect(lifecycle.slice(0, 2)).toEqual([
      "flock:-n:8",
      "readlink-fd8",
    ]);
    expect(lifecycle.slice(2)).toEqual([
      "realpath-fd8",
      "flock:-n:8",
      "realpath-fd8",
      "flock:-n:8",
      "realpath-fd8",
      "flock:-n:8",
      "realpath-fd8",
      "flock:-n:8",
    ]);
  });

  it("resumes HOST_ROLLBACK_REQUIRED without restoring the database again", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "host");

    const result = await executeStateMachine(fixture, "recover-required");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const log = await nonFsyncOperationLog(fixture);
    expect(log).not.toContain("restore:apply");
    expect(log.filter((entry) => entry.startsWith("export:"))).toHaveLength(2);
    expect(log).toContain(
      `rollback:${RELEASE_ID}:--restore-governance-host`,
    );
    expect(await pathExists(fixture.hostRollbackMarker)).toBe(false);
    expect(await pathExists(fixture.completedHostRollbackMarker)).toBe(true);
    await expect(realpath(fixture.currentLink)).resolves.toBe(
      fixture.previousRelease,
    );
  });

  it("replays idempotent host repair from ROLLED_BACK:HOST_ROLLBACK_REQUIRED before completing recovery", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "host");
    await setHostActivationState(fixture, "ROLLED_BACK");

    const result = await executeStateMachine(fixture, "recover-required");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const log = await nonFsyncOperationLog(fixture);
    expect(log).not.toContain("restore:apply");
    expect(log).toContain(
      `rollback:${RELEASE_ID}:--restore-governance-host`,
    );
    expect(log.filter((entry) => entry.startsWith("export:"))).toHaveLength(2);
    expect(await pathExists(fixture.hostRollbackMarker)).toBe(false);
    expect(await pathExists(fixture.completedHostRollbackMarker)).toBe(true);
    expect(await pathExists(fixture.hostActivationRolledBack)).toBe(true);
    await expect(realpath(fixture.currentLink)).resolves.toBe(
      fixture.previousRelease,
    );
  });

  it("treats HOST_ROLLBACK_COMPLETED as a terminal audit ledger", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "completed-host");
    const markerPayload = await readFile(
      fixture.completedHostRollbackMarker,
      "utf8",
    );

    const result = await executeStateMachine(fixture, "recover-required");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(await nonFsyncOperationLog(fixture)).toEqual([]);
    await expect(
      readFile(fixture.completedHostRollbackMarker, "utf8"),
    ).resolves.toBe(markerPayload);
    await expect(realpath(fixture.currentLink)).resolves.toBe(
      fixture.releaseDir,
    );
  });

  it.each([
    { fault: "compare-post-host", status: 86 },
    { fault: "lock-proof-recover-final", status: 99 },
  ] as const)(
    "retains HOST_ROLLBACK_REQUIRED when post-host recovery fails at $fault",
    async ({ fault, status }) => {
      const fixture = await createPublicationFixture();
      await writeMarker(fixture, "recovery");

      const result = await executeStateMachine(fixture, "recover-required", {
        fault,
      });

      expect(result.exitCode).toBe(status);
      expect(await pathExists(fixture.recoveryMarker)).toBe(false);
      expect(await pathExists(fixture.hostRollbackMarker)).toBe(true);
      expect(await pathExists(fixture.completedHostRollbackMarker)).toBe(false);
      await expect(realpath(fixture.currentLink)).resolves.toBe(
        fixture.previousRelease,
      );
    },
  );

  it("retains HOST_ROLLBACK_REQUIRED when the previous-release verifier fails", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "recovery");

    const result = await executeStateMachine(fixture, "recover-required", {
      fault: "verify",
    });

    expect(result.exitCode).toBe(84);
    expect(await pathExists(fixture.recoveryMarker)).toBe(false);
    expect(await pathExists(fixture.hostRollbackMarker)).toBe(true);
    expect(await pathExists(fixture.completedHostRollbackMarker)).toBe(false);
    expect(await operationLog(fixture)).toContain(
      `verify:https://jamesky.site:${LEGACY_RELEASE_ID}`,
    );
  });

  it("retains recovery state when current drifts after versioned verification", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "recovery");
    await createLegacyRelease(fixture);

    const result = await executeStateMachine(fixture, "recover-required", {
      fault: "recover-current-drift",
    });

    expect(result.exitCode).toBe(70);
    expect(await pathExists(fixture.recoveryMarker)).toBe(false);
    expect(await pathExists(fixture.hostRollbackMarker)).toBe(true);
    expect(await pathExists(fixture.completedHostRollbackMarker)).toBe(false);
    expect(await pathExists(fixture.commitMarker)).toBe(false);
    expect(await operationLog(fixture)).toContain(
      `verify:https://jamesky.site:${LEGACY_RELEASE_ID}`,
    );
  });

  it("isolates the current verifier from secrets and the maintenance capability", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "recovery");
    const secret = "governance-recovery-secret-canary";

    const result = await executeStateMachine(fixture, "recover-required", {
      environment: {
        GOVERNANCE_SECRET_CANARY: secret,
      },
      fault: "inspect-isolated-env",
    });

    expect(result.exitCode).toBe(0);
    const combined = `${result.stdout}\n${result.stderr}\n${(
      await operationLog(fixture)
    ).join("\n")}`;
    expect(combined).toContain("env-clean:verify");
    expect(combined).toContain("env-clean:rollback");
    expect(combined).not.toContain("env-leak:");
    expect(combined).not.toContain(secret);
  });

  it("uses the actual verifier from an active legacy timestamp release during recovery", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "recovery");
    await pointCurrentAtLegacyRelease(fixture);

    const result = await executeStateMachine(fixture, "recover-required");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(await operationLog(fixture)).toContain(
      `verify:https://jamesky.site:${LEGACY_RELEASE_ID}`,
    );
    expect(await pathExists(fixture.recoveryMarker)).toBe(false);
    expect(await pathExists(fixture.hostRollbackMarker)).toBe(false);
    expect(await pathExists(fixture.completedHostRollbackMarker)).toBe(true);
  });

  it("rejects recovery when a finalized publication fact already exists", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "recovery");
    await copyFile(fixture.recoveryMarker, fixture.finalizedMarker);
    await chmod(fixture.finalizedMarker, 0o600);

    const result = await executeStateMachine(fixture, "recover-required");

    expect(result.exitCode).toBe(70);
    await expect(nonFsyncOperationLog(fixture)).resolves.toEqual([]);
    expect(await pathExists(fixture.recoveryMarker)).toBe(true);
    expect(await pathExists(fixture.finalizedMarker)).toBe(true);
  });

  it("durably enters forward-only finalized state before validating and commits the host ledger last", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "commit");
    await installSavedValidator(fixture);

    const result = await executeStateMachine(fixture, "finalize-committed");

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(await nonFsyncOperationLog(fixture)).toEqual([
      `finalize:${fixture.finalizedMarker}`,
      "lock-proof:1",
      `rollback:${RELEASE_ID}:--validate-committed`,
      `validator:${RELEASE_ID}`,
      "lock-proof:2",
      `rollback:${RELEASE_ID}:--validate-committed`,
      `validator:${RELEASE_ID}`,
      "lock-proof:3",
    ]);
    await expect(lstat(fixture.commitMarker)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await lstat(fixture.finalizedMarker)).isFile()).toBe(true);
    expect(await pathExists(fixture.hostActivationPending)).toBe(false);
    expect(await pathExists(fixture.hostActivationCommitted)).toBe(true);
    expect(await operationLog(fixture)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(fixture.finalizedMarker),
        expect.stringContaining(fixture.hostActivationCommitted),
      ]),
    );
  });

  it("revalidates a finalized tombstone without rewriting it", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "commit");
    await installSavedValidator(fixture);

    const first = await executeStateMachine(fixture, "finalize-committed");
    const finalizedContents = await readFile(fixture.finalizedMarker, "utf8");
    const second = await executeStateMachine(fixture, "finalize-committed");

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    await expect(readFile(fixture.finalizedMarker, "utf8")).resolves.toBe(
      finalizedContents,
    );
    const log = await nonFsyncOperationLog(fixture);
    expect(log.slice(0, 8)).toEqual([
      `finalize:${fixture.finalizedMarker}`,
      "lock-proof:1",
      `rollback:${RELEASE_ID}:--validate-committed`,
      `validator:${RELEASE_ID}`,
      "lock-proof:2",
      `rollback:${RELEASE_ID}:--validate-committed`,
      `validator:${RELEASE_ID}`,
      "lock-proof:3",
    ]);
    expect(log.filter((entry) => entry === `finalize:${fixture.finalizedMarker}`)).toHaveLength(1);
    expect(log.filter((entry) => entry === `rollback:${RELEASE_ID}:--validate-committed`)).toHaveLength(4);
    expect(log.filter((entry) => entry === `validator:${RELEASE_ID}`)).toHaveLength(4);
    expect(log.filter((entry) => entry.startsWith("lock-proof:"))).toHaveLength(6);
    expect(await pathExists(fixture.hostActivationCommitted)).toBe(true);
  }, 50_000);

  it("rejects current drift when explicitly revalidating a real V1 committed/finalized terminal ledger", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "commit");
    await installSavedValidator(fixture);
    expect(
      await executeStateMachine(fixture, "finalize-committed"),
    ).toMatchObject({ exitCode: 0 });
    const finalizedContents = await readFile(fixture.finalizedMarker, "utf8");
    await rm(fixture.currentLink);
    await symlink(fixture.previousRelease, fixture.currentLink);

    const result = await executeStateMachine(fixture, "finalize-committed");

    expect(result.exitCode).toBe(70);
    expect(result.stderr).toContain(
      "current does not match the requested release",
    );
    await expect(readFile(fixture.finalizedMarker, "utf8")).resolves.toBe(
      finalizedContents,
    );
    expect(await pathExists(fixture.hostActivationCommitted)).toBe(true);
    expect(
      (await nonFsyncOperationLog(fixture)).filter(
        (entry) => entry === `finalize:${fixture.finalizedMarker}`,
      ),
    ).toHaveLength(1);
  }, 50_000);

  it("retains a real V1 committed/finalized terminal ledger when repeated public validation fails", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "commit");
    await installSavedValidator(fixture);
    expect(
      await executeStateMachine(fixture, "finalize-committed"),
    ).toMatchObject({ exitCode: 0 });
    const finalizedContents = await readFile(fixture.finalizedMarker, "utf8");

    const result = await executeStateMachine(fixture, "finalize-committed", {
      fault: "validator",
    });

    expect(result.exitCode).toBe(82);
    await expect(readFile(fixture.finalizedMarker, "utf8")).resolves.toBe(
      finalizedContents,
    );
    expect(await pathExists(fixture.hostActivationCommitted)).toBe(true);
    expect(
      (await nonFsyncOperationLog(fixture)).filter(
        (entry) => entry === `finalize:${fixture.finalizedMarker}`,
      ),
    ).toHaveLength(1);
  }, 50_000);

  it("fails closed when committed and finalized markers coexist", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "commit");
    await copyFile(fixture.commitMarker, fixture.finalizedMarker);
    await chmod(fixture.finalizedMarker, 0o600);
    await installSavedValidator(fixture);

    const result = await executeStateMachine(fixture, "finalize-committed");

    expect(result.exitCode).toBe(70);
    await expect(nonFsyncOperationLog(fixture)).resolves.toEqual([]);
    expect(await pathExists(fixture.commitMarker)).toBe(true);
    expect(await pathExists(fixture.finalizedMarker)).toBe(true);
  });

  it("requires the maintenance capability before finalized-state validation", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "commit");
    await installSavedValidator(fixture);

    const result = await executeStateMachine(fixture, "finalize-committed", {
      environment: { DIESEL_GOVERNANCE_MAINTENANCE_TOKEN: "" },
    });

    expect(result.exitCode).toBe(70);
    await expect(operationLog(fixture)).resolves.toEqual([]);
    expect(await pathExists(fixture.commitMarker)).toBe(true);
    expect(await pathExists(fixture.finalizedMarker)).toBe(false);
  });

  it("rejects a forged token when the initial lock proof fails before validators", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "commit");
    await installSavedValidator(fixture);

    const result = await executeStateMachine(fixture, "finalize-committed", {
      environment: {
        DIESEL_GOVERNANCE_MAINTENANCE_TOKEN: "c".repeat(64),
      },
      fault: "lock-proof-initial",
    });

    expect(result.exitCode).toBe(97);
    expect(await nonFsyncOperationLog(fixture)).toEqual([
      `finalize:${fixture.finalizedMarker}`,
      "lock-proof:1",
    ]);
    expect(await pathExists(fixture.commitMarker)).toBe(false);
    expect(await pathExists(fixture.finalizedMarker)).toBe(true);
    expect(await pathExists(fixture.hostActivationPending)).toBe(true);
  });

  it("retains forward-only finalized state when the final lock proof fails", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "commit");
    await installSavedValidator(fixture);

    const result = await executeStateMachine(fixture, "finalize-committed", {
      fault: "lock-proof-final",
    });

    expect(result.exitCode).toBe(98);
    expect(await nonFsyncOperationLog(fixture)).toEqual([
      `finalize:${fixture.finalizedMarker}`,
      "lock-proof:1",
      `rollback:${RELEASE_ID}:--validate-committed`,
      `validator:${RELEASE_ID}`,
      "lock-proof:2",
    ]);
    expect(await pathExists(fixture.commitMarker)).toBe(false);
    expect(await pathExists(fixture.finalizedMarker)).toBe(true);
    expect(await pathExists(fixture.hostActivationPending)).toBe(true);
  });

  it("retains forward-only finalized state when current drifts after the saved validator", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "commit");
    await installSavedValidator(fixture);
    await createLegacyRelease(fixture);

    const result = await executeStateMachine(fixture, "finalize-committed", {
      fault: "finalize-current-drift",
    });

    expect(result.exitCode).toBe(70);
    expect(await pathExists(fixture.commitMarker)).toBe(false);
    expect(await pathExists(fixture.finalizedMarker)).toBe(true);
    expect(await nonFsyncOperationLog(fixture)).toEqual([
      `finalize:${fixture.finalizedMarker}`,
      "lock-proof:1",
      `rollback:${RELEASE_ID}:--validate-committed`,
      `validator:${RELEASE_ID}`,
      "lock-proof:2",
    ]);
  });

  it("isolates both finalize validators from secrets and the maintenance capability", async () => {
    const fixture = await createPublicationFixture();
    await writeMarker(fixture, "commit");
    await installSavedValidator(fixture);
    const secret = "governance-finalize-secret-canary";

    const result = await executeStateMachine(fixture, "finalize-committed", {
      environment: {
        GOVERNANCE_SECRET_CANARY: secret,
      },
      fault: "inspect-isolated-env",
    });

    expect(result.exitCode).toBe(0);
    const combined = `${result.stdout}\n${result.stderr}\n${(
      await operationLog(fixture)
    ).join("\n")}`;
    expect(combined.match(/env-clean:rollback/gu)).toHaveLength(2);
    expect(combined).toContain("env-clean:validator");
    expect(combined).not.toContain("env-leak:");
    expect(combined).not.toContain(secret);
  });

  it.each([
    {
      expectedAfterFinalize: [
        "lock-proof:1",
        `rollback:${RELEASE_ID}:--validate-committed`,
      ],
      fault: "rollback-validation",
      status: 83,
    },
    {
      expectedAfterFinalize: [
        "lock-proof:1",
        `rollback:${RELEASE_ID}:--validate-committed`,
        `validator:${RELEASE_ID}`,
      ],
      fault: "validator",
      status: 82,
    },
  ] as const)(
    "keeps the forward-only finalized marker without restore when $fault fails",
    async ({ expectedAfterFinalize, fault, status }) => {
      const fixture = await createPublicationFixture();
      await writeMarker(fixture, "commit");
      await installSavedValidator(fixture);

      const result = await executeStateMachine(fixture, "finalize-committed", {
        fault,
      });

      expect(result.exitCode).toBe(status);
      expect(await nonFsyncOperationLog(fixture)).toEqual([
        `finalize:${fixture.finalizedMarker}`,
        ...expectedAfterFinalize,
      ]);
      expect(await pathExists(fixture.commitMarker)).toBe(false);
      expect((await lstat(fixture.finalizedMarker)).isFile()).toBe(true);
      expect(await pathExists(fixture.hostActivationPending)).toBe(true);
      expect((await operationLog(fixture)).some((entry) => entry.startsWith("restore:"))).toBe(
        false,
      );
    },
  );

  it.each([
    {
      expectedStatus: 90,
      fault: "finalize-rename",
      survivingMarker: "commit",
    },
    {
      expectedStatus: 91,
      fault: "finalize-rename-after",
      survivingMarker: "finalized",
    },
    {
      expectedStatus: 92,
      fault: "finalize-fsync",
      survivingMarker: "finalized",
    },
  ] as const)(
    "preserves a durable publication fact after $fault failure",
    async ({ expectedStatus, fault, survivingMarker }) => {
      const fixture = await createPublicationFixture();
      await writeMarker(fixture, "commit");
      await installSavedValidator(fixture);

      const result = await executeStateMachine(fixture, "finalize-committed", {
        fault,
      });

      expect(result.exitCode).toBe(expectedStatus);
      expect(
        (await pathExists(fixture.commitMarker)) ||
          (await pathExists(fixture.finalizedMarker)),
      ).toBe(true);
      expect(
        await pathExists(
          survivingMarker === "commit"
            ? fixture.commitMarker
            : fixture.finalizedMarker,
        ),
      ).toBe(true);
      expect(
        (await operationLog(fixture)).some((entry) =>
          entry.startsWith("restore:"),
        ),
      ).toBe(false);
    },
  );
});
