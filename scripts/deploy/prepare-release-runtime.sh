#!/bin/bash

# This file is intentionally sourceable so the root-side build handoff can be
# exercised against an isolated filesystem fixture. The CLI entry point fixes
# every production path; callers cannot override them with environment values.

prepare_release_cli_bootstrap_metadata_is_allowed() {
  local profile="$1"
  local metadata="$2"

  case "${profile}:${metadata}" in
    system-directory:root:root:755 | \
      release-directory:root:root:755 | \
      release-directory:root:diesel:750 | \
      release-executable:root:root:755:1 | \
      release-executable:root:diesel:750:1) return 0 ;;
    *) return 1 ;;
  esac
}

prepare_release_require_cli_bootstrap_path() {
  local path="$1"
  local profile="$2"
  local canonical_path
  local metadata

  case "${profile}" in
    system-directory | release-directory)
      [[ -d "${path}" && ! -L "${path}" ]] || return 1
      metadata="$(/usr/bin/stat -c '%U:%G:%a' -- "${path}" 2>/dev/null)" ||
        return 1
      ;;
    release-executable)
      [[ -f "${path}" && ! -L "${path}" && -x "${path}" ]] || return 1
      metadata="$(/usr/bin/stat -c '%U:%G:%a:%h' -- "${path}" 2>/dev/null)" ||
        return 1
      ;;
    *) return 1 ;;
  esac
  canonical_path="$(/usr/bin/realpath -e -- "${path}" 2>/dev/null)" || return 1
  [[ "${canonical_path}" == "${path}" ]] || return 1
  prepare_release_cli_bootstrap_metadata_is_allowed "${profile}" "${metadata}"
}

prepare_release_sourced_production_root_is_selected() {
  local deploy_root="$1"
  local canonical_root

  [[ "${BASH_SOURCE[0]}" != "$0" ]] || return 1
  if [[ "${deploy_root}" =~ ^/+opt/+diesel/*$ ]]; then
    return 0
  fi
  [[ -x /usr/bin/realpath ]] || return 1
  canonical_root="$(/usr/bin/realpath -e -- "${deploy_root}" 2>/dev/null)" ||
    return 1
  [[ "${canonical_root}" == "/opt/diesel" ]]
}

prepare_release_cli_bootstrap() {
  if [[ "$#" -ne 3 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
    return 64
  fi
  local release_id="$1"
  local deploy_root="$2"
  local observed_entry="$3"

  if prepare_release_sourced_production_root_is_selected "${deploy_root}"; then
    return 64
  fi
  local expected_release="${deploy_root}/releases/${release_id}"
  local expected_entry="${expected_release}/scripts/deploy/prepare-release-runtime.sh"
  local expected_ledger="${expected_release}/scripts/deploy/host-activation-ledger.sh"

  if [[ "${observed_entry}" != "${expected_entry}" ]]; then
    return 70
  fi
  if ! prepare_release_require_cli_bootstrap_path /opt system-directory ||
    ! prepare_release_require_cli_bootstrap_path \
      "${deploy_root}" system-directory ||
    ! prepare_release_require_cli_bootstrap_path \
      "${deploy_root}/releases" system-directory ||
    ! prepare_release_require_cli_bootstrap_path \
      "${expected_release}" release-directory ||
    ! prepare_release_require_cli_bootstrap_path \
      "${expected_release}/scripts" release-directory ||
    ! prepare_release_require_cli_bootstrap_path \
      "${expected_release}/scripts/deploy" release-directory ||
    ! prepare_release_require_cli_bootstrap_path \
      "${expected_entry}" release-executable ||
    ! prepare_release_require_cli_bootstrap_path \
      "${expected_ledger}" release-executable; then
    return 70
  fi
  export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
  source -- "${expected_ledger}" || return 70
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
    echo "usage: prepare-release-runtime.sh <full-lowercase-git-commit-sha>" >&2
    exit 64
  fi
  if prepare_release_cli_bootstrap \
    "$1" "/opt/diesel" "${BASH_SOURCE[0]}"; then
    :
  else
    prepare_release_bootstrap_status=$?
    echo "runtime preparation pre-source trust validation failed" >&2
    exit "${prepare_release_bootstrap_status}"
  fi
  unset prepare_release_bootstrap_status
else
  prepare_release_script_directory="${BASH_SOURCE[0]%/*}"
  if [[ "${prepare_release_script_directory}" == "${BASH_SOURCE[0]}" ]]; then
    prepare_release_script_directory='.'
  fi
  if source -- "${prepare_release_script_directory}/host-activation-ledger.sh"; then
    unset prepare_release_script_directory
  else
    prepare_release_source_status=$?
    unset prepare_release_script_directory
    return "${prepare_release_source_status}"
  fi
fi

prepare_release_usage() {
  echo "usage: prepare-release-runtime.sh <full-lowercase-git-commit-sha>" >&2
}

prepare_release_fail() {
  local status="$1"
  shift
  echo "$*" >&2
  return "${status}"
}

prepare_release_effective_uid() {
  printf '%s\n' "${EUID}"
}

prepare_release_require_trusted_bootstrap_directory() {
  local path="$1"
  local expected_metadata="$2"
  local label="$3"
  local canonical_path
  local actual_metadata

  if [[ ! -d "${path}" || -L "${path}" ]] ||
    ! canonical_path="$(/usr/bin/realpath -e -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]] ||
    ! actual_metadata="$(/usr/bin/stat -c '%u:%g:%a' -- "${path}")" ||
    [[ "${actual_metadata}" != "${expected_metadata}" ]]; then
    prepare_release_fail 70 \
      "${label} is outside the fixed root bootstrap directory profile"
    return
  fi
}

prepare_release_require_trusted_bootstrap_executable() {
  local path="$1"
  local label="$2"
  local canonical_path
  local metadata
  local owner
  local group
  local mode
  local permissions

  if [[ ! -f "${path}" || ! -x "${path}" ]] ||
    ! canonical_path="$(/usr/bin/realpath -e -- "${path}")" ||
    ! metadata="$(/usr/bin/stat -c '%u:%g:%a' -- "${canonical_path}")"; then
    prepare_release_fail 70 "${label} is not a trusted host executable"
    return
  fi
  IFS=: read -r owner group mode <<<"${metadata}"
  if [[ "${owner}" != "0" || "${group}" != "0" ||
    ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    prepare_release_fail 70 "${label} has unsafe host metadata"
    return
  fi
  permissions=$((8#${mode}))
  if (( (permissions & 07000) != 0 || (permissions & 0022) != 0 ||
    (permissions & 0100) == 0 )); then
    prepare_release_fail 70 \
      "${label} is writable outside root, has special bits, or is not root-executable"
    return
  fi
}

prepare_release_require_fixed_root_command_boundary() {
  local fixed_vps_path="$1"
  local node_binary="$2"
  local node_root="/opt/node-v22.22.3-linux-x64"
  local command_name
  local command_spec
  local expected_path
  local resolved_path
  local node_version
  local -a command_specs=(
    "bash:/usr/bin/bash"
    "chmod:/usr/bin/chmod"
    "chown:/usr/bin/chown"
    "cmp:/usr/bin/cmp"
    "cp:/usr/bin/cp"
    "env:/usr/bin/env"
    "find:/usr/bin/find"
    "findmnt:/usr/bin/findmnt"
    "flock:/usr/bin/flock"
    "id:/usr/bin/id"
    "install:/usr/bin/install"
    "ln:/usr/bin/ln"
    "mktemp:/usr/bin/mktemp"
    "pgrep:/usr/bin/pgrep"
    "realpath:/usr/bin/realpath"
    "rm:/usr/bin/rm"
    "runuser:/usr/sbin/runuser"
    "sh:/usr/bin/sh"
    "sha256sum:/usr/bin/sha256sum"
    "sleep:/usr/bin/sleep"
    "sort:/usr/bin/sort"
    "stat:/usr/bin/stat"
    "sync:/usr/bin/sync"
    "systemctl:/usr/bin/systemctl"
    "systemd:/usr/bin/systemd"
    "systemd-run:/usr/bin/systemd-run"
    "timeout:/usr/bin/timeout"
  )

  if [[ "${fixed_vps_path}" != \
      "${node_root}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" ||
    "${node_binary}" != "${node_root}/bin/node" ]]; then
    prepare_release_fail 70 "runtime preparation requires the fixed host command profile"
    return
  fi
  prepare_release_require_trusted_bootstrap_directory \
    /opt "0:0:755" "fixed Node parent" || return $?
  prepare_release_require_trusted_bootstrap_directory \
    "${node_root}" "0:0:755" "fixed Node root" || return $?
  prepare_release_require_trusted_bootstrap_directory \
    "${node_root}/bin" "0:0:755" "fixed Node bin" || return $?
  prepare_release_require_trusted_bootstrap_directory \
    /usr/local "0:0:755" "local host command root" || return $?
  prepare_release_require_trusted_bootstrap_directory \
    /usr/local/sbin "0:0:755" "local host sbin directory" || return $?
  prepare_release_require_trusted_bootstrap_directory \
    /usr/local/bin "0:0:755" "local host bin directory" || return $?
  if [[ ! -f "${node_binary}" || -L "${node_binary}" ||
    ! -x "${node_binary}" ]] ||
    [[ "$(/usr/bin/realpath -e -- "${node_binary}")" != "${node_binary}" ]] ||
    [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${node_binary}")" != \
      "0:0:755:1" ]] ||
    ! node_version="$("${node_binary}" --version)" ||
    [[ "${node_version}" != "v22.22.3" ]]; then
    prepare_release_fail 70 "fixed Node.js runtime is outside the host bootstrap profile"
    return
  fi
  prepare_release_require_trusted_bootstrap_executable \
    "${node_root}/bin/corepack" "fixed Corepack launcher" || return $?

  # Root preparation uses only the fixed system command set. The application
  # PATH is passed separately to the unprivileged transient builder.
  export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
  for command_spec in "${command_specs[@]}"; do
    command_name="${command_spec%%:*}"
    expected_path="${command_spec#*:}"
    resolved_path="$(command -v "${command_name}")"
    if [[ "${resolved_path}" != "${expected_path}" ]]; then
      prepare_release_fail 70 \
        "runtime preparation command does not resolve to its fixed host path: ${command_name}"
      return
    fi
    prepare_release_require_trusted_bootstrap_executable \
      "${expected_path}" "fixed runtime command ${command_name}" || return $?
  done
  if [[ "$(type -t test)" != builtin ]]; then
    prepare_release_fail 70 "runtime preparation requires the Bash test builtin"
    return
  fi
}

prepare_release_is_commit() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

prepare_release_require_directory() {
  local path="$1"
  local expected_metadata="$2"
  local label="$3"
  local canonical_path
  local actual_metadata

  if [[ ! -d "${path}" || -L "${path}" ]]; then
    prepare_release_fail 70 "${label} must be a real directory: ${path}"
    return
  fi
  if ! canonical_path="$(realpath -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]]; then
    prepare_release_fail 70 "${label} must not traverse a symlink: ${path}"
    return
  fi
  actual_metadata="$(stat -c '%U:%G:%a' -- "${path}")"
  if [[ "${actual_metadata}" != "${expected_metadata}" ]]; then
    prepare_release_fail 70 \
      "${label} has unexpected ownership or permissions: ${path}"
    return
  fi
}

prepare_release_require_file() {
  local path="$1"
  local expected_metadata="$2"
  local executable_required="$3"
  local label="$4"
  local canonical_path
  local actual_metadata

  if [[ ! -f "${path}" || -L "${path}" ]]; then
    prepare_release_fail 70 "${label} must be a regular non-symlink file: ${path}"
    return
  fi
  if ! canonical_path="$(realpath -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]]; then
    prepare_release_fail 70 "${label} must not traverse a symlink: ${path}"
    return
  fi
  actual_metadata="$(stat -c '%U:%G:%a' -- "${path}")"
  if [[ "${actual_metadata}" != "${expected_metadata}" ]]; then
    prepare_release_fail 70 \
      "${label} has unexpected ownership or permissions: ${path}"
    return
  fi
  if [[ "${executable_required}" == "yes" && ! -x "${path}" ]]; then
    prepare_release_fail 70 "${label} must be executable: ${path}"
    return
  fi
}

# A newly rsynced candidate is root-owned with umask-022 modes. A retry after
# this preparer has normalized the immutable source tree is root:diesel with no
# access for other users. Accept only those two closed metadata states before
# the first recursive normalization, then require the exact runtime state again
# immediately after normalization.
prepare_release_require_staged_or_normalized_executable() {
  local path="$1"
  local label="$2"
  local canonical_path
  local actual_metadata

  if [[ ! -f "${path}" || -L "${path}" || ! -x "${path}" ]]; then
    prepare_release_fail 70 \
      "${label} must be a regular non-symlink executable: ${path}"
    return
  fi
  if ! canonical_path="$(realpath -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]]; then
    prepare_release_fail 70 "${label} must not traverse a symlink: ${path}"
    return
  fi
  actual_metadata="$(stat -c '%U:%G:%a:%h' -- "${path}")"
  case "${actual_metadata}" in
    root:root:755:1 | root:diesel:750:1) ;;
    *)
      prepare_release_fail 70 \
        "${label} has unexpected staged or normalized metadata: ${path}"
      return
      ;;
  esac
}

prepare_release_require_absent() {
  local path="$1"
  local label="$2"

  if [[ -e "${path}" || -L "${path}" ]]; then
    prepare_release_fail 70 "${label} must not exist before runtime preparation: ${path}"
    return
  fi
}

prepare_release_require_stable_database_identity() {
  if [[ "$#" -ne 4 ]]; then
    prepare_release_fail 64 \
      "database identity validation requires four fixed runtime paths"
    return
  fi

  local node_binary="$1"
  local environment_backup="$2"
  local environment_path="$3"
  local shared_root="$4"

  "${node_binary}" -e '
    const { closeSync, fsyncSync, openSync, readFileSync } = require("node:fs");
    const { parseEnv } = require("node:util");

    const [backupPath, livePath, sharedRoot] = process.argv.slice(1);
    const invalidMessage =
      "runtime database identity is missing or invalid\n";
    const changedMessage =
      "runtime database identity changed across the release boundary\n";
    const durabilityMessage =
      "runtime environment durability proof failed\n";

    let backupEnvironment;
    let liveEnvironment;
    try {
      if (typeof parseEnv !== "function") throw new Error("parseEnv unavailable");
      backupEnvironment = parseEnv(readFileSync(backupPath, "utf8"));
      liveEnvironment = parseEnv(readFileSync(livePath, "utf8"));
    } catch {
      process.stderr.write(invalidMessage);
      process.exit(70);
    }

    const backupDatabaseUrl = backupEnvironment.DATABASE_URL;
    const liveDatabaseUrl = liveEnvironment.DATABASE_URL;
    const hasPostgresProtocol = (value) => {
      if (typeof value !== "string" || value.length === 0) return false;
      try {
        const protocol = new URL(value).protocol;
        return protocol === "postgres:" || protocol === "postgresql:";
      } catch {
        return false;
      }
    };
    if (
      !hasPostgresProtocol(backupDatabaseUrl) ||
      !hasPostgresProtocol(liveDatabaseUrl)
    ) {
      process.stderr.write(invalidMessage);
      process.exit(70);
    }
    if (backupDatabaseUrl !== liveDatabaseUrl) {
      process.stderr.write(changedMessage);
      process.exit(70);
    }

    try {
      for (const path of [livePath, sharedRoot]) {
        const descriptor = openSync(path, "r");
        try {
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
      }
    } catch {
      process.stderr.write(durabilityMessage);
      process.exit(70);
    }
  ' -- "${environment_backup}" "${environment_path}" "${shared_root}"
}

prepare_release_fsync_rollback_basis() {
  if [[ "$#" -lt 2 ]]; then
    prepare_release_fail 64 \
      "rollback durability validation requires fixed runtime paths"
    return
  fi

  local node_binary="$1"
  shift

  "${node_binary}" -e '
    const { closeSync, fsyncSync, openSync } = require("node:fs");
    try {
      for (const path of process.argv.slice(1)) {
        const descriptor = openSync(path, "r");
        try {
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
      }
    } catch {
      process.stderr.write("rollback basis durability proof failed\n");
      process.exit(70);
    }
  ' -- "$@"
}

prepare_release_persist_candidate() {
  if [[ "$#" -ne 6 ]]; then
    prepare_release_fail 64 \
      "candidate durability validation requires six fixed runtime paths"
    return
  fi

  local node_binary="$1"
  local release_dir="$2"
  local release_root="$3"
  local deploy_root="$4"
  local build_marker="$5"
  local ready_marker="$6"

  # Never follow symlinks while proving that the candidate tree lives on one
  # filesystem. The shared environment and data links are intentionally part
  # of the release, but their targets must not expand the durability boundary.
  if ! "${node_binary}" -e '
    const { lstatSync, readdirSync } = require("node:fs");
    const { join } = require("node:path");

    const root = process.argv[1];
    try {
      const rootDevice = lstatSync(root, { bigint: true }).dev;
      const pending = [root];
      while (pending.length > 0) {
        const path = pending.pop();
        const metadata = lstatSync(path, { bigint: true });
        if (metadata.dev !== rootDevice) {
          throw new Error("nested filesystem");
        }
        if (!metadata.isDirectory()) continue;
        for (const entry of readdirSync(path)) {
          pending.push(join(path, entry));
        }
      }
    } catch {
      process.stderr.write("candidate filesystem boundary validation failed\n");
      process.exit(70);
    }
  ' -- "${release_dir}"; then
    return 70
  fi

  # sync -f flushes every dirty inode on each containing filesystem. Listing
  # all three levels also covers a release mount that differs from its parents.
  if ! sync -f -- "${release_dir}" "${release_root}" "${deploy_root}"; then
    prepare_release_fail 70 "candidate filesystem durability proof failed"
    return
  fi

  if ! "${node_binary}" -e '
    const { closeSync, fsyncSync, openSync } = require("node:fs");
    try {
      for (const path of process.argv.slice(1)) {
        const descriptor = openSync(path, "r");
        try {
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
      }
    } catch {
      process.stderr.write("candidate inode durability proof failed\n");
      process.exit(70);
    }
  ' -- \
    "${build_marker}" \
    "${ready_marker}" \
    "${release_dir}/node_modules" \
    "${release_dir}/.next" \
    "${release_dir}" \
    "${release_root}" \
    "${deploy_root}"; then
    return 70
  fi
}

prepare_release_require_identity_boundary() {
  local runtime_uid
  local runtime_gid
  local runtime_groups
  local builder_uid
  local builder_gid
  local builder_groups
  local group_id

  if ! runtime_uid="$(id -u diesel)" ||
    ! runtime_gid="$(id -g diesel)" ||
    ! runtime_groups="$(id -G diesel)" ||
    ! builder_uid="$(id -u diesel-build)" ||
    ! builder_gid="$(id -g diesel-build)" ||
    ! builder_groups="$(id -G diesel-build)"; then
    prepare_release_fail 70 "runtime and build identities must exist"
    return
  fi
  for identity_value in \
    "${runtime_uid}" "${runtime_gid}" "${builder_uid}" "${builder_gid}"; do
    if [[ ! "${identity_value}" =~ ^[0-9]+$ ]]; then
      prepare_release_fail 70 "runtime and build identities must use numeric IDs"
      return
    fi
  done
  if [[ ! "${runtime_groups}" =~ ^[0-9]+([[:space:]][0-9]+)*$ ]] ||
    [[ ! "${builder_groups}" =~ ^[0-9]+([[:space:]][0-9]+)*$ ]]; then
    prepare_release_fail 70 "runtime and build group membership is invalid"
    return
  fi
  if [[ "${runtime_uid}" -eq 0 || "${builder_uid}" -eq 0 ||
    "${runtime_uid}" -eq "${builder_uid}" ||
    "${runtime_gid}" -eq 0 || "${builder_gid}" -eq 0 ||
    "${runtime_gid}" -eq "${builder_gid}" ]]; then
    prepare_release_fail 70 "runtime and build identities must be distinct and unprivileged"
    return
  fi
  for group_id in ${builder_groups}; do
    if [[ "${group_id}" -eq "${runtime_gid}" ]]; then
      prepare_release_fail 70 "diesel-build must not belong to the diesel runtime group"
      return
    fi
  done
  for group_id in ${runtime_groups}; do
    if [[ "${group_id}" -eq "${builder_gid}" ]]; then
      prepare_release_fail 70 "diesel must not belong to the diesel-build group"
      return
    fi
  done
  if [[ "${runtime_groups}" != "${runtime_gid}" ||
    "${builder_groups}" != "${builder_gid}" ]]; then
    prepare_release_fail 70 \
      "runtime and build identities must not have supplementary groups"
    return
  fi
}

prepare_release_remove_exact_directory() {
  local path="$1"
  local parent="$2"
  local release_id="$3"
  local label="$4"
  local canonical_parent
  local canonical_path

  if ! prepare_release_is_commit "${release_id}" ||
    [[ "${path}" != "${parent}/${release_id}" ]] ||
    [[ ! -d "${parent}" || -L "${parent}" ]] ||
    ! canonical_parent="$(realpath -- "${parent}")" ||
    [[ "${canonical_parent}" != "${parent}" ]]; then
    prepare_release_fail 70 "refusing to remove an unexpected ${label}"
    return
  fi
  if [[ ! -e "${path}" && ! -L "${path}" ]]; then
    return 0
  fi
  if [[ ! -d "${path}" || -L "${path}" ]] ||
    ! canonical_path="$(realpath -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]]; then
    prepare_release_fail 70 "refusing to remove a replaced ${label}"
    return
  fi
  rm -rf -- "${path}"
}

prepare_release_require_systemd_host() {
  local proc_root="$1"
  local pid_one_comm=''
  local cgroup_filesystem=''
  local manager_state=''
  local manager_status=0
  local manager_version_output=''
  local manager_version=''
  local version_output=''
  local version_line=''
  local expected_version=''
  local command_name
  local command_version

  if [[ "${proc_root}" != /proc || ! -d "${proc_root}" ||
    -L "${proc_root}" ]]; then
    prepare_release_fail 70 "runtime preparation requires the real /proc filesystem"
    return
  fi
  if ! IFS= read -r pid_one_comm <"${proc_root}/1/comm" ||
    [[ "${pid_one_comm}" != systemd ]]; then
    prepare_release_fail 70 "runtime preparation requires systemd as PID 1"
    return
  fi
  if [[ ! -d /run/systemd/system || -L /run/systemd/system ]] ||
    [[ ! -f /sys/fs/cgroup/cgroup.controllers ||
      -L /sys/fs/cgroup/cgroup.controllers ||
      ! -r /sys/fs/cgroup/cgroup.controllers ]]; then
    prepare_release_fail 70 "runtime preparation requires a reachable cgroup v2 systemd manager"
    return
  fi
  cgroup_filesystem="$(findmnt -n -o FSTYPE --target /sys/fs/cgroup)" || {
    prepare_release_fail 70 "runtime preparation could not inspect the cgroup filesystem"
    return
  }
  if [[ "${cgroup_filesystem}" != cgroup2 ]]; then
    prepare_release_fail 70 "runtime preparation requires the unified cgroup v2 hierarchy"
    return
  fi

  for command_name in systemd systemctl systemd-run; do
    version_output="$("${command_name}" --version)" || {
      prepare_release_fail 70 "${command_name} version lookup failed"
      return
    }
    version_line="${version_output%%$'\n'*}"
    if [[ ! "${version_line}" =~ ^systemd[[:space:]]+([0-9]+) ]]; then
      prepare_release_fail 70 "${command_name} returned an unrecognized version"
      return
    fi
    command_version="${BASH_REMATCH[1]}"
    if [[ "${command_version}" -lt 245 ]]; then
      prepare_release_fail 70 "systemd 245 or newer is required"
      return
    fi
    if [[ -z "${expected_version}" ]]; then
      expected_version="${command_version}"
    elif [[ "${command_version}" != "${expected_version}" ]]; then
      prepare_release_fail 70 "systemd manager and client versions must match"
      return
    fi
  done

  manager_version_output="$(
    timeout --foreground --signal=TERM --kill-after=2s 10s \
      systemctl show --property=Version --value
  )" || {
    prepare_release_fail 70 "systemd manager version lookup failed"
    return
  }
  if [[ ! "${manager_version_output}" =~ ^([0-9]+)($|[.+~_-]) ]]; then
    prepare_release_fail 70 "systemd manager returned an unrecognized version"
    return
  fi
  manager_version="${BASH_REMATCH[1]}"
  if [[ "${manager_version}" != "${expected_version}" ]]; then
    prepare_release_fail 70 "systemd manager and client versions must match"
    return
  fi

  manager_state="$(
    timeout --foreground --signal=TERM --kill-after=2s 10s \
      systemctl is-system-running
  )" || manager_status="$?"
  if [[ "${manager_state}" != running && "${manager_state}" != degraded ]]; then
    prepare_release_fail 70 \
      "systemd manager is not ready (state=${manager_state:-unknown}, status=${manager_status})"
    return
  fi
}

prepare_release_require_transient_build_commands() {
  local absolute_build_command

  for absolute_build_command in /usr/bin/env /usr/bin/bash; do
    if [[ ! -f "${absolute_build_command}" || -L "${absolute_build_command}" ||
      ! -x "${absolute_build_command}" ]]; then
      prepare_release_fail 70 \
        "transient build command is missing, symlinked, or not executable: ${absolute_build_command}"
      return
    fi
  done
}

prepare_release_uid_has_processes() {
  local uid="$1"
  local probe_status

  if pgrep -u "${uid}" >/dev/null 2>&1; then
    return 0
  else
    probe_status="$?"
  fi
  if [[ "${probe_status}" -eq 1 ]]; then
    return 1
  fi
  prepare_release_fail 70 "process lookup failed for build UID ${uid}"
}

prepare_release_control_group_has_processes() {
  local proc_root="$1"
  local control_group="$2"
  local cgroup_file
  local cgroup_contents
  local cgroup_line
  local after_hierarchy
  local member_path
  local readable_files=0
  local cgroup_files=("${proc_root}"/[0-9]*/cgroup)

  if [[ ! "${control_group}" =~ ^/system\.slice/diesel-build-[0-9a-f]{40}\.service$ ]]; then
    prepare_release_fail 70 "refusing to inspect an unexpected build control group"
    return
  fi
  for cgroup_file in "${cgroup_files[@]}"; do
    if [[ ! -e "${cgroup_file}" ]]; then
      continue
    fi
    if [[ ! -f "${cgroup_file}" || -L "${cgroup_file}" ||
      ! -r "${cgroup_file}" ]]; then
      if [[ ! -e "${cgroup_file}" ]]; then
        continue
      fi
      prepare_release_fail 70 "could not safely read process cgroup metadata"
      return
    fi
    if ! cgroup_contents="$(<"${cgroup_file}")"; then
      if [[ ! -e "${cgroup_file}" ]]; then
        continue
      fi
      prepare_release_fail 70 "process cgroup metadata read failed"
      return
    fi
    if [[ -z "${cgroup_contents}" ]]; then
      if [[ ! -e "${cgroup_file}" ]]; then
        continue
      fi
      prepare_release_fail 70 "process cgroup metadata was empty"
      return
    fi
    readable_files=$((readable_files + 1))
    while IFS= read -r cgroup_line; do
      if [[ "${cgroup_line}" != *:*:* ]]; then
        prepare_release_fail 70 "process cgroup metadata was malformed"
        return
      fi
      after_hierarchy="${cgroup_line#*:}"
      member_path="${after_hierarchy#*:}"
      if [[ "${member_path}" == "${control_group}" ||
        "${member_path}" == "${control_group}/"* ]]; then
        return 0
      fi
    done <<<"${cgroup_contents}"
  done
  if [[ "${readable_files}" -eq 0 ]]; then
    prepare_release_fail 70 "no readable process cgroup metadata was found"
    return
  fi
  return 1
}

prepare_release_control_group_is_populated() {
  local control_group="$1"
  local cgroup_directory="/sys/fs/cgroup${control_group}"
  local events_path="${cgroup_directory}/cgroup.events"
  local event_name
  local event_value
  local populated_seen=0

  if [[ ! -e "${cgroup_directory}" && ! -L "${cgroup_directory}" ]]; then
    return 1
  fi
  if [[ ! -d "${cgroup_directory}" || -L "${cgroup_directory}" ||
    ! -f "${events_path}" || -L "${events_path}" || ! -r "${events_path}" ]]; then
    prepare_release_fail 70 "build cgroup state could not be inspected safely"
    return
  fi
  while read -r event_name event_value; do
    if [[ "${event_name}" == populated ]]; then
      if [[ "${populated_seen}" -ne 0 ||
        ( "${event_value}" != 0 && "${event_value}" != 1 ) ]]; then
        prepare_release_fail 70 "build cgroup populated state was malformed"
        return
      fi
      populated_seen=1
      if [[ "${event_value}" == 1 ]]; then
        return 0
      fi
    fi
  done <"${events_path}"
  if [[ "${populated_seen}" -ne 1 ]]; then
    prepare_release_fail 70 "build cgroup populated state was missing"
    return
  fi
  return 1
}

prepare_release_require_control_group_absent() {
  local control_group="$1"
  local cgroup_directory="/sys/fs/cgroup${control_group}"

  if [[ ! "${control_group}" =~ ^/system\.slice/diesel-build-[0-9a-f]{40}\.service$ ]]; then
    prepare_release_fail 70 "refusing to inspect an unexpected build control group"
    return
  fi
  if [[ -e "${cgroup_directory}" || -L "${cgroup_directory}" ]]; then
    prepare_release_fail 70 "build cgroup path still exists"
    return
  fi
}

prepare_release_load_unit_state() {
  local unit="$1"
  local show_output=''
  local show_status=0
  local property_line
  local property_name
  local property_value
  local seen_properties=' '

  PREPARE_RELEASE_UNIT_LOAD_STATE=''
  PREPARE_RELEASE_UNIT_ACTIVE_STATE=''
  PREPARE_RELEASE_UNIT_SUB_STATE=''
  PREPARE_RELEASE_UNIT_RESULT=''
  PREPARE_RELEASE_UNIT_EXEC_MAIN_CODE=''
  PREPARE_RELEASE_UNIT_EXEC_MAIN_STATUS=''
  PREPARE_RELEASE_UNIT_CONTROL_GROUP=''
  PREPARE_RELEASE_UNIT_TRANSIENT=''
  PREPARE_RELEASE_UNIT_FRAGMENT_PATH=''
  PREPARE_RELEASE_UNIT_USER=''
  PREPARE_RELEASE_UNIT_GROUP=''
  PREPARE_RELEASE_UNIT_WORKING_DIRECTORY=''
  PREPARE_RELEASE_UNIT_SLICE=''
  PREPARE_RELEASE_UNIT_KILL_MODE=''
  PREPARE_RELEASE_UNIT_DELEGATE=''
  PREPARE_RELEASE_UNIT_REMAIN_AFTER_EXIT=''
  PREPARE_RELEASE_UNIT_RESTART=''
  PREPARE_RELEASE_UNIT_TYPE=''
  PREPARE_RELEASE_UNIT_KILL_SIGNAL=''
  PREPARE_RELEASE_UNIT_FINAL_KILL_SIGNAL=''
  PREPARE_RELEASE_UNIT_SEND_SIGKILL=''
  PREPARE_RELEASE_UNIT_RUNTIME_MAX_USEC=''
  PREPARE_RELEASE_UNIT_TIMEOUT_STOP_USEC=''
  PREPARE_RELEASE_UNIT_UMASK=''
  PREPARE_RELEASE_UNIT_NO_NEW_PRIVILEGES=''
  PREPARE_RELEASE_UNIT_PROTECT_CONTROL_GROUPS=''
  PREPARE_RELEASE_UNIT_PROPERTY_COUNT=0

  show_output="$(
    timeout --foreground --signal=TERM --kill-after=2s 10s \
      systemctl show --all --no-pager "${unit}" \
      --property=LoadState \
      --property=ActiveState \
      --property=SubState \
      --property=Result \
      --property=ExecMainCode \
      --property=ExecMainStatus \
      --property=ControlGroup \
      --property=Transient \
      --property=FragmentPath \
      --property=User \
      --property=Group \
      --property=WorkingDirectory \
      --property=Slice \
      --property=KillMode \
      --property=Delegate \
      --property=RemainAfterExit \
      --property=Restart \
      --property=Type \
      --property=KillSignal \
      --property=FinalKillSignal \
      --property=SendSIGKILL \
      --property=RuntimeMaxUSec \
      --property=TimeoutStopUSec \
      --property=UMask \
      --property=NoNewPrivileges \
      --property=ProtectControlGroups
  )" || show_status="$?"
  if [[ "${show_status}" -ne 0 ]]; then
    prepare_release_fail 70 "systemd unit state query failed for ${unit}"
    return
  fi
  while IFS= read -r property_line; do
    if [[ "${property_line}" != *=* ]]; then
      prepare_release_fail 70 "systemd returned malformed unit metadata"
      return
    fi
    property_name="${property_line%%=*}"
    property_value="${property_line#*=}"
    if [[ "${seen_properties}" == *" ${property_name} "* ]]; then
      prepare_release_fail 70 "systemd returned a duplicate unit property"
      return
    fi
    seen_properties+="${property_name} "
    case "${property_name}" in
      LoadState) PREPARE_RELEASE_UNIT_LOAD_STATE="${property_value}" ;;
      ActiveState) PREPARE_RELEASE_UNIT_ACTIVE_STATE="${property_value}" ;;
      SubState) PREPARE_RELEASE_UNIT_SUB_STATE="${property_value}" ;;
      Result) PREPARE_RELEASE_UNIT_RESULT="${property_value}" ;;
      ExecMainCode) PREPARE_RELEASE_UNIT_EXEC_MAIN_CODE="${property_value}" ;;
      ExecMainStatus) PREPARE_RELEASE_UNIT_EXEC_MAIN_STATUS="${property_value}" ;;
      ControlGroup) PREPARE_RELEASE_UNIT_CONTROL_GROUP="${property_value}" ;;
      Transient) PREPARE_RELEASE_UNIT_TRANSIENT="${property_value}" ;;
      FragmentPath) PREPARE_RELEASE_UNIT_FRAGMENT_PATH="${property_value}" ;;
      User) PREPARE_RELEASE_UNIT_USER="${property_value}" ;;
      Group) PREPARE_RELEASE_UNIT_GROUP="${property_value}" ;;
      WorkingDirectory) PREPARE_RELEASE_UNIT_WORKING_DIRECTORY="${property_value}" ;;
      Slice) PREPARE_RELEASE_UNIT_SLICE="${property_value}" ;;
      KillMode) PREPARE_RELEASE_UNIT_KILL_MODE="${property_value}" ;;
      Delegate) PREPARE_RELEASE_UNIT_DELEGATE="${property_value}" ;;
      RemainAfterExit) PREPARE_RELEASE_UNIT_REMAIN_AFTER_EXIT="${property_value}" ;;
      Restart) PREPARE_RELEASE_UNIT_RESTART="${property_value}" ;;
      Type) PREPARE_RELEASE_UNIT_TYPE="${property_value}" ;;
      KillSignal) PREPARE_RELEASE_UNIT_KILL_SIGNAL="${property_value}" ;;
      FinalKillSignal) PREPARE_RELEASE_UNIT_FINAL_KILL_SIGNAL="${property_value}" ;;
      SendSIGKILL) PREPARE_RELEASE_UNIT_SEND_SIGKILL="${property_value}" ;;
      RuntimeMaxUSec) PREPARE_RELEASE_UNIT_RUNTIME_MAX_USEC="${property_value}" ;;
      TimeoutStopUSec) PREPARE_RELEASE_UNIT_TIMEOUT_STOP_USEC="${property_value}" ;;
      UMask) PREPARE_RELEASE_UNIT_UMASK="${property_value}" ;;
      NoNewPrivileges) PREPARE_RELEASE_UNIT_NO_NEW_PRIVILEGES="${property_value}" ;;
      ProtectControlGroups) PREPARE_RELEASE_UNIT_PROTECT_CONTROL_GROUPS="${property_value}" ;;
      *)
        prepare_release_fail 70 "systemd returned an unexpected unit property"
        return
        ;;
    esac
    PREPARE_RELEASE_UNIT_PROPERTY_COUNT=$((PREPARE_RELEASE_UNIT_PROPERTY_COUNT + 1))
  done <<<"${show_output}"
  if [[ "${PREPARE_RELEASE_UNIT_PROPERTY_COUNT}" -ne 26 ||
    -z "${PREPARE_RELEASE_UNIT_LOAD_STATE}" ]]; then
    prepare_release_fail 70 "systemd unit metadata was incomplete"
    return
  fi
}

prepare_release_require_unit_absent() {
  local unit="$1"

  if ! prepare_release_load_unit_state "${unit}"; then
    return 70
  fi
  if [[ "${PREPARE_RELEASE_UNIT_LOAD_STATE}" != not-found ]]; then
    prepare_release_fail 70 "build unit already exists: ${unit}"
    return
  fi
}

prepare_release_validate_loaded_build_unit() {
  local unit="$1"
  local build_workspace="$2"
  local expected_control_group="$3"

  if [[ "${PREPARE_RELEASE_UNIT_LOAD_STATE}" != loaded ||
    "${PREPARE_RELEASE_UNIT_TRANSIENT}" != yes ||
    ( -n "${PREPARE_RELEASE_UNIT_FRAGMENT_PATH}" &&
      "${PREPARE_RELEASE_UNIT_FRAGMENT_PATH}" != "/run/systemd/transient/${unit}" ) ||
    "${PREPARE_RELEASE_UNIT_USER}" != diesel-build ||
    "${PREPARE_RELEASE_UNIT_GROUP}" != diesel-build ||
    "${PREPARE_RELEASE_UNIT_WORKING_DIRECTORY}" != "${build_workspace}" ||
    "${PREPARE_RELEASE_UNIT_SLICE}" != system.slice ||
    "${PREPARE_RELEASE_UNIT_KILL_MODE}" != control-group ||
    "${PREPARE_RELEASE_UNIT_DELEGATE}" != no ||
    "${PREPARE_RELEASE_UNIT_REMAIN_AFTER_EXIT}" != yes ||
    "${PREPARE_RELEASE_UNIT_RESTART}" != no ||
    "${PREPARE_RELEASE_UNIT_TYPE}" != exec ||
    ( "${PREPARE_RELEASE_UNIT_KILL_SIGNAL}" != 15 &&
      "${PREPARE_RELEASE_UNIT_KILL_SIGNAL}" != SIGTERM ) ||
    ( "${PREPARE_RELEASE_UNIT_FINAL_KILL_SIGNAL}" != 9 &&
      "${PREPARE_RELEASE_UNIT_FINAL_KILL_SIGNAL}" != SIGKILL ) ||
    "${PREPARE_RELEASE_UNIT_SEND_SIGKILL}" != yes ||
    ! "${PREPARE_RELEASE_UNIT_RUNTIME_MAX_USEC}" =~ ^(45min|2700s|2700000000us)$ ||
    ! "${PREPARE_RELEASE_UNIT_TIMEOUT_STOP_USEC}" =~ ^(30s|30000ms|30000000us)$ ||
    "${PREPARE_RELEASE_UNIT_UMASK}" != 0077 ||
    "${PREPARE_RELEASE_UNIT_NO_NEW_PRIVILEGES}" != yes ||
    "${PREPARE_RELEASE_UNIT_PROTECT_CONTROL_GROUPS}" != yes ]]; then
    prepare_release_fail 70 "build unit metadata drifted: ${unit}"
    return
  fi
  if [[ "${PREPARE_RELEASE_UNIT_CONTROL_GROUP}" != "${expected_control_group}" ]]; then
    # systemd releases the cgroup of a failed service while retaining its exit
    # metadata. Only accept that exact terminal shape after proving the expected
    # cgroup has disappeared; never accept another path or a missing active one.
    if [[ -n "${PREPARE_RELEASE_UNIT_CONTROL_GROUP}" ||
      "${PREPARE_RELEASE_UNIT_ACTIVE_STATE}" != failed ||
      "${PREPARE_RELEASE_UNIT_SUB_STATE}" != failed ]]; then
      prepare_release_fail 70 "build unit metadata drifted: ${unit}"
      return
    fi
    prepare_release_require_control_group_absent "${expected_control_group}"
  fi
}

prepare_release_monotonic_seconds() {
  local proc_root="$1"
  local uptime_seconds
  local ignored_fraction

  if ! IFS='. ' read -r uptime_seconds ignored_fraction <"${proc_root}/uptime" ||
    [[ ! "${uptime_seconds}" =~ ^[0-9]+$ ]]; then
    prepare_release_fail 70 "monotonic clock lookup failed"
    return
  fi
  printf '%s\n' "${uptime_seconds}"
}

prepare_release_map_build_status() {
  local result="$1"
  local exec_main_code="$2"
  local exec_main_status="$3"

  if [[ ! "${exec_main_code}" =~ ^[0-9]+$ ||
    ! "${exec_main_status}" =~ ^[0-9]+$ ||
    "${exec_main_status}" -gt 255 ]]; then
    prepare_release_fail 70 "systemd returned invalid build exit metadata"
    return
  fi
  if [[ "${result}" == success && "${exec_main_code}" -eq 1 &&
    "${exec_main_status}" -eq 0 ]]; then
    return 0
  fi
  if [[ "${result}" == timeout ]]; then
    return 124
  fi
  if [[ "${result}" == oom-kill ]]; then
    return 137
  fi
  if [[ "${result}" == exit-code && "${exec_main_code}" -eq 1 &&
    "${exec_main_status}" -gt 0 ]]; then
    return "${exec_main_status}"
  fi
  if [[ ( "${result}" == success || "${result}" == signal ||
      "${result}" == core-dump ) &&
    ( "${exec_main_code}" -eq 2 || "${exec_main_code}" -eq 3 ) &&
    "${exec_main_status}" -gt 0 && "${exec_main_status}" -lt 128 ]]; then
    return $((128 + exec_main_status))
  fi
  prepare_release_fail 70 \
    "systemd build result was not a recognized terminal outcome"
}

prepare_release_prove_build_quiescent() {
  local proc_root="$1"
  local control_group="$2"
  local builder_uid="$3"
  local proof_round
  local probe_status

  for proof_round in 1 2; do
    if prepare_release_control_group_has_processes \
      "${proc_root}" "${control_group}"; then
      prepare_release_fail 70 "build cgroup still contains processes"
      return
    else
      probe_status="$?"
      if [[ "${probe_status}" -ne 1 ]]; then
        return "${probe_status}"
      fi
    fi
    if prepare_release_control_group_is_populated "${control_group}"; then
      prepare_release_fail 70 "build cgroup still reports populated"
      return
    else
      probe_status="$?"
      if [[ "${probe_status}" -ne 1 ]]; then
        return "${probe_status}"
      fi
    fi
    if prepare_release_uid_has_processes "${builder_uid}"; then
      prepare_release_fail 70 "diesel-build still owns processes after unit stop"
      return
    else
      probe_status="$?"
      if [[ "${probe_status}" -ne 1 ]]; then
        return "${probe_status}"
      fi
    fi
    if [[ "${proof_round}" -eq 1 ]]; then
      sleep 1
    fi
  done
}

prepare_release_quiesce_build_unit() {
  local unit="$1"
  local build_workspace="$2"
  local proc_root="$3"
  local control_group="$4"
  local builder_uid="$5"
  local stop_status=0
  local kill_status=0
  local retry_stop_status=0
  local reset_status=0
  local attempt

  if ! prepare_release_load_unit_state "${unit}"; then
    return 70
  fi
  if [[ "${PREPARE_RELEASE_UNIT_LOAD_STATE}" == not-found ]]; then
    if ! prepare_release_require_control_group_absent "${control_group}"; then
      return 70
    fi
    prepare_release_prove_build_quiescent \
      "${proc_root}" "${control_group}" "${builder_uid}"
    return
  fi
  if ! prepare_release_validate_loaded_build_unit \
    "${unit}" "${build_workspace}" "${control_group}"; then
    return 70
  fi

  timeout --foreground --signal=TERM --kill-after=5s 40s \
    systemctl stop "${unit}" || stop_status="$?"
  if [[ "${stop_status}" -ne 0 ]]; then
    echo "build unit stop did not complete; forcing its validated cgroup: ${unit}" >&2
    timeout --foreground --signal=TERM --kill-after=2s 10s \
      systemctl kill --kill-who=all --signal=SIGKILL "${unit}" || \
      kill_status="$?"
    timeout --foreground --signal=TERM --kill-after=5s 40s \
      systemctl stop "${unit}" || retry_stop_status="$?"
    if [[ "${kill_status}" -ne 0 && "${retry_stop_status}" -ne 0 ]]; then
      echo "forced build unit cleanup commands failed; verifying final manager state" >&2
    fi
  fi
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if ! prepare_release_load_unit_state "${unit}"; then
      return 70
    fi
    if [[ "${PREPARE_RELEASE_UNIT_LOAD_STATE}" == not-found ]]; then
      break
    fi
    sleep 1
  done
  if [[ "${PREPARE_RELEASE_UNIT_LOAD_STATE}" != not-found ]]; then
    timeout --foreground --signal=TERM --kill-after=2s 10s \
      systemctl reset-failed "${unit}" || reset_status="$?"
    if [[ "${reset_status}" -ne 0 ]]; then
      if ! prepare_release_load_unit_state "${unit}"; then
        return 70
      fi
      if [[ "${PREPARE_RELEASE_UNIT_LOAD_STATE}" != not-found ]]; then
        prepare_release_fail 70 "build unit reset failed: ${unit}"
        return
      fi
    fi
    for attempt in 1 2 3 4 5; do
      if ! prepare_release_load_unit_state "${unit}"; then
        return 70
      fi
      if [[ "${PREPARE_RELEASE_UNIT_LOAD_STATE}" == not-found ]]; then
        break
      fi
      sleep 1
    done
  fi
  if [[ "${PREPARE_RELEASE_UNIT_LOAD_STATE}" != not-found ]]; then
    prepare_release_fail 70 "build unit did not unload: ${unit}"
    return
  fi
  for attempt in 1 2 3 4 5; do
    if [[ ! -e "/sys/fs/cgroup${control_group}" &&
      ! -L "/sys/fs/cgroup${control_group}" ]]; then
      break
    fi
    sleep 1
  done
  if ! prepare_release_require_control_group_absent "${control_group}"; then
    return 70
  fi
  prepare_release_prove_build_quiescent \
    "${proc_root}" "${control_group}" "${builder_uid}"
}

prepare_release_report_build_start_failure() {
  local unit="$1"
  local start_status="$2"
  local value

  if ! prepare_release_load_unit_state "${unit}"; then
    return 0
  fi
  for value in \
    "${start_status}" "${PREPARE_RELEASE_UNIT_LOAD_STATE}" \
    "${PREPARE_RELEASE_UNIT_ACTIVE_STATE}" "${PREPARE_RELEASE_UNIT_SUB_STATE}" \
    "${PREPARE_RELEASE_UNIT_RESULT}" "${PREPARE_RELEASE_UNIT_EXEC_MAIN_CODE}" \
    "${PREPARE_RELEASE_UNIT_EXEC_MAIN_STATUS}"; do
    if [[ ! "${value}" =~ ^[a-zA-Z0-9_-]{1,40}$ ]]; then
      return 0
    fi
  done
  # Only bounded status fields: never print unit environment, argv or journal.
  printf 'Build start diagnostics: start=%s load=%s active=%s sub=%s result=%s code=%s status=%s\n' \
    "${start_status}" "${PREPARE_RELEASE_UNIT_LOAD_STATE}" \
    "${PREPARE_RELEASE_UNIT_ACTIVE_STATE}" "${PREPARE_RELEASE_UNIT_SUB_STATE}" \
    "${PREPARE_RELEASE_UNIT_RESULT}" "${PREPARE_RELEASE_UNIT_EXEC_MAIN_CODE}" \
    "${PREPARE_RELEASE_UNIT_EXEC_MAIN_STATUS}" >&2
}

prepare_release_run_build_unit() {
  local release_id="$1"
  local build_workspace="$2"
  local build_home="$3"
  local fixed_vps_path="$4"
  local registry="$5"
  local proc_root="$6"
  local builder_uid="$7"
  local unit="diesel-build-${release_id}.service"
  local control_group="/system.slice/${unit}"
  local start_status=0
  local build_status=70
  local start_seconds
  local current_seconds
  local deadline_seconds
  local last_progress_seconds
  local probe_status
  local lifecycle_leak=0
  local terminal_observed=0

  PREPARE_RELEASE_CLEANUP_BUILD_UNIT="${unit}"
  PREPARE_RELEASE_CLEANUP_BUILD_CONTROL_GROUP="${control_group}"
  PREPARE_RELEASE_CLEANUP_BUILD_UNIT_ARMED=1

  timeout --foreground --signal=TERM --kill-after=5s 30s systemd-run \
    --quiet \
    --no-ask-password \
    --unit="${unit}" \
    --service-type=exec \
    --remain-after-exit \
    --property=User=diesel-build \
    --property=Group=diesel-build \
    --property=WorkingDirectory="${build_workspace}" \
    --property=Slice=system.slice \
    --property=KillMode=control-group \
    --property=KillSignal=SIGTERM \
    --property=FinalKillSignal=SIGKILL \
    --property=SendSIGKILL=yes \
    --property=RuntimeMaxSec=45min \
    --property=TimeoutStopSec=30s \
    --property=Restart=no \
    --property=Delegate=no \
    --property=UMask=0077 \
    --property=NoNewPrivileges=yes \
    --property=ProtectControlGroups=yes \
    /usr/bin/env -i \
    HOME="${build_home}" \
    PATH="${fixed_vps_path}" \
    BUILD_HOME="${build_home}" \
    BUILD_RELEASE_ID="${release_id}" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_REGISTRY="${registry}" \
    /usr/bin/bash scripts/deploy/build-release.sh </dev/null || start_status="$?"
  if [[ "${start_status}" -ne 0 ]]; then
    prepare_release_report_build_start_failure "${unit}" "${start_status}" || true
    prepare_release_fail 70 "systemd rejected the transient build unit"
    return
  fi

  start_seconds="$(prepare_release_monotonic_seconds "${proc_root}")"
  deadline_seconds=$((start_seconds + 2760))
  last_progress_seconds="${start_seconds}"
  while true; do
    prepare_release_load_unit_state "${unit}"
    prepare_release_validate_loaded_build_unit \
      "${unit}" "${build_workspace}" "${control_group}"
    if [[ "${PREPARE_RELEASE_UNIT_ACTIVE_STATE}" == active &&
      "${PREPARE_RELEASE_UNIT_SUB_STATE}" == exited ]] ||
      [[ "${PREPARE_RELEASE_UNIT_ACTIVE_STATE}" == failed &&
        "${PREPARE_RELEASE_UNIT_SUB_STATE}" == failed ]]; then
      terminal_observed=1
      break
    fi
    case "${PREPARE_RELEASE_UNIT_ACTIVE_STATE}:${PREPARE_RELEASE_UNIT_SUB_STATE}" in
      activating:*|active:running|deactivating:*) ;;
      *)
        prepare_release_fail 70 "build unit entered an unexpected state"
        return
        ;;
    esac
    current_seconds="$(prepare_release_monotonic_seconds "${proc_root}")"
    if [[ "${current_seconds}" -ge "${deadline_seconds}" ]]; then
      build_status=124
      break
    fi
    if [[ $((current_seconds - last_progress_seconds)) -ge 60 ]]; then
      printf 'Build unit still running: %s (%ss elapsed)\n' \
        "${unit}" "$((current_seconds - start_seconds))"
      last_progress_seconds="${current_seconds}"
    fi
    sleep 2
  done

  if [[ "${build_status}" -ne 124 ]]; then
    if prepare_release_map_build_status \
      "${PREPARE_RELEASE_UNIT_RESULT}" \
      "${PREPARE_RELEASE_UNIT_EXEC_MAIN_CODE}" \
      "${PREPARE_RELEASE_UNIT_EXEC_MAIN_STATUS}"; then
      build_status=0
    else
      build_status="$?"
    fi
  fi
  if [[ "${terminal_observed}" -eq 1 ]]; then
    if prepare_release_control_group_has_processes \
      "${proc_root}" "${control_group}"; then
      lifecycle_leak=1
    else
      probe_status="$?"
      if [[ "${probe_status}" -ne 1 ]]; then
        return "${probe_status}"
      fi
    fi
    if prepare_release_control_group_is_populated "${control_group}"; then
      lifecycle_leak=1
    else
      probe_status="$?"
      if [[ "${probe_status}" -ne 1 ]]; then
        return "${probe_status}"
      fi
    fi
  fi

  prepare_release_quiesce_build_unit \
    "${unit}" "${build_workspace}" "${proc_root}" \
    "${control_group}" "${builder_uid}"
  PREPARE_RELEASE_CLEANUP_BUILD_UNIT_ARMED=0
  if [[ "${lifecycle_leak}" -ne 0 ]]; then
    prepare_release_fail 70 \
      "build lifecycle left descendant processes in its cgroup"
    return
  fi
  return "${build_status}"
}

prepare_release_runtime() (
  set -Eeuo pipefail

  if [[ "$#" -ne 5 ]]; then
    prepare_release_usage
    return 64
  fi

  local release_id="$1"
  local deploy_root="$2"
  local fixed_vps_path="$3"
  local node_binary="$4"
  local proc_root="$5"
  if prepare_release_sourced_production_root_is_selected "${deploy_root}"; then
    prepare_release_fail 64 \
      "runtime preparation test seam cannot target the production deployment root"
    return
  fi
  local root_child_path="${fixed_vps_path}"
  local release_root="${deploy_root}/releases"
  local release_dir="${release_root}/${release_id}"
  local build_root="${deploy_root}/build"
  local build_home="${build_root}/${release_id}"
  local build_workspace_root="${deploy_root}/build-workspaces"
  local build_workspace="${build_workspace_root}/${release_id}"
  local build_lock_path="${deploy_root}/.release-build.lock"
  local shared_root="${deploy_root}/shared"
  local data_root="${shared_root}/.data"
  local environment_path="${shared_root}/.env.production.local"
  local deployment_state_dir="${deploy_root}/backups/${release_id}"
  local backups_root="${deploy_root}/backups"
  local previous_release_file="${deployment_state_dir}/previous-release"
  local environment_backup="${deployment_state_dir}/env.production.local.pre-switch"
  local nginx_primary_backup="${deployment_state_dir}/jamesky.site.pre-switch"
  local nginx_alternate_backup="${deployment_state_dir}/diesel-demo.pre-switch"
  local input_manifest="${release_dir}/.release-input-manifest.json"
  local next_environment="${release_dir}/next-env.d.ts"
  local build_script="${release_dir}/scripts/deploy/build-release.sh"
  local input_manifest_script="${release_dir}/scripts/deploy/release-input-manifest.mjs"
  local artifact_script="${release_dir}/scripts/deploy/release-artifact-manifest.mjs"
  local host_activation_ledger_script="${release_dir}/scripts/deploy/host-activation-ledger.sh"
  local registry="${PNPM_REGISTRY:-https://registry.npmjs.org}"
  local build_unit="diesel-build-${release_id}.service"
  local build_control_group="/system.slice/${build_unit}"
  local runtime_uid
  local runtime_gid
  local builder_uid
  if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    root_child_path="/usr/sbin:/usr/bin:/sbin:/bin"
  fi
  local effective_uid
  local probe_status
  local artifact_digest
  local ready_digest
  local build_output
  PREPARE_RELEASE_CLEANUP_ARMED=0
  PREPARE_RELEASE_CLEANUP_BUILD_WORKSPACE="${build_workspace}"
  PREPARE_RELEASE_CLEANUP_WORKSPACE_ROOT="${build_workspace_root}"
  PREPARE_RELEASE_CLEANUP_BUILD_HOME="${build_home}"
  PREPARE_RELEASE_CLEANUP_BUILD_ROOT="${build_root}"
  PREPARE_RELEASE_CLEANUP_RELEASE_ID="${release_id}"
  PREPARE_RELEASE_PRESERVE_BUILD_ARTIFACTS=0
  PREPARE_RELEASE_CLEANUP_BUILD_UNIT_ARMED=0
  PREPARE_RELEASE_CLEANUP_BUILD_UNIT="${build_unit}"
  PREPARE_RELEASE_CLEANUP_BUILD_CONTROL_GROUP="${build_control_group}"
  PREPARE_RELEASE_CLEANUP_PROC_ROOT="${proc_root}"
  PREPARE_RELEASE_CLEANUP_BUILDER_UID=''

  prepare_release_cleanup_on_exit() {
    local exit_status="$1"
    local cleanup_failed=0
    trap - EXIT
    trap '' INT TERM HUP
    if [[ "${PREPARE_RELEASE_CLEANUP_ARMED}" -eq 1 ]]; then
      if [[ "${PREPARE_RELEASE_CLEANUP_BUILD_UNIT_ARMED}" -eq 1 ]]; then
        if prepare_release_quiesce_build_unit \
          "${PREPARE_RELEASE_CLEANUP_BUILD_UNIT}" \
          "${PREPARE_RELEASE_CLEANUP_BUILD_WORKSPACE}" \
          "${PREPARE_RELEASE_CLEANUP_PROC_ROOT}" \
          "${PREPARE_RELEASE_CLEANUP_BUILD_CONTROL_GROUP}" \
          "${PREPARE_RELEASE_CLEANUP_BUILDER_UID}"; then
          PREPARE_RELEASE_CLEANUP_BUILD_UNIT_ARMED=0
        else
          cleanup_failed=1
        fi
      fi
      if [[ "${cleanup_failed}" -eq 0 &&
        "${PREPARE_RELEASE_PRESERVE_BUILD_ARTIFACTS}" -eq 1 ]]; then
        echo \
          "retaining frozen build workspace and home after candidate handoff failure" >&2
      elif [[ "${cleanup_failed}" -eq 0 ]]; then
        if ! prepare_release_remove_exact_directory \
          "${PREPARE_RELEASE_CLEANUP_BUILD_WORKSPACE}" \
          "${PREPARE_RELEASE_CLEANUP_WORKSPACE_ROOT}" \
          "${PREPARE_RELEASE_CLEANUP_RELEASE_ID}" \
          "build workspace"; then
          cleanup_failed=1
        fi
        if ! prepare_release_remove_exact_directory \
          "${PREPARE_RELEASE_CLEANUP_BUILD_HOME}" \
          "${PREPARE_RELEASE_CLEANUP_BUILD_ROOT}" \
          "${PREPARE_RELEASE_CLEANUP_RELEASE_ID}" \
          "per-release build home"; then
          cleanup_failed=1
        fi
      else
        echo "retaining build workspace and home because process cleanup was not proven" >&2
      fi
    fi
    if [[ "${cleanup_failed}" -ne 0 ]]; then
      exit 70
    fi
    exit "${exit_status}"
  }
  trap 'prepare_release_cleanup_on_exit "$?"' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  if ! prepare_release_is_commit "${release_id}"; then
    prepare_release_usage
    return 64
  fi
  if [[ ! "${deploy_root}" =~ ^/[^[:cntrl:]]+$ ||
    ! "${build_workspace}" =~ ^/[^[:cntrl:]]+$ ]]; then
    prepare_release_fail 64 "deployment paths must be absolute and control-character free"
    return
  fi

  effective_uid="$(prepare_release_effective_uid)"
  if [[ "${effective_uid}" != "0" ]]; then
    prepare_release_fail 77 "runtime preparation must run as root"
    return
  fi
  prepare_release_require_fixed_root_command_boundary \
    "${fixed_vps_path}" "${node_binary}" || return $?
  prepare_release_require_identity_boundary
  runtime_uid="$(id -u diesel)"
  runtime_gid="$(id -g diesel)"
  if [[ ! -f "${node_binary}" || -L "${node_binary}" || ! -x "${node_binary}" ]]; then
    prepare_release_fail 70 "fixed Node.js binary is missing, symlinked, or not executable"
    return
  fi
  prepare_release_require_transient_build_commands

  prepare_release_require_directory "${deploy_root}" "root:root:755" \
    "deployment root"
  prepare_release_require_directory "${release_root}" "root:root:755" \
    "release root"
  prepare_release_require_directory "${release_dir}" "root:diesel:750" \
    "target release"
  prepare_release_require_directory "${build_root}" "root:diesel-build:710" \
    "isolated build root"
  prepare_release_require_directory "${shared_root}" "root:diesel:750" \
    "shared runtime root"
  prepare_release_require_directory "${data_root}" "diesel:diesel:750" \
    "shared data root"
  prepare_release_require_directory "${deployment_state_dir}" "root:root:700" \
    "release rollback state"
  prepare_release_require_directory "${backups_root}" "root:root:700" \
    "release rollback root"
  prepare_release_require_file "${environment_path}" "root:diesel:640" no \
    "shared runtime environment"
  prepare_release_require_file "${environment_backup}" "root:root:600" no \
    "pre-switch environment backup"
  prepare_release_require_file "${previous_release_file}" "root:root:600" no \
    "pre-switch release state"
  prepare_release_require_file "${nginx_primary_backup}" "root:root:600" no \
    "pre-switch primary Nginx backup"
  prepare_release_require_file "${nginx_alternate_backup}" "root:root:600" no \
    "pre-switch alternate Nginx backup"
  prepare_release_require_staged_or_normalized_executable \
    "${host_activation_ledger_script}" \
    "versioned host activation ledger"

  # No build, systemd, release-tree, or live-host mutation may begin without a
  # durable V1 PENDING marker bound to these exact rollback-basis bytes.
  host_activation_ledger_require_pending \
    "${release_id}" "${deploy_root}" "${node_binary}"

  prepare_release_require_file "${build_lock_path}" "root:root:600" no \
    "global release build lock"
  exec 9<>"${build_lock_path}"
  if ! flock -n 9; then
    prepare_release_fail 70 "another release build owns the global build lock"
    return
  fi

  # The rollback environment must select the same governance database as the
  # live environment. Prove and durably persist that invariant before any
  # transient systemd unit, build workspace, release inode, or live runtime
  # state can be mutated.
  prepare_release_fsync_rollback_basis \
    "${node_binary}" \
    "${previous_release_file}" \
    "${environment_backup}" \
    "${nginx_primary_backup}" \
    "${nginx_alternate_backup}" \
    "${deployment_state_dir}" \
    "${backups_root}" \
    "${deploy_root}"
  prepare_release_require_stable_database_identity \
    "${node_binary}" "${environment_backup}" \
    "${environment_path}" "${shared_root}"

  prepare_release_require_systemd_host "${proc_root}"
  prepare_release_require_unit_absent "${build_unit}"
  if prepare_release_control_group_has_processes \
    "${proc_root}" "${build_control_group}"; then
    prepare_release_fail 70 "a stale build cgroup still contains processes"
    return
  else
    probe_status="$?"
    if [[ "${probe_status}" -ne 1 ]]; then
      return "${probe_status}"
    fi
  fi
  if prepare_release_control_group_is_populated "${build_control_group}"; then
    prepare_release_fail 70 "a stale build cgroup is still populated"
    return
  else
    probe_status="$?"
    if [[ "${probe_status}" -ne 1 ]]; then
      return "${probe_status}"
    fi
  fi
  prepare_release_require_control_group_absent "${build_control_group}"
  builder_uid="$(id -u diesel-build)"
  PREPARE_RELEASE_CLEANUP_BUILDER_UID="${builder_uid}"
  if prepare_release_uid_has_processes "${builder_uid}"; then
    prepare_release_fail 70 "diesel-build already owns processes before the build"
    return
  else
    probe_status="$?"
    if [[ "${probe_status}" -ne 1 ]]; then
      return "${probe_status}"
    fi
  fi

  for reserved_path in \
    "${release_dir}/.env.local" \
    "${release_dir}/.env.production" \
    "${release_dir}/.env.production.local" \
    "${release_dir}/.data" \
    "${release_dir}/node_modules" \
    "${release_dir}/.next" \
    "${release_dir}/.build-complete" \
    "${release_dir}/.deploy-ready"; do
    prepare_release_require_absent "${reserved_path}" "reserved release output"
  done

  chown -hR root:diesel "${release_dir}"
  chmod -R u=rwX,g=rX,o= "${release_dir}"
  prepare_release_require_file \
    "${host_activation_ledger_script}" "root:diesel:750" yes \
    "normalized versioned host activation ledger"
  prepare_release_require_file "${input_manifest}" "root:diesel:640" no \
    "release input manifest"
  prepare_release_require_file "${next_environment}" "root:diesel:640" no \
    "canonical Next environment input"
  prepare_release_require_file "${build_script}" "root:diesel:750" yes \
    "unprivileged build script"
  prepare_release_require_file "${input_manifest_script}" "root:diesel:640" no \
    "release input verifier"
  prepare_release_require_file "${artifact_script}" "root:diesel:640" no \
    "release artifact verifier"

  if [[ -e "${build_workspace_root}" || -L "${build_workspace_root}" ]]; then
    prepare_release_require_directory \
      "${build_workspace_root}" "root:diesel-build:710" \
      "build workspace root"
  else
    install -d -m 0710 -o root -g diesel-build "${build_workspace_root}"
    prepare_release_require_directory \
      "${build_workspace_root}" "root:diesel-build:710" \
      "build workspace root"
  fi
  prepare_release_require_absent "${build_workspace}" "per-release build workspace"
  prepare_release_require_absent "${build_home}" "per-release build home"
  PREPARE_RELEASE_CLEANUP_ARMED=1
  install -d -m 0700 -o diesel-build -g diesel-build "${build_home}"
  install -d -m 0700 -o diesel-build -g diesel-build "${build_workspace}"
  cp -a "${release_dir}/." "${build_workspace}/"
  chown -hR diesel-build:diesel-build "${build_workspace}"
  chmod -R u=rwX,g=,o= "${build_workspace}"
  install -d -m 0700 -o diesel-build -g diesel-build \
    "${build_workspace}/node_modules" "${build_workspace}/.next"
  install -m 0600 -o diesel-build -g diesel-build /dev/null \
    "${build_workspace}/.build-complete"

  prepare_release_run_build_unit \
    "${release_id}" "${build_workspace}" "${build_home}" \
    "${fixed_vps_path}" "${registry}" "${proc_root}" "${builder_uid}"

  # Revoke the build identity's directory and file write permissions before
  # trusting either the generated marker or the artifact bytes it describes.
  chown -hR root:root "${build_workspace}"
  chmod -R u=rwX,g=,o= "${build_workspace}"
  prepare_release_require_directory "${build_workspace}" "root:root:700" \
    "frozen build workspace"
  prepare_release_require_file \
    "${build_workspace}/.build-complete" "root:root:600" no \
    "sealed build marker"
  prepare_release_require_file \
    "${build_workspace}/.release-input-manifest.json" "root:root:600" no \
    "frozen release input manifest"
  prepare_release_require_file \
    "${build_workspace}/next-env.d.ts" "root:root:600" no \
    "generated Next environment input"
  # Next rewrites this tracked declaration during a production build. The
  # builder restores its own snapshot for an early integrity check, then the
  # root controller repeats the restoration from the inaccessible canonical
  # release only after the service cgroup and build UID are proven quiescent.
  cp -P --preserve=mode --reflink=never -- \
    "${next_environment}" "${build_workspace}/next-env.d.ts"
  chmod 600 "${build_workspace}/next-env.d.ts"
  prepare_release_require_file \
    "${build_workspace}/next-env.d.ts" "root:root:600" no \
    "restored Next environment input"
  if ! cmp --silent -- \
    "${input_manifest}" "${build_workspace}/.release-input-manifest.json"; then
    prepare_release_fail 70 "release input manifest drifted during the build"
    return
  fi
  (
    cd "${build_workspace}"
    env -i HOME=/root PATH="${root_child_path}" \
      "${node_binary}" "${input_manifest_script}" \
      verify "${release_id}" .release-input-manifest.json >/dev/null
  )

  artifact_digest="$(
    cd "${build_workspace}"
    env -i HOME=/root PATH="${root_child_path}" \
      "${node_binary}" "${artifact_script}" \
      verify "${release_id}" .build-complete
  )"
  if [[ ! "${artifact_digest}" =~ ^[0-9a-f]{64}$ ]]; then
    prepare_release_fail 70 "artifact verifier did not return a SHA-256 digest"
    return
  fi

  if [[ -e "${build_workspace}/.next/cache" || -L "${build_workspace}/.next/cache" ]]; then
    if [[ ! -d "${build_workspace}/.next/cache" || -L "${build_workspace}/.next/cache" ]]; then
      prepare_release_fail 70 ".next/cache must be a real directory when present"
      return
    fi
    rm -rf -- "${build_workspace}/.next/cache"
  fi

  # Copy into new root-controlled inodes instead of renaming builder-created
  # inodes. A lifecycle process retaining an old writable file descriptor can
  # then mutate only the quarantined workspace, never the release candidate.
  # Once handoff starts, retain the frozen source on any failure so an operator
  # can inspect or explicitly rebuild an incomplete, never-activated candidate.
  PREPARE_RELEASE_PRESERVE_BUILD_ARTIFACTS=1
  for build_output in node_modules .next; do
    prepare_release_require_absent \
      "${release_dir}/${build_output}" "target release build output"
    prepare_release_require_directory \
      "${build_workspace}/${build_output}" "root:root:700" \
      "frozen ${build_output} output"
    cp -R -P --preserve=mode --reflink=never -- \
      "${build_workspace}/${build_output}" "${release_dir}/${build_output}"
  done
  prepare_release_require_absent \
    "${release_dir}/.build-complete" "target release build marker"
  cp -P --preserve=mode --reflink=never -- \
    "${build_workspace}/.build-complete" "${release_dir}/.build-complete"

  chown -hR root:diesel "${release_dir}"
  chmod -R u=rwX,g=rX,o= "${release_dir}"
  chmod -R u=rwX,g=rX,o= "${release_dir}/.next"
  if [[ -e "${release_dir}/.next/cache" || -L "${release_dir}/.next/cache" ]]; then
    if [[ ! -d "${release_dir}/.next/cache" || -L "${release_dir}/.next/cache" ]]; then
      prepare_release_fail 70 ".next/cache must be a real directory when present"
      return
    fi
    rm -rf -- "${release_dir}/.next/cache"
  fi
  install -d -m 0750 -o diesel -g diesel "${release_dir}/.next/cache"

  ln -s "${environment_path}" "${release_dir}/.env.production.local"
  ln -s "${data_root}" "${release_dir}/.data"
  runuser -u diesel -- test -r "${release_dir}/.env.production.local"
  runuser -u diesel -- test -w "${release_dir}/.data"
  runuser -u diesel -- sh -c \
    'probe="$(mktemp "$1/.write-probe.XXXXXX")" && rm -f "${probe}"' sh \
    "${data_root}"
  runuser -u diesel -- test -x "${release_dir}/node_modules/next/dist/bin/next"
  runuser -u diesel -- test -x "${release_dir}/.next/server"
  runuser -u diesel -- test -r "${release_dir}/.next/BUILD_ID"
  runuser -u diesel -- test -r "${release_dir}/.next/required-server-files.json"
  runuser -u diesel -- test -r "${release_dir}/.next/server/app-paths-manifest.json"

  ready_digest="$(
    cd "${release_dir}"
    env -i HOME=/root PATH="${root_child_path}" \
      "${node_binary}" "${artifact_script}" \
      finalize "${release_id}" .build-complete .deploy-ready
  )"
  if [[ "${ready_digest}" != "${artifact_digest}" ]]; then
    prepare_release_fail 70 "deploy-ready digest does not match the frozen build"
    return
  fi
  chown root:diesel "${release_dir}/.deploy-ready"
  chmod 640 "${release_dir}/.deploy-ready"
  prepare_release_require_file \
    "${release_dir}/.deploy-ready" "root:diesel:640" no \
    "deployment readiness marker"
  (
    cd "${release_dir}"
    env -i HOME=/root PATH="${root_child_path}" \
      "${node_binary}" "${artifact_script}" \
      check-ready "${release_id}" .build-complete .deploy-ready \
      0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}" >/dev/null
  )

  prepare_release_persist_candidate \
    "${node_binary}" \
    "${release_dir}" \
    "${release_root}" \
    "${deploy_root}" \
    "${release_dir}/.build-complete" \
    "${release_dir}/.deploy-ready"

  # Re-read the durable bytes instead of trusting page-cache validation that
  # happened before sync/fsync. The builder is already quiescent and neither
  # marker is writable by the runtime identity.
  prepare_release_require_directory "${release_dir}" "root:diesel:750" \
    "durable target release"
  prepare_release_require_file \
    "${release_dir}/.build-complete" "root:diesel:640" no \
    "durable sealed build marker"
  prepare_release_require_file \
    "${release_dir}/.deploy-ready" "root:diesel:640" no \
    "durable deployment readiness marker"
  (
    cd "${release_dir}"
    env -i HOME=/root PATH="${root_child_path}" \
      "${node_binary}" "${artifact_script}" \
      check-ready "${release_id}" .build-complete .deploy-ready \
      0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}" >/dev/null
  )

  PREPARE_RELEASE_PRESERVE_BUILD_ARTIFACTS=0
  prepare_release_remove_exact_directory \
    "${build_workspace}" "${build_workspace_root}" "${release_id}" \
    "build workspace"
  prepare_release_remove_exact_directory \
    "${build_home}" "${build_root}" "${release_id}" \
    "per-release build home"
  PREPARE_RELEASE_CLEANUP_ARMED=0

  printf 'Release runtime prepared: %s (%s)\n' "${release_id}" "${artifact_digest}"
)

prepare_release_runtime_main() {
  set -Eeuo pipefail

  if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
    prepare_release_fail 64 \
      "production runtime preparation main is unavailable when sourced"
    return
  fi
  if [[ "$#" -ne 1 ]]; then
    prepare_release_usage
    return 64
  fi
  prepare_release_runtime \
    "$1" \
    "/opt/diesel" \
    "/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    "/opt/node-v22.22.3-linux-x64/bin/node" \
    "/proc"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  prepare_release_runtime_main "$@"
fi
