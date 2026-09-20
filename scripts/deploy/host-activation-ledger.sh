#!/usr/bin/env bash

# Versioned, sourceable host-activation ledger. The CLI fixes both the deploy
# root and Node runtime; sourced callers may provide isolated fixture paths.

host_activation_ledger_usage() {
  echo "usage: host-activation-ledger.sh <initialize-protocol|validate> <full-lowercase-git-commit-sha>" >&2
}

host_activation_ledger_fail() {
  local status="$1"
  shift
  printf 'Host activation ledger: %s\n' "$*" >&2
  return "${status}"
}

host_activation_ledger_is_release_id() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

host_activation_ledger_is_runtime_release_id() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]
}

host_activation_ledger_require_deploy_root() {
  local deploy_root="$1"

  if [[ ! "${deploy_root}" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
    [[ "${deploy_root}" == "/" ]] ||
    [[ "${deploy_root}" == */ ]] ||
    [[ "${deploy_root}" == *//* ]] ||
    [[ "${deploy_root}" == *'/../'* ]] ||
    [[ "${deploy_root}" == *'/./'* ]] ||
    [[ "${deploy_root}" == */.. ]] ||
    [[ "${deploy_root}" == */. ]]; then
    host_activation_ledger_fail 64 "deploy root is not canonical"
    return
  fi
}

host_activation_ledger_require_directory() {
  local path="$1"
  local expected_metadata="$2"
  local label="$3"
  local canonical_path
  local actual_metadata

  if [[ ! -d "${path}" || -L "${path}" ]]; then
    host_activation_ledger_fail 70 "${label} must be a real directory"
    return
  fi
  if ! canonical_path="$(realpath -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]]; then
    host_activation_ledger_fail 70 "${label} must be canonical"
    return
  fi
  if ! actual_metadata="$(stat -c '%U:%G:%a' -- "${path}")" ||
    [[ "${actual_metadata}" != "${expected_metadata}" ]]; then
    host_activation_ledger_fail 70 \
      "${label} must be ${expected_metadata}"
    return
  fi
}

host_activation_ledger_require_file() {
  local path="$1"
  local expected_metadata="$2"
  local label="$3"
  local canonical_path
  local actual_metadata
  local link_count

  if [[ ! -f "${path}" || -L "${path}" ]]; then
    host_activation_ledger_fail 70 \
      "${label} must be a regular non-symlink file"
    return
  fi
  if ! canonical_path="$(realpath -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]]; then
    host_activation_ledger_fail 70 "${label} must be canonical"
    return
  fi
  if ! actual_metadata="$(stat -c '%U:%G:%a' -- "${path}")" ||
    [[ "${actual_metadata}" != "${expected_metadata}" ]]; then
    host_activation_ledger_fail 70 \
      "${label} must be ${expected_metadata}"
    return
  fi
  if ! link_count="$(stat -c '%h' -- "${path}")" ||
    [[ "${link_count}" != "1" ]]; then
    host_activation_ledger_fail 70 "${label} must have one link"
    return
  fi
}

host_activation_ledger_require_absent() {
  local path="$1"
  local label="$2"

  if [[ -e "${path}" || -L "${path}" ]]; then
    host_activation_ledger_fail 70 "${label} must be absent"
    return
  fi
}

host_activation_ledger_hash_file() {
  local path="$1"
  local hash_output
  local digest

  if ! hash_output="$(sha256sum -- "${path}")"; then
    host_activation_ledger_fail 70 "could not hash durable activation state"
    return
  fi
  digest="${hash_output%% *}"
  if [[ ! "${digest}" =~ ^[0-9a-f]{64}$ ]]; then
    host_activation_ledger_fail 70 "durable activation state hash is invalid"
    return
  fi
  HOST_ACTIVATION_LEDGER_HASH="${digest}"
}

host_activation_ledger_fsync_paths() {
  local node_binary="$1"
  shift

  if [[ "$#" -lt 1 ]]; then
    host_activation_ledger_fail 64 "at least one durability path is required"
    return
  fi
  if [[ ! -f "${node_binary}" || -L "${node_binary}" ||
    ! -x "${node_binary}" ]]; then
    host_activation_ledger_fail 70 "fixed Node.js runtime is unavailable"
    return
  fi
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
      process.stderr.write("Host activation ledger: durability proof failed\n");
      process.exit(70);
    }
  ' -- "$@"
}

host_activation_ledger_set_paths() {
  local release_id="$1"
  local deploy_root="$2"

  HOST_ACTIVATION_LEDGER_RELEASE_ID="${release_id}"
  HOST_ACTIVATION_LEDGER_DEPLOY_ROOT="${deploy_root}"
  HOST_ACTIVATION_LEDGER_BACKUPS_ROOT="${deploy_root}/backups"
  HOST_ACTIVATION_LEDGER_PROTOCOL_MANIFEST="${deploy_root}/backups/HOST_ACTIVATION_PROTOCOL_V1"
  HOST_ACTIVATION_LEDGER_STATE_DIRECTORY="${deploy_root}/backups/${release_id}"
  HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_FILE="${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/previous-release"
  HOST_ACTIVATION_LEDGER_ENVIRONMENT_BACKUP="${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/env.production.local.pre-switch"
  HOST_ACTIVATION_LEDGER_NGINX_PRIMARY_BACKUP="${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/jamesky.site.pre-switch"
  HOST_ACTIVATION_LEDGER_NGINX_ALTERNATE_BACKUP="${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/diesel-demo.pre-switch"
  HOST_ACTIVATION_LEDGER_ANCHOR="${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ACTIVATION_V1"
  HOST_ACTIVATION_LEDGER_PENDING="${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ACTIVATION_PENDING"
  HOST_ACTIVATION_LEDGER_ROLLED_BACK="${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ACTIVATION_ROLLED_BACK"
  HOST_ACTIVATION_LEDGER_COMMITTED="${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ACTIVATION_COMMITTED"
}

host_activation_ledger_validate_common_layout() {
  local release_id="$1"
  local deploy_root="$2"

  if ! host_activation_ledger_is_release_id "${release_id}"; then
    host_activation_ledger_fail 64 \
      "release ID must be a full lowercase Git commit SHA"
    return
  fi
  host_activation_ledger_require_deploy_root "${deploy_root}" || return $?
  host_activation_ledger_set_paths "${release_id}" "${deploy_root}"
  host_activation_ledger_require_directory \
    "${deploy_root}" "root:root:755" "deployment root" || return $?
  host_activation_ledger_require_directory \
    "${HOST_ACTIVATION_LEDGER_BACKUPS_ROOT}" "root:root:700" \
    "activation state root" || return $?
  host_activation_ledger_require_directory \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}" "root:root:700" \
    "activation state directory"
}

host_activation_ledger_read_previous_release() {
  local release_id="$1"
  local deploy_root="$2"
  local previous_release=''
  local previous_release_id
  local state_size

  host_activation_ledger_require_file \
    "${HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_FILE}" "root:root:600" \
    "previous release state" || return $?
  if ! state_size="$(stat -c '%s' -- \
    "${HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_FILE}")" ||
    [[ ! "${state_size}" =~ ^[0-9]+$ ]] ||
    (( state_size < 2 || state_size > 512 )); then
    host_activation_ledger_fail 70 "previous release state is not bounded"
    return
  fi
  if ! IFS= read -r previous_release \
    <"${HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_FILE}"; then
    host_activation_ledger_fail 70 \
      "previous release state must be one newline-terminated record"
    return
  fi
  previous_release_id="${previous_release##*/}"
  if ! host_activation_ledger_is_runtime_release_id "${previous_release_id}" ||
    [[ "${previous_release}" != \
      "${deploy_root}/releases/${previous_release_id}" ]] ||
    [[ "${previous_release_id}" == "${release_id}" ]] ||
    [[ "${state_size}" != "$((${#previous_release} + 1))" ]]; then
    host_activation_ledger_fail 70 \
      "previous release state is not a distinct canonical release"
    return
  fi
  HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_PATH="${previous_release}"
  HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_ID="${previous_release_id}"
}

host_activation_ledger_build_anchor_payload() {
  local release_id="$1"
  local deploy_root="$2"
  local previous_release_sha256
  local environment_sha256
  local nginx_primary_sha256
  local nginx_alternate_sha256

  host_activation_ledger_read_previous_release \
    "${release_id}" "${deploy_root}" || return $?
  host_activation_ledger_require_file \
    "${HOST_ACTIVATION_LEDGER_ENVIRONMENT_BACKUP}" "root:root:600" \
    "environment rollback basis" || return $?
  host_activation_ledger_require_file \
    "${HOST_ACTIVATION_LEDGER_NGINX_PRIMARY_BACKUP}" "root:root:600" \
    "primary Nginx rollback basis" || return $?
  host_activation_ledger_require_file \
    "${HOST_ACTIVATION_LEDGER_NGINX_ALTERNATE_BACKUP}" "root:root:600" \
    "alternate Nginx rollback basis" || return $?

  host_activation_ledger_hash_file \
    "${HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_FILE}" || return $?
  previous_release_sha256="${HOST_ACTIVATION_LEDGER_HASH}"
  host_activation_ledger_hash_file \
    "${HOST_ACTIVATION_LEDGER_ENVIRONMENT_BACKUP}" || return $?
  environment_sha256="${HOST_ACTIVATION_LEDGER_HASH}"
  host_activation_ledger_hash_file \
    "${HOST_ACTIVATION_LEDGER_NGINX_PRIMARY_BACKUP}" || return $?
  nginx_primary_sha256="${HOST_ACTIVATION_LEDGER_HASH}"
  host_activation_ledger_hash_file \
    "${HOST_ACTIVATION_LEDGER_NGINX_ALTERNATE_BACKUP}" || return $?
  nginx_alternate_sha256="${HOST_ACTIVATION_LEDGER_HASH}"

  HOST_ACTIVATION_LEDGER_ANCHOR_PAYLOAD="${release_id}"$'\t'"${HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_PATH}"$'\n'\
"${previous_release_sha256}"$'\t'"${HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_FILE}"$'\n'\
"${environment_sha256}"$'\t'"${HOST_ACTIVATION_LEDGER_ENVIRONMENT_BACKUP}"$'\n'\
"${nginx_primary_sha256}"$'\t'"${HOST_ACTIVATION_LEDGER_NGINX_PRIMARY_BACKUP}"$'\n'\
"${nginx_alternate_sha256}"$'\t'"${HOST_ACTIVATION_LEDGER_NGINX_ALTERNATE_BACKUP}"
}

host_activation_ledger_parse_anchor() {
  local release_id="$1"
  local deploy_root="$2"
  local anchor_size
  local anchor_contents

  host_activation_ledger_require_file \
    "${HOST_ACTIVATION_LEDGER_ANCHOR}" "root:root:600" \
    "host activation V1 anchor" || return $?
  if ! anchor_size="$(stat -c '%s' -- "${HOST_ACTIVATION_LEDGER_ANCHOR}")" ||
    [[ ! "${anchor_size}" =~ ^[0-9]+$ ]] ||
    (( anchor_size < 2 || anchor_size > 4096 )); then
    host_activation_ledger_fail 70 "host activation V1 anchor is not bounded"
    return
  fi
  host_activation_ledger_build_anchor_payload \
    "${release_id}" "${deploy_root}" || return $?
  anchor_contents="$(<"${HOST_ACTIVATION_LEDGER_ANCHOR}")"
  if [[ "${anchor_contents}" != "${HOST_ACTIVATION_LEDGER_ANCHOR_PAYLOAD}" ]] ||
    [[ "${anchor_size}" != \
      "$((${#HOST_ACTIVATION_LEDGER_ANCHOR_PAYLOAD} + 1))" ]]; then
    host_activation_ledger_fail 70 \
      "host activation V1 anchor payload is invalid"
    return
  fi
  host_activation_ledger_hash_file \
    "${HOST_ACTIVATION_LEDGER_ANCHOR}" || return $?
  HOST_ACTIVATION_LEDGER_ANCHOR_SHA256="${HOST_ACTIVATION_LEDGER_HASH}"
}

host_activation_ledger_parse_state_marker() {
  local marker_path="$1"
  local release_id="$2"
  local deploy_root="$3"
  local marker_size
  local marker_contents
  local expected_payload

  host_activation_ledger_parse_anchor \
    "${release_id}" "${deploy_root}" || return $?
  host_activation_ledger_require_file \
    "${marker_path}" "root:root:600" \
    "host activation state marker" || return $?
  if ! marker_size="$(stat -c '%s' -- "${marker_path}")" ||
    [[ ! "${marker_size}" =~ ^[0-9]+$ ]] ||
    (( marker_size < 2 || marker_size > 1024 )); then
    host_activation_ledger_fail 70 \
      "host activation state marker is not bounded"
    return
  fi
  expected_payload="${HOST_ACTIVATION_LEDGER_ANCHOR_SHA256}"$'\t'\
"${HOST_ACTIVATION_LEDGER_ANCHOR}"
  marker_contents="$(<"${marker_path}")"
  if [[ "${marker_contents}" != "${expected_payload}" ]] ||
    [[ "${marker_size}" != "$((${#expected_payload} + 1))" ]]; then
    host_activation_ledger_fail 70 \
      "host activation state marker payload is invalid"
    return
  fi
}

host_activation_ledger_parse_publication_marker() {
  local marker_path="$1"
  local release_id="$2"
  local deploy_root="$3"
  local snapshot_path="${deploy_root}/backups/${release_id}/governance-before.json"
  local marker_size
  local marker_contents
  local snapshot_sha256
  local expected_payload

  host_activation_ledger_require_file \
    "${marker_path}" "root:root:600" "governance publication marker" || return $?
  host_activation_ledger_require_file \
    "${snapshot_path}" "root:root:600" "governance snapshot" || return $?
  if ! marker_size="$(stat -c '%s' -- "${marker_path}")" ||
    [[ ! "${marker_size}" =~ ^[0-9]+$ ]] ||
    (( marker_size < 2 || marker_size > 1024 )); then
    host_activation_ledger_fail 70 "governance publication marker is not bounded"
    return
  fi
  host_activation_ledger_hash_file "${snapshot_path}" || return $?
  snapshot_sha256="${HOST_ACTIVATION_LEDGER_HASH}"
  expected_payload="${snapshot_sha256}"$'\t'"${snapshot_path}"
  marker_contents="$(<"${marker_path}")"
  if [[ "${marker_contents}" != "${expected_payload}" ]] ||
    [[ "${marker_size}" != "$((${#expected_payload} + 1))" ]]; then
    host_activation_ledger_fail 70 \
      "governance publication marker payload is invalid"
    return
  fi
}

host_activation_ledger_detect_governance_state() {
  local release_id="$1"
  local deploy_root="$2"
  local state_directory="${deploy_root}/backups/${release_id}"
  local marker_name
  local marker_path
  local count=0

  HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE="none"
  for marker_name in \
    RECOVERY_REQUIRED HOST_ROLLBACK_REQUIRED HOST_ROLLBACK_COMPLETED \
    PUBLISH_COMMITTED PUBLISH_FINALIZED; do
    marker_path="${state_directory}/${marker_name}"
    if [[ -e "${marker_path}" || -L "${marker_path}" ]]; then
      count=$((count + 1))
      HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE="${marker_name}"
      host_activation_ledger_parse_publication_marker \
        "${marker_path}" "${release_id}" "${deploy_root}" || return $?
    fi
  done
  if [[ "${count}" -gt 1 ]]; then
    host_activation_ledger_fail 70 \
      "governance publication markers have an invalid coexistence"
    return
  fi
}

host_activation_ledger_require_no_unknown_records() {
  local state_directory="$1"
  local entry
  local entry_name

  while IFS= read -r -d '' entry; do
    entry_name="${entry##*/}"
    if [[ -L "${entry}" ]]; then
      host_activation_ledger_fail 70 \
        "a symlink blocks host activation protocol validation"
      return
    fi
    case "${entry_name}" in
      HOST_ACTIVATION_V1 | HOST_ACTIVATION_PENDING | \
        HOST_ACTIVATION_ROLLED_BACK | HOST_ACTIVATION_COMMITTED | \
        RECOVERY_REQUIRED | HOST_ROLLBACK_REQUIRED | \
        HOST_ROLLBACK_COMPLETED | PUBLISH_COMMITTED | \
        PUBLISH_FINALIZED) ;;
      .* | *[A-Z]* | HOST_ACTIVATION_* | HOST_ROLLBACK_* | PUBLISH_* | RECOVERY_*)
        host_activation_ledger_fail 70 \
          "an unknown or incomplete state record blocks host activation"
        return
        ;;
    esac
  done < <(find -- "${state_directory}" -mindepth 1 -maxdepth 1 -print0)
}

host_activation_ledger_parse_protocol_manifest() {
  local deploy_root="$1"
  local LC_ALL=C
  local manifest_path="${deploy_root}/backups/HOST_ACTIVATION_PROTOCOL_V1"
  local manifest_size
  local manifest_contents
  local reconstructed=''
  local header
  local header_magic
  local header_version
  local enabling_release
  local entry
  local release_id
  local marker_name
  local marker_path
  local marker_sha256
  local snapshot_path
  local snapshot_sha256
  local previous_release=''
  local actual_sha256
  local line_number=0
  local -a lines=()

  host_activation_ledger_require_deploy_root "${deploy_root}" || return $?
  host_activation_ledger_require_directory \
    "${deploy_root}/backups" "root:root:700" \
    "activation state root" || return $?
  host_activation_ledger_require_file \
    "${manifest_path}" "root:root:600" \
    "host activation protocol manifest" || return $?
  if ! manifest_size="$(stat -c '%s' -- "${manifest_path}")" ||
    [[ ! "${manifest_size}" =~ ^[0-9]+$ ]] ||
    (( manifest_size < 2 || manifest_size > 1048576 )); then
    host_activation_ledger_fail 70 \
      "host activation protocol manifest is not bounded"
    return
  fi
  manifest_contents="$(<"${manifest_path}")"
  if [[ "${manifest_size}" != "$((${#manifest_contents} + 1))" ]]; then
    host_activation_ledger_fail 70 \
      "host activation protocol manifest must end with one newline"
    return
  fi
  IFS=$'\n' read -r -d '' -a lines <"${manifest_path}" || true
  if (( ${#lines[@]} < 1 || ${#lines[@]} > 4097 )); then
    host_activation_ledger_fail 70 \
      "host activation protocol manifest record count is invalid"
    return
  fi
  header="${lines[0]}"
  IFS=$'\t' read -r header_magic header_version enabling_release \
    <<<"${header}"
  if [[ "${header}" != \
      "HOST_ACTIVATION_PROTOCOL_V1"$'\t'"1"$'\t'"${enabling_release}" ]] ||
    [[ "${header_magic}" != "HOST_ACTIVATION_PROTOCOL_V1" ]] ||
    [[ "${header_version}" != "1" ]] ||
    ! host_activation_ledger_is_release_id "${enabling_release}"; then
    host_activation_ledger_fail 70 \
      "host activation protocol manifest header is invalid"
    return
  fi
  reconstructed="${header}"
  HOST_ACTIVATION_LEDGER_PROTOCOL_ENABLE_RELEASE="${enabling_release}"
  HOST_ACTIVATION_LEDGER_GRANDFATHER_COUNT=0
  HOST_ACTIVATION_LEDGER_GRANDFATHER_RELEASES=''
  HOST_ACTIVATION_LEDGER_GRANDFATHER_MARKERS=''

  for ((line_number = 1; line_number < ${#lines[@]}; line_number++)); do
    entry="${lines[line_number]}"
    IFS=$'\t' read -r release_id marker_name marker_path marker_sha256 \
      snapshot_path snapshot_sha256 <<<"${entry}"
    if [[ "${entry}" != \
        "${release_id}"$'\t'"${marker_name}"$'\t'"${marker_path}"$'\t'"${marker_sha256}"$'\t'"${snapshot_path}"$'\t'"${snapshot_sha256}" ]] ||
      ! host_activation_ledger_is_release_id "${release_id}" ||
      { [[ -n "${previous_release}" ]] &&
        { [[ "${release_id}" == "${previous_release}" ]] ||
          [[ "${release_id}" < "${previous_release}" ]]; }; } ||
      [[ "${marker_name}" != "HOST_ROLLBACK_COMPLETED" && \
        "${marker_name}" != "PUBLISH_FINALIZED" ]] ||
      [[ "${marker_path}" != \
        "${deploy_root}/backups/${release_id}/${marker_name}" ]] ||
      [[ "${snapshot_path}" != \
        "${deploy_root}/backups/${release_id}/governance-before.json" ]] ||
      [[ ! "${marker_sha256}" =~ ^[0-9a-f]{64}$ ]] ||
      [[ ! "${snapshot_sha256}" =~ ^[0-9a-f]{64}$ ]]; then
      host_activation_ledger_fail 70 \
        "host activation protocol manifest entry is invalid"
      return
    fi
    host_activation_ledger_require_directory \
      "${deploy_root}/backups/${release_id}" "root:root:700" \
      "grandfathered activation state directory" || return $?
    host_activation_ledger_require_no_unknown_records \
      "${deploy_root}/backups/${release_id}" || return $?
    host_activation_ledger_require_absent \
      "${deploy_root}/backups/${release_id}/HOST_ACTIVATION_V1" \
      "grandfathered V1 anchor" || return $?
    host_activation_ledger_require_absent \
      "${deploy_root}/backups/${release_id}/HOST_ACTIVATION_PENDING" \
      "grandfathered pending marker" || return $?
    host_activation_ledger_require_absent \
      "${deploy_root}/backups/${release_id}/HOST_ACTIVATION_ROLLED_BACK" \
      "grandfathered rolled-back marker" || return $?
    host_activation_ledger_require_absent \
      "${deploy_root}/backups/${release_id}/HOST_ACTIVATION_COMMITTED" \
      "grandfathered committed marker" || return $?
    host_activation_ledger_detect_governance_state \
      "${release_id}" "${deploy_root}" || return $?
    if [[ "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != \
      "${marker_name}" ]]; then
      host_activation_ledger_fail 70 \
        "grandfathered governance state changed after protocol initialization"
      return
    fi
    host_activation_ledger_hash_file "${marker_path}" || return $?
    actual_sha256="${HOST_ACTIVATION_LEDGER_HASH}"
    if [[ "${actual_sha256}" != "${marker_sha256}" ]]; then
      host_activation_ledger_fail 70 \
        "grandfathered governance marker hash changed"
      return
    fi
    host_activation_ledger_hash_file "${snapshot_path}" || return $?
    actual_sha256="${HOST_ACTIVATION_LEDGER_HASH}"
    if [[ "${actual_sha256}" != "${snapshot_sha256}" ]]; then
      host_activation_ledger_fail 70 \
        "grandfathered governance snapshot hash changed"
      return
    fi
    HOST_ACTIVATION_LEDGER_GRANDFATHER_RELEASES+="${release_id}"$'\n'
    HOST_ACTIVATION_LEDGER_GRANDFATHER_MARKERS+="${marker_name}"$'\n'
    HOST_ACTIVATION_LEDGER_GRANDFATHER_COUNT=$((
      HOST_ACTIVATION_LEDGER_GRANDFATHER_COUNT + 1
    ))
    previous_release="${release_id}"
    reconstructed+=$'\n'"${entry}"
  done
  if [[ "${reconstructed}" != "${manifest_contents}" ]]; then
    host_activation_ledger_fail 70 \
      "host activation protocol manifest payload is invalid"
    return
  fi
  HOST_ACTIVATION_LEDGER_PROTOCOL_MANIFEST="${manifest_path}"
}

host_activation_ledger_is_grandfathered() {
  local release_id="$1"
  local marker_name="$2"
  local releases="${HOST_ACTIVATION_LEDGER_GRANDFATHER_RELEASES:-}"
  local markers="${HOST_ACTIVATION_LEDGER_GRANDFATHER_MARKERS:-}"
  local candidate_release
  local candidate_marker

  while IFS= read -r candidate_release && IFS= read -r candidate_marker <&4; do
    if [[ "${candidate_release}" == "${release_id}" &&
      "${candidate_marker}" == "${marker_name}" ]]; then
      return 0
    fi
  done <<<"${releases}" 4<<<"${markers}"
  return 1
}

host_activation_ledger_require_unarmed_candidate() {
  local release_id="$1"
  local deploy_root="$2"
  local marker_path

  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
  host_activation_ledger_validate_common_layout \
    "${release_id}" "${deploy_root}" || return $?
  host_activation_ledger_parse_protocol_manifest "${deploy_root}" || return $?
  host_activation_ledger_require_no_unknown_records \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}" || return $?
  for marker_path in \
    "${HOST_ACTIVATION_LEDGER_ANCHOR}" \
    "${HOST_ACTIVATION_LEDGER_PENDING}" \
    "${HOST_ACTIVATION_LEDGER_ROLLED_BACK}" \
    "${HOST_ACTIVATION_LEDGER_COMMITTED}" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/RECOVERY_REQUIRED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ROLLBACK_REQUIRED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ROLLBACK_COMPLETED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/PUBLISH_COMMITTED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/PUBLISH_FINALIZED"; do
    host_activation_ledger_require_absent \
      "${marker_path}" "unarmed candidate ledger" || return $?
  done
  if host_activation_ledger_is_grandfathered "${release_id}" \
    HOST_ROLLBACK_COMPLETED ||
    host_activation_ledger_is_grandfathered "${release_id}" \
      PUBLISH_FINALIZED; then
    host_activation_ledger_fail 70 \
      "a grandfathered release cannot be re-armed"
    return
  fi
}

host_activation_ledger_require_resumable_anchor() {
  local release_id="$1"
  local deploy_root="$2"
  local marker_path

  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
  host_activation_ledger_validate_common_layout \
    "${release_id}" "${deploy_root}" || return $?
  host_activation_ledger_parse_protocol_manifest "${deploy_root}" || return $?
  host_activation_ledger_require_no_unknown_records \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}" || return $?
  host_activation_ledger_parse_anchor \
    "${release_id}" "${deploy_root}" || return $?
  for marker_path in \
    "${HOST_ACTIVATION_LEDGER_PENDING}" \
    "${HOST_ACTIVATION_LEDGER_ROLLED_BACK}" \
    "${HOST_ACTIVATION_LEDGER_COMMITTED}" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/RECOVERY_REQUIRED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ROLLBACK_REQUIRED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ROLLBACK_COMPLETED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/PUBLISH_COMMITTED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/PUBLISH_FINALIZED"; do
    host_activation_ledger_require_absent \
      "${marker_path}" "resumable anchor companion state" || return $?
  done
  if host_activation_ledger_is_grandfathered "${release_id}" \
    HOST_ROLLBACK_COMPLETED ||
    host_activation_ledger_is_grandfathered "${release_id}" \
      PUBLISH_FINALIZED; then
    host_activation_ledger_fail 70 \
      "a grandfathered release cannot resume V1 activation"
    return
  fi
}

host_activation_ledger_initialize_protocol() {
  local enabling_release="$1"
  local deploy_root="$2"
  local node_binary="$3"
  local LC_ALL=C
  local manifest_path="${deploy_root}/backups/HOST_ACTIVATION_PROTOCOL_V1"
  local backups_root="${deploy_root}/backups"
  local payload
  local unsafe_path
  local ledger_path
  local state_directory
  local release_id
  local marker_name
  local marker_path
  local marker_sha256
  local snapshot_path
  local snapshot_sha256
  local directory_names
  local grandfather_count=0

  if ! host_activation_ledger_is_release_id "${enabling_release}"; then
    host_activation_ledger_fail 64 \
      "release ID must be a full lowercase Git commit SHA"
    return
  fi
  host_activation_ledger_require_deploy_root "${deploy_root}" || return $?
  host_activation_ledger_require_directory \
    "${deploy_root}" "root:root:755" "deployment root" || return $?
  host_activation_ledger_require_directory \
    "${backups_root}" "root:root:700" "activation state root" || return $?
  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?

  if [[ -e "${manifest_path}" || -L "${manifest_path}" ]]; then
    host_activation_ledger_parse_protocol_manifest "${deploy_root}" || return $?
    if [[ "${HOST_ACTIVATION_LEDGER_PROTOCOL_ENABLE_RELEASE}" != \
      "${enabling_release}" ]]; then
      host_activation_ledger_fail 70 \
        "host activation protocol was initialized by another release"
      return
    fi
    host_activation_ledger_fsync_paths \
      "${node_binary}" "${manifest_path}" "${backups_root}" \
      "${deploy_root}" || return $?
    host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
    host_activation_ledger_parse_protocol_manifest "${deploy_root}" || return $?
    host_activation_ledger_scan_all \
      "${deploy_root}" "${node_binary}" allow-active
    return
  fi

  if ! unsafe_path="$(find -- "${backups_root}" -mindepth 1 \
    \( -type l -o -name '.*' \) -print -quit)"; then
    host_activation_ledger_fail 70 \
      "could not inspect pre-protocol activation state"
    return
  fi
  if [[ -n "${unsafe_path}" ]]; then
    host_activation_ledger_fail 70 \
      "a symlink or temporary state blocks protocol initialization"
    return
  fi
  if ! ledger_path="$(find -- "${backups_root}" -mindepth 1 \
    \( -name 'HOST_ACTIVATION_*' -o -name 'HOST_ROLLBACK_*' -o \
      -name 'PUBLISH_*' -o -name 'RECOVERY_*' \) -print)"; then
    host_activation_ledger_fail 70 \
      "could not scan pre-protocol activation ledgers"
    return
  fi
  while IFS= read -r marker_path; do
    [[ -n "${marker_path}" ]] || continue
    state_directory="${marker_path%/*}"
    release_id="${state_directory##*/}"
    if ! host_activation_ledger_is_release_id "${release_id}" ||
      [[ "${state_directory}" != "${backups_root}/${release_id}" ]]; then
      host_activation_ledger_fail 70 \
        "a non-canonical ledger blocks protocol initialization"
      return
    fi
  done <<<"${ledger_path}"

  if ! directory_names="$(find -- "${backups_root}" -mindepth 1 \
    -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort)"; then
    host_activation_ledger_fail 70 \
      "could not enumerate pre-protocol activation state"
    return
  fi
  payload="HOST_ACTIVATION_PROTOCOL_V1"$'\t'"1"$'\t'"${enabling_release}"
  while IFS= read -r release_id; do
    [[ -n "${release_id}" ]] || continue
    if ! host_activation_ledger_is_release_id "${release_id}"; then
      continue
    fi
    state_directory="${backups_root}/${release_id}"
    host_activation_ledger_require_directory \
      "${state_directory}" "root:root:700" \
      "pre-protocol activation state directory" || return $?
    host_activation_ledger_set_paths "${release_id}" "${deploy_root}"
    host_activation_ledger_require_no_unknown_records \
      "${state_directory}" || return $?
    host_activation_ledger_require_absent \
      "${HOST_ACTIVATION_LEDGER_ANCHOR}" \
      "pre-protocol V1 anchor" || return $?
    host_activation_ledger_require_absent \
      "${HOST_ACTIVATION_LEDGER_PENDING}" \
      "pre-protocol pending marker" || return $?
    host_activation_ledger_require_absent \
      "${HOST_ACTIVATION_LEDGER_ROLLED_BACK}" \
      "pre-protocol rolled-back marker" || return $?
    host_activation_ledger_require_absent \
      "${HOST_ACTIVATION_LEDGER_COMMITTED}" \
      "pre-protocol committed marker" || return $?
    host_activation_ledger_detect_governance_state \
      "${release_id}" "${deploy_root}" || return $?
    marker_name="${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}"
    if [[ "${marker_name}" != "HOST_ROLLBACK_COMPLETED" &&
      "${marker_name}" != "PUBLISH_FINALIZED" ]]; then
      host_activation_ledger_fail 70 \
        "only terminal legacy ledgers may be grandfathered"
      return
    fi
    marker_path="${state_directory}/${marker_name}"
    snapshot_path="${state_directory}/governance-before.json"
    host_activation_ledger_hash_file "${marker_path}" || return $?
    marker_sha256="${HOST_ACTIVATION_LEDGER_HASH}"
    host_activation_ledger_hash_file "${snapshot_path}" || return $?
    snapshot_sha256="${HOST_ACTIVATION_LEDGER_HASH}"
    payload+=$'\n'"${release_id}"$'\t'"${marker_name}"$'\t'\
"${marker_path}"$'\t'"${marker_sha256}"$'\t'"${snapshot_path}"$'\t'\
"${snapshot_sha256}"
    grandfather_count=$((grandfather_count + 1))
    if (( grandfather_count > 4096 || ${#payload} + 1 > 1048576 )); then
      host_activation_ledger_fail 70 \
        "pre-protocol terminal ledger manifest is too large"
      return
    fi
  done <<<"${directory_names}"

  host_activation_ledger_write_record \
    "${manifest_path}" "${payload}" "${node_binary}" || return $?
  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
  host_activation_ledger_parse_protocol_manifest "${deploy_root}" || return $?
  if [[ "${HOST_ACTIVATION_LEDGER_PROTOCOL_ENABLE_RELEASE}" != \
    "${enabling_release}" ]]; then
    host_activation_ledger_fail 70 \
      "host activation protocol initialization did not converge"
    return
  fi
  host_activation_ledger_scan_all \
    "${deploy_root}" "${node_binary}" allow-active
}

host_activation_ledger_validate_release_state() {
  local release_id="$1"
  local deploy_root="$2"
  local anchor_present=0
  local host_state_count=0
  local marker_path
  local unexpected_marker

  host_activation_ledger_validate_common_layout \
    "${release_id}" "${deploy_root}" || return $?
  host_activation_ledger_parse_protocol_manifest "${deploy_root}" || return $?
  host_activation_ledger_require_no_unknown_records \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}" || return $?
  if ! unexpected_marker="$(find -- \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}" -mindepth 1 -maxdepth 1 \
    -name 'HOST_ACTIVATION_*' \
    ! -name HOST_ACTIVATION_V1 \
    ! -name HOST_ACTIVATION_PENDING \
    ! -name HOST_ACTIVATION_ROLLED_BACK \
    ! -name HOST_ACTIVATION_COMMITTED -print -quit)"; then
    host_activation_ledger_fail 70 \
      "could not inspect host activation records"
    return
  fi
  if [[ -n "${unexpected_marker}" ]]; then
    host_activation_ledger_fail 70 \
      "an unknown host activation record blocks this operation"
    return
  fi
  if [[ -e "${HOST_ACTIVATION_LEDGER_ANCHOR}" ||
    -L "${HOST_ACTIVATION_LEDGER_ANCHOR}" ]]; then
    anchor_present=1
  fi
  HOST_ACTIVATION_LEDGER_STATE="none"
  for marker_path in \
    "${HOST_ACTIVATION_LEDGER_PENDING}" \
    "${HOST_ACTIVATION_LEDGER_ROLLED_BACK}" \
    "${HOST_ACTIVATION_LEDGER_COMMITTED}"; do
    if [[ -e "${marker_path}" || -L "${marker_path}" ]]; then
      host_state_count=$((host_state_count + 1))
      HOST_ACTIVATION_LEDGER_STATE="${marker_path##*/HOST_ACTIVATION_}"
    fi
  done
  if [[ "${anchor_present}" -eq 0 ]]; then
    if [[ "${host_state_count}" -ne 0 ]]; then
      host_activation_ledger_fail 70 \
        "host activation state exists without its V1 anchor"
      return
    fi
    host_activation_ledger_detect_governance_state \
      "${release_id}" "${deploy_root}" || return $?
    case "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" in
      HOST_ROLLBACK_COMPLETED | PUBLISH_FINALIZED)
        if ! host_activation_ledger_is_grandfathered \
          "${release_id}" \
          "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}"; then
          host_activation_ledger_fail 70 \
            "anchorless terminal ledger is not grandfathered"
          return
        fi
        HOST_ACTIVATION_LEDGER_PROTOCOL="legacy"
        HOST_ACTIVATION_LEDGER_CLASSIFICATION="terminal"
        ;;
      *)
        host_activation_ledger_fail 70 \
          "anchorless state is not permitted after V1 initialization"
        return
        ;;
    esac
    return 0
  fi
  if [[ "${host_state_count}" -ne 1 ]]; then
    host_activation_ledger_fail 70 \
      "host activation V1 requires exactly one state marker"
    return
  fi
  host_activation_ledger_parse_state_marker \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ACTIVATION_${HOST_ACTIVATION_LEDGER_STATE}" \
    "${release_id}" "${deploy_root}" || return $?
  host_activation_ledger_detect_governance_state \
    "${release_id}" "${deploy_root}" || return $?
  HOST_ACTIVATION_LEDGER_PROTOCOL="v1"
  case "${HOST_ACTIVATION_LEDGER_STATE}:${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" in
    PENDING:none | PENDING:RECOVERY_REQUIRED | \
      PENDING:HOST_ROLLBACK_REQUIRED | PENDING:PUBLISH_COMMITTED | \
      PENDING:PUBLISH_FINALIZED | ROLLED_BACK:HOST_ROLLBACK_REQUIRED)
      HOST_ACTIVATION_LEDGER_CLASSIFICATION="active"
      ;;
    ROLLED_BACK:none | ROLLED_BACK:HOST_ROLLBACK_COMPLETED | \
      COMMITTED:PUBLISH_FINALIZED)
      HOST_ACTIVATION_LEDGER_CLASSIFICATION="terminal"
      ;;
    *)
      host_activation_ledger_fail 70 \
        "host activation and governance ledgers have an invalid coexistence"
      return
      ;;
  esac
}

host_activation_ledger_scan_all() {
  local deploy_root="$1"
  local node_binary="$2"
  local required_policy="${3:-allow-active}"
  local expected_active_release="${4:-}"
  local backups_root="${deploy_root}/backups"
  local unsafe_path
  local marker_paths
  local state_directories
  local marker_path
  local state_directory
  local release_id
  local active_count=0
  local active_release=''
  local inspected_release_ids=''

  host_activation_ledger_require_deploy_root "${deploy_root}" || return $?
  host_activation_ledger_require_directory \
    "${backups_root}" "root:root:700" "activation state root" || return $?
  host_activation_ledger_parse_protocol_manifest "${deploy_root}" || return $?
  if ! unsafe_path="$(find -- "${backups_root}" \
    \( -type l -o -name '.*' -o \
      \( -name HOST_ACTIVATION_PROTOCOL_V1 \
        ! -path "${backups_root}/HOST_ACTIVATION_PROTOCOL_V1" \) -o \
      \( -name 'HOST_ACTIVATION_*' \
        ! -name HOST_ACTIVATION_PROTOCOL_V1 \
        ! -name HOST_ACTIVATION_V1 \
        ! -name HOST_ACTIVATION_PENDING \
        ! -name HOST_ACTIVATION_ROLLED_BACK \
        ! -name HOST_ACTIVATION_COMMITTED \) -o \
      \( -name 'HOST_ROLLBACK_*' \
        ! -name HOST_ROLLBACK_REQUIRED \
        ! -name HOST_ROLLBACK_COMPLETED \) -o \
      \( -name 'PUBLISH_*' \
        ! -name PUBLISH_COMMITTED ! -name PUBLISH_FINALIZED \) -o \
      \( -name 'RECOVERY_*' ! -name RECOVERY_REQUIRED \) \) \
    -print -quit)"; then
    host_activation_ledger_fail 70 "could not scan host activation state"
    return
  fi
  if [[ -n "${unsafe_path}" ]]; then
    host_activation_ledger_fail 70 \
      "a symlink or incomplete activation record blocks host activation"
    return
  fi
  if ! marker_paths="$(find -- "${backups_root}" \
    \( -name HOST_ACTIVATION_V1 -o -name HOST_ACTIVATION_PENDING -o \
      -name HOST_ACTIVATION_ROLLED_BACK -o -name HOST_ACTIVATION_COMMITTED -o \
      -name RECOVERY_REQUIRED -o -name HOST_ROLLBACK_REQUIRED -o \
      -name HOST_ROLLBACK_COMPLETED -o -name PUBLISH_COMMITTED -o \
      -name PUBLISH_FINALIZED \) -print)"; then
    host_activation_ledger_fail 70 "could not scan host activation state"
    return
  fi
  while IFS= read -r marker_path; do
    [[ -n "${marker_path}" ]] || continue
    state_directory="${marker_path%/*}"
    release_id="${state_directory##*/}"
    if ! host_activation_ledger_is_release_id "${release_id}" ||
      [[ "${state_directory}" != "${backups_root}/${release_id}" ]]; then
      host_activation_ledger_fail 70 \
        "activation ledger is outside its canonical release state directory"
      return
    fi
    inspected_release_ids+="${release_id}"$'\n'
  done <<<"${marker_paths}"

  if ! state_directories="$(find -- "${backups_root}" -mindepth 1 \
    -maxdepth 1 -type d -printf '%f\n')"; then
    host_activation_ledger_fail 70 \
      "could not enumerate host activation state directories"
    return
  fi
  while IFS= read -r release_id; do
    [[ -n "${release_id}" ]] || continue
    if host_activation_ledger_is_release_id "${release_id}"; then
      inspected_release_ids+="${release_id}"$'\n'
    fi
  done <<<"${state_directories}"

  if ! inspected_release_ids="$(LC_ALL=C sort -u \
    <<<"${inspected_release_ids}")"; then
    host_activation_ledger_fail 70 \
      "could not order host activation state directories"
    return
  fi
  while IFS= read -r release_id; do
    [[ -n "${release_id}" ]] || continue
    if [[ "${required_policy}" == "zero-active" &&
      "${release_id}" == "${expected_active_release}" ]]; then
      if [[ -e "${backups_root}/${release_id}/HOST_ACTIVATION_V1" ||
        -L "${backups_root}/${release_id}/HOST_ACTIVATION_V1" ]]; then
        host_activation_ledger_require_resumable_anchor \
          "${release_id}" "${deploy_root}" || return $?
      else
        host_activation_ledger_require_unarmed_candidate \
          "${release_id}" "${deploy_root}" || return $?
      fi
      continue
    fi
    host_activation_ledger_validate_release_state \
      "${release_id}" "${deploy_root}" || return $?
    if [[ "${HOST_ACTIVATION_LEDGER_CLASSIFICATION}" == "active" ]]; then
      active_count=$((active_count + 1))
      active_release="${release_id}"
    elif [[ "${HOST_ACTIVATION_LEDGER_CLASSIFICATION}" == "terminal" ]]; then
      host_activation_ledger_revalidate_terminal \
        "${release_id}" "${deploy_root}" "${node_binary}" || return $?
    fi
  done <<<"${inspected_release_ids}"
  case "${required_policy}" in
    zero-active)
      if [[ "${active_count}" -ne 0 ]]; then
        host_activation_ledger_fail 70 \
          "an active release ledger blocks host activation"
        return
      fi
      ;;
    allow-active)
      if [[ "${active_count}" -gt 1 ]] ||
        { [[ "${active_count}" -eq 1 ]] &&
          [[ -n "${expected_active_release}" ]] &&
          [[ "${active_release}" != "${expected_active_release}" ]]; }; then
        host_activation_ledger_fail 70 \
          "an unrelated active release ledger blocks this operation"
        return
      fi
      ;;
    *)
      host_activation_ledger_fail 64 "host activation scan policy is invalid"
      return
      ;;
  esac
  HOST_ACTIVATION_LEDGER_ACTIVE_COUNT="${active_count}"
  HOST_ACTIVATION_LEDGER_ACTIVE_RELEASE="${active_release}"
}

host_activation_ledger_require_lifecycle_lock() {
  local deploy_root="$1"
  local lock_path="${deploy_root}/.release-lifecycle.lock"
  local inherited_path

  if [[ "${DIESEL_RELEASE_LIFECYCLE_LOCK_FD:-}" != "8" ]] ||
    ! { true <&8; } 2>/dev/null ||
    ! inherited_path="$(realpath -- "/proc/$$/fd/8")" ||
    [[ "${inherited_path}" != "${lock_path}" ]]; then
    host_activation_ledger_fail 70 \
      "release lifecycle lock descriptor 8 is required"
    return
  fi
  # A descriptor that merely points at the lock inode is not proof that this
  # open-file-description owns the lifecycle flock. Reapplying flock is
  # idempotent for an inherited locked OFD, safely acquires an uncontended
  # unlocked OFD, and rejects a distinct OFD while another release owns it.
  if ! command -v flock >/dev/null 2>&1 || ! flock -n 8 2>/dev/null; then
    host_activation_ledger_fail 70 \
      "release lifecycle lock descriptor 8 is not exclusively locked"
    return
  fi
}

host_activation_ledger_write_record() {
  local destination="$1"
  local payload="$2"
  local node_binary="$3"
  local state_directory="${destination%/*}"
  local backups_root="${state_directory%/*}"
  local temporary_path=''

  host_activation_ledger_require_absent \
    "${destination}" "durable activation record" || return $?
  if ! temporary_path="$(mktemp -- \
    "${state_directory}/.${destination##*/}.XXXXXX")"; then
    host_activation_ledger_fail 70 "could not stage durable activation record"
    return
  fi
  if ! chown -- root:root "${temporary_path}" ||
    ! chmod -- 600 "${temporary_path}" ||
    ! printf '%s\n' "${payload}" >"${temporary_path}" ||
    ! host_activation_ledger_require_file \
      "${temporary_path}" "root:root:600" "staged activation record" ||
    ! host_activation_ledger_fsync_paths "${node_binary}" "${temporary_path}" ||
    ! mv -Tf -- "${temporary_path}" "${destination}"; then
    rm -f -- "${temporary_path}" 2>/dev/null || true
    host_activation_ledger_fail 70 "could not persist durable activation record"
    return
  fi
  host_activation_ledger_fsync_paths \
    "${node_binary}" "${destination}" "${state_directory}" "${backups_root}"
}

host_activation_ledger_require_live_basis() {
  local release_id="$1"
  local deploy_root="$2"
  local nginx_sites_root="$3"
  local shared_root="${deploy_root}/shared"
  local environment_path="${shared_root}/.env.production.local"
  local nginx_primary_path="${nginx_sites_root}/jamesky.site"
  local nginx_alternate_path="${nginx_sites_root}/diesel-demo"
  local current_link="${deploy_root}/current"
  local current_release

  host_activation_ledger_validate_common_layout \
    "${release_id}" "${deploy_root}" || return $?
  host_activation_ledger_build_anchor_payload \
    "${release_id}" "${deploy_root}" || return $?
  host_activation_ledger_require_directory \
    "${shared_root}" "root:diesel:750" "shared runtime root" || return $?
  host_activation_ledger_require_directory \
    "${nginx_sites_root}" "root:root:755" "Nginx sites root" || return $?
  host_activation_ledger_require_file \
    "${environment_path}" "root:diesel:640" \
    "live runtime environment" || return $?
  host_activation_ledger_require_file \
    "${nginx_primary_path}" "root:root:644" \
    "live primary Nginx configuration" || return $?
  host_activation_ledger_require_file \
    "${nginx_alternate_path}" "root:root:644" \
    "live alternate Nginx configuration" || return $?
  if [[ ! -L "${current_link}" ]] ||
    ! current_release="$(realpath -- "${current_link}")" ||
    [[ "${current_release}" != \
      "${HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_PATH}" ]]; then
    host_activation_ledger_fail 70 \
      "current does not match the persisted previous release"
    return
  fi
  if ! cmp -s -- \
      "${HOST_ACTIVATION_LEDGER_ENVIRONMENT_BACKUP}" \
      "${environment_path}" ||
    ! cmp -s -- \
      "${HOST_ACTIVATION_LEDGER_NGINX_PRIMARY_BACKUP}" \
      "${nginx_primary_path}" ||
    ! cmp -s -- \
      "${HOST_ACTIVATION_LEDGER_NGINX_ALTERNATE_BACKUP}" \
      "${nginx_alternate_path}"; then
    host_activation_ledger_fail 70 \
      "live host state does not match the rollback basis"
    return
  fi
}

host_activation_ledger_begin() {
  local release_id="$1"
  local deploy_root="$2"
  local node_binary="$3"
  local nginx_sites_root="${4:-/etc/nginx/sites-available}"

  host_activation_ledger_validate_common_layout \
    "${release_id}" "${deploy_root}" || return $?
  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
  host_activation_ledger_require_live_basis \
    "${release_id}" "${deploy_root}" "${nginx_sites_root}" || return $?
  host_activation_ledger_scan_all \
    "${deploy_root}" "${node_binary}" zero-active \
    "${release_id}" || return $?
  host_activation_ledger_set_paths "${release_id}" "${deploy_root}"
  local host_marker
  for host_marker in \
    "${HOST_ACTIVATION_LEDGER_PENDING}" \
    "${HOST_ACTIVATION_LEDGER_ROLLED_BACK}" \
    "${HOST_ACTIVATION_LEDGER_COMMITTED}" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/RECOVERY_REQUIRED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ROLLBACK_REQUIRED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ROLLBACK_COMPLETED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/PUBLISH_COMMITTED" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/PUBLISH_FINALIZED"; do
    host_activation_ledger_require_absent \
      "${host_marker}" "pre-activation state marker" || return $?
  done
  if [[ -e "${HOST_ACTIVATION_LEDGER_ANCHOR}" ||
    -L "${HOST_ACTIVATION_LEDGER_ANCHOR}" ]]; then
    host_activation_ledger_require_resumable_anchor \
      "${release_id}" "${deploy_root}" || return $?
  else
    host_activation_ledger_build_anchor_payload \
      "${release_id}" "${deploy_root}" || return $?
    host_activation_ledger_fsync_paths \
      "${node_binary}" \
      "${HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_FILE}" \
      "${HOST_ACTIVATION_LEDGER_ENVIRONMENT_BACKUP}" \
      "${HOST_ACTIVATION_LEDGER_NGINX_PRIMARY_BACKUP}" \
      "${HOST_ACTIVATION_LEDGER_NGINX_ALTERNATE_BACKUP}" \
      "${HOST_ACTIVATION_LEDGER_PROTOCOL_MANIFEST}" \
      "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}" \
      "${HOST_ACTIVATION_LEDGER_BACKUPS_ROOT}" "${deploy_root}" || return $?
    host_activation_ledger_write_record \
      "${HOST_ACTIVATION_LEDGER_ANCHOR}" \
      "${HOST_ACTIVATION_LEDGER_ANCHOR_PAYLOAD}" \
      "${node_binary}" || return $?
    host_activation_ledger_parse_anchor \
      "${release_id}" "${deploy_root}" || return $?
  fi
  host_activation_ledger_write_record \
    "${HOST_ACTIVATION_LEDGER_PENDING}" \
    "${HOST_ACTIVATION_LEDGER_ANCHOR_SHA256}"$'\t'\
"${HOST_ACTIVATION_LEDGER_ANCHOR}" \
    "${node_binary}" || return $?
  host_activation_ledger_validate_release_state \
    "${release_id}" "${deploy_root}" || return $?
  if [[ "${HOST_ACTIVATION_LEDGER_PROTOCOL}" != "v1" ||
    "${HOST_ACTIVATION_LEDGER_STATE}" != "PENDING" ||
    "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != "none" ]]; then
    host_activation_ledger_fail 70 "host activation did not enter PENDING"
    return
  fi
  host_activation_ledger_require_live_basis \
    "${release_id}" "${deploy_root}" "${nginx_sites_root}" || return $?
  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
  host_activation_ledger_validate_release_state \
    "${release_id}" "${deploy_root}" || return $?
  if [[ "${HOST_ACTIVATION_LEDGER_STATE}" != "PENDING" ||
    "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != "none" ]]; then
    host_activation_ledger_fail 70 \
      "host activation changed after live-state verification"
    return
  fi
}

host_activation_ledger_require_pending() {
  local release_id="$1"
  local deploy_root="$2"
  local node_binary="$3"

  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
  host_activation_ledger_validate_release_state \
    "${release_id}" "${deploy_root}" || return $?
  if [[ "${HOST_ACTIVATION_LEDGER_PROTOCOL}" != "v1" ||
    "${HOST_ACTIVATION_LEDGER_STATE}" != "PENDING" ||
    "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" != "none" ]]; then
    host_activation_ledger_fail 70 \
      "runtime preparation requires PENDING host activation state"
    return
  fi
  host_activation_ledger_fsync_paths \
    "${node_binary}" \
    "${HOST_ACTIVATION_LEDGER_PROTOCOL_MANIFEST}" \
    "${HOST_ACTIVATION_LEDGER_ANCHOR}" \
    "${HOST_ACTIVATION_LEDGER_PENDING}" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}" \
    "${HOST_ACTIVATION_LEDGER_BACKUPS_ROOT}" || return $?
  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
  host_activation_ledger_validate_release_state \
    "${release_id}" "${deploy_root}"
}

host_activation_ledger_transition() {
  local release_id="$1"
  local deploy_root="$2"
  local node_binary="$3"
  local destination_state="$4"
  local source_marker
  local destination_marker

  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
  host_activation_ledger_validate_release_state \
    "${release_id}" "${deploy_root}" || return $?
  if [[ "${HOST_ACTIVATION_LEDGER_PROTOCOL}" != "v1" ]]; then
    host_activation_ledger_fail 70 \
      "host activation transition requires the V1 protocol"
    return
  fi
  case "${destination_state}" in
    ROLLED_BACK)
      if [[ "${HOST_ACTIVATION_LEDGER_STATE}" == "ROLLED_BACK" ]]; then
        destination_marker="${HOST_ACTIVATION_LEDGER_ROLLED_BACK}"
      elif [[ "${HOST_ACTIVATION_LEDGER_STATE}" == "PENDING" ]] &&
        [[ "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" == "none" ||
          "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" == \
            "HOST_ROLLBACK_REQUIRED" ]]; then
        source_marker="${HOST_ACTIVATION_LEDGER_PENDING}"
        destination_marker="${HOST_ACTIVATION_LEDGER_ROLLED_BACK}"
      else
        host_activation_ledger_fail 70 \
          "host activation cannot transition to ROLLED_BACK"
        return
      fi
      ;;
    COMMITTED)
      if [[ "${HOST_ACTIVATION_LEDGER_STATE}" == "COMMITTED" ]]; then
        destination_marker="${HOST_ACTIVATION_LEDGER_COMMITTED}"
      elif [[ "${HOST_ACTIVATION_LEDGER_STATE}" == "PENDING" ]] &&
        [[ "${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}" == \
          "PUBLISH_FINALIZED" ]]; then
        source_marker="${HOST_ACTIVATION_LEDGER_PENDING}"
        destination_marker="${HOST_ACTIVATION_LEDGER_COMMITTED}"
      else
        host_activation_ledger_fail 70 \
          "host activation cannot transition to COMMITTED"
        return
      fi
      ;;
    *)
      host_activation_ledger_fail 64 "host activation destination is invalid"
      return
      ;;
  esac
  if [[ -n "${source_marker:-}" ]]; then
    host_activation_ledger_require_absent \
      "${destination_marker}" "destination host activation marker" || return $?
    mv -Tf -- "${source_marker}" "${destination_marker}" || return $?
  fi
  host_activation_ledger_fsync_paths \
    "${node_binary}" \
    "${HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_FILE}" \
    "${HOST_ACTIVATION_LEDGER_ENVIRONMENT_BACKUP}" \
    "${HOST_ACTIVATION_LEDGER_NGINX_PRIMARY_BACKUP}" \
    "${HOST_ACTIVATION_LEDGER_NGINX_ALTERNATE_BACKUP}" \
    "${HOST_ACTIVATION_LEDGER_PROTOCOL_MANIFEST}" \
    "${HOST_ACTIVATION_LEDGER_ANCHOR}" "${destination_marker}" \
    "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}" \
    "${HOST_ACTIVATION_LEDGER_BACKUPS_ROOT}" || return $?
  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
  host_activation_ledger_validate_release_state \
    "${release_id}" "${deploy_root}" || return $?
  if [[ "${HOST_ACTIVATION_LEDGER_STATE}" != "${destination_state}" ]]; then
    host_activation_ledger_fail 70 "host activation transition did not converge"
    return
  fi
}

host_activation_ledger_revalidate_terminal() {
  local release_id="$1"
  local deploy_root="$2"
  local node_binary="$3"
  local marker_path

  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
  host_activation_ledger_validate_release_state \
    "${release_id}" "${deploy_root}" || return $?
  if [[ "${HOST_ACTIVATION_LEDGER_CLASSIFICATION}" != "terminal" ]]; then
    host_activation_ledger_fail 70 "host activation state is not terminal"
    return
  fi
  if [[ "${HOST_ACTIVATION_LEDGER_PROTOCOL}" == "v1" ]]; then
    marker_path="${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/HOST_ACTIVATION_${HOST_ACTIVATION_LEDGER_STATE}"
    host_activation_ledger_fsync_paths \
      "${node_binary}" \
      "${HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_FILE}" \
      "${HOST_ACTIVATION_LEDGER_ENVIRONMENT_BACKUP}" \
      "${HOST_ACTIVATION_LEDGER_NGINX_PRIMARY_BACKUP}" \
      "${HOST_ACTIVATION_LEDGER_NGINX_ALTERNATE_BACKUP}" \
      "${HOST_ACTIVATION_LEDGER_ANCHOR}" "${marker_path}" \
      "${HOST_ACTIVATION_LEDGER_PROTOCOL_MANIFEST}" \
      "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}" \
      "${HOST_ACTIVATION_LEDGER_BACKUPS_ROOT}" || return $?
  else
    marker_path="${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}"
    host_activation_ledger_fsync_paths \
      "${node_binary}" "${HOST_ACTIVATION_LEDGER_PROTOCOL_MANIFEST}" \
      "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}/governance-before.json" \
      "${marker_path}" "${HOST_ACTIVATION_LEDGER_STATE_DIRECTORY}" \
      "${HOST_ACTIVATION_LEDGER_BACKUPS_ROOT}" || return $?
  fi
  host_activation_ledger_require_lifecycle_lock "${deploy_root}" || return $?
  host_activation_ledger_validate_release_state \
    "${release_id}" "${deploy_root}"
}

host_activation_ledger_state_machine() (
  set -Eeuo pipefail

  if [[ "$#" -ne 4 ]]; then
    host_activation_ledger_fail 64 \
      "internal interface requires mode, release ID, deploy root, and Node"
    return
  fi
  local mode="$1"
  local release_id="$2"
  local deploy_root="$3"
  local node_binary="$4"

  case "${mode}" in
    initialize-protocol)
      host_activation_ledger_initialize_protocol \
        "${release_id}" "${deploy_root}" "${node_binary}"
      ;;
    begin)
      host_activation_ledger_begin \
        "${release_id}" "${deploy_root}" "${node_binary}"
      ;;
    validate)
      host_activation_ledger_validate_release_state \
        "${release_id}" "${deploy_root}"
      ;;
    require-pending)
      host_activation_ledger_require_pending \
        "${release_id}" "${deploy_root}" "${node_binary}"
      ;;
    mark-rolled-back)
      host_activation_ledger_transition \
        "${release_id}" "${deploy_root}" "${node_binary}" ROLLED_BACK
      ;;
    mark-committed)
      host_activation_ledger_transition \
        "${release_id}" "${deploy_root}" "${node_binary}" COMMITTED
      ;;
    *)
      host_activation_ledger_fail 64 "host activation mode is invalid"
      return
      ;;
  esac
)

host_activation_ledger_main() (
  set -Eeuo pipefail

  if [[ "$#" -ne 2 ]]; then
    host_activation_ledger_usage
    return 64
  fi
  local mode="$1"
  local release_id="$2"
  local deploy_root="/opt/diesel"
  local node_binary="/opt/node-v22.22.3-linux-x64/bin/node"
  local lock_path="${deploy_root}/.release-lifecycle.lock"
  local command_name

  case "$1" in
    initialize-protocol | validate) ;;
    *)
      host_activation_ledger_usage
      return 64
      ;;
  esac
  if [[ "$(id -u)" != "0" ]]; then
    host_activation_ledger_fail 77 "host activation ledger must run as root"
    return
  fi
  for command_name in chmod chown find flock mktemp mv realpath sha256sum sort stat; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      host_activation_ledger_fail 70 \
        "required host activation command is unavailable: ${command_name}"
      return
    fi
  done
  host_activation_ledger_require_file \
    "${lock_path}" "root:root:600" "release lifecycle lock" || return $?
  exec 8<>"${lock_path}"
  export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
  if ! flock -n 8; then
    host_activation_ledger_fail 70 "another release lifecycle operation is active"
    return
  fi
  host_activation_ledger_state_machine \
    "${mode}" "${release_id}" "${deploy_root}" "${node_binary}"
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  host_activation_ledger_main "$@"
fi
