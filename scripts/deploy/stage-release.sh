#!/usr/bin/env bash
set +x
set +v
set -Eeuo pipefail
umask 077
IFS=$' \t\n'
export LANG=C
export LC_ALL=C

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  printf '%s\n' "stage-release.sh must be executed, not sourced" >&2
  return 64 2>/dev/null || exit 64
fi

temp_root=""
temp_root_identity=""
stat_bin=""
rm_bin=""
active_bounded_command_pid=""
active_bounded_command_receipt_path=""
active_bounded_command_receipt_token=""
bounded_command_launching=0
last_bounded_command_status=0
bounded_command_containment_unproven=0
bounded_command_receipt_sequence=0
pending_signal=""
pending_signal_status=""

finish_pending_signal() {
  local runner_pid="${active_bounded_command_pid}"
  local current_job_pid=""
  local runner_status=126
  trap '' HUP INT TERM
  if [[ -n "${runner_pid}" ]]; then
    # The Bash jobspec is the identity-bearing capability for an unreaped
    # direct child. A cached numeric PID can be reused after wait has reaped
    # the runner but before this trap runs, so never signal runner_pid itself.
    current_job_pid="$(jobs -p %% 2>/dev/null || true)"
    if [[ "${current_job_pid}" == "${runner_pid}" ]]; then
      builtin kill -s "${pending_signal}" "%%" 2>/dev/null || true
    fi
    if builtin wait "${runner_pid}" 2>/dev/null; then
      runner_status=0
    else
      runner_status="$?"
    fi
    active_bounded_command_pid=""
    if validate_bounded_command_receipt \
      "${active_bounded_command_receipt_path}" \
      "${active_bounded_command_receipt_token}" \
      "${runner_status}"; then
      bounded_command_containment_unproven=0
    else
      printf '%s\n' \
        "bounded command did not provide a trustworthy containment receipt: ${active_bounded_command_receipt_path:-[unavailable]}" >&2
    fi
    active_bounded_command_receipt_path=""
    active_bounded_command_receipt_token=""
  fi
  exit "${pending_signal_status}"
}

handle_signal() {
  local signal="$1"
  local status="$2"
  if [[ -z "${pending_signal_status}" ]]; then
    pending_signal="${signal}"
    pending_signal_status="${status}"
  fi
  if [[ "${bounded_command_launching}" -eq 1 && -z "${active_bounded_command_pid}" ]]; then
    return 0
  fi
  finish_pending_signal
}

trap 'handle_signal HUP 129' HUP
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM

fail() {
  local status="$1"
  shift
  printf '%s\n' "$*" >&2
  exit "${status}"
}

directory_identity() {
  local path="$1"
  local identity=""
  if identity="$("${stat_bin}" -f '%u:%Lp:%d:%i' "${path}" 2>/dev/null)"; then
    :
  elif identity="$("${stat_bin}" -c '%u:%a:%d:%i' -- "${path}" 2>/dev/null)"; then
    :
  else
    return 1
  fi
  [[ "${identity}" =~ ^[0-9]+:700:[0-9]+:[0-9]+$ ]] || return 1
  printf '%s\n' "${identity}"
}

remove_temp_root() {
  local current_identity=""
  local current_path=""
  [[ -z "${temp_root}" ]] && return 0
  if [[ -z "${stat_bin}" || -z "${rm_bin}" || ! -d "${temp_root}" || -L "${temp_root}" ]]; then
    printf '%s\n' "refusing to clean an untrusted staging temporary path: ${temp_root}" >&2
    return 70
  fi
  current_path="$(CDPATH= cd -- "${temp_root}" 2>/dev/null && pwd -P)" || {
    printf '%s\n' "could not resolve the staging temporary path during cleanup" >&2
    return 70
  }
  current_identity="$(directory_identity "${temp_root}")" || {
    printf '%s\n' "staging temporary directory identity drifted; preserving it for inspection" >&2
    return 70
  }
  if [[ "${current_path}" != "${temp_root}" || "${current_identity}" != "${temp_root_identity}" ]]; then
    printf '%s\n' "staging temporary directory was replaced; preserving it for inspection" >&2
    return 70
  fi
  "${rm_bin}" -rf -- "${temp_root}" || {
    printf '%s\n' "failed to remove the verified staging temporary directory" >&2
    return 70
  }
  if [[ -e "${temp_root}" || -L "${temp_root}" ]]; then
    printf '%s\n' "staging temporary directory still exists after cleanup" >&2
    return 70
  fi
  temp_root=""
  temp_root_identity=""
}

cleanup_on_exit() {
  local status="$?"
  trap - EXIT
  trap '' HUP INT TERM
  set +e
  local cleanup_status=0
  if [[ "${bounded_command_containment_unproven}" -eq 1 ]]; then
    printf '%s\n' \
      "bounded command containment is unproven; preserving local staging state for operator inspection: ${temp_root:-[not-created]}" >&2
    cleanup_status=70
  else
    remove_temp_root
    cleanup_status="$?"
  fi
  if [[ "${status}" -eq 0 && "${cleanup_status}" -ne 0 ]]; then
    status=70
  fi
  exit "${status}"
}
trap cleanup_on_exit EXIT

if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  fail 64 "usage: stage-release.sh <full-lowercase-git-sha>"
fi

readonly release_id="$1"
readonly stage_script_path="scripts/deploy/stage-release.sh"
readonly authorization_bundle_path="scripts/deploy/verify-release-authorization.bundle.mjs"
readonly authorization_license_path="scripts/deploy/verify-release-authorization.bundle.LICENSE"
readonly manifest_helper_path="scripts/deploy/release-input-manifest.mjs"
readonly bounded_command_path="scripts/deploy/run-bounded-command.mjs"
readonly manifest_name=".release-input-manifest.json"
readonly remote_target="root@111.228.50.85"
readonly deploy_root="/opt/diesel"
readonly releases_root="${deploy_root}/releases"
readonly remote_release_dir="${releases_root}/${release_id}"
readonly remote_node_bin="/opt/node-v22.22.3-linux-x64/bin/node"

# A non-interactive shell reads BASH_ENV before this file starts. The committed
# runbook bootstrap clears it as well; unset it again so no child inherits an
# injection hook. Tool-specific env -i calls below keep application secrets out
# of Git, Node, SSH, and rsync processes.
unset BASH_ENV BASH_XTRACEFD ENV CDPATH GLOBIGNORE PS4 \
  NODE_OPTIONS NODE_PATH npm_config_node_options \
  NPM_CONFIG_NODE_OPTIONS TAR_OPTIONS RSYNC_RSH RSYNC_PROXY SSH_ASKPASS \
  SSH_ASKPASS_REQUIRE GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE \
  GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES \
  GIT_COMMON_DIR GIT_REPLACE_REF_BASE GIT_CONFIG_COUNT \
  GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 \
  ADMIN_ROLE_BINDINGS_JSON AI_API_KEY ANTHROPIC_API_KEY DATABASE_URL \
  DIRECT_URL OPENAI_API_KEY SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY

resolve_tool() {
  local name="$1"
  local resolved=""
  resolved="$(type -P "${name}" 2>/dev/null)" || fail 69 "required local tool is unavailable: ${name}"
  [[ "${resolved}" == /* && "${resolved}" =~ ^[A-Za-z0-9_./+@-]+$ ]] ||
    fail 69 "required local tool has an unsupported path: ${name}"
  printf '%s\n' "${resolved}"
}

env_bin="$(resolve_tool env)"
cat_bin="$(resolve_tool cat)"
git_bin="$(resolve_tool git)"
id_bin="$(resolve_tool id)"
mkdir_bin="$(resolve_tool mkdir)"
mktemp_bin="$(resolve_tool mktemp)"
mv_bin="$(resolve_tool mv)"
node_bin="$(resolve_tool node)"
rm_bin="$(resolve_tool rm)"
rsync_bin="$(resolve_tool rsync)"
ssh_bin="$(resolve_tool ssh)"
stat_bin="$(resolve_tool stat)"
tar_bin="$(resolve_tool tar)"
wc_bin="$(resolve_tool wc)"

gh_bin="$(type -P gh 2>/dev/null || true)"
if [[ -n "${gh_bin}" && ( "${gh_bin}" != /* || ! "${gh_bin}" =~ ^[A-Za-z0-9_./+@-]+$ ) ]]; then
  fail 69 "GitHub CLI has an unsupported path"
fi

trusted_path="${node_bin%/*}:${git_bin%/*}"
if [[ -n "${gh_bin}" ]]; then
  trusted_path="${trusted_path}:${gh_bin%/*}"
fi
trusted_path="${trusted_path}:/usr/bin:/bin:/usr/sbin:/sbin"

git_environment=(
  "${env_bin}" -i
  "HOME=/nonexistent"
  "LANG=C"
  "LC_ALL=C"
  "PATH=${trusted_path}"
  "GIT_CONFIG_GLOBAL=/dev/null"
  "GIT_CONFIG_NOSYSTEM=1"
  "GIT_NO_REPLACE_OBJECTS=1"
  "GIT_OPTIONAL_LOCKS=0"
  "GIT_TERMINAL_PROMPT=0"
  "NO_COLOR=1"
)

run_git() {
  "${git_environment[@]}" "${git_bin}" \
    -c core.fsmonitor=false \
    -c core.hooksPath=/dev/null \
    -c diff.external= \
    "$@"
}

repo_root="$(run_git rev-parse --show-toplevel 2>/dev/null)" ||
  fail 64 "stage-release.sh must run from a Git worktree root"
repo_root="$(CDPATH= cd -- "${repo_root}" && pwd -P)" ||
  fail 64 "could not resolve the Git worktree root"
physical_cwd="$(pwd -P)"
[[ "${physical_cwd}" == "${repo_root}" ]] ||
  fail 64 "stage-release.sh must run from the physical Git worktree root"

stage_invocation_path="${BASH_SOURCE[0]}"
if [[ "${stage_invocation_path}" != /* ]]; then
  stage_invocation_parent="${stage_invocation_path%/*}"
  [[ "${stage_invocation_parent}" != "${stage_invocation_path}" ]] || stage_invocation_parent="."
  stage_invocation_path="$(CDPATH= cd -- "${stage_invocation_parent}" && pwd -P)/${stage_invocation_path##*/}"
fi
[[ -f "${stage_invocation_path}" && ! -L "${stage_invocation_path}" && -x "${stage_invocation_path}" ]] ||
  fail 64 "the executing stage script must be a regular executable committed export"

assert_repo_state() {
  local branch=""
  local head=""
  local index_entry=""
  local index_state=""
  local status=""
  head="$(run_git rev-parse --verify 'HEAD^{commit}')" || return 1
  [[ "${head}" == "${release_id}" ]] ||
    fail 65 "release SHA does not match the current Git HEAD"
  branch="$(run_git symbolic-ref --quiet --short HEAD)" ||
    fail 65 "release staging requires an attached master branch"
  [[ "${branch}" == "master" ]] ||
    fail 65 "release staging requires the master branch"
  status="$(run_git status --porcelain=v1 --untracked-files=all --ignore-submodules=none)" || return 1
  [[ -z "${status}" ]] || fail 65 "release staging requires a fully clean worktree"
  index_state="$(run_git -c core.quotePath=true ls-files -v)" || return 1
  while IFS= read -r index_entry; do
    [[ -z "${index_entry}" || "${index_entry}" == "H "* ]] ||
      fail 65 "release staging rejects assume-unchanged, skip-worktree, and non-normal index entries"
  done <<< "${index_state}"
}

commit_blob_for() {
  local path="$1"
  local expected_mode="$2"
  local entry=""
  local metadata=""
  local entry_path=""
  local mode=""
  local type=""
  local blob=""
  local extra=""
  entry="$(run_git ls-tree "${release_id}" -- "${path}")" || return 1
  [[ "${entry}" == *$'\t'* ]] || fail 65 "release commit is missing ${path}"
  metadata="${entry%%$'\t'*}"
  entry_path="${entry#*$'\t'}"
  IFS=' ' read -r mode type blob extra <<< "${metadata}"
  [[ "${entry_path}" == "${path}" && "${mode}" == "${expected_mode}" &&
    "${type}" == "blob" && "${blob}" =~ ^[0-9a-f]{40}$ && -z "${extra}" ]] ||
    fail 65 "release commit has an invalid mode or object for ${path}"
  printf '%s\n' "${blob}"
}

hash_file() {
  local path="$1"
  run_git hash-object --no-filters -- "${path}"
}

assert_bound_file() {
  local path="$1"
  local expected_mode="$2"
  local expected_blob="$3"
  local label="$4"
  [[ -f "${path}" && ! -L "${path}" ]] || fail 65 "${label} must be a regular file"
  if [[ "${expected_mode}" == "100755" ]]; then
    [[ -x "${path}" ]] || fail 65 "${label} lost its executable mode"
  else
    [[ ! -x "${path}" ]] || fail 65 "${label} unexpectedly became executable"
  fi
  [[ "$(hash_file "${path}")" == "${expected_blob}" ]] ||
    fail 65 "${label} does not match the release commit blob"
}

assert_repo_state
stage_blob="$(commit_blob_for "${stage_script_path}" 100755)"
authorization_bundle_blob="$(commit_blob_for "${authorization_bundle_path}" 100644)"
authorization_license_blob="$(commit_blob_for "${authorization_license_path}" 100644)"
manifest_helper_blob="$(commit_blob_for "${manifest_helper_path}" 100644)"
bounded_command_blob="$(commit_blob_for "${bounded_command_path}" 100644)"

assert_critical_bindings() {
  [[ "$(commit_blob_for "${stage_script_path}" 100755)" == "${stage_blob}" ]] ||
    fail 65 "committed stage script identity drifted"
  [[ "$(commit_blob_for "${authorization_bundle_path}" 100644)" == "${authorization_bundle_blob}" ]] ||
    fail 65 "committed authorization bundle identity drifted"
  [[ "$(commit_blob_for "${authorization_license_path}" 100644)" == "${authorization_license_blob}" ]] ||
    fail 65 "committed authorization license identity drifted"
  [[ "$(commit_blob_for "${manifest_helper_path}" 100644)" == "${manifest_helper_blob}" ]] ||
    fail 65 "committed release manifest helper identity drifted"
  [[ "$(commit_blob_for "${bounded_command_path}" 100644)" == "${bounded_command_blob}" ]] ||
    fail 65 "committed bounded command helper identity drifted"
  assert_bound_file "${stage_invocation_path}" 100755 "${stage_blob}" "executing committed stage script"
  assert_bound_file "${stage_script_path}" 100755 "${stage_blob}" "worktree stage script"
  assert_bound_file "${authorization_bundle_path}" 100644 "${authorization_bundle_blob}" "worktree authorization bundle"
  assert_bound_file "${authorization_license_path}" 100644 "${authorization_license_blob}" "worktree authorization license"
  assert_bound_file "${manifest_helper_path}" 100644 "${manifest_helper_blob}" "worktree release manifest helper"
  assert_bound_file "${bounded_command_path}" 100644 "${bounded_command_blob}" "worktree bounded command helper"
}
assert_critical_bindings

temp_root="$("${mktemp_bin}" -d)" || fail 70 "could not create a private staging temporary directory"
temp_root="$(CDPATH= cd -- "${temp_root}" && pwd -P)" ||
  fail 70 "could not resolve the staging temporary directory"
temp_root_identity="$(directory_identity "${temp_root}")" ||
  fail 70 "staging temporary directory must be owned by the caller with mode 0700"
[[ "${temp_root_identity%%:*}" == "$("${id_bin}" -u)" ]] ||
  fail 70 "staging temporary directory owner does not match the caller"

manifest_archive="${temp_root}/manifest-helper.tar"
manifest_export="${temp_root}/manifest-helper"
authorization_archive="${temp_root}/authorization-bundle.tar"
authorization_export="${temp_root}/authorization-bundle"
release_archive="${temp_root}/release.tar"
release_export="${temp_root}/release"
generated_manifest="${temp_root}/generated-release-input-manifest.json"
authorization_output="${temp_root}/authorization.json"
remote_identity_output="${temp_root}/remote-candidate-identity.txt"
remote_preflight_error="${temp_root}/remote-preflight-error.txt"
remote_preflight_script="${temp_root}/remote-preflight.sh"
rsync_output="${temp_root}/rsync-output.txt"
rsync_error="${temp_root}/rsync-error.txt"
remote_digest_output="${temp_root}/remote-input-digest.txt"
remote_postcheck_error="${temp_root}/remote-postcheck-error.txt"
remote_postcheck_script="${temp_root}/remote-postcheck.sh"
"${mkdir_bin}" -- "${manifest_export}" "${authorization_export}" "${release_export}"

run_git archive --format=tar --output="${manifest_archive}" "${release_id}" -- \
  "${manifest_helper_path}" "${bounded_command_path}"
"${env_bin}" -i "LANG=C" "LC_ALL=C" "PATH=${trusted_path}" \
  "${tar_bin}" -xf "${manifest_archive}" -C "${manifest_export}"

committed_manifest_helper="${manifest_export}/${manifest_helper_path}"
committed_bounded_command="${manifest_export}/${bounded_command_path}"
assert_bound_file "${committed_manifest_helper}" 100644 "${manifest_helper_blob}" "committed release manifest helper"
assert_bound_file "${committed_bounded_command}" 100644 "${bounded_command_blob}" "committed bounded command helper"

manifest_environment=(
  "${env_bin}" -i
  "HOME=${temp_root}"
  "LANG=C"
  "LC_ALL=C"
  "PATH=${trusted_path}"
  "GIT_CONFIG_GLOBAL=/dev/null"
  "GIT_CONFIG_NOSYSTEM=1"
  "GIT_NO_REPLACE_OBJECTS=1"
  "GIT_OPTIONAL_LOCKS=0"
  "GIT_TERMINAL_PROMPT=0"
  "NO_COLOR=1"
)
node_version="$("${manifest_environment[@]}" "${node_bin}" --version)"
[[ "${node_version}" =~ ^v22\.[0-9]+\.[0-9]+$ ]] ||
  fail 69 "release staging requires Node.js 22"
if ! "${manifest_environment[@]}" "${node_bin}" \
  "${committed_bounded_command}" --check-process-group-inventory-v1 \
  > /dev/null; then
  fail 69 "release staging requires bounded process-group inventory support"
fi

# This first create is also the pre-archive tree admission. It rejects every
# non-regular Git entry and every forbidden release root before a full payload
# archive is made or the production host is contacted.
input_digest="$(
  "${manifest_environment[@]}" "${node_bin}" \
    "${committed_manifest_helper}" create "${release_id}" "${generated_manifest}"
)"
[[ "${input_digest}" =~ ^[0-9a-f]{64}$ ]] ||
  fail 65 "release input manifest creator returned an invalid digest"

assert_repo_state
assert_critical_bindings
run_git archive --format=tar --output="${release_archive}" "${release_id}"
# Only the admitted, secret-free payload gets transport-readable modes. Keep
# the enclosing temporary root, authorization and control files private.
# The receiver's umask cannot add bits removed during local archive extraction.
(
  umask 022
  "${env_bin}" -i "LANG=C" "LC_ALL=C" "PATH=${trusted_path}" \
    "${tar_bin}" -xf "${release_archive}" -C "${release_export}"
)

archive_manifest_helper="${release_export}/${manifest_helper_path}"
assert_bound_file "${archive_manifest_helper}" 100644 "${manifest_helper_blob}" "archived release manifest helper"
"${mv_bin}" -- "${generated_manifest}" "${release_export}/${manifest_name}"

verify_local_export() {
  local digest=""
  digest="$(
    CDPATH= cd -- "${release_export}" &&
      "${manifest_environment[@]}" "${node_bin}" \
        "${manifest_helper_path}" verify "${release_id}" "${manifest_name}"
  )" || return 1
  [[ "${digest}" == "${input_digest}" ]] ||
    fail 65 "local release export digest does not match the committed manifest"
}
verify_local_export

archive_manifest_helper_sha256="$(
  "${manifest_environment[@]}" "${node_bin}" -e '
    const { createHash } = require("node:crypto");
    const { readFileSync } = require("node:fs");
    process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
  ' "${archive_manifest_helper}"
)"
archive_manifest_helper_size="$("${wc_bin}" -c < "${archive_manifest_helper}")"
archive_manifest_helper_size="${archive_manifest_helper_size//[[:space:]]/}"
[[ "${archive_manifest_helper_sha256}" =~ ^[0-9a-f]{64}$ &&
  "${archive_manifest_helper_size}" =~ ^[0-9]+$ &&
  "${archive_manifest_helper_size}" -ge 1 &&
  "${archive_manifest_helper_size}" -le 8388608 ]] ||
  fail 65 "archived release manifest helper identity is invalid"

run_git archive --format=tar --output="${authorization_archive}" "${release_id}" -- \
  "${authorization_bundle_path}" "${authorization_license_path}"
"${env_bin}" -i "LANG=C" "LC_ALL=C" "PATH=${trusted_path}" \
  "${tar_bin}" -xf "${authorization_archive}" -C "${authorization_export}"
committed_authorization_bundle="${authorization_export}/${authorization_bundle_path}"
committed_authorization_license="${authorization_export}/${authorization_license_path}"
assert_bound_file "${committed_authorization_bundle}" 100644 "${authorization_bundle_blob}" "committed authorization bundle"
assert_bound_file "${committed_authorization_license}" 100644 "${authorization_license_blob}" "committed authorization license"

authorization_environment=(
  "${env_bin}" -i
  "LANG=C"
  "LC_ALL=C"
  "PATH=${trusted_path}"
  "GIT_CONFIG_GLOBAL=/dev/null"
  "GIT_CONFIG_NOSYSTEM=1"
  "GIT_NO_REPLACE_OBJECTS=1"
  "GIT_OPTIONAL_LOCKS=0"
  "GIT_TERMINAL_PROMPT=0"
  "NO_COLOR=1"
)
for allowed_name in \
  HOME GH_CONFIG_DIR GH_TOKEN GITHUB_TOKEN HTTPS_PROXY HTTP_PROXY NO_PROXY \
  SSL_CERT_DIR SSL_CERT_FILE SSH_AUTH_SOCK XDG_CONFIG_HOME; do
  allowed_value="${!allowed_name-}"
  if [[ -n "${allowed_value}" ]]; then
    authorization_environment+=("${allowed_name}=${allowed_value}")
  fi
done

# Authorization is intentionally the final networked precondition before the
# first SSH. Its result is consumed once and is never copied into the release.
assert_repo_state
assert_critical_bindings
(
  ulimit -f 129
  "${authorization_environment[@]}" "${node_bin}" \
    "${committed_authorization_bundle}" "${release_id}"
) > "${authorization_output}"
authorization_bytes="$("${wc_bin}" -c < "${authorization_output}")"
authorization_bytes="${authorization_bytes//[[:space:]]/}"
[[ "${authorization_bytes}" =~ ^[0-9]+$ && "${authorization_bytes}" -ge 1 &&
  "${authorization_bytes}" -le 65536 ]] ||
  fail 65 "release authorization stdout must contain 1 to 65536 bytes"
"${authorization_environment[@]}" "${node_bin}" \
  "${committed_authorization_bundle}" validate-output "${release_id}" \
  < "${authorization_output}" > /dev/null
assert_repo_state
assert_critical_bindings
assert_bound_file "${committed_authorization_bundle}" 100644 "${authorization_bundle_blob}" "committed authorization bundle"
assert_bound_file "${committed_authorization_license}" 100644 "${authorization_license_blob}" "committed authorization license"
assert_bound_file "${committed_manifest_helper}" 100644 "${manifest_helper_blob}" "committed release manifest helper"
assert_bound_file "${committed_bounded_command}" 100644 "${bounded_command_blob}" "committed bounded command helper"
verify_local_export

ssh_environment=(
  "${env_bin}" -i
  "HOME=${HOME:-/nonexistent}"
  "LANG=C"
  "LC_ALL=C"
  "PATH=${trusted_path}"
)
if [[ -n "${SSH_AUTH_SOCK:-}" ]]; then
  ssh_environment+=("SSH_AUTH_SOCK=${SSH_AUTH_SOCK}")
fi
ssh_options=(
  -F /dev/null
  -o BatchMode=yes
  -o CanonicalizeHostname=no
  -o CheckHostIP=yes
  -o ClearAllForwardings=yes
  -o ConnectTimeout=10
  -o ForwardAgent=no
  -o ForwardX11=no
  -o HostKeyAlias=111.228.50.85
  -o KbdInteractiveAuthentication=no
  -o LogLevel=ERROR
  -o NumberOfPasswordPrompts=0
  -o PasswordAuthentication=no
  -o PermitLocalCommand=no
  -o RequestTTY=no
  -o ServerAliveCountMax=2
  -o ServerAliveInterval=15
  -o StrictHostKeyChecking=yes
  -o UpdateHostKeys=no
)

validate_bounded_command_receipt() {
  local receipt_path="$1"
  local receipt_token="$2"
  local runner_status="$3"
  [[ -n "${receipt_path}" && -n "${receipt_token}" ]] || return 1
  "${manifest_environment[@]}" \
    "DIESEL_RECEIPT_PATH=${receipt_path}" \
    "DIESEL_RECEIPT_TOKEN=${receipt_token}" \
    "DIESEL_RECEIPT_STATUS=${runner_status}" \
    "${node_bin}" -e '
      const {
        closeSync,
        constants,
        fstatSync,
        openSync,
        readFileSync,
        realpathSync,
      } = require("node:fs");
      const path = process.env.DIESEL_RECEIPT_PATH;
      const token = process.env.DIESEL_RECEIPT_TOKEN;
      const statusText = process.env.DIESEL_RECEIPT_STATUS;
      if (
        typeof path !== "string" ||
        !path.startsWith("/") ||
        typeof token !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token) ||
        typeof statusText !== "string" ||
        !/^(?:0|[1-9][0-9]{0,2})$/.test(statusText)
      ) process.exit(2);
      const exitCode = Number(statusText);
      if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
        process.exit(2);
      }
      let descriptor;
      try {
        descriptor = openSync(
          path,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        const before = fstatSync(descriptor);
        if (
          !before.isFile() ||
          before.nlink !== 1 ||
          (before.mode & 0o777) !== 0o600 ||
          before.size <= 0 ||
          before.size > 1024 ||
          realpathSync(path) !== path
        ) process.exit(3);
        const bytes = readFileSync(descriptor);
        const after = fstatSync(descriptor);
        if (
          bytes.byteLength !== before.size ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.mode !== after.mode ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs ||
          before.nlink !== after.nlink ||
          before.size !== after.size
        ) process.exit(3);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const receipt = JSON.parse(text);
        const expected = {
          version: "bounded-command-completion-v2",
          token,
          exitCode,
          closeSeen: true,
          groupAbsenceProven: true,
          guardianSealed: true,
        };
        if (text !== `${JSON.stringify(expected)}\n`) process.exit(4);
        if (JSON.stringify(receipt) !== JSON.stringify(expected)) process.exit(4);
      } catch {
        process.exit(5);
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
    '
}

run_bounded_command() {
  local receipt_path=""
  local receipt_token=""
  local runner_pid=""
  local runner_status=0
  assert_bound_file "${committed_bounded_command}" 100644 "${bounded_command_blob}" "committed bounded command helper"
  [[ -z "${active_bounded_command_pid}" && "${bounded_command_launching}" -eq 0 ]] || return 70
  bounded_command_receipt_sequence="$((bounded_command_receipt_sequence + 1))"
  receipt_path="${temp_root}/bounded-command-${bounded_command_receipt_sequence}.completion.json"
  receipt_token="$(
    "${manifest_environment[@]}" "${node_bin}" -e \
      'process.stdout.write(require("node:crypto").randomUUID())'
  )" || return 70
  [[ "${receipt_token}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || return 70
  active_bounded_command_receipt_path="${receipt_path}"
  active_bounded_command_receipt_token="${receipt_token}"
  bounded_command_containment_unproven=1
  bounded_command_launching=1
  "${manifest_environment[@]}" \
    "DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_PATH=${receipt_path}" \
    "DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_TOKEN=${receipt_token}" \
    "${node_bin}" "${committed_bounded_command}" "$@" &
  active_bounded_command_pid="$!"
  bounded_command_launching=0
  if [[ -n "${pending_signal_status}" ]]; then
    finish_pending_signal
  fi
  runner_pid="${active_bounded_command_pid}"
  if builtin wait "${runner_pid}"; then
    runner_status=0
  else
    runner_status="$?"
  fi
  active_bounded_command_pid=""
  if ! validate_bounded_command_receipt \
    "${receipt_path}" "${receipt_token}" "${runner_status}"; then
    printf '%s\n' \
      "bounded command did not provide a trustworthy containment receipt: ${receipt_path}" >&2
    runner_status=126
  else
    bounded_command_containment_unproven=0
  fi
  active_bounded_command_receipt_path=""
  active_bounded_command_receipt_token=""
  last_bounded_command_status="${runner_status}"
  return "${runner_status}"
}

"${cat_bin}" > "${remote_preflight_script}" <<'REMOTE_PREFLIGHT'
set -Eeuo pipefail
umask 077
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
[[ "${EUID}" -eq 0 ]] || exit 70
[[ "$#" -eq 1 && "$1" =~ ^[0-9a-f]{40}$ ]] || exit 64
release_id="$1"
deploy_root="/opt/diesel"
releases_root="${deploy_root}/releases"
release_dir="${releases_root}/${release_id}"
node_root="/opt/node-v22.22.3-linux-x64"
node_bin="${node_root}/bin/node"
realpath_bin="/usr/bin/realpath"
stat_bin="/usr/bin/stat"
getent_bin="/usr/bin/getent"
groupadd_bin="/usr/sbin/groupadd"
mkdir_bin="/usr/bin/mkdir"
find_bin="/usr/bin/find"
chown_bin="/usr/bin/chown"
chmod_bin="/usr/bin/chmod"

for parent in "${deploy_root}" "${releases_root}"; do
  [[ -d "${parent}" && ! -L "${parent}" ]] || exit 70
  [[ "$("${realpath_bin}" -e -- "${parent}")" == "${parent}" ]] || exit 70
  [[ "$("${stat_bin}" -c '%u:%g:%a' -- "${parent}")" == "0:0:755" ]] || exit 70
done
deploy_identity="$("${stat_bin}" -c '%d:%i' -- "${deploy_root}")"
releases_identity="$("${stat_bin}" -c '%d:%i' -- "${releases_root}")"
[[ "${deploy_identity}" =~ ^[0-9]+:[0-9]+$ &&
  "${releases_identity}" =~ ^[0-9]+:[0-9]+$ ]] || exit 70

for node_parent in "/opt" "${node_root}" "${node_root}/bin"; do
  [[ -d "${node_parent}" && ! -L "${node_parent}" ]] || exit 70
  [[ "$("${realpath_bin}" -e -- "${node_parent}")" == "${node_parent}" ]] || exit 70
  [[ "$("${stat_bin}" -c '%u:%g:%a' -- "${node_parent}")" == "0:0:755" ]] || exit 70
done
[[ -f "${node_bin}" && ! -L "${node_bin}" && -x "${node_bin}" ]] || exit 70
[[ "$("${realpath_bin}" -e -- "${node_bin}")" == "${node_bin}" ]] || exit 70
[[ "$("${stat_bin}" -c '%u:%g:%a' -- "${node_bin}")" == "0:0:755" ]] || exit 70
[[ "$("${node_bin}" --version)" == "v22.22.3" ]] || exit 70

[[ ! -e "${release_dir}" && ! -L "${release_dir}" ]] || exit 70
group_record="$("${getent_bin}" group diesel 2>/dev/null || true)"
if [[ -z "${group_record}" ]]; then
  "${groupadd_bin}" --system diesel >/dev/null
  group_record="$("${getent_bin}" group diesel)"
fi
IFS=: read -r group_name _ diesel_gid group_members <<< "${group_record}"
[[ "${group_name}" == "diesel" && "${diesel_gid}" =~ ^[0-9]+$ && "${diesel_gid}" -gt 0 ]] || exit 70
"${mkdir_bin}" -- "${release_dir}"
[[ -d "${release_dir}" && ! -L "${release_dir}" ]] || exit 70
[[ "$("${realpath_bin}" -e -- "${release_dir}")" == "${release_dir}" ]] || exit 70
[[ -z "$("${find_bin}" "${release_dir}" -mindepth 1 -maxdepth 1 -print -quit)" ]] || exit 70
"${chown_bin}" "0:${diesel_gid}" "${release_dir}"
"${chmod_bin}" 750 "${release_dir}"
[[ "$("${stat_bin}" -c '%u:%g:%a:%d:%i' -- "${deploy_root}")" == "0:0:755:${deploy_identity}" ]] || exit 70
[[ "$("${stat_bin}" -c '%u:%g:%a:%d:%i' -- "${releases_root}")" == "0:0:755:${releases_identity}" ]] || exit 70
release_identity="$("${stat_bin}" -c '%u:%g:%a:%d:%i' -- "${release_dir}")"
[[ "${release_identity}" =~ ^0:${diesel_gid}:750:[0-9]+:[0-9]+$ ]] || exit 70
printf '%s:%s:%s:%s\n' "${deploy_identity}" "${releases_identity}" "${release_identity##0:${diesel_gid}:750:}" "${diesel_gid}"
REMOTE_PREFLIGHT

if ! run_bounded_command 60000 5000 512 8192 \
  "${remote_preflight_script}" "${remote_identity_output}" "${remote_preflight_error}" -- \
  "${ssh_environment[@]}" "${ssh_bin}" "${ssh_options[@]}" \
  "${remote_target}" /usr/bin/env -i \
  HOME=/root LANG=C LC_ALL=C PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /bin/bash --noprofile --norc -s -- "${release_id}"; then
  fail 70 "remote release preflight failed (bounded command status ${last_bounded_command_status})"
fi

remote_identity_bytes="$("${wc_bin}" -c < "${remote_identity_output}")"
remote_identity_bytes="${remote_identity_bytes//[[:space:]]/}"
remote_candidate_identity="$(<"${remote_identity_output}")"
remote_identity_expected_bytes="$(( ${#remote_candidate_identity} + 1 ))"
[[ "${remote_identity_bytes}" =~ ^[0-9]+$ &&
  "${remote_identity_bytes}" -eq "${remote_identity_expected_bytes}" &&
  "${remote_identity_bytes}" -le 512 ]] ||
  fail 70 "remote candidate identity output is invalid"
[[ "${remote_candidate_identity}" =~ ^[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9]+$ ]] ||
  fail 70 "remote candidate identity output is malformed"
IFS=: read -r \
  remote_deploy_device remote_deploy_inode \
  remote_releases_device remote_releases_inode \
  remote_candidate_device remote_candidate_inode remote_diesel_gid \
  <<< "${remote_candidate_identity}"

verify_local_export
ssh_transport="${ssh_bin} -F /dev/null"
for ssh_option in "${ssh_options[@]}"; do
  if [[ "${ssh_option}" != "-F" && "${ssh_option}" != "/dev/null" ]]; then
    ssh_transport="${ssh_transport} ${ssh_option}"
  fi
done
remote_rsync_path="umask 022 && /usr/bin/env -i HOME=/root LANG=C LC_ALL=C PATH=/usr/bin:/bin /usr/bin/rsync"
if ! run_bounded_command 900000 5000 65536 65536 \
  - "${rsync_output}" "${rsync_error}" -- \
  "${ssh_environment[@]}" "${rsync_bin}" \
  -a --no-owner --no-group --no-perms --timeout=60 \
  "--rsync-path=${remote_rsync_path}" \
  -e "${ssh_transport}" -- \
  "${release_export}/" "${remote_target}:${remote_release_dir}/"; then
  fail 70 "release archive transfer failed (bounded command status ${last_bounded_command_status})"
fi

"${cat_bin}" > "${remote_postcheck_script}" <<'REMOTE_POSTCHECK'
set -Eeuo pipefail
umask 077
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
[[ "${EUID}" -eq 0 ]] || exit 70
[[ "$#" -eq 11 && "$1" =~ ^[0-9a-f]{40}$ && "$2" =~ ^[0-9a-f]{64}$ &&
  "$3" =~ ^[0-9]+$ && "$4" =~ ^[0-9]+$ && "$5" =~ ^[0-9]+$ &&
  "$6" =~ ^[0-9]+$ && "$7" =~ ^[0-9]+$ && "$8" =~ ^[0-9]+$ &&
  "$9" =~ ^[0-9]+$ && "${10}" =~ ^[0-9]+$ && "${11}" =~ ^[0-9a-f]{64}$ ]] || exit 64
release_id="$1"
expected_digest="$2"
expected_deploy_device="$3"
expected_deploy_inode="$4"
expected_releases_device="$5"
expected_releases_inode="$6"
expected_candidate_device="$7"
expected_candidate_inode="$8"
diesel_gid="$9"
expected_helper_size="${10}"
expected_helper_sha256="${11}"
deploy_root="/opt/diesel"
releases_root="${deploy_root}/releases"
release_dir="${releases_root}/${release_id}"
node_root="/opt/node-v22.22.3-linux-x64"
node_bin="${node_root}/bin/node"
manifest_helper="${release_dir}/scripts/deploy/release-input-manifest.mjs"
manifest_path="${release_dir}/.release-input-manifest.json"
realpath_bin="/usr/bin/realpath"
stat_bin="/usr/bin/stat"
sha256sum_bin="/usr/bin/sha256sum"
env_bin="/usr/bin/env"

verify_remote_state() {
  local actual_identity=""
  local node_parent=""
  [[ -d "${deploy_root}" && ! -L "${deploy_root}" ]] || return 1
  [[ "$("${realpath_bin}" -e -- "${deploy_root}")" == "${deploy_root}" ]] || return 1
  actual_identity="$("${stat_bin}" -c '%u:%g:%a:%d:%i' -- "${deploy_root}")" || return 1
  [[ "${actual_identity}" == "0:0:755:${expected_deploy_device}:${expected_deploy_inode}" ]] || return 1
  [[ -d "${releases_root}" && ! -L "${releases_root}" ]] || return 1
  [[ "$("${realpath_bin}" -e -- "${releases_root}")" == "${releases_root}" ]] || return 1
  actual_identity="$("${stat_bin}" -c '%u:%g:%a:%d:%i' -- "${releases_root}")" || return 1
  [[ "${actual_identity}" == "0:0:755:${expected_releases_device}:${expected_releases_inode}" ]] || return 1
  [[ -d "${release_dir}" && ! -L "${release_dir}" ]] || return 1
  [[ "$("${realpath_bin}" -e -- "${release_dir}")" == "${release_dir}" ]] || return 1
  actual_identity="$("${stat_bin}" -c '%u:%g:%a:%d:%i' -- "${release_dir}")" || return 1
  [[ "${actual_identity}" == "0:${diesel_gid}:750:${expected_candidate_device}:${expected_candidate_inode}" ]] || return 1
  for node_parent in "/opt" "${node_root}" "${node_root}/bin"; do
    [[ -d "${node_parent}" && ! -L "${node_parent}" ]] || return 1
    [[ "$("${realpath_bin}" -e -- "${node_parent}")" == "${node_parent}" ]] || return 1
    [[ "$("${stat_bin}" -c '%u:%g:%a' -- "${node_parent}")" == "0:0:755" ]] || return 1
  done
  [[ -f "${node_bin}" && ! -L "${node_bin}" && -x "${node_bin}" ]] || return 1
  [[ "$("${realpath_bin}" -e -- "${node_bin}")" == "${node_bin}" ]] || return 1
  [[ "$("${stat_bin}" -c '%u:%g:%a' -- "${node_bin}")" == "0:0:755" ]] || return 1
  [[ "$("${node_bin}" --version)" == "v22.22.3" ]] || return 1
}

verify_manifest_helper() {
  local helper_digest_record=""
  local helper_metadata=""
  [[ -f "${manifest_helper}" && ! -L "${manifest_helper}" ]] || return 1
  [[ "$("${realpath_bin}" -e -- "${manifest_helper}")" == "${manifest_helper}" ]] || return 1
  helper_metadata="$("${stat_bin}" -c '%u:%g:%a:%h:%s' -- "${manifest_helper}")" || return 1
  [[ "${helper_metadata}" == "0:0:644:1:${expected_helper_size}" ]] || return 1
  helper_digest_record="$("${sha256sum_bin}" -- "${manifest_helper}")" || return 1
  [[ "${helper_digest_record}" == "${expected_helper_sha256}  ${manifest_helper}" ]]
}

verify_forbidden_runtime_paths_absent() {
  local forbidden_runtime_path=""
  for forbidden_runtime_path in ".next" "node_modules" ".build-complete" ".deploy-ready"; do
    [[ ! -e "${release_dir}/${forbidden_runtime_path}" &&
      ! -L "${release_dir}/${forbidden_runtime_path}" ]] || return 1
  done
}

verify_remote_state || exit 70
verify_manifest_helper || exit 70
[[ -f "${manifest_path}" && ! -L "${manifest_path}" ]] || exit 70
verify_forbidden_runtime_paths_absent || exit 70
actual_digest="$(
  cd -- "${release_dir}"
  "${env_bin}" -i HOME=/root LANG=C LC_ALL=C PATH=/usr/bin:/bin \
    "${node_bin}" "scripts/deploy/release-input-manifest.mjs" \
    verify "${release_id}" ".release-input-manifest.json"
)"
[[ "${actual_digest}" == "${expected_digest}" ]] || exit 70
verify_remote_state || exit 70
verify_manifest_helper || exit 70
verify_forbidden_runtime_paths_absent || exit 70
printf '%s\n' "${actual_digest}"
REMOTE_POSTCHECK

if ! run_bounded_command 300000 5000 128 8192 \
  "${remote_postcheck_script}" "${remote_digest_output}" "${remote_postcheck_error}" -- \
  "${ssh_environment[@]}" "${ssh_bin}" "${ssh_options[@]}" \
  "${remote_target}" /usr/bin/env -i \
  HOME=/root LANG=C LC_ALL=C PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /bin/bash --noprofile --norc -s -- \
  "${release_id}" "${input_digest}" \
  "${remote_deploy_device}" "${remote_deploy_inode}" \
  "${remote_releases_device}" "${remote_releases_inode}" \
  "${remote_candidate_device}" "${remote_candidate_inode}" "${remote_diesel_gid}" \
  "${archive_manifest_helper_size}" "${archive_manifest_helper_sha256}"; then
  fail 70 "remote release verification failed (bounded command status ${last_bounded_command_status})"
fi

remote_digest_bytes="$("${wc_bin}" -c < "${remote_digest_output}")"
remote_digest_bytes="${remote_digest_bytes//[[:space:]]/}"
[[ "${remote_digest_bytes}" =~ ^65$ ]] || fail 70 "remote manifest verifier output is invalid"
remote_digest="$(<"${remote_digest_output}")"
[[ "${remote_digest}" == "${input_digest}" ]] ||
  fail 70 "remote release input digest does not match the local export"
verify_local_export

receipt_json="$(
  "${env_bin}" -i \
    "LANG=C" "LC_ALL=C" "PATH=${trusted_path}" \
    "RELEASE_ID=${release_id}" \
    "INPUT_DIGEST=${input_digest}" \
    "REMOTE_TARGET=${remote_target}" \
    "REMOTE_RELEASE_DIR=${remote_release_dir}" \
    "${node_bin}" -e '
      const { readFileSync } = require("node:fs");
      const authorization = JSON.parse(readFileSync(0, "utf8"));
      const receipt = {
        authorization,
        commit: process.env.RELEASE_ID,
        format: "diesel-release-stage-v1",
        inputDigest: process.env.INPUT_DIGEST,
        releaseDir: process.env.REMOTE_RELEASE_DIR,
        target: process.env.REMOTE_TARGET,
      };
      process.stdout.write(JSON.stringify(receipt));
    ' < "${authorization_output}"
)"
[[ -n "${receipt_json}" && "${#receipt_json}" -le 70000 &&
  "${receipt_json}" != *$'\n'* ]] ||
  fail 70 "staging receipt generation failed"

# Do not print the success receipt until the private local staging tree has
# been safely removed. A failed remote candidate is deliberately never removed.
remove_temp_root || fail 70 "staging succeeded remotely but local cleanup failed"
trap - EXIT
printf '%s\n' "${receipt_json}"
