#!/bin/bash

# This file is intentionally sourceable. Production callers use the CLI entry
# point at the bottom, which fixes the deployment root to /opt/diesel. Tests may
# source the file and exercise governance_publication_state_machine against an
# isolated, root-owned filesystem fixture.

governance_cli_bootstrap_metadata_is_allowed() {
  local object_type="$1"
  local metadata="$2"

  case "${object_type}:${metadata}" in
    directory:root:root:755 | directory:root:diesel:750 | \
      executable:root:diesel:750:1) return 0 ;;
    *) return 1 ;;
  esac
}

governance_cli_require_bootstrap_path() {
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
  governance_cli_bootstrap_metadata_is_allowed "${object_type}" "${metadata}"
}

governance_sourced_production_root_is_selected() {
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
  if [[ "$#" -ne 2 ||
    ! "$2" =~ ^[0-9a-f]{40}$ ]] ||
    [[ "$1" != "publish" && "$1" != "recover-required" &&
      "$1" != "finalize-committed" ]]; then
    echo "usage: governance-publication-state-machine.sh <publish|recover-required|finalize-committed> <full-lowercase-git-commit-sha>" >&2
    exit 64
  fi
  governance_expected_entry="/opt/diesel/releases/$2/scripts/deploy/governance-publication-state-machine.sh"
  governance_expected_ledger="/opt/diesel/releases/$2/scripts/deploy/host-activation-ledger.sh"
  governance_expected_release="/opt/diesel/releases/$2"
  if [[ "${BASH_SOURCE[0]}" != "${governance_expected_entry}" ]] ||
    ! governance_cli_require_bootstrap_path /opt directory ||
    ! governance_cli_require_bootstrap_path /opt/diesel directory ||
    ! governance_cli_require_bootstrap_path /opt/diesel/releases directory ||
    ! governance_cli_require_bootstrap_path \
      "${governance_expected_release}" directory ||
    ! governance_cli_require_bootstrap_path \
      "${governance_expected_release}/scripts" directory ||
    ! governance_cli_require_bootstrap_path \
      "${governance_expected_release}/scripts/deploy" directory ||
    ! governance_cli_require_bootstrap_path \
      "${governance_expected_entry}" executable ||
    ! governance_cli_require_bootstrap_path \
      "${governance_expected_ledger}" executable; then
    echo "governance publication pre-source trust validation failed" >&2
    exit 70
  fi
  unset governance_expected_entry governance_expected_ledger governance_expected_release
  export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
fi

if source -- "${BASH_SOURCE[0]%/*}/host-activation-ledger.sh"; then
  :
else
  governance_ledger_source_status=$?
  if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    echo "governance publication ledger source failed" >&2
    exit 70
  fi
  return "${governance_ledger_source_status}"
fi

GOVERNANCE_ROOT_PATH="/usr/sbin:/usr/bin:/sbin:/bin"
GOVERNANCE_APPLICATION_PATH="/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
GOVERNANCE_NODE_BINARY=""
GOVERNANCE_FIXED_NODE_RUNNER=0

governance_publication_usage() {
  echo "usage: governance-publication-state-machine.sh <publish|recover-required|finalize-committed> <full-lowercase-git-commit-sha>" >&2
}

governance_publication_fail() {
  local status="$1"
  local message="$2"

  printf 'Governance publication: %s\n' "${message}" >&2
  return "${status}"
}

governance_require_cli_bootstrap_directory() {
  local path="$1"
  local canonical_path
  local metadata

  if [[ ! -d "${path}" || -L "${path}" ]] ||
    ! canonical_path="$(/usr/bin/realpath -e -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]] ||
    ! metadata="$(/usr/bin/stat -c '%u:%g:%a' -- "${path}")" ||
    [[ "${metadata}" != "0:0:755" ]]; then
    governance_publication_fail 70 \
      "fixed command directory is outside the root bootstrap profile: ${path}"
    return
  fi
}

governance_require_cli_bootstrap_executable() {
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
    governance_publication_fail 70 "${label} is not a trusted host executable"
    return
  fi
  IFS=: read -r owner group mode link_count <<<"${metadata}"
  if [[ "${owner}" != "0" || "${group}" != "0" ||
    "${link_count}" != "1" || ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    governance_publication_fail 70 "${label} has unsafe host metadata"
    return
  fi
  permissions=$((8#${mode}))
  if (( (permissions & 07000) != 0 || (permissions & 0022) != 0 ||
    (permissions & 0100) == 0 )); then
    governance_publication_fail 70 \
      "${label} is writable outside root, has special bits, or is not root-executable"
    return
  fi
}

governance_run_node() {
  if [[ "${GOVERNANCE_FIXED_NODE_RUNNER}" -eq 1 ]]; then
    "${GOVERNANCE_NODE_BINARY}" "$@"
  else
    node "$@"
  fi
}

governance_run_tsx() {
  if [[ "${GOVERNANCE_FIXED_NODE_RUNNER}" -eq 1 ]]; then
    "${GOVERNANCE_NODE_BINARY}" --import tsx "$@"
  else
    corepack pnpm exec tsx "$@"
  fi
}

governance_require_cli_command_boundary() {
  local node_root="/opt/node-v22.22.3-linux-x64"
  local node_binary="${node_root}/bin/node"
  local command_name
  local command_spec
  local expected_path
  local path
  local resolved_path
  local version

  if [[ "${EUID}" -ne 0 ]]; then
    governance_publication_fail 70 "the state machine must run as root"
    return
  fi
  for path in \
    /opt "${node_root}" "${node_root}/bin" \
    /usr/local /usr/local/sbin /usr/local/bin; do
    governance_require_cli_bootstrap_directory "${path}" || return $?
  done
  if [[ ! -f "${node_binary}" || -L "${node_binary}" ||
    ! -x "${node_binary}" ]] ||
    [[ "$(/usr/bin/realpath -e -- "${node_binary}")" != "${node_binary}" ]] ||
    [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${node_binary}")" != \
      "0:0:755:1" ]] ||
    ! version="$("${node_binary}" --version)" ||
    [[ "${version}" != "v22.22.3" ]]; then
    governance_publication_fail 70 \
      "fixed Node.js runtime is outside the root bootstrap profile"
    return
  fi
  export PATH="${GOVERNANCE_ROOT_PATH}"
  for command_spec in \
    bash:/usr/bin/bash chmod:/usr/bin/chmod chown:/usr/bin/chown \
    curl:/usr/bin/curl env:/usr/bin/env find:/usr/bin/find flock:/usr/bin/flock \
    id:/usr/bin/id install:/usr/bin/install mktemp:/usr/bin/mktemp \
    mv:/usr/bin/mv readlink:/usr/bin/readlink realpath:/usr/bin/realpath \
    rm:/usr/bin/rm rmdir:/usr/bin/rmdir runuser:/usr/sbin/runuser \
    sha256sum:/usr/bin/sha256sum sort:/usr/bin/sort stat:/usr/bin/stat; do
    command_name="${command_spec%%:*}"
    expected_path="${command_spec#*:}"
    resolved_path="$(command -v "${command_name}")"
    if [[ "${resolved_path}" != "${expected_path}" ]]; then
      governance_publication_fail 70 \
        "governance command is outside the fixed system profile: ${command_name}"
      return
    fi
    governance_require_cli_bootstrap_executable \
      "${expected_path}" "fixed governance command ${command_name}" || return $?
  done
  if [[ "$(PATH="${GOVERNANCE_APPLICATION_PATH}" command -v node)" != \
    "${node_binary}" ]] ||
    [[ "$(PATH="${GOVERNANCE_APPLICATION_PATH}" command -v curl)" != \
      "/usr/bin/curl" ]]; then
    governance_publication_fail 70 \
      "unprivileged validators do not resolve to the validated application profile"
    return
  fi
  GOVERNANCE_NODE_BINARY="${node_binary}"
  GOVERNANCE_FIXED_NODE_RUNNER=1
}

governance_require_safe_release_id() {
  local expected_release_id="$1"

  if [[ ! "${expected_release_id}" =~ ^[0-9a-f]{40}$ ]]; then
    governance_publication_fail 64 \
      "release ID must be a full lowercase Git commit SHA"
    return
  fi
}

governance_require_safe_runtime_release_id() {
  local runtime_release_id="$1"

  if [[ ! "${runtime_release_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
    governance_publication_fail 70 "active release ID is unsafe"
    return
  fi
}

governance_require_safe_deploy_root() {
  local deploy_root="$1"

  if [[ ! "${deploy_root}" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
    [[ "${deploy_root}" == "/" ]] ||
    [[ "${deploy_root}" == */ ]] ||
    [[ "${deploy_root}" == *//* ]] ||
    [[ "${deploy_root}" == *'/../'* ]] ||
    [[ "${deploy_root}" == *'/./'* ]] ||
    [[ "${deploy_root}" == */.. ]] ||
    [[ "${deploy_root}" == */. ]]; then
    governance_publication_fail 64 "deploy root is not canonical"
    return
  fi
}

governance_require_root() {
  if [[ "$(id -u)" != "0" ]]; then
    governance_publication_fail 70 "the state machine must run as root"
    return
  fi
}

governance_require_maintenance_environment() {
  local expected_release_id="$1"

  if [[ "${NODE_ENV:-}" != "production" ]] ||
    [[ "${DATABASE_MODE:-}" != "postgres" ]] ||
    [[ "${release_id:-}" != "${expected_release_id}" ]]; then
    governance_publication_fail 70 \
      "production environment and release binding are required"
    return
  fi
  if [[ ! "${DIESEL_GOVERNANCE_MAINTENANCE_TOKEN:-}" =~ ^[0-9a-f]{64}$ ]]; then
    governance_publication_fail 70 \
      "a governance maintenance lock token is required"
    return
  fi
}

governance_require_exact_directory() {
  local path="$1"
  local expected_metadata="$2"
  local label="$3"
  local actual_metadata

  if [[ ! -d "${path}" || -L "${path}" ]]; then
    governance_publication_fail 70 \
      "${label} must be a regular directory"
    return
  fi
  if ! actual_metadata="$(stat -c '%U:%G:%a' -- "${path}")"; then
    governance_publication_fail 70 "could not inspect ${label}"
    return
  fi
  if [[ "${actual_metadata}" != "${expected_metadata}" ]]; then
    governance_publication_fail 70 \
      "${label} must be ${expected_metadata}"
    return
  fi
}

governance_require_exact_file() {
  local path="$1"
  local expected_metadata="$2"
  local label="$3"
  local actual_metadata

  if [[ ! -f "${path}" || -L "${path}" ]]; then
    governance_publication_fail 70 \
      "${label} must be a regular non-symlink file"
    return
  fi
  if ! actual_metadata="$(stat -c '%U:%G:%a' -- "${path}")"; then
    governance_publication_fail 70 "could not inspect ${label}"
    return
  fi
  if [[ "${actual_metadata}" != "${expected_metadata}" ]]; then
    governance_publication_fail 70 \
      "${label} must be ${expected_metadata}"
    return
  fi
}

governance_require_trusted_runtime_path() {
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
    governance_publication_fail 70 "${label} must not be a symlink"
    return
  fi
  case "${object_type}" in
    directory)
      [[ -d "${path}" ]] || {
        governance_publication_fail 70 "${label} must be a directory"
        return
      }
      ;;
    file)
      [[ -f "${path}" ]] || {
        governance_publication_fail 70 "${label} must be a regular file"
        return
      }
      ;;
    *)
      governance_publication_fail 64 "invalid trusted runtime object type"
      return
      ;;
  esac
  if ! canonical_path="$(readlink -f -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]]; then
    governance_publication_fail 70 "${label} must be canonical"
    return
  fi
  if ! metadata="$(stat -c '%U:%G:%a' -- "${path}")"; then
    governance_publication_fail 70 "could not inspect ${label}"
    return
  fi
  IFS=: read -r owner group mode <<<"${metadata}"
  if [[ "${owner}" != "root" ||
    ( "${group}" != "root" && "${group}" != "diesel" ) ]] ||
    [[ ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    governance_publication_fail 70 "${label} is not root-owned trusted state"
    return
  fi
  permissions=$((8#${mode}))
  if (( (permissions & 0022) != 0 )); then
    governance_publication_fail 70 "${label} must not be group- or world-writable"
    return
  fi
  if [[ "${object_type}" == "directory" ]] &&
    (( (permissions & 0500) != 0500 )); then
    governance_publication_fail 70 "${label} must be readable and traversable"
    return
  fi
  if [[ "${object_type}" == "file" ]] &&
    (( (permissions & 0400) == 0 )); then
    governance_publication_fail 70 "${label} must be readable"
    return
  fi
  if [[ "${executable_required}" == "yes" ]] &&
    (( (permissions & 0100) == 0 )); then
    governance_publication_fail 70 "${label} must be executable"
    return
  fi
  if [[ "${executable_required}" != "yes" &&
    "${executable_required}" != "no" ]]; then
    governance_publication_fail 64 "invalid executable policy"
    return
  fi
}

governance_require_absent() {
  local path="$1"
  local label="$2"

  if [[ -e "${path}" || -L "${path}" ]]; then
    governance_publication_fail 70 "${label} must be absent"
    return
  fi
}

governance_require_stable_database_identity() {
  local expected_release_id="$1"
  local deploy_root="$2"
  local shared_root="${deploy_root}/shared"
  local live_environment="${shared_root}/.env.production.local"
  local environment_backup="${deploy_root}/backups/${expected_release_id}/env.production.local.pre-switch"

  governance_require_exact_directory \
    "${shared_root}" "root:diesel:750" "shared runtime root"
  governance_require_exact_file \
    "${live_environment}" "root:diesel:640" "shared runtime environment"
  governance_require_exact_file \
    "${environment_backup}" "root:root:600" \
    "pre-switch environment backup"

  governance_run_node -e '
    const { closeSync, fsyncSync, openSync, readFileSync } = require("node:fs");
    const { parseEnv } = require("node:util");

    const [backupPath, livePath, sharedRoot] = process.argv.slice(1);
    const invalidMessage =
      "Governance publication: runtime database identity is missing or invalid\n";
    const changedMessage =
      "Governance publication: runtime database identity changed across the release boundary\n";
    const durabilityMessage =
      "Governance publication: runtime environment durability proof failed\n";

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
    const maintenanceDatabaseUrl = process.env.DATABASE_URL;
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
      !hasPostgresProtocol(liveDatabaseUrl) ||
      !hasPostgresProtocol(maintenanceDatabaseUrl)
    ) {
      process.stderr.write(invalidMessage);
      process.exit(70);
    }
    if (
      backupDatabaseUrl !== liveDatabaseUrl ||
      backupDatabaseUrl !== maintenanceDatabaseUrl
    ) {
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
  ' -- "${environment_backup}" "${live_environment}" "${shared_root}"
}

governance_acquire_release_lifecycle_lock() {
  local deploy_root="$1"
  local lock_path="${deploy_root}/.release-lifecycle.lock"
  local inherited_lock_fd="${DIESEL_RELEASE_LIFECYCLE_LOCK_FD:-}"
  local inherited_lock_path

  if ! command -v flock >/dev/null 2>&1; then
    governance_publication_fail 70 \
      "required publication command is unavailable: flock"
    return
  fi
  governance_require_exact_file \
    "${lock_path}" "root:root:600" "release lifecycle lock"
  if [[ -n "${inherited_lock_fd}" ]]; then
    if [[ "${inherited_lock_fd}" != "8" ]] ||
      ! { true <&8; } 2>/dev/null; then
      governance_publication_fail 70 \
        "inherited release lifecycle lock descriptor is invalid"
      return
    fi
    if ! inherited_lock_path="$(readlink -f -- /proc/self/fd/8)" ||
      [[ "${inherited_lock_path}" != "${lock_path}" ]]; then
      governance_publication_fail 70 \
        "inherited release lifecycle lock path is invalid"
      return
    fi
  else
    exec 8<>"${lock_path}"
    export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
  fi
  if ! flock -n 8; then
    governance_publication_fail 70 \
      "another release lifecycle operation is active"
    return
  fi
  GOVERNANCE_RELEASE_LIFECYCLE_LOCK_PATH="${lock_path}"
}

governance_validate_release_directory() {
  local expected_release_id="$1"
  local deploy_root="$2"
  local release_dir="${deploy_root}/releases/${expected_release_id}"

  governance_require_exact_directory \
    "${release_dir}" "root:diesel:750" "release directory"
  governance_require_exact_file \
    "${release_dir}/.deploy-ready" "root:diesel:640" "release readiness marker"
  governance_validate_release_script_directories "${release_dir}"
}

governance_validate_release_script_directories() {
  local release_path="$1"

  governance_require_trusted_runtime_path \
    "${release_path}/scripts" directory no "release scripts directory"
  governance_require_trusted_runtime_path \
    "${release_path}/scripts/db" directory no "release database scripts directory"
  governance_require_trusted_runtime_path \
    "${release_path}/scripts/deploy" directory no \
    "release deployment scripts directory"
}

governance_validate_runtime_verifier_directories() {
  local release_path="$1"

  governance_require_trusted_runtime_path \
    "${release_path}/scripts" directory no "active release scripts directory"
  governance_require_trusted_runtime_path \
    "${release_path}/scripts/deploy" directory no \
    "active release deployment scripts directory"
}

governance_validate_current_release() {
  local deploy_root="$1"
  local expected_release_id="${2:-}"
  local releases_root="${deploy_root}/releases"
  local current_link="${deploy_root}/current"
  local current_release_path
  local current_release_id

  if [[ ! -L "${current_link}" ]]; then
    governance_publication_fail 70 "current must be a release symlink"
    return
  fi
  if ! current_release_path="$(readlink -f -- "${current_link}")"; then
    governance_publication_fail 70 "current release cannot be resolved"
    return
  fi
  current_release_id="${current_release_path##*/}"
  governance_require_safe_runtime_release_id "${current_release_id}"
  if [[ "${current_release_path}" != "${releases_root}/${current_release_id}" ]]; then
    governance_publication_fail 70 \
      "current must resolve directly below the release root"
    return
  fi
  if [[ -n "${expected_release_id}" &&
    "${current_release_id}" != "${expected_release_id}" ]]; then
    governance_publication_fail 70 \
      "current does not match the requested release"
    return
  fi
  if [[ -n "${expected_release_id}" ]]; then
    governance_validate_release_directory "${current_release_id}" "${deploy_root}"
  else
    governance_require_trusted_runtime_path \
      "${current_release_path}" directory no "active release directory"
    governance_require_trusted_runtime_path \
      "${current_release_path}/.deploy-ready" file no \
      "active release readiness marker"
    # Historical releases supported by host rollback need only contain the
    # versioned public verifier. Do not require unrelated database scripts.
    governance_validate_runtime_verifier_directories "${current_release_path}"
  fi

  GOVERNANCE_CURRENT_RELEASE_ID="${current_release_id}"
  GOVERNANCE_CURRENT_RELEASE_PATH="${current_release_path}"
}

governance_validate_common_layout() {
  local deploy_root="$1"

  governance_require_exact_directory \
    "${deploy_root}" "root:root:755" "deployment root"
  governance_require_exact_directory \
    "${deploy_root}/releases" "root:root:755" "release root"
  governance_require_exact_directory \
    "${deploy_root}/backups" "root:root:700" "publication state root"
}

governance_hash_snapshot() {
  local snapshot_path="$1"
  local hash_output
  local snapshot_sha256

  governance_require_exact_file \
    "${snapshot_path}" "root:root:600" "governance snapshot"
  if ! hash_output="$(sha256sum -- "${snapshot_path}")"; then
    governance_publication_fail 70 "could not hash the governance snapshot"
    return
  fi
  snapshot_sha256="${hash_output%% *}"
  if [[ ! "${snapshot_sha256}" =~ ^[0-9a-f]{64}$ ]]; then
    governance_publication_fail 70 \
      "governance snapshot hash is invalid"
    return
  fi

  GOVERNANCE_SNAPSHOT_SHA256="${snapshot_sha256}"
}

# Shared fail-closed parser for RECOVERY_REQUIRED, HOST_ROLLBACK_REQUIRED,
# HOST_ROLLBACK_COMPLETED, PUBLISH_COMMITTED, and PUBLISH_FINALIZED. Every
# durable state is bound to the same immutable pre-publication snapshot.
# On success it exposes the validated values through the two variables below.
governance_parse_publication_marker() {
  local marker_path="$1"
  local expected_release_id="$2"
  local deploy_root="$3"
  local expected_snapshot_path="${deploy_root}/backups/${expected_release_id}/governance-before.json"
  local marker_line
  local marker_size
  local marker_snapshot_sha256
  local marker_snapshot_path
  local expected_line
  local actual_hash_output
  local actual_snapshot_sha256

  governance_require_safe_release_id "${expected_release_id}"
  governance_require_safe_deploy_root "${deploy_root}"
  governance_require_exact_file \
    "${marker_path}" "root:root:600" "publication marker"

  marker_line=''
  if ! IFS= read -r marker_line <"${marker_path}"; then
    governance_publication_fail 70 \
      "publication marker must be one newline-terminated record"
    return
  fi
  if ! marker_size="$(stat -c '%s' -- "${marker_path}")"; then
    governance_publication_fail 70 "could not inspect publication marker size"
    return
  fi
  if [[ "${marker_line}" != *$'\t'* ]]; then
    governance_publication_fail 70 "publication marker payload is invalid"
    return
  fi
  marker_snapshot_sha256="${marker_line%%$'\t'*}"
  marker_snapshot_path="${marker_line#*$'\t'}"
  expected_line="${marker_snapshot_sha256}"$'\t'"${expected_snapshot_path}"
  if [[ ! "${marker_snapshot_sha256}" =~ ^[0-9a-f]{64}$ ]] ||
    [[ "${marker_snapshot_path}" != "${expected_snapshot_path}" ]] ||
    [[ "${marker_line}" != "${expected_line}" ]] ||
    [[ "${marker_size}" != "$((${#expected_line} + 1))" ]]; then
    governance_publication_fail 70 \
      "publication marker is not bound to the release snapshot"
    return
  fi

  governance_require_exact_file \
    "${expected_snapshot_path}" "root:root:600" "governance snapshot"
  if ! actual_hash_output="$(sha256sum -- "${expected_snapshot_path}")"; then
    governance_publication_fail 70 "could not hash the governance snapshot"
    return
  fi
  actual_snapshot_sha256="${actual_hash_output%% *}"
  if [[ "${actual_snapshot_sha256}" != "${marker_snapshot_sha256}" ]]; then
    governance_publication_fail 70 \
      "governance snapshot does not match the publication marker"
    return
  fi

  GOVERNANCE_MARKER_SNAPSHOT_SHA256="${marker_snapshot_sha256}"
  GOVERNANCE_MARKER_SNAPSHOT_PATH="${marker_snapshot_path}"
}

governance_require_versioned_publish_inputs() {
  local expected_release_id="$1"
  local deploy_root="$2"
  local release_dir="${deploy_root}/releases/${expected_release_id}"

  governance_require_exact_file \
    "${release_dir}/scripts/db/assert-governance-maintenance-lock.ts" \
    "root:diesel:640" "versioned maintenance lock verifier"
  governance_require_exact_file \
    "${release_dir}/scripts/db/export-governance-snapshot.ts" \
    "root:diesel:640" "versioned governance exporter"
  governance_require_exact_file \
    "${release_dir}/scripts/db/restore-governance-snapshot.ts" \
    "root:diesel:640" "versioned governance restorer"
  governance_require_exact_file \
    "${release_dir}/scripts/deploy/publish-governance-country-fixtures.sh" \
    "root:diesel:750" "versioned country publication queue"
  governance_require_exact_file \
    "${release_dir}/scripts/deploy/validate-public-governance.sh" \
    "root:diesel:750" "versioned public governance validator"
  governance_require_exact_file \
    "${release_dir}/scripts/deploy/host-activation-ledger.sh" \
    "root:diesel:750" "versioned host activation ledger"
}

governance_resolve_node_binary() {
  local node_binary

  if [[ "${GOVERNANCE_FIXED_NODE_RUNNER}" -eq 1 ]]; then
    if [[ "${GOVERNANCE_NODE_BINARY}" != \
      "/opt/node-v22.22.3-linux-x64/bin/node" ]]; then
      governance_publication_fail 70 \
        "the fixed Node.js runtime binding is unavailable"
      return
    fi
    return 0
  fi
  if ! node_binary="$(command -v node)" ||
    [[ ! -f "${node_binary}" || -L "${node_binary}" ||
      ! -x "${node_binary}" ]]; then
    governance_publication_fail 70 \
      "the fixed Node.js runtime is unavailable"
    return
  fi
  GOVERNANCE_NODE_BINARY="${node_binary}"
}

governance_require_host_activation_commands() {
  local command_name

  for command_name in find realpath sha256sum sort stat; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      governance_publication_fail 70 \
        "required host activation command is unavailable: ${command_name}"
      return
    fi
  done
}

governance_require_v1_host_state() {
  local expected_release_id="$1"
  local deploy_root="$2"
  local expected_host_state="$3"
  local expected_governance_state="$4"

  host_activation_ledger_validate_release_state \
    "${expected_release_id}" "${deploy_root}" || return $?
  if [[ "${HOST_ACTIVATION_LEDGER_PROTOCOL}" != "v1" ]] ||
    [[ "${HOST_ACTIVATION_LEDGER_STATE}" != "${expected_host_state}" ]] ||
    [[ "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != \
      "${expected_governance_state}" ]]; then
    governance_publication_fail 70 \
      "host activation ledger is not in the required publication state"
    return
  fi
}

governance_assert_maintenance_lock() {
  local release_dir="$1"
  local lock_verifier="${release_dir}/scripts/db/assert-governance-maintenance-lock.ts"

  governance_require_exact_file \
    "${lock_verifier}" "root:diesel:640" \
    "versioned maintenance lock verifier"
  (
    cd -- "${release_dir}"
    governance_run_tsx \
      scripts/db/assert-governance-maintenance-lock.ts
  )
}

governance_export_snapshot() {
  local output_path="$1"

  governance_run_tsx \
    scripts/db/export-governance-snapshot.ts \
    --output="${output_path}"
}

governance_restore_snapshot() {
  local snapshot_path="$1"
  local snapshot_sha256="$2"
  local mode="${3:-dry-run}"

  if [[ "${mode}" == "apply" ]]; then
    governance_run_tsx \
      scripts/db/restore-governance-snapshot.ts \
      --input="${snapshot_path}" --sha256="${snapshot_sha256}" --apply
  elif [[ "${mode}" != "dry-run" ]]; then
    governance_publication_fail 64 "invalid snapshot restore mode"
    return
  else
    governance_run_tsx \
      scripts/db/restore-governance-snapshot.ts \
      --input="${snapshot_path}" --sha256="${snapshot_sha256}"
  fi
}

governance_compare_snapshots() {
  local before_path="$1"
  local after_path="$2"

  governance_run_node -e '
    const { readFileSync } = require("node:fs");
    const { isDeepStrictEqual } = require("node:util");
    const before = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const after = JSON.parse(readFileSync(process.argv[2], "utf8"));
    if (
      !isDeepStrictEqual(before.tableCounts, after.tableCounts) ||
      !isDeepStrictEqual(before.tables, after.tables)
    ) {
      throw new Error("Governance snapshots do not match");
    }
  ' -- "${before_path}" "${after_path}"
}

# Host-state validators need the release lifecycle descriptor, but no database,
# model, or maintenance-token environment. Keeping FD 8 open lets the
# versioned rollback state machine prove that it is running inside this same
# lifecycle critical section instead of trying to acquire a second lock.
governance_run_isolated_host_validator() {
  local inherited_lock_path

  if [[ "$#" -lt 1 ]]; then
    governance_publication_fail 64 "an isolated host validator is required"
    return
  fi
  if [[ "${DIESEL_RELEASE_LIFECYCLE_LOCK_FD:-}" != "8" ]] ||
    ! { true <&8; } 2>/dev/null; then
    governance_publication_fail 70 \
      "the isolated host validator requires lifecycle lock descriptor 8"
    return
  fi
  if [[ -z "${GOVERNANCE_RELEASE_LIFECYCLE_LOCK_PATH:-}" ]] ||
    ! inherited_lock_path="$(readlink -f -- /proc/self/fd/8)" ||
    [[ "${inherited_lock_path}" != \
      "${GOVERNANCE_RELEASE_LIFECYCLE_LOCK_PATH}" ]]; then
    governance_publication_fail 70 \
      "the isolated host validator inherited an unexpected lifecycle lock"
    return
  fi

  if [[ "${GOVERNANCE_FIXED_NODE_RUNNER}" -eq 1 ]]; then
    /usr/bin/env -i \
      HOME=/root \
      PATH="${GOVERNANCE_ROOT_PATH}" \
      DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8 \
      /bin/bash --noprofile --norc -- "$@"
  else
    env -i \
      HOME=/root \
      PATH="${PATH}" \
      DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8 \
      bash -- "$@"
  fi
}

# Public readback scripts do not need database/model credentials, the live
# maintenance capability, or the host lifecycle descriptor. Execute them as
# the unprivileged application user in a deliberately empty environment.
governance_run_isolated_runtime_verifier() {
  if [[ "$#" -lt 1 ]]; then
    governance_publication_fail 64 "an isolated runtime verifier is required"
    return
  fi

  if [[ "${GOVERNANCE_FIXED_NODE_RUNNER}" -eq 1 ]]; then
    /usr/sbin/runuser -u diesel -- \
      /usr/bin/env -i HOME=/var/lib/diesel \
        PATH="${GOVERNANCE_APPLICATION_PATH}" /bin/bash --noprofile --norc -- \
        "$@" 8>&-
  else
    runuser -u diesel -- \
      env -i HOME=/var/lib/diesel PATH="${PATH}" bash -- "$@" 8>&-
  fi
}

# The durable saved validator lives below a root-only publication state
# directory. Root opens the already-validated file as stdin before runuser
# drops privileges; the validator itself still executes as diesel and cannot
# observe FD 8 or any production secrets.
governance_run_isolated_saved_public_validator() {
  local validator_path="${1:-}"

  if [[ "$#" -lt 1 ]]; then
    governance_publication_fail 64 \
      "an isolated saved public validator is required"
    return
  fi
  shift

  if [[ "${GOVERNANCE_FIXED_NODE_RUNNER}" -eq 1 ]]; then
    /usr/sbin/runuser -u diesel -- \
      /usr/bin/env -i HOME=/var/lib/diesel \
        PATH="${GOVERNANCE_APPLICATION_PATH}" \
        /bin/bash --noprofile --norc -s -- "$@" \
      8>&- <"${validator_path}"
  else
    runuser -u diesel -- \
      env -i HOME=/var/lib/diesel PATH="${PATH}" bash -s -- "$@" \
      8>&- <"${validator_path}"
  fi
}

# Atomic rename is not a durable commit until the renamed inode and containing
# directory have reached stable storage. Use the already-required production
# Node runtime so the same helper works for regular files and directories
# without adding another host package.
governance_fsync_paths() {
  if [[ "$#" -lt 1 ]]; then
    governance_publication_fail 64 "at least one fsync path is required"
    return
  fi

  governance_run_node -e '
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

governance_atomic_write_marker() {
  local marker_path="$1"
  local snapshot_sha256="$2"
  local snapshot_path="$3"
  local marker_directory="${marker_path%/*}"

  governance_require_absent "${marker_path}" "publication marker"
  GOVERNANCE_PENDING_MARKER_TEMP=''
  GOVERNANCE_PENDING_MARKER_TEMP="$(
    mktemp -- "${marker_directory}/.${marker_path##*/}.XXXXXX"
  )"
  chown -- root:root "${GOVERNANCE_PENDING_MARKER_TEMP}"
  chmod -- 600 "${GOVERNANCE_PENDING_MARKER_TEMP}"
  printf '%s\t%s\n' "${snapshot_sha256}" "${snapshot_path}" \
    >"${GOVERNANCE_PENDING_MARKER_TEMP}"
  governance_require_exact_file \
    "${GOVERNANCE_PENDING_MARKER_TEMP}" "root:root:600" \
    "staged publication marker"
  governance_fsync_paths "${GOVERNANCE_PENDING_MARKER_TEMP}"
  mv -Tf -- "${GOVERNANCE_PENDING_MARKER_TEMP}" "${marker_path}"
  GOVERNANCE_PENDING_MARKER_TEMP=''
  governance_fsync_paths "${marker_directory}"
}

governance_durable_rename_publication_marker() {
  local source_marker="$1"
  local destination_marker="$2"
  local expected_release_id="$3"
  local deploy_root="$4"
  local marker_directory="${source_marker%/*}"

  if [[ "${destination_marker%/*}" != "${marker_directory}" ]]; then
    governance_publication_fail 64 \
      "publication marker transitions must remain in one state directory"
    return
  fi
  governance_parse_publication_marker \
    "${source_marker}" "${expected_release_id}" "${deploy_root}" || return $?
  governance_require_absent \
    "${destination_marker}" "destination publication marker" || return $?
  mv -Tf -- "${source_marker}" "${destination_marker}" || return $?
  # fsync both the renamed inode and the directory entry. If either proof
  # fails, the destination remains as the only conservative recovery state.
  governance_fsync_paths \
    "${destination_marker}" "${marker_directory}" || return $?
  governance_parse_publication_marker \
    "${destination_marker}" "${expected_release_id}" "${deploy_root}"
}

governance_export_and_compare_restored_database() {
  local release_dir="$1"
  local snapshot_path="$2"
  local compare_path="$3"

  governance_require_absent \
    "${compare_path}" "recovery comparison snapshot" || return $?
  governance_export_snapshot "${compare_path}" || return $?
  governance_require_exact_file \
    "${compare_path}" "root:root:600" \
    "recovery comparison snapshot" || return $?
  governance_compare_snapshots \
    "${snapshot_path}" "${compare_path}" || return $?
  governance_assert_maintenance_lock "${release_dir}"
}

governance_restore_and_require_host_rollback() {
  local expected_release_id="$1"
  local deploy_root="$2"
  local release_dir="$3"
  local recovery_marker="$4"
  local host_rollback_marker="$5"
  local host_rollback_completed_marker="$6"
  local snapshot_path="$7"
  local compare_path="$8"
  local marker_directory="${recovery_marker%/*}"
  local snapshot_sha256

  governance_require_absent \
    "${host_rollback_marker}" "host rollback marker" || return $?
  governance_require_absent \
    "${host_rollback_completed_marker}" \
    "host rollback completed marker" || return $?
  governance_require_absent \
    "${marker_directory}/PUBLISH_COMMITTED" \
    "publish commit marker" || return $?
  governance_require_absent \
    "${marker_directory}/PUBLISH_FINALIZED" \
    "publish finalized marker" || return $?
  governance_parse_publication_marker \
    "${recovery_marker}" "${expected_release_id}" "${deploy_root}" || return $?
  snapshot_sha256="${GOVERNANCE_MARKER_SNAPSHOT_SHA256}"

  governance_restore_snapshot \
    "${snapshot_path}" "${snapshot_sha256}" apply || return $?
  governance_export_and_compare_restored_database \
    "${release_dir}" "${snapshot_path}" "${compare_path}" || return $?
  rm -f -- "${compare_path}" || return $?
  governance_require_absent \
    "${compare_path}" "recovery comparison snapshot" || return $?

  governance_require_absent \
    "${host_rollback_marker}" "host rollback marker" || return $?
  governance_require_absent \
    "${host_rollback_completed_marker}" \
    "host rollback completed marker" || return $?
  governance_require_absent \
    "${marker_directory}/PUBLISH_COMMITTED" \
    "publish commit marker" || return $?
  governance_require_absent \
    "${marker_directory}/PUBLISH_FINALIZED" \
    "publish finalized marker" || return $?
  governance_durable_rename_publication_marker \
    "${recovery_marker}" "${host_rollback_marker}" \
    "${expected_release_id}" "${deploy_root}" || return $?
  host_activation_ledger_validate_release_state \
    "${expected_release_id}" "${deploy_root}" || return $?
  if [[ "${HOST_ACTIVATION_LEDGER_PROTOCOL}" == "v1" ]] &&
    { [[ "${HOST_ACTIVATION_LEDGER_STATE}" != "PENDING" ]] ||
      [[ "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != \
        "HOST_ROLLBACK_REQUIRED" ]]; }; then
    governance_publication_fail 70 \
      "restored governance state conflicts with host activation state"
    return
  fi
}

governance_read_previous_release_state() {
  local previous_release_file="$1"
  local expected_release_id="$2"
  local deploy_root="$3"
  local previous_release
  local previous_release_id
  local state_size

  governance_require_exact_file \
    "${previous_release_file}" "root:root:600" \
    "previous release state" || return $?
  previous_release=''
  if ! IFS= read -r previous_release <"${previous_release_file}"; then
    governance_publication_fail 70 \
      "previous release state must be one newline-terminated record"
    return
  fi
  if ! state_size="$(stat -c '%s' -- "${previous_release_file}")"; then
    governance_publication_fail 70 \
      "could not inspect previous release state size"
    return
  fi
  previous_release_id="${previous_release##*/}"
  governance_require_safe_runtime_release_id "${previous_release_id}" || return $?
  if [[ "${previous_release}" != \
      "${deploy_root}/releases/${previous_release_id}" ]] ||
    [[ "${previous_release_id}" == "${expected_release_id}" ]] ||
    [[ "${state_size}" != "$((${#previous_release} + 1))" ]]; then
    governance_publication_fail 70 \
      "previous release state is not a distinct canonical release path"
    return
  fi

  GOVERNANCE_PREVIOUS_RELEASE_ID="${previous_release_id}"
  GOVERNANCE_PREVIOUS_RELEASE_PATH="${previous_release}"
}

governance_scan_stale_markers() {
  local backups_root="$1"
  local stale_markers
  local completed_markers
  local completed_marker
  local completed_state_directory
  local completed_release_id
  local finalized_markers
  local finalized_marker
  local finalized_state_directory
  local finalized_release_id
  local deploy_root="${backups_root%/backups}"

  if ! stale_markers="$(
    find -- "${backups_root}" \
      \( -type l -o -name RECOVERY_REQUIRED -o \
      -name HOST_ROLLBACK_REQUIRED -o -name PUBLISH_COMMITTED \) \
      -print
  )"; then
    governance_publication_fail 70 \
      "could not scan publication state markers"
    return
  fi
  if [[ -n "${stale_markers}" ]]; then
    governance_publication_fail 70 \
      "an unresolved marker or symlink blocks this publish"
    return
  fi

  if ! completed_markers="$(
    find -- "${backups_root}" -name HOST_ROLLBACK_COMPLETED -print
  )"; then
    governance_publication_fail 70 \
      "could not scan completed host rollback ledgers"
    return
  fi
  while IFS= read -r completed_marker; do
    [[ -n "${completed_marker}" ]] || continue
    completed_state_directory="${completed_marker%/*}"
    completed_release_id="${completed_state_directory##*/}"
    governance_require_safe_release_id "${completed_release_id}" || return $?
    if [[ "${completed_state_directory}" != \
      "${backups_root}/${completed_release_id}" ]]; then
      governance_publication_fail 70 \
        "completed host rollback ledger is outside its canonical state directory"
      return
    fi
    governance_require_exact_directory \
      "${completed_state_directory}" "root:root:700" \
      "completed host rollback state directory" || return $?
    governance_parse_publication_marker \
      "${completed_marker}" "${completed_release_id}" "${deploy_root}" || return $?
    governance_require_absent \
      "${completed_state_directory}/RECOVERY_REQUIRED" \
      "recovery marker beside completed host rollback" || return $?
    governance_require_absent \
      "${completed_state_directory}/HOST_ROLLBACK_REQUIRED" \
      "host rollback marker beside completed host rollback" || return $?
    governance_require_absent \
      "${completed_state_directory}/PUBLISH_COMMITTED" \
      "publish commit marker beside completed host rollback" || return $?
    governance_require_absent \
      "${completed_state_directory}/PUBLISH_FINALIZED" \
      "publish finalized marker beside completed host rollback" || return $?
  done <<<"${completed_markers}"

  if ! finalized_markers="$(
    find -- "${backups_root}" -name PUBLISH_FINALIZED -print
  )"; then
    governance_publication_fail 70 \
      "could not scan finalized publication ledgers"
    return
  fi
  while IFS= read -r finalized_marker; do
    [[ -n "${finalized_marker}" ]] || continue
    finalized_state_directory="${finalized_marker%/*}"
    finalized_release_id="${finalized_state_directory##*/}"
    governance_require_safe_release_id "${finalized_release_id}" || return $?
    if [[ "${finalized_state_directory}" != \
      "${backups_root}/${finalized_release_id}" ]]; then
      governance_publication_fail 70 \
        "finalized publication ledger is outside its canonical state directory"
      return
    fi
    governance_require_exact_directory \
      "${finalized_state_directory}" "root:root:700" \
      "finalized publication state directory" || return $?
    governance_parse_publication_marker \
      "${finalized_marker}" "${finalized_release_id}" "${deploy_root}" || return $?
    governance_require_absent \
      "${finalized_state_directory}/RECOVERY_REQUIRED" \
      "recovery marker beside finalized publication" || return $?
    governance_require_absent \
      "${finalized_state_directory}/HOST_ROLLBACK_REQUIRED" \
      "host rollback marker beside finalized publication" || return $?
    governance_require_absent \
      "${finalized_state_directory}/HOST_ROLLBACK_COMPLETED" \
      "host rollback completed marker beside finalized publication" || return $?
    governance_require_absent \
      "${finalized_state_directory}/PUBLISH_COMMITTED" \
      "publish commit marker beside finalized publication" || return $?
  done <<<"${finalized_markers}"
}

# The country queue requires each trap definition to contain this literal
# function name. The handler disables every trap before it performs recovery,
# preventing recursive restores. Once a committed/finalized publication or a
# host-rollback state exists it never calls the restorer again, even if a
# marker or later readback is damaged.
restore_governance_on_failure() {
  local requested_status="${1:-1}"
  local recovery_status=0

  trap - ERR INT TERM HUP EXIT
  if [[ ! "${requested_status}" =~ ^[0-9]+$ ]] ||
    [[ "${requested_status}" -eq 0 ]]; then
    requested_status=1
  fi

  if [[ "${GOVERNANCE_COMMIT_REACHED:-0}" == "1" ]] ||
    [[ -e "${GOVERNANCE_PUBLISH_COMMIT_MARKER:-/nonexistent}" ]] ||
    [[ -L "${GOVERNANCE_PUBLISH_COMMIT_MARKER:-/nonexistent}" ]] ||
    [[ -e "${GOVERNANCE_PUBLISH_FINALIZED_MARKER:-/nonexistent}" ]] ||
    [[ -L "${GOVERNANCE_PUBLISH_FINALIZED_MARKER:-/nonexistent}" ]] ||
    [[ -e "${GOVERNANCE_HOST_ROLLBACK_MARKER:-/nonexistent}" ]] ||
    [[ -L "${GOVERNANCE_HOST_ROLLBACK_MARKER:-/nonexistent}" ]] ||
    [[ -e "${GOVERNANCE_HOST_ROLLBACK_COMPLETED_MARKER:-/nonexistent}" ]] ||
    [[ -L "${GOVERNANCE_HOST_ROLLBACK_COMPLETED_MARKER:-/nonexistent}" ]]; then
    exit "${requested_status}"
  fi

  if [[ "${GOVERNANCE_SNAPSHOT_READY:-0}" != "1" ]]; then
    exit "${requested_status}"
  fi

  # A successful database restoration is not the end state: the host may still
  # be serving the failed release. Prove the restored graph is byte-for-byte
  # equivalent at the structured snapshot boundary, then durably advance the
  # single marker to HOST_ROLLBACK_REQUIRED. The versioned host rollback owns
  # the next transition and this handler never deletes the recovery ledger.
  set +e
  governance_restore_and_require_host_rollback \
    "${GOVERNANCE_EXPECTED_RELEASE_ID}" \
    "${GOVERNANCE_DEPLOY_ROOT}" \
    "${GOVERNANCE_RELEASE_DIRECTORY}" \
    "${GOVERNANCE_RECOVERY_MARKER}" \
    "${GOVERNANCE_HOST_ROLLBACK_MARKER}" \
    "${GOVERNANCE_HOST_ROLLBACK_COMPLETED_MARKER}" \
    "${GOVERNANCE_SNAPSHOT_PATH}" \
    "${GOVERNANCE_FAILURE_RECOVERY_COMPARE_PATH}"
  recovery_status="$?"
  set -e
  if [[ -n "${GOVERNANCE_PENDING_MARKER_TEMP:-}" ]] &&
    [[ "${GOVERNANCE_PENDING_MARKER_TEMP}" == "${GOVERNANCE_SNAPSHOT_DIRECTORY}/."* ]]; then
    rm -f -- "${GOVERNANCE_PENDING_MARKER_TEMP}"
    GOVERNANCE_PENDING_MARKER_TEMP=''
  fi
  if [[ "${recovery_status}" -ne 0 ]]; then
    governance_publication_fail 70 \
      "snapshot recovery did not converge; its durable recovery marker was preserved" || true
    exit 70
  fi
  exit "${requested_status}"
}

governance_publish_release() {
  local expected_release_id="$1"
  local deploy_root="$2"
  local releases_root="${deploy_root}/releases"
  local backups_root="${deploy_root}/backups"
  local release_dir="${releases_root}/${expected_release_id}"
  local snapshot_directory="${backups_root}/${expected_release_id}"
  local snapshot_path="${snapshot_directory}/governance-before.json"
  local rehearsal_path="${snapshot_directory}/governance-after-rehearsal.json"
  local failure_recovery_compare_path="${snapshot_directory}/governance-after-failure-recovery.json"
  local recovery_marker="${snapshot_directory}/RECOVERY_REQUIRED"
  local host_rollback_marker="${snapshot_directory}/HOST_ROLLBACK_REQUIRED"
  local host_rollback_completed_marker="${snapshot_directory}/HOST_ROLLBACK_COMPLETED"
  local publish_commit_marker="${snapshot_directory}/PUBLISH_COMMITTED"
  local publish_finalized_marker="${snapshot_directory}/PUBLISH_FINALIZED"
  local public_validation_script="${snapshot_directory}/validate-public-governance.sh"
  local previous_release_file="${snapshot_directory}/previous-release"
  local environment_backup="${snapshot_directory}/env.production.local.pre-switch"
  local nginx_primary_backup="${snapshot_directory}/jamesky.site.pre-switch"
  local nginx_alternate_backup="${snapshot_directory}/diesel-demo.pre-switch"
  local country_queue="${release_dir}/scripts/deploy/publish-governance-country-fixtures.sh"
  local source_public_validation_script="${release_dir}/scripts/deploy/validate-public-governance.sh"
  local node_binary
  local snapshot_sha256

  governance_require_exact_directory \
    "${deploy_root}" "root:root:755" "deployment root"
  governance_require_exact_directory \
    "${releases_root}" "root:root:755" "release root"
  governance_validate_release_directory "${expected_release_id}" "${deploy_root}"
  governance_validate_common_layout "${deploy_root}"
  governance_validate_current_release "${deploy_root}" "${expected_release_id}"
  governance_require_versioned_publish_inputs \
    "${expected_release_id}" "${deploy_root}"
  governance_resolve_node_binary
  node_binary="${GOVERNANCE_NODE_BINARY}"
  governance_require_exact_directory \
    "${snapshot_directory}" "root:root:700" "publication state directory"
  host_activation_ledger_scan_all \
    "${deploy_root}" "${node_binary}" allow-active \
    "${expected_release_id}"
  governance_require_v1_host_state \
    "${expected_release_id}" "${deploy_root}" PENDING none
  governance_scan_stale_markers "${backups_root}"
  governance_require_exact_file \
    "${previous_release_file}" "root:root:600" "previous release state"
  governance_require_exact_file \
    "${environment_backup}" "root:root:600" "environment rollback backup"
  governance_require_exact_file \
    "${nginx_primary_backup}" "root:root:600" "primary Nginx rollback backup"
  governance_require_exact_file \
    "${nginx_alternate_backup}" "root:root:600" "alternate Nginx rollback backup"
  governance_require_stable_database_identity \
    "${expected_release_id}" "${deploy_root}"
  governance_fsync_paths \
    "${previous_release_file}" "${environment_backup}" \
    "${nginx_primary_backup}" "${nginx_alternate_backup}" \
    "${snapshot_directory}" "${backups_root}" "${deploy_root}"
  governance_require_absent "${snapshot_path}" "governance snapshot"
  governance_require_absent "${rehearsal_path}" "restore rehearsal snapshot"
  governance_require_absent "${failure_recovery_compare_path}" \
    "failure recovery comparison snapshot"
  governance_require_absent "${public_validation_script}" \
    "saved public governance validator"
  governance_require_absent "${recovery_marker}" "recovery marker"
  governance_require_absent "${host_rollback_marker}" \
    "host rollback marker"
  governance_require_absent "${host_rollback_completed_marker}" \
    "host rollback completed marker"
  governance_require_absent "${publish_commit_marker}" "publish commit marker"
  governance_require_absent "${publish_finalized_marker}" \
    "publish finalized marker"

  cd -- "${release_dir}"
  if [[ "$(pwd -P)" != "${release_dir}" ]]; then
    governance_publication_fail 70 \
      "working directory does not match the requested release"
    return
  fi

  install -m 0700 -o root -g root -- \
    "${source_public_validation_script}" "${public_validation_script}"
  governance_require_exact_file \
    "${public_validation_script}" "root:root:700" \
    "saved public governance validator"
  /bin/bash --noprofile --norc -n -- "${public_validation_script}"
  governance_fsync_paths \
    "${public_validation_script}" "${snapshot_directory}"

  governance_export_snapshot "${snapshot_path}"
  governance_require_exact_file \
    "${snapshot_path}" "root:root:600" "governance snapshot"
  governance_fsync_paths "${snapshot_path}" "${snapshot_directory}"
  governance_hash_snapshot "${snapshot_path}"
  snapshot_sha256="${GOVERNANCE_SNAPSHOT_SHA256}"
  governance_restore_snapshot "${snapshot_path}" "${snapshot_sha256}" dry-run

  GOVERNANCE_COMMIT_REACHED=0
  GOVERNANCE_DEPLOY_ROOT="${deploy_root}"
  GOVERNANCE_EXPECTED_RELEASE_ID="${expected_release_id}"
  GOVERNANCE_PENDING_MARKER_TEMP=''
  GOVERNANCE_PUBLISH_COMMIT_MARKER="${publish_commit_marker}"
  GOVERNANCE_PUBLISH_FINALIZED_MARKER="${publish_finalized_marker}"
  GOVERNANCE_RECOVERY_MARKER="${recovery_marker}"
  GOVERNANCE_HOST_ROLLBACK_MARKER="${host_rollback_marker}"
  GOVERNANCE_HOST_ROLLBACK_COMPLETED_MARKER="${host_rollback_completed_marker}"
  GOVERNANCE_RELEASE_DIRECTORY="${release_dir}"
  GOVERNANCE_FAILURE_RECOVERY_COMPARE_PATH="${failure_recovery_compare_path}"
  GOVERNANCE_SNAPSHOT_DIRECTORY="${snapshot_directory}"
  GOVERNANCE_SNAPSHOT_PATH="${snapshot_path}"
  GOVERNANCE_SNAPSHOT_READY=1
  GOVERNANCE_SNAPSHOT_SHA256="${snapshot_sha256}"
  trap 'restore_governance_on_failure "$?"' ERR
  trap 'restore_governance_on_failure 130' INT
  trap 'restore_governance_on_failure 143' TERM
  trap 'restore_governance_on_failure 129' HUP
  trap 'restore_governance_on_failure "$?"' EXIT

  governance_atomic_write_marker \
    "${recovery_marker}" "${snapshot_sha256}" "${snapshot_path}"
  governance_parse_publication_marker \
    "${recovery_marker}" "${expected_release_id}" "${deploy_root}"

  governance_restore_snapshot "${snapshot_path}" "${snapshot_sha256}" apply
  governance_export_snapshot "${rehearsal_path}"
  governance_require_exact_file \
    "${rehearsal_path}" "root:root:600" "restore rehearsal snapshot"
  governance_compare_snapshots "${snapshot_path}" "${rehearsal_path}"

  source -- "${country_queue}"
  if ! declare -F publish_governance_country_fixtures_for_root \
    >/dev/null 2>&1; then
    governance_publication_fail 70 \
      "versioned country publication queue has no entry point"
    return
  fi
  publish_governance_country_fixtures_for_root \
    "${expected_release_id}" "${deploy_root}"
  governance_run_isolated_saved_public_validator \
    "${public_validation_script}" "${expected_release_id}"

  governance_assert_maintenance_lock "${release_dir}"
  governance_require_absent "${host_rollback_marker}" \
    "host rollback marker"
  governance_require_absent "${host_rollback_completed_marker}" \
    "host rollback completed marker"
  governance_require_absent "${publish_finalized_marker}" \
    "publish finalized marker"
  governance_parse_publication_marker \
    "${recovery_marker}" "${expected_release_id}" "${deploy_root}"
  governance_require_v1_host_state \
    "${expected_release_id}" "${deploy_root}" PENDING RECOVERY_REQUIRED
  governance_durable_rename_publication_marker \
    "${recovery_marker}" "${publish_commit_marker}" \
    "${expected_release_id}" "${deploy_root}"
  governance_require_v1_host_state \
    "${expected_release_id}" "${deploy_root}" PENDING PUBLISH_COMMITTED
  GOVERNANCE_COMMIT_REACHED=1
  trap - ERR INT TERM HUP EXIT
}

governance_cleanup_recovery_compare() {
  if [[ -n "${GOVERNANCE_RECOVERY_COMPARE_PATH:-}" ]] &&
    [[ -f "${GOVERNANCE_RECOVERY_COMPARE_PATH}" ]] &&
    [[ ! -L "${GOVERNANCE_RECOVERY_COMPARE_PATH}" ]]; then
    rm -f -- "${GOVERNANCE_RECOVERY_COMPARE_PATH}"
  fi
  if [[ -n "${GOVERNANCE_RECOVERY_COMPARE_DIRECTORY:-}" ]] &&
    [[ -d "${GOVERNANCE_RECOVERY_COMPARE_DIRECTORY}" ]] &&
    [[ ! -L "${GOVERNANCE_RECOVERY_COMPARE_DIRECTORY}" ]]; then
    rmdir -- "${GOVERNANCE_RECOVERY_COMPARE_DIRECTORY}" 2>/dev/null || true
  fi
}

governance_recover_required_release() {
  local expected_release_id="$1"
  local deploy_root="$2"
  local release_dir="${deploy_root}/releases/${expected_release_id}"
  local snapshot_directory="${deploy_root}/backups/${expected_release_id}"
  local recovery_marker="${snapshot_directory}/RECOVERY_REQUIRED"
  local host_rollback_marker="${snapshot_directory}/HOST_ROLLBACK_REQUIRED"
  local host_rollback_completed_marker="${snapshot_directory}/HOST_ROLLBACK_COMPLETED"
  local publish_commit_marker="${snapshot_directory}/PUBLISH_COMMITTED"
  local publish_finalized_marker="${snapshot_directory}/PUBLISH_FINALIZED"
  local snapshot_path="${snapshot_directory}/governance-before.json"
  local previous_release_file="${snapshot_directory}/previous-release"
  local rollback_script="${release_dir}/scripts/deploy/rollback-host-release.sh"
  local host_activation_ledger_script="${release_dir}/scripts/deploy/host-activation-ledger.sh"
  local recovery_state_count=0
  local host_protocol
  local host_state
  local governance_state
  local node_binary
  local selected_marker

  governance_validate_common_layout "${deploy_root}"
  governance_validate_release_directory "${expected_release_id}" "${deploy_root}"
  governance_require_exact_directory \
    "${snapshot_directory}" "root:root:700" "publication state directory"
  governance_require_exact_file \
    "${release_dir}/scripts/db/assert-governance-maintenance-lock.ts" \
    "root:diesel:640" "versioned maintenance lock verifier"
  governance_require_exact_file \
    "${release_dir}/scripts/db/export-governance-snapshot.ts" \
    "root:diesel:640" "versioned governance exporter"
  governance_require_exact_file \
    "${release_dir}/scripts/db/restore-governance-snapshot.ts" \
    "root:diesel:640" "versioned governance restorer"
  governance_require_exact_file \
    "${rollback_script}" "root:diesel:750" \
    "versioned host rollback state machine"
  governance_require_exact_file \
    "${host_activation_ledger_script}" "root:diesel:750" \
    "versioned host activation ledger"
  governance_resolve_node_binary
  node_binary="${GOVERNANCE_NODE_BINARY}"
  host_activation_ledger_scan_all \
    "${deploy_root}" "${node_binary}" allow-active \
    "${expected_release_id}"
  host_activation_ledger_validate_release_state \
    "${expected_release_id}" "${deploy_root}"
  host_protocol="${HOST_ACTIVATION_LEDGER_PROTOCOL}"
  host_state="${HOST_ACTIVATION_LEDGER_STATE}"
  governance_state="${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}"

  if [[ "${host_protocol}" == "v1" ]]; then
    case "${host_state}:${governance_state}" in
      ROLLED_BACK:HOST_ROLLBACK_COMPLETED)
        host_activation_ledger_revalidate_terminal \
          "${expected_release_id}" "${deploy_root}" "${node_binary}"
        return 0
        ;;
      PENDING:RECOVERY_REQUIRED | PENDING:HOST_ROLLBACK_REQUIRED | \
        ROLLED_BACK:HOST_ROLLBACK_REQUIRED) ;;
      *)
        governance_publication_fail 70 \
          "host activation ledger is not recoverable"
        return
        ;;
    esac
  else
    governance_require_absent "${publish_commit_marker}" "publish commit marker"
    governance_require_absent "${publish_finalized_marker}" \
      "publish finalized marker"
    for selected_marker in \
      "${recovery_marker}" \
      "${host_rollback_marker}" \
      "${host_rollback_completed_marker}"; do
      if [[ -e "${selected_marker}" || -L "${selected_marker}" ]]; then
        recovery_state_count=$((recovery_state_count + 1))
      fi
    done
    if [[ "${recovery_state_count}" -ne 1 ]]; then
      governance_publication_fail 70 \
        "exactly one governance recovery state must be present"
      return
    fi
  fi
  governance_read_previous_release_state \
    "${previous_release_file}" "${expected_release_id}" "${deploy_root}"

  # COMPLETED is a terminal audit ledger for the moment recovery converged.
  # Later valid governance writes or releases must not make that historical
  # fact actionable again. Re-prove and re-fsync the ledger, but never restore
  # its snapshot or mutate the current host from this state.
  if [[ -e "${host_rollback_completed_marker}" ||
    -L "${host_rollback_completed_marker}" ]]; then
    governance_require_absent "${recovery_marker}" "recovery marker"
    governance_require_absent "${host_rollback_marker}" \
      "host rollback marker"
    governance_parse_publication_marker \
      "${host_rollback_completed_marker}" \
      "${expected_release_id}" "${deploy_root}"
    governance_fsync_paths \
      "${host_rollback_completed_marker}" "${snapshot_directory}"
    governance_parse_publication_marker \
      "${host_rollback_completed_marker}" \
      "${expected_release_id}" "${deploy_root}"
    return 0
  fi

  governance_require_stable_database_identity \
    "${expected_release_id}" "${deploy_root}"

  cd -- "${release_dir}"
  GOVERNANCE_RECOVERY_COMPARE_DIRECTORY="$(
    mktemp -d -- \
      "${deploy_root}/.governance-recovery-${expected_release_id}.XXXXXX"
  )"
  governance_require_exact_directory \
    "${GOVERNANCE_RECOVERY_COMPARE_DIRECTORY}" "root:root:700" \
    "recovery comparison directory"
  GOVERNANCE_RECOVERY_COMPARE_PATH="${GOVERNANCE_RECOVERY_COMPARE_DIRECTORY}/after.json"
  trap governance_cleanup_recovery_compare EXIT

  if [[ -e "${recovery_marker}" || -L "${recovery_marker}" ]]; then
    governance_restore_and_require_host_rollback \
      "${expected_release_id}" \
      "${deploy_root}" \
      "${release_dir}" \
      "${recovery_marker}" \
      "${host_rollback_marker}" \
      "${host_rollback_completed_marker}" \
      "${snapshot_path}" \
      "${GOVERNANCE_RECOVERY_COMPARE_PATH}"
  elif [[ -e "${host_rollback_marker}" || -L "${host_rollback_marker}" ]]; then
    governance_parse_publication_marker \
      "${host_rollback_marker}" "${expected_release_id}" "${deploy_root}"
    governance_export_and_compare_restored_database \
      "${release_dir}" "${snapshot_path}" \
      "${GOVERNANCE_RECOVERY_COMPARE_PATH}"
  fi

  rm -f -- "${GOVERNANCE_RECOVERY_COMPARE_PATH}"
  governance_require_absent \
    "${GOVERNANCE_RECOVERY_COMPARE_PATH}" \
    "recovery comparison snapshot"

  governance_require_absent "${recovery_marker}" "recovery marker"
  governance_require_absent "${host_rollback_completed_marker}" \
    "host rollback completed marker"
  governance_require_absent "${publish_commit_marker}" "publish commit marker"
  governance_require_absent "${publish_finalized_marker}" \
    "publish finalized marker"
  governance_parse_publication_marker \
    "${host_rollback_marker}" "${expected_release_id}" "${deploy_root}"

  host_activation_ledger_validate_release_state \
    "${expected_release_id}" "${deploy_root}"
  host_protocol="${HOST_ACTIVATION_LEDGER_PROTOCOL}"
  host_state="${HOST_ACTIVATION_LEDGER_STATE}"
  governance_state="${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}"
  if [[ "${host_protocol}" == "v1" ]]; then
    if [[ "${governance_state}" != "HOST_ROLLBACK_REQUIRED" ]] ||
      [[ "${host_state}" != "PENDING" && \
        "${host_state}" != "ROLLED_BACK" ]]; then
      governance_publication_fail 70 \
        "host activation ledger changed during governance recovery"
      return
    fi
    governance_run_isolated_host_validator \
      "${rollback_script}" "${expected_release_id}" \
      --restore-governance-host
  else
    governance_run_isolated_host_validator \
      "${rollback_script}" "${expected_release_id}" \
      --restore-governance-host
  fi

  governance_require_absent "${recovery_marker}" "recovery marker"
  governance_require_absent "${host_rollback_completed_marker}" \
    "host rollback completed marker"
  governance_require_absent "${publish_commit_marker}" "publish commit marker"
  governance_require_absent "${publish_finalized_marker}" \
    "publish finalized marker"
  governance_parse_publication_marker \
    "${host_rollback_marker}" "${expected_release_id}" "${deploy_root}"

  # Host repair may take long enough for a lost lock or out-of-band writer to
  # matter. Re-export the old graph after the host verifier and compare again
  # while the same maintenance session is still proven live.
  governance_export_and_compare_restored_database \
    "${release_dir}" "${snapshot_path}" \
    "${GOVERNANCE_RECOVERY_COMPARE_PATH}"
  governance_read_previous_release_state \
    "${previous_release_file}" "${expected_release_id}" "${deploy_root}"
  governance_validate_current_release "${deploy_root}"
  if [[ "${GOVERNANCE_CURRENT_RELEASE_ID}" != \
      "${GOVERNANCE_PREVIOUS_RELEASE_ID}" ]] ||
    [[ "${GOVERNANCE_CURRENT_RELEASE_PATH}" != \
      "${GOVERNANCE_PREVIOUS_RELEASE_PATH}" ]]; then
    governance_publication_fail 70 \
      "host rollback did not converge current to the previous release"
    return
  fi
  governance_require_absent "${recovery_marker}" "recovery marker"
  governance_require_absent "${host_rollback_completed_marker}" \
    "host rollback completed marker"
  governance_require_absent "${publish_commit_marker}" "publish commit marker"
  governance_require_absent "${publish_finalized_marker}" \
    "publish finalized marker"
  governance_parse_publication_marker \
    "${host_rollback_marker}" "${expected_release_id}" "${deploy_root}"
  governance_assert_maintenance_lock "${release_dir}"
  if [[ "${host_protocol}" == "v1" ]]; then
    host_activation_ledger_validate_release_state \
      "${expected_release_id}" "${deploy_root}"
    if [[ "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != \
      "HOST_ROLLBACK_REQUIRED" ]] ||
      [[ "${HOST_ACTIVATION_LEDGER_STATE}" != "PENDING" && \
        "${HOST_ACTIVATION_LEDGER_STATE}" != "ROLLED_BACK" ]]; then
      governance_publication_fail 70 \
        "host activation ledger changed before recovery commit"
      return
    fi
    if [[ "${HOST_ACTIVATION_LEDGER_STATE}" == "PENDING" ]]; then
      host_activation_ledger_transition \
        "${expected_release_id}" "${deploy_root}" "${node_binary}" \
        ROLLED_BACK
    fi
    governance_require_v1_host_state \
      "${expected_release_id}" "${deploy_root}" \
      ROLLED_BACK HOST_ROLLBACK_REQUIRED
  fi
  governance_durable_rename_publication_marker \
    "${host_rollback_marker}" "${host_rollback_completed_marker}" \
    "${expected_release_id}" "${deploy_root}"
  governance_require_absent "${host_rollback_marker}" \
    "host rollback marker"
  governance_parse_publication_marker \
    "${host_rollback_completed_marker}" \
    "${expected_release_id}" "${deploy_root}"
  if [[ "${host_protocol}" == "v1" ]]; then
    host_activation_ledger_revalidate_terminal \
      "${expected_release_id}" "${deploy_root}" "${node_binary}"
    if [[ "${HOST_ACTIVATION_LEDGER_STATE}" != "ROLLED_BACK" ]] ||
      [[ "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != \
        "HOST_ROLLBACK_COMPLETED" ]]; then
      governance_publication_fail 70 \
        "governance recovery did not reach its terminal ledger"
      return
    fi
  fi
  trap - EXIT
  governance_cleanup_recovery_compare
}

governance_finalize_committed_release() {
  local expected_release_id="$1"
  local deploy_root="$2"
  local release_dir="${deploy_root}/releases/${expected_release_id}"
  local snapshot_directory="${deploy_root}/backups/${expected_release_id}"
  local recovery_marker="${snapshot_directory}/RECOVERY_REQUIRED"
  local host_rollback_marker="${snapshot_directory}/HOST_ROLLBACK_REQUIRED"
  local host_rollback_completed_marker="${snapshot_directory}/HOST_ROLLBACK_COMPLETED"
  local publish_commit_marker="${snapshot_directory}/PUBLISH_COMMITTED"
  local publish_finalized_marker="${snapshot_directory}/PUBLISH_FINALIZED"
  local public_validation_script="${snapshot_directory}/validate-public-governance.sh"
  local rollback_script="${release_dir}/scripts/deploy/rollback-host-release.sh"
  local host_activation_ledger_script="${release_dir}/scripts/deploy/host-activation-ledger.sh"
  local host_protocol
  local host_state
  local node_binary
  local publication_marker
  local transition_required=0

  governance_validate_common_layout "${deploy_root}"
  governance_validate_release_directory "${expected_release_id}" "${deploy_root}"
  governance_require_exact_directory \
    "${snapshot_directory}" "root:root:700" "publication state directory"
  governance_require_exact_file \
    "${host_activation_ledger_script}" "root:diesel:750" \
    "versioned host activation ledger"
  governance_resolve_node_binary
  node_binary="${GOVERNANCE_NODE_BINARY}"
  host_activation_ledger_scan_all \
    "${deploy_root}" "${node_binary}" allow-active \
    "${expected_release_id}"
  host_activation_ledger_validate_release_state \
    "${expected_release_id}" "${deploy_root}"
  host_protocol="${HOST_ACTIVATION_LEDGER_PROTOCOL}"
  host_state="${HOST_ACTIVATION_LEDGER_STATE}"
  if [[ "${HOST_ACTIVATION_LEDGER_CLASSIFICATION}" == "terminal" &&
    "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" == \
      "PUBLISH_FINALIZED" ]]; then
    host_activation_ledger_revalidate_terminal \
      "${expected_release_id}" "${deploy_root}" "${node_binary}"
    host_state="${HOST_ACTIVATION_LEDGER_STATE}"
  fi
  if [[ "${host_protocol}" == "v1" ]]; then
    case "${HOST_ACTIVATION_LEDGER_STATE}:${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" in
      PENDING:PUBLISH_COMMITTED | PENDING:PUBLISH_FINALIZED | \
        COMMITTED:PUBLISH_FINALIZED) ;;
      *)
        governance_publication_fail 70 \
          "host activation ledger is not finalizable"
        return
        ;;
    esac
  fi
  governance_require_stable_database_identity \
    "${expected_release_id}" "${deploy_root}"
  governance_require_absent "${recovery_marker}" "recovery marker"
  governance_require_absent "${host_rollback_marker}" \
    "host rollback marker"
  governance_require_absent "${host_rollback_completed_marker}" \
    "host rollback completed marker"
  if [[ ( -e "${publish_commit_marker}" || -L "${publish_commit_marker}" ) &&
    ( -e "${publish_finalized_marker}" || -L "${publish_finalized_marker}" ) ]]; then
    governance_publication_fail 70 \
      "commit and finalized markers must not coexist"
    return
  elif [[ -e "${publish_commit_marker}" || -L "${publish_commit_marker}" ]]; then
    publication_marker="${publish_commit_marker}"
    transition_required=1
  elif [[ -e "${publish_finalized_marker}" || -L "${publish_finalized_marker}" ]]; then
    publication_marker="${publish_finalized_marker}"
  else
    governance_publication_fail 70 \
      "committed publication state is missing"
    return
  fi
  governance_parse_publication_marker \
    "${publication_marker}" "${expected_release_id}" "${deploy_root}"
  governance_require_exact_file \
    "${release_dir}/scripts/db/assert-governance-maintenance-lock.ts" \
    "root:diesel:640" "versioned maintenance lock verifier"
  governance_require_exact_file \
    "${rollback_script}" "root:diesel:750" "versioned host rollback validator"
  governance_require_exact_file \
    "${public_validation_script}" "root:root:700" \
    "saved public governance validator"

  if [[ "${host_protocol}" == "v1" ]]; then
    if [[ "${transition_required}" -eq 1 ]]; then
      governance_durable_rename_publication_marker \
        "${publish_commit_marker}" "${publish_finalized_marker}" \
        "${expected_release_id}" "${deploy_root}"
      publication_marker="${publish_finalized_marker}"
      transition_required=0
    fi
    if [[ "${host_state}" == "PENDING" ]]; then
      governance_require_v1_host_state \
        "${expected_release_id}" "${deploy_root}" \
        PENDING PUBLISH_FINALIZED
    else
      governance_require_v1_host_state \
        "${expected_release_id}" "${deploy_root}" \
        COMMITTED PUBLISH_FINALIZED
    fi
  fi

  cd -- "${release_dir}"
  governance_validate_current_release "${deploy_root}" "${expected_release_id}"
  governance_assert_maintenance_lock "${release_dir}"
  governance_run_isolated_host_validator "${rollback_script}" \
    "${expected_release_id}" --validate-committed
  governance_run_isolated_saved_public_validator \
    "${public_validation_script}" "${expected_release_id}"

  governance_require_absent "${recovery_marker}" "recovery marker"
  governance_require_absent "${host_rollback_marker}" \
    "host rollback marker"
  governance_require_absent "${host_rollback_completed_marker}" \
    "host rollback completed marker"
  governance_parse_publication_marker \
    "${publication_marker}" "${expected_release_id}" "${deploy_root}"
  governance_assert_maintenance_lock "${release_dir}"
  governance_validate_current_release "${deploy_root}" "${expected_release_id}"
  governance_run_isolated_host_validator "${rollback_script}" \
    "${expected_release_id}" --validate-committed
  governance_run_isolated_saved_public_validator \
    "${public_validation_script}" "${expected_release_id}"
  governance_assert_maintenance_lock "${release_dir}"
  governance_validate_current_release "${deploy_root}" "${expected_release_id}"
  governance_require_absent "${recovery_marker}" "recovery marker"
  governance_require_absent "${host_rollback_marker}" \
    "host rollback marker"
  governance_require_absent "${host_rollback_completed_marker}" \
    "host rollback completed marker"
  if [[ "${host_protocol}" == "v1" ]]; then
    if [[ "${host_state}" == "PENDING" ]]; then
      governance_require_v1_host_state \
        "${expected_release_id}" "${deploy_root}" \
        PENDING PUBLISH_FINALIZED
      host_activation_ledger_transition \
        "${expected_release_id}" "${deploy_root}" "${node_binary}" \
        COMMITTED
    else
      governance_require_v1_host_state \
        "${expected_release_id}" "${deploy_root}" \
        COMMITTED PUBLISH_FINALIZED
    fi
    host_activation_ledger_revalidate_terminal \
      "${expected_release_id}" "${deploy_root}" "${node_binary}"
    if [[ "${HOST_ACTIVATION_LEDGER_STATE}" != "COMMITTED" ]] ||
      [[ "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != \
        "PUBLISH_FINALIZED" ]]; then
      governance_publication_fail 70 \
        "publication finalization did not reach its terminal ledger"
      return
    fi
  else
    if [[ "${transition_required}" -eq 1 ]]; then
      governance_durable_rename_publication_marker \
        "${publish_commit_marker}" "${publish_finalized_marker}" \
        "${expected_release_id}" "${deploy_root}"
    fi
  fi
  governance_require_absent "${publish_commit_marker}" \
    "publish commit marker"
  governance_parse_publication_marker \
    "${publish_finalized_marker}" "${expected_release_id}" "${deploy_root}"
}

governance_publication_state_machine() (
  set -Eeuo pipefail
  trap - ERR INT TERM HUP EXIT

  if [[ "$#" -ne 3 ]]; then
    governance_publication_fail 64 \
      "internal state machine requires <mode> <release-id> <deploy-root>"
    return
  fi

  local mode="$1"
  local expected_release_id="$2"
  local deploy_root="$3"

  if governance_sourced_production_root_is_selected "${deploy_root}"; then
    governance_publication_fail 64 \
      "governance test seam cannot target the production deployment root"
    return
  fi
  governance_require_safe_release_id "${expected_release_id}"
  governance_require_safe_deploy_root "${deploy_root}"
  case "${mode}" in
    publish | recover-required | finalize-committed) ;;
    *)
      governance_publication_fail 64 \
        "mode must be publish, recover-required, or finalize-committed"
      return
      ;;
  esac
  governance_require_root
  governance_acquire_release_lifecycle_lock "${deploy_root}"
  governance_require_host_activation_commands

  case "${mode}" in
    publish)
      governance_require_maintenance_environment "${expected_release_id}"
      governance_publish_release "${expected_release_id}" "${deploy_root}"
      ;;
    recover-required)
      governance_require_maintenance_environment "${expected_release_id}"
      governance_recover_required_release \
        "${expected_release_id}" "${deploy_root}"
      ;;
    finalize-committed)
      governance_require_maintenance_environment "${expected_release_id}"
      governance_finalize_committed_release \
        "${expected_release_id}" "${deploy_root}"
      ;;
  esac
)

governance_publication_state_machine_main() (
  set -Eeuo pipefail

  if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
    governance_publication_fail 64 \
      "production governance main is unavailable when sourced"
    return
  fi
  if [[ "$#" -ne 2 ]]; then
    governance_publication_usage
    return 64
  fi
  governance_require_safe_release_id "$2" || return $?
  case "$1" in
    publish | recover-required | finalize-committed) ;;
    *)
      governance_publication_fail 64 \
        "mode must be publish, recover-required, or finalize-committed"
      return
      ;;
  esac
  governance_require_cli_command_boundary || return $?
  governance_publication_state_machine "$1" "$2" /opt/diesel
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  governance_publication_state_machine_main "$@"
fi
