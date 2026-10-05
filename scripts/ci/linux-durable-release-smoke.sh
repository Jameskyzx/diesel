#!/bin/bash
set -Eeuo pipefail

# Never run this fixture on a real host. It claims a previously absent fixed
# layout only on a disposable GitHub-hosted VM. Leave fixture files to VM
# teardown; no recursive deletion or production-path override is provided.
[[ "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted && "${EUID}" -eq 0 ]] || exit 77
[[ "$#" -eq 1 && -d "$1" && ! -L "$1" ]] || exit 64
[[ "$(/usr/bin/uname -s)" == Linux && "$(/usr/bin/realpath -e -- "$1")" == "$1" ]] || exit 77
[[ ! -e /opt/diesel && ! -L /opt/diesel ]] || exit 70
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
node=/opt/node-v22.22.3-linux-x64/bin/node
[[ "$("${node}" --version)" == v22.22.3 ]] || exit 70
source_export="$1"
/usr/bin/install -d -m 0755 /opt/diesel /opt/diesel/releases
/usr/bin/install -d -m 0700 /opt/diesel/release-inputs

for scenario in completed failed killed; do
  fixture="$(/usr/bin/mktemp -d /opt/diesel-durable-ci.XXXXXX)"
  /usr/bin/install -d -m 0755 "${fixture}/scripts/deploy"
  /usr/bin/install -m 0644 "${source_export}/scripts/deploy/durable-release.bundle.mjs" "${fixture}/scripts/deploy/durable-release.bundle.mjs"
  /usr/bin/install -m 0644 "${source_export}/scripts/deploy/release-input-manifest.mjs" "${fixture}/scripts/deploy/release-input-manifest.mjs"
  /usr/bin/printf '%s\n' '#!/bin/bash' 'set -Eeuo pipefail' '/usr/bin/sleep 4' 'printf "synthetic durable smoke only\\n"' \
    "# ${scenario}" >"${fixture}/scripts/deploy/host-release-orchestrator.sh"
  if [[ "${scenario}" == failed ]]; then
    /usr/bin/printf '%s\n' 'exit 37' >>"${fixture}/scripts/deploy/host-release-orchestrator.sh"
  elif [[ "${scenario}" == killed ]]; then
    /usr/bin/printf '%s\n' '/usr/bin/sleep 60' >>"${fixture}/scripts/deploy/host-release-orchestrator.sh"
  fi
  /usr/bin/chmod 0755 "${fixture}/scripts/deploy/host-release-orchestrator.sh"
  (
    cd -- "${fixture}"
    /usr/bin/git -c init.defaultBranch=fixture init --quiet
    /usr/bin/git add scripts
    /usr/bin/git -c user.name=CI -c user.email=ci@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null commit --quiet -m "Synthetic ${scenario} fixture"
  )
  release_id="$(/usr/bin/git -C "${fixture}" rev-parse HEAD)"
  [[ "${release_id}" =~ ^[0-9a-f]{40}$ ]] || exit 70
  release_dir="/opt/diesel/releases/${release_id}"
  /usr/bin/install -d -m 0755 "${release_dir}"
  # Root tar preserves archive modes: Git's default 0002 mask would leave
  # group-writable paths that the production controller correctly rejects.
  /usr/bin/git -c tar.umask=0022 -C "${fixture}" archive "${release_id}" | /usr/bin/tar -xf - -C "${release_dir}"
  (cd "${fixture}"; "${node}" scripts/deploy/release-input-manifest.mjs create "${release_id}" "${release_dir}/.release-input-manifest.json")
  /usr/bin/install -d -m 0700 "/opt/diesel/release-inputs/${release_id}"
  /usr/bin/install -m 0600 /dev/null "/opt/diesel/release-inputs/${release_id}/env.production.local"
  entry="${release_dir}/scripts/deploy/durable-release.bundle.mjs"
  unit="diesel-release-${release_id}.service"
  # End the controlling session with HUP immediately after submission. The
  # system service must survive independently, with no inherited caller pipe.
  caller_status=0
  /usr/bin/setsid /bin/bash -c '"$1" "$2" start "$3" >"$4"; status=$?; [[ "$status" -eq 0 ]] || exit "$status"; kill -HUP "$BASHPID"' \
    smoke-caller "${node}" "${entry}" "${release_id}" "${fixture}/submission.json" || caller_status=$?
  [[ "${caller_status}" -eq 129 ]] || exit 70
  operation="/opt/diesel/operations/${release_id}"
  original="$(/usr/bin/sha256sum "${operation}/operation.json")"
  if "${node}" "${entry}" start "${release_id}" >/dev/null 2>&1; then exit 70; fi
  [[ "$(/usr/bin/sha256sum "${operation}/operation.json")" == "${original}" ]] || exit 70
  started=0
  for attempt in {1..60}; do
    if [[ -f "${operation}/started.json" ]]; then started=1; break; fi
    /usr/bin/sleep 0.25
  done
  [[ "${started}" -eq 1 ]] || exit 70
  if [[ "${scenario}" == killed ]]; then /usr/bin/systemctl kill --signal=SIGKILL "${unit}"; fi
  finished=0
  for attempt in {1..80}; do
    "${node}" "${entry}" status "${release_id}" >"${fixture}/status.json" || true
    if "${node}" --input-type=module -e 'import{readFileSync}from"node:fs"; const r=JSON.parse(readFileSync(process.argv[1])); process.exit(["completed","failed"].includes(r.state)?0:1)' "${fixture}/status.json"; then finished=1; break; fi
    /usr/bin/sleep 0.25
  done
  [[ "${finished}" -eq 1 ]] || exit 70
  "${node}" --input-type=module -e '
    import{readFileSync,existsSync}from"node:fs";
    const r=JSON.parse(readFileSync(process.argv[1])); const scenario=process.argv[2];
    if(r.deploymentVerified!==false || r.state!==(scenario==="completed"?"completed":"failed")) process.exit(1);
    if(scenario==="completed" && r.completion.exitCode!==0) process.exit(1);
    if(scenario==="failed" && r.completion.exitCode!==37) process.exit(1);
    if(scenario==="killed" && existsSync(process.argv[3]+"/completed.json")) process.exit(1);
  ' "${fixture}/status.json" "${scenario}" "${operation}"
  /usr/bin/systemctl stop "${unit}"
  /usr/bin/systemctl reset-failed "${unit}" 2>/dev/null || true
  /usr/bin/printf 'Durable service smoke passed: %s (synthetic, not deployment acceptance)\n' "${scenario}"
done
