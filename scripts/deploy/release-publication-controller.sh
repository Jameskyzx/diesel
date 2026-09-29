#!/bin/bash

# This file is intentionally sourceable. The pure orchestration entry point can
# be exercised with dependency functions replaced by tests, while the CLI and
# release_publication_controller always use the fixed production layout.

RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS=64
RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS=70
RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS=75

release_publication_controller_cli_bootstrap_metadata_is_allowed() {
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

release_publication_controller_require_cli_bootstrap_path() {
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
  release_publication_controller_cli_bootstrap_metadata_is_allowed \
    "${profile}" "${metadata}"
}

release_publication_controller_sourced_production_root_is_selected() {
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

release_publication_controller_cli_bootstrap() {
  if [[ "$#" -ne 3 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
    return "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}"
  fi
  local release_id="$1"
  local deploy_root="$2"
  local observed_entry="$3"

  if release_publication_controller_sourced_production_root_is_selected \
    "${deploy_root}"; then
    return "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}"
  fi
  local expected_release="${deploy_root}/releases/${release_id}"
  local expected_entry="${expected_release}/scripts/deploy/release-publication-controller.sh"
  local expected_ledger="${expected_release}/scripts/deploy/host-activation-ledger.sh"

  if [[ "${observed_entry}" != "${expected_entry}" ]]; then
    return "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}"
  fi
  if ! release_publication_controller_require_cli_bootstrap_path \
      /opt system-directory ||
    ! release_publication_controller_require_cli_bootstrap_path \
      "${deploy_root}" system-directory ||
    ! release_publication_controller_require_cli_bootstrap_path \
      "${deploy_root}/releases" system-directory ||
    ! release_publication_controller_require_cli_bootstrap_path \
      "${expected_release}" release-directory ||
    ! release_publication_controller_require_cli_bootstrap_path \
      "${expected_release}/scripts" release-directory ||
    ! release_publication_controller_require_cli_bootstrap_path \
      "${expected_release}/scripts/deploy" release-directory ||
    ! release_publication_controller_require_cli_bootstrap_path \
      "${expected_entry}" release-executable ||
    ! release_publication_controller_require_cli_bootstrap_path \
      "${expected_ledger}" release-executable; then
    # The ledger has not executed, so its commit boundary is still unknown.
    return "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"
  fi
  export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
  source -- "${expected_ledger}" ||
    return "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
    echo "usage: release-publication-controller.sh <40-character-lowercase-git-sha>" >&2
    exit "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}"
  fi
  if release_publication_controller_cli_bootstrap \
    "$1" "/opt/diesel" "${BASH_SOURCE[0]}"; then
    :
  else
    release_publication_controller_bootstrap_status=$?
    echo "release publication controller pre-source trust validation failed" >&2
    exit "${release_publication_controller_bootstrap_status}"
  fi
  unset release_publication_controller_bootstrap_status
else
  release_publication_controller_script_directory="${BASH_SOURCE[0]%/*}"
  if [[ "${release_publication_controller_script_directory}" == "${BASH_SOURCE[0]}" ]]; then
    release_publication_controller_script_directory='.'
  fi
  if source -- \
    "${release_publication_controller_script_directory}/host-activation-ledger.sh"; then
    unset release_publication_controller_script_directory
  else
    release_publication_controller_source_status=$?
    unset release_publication_controller_script_directory
    return "${release_publication_controller_source_status}"
  fi
fi

RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT="/opt/diesel"
RELEASE_PUBLICATION_CONTROLLER_ROOT_PATH="/usr/sbin:/usr/bin:/sbin:/bin"
RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY="/opt/node-v22.22.3-linux-x64/bin/node"

release_publication_controller_usage() {
  echo "usage: release-publication-controller.sh <40-character-lowercase-git-sha>" >&2
}

release_publication_controller_fail() {
  local status="$1"
  shift
  echo "$*" >&2
  return "${status}"
}

release_publication_controller_is_commit() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

release_publication_controller_require_trusted_host_executable() {
  local path="$1"
  local label="$2"
  local metadata
  local owner
  local group
  local mode
  local permissions

  if [[ ! -f "${path}" || -L "${path}" || ! -x "${path}" ]] ||
    ! metadata="$(/usr/bin/stat -c '%u:%g:%a' -- "${path}")"; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "${label} must be a trusted executable"
    return
  fi
  IFS=: read -r owner group mode <<<"${metadata}"
  if [[ "${owner}" != "0" || "${group}" != "0" ||
    ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "${label} has unsafe ownership or mode"
    return
  fi
  permissions=$((8#${mode}))
  if (( (permissions & 07000) != 0 || (permissions & 0022) != 0 ||
    (permissions & 0100) == 0 )); then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "${label} is writable outside root, has special mode bits, or is not root-executable"
    return
  fi
}

release_publication_controller_require_trusted_host_directory() {
  local path="$1"
  local label="$2"
  local canonical_path
  local metadata
  local owner
  local group
  local mode
  local permissions

  if [[ ! -d "${path}" || -L "${path}" ]] ||
    ! canonical_path="$(/usr/bin/realpath -e -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]] ||
    ! metadata="$(/usr/bin/stat -c '%u:%g:%a' -- "${path}")"; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "${label} must be a trusted canonical directory"
    return
  fi
  IFS=: read -r owner group mode <<<"${metadata}"
  if [[ "${owner}" != "0" || "${group}" != "0" ||
    ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "${label} has unsafe ownership or mode"
    return
  fi
  permissions=$((8#${mode}))
  if (( (permissions & 07000) != 0 || (permissions & 0022) != 0 ||
    (permissions & 0500) != 0500 )); then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "${label} is writable outside root, has special mode bits, or is not root-searchable"
    return
  fi
}

release_publication_controller_require_fixed_node_runtime() {
  local node_root="/opt/node-v22.22.3-linux-x64"
  local path
  local canonical_path
  local metadata
  local version

  for path in /opt "${node_root}" "${node_root}/bin"; do
    if [[ ! -d "${path}" || -L "${path}" ]] ||
      ! canonical_path="$(/usr/bin/realpath -e -- "${path}")" ||
      [[ "${canonical_path}" != "${path}" ]] ||
      ! metadata="$(/usr/bin/stat -c '%u:%g:%a' -- "${path}")" ||
      [[ "${metadata}" != "0:0:755" ]]; then
      release_publication_controller_fail \
        "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
        "fixed Node.js runtime directory is not trusted: ${path}"
      return
    fi
  done

  if [[ ! -f "${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}" ||
    -L "${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}" ||
    ! -x "${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}" ]] ||
    ! canonical_path="$(
      /usr/bin/realpath -e -- "${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}"
    )" ||
    [[ "${canonical_path}" != "${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}" ]] ||
    ! metadata="$(
      /usr/bin/stat -c '%u:%g:%a:%h' -- \
        "${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}"
    )" ||
    [[ "${metadata}" != "0:0:755:1" ]] ||
    ! version="$("${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}" --version)" ||
    [[ "${version}" != "v22.22.3" ]]; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "fixed Node.js runtime is missing or does not match the trusted host profile"
    return
  fi
}

release_publication_controller_require_fixed_host_commands() {
  local command_name
  local expected_path
  local resolved_path
  local command_spec
  local -a command_specs=(
    "find:/usr/bin/find"
    "flock:/usr/bin/flock"
    "id:/usr/bin/id"
    "mktemp:/usr/bin/mktemp"
    "mv:/usr/bin/mv"
    "readlink:/usr/bin/readlink"
    "realpath:/usr/bin/realpath"
    "sha256sum:/usr/bin/sha256sum"
    "sort:/usr/bin/sort"
    "stat:/usr/bin/stat"
  )

  release_publication_controller_require_trusted_host_directory \
    /usr/local "local host command root" || return $?
  release_publication_controller_require_trusted_host_directory \
    /usr/local/sbin "local host sbin directory" || return $?
  release_publication_controller_require_trusted_host_directory \
    /usr/local/bin "local host bin directory" || return $?

  # Root orchestration never searches the application or local-install bins.
  # Those paths are passed only to explicit clean children after this proof.
  export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
  for command_spec in "${command_specs[@]}"; do
    command_name="${command_spec%%:*}"
    expected_path="${command_spec#*:}"
    resolved_path="$(command -v "${command_name}")"
    if [[ "${resolved_path}" != "${expected_path}" ]]; then
      release_publication_controller_fail \
        "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
        "required release publication command does not resolve to its fixed host path: ${command_name}"
      return
    fi
    release_publication_controller_require_trusted_host_executable \
      "${expected_path}" "fixed host command ${command_name}" || return $?
  done
}

release_publication_controller_effective_uid() {
  printf '%s\n' "${EUID}"
}

release_publication_controller_diesel_gid() {
  /usr/bin/id -g diesel
}

# Keep every shell that waits for another controller layer alive long enough to
# receive that layer's strict commit-boundary classification. Exact success or
# preserve status wins over a concurrently observed operator signal; otherwise
# the recorded signal-shaped status is returned to the caller.
release_publication_controller_run_supervised() {
  local previous_hup
  local previous_int
  local previous_term
  local child_status
  local RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS=0

  previous_hup="$(trap -p HUP)"
  previous_int="$(trap -p INT)"
  previous_term="$(trap -p TERM)"
  trap 'RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS=129' HUP
  trap 'RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS=130' INT
  trap 'RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS=143' TERM

  if "$@"; then
    child_status=0
  else
    child_status=$?
  fi

  trap - HUP INT TERM
  if [[ -n "${previous_hup}" ]]; then eval "${previous_hup}"; fi
  if [[ -n "${previous_int}" ]]; then eval "${previous_int}"; fi
  if [[ -n "${previous_term}" ]]; then eval "${previous_term}"; fi

  case "${child_status}" in
    0 | "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}")
      return "${child_status}"
      ;;
  esac
  if [[ "${RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS}" -ne 0 ]]; then
    return "${RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS}"
  fi
  return "${child_status}"
}

release_publication_controller_staged_metadata_is_allowed() {
  local path_type="$1"
  local executable_policy="$2"
  local owner="$3"
  local group="$4"
  local mode="$5"
  local link_count="$6"
  local diesel_gid="$7"
  local metadata_key

  if [[ ! "${diesel_gid}" =~ ^[1-9][0-9]*$ ]] ||
    [[ ! "${link_count}" =~ ^[1-9][0-9]*$ ]]; then
    return 1
  fi
  metadata_key="${path_type}:${executable_policy}:${owner}:${group}:${mode}"
  case "${metadata_key}" in
    directory:no:0:0:755 | directory:no:0:"${diesel_gid}":750)
      return 0
      ;;
    file:yes:0:0:755 | file:yes:0:"${diesel_gid}":750 | \
      file:no:0:0:644 | file:no:0:"${diesel_gid}":640)
      [[ "${link_count}" == "1" ]]
      return
      ;;
    *) return 1 ;;
  esac
}

release_publication_controller_require_trusted_staged_path() {
  local path="$1"
  local path_type="$2"
  local executable_policy="$3"
  local diesel_gid="$4"
  local label="$5"
  local canonical_path
  local metadata
  local owner
  local group
  local mode
  local link_count

  case "${path_type}" in
    directory)
      if [[ ! -d "${path}" || -L "${path}" ]]; then
        release_publication_controller_fail \
          "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
          "${label} must be a real directory"
        return
      fi
      ;;
    file)
      if [[ ! -f "${path}" || -L "${path}" ]]; then
        release_publication_controller_fail \
          "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
          "${label} must be a regular non-symlink file"
        return
      fi
      ;;
    *)
      release_publication_controller_fail \
        "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}" \
        "staged path type must be file or directory"
      return
      ;;
  esac
  if ! canonical_path="$(/usr/bin/realpath -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]] ||
    ! metadata="$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${path}")"; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "${label} must be canonical and inspectable"
    return
  fi
  IFS=: read -r owner group mode link_count <<<"${metadata}"
  if ! release_publication_controller_staged_metadata_is_allowed \
    "${path_type}" "${executable_policy}" "${owner}" "${group}" \
    "${mode}" "${link_count}" "${diesel_gid}"; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "${label} is outside the exact staged or normalized metadata states"
    return
  fi
}

release_publication_controller_return_precommit_status() {
  local status="$1"

  case "${status}" in
    129 | 130 | 137 | 143) return "${status}" ;;
    *) return "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" ;;
  esac
}

release_publication_controller_is_signal_status() {
  case "$1" in
    129 | 130 | 137 | 143) return 0 ;;
    *) return 1 ;;
  esac
}

release_publication_controller_return_classified_status() {
  local ledger_state="$1"
  local phase_status="$2"

  case "${ledger_state}" in
    PENDING:PUBLISH_COMMITTED | PENDING:PUBLISH_FINALIZED | \
      COMMITTED:PUBLISH_FINALIZED)
      return "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"
      ;;
    PENDING:none)
      release_publication_controller_return_precommit_status "${phase_status}"
      return
      ;;
    *) return "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" ;;
  esac
}

release_publication_controller_run_classified_preflight() {
  local ledger_state="$1"
  local phase_status
  shift

  if "$@"; then
    return 0
  else
    phase_status=$?
  fi
  release_publication_controller_return_classified_status \
    "${ledger_state}" "${phase_status}"
}

# Dependency seam: print exactly HOST_STATE:GOVERNANCE_STATE after a strict,
# lock-protected parse. Tests may replace this function after sourcing.
release_publication_controller_read_strict_state() {
  local release_id="$1"

  host_activation_ledger_require_lifecycle_lock \
    "${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}" || return $?
  host_activation_ledger_scan_all \
    "${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}" \
    "${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}" \
    allow-active "${release_id}" || return $?
  host_activation_ledger_validate_release_state \
    "${release_id}" "${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}" || return $?
  if [[ "${HOST_ACTIVATION_LEDGER_PROTOCOL}" != "v1" ]]; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "release publication requires the V1 host activation ledger"
    return
  fi
  printf '%s:%s\n' \
    "${HOST_ACTIVATION_LEDGER_STATE}" \
    "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}"
}

# Dependency seam: require the only state from which a fresh prepare attempt is
# legal. Keeping this separate lets orchestration tests model repeated strict
# reads without constructing a root-owned ledger fixture.
release_publication_controller_require_pending_state() {
  local release_id="$1"
  local state_status
  local strict_state

  if strict_state="$(
    release_publication_controller_read_strict_state "${release_id}"
  )"; then
    state_status=0
  else
    state_status=$?
  fi
  if [[ "${state_status}" -ne 0 ]]; then
    if release_publication_controller_is_signal_status "${state_status}"; then
      return "${state_status}"
    fi
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "release ledger could not be read before publication"
    return
  fi
  if [[ "${strict_state}" != "PENDING:none" ]]; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "release publication requires exact PENDING:none"
    return
  fi
}

# Dependency seam: prepare the immutable runtime while retaining the inherited
# lifecycle-lock OFD. The empty environment prevents Bash/Node startup hooks or
# service secrets from becoming controller inputs.
release_publication_controller_run_prepare() {
  local release_id="$1"

  if release_publication_controller_sourced_production_root_is_selected \
    "${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}"; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}" \
      "runtime preparation child cannot target production from a sourced controller"
    return
  fi
  local release_dir="${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}/releases/${release_id}"
  local -a clean_environment=(
    HOME=/root
    LANG=C
    LC_ALL=C
    PATH="${RELEASE_PUBLICATION_CONTROLLER_ROOT_PATH}"
    DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
  )
  if [[ -n "${PNPM_REGISTRY:-}" ]]; then
    clean_environment+=("PNPM_REGISTRY=${PNPM_REGISTRY}")
  fi

  /usr/bin/env -i "${clean_environment[@]}" \
    /bin/bash --noprofile --norc -- \
    "${release_dir}/scripts/deploy/prepare-release-runtime.sh" \
    "${release_id}"
}

# Dependency seam: perform the clean host activation child boundary. FD 8 is
# deliberately retained; this controller never closes, unlocks, or replaces it.
release_publication_controller_run_activate() {
  local release_id="$1"

  if release_publication_controller_sourced_production_root_is_selected \
    "${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}"; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}" \
      "host activation child cannot target production from a sourced controller"
    return
  fi
  local release_dir="${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}/releases/${release_id}"

  /usr/bin/env -i \
    HOME=/root \
    LANG=C \
    LC_ALL=C \
    PATH="${RELEASE_PUBLICATION_CONTROLLER_ROOT_PATH}" \
    DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8 \
    /bin/bash --noprofile --norc -- \
    "${release_dir}/scripts/deploy/activate-host-release.sh" \
    "${release_id}"
}

# Dependency seam: activation success is not trusted until current and the
# still-pre-publication ledger are both re-read under the lifecycle lock.
release_publication_controller_require_current() {
  local release_id="$1"
  local release_dir="${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}/releases/${release_id}"
  local current_link="${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}/current"
  local current_release
  local expected_link_metadata="root:root:1:${#release_dir}"
  local link_metadata_before
  local link_metadata_after
  local raw_target_before
  local raw_target_after

  host_activation_ledger_require_pending \
    "${release_id}" \
    "${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}" \
    "${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}" || return $?
  if [[ ! -L "${current_link}" ]] ||
    ! raw_target_before="$(/usr/bin/readlink -- "${current_link}")" ||
    ! link_metadata_before="$(
      /usr/bin/stat -c '%U:%G:%h:%s' -- "${current_link}"
    )" ||
    ! current_release="$(/usr/bin/realpath -- "${current_link}")" ||
    ! raw_target_after="$(/usr/bin/readlink -- "${current_link}")" ||
    ! link_metadata_after="$(
      /usr/bin/stat -c '%U:%G:%h:%s' -- "${current_link}"
    )" ||
    [[ "${raw_target_before}" != "${release_dir}" ]] ||
    [[ "${raw_target_after}" != "${release_dir}" ]] ||
    [[ "${link_metadata_before}" != "${expected_link_metadata}" ]] ||
    [[ "${link_metadata_after}" != "${expected_link_metadata}" ]] ||
    [[ "${current_release}" != "${release_dir}" ]]; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "current does not point to the activated target release"
    return
  fi
  host_activation_ledger_require_pending \
    "${release_id}" \
    "${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}" \
    "${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}"
}

# Dependency seam: every governance mode remains the direct child of the
# maintenance-lock wrapper. No intermediate shell constructs the command.
release_publication_controller_run_governance_mode() (
  set -uo pipefail

  if [[ "$#" -ne 2 ]]; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}" \
      "governance controller dependency requires mode and release ID"
    return
  fi
  local mode="$1"
  local release_id="$2"

  if release_publication_controller_sourced_production_root_is_selected \
    "${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}"; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}" \
      "governance child cannot target production from a sourced controller"
    return
  fi
  local release_dir="${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}/releases/${release_id}"
  local database_environment="${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}/backups/${release_id}/env.production.local.pre-switch"

  case "${mode}" in
    publish | finalize-committed) ;;
    *)
      release_publication_controller_fail \
        "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}" \
        "governance controller mode must be publish or finalize-committed"
      return
      ;;
  esac

  cd -- "${release_dir}" || return $?
  /usr/bin/env -i \
    HOME=/root \
    PATH="${RELEASE_PUBLICATION_CONTROLLER_ROOT_PATH}" \
    NODE_ENV=production \
    DATABASE_MODE=postgres \
    DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8 \
    release_id="${release_id}" \
    "${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}" --import tsx \
    "${release_dir}/scripts/db/with-governance-maintenance-lock.ts" \
    --database-env-file="${database_environment}" -- \
    /bin/bash --noprofile --norc -- \
    "${release_dir}/scripts/deploy/governance-publication-state-machine.sh" \
    "${mode}" "${release_id}"
)

release_publication_controller_finalize_and_require_terminal() {
  local release_id="$1"
  local entry_state="$2"
  local finalize_status
  local state_status
  local strict_state

  if release_publication_controller_run_governance_mode \
    finalize-committed "${release_id}"; then
    finalize_status=0
  else
    finalize_status=$?
  fi
  if strict_state="$(
    release_publication_controller_read_strict_state "${release_id}"
  )"; then
    state_status=0
  else
    state_status=$?
  fi
  if [[ "${state_status}" -eq 0 &&
    "${strict_state}" == "COMMITTED:PUBLISH_FINALIZED" ]]; then
    case "${entry_state}" in
      PENDING:PUBLISH_COMMITTED | PENDING:PUBLISH_FINALIZED)
        # PENDING -> COMMITTED is written only after the fresh host/public/
        # current/lock validators. That durable transition may therefore win
        # over a child status produced after the final write.
        return 0
        ;;
      COMMITTED:PUBLISH_FINALIZED)
        # A pre-existing terminal marker cannot prove that this retry's live
        # validators passed; require the fresh finalize invocation itself to
        # return success as well as the terminal readback.
        if [[ "${finalize_status}" -eq 0 ]]; then
          return 0
        fi
        ;;
    esac
  fi
  release_publication_controller_fail \
    "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}" \
    "publication finalization did not reach an exact terminal ledger; preserving release state"
  return
}

release_publication_controller_reconcile_committed() (
  set -uo pipefail

  if [[ "$#" -ne 1 ]] ||
    ! release_publication_controller_is_commit "${1:-}"; then
    release_publication_controller_usage
    return "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}"
  fi
  local release_id="$1"
  local state_status
  local strict_state
  RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS=0
  trap 'RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS=129' HUP
  trap 'RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS=130' INT
  trap 'RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS=143' TERM

  if [[ "${RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS:-0}" -ne 0 ]]; then
    return "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"
  fi

  if strict_state="$(
    release_publication_controller_read_strict_state "${release_id}"
  )"; then
    state_status=0
  else
    state_status=$?
  fi
  if [[ "${state_status}" -ne 0 ]]; then
    return "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"
  fi
  case "${strict_state}" in
    PENDING:PUBLISH_COMMITTED | PENDING:PUBLISH_FINALIZED | \
      COMMITTED:PUBLISH_FINALIZED)
      if [[ "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}" -ne 0 ]]; then
        return "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"
      fi
      release_publication_controller_finalize_and_require_terminal \
        "${release_id}" "${strict_state}"
      return $?
      ;;
    *) return "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}" ;;
  esac
)

# Pure orchestration entry point. All filesystem, process, database, and state
# reads are delegated through the dependency functions above so tests can
# exercise the closed state table without a synthetic root filesystem.
release_publication_controller_reconcile() (
  set -uo pipefail

  if [[ "$#" -ne 1 ]] ||
    ! release_publication_controller_is_commit "${1:-}"; then
    release_publication_controller_usage
    return "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}"
  fi
  local release_id="$1"
  local phase_status
  local state_status
  local strict_state
  RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS=0
  trap 'RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS=129' HUP
  trap 'RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS=130' INT
  trap 'RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS=143' TERM

  if [[ "${RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS:-0}" -ne 0 ]]; then
    return "${RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS}"
  fi

  if release_publication_controller_require_pending_state "${release_id}"; then
    state_status=0
  else
    state_status=$?
  fi
  if [[ "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}" -ne 0 ]]; then
    return "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}"
  fi
  if [[ "${state_status}" -ne 0 ]]; then
    release_publication_controller_return_precommit_status "${state_status}"
    return $?
  fi

  if release_publication_controller_run_prepare "${release_id}"; then
    :
  else
    phase_status=$?
    if [[ "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}" -ne 0 ]]; then
      return "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}"
    fi
    release_publication_controller_return_precommit_status "${phase_status}"
    return $?
  fi
  if [[ "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}" -ne 0 ]]; then
    return "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}"
  fi

  if release_publication_controller_require_pending_state "${release_id}"; then
    state_status=0
  else
    state_status=$?
  fi
  if [[ "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}" -ne 0 ]]; then
    return "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}"
  fi
  if [[ "${state_status}" -ne 0 ]]; then
    release_publication_controller_return_precommit_status "${state_status}"
    return $?
  fi

  if release_publication_controller_run_activate "${release_id}"; then
    :
  else
    phase_status=$?
    if [[ "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}" -ne 0 ]]; then
      return "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}"
    fi
    release_publication_controller_return_precommit_status "${phase_status}"
    return $?
  fi
  if [[ "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}" -ne 0 ]]; then
    return "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}"
  fi

  if release_publication_controller_require_current "${release_id}"; then
    :
  else
    phase_status=$?
    if [[ "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}" -ne 0 ]]; then
      return "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}"
    fi
    release_publication_controller_return_precommit_status "${phase_status}"
    return $?
  fi
  if [[ "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}" -ne 0 ]]; then
    return "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}"
  fi

  if release_publication_controller_run_governance_mode \
    publish "${release_id}"; then
    phase_status=0
  else
    phase_status=$?
  fi

  # Once publish has been invoked, inability to classify the strict ledger is
  # not evidence that rollback is safe. Status 75 instructs the parent trap to
  # preserve the host/database state for forward repair or operator review.
  if strict_state="$(
    release_publication_controller_read_strict_state "${release_id}"
  )"; then
    state_status=0
  else
    state_status=$?
  fi
  if [[ "${state_status}" -ne 0 ]]; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}" \
      "publication ledger could not be classified after publish; preserving release state"
    return
  fi

  case "${strict_state}" in
    PENDING:PUBLISH_COMMITTED | PENDING:PUBLISH_FINALIZED | \
      COMMITTED:PUBLISH_FINALIZED)
      if [[ "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}" -ne 0 ]] ||
        release_publication_controller_is_signal_status "${phase_status}"; then
        return "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"
      fi
      release_publication_controller_finalize_and_require_terminal \
        "${release_id}" "${strict_state}"
      return $?
      ;;
    PENDING:none | PENDING:RECOVERY_REQUIRED | \
      PENDING:HOST_ROLLBACK_REQUIRED | \
      ROLLED_BACK:HOST_ROLLBACK_REQUIRED | ROLLED_BACK:none | \
      ROLLED_BACK:HOST_ROLLBACK_COMPLETED)
      if [[ "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}" -ne 0 ]]; then
        return "${RELEASE_PUBLICATION_CONTROLLER_SIGNAL_STATUS}"
      fi
      if [[ "${phase_status}" -eq 0 ]]; then
        release_publication_controller_fail \
          "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
          "governance publish returned success without a commit-shaped ledger"
        return
      fi
      release_publication_controller_return_precommit_status "${phase_status}"
      return $?
      ;;
    *)
      release_publication_controller_fail \
        "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}" \
        "publication ledger is unknown after publish; preserving release state"
      return
      ;;
  esac
)

release_publication_controller_impl() {
  if [[ "$#" -ne 1 ]] ||
    ! release_publication_controller_is_commit "${1:-}"; then
    release_publication_controller_usage
    return "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}"
  fi
  local release_id="$1"
  local deploy_root="${RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT}"
  local release_dir="${deploy_root}/releases/${release_id}"
  local state_dir="${deploy_root}/backups/${release_id}"
  local diesel_gid
  local effective_uid
  local ledger_state
  local phase_status

  if release_publication_controller_sourced_production_root_is_selected \
    "${deploy_root}"; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}" \
      "production release publication is unavailable from a sourced shell"
    return
  fi
  effective_uid="$(release_publication_controller_effective_uid)"
  if [[ "${effective_uid}" != "0" ]]; then
    release_publication_controller_fail 77 \
      "release publication controller must run as root"
    return
  fi
  if [[ "${DIESEL_RELEASE_LIFECYCLE_LOCK_FD:-}" != "8" ]] ||
    ! { true <&8; } 2>/dev/null; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}" \
      "release publication controller requires inherited lifecycle lock descriptor 8"
    return
  fi
  # Until a strict ledger read proves PENDING:none, no bootstrap failure is
  # evidence that rollback is safe: this invocation may be a committed retry.
  if ! release_publication_controller_require_fixed_node_runtime ||
    ! release_publication_controller_require_trusted_host_executable \
      /usr/bin/env "fixed environment launcher" ||
    ! release_publication_controller_require_trusted_host_executable \
      /bin/bash "fixed Bash launcher" ||
    ! release_publication_controller_require_fixed_host_commands; then
    return "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"
  fi
  if ledger_state="$(
    release_publication_controller_read_strict_state "${release_id}"
  )"; then
    :
  else
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}" \
      "release publication entry could not be classified strictly; preserving release state"
    return
  fi
  case "${ledger_state}" in
    PENDING:none | PENDING:PUBLISH_COMMITTED | PENDING:PUBLISH_FINALIZED | \
      COMMITTED:PUBLISH_FINALIZED) ;;
    *)
      release_publication_controller_fail \
        "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
        "release ledger is not eligible for publication reconciliation"
      return
      ;;
  esac
  if [[ "${RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS:-0}" -ne 0 ]]; then
    case "${ledger_state}" in
      PENDING:none)
        return "${RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS}"
        ;;
      *) return "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}" ;;
    esac
  fi

  if ! diesel_gid="$(release_publication_controller_diesel_gid)" ||
    [[ ! "${diesel_gid}" =~ ^[1-9][0-9]*$ ]]; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}" \
      "diesel group identity is unavailable"
    release_publication_controller_return_classified_status \
      "${ledger_state}" "${RELEASE_PUBLICATION_CONTROLLER_FAILURE_STATUS}"
    return $?
  fi

  release_publication_controller_run_classified_preflight \
    "${ledger_state}" host_activation_ledger_require_directory \
    "${deploy_root}" "root:root:755" "deployment root" || return $?
  release_publication_controller_run_classified_preflight \
    "${ledger_state}" host_activation_ledger_require_directory \
    "${deploy_root}/releases" "root:root:755" "release root" || return $?
  release_publication_controller_run_classified_preflight \
    "${ledger_state}" host_activation_ledger_require_directory \
    "${release_dir}" "root:diesel:750" "target release" || return $?
  release_publication_controller_run_classified_preflight \
    "${ledger_state}" \
    release_publication_controller_require_trusted_staged_path \
    "${release_dir}/scripts" directory no "${diesel_gid}" \
    "target release scripts directory" || return $?
  release_publication_controller_run_classified_preflight \
    "${ledger_state}" \
    release_publication_controller_require_trusted_staged_path \
    "${release_dir}/scripts/deploy" directory no "${diesel_gid}" \
    "target release deployment scripts directory" || return $?
  release_publication_controller_run_classified_preflight \
    "${ledger_state}" \
    release_publication_controller_require_trusted_staged_path \
    "${release_dir}/scripts/db" directory no "${diesel_gid}" \
    "target release database scripts directory" || return $?
  release_publication_controller_run_classified_preflight \
    "${ledger_state}" host_activation_ledger_require_directory \
    "${state_dir}" "root:root:700" "release state directory" || return $?

  local required_executable
  for required_executable in \
    "${release_dir}/scripts/deploy/release-publication-controller.sh" \
    "${release_dir}/scripts/deploy/prepare-release-runtime.sh" \
    "${release_dir}/scripts/deploy/activate-host-release.sh" \
    "${release_dir}/scripts/deploy/rollback-host-release.sh" \
    "${release_dir}/scripts/deploy/governance-publication-state-machine.sh" \
    "${release_dir}/scripts/deploy/host-activation-ledger.sh"; do
    release_publication_controller_run_classified_preflight \
      "${ledger_state}" \
      release_publication_controller_require_trusted_staged_path \
      "${required_executable}" file yes "${diesel_gid}" \
      "versioned release publication executable" || return $?
  done
  release_publication_controller_run_classified_preflight \
    "${ledger_state}" \
    release_publication_controller_require_trusted_staged_path \
    "${release_dir}/scripts/db/with-governance-maintenance-lock.ts" \
    file no "${diesel_gid}" \
    "versioned governance maintenance wrapper" || return $?
  release_publication_controller_run_classified_preflight \
    "${ledger_state}" host_activation_ledger_require_file \
    "${state_dir}/env.production.local.pre-switch" \
    "root:root:600" "pre-switch governance environment" || return $?

  if [[ "${RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS:-0}" -ne 0 ]]; then
    case "${ledger_state}" in
      PENDING:PUBLISH_COMMITTED | PENDING:PUBLISH_FINALIZED | \
        COMMITTED:PUBLISH_FINALIZED)
        return "${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"
        ;;
      *)
        return "${RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS}"
        ;;
    esac
  fi
  case "${ledger_state}" in
    PENDING:none)
      release_publication_controller_run_classified_preflight \
        "${ledger_state}" host_activation_ledger_require_pending \
        "${release_id}" "${deploy_root}" \
        "${RELEASE_PUBLICATION_CONTROLLER_NODE_BINARY}" || return $?
      if [[ "${RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS:-0}" -ne 0 ]]; then
        return "${RELEASE_PUBLICATION_CONTROLLER_SUPERVISOR_SIGNAL_STATUS}"
      fi
      ;;
    PENDING:PUBLISH_COMMITTED | PENDING:PUBLISH_FINALIZED | \
      COMMITTED:PUBLISH_FINALIZED)
      if release_publication_controller_reconcile_committed "${release_id}"; then
        return 0
      else
        phase_status=$?
      fi
      release_publication_controller_return_classified_status \
        "${ledger_state}" "${phase_status}"
      return $?
      ;;
  esac

  release_publication_controller_reconcile "${release_id}"
}

release_publication_controller() (
  set -uo pipefail

  release_publication_controller_run_supervised \
    release_publication_controller_impl "$@"
)

release_publication_controller_run_main() {
  if [[ "$#" -ne 1 ]]; then
    release_publication_controller_usage
    return "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}"
  fi
  release_publication_controller_run_supervised \
    release_publication_controller "$1"
}

release_publication_controller_main() {
  if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
    release_publication_controller_fail \
      "${RELEASE_PUBLICATION_CONTROLLER_USAGE_STATUS}" \
      "production release publication main is unavailable when sourced"
    return
  fi
  release_publication_controller_run_main "$@"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  release_publication_controller_main "$@"
fi
