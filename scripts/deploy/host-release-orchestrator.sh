#!/bin/bash

# This file is intentionally sourceable. Tests replace the named side-effect
# functions below and exercise the parent state machine in a disposable shell.
# The direct CLI fixes every production path and refuses path overrides.

HOST_RELEASE_ORCHESTRATOR_USAGE_STATUS=64
HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS=70
HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS=75
HOST_RELEASE_ORCHESTRATOR_NOT_ROOT_STATUS=77
HOST_RELEASE_ORCHESTRATOR_ROOT_PATH="/usr/sbin:/usr/bin:/sbin:/bin"
HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT="/opt/diesel"
HOST_RELEASE_ORCHESTRATOR_NODE_BINARY="/opt/node-v22.22.3-linux-x64/bin/node"
HOST_RELEASE_ORCHESTRATOR_NGINX_ROOT="/etc/nginx/sites-available"
HOST_RELEASE_ORCHESTRATOR_INPUT_ROOT="/opt/diesel/release-inputs"
HOST_RELEASE_ORCHESTRATOR_MAX_ENVIRONMENT_BYTES=1048576

host_release_orchestrator_usage() {
  echo "usage: host-release-orchestrator.sh <40-character-lowercase-git-sha> <fixed-root-only-environment-candidate>" >&2
}

host_release_orchestrator_fail() {
  local status="$1"
  shift
  echo "$*" >&2
  return "${status}"
}

host_release_orchestrator_is_commit() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

host_release_orchestrator_sourced_production_root_is_selected() {
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

host_release_orchestrator_cli_metadata_is_allowed() {
  local profile="$1"
  local metadata="$2"

  case "${profile}:${metadata}" in
    system-directory:root:root:755 | \
      release-directory:root:root:755 | \
      release-directory:root:diesel:750 | \
      release-executable:root:root:755:1 | \
      release-executable:root:diesel:750:1 | \
      release-file:root:root:644:1 | \
      release-file:root:diesel:640:1 | \
      private-directory:root:root:700 | \
      private-file:root:root:600:1) return 0 ;;
    *) return 1 ;;
  esac
}

host_release_orchestrator_require_cli_path() {
  local path="$1"
  local profile="$2"
  local canonical_path
  local metadata

  case "${profile}" in
    system-directory | release-directory | private-directory)
      [[ -d "${path}" && ! -L "${path}" ]] || return 1
      metadata="$(/usr/bin/stat -c '%U:%G:%a' -- "${path}" 2>/dev/null)" ||
        return 1
      ;;
    release-executable)
      [[ -f "${path}" && ! -L "${path}" && -x "${path}" ]] || return 1
      metadata="$(/usr/bin/stat -c '%U:%G:%a:%h' -- "${path}" 2>/dev/null)" ||
        return 1
      ;;
    release-file | private-file)
      [[ -f "${path}" && ! -L "${path}" ]] || return 1
      metadata="$(/usr/bin/stat -c '%U:%G:%a:%h' -- "${path}" 2>/dev/null)" ||
        return 1
      ;;
    *) return 1 ;;
  esac
  canonical_path="$(/usr/bin/realpath -e -- "${path}" 2>/dev/null)" || return 1
  [[ "${canonical_path}" == "${path}" ]] || return 1
  host_release_orchestrator_cli_metadata_is_allowed "${profile}" "${metadata}"
}

host_release_orchestrator_candidate_metadata_is_allowed() {
  local owner="$1"
  local group="$2"
  local mode="$3"
  local link_count="$4"
  local size="$5"

  [[ "${owner}" == "0" && "${group}" == "0" && "${mode}" == "600" &&
    "${link_count}" == "1" && "${size}" =~ ^[0-9]+$ ]] || return 1
  (( size > 0 && size <= HOST_RELEASE_ORCHESTRATOR_MAX_ENVIRONMENT_BYTES ))
}

host_release_orchestrator_cli_bootstrap() {
  if [[ "$#" -ne 4 ]] || ! host_release_orchestrator_is_commit "$1"; then
    return "${HOST_RELEASE_ORCHESTRATOR_USAGE_STATUS}"
  fi
  local release_id="$1"
  local candidate_path="$2"
  local deploy_root="$3"
  local observed_entry="$4"
  local release_dir="${deploy_root}/releases/${release_id}"
  local expected_entry="${release_dir}/scripts/deploy/host-release-orchestrator.sh"
  local expected_candidate="${deploy_root}/release-inputs/${release_id}/env.production.local"
  local candidate_metadata
  local candidate_owner
  local candidate_group
  local candidate_mode
  local candidate_links
  local candidate_size

  if host_release_orchestrator_sourced_production_root_is_selected \
    "${deploy_root}"; then
    return "${HOST_RELEASE_ORCHESTRATOR_USAGE_STATUS}"
  fi
  if [[ "${observed_entry}" != "${expected_entry}" ||
    "${candidate_path}" != "${expected_candidate}" ]]; then
    return "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}"
  fi
  if ! host_release_orchestrator_require_cli_path /opt system-directory ||
    ! host_release_orchestrator_require_cli_path \
      "${deploy_root}" system-directory ||
    ! host_release_orchestrator_require_cli_path \
      "${deploy_root}/releases" system-directory ||
    ! host_release_orchestrator_require_cli_path \
      "${release_dir}" release-directory ||
    ! host_release_orchestrator_require_cli_path \
      "${release_dir}/scripts" release-directory ||
    ! host_release_orchestrator_require_cli_path \
      "${release_dir}/scripts/deploy" release-directory ||
    ! host_release_orchestrator_require_cli_path \
      "${expected_entry}" release-executable ||
    ! host_release_orchestrator_require_cli_path \
      "${deploy_root}/release-inputs" private-directory ||
    ! host_release_orchestrator_require_cli_path \
      "${deploy_root}/release-inputs/${release_id}" private-directory ||
    ! host_release_orchestrator_require_cli_path \
      "${candidate_path}" private-file; then
    return "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}"
  fi
  candidate_metadata="$(
    /usr/bin/stat -c '%u:%g:%a:%h:%s' -- "${candidate_path}" 2>/dev/null
  )" || return "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}"
  IFS=: read -r candidate_owner candidate_group candidate_mode \
    candidate_links candidate_size <<<"${candidate_metadata}"
  host_release_orchestrator_candidate_metadata_is_allowed \
    "${candidate_owner}" "${candidate_group}" "${candidate_mode}" \
    "${candidate_links}" "${candidate_size}" ||
    return "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}"
}

host_release_orchestrator_configure_production() {
  local release_id="$1"
  local candidate_path="$2"

  HOST_RELEASE_ORCHESTRATOR_RELEASE_ID="${release_id}"
  HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH="${candidate_path}"
  HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR="${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/releases/${release_id}"
  HOST_RELEASE_ORCHESTRATOR_STATE_DIR="${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/backups/${release_id}"
  HOST_RELEASE_ORCHESTRATOR_PREVIOUS_RELEASE_FILE="${HOST_RELEASE_ORCHESTRATOR_STATE_DIR}/previous-release"
  HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_BACKUP="${HOST_RELEASE_ORCHESTRATOR_STATE_DIR}/env.production.local.pre-switch"
  HOST_RELEASE_ORCHESTRATOR_NGINX_PRIMARY_BACKUP="${HOST_RELEASE_ORCHESTRATOR_STATE_DIR}/jamesky.site.pre-switch"
  HOST_RELEASE_ORCHESTRATOR_NGINX_ALTERNATE_BACKUP="${HOST_RELEASE_ORCHESTRATOR_STATE_DIR}/diesel-demo.pre-switch"
  HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT="${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/shared/.env.production.local"
  HOST_RELEASE_ORCHESTRATOR_NGINX_PRIMARY="${HOST_RELEASE_ORCHESTRATOR_NGINX_ROOT}/jamesky.site"
  HOST_RELEASE_ORCHESTRATOR_NGINX_ALTERNATE="${HOST_RELEASE_ORCHESTRATOR_NGINX_ROOT}/diesel-demo"
  HOST_RELEASE_ORCHESTRATOR_LEDGER="${HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR}/scripts/deploy/host-activation-ledger.sh"
  HOST_RELEASE_ORCHESTRATOR_ROLLBACK="${HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR}/scripts/deploy/rollback-host-release.sh"
  HOST_RELEASE_ORCHESTRATOR_CONTROLLER="${HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR}/scripts/deploy/release-publication-controller.sh"
  HOST_RELEASE_ORCHESTRATOR_GOVERNANCE="${HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR}/scripts/deploy/governance-publication-state-machine.sh"
  HOST_RELEASE_ORCHESTRATOR_MAINTENANCE_WRAPPER="${HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR}/scripts/db/with-governance-maintenance-lock.ts"
  HOST_RELEASE_ORCHESTRATOR_RUNTIME_ENVIRONMENT_CONTRACT="${HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR}/scripts/deploy/runtime-environment-contract.cjs"
  HOST_RELEASE_ORCHESTRATOR_LOCK_PATH="${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/.release-lifecycle.lock"
  HOST_RELEASE_ORCHESTRATOR_CANDIDATE_FINGERPRINT=""
  HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP=""
  HOST_RELEASE_ORCHESTRATOR_DIESEL_GID=""
}

host_release_orchestrator_require_fixed_executable() {
  local path="$1"
  local label="$2"
  local canonical_path
  local metadata
  local owner
  local group
  local mode
  local links
  local permissions

  if [[ ! -f "${path}" || -L "${path}" || ! -x "${path}" ]] ||
    ! canonical_path="$(/usr/bin/realpath -e -- "${path}")" ||
    [[ "${canonical_path}" != "${path}" ]] ||
    ! metadata="$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${path}")"; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "${label} is not a trusted executable"
    return
  fi
  IFS=: read -r owner group mode links <<<"${metadata}"
  if [[ "${owner}" != "0" || "${group}" != "0" || "${links}" != "1" ||
    ! "${mode}" =~ ^[0-7]{3,4}$ ]]; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "${label} has unsafe metadata"
    return
  fi
  permissions=$((8#${mode}))
  if (( (permissions & 07000) != 0 || (permissions & 0022) != 0 ||
    (permissions & 0100) == 0 )); then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "${label} is outside the fixed executable profile"
    return
  fi
}

host_release_orchestrator_require_fixed_command_boundary() {
  local command_name
  local command_spec
  local expected_path
  local resolved_path
  local version
  local -a command_specs=(
    "bash:/usr/bin/bash"
    "chmod:/usr/bin/chmod"
    "cmp:/usr/bin/cmp"
    "cp:/usr/bin/cp"
    "env:/usr/bin/env"
    "find:/usr/bin/find"
    "flock:/usr/bin/flock"
    "id:/usr/bin/id"
    "install:/usr/bin/install"
    "mktemp:/usr/bin/mktemp"
    "mv:/usr/bin/mv"
    "readlink:/usr/bin/readlink"
    "realpath:/usr/bin/realpath"
    "rm:/usr/bin/rm"
    "sha256sum:/usr/bin/sha256sum"
    "sort:/usr/bin/sort"
    "stat:/usr/bin/stat"
  )

  export PATH="${HOST_RELEASE_ORCHESTRATOR_ROOT_PATH}"
  for command_spec in "${command_specs[@]}"; do
    command_name="${command_spec%%:*}"
    expected_path="${command_spec#*:}"
    resolved_path="$(command -v "${command_name}")"
    if [[ "${resolved_path}" != "${expected_path}" ]]; then
      host_release_orchestrator_fail \
        "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
        "host release command does not resolve to its fixed path: ${command_name}"
      return
    fi
    host_release_orchestrator_require_fixed_executable \
      "${expected_path}" "fixed host release command ${command_name}" || return $?
  done
  if [[ ! -f "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}" ||
    -L "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}" ||
    ! -x "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}" ]] ||
    [[ "$(/usr/bin/realpath -e -- "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}")" != \
      "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}" ]] ||
    [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- \
      "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}")" != "0:0:755:1" ]] ||
    ! version="$("${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}" --version)" ||
    [[ "${version}" != "v22.22.3" ]]; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "fixed Node.js runtime is outside the host release profile"
    return
  fi
}

host_release_orchestrator_require_release_inputs() {
  local release_executable

  for release_executable in \
    "${HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR}/scripts/deploy/host-release-orchestrator.sh" \
    "${HOST_RELEASE_ORCHESTRATOR_CONTROLLER}" \
    "${HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR}/scripts/deploy/prepare-release-runtime.sh" \
    "${HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR}/scripts/deploy/activate-host-release.sh" \
    "${HOST_RELEASE_ORCHESTRATOR_ROLLBACK}" \
    "${HOST_RELEASE_ORCHESTRATOR_GOVERNANCE}" \
    "${HOST_RELEASE_ORCHESTRATOR_LEDGER}"; do
    host_release_orchestrator_require_cli_path \
      "${release_executable}" release-executable || {
      host_release_orchestrator_fail \
        "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
        "versioned host release executable failed trust validation"
      return
    }
  done
  host_release_orchestrator_require_cli_path \
    "${HOST_RELEASE_ORCHESTRATOR_MAINTENANCE_WRAPPER}" release-file || {
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "versioned maintenance wrapper failed trust validation"
    return
  }
  host_release_orchestrator_require_cli_path \
    "${HOST_RELEASE_ORCHESTRATOR_RUNTIME_ENVIRONMENT_CONTRACT}" release-file || {
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "versioned runtime environment contract failed trust validation"
    return
  }
}

host_release_orchestrator_capture_candidate_fingerprint() {
  local candidate_path="$1"
  local live_path="$2"
  local diesel_gid="$3"

  "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}" -e '
    const { isUtf8 } = require("node:buffer");
    const { createHash } = require("node:crypto");
    const { closeSync, constants, fstatSync, openSync, readFileSync } = require("node:fs");
    const { parseEnv } = require("node:util");
    const [candidatePath, livePath, contractPath, dieselGidText, maxBytesText] = process.argv.slice(1);
    const {
      validateProductionAiAdmissionConfiguration,
      validateProductionAiChatRateLimitConfiguration,
    } = require(contractPath);
    const dieselGid = Number(dieselGidText);
    const maxBytes = Number(maxBytesText);
    function read(path, expectedGid, expectedMode) {
      let descriptor;
      try {
        descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const before = fstatSync(descriptor, { bigint: true });
        if (!before.isFile() || before.uid !== 0n || before.gid !== BigInt(expectedGid) ||
            (before.mode & 0o7777n) !== BigInt(expectedMode) || before.nlink !== 1n ||
            before.size <= 0n || before.size > BigInt(maxBytes)) throw new Error();
        const bytes = readFileSync(descriptor);
        const after = fstatSync(descriptor, { bigint: true });
        for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
          if (before[key] !== after[key]) throw new Error();
        }
        if (!isUtf8(bytes)) throw new Error();
        const values = parseEnv(bytes.toString("utf8"));
        const databaseUrl = values.DATABASE_URL;
        if (typeof databaseUrl !== "string" || databaseUrl.length === 0) throw new Error();
        const protocol = new URL(databaseUrl).protocol;
        if (protocol !== "postgres:" && protocol !== "postgresql:") throw new Error();
        return {
          bytes,
          databaseUrl,
          values,
          fingerprint: [before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs,
            createHash("sha256").update(bytes).digest("hex")].join(":"),
        };
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
    }
    try {
      const candidate = read(candidatePath, 0, 0o600);
      const live = read(livePath, dieselGid, 0o640);
      if (candidate.databaseUrl !== live.databaseUrl) throw new Error();
      validateProductionAiAdmissionConfiguration(candidate.values);
      validateProductionAiChatRateLimitConfiguration(candidate.values);
      process.stdout.write(`${candidate.fingerprint}\n`);
    } catch {
      process.stderr.write("environment candidate validation failed\n");
      process.exit(70);
    }
  ' -- "${candidate_path}" "${live_path}" \
    "${HOST_RELEASE_ORCHESTRATOR_RUNTIME_ENVIRONMENT_CONTRACT}" "${diesel_gid}" \
    "${HOST_RELEASE_ORCHESTRATOR_MAX_ENVIRONMENT_BYTES}" 8>&-
}

host_release_orchestrator_validate_environment_readback() {
  local backup_path="$1"
  local candidate_path="$2"
  local live_path="$3"
  local diesel_gid="$4"

  "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}" -e '
    const [backupPath, candidatePath, livePath, contractPath, dieselGidText, maxBytesText] = process.argv.slice(1);
    const {
      READBACK_ERROR_CODES,
      validateInstalledProductionEnvironmentFiles,
    } = require(contractPath);
    try {
      validateInstalledProductionEnvironmentFiles({
        backupPath,
        candidatePath,
        liveGid: Number(dieselGidText),
        livePath,
        maxBytes: Number(maxBytesText),
        ownerGid: 0,
        ownerUid: 0,
      });
    } catch (error) {
      const messages = {
        [READBACK_ERROR_CODES.AI_ADMISSION_INVALID]:
          "production AI admission configuration is invalid",
        [READBACK_ERROR_CODES.AI_RATE_LIMIT_INVALID]:
          "production AI hourly rate-limit configuration is invalid",
        [READBACK_ERROR_CODES.DATABASE_IDENTITY_CHANGED]:
          "production database identity changed during release",
        [READBACK_ERROR_CODES.ENVIRONMENT_CONTENT_MISMATCH]:
          "installed production environment differs from candidate",
        [READBACK_ERROR_CODES.ENVIRONMENT_READBACK_INVALID]:
          "production environment readback failed",
      };
      process.stderr.write(`${messages[error?.code] ?? "production environment readback failed"}\n`);
      process.exit(70);
    }
  ' -- "${backup_path}" "${candidate_path}" "${live_path}" \
    "${HOST_RELEASE_ORCHESTRATOR_RUNTIME_ENVIRONMENT_CONTRACT}" "${diesel_gid}" \
    "${HOST_RELEASE_ORCHESTRATOR_MAX_ENVIRONMENT_BYTES}" 8>&-
}

host_release_orchestrator_fsync_paths() {
  "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}" -e '
    const { closeSync, fsyncSync, openSync } = require("node:fs");
    try {
      for (const path of process.argv.slice(1)) {
        const descriptor = openSync(path, "r");
        try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
      }
    } catch {
      process.stderr.write("host release durability proof failed\n");
      process.exit(70);
    }
  ' -- "$@" 8>&-
}

host_release_orchestrator_require_exact_directory() {
  local path="$1"
  local expected_metadata="$2"

  [[ -d "${path}" && ! -L "${path}" ]] || return 1
  [[ "$(/usr/bin/realpath -e -- "${path}" 2>/dev/null)" == "${path}" ]] ||
    return 1
  [[ "$(/usr/bin/stat -c '%u:%g:%a' -- "${path}" 2>/dev/null)" == \
    "${expected_metadata}" ]]
}

host_release_orchestrator_require_exact_file() {
  local path="$1"
  local expected_metadata="$2"

  [[ -f "${path}" && ! -L "${path}" ]] || return 1
  [[ "$(/usr/bin/realpath -e -- "${path}" 2>/dev/null)" == "${path}" ]] ||
    return 1
  [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${path}" 2>/dev/null)" == \
    "${expected_metadata}" ]]
}

host_release_orchestrator_preflight_candidate() {
  if [[ "${EUID}" != "0" ]]; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_NOT_ROOT_STATUS}" \
      "host release orchestrator must run as root"
    return
  fi
  host_release_orchestrator_require_fixed_command_boundary || return $?
  host_release_orchestrator_require_release_inputs || return $?
  if ! HOST_RELEASE_ORCHESTRATOR_DIESEL_GID="$(/usr/bin/id -g diesel)" ||
    [[ ! "${HOST_RELEASE_ORCHESTRATOR_DIESEL_GID}" =~ ^[1-9][0-9]*$ ]]; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "diesel runtime identity is unavailable"
    return
  fi
  if ! host_release_orchestrator_require_exact_directory \
      "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/shared" \
      "0:${HOST_RELEASE_ORCHESTRATOR_DIESEL_GID}:750" ||
    ! host_release_orchestrator_require_exact_file \
      "${HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT}" \
      "0:${HOST_RELEASE_ORCHESTRATOR_DIESEL_GID}:640:1" ||
    ! host_release_orchestrator_require_exact_file \
      "${HOST_RELEASE_ORCHESTRATOR_LOCK_PATH}" "0:0:600:1" ||
    ! host_release_orchestrator_require_exact_directory \
      "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/backups" "0:0:700" ||
    ! host_release_orchestrator_require_exact_file \
      "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/backups/HOST_ACTIVATION_PROTOCOL_V1" \
      "0:0:600:1" ||
    ! host_release_orchestrator_require_exact_directory \
      "${HOST_RELEASE_ORCHESTRATOR_NGINX_ROOT}" "0:0:755" ||
    ! host_release_orchestrator_require_exact_file \
      "${HOST_RELEASE_ORCHESTRATOR_NGINX_PRIMARY}" "0:0:644:1" ||
    ! host_release_orchestrator_require_exact_file \
      "${HOST_RELEASE_ORCHESTRATOR_NGINX_ALTERNATE}" "0:0:644:1"; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "host release state is outside the fixed ownership profile"
    return
  fi
  if ! HOST_RELEASE_ORCHESTRATOR_CANDIDATE_FINGERPRINT="$(
      host_release_orchestrator_capture_candidate_fingerprint \
        "${HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH}" \
        "${HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT}" \
        "${HOST_RELEASE_ORCHESTRATOR_DIESEL_GID}"
    )" ||
    [[ ! "${HOST_RELEASE_ORCHESTRATOR_CANDIDATE_FINGERPRINT}" =~ \
      ^[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9a-f]{64}$ ]]; then
    return "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}"
  fi
  # Only after every sibling has passed the pre-source boundary may the parent
  # load the strict ledger parser used for terminal routing.
  source -- "${HOST_RELEASE_ORCHESTRATOR_LEDGER}" || {
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "host activation ledger source failed"
    return
  }
}

host_release_orchestrator_acquire_lock() {
  exec 8<>"${HOST_RELEASE_ORCHESTRATOR_LOCK_PATH}" || return 70
  HOST_RELEASE_ORCHESTRATOR_LOCK_OPEN=1
  export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
  if ! /usr/bin/flock -n 8; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "another release lifecycle operation is active"
    return
  fi
}

host_release_orchestrator_persist_basis() {
  local previous_release
  local live_before
  local live_after

  if [[ -e "${HOST_RELEASE_ORCHESTRATOR_STATE_DIR}" ||
    -L "${HOST_RELEASE_ORCHESTRATOR_STATE_DIR}" ]]; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "release state directory already exists"
    return
  fi
  previous_release="$(
    /usr/bin/readlink -f -- "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/current"
  )" || return 70
  case "${previous_release}" in
    "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}"/releases/*) ;;
    *)
      host_release_orchestrator_fail \
        "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
        "previous release is outside the fixed release root"
      return
      ;;
  esac
  [[ -d "${previous_release}" && ! -L "${previous_release}" ]] || return 70

  /usr/bin/install -d -m 0700 -o root -g root \
    "${HOST_RELEASE_ORCHESTRATOR_STATE_DIR}" || return 70
  printf '%s\n' "${previous_release}" > \
    "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_RELEASE_FILE}" || return 70
  /usr/bin/chmod 0600 "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_RELEASE_FILE}" ||
    return 70
  live_before="$(
    /usr/bin/stat -c '%d:%i:%s:%Y:%Z' -- \
      "${HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT}"
  )" || return 70
  /usr/bin/install -m 0600 -o root -g root \
    "${HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT}" \
    "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_BACKUP}" || return 70
  live_after="$(
    /usr/bin/stat -c '%d:%i:%s:%Y:%Z' -- \
      "${HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT}"
  )" || return 70
  if [[ "${live_before}" != "${live_after}" ]] ||
    ! /usr/bin/cmp -s -- "${HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT}" \
      "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_BACKUP}"; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "shared environment changed while creating rollback basis"
    return
  fi
  /usr/bin/install -m 0600 -o root -g root \
    "${HOST_RELEASE_ORCHESTRATOR_NGINX_PRIMARY}" \
    "${HOST_RELEASE_ORCHESTRATOR_NGINX_PRIMARY_BACKUP}" || return 70
  /usr/bin/install -m 0600 -o root -g root \
    "${HOST_RELEASE_ORCHESTRATOR_NGINX_ALTERNATE}" \
    "${HOST_RELEASE_ORCHESTRATOR_NGINX_ALTERNATE_BACKUP}" || return 70
  if [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- \
      "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_RELEASE_FILE}")" != "0:0:600:1" ]] ||
    [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- \
      "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_BACKUP}")" != "0:0:600:1" ]] ||
    [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- \
      "${HOST_RELEASE_ORCHESTRATOR_NGINX_PRIMARY_BACKUP}")" != "0:0:600:1" ]] ||
    [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- \
      "${HOST_RELEASE_ORCHESTRATOR_NGINX_ALTERNATE_BACKUP}")" != "0:0:600:1" ]]; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "rollback basis has unsafe metadata"
    return
  fi
  host_release_orchestrator_fsync_paths \
    "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_RELEASE_FILE}" \
    "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_BACKUP}" \
    "${HOST_RELEASE_ORCHESTRATOR_NGINX_PRIMARY_BACKUP}" \
    "${HOST_RELEASE_ORCHESTRATOR_NGINX_ALTERNATE_BACKUP}" \
    "${HOST_RELEASE_ORCHESTRATOR_STATE_DIR}" \
    "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/backups" \
    "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}"
}

host_release_orchestrator_begin_activation() {
  /usr/bin/env -i \
    HOME=/root LANG=C LC_ALL=C \
    PATH="${HOST_RELEASE_ORCHESTRATOR_ROOT_PATH}" \
    DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8 \
    /usr/bin/bash --noprofile --norc -- \
      "${HOST_RELEASE_ORCHESTRATOR_ROLLBACK}" \
      "${HOST_RELEASE_ORCHESTRATOR_RELEASE_ID}" --begin-activation
}

host_release_orchestrator_read_strict_state() {
  HOST_RELEASE_ORCHESTRATOR_STRICT_STATE=""
  host_activation_ledger_validate_release_state \
    "${HOST_RELEASE_ORCHESTRATOR_RELEASE_ID}" \
    "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}" || return $?
  HOST_RELEASE_ORCHESTRATOR_STRICT_STATE="${HOST_ACTIVATION_LEDGER_STATE}:${HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE}"
}

host_release_orchestrator_stage_environment_candidate() {
  local candidate_path="$1"
  local live_path="$2"
  local expected_fingerprint="$3"
  local diesel_gid="$4"
  local release_id="$5"

  "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}" -e '
    const { isUtf8 } = require("node:buffer");
    const { createHash, randomBytes } = require("node:crypto");
    const {
      closeSync, constants, fchmodSync, fchownSync, fsyncSync, fstatSync,
      openSync, readFileSync, readSync, unlinkSync, writeSync,
    } = require("node:fs");
    const { dirname } = require("node:path");
    const { parseEnv } = require("node:util");
    const [sourcePath, livePath, expected, contractPath, dieselGidText, releaseId, maxBytesText] = process.argv.slice(1);
    const {
      validateProductionAiAdmissionConfiguration,
      validateProductionAiChatRateLimitConfiguration,
    } = require(contractPath);
    let source;
    let destination;
    let destinationPath = "";
    let ownsDestination = false;
    try {
      source = openSync(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = fstatSync(source, { bigint: true });
      if (!before.isFile() || before.uid !== 0n || before.gid !== 0n ||
          (before.mode & 0o7777n) !== 0o600n || before.nlink !== 1n ||
          before.size <= 0n || before.size > BigInt(maxBytesText)) throw new Error();
      const bytes = readFileSync(source);
      if (!isUtf8(bytes)) throw new Error();
      const values = parseEnv(bytes.toString("utf8"));
      const databaseUrl = values.DATABASE_URL;
      const protocol = new URL(databaseUrl ?? "").protocol;
      if (protocol !== "postgres:" && protocol !== "postgresql:") throw new Error();
      validateProductionAiAdmissionConfiguration(values);
      validateProductionAiChatRateLimitConfiguration(values);
      const afterRead = fstatSync(source, { bigint: true });
      const actual = [before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs,
        createHash("sha256").update(bytes).digest("hex")].join(":");
      if (actual !== expected) throw new Error();
      for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
        if (before[key] !== afterRead[key]) throw new Error();
      }
      destinationPath = `${dirname(livePath)}/.env.production.local.${releaseId}.${process.pid}.${randomBytes(8).toString("hex")}`;
      destination = openSync(destinationPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600);
      ownsDestination = true;
      let offset = 0;
      while (offset < bytes.length) {
        offset += writeSync(destination, bytes, offset, bytes.length - offset, null);
      }
      fchownSync(destination, 0, Number(dieselGidText));
      fchmodSync(destination, 0o640);
      fsyncSync(destination);
      closeSync(destination);
      destination = undefined;
      closeSync(source);
      source = undefined;
      ownsDestination = false;
      process.stdout.write(`${destinationPath}\n`);
    } catch {
      if (destination !== undefined) {
        try { closeSync(destination); } catch {}
      }
      if (source !== undefined) {
        try { closeSync(source); } catch {}
      }
      if (ownsDestination && destinationPath !== "") {
        try { unlinkSync(destinationPath); } catch {}
      }
      process.stderr.write("environment candidate staging failed\n");
      process.exit(70);
    }
  ' -- "${candidate_path}" "${live_path}" "${expected_fingerprint}" \
    "${HOST_RELEASE_ORCHESTRATOR_RUNTIME_ENVIRONMENT_CONTRACT}" \
    "${diesel_gid}" "${release_id}" \
    "${HOST_RELEASE_ORCHESTRATOR_MAX_ENVIRONMENT_BYTES}" 8>&-
}

host_release_orchestrator_install_candidate() {
  local expected_prefix="${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/shared/.env.production.local.${HOST_RELEASE_ORCHESTRATOR_RELEASE_ID}."
  local candidate_size

  HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP="$(
    host_release_orchestrator_stage_environment_candidate \
      "${HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH}" \
      "${HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT}" \
      "${HOST_RELEASE_ORCHESTRATOR_CANDIDATE_FINGERPRINT}" \
      "${HOST_RELEASE_ORCHESTRATOR_DIESEL_GID}" \
      "${HOST_RELEASE_ORCHESTRATOR_RELEASE_ID}"
  )" || return "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}"
  case "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP}" in
    "${expected_prefix}"*) ;;
    *)
      HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP=""
      host_release_orchestrator_fail \
        "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
        "environment candidate staging returned an invalid path"
      return
      ;;
  esac
  candidate_size="$(/usr/bin/stat -c '%s' -- \
    "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP}")" || return 70
  if [[ "$(/usr/bin/stat -c '%u:%g:%a:%h' -- \
      "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP}")" != \
      "0:${HOST_RELEASE_ORCHESTRATOR_DIESEL_GID}:640:1" ]] ||
    [[ ! "${candidate_size}" =~ ^[0-9]+$ ]] ||
    (( candidate_size <= 0 || candidate_size > HOST_RELEASE_ORCHESTRATOR_MAX_ENVIRONMENT_BYTES )) ||
    ! /usr/bin/cmp -s -- "${HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH}" \
      "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP}"; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
      "staged environment candidate failed readback"
    return
  fi
  /usr/bin/mv -Tf -- "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP}" \
    "${HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT}" || return 70
  HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP=""
  host_release_orchestrator_fsync_paths \
    "${HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT}" \
    "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/shared"
}

host_release_orchestrator_readback_environment() {
  host_release_orchestrator_validate_environment_readback \
    "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_BACKUP}" \
    "${HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH}" \
    "${HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT}" \
    "${HOST_RELEASE_ORCHESTRATOR_DIESEL_GID}"
}

host_release_orchestrator_run_controller() {
  /usr/bin/env -i \
    HOME=/root LANG=C LC_ALL=C \
    PATH="${HOST_RELEASE_ORCHESTRATOR_ROOT_PATH}" \
    DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8 \
    /usr/bin/bash --noprofile --norc -- \
      "${HOST_RELEASE_ORCHESTRATOR_CONTROLLER}" \
      "${HOST_RELEASE_ORCHESTRATOR_RELEASE_ID}"
}

host_release_orchestrator_close_lock() {
  if [[ "${HOST_RELEASE_ORCHESTRATOR_LOCK_OPEN:-0}" -eq 1 ]]; then
    exec 8>&-
    unset DIESEL_RELEASE_LIFECYCLE_LOCK_FD
    HOST_RELEASE_ORCHESTRATOR_LOCK_OPEN=0
  fi
}

host_release_orchestrator_cleanup_environment_temp() {
  local expected_prefix="${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/shared/.env.production.local.${HOST_RELEASE_ORCHESTRATOR_RELEASE_ID}."

  if [[ -z "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP:-}" ]]; then
    return 0
  fi
  case "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP}" in
    "${expected_prefix}"*) ;;
    *)
      host_release_orchestrator_fail \
        "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}" \
        "refusing to clean an invalid environment staging path"
      return
      ;;
  esac
  /usr/bin/rm -f -- "${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP}" || return 70
  HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP=""
}

host_release_orchestrator_run_direct_abort() {
  /usr/bin/env -i HOME=/root LANG=C LC_ALL=C \
    PATH="${HOST_RELEASE_ORCHESTRATOR_ROOT_PATH}" \
    /usr/bin/bash --noprofile --norc -- \
      "${HOST_RELEASE_ORCHESTRATOR_ROLLBACK}" \
      "${HOST_RELEASE_ORCHESTRATOR_RELEASE_ID}" --abort-if-uncommitted
}

host_release_orchestrator_run_governance_recovery() {
  (
    cd -- "${HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR}" || exit 70
    /usr/bin/env -i \
      HOME=/root \
      LANG=C \
      LC_ALL=C \
      PATH="${HOST_RELEASE_ORCHESTRATOR_ROOT_PATH}" \
      NODE_ENV=production \
      DATABASE_MODE=postgres \
      release_id="${HOST_RELEASE_ORCHESTRATOR_RELEASE_ID}" \
      "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}" --import tsx \
        "${HOST_RELEASE_ORCHESTRATOR_MAINTENANCE_WRAPPER}" \
        --database-env-file="${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_BACKUP}" -- \
        /usr/bin/bash --noprofile --norc -- \
          "${HOST_RELEASE_ORCHESTRATOR_GOVERNANCE}" \
          recover-required "${HOST_RELEASE_ORCHESTRATOR_RELEASE_ID}"
  )
}

host_release_orchestrator_record_signal() {
  local status="$1"
  local signal_name="$2"

  if [[ "${HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS:-0}" -eq 0 ]]; then
    HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS="${status}"
    if [[ "${HOST_RELEASE_ORCHESTRATOR_ACTIVE_CHILD_PID:-0}" =~ \
        ^[1-9][0-9]*$ ]]; then
      HOST_RELEASE_ORCHESTRATOR_WAIT_INTERRUPTED=1
      host_release_orchestrator_forward_signal_once "${signal_name}"
    fi
  fi
}

host_release_orchestrator_forward_signal_once() {
  local signal_name="$1"

  # Bash defers traps between builtin commands. This single arithmetic builtin
  # is the compare-and-claim boundary shared by the trap and registration
  # replay, so only its first caller can deliver the signal.
  if (( ++HOST_RELEASE_ORCHESTRATOR_SIGNAL_FORWARD_CLAIMS == 1 )); then
    host_release_orchestrator_forward_signal_to_active_child "${signal_name}"
  fi
}

host_release_orchestrator_forward_signal_to_active_child() {
  local signal_name="$1"

  builtin kill -s "${signal_name}" \
    -- "-${HOST_RELEASE_ORCHESTRATOR_ACTIVE_CHILD_PID}" 2>/dev/null ||
    builtin kill -s "${signal_name}" \
      "${HOST_RELEASE_ORCHESTRATOR_ACTIVE_CHILD_PID}" 2>/dev/null || true
}

host_release_orchestrator_recorded_signal_name() {
  case "${HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS:-0}" in
    129) printf '%s\n' HUP ;;
    130) printf '%s\n' INT ;;
    143) printf '%s\n' TERM ;;
    *) return 1 ;;
  esac
}

# Source-mode tests replace this no-op to force the otherwise tiny interval
# between child spawn and PID registration. The production definition cannot
# be selected through the process environment.
host_release_orchestrator_after_child_spawn_before_registration() {
  :
}

# Source-mode tests use this second no-op to exercise a signal arriving after
# PID registration but before the missed-signal replay. It is not environment
# configurable in the production direct path.
host_release_orchestrator_after_child_registration_before_signal_replay() {
  :
}

host_release_orchestrator_run_supervised() {
  local child_status
  local monitor_was_enabled=0
  local recorded_signal_name
  local spawned_pid

  HOST_RELEASE_ORCHESTRATOR_WAIT_INTERRUPTED=0
  HOST_RELEASE_ORCHESTRATOR_ACTIVE_CHILD_PID=0
  HOST_RELEASE_ORCHESTRATOR_SIGNAL_FORWARD_CLAIMS=0
  if [[ "$-" == *m* ]]; then
    monitor_was_enabled=1
  else
    set -m
  fi
  "$@" &
  spawned_pid=$!
  if [[ "${monitor_was_enabled}" -eq 0 ]]; then
    set +m
  fi
  host_release_orchestrator_after_child_spawn_before_registration \
    "${spawned_pid}"
  HOST_RELEASE_ORCHESTRATOR_ACTIVE_CHILD_PID="${spawned_pid}"
  host_release_orchestrator_after_child_registration_before_signal_replay \
    "${spawned_pid}"
  if recorded_signal_name="$(host_release_orchestrator_recorded_signal_name)"; then
    host_release_orchestrator_forward_signal_once "${recorded_signal_name}"
  fi
  while true; do
    if wait "${HOST_RELEASE_ORCHESTRATOR_ACTIVE_CHILD_PID}"; then
      child_status=0
    else
      child_status=$?
    fi
    if [[ "${HOST_RELEASE_ORCHESTRATOR_WAIT_INTERRUPTED}" -eq 1 ]]; then
      HOST_RELEASE_ORCHESTRATOR_WAIT_INTERRUPTED=0
      continue
    fi
    break
  done
  HOST_RELEASE_ORCHESTRATOR_ACTIVE_CHILD_PID=0
  return "${child_status}"
}

host_release_orchestrator_install_traps() {
  HOST_RELEASE_ORCHESTRATOR_PREVIOUS_EXIT_TRAP="$(trap -p EXIT)"
  HOST_RELEASE_ORCHESTRATOR_PREVIOUS_HUP_TRAP="$(trap -p HUP)"
  HOST_RELEASE_ORCHESTRATOR_PREVIOUS_INT_TRAP="$(trap -p INT)"
  HOST_RELEASE_ORCHESTRATOR_PREVIOUS_TERM_TRAP="$(trap -p TERM)"
  trap 'host_release_orchestrator_record_signal 129 HUP' HUP
  trap 'host_release_orchestrator_record_signal 130 INT' INT
  trap 'host_release_orchestrator_record_signal 143 TERM' TERM
  trap 'host_release_orchestrator_handle_exit "$?"' EXIT
}

host_release_orchestrator_restore_traps() {
  trap - EXIT HUP INT TERM
  if [[ -n "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_EXIT_TRAP:-}" ]]; then
    eval "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_EXIT_TRAP}"
  fi
  if [[ -n "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_HUP_TRAP:-}" ]]; then
    eval "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_HUP_TRAP}"
  fi
  if [[ -n "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_INT_TRAP:-}" ]]; then
    eval "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_INT_TRAP}"
  fi
  if [[ -n "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_TERM_TRAP:-}" ]]; then
    eval "${HOST_RELEASE_ORCHESTRATOR_PREVIOUS_TERM_TRAP}"
  fi
}

host_release_orchestrator_failure_status() {
  local status="$1"

  if [[ "${status}" -eq "${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}" ]]; then
    printf '%s\n' "${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}"
  elif [[ "${HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS:-0}" -ne 0 ]]; then
    printf '%s\n' "${HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS}"
  elif [[ "${status}" -eq 129 || "${status}" -eq 130 ||
    "${status}" -eq 137 || "${status}" -eq 143 ||
    "${status}" -eq "${HOST_RELEASE_ORCHESTRATOR_USAGE_STATUS}" ||
    "${status}" -eq "${HOST_RELEASE_ORCHESTRATOR_NOT_ROOT_STATUS}" ]]; then
    printf '%s\n' "${status}"
  else
    printf '%s\n' "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}"
  fi
}

host_release_orchestrator_abort_once() {
  local failure_status="$1"
  local cleanup_status=0
  local restore_status=0

  if [[ "${HOST_RELEASE_ORCHESTRATOR_TERMINALIZATION_STARTED:-0}" -eq 1 ]]; then
    return "${HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS:-${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}}"
  fi
  HOST_RELEASE_ORCHESTRATOR_TERMINALIZATION_STARTED=1
  HOST_RELEASE_ORCHESTRATOR_ROLLBACK_ARMED=0
  failure_status="$(host_release_orchestrator_failure_status "${failure_status}")"

  if [[ "${failure_status}" -eq \
    "${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}" ]]; then
    HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS="${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}"
    host_release_orchestrator_cleanup_environment_temp || true
    host_release_orchestrator_close_lock || true
    return "${HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS}"
  fi

  if host_release_orchestrator_cleanup_environment_temp; then
    cleanup_status=0
  else
    cleanup_status=$?
  fi
  if ! host_release_orchestrator_read_strict_state; then
    HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS="${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}"
    host_release_orchestrator_close_lock || true
    return "${HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS}"
  fi

  case "${HOST_RELEASE_ORCHESTRATOR_STRICT_STATE}" in
    PENDING:PUBLISH_COMMITTED | PENDING:PUBLISH_FINALIZED | \
      COMMITTED:PUBLISH_FINALIZED)
      HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS="${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}"
      host_release_orchestrator_close_lock || true
      return "${HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS}"
      ;;
    PENDING:none)
      host_release_orchestrator_close_lock || true
      if host_release_orchestrator_run_direct_abort; then
        restore_status=0
      else
        restore_status=$?
      fi
      ;;
    PENDING:RECOVERY_REQUIRED | PENDING:HOST_ROLLBACK_REQUIRED | \
      ROLLED_BACK:HOST_ROLLBACK_REQUIRED)
      host_release_orchestrator_close_lock || true
      if host_release_orchestrator_run_governance_recovery; then
        restore_status=0
      else
        restore_status=$?
      fi
      ;;
    ROLLED_BACK:none | ROLLED_BACK:HOST_ROLLBACK_COMPLETED)
      host_release_orchestrator_close_lock || true
      ;;
    *)
      HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS="${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}"
      host_release_orchestrator_close_lock || true
      return "${HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS}"
      ;;
  esac
  if [[ "${restore_status}" -ne 0 || "${cleanup_status}" -ne 0 ]]; then
    HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS="${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}"
  else
    HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS="${failure_status}"
  fi
  return "${HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS}"
}

host_release_orchestrator_handle_exit() {
  local status="$1"
  local final_status="${status}"

  trap - EXIT HUP INT TERM
  if [[ "${HOST_RELEASE_ORCHESTRATOR_ROLLBACK_ARMED:-0}" -eq 1 ]]; then
    if host_release_orchestrator_abort_once "${status}"; then
      final_status=0
    else
      final_status=$?
    fi
  else
    host_release_orchestrator_cleanup_environment_temp || final_status=70
    host_release_orchestrator_close_lock || final_status=70
  fi
  if [[ "${final_status}" -eq 0 && "${status}" -ne 0 ]]; then
    final_status="${status}"
  elif [[ "${final_status}" -eq 0 ]]; then
    final_status="${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}"
  fi
  exit "${final_status}"
}

host_release_orchestrator_finish_without_rollback() {
  local status="$1"
  local cleanup_status=0

  HOST_RELEASE_ORCHESTRATOR_ROLLBACK_ARMED=0
  HOST_RELEASE_ORCHESTRATOR_TERMINALIZATION_STARTED=1
  if host_release_orchestrator_cleanup_environment_temp; then
    cleanup_status=0
  else
    cleanup_status=$?
  fi
  host_release_orchestrator_close_lock || cleanup_status=70
  host_release_orchestrator_restore_traps
  if [[ "${cleanup_status}" -ne 0 ]]; then
    if [[ "${status}" -eq 0 ]]; then
      return "${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}"
    fi
    return "${HOST_RELEASE_ORCHESTRATOR_FAILURE_STATUS}"
  fi
  return "${status}"
}

host_release_orchestrator_finish_with_rollback() {
  local status="$1"
  local terminal_status

  if host_release_orchestrator_abort_once "${status}"; then
    terminal_status=0
  else
    terminal_status=$?
  fi
  host_release_orchestrator_restore_traps
  return "${terminal_status}"
}

host_release_orchestrator_finish_failure() {
  local status="$1"

  if [[ "${status}" -eq "${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}" ]]; then
    host_release_orchestrator_finish_without_rollback "${status}"
  else
    host_release_orchestrator_finish_with_rollback "${status}"
  fi
}

host_release_orchestrator_reconcile() {
  local operation_status
  local controller_status

  if host_release_orchestrator_preflight_candidate; then
    operation_status=0
  else
    operation_status=$?
  fi
  if [[ "${operation_status}" -ne 0 ||
    "${HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS}" -ne 0 ]]; then
    operation_status="$(host_release_orchestrator_failure_status "${operation_status}")"
    host_release_orchestrator_finish_without_rollback "${operation_status}"
    return
  fi

  if host_release_orchestrator_acquire_lock; then
    operation_status=0
  else
    operation_status=$?
  fi
  if [[ "${operation_status}" -ne 0 ||
    "${HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS}" -ne 0 ]]; then
    operation_status="$(host_release_orchestrator_failure_status "${operation_status}")"
    host_release_orchestrator_finish_without_rollback "${operation_status}"
    return
  fi

  if host_release_orchestrator_persist_basis; then
    operation_status=0
  else
    operation_status=$?
  fi
  if [[ "${operation_status}" -ne 0 ||
    "${HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS}" -ne 0 ]]; then
    operation_status="$(host_release_orchestrator_failure_status "${operation_status}")"
    host_release_orchestrator_finish_without_rollback "${operation_status}"
    return
  fi

  # From this point an interrupted begin may already have written PENDING.
  # The one-shot terminalizer therefore uses the strict ledger parser before
  # deciding whether rollback is safe.
  HOST_RELEASE_ORCHESTRATOR_ROLLBACK_ARMED=1
  if host_release_orchestrator_run_supervised \
    host_release_orchestrator_begin_activation; then
    operation_status=0
  else
    operation_status=$?
  fi
  if [[ "${operation_status}" -ne 0 ||
    "${HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS}" -ne 0 ]]; then
    operation_status="$(host_release_orchestrator_failure_status "${operation_status}")"
    host_release_orchestrator_finish_failure "${operation_status}"
    return
  fi
  if ! host_release_orchestrator_read_strict_state ||
    [[ "${HOST_RELEASE_ORCHESTRATOR_STRICT_STATE}" != "PENDING:none" ]]; then
    host_release_orchestrator_finish_without_rollback \
      "${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}"
    return
  fi

  if host_release_orchestrator_install_candidate; then
    operation_status=0
  else
    operation_status=$?
  fi
  if [[ "${operation_status}" -ne 0 ||
    "${HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS}" -ne 0 ]]; then
    operation_status="$(host_release_orchestrator_failure_status "${operation_status}")"
    host_release_orchestrator_finish_failure "${operation_status}"
    return
  fi
  if host_release_orchestrator_readback_environment; then
    operation_status=0
  else
    operation_status=$?
  fi
  if [[ "${operation_status}" -ne 0 ||
    "${HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS}" -ne 0 ]]; then
    operation_status="$(host_release_orchestrator_failure_status "${operation_status}")"
    host_release_orchestrator_finish_failure "${operation_status}"
    return
  fi

  HOST_RELEASE_ORCHESTRATOR_CONTROLLER_STARTED=1
  if host_release_orchestrator_run_supervised \
    host_release_orchestrator_run_controller; then
    controller_status=0
  else
    controller_status=$?
  fi
  case "${controller_status}" in
    0)
      host_release_orchestrator_finish_without_rollback 0
      ;;
    "${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}")
      host_release_orchestrator_finish_without_rollback \
        "${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}"
      ;;
    *)
      controller_status="$(host_release_orchestrator_failure_status \
        "${controller_status}")"
      host_release_orchestrator_finish_failure "${controller_status}"
      ;;
  esac
}

host_release_orchestrator_run_main() {
  if [[ "$#" -ne 2 ]] || ! host_release_orchestrator_is_commit "$1"; then
    host_release_orchestrator_usage
    return "${HOST_RELEASE_ORCHESTRATOR_USAGE_STATUS}"
  fi
  if host_release_orchestrator_sourced_production_root_is_selected \
    "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}"; then
    host_release_orchestrator_fail \
      "${HOST_RELEASE_ORCHESTRATOR_USAGE_STATUS}" \
      "production host release is unavailable from a sourced shell"
    return
  fi

  HOST_RELEASE_ORCHESTRATOR_SIGNAL_STATUS=0
  HOST_RELEASE_ORCHESTRATOR_LOCK_OPEN=0
  HOST_RELEASE_ORCHESTRATOR_ROLLBACK_ARMED=0
  HOST_RELEASE_ORCHESTRATOR_TERMINALIZATION_STARTED=0
  HOST_RELEASE_ORCHESTRATOR_TERMINAL_STATUS=""
  HOST_RELEASE_ORCHESTRATOR_CONTROLLER_STARTED=0
  HOST_RELEASE_ORCHESTRATOR_ACTIVE_CHILD_PID=0
  HOST_RELEASE_ORCHESTRATOR_WAIT_INTERRUPTED=0
  HOST_RELEASE_ORCHESTRATOR_SIGNAL_FORWARD_CLAIMS=0
  host_release_orchestrator_install_traps
  host_release_orchestrator_reconcile
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [[ "$#" -ne 2 ]] || ! host_release_orchestrator_is_commit "${1:-}"; then
    host_release_orchestrator_usage
    exit "${HOST_RELEASE_ORCHESTRATOR_USAGE_STATUS}"
  fi
  if [[ "${EUID}" != "0" ]]; then
    echo "host release orchestrator must run as root" >&2
    exit "${HOST_RELEASE_ORCHESTRATOR_NOT_ROOT_STATUS}"
  fi
  if host_release_orchestrator_cli_bootstrap \
    "$1" "$2" "/opt/diesel" "${BASH_SOURCE[0]}"; then
    :
  else
    host_release_orchestrator_bootstrap_status=$?
    echo "host release orchestrator bootstrap validation failed" >&2
    exit "${host_release_orchestrator_bootstrap_status}"
  fi
  export PATH="${HOST_RELEASE_ORCHESTRATOR_ROOT_PATH}"
  export LANG=C
  export LC_ALL=C
  umask 077
  host_release_orchestrator_configure_production "$1" "$2"
  host_release_orchestrator_run_main "$1" "$2"
  exit $?
fi
