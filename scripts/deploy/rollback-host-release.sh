#!/usr/bin/env bash
set -euo pipefail

release_id="${1:-}"
mode="${2:---check}"
deploy_root="/opt/diesel"

[[ "${release_id}" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || {
  echo "usage: rollback-host-release.sh <failed-release-id> [--check|--apply]" >&2
  exit 64
}
[[ "${mode}" == "--check" || "${mode}" == "--apply" ]] || {
  echo "mode must be --check or --apply" >&2
  exit 64
}

release_dir="${deploy_root}/releases/${release_id}"
state_dir="${deploy_root}/backups/${release_id}"
previous_release_file="${state_dir}/previous-release"
publish_commit_marker="${state_dir}/PUBLISH_COMMITTED"

[[ ! -e "${publish_commit_marker}" ]] || {
  echo "refusing host-only rollback after the governance publish commit point" >&2
  exit 70
}
[[ -f "${previous_release_file}" ]] || {
  echo "previous-release state is missing" >&2
  exit 70
}
IFS= read -r previous_release < "${previous_release_file}"
case "${previous_release}" in
  /opt/diesel/releases/*) ;;
  *)
    echo "previous release is outside /opt/diesel/releases" >&2
    exit 70
    ;;
esac
[[ -d "${previous_release}" ]] || {
  echo "previous release directory is missing" >&2
  exit 70
}
[[ "$(readlink -f "${deploy_root}/current")" == "${release_dir}" ]] || {
  echo "current does not point to the failed release" >&2
  exit 70
}

for backup in \
  "${state_dir}/env.production.local.pre-switch" \
  "${state_dir}/jamesky.site.pre-switch" \
  "${state_dir}/diesel-demo.pre-switch"; do
  [[ -f "${backup}" ]] || {
    echo "rollback backup is missing: ${backup}" >&2
    exit 70
  }
done

if [[ "${mode}" == "--check" ]]; then
  printf 'Host rollback preflight passed: %s -> %s\n' "${release_dir}" "${previous_release}"
  exit 0
fi

[[ "$(id -u)" -eq 0 ]] || {
  echo "--apply must run as root" >&2
  exit 77
}

environment_restore_path="$(mktemp "${deploy_root}/shared/.env.production.local.rollback.XXXXXX")"
trap 'rm -f -- "${environment_restore_path}"' EXIT
install -m 0640 -o root -g diesel \
  "${state_dir}/env.production.local.pre-switch" "${environment_restore_path}"
mv -Tf "${environment_restore_path}" "${deploy_root}/shared/.env.production.local"
cp "${state_dir}/jamesky.site.pre-switch" /etc/nginx/sites-available/jamesky.site
cp "${state_dir}/diesel-demo.pre-switch" /etc/nginx/sites-available/diesel-demo
nginx -t
systemctl reload nginx

rollback_link="${deploy_root}/current.rollback-${release_id}"
[[ ! -e "${rollback_link}" ]]
ln -s "${previous_release}" "${rollback_link}"
mv -Tf "${rollback_link}" "${deploy_root}/current"

fixed_vps_path="/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
previous_version="$(basename "${previous_release}")"
if env -i HOME=/root PATH="${fixed_vps_path}" pm2 describe diesel-demo >/dev/null 2>&1; then
  env -i HOME=/root PATH="${fixed_vps_path}" pm2 delete diesel-demo
fi
env -i \
  HOME=/root \
  PATH="${fixed_vps_path}" \
  APP_VERSION="${previous_version}" \
  NODE_ENV=production \
  pm2 start "${previous_release}/deploy/ecosystem.config.cjs"

# A rollback must use the target release's versioned ecosystem definition. Do
# not impose a newer release's OS-uid policy on an older compatible release;
# still fail closed on process identity, cardinality, status, and version.
pm2_process_pid="$(
  env -i HOME=/root PATH="${fixed_vps_path}" pm2 jlist |
    EXPECTED_APP_VERSION="${previous_version}" /opt/node-v22.22.3-linux-x64/bin/node -e '
      const apps = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      const matches = apps.filter((app) => app.name === "diesel-demo");
      const app = matches[0];
      const pm2Environment = app?.pm2_env ?? {};
      const appVersion =
        pm2Environment.APP_VERSION ?? pm2Environment.env?.APP_VERSION;
      if (
        matches.length !== 1 ||
        app?.pm2_env?.status !== "online" ||
        !Number.isInteger(app.pid) ||
        app.pid <= 1 ||
        appVersion !== process.env.EXPECTED_APP_VERSION
      ) {
        throw new Error("Unexpected PM2 process or rollback release version");
      }
      process.stdout.write(String(app.pid));
    '
)"
[[ -n "${pm2_process_pid}" ]]
env -i HOME=/root PATH="${fixed_vps_path}" pm2 save

"${previous_release}/scripts/deploy/verify-release.sh" \
  http://127.0.0.1:8788 "${previous_version}"
trap - EXIT
