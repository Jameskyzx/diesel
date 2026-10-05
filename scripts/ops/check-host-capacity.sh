#!/bin/bash
set -Eeuo pipefail
# Read-only, fixed-host timer entry. The bundled controller validates its full
# immutable release path and prints filesystem counters only, never secrets.
[[ "${EUID}" -eq 0 ]] || exit 77
release_path="$(/usr/bin/readlink -f -- /opt/diesel/current)"
release_id="${release_path##*/}"
[[ "${release_id}" =~ ^[0-9a-f]{40}$ && "${release_path}" == "/opt/diesel/releases/${release_id}" ]] || exit 70
exec /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C NODE_ENV=production \
  /opt/node-v22.22.3-linux-x64/bin/node \
  "${release_path}/scripts/deploy/durable-release.bundle.mjs" capacity "${release_id}"
