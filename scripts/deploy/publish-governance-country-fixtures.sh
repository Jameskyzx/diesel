#!/usr/bin/env bash

# This file is deliberately source-only. The caller owns the governance
# recovery traps, so running the 97-country loop in another long-lived shell
# would weaken the existing signal and rollback boundary.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "Usage: source this script inside the protected governance publish shell" >&2
  exit 64
fi

publish_governance_country_fixtures_error() {
  printf 'Governance country fixture queue: %s\n' "$1" >&2
}

# The deploy-root argument keeps the fail-closed path contract testable without
# weakening the production entry point below, which always fixes it to
# /opt/diesel.
publish_governance_country_fixtures_for_root() {
  if [[ "$#" -ne 2 ]]; then
    publish_governance_country_fixtures_error \
      "expected <full-lowercase-git-commit-sha> <deploy-root>"
    return 64
  fi

  local expected_release_id="$1"
  local deploy_root="$2"
  local release_dir="${deploy_root}/releases/${expected_release_id}"
  local current_link="${deploy_root}/current"
  local snapshot_dir="${deploy_root}/backups/${expected_release_id}"
  local snapshot_path="${snapshot_dir}/governance-before.json"
  local recovery_marker="${snapshot_dir}/RECOVERY_REQUIRED"
  local publish_commit_marker="${snapshot_dir}/PUBLISH_COMMITTED"
  local metadata=''
  local current_target=''
  local trap_definition=''
  local snapshot_hash_output=''
  local actual_snapshot_sha256=''
  local marker_snapshot_sha256=''
  local marker_snapshot_path=''
  local marker_extra_field=''
  local trailing_marker_line=''
  local seen_country_codes=' '
  local country_iso3=''
  local country_status=0
  local country_index=0
  local signal_name=''
  local -a country_iso3s=(
    CRI ECU PAN DOM PHL PAK SAU ARE ISR ZAF EGY GHA KEN RWA TZA ZMB ZWE
    CIV DZA TUN ETH CMR SEN NGA UGA BWA NAM SWZ KHM LAO LKA MMR MNG LIE
    SGP MAR QAT KWT OMN JOR IRN IRQ LBN SYR GUY HTI JAM BLZ CUB LBR LBY
    MLI MRT NER GTM HND NIC PRY URY PRK PSE SDN PRI NCL ERI GAB GMB GNB
    GNQ MOZ LSO MDG MUS FJI CAF COD COG GIN DJI AUS PNG BRN BTN SLB TLS
    MWI SLE SOM SSD TCD SLV SUR TTO CAN USA CHN MLT
  )

  if [[ ! "${expected_release_id}" =~ ^[0-9a-f]{40}$ ]]; then
    publish_governance_country_fixtures_error \
      "release ID must be a full lowercase Git commit SHA"
    return 64
  fi
  if [[ ! "${deploy_root}" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
     [[ "${deploy_root}" == */ ]] ||
     [[ "${deploy_root}" == *'/../'* ]] ||
     [[ "${deploy_root}" == *'/./'* ]]; then
    publish_governance_country_fixtures_error "deploy root is not canonical"
    return 64
  fi
  if [[ "$(id -u)" != '0' ]]; then
    publish_governance_country_fixtures_error "the queue must run as root"
    return 70
  fi
  if [[ "${NODE_ENV:-}" != 'production' ]] ||
     [[ "${DATABASE_MODE:-}" != 'postgres' ]] ||
     [[ "${release_id:-}" != "${expected_release_id}" ]]; then
    publish_governance_country_fixtures_error \
      "production environment and release binding are required"
    return 70
  fi
  if [[ ! "${DIESEL_GOVERNANCE_MAINTENANCE_TOKEN:-}" =~ ^[0-9a-f]{64}$ ]]; then
    publish_governance_country_fixtures_error \
      "a governance maintenance lock token is required"
    return 70
  fi
  if [[ "$-" != *e* ]] || [[ "$-" != *u* ]] ||
     [[ ! -o errtrace ]] || [[ ! -o pipefail ]]; then
    publish_governance_country_fixtures_error \
      "errexit, errtrace, nounset and pipefail must remain enabled"
    return 70
  fi
  for signal_name in ERR INT TERM HUP EXIT; do
    trap_definition="$(trap -p "${signal_name}")"
    if [[ "${trap_definition}" != *restore_governance_on_failure* ]]; then
      publish_governance_country_fixtures_error \
        "the ${signal_name} recovery trap is not installed"
      return 70
    fi
  done

  if [[ ! -d "${deploy_root}" ]] || [[ -L "${deploy_root}" ]] ||
     [[ ! -d "${deploy_root}/releases" ]] ||
     [[ -L "${deploy_root}/releases" ]] ||
     [[ ! -d "${release_dir}" ]] || [[ -L "${release_dir}" ]]; then
    publish_governance_country_fixtures_error \
      "the release path boundary is invalid"
    return 70
  fi
  metadata="$(stat -c '%U:%G:%a' "${deploy_root}")"
  if [[ "${metadata}" != 'root:root:755' ]]; then
    publish_governance_country_fixtures_error \
      "deploy root must be root:root:755"
    return 70
  fi
  metadata="$(stat -c '%U:%G:%a' "${deploy_root}/releases")"
  if [[ "${metadata}" != 'root:root:755' ]]; then
    publish_governance_country_fixtures_error \
      "release root must be root:root:755"
    return 70
  fi
  metadata="$(stat -c '%U:%G:%a' "${release_dir}")"
  if [[ "${metadata}" != 'root:diesel:750' ]]; then
    publish_governance_country_fixtures_error \
      "release directory must be root:diesel:750"
    return 70
  fi
  if [[ ! -L "${current_link}" ]]; then
    publish_governance_country_fixtures_error \
      "current must be a symlink to the candidate release"
    return 70
  fi
  current_target="$(readlink -f "${current_link}")"
  if [[ "${current_target}" != "${release_dir}" ]] ||
     [[ "$(pwd -P)" != "${release_dir}" ]]; then
    publish_governance_country_fixtures_error \
      "current and the working directory must match the candidate release"
    return 70
  fi
  if [[ ! -f scripts/db/ingest-accepted-fixtures.ts ]] ||
     [[ -L scripts/db/ingest-accepted-fixtures.ts ]]; then
    publish_governance_country_fixtures_error \
      "the versioned fixture ingester is unavailable"
    return 70
  fi

  if [[ ! -f "${recovery_marker}" ]] || [[ -L "${recovery_marker}" ]]; then
    publish_governance_country_fixtures_error \
      "RECOVERY_REQUIRED must be a regular file"
    return 70
  fi
  metadata="$(stat -c '%U:%G:%a' "${recovery_marker}")"
  if [[ "${metadata}" != 'root:root:600' ]]; then
    publish_governance_country_fixtures_error \
      "RECOVERY_REQUIRED must be root:root:600"
    return 70
  fi
  if [[ -e "${publish_commit_marker}" ]] || [[ -L "${publish_commit_marker}" ]]; then
    publish_governance_country_fixtures_error \
      "PUBLISH_COMMITTED must not exist before the country queue"
    return 70
  fi
  if ! IFS=$'\t' read -r marker_snapshot_sha256 marker_snapshot_path marker_extra_field \
    <"${recovery_marker}"; then
    publish_governance_country_fixtures_error \
      "RECOVERY_REQUIRED must contain one newline-terminated record"
    return 70
  fi
  if IFS= read -r trailing_marker_line < <(tail -n +2 -- "${recovery_marker}") ||
     [[ -n "${trailing_marker_line}" ]]; then
    publish_governance_country_fixtures_error \
      "RECOVERY_REQUIRED must contain exactly one record"
    return 70
  fi
  if [[ ! "${marker_snapshot_sha256}" =~ ^[0-9a-f]{64}$ ]] ||
     [[ "${marker_snapshot_path}" != "${snapshot_path}" ]] ||
     [[ -n "${marker_extra_field}" ]]; then
    publish_governance_country_fixtures_error \
      "RECOVERY_REQUIRED is not bound to the release snapshot"
    return 70
  fi
  if [[ ! -f "${snapshot_path}" ]] || [[ -L "${snapshot_path}" ]]; then
    publish_governance_country_fixtures_error \
      "the governance snapshot must be a regular file"
    return 70
  fi
  metadata="$(stat -c '%U:%G:%a' "${snapshot_path}")"
  if [[ "${metadata}" != 'root:root:600' ]]; then
    publish_governance_country_fixtures_error \
      "the governance snapshot must be root:root:600"
    return 70
  fi
  if ! snapshot_hash_output="$(sha256sum -- "${snapshot_path}")"; then
    publish_governance_country_fixtures_error \
      "the governance snapshot cannot be hashed"
    return 70
  fi
  actual_snapshot_sha256="${snapshot_hash_output%% *}"
  if [[ "${actual_snapshot_sha256}" != "${marker_snapshot_sha256}" ]]; then
    publish_governance_country_fixtures_error \
      "the governance snapshot hash does not match RECOVERY_REQUIRED"
    return 70
  fi

  if [[ "${#country_iso3s[@]}" -ne 97 ]]; then
    publish_governance_country_fixtures_error \
      "the publication queue must contain exactly 97 countries"
    return 70
  fi
  for country_iso3 in "${country_iso3s[@]}"; do
    if [[ ! "${country_iso3}" =~ ^[A-Z]{3}$ ]] ||
       [[ "${seen_country_codes}" == *" ${country_iso3} "* ]]; then
      publish_governance_country_fixtures_error \
        "the publication queue contains an invalid or duplicate ISO3"
      return 70
    fi
    seen_country_codes+="${country_iso3} "
  done

  for country_iso3 in "${country_iso3s[@]}"; do
    country_index=$((country_index + 1))
    printf 'GOVERNANCE_COUNTRY_START %d/97 %s\n' \
      "${country_index}" "${country_iso3}"
    if declare -F governance_run_tsx >/dev/null 2>&1; then
      if governance_run_tsx \
        scripts/db/ingest-accepted-fixtures.ts --country="${country_iso3}"; then
        country_status=0
      else
        country_status="$?"
      fi
    else
      if corepack pnpm exec tsx \
        --conditions=react-server \
        scripts/db/ingest-accepted-fixtures.ts --country="${country_iso3}"; then
        country_status=0
      else
        country_status="$?"
      fi
    fi
    if [[ "${country_status}" -eq 0 ]]; then
      printf 'GOVERNANCE_COUNTRY_COMPLETE %d/97 %s\n' \
        "${country_index}" "${country_iso3}"
    else
      printf 'GOVERNANCE_COUNTRY_FAILED %d/97 %s status=%d\n' \
        "${country_index}" "${country_iso3}" "${country_status}" >&2
      return "${country_status}"
    fi
  done
}

publish_governance_country_fixtures() {
  if [[ "$#" -ne 1 ]]; then
    publish_governance_country_fixtures_error \
      "expected one full lowercase Git commit SHA"
    return 64
  fi
  publish_governance_country_fixtures_for_root "$1" /opt/diesel
}
