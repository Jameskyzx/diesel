#!/usr/bin/env bash
set -Eeuo pipefail

linux_release_handoff_usage() {
  echo "usage: linux-release-handoff-smoke.sh <commit-sha> <release-export> <node-binary> <runner-temp>" >&2
}

linux_release_handoff_fail() {
  local status="$1"
  shift
  echo "$*" >&2
  return "${status}"
}

linux_release_handoff_install_signal_traps() {
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
}

linux_release_handoff_uid_has_processes() {
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
  echo "process lookup failed for UID ${uid}" >&2
  return 70
}

linux_release_handoff_stop_uid_processes() {
  local uid="$1"
  local label="$2"
  local probe_status

  if linux_release_handoff_uid_has_processes "${uid}"; then
    pkill -TERM -u "${uid}" >/dev/null 2>&1 || true
    sleep 1
  else
    probe_status="$?"
    [[ "${probe_status}" -eq 1 ]] && return 0
    return 70
  fi
  if linux_release_handoff_uid_has_processes "${uid}"; then
    pkill -KILL -u "${uid}" >/dev/null 2>&1 || true
    sleep 1
  else
    probe_status="$?"
    [[ "${probe_status}" -eq 1 ]] && return 0
    return 70
  fi
  if linux_release_handoff_uid_has_processes "${uid}"; then
    echo "${label} processes survived cleanup" >&2
    return 70
  else
    probe_status="$?"
    [[ "${probe_status}" -eq 1 ]] && return 0
    return 70
  fi
}

linux_release_handoff_run_cgroup_canary() {
  local release_id="$1"
  local deploy_root="$2"
  local release_dir="$3"
  local fixed_path="$4"
  local builder_uid="$5"
  local canary_release_id
  local canary_workspace_root="${deploy_root}/cgroup-canary-workspaces"
  local canary_home_root="${deploy_root}/cgroup-canary-homes"
  local canary_workspace
  local canary_home
  local canary_marker
  local canary_status=0
  local -a canary_marker_lines=()

  if [[ "${release_id:0:1}" == f ]]; then
    canary_release_id="e${release_id:1}"
  else
    canary_release_id="f${release_id:1}"
  fi
  canary_workspace="${canary_workspace_root}/${canary_release_id}"
  canary_home="${canary_home_root}/${canary_release_id}"
  canary_marker="${canary_home}/payload-started"
  install -d -m 0710 -o root -g diesel-build \
    "${canary_workspace_root}" "${canary_home_root}"
  install -d -m 0700 -o diesel-build -g diesel-build \
    "${canary_workspace}" "${canary_home}"
  install -d -m 0700 -o diesel-build -g diesel-build \
    "${canary_workspace}/scripts" "${canary_workspace}/scripts/deploy"
  install -m 0700 -o diesel-build -g diesel-build /dev/null \
    "${canary_workspace}/scripts/deploy/build-release.sh"
  printf '%s\n' \
    '#!/usr/bin/bash' \
    '/usr/bin/sleep 300 &' \
    'child_pid="$!"' \
    'printf '\''%s\n%s\n'\'' "${BUILD_RELEASE_ID}" "${child_pid}" >"${BUILD_HOME}/payload-started"' \
    'exit 0' \
    >"${canary_workspace}/scripts/deploy/build-release.sh"
  chown diesel-build:diesel-build \
    "${canary_workspace}/scripts/deploy/build-release.sh"
  chmod 700 "${canary_workspace}/scripts/deploy/build-release.sh"

  if ! runuser -u diesel-build -- /usr/bin/test -x "${canary_workspace}" ||
    ! runuser -u diesel-build -- /usr/bin/test -r \
      "${canary_workspace}/scripts/deploy/build-release.sh"; then
    linux_release_handoff_fail 70 "builder cannot traverse the isolated canary workspace"
    return
  fi

  echo "Expecting the transient builder canary to reject a background child"
  /bin/bash -c '
    set -Eeuo pipefail
    source "$1"
    canary_release_id="$2"
    canary_workspace="$3"
    canary_home="$4"
    fixed_path="$5"
    builder_uid="$6"
    canary_unit="diesel-build-${canary_release_id}.service"
    canary_control_group="/system.slice/${canary_unit}"
    PREPARE_RELEASE_CLEANUP_BUILD_UNIT_ARMED=0
    cleanup_canary_unit() {
      local original_status="$1"
      trap - EXIT
      trap "" INT TERM HUP
      if [[ "${PREPARE_RELEASE_CLEANUP_BUILD_UNIT_ARMED}" -eq 1 ]]; then
        if ! prepare_release_quiesce_build_unit \
          "${canary_unit}" "${canary_workspace}" /proc \
          "${canary_control_group}" "${builder_uid}"; then
          exit 70
        fi
      fi
      exit "${original_status}"
    }
    trap '\''cleanup_canary_unit "$?"'\'' EXIT
    prepare_release_run_build_unit \
      "${canary_release_id}" "${canary_workspace}" "${canary_home}" \
      "${fixed_path}" "https://registry.npmjs.org" /proc "${builder_uid}"
  ' bash \
    "${release_dir}/scripts/deploy/prepare-release-runtime.sh" \
    "${canary_release_id}" "${canary_workspace}" "${canary_home}" \
    "${fixed_path}" "${builder_uid}" || canary_status="$?"
  if [[ "${canary_status}" -ne 70 ]]; then
    linux_release_handoff_fail 70 \
      "background-child canary returned ${canary_status}, expected fail-closed 70"
    return
  fi
  if [[ ! -f "${canary_marker}" || -L "${canary_marker}" ]] ||
    [[ "$(realpath -- "${canary_marker}")" != "${canary_marker}" ]] ||
    [[ "$(stat -c '%U:%G:%a' -- "${canary_marker}")" != \
      diesel-build:diesel-build:600 ]]; then
    linux_release_handoff_fail 70 \
      "background-child canary did not leave a trusted execution marker"
    return
  fi
  mapfile -t canary_marker_lines <"${canary_marker}"
  if [[ "${#canary_marker_lines[@]}" -ne 2 ]] ||
    [[ "${canary_marker_lines[0]}" != "${canary_release_id}" ]] ||
    [[ ! "${canary_marker_lines[1]}" =~ ^[0-9]+$ ]]; then
    linux_release_handoff_fail 70 \
      "background-child canary execution marker was malformed"
    return
  fi

  /bin/bash -c '
    set -Eeuo pipefail
    source "$1"
    canary_release_id="$2"
    canary_workspace_root="$3"
    canary_home_root="$4"
    builder_uid="$5"
    canary_unit="diesel-build-${canary_release_id}.service"
    canary_control_group="/system.slice/${canary_unit}"
    prepare_release_require_unit_absent "${canary_unit}"
    prepare_release_require_control_group_absent "${canary_control_group}"
    prepare_release_prove_build_quiescent \
      /proc "${canary_control_group}" "${builder_uid}"
    prepare_release_remove_exact_directory \
      "${canary_workspace_root}/${canary_release_id}" \
      "${canary_workspace_root}" "${canary_release_id}" \
      "cgroup canary workspace"
    prepare_release_remove_exact_directory \
      "${canary_home_root}/${canary_release_id}" \
      "${canary_home_root}" "${canary_release_id}" \
      "cgroup canary home"
  ' bash \
    "${release_dir}/scripts/deploy/prepare-release-runtime.sh" \
    "${canary_release_id}" "${canary_workspace_root}" \
    "${canary_home_root}" "${builder_uid}"
  rmdir -- "${canary_workspace_root}" "${canary_home_root}"
  printf 'Transient builder background-child canary verified: %s\n' \
    "${canary_release_id}"
}

linux_release_handoff_run_status_canary() {
  local release_id="$1"
  local deploy_root="$2"
  local release_dir="$3"
  local fixed_path="$4"
  local builder_uid="$5"
  local canary_mode="$6"
  local expected_status
  local canary_prefix
  local alternate_prefix
  local payload_terminal_command
  local canary_release_id
  local canary_workspace_root
  local canary_home_root
  local canary_workspace
  local canary_home
  local canary_marker
  local canary_status=0

  case "${canary_mode}" in
    exit-code)
      expected_status=23
      canary_prefix=d
      alternate_prefix=c
      payload_terminal_command='exit 23'
      ;;
    signal)
      expected_status=143
      canary_prefix=b
      alternate_prefix=a
      payload_terminal_command='trap - TERM; kill -TERM "$$"; exit 99'
      ;;
    *)
      linux_release_handoff_fail 64 \
        "unknown transient builder status canary: ${canary_mode}"
      return
      ;;
  esac
  if [[ "${release_id:0:1}" == "${canary_prefix}" ]]; then
    canary_prefix="${alternate_prefix}"
  fi
  canary_release_id="${canary_prefix}${release_id:1}"
  canary_workspace_root="${deploy_root}/status-canary-${canary_mode}-workspaces"
  canary_home_root="${deploy_root}/status-canary-${canary_mode}-homes"
  canary_workspace="${canary_workspace_root}/${canary_release_id}"
  canary_home="${canary_home_root}/${canary_release_id}"
  canary_marker="${canary_home}/payload-started"

  install -d -m 0710 -o root -g diesel-build \
    "${canary_workspace_root}" "${canary_home_root}"
  install -d -m 0700 -o diesel-build -g diesel-build \
    "${canary_workspace}" "${canary_home}"
  install -d -m 0700 -o diesel-build -g diesel-build \
    "${canary_workspace}/scripts" "${canary_workspace}/scripts/deploy"
  install -m 0700 -o diesel-build -g diesel-build /dev/null \
    "${canary_workspace}/scripts/deploy/build-release.sh"
  printf '%s\n' \
    '#!/usr/bin/bash' \
    'printf '\''%s\n'\'' "${BUILD_RELEASE_ID}" >"${BUILD_HOME}/payload-started"' \
    "${payload_terminal_command}" \
    >"${canary_workspace}/scripts/deploy/build-release.sh"
  chown diesel-build:diesel-build \
    "${canary_workspace}/scripts/deploy/build-release.sh"
  chmod 700 "${canary_workspace}/scripts/deploy/build-release.sh"

  if /bin/bash -c '
    set -Eeuo pipefail
    source "$1"
    canary_release_id="$2"
    canary_workspace="$3"
    canary_home="$4"
    fixed_path="$5"
    builder_uid="$6"
    canary_unit="diesel-build-${canary_release_id}.service"
    canary_control_group="/system.slice/${canary_unit}"
    PREPARE_RELEASE_CLEANUP_BUILD_UNIT_ARMED=0
    cleanup_canary_unit() {
      local original_status="$1"
      trap - EXIT
      trap "" INT TERM HUP
      if [[ "${PREPARE_RELEASE_CLEANUP_BUILD_UNIT_ARMED}" -eq 1 ]]; then
        if ! prepare_release_quiesce_build_unit \
          "${canary_unit}" "${canary_workspace}" /proc \
          "${canary_control_group}" "${builder_uid}"; then
          exit 70
        fi
      fi
      exit "${original_status}"
    }
    trap '\''cleanup_canary_unit "$?"'\'' EXIT
    prepare_release_run_build_unit \
      "${canary_release_id}" "${canary_workspace}" "${canary_home}" \
      "${fixed_path}" "https://registry.npmjs.org" /proc "${builder_uid}"
  ' bash \
    "${release_dir}/scripts/deploy/prepare-release-runtime.sh" \
    "${canary_release_id}" "${canary_workspace}" "${canary_home}" \
    "${fixed_path}" "${builder_uid}"; then
    canary_status=0
  else
    canary_status="$?"
  fi
  if [[ "${canary_status}" -ne "${expected_status}" ]]; then
    linux_release_handoff_fail 70 \
      "${canary_mode} status canary returned ${canary_status}, expected ${expected_status}"
    return
  fi

  if [[ ! -f "${canary_marker}" || -L "${canary_marker}" ]] ||
    [[ "$(realpath -- "${canary_marker}")" != "${canary_marker}" ]] ||
    [[ "$(stat -c '%U:%G:%a' -- "${canary_marker}")" != \
      diesel-build:diesel-build:600 ]] ||
    [[ "$(<"${canary_marker}")" != "${canary_release_id}" ]]; then
    linux_release_handoff_fail 70 \
      "${canary_mode} status canary did not leave a trusted execution marker"
    return
  fi

  /bin/bash -c '
    set -Eeuo pipefail
    source "$1"
    canary_release_id="$2"
    canary_workspace_root="$3"
    canary_home_root="$4"
    builder_uid="$5"
    canary_unit="diesel-build-${canary_release_id}.service"
    canary_control_group="/system.slice/${canary_unit}"
    prepare_release_require_unit_absent "${canary_unit}"
    prepare_release_require_control_group_absent "${canary_control_group}"
    prepare_release_prove_build_quiescent \
      /proc "${canary_control_group}" "${builder_uid}"
    prepare_release_remove_exact_directory \
      "${canary_workspace_root}/${canary_release_id}" \
      "${canary_workspace_root}" "${canary_release_id}" \
      "status canary workspace"
    prepare_release_remove_exact_directory \
      "${canary_home_root}/${canary_release_id}" \
      "${canary_home_root}" "${canary_release_id}" \
      "status canary home"
  ' bash \
    "${release_dir}/scripts/deploy/prepare-release-runtime.sh" \
    "${canary_release_id}" "${canary_workspace_root}" \
    "${canary_home_root}" "${builder_uid}"
  rmdir -- "${canary_workspace_root}" "${canary_home_root}"
  printf 'Transient builder %s status canary verified: %s -> %s\n' \
    "${canary_mode}" "${canary_release_id}" "${expected_status}"
}

LINUX_RELEASE_HANDOFF_DEPLOY_ROOT=''
LINUX_RELEASE_HANDOFF_DEPLOY_ROOT_DEVICE_INODE=''
LINUX_RELEASE_HANDOFF_RUNNER_TEMP=''
LINUX_RELEASE_HANDOFF_RUNTIME_GROUP_OWNED=0
LINUX_RELEASE_HANDOFF_BUILDER_GROUP_OWNED=0
LINUX_RELEASE_HANDOFF_RUNTIME_USER_OWNED=0
LINUX_RELEASE_HANDOFF_BUILDER_USER_OWNED=0
LINUX_RELEASE_HANDOFF_RUNTIME_UID=''
LINUX_RELEASE_HANDOFF_BUILDER_UID=''
LINUX_RELEASE_HANDOFF_RUNTIME_GID=''
LINUX_RELEASE_HANDOFF_BUILDER_GID=''

linux_release_handoff_remove_owned_group() {
  local name="$1"
  local expected_gid="$2"
  local user_removed="$3"
  local entry
  local lookup_status
  local observed_name
  local password
  local observed_gid
  local members

  if entry="$(getent group "${name}")"; then
    [[ "${entry}" != *$'\n'* ]] || return 70
    IFS=: read -r observed_name password observed_gid members <<<"${entry}"
    [[ "${observed_name}" == "${name}" && "${observed_gid}" == "${expected_gid}" ]] || return 70
    groupdel "${name}"
    return
  else
    lookup_status="$?"
  fi
  # Some shadow configurations remove the matching private group in userdel.
  # Accept that only after our successful user deletion and two absent lookups.
  [[ "${lookup_status}" -eq 2 && "${user_removed}" -eq 1 ]] || return 70
  if getent group "${expected_gid}" >/dev/null 2>&1; then
    return 70
  else
    lookup_status="$?"
  fi
  [[ "${lookup_status}" -eq 2 ]] || return 70
}

linux_release_handoff_cleanup() {
  local original_status="$1"
  local cleanup_failed=0
  local cleanup_uid=''
  local cleanup_gid=''
  local builder_identity_preserved=0
  local runtime_identity_preserved=0
  local builder_user_removed=0
  local runtime_user_removed=0
  trap - EXIT
  trap '' INT TERM HUP

  if [[ "${LINUX_RELEASE_HANDOFF_BUILDER_USER_OWNED}" -eq 1 ]]; then
    if ! cleanup_uid="$(id -u diesel-build 2>/dev/null)" ||
      ! cleanup_gid="$(id -g diesel-build 2>/dev/null)" ||
      [[ "${cleanup_uid}" != "${LINUX_RELEASE_HANDOFF_BUILDER_UID}" ]] ||
      [[ "${cleanup_gid}" != "${LINUX_RELEASE_HANDOFF_BUILDER_GID}" ]]; then
      echo "Refusing to remove a replaced diesel-build identity" >&2
      cleanup_failed=1
      builder_identity_preserved=1
    else
      if ! linux_release_handoff_stop_uid_processes \
        "${cleanup_uid}" diesel-build; then
        cleanup_failed=1
        echo "Retaining the diesel-build identity for runner teardown" >&2
        builder_identity_preserved=1
      elif ! userdel diesel-build; then
        cleanup_failed=1
        builder_identity_preserved=1
      else
        builder_user_removed=1
      fi
    fi
  fi
  if [[ "${LINUX_RELEASE_HANDOFF_RUNTIME_USER_OWNED}" -eq 1 ]]; then
    if ! cleanup_uid="$(id -u diesel 2>/dev/null)" ||
      ! cleanup_gid="$(id -g diesel 2>/dev/null)" ||
      [[ "${cleanup_uid}" != "${LINUX_RELEASE_HANDOFF_RUNTIME_UID}" ]] ||
      [[ "${cleanup_gid}" != "${LINUX_RELEASE_HANDOFF_RUNTIME_GID}" ]]; then
      echo "Refusing to remove a replaced diesel identity" >&2
      cleanup_failed=1
      runtime_identity_preserved=1
    else
      if ! linux_release_handoff_stop_uid_processes \
        "${cleanup_uid}" diesel; then
        cleanup_failed=1
        echo "Retaining the diesel identity for runner teardown" >&2
        runtime_identity_preserved=1
      elif ! userdel diesel; then
        cleanup_failed=1
        runtime_identity_preserved=1
      else
        runtime_user_removed=1
      fi
    fi
  fi

  if [[ -n "${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT}" ]]; then
    if [[ "${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT%/*}" != "${LINUX_RELEASE_HANDOFF_RUNNER_TEMP}" ]] ||
      [[ "${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT##*/}" != diesel-release-handoff.* ]]; then
      echo "Refusing to remove an unexpected Linux handoff root" >&2
      cleanup_failed=1
    fi
    if [[ "${cleanup_failed}" -eq 0 ]]; then
      if [[ ! -d "${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT}" ||
        -L "${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT}" ]] ||
        [[ "$(realpath -- "${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT}")" != "${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT}" ]] ||
        [[ -z "${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT_DEVICE_INODE}" ]] ||
        [[ "$(stat -c '%d:%i' -- "${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT}")" != "${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT_DEVICE_INODE}" ]]; then
        echo "Refusing to remove a replaced Linux handoff root" >&2
        cleanup_failed=1
      elif ! rm -rf -- "${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT}"; then
        cleanup_failed=1
      fi
    else
      echo "Retaining the Linux handoff root for ephemeral runner teardown" >&2
    fi
  fi

  if [[ "${LINUX_RELEASE_HANDOFF_BUILDER_GROUP_OWNED}" -eq 1 ]]; then
    if [[ "${builder_identity_preserved}" -eq 1 ]]; then
      echo "Retaining the diesel-build group with its user" >&2
    elif ! linux_release_handoff_remove_owned_group diesel-build \
      "${LINUX_RELEASE_HANDOFF_BUILDER_GID}" "${builder_user_removed}"; then
      echo "Refusing or failing to remove a replaced diesel-build group" >&2
      cleanup_failed=1
    fi
  fi
  if [[ "${LINUX_RELEASE_HANDOFF_RUNTIME_GROUP_OWNED}" -eq 1 ]]; then
    if [[ "${runtime_identity_preserved}" -eq 1 ]]; then
      echo "Retaining the diesel group with its user" >&2
    elif ! linux_release_handoff_remove_owned_group diesel \
      "${LINUX_RELEASE_HANDOFF_RUNTIME_GID}" "${runtime_user_removed}"; then
      echo "Refusing or failing to remove a replaced diesel group" >&2
      cleanup_failed=1
    fi
  fi

  if [[ "${cleanup_failed}" -ne 0 ]]; then
    exit 70
  fi
  exit "${original_status}"
}

linux_release_handoff_main() {
  if [[ "$#" -ne 4 ]] || [[ ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
    linux_release_handoff_usage
    return 64
  fi

  local release_id="$1"
  local release_export_input="$2"
  local node_binary_input="$3"
  local runner_temp_input="$4"
  local release_export
  local release_export_parent
  local node_binary
  local runner_temp
  local deploy_root=''
  local release_root
  local release_dir
  local build_root
  local build_workspace_root
  local shared_root
  local data_root
  local state_root
  local environment_path
  local environment_backup
  local fixed_path
  local available_kib
  local cp_version
  local stat_version
  local runuser_version
  local runtime_uid
  local builder_uid
  local runtime_gid
  local builder_gid
  local candidate_identity_id
  local identity_uid
  local lookup_status
  local process_probe_status
  local deploy_root_device_inode

  trap 'linux_release_handoff_cleanup "$?"' EXIT
  linux_release_handoff_install_signal_traps

  if [[ "${CI:-}" != 'true' || "${GITHUB_ACTIONS:-}" != 'true' ||
    "${RUNNER_ENVIRONMENT:-}" != 'github-hosted' ]]; then
    linux_release_handoff_fail 77 \
      "Linux release handoff smoke only runs on a GitHub-hosted CI runner"
    return
  fi
  if [[ "$(id -u)" -ne 0 ]] || [[ "$(uname -s)" != 'Linux' ]]; then
    linux_release_handoff_fail 77 \
      "Linux release handoff smoke requires root on Linux"
    return
  fi
  for command_name in \
    awk bash chmod chown corepack cp df dirname findmnt flock getent groupadd \
    groupdel id install mktemp pgrep pkill realpath rm rsync runuser sleep stat \
    systemctl systemd systemd-run timeout uname useradd userdel rmdir; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      linux_release_handoff_fail 70 \
        "required Linux handoff command is unavailable: ${command_name}"
      return
    fi
  done
  if ! cp_version="$(cp --version 2>/dev/null)" ||
    ! stat_version="$(stat --version 2>/dev/null)" ||
    ! runuser_version="$(runuser --version 2>/dev/null)" ||
    [[ "${cp_version}" != *'GNU coreutils'* ]] ||
    [[ "${stat_version}" != *'GNU coreutils'* ]] ||
    [[ "${runuser_version}" != *'util-linux'* ]]; then
    linux_release_handoff_fail 70 \
      "GNU coreutils and util-linux runuser are required"
    return
  fi

  for candidate_path in \
    "${release_export_input}" "${node_binary_input}" "${runner_temp_input}"; do
    if [[ ! "${candidate_path}" =~ ^/[^[:cntrl:]]+$ ]]; then
      linux_release_handoff_fail 64 \
        "Linux handoff paths must be absolute and control-character free"
      return
    fi
  done
  if ! release_export="$(realpath -- "${release_export_input}")" ||
    ! node_binary="$(realpath -- "${node_binary_input}")" ||
    ! runner_temp="$(realpath -- "${runner_temp_input}")"; then
    linux_release_handoff_fail 70 \
      "Linux handoff inputs must resolve to canonical real paths"
    return
  fi
  if [[ "${release_export}" != "${release_export_input}" ||
    ! -d "${release_export}" || -L "${release_export}" ||
    "${node_binary}" != "${node_binary_input}" ||
    ! -f "${node_binary}" || -L "${node_binary}" || ! -x "${node_binary}" ||
    "${runner_temp}" != "${runner_temp_input}" ||
    ! -d "${runner_temp}" || -L "${runner_temp}" ]]; then
    linux_release_handoff_fail 70 \
      "Linux handoff inputs must be canonical real paths"
    return
  fi
  release_export_parent="${release_export%/release}"
  if [[ "${release_export_parent}/release" != "${release_export}" ||
    "${release_export_parent%/*}" != "${runner_temp}" ||
    "${release_export_parent##*/}" != diesel-release-export.* ]]; then
    linux_release_handoff_fail 70 \
      "release export must be an isolated child of the runner temp directory"
    return
  fi
  LINUX_RELEASE_HANDOFF_RUNNER_TEMP="${runner_temp}"
  for required_input in \
    .release-input-manifest.json \
    scripts/deploy/build-release.sh \
    scripts/deploy/prepare-release-runtime.sh \
    scripts/deploy/release-artifact-manifest.mjs; do
    if [[ ! -f "${release_export}/${required_input}" ||
      -L "${release_export}/${required_input}" ]]; then
      linux_release_handoff_fail 70 \
        "release export is missing a required regular input: ${required_input}"
      return
    fi
  done

  if ! available_kib="$(df -Pk "${runner_temp}" | awk 'NR == 2 { print $4 }')"; then
    linux_release_handoff_fail 70 \
      "Linux handoff smoke could not read runner disk capacity"
    return
  fi
  if [[ ! "${available_kib}" =~ ^[0-9]+$ ]] ||
    [[ "${available_kib}" -lt 8388608 ]]; then
    linux_release_handoff_fail 70 \
      "Linux handoff smoke requires at least 8 GiB free"
    return
  fi
  for identity_name in diesel diesel-build; do
    if getent passwd "${identity_name}" >/dev/null 2>&1; then
      linux_release_handoff_fail 70 \
        "CI identity already exists and will not be reused: ${identity_name}"
      return
    else
      lookup_status="$?"
      if [[ "${lookup_status}" -ne 2 ]]; then
        linux_release_handoff_fail 70 \
          "passwd identity lookup failed: ${identity_name}"
        return
      fi
    fi
    if getent group "${identity_name}" >/dev/null 2>&1; then
      linux_release_handoff_fail 70 \
        "CI identity already exists and will not be reused: ${identity_name}"
      return
    else
      lookup_status="$?"
      if [[ "${lookup_status}" -ne 2 ]]; then
        linux_release_handoff_fail 70 \
          "group identity lookup failed: ${identity_name}"
        return
      fi
    fi
  done
  runtime_uid=''
  builder_uid=''
  for ((candidate_identity_id = 300; candidate_identity_id <= 899; candidate_identity_id++)); do
    if getent passwd "${candidate_identity_id}" >/dev/null 2>&1; then
      continue
    else
      lookup_status="$?"
      if [[ "${lookup_status}" -ne 2 ]]; then
        linux_release_handoff_fail 70 \
          "numeric passwd lookup failed: ${candidate_identity_id}"
        return
      fi
    fi
    if getent group "${candidate_identity_id}" >/dev/null 2>&1; then
      continue
    else
      lookup_status="$?"
      if [[ "${lookup_status}" -ne 2 ]]; then
        linux_release_handoff_fail 70 \
          "numeric group lookup failed: ${candidate_identity_id}"
        return
      fi
    fi
    if pgrep -u "${candidate_identity_id}" >/dev/null 2>&1; then
      continue
    else
      process_probe_status="$?"
      if [[ "${process_probe_status}" -ne 1 ]]; then
        linux_release_handoff_fail 70 \
          "numeric process lookup failed: ${candidate_identity_id}"
        return
      fi
    fi
    if [[ -z "${runtime_uid}" ]]; then
      runtime_uid="${candidate_identity_id}"
    else
      builder_uid="${candidate_identity_id}"
      break
    fi
  done
  if [[ ! "${runtime_uid}" =~ ^[0-9]+$ || ! "${builder_uid}" =~ ^[0-9]+$ ]]; then
    linux_release_handoff_fail 70 \
      "CI could not reserve two unused system identity IDs"
    return
  fi
  runtime_gid="${runtime_uid}"
  builder_gid="${builder_uid}"
  LINUX_RELEASE_HANDOFF_RUNTIME_UID="${runtime_uid}"
  LINUX_RELEASE_HANDOFF_RUNTIME_GID="${runtime_gid}"
  LINUX_RELEASE_HANDOFF_BUILDER_UID="${builder_uid}"
  LINUX_RELEASE_HANDOFF_BUILDER_GID="${builder_gid}"

  trap '' INT TERM HUP
  if ! groupadd --system --gid "${runtime_gid}" diesel; then
    linux_release_handoff_install_signal_traps
    linux_release_handoff_fail 70 "CI runtime group creation failed"
    return
  fi
  LINUX_RELEASE_HANDOFF_RUNTIME_GROUP_OWNED=1
  linux_release_handoff_install_signal_traps
  if ! runtime_gid="$(
    getent group diesel | awk -F: '$1 == "diesel" { print $3 }'
  )" || [[ "${runtime_gid}" != "${LINUX_RELEASE_HANDOFF_RUNTIME_GID}" ]]; then
    linux_release_handoff_fail 70 \
      "CI runtime group could not be resolved"
    return
  fi
  trap '' INT TERM HUP
  if ! groupadd --system --gid "${builder_gid}" diesel-build; then
    linux_release_handoff_install_signal_traps
    linux_release_handoff_fail 70 "CI builder group creation failed"
    return
  fi
  LINUX_RELEASE_HANDOFF_BUILDER_GROUP_OWNED=1
  linux_release_handoff_install_signal_traps
  if ! builder_gid="$(
    getent group diesel-build | awk -F: '$1 == "diesel-build" { print $3 }'
  )" || [[ "${builder_gid}" != "${LINUX_RELEASE_HANDOFF_BUILDER_GID}" ]]; then
    linux_release_handoff_fail 70 \
      "CI builder group could not be resolved"
    return
  fi

  trap '' INT TERM HUP
  if ! useradd --system --uid "${runtime_uid}" --gid diesel \
    --home-dir /nonexistent --shell /usr/sbin/nologin --no-create-home diesel; then
    linux_release_handoff_install_signal_traps
    linux_release_handoff_fail 70 "CI runtime user creation failed"
    return
  fi
  LINUX_RELEASE_HANDOFF_RUNTIME_USER_OWNED=1
  linux_release_handoff_install_signal_traps
  if [[ "$(id -u diesel)" != "${LINUX_RELEASE_HANDOFF_RUNTIME_UID}" ]] ||
    [[ "$(id -g diesel)" != "${runtime_gid}" ]]; then
    linux_release_handoff_fail 70 \
      "CI runtime identity could not be resolved"
    return
  fi

  trap '' INT TERM HUP
  if ! useradd --system --uid "${builder_uid}" --gid diesel-build \
    --home-dir /nonexistent --shell /usr/sbin/nologin --no-create-home diesel-build; then
    linux_release_handoff_install_signal_traps
    linux_release_handoff_fail 70 "CI builder user creation failed"
    return
  fi
  LINUX_RELEASE_HANDOFF_BUILDER_USER_OWNED=1
  linux_release_handoff_install_signal_traps
  if [[ "$(id -u diesel-build)" != "${LINUX_RELEASE_HANDOFF_BUILDER_UID}" ]] ||
    [[ "$(id -g diesel-build)" != "${builder_gid}" ]]; then
    linux_release_handoff_fail 70 \
      "CI builder identity could not be resolved"
    return
  fi
  if [[ "${runtime_uid}" -eq 0 || "${builder_uid}" -eq 0 ||
    "${runtime_uid}" -eq "${builder_uid}" ||
    "${runtime_gid}" -eq 0 || "${builder_gid}" -eq 0 ||
    "${runtime_gid}" -eq "${builder_gid}" ||
    "$(id -G diesel)" != "${runtime_gid}" ||
    "$(id -G diesel-build)" != "${builder_gid}" ]]; then
    linux_release_handoff_fail 70 \
      "CI runtime and builder identities are not isolated"
    return
  fi

  if ! deploy_root="$(mktemp -d "${runner_temp}/diesel-release-handoff.XXXXXX")"; then
    linux_release_handoff_fail 70 \
      "Linux handoff smoke could not create its isolated root"
    return
  fi
  LINUX_RELEASE_HANDOFF_DEPLOY_ROOT="${deploy_root}"
  if ! deploy_root="$(realpath -- "${deploy_root}")"; then
    linux_release_handoff_fail 70 \
      "Linux handoff root could not be resolved"
    return
  fi
  LINUX_RELEASE_HANDOFF_DEPLOY_ROOT="${deploy_root}"
  if ! deploy_root_device_inode="$(stat -c '%d:%i' -- "${deploy_root}")" ||
    [[ ! "${deploy_root_device_inode}" =~ ^[0-9]+:[0-9]+$ ]]; then
    linux_release_handoff_fail 70 \
      "Linux handoff root identity could not be recorded"
    return
  fi
  LINUX_RELEASE_HANDOFF_DEPLOY_ROOT_DEVICE_INODE="${deploy_root_device_inode}"
  release_root="${deploy_root}/releases"
  release_dir="${release_root}/${release_id}"
  build_root="${deploy_root}/build"
  build_workspace_root="${deploy_root}/build-workspaces"
  shared_root="${deploy_root}/shared"
  data_root="${shared_root}/.data"
  state_root="${deploy_root}/backups/${release_id}"
  environment_path="${shared_root}/.env.production.local"
  environment_backup="${state_root}/env.production.local.pre-switch"

  chmod 755 "${deploy_root}"
  install -m 0600 -o root -g root /dev/null \
    "${deploy_root}/.release-build.lock"
  install -d -m 0755 -o root -g root "${release_root}"
  install -d -m 0750 -o root -g diesel "${release_dir}"
  install -d -m 0710 -o root -g diesel-build "${build_root}"
  install -d -m 0750 -o root -g diesel "${shared_root}"
  install -d -m 0750 -o diesel -g diesel "${data_root}"
  install -d -m 0700 -o root -g root "${deploy_root}/backups" "${state_root}"
  install -m 0640 -o root -g diesel /dev/null "${environment_path}"
  printf '%s\n' \
    'NODE_ENV=production' \
    'DATABASE_MODE=postgres' \
    'DATABASE_URL=postgresql://database.invalid/diesel' \
    'AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY=50000' \
    'AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY=500' \
    'AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR=300' \
    'AI_CHAT_RATE_LIMIT_PER_HOUR=30' \
    'AI_CHAT_RATE_LIMIT_BACKEND=postgres' \
    >"${environment_path}"
  install -m 0600 -o root -g root \
    "${environment_path}" "${environment_backup}"

  rsync -a --no-owner --no-group --no-perms -- \
    "${release_export}/" "${release_dir}/"
  if [[ -L "${release_dir}" ]] ||
    [[ "$(stat -c '%U:%G:%a' "${release_dir}")" != 'root:diesel:750' ]]; then
    linux_release_handoff_fail 70 \
      "rsync changed the pre-created release root boundary"
    return
  fi

  fixed_path="$(dirname -- "${node_binary}"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  linux_release_handoff_run_cgroup_canary \
    "${release_id}" "${deploy_root}" "${release_dir}" \
    "${fixed_path}" "${builder_uid}"
  linux_release_handoff_run_status_canary \
    "${release_id}" "${deploy_root}" "${release_dir}" \
    "${fixed_path}" "${builder_uid}" exit-code
  linux_release_handoff_run_status_canary \
    "${release_id}" "${deploy_root}" "${release_dir}" \
    "${fixed_path}" "${builder_uid}" signal
  (
    # Keep sourced shell options, traps, and function names inside this child;
    # the outer EXIT trap must remain authoritative for identities and temp root.
    # shellcheck source=/dev/null
    source "${release_dir}/scripts/deploy/prepare-release-runtime.sh"
    prepare_release_runtime \
      "${release_id}" "${deploy_root}" "${fixed_path}" "${node_binary}" \
      "/proc"
  )

  for marker in .build-complete .deploy-ready; do
    if [[ "$(stat -c '%U:%G:%a' "${release_dir}/${marker}")" != \
      'root:diesel:640' ]]; then
      linux_release_handoff_fail 70 \
        "release marker has unexpected metadata: ${marker}"
      return
    fi
  done
  for artifact_root in .next node_modules; do
    if [[ ! -d "${release_dir}/${artifact_root}" ||
      -L "${release_dir}/${artifact_root}" ]]; then
      linux_release_handoff_fail 70 \
        "release artifact root is invalid: ${artifact_root}"
      return
    fi
  done
  (
    cd "${release_dir}"
    "${node_binary}" scripts/deploy/release-artifact-manifest.mjs \
      check-ready "${release_id}" .build-complete .deploy-ready \
      0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}" >/dev/null
  )
  chown diesel:diesel "${release_root}"
  if (
    cd "${release_dir}"
    "${node_binary}" scripts/deploy/release-artifact-manifest.mjs \
      check-ready "${release_id}" .build-complete .deploy-ready \
      0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}" \
      >/dev/null 2>&1
  ); then
    linux_release_handoff_fail 70 \
      "check-ready accepted a runtime-owned releases directory"
    return
  fi
  chown root:root "${release_root}"
  chown diesel:diesel "${deploy_root}"
  if (
    cd "${release_dir}"
    "${node_binary}" scripts/deploy/release-artifact-manifest.mjs \
      check-ready "${release_id}" .build-complete .deploy-ready \
      0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}" \
      >/dev/null 2>&1
  ); then
    linux_release_handoff_fail 70 \
      "check-ready accepted a runtime-owned deployment root"
    return
  fi
  chown root:root "${deploy_root}"
  chmod 660 "${release_dir}/.next/BUILD_ID"
  if (
    cd "${release_dir}"
    "${node_binary}" scripts/deploy/release-artifact-manifest.mjs \
      check-ready "${release_id}" .build-complete .deploy-ready \
      0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}" \
      >/dev/null 2>&1
  ); then
    linux_release_handoff_fail 70 \
      "check-ready accepted a group-writable immutable artifact"
    return
  fi
  chmod 640 "${release_dir}/.next/BUILD_ID"
  chown diesel:diesel "${release_dir}/.next/BUILD_ID"
  if (
    cd "${release_dir}"
    "${node_binary}" scripts/deploy/release-artifact-manifest.mjs \
      check-ready "${release_id}" .build-complete .deploy-ready \
      0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}" \
      >/dev/null 2>&1
  ); then
    linux_release_handoff_fail 70 \
      "check-ready accepted a runtime-owned immutable artifact"
    return
  fi
  chown root:diesel "${release_dir}/.next/BUILD_ID"
  (
    cd "${release_dir}"
    "${node_binary}" scripts/deploy/release-artifact-manifest.mjs \
      check-ready "${release_id}" .build-complete .deploy-ready \
      0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}" >/dev/null
  )
  if [[ -e "${build_root}/${release_id}" ||
    -e "${build_workspace_root}/${release_id}" ]]; then
    linux_release_handoff_fail 70 \
      "runtime or builder state/processes remained after the handoff"
    return
  fi
  (
    # Re-read the exact shipped controller and independently assert that its
    # deterministic transient unit and cgroup are gone after the handoff.
    # shellcheck source=/dev/null
    source "${release_dir}/scripts/deploy/prepare-release-runtime.sh"
    prepare_release_require_unit_absent \
      "diesel-build-${release_id}.service"
    prepare_release_require_control_group_absent \
      "/system.slice/diesel-build-${release_id}.service"
    if prepare_release_control_group_has_processes \
      /proc "/system.slice/diesel-build-${release_id}.service"; then
      linux_release_handoff_fail 70 \
        "build control group retained processes after the handoff"
      exit 70
    else
      process_probe_status="$?"
      [[ "${process_probe_status}" -eq 1 ]] || exit "${process_probe_status}"
    fi
    if prepare_release_control_group_is_populated \
      "/system.slice/diesel-build-${release_id}.service"; then
      linux_release_handoff_fail 70 \
        "build control group remained populated after the handoff"
      exit 70
    else
      process_probe_status="$?"
      [[ "${process_probe_status}" -eq 1 ]] || exit "${process_probe_status}"
    fi
  )
  for identity_uid in "${runtime_uid}" "${builder_uid}"; do
    if linux_release_handoff_uid_has_processes "${identity_uid}"; then
      linux_release_handoff_fail 70 \
        "runtime or builder state/processes remained after the handoff"
      return
    else
      process_probe_status="$?"
      if [[ "${process_probe_status}" -ne 1 ]]; then
        linux_release_handoff_fail 70 \
          "runtime or builder process verification failed"
        return
      fi
    fi
  done

  printf 'Linux release handoff verified: %s\n' "${release_id}"
}

linux_release_handoff_main "$@"
