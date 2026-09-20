#!/bin/bash

# This file is intentionally sourceable so the activation sequence can be
# exercised against an isolated host fixture. The CLI entry point accepts only
# a release commit and always supplies the production paths below.

activate_host_release_cli_bootstrap_metadata_is_allowed() {
  local profile="$1"
  local metadata="$2"

  case "${profile}:${metadata}" in
    system-directory:root:root:755 | \
      release-directory:root:diesel:750 | \
      release-executable:root:diesel:750:1) return 0 ;;
    *) return 1 ;;
  esac
}

activate_host_release_require_cli_bootstrap_path() {
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
  activate_host_release_cli_bootstrap_metadata_is_allowed \
    "${profile}" "${metadata}"
}

activate_host_release_sourced_production_root_is_selected() {
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

activate_host_release_cli_bootstrap() {
  if [[ "$#" -ne 3 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
    return 64
  fi
  local release_id="$1"
  local deploy_root="$2"
  local observed_entry="$3"

  if activate_host_release_sourced_production_root_is_selected \
    "${deploy_root}"; then
    return 64
  fi
  local expected_release="${deploy_root}/releases/${release_id}"
  local expected_entry="${expected_release}/scripts/deploy/activate-host-release.sh"
  local expected_rollback="${expected_release}/scripts/deploy/rollback-host-release.sh"
  local expected_ledger="${expected_release}/scripts/deploy/host-activation-ledger.sh"

  if [[ "${observed_entry}" != "${expected_entry}" ]]; then
    return 70
  fi
  if ! activate_host_release_require_cli_bootstrap_path /opt system-directory ||
    ! activate_host_release_require_cli_bootstrap_path \
      "${deploy_root}" system-directory ||
    ! activate_host_release_require_cli_bootstrap_path \
      "${deploy_root}/releases" system-directory ||
    ! activate_host_release_require_cli_bootstrap_path \
      "${expected_release}" release-directory ||
    ! activate_host_release_require_cli_bootstrap_path \
      "${expected_release}/scripts" release-directory ||
    ! activate_host_release_require_cli_bootstrap_path \
      "${expected_release}/scripts/deploy" release-directory ||
    ! activate_host_release_require_cli_bootstrap_path \
      "${expected_entry}" release-executable ||
    ! activate_host_release_require_cli_bootstrap_path \
      "${expected_rollback}" release-executable ||
    ! activate_host_release_require_cli_bootstrap_path \
      "${expected_ledger}" release-executable; then
    return 70
  fi
  export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
  source -- "${expected_rollback}" || return 70
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
    echo "usage: activate-host-release.sh <40-character-lowercase-git-sha>" >&2
    exit 64
  fi
  if activate_host_release_cli_bootstrap \
    "$1" "/opt/diesel" "${BASH_SOURCE[0]}"; then
    :
  else
    activate_host_release_bootstrap_status=$?
    echo "host activation pre-source trust validation failed" >&2
    exit "${activate_host_release_bootstrap_status}"
  fi
  unset activate_host_release_bootstrap_status
else
  activate_host_release_script_directory="${BASH_SOURCE[0]%/*}"
  if [[ "${activate_host_release_script_directory}" == "${BASH_SOURCE[0]}" ]]; then
    activate_host_release_script_directory='.'
  fi
  if source -- \
    "${activate_host_release_script_directory}/rollback-host-release.sh"; then
    unset activate_host_release_script_directory
  else
    activate_host_release_source_status=$?
    unset activate_host_release_script_directory
    return "${activate_host_release_source_status}"
  fi
fi

activate_host_release_usage() {
  echo "usage: activate-host-release.sh <40-character-lowercase-git-sha>" >&2
}

activate_host_release_fail() {
  local status="$1"
  shift
  echo "$*" >&2
  return "${status}"
}

activate_host_release_require_cli_bootstrap_directory() {
  local path="$1"
  local canonical_path
  local metadata

  if [[ ! -d "${path}" || -L "${path}" ]] ||
    ! canonical_path="$(/usr/bin/realpath -e -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]] ||
    ! metadata="$(/usr/bin/stat -c '%u:%g:%a' -- "${path}")" ||
    [[ "${metadata}" != "0:0:755" ]]; then
    activate_host_release_fail 70 \
      "fixed command directory is outside the root bootstrap profile: ${path}"
    return
  fi
}

activate_host_release_require_cli_bootstrap_executable() {
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
    activate_host_release_fail 70 "${label} is not a trusted host executable"
    return
  fi
  IFS=: read -r owner group mode link_count <<<"${metadata}"
  if [[ "${owner}" != "0" || "${group}" != "0" ||
    "${link_count}" != "1" || ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    activate_host_release_fail 70 "${label} has unsafe host metadata"
    return
  fi
  permissions=$((8#${mode}))
  if (( (permissions & 07000) != 0 || (permissions & 0022) != 0 ||
    (permissions & 0100) == 0 )); then
    activate_host_release_fail 70 \
      "${label} is writable outside root, has special bits, or is not root-executable"
    return
  fi
}

activate_host_release_cli_runtime_metadata_is_trusted() {
  local object_type="$1"
  local owner="$2"
  local group="$3"
  local mode="$4"
  local link_count="$5"

  case "${object_type}:${owner}:${group}:${mode}:${link_count}" in
    directory:0:0:755:* | executable:0:0:755:1) return 0 ;;
    *) return 1 ;;
  esac
}

activate_host_release_require_cli_canonical_executable_chain() {
  local path="$1"
  local label="$2"
  local cursor=""
  local metadata
  local owner
  local group
  local mode
  local link_count
  local segment
  local -a segments

  if [[ "${path}" != /* || "${path}" == "/" || -L "${path}" ]] ||
    [[ "$(/usr/bin/realpath -e -- "${path}" 2>/dev/null)" != "${path}" ]]; then
    activate_host_release_fail 70 "${label} must be a canonical executable"
    return
  fi
  IFS=/ read -r -a segments <<<"${path#/}"
  for segment in "${segments[@]}"; do
    if [[ -z "${segment}" || "${segment}" == "." || "${segment}" == ".." ]]; then
      activate_host_release_fail 70 "${label} has an unsafe path"
      return
    fi
    cursor="${cursor}/${segment}"
    if [[ -L "${cursor}" ]] ||
      ! metadata="$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${cursor}")"; then
      activate_host_release_fail 70 "${label} traverses an untrusted path"
      return
    fi
    IFS=: read -r owner group mode link_count <<<"${metadata}"
    if [[ ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
      activate_host_release_fail 70 "${label} has unsafe path metadata"
      return
    fi
    if [[ "${cursor}" == "${path}" ]]; then
      if [[ ! -f "${cursor}" || ! -x "${cursor}" ]] ||
        ! activate_host_release_cli_runtime_metadata_is_trusted \
          executable "${owner}" "${group}" "${mode}" "${link_count}"; then
        activate_host_release_fail 70 "${label} is not the trusted executable inode"
        return
      fi
    elif [[ ! -d "${cursor}" ]] ||
      ! activate_host_release_cli_runtime_metadata_is_trusted \
        directory "${owner}" "${group}" "${mode}" "${link_count}"; then
      activate_host_release_fail 70 "${label} has an untrusted parent directory"
      return
    fi
  done
}

activate_host_release_is_commit() {
  local release_id="$1"

  [[ "${release_id}" =~ ^[0-9a-f]{40}$ ]]
}

activate_host_release() (
  set -Eeuo pipefail

  if [[ "$#" -ne 9 && "$#" -ne 12 ]]; then
    activate_host_release_fail 64 \
      "internal host activation requires nine fixed arguments"
    return
  fi
  if [[ "$#" -eq 12 && "${BASH_SOURCE[0]}" == "$0" ]]; then
    activate_host_release_fail 64 \
      "host activation test seams are unavailable from the CLI"
    return
  fi
  if [[ "$#" -eq 9 && "${BASH_SOURCE[0]}" != "$0" ]]; then
    activate_host_release_fail 64 \
      "production host activation is unavailable from a sourced shell"
    return
  fi
  if [[ "$#" -eq 12 ]] &&
    activate_host_release_sourced_production_root_is_selected "$2"; then
    activate_host_release_fail 64 \
      "host activation test seam cannot target the production deployment root"
    return
  fi

  local release_id="$1"
  local deploy_root="$2"
  local nginx_sites_root="$3"
  local fixed_vps_path="$4"
  local node_binary="$5"
  local proc_root="$6"
  local expected_pm2_state_root="$7"
  local expected_pm2_exec="$8"
  local expected_unit_fragment="$9"
  local expected_daemon_uid=0
  local expected_daemon_gid=0
  local approved_additional_unit_paths=""
  if [[ "$#" -eq 12 ]]; then
    expected_daemon_uid="${10}"
    expected_daemon_gid="${11}"
    approved_additional_unit_paths="${12}"
  fi

  local releases_root="${deploy_root}/releases"
  local backups_root="${deploy_root}/backups"
  local release_dir="${releases_root}/${release_id}"
  local deployment_state_dir="${backups_root}/${release_id}"
  local shared_root="${deploy_root}/shared"
  local environment_path="${shared_root}/.env.production.local"
  local current_link="${deploy_root}/current"
  local nginx_primary_source="${release_dir}/deploy/nginx/jamesky.site.conf"
  local nginx_alternate_source="${release_dir}/deploy/nginx/diesel-demo.conf"
  local nginx_primary_path="${nginx_sites_root}/jamesky.site"
  local nginx_alternate_path="${nginx_sites_root}/diesel-demo"
  local ecosystem_path="${release_dir}/deploy/ecosystem.config.cjs"
  local current_ecosystem_path="${current_link}/deploy/ecosystem.config.cjs"
  local artifact_manifest="${release_dir}/scripts/deploy/release-artifact-manifest.mjs"
  local pm2_state_helper="${release_dir}/scripts/deploy/persist-pm2-release-state.mjs"
  local readiness_response_validator="${release_dir}/scripts/deploy/readiness-response-contract.cjs"
  local activation_script="${release_dir}/scripts/deploy/activate-host-release.sh"
  local runtime_uid
  local runtime_gid
  local production_entry=0
  local root_child_path="${fixed_vps_path}"
  local pm2_launcher
  local bootstrap_directory
  local command_name
  local command_spec
  local expected_command_path
  local resolved_command_path
  local systemctl_command=systemctl
  local -a pm2_command=(pm2)
  # EXIT traps run after Bash unwinds function-local variables. Keep every
  # cleanup path and validator input in this function's subshell scope so an
  # interrupted atomic install cannot strand an active-looking candidate.
  activate_host_release_current_next="${deploy_root}/current.next"
  activate_host_release_target_release="${release_dir}"
  activate_host_release_nginx_primary_stage="${nginx_sites_root}/.jamesky.site.activate"
  activate_host_release_nginx_alternate_stage="${nginx_sites_root}/.diesel-demo.activate"
  activate_host_release_cleanup_node="${node_binary}"
  activate_host_release_cleanup_deploy_root="${deploy_root}"
  activate_host_release_cleanup_nginx_root="${nginx_sites_root}"
  activate_host_release_cleanup_state_dir="${deployment_state_dir}"
  activate_host_release_readiness_headers=""

  if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    production_entry=1
    export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
    root_child_path="/usr/sbin:/usr/bin:/sbin:/bin"
    pm2_launcher="${node_binary%/*}/pm2"
    pm2_command=("${node_binary}" "${expected_pm2_exec}")
    systemctl_command=/usr/bin/systemctl
    for bootstrap_directory in \
      /opt "${node_binary%/bin/node}" "${node_binary%/node}" \
      /usr /usr/bin /usr/sbin /usr/local /usr/local/sbin /usr/local/bin; do
      activate_host_release_require_cli_bootstrap_directory \
        "${bootstrap_directory}" || return $?
    done
  else
    export PATH="${fixed_vps_path}"
  fi

  if ! activate_host_release_is_commit "${release_id}"; then
    activate_host_release_usage
    return 64
  fi
  if [[ "${production_entry}" -eq 1 ]]; then
    if [[ "${EUID}" -ne 0 ]]; then
      activate_host_release_fail 77 "host activation must run as root"
      return
    fi
  elif [[ "$(id -u)" -ne 0 ]]; then
    activate_host_release_fail 77 "host activation must run as root"
    return
  fi
  if [[ "${DIESEL_RELEASE_LIFECYCLE_LOCK_FD:-}" != 8 ]] ||
    ! { true <&8; } 2>/dev/null; then
    activate_host_release_fail 70 \
      "host activation requires inherited lifecycle lock descriptor 8"
    return
  fi
  if [[ "${production_entry}" -eq 1 ]]; then
    for command_spec in \
      cmp:/usr/bin/cmp cp:/usr/bin/cp curl:/usr/bin/curl \
      env:/usr/bin/env find:/usr/bin/find flock:/usr/bin/flock \
      id:/usr/bin/id install:/usr/bin/install ln:/usr/bin/ln \
      mktemp:/usr/bin/mktemp mv:/usr/bin/mv nginx:/usr/sbin/nginx ps:/usr/bin/ps \
      readlink:/usr/bin/readlink realpath:/usr/bin/realpath \
      rm:/usr/bin/rm sha256sum:/usr/bin/sha256sum sort:/usr/bin/sort \
      stat:/usr/bin/stat systemctl:/usr/bin/systemctl \
      systemd-analyze:/usr/bin/systemd-analyze tr:/usr/bin/tr; do
      command_name="${command_spec%%:*}"
      expected_command_path="${command_spec#*:}"
      resolved_command_path="$(command -v "${command_name}")"
      if [[ "${resolved_command_path}" != "${expected_command_path}" ]]; then
        activate_host_release_fail 70 \
          "host activation command is outside the fixed system profile: ${command_name}"
        return
      fi
      activate_host_release_require_cli_bootstrap_executable \
        "${expected_command_path}" "fixed host command ${command_name}" || return $?
    done
  else
    for command_name in \
      cmp cp curl env find flock id install ln mktemp mv nginx ps readlink \
      realpath rm sha256sum sort stat systemctl systemd-analyze tr; do
      if ! command -v "${command_name}" >/dev/null 2>&1; then
        activate_host_release_fail 70 \
          "required host activation command is unavailable: ${command_name}"
        return
      fi
    done
  fi
  if [[ ! -f "${node_binary}" || -L "${node_binary}" ||
    ! -x "${node_binary}" ]]; then
    activate_host_release_fail 70 \
      "fixed Node.js binary is missing, symlinked, or not executable"
    return
  fi
  if [[ "${production_entry}" -eq 1 ]]; then
    if [[ "${node_binary}" != "/opt/node-v22.22.3-linux-x64/bin/node" ]] ||
      [[ "$(/usr/bin/realpath -e -- "${node_binary}")" != "${node_binary}" ]] ||
      [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${node_binary}")" != \
        "0:0:755:1" ]] ||
      [[ "$("${node_binary}" --version)" != "v22.22.3" ]] ||
      [[ ! -L "${pm2_launcher}" ]] ||
      [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${pm2_launcher}")" != \
        "0:0:777:1" ]] ||
      [[ "$(/usr/bin/readlink -- "${pm2_launcher}")" != \
        "../lib/node_modules/pm2/bin/pm2" ]] ||
      [[ "$(/usr/bin/realpath -e -- "${pm2_launcher}")" != \
        "${expected_pm2_exec}" ]]; then
      activate_host_release_fail 70 \
        "fixed Node.js and PM2 launchers are outside the host profile"
      return
    fi
    activate_host_release_require_cli_canonical_executable_chain \
      "${expected_pm2_exec}" "fixed PM2 executable" || return $?
    if [[ "$(PATH="${fixed_vps_path}" command -v pm2)" != \
      "${pm2_launcher}" ]] ||
      [[ "$(PATH="${fixed_vps_path}" command -v systemctl)" != \
        "/usr/bin/systemctl" ]] ||
      [[ "$(PATH="${fixed_vps_path}" command -v systemd-analyze)" != \
        "/usr/bin/systemd-analyze" ]]; then
      activate_host_release_fail 70 \
        "clean activation children do not resolve to the validated command profile"
      return
    fi
  elif ! command -v pm2 >/dev/null 2>&1; then
    activate_host_release_fail 70 "required host activation command is unavailable: pm2"
    return
  fi
  if [[ ! "${expected_daemon_uid}" =~ ^(0|[1-9][0-9]{0,9})$ ]] ||
    [[ ! "${expected_daemon_gid}" =~ ^(0|[1-9][0-9]{0,9})$ ]] ||
    [[ "${expected_daemon_uid}" -gt 4294967294 ]] ||
    [[ "${expected_daemon_gid}" -gt 4294967294 ]]; then
    activate_host_release_fail 70 "invalid PM2 daemon identity boundary"
    return
  fi

  rollback_require_directory "${deploy_root}" "root:root:755" \
    "deployment root"
  rollback_require_directory "${releases_root}" "root:root:755" \
    "release root"
  rollback_require_directory "${backups_root}" "root:root:700" \
    "rollback state root"
  rollback_require_directory "${deployment_state_dir}" "root:root:700" \
    "release rollback state"
  host_activation_ledger_require_directory \
    "${nginx_sites_root}" "root:root:755" \
    "Nginx sites directory"
  rollback_require_directory "${shared_root}" "root:diesel:750" \
    "shared application directory"
  rollback_require_regular_file "${environment_path}" "root:diesel:640" \
    "shared runtime environment"
  rollback_require_trusted_release_path \
    "${release_dir}" directory no "target release directory"
  rollback_require_trusted_release_path \
    "${release_dir}/deploy" directory no "target release deploy directory"
  rollback_require_trusted_release_path \
    "${release_dir}/deploy/nginx" directory no \
    "target release Nginx directory"
  rollback_require_trusted_release_path \
    "${release_dir}/scripts" directory no "target release scripts directory"
  rollback_require_trusted_release_path \
    "${release_dir}/scripts/deploy" directory no \
    "target release deployment scripts directory"
  rollback_require_trusted_release_path \
    "${nginx_primary_source}" file no "target primary Nginx configuration"
  rollback_require_trusted_release_path \
    "${nginx_alternate_source}" file no \
    "target alternate Nginx configuration"
  rollback_require_trusted_release_path \
    "${ecosystem_path}" file no "target PM2 ecosystem definition"
  rollback_require_trusted_release_path \
    "${artifact_manifest}" file no "target release artifact validator"
  rollback_require_trusted_release_path \
    "${pm2_state_helper}" file no "target PM2 persistence helper"
  rollback_require_trusted_release_path \
    "${readiness_response_validator}" file no \
    "target readiness response validator"
  if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    rollback_require_trusted_release_path \
      "${activation_script}" file yes "target host activation entry"
    if [[ -L "${BASH_SOURCE[0]}" ]] ||
      [[ "$(realpath -- "${BASH_SOURCE[0]}")" != "${activation_script}" ]]; then
      activate_host_release_fail 70 \
        "host activation CLI must execute the target release entry"
      return
    fi
  fi

  # Unlike the rollback CLI, activation is never allowed to acquire a new
  # lifecycle lock. It must inherit the exact OFD held by the outer release
  # controller and prove that capability before every live-host phase.
  rollback_acquire_release_lifecycle_lock "${deploy_root}"
  host_activation_ledger_require_pending \
    "${release_id}" "${deploy_root}" "${node_binary}"

  if ! runtime_uid="$(id -u diesel)" ||
    ! runtime_gid="$(id -g diesel)" ||
    [[ ! "${runtime_uid}" =~ ^(0|[1-9][0-9]{0,9})$ ]] ||
    [[ ! "${runtime_gid}" =~ ^(0|[1-9][0-9]{0,9})$ ]] ||
    [[ "${runtime_uid}" -gt 4294967294 ]] ||
    [[ "${runtime_gid}" -gt 4294967294 ]] ||
    [[ "${runtime_uid}" -eq 0 ]]; then
    activate_host_release_fail 70 "invalid diesel runtime identity boundary"
    return
  fi

  # check-ready rehashes the complete immutable release closure. Runtime
  # preparation already proved that the intentionally edited live environment
  # retains the rollback database identity, so activation must not compare its
  # full bytes to the pre-switch backup. Re-prove the remaining live rollback
  # basis: current still names the persisted previous release and both Nginx
  # files still exactly match the ledger-bound backups.
  (
    cd "${release_dir}"
    env -i HOME=/root PATH="${root_child_path}" \
      "${node_binary}" "${artifact_manifest}" \
      check-ready "${release_id}" .build-complete .deploy-ready \
      0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}" >/dev/null 8>&-
  )
  host_activation_ledger_require_pending \
    "${release_id}" "${deploy_root}" "${node_binary}"
  rollback_require_directory "${shared_root}" "root:diesel:750" \
    "shared application directory"
  rollback_require_regular_file "${environment_path}" "root:diesel:640" \
    "shared runtime environment"
  host_activation_ledger_require_directory \
    "${nginx_sites_root}" "root:root:755" \
    "Nginx sites directory"
  host_activation_ledger_require_file \
    "${nginx_primary_path}" "root:root:644" \
    "live primary Nginx configuration"
  host_activation_ledger_require_file \
    "${nginx_alternate_path}" "root:root:644" \
    "live alternate Nginx configuration"
  if [[ ! -L "${current_link}" ]] ||
    [[ "$(realpath -- "${current_link}")" != \
      "${HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_PATH}" ]]; then
    activate_host_release_fail 70 \
      "current no longer matches the persisted previous release"
    return
  fi
  if ! cmp -s -- \
      "${HOST_ACTIVATION_LEDGER_NGINX_PRIMARY_BACKUP}" \
      "${nginx_primary_path}" ||
    ! cmp -s -- \
      "${HOST_ACTIVATION_LEDGER_NGINX_ALTERNATE_BACKUP}" \
      "${nginx_alternate_path}"; then
    activate_host_release_fail 70 \
      "live Nginx state no longer matches the rollback basis"
    return
  fi
  local stale_activation_object_removed=0
  local nginx_stage_path
  local nginx_stage_label
  if [[ -e "${activate_host_release_current_next}" ||
    -L "${activate_host_release_current_next}" ]]; then
    rollback_require_current_next_candidate \
      "${activate_host_release_current_next}" "${release_dir}" \
      "temporary current activation link"
    rm -f -- "${activate_host_release_current_next}" 8>&-
    stale_activation_object_removed=1
  fi
  for nginx_stage_path in \
    "${activate_host_release_nginx_primary_stage}" \
    "${activate_host_release_nginx_alternate_stage}"; do
    if [[ "${nginx_stage_path}" == \
      "${activate_host_release_nginx_primary_stage}" ]]; then
      nginx_stage_label="stale primary Nginx activation stage"
    else
      nginx_stage_label="stale alternate Nginx activation stage"
    fi
    if [[ -e "${nginx_stage_path}" || -L "${nginx_stage_path}" ]]; then
      host_activation_ledger_require_file \
        "${nginx_stage_path}" "root:root:644" "${nginx_stage_label}"
      rm -f -- "${nginx_stage_path}" 8>&-
      stale_activation_object_removed=1
    fi
  done
  if [[ "${stale_activation_object_removed}" -eq 1 ]]; then
    rollback_fsync_paths \
      "${node_binary}" "${deploy_root}" "${nginx_sites_root}" 8>&-
  fi
  if [[ -e "${activate_host_release_current_next}" ||
    -L "${activate_host_release_current_next}" ||
    -e "${activate_host_release_nginx_primary_stage}" ||
    -L "${activate_host_release_nginx_primary_stage}" ||
    -e "${activate_host_release_nginx_alternate_stage}" ||
    -L "${activate_host_release_nginx_alternate_stage}" ]]; then
    activate_host_release_fail 70 \
      "temporary activation objects could not be cleared"
    return
  fi

  activate_host_release_cleanup() {
    local original_status="$?"
    local cleanup_status=0
    local cleanup_removed=0
    local cleanup_stage_path
    local cleanup_stage_label

    trap - EXIT
    if [[ -e "${activate_host_release_current_next}" ||
      -L "${activate_host_release_current_next}" ]]; then
      if rollback_require_current_next_candidate \
          "${activate_host_release_current_next}" \
          "${activate_host_release_target_release}" \
          "temporary current activation link"; then
        if rm -f -- "${activate_host_release_current_next}" 8>&-; then
          cleanup_removed=1
        else
          cleanup_status=70
        fi
      else
        cleanup_status=70
      fi
    fi
    for cleanup_stage_path in \
      "${activate_host_release_nginx_primary_stage}" \
      "${activate_host_release_nginx_alternate_stage}"; do
      if [[ "${cleanup_stage_path}" == \
        "${activate_host_release_nginx_primary_stage}" ]]; then
        cleanup_stage_label="primary Nginx activation stage"
      else
        cleanup_stage_label="alternate Nginx activation stage"
      fi
      if [[ -e "${cleanup_stage_path}" || -L "${cleanup_stage_path}" ]]; then
        if host_activation_ledger_require_file \
            "${cleanup_stage_path}" "root:root:644" \
            "${cleanup_stage_label}" &&
          rm -f -- "${cleanup_stage_path}" 8>&-; then
          cleanup_removed=1
        else
          cleanup_status=70
        fi
      fi
    done
    if [[ -n "${activate_host_release_readiness_headers}" ]] &&
      [[ -e "${activate_host_release_readiness_headers}" ||
        -L "${activate_host_release_readiness_headers}" ]]; then
      case "${activate_host_release_readiness_headers}" in
        "${activate_host_release_cleanup_state_dir}/.readiness-headers."*) ;;
        *) cleanup_status=70 ;;
      esac
      if [[ "${cleanup_status}" -eq 0 ]] &&
        host_activation_ledger_require_file \
          "${activate_host_release_readiness_headers}" "root:root:600" \
          "temporary readiness response headers" &&
        rm -f -- "${activate_host_release_readiness_headers}" 8>&-; then
        cleanup_removed=1
        activate_host_release_readiness_headers=""
      else
        cleanup_status=70
      fi
    fi
    if [[ "${cleanup_removed}" -eq 1 ]] &&
      ! rollback_fsync_paths \
        "${activate_host_release_cleanup_node}" \
        "${activate_host_release_cleanup_deploy_root}" \
        "${activate_host_release_cleanup_nginx_root}" \
        "${activate_host_release_cleanup_state_dir}" 8>&-; then
      cleanup_status=70
    fi
    if [[ "${cleanup_status}" -ne 0 ]]; then
      echo "temporary activation object cleanup failed" >&2
      if [[ "${original_status}" -eq 0 ]]; then
        original_status=70
      fi
    fi
    exit "${original_status}"
  }
  trap activate_host_release_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP

  install -m 0644 -o root -g root -- \
    "${nginx_primary_source}" \
    "${activate_host_release_nginx_primary_stage}" 8>&-
  install -m 0644 -o root -g root -- \
    "${nginx_alternate_source}" \
    "${activate_host_release_nginx_alternate_stage}" 8>&-
  host_activation_ledger_require_file \
    "${activate_host_release_nginx_primary_stage}" "root:root:644" \
    "staged primary Nginx configuration"
  host_activation_ledger_require_file \
    "${activate_host_release_nginx_alternate_stage}" "root:root:644" \
    "staged alternate Nginx configuration"
  if ! cmp -s -- \
      "${nginx_primary_source}" \
      "${activate_host_release_nginx_primary_stage}" ||
    ! cmp -s -- \
      "${nginx_alternate_source}" \
      "${activate_host_release_nginx_alternate_stage}"; then
    activate_host_release_fail 70 \
      "staged Nginx configuration does not match the target release"
    return
  fi
  rollback_validate_nginx_backups \
    "${activate_host_release_nginx_primary_stage}" \
    "${activate_host_release_nginx_alternate_stage}" 8>&-

  # Revalidate the exact live inodes immediately before the first write. The
  # replacement itself is an atomic rename from the same root-owned directory,
  # so a hardlink can neither be overwritten in place nor carry candidate bytes
  # into an alias.
  host_activation_ledger_require_lifecycle_lock "${deploy_root}"
  host_activation_ledger_require_pending \
    "${release_id}" "${deploy_root}" "${node_binary}"
  host_activation_ledger_require_directory \
    "${nginx_sites_root}" "root:root:755" \
    "Nginx sites directory"
  host_activation_ledger_require_file \
    "${nginx_primary_path}" "root:root:644" \
    "live primary Nginx configuration"
  host_activation_ledger_require_file \
    "${nginx_alternate_path}" "root:root:644" \
    "live alternate Nginx configuration"
  if ! cmp -s -- \
      "${HOST_ACTIVATION_LEDGER_NGINX_PRIMARY_BACKUP}" \
      "${nginx_primary_path}" ||
    ! cmp -s -- \
      "${HOST_ACTIVATION_LEDGER_NGINX_ALTERNATE_BACKUP}" \
      "${nginx_alternate_path}"; then
    activate_host_release_fail 70 \
      "live Nginx state changed before atomic installation"
    return
  fi
  mv -Tf -- \
    "${activate_host_release_nginx_primary_stage}" \
    "${nginx_primary_path}" 8>&-
  mv -Tf -- \
    "${activate_host_release_nginx_alternate_stage}" \
    "${nginx_alternate_path}" 8>&-
  host_activation_ledger_require_file \
    "${nginx_primary_path}" "root:root:644" \
    "installed primary Nginx configuration"
  host_activation_ledger_require_file \
    "${nginx_alternate_path}" "root:root:644" \
    "installed alternate Nginx configuration"
  if ! cmp -s -- "${nginx_primary_source}" "${nginx_primary_path}" ||
    ! cmp -s -- "${nginx_alternate_source}" "${nginx_alternate_path}"; then
    activate_host_release_fail 70 \
      "installed Nginx configuration does not match the target release"
    return
  fi
  nginx -t 8>&-
  rollback_fsync_paths \
    "${node_binary}" \
    "${environment_path}" \
    "${shared_root}" \
    "${nginx_primary_path}" \
    "${nginx_alternate_path}" \
    "${nginx_sites_root}" 8>&-

  host_activation_ledger_require_lifecycle_lock "${deploy_root}"
  host_activation_ledger_require_pending \
    "${release_id}" "${deploy_root}" "${node_binary}"
  # Cleanup is already armed before link creation. If the shell is terminated
  # between ln and mv, EXIT removes only the exact target-release symlink; a
  # later retry may likewise clear that same crash residue after all PENDING,
  # current and rollback-basis checks have succeeded.
  ln -s -- "${release_dir}" "${activate_host_release_current_next}" 8>&-
  mv -Tf -- "${activate_host_release_current_next}" "${current_link}" 8>&-
  if [[ ! -L "${current_link}" ]] ||
    [[ "$(realpath -- "${current_link}")" != "${release_dir}" ]]; then
    activate_host_release_fail 70 \
      "current did not converge to the target release"
    return
  fi
  rollback_fsync_paths "${node_binary}" "${deploy_root}" 8>&-

  host_activation_ledger_require_lifecycle_lock "${deploy_root}"
  if env -i HOME=/root PATH="${root_child_path}" \
    "${pm2_command[@]}" describe diesel-demo 8>&- >/dev/null 2>&1; then
    env -i HOME=/root PATH="${root_child_path}" \
      "${pm2_command[@]}" delete diesel-demo 8>&-
  fi
  env -i \
    HOME=/root \
    PATH="${root_child_path}" \
    APP_VERSION="${release_id}" \
    NODE_ENV=production \
    "${pm2_command[@]}" start "${current_ecosystem_path}" 8>&-

  rollback_validate_pm2_process \
    "${release_id}" "${release_dir}" "${current_link}" \
    "${proc_root}" "${fixed_vps_path}" "${node_binary}" \
    "${runtime_uid}" "${runtime_gid}" \
    "${expected_pm2_exec}" "${root_child_path}"
  activate_host_release_readiness_headers="$(
    mktemp "${deployment_state_dir}/.readiness-headers.XXXXXX"
  )"
  host_activation_ledger_require_file \
    "${activate_host_release_readiness_headers}" "root:root:600" \
    "temporary readiness response headers"
  local readiness_request_started_at_ms
  readiness_request_started_at_ms="$(
    env -i HOME=/root PATH="${root_child_path}" \
      "${node_binary}" -e 'process.stdout.write(String(Date.now()))' 8>&-
  )"
  [[ "${readiness_request_started_at_ms}" =~ ^[0-9]+$ ]] || {
    activate_host_release_fail 70 "readiness request clock is invalid"
    return
  }
  curl --disable --connect-timeout 10 --fail --max-filesize 65536 \
    --dump-header "${activate_host_release_readiness_headers}" \
    --max-time 30 --noproxy '*' --proto '=http' \
    --retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 60 \
    --show-error --silent \
    http://127.0.0.1:8788/api/health/ready 8>&- |
    env -i \
      HOME=/root \
      PATH="${root_child_path}" \
      EXPECTED_APP_VERSION="${release_id}" \
      READINESS_HEADERS_PATH="${activate_host_release_readiness_headers}" \
      READINESS_REQUEST_STARTED_AT_MS="${readiness_request_started_at_ms}" \
      READINESS_RESPONSE_VALIDATOR="${readiness_response_validator}" \
      "${node_binary}" -e '
        const { readFileSync } = require("node:fs");
        const chunks = [];
        process.stdin.on("data", (chunk) => chunks.push(chunk));
        process.stdin.on("end", () => {
          const contract = require(process.env.READINESS_RESPONSE_VALIDATOR);
          contract.validateReadinessResponseV1({
            bodyText: Buffer.concat(chunks).toString("utf8"),
            contractVersion: contract.READINESS_RESPONSE_CONTRACT_VERSION,
            expectedVersion: process.env.EXPECTED_APP_VERSION,
            rawHeaders: readFileSync(
              process.env.READINESS_HEADERS_PATH,
              "utf8",
            ),
            requestStartedAtMs: Number(
              process.env.READINESS_REQUEST_STARTED_AT_MS,
            ),
            responseReceivedAtMs: Date.now(),
          });
        });
      ' 8>&-
  host_activation_ledger_require_file \
    "${activate_host_release_readiness_headers}" "root:root:600" \
    "temporary readiness response headers"
  rm -f -- "${activate_host_release_readiness_headers}" 8>&-
  activate_host_release_readiness_headers=""
  rollback_fsync_paths "${node_binary}" "${deployment_state_dir}" 8>&-

  host_activation_ledger_require_lifecycle_lock "${deploy_root}"
  host_activation_ledger_require_pending \
    "${release_id}" "${deploy_root}" "${node_binary}"
  env -i HOME=/root PATH="${root_child_path}" \
    "${pm2_command[@]}" save 8>&-
  rollback_validate_durable_pm2_state \
    "${release_id}" "${release_dir}" "${current_link}" \
    "${proc_root}" "${fixed_vps_path}" "${node_binary}" \
    "${pm2_state_helper}" "${expected_pm2_state_root}" \
    "${expected_pm2_exec}" "${expected_unit_fragment}" \
    "${expected_daemon_uid}" "${expected_daemon_gid}" \
    "${approved_additional_unit_paths}" "${root_child_path}"
  env -i HOME=/root PATH="${root_child_path}" \
    "${systemctl_command}" is-enabled --quiet pm2-root 8>&-
  env -i HOME=/root PATH="${root_child_path}" \
    "${systemctl_command}" is-active --quiet pm2-root 8>&-

  host_activation_ledger_require_lifecycle_lock "${deploy_root}"
  host_activation_ledger_require_pending \
    "${release_id}" "${deploy_root}" "${node_binary}"
  env -i HOME=/root PATH="${root_child_path}" \
    "${systemctl_command}" reload nginx 8>&-

  if [[ "$(realpath -- "${current_link}")" != "${release_dir}" ]]; then
    activate_host_release_fail 70 \
      "current changed after target release activation"
    return
  fi
  trap - EXIT INT TERM HUP
  printf 'Host activation completed: %s\n' "${release_dir}"
)

activate_host_release_main() (
  set -Eeuo pipefail

  if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
    activate_host_release_fail 64 \
      "production host activation main is unavailable when sourced"
    return
  fi
  if [[ "$#" -ne 1 ]]; then
    activate_host_release_usage
    return 64
  fi

  activate_host_release \
    "$1" \
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
  activate_host_release_main "$@"
fi
