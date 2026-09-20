import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createPrepareRealpathShim } from "./prepare-native-realpath";
import { createFixtureSha256sumShim } from "./fixture-sha256sum";

export const TEST_RELEASE_SHA = "a".repeat(40);

export type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function writeExecutable(path: string, source: string): Promise<void> {
  await writeFile(path, source, "utf8");
  await chmod(path, 0o755);
}

export type HostActivationLedgerFixture = {
  anchor: string;
  backupsRoot: string;
  committed: string;
  currentLink: string;
  deployRoot: string;
  fakePath: string;
  lifecycleLock: string;
  manifest: string;
  nginxSitesRoot: string;
  nodeBinary: string;
  pending: string;
  previousRelease: string;
  rolledBack: string;
  root: string;
  sharedRoot: string;
  stateDir: string;
};

export async function writeHostActivationBasis(
  fixture: HostActivationLedgerFixture,
  releaseId = TEST_RELEASE_SHA,
): Promise<string> {
  const stateDir = join(fixture.backupsRoot, releaseId);
  await mkdir(stateDir, { recursive: true });
  await chmod(stateDir, 0o700);
  const basis = new Map<string, string>([
    [join(stateDir, "previous-release"), `${fixture.previousRelease}\n`],
    [join(stateDir, "env.production.local.pre-switch"), "DATABASE_URL=postgresql://fixture@database.invalid/diesel\n"],
    [join(stateDir, "jamesky.site.pre-switch"), "primary fixture\n"],
    [join(stateDir, "diesel-demo.pre-switch"), "alternate fixture\n"],
  ]);
  await Promise.all(
    [...basis].map(async ([path, contents]) => {
      await writeFile(path, contents, "utf8");
      await chmod(path, 0o600);
    }),
  );
  return stateDir;
}

export async function createHostActivationLedgerFixture(): Promise<HostActivationLedgerFixture> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "diesel-host-activation-ledger-")),
  );
  const deployRoot = join(root, "deploy");
  const backupsRoot = join(deployRoot, "backups");
  const stateDir = join(backupsRoot, TEST_RELEASE_SHA);
  const releaseRoot = join(deployRoot, "releases");
  const previousRelease = join(releaseRoot, "previous-release");
  const sharedRoot = join(deployRoot, "shared");
  const nginxSitesRoot = join(root, "nginx-sites");
  const fakeBin = join(root, "fake-bin");
  const lifecycleLock = join(deployRoot, ".release-lifecycle.lock");
  const manifest = join(backupsRoot, "HOST_ACTIVATION_PROTOCOL_V1");
  const anchor = join(stateDir, "HOST_ACTIVATION_V1");
  const pending = join(stateDir, "HOST_ACTIVATION_PENDING");
  const rolledBack = join(stateDir, "HOST_ACTIVATION_ROLLED_BACK");
  const committed = join(stateDir, "HOST_ACTIVATION_COMMITTED");
  const currentLink = join(deployRoot, "current");
  const nodeBinary = join(fakeBin, "node");
  const fakeFindProgram = join(root, "fake-find.mjs");

  await Promise.all([
    mkdir(previousRelease, { recursive: true }),
    mkdir(backupsRoot, { recursive: true }),
    mkdir(sharedRoot, { recursive: true }),
    mkdir(nginxSitesRoot, { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);
  await Promise.all([
    chmod(deployRoot, 0o755),
    chmod(releaseRoot, 0o755),
    chmod(previousRelease, 0o750),
    chmod(backupsRoot, 0o700),
    chmod(sharedRoot, 0o750),
    chmod(nginxSitesRoot, 0o755),
  ]);
  await writeFile(lifecycleLock, "", "utf8");
  await chmod(lifecycleLock, 0o600);
  await writeHostActivationBasis({
    anchor,
    backupsRoot,
    committed,
    currentLink,
    deployRoot,
    fakePath: "",
    lifecycleLock,
    manifest,
    nginxSitesRoot,
    nodeBinary,
    pending,
    previousRelease,
    rolledBack,
    root,
    sharedRoot,
    stateDir,
  });
  await Promise.all([
    writeFile(
      join(sharedRoot, ".env.production.local"),
      "DATABASE_URL=postgresql://fixture@database.invalid/diesel\n",
      "utf8",
    ).then(() => chmod(join(sharedRoot, ".env.production.local"), 0o640)),
    writeFile(join(nginxSitesRoot, "jamesky.site"), "primary fixture\n", "utf8").then(
      () => chmod(join(nginxSitesRoot, "jamesky.site"), 0o644),
    ),
    writeFile(join(nginxSitesRoot, "diesel-demo"), "alternate fixture\n", "utf8").then(
      () => chmod(join(nginxSitesRoot, "diesel-demo"), 0o644),
    ),
  ]);
  await symlink(previousRelease, currentLink);

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
} else if (joined.includes("-name .*") && joined.includes("-type l")) {
  selected = entries.filter(({ info, name }) => info.isSymbolicLink() || name.startsWith(".")).slice(0, 1);
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
  const quotedRealNode = quoteShell(process.execPath);
  await writeExecutable(
    join(fakeBin, "find"),
    `#!/bin/bash
exec ${quotedRealNode} ${quoteShell(fakeFindProgram)} "$@"
`,
  );
  await writeExecutable(
    join(fakeBin, "realpath"),
    await createPrepareRealpathShim(lifecycleLock, root),
  );
  await writeExecutable(
    join(fakeBin, "stat"),
    `#!/bin/bash
set -euo pipefail
format="\${2:-}"
path="\${!#}"
# Read a fresh lstat-equivalent snapshot on every invocation. Only the process
# startup changes; retain this fixture's low-nine-bit mode and owner projection.
if metadata="$(/usr/bin/stat -c '%a:%h:%s' -- "$path" 2>/dev/null)"; then
  :
else
  metadata="$(/usr/bin/stat -f '%Lp:%l:%z' -- "$path")"
fi
[[ "$metadata" =~ ^[0-7]{1,4}:[0-9]+:[0-9]+$ ]] || exit 65
IFS=: read -r mode link_count size <<< "$metadata"
printf -v mode '%o' "$((8#$mode & 0777))"
case "$path" in
  ${quoteShell(sharedRoot)}|${quoteShell(`${sharedRoot}/`)}*) owner='root:diesel' ;;
  *) owner='root:root' ;;
esac
case "$format" in
  '%U:%G:%a') printf '%s:%s\\n' "$owner" "$mode" ;;
  '%s') printf '%s\\n' "$size" ;;
  '%h') printf '%s\\n' "$link_count" ;;
  *) exit 64 ;;
esac
`,
  );
  await writeExecutable(
    join(fakeBin, "sha256sum"),
    createFixtureSha256sumShim(),
  );
  await writeExecutable(
    join(fakeBin, "mktemp"),
    `#!/bin/bash
set -euo pipefail
while [[ "$#" -gt 0 && "$1" == -* ]]; do shift; done
template="$1"
path="\${template%XXXXXX}fixture-$$-$RANDOM"
: >"$path"
/bin/chmod 600 "$path"
printf '%s\\n' "$path"
`,
  );
  await writeExecutable(
    join(fakeBin, "chown"),
    "#!/bin/bash\nexit 0\n",
  );
  await writeExecutable(
    join(fakeBin, "flock"),
    `#!/bin/bash
set -euo pipefail
[[ "$#" -eq 2 && "$1" == '-n' && "$2" == '8' ]]
[[ ! -f ${quoteShell(join(root, "lifecycle-lock-contended"))} ]]
`,
  );
  await writeExecutable(
    join(fakeBin, "mv"),
    `#!/bin/bash
set -euo pipefail
while [[ "$#" -gt 0 && "$1" == -* ]]; do shift; done
[[ "\${1:-}" != '--' ]] || shift
[[ "$#" -eq 2 ]]
exec /bin/mv -f "$1" "$2"
`,
  );
  await writeExecutable(
    nodeBinary,
    `#!/bin/bash
set -euo pipefail
if [[ "$*" == *fsyncSync* &&
      -f ${quoteShell(join(root, "fail-after-anchor"))} &&
      -e ${quoteShell(anchor)} && ! -e ${quoteShell(pending)} ]]; then
  exit 97
fi
exec ${quotedRealNode} "$@"
`,
  );

  return {
    anchor,
    backupsRoot,
    committed,
    currentLink,
    deployRoot,
    fakePath: `${fakeBin}:${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    lifecycleLock,
    manifest,
    nginxSitesRoot,
    nodeBinary,
    pending,
    previousRelease,
    rolledBack,
    root,
    sharedRoot,
    stateDir,
  };
}

export async function createPreparePreflightFixture(
  readyKind: "absent" | "file" | "symlink",
): Promise<{
  backupRoot: string;
  buildRoot: string;
  buildWorkspaceRoot: string;
  deployRoot: string;
  environmentBackup: string;
  environmentPath: string;
  fakeBin: string;
  fakePath: string;
  lifecycleLock: string;
  nodeBinary: string;
  nginxAlternateBackup: string;
  nginxPrimaryBackup: string;
  operationLog: string;
  previousReleaseFile: string;
  releaseDir: string;
  root: string;
  sharedRoot: string;
}> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "diesel-prepare-release-")),
  );
  const deployRoot = join(root, "deploy");
  const releaseRoot = join(deployRoot, "releases");
  const releaseDir = join(releaseRoot, TEST_RELEASE_SHA);
  const buildRoot = join(deployRoot, "build");
  const buildLockPath = join(deployRoot, ".release-build.lock");
  const lifecycleLock = join(deployRoot, ".release-lifecycle.lock");
  const buildWorkspaceRoot = join(deployRoot, "build-workspaces");
  const sharedRoot = join(deployRoot, "shared");
  const dataRoot = join(sharedRoot, ".data");
  const stateRoot = join(deployRoot, "backups", TEST_RELEASE_SHA);
  const backupRoot = join(deployRoot, "backups");
  const environmentPath = join(sharedRoot, ".env.production.local");
  const environmentBackup = join(
    stateRoot,
    "env.production.local.pre-switch",
  );
  const fakeBin = join(root, "bin");
  const previousReleaseFile = join(stateRoot, "previous-release");
  const nginxPrimaryBackup = join(stateRoot, "jamesky.site.pre-switch");
  const nginxAlternateBackup = join(stateRoot, "diesel-demo.pre-switch");
  const nodeBinary = join(fakeBin, "node");
  const operationLog = join(root, "prepare-operations.log");
  const normalizedMetadataMarker = join(root, "release-normalized");
  const databaseEnvironment =
    "DATABASE_URL=postgresql://fixture:fixture@database.invalid/diesel\n";
  await Promise.all([
    mkdir(releaseDir, { recursive: true }),
    mkdir(buildRoot, { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
    mkdir(stateRoot, { recursive: true }),
    mkdir(fakeBin),
  ]);
  await Promise.all([
    writeFile(environmentPath, databaseEnvironment, "utf8"),
    writeFile(environmentBackup, databaseEnvironment, "utf8"),
    writeFile(previousReleaseFile, `${releaseDir}\n`, "utf8"),
    writeFile(nginxPrimaryBackup, "primary Nginx backup\n", "utf8"),
    writeFile(nginxAlternateBackup, "alternate Nginx backup\n", "utf8"),
    writeFile(buildLockPath, "", "utf8"),
    writeFile(lifecycleLock, "", "utf8"),
  ]);
  const readyPath = join(releaseDir, ".deploy-ready");
  if (readyKind === "file") {
    await writeFile(readyPath, "premature\n", "utf8");
  } else if (readyKind === "symlink") {
    await symlink(join(root, "missing-ready-target"), readyPath);
  }

  await writeExecutable(
    join(fakeBin, "id"),
    `#!/bin/bash
set -euo pipefail
case "\${1:-}:\${2:-}" in
  -u:) printf '0\\n' ;;
  -u:diesel|-g:diesel|-G:diesel) printf '1001\\n' ;;
  -u:diesel-build|-g:diesel-build|-G:diesel-build) printf '1002\\n' ;;
  *) echo "unexpected id arguments: $*" >&2; exit 98 ;;
esac
`,
  );
  await writeExecutable(
    join(fakeBin, "corepack"),
    "#!/bin/bash\necho 'corepack must not be called' >&2\nexit 99\n",
  );
  await writeExecutable(
    join(fakeBin, "runuser"),
    `#!/bin/bash
echo 'fake runuser invoked' >&2
exit "\${PREPARE_TEST_RUNUSER_STATUS:-99}"
`,
  );
  for (const commandName of [
    "findmnt",
    "pgrep",
    "systemctl",
    "systemd",
    "systemd-run",
    "timeout",
  ]) {
    await writeExecutable(
      join(fakeBin, commandName),
      `#!/bin/bash\necho '${commandName} must be overridden in this fixture' >&2\nexit 99\n`,
    );
  }
  await writeExecutable(
    join(fakeBin, "flock"),
    '#!/bin/bash\nexit "${PREPARE_TEST_FLOCK_STATUS:-0}"\n',
  );
  await writeExecutable(
    join(fakeBin, "realpath"),
    await createPrepareRealpathShim(lifecycleLock, root),
  );
  await writeExecutable(
    nodeBinary,
    `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == '-e' && "\${2:-}" == *parseEnv* && "\${2:-}" == *fsyncSync* ]]; then
  printf 'database-identity-start\n' >>${quoteShell(operationLog)}
  set +e
  ${quoteShell(process.execPath)} "$@"
  status="$?"
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'database-identity-fsync-complete\n' >>${quoteShell(operationLog)}
  fi
  exit "$status"
fi
if [[ "\${1:-}" == '-e' && "\${2:-}" == *readdirSync* ]]; then
  printf 'candidate-boundary:%s\n' "\${4:-}" >>${quoteShell(operationLog)}
  if [[ "\${PREPARE_TEST_CANDIDATE_BOUNDARY_STATUS:-0}" != '0' ]]; then
    printf 'candidate filesystem boundary validation failed\n' >&2
    exit "\${PREPARE_TEST_CANDIDATE_BOUNDARY_STATUS}"
  fi
  exit 0
fi
if [[ "\${1:-}" == '-e' && "\${2:-}" == *'candidate inode durability proof failed'* ]]; then
  after_separator=0
  for argument in "$@"; do
    if [[ "$after_separator" -eq 1 ]]; then
      printf 'candidate-fsync:%s\n' "$argument" >>${quoteShell(operationLog)}
    elif [[ "$argument" == '--' ]]; then
      after_separator=1
    fi
  done
  if [[ "\${PREPARE_TEST_CANDIDATE_FSYNC_STATUS:-0}" != '0' ]]; then
    printf 'candidate inode durability proof failed\n' >&2
    exit "\${PREPARE_TEST_CANDIDATE_FSYNC_STATUS}"
  fi
  exit 0
fi
if [[ "\${1:-}" == '-e' && "\${2:-}" == *fsyncSync* ]]; then
  after_separator=0
  for argument in "$@"; do
    if [[ "$after_separator" -eq 1 ]]; then
      printf 'rollback-basis:%s\n' "$argument" >>${quoteShell(operationLog)}
    elif [[ "$argument" == '--' ]]; then
      after_separator=1
    fi
  done
  if [[ "\${PREPARE_TEST_ROLLBACK_FSYNC_STATUS:-0}" != '0' ]]; then
    printf 'rollback basis durability proof failed\n' >&2
    exit "\${PREPARE_TEST_ROLLBACK_FSYNC_STATUS}"
  fi
fi
exec ${quoteShell(process.execPath)} "$@"
`,
  );
  await writeExecutable(
    join(fakeBin, "sync"),
    `#!/bin/bash
set -euo pipefail
printf 'candidate-sync:%s\n' "$*" >>${quoteShell(operationLog)}
if [[ "\${PREPARE_TEST_CANDIDATE_SYNC_STATUS:-0}" != '0' ]]; then
  exit "\${PREPARE_TEST_CANDIDATE_SYNC_STATUS}"
fi
`,
  );
  await writeExecutable(
    join(fakeBin, "chown"),
    `#!/bin/bash
set -euo pipefail
for argument in "$@"; do
  if [[ "$argument" == ${quoteShell(releaseDir)} ]]; then
    : >${quoteShell(normalizedMetadataMarker)}
  fi
done
`,
  );
  await writeExecutable(join(fakeBin, "chmod"), "#!/bin/bash\nexit 0\n");
  await writeExecutable(
    join(fakeBin, "install"),
    `#!/bin/bash
set -euo pipefail
directory_mode=0
declare -a operands=()
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -d) directory_mode=1; shift ;;
    -m|-o|-g) shift 2 ;;
    --) shift ;;
    *) operands+=("$1"); shift ;;
  esac
done
if [[ "$directory_mode" -eq 1 ]]; then
  mkdir -p -- "\${operands[@]}"
else
  target="\${operands[\${#operands[@]}-1]}"
  mkdir -p -- "$(dirname -- "$target")"
  : >"$target"
fi
`,
  );
  const inputManifest = join(releaseDir, ".release-input-manifest.json");
  const nextEnvironment = join(releaseDir, "next-env.d.ts");
  const buildScript = join(releaseDir, "scripts", "deploy", "build-release.sh");
  const inputManifestScript = join(
    releaseDir,
    "scripts",
    "deploy",
    "release-input-manifest.mjs",
  );
  const artifactScript = join(
    releaseDir,
    "scripts",
    "deploy",
    "release-artifact-manifest.mjs",
  );
  const hostActivationLedger = join(
    releaseDir,
    "scripts",
    "deploy",
    "host-activation-ledger.sh",
  );
  await mkdir(dirname(hostActivationLedger), { recursive: true });
  await writeFile(nextEnvironment, "// fixture Next environment\n", "utf8");
  await writeExecutable(hostActivationLedger, "#!/bin/bash\n");
  const metadata = new Map<string, string>([
    [deployRoot, "root:root:755"],
    [releaseRoot, "root:root:755"],
    [releaseDir, "root:diesel:750"],
    [buildRoot, "root:diesel-build:710"],
    [buildLockPath, "root:root:600"],
    [lifecycleLock, "root:root:600"],
    [sharedRoot, "root:diesel:750"],
    [dataRoot, "diesel:diesel:750"],
    [backupRoot, "root:root:700"],
    [stateRoot, "root:root:700"],
    [environmentPath, "root:diesel:640"],
    [environmentBackup, "root:root:600"],
    [previousReleaseFile, "root:root:600"],
    [nginxPrimaryBackup, "root:root:600"],
    [nginxAlternateBackup, "root:root:600"],
    [buildWorkspaceRoot, "root:diesel-build:710"],
    [inputManifest, "root:diesel:640"],
    [nextEnvironment, "root:diesel:640"],
    [buildScript, "root:diesel:750"],
    [inputManifestScript, "root:diesel:640"],
    [artifactScript, "root:diesel:640"],
  ]);
  const metadataCases = [...metadata]
    .map(([path, value]) => `  ${quoteShell(path)}) printf '%s\\n' ${quoteShell(value)} ;;`)
    .join("\n");
  await writeExecutable(
    join(fakeBin, "stat"),
    `#!/bin/bash
set -euo pipefail
path="\${!#}"
case "$path" in
  ${quoteShell(hostActivationLedger)})
    if [[ -f ${quoteShell(normalizedMetadataMarker)} ]]; then
      if [[ "\${2:-}" == *'%h'* ]]; then
        printf '%s\n' 'root:diesel:750:1'
      else
        printf '%s\n' 'root:diesel:750'
      fi
    else
      printf '%s\n' 'root:root:755:1'
    fi
    ;;
${metadataCases}
  *) echo "unexpected stat target: $path" >&2; exit 98 ;;
esac
`,
  );

  return {
    backupRoot,
    buildRoot,
    buildWorkspaceRoot,
    deployRoot,
    environmentBackup,
    environmentPath,
    fakeBin,
    fakePath:
      `${fakeBin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    lifecycleLock,
    nodeBinary,
    nginxAlternateBackup,
    nginxPrimaryBackup,
    operationLog,
    previousReleaseFile,
    releaseDir,
    root,
    sharedRoot,
  };
}
