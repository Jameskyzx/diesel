#!/bin/bash

# This file is intentionally sourceable so its state machine can be exercised
# against an isolated filesystem fixture. The CLI entry point below always
# supplies the production paths; callers cannot override them with environment
# variables or extra arguments.

rollback_cli_bootstrap_metadata_is_allowed() {
  local object_type="$1"
  local metadata="$2"

  case "${object_type}:${metadata}" in
    directory:root:root:755 | directory:root:diesel:750 | \
      executable:root:root:755:1 | executable:root:diesel:750:1) return 0 ;;
    *) return 1 ;;
  esac
}

rollback_cli_require_bootstrap_path() {
  local path="$1"
  local object_type="$2"
  local canonical_path
  local metadata

  case "${object_type}" in
    directory)
      [[ -d "${path}" && ! -L "${path}" ]] || return 1
      metadata="$(/usr/bin/stat -c '%U:%G:%a' -- "${path}" 2>/dev/null)" ||
        return 1
      ;;
    executable)
      [[ -f "${path}" && ! -L "${path}" && -x "${path}" ]] || return 1
      metadata="$(/usr/bin/stat -c '%U:%G:%a:%h' -- "${path}" 2>/dev/null)" ||
        return 1
      ;;
    *) return 1 ;;
  esac
  canonical_path="$(/usr/bin/realpath -e -- "${path}" 2>/dev/null)" || return 1
  [[ "${canonical_path}" == "${path}" ]] || return 1
  rollback_cli_bootstrap_metadata_is_allowed "${object_type}" "${metadata}"
}

rollback_sourced_production_root_is_selected() {
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

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [[ "$#" -lt 1 || "$#" -gt 2 ||
    ! "${1:-}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "usage: rollback-host-release.sh <full-lowercase-git-commit-sha> [--begin-activation|--check|--apply|--abort-if-uncommitted|--restore-governance-host|--validate-committed]" >&2
    exit 64
  fi
  case "${2:---check}" in
    --begin-activation | --check | --apply | --abort-if-uncommitted | \
      --restore-governance-host | --validate-committed) ;;
    *)
      echo "usage: rollback-host-release.sh <full-lowercase-git-commit-sha> [--begin-activation|--check|--apply|--abort-if-uncommitted|--restore-governance-host|--validate-committed]" >&2
      exit 64
      ;;
  esac
  rollback_expected_entry="/opt/diesel/releases/$1/scripts/deploy/rollback-host-release.sh"
  rollback_expected_ledger="/opt/diesel/releases/$1/scripts/deploy/host-activation-ledger.sh"
  rollback_expected_release="/opt/diesel/releases/$1"
  if [[ "${BASH_SOURCE[0]}" != "${rollback_expected_entry}" ]] ||
    ! rollback_cli_require_bootstrap_path /opt directory ||
    ! rollback_cli_require_bootstrap_path /opt/diesel directory ||
    ! rollback_cli_require_bootstrap_path /opt/diesel/releases directory ||
    ! rollback_cli_require_bootstrap_path \
      "${rollback_expected_release}" directory ||
    ! rollback_cli_require_bootstrap_path \
      "${rollback_expected_release}/scripts" directory ||
    ! rollback_cli_require_bootstrap_path \
      "${rollback_expected_release}/scripts/deploy" directory ||
    ! rollback_cli_require_bootstrap_path \
      "${rollback_expected_entry}" executable ||
    ! rollback_cli_require_bootstrap_path \
      "${rollback_expected_ledger}" executable; then
    echo "rollback pre-source trust validation failed" >&2
    exit 70
  fi
  unset rollback_expected_entry rollback_expected_ledger rollback_expected_release
  export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
fi

rollback_script_directory="${BASH_SOURCE[0]%/*}"
if [[ "${rollback_script_directory}" == "${BASH_SOURCE[0]}" ]]; then
  rollback_script_directory='.'
fi
if source -- "${rollback_script_directory}/host-activation-ledger.sh"; then
  unset rollback_script_directory
else
  rollback_ledger_source_status=$?
  unset rollback_script_directory
  if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    echo "rollback ledger source failed" >&2
    exit 70
  fi
  return "${rollback_ledger_source_status}"
fi

rollback_usage() {
  echo "usage: rollback-host-release.sh <full-lowercase-git-commit-sha> [--begin-activation|--check|--apply|--abort-if-uncommitted|--restore-governance-host|--validate-committed]" >&2
}

rollback_fail() {
  local status="$1"
  shift
  echo "$*" >&2
  return "${status}"
}

rollback_require_production_bootstrap_directory() {
  local path="$1"

  if [[ ! -d "${path}" || -L "${path}" ]] ||
    [[ "$(/usr/bin/realpath -e -- "${path}" 2>/dev/null)" != "${path}" ]] ||
    [[ "$(/usr/bin/stat -c '%u:%g:%a' -- "${path}" 2>/dev/null)" != \
      "0:0:755" ]]; then
    rollback_fail 70 \
      "production rollback command directory is outside the fixed profile: ${path}"
    return
  fi
}

rollback_require_production_bootstrap_executable() {
  local path="$1"
  local label="$2"
  local canonical_path
  local metadata
  local owner
  local group
  local mode
  local link_count
  local permissions

  if [[ ! -f "${path}" || ! -x "${path}" ]] ||
    ! canonical_path="$(/usr/bin/realpath -e -- "${path}")" ||
    ! metadata="$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${canonical_path}")"; then
    rollback_fail 70 "${label} is not a trusted production executable"
    return
  fi
  IFS=: read -r owner group mode link_count <<<"${metadata}"
  if [[ "${owner}" != "0" || "${group}" != "0" ||
    "${link_count}" != "1" || ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    rollback_fail 70 "${label} has unsafe production metadata"
    return
  fi
  permissions=$((8#${mode}))
  if (( (permissions & 07000) != 0 || (permissions & 0022) != 0 ||
    (permissions & 0100) == 0 )); then
    rollback_fail 70 "${label} is outside the production executable profile"
    return
  fi
}

rollback_require_production_command_boundary() {
  local fixed_vps_path="$1"
  local node_binary="$2"
  local expected_pm2_exec="$3"
  local node_root="/opt/node-v22.22.3-linux-x64"
  local pm2_launcher="${node_root}/bin/pm2"
  local command_name
  local command_spec
  local expected_path
  local path
  local resolved_path
  local version

  if [[ "${fixed_vps_path}" != \
      "${node_root}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" ||
    "${node_binary}" != "${node_root}/bin/node" ||
    "${expected_pm2_exec}" != \
      "${node_root}/lib/node_modules/pm2/bin/pm2" ]]; then
    rollback_fail 70 "production rollback requires the fixed runtime profile"
    return
  fi
  for path in \
    /opt "${node_root}" "${node_root}/bin" "${node_root}/lib" \
    "${node_root}/lib/node_modules" "${node_root}/lib/node_modules/pm2" \
    "${node_root}/lib/node_modules/pm2/bin" \
    /usr/local /usr/local/sbin /usr/local/bin; do
    rollback_require_production_bootstrap_directory "${path}" || return $?
  done
  if [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${node_binary}" 2>/dev/null)" != \
      "0:0:755:1" || -L "${node_binary}" ]] ||
    [[ "$(/usr/bin/realpath -e -- "${node_binary}" 2>/dev/null)" != \
      "${node_binary}" ]] ||
    ! version="$("${node_binary}" --version)" ||
    [[ "${version}" != "v22.22.3" ]] ||
    [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${expected_pm2_exec}" 2>/dev/null)" != \
      "0:0:755:1" || -L "${expected_pm2_exec}" ]] ||
    [[ "$(/usr/bin/realpath -e -- "${expected_pm2_exec}" 2>/dev/null)" != \
      "${expected_pm2_exec}" ]] ||
    [[ ! -L "${pm2_launcher}" ]] ||
    [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${pm2_launcher}" 2>/dev/null)" != \
      "0:0:777:1" ]] ||
    [[ "$(/usr/bin/readlink -- "${pm2_launcher}" 2>/dev/null)" != \
      "../lib/node_modules/pm2/bin/pm2" ]] ||
    [[ "$(/usr/bin/realpath -e -- "${pm2_launcher}" 2>/dev/null)" != \
      "${expected_pm2_exec}" ]]; then
    rollback_fail 70 "production Node.js or PM2 runtime is outside the fixed profile"
    return
  fi
  for command_spec in \
    bash:/usr/bin/bash chmod:/usr/bin/chmod chown:/usr/bin/chown \
    cmp:/usr/bin/cmp cp:/usr/bin/cp curl:/usr/bin/curl env:/usr/bin/env \
    find:/usr/bin/find flock:/usr/bin/flock id:/usr/bin/id \
    install:/usr/bin/install ln:/usr/bin/ln mktemp:/usr/bin/mktemp \
    mv:/usr/bin/mv nginx:/usr/sbin/nginx ps:/usr/bin/ps \
    readlink:/usr/bin/readlink realpath:/usr/bin/realpath rm:/usr/bin/rm \
    rmdir:/usr/bin/rmdir runuser:/usr/sbin/runuser \
    sha256sum:/usr/bin/sha256sum sh:/usr/bin/sh sort:/usr/bin/sort \
    stat:/usr/bin/stat systemctl:/usr/bin/systemctl \
    systemd-analyze:/usr/bin/systemd-analyze tr:/usr/bin/tr; do
    command_name="${command_spec%%:*}"
    expected_path="${command_spec#*:}"
    resolved_path="$(command -v "${command_name}")"
    if [[ "${resolved_path}" != "${expected_path}" ]]; then
      rollback_fail 70 \
        "production rollback command is outside the fixed system profile: ${command_name}"
      return
    fi
    rollback_require_production_bootstrap_executable \
      "${expected_path}" "fixed rollback command ${command_name}" || return $?
  done
  if [[ "$(PATH="${fixed_vps_path}" command -v node)" != \
      "${node_binary}" ]] ||
    [[ "$(PATH="${fixed_vps_path}" command -v curl)" != "/usr/bin/curl" ]] ||
    [[ "$(PATH="${fixed_vps_path}" command -v bash)" != "/usr/bin/bash" ]] ||
    [[ "$(PATH="${fixed_vps_path}" command -v sh)" != "/usr/bin/sh" ]]; then
    rollback_fail 70 \
      "unprivileged rollback children do not resolve to the validated profile"
    return
  fi
}

rollback_is_safe_release_id() {
  local release_id="$1"

  [[ "${release_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]
}

rollback_require_directory() {
  local path="$1"
  local expected_metadata="$2"
  local label="$3"
  local actual_metadata
  local canonical_path

  if [[ ! -d "${path}" || -L "${path}" ]]; then
    rollback_fail 70 "${label} must be a real directory: ${path}"
    return
  fi
  if ! canonical_path="$(realpath -- "${path}")" || [[ "${canonical_path}" != "${path}" ]]; then
    rollback_fail 70 "${label} must not traverse a symlink: ${path}"
    return
  fi
  if ! actual_metadata="$(stat -c '%U:%G:%a' -- "${path}")"; then
    rollback_fail 70 "could not inspect ${label}: ${path}"
    return
  fi
  if [[ "${actual_metadata}" != "${expected_metadata}" ]]; then
    rollback_fail 70 "${label} has unexpected ownership or permissions: ${path}"
    return
  fi
}

rollback_require_regular_file() {
  local path="$1"
  local expected_metadata="$2"
  local label="$3"
  local actual_metadata

  if [[ ! -f "${path}" || -L "${path}" ]]; then
    rollback_fail 70 "${label} must be a regular non-symlink file: ${path}"
    return
  fi
  if ! actual_metadata="$(stat -c '%U:%G:%a' -- "${path}")"; then
    rollback_fail 70 "could not inspect ${label}: ${path}"
    return
  fi
  if [[ "${actual_metadata}" != "${expected_metadata}" ]]; then
    rollback_fail 70 "${label} has unexpected ownership or permissions: ${path}"
    return
  fi
}

rollback_require_current_next_candidate() {
  local candidate_path="$1"
  local expected_target="$2"
  local label="$3"
  local candidate_metadata
  local candidate_target
  local resolved_target

  if [[ ! -L "${candidate_path}" ]] ||
    ! candidate_target="$(readlink -- "${candidate_path}")" ||
    [[ "${candidate_target}" != "${expected_target}" ]] ||
    ! candidate_metadata="$(stat -c '%U:%G:%h:%s' -- \
      "${candidate_path}")" ||
    [[ "${candidate_metadata}" != \
      "root:root:1:${#expected_target}" ]] ||
    ! resolved_target="$(realpath -- "${candidate_path}")" ||
    [[ "${resolved_target}" != "${expected_target}" ]]; then
    rollback_fail 70 \
      "${label} is not the exact failed-release symlink"
    return
  fi
}

rollback_require_trusted_release_path() {
  local path="$1"
  local object_type="$2"
  local executable_required="$3"
  local label="$4"
  local canonical_path
  local metadata
  local owner
  local group
  local mode
  local permissions

  if [[ -L "${path}" ]]; then
    rollback_fail 70 "${label} must not traverse a symlink: ${path}"
    return
  fi
  case "${object_type}" in
    directory)
      if [[ ! -d "${path}" ]]; then
        rollback_fail 70 "${label} must be a real directory: ${path}"
        return
      fi
      ;;
    file)
      if [[ ! -f "${path}" ]]; then
        rollback_fail 70 "${label} must be a regular non-symlink file: ${path}"
        return
      fi
      ;;
    *)
      rollback_fail 64 "invalid trusted release object type: ${object_type}"
      return
      ;;
  esac

  if ! canonical_path="$(realpath -- "${path}")" || [[ "${canonical_path}" != "${path}" ]]; then
    rollback_fail 70 "${label} must not traverse a symlink: ${path}"
    return
  fi
  if ! metadata="$(stat -c '%U:%G:%a' -- "${path}")"; then
    rollback_fail 70 "could not inspect ${label}: ${path}"
    return
  fi
  IFS=: read -r owner group mode <<<"${metadata}"
  if [[ "${owner}" != "root" ||
    ( "${group}" != "root" && "${group}" != "diesel" ) ]]; then
    rollback_fail 70 "${label} must be owned by root with group root or diesel: ${path}"
    return
  fi
  if [[ ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    rollback_fail 70 "${label} has an invalid permission mode: ${path}"
    return
  fi
  permissions=$((8#${mode}))
  if (( (permissions & 0022) != 0 )); then
    rollback_fail 70 "${label} must not be group- or world-writable: ${path}"
    return
  fi
  if [[ "${object_type}" == "directory" ]] && (( (permissions & 0500) != 0500 )); then
    rollback_fail 70 "${label} must be readable and traversable by root: ${path}"
    return
  fi
  if [[ "${object_type}" == "file" ]] && (( (permissions & 0400) == 0 )); then
    rollback_fail 70 "${label} must be readable by root: ${path}"
    return
  fi
  if [[ "${executable_required}" == "yes" ]] && (( (permissions & 0100) == 0 )); then
    rollback_fail 70 "${label} must be executable by root: ${path}"
    return
  fi
  if [[ "${executable_required}" != "yes" && "${executable_required}" != "no" ]]; then
    rollback_fail 64 "invalid executable policy: ${executable_required}"
    return
  fi
}

rollback_require_regular_or_absent() {
  local path="$1"
  local label="$2"

  if [[ -e "${path}" || -L "${path}" ]]; then
    if [[ ! -f "${path}" || -L "${path}" ]]; then
      rollback_fail 70 "${label} must be a regular non-symlink file when present: ${path}"
      return
    fi
  fi
}

rollback_require_absent() {
  local path="$1"
  local label="$2"

  if [[ -e "${path}" || -L "${path}" ]]; then
    rollback_fail 70 "${label} must be absent before host rollback: ${path}"
    return
  fi
}

rollback_acquire_release_lifecycle_lock() {
  local deploy_root="$1"
  local lock_path="${deploy_root}/.release-lifecycle.lock"
  local inherited_lock_fd="${DIESEL_RELEASE_LIFECYCLE_LOCK_FD:-}"
  local inherited_lock_path

  if ! command -v flock >/dev/null 2>&1; then
    rollback_fail 70 "required rollback command is unavailable: flock"
    return
  fi
  rollback_require_regular_file \
    "${lock_path}" "root:root:600" "release lifecycle lock"
  if [[ -n "${inherited_lock_fd}" ]]; then
    if [[ "${inherited_lock_fd}" != "8" ]] ||
      ! { true <&8; } 2>/dev/null; then
      rollback_fail 70 "inherited release lifecycle lock descriptor is invalid"
      return
    fi
    if ! inherited_lock_path="$(realpath -- /proc/self/fd/8)" ||
      [[ "${inherited_lock_path}" != "${lock_path}" ]]; then
      rollback_fail 70 "inherited release lifecycle lock path is invalid"
      return
    fi
  else
    exec 8<>"${lock_path}"
    export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
  fi
  if ! flock -n 8; then
    rollback_fail 70 "another release lifecycle operation is active"
    return
  fi
}

rollback_fsync_paths() {
  local node_binary="$1"
  shift

  if [[ "$#" -lt 1 ]]; then
    rollback_fail 64 "at least one rollback fsync path is required"
    return
  fi
  "${node_binary}" -e '
    const { closeSync, fsyncSync, openSync } = require("node:fs");
    for (const path of process.argv.slice(1)) {
      const descriptor = openSync(path, "r");
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    }
  ' -- "$@"
}

rollback_validate_publish_commit_marker() {
  local publish_commit_marker="$1"
  local expected_snapshot_path="$2"
  local marker_label="${3:-publish commit marker}"
  local marker_contents
  local marker_size
  local committed_snapshot_sha256
  local committed_snapshot_path
  local expected_line
  local actual_snapshot_sha256_output
  local actual_snapshot_sha256

  rollback_require_regular_file \
    "${publish_commit_marker}" "root:root:600" "${marker_label}"

  marker_contents=''
  if ! IFS= read -r marker_contents <"${publish_commit_marker}"; then
    rollback_fail 70 "${marker_label} must be one newline-terminated record"
    return
  fi
  if ! marker_size="$(stat -c '%s' -- "${publish_commit_marker}")"; then
    rollback_fail 70 "could not inspect ${marker_label} size"
    return
  fi
  IFS=$'\t' read -r committed_snapshot_sha256 committed_snapshot_path <<<"${marker_contents}"
  expected_line="${committed_snapshot_sha256}"$'\t'"${expected_snapshot_path}"
  if [[ ! "${committed_snapshot_sha256}" =~ ^[0-9a-f]{64}$ ]] ||
    [[ "${committed_snapshot_path}" != "${expected_snapshot_path}" ]] ||
    [[ "${marker_contents}" != "${expected_line}" ]] ||
    [[ "${marker_size}" != "$((${#expected_line} + 1))" ]]; then
    rollback_fail 70 "${marker_label} has an invalid payload"
    return
  fi

  rollback_require_regular_file \
    "${committed_snapshot_path}" "root:root:600" "committed governance snapshot"
  if ! actual_snapshot_sha256_output="$(sha256sum -- "${committed_snapshot_path}")"; then
    rollback_fail 70 "could not hash the committed governance snapshot"
    return
  fi
  actual_snapshot_sha256="${actual_snapshot_sha256_output%% *}"
  if [[ "${actual_snapshot_sha256}" != "${committed_snapshot_sha256}" ]]; then
    rollback_fail 70 "committed governance snapshot does not match its marker"
    return
  fi
}

rollback_validate_trusted_root_path_chain() (
  set -Eeuo pipefail

  if [[ "$#" -ne 3 ]]; then
    return 64
  fi

  local path="$1"
  local final_type="$2"
  local executable_required="$3"
  local canonical_path
  local cursor='/'
  local metadata
  local owner
  local group
  local mode
  local permissions
  local segment
  local -a segments

  if [[ "${path}" != /* || "${path}" == '/' ||
    "${path}" == *$'\n'* || "${path}" == *$'\r'* ]] ||
    ! canonical_path="$(realpath -- "${path}" 2>/dev/null)" ||
    [[ "${canonical_path}" != "${path}" ]]; then
    return 70
  fi
  if ! metadata="$(stat -c '%U:%G:%a' -- / 2>/dev/null)"; then
    return 70
  fi
  IFS=: read -r owner group mode <<<"${metadata}"
  if [[ "${owner}" != root || "${group}" != root ||
    ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    return 70
  fi
  permissions=$((8#${mode}))
  if (( (permissions & 0022) != 0 || (permissions & 0500) != 0500 )); then
    return 70
  fi
  IFS='/' read -r -a segments <<<"${path#/}"
  if [[ "${#segments[@]}" -eq 0 ]]; then
    return 70
  fi
  for segment in "${segments[@]}"; do
    if [[ -z "${segment}" || "${segment}" == '.' || "${segment}" == '..' ]]; then
      return 70
    fi
    cursor="${cursor%/}/${segment}"
    if [[ -L "${cursor}" ]] ||
      ! metadata="$(stat -c '%U:%G:%a' -- "${cursor}" 2>/dev/null)"; then
      return 70
    fi
    IFS=: read -r owner group mode <<<"${metadata}"
    if [[ "${owner}" != root || "${group}" != root ||
      ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
      return 70
    fi
    permissions=$((8#${mode}))
    if (( (permissions & 0022) != 0 )); then
      return 70
    fi
    if [[ "${cursor}" == "${path}" ]]; then
      case "${final_type}" in
        directory)
          if [[ ! -d "${cursor}" ]] || (( (permissions & 0500) != 0500 )); then
            return 70
          fi
          ;;
        file)
          if [[ ! -f "${cursor}" ]] || (( (permissions & 0400) == 0 )); then
            return 70
          fi
          ;;
        *) return 64 ;;
      esac
      if [[ "${executable_required}" == yes ]]; then
        (( (permissions & 0100) != 0 )) || return 70
      elif [[ "${executable_required}" != no ]]; then
        return 64
      fi
    elif [[ ! -d "${cursor}" ]] || (( (permissions & 0500) != 0500 )); then
      return 70
    fi
  done
)

rollback_read_pm2_unit_disk_identity() (
  set -Eeuo pipefail

  if [[ "$#" -ne 9 ]]; then
    return 64
  fi

  local expected_fragment="$1"
  local expected_pm2_state_root="$2"
  local expected_pm2_exec="$3"
  local fixed_vps_path="$4"
  local node_binary="$5"
  local expected_owner_uid="$6"
  local expected_owner_gid="$7"
  local approved_additional_unit_paths="$8"
  local host_command_path="$9"

  if ! env -i HOME=/root LC_ALL=C PATH="${host_command_path}" \
      systemctl show --property=UnitPath --property=Environment \
        8>&- 2>/dev/null |
    env -i \
      HOME=/root \
      LC_ALL=C \
      PATH="${host_command_path}" \
      EXPECTED_UNIT_FRAGMENT="${expected_fragment}" \
      EXPECTED_PM2_STATE_ROOT="${expected_pm2_state_root}" \
      EXPECTED_PM2_EXEC="${expected_pm2_exec}" \
      EXPECTED_OWNER_UID="${expected_owner_uid}" \
      EXPECTED_OWNER_GID="${expected_owner_gid}" \
      APPROVED_ADDITIONAL_UNIT_PATHS="${approved_additional_unit_paths}" \
      FIXED_VPS_PATH="${fixed_vps_path}" \
      HOST_COMMAND_PATH="${host_command_path}" \
      "${node_binary}" -e '
        const {
          closeSync,
          constants,
          fstatSync,
          lstatSync,
          openSync,
          readSync,
          readlinkSync,
          readdirSync,
          realpathSync,
        } = require("node:fs");
        const { createHash } = require("node:crypto");
        const { basename, dirname, join, normalize } = require("node:path");
        const { spawnSync } = require("node:child_process");

        const MAX_FRAGMENT_BYTES = 64 * 1024;
        const MAX_UNIT_PATH_BYTES = 64 * 1024;
        const MAX_DIRECTORY_ENTRIES = 16 * 1024;
        const expectedFragment = process.env.EXPECTED_UNIT_FRAGMENT;
        const expectedStateRoot = process.env.EXPECTED_PM2_STATE_ROOT;
        const expectedPm2Exec = process.env.EXPECTED_PM2_EXEC;
        const expectedOwnerUid = Number(process.env.EXPECTED_OWNER_UID);
        const expectedOwnerGid = Number(process.env.EXPECTED_OWNER_GID);
        const approvedAdditionalUnitPaths =
          process.env.APPROVED_ADDITIONAL_UNIT_PATHS;
        const fixedPath = process.env.FIXED_VPS_PATH;
        const hostCommandPath = process.env.HOST_COMMAND_PATH;
        const decoder = new TextDecoder("utf-8", { fatal: true });
        const aliasEdges = new Map();
        const presentUnitRoots = [];
        const reverseDependencyObservations = [];
        const reverseEnablementCandidates = [];
        const rootObservations = [];
        const supplementObservations = [];
        let enablementObservation;
        const approvedUnitPathOrder = [
          "/etc/systemd/system.control",
          "/run/systemd/system.control",
          "/run/systemd/transient",
          "/run/systemd/generator.early",
          "/etc/systemd/system",
          "/etc/systemd/system.attached",
          "/run/systemd/system",
          "/run/systemd/system.attached",
          "/run/systemd/generator",
          "/usr/local/lib/systemd/system",
          "/usr/local/share/systemd/system",
          "/usr/lib/systemd/system",
          "/usr/share/systemd/system",
          "/lib/systemd/system",
          "/run/systemd/generator.late",
        ];
        const approvedUnitPaths = new Set(approvedUnitPathOrder);

        function readBoundedDescriptor(descriptor, limit) {
          const buffer = Buffer.allocUnsafe(limit + 1);
          let offset = 0;
          while (offset < buffer.length) {
            const bytesRead = readSync(
              descriptor,
              buffer,
              offset,
              buffer.length - offset,
              null,
            );
            if (bytesRead === 0) break;
            offset += bytesRead;
          }
          if (offset > limit) throw new Error("invalid unit identity");
          return buffer.subarray(0, offset);
        }

        function sameMetadata(left, right) {
          return left.dev === right.dev &&
            left.ino === right.ino &&
            left.mode === right.mode &&
            left.nlink === right.nlink &&
            left.uid === right.uid &&
            left.gid === right.gid &&
            left.size === right.size &&
            left.mtimeMs === right.mtimeMs &&
            left.ctimeMs === right.ctimeMs;
        }

        function readTrustedFragment() {
          const pathBefore = lstatSync(expectedFragment);
          const descriptor = openSync(
            expectedFragment,
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          try {
            const before = fstatSync(descriptor);
            const contents = readBoundedDescriptor(
              descriptor,
              MAX_FRAGMENT_BYTES,
            );
            const after = fstatSync(descriptor);
            const pathAfter = lstatSync(expectedFragment);
            if (
              !before.isFile() ||
              before.isSymbolicLink() ||
              before.nlink !== 1 ||
              before.uid !== expectedOwnerUid ||
              before.gid !== expectedOwnerGid ||
              (before.mode & 0o022) !== 0 ||
              before.size !== contents.length ||
              !sameMetadata(before, after) ||
              !sameMetadata(pathBefore, before) ||
              !sameMetadata(pathAfter, after) ||
              realpathSync(expectedFragment) !== expectedFragment
            ) {
              throw new Error("invalid unit identity");
            }
            return { contents, metadata: after };
          } finally {
            closeSync(descriptor);
          }
        }

        function pathExists(path) {
          try {
            return lstatSync(path);
          } catch (error) {
            if (error?.code === "ENOENT") return undefined;
            throw error;
          }
        }

        function metadataRecord(metadata) {
          return {
            ctimeMs: metadata.ctimeMs,
            dev: metadata.dev,
            gid: metadata.gid,
            ino: metadata.ino,
            mode: metadata.mode,
            mtimeMs: metadata.mtimeMs,
            nlink: metadata.nlink,
            size: metadata.size,
            uid: metadata.uid,
          };
        }

        function validateTrustedExistingPath(path, expectedType) {
          let cursor = "/";
          for (const segment of path.slice(1).split("/")) {
            cursor = join(cursor, segment);
            const metadata = lstatSync(cursor);
            const isFinal = cursor === path;
            const trustedOwner = isFinal
              ? metadata.uid === expectedOwnerUid &&
                metadata.gid === expectedOwnerGid
              : (metadata.uid === 0 && metadata.gid === 0) ||
                (metadata.uid === expectedOwnerUid &&
                  metadata.gid === expectedOwnerGid);
            const testOnlyStickyAncestor =
              !isFinal &&
              expectedOwnerUid !== 0 &&
              (metadata.mode & 0o1000) !== 0;
            if (
              !trustedOwner ||
              (!metadata.isSymbolicLink() &&
                (metadata.mode & 0o022) !== 0 &&
                !testOnlyStickyAncestor) ||
              (cursor !== path &&
                !metadata.isDirectory() &&
                !metadata.isSymbolicLink())
            ) {
              throw new Error("invalid unit identity");
            }
          }
          const canonical = realpathSync(path);
          cursor = "/";
          for (const segment of canonical.slice(1).split("/")) {
            cursor = join(cursor, segment);
            const metadata = lstatSync(cursor);
            const isFinal = cursor === canonical;
            const trustedOwner = isFinal
              ? metadata.uid === expectedOwnerUid &&
                metadata.gid === expectedOwnerGid
              : (metadata.uid === 0 && metadata.gid === 0) ||
                (metadata.uid === expectedOwnerUid &&
                  metadata.gid === expectedOwnerGid);
            const testOnlyStickyAncestor =
              !isFinal &&
              expectedOwnerUid !== 0 &&
              (metadata.mode & 0o1000) !== 0;
            if (
              metadata.isSymbolicLink() ||
              !trustedOwner ||
              ((metadata.mode & 0o022) !== 0 &&
                !testOnlyStickyAncestor) ||
              (cursor !== canonical && !metadata.isDirectory())
            ) {
              throw new Error("invalid unit identity");
            }
          }
          const canonicalMetadata = lstatSync(canonical);
          if (
            (expectedType === "directory" &&
              !canonicalMetadata.isDirectory()) ||
            (expectedType === "file" && !canonicalMetadata.isFile())
          ) {
            throw new Error("invalid unit identity");
          }
          return { canonical, metadata: canonicalMetadata };
        }

        function validateUnitRootPath(root) {
          const first = pathExists(root);
          if (first !== undefined) {
            const trusted = validateTrustedExistingPath(root, "directory");
            const second = lstatSync(root);
            if (!sameMetadata(first, second)) {
              throw new Error("invalid unit identity");
            }
            return {
              absent: false,
              canonical: trusted.canonical,
              metadata: second,
              observation: {
                canonical: trusted.canonical,
                metadata: metadataRecord(second),
                path: root,
                state: "present",
              },
            };
          }

          let parent = dirname(root);
          while (pathExists(parent) === undefined) {
            const nextParent = dirname(parent);
            if (nextParent === parent) {
              throw new Error("invalid unit identity");
            }
            parent = nextParent;
          }
          const parentBefore = lstatSync(parent);
          const trustedParent = validateTrustedExistingPath(parent, "directory");
          const parentAfter = lstatSync(parent);
          if (
            !sameMetadata(parentBefore, parentAfter) ||
            pathExists(root) !== undefined
          ) {
            throw new Error("invalid unit identity");
          }
          return {
            absent: true,
            observation: {
              nearestExistingParent: parent,
              nearestExistingParentCanonical: trustedParent.canonical,
              nearestExistingParentMetadata: metadataRecord(parentAfter),
              path: root,
              state: "absent",
            },
          };
        }

        function parsePathList(paths) {
          if (
            paths.length === 0 ||
            paths.length > 64 ||
            new Set(paths).size !== paths.length ||
            paths.some(
              (path) =>
                !path.startsWith("/") ||
                normalize(path) !== path ||
                (path.length > 1 && path.endsWith("/")),
            )
          ) {
            throw new Error("invalid unit identity");
          }
          return paths;
        }

        function isOrderedSubset(paths, approvedOrder) {
          let approvedIndex = -1;
          for (const path of paths) {
            approvedIndex = approvedOrder.indexOf(path, approvedIndex + 1);
            if (approvedIndex === -1) return false;
          }
          return true;
        }

        function parseManagerProperties(contents) {
          const text = decoder.decode(contents);
          if (
            text.length === 0 ||
            !text.endsWith("\n") ||
            text.includes("\r") ||
            text.includes("\0")
          ) {
            throw new Error("invalid unit identity");
          }
          const properties = new Map();
          for (const line of text.slice(0, -1).split("\n")) {
            const separator = line.indexOf("=");
            const key = line.slice(0, separator);
            if (
              separator <= 0 ||
              !["UnitPath", "Environment"].includes(key) ||
              properties.has(key)
            ) {
              throw new Error("invalid unit identity");
            }
            properties.set(key, line.slice(separator + 1));
          }
          if (
            properties.size !== 2 ||
            properties.get("Environment").includes("SYSTEMD_UNIT_PATH=")
          ) {
            throw new Error("invalid unit identity");
          }
          const unitPath = properties.get("UnitPath");
          if (
            unitPath.length === 0 ||
            /["\\\t]/u.test(unitPath) ||
            unitPath.includes("  ")
          ) {
            throw new Error("invalid unit identity");
          }
          return {
            rawUnitPath: Buffer.from(`${unitPath}\n`, "utf8"),
            unitPaths: parsePathList(unitPath.split(" ")),
          };
        }

        function readCompiledUnitPaths() {
          const result = spawnSync(
            "/usr/bin/env",
            [
              "-i",
              "HOME=/root",
              "LC_ALL=C",
              `PATH=${hostCommandPath}`,
              "systemd-analyze",
              "--system",
              "unit-paths",
            ],
            {
              maxBuffer: MAX_UNIT_PATH_BYTES,
              stdio: ["ignore", "pipe", "ignore"],
            },
          );
          if (
            result.error !== undefined ||
            result.status !== 0 ||
            !Buffer.isBuffer(result.stdout)
          ) {
            throw new Error("invalid unit identity");
          }
          const text = decoder.decode(result.stdout);
          if (
            text.length === 0 ||
            !text.endsWith("\n") ||
            text.includes("\r") ||
            text.includes("\0")
          ) {
            throw new Error("invalid unit identity");
          }
          const paths = text.slice(0, -1).split("\n");
          return {
            paths: parsePathList(paths),
            raw: result.stdout,
          };
        }

        function inspectSupplementDirectory(root, directoryName, mode) {
            const directoryPath = join(root, directoryName);
            const metadata = pathExists(directoryPath);
            if (metadata === undefined) {
              supplementObservations.push({
                path: directoryPath,
                state: "absent",
              });
              return;
            }
            if (
              metadata.isSymbolicLink() ||
              !metadata.isDirectory() ||
              metadata.uid !== expectedOwnerUid ||
              metadata.gid !== expectedOwnerGid ||
              (metadata.mode & 0o022) !== 0
            ) {
              throw new Error("invalid unit identity");
            }
            const entries = readdirSync(directoryPath, { withFileTypes: true });
            const observedEntries = entries.map((entry) => ({
              name: entry.name,
              type: entry.isSymbolicLink()
                ? "symlink"
                : entry.isDirectory()
                  ? "directory"
                  : entry.isFile()
                    ? "file"
                    : "other",
            })).sort((left, right) => left.name.localeCompare(right.name));
            if (
              entries.length > MAX_DIRECTORY_ENTRIES ||
              (mode === "drop-in" &&
                entries.some((entry) => entry.name.endsWith(".conf"))) ||
              (mode === "dependency" && entries.length !== 0)
            ) {
              throw new Error("invalid unit identity");
            }
            const after = lstatSync(directoryPath);
            if (!sameMetadata(metadata, after)) {
              throw new Error("invalid unit identity");
            }
            supplementObservations.push({
              entries: observedEntries,
              metadata: metadataRecord(after),
              path: directoryPath,
              state: "present",
            });
        }

        function rejectDropIns(root, aliasNames = []) {
          for (const unitName of [
            "pm2-root.service",
            "pm2-.service",
            "service",
            ...aliasNames,
          ]) {
            inspectSupplementDirectory(root, `${unitName}.d`, "drop-in");
          }
        }

        function rejectDependencyLinks(root, aliasNames) {
          for (const unitName of [
            "pm2-root.service",
            "pm2-.service",
            "service",
            ...aliasNames,
          ]) {
            for (const kind of ["wants", "requires", "upholds"]) {
              inspectSupplementDirectory(
                root,
                `${unitName}.${kind}`,
                "dependency",
              );
            }
          }
        }

        function validateBootEnablement() {
          const enablementDirectory = join(
            dirname(expectedFragment),
            "multi-user.target.wants",
          );
          const directoryBefore = lstatSync(enablementDirectory);
          validateTrustedExistingPath(enablementDirectory, "directory");
          const linkPath = join(enablementDirectory, "pm2-root.service");
          const linkBefore = lstatSync(linkPath);
          const target = readlinkSync(linkPath, "utf8");
          const linkAfter = lstatSync(linkPath);
          const directoryAfter = lstatSync(enablementDirectory);
          const lexicalTarget = normalize(
            target.startsWith("/")
              ? target
              : join(enablementDirectory, target),
          );
          if (
            !directoryBefore.isDirectory() ||
            directoryBefore.isSymbolicLink() ||
            !sameMetadata(directoryBefore, directoryAfter) ||
            !linkBefore.isSymbolicLink() ||
            linkBefore.nlink !== 1 ||
            linkBefore.uid !== expectedOwnerUid ||
            linkBefore.gid !== expectedOwnerGid ||
            !sameMetadata(linkBefore, linkAfter) ||
            target.length === 0 ||
            target.length > 4096 ||
            target.includes("\0") ||
            lexicalTarget !== expectedFragment ||
            realpathSync(linkPath) !== expectedFragment
          ) {
            throw new Error("invalid unit identity");
          }
          enablementObservation = {
            directoryMetadata: metadataRecord(directoryAfter),
            linkMetadata: metadataRecord(linkAfter),
            linkPath,
            target,
          };
        }

        function scanReverseDependencyCandidates(root, entries) {
          for (const entry of entries) {
            if (!/\.(?:wants|requires|upholds)$/u.test(entry.name)) continue;
            const directoryPath = join(root, entry.name);
            const directoryBefore = lstatSync(directoryPath);
            if (directoryBefore.isSymbolicLink()) {
              throw new Error("invalid unit identity");
            }
            if (!directoryBefore.isDirectory()) {
              reverseDependencyObservations.push({
                metadata: metadataRecord(directoryBefore),
                path: directoryPath,
                state: "not-directory",
              });
              continue;
            }
            if (
              directoryBefore.uid !== expectedOwnerUid ||
              directoryBefore.gid !== expectedOwnerGid ||
              (directoryBefore.mode & 0o022) !== 0
            ) {
              throw new Error("invalid unit identity");
            }
            const candidatePath = join(directoryPath, "pm2-root.service");
            const candidateMetadata = pathExists(candidatePath);
            let candidateObservation;
            if (candidateMetadata !== undefined) {
              let target;
              if (candidateMetadata.isSymbolicLink()) {
                target = readlinkSync(candidatePath, "utf8");
              }
              candidateObservation = {
                metadata: metadataRecord(candidateMetadata),
                path: candidatePath,
                target,
              };
              reverseEnablementCandidates.push(candidateObservation);
            }
            const directoryAfter = lstatSync(directoryPath);
            if (!sameMetadata(directoryBefore, directoryAfter)) {
              throw new Error("invalid unit identity");
            }
            reverseDependencyObservations.push({
              candidate: candidateObservation,
              metadata: metadataRecord(directoryAfter),
              path: directoryPath,
              state: "directory",
            });
          }
        }

        function isServiceUnitName(name) {
          return /^(?:[A-Za-z0-9:_.@-]|\\x[0-9A-Fa-f]{2})+\.service$/u
            .test(name);
        }

        function recordAlias(root, aliasName, target) {
          if (
            target.length === 0 ||
            target.length > 4096 ||
            target.includes("\0")
          ) {
            throw new Error("invalid unit identity");
          }
          if (!isServiceUnitName(aliasName)) {
            throw new Error("invalid unit identity");
          }
          const normalizedTarget = normalize(
            target.startsWith("/") ? target : join(root, target),
          );
          const targetName = basename(normalizedTarget);
          if (!targetName.endsWith(".service")) return;
          if (!isServiceUnitName(targetName)) {
            throw new Error("invalid unit identity");
          }
          const targets = aliasEdges.get(aliasName) ?? new Set();
          targets.add(targetName);
          aliasEdges.set(aliasName, targets);
        }

        function pm2Aliases() {
          const aliases = new Set();
          function reachesPm2(name, visiting) {
            if (name === "pm2-root.service") return true;
            if (visiting.has(name)) return false;
            const nextVisiting = new Set(visiting);
            nextVisiting.add(name);
            for (const target of aliasEdges.get(name) ?? []) {
              if (reachesPm2(target, nextVisiting)) return true;
            }
            return false;
          }
          for (const aliasName of aliasEdges.keys()) {
            if (
              aliasName !== "pm2-root.service" &&
              reachesPm2(aliasName, new Set())
            ) {
              aliases.add(aliasName);
            }
          }
          return aliases;
        }

        function validateUnitRoot(root, expectedCanonicalFragment) {
          const rootIdentity = validateUnitRootPath(root);
          rootObservations.push(rootIdentity.observation);
          if (rootIdentity.absent) {
            return;
          }
          presentUnitRoots.push(root);
          const entries = readdirSync(root, { withFileTypes: true });
          if (entries.length > MAX_DIRECTORY_ENTRIES) {
            throw new Error("invalid unit identity");
          }
          entries.sort((left, right) => left.name.localeCompare(right.name));

          const candidate = join(root, "pm2-root.service");
          const candidateMetadata = pathExists(candidate);
          if (candidateMetadata !== undefined) {
            if (
              candidate !== expectedFragment ||
              candidateMetadata.isSymbolicLink() ||
              !candidateMetadata.isFile() ||
              realpathSync(candidate) !== expectedCanonicalFragment
            ) {
              throw new Error("invalid unit identity");
            }
          }

          scanReverseDependencyCandidates(root, entries);

          for (const entry of entries) {
            if (!entry.name.endsWith(".service")) continue;
            const entryPath = join(root, entry.name);
            if (entryPath === expectedFragment) continue;
            const metadata = lstatSync(entryPath);
            if (!metadata.isSymbolicLink()) continue;
            recordAlias(root, entry.name, readlinkSync(entryPath, "utf8"));
            let canonicalAlias;
            try {
              canonicalAlias = realpathSync(entryPath);
            } catch (error) {
              if (error?.code !== "ENOENT") throw error;
            }
            if (canonicalAlias === expectedCanonicalFragment) {
              throw new Error("invalid unit identity");
            }
          }
        }

        try {
          const managerProperties = parseManagerProperties(
            readBoundedDescriptor(
              0,
              MAX_UNIT_PATH_BYTES,
            ),
          );
          const compiledUnitPaths = readCompiledUnitPaths();
          const expectedUnitRoot = dirname(expectedFragment);
          const additionalUnitPaths = approvedAdditionalUnitPaths === ""
            ? []
            : parsePathList(approvedAdditionalUnitPaths.split(":"));
          for (const path of additionalUnitPaths) {
            approvedUnitPaths.add(path);
          }
          const nonstandardApprovedOrder = additionalUnitPaths.includes(
            expectedUnitRoot,
          )
            ? additionalUnitPaths
            : [expectedUnitRoot, ...additionalUnitPaths];
          if (
            compiledUnitPaths.paths.some(
              (path) =>
                path !== expectedUnitRoot && !approvedUnitPaths.has(path),
            ) ||
            !isOrderedSubset(
              compiledUnitPaths.paths.filter((path) =>
                approvedUnitPathOrder.includes(path),
              ),
              approvedUnitPathOrder,
            ) ||
            !isOrderedSubset(
              compiledUnitPaths.paths.filter((path) =>
                !approvedUnitPathOrder.includes(path),
              ),
              nonstandardApprovedOrder,
            )
          ) {
            throw new Error("invalid unit identity");
          }
          let compiledIndex = -1;
          for (const managerPath of managerProperties.unitPaths) {
            if (pathExists(managerPath) === undefined) {
              throw new Error("invalid unit identity");
            }
            compiledIndex = compiledUnitPaths.paths.indexOf(
              managerPath,
              compiledIndex + 1,
            );
            if (compiledIndex === -1) {
              throw new Error("invalid unit identity");
            }
          }
          if (
            !managerProperties.unitPaths.includes(dirname(expectedFragment)) ||
            !compiledUnitPaths.paths.includes(dirname(expectedFragment))
          ) {
            throw new Error("invalid unit identity");
          }
          const fragmentPathMetadata = lstatSync(expectedFragment);
          if (
            expectedFragment !== join(expectedUnitRoot, "pm2-root.service") ||
            !fragmentPathMetadata.isFile() ||
            fragmentPathMetadata.isSymbolicLink() ||
            fragmentPathMetadata.nlink !== 1 ||
            fragmentPathMetadata.uid !== expectedOwnerUid ||
            fragmentPathMetadata.gid !== expectedOwnerGid ||
            (fragmentPathMetadata.mode & 0o022) !== 0
          ) {
            throw new Error("invalid unit identity");
          }
          const expectedCanonicalFragment = realpathSync(expectedFragment);
          validateBootEnablement();
          for (const root of compiledUnitPaths.paths) {
            validateUnitRoot(root, expectedCanonicalFragment);
          }
          const aliases = [...pm2Aliases()].sort();
          for (const root of presentUnitRoots) {
            rejectDropIns(root, aliases);
            rejectDependencyLinks(root, aliases);
          }
          if (aliases.length !== 0) {
            throw new Error("invalid unit identity");
          }
          const expectedEnablementLink = join(
            expectedUnitRoot,
            "multi-user.target.wants",
            "pm2-root.service",
          );
          if (
            reverseEnablementCandidates.length !== 1 ||
            reverseEnablementCandidates[0].path !== expectedEnablementLink
          ) {
            throw new Error("invalid unit identity");
          }

          const unitPath = `${fixedPath}:/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin`;
          const expectedUnit = [
            "[Unit]",
            "Description=PM2 process manager",
            "Documentation=https://pm2.keymetrics.io/",
            "After=network.target",
            "",
            "[Service]",
            "Type=forking",
            "User=root",
            "LimitNOFILE=infinity",
            "LimitNPROC=infinity",
            "LimitCORE=infinity",
            `Environment=PATH=${unitPath}`,
            `Environment=PM2_HOME=${expectedStateRoot}`,
            `PIDFile=${expectedStateRoot}/pm2.pid`,
            "Restart=on-failure",
            "",
            `ExecStart=${expectedPm2Exec} resurrect`,
            `ExecReload=${expectedPm2Exec} reload all`,
            `ExecStop=${expectedPm2Exec} kill`,
            "",
            "[Install]",
            "WantedBy=multi-user.target",
            "",
          ].join("\n");
          const fragment = readTrustedFragment();
          const expectedBytes = Buffer.from(expectedUnit, "utf8");
          if (!fragment.contents.equals(expectedBytes)) {
            throw new Error("invalid unit identity");
          }
          const fingerprint = createHash("sha256")
            .update("diesel-pm2-systemd-unit-v1\0")
            .update(managerProperties.rawUnitPath)
            .update("\0")
            .update(compiledUnitPaths.raw)
            .update("\0")
            .update(fragment.contents)
            .update("\0")
            .update(JSON.stringify(metadataRecord(fragment.metadata)))
            .update("\0")
            .update(JSON.stringify(rootObservations))
            .update("\0")
            .update(JSON.stringify(supplementObservations))
            .update("\0")
            .update(JSON.stringify(enablementObservation))
            .update("\0")
            .update(JSON.stringify(reverseDependencyObservations))
            .update("\0")
            .update(JSON.stringify(reverseEnablementCandidates))
            .update("\0")
            .update(JSON.stringify(
              [...aliasEdges.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([name, targets]) => [name, [...targets].sort()]),
            ))
            .digest("hex");
          process.stdout.write(fingerprint);
        } catch {
          process.exitCode = 70;
        }
      ' 8>&- 2>/dev/null; then
    return 70
  fi
)

rollback_validate_pm2_systemd_identity() (
  set -Eeuo pipefail

  if [[ "$#" -ne 10 ]]; then
    return 64
  fi

  local expected_pm2_state_root="$1"
  local expected_pm2_exec="$2"
  local proc_root="$3"
  local node_binary="$4"
  local fixed_vps_path="$5"
  local expected_fragment="$6"
  local expected_daemon_uid="$7"
  local expected_daemon_gid="$8"
  local approved_additional_unit_paths="$9"
  local host_command_path="${10}"
  local expected_pid_file="${expected_pm2_state_root}/pm2.pid"
  local disk_identity_before
  local disk_identity_after

  if [[ ! "${expected_daemon_uid}" =~ ^(0|[1-9][0-9]{0,9})$ ]] ||
    [[ ! "${expected_daemon_gid}" =~ ^(0|[1-9][0-9]{0,9})$ ]] ||
    [[ "${expected_daemon_uid}" -gt 4294967294 ]] ||
    [[ "${expected_daemon_gid}" -gt 4294967294 ]]; then
    return 70
  fi

  rollback_validate_trusted_root_path_chain \
    "${expected_pm2_state_root}" directory no
  rollback_validate_trusted_root_path_chain \
    "${expected_pid_file}" file no
  rollback_validate_trusted_root_path_chain \
    "${expected_pm2_exec}" file yes
  rollback_validate_trusted_root_path_chain \
    "${expected_fragment}" file no
  if [[ ! -d "${proc_root}" || -L "${proc_root}" ]] ||
    [[ "$(realpath -- "${proc_root}" 2>/dev/null)" != "${proc_root}" ]]; then
    return 70
  fi
  if ! disk_identity_before="$(
    rollback_read_pm2_unit_disk_identity \
      "${expected_fragment}" "${expected_pm2_state_root}" \
      "${expected_pm2_exec}" "${fixed_vps_path}" "${node_binary}" \
      "${expected_daemon_uid}" "${expected_daemon_gid}" \
      "${approved_additional_unit_paths}" "${host_command_path}"
  )" || [[ ! "${disk_identity_before}" =~ ^[0-9a-f]{64}$ ]]; then
    return 70
  fi

  if ! env -i HOME=/root LC_ALL=C PATH="${host_command_path}" \
      systemctl show pm2-root --all --no-pager \
        --property=Id \
        --property=Names \
        --property=LoadState \
        --property=ActiveState \
        --property=SubState \
        --property=UnitFileState \
        --property=Type \
        --property=User \
        --property=Environment \
        --property=EnvironmentFiles \
        --property=PIDFile \
        --property=ExecCondition \
        --property=ExecStart \
        --property=ExecStartPre \
        --property=ExecStartPost \
        --property=ExecReload \
        --property=ExecStop \
        --property=ExecStopPost \
        --property=Restart \
        --property=Wants \
        --property=Requires \
        --property=Upholds \
        --property=Requisite \
        --property=BindsTo \
        --property=OnFailure \
        --property=OnSuccess \
        --property=PartOf \
        --property=Conflicts \
        --property=RootDirectory \
        --property=RootImage \
        --property=Group \
        --property=SupplementaryGroups \
        --property=PAMName \
        --property=PassEnvironment \
        --property=UnsetEnvironment \
        --property=DynamicUser \
        --property=Slice \
        --property=WorkingDirectory \
        --property=MainPID \
        --property=ControlGroup \
        --property=FragmentPath \
        --property=DropInPaths \
        --property=NeedDaemonReload \
        8>&- 2>/dev/null |
    env -i \
      HOME=/root \
      LC_ALL=C \
      PATH="${host_command_path}" \
      EXPECTED_PM2_STATE_ROOT="${expected_pm2_state_root}" \
      EXPECTED_PM2_EXEC="${expected_pm2_exec}" \
      EXPECTED_UNIT_FRAGMENT="${expected_fragment}" \
      EXPECTED_PROC_ROOT="${proc_root}" \
      EXPECTED_NODE_BINARY="${node_binary}" \
      EXPECTED_DAEMON_UID="${expected_daemon_uid}" \
      EXPECTED_DAEMON_GID="${expected_daemon_gid}" \
      FIXED_VPS_PATH="${fixed_vps_path}" \
      HOST_COMMAND_PATH="${host_command_path}" \
      "${node_binary}" -e '
        const {
          closeSync,
          constants,
          lstatSync,
          openSync,
          readSync,
          realpathSync,
        } = require("node:fs");
        const { dirname, resolve } = require("node:path");
        const { spawnSync } = require("node:child_process");

        const MAX_SHOW_BYTES = 64 * 1024;
        const MAX_ENVIRON_BYTES = 64 * 1024;
        const MAX_CGROUP_BYTES = 512;
        const MAX_PID_BYTES = 16;
        const expectedStateRoot = process.env.EXPECTED_PM2_STATE_ROOT;
        const expectedPm2Exec = process.env.EXPECTED_PM2_EXEC;
        const expectedFragment = process.env.EXPECTED_UNIT_FRAGMENT;
        const procRoot = process.env.EXPECTED_PROC_ROOT;
        const expectedNode = process.env.EXPECTED_NODE_BINARY;
        const expectedDaemonUid = Number(process.env.EXPECTED_DAEMON_UID);
        const expectedDaemonGid = Number(process.env.EXPECTED_DAEMON_GID);
        const fixedPath = process.env.FIXED_VPS_PATH;
        const hostCommandPath = process.env.HOST_COMMAND_PATH;
        const expectedPidFile = resolve(expectedStateRoot, "pm2.pid");
        const expectedControlGroup = "/system.slice/pm2-root.service";
        const propertyNames = [
          "Id",
          "Names",
          "LoadState",
          "ActiveState",
          "SubState",
          "UnitFileState",
          "Type",
          "User",
          "Environment",
          "EnvironmentFiles",
          "PIDFile",
          "ExecCondition",
          "ExecStart",
          "ExecStartPre",
          "ExecStartPost",
          "ExecReload",
          "ExecStop",
          "ExecStopPost",
          "Restart",
          "Wants",
          "Requires",
          "Upholds",
          "Requisite",
          "BindsTo",
          "OnFailure",
          "OnSuccess",
          "PartOf",
          "Conflicts",
          "RootDirectory",
          "RootImage",
          "Group",
          "SupplementaryGroups",
          "PAMName",
          "PassEnvironment",
          "UnsetEnvironment",
          "DynamicUser",
          "Slice",
          "WorkingDirectory",
          "MainPID",
          "ControlGroup",
          "FragmentPath",
          "DropInPaths",
          "NeedDaemonReload",
        ];
        const propertySet = new Set(propertyNames);
        const showArguments = [
          "show",
          "pm2-root",
          "--all",
          "--no-pager",
          ...propertyNames.map((name) => `--property=${name}`),
        ];
        const decoder = new TextDecoder("utf-8", { fatal: true });

        function readBoundedDescriptor(descriptor, limit) {
          const buffer = Buffer.allocUnsafe(limit + 1);
          let offset = 0;
          while (offset < buffer.length) {
            const bytesRead = readSync(
              descriptor,
              buffer,
              offset,
              buffer.length - offset,
              null,
            );
            if (bytesRead === 0) break;
            offset += bytesRead;
          }
          if (offset > limit) throw new Error("invalid systemd identity");
          return buffer.subarray(0, offset);
        }

        function readBounded(path, limit) {
          const descriptor = openSync(
            path,
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          try {
            return readBoundedDescriptor(descriptor, limit);
          } finally {
            closeSync(descriptor);
          }
        }

        function parseProperties(contents) {
          const text = decoder.decode(contents);
          if (text.length === 0 || !text.endsWith("\n") || text.includes("\r")) {
            throw new Error("invalid systemd identity");
          }
          const lines = text.slice(0, -1).split("\n");
          const properties = new Map();
          for (const line of lines) {
            const separator = line.indexOf("=");
            const key = line.slice(0, separator);
            if (
              separator <= 0 ||
              !propertySet.has(key) ||
              properties.has(key)
            ) {
              throw new Error("invalid systemd identity");
            }
            properties.set(key, line.slice(separator + 1));
          }
          if (properties.size !== propertyNames.length) {
            throw new Error("invalid systemd identity");
          }
          return properties;
        }

        function parseUnitEnvironment(value) {
          if (
            value.length === 0 ||
            /["\\\r\n\t]/u.test(value)
          ) {
            throw new Error("invalid systemd identity");
          }
          const entries = value.split(" ");
          if (entries.length !== 2) {
            throw new Error("invalid systemd identity");
          }
          const environment = new Map();
          for (const entry of entries) {
            const separator = entry.indexOf("=");
            const key = entry.slice(0, separator);
            const entryValue = entry.slice(separator + 1);
            if (
              separator <= 0 ||
              !["PATH", "PM2_HOME"].includes(key) ||
              environment.has(key) ||
              entryValue.length === 0
            ) {
              throw new Error("invalid systemd identity");
            }
            environment.set(key, entryValue);
          }
          const unitPath = environment.get("PATH");
          const expectedUnitPath = `${fixedPath}:/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin`;
          if (
            environment.get("PM2_HOME") !== expectedStateRoot ||
            typeof unitPath !== "string" ||
            fixedPath.split(":")[0] !== dirname(expectedNode) ||
            unitPath !== expectedUnitPath
          ) {
            throw new Error("invalid systemd identity");
          }
          return unitPath;
        }

        function validateExecCommand(value, expectedArguments) {
          if (
            !value.startsWith("{ ") ||
            !value.endsWith(" }") ||
            value.slice(2, -2).includes("{") ||
            value.slice(2, -2).includes("}")
          ) {
            throw new Error("invalid systemd identity");
          }
          const fields = value.slice(2, -2).split(" ; ");
          if (
            fields.length !== 8 ||
            fields[0] !== `path=${expectedPm2Exec}` ||
            fields[1] !==
              `argv[]=${expectedPm2Exec} ${expectedArguments}` ||
            fields[2] !== "ignore_errors=no" ||
            !fields[3].startsWith("start_time=[") ||
            !fields[3].endsWith("]") ||
            !fields[4].startsWith("stop_time=[") ||
            !fields[4].endsWith("]") ||
            !/^pid=(?:0|[1-9][0-9]{0,9})$/u.test(fields[5]) ||
            !/^code=(?:\(null\)|exited|killed|dumped)$/u.test(fields[6]) ||
            !/^status=[^;{}\r\n]+$/u.test(fields[7])
          ) {
            throw new Error("invalid systemd identity");
          }
        }

        function parseUnitSet(value) {
          if (
            value.includes("\0") ||
            value.includes("\r") ||
            value.includes("\n") ||
            value.includes("\t") ||
            value.includes("  ")
          ) {
            throw new Error("invalid systemd identity");
          }
          if (value === "") return new Set();
          const names = value.split(" ");
          if (
            new Set(names).size !== names.length ||
            names.some((name) => !/^[A-Za-z0-9:_.@-]+$/u.test(name))
          ) {
            throw new Error("invalid systemd identity");
          }
          return new Set(names);
        }

        function hasExactMembers(actual, expected) {
          return actual.size === expected.size &&
            [...expected].every((value) => actual.has(value));
        }

        function validateProperties(properties, expectedPid) {
          const wants = parseUnitSet(properties.get("Wants"));
          const requires = parseUnitSet(properties.get("Requires"));
          const upholds = parseUnitSet(properties.get("Upholds"));
          const conflicts = parseUnitSet(properties.get("Conflicts"));
          if (
            properties.get("Id") !== "pm2-root.service" ||
            properties.get("Names") !== "pm2-root.service" ||
            properties.get("LoadState") !== "loaded" ||
            properties.get("ActiveState") !== "active" ||
            properties.get("SubState") !== "running" ||
            properties.get("UnitFileState") !== "enabled" ||
            properties.get("Type") !== "forking" ||
            properties.get("User") !== "root" ||
            properties.get("EnvironmentFiles") !== "" ||
            properties.get("PIDFile") !== expectedPidFile ||
            properties.get("ExecCondition") !== "" ||
            properties.get("ExecStartPre") !== "" ||
            properties.get("ExecStartPost") !== "" ||
            properties.get("ExecStopPost") !== "" ||
            properties.get("Restart") !== "on-failure" ||
            properties.get("Requisite") !== "" ||
            properties.get("BindsTo") !== "" ||
            properties.get("OnFailure") !== "" ||
            properties.get("OnSuccess") !== "" ||
            properties.get("PartOf") !== "" ||
            !hasExactMembers(conflicts, new Set(["shutdown.target"])) ||
            properties.get("RootDirectory") !== "" ||
            properties.get("RootImage") !== "" ||
            properties.get("Group") !== "" ||
            properties.get("SupplementaryGroups") !== "" ||
            properties.get("PAMName") !== "" ||
            properties.get("PassEnvironment") !== "" ||
            properties.get("UnsetEnvironment") !== "" ||
            properties.get("DynamicUser") !== "no" ||
            properties.get("Slice") !== "system.slice" ||
            properties.get("WorkingDirectory") !== "" ||
            properties.get("ControlGroup") !== expectedControlGroup ||
            properties.get("FragmentPath") !== expectedFragment ||
            properties.get("DropInPaths") !== "" ||
            properties.get("NeedDaemonReload") !== "no" ||
            wants.size !== 0 ||
            upholds.size !== 0 ||
            !hasExactMembers(
              requires,
              new Set(["system.slice", "sysinit.target"]),
            )
          ) {
            throw new Error("invalid systemd identity");
          }
          const mainPidText = properties.get("MainPID");
          if (
            !/^[1-9][0-9]{0,6}$/u.test(mainPidText) ||
            Number(mainPidText) <= 1 ||
            Number(mainPidText) > 4194304 ||
            (expectedPid !== undefined && Number(mainPidText) !== expectedPid)
          ) {
            throw new Error("invalid systemd identity");
          }
          validateExecCommand(properties.get("ExecStart"), "resurrect");
          validateExecCommand(properties.get("ExecReload"), "reload all");
          validateExecCommand(properties.get("ExecStop"), "kill");
          return {
            pid: Number(mainPidText),
            unitPath: parseUnitEnvironment(properties.get("Environment")),
          };
        }

        function parseNulTerminatedEnvironment(contents) {
          if (contents.length === 0 || contents.at(-1) !== 0) {
            throw new Error("invalid systemd identity");
          }
          const entries = decoder.decode(contents.subarray(0, -1)).split("\0");
          if (entries.some((entry) => entry.length === 0)) {
            throw new Error("invalid systemd identity");
          }
          return entries;
        }

        function validateLiveDaemon(identity) {
          const pidFileMetadata = lstatSync(expectedPidFile);
          if (
            !pidFileMetadata.isFile() ||
            pidFileMetadata.isSymbolicLink() ||
            pidFileMetadata.nlink !== 1 ||
            realpathSync(expectedPidFile) !== expectedPidFile
          ) {
            throw new Error("invalid systemd identity");
          }
          const pidFileContents = decoder.decode(
            readBounded(expectedPidFile, MAX_PID_BYTES),
          );
          if (pidFileContents !== String(identity.pid)) {
            throw new Error("invalid systemd identity");
          }

          const processRoot = resolve(procRoot, String(identity.pid));
          const processMetadata = lstatSync(processRoot);
          if (
            !processMetadata.isDirectory() ||
            processMetadata.isSymbolicLink() ||
            processMetadata.uid !== expectedDaemonUid ||
            processMetadata.gid !== expectedDaemonGid ||
            realpathSync(processRoot) !== processRoot ||
            realpathSync(resolve(processRoot, "exe")) !== expectedNode
          ) {
            throw new Error("invalid systemd identity");
          }
          const cgroup = decoder.decode(
            readBounded(resolve(processRoot, "cgroup"), MAX_CGROUP_BYTES),
          );
          if (cgroup !== `0::${expectedControlGroup}\n`) {
            throw new Error("invalid systemd identity");
          }
          const environment = parseNulTerminatedEnvironment(
            readBounded(resolve(processRoot, "environ"), MAX_ENVIRON_BYTES),
          );
          const pm2Homes = environment.filter(
            (entry) => entry.startsWith("PM2_HOME="),
          );
          const paths = environment.filter((entry) => entry.startsWith("PATH="));
          if (
            pm2Homes.length !== 1 ||
            pm2Homes[0] !== `PM2_HOME=${expectedStateRoot}` ||
            paths.length !== 1 ||
            paths[0] !== `PATH=${identity.unitPath}`
          ) {
            throw new Error("invalid systemd identity");
          }
        }

        function readSecondSnapshot() {
          const result = spawnSync(
            "/usr/bin/env",
            [
              "-i",
              "HOME=/root",
              "LC_ALL=C",
              `PATH=${hostCommandPath}`,
              "systemctl",
              ...showArguments,
            ],
            {
              maxBuffer: MAX_SHOW_BYTES,
              stdio: ["ignore", "pipe", "ignore"],
            },
          );
          if (
            result.error !== undefined ||
            result.status !== 0 ||
            !Buffer.isBuffer(result.stdout)
          ) {
            throw new Error("invalid systemd identity");
          }
          return parseProperties(result.stdout);
        }

        try {
          if (
            !expectedStateRoot.startsWith("/") ||
            !expectedPm2Exec.startsWith("/") ||
            !expectedFragment.startsWith("/") ||
            !procRoot.startsWith("/") ||
            !expectedNode.startsWith("/") ||
            !fixedPath.startsWith("/") ||
            realpathSync(expectedStateRoot) !== expectedStateRoot ||
            realpathSync(procRoot) !== procRoot
          ) {
            throw new Error("invalid systemd identity");
          }
          const firstIdentity = validateProperties(
            parseProperties(readBoundedDescriptor(0, MAX_SHOW_BYTES)),
          );
          validateLiveDaemon(firstIdentity);
          const secondIdentity = validateProperties(
            readSecondSnapshot(),
            firstIdentity.pid,
          );
          if (secondIdentity.unitPath !== firstIdentity.unitPath) {
            throw new Error("invalid systemd identity");
          }
        } catch {
          process.exitCode = 70;
        }
      ' 8>&- 2>/dev/null; then
    return 70
  fi
  if ! disk_identity_after="$(
    rollback_read_pm2_unit_disk_identity \
      "${expected_fragment}" "${expected_pm2_state_root}" \
      "${expected_pm2_exec}" "${fixed_vps_path}" "${node_binary}" \
      "${expected_daemon_uid}" "${expected_daemon_gid}" \
      "${approved_additional_unit_paths}" "${host_command_path}"
  )" || [[ "${disk_identity_after}" != "${disk_identity_before}" ]]; then
    return 70
  fi
  rollback_validate_trusted_root_path_chain \
    "${expected_fragment}" file no
)

rollback_inspect_pm2_process() {
  local expected_app_version="$1"
  local fixed_vps_path="$2"
  local node_binary="$3"
  local expected_pm2_exec="$4"
  local host_command_path="$5"

  if [[ "${host_command_path}" == "${fixed_vps_path}" ]]; then
    env -i HOME=/root PATH="${host_command_path}" pm2 jlist 8>&-
  else
    env -i HOME=/root PATH="${host_command_path}" \
      "${node_binary}" "${expected_pm2_exec}" jlist 8>&-
  fi |
    EXPECTED_APP_VERSION="${expected_app_version}" "${node_binary}" -e '
      const apps = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      if (!Array.isArray(apps)) {
        throw new Error("Unexpected PM2 process list");
      }
      const matches = apps.filter((app) => app.name === "diesel-demo");
      const app = matches[0];
      const pm2Environment = app?.pm2_env ?? {};
      const appVersions = [
        pm2Environment.APP_VERSION,
        pm2Environment.env?.APP_VERSION,
      ].filter((value) => value !== undefined);
      const healthy =
        matches.length === 1 &&
        app?.pm2_env?.status === "online" &&
        Number.isInteger(app.pid) &&
        app.pid > 1 &&
        appVersions.length > 0 &&
        appVersions.every(
          (version) => version === process.env.EXPECTED_APP_VERSION,
        );

      if (healthy) {
        process.stdout.write(`healthy:${app.pid}`);
      } else {
        process.stdout.write(`repair:${matches.length}`);
      }
    ' 8>&-
}

rollback_validate_pm2_process() {
  if [[ "$#" -ne 10 ]]; then
    rollback_fail 64 "PM2 process validation requires ten fixed arguments"
    return
  fi

  local expected_app_version="$1"
  local expected_release_dir="$2"
  local expected_configured_cwd="$3"
  local proc_root="$4"
  local fixed_vps_path="$5"
  local node_binary="$6"
  local expected_runtime_uid="$7"
  local expected_runtime_gid="$8"
  local expected_pm2_exec="$9"
  local host_command_path="${10}"
  local pm2_process_list
  local pm2_process_pid
  local process_uid
  local process_gid
  local pm2_runner_mode=fixed-node

  if [[ ! -d "${expected_release_dir}" || -L "${expected_release_dir}" ||
    ! -L "${expected_configured_cwd}" ||
    ! -d "${proc_root}" || -L "${proc_root}" ]] ||
    [[ "$(realpath -- "${expected_release_dir}" 2>/dev/null)" != \
      "${expected_release_dir}" ]] ||
    [[ "$(realpath -- "${expected_configured_cwd}" 2>/dev/null)" != \
      "${expected_release_dir}" ]] ||
    [[ "$(realpath -- "${proc_root}" 2>/dev/null)" != "${proc_root}" ]]; then
    rollback_fail 70 "rollback process identity validation failed"
    return
  fi

  if [[ "${host_command_path}" == "${fixed_vps_path}" ]]; then
    pm2_runner_mode=path-fixture
    pm2_process_list="$(
      env -i HOME=/root PATH="${host_command_path}" pm2 jlist 8>&- 2>/dev/null
    )" || {
      rollback_fail 70 "rollback process identity validation failed"
      return
    }
  elif ! pm2_process_list="$(
    env -i HOME=/root PATH="${host_command_path}" \
      "${node_binary}" "${expected_pm2_exec}" jlist 8>&- 2>/dev/null
  )"; then
    rollback_fail 70 "rollback process identity validation failed"
    return
  fi
  if ! pm2_process_pid="$(
    printf '%s' "${pm2_process_list}" |
      env -i \
        HOME=/root \
        PATH="${host_command_path}" \
        EXPECTED_APP_VERSION="${expected_app_version}" \
        EXPECTED_RELEASE_DIR="${expected_release_dir}" \
        EXPECTED_CONFIGURED_CWD="${expected_configured_cwd}" \
        EXPECTED_PROC_ROOT="${proc_root}" \
        EXPECTED_NODE_BINARY="${node_binary}" \
        EXPECTED_RUNTIME_UID="${expected_runtime_uid}" \
        EXPECTED_RUNTIME_GID="${expected_runtime_gid}" \
        EXPECTED_PM2_EXEC="${expected_pm2_exec}" \
        HOST_COMMAND_PATH="${host_command_path}" \
        PM2_RUNNER_MODE="${pm2_runner_mode}" \
        FIXED_VPS_PATH="${fixed_vps_path}" \
        "${node_binary}" -e '
          const {
            closeSync,
            constants,
            lstatSync,
            openSync,
            readSync,
            realpathSync,
          } = require("node:fs");
          const { isAbsolute, relative, resolve, sep } = require("node:path");
          const { spawnSync } = require("node:child_process");

          const MAX_JLIST_BYTES = 16 * 1024 * 1024;
          const MAX_PACKAGE_BYTES = 64 * 1024;
          const MAX_CMDLINE_BYTES = 4096;
          const expectedVersion = process.env.EXPECTED_APP_VERSION;
          const expectedRelease = process.env.EXPECTED_RELEASE_DIR;
          const expectedCwd = process.env.EXPECTED_CONFIGURED_CWD;
          const procRoot = process.env.EXPECTED_PROC_ROOT;
          const expectedNode = process.env.EXPECTED_NODE_BINARY;
          const expectedPm2Exec = process.env.EXPECTED_PM2_EXEC;
          const hostCommandPath = process.env.HOST_COMMAND_PATH;
          const pm2RunnerMode = process.env.PM2_RUNNER_MODE;
          const fixedPath = process.env.FIXED_VPS_PATH;
          const identityPattern = /^(?:0|[1-9][0-9]{0,9})$/u;
          const expectedUidText = process.env.EXPECTED_RUNTIME_UID;
          const expectedGidText = process.env.EXPECTED_RUNTIME_GID;
          if (
            !identityPattern.test(expectedUidText) ||
            !identityPattern.test(expectedGidText)
          ) {
            throw new Error("invalid identity");
          }
          const expectedUid = Number(expectedUidText);
          const expectedGid = Number(expectedGidText);
          if (
            expectedUid > 4294967294 ||
            expectedGid > 4294967294
          ) {
            throw new Error("invalid identity");
          }
          const expectedArgs = [
            "-i",
            `HOME=${resolve(expectedCwd, "..", "shared")}`,
            `PATH=${fixedPath}`,
            "NODE_ENV=production",
            `APP_VERSION=${expectedVersion}`,
            expectedNode,
            "--env-file=.env.production.local",
            "node_modules/next/dist/bin/next",
            "start",
            "--hostname",
            "127.0.0.1",
            "--port",
            "8788",
          ];

          function readBoundedDescriptor(descriptor, limit) {
            const buffer = Buffer.allocUnsafe(limit + 1);
            let offset = 0;
            while (offset < buffer.length) {
              const bytesRead = readSync(
                descriptor,
                buffer,
                offset,
                buffer.length - offset,
                null,
              );
              if (bytesRead === 0) break;
              offset += bytesRead;
            }
            if (offset > limit) throw new Error("invalid identity");
            return buffer.subarray(0, offset);
          }

          function readBounded(path, limit) {
            const descriptor = openSync(
              path,
              constants.O_RDONLY | constants.O_NOFOLLOW,
            );
            try {
              return readBoundedDescriptor(descriptor, limit);
            } finally {
              closeSync(descriptor);
            }
          }

          function decodeJson(contents) {
            return JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(contents),
            );
          }

          function exactStringArray(actual, expected) {
            return Array.isArray(actual) &&
              actual.length === expected.length &&
              actual.every((value, index) => value === expected[index]);
          }

          function hasTrustedOwnership(metadata, expectedOwner) {
            return metadata.uid === expectedOwner.uid &&
              metadata.gid === expectedOwner.gid;
          }

          function hasTrustedMetadata(metadata, expectedOwner) {
            return hasTrustedOwnership(metadata, expectedOwner) &&
              (metadata.mode & 0o022) === 0;
          }

          function assertTrustedCanonicalPath(path, finalType) {
            const relativePath = relative(expectedRelease, path);
            if (
              relativePath.length === 0 ||
              relativePath === ".." ||
              relativePath.startsWith(`..${sep}`) ||
              isAbsolute(relativePath)
            ) {
              throw new Error("invalid identity");
            }
            const releaseMetadata = lstatSync(expectedRelease);
            if (
              !releaseMetadata.isDirectory() ||
              releaseMetadata.isSymbolicLink() ||
              (releaseMetadata.mode & 0o022) !== 0
            ) {
              throw new Error("invalid identity");
            }
            let cursor = expectedRelease;
            const segments = relativePath.split(sep);
            for (const [index, segment] of segments.entries()) {
              cursor = resolve(cursor, segment);
              const metadata = lstatSync(cursor);
              const isFinal = index === segments.length - 1;
              if (
                metadata.isSymbolicLink() ||
                !hasTrustedMetadata(metadata, releaseMetadata) ||
                (isFinal && finalType === "file" && !metadata.isFile()) ||
                (isFinal && finalType === "directory" &&
                  !metadata.isDirectory()) ||
                (!isFinal && !metadata.isDirectory())
              ) {
                throw new Error("invalid identity");
              }
            }
          }

          function trustedNextPackagePath() {
            const nodeModulesPath = resolve(expectedRelease, "node_modules");
            const nextReference = resolve(nodeModulesPath, "next");
            const packageReference = resolve(nextReference, "package.json");
            const releaseMetadata = lstatSync(expectedRelease);
            assertTrustedCanonicalPath(
              realpathSync(nodeModulesPath),
              "directory",
            );
            const nextReferenceMetadata = lstatSync(nextReference);
            if (
              !hasTrustedOwnership(nextReferenceMetadata, releaseMetadata) ||
              (!nextReferenceMetadata.isDirectory() &&
                !nextReferenceMetadata.isSymbolicLink()) ||
              (nextReferenceMetadata.isDirectory() &&
                !hasTrustedMetadata(nextReferenceMetadata, releaseMetadata))
            ) {
              throw new Error("invalid identity");
            }
            const canonicalNext = realpathSync(nextReference);
            assertTrustedCanonicalPath(canonicalNext, "directory");
            const packageReferenceMetadata = lstatSync(packageReference);
            if (
              packageReferenceMetadata.isSymbolicLink() ||
              !packageReferenceMetadata.isFile() ||
              !hasTrustedMetadata(packageReferenceMetadata, releaseMetadata)
            ) {
              throw new Error("invalid identity");
            }
            const canonicalPackage = realpathSync(packageReference);
            if (relative(canonicalNext, canonicalPackage) !== "package.json") {
              throw new Error("invalid identity");
            }
            assertTrustedCanonicalPath(canonicalPackage, "file");
            return canonicalPackage;
          }

          function validateSnapshot(apps, expectedPid) {
            if (!Array.isArray(apps)) throw new Error("invalid identity");
            const matches = apps.filter(
              (app) => app?.name === "diesel-demo" ||
                app?.pm2_env?.name === "diesel-demo",
            );
            const app = matches[0];
            const pm2Environment = app?.pm2_env;
            if (
              matches.length !== 1 ||
              app?.name !== "diesel-demo" ||
              typeof pm2Environment !== "object" ||
              pm2Environment === null ||
              Array.isArray(pm2Environment) ||
              pm2Environment.name !== "diesel-demo" ||
              pm2Environment.status !== "online" ||
              !Number.isInteger(app.pid) ||
              app.pid <= 1 ||
              (expectedPid !== undefined && app.pid !== expectedPid) ||
              pm2Environment.APP_VERSION !== expectedVersion ||
              pm2Environment.env?.APP_VERSION !== expectedVersion ||
              pm2Environment.pm_cwd !== expectedCwd ||
              pm2Environment.pm_exec_path !== "/usr/bin/env" ||
              pm2Environment.exec_interpreter !== "none" ||
              pm2Environment.exec_mode !== "fork_mode" ||
              !exactStringArray(pm2Environment.node_args, []) ||
              pm2Environment.autorestart !== true ||
              pm2Environment.max_memory_restart !== 1073741824 ||
              pm2Environment.uid !== expectedUid ||
              pm2Environment.gid !== expectedGid ||
              !exactStringArray(pm2Environment.args, expectedArgs)
            ) {
              throw new Error("invalid identity");
            }
            return app.pid;
          }

          const packageDocument = decodeJson(
            readBounded(
              trustedNextPackagePath(),
              MAX_PACKAGE_BYTES,
            ),
          );
          const nextVersion = packageDocument?.version;
          if (
            typeof nextVersion !== "string" ||
            nextVersion.length > 64 ||
            !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u.test(
              nextVersion,
            )
          ) {
            throw new Error("invalid identity");
          }
          const expectedTitle = Buffer.from(`next-server (v${nextVersion})\0`);

          function validateLiveProcess(pid) {
            const processRoot = resolve(procRoot, String(pid));
            if (
              realpathSync(expectedCwd) !== expectedRelease ||
              realpathSync(resolve(processRoot, "cwd")) !== expectedRelease ||
              realpathSync(resolve(processRoot, "exe")) !== expectedNode
            ) {
              throw new Error("invalid identity");
            }
            const cmdline = readBounded(
              resolve(processRoot, "cmdline"),
              MAX_CMDLINE_BYTES,
            );
            if (
              cmdline.length < expectedTitle.length ||
              !cmdline.subarray(0, expectedTitle.length).equals(expectedTitle) ||
              !cmdline.subarray(expectedTitle.length).every((byte) => byte === 0)
            ) {
              throw new Error("invalid identity");
            }
          }

          try {
            const firstSnapshot = decodeJson(
              readBoundedDescriptor(0, MAX_JLIST_BYTES),
            );
            const pid = validateSnapshot(firstSnapshot);
            validateLiveProcess(pid);

            const secondResult = pm2RunnerMode === "path-fixture"
              ? spawnSync(
                  "/usr/bin/env",
                  [
                    "-i",
                    "HOME=/root",
                    `PATH=${hostCommandPath}`,
                    "pm2",
                    "jlist",
                  ],
                  {
                    maxBuffer: MAX_JLIST_BYTES,
                    stdio: ["ignore", "pipe", "ignore"],
                  },
                )
              : spawnSync(
                  expectedNode,
                  [expectedPm2Exec, "jlist"],
                  {
                    env: { HOME: "/root", PATH: hostCommandPath },
                    maxBuffer: MAX_JLIST_BYTES,
                    stdio: ["ignore", "pipe", "ignore"],
                  },
                );
            if (
              secondResult.error !== undefined ||
              secondResult.status !== 0 ||
              !Buffer.isBuffer(secondResult.stdout)
            ) {
              throw new Error("invalid identity");
            }
            validateSnapshot(decodeJson(secondResult.stdout), pid);
            validateLiveProcess(pid);
            process.stdout.write(String(pid));
          } catch {
            process.exitCode = 70;
          }
        ' 8>&- 2>/dev/null
  )" || [[ -z "${pm2_process_pid}" ]]; then
    rollback_fail 70 "rollback process identity validation failed"
    return
  fi
  if ! process_uid="$(ps -o uid= -p "${pm2_process_pid}" | tr -d '[:space:]')" ||
    ! process_gid="$(ps -o gid= -p "${pm2_process_pid}" | tr -d '[:space:]')" ||
    [[ ! "${process_uid}" =~ ^[0-9]+$ ]] ||
    [[ ! "${process_gid}" =~ ^[0-9]+$ ]] ||
    [[ "${process_uid}" != "${expected_runtime_uid}" ]] ||
    [[ "${process_gid}" != "${expected_runtime_gid}" ]]; then
    rollback_fail 70 "rollback process identity validation failed"
    return
  fi
}

rollback_validate_durable_pm2_state() {
  if [[ "$#" -ne 14 ]]; then
    rollback_fail 64 "durable PM2 validation requires fourteen fixed arguments"
    return
  fi

  local expected_app_version="$1"
  local expected_release_dir="$2"
  local expected_configured_cwd="$3"
  local proc_root="$4"
  local fixed_vps_path="$5"
  local node_binary="$6"
  local pm2_state_helper="$7"
  local expected_pm2_state_root="$8"
  local expected_pm2_exec="$9"
  local expected_unit_fragment="${10}"
  local expected_daemon_uid="${11}"
  local expected_daemon_gid="${12}"
  local approved_additional_unit_paths="${13}"
  local host_command_path="${14}"
  local runtime_uid
  local runtime_gid

  if ! runtime_uid="$(id -u diesel)" ||
    ! runtime_gid="$(id -g diesel)" ||
    [[ ! "${runtime_uid}" =~ ^(0|[1-9][0-9]{0,9})$ ]] ||
    [[ ! "${runtime_gid}" =~ ^(0|[1-9][0-9]{0,9})$ ]] ||
    [[ "${runtime_uid}" -gt 4294967294 ]] ||
    [[ "${runtime_gid}" -gt 4294967294 ]]; then
    rollback_fail 70 "rollback process identity validation failed"
    return
  fi

  rollback_validate_pm2_process \
    "${expected_app_version}" "${expected_release_dir}" \
    "${expected_configured_cwd}" "${proc_root}" \
    "${fixed_vps_path}" "${node_binary}" \
    "${runtime_uid}" "${runtime_gid}" \
    "${expected_pm2_exec}" "${host_command_path}"
  if [[ "$(realpath -- "${expected_configured_cwd}" 2>/dev/null)" != \
    "${expected_release_dir}" ]]; then
    rollback_fail 70 "PM2 durable release state validation failed."
    return
  fi
  if ! env -i HOME=/root PATH="${host_command_path}" \
    "${node_binary}" "${pm2_state_helper}" "${expected_app_version}" \
    "${runtime_uid}" "${runtime_gid}" \
    8>&- >/dev/null 2>&1; then
    rollback_fail 70 "PM2 durable release state validation failed."
    return
  fi
  if [[ "$(realpath -- "${expected_configured_cwd}" 2>/dev/null)" != \
    "${expected_release_dir}" ]]; then
    rollback_fail 70 "PM2 durable release state validation failed."
    return
  fi
  if ! rollback_validate_pm2_systemd_identity \
    "${expected_pm2_state_root}" "${expected_pm2_exec}" \
    "${proc_root}" "${node_binary}" "${fixed_vps_path}" \
    "${expected_unit_fragment}" \
    "${expected_daemon_uid}" "${expected_daemon_gid}" \
    "${approved_additional_unit_paths}" "${host_command_path}" \
    >/dev/null 2>&1; then
    rollback_fail 70 "PM2 systemd identity validation failed."
    return
  fi
}

rollback_validate_nginx_backups() (
  set -Eeuo pipefail

  local nginx_primary_backup="$1"
  local nginx_alternate_backup="$2"
  local validation_status=0

  # EXIT runs after Bash unwinds function-local variables, so this cleanup path
  # deliberately uses subshell-scoped state rather than a local variable.
  nginx_backup_validation_config="$(
    mktemp /tmp/diesel-nginx-rollback-check.XXXXXX
  )"
  cleanup_validation_config() {
    rm -f -- "${nginx_backup_validation_config}"
  }
  trap cleanup_validation_config EXIT

  # Validate the persisted site pair without replacing the live files. Absolute
  # includes retain the same Nginx prefix and referenced certificate paths as a
  # real rollback while the temporary top-level config keeps --check read-only.
  printf '%s\n' \
    'worker_processes 1;' \
    'error_log stderr notice;' \
    'events {}' \
    'http {' \
    '  access_log off;' \
    '  include /etc/nginx/mime.types;' \
    "  include \"${nginx_primary_backup}\";" \
    "  include \"${nginx_alternate_backup}\";" \
    '}' >"${nginx_backup_validation_config}"
  chmod 600 "${nginx_backup_validation_config}"

  if ! nginx -t -c "${nginx_backup_validation_config}"; then
    validation_status=70
  fi
  exit "${validation_status}"
)

rollback_host_release() (
  set -Eeuo pipefail

  if [[ "$#" -ne 10 && "$#" -ne 13 ]]; then
    rollback_fail 64 \
      "internal rollback state machine requires ten fixed arguments"
    return
  fi
  if [[ "$#" -eq 10 && "${BASH_SOURCE[0]}" != "$0" ]]; then
    rollback_fail 64 \
      "production rollback state machine is unavailable when sourced"
    return
  fi
  if [[ "$#" -eq 13 && "${BASH_SOURCE[0]}" == "$0" ]]; then
    rollback_fail 64 "rollback test seams are unavailable from the CLI"
    return
  fi
  if [[ "$#" -eq 13 ]] &&
    rollback_sourced_production_root_is_selected "$3"; then
    rollback_fail 64 \
      "rollback test seam cannot target the production deployment root"
    return
  fi

  local release_id="$1"
  local mode="$2"
  local deploy_root="$3"
  local nginx_sites_root="$4"
  local fixed_vps_path="$5"
  local node_binary="$6"
  local root_command_path="${fixed_vps_path}"
  local proc_root="$7"
  local expected_pm2_state_root="$8"
  local expected_pm2_exec="$9"
  local expected_unit_fragment="${10}"
  local expected_daemon_uid=0
  local expected_daemon_gid=0
  local approved_additional_unit_paths=""
  local systemctl_command=systemctl
  local -a pm2_command=(pm2)
  if [[ "$#" -eq 13 ]]; then
    expected_daemon_uid="${11}"
    expected_daemon_gid="${12}"
    approved_additional_unit_paths="${13}"
  else
    root_command_path="/usr/sbin:/usr/bin:/sbin:/bin"
    systemctl_command=/usr/bin/systemctl
    pm2_command=("${node_binary}" "${expected_pm2_exec}")
  fi
  local releases_root="${deploy_root}/releases"
  local backups_root="${deploy_root}/backups"
  local release_dir="${releases_root}/${release_id}"
  local state_dir="${backups_root}/${release_id}"
  local previous_release_file="${state_dir}/previous-release"
  local environment_backup="${state_dir}/env.production.local.pre-switch"
  local nginx_primary_backup="${state_dir}/jamesky.site.pre-switch"
  local nginx_alternate_backup="${state_dir}/diesel-demo.pre-switch"
  local publish_commit_marker="${state_dir}/PUBLISH_COMMITTED"
  local publish_finalized_marker="${state_dir}/PUBLISH_FINALIZED"
  local recovery_marker="${state_dir}/RECOVERY_REQUIRED"
  local host_rollback_marker="${state_dir}/HOST_ROLLBACK_REQUIRED"
  local host_rollback_completed_marker="${state_dir}/HOST_ROLLBACK_COMPLETED"
  local governance_snapshot="${state_dir}/governance-before.json"
  local shared_root="${deploy_root}/shared"
  local environment_path="${shared_root}/.env.production.local"
  local nginx_primary_path="${nginx_sites_root}/jamesky.site"
  local nginx_alternate_path="${nginx_sites_root}/diesel-demo"
  local current_link="${deploy_root}/current"
  local current_next="${deploy_root}/current.next"
  local pm2_state_helper="${release_dir}/scripts/deploy/persist-pm2-release-state.mjs"
  local host_activation_ledger_script="${release_dir}/scripts/deploy/host-activation-ledger.sh"
  local previous_release
  local previous_release_name
  local current_release
  local previous_ecosystem
  local previous_verifier
  local command_name
  local committed_marker
  local committed_marker_label
  local host_rollback_marker_active=0
  local environment_restore_required=1
  local nginx_restore_required=0
  local pm2_inspection
  local pm2_named_process_count=0
  local candidate_nginx_status=0
  local nginx_candidate_install_status=0
  local nginx_restore_status=0
  local current_next_present=0
  # These variables deliberately outlive the function-local scope inside
  # this subshell. Bash runs an EXIT trap after unwinding local variables, so
  # cleanup state must remain visible in order to preserve the original
  # failure status and remove any staged file.
  environment_restore_path=""
  nginx_primary_restore_path=""
  nginx_alternate_restore_path=""
  nginx_primary_pre_attempt_path=""
  nginx_alternate_pre_attempt_path=""
  nginx_primary_pre_attempt_restore_path=""
  nginx_alternate_pre_attempt_restore_path=""
  nginx_primary_recovery_live_path="${nginx_primary_path}"
  nginx_alternate_recovery_live_path="${nginx_alternate_path}"
  nginx_primary_was_present=0
  nginx_alternate_was_present=0
  preserve_nginx_recovery_masters=0
  rollback_link_directory=""

  export PATH="${root_command_path}"

  if ! rollback_is_safe_release_id "${release_id}"; then
    rollback_usage
    return 64
  fi
  case "${mode}" in
    --begin-activation | --check | --apply | --abort-if-uncommitted | --restore-governance-host | --validate-committed) ;;
    *)
      rollback_fail 64 \
        "mode must be --begin-activation, --check, --apply, --abort-if-uncommitted, --restore-governance-host, or --validate-committed"
      return
      ;;
  esac
  if [[ "$#" -eq 10 ]]; then
    rollback_require_production_command_boundary \
      "${fixed_vps_path}" "${node_binary}" "${expected_pm2_exec}" || return $?
  fi

  for command_name in find readlink realpath sha256sum sort stat; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      rollback_fail 70 "required rollback command is unavailable: ${command_name}"
      return
    fi
  done

  rollback_require_directory "${deploy_root}" "root:root:755" "deployment root"
  rollback_require_directory "${releases_root}" "root:root:755" "release root"
  rollback_require_directory "${backups_root}" "root:root:700" "rollback state root"
  rollback_acquire_release_lifecycle_lock "${deploy_root}"
  rollback_require_directory "${state_dir}" "root:root:700" "rollback state directory"
  rollback_require_trusted_release_path \
    "${release_dir}" directory no "failed release directory"
  rollback_require_trusted_release_path \
    "${release_dir}/scripts" directory no "failed release scripts directory"
  rollback_require_trusted_release_path \
    "${release_dir}/scripts/deploy" directory no \
    "failed release deployment scripts directory"
  rollback_require_trusted_release_path \
    "${pm2_state_helper}" file no \
    "versioned PM2 persistence helper"
  rollback_require_trusted_release_path \
    "${host_activation_ledger_script}" file yes \
    "versioned host activation ledger"

  if [[ "${mode}" == "--begin-activation" ]]; then
    if [[ -e "${state_dir}/HOST_ACTIVATION_V1" ||
      -L "${state_dir}/HOST_ACTIVATION_V1" ]]; then
      host_activation_ledger_require_resumable_anchor \
        "${release_id}" "${deploy_root}"
    else
      host_activation_ledger_require_unarmed_candidate \
        "${release_id}" "${deploy_root}"
    fi
    HOST_ACTIVATION_LEDGER_PROTOCOL="v1-unarmed"
    HOST_ACTIVATION_LEDGER_CLASSIFICATION="idle"
    HOST_ACTIVATION_LEDGER_STATE="none"
    HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE="none"
  else
    host_activation_ledger_validate_release_state \
      "${release_id}" "${deploy_root}"
  fi
  if [[ "${HOST_ACTIVATION_LEDGER_PROTOCOL}" == "v1" &&
    "${HOST_ACTIVATION_LEDGER_CLASSIFICATION}" == "terminal" ]]; then
    case "${HOST_ACTIVATION_LEDGER_STATE}:${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}:${mode}" in
      ROLLED_BACK:none:--check | ROLLED_BACK:none:--apply | \
        ROLLED_BACK:none:--abort-if-uncommitted | \
        ROLLED_BACK:HOST_ROLLBACK_COMPLETED:--check | \
        ROLLED_BACK:HOST_ROLLBACK_COMPLETED:--abort-if-uncommitted | \
        ROLLED_BACK:HOST_ROLLBACK_COMPLETED:--restore-governance-host)
        host_activation_ledger_revalidate_terminal \
          "${release_id}" "${deploy_root}" "${node_binary}"
        printf 'Host activation ledger is terminal: %s (%s)\n' \
          "${release_dir}" "${HOST_ACTIVATION_LEDGER_STATE}"
        return 0
        ;;
      COMMITTED:PUBLISH_FINALIZED:--abort-if-uncommitted | \
        COMMITTED:PUBLISH_FINALIZED:--validate-committed)
        # The terminal pair is durable history, but these two modes are also
        # used as current-release acceptance gates. Re-parse the ledger, then
        # continue through current/PM2/UID/durable-dump validation below.
        host_activation_ledger_revalidate_terminal \
          "${release_id}" "${deploy_root}" "${node_binary}"
        ;;
      *)
        rollback_fail 70 \
          "requested rollback mode conflicts with terminal host activation state"
        return
        ;;
    esac
  fi
  if [[ ! -L "${current_link}" ]]; then
    rollback_fail 70 "current must be a release symlink"
    return
  fi
  if ! current_release="$(realpath -- "${current_link}")"; then
    rollback_fail 70 "current release symlink cannot be resolved"
    return
  fi

  if [[ ( -e "${publish_commit_marker}" || -L "${publish_commit_marker}" ) &&
    ( -e "${publish_finalized_marker}" || -L "${publish_finalized_marker}" ) ]]; then
    rollback_fail 70 "publish commit and finalized markers must not coexist"
    return
  elif [[ -e "${publish_commit_marker}" || -L "${publish_commit_marker}" ]]; then
    committed_marker="${publish_commit_marker}"
    committed_marker_label="publish commit marker"
  elif [[ -e "${publish_finalized_marker}" || -L "${publish_finalized_marker}" ]]; then
    committed_marker="${publish_finalized_marker}"
    committed_marker_label="publish finalized marker"
  fi

  if [[ -n "${committed_marker:-}" ]]; then
    if ! command -v sha256sum >/dev/null 2>&1; then
      rollback_fail 70 "required rollback command is unavailable: sha256sum"
      return
    fi
    rollback_validate_publish_commit_marker \
      "${committed_marker}" "${governance_snapshot}" \
      "${committed_marker_label}"
    rollback_require_absent "${recovery_marker}" "governance recovery marker"
    rollback_require_absent \
      "${host_rollback_marker}" "governance host rollback marker"
    rollback_require_absent \
      "${host_rollback_completed_marker}" \
      "governance completed host rollback marker"
    if [[ "${current_release}" != "${release_dir}" ]]; then
      rollback_fail 70 "committed host does not point to the committed release"
      return
    fi
    case "${mode}" in
      --abort-if-uncommitted)
        for command_name in id ps realpath stat systemctl systemd-analyze tr; do
          if ! command -v "${command_name}" >/dev/null 2>&1; then
            rollback_fail 70 \
              "required rollback command is unavailable: ${command_name}"
            return
          fi
        done
        if [[ "$(id -u)" -ne 0 ]]; then
          rollback_fail 77 "${mode} must run as root"
          return
        fi
        if [[ ! -f "${node_binary}" || -L "${node_binary}" ||
          ! -x "${node_binary}" ]]; then
          rollback_fail 70 \
            "rollback Node.js binary is missing, symlinked, or not executable"
          return
        fi
        rollback_validate_durable_pm2_state \
          "${release_id}" "${release_dir}" "${current_link}" \
          "${proc_root}" "${fixed_vps_path}" "${node_binary}" \
          "${pm2_state_helper}" "${expected_pm2_state_root}" \
          "${expected_pm2_exec}" "${expected_unit_fragment}" \
          "${expected_daemon_uid}" "${expected_daemon_gid}" \
          "${approved_additional_unit_paths}" "${root_command_path}"
        printf 'Publish commit point is valid; preserving committed release: %s\n' "${release_dir}"
        return 0
        ;;
      --validate-committed)
        for command_name in id ps realpath stat systemctl systemd-analyze tr; do
          if ! command -v "${command_name}" >/dev/null 2>&1; then
            rollback_fail 70 \
              "required rollback command is unavailable: ${command_name}"
            return
          fi
        done
        if [[ "$(id -u)" -ne 0 ]]; then
          rollback_fail 77 "${mode} must run as root"
          return
        fi
        if [[ ! -f "${node_binary}" || -L "${node_binary}" ||
          ! -x "${node_binary}" ]]; then
          rollback_fail 70 \
            "rollback Node.js binary is missing, symlinked, or not executable"
          return
        fi
        rollback_validate_durable_pm2_state \
          "${release_id}" "${release_dir}" "${current_link}" \
          "${proc_root}" "${fixed_vps_path}" "${node_binary}" \
          "${pm2_state_helper}" "${expected_pm2_state_root}" \
          "${expected_pm2_exec}" "${expected_unit_fragment}" \
          "${expected_daemon_uid}" "${expected_daemon_gid}" \
          "${approved_additional_unit_paths}" "${root_command_path}"
        printf 'Publish commit point is valid for release: %s\n' "${release_dir}"
        return 0
        ;;
    esac
    rollback_fail 70 "refusing host-only rollback after the governance publish commit point"
    return
  fi

  if [[ "${mode}" == "--validate-committed" ]]; then
    rollback_fail 70 \
      "publish commit marker is missing and no finalized tombstone exists"
    return
  fi

  if [[ ( -e "${recovery_marker}" || -L "${recovery_marker}" ) &&
    (( -e "${host_rollback_marker}" || -L "${host_rollback_marker}" ) ||
      ( -e "${host_rollback_completed_marker}" ||
        -L "${host_rollback_completed_marker}" )) ]]; then
    rollback_fail 70 "governance recovery markers must not coexist"
    return
  fi
  if [[ ( -e "${host_rollback_marker}" || -L "${host_rollback_marker}" ) &&
    ( -e "${host_rollback_completed_marker}" ||
      -L "${host_rollback_completed_marker}" ) ]]; then
    rollback_fail 70 "host rollback markers must not coexist"
    return
  fi
  rollback_require_absent "${recovery_marker}" "governance recovery marker"
  if [[ -e "${host_rollback_marker}" || -L "${host_rollback_marker}" ]]; then
    if [[ "${mode}" != "--restore-governance-host" ]]; then
      rollback_fail 70 \
        "HOST_ROLLBACK_REQUIRED requires maintenance-locked governance recovery"
      return
    fi
    if ! command -v sha256sum >/dev/null 2>&1; then
      rollback_fail 70 "required rollback command is unavailable: sha256sum"
      return
    fi
    rollback_validate_publish_commit_marker \
      "${host_rollback_marker}" "${governance_snapshot}" \
      "governance host rollback marker"
    host_rollback_marker_active=1
  elif [[ -e "${host_rollback_completed_marker}" ||
    -L "${host_rollback_completed_marker}" ]]; then
    if ! command -v sha256sum >/dev/null 2>&1; then
      rollback_fail 70 "required rollback command is unavailable: sha256sum"
      return
    fi
    rollback_validate_publish_commit_marker \
      "${host_rollback_completed_marker}" "${governance_snapshot}" \
      "governance completed host rollback marker"
    rollback_fail 70 \
      "HOST_ROLLBACK_COMPLETED is a terminal audit ledger"
    return
  fi
  if [[ "${mode}" == "--restore-governance-host" &&
    "${host_rollback_marker_active}" -ne 1 ]]; then
    rollback_fail 70 \
      "governance host recovery requires HOST_ROLLBACK_REQUIRED"
    return
  fi
  rollback_require_regular_file \
    "${previous_release_file}" "root:root:600" "previous-release state"
  rollback_require_regular_file \
    "${environment_backup}" "root:root:600" "environment rollback backup"
  rollback_require_regular_file \
    "${nginx_primary_backup}" "root:root:600" "primary Nginx rollback backup"
  rollback_require_regular_file \
    "${nginx_alternate_backup}" "root:root:600" "alternate Nginx rollback backup"

  previous_release="$(<"${previous_release_file}")"
  previous_release_name="${previous_release##*/}"
  if ! rollback_is_safe_release_id "${previous_release_name}" ||
    [[ "${previous_release}" != "${releases_root}/${previous_release_name}" ]] ||
    [[ "${previous_release}" == "${release_dir}" ]]; then
    rollback_fail 70 "previous release is not a distinct release below ${releases_root}"
    return
  fi
  rollback_require_trusted_release_path \
    "${previous_release}" directory no "previous release directory"
  if [[ "${current_release}" != "${release_dir}" &&
    "${current_release}" != "${previous_release}" ]]; then
    rollback_fail 70 "current points to neither the failed nor previous release"
    return
  fi
  if [[ -e "${current_next}" || -L "${current_next}" ]]; then
    if [[ "${mode}" == "--begin-activation" ]]; then
      rollback_fail 70 \
        "temporary current activation link must be absent before begin"
      return
    fi
    rollback_require_current_next_candidate \
      "${current_next}" "${release_dir}" \
      "temporary current activation link"
    current_next_present=1
  fi
  previous_ecosystem="${previous_release}/deploy/ecosystem.config.cjs"
  previous_verifier="${previous_release}/scripts/deploy/verify-release.sh"
  rollback_require_trusted_release_path \
    "${previous_release}/deploy" directory no "previous release deploy directory"
  rollback_require_trusted_release_path \
    "${previous_release}/scripts" directory no "previous release scripts directory"
  rollback_require_trusted_release_path \
    "${previous_release}/scripts/deploy" directory no \
    "previous release deployment scripts directory"
  rollback_require_trusted_release_path \
    "${previous_release}/.deploy-ready" file no "previous release readiness marker"
  rollback_require_trusted_release_path \
    "${previous_ecosystem}" file no "previous release ecosystem definition"
  rollback_require_trusted_release_path \
    "${previous_verifier}" file yes "previous release verifier"

  rollback_require_directory "${shared_root}" "root:diesel:750" "shared application directory"
  rollback_require_directory "${nginx_sites_root}" "root:root:755" "Nginx sites directory"
  rollback_require_regular_or_absent "${environment_path}" "shared environment file"
  rollback_require_regular_or_absent "${nginx_primary_path}" "primary Nginx configuration"
  rollback_require_regular_or_absent "${nginx_alternate_path}" "alternate Nginx configuration"

  for command_name in bash chown chmod cmp cp env find id install ln mktemp mv nginx ps readlink realpath rm rmdir runuser sha256sum sort stat systemctl systemd-analyze tr; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      rollback_fail 70 "required rollback command is unavailable: ${command_name}"
      return
    fi
  done
  if [[ ! -f "${node_binary}" || -L "${node_binary}" || ! -x "${node_binary}" ]]; then
    rollback_fail 70 "rollback Node.js binary is missing, symlinked, or not executable"
    return
  fi
  if [[ "${mode}" != "--check" && "$(id -u)" -ne 0 ]]; then
    rollback_fail 77 "${mode} must run as root"
    return
  fi
  # Read-only service and process probes complete the preflight. From this
  # point onward every interrupted state can be converged by rerunning the same
  # command.
  if ! rollback_validate_pm2_systemd_identity \
    "${expected_pm2_state_root}" "${expected_pm2_exec}" \
    "${proc_root}" "${node_binary}" "${fixed_vps_path}" \
    "${expected_unit_fragment}" \
    "${expected_daemon_uid}" "${expected_daemon_gid}" \
    "${approved_additional_unit_paths}" "${root_command_path}" \
    >/dev/null 2>&1; then
    rollback_fail 70 "PM2 systemd identity validation failed."
    return
  fi
  pm2_inspection="$(
    rollback_inspect_pm2_process \
      "${previous_release_name}" "${fixed_vps_path}" "${node_binary}" \
      "${expected_pm2_exec}" "${root_command_path}"
  )"
  case "${pm2_inspection}" in
    healthy:*)
      [[ -n "${pm2_inspection#healthy:}" ]] || {
        rollback_fail 70 "PM2 returned an empty process id during preflight"
        return
      }
      pm2_named_process_count=1
      ;;
    repair:*)
      pm2_named_process_count="${pm2_inspection#repair:}"
      if [[ ! "${pm2_named_process_count}" =~ ^[0-9]+$ ]]; then
        rollback_fail 70 "PM2 returned an invalid process count during preflight"
        return
      fi
      if [[ "${pm2_named_process_count}" -gt 0 ]]; then
        if ! env -i HOME=/root PATH="${root_command_path}" \
          "${pm2_command[@]}" describe diesel-demo 8>&- >/dev/null 2>&1; then
          rollback_fail 70 "PM2 process list and describe output disagree"
          return
        fi
      elif env -i HOME=/root PATH="${root_command_path}" \
        "${pm2_command[@]}" describe diesel-demo 8>&- >/dev/null 2>&1; then
        rollback_fail 70 "PM2 process list and describe output disagree"
        return
      fi
      ;;
    *)
      rollback_fail 70 "PM2 returned an invalid preflight result"
      return
      ;;
  esac

  if ! rollback_validate_nginx_backups \
    "${nginx_primary_backup}" "${nginx_alternate_backup}"; then
    rollback_fail 70 "rollback Nginx backup configuration is invalid"
    return
  fi
  if ! runuser -u diesel -- env -i \
    HOME=/var/lib/diesel \
    PATH="${fixed_vps_path}" \
    test -x "${previous_verifier}" 8>&-; then
    rollback_fail 70 "previous release verifier is not executable by diesel"
    return
  fi

  if [[ -f "${environment_path}" ]] &&
    cmp -s -- "${environment_backup}" "${environment_path}" &&
    [[ "$(stat -c '%U:%G:%a' -- "${environment_path}")" == "root:diesel:640" ]]; then
    environment_restore_required=0
  fi
  if [[ ! -f "${nginx_primary_path}" ]] ||
    ! cmp -s -- "${nginx_primary_backup}" "${nginx_primary_path}" ||
    [[ "$(stat -c '%U:%G:%a' -- "${nginx_primary_path}")" != "root:root:644" ]] ||
    [[ ! -f "${nginx_alternate_path}" ]] ||
    ! cmp -s -- "${nginx_alternate_backup}" "${nginx_alternate_path}" ||
    [[ "$(stat -c '%U:%G:%a' -- "${nginx_alternate_path}")" != "root:root:644" ]]; then
    nginx_restore_required=1
  fi

  if [[ "${mode}" == "--begin-activation" ]]; then
    if [[ "${current_release}" != "${previous_release}" ]]; then
      rollback_fail 70 \
        "host activation must begin from the persisted previous release"
      return
    fi
    if ! runuser -u diesel -- env -i \
      HOME=/var/lib/diesel \
      PATH="${fixed_vps_path}" \
      bash -- "${previous_verifier}" \
      http://127.0.0.1:8788 "${previous_release_name}" 8>&-; then
      rollback_fail 70 \
        "previous release public verification failed before activation"
      return
    fi
    host_activation_ledger_begin \
      "${release_id}" "${deploy_root}" "${node_binary}" \
      "${nginx_sites_root}"
    printf 'Host activation ledger entered PENDING: %s\n' "${release_dir}"
    return 0
  fi

  if [[ "${mode}" == "--check" ]]; then
    printf 'Host rollback preflight passed: %s -> %s\n' "${release_dir}" "${previous_release}"
    return 0
  fi

  if ! current_release="$(realpath -- "${current_link}")"; then
    rollback_fail 70 "current release symlink cannot be resolved after preflight"
    return
  fi
  if [[ "${current_release}" != "${release_dir}" &&
    "${current_release}" != "${previous_release}" ]]; then
    rollback_fail 70 "current changed to an unexpected release during preflight"
    return
  fi
  rollback_require_absent "${publish_commit_marker}" "publish commit marker"
  rollback_require_absent \
    "${publish_finalized_marker}" "publish finalized marker"
  rollback_require_absent "${recovery_marker}" "governance recovery marker"
  if [[ "${host_rollback_marker_active}" -eq 1 ]]; then
    rollback_require_absent \
      "${host_rollback_completed_marker}" \
      "governance completed host rollback marker"
    rollback_validate_publish_commit_marker \
      "${host_rollback_marker}" "${governance_snapshot}" \
      "governance host rollback marker"
  else
    rollback_require_absent \
      "${host_rollback_marker}" "governance host rollback marker"
    rollback_require_absent \
      "${host_rollback_completed_marker}" \
      "governance completed host rollback marker"
  fi
  if [[ "${current_next_present}" -eq 1 ]]; then
    host_activation_ledger_require_lifecycle_lock "${deploy_root}"
    rollback_require_current_next_candidate \
      "${current_next}" "${release_dir}" \
      "temporary current activation link"
    rm -f -- "${current_next}" 8>&-
    rollback_require_absent \
      "${current_next}" "temporary current activation link"
    rollback_fsync_paths "${node_binary}" "${deploy_root}" 8>&-
    host_activation_ledger_require_lifecycle_lock "${deploy_root}"
    host_activation_ledger_validate_release_state \
      "${release_id}" "${deploy_root}"
    if [[ "${HOST_ACTIVATION_LEDGER_STATE}" != "PENDING" ]] ||
      { [[ "${host_rollback_marker_active}" -eq 1 ]] &&
        [[ "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != \
          "HOST_ROLLBACK_REQUIRED" ]]; } ||
      { [[ "${host_rollback_marker_active}" -eq 0 ]] &&
        [[ "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != "none" ]]; }; then
      rollback_fail 70 \
        "host activation ledger changed during temporary-link cleanup"
      return
    fi
    if ! current_release="$(realpath -- "${current_link}")" ||
      { [[ "${current_release}" != "${release_dir}" ]] &&
        [[ "${current_release}" != "${previous_release}" ]]; }; then
      rollback_fail 70 \
        "current changed during temporary-link cleanup"
      return
    fi
  fi

  rollback_cleanup_temporary_paths() {
    local cleanup_status=0

    if [[ -n "${environment_restore_path:-}" ]]; then
      rm -f -- "${environment_restore_path}" || cleanup_status=70
    fi
    if [[ -n "${nginx_primary_restore_path:-}" ]]; then
      rm -f -- "${nginx_primary_restore_path}" || cleanup_status=70
    fi
    if [[ -n "${nginx_alternate_restore_path:-}" ]]; then
      rm -f -- "${nginx_alternate_restore_path}" || cleanup_status=70
    fi
    if [[ -n "${nginx_primary_pre_attempt_restore_path:-}" ]]; then
      rm -f -- "${nginx_primary_pre_attempt_restore_path}" || cleanup_status=70
    fi
    if [[ -n "${nginx_alternate_pre_attempt_restore_path:-}" ]]; then
      rm -f -- "${nginx_alternate_pre_attempt_restore_path}" || cleanup_status=70
    fi
    if [[ "${preserve_nginx_recovery_masters:-0}" -eq 1 ]]; then
      if [[ -n "${nginx_primary_pre_attempt_path:-}" ]]; then
        echo "preserving Nginx recovery master: ${nginx_primary_pre_attempt_path}" >&2
      elif [[ "${nginx_primary_was_present:-0}" -eq 0 ]]; then
        echo "preserving Nginx recovery absence target: ${nginx_primary_recovery_live_path}" >&2
      fi
      if [[ -n "${nginx_alternate_pre_attempt_path:-}" ]]; then
        echo "preserving Nginx recovery master: ${nginx_alternate_pre_attempt_path}" >&2
      elif [[ "${nginx_alternate_was_present:-0}" -eq 0 ]]; then
        echo "preserving Nginx recovery absence target: ${nginx_alternate_recovery_live_path}" >&2
      fi
    else
      if [[ -n "${nginx_primary_pre_attempt_path:-}" ]]; then
        rm -f -- "${nginx_primary_pre_attempt_path}" || cleanup_status=70
      fi
      if [[ -n "${nginx_alternate_pre_attempt_path:-}" ]]; then
        rm -f -- "${nginx_alternate_pre_attempt_path}" || cleanup_status=70
      fi
    fi
    if [[ -n "${rollback_link_directory:-}" ]]; then
      rm -f -- "${rollback_link_directory}/current" || cleanup_status=70
      rmdir -- "${rollback_link_directory}" 2>/dev/null || cleanup_status=70
    fi
    return "${cleanup_status}"
  }

  rollback_cleanup_on_exit() {
    local original_status="$?"
    local cleanup_status

    set +e
    rollback_cleanup_temporary_paths
    cleanup_status="$?"
    if [[ "${cleanup_status}" -ne 0 ]]; then
      echo "rollback temporary-file cleanup failed" >&2
    fi
    exit "${original_status}"
  }
  trap rollback_cleanup_on_exit EXIT

  rollback_delete_nginx_recovery_masters() {
    local delete_status=0

    if [[ -n "${nginx_primary_pre_attempt_path}" ]]; then
      if rm -f -- "${nginx_primary_pre_attempt_path}"; then
        nginx_primary_pre_attempt_path=""
      else
        delete_status=70
      fi
    fi
    if [[ -n "${nginx_alternate_pre_attempt_path}" ]]; then
      if rm -f -- "${nginx_alternate_pre_attempt_path}"; then
        nginx_alternate_pre_attempt_path=""
      else
        delete_status=70
      fi
    fi
    if [[ "${delete_status}" -eq 0 ]]; then
      preserve_nginx_recovery_masters=0
    fi
    return "${delete_status}"
  }

  rollback_restore_pre_attempt_nginx() {
    local restore_status=0

    if [[ "${nginx_primary_was_present}" -eq 1 ]]; then
      if [[ -z "${nginx_primary_pre_attempt_path}" ]]; then
        restore_status=70
      elif nginx_primary_pre_attempt_restore_path="$(
        mktemp "${nginx_sites_root}/.jamesky.site.pre-attempt-restore.XXXXXX"
      )" &&
        cp -p -- \
          "${nginx_primary_pre_attempt_path}" \
          "${nginx_primary_pre_attempt_restore_path}" &&
        cmp -s -- \
          "${nginx_primary_pre_attempt_path}" \
          "${nginx_primary_pre_attempt_restore_path}" &&
        [[ "$(stat -c '%U:%G:%a' -- "${nginx_primary_pre_attempt_path}")" == \
          "$(stat -c '%U:%G:%a' -- "${nginx_primary_pre_attempt_restore_path}")" ]] &&
        mv -Tf -- \
          "${nginx_primary_pre_attempt_restore_path}" "${nginx_primary_path}"; then
        nginx_primary_pre_attempt_restore_path=""
      else
        restore_status=70
      fi
    elif ! rm -f -- "${nginx_primary_path}"; then
      restore_status=70
    fi

    if [[ "${nginx_alternate_was_present}" -eq 1 ]]; then
      if [[ -z "${nginx_alternate_pre_attempt_path}" ]]; then
        restore_status=70
      elif nginx_alternate_pre_attempt_restore_path="$(
        mktemp "${nginx_sites_root}/.diesel-demo.pre-attempt-restore.XXXXXX"
      )" &&
        cp -p -- \
          "${nginx_alternate_pre_attempt_path}" \
          "${nginx_alternate_pre_attempt_restore_path}" &&
        cmp -s -- \
          "${nginx_alternate_pre_attempt_path}" \
          "${nginx_alternate_pre_attempt_restore_path}" &&
        [[ "$(stat -c '%U:%G:%a' -- "${nginx_alternate_pre_attempt_path}")" == \
          "$(stat -c '%U:%G:%a' -- "${nginx_alternate_pre_attempt_restore_path}")" ]] &&
        mv -Tf -- \
          "${nginx_alternate_pre_attempt_restore_path}" "${nginx_alternate_path}"; then
        nginx_alternate_pre_attempt_restore_path=""
      else
        restore_status=70
      fi
    elif ! rm -f -- "${nginx_alternate_path}"; then
      restore_status=70
    fi

    if ! nginx -t; then
      restore_status=70
    fi
    if [[ "${restore_status}" -eq 0 ]]; then
      if ! rollback_delete_nginx_recovery_masters; then
        restore_status=70
      fi
    fi
    return "${restore_status}"
  }

  # Validate the rollback Nginx pair before changing the shared environment,
  # release symlink, or PM2. If the candidate pair is invalid, restore the
  # exact pre-attempt files (including metadata) or their absence, validate the
  # restored state, and fail without touching the application host state.
  if [[ "${nginx_restore_required}" -eq 1 ]]; then
    if [[ -f "${nginx_primary_path}" ]]; then
      nginx_primary_was_present=1
      nginx_primary_pre_attempt_path="$(
        mktemp "${nginx_sites_root}/.jamesky.site.pre-attempt.XXXXXX"
      )"
      cp -p -- "${nginx_primary_path}" "${nginx_primary_pre_attempt_path}"
      cmp -s -- "${nginx_primary_path}" "${nginx_primary_pre_attempt_path}"
      [[ "$(stat -c '%U:%G:%a' -- "${nginx_primary_pre_attempt_path}")" == \
        "$(stat -c '%U:%G:%a' -- "${nginx_primary_path}")" ]]
    fi
    if [[ -f "${nginx_alternate_path}" ]]; then
      nginx_alternate_was_present=1
      nginx_alternate_pre_attempt_path="$(
        mktemp "${nginx_sites_root}/.diesel-demo.pre-attempt.XXXXXX"
      )"
      cp -p -- "${nginx_alternate_path}" "${nginx_alternate_pre_attempt_path}"
      cmp -s -- "${nginx_alternate_path}" "${nginx_alternate_pre_attempt_path}"
      [[ "$(stat -c '%U:%G:%a' -- "${nginx_alternate_pre_attempt_path}")" == \
        "$(stat -c '%U:%G:%a' -- "${nginx_alternate_path}")" ]]
    fi

    nginx_primary_restore_path="$(mktemp "${nginx_sites_root}/.jamesky.site.rollback.XXXXXX")"
    nginx_alternate_restore_path="$(mktemp "${nginx_sites_root}/.diesel-demo.rollback.XXXXXX")"
    install -m 0644 -o root -g root \
      "${nginx_primary_backup}" "${nginx_primary_restore_path}"
    install -m 0644 -o root -g root \
      "${nginx_alternate_backup}" "${nginx_alternate_restore_path}"
    preserve_nginx_recovery_masters=1
    if mv -Tf -- "${nginx_primary_restore_path}" "${nginx_primary_path}"; then
      nginx_primary_restore_path=""
    else
      nginx_candidate_install_status=70
    fi
    if [[ "${nginx_candidate_install_status}" -eq 0 ]]; then
      if mv -Tf -- "${nginx_alternate_restore_path}" "${nginx_alternate_path}"; then
        nginx_alternate_restore_path=""
      else
        nginx_candidate_install_status=70
      fi
    fi
    if [[ "${nginx_candidate_install_status}" -ne 0 ]]; then
      set +e
      rollback_restore_pre_attempt_nginx
      nginx_restore_status="$?"
      set -e
      if [[ "${nginx_restore_status}" -ne 0 ]]; then
        rollback_fail 70 \
          "rollback Nginx candidate installation and pre-attempt restoration both failed"
        return
      fi
      rollback_fail 70 "rollback Nginx candidate installation failed"
      return
    fi
  fi
  if [[ "$(stat -c '%U:%G:%a' -- "${nginx_primary_path}")" == "root:root:644" ]] &&
    [[ "$(stat -c '%U:%G:%a' -- "${nginx_alternate_path}")" == "root:root:644" ]] &&
    cmp -s -- "${nginx_primary_backup}" "${nginx_primary_path}" &&
    cmp -s -- "${nginx_alternate_backup}" "${nginx_alternate_path}" &&
    nginx -t; then
    candidate_nginx_status=0
  else
    candidate_nginx_status="$?"
    if [[ "${nginx_restore_required}" -eq 1 ]]; then
      set +e
      rollback_restore_pre_attempt_nginx
      nginx_restore_status="$?"
      set -e
      if [[ "${nginx_restore_status}" -ne 0 ]]; then
        rollback_fail 70 \
          "rollback Nginx candidate was invalid and the pre-attempt state could not be revalidated"
        return
      fi
    fi
    if [[ "${candidate_nginx_status}" -eq 0 ]]; then
      candidate_nginx_status=70
    fi
    rollback_fail "${candidate_nginx_status}" \
      "rollback Nginx candidate configuration is invalid"
    return
  fi
  if ! rollback_delete_nginx_recovery_masters; then
    preserve_nginx_recovery_masters=1
    rollback_fail 70 "validated Nginx candidate recovery masters could not be removed"
    return
  fi
  # Repeat the durability proof even after an interrupted earlier attempt that
  # already installed the desired files. Idempotent recovery must close the
  # rename/fsync window rather than merely observe matching bytes.
  rollback_fsync_paths \
    "${node_binary}" \
    "${nginx_primary_path}" \
    "${nginx_alternate_path}" \
    "${nginx_sites_root}"

  if [[ "${environment_restore_required}" -eq 1 ]]; then
    environment_restore_path="$(mktemp "${shared_root}/.env.production.local.rollback.XXXXXX")"
    install -m 0640 -o root -g diesel \
      "${environment_backup}" "${environment_restore_path}"
    [[ "$(stat -c '%U:%G:%a' -- "${environment_restore_path}")" == "root:diesel:640" ]]
    mv -f -- "${environment_restore_path}" "${environment_path}"
    environment_restore_path=""
  fi
  [[ "$(stat -c '%U:%G:%a' -- "${environment_path}")" == "root:diesel:640" ]]
  cmp -s -- "${environment_backup}" "${environment_path}"
  rollback_fsync_paths "${node_binary}" "${environment_path}" "${shared_root}"

  if [[ "${current_release}" == "${release_dir}" ]]; then
    rollback_link_directory="$(mktemp -d "${deploy_root}/.current-rollback-${release_id}.XXXXXX")"
    ln -s -- "${previous_release}" "${rollback_link_directory}/current"
    mv -Tf -- "${rollback_link_directory}/current" "${current_link}"
    rmdir -- "${rollback_link_directory}"
    rollback_link_directory=""
  fi
  if [[ "$(realpath -- "${current_link}")" != "${previous_release}" ]]; then
    rollback_fail 70 "current did not converge to the previous release"
    return
  fi
  rollback_fsync_paths "${node_binary}" "${deploy_root}"

  # Always rebuild from the trusted previous ecosystem. Name/status/version
  # alone do not prove that cwd, executable and arguments are the definition
  # that should survive a reboot.
  if [[ "${pm2_named_process_count}" -gt 0 ]]; then
    env -i HOME=/root PATH="${root_command_path}" \
      "${pm2_command[@]}" delete diesel-demo 8>&-
  fi
  env -i \
    HOME=/root \
    PATH="${root_command_path}" \
    APP_VERSION="${previous_release_name}" \
    NODE_ENV=production \
    "${pm2_command[@]}" start "${previous_ecosystem}" 8>&-
  env -i HOME=/root PATH="${root_command_path}" \
    "${pm2_command[@]}" save 8>&-
  rollback_validate_durable_pm2_state \
    "${previous_release_name}" "${previous_release}" "${current_link}" \
    "${proc_root}" "${fixed_vps_path}" "${node_binary}" \
    "${pm2_state_helper}" "${expected_pm2_state_root}" \
    "${expected_pm2_exec}" "${expected_unit_fragment}" \
    "${expected_daemon_uid}" "${expected_daemon_gid}" \
    "${approved_additional_unit_paths}" "${root_command_path}"

  # Reload even when the files already match. A prior attempt may have been
  # interrupted after the atomic file replacement but before this reload.
  "${systemctl_command}" reload nginx

  runuser -u diesel -- env -i \
    HOME=/var/lib/diesel \
    PATH="${fixed_vps_path}" \
    "${previous_verifier}" \
    http://127.0.0.1:8788 "${previous_release_name}" 8>&-

  if [[ "$(realpath -- "${current_link}")" != "${previous_release}" ]]; then
    rollback_fail 70 "current changed after the previous release verification"
    return
  fi
  rollback_require_absent "${publish_commit_marker}" "publish commit marker"
  rollback_require_absent \
    "${publish_finalized_marker}" "publish finalized marker"
  rollback_require_absent "${recovery_marker}" "governance recovery marker"
  if [[ "${host_rollback_marker_active}" -eq 1 ]]; then
    rollback_require_absent \
      "${host_rollback_completed_marker}" \
      "governance completed host rollback marker"
    rollback_validate_publish_commit_marker \
      "${host_rollback_marker}" "${governance_snapshot}" \
      "governance host rollback marker"
    if [[ "$(realpath -- "${current_link}")" != "${previous_release}" ]]; then
      rollback_fail 70 \
        "current changed before the host rollback marker could be cleared"
      return
    fi
    # Only the database-maintenance state machine may promote this ledger to
    # HOST_ROLLBACK_COMPLETED after a fresh post-host snapshot comparison.
    # This host script proves and persists the restored host while preserving
    # HOST_ROLLBACK_REQUIRED as the single unresolved recovery fact.
    rollback_fsync_paths \
      "${node_binary}" \
      "${host_rollback_marker}" \
      "${state_dir}" \
      "${backups_root}"
    rollback_validate_publish_commit_marker \
      "${host_rollback_marker}" "${governance_snapshot}" \
      "governance host rollback marker"
    rollback_require_absent \
      "${host_rollback_completed_marker}" \
      "governance completed host rollback marker"
  else
    rollback_require_absent \
      "${host_rollback_marker}" "governance host rollback marker"
    rollback_require_absent \
      "${host_rollback_completed_marker}" \
      "governance completed host rollback marker"
  fi
  if [[ "${HOST_ACTIVATION_LEDGER_PROTOCOL}" == "v1" &&
    "${host_rollback_marker_active}" -eq 0 ]]; then
    host_activation_ledger_validate_release_state \
      "${release_id}" "${deploy_root}"
    if [[ "${HOST_ACTIVATION_LEDGER_STATE}" != "PENDING" ||
      "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != "none" ]]; then
      rollback_fail 70 \
        "direct host rollback requires PENDING activation without governance state"
      return
    fi
    host_activation_ledger_transition \
      "${release_id}" "${deploy_root}" "${node_binary}" ROLLED_BACK
  fi
  trap - EXIT
  rollback_cleanup_temporary_paths
  printf 'Host rollback completed: %s -> %s\n' "${release_dir}" "${previous_release}"
)

rollback_host_release_main() (
  set -Eeuo pipefail

  if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
    rollback_fail 64 "production rollback main is unavailable when sourced"
    return
  fi
  if [[ "$#" -lt 1 || "$#" -gt 2 ]]; then
    rollback_usage
    return 64
  fi

  rollback_host_release \
    "$1" "${2:---check}" \
    "/opt/diesel" \
    "/etc/nginx/sites-available" \
    "/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    "/opt/node-v22.22.3-linux-x64/bin/node" \
    "/proc" \
    "/root/.pm2" \
    "/opt/node-v22.22.3-linux-x64/lib/node_modules/pm2/bin/pm2" \
    "/etc/systemd/system/pm2-root.service"
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  rollback_host_release_main "$@"
fi
