#!/bin/bash
# One incident only. Run from a newly staged, CI-authorized controller release.
set -Eeuo pipefail
umask 077

if [[ "${BASH_SOURCE[0]}" != "$0" || "$#" -ne 2 ||
      ! "${1:-}" =~ ^[0-9a-f]{40}$ ||
      ( "${2:-}" != --check && "${2:-}" != --apply ) ]]; then
  echo 'usage: archive-unarmed-release.sh <controller-full-sha> <--check|--apply>' >&2
  exit 64
fi
controller="$1"
mode="$2"
failed=9cbeeef340ca7570b7f84175451383363acc42bb
previous=5b35ced1e6e52ca1df9fec9d46f355b73b033ec6
release="/opt/diesel/releases/${controller}"
entry="${release}/scripts/deploy/archive-unarmed-release.sh"
[[ "${BASH_SOURCE[0]}" == "${entry}" && "${controller}" != "${failed}" && EUID -eq 0 ]] || exit 70
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
unset DIESEL_RELEASE_LIFECYCLE_LOCK_FD NODE_OPTIONS NODE_PATH

# No sibling is sourced/executed until its complete path and metadata are trusted.
for path in /opt /opt/diesel /opt/diesel/releases "${release}" \
  "${release}/scripts" "${release}/scripts/deploy"; do
  [[ -d "${path}" && ! -L "${path}" &&
     "$(/usr/bin/realpath -e -- "${path}")" == "${path}" ]] || exit 70
  case "$(/usr/bin/stat -c '%U:%G:%a' -- "${path}")" in
    root:root:755 | root:diesel:750) ;;
    *) exit 70 ;;
  esac
done
for name in archive-unarmed-release.sh rollback-host-release.sh host-activation-ledger.sh \
  archive-unarmed-release.mjs release-input-manifest.mjs; do
  path="${release}/scripts/deploy/${name}"
  [[ -f "${path}" && ! -L "${path}" &&
     "$(/usr/bin/realpath -e -- "${path}")" == "${path}" ]] || exit 70
  case "$(/usr/bin/stat -c '%U:%G:%a:%h' -- "${path}")" in
    root:root:644:1 | root:root:755:1 | root:diesel:640:1 | root:diesel:750:1) ;;
    *) exit 70 ;;
  esac
done
source "${release}/scripts/deploy/rollback-host-release.sh"
node=/opt/node-v22.22.3-linux-x64/bin/node
pm2_exec=/opt/node-v22.22.3-linux-x64/lib/node_modules/pm2/bin/pm2
fixed_path=/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
rollback_require_production_command_boundary "${fixed_path}" "${node}" "${pm2_exec}"
rollback_acquire_release_lifecycle_lock /opt/diesel
rollback_require_regular_file /opt/diesel/.release-build.lock root:root:600 'release build lock'
exec 9<>/opt/diesel/.release-build.lock
/usr/bin/flock -n 9

# A complete manifest verification binds the controller and untouched failed input.
for sha in "${controller}" "${failed}"; do
  (
    cd -- "/opt/diesel/releases/${sha}"
    /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
      "${node}" "${release}/scripts/deploy/release-input-manifest.mjs" \
      verify "${sha}" "/opt/diesel/releases/${sha}/.release-input-manifest.json" \
      8>&- 9>&- >/dev/null
  )
done
host_activation_ledger_scan_all /opt/diesel "${node}" zero-active "${failed}"
/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  "${node}" "${release}/scripts/deploy/archive-unarmed-release.mjs" "${controller}" --check >/dev/null

# Read-only checks only: never call PM2 persistence, start, save, restart or repair.
rollback_validate_pm2_systemd_identity /root/.pm2 "${pm2_exec}" /proc "${node}" \
  "${fixed_path}" /etc/systemd/system/pm2-root.service 0 0 '' "${PATH}" 8>&- 9>&-
runtime_uid="$(/usr/bin/id -u diesel)"
runtime_gid="$(/usr/bin/id -g diesel)"
rollback_validate_pm2_process "${previous}" "/opt/diesel/releases/${previous}" \
  /opt/diesel/current /proc "${fixed_path}" "${node}" "${runtime_uid}" "${runtime_gid}" \
  "${pm2_exec}" "${PATH}" 8>&- 9>&-
/usr/sbin/nginx -t 8>&- 9>&-
# The controller is intentionally unbuilt. Validate the old runtime with its
# own trusted verifier; the new contract is required after normal activation.
verifier="/opt/diesel/releases/${previous}/scripts/deploy/verify-release.sh"
rollback_require_trusted_release_path "${verifier}" file yes 'previous release verifier'
/usr/sbin/runuser -u diesel -- /usr/bin/env -i HOME=/var/lib/diesel PATH="${fixed_path}" \
  /usr/bin/bash -- "${verifier}" http://127.0.0.1:8788 "${previous}" 8>&- 9>&-

/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  "${node}" "${release}/scripts/deploy/archive-unarmed-release.mjs" "${controller}" "${mode}"
if [[ "${mode}" == --apply ]]; then
  host_activation_ledger_scan_all /opt/diesel "${node}" zero-active
fi
