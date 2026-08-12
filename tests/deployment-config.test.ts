import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("jamesky.site Nginx boundary", () => {
  it("proxies the public app while blocking privileged routes", async () => {
    const configurations = await Promise.all(
      ["jamesky.site.conf", "diesel-demo.conf"].map((filename) =>
        readFile(
          resolve(process.cwd(), "deploy/nginx", filename),
          "utf8",
        ),
      ),
    );
    const [configuration, alternateConfiguration] = configurations;

    expect(configuration).toContain(
      "server_name jamesky.site www.jamesky.site;",
    );
    expect(configuration).toContain("client_max_body_size 10m;");
    expect(configuration).toContain("location = /api/chat {");
    expect(configuration).toContain("proxy_request_buffering off;");
    expect(configuration).toContain(
      "limit_conn_zone $binary_remote_addr zone=chat_per_client:10m;",
    );
    expect(configuration).toContain(
      "limit_conn_zone $server_name zone=chat_global:1m;",
    );
    expect(configuration).toContain("limit_conn_status 429;");
    expect(configuration).toContain("limit_conn chat_per_client 3;");
    expect(configuration).toContain("limit_conn chat_global 8;");
    expect(configuration.indexOf("limit_conn_zone")).toBeLessThan(
      configuration.indexOf("server {"),
    );
    const catchAllLocation = configuration.slice(
      configuration.indexOf("location / {"),
    );
    expect(catchAllLocation).not.toContain("client_max_body_size 10m;");
    expect(catchAllLocation).not.toContain("proxy_request_buffering off;");
    expect(catchAllLocation).not.toContain("limit_conn chat_per_client");
    expect(catchAllLocation).not.toContain("limit_conn chat_global");
    expect(configuration).toContain("proxy_pass http://127.0.0.1:8788;");
    expect(configuration).toContain(
      "proxy_set_header X-Forwarded-For $remote_addr;",
    );
    expect(configuration).not.toContain("$proxy_add_x_forwarded_for");
    expect(configuration).toContain(
      'proxy_set_header oai-authenticated-user-email "";',
    );

    for (const route of [
      "/admin/",
      "/api/admin/",
      "/dev/",
      "/api/dev/",
    ]) {
      expect(configuration).toContain(
        `location ^~ ${route} {\n        return 404;\n    }`,
      );
    }

    expect(alternateConfiguration).toContain(
      "server_name 111.228.50.85 diesel.jamesky.site;",
    );
    expect(alternateConfiguration).toContain(
      "return 301 https://jamesky.site$request_uri;",
    );
    expect(alternateConfiguration).not.toContain("proxy_pass");

    const ecosystem = await readFile(
      resolve(process.cwd(), "deploy", "ecosystem.config.cjs"),
      "utf8",
    );
    expect(ecosystem).toContain('uid: "diesel"');
    expect(ecosystem).toContain('gid: "diesel"');
    expect(ecosystem).toContain('script: "/usr/bin/env"');
    expect(ecosystem).toContain('interpreter: "none"');
    expect(ecosystem).toContain('"-i"');
    expect(ecosystem).toContain('"HOME=/opt/diesel/shared"');
    expect(ecosystem).toContain(
      '"PATH=/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    );
    expect(ecosystem).toContain('"NODE_ENV=production"');
    expect(ecosystem).toContain('`APP_VERSION=${appVersion}`');
    expect(ecosystem).toContain(
      'const nodeInterpreter = "/opt/node-v22.22.3-linux-x64/bin/node"',
    );
    expect(ecosystem).toContain('"--env-file=.env.production.local"');
    expect(ecosystem).not.toContain("process.env.DATABASE_URL");
    expect(ecosystem).not.toContain("process.env.AI_");
  });

  it("documents a tracked-only, fail-fast VPS release and rollback", async () => {
    const deploymentRunbook = await readFile(
      resolve(process.cwd(), "docs", "DEPLOYMENT.md"),
      "utf8",
    );

    expect(deploymentRunbook).toContain(
      "git ls-files -z | rsync -a --relative --from0 --files-from=-",
    );
    expect(deploymentRunbook).toContain(
      'test -z "$(git status --porcelain --untracked-files=no)"',
    );
    expect(deploymentRunbook).toContain(
      'mkdir -- /opt/diesel/releases/${release_id}',
    );
    expect(deploymentRunbook).not.toContain(
      'mkdir -p /opt/diesel/releases/${release_id}',
    );
    expect(deploymentRunbook).toContain(
      'find /opt/diesel/releases/${release_id} -mindepth 1 -maxdepth 1 -print -quit',
    );
    const releaseDirectoryCreationIndex = deploymentRunbook.indexOf(
      'mkdir -- /opt/diesel/releases/${release_id}',
    );
    const emptyReleaseDirectoryIndex = deploymentRunbook.indexOf(
      'find /opt/diesel/releases/${release_id} -mindepth 1 -maxdepth 1 -print -quit',
      releaseDirectoryCreationIndex,
    );
    const releaseGroupIndex = deploymentRunbook.indexOf(
      "getent group diesel >/dev/null 2>&1 || groupadd --system diesel",
      emptyReleaseDirectoryIndex,
    );
    const releaseOwnershipIndex = deploymentRunbook.indexOf(
      "chown root:diesel /opt/diesel/releases/${release_id}",
      releaseGroupIndex,
    );
    const releaseModeIndex = deploymentRunbook.indexOf(
      "chmod 750 /opt/diesel/releases/${release_id}",
      releaseOwnershipIndex,
    );
    const releasePermissionProbeIndex = deploymentRunbook.indexOf(
      "stat -c '%U:%G:%a' /opt/diesel/releases/${release_id}",
      releaseModeIndex,
    );
    const trackedRsyncIndex = deploymentRunbook.indexOf(
      "git ls-files -z | rsync -a --relative --from0 --files-from=-",
    );
    expect(releaseDirectoryCreationIndex).toBeGreaterThanOrEqual(0);
    expect(emptyReleaseDirectoryIndex).toBeGreaterThan(
      releaseDirectoryCreationIndex,
    );
    expect(releaseGroupIndex).toBeGreaterThan(emptyReleaseDirectoryIndex);
    expect(releaseOwnershipIndex).toBeGreaterThan(releaseGroupIndex);
    expect(releaseModeIndex).toBeGreaterThan(releaseOwnershipIndex);
    expect(releasePermissionProbeIndex).toBeGreaterThan(releaseModeIndex);
    expect(trackedRsyncIndex).toBeGreaterThan(releasePermissionProbeIndex);
    expect(deploymentRunbook).toContain("= root:diesel:750");
    expect(deploymentRunbook).toContain(
      'test -f "${release_dir}/.deploy-ready"',
    );
    expect(deploymentRunbook).toContain("id -u diesel");
    expect(deploymentRunbook).toContain("getent group diesel");
    expect(deploymentRunbook).toContain("groupadd --system diesel");
    expect(deploymentRunbook).toContain("useradd --system --gid diesel");
    expect(deploymentRunbook).toContain(
      'chown root:diesel /opt/diesel/shared/.env.production.local',
    );
    expect(deploymentRunbook).toContain(
      "test ! -L /opt/diesel/shared/.env.production.local",
    );
    expect(deploymentRunbook).toContain(
      "install -d -m 0750 -o root -g diesel /opt/diesel/shared",
    );
    expect(deploymentRunbook).toContain(
      "install -d -m 0750 -o diesel -g diesel /opt/diesel/shared/.data",
    );
    expect(deploymentRunbook).toContain(
      'ln -s /opt/diesel/shared/.data "${release_dir}/.data"',
    );
    expect(deploymentRunbook).toContain(
      'runuser -u diesel -- test -r "${release_dir}/.env.production.local"',
    );
    expect(deploymentRunbook).toContain(
      'runuser -u diesel -- test -w "${release_dir}/.data"',
    );
    expect(deploymentRunbook).toContain(
      "mktemp /opt/diesel/shared/.data/.write-probe.XXXXXX",
    );
    for (const artifact of [
      ".next/BUILD_ID",
      ".next/required-server-files.json",
      ".next/server/app-paths-manifest.json",
    ]) {
      expect(deploymentRunbook).toContain(
        `runuser -u diesel -- test -r "\${release_dir}/${artifact}"`,
      );
    }
    const trustedInstallCommand =
      'corepack pnpm --config.registry="${PNPM_REGISTRY:-https://registry.npmjs.org}" \\\n  install --frozen-lockfile --trust-lockfile';
    const installIndex = deploymentRunbook.indexOf(trustedInstallCommand);
    const cleanBuildCommand =
      'env -i \\\n  HOME=/root \\\n  PATH="${PATH}" \\\n  APP_VERSION="${release_id}" \\\n  NODE_ENV=production \\\n  corepack pnpm build';
    const buildIndex = deploymentRunbook.indexOf(cleanBuildCommand);
    const nextReadProbeIndex = deploymentRunbook.indexOf(
      'runuser -u diesel -- test -r "${release_dir}/.next/BUILD_ID"',
    );
    const deployReadyIndex = deploymentRunbook.indexOf("touch .deploy-ready");
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThan(installIndex);
    expect(deploymentRunbook).not.toContain("npm_config_registry");
    expect(deploymentRunbook).not.toContain("pnpm config set registry");
    expect(nextReadProbeIndex).toBeGreaterThan(buildIndex);
    expect(deployReadyIndex).toBeGreaterThan(nextReadProbeIndex);
    expect(deploymentRunbook).toContain(
      "scripts/db/export-governance-snapshot.ts",
    );
    expect(deploymentRunbook).toContain(
      '--output="${snapshot_path}"',
    );
    expect(deploymentRunbook).toContain(
      "scripts/db/restore-governance-snapshot.ts",
    );
    expect(deploymentRunbook).toContain(
      '--input="${snapshot_path}" --sha256="${snapshot_sha256}" --apply',
    );
    expect(deploymentRunbook).toContain(
      "scripts/db/with-governance-maintenance-lock.ts -- bash -s",
    );
    expect(deploymentRunbook).toContain("restore_in_progress=0");
    expect(deploymentRunbook).toContain(
      "trap 'restore_governance_on_failure \"$?\"' ERR",
    );
    expect(deploymentRunbook).toContain(
      "trap 'restore_governance_on_failure 130' INT",
    );
    expect(deploymentRunbook).toContain(
      "trap 'restore_governance_on_failure 143' TERM",
    );
    expect(deploymentRunbook).toContain(
      "trap 'restore_governance_on_failure 129' HUP",
    );
    expect(deploymentRunbook).toContain(
      "trap 'restore_governance_on_failure \"$?\"' EXIT",
    );
    expect(deploymentRunbook).toContain("trap - ERR INT TERM HUP EXIT");
    expect(deploymentRunbook).toContain(
      'recovery_marker="${snapshot_dir}/RECOVERY_REQUIRED"',
    );
    expect(deploymentRunbook).toContain(
      'publish_commit_marker="${snapshot_dir}/PUBLISH_COMMITTED"',
    );
    expect(deploymentRunbook).toContain(
      'rehearsal_path="${snapshot_dir}/governance-after-rehearsal.json"',
    );
    expect(deploymentRunbook).toContain(
      "Governance restore rehearsal changed the protected tables",
    );
    expect(deploymentRunbook).toContain(
      'IFS=$\'\\t\' read -r snapshot_sha256 snapshot_path <"${recovery_marker}"',
    );
    expect(deploymentRunbook).toContain("governance_env=(\n  env -i");
    expect(deploymentRunbook).toContain(
      "find /opt/diesel/backups -name RECOVERY_REQUIRED -print -quit",
    );
    expect(deploymentRunbook).toContain(
      'public_validation_script="${snapshot_dir}/validate-public-governance.sh"',
    );
    expect(deploymentRunbook).toContain(
      'validate_public_governance "${release_id}"',
    );
    expect(deploymentRunbook).toContain(
      '"${public_origin}/api/countries"',
    );
    expect(deploymentRunbook).toContain("countries.length !== 178");
    expect(deploymentRunbook).toContain(
      '"${public_origin}/countries/${iso3}"',
    );
    expect(deploymentRunbook).toContain(
      '"${public_origin}/api/countries/${iso3}?asOf=2026-08-11"',
    );
    expect(deploymentRunbook).toContain(
      'body.asOf !== "2026-08-11"',
    );
    expect(deploymentRunbook).toContain(
      'response_status="$(curl "${curl_common[@]}" --output /dev/null',
    );
    expect(deploymentRunbook).toContain(
      'test "${response_status}" = "200"',
    );
    expect(deploymentRunbook).toContain(
      'assert_country_detail URY 1 "Vehicle-emission homologation procedure V5" 2023-05-14 2025-11-13 UY-NATIONAL 10000000-0000-4000-8000-000000000561 10000000-0000-4000-8000-000000000562',
    );

    const previousReleasePersistIndex = deploymentRunbook.indexOf(
      `printf '%s\\n' "\${previous_release_absolute}" >"\${previous_release_path_file}"`,
    );
    const primaryNginxBackupIndex = deploymentRunbook.indexOf(
      'cp /etc/nginx/sites-available/jamesky.site "${nginx_primary_backup}"',
    );
    const alternateNginxBackupIndex = deploymentRunbook.indexOf(
      'cp /etc/nginx/sites-available/diesel-demo "${nginx_alternate_backup}"',
    );
    const currentReleaseSwitchIndex = deploymentRunbook.indexOf(
      "mv -Tf /opt/diesel/current.next /opt/diesel/current",
    );
    const environmentBackupIndex = deploymentRunbook.indexOf(
      'install -m 0600 -o root -g root \\\n  /opt/diesel/shared/.env.production.local "${environment_backup}"',
    );
    const hostRestoreStart = deploymentRunbook.indexOf(
      "restore_precommit_host_state() (",
    );
    const hostRestoreEnd = deploymentRunbook.indexOf(
      "\n)\nabort_release_and_restore_host() {",
      hostRestoreStart,
    );
    const hostRestoreBlock = deploymentRunbook.slice(
      hostRestoreStart,
      hostRestoreEnd,
    );
    const hostTrapIndex = deploymentRunbook.indexOf(
      'trap \'abort_release_and_restore_host "$?" "${rollback_release_id}"\' ERR',
    );
    expect(previousReleasePersistIndex).toBeGreaterThanOrEqual(0);
    expect(environmentBackupIndex).toBeGreaterThan(
      previousReleasePersistIndex,
    );
    expect(primaryNginxBackupIndex).toBeGreaterThan(
      environmentBackupIndex,
    );
    expect(alternateNginxBackupIndex).toBeGreaterThan(
      primaryNginxBackupIndex,
    );
    expect(currentReleaseSwitchIndex).toBeGreaterThan(
      alternateNginxBackupIndex,
    );
    expect(hostRestoreStart).toBeGreaterThan(alternateNginxBackupIndex);
    expect(hostRestoreEnd).toBeGreaterThan(hostRestoreStart);
    expect(hostTrapIndex).toBeGreaterThan(hostRestoreEnd);
    expect(hostTrapIndex).toBeLessThan(buildIndex);
    expect(deploymentRunbook).toContain(
      'trap \'failure_status="$?"; if [ "${release_committed}" -ne 1 ]; then abort_release_and_restore_host "${failure_status}" "${rollback_release_id}"; fi\' EXIT',
    );
    expect(hostRestoreBlock).toContain(
      'fixed_vps_path="/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    );
    const committedPublishGuardIndex = hostRestoreBlock.indexOf(
      'if [ -e "${rollback_publish_commit_marker}" ]; then',
    );
    const environmentRestoreIndex = hostRestoreBlock.indexOf(
      'mv -Tf "${environment_restore_path}" /opt/diesel/shared/.env.production.local',
    );
    expect(committedPublishGuardIndex).toBeGreaterThanOrEqual(0);
    expect(hostRestoreBlock).toContain(
      'test "$(stat -c \'%U:%G:%a\' "${rollback_publish_commit_marker}")" = "root:root:600"',
    );
    expect(
      hostRestoreBlock.slice(
        committedPublishGuardIndex,
        environmentRestoreIndex,
      ),
    ).toContain("exit 0");
    expect(committedPublishGuardIndex).toBeLessThan(environmentRestoreIndex);
    expect(hostRestoreBlock).toContain(
      'mv -Tf "${environment_restore_path}" /opt/diesel/shared/.env.production.local',
    );
    expect(hostRestoreBlock).toContain(
      'cp "${rollback_nginx_primary_backup}" /etc/nginx/sites-available/jamesky.site',
    );
    expect(hostRestoreBlock).toContain(
      'cp "${rollback_nginx_alternate_backup}" /etc/nginx/sites-available/diesel-demo',
    );
    const currentReadIndex = hostRestoreBlock.indexOf(
      'current_release_absolute="$(readlink -f /opt/diesel/current)"',
    );
    const switchedStateIndex = hostRestoreBlock.indexOf(
      "current_was_switched=0",
      currentReadIndex,
    );
    const targetReleaseCheckIndex = hostRestoreBlock.indexOf(
      'if [ "${current_release_absolute}" = "${rollback_release_dir}" ]; then',
      switchedStateIndex,
    );
    const currentRollbackIndex = hostRestoreBlock.indexOf(
      'mv -Tf "${rollback_link}" /opt/diesel/current',
      targetReleaseCheckIndex,
    );
    const unexpectedCurrentCheckIndex = hostRestoreBlock.indexOf(
      'elif [ "${current_release_absolute}" != "${rollback_previous_release}" ]; then',
      currentRollbackIndex,
    );
    const conditionalPm2Index = hostRestoreBlock.indexOf(
      'if [ "${current_was_switched}" -eq 1 ]; then',
      unexpectedCurrentCheckIndex,
    );
    const rollbackPm2DeleteIndex = hostRestoreBlock.indexOf(
      "pm2 delete diesel-demo",
      conditionalPm2Index,
    );
    const rollbackPm2Index = hostRestoreBlock.indexOf(
      "pm2 start /opt/diesel/current/deploy/ecosystem.config.cjs",
      rollbackPm2DeleteIndex,
    );
    const rollbackTimeoutIndex = hostRestoreBlock.indexOf(
      "curl --connect-timeout 10 --fail --max-time 30",
      rollbackPm2Index,
    );
    const rollbackConnectionRetryIndex = hostRestoreBlock.indexOf(
      "--retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 60",
      rollbackPm2Index,
    );
    const rollbackHealthIndex = hostRestoreBlock.indexOf(
      "Unexpected application health after pre-commit rollback",
      rollbackPm2Index,
    );
    expect(currentReadIndex).toBeGreaterThanOrEqual(0);
    expect(switchedStateIndex).toBeGreaterThan(currentReadIndex);
    expect(targetReleaseCheckIndex).toBeGreaterThan(switchedStateIndex);
    expect(currentRollbackIndex).toBeGreaterThan(targetReleaseCheckIndex);
    expect(unexpectedCurrentCheckIndex).toBeGreaterThan(currentRollbackIndex);
    expect(conditionalPm2Index).toBeGreaterThan(unexpectedCurrentCheckIndex);
    expect(rollbackPm2DeleteIndex).toBeGreaterThan(conditionalPm2Index);
    expect(rollbackPm2Index).toBeGreaterThan(rollbackPm2DeleteIndex);
    expect(rollbackTimeoutIndex).toBeGreaterThan(rollbackPm2Index);
    expect(rollbackConnectionRetryIndex).toBeGreaterThan(rollbackTimeoutIndex);
    expect(rollbackHealthIndex).toBeGreaterThan(rollbackPm2Index);
    expect(rollbackHealthIndex).toBeGreaterThan(rollbackConnectionRetryIndex);
    expect(hostRestoreBlock).not.toContain("id -u diesel");
    expect(deploymentRunbook).toContain(
      'restore_precommit_host_state "${failed_release_id}"',
    );
    const manualHostRollbackStart = deploymentRunbook.indexOf(
      'release_id="<失败发布的 release-id>"',
    );
    const manualHostRollbackEnd = deploymentRunbook.indexOf(
      "\n```\n\n### 4.3",
      manualHostRollbackStart,
    );
    const manualHostRollbackBlock = deploymentRunbook.slice(
      manualHostRollbackStart,
      manualHostRollbackEnd,
    );
    expect(manualHostRollbackStart).toBeGreaterThan(currentReleaseSwitchIndex);
    expect(manualHostRollbackEnd).toBeGreaterThan(manualHostRollbackStart);
    expect(manualHostRollbackBlock).toContain(
      'fixed_vps_path="/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    );
    expect(manualHostRollbackBlock).toContain(
      'test ! -e "${deployment_state_dir}/PUBLISH_COMMITTED"',
    );
    expect(manualHostRollbackBlock).toContain(
      "Unexpected PM2 process or release version",
    );
    expect(manualHostRollbackBlock).toContain(
      "Unexpected application health after manual host rollback",
    );
    const manualRollbackRetryIndex = manualHostRollbackBlock.indexOf(
      "--retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 60",
    );
    const manualRollbackTimeoutIndex = manualHostRollbackBlock.indexOf(
      "curl --connect-timeout 10 --fail --max-time 30",
    );
    const manualRollbackHealthIndex = manualHostRollbackBlock.indexOf(
      "Unexpected application health after manual host rollback",
    );
    expect(manualRollbackTimeoutIndex).toBeGreaterThanOrEqual(0);
    expect(manualRollbackRetryIndex).toBeGreaterThanOrEqual(0);
    expect(manualRollbackRetryIndex).toBeGreaterThan(
      manualRollbackTimeoutIndex,
    );
    expect(manualRollbackHealthIndex).toBeGreaterThan(
      manualRollbackRetryIndex,
    );
    expect(
      deploymentRunbook.match(
        /--retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 60/g,
      ),
    ).toHaveLength(3);
    expect(
      deploymentRunbook.match(/Unexpected application health after PM2 start/g),
    ).toHaveLength(1);
    expect(manualHostRollbackBlock).not.toContain("id -u diesel");
    const releaseCommitIndex = deploymentRunbook.indexOf(
      "release_committed=1\ntrap - ERR INT TERM HUP EXIT",
    );

    const protectedBlockStart = deploymentRunbook.indexOf(
      "scripts/db/with-governance-maintenance-lock.ts -- bash -s",
    );
    const isolatedEnvironmentIndex = deploymentRunbook.indexOf(
      "governance_env=(\n  env -i",
    );
    const protectedBlockEnd = deploymentRunbook.indexOf(
      "\nGOVERNANCE_PUBLISH\n",
      protectedBlockStart,
    );
    const protectedBlock = deploymentRunbook.slice(
      protectedBlockStart,
      protectedBlockEnd,
    );
    const protectedCountries = Array.from(
      protectedBlock.matchAll(
        /ingest-accepted-fixtures\.ts --country=([A-Z]{3})/g,
      ),
      (match) => match[1],
    );
    const publishedCountries = protectedBlock
      .match(/published_countries="([A-Z ]+)"/)?.[1]
      .split(" ");
    const expectedProtectedCountries = [
      "CRI",
      "ECU",
      "PAN",
      "DOM",
      "PHL",
      "PAK",
      "SAU",
      "ARE",
      "ISR",
      "ZAF",
      "EGY",
      "GHA",
      "KEN",
      "RWA",
      "TZA",
      "ZMB",
      "ZWE",
      "CIV",
      "DZA",
      "TUN",
      "ETH",
      "CMR",
      "SEN",
      "NGA",
      "UGA",
      "BWA",
      "NAM",
      "SWZ",
      "KHM",
      "LAO",
      "LKA",
      "MMR",
      "MNG",
      "LIE",
      "SGP",
      "MAR",
      "QAT",
      "KWT",
      "OMN",
      "JOR",
      "IRN",
      "IRQ",
      "LBN",
      "SYR",
      "GUY",
      "HTI",
      "JAM",
      "BLZ",
      "CUB",
      "LBR",
      "LBY",
      "MLI",
      "MRT",
      "NER",
      "GTM",
      "HND",
      "NIC",
      "PRY",
      "URY",
      "PRK",
      "PSE",
      "SDN",
      "PRI",
      "NCL",
      "ERI",
      "GAB",
      "GMB",
      "GNB",
      "GNQ",
      "MOZ",
      "LSO",
      "MDG",
      "MUS",
      "FJI",
      "CAF",
      "COD",
      "COG",
      "GIN",
      "DJI",
      "AUS",
      "PNG",
      "BRN",
      "BTN",
      "SLB",
      "TLS",
      "MWI",
      "SLE",
      "SOM",
      "SSD",
      "TCD",
      "SLV",
      "SUR",
      "TTO",
      "CAN",
      "USA",
      "CHN",
      "MLT",
    ];
    expect(protectedBlockStart).toBeGreaterThanOrEqual(0);
    expect(isolatedEnvironmentIndex).toBeGreaterThanOrEqual(0);
    expect(isolatedEnvironmentIndex).toBeLessThan(protectedBlockStart);
    const governanceEnvironmentPrelude = deploymentRunbook.slice(
      isolatedEnvironmentIndex,
      protectedBlockStart,
    );
    expect(governanceEnvironmentPrelude).toContain(
      "  NODE_ENV=production\n  DATABASE_MODE=postgres",
    );
    expect(governanceEnvironmentPrelude).toContain(
      '"${governance_env[@]}" node --env-file=.env.production.local',
    );
    const productionEnvironmentPreflightIndex =
      governanceEnvironmentPrelude.indexOf(
        "Governance commands require NODE_ENV=production and DATABASE_MODE=postgres",
      );
    const databaseUrlPreflightIndex = governanceEnvironmentPrelude.indexOf(
      "Governance commands require a PostgreSQL DATABASE_URL",
    );
    expect(productionEnvironmentPreflightIndex).toBeGreaterThanOrEqual(0);
    expect(databaseUrlPreflightIndex).toBeGreaterThan(
      productionEnvironmentPreflightIndex,
    );
    const wrapperConditionalIndex = governanceEnvironmentPrelude.indexOf(
      'if "${governance_env[@]}" node --env-file=.env.production.local --import tsx',
    );
    expect(wrapperConditionalIndex).toBeGreaterThan(
      databaseUrlPreflightIndex,
    );
    expect(governanceEnvironmentPrelude).not.toContain("set +e");
    expect(protectedBlockEnd).toBeGreaterThan(protectedBlockStart);
    const wrapperSuccessStatusIndex = deploymentRunbook.indexOf(
      "then\n  governance_status=0",
      protectedBlockEnd,
    );
    const wrapperFailureStatusIndex = deploymentRunbook.indexOf(
      'else\n  governance_status="$?"\nfi',
      wrapperSuccessStatusIndex,
    );
    expect(wrapperSuccessStatusIndex).toBeGreaterThan(protectedBlockEnd);
    expect(wrapperFailureStatusIndex).toBeGreaterThan(
      wrapperSuccessStatusIndex,
    );
    expect(releaseCommitIndex).toBeGreaterThan(protectedBlockEnd);
    expect(protectedBlock).not.toContain("--env-file=.env.local");
    expect(protectedCountries).toEqual(expectedProtectedCountries);
    expect(protectedCountries).toHaveLength(97);
    expect(new Set(protectedCountries).size).toBe(97);
    expect(publishedCountries).toEqual(protectedCountries);
    expect(protectedBlock).toContain(
      "97 jurisdictions / 28 regulations / 651 limits / 203 sources",
    );
    expect(deploymentRunbook).toContain("§1039.140 / §1065.20(e) ties-to-even");
    expect(deploymentRunbook).toContain("[129.5,560.501)");
    expect(deploymentRunbook).toContain(
      "560、560.001 与 560.500 kW 均命中最高带",
    );
    for (const assertion of [
      'assert_country_detail AUS 1 "Vehicle Standard (Australian Design Rule 80/04" 2025-11-01',
      'assert_country_detail PNG 1 "Road Traffic Rules"',
      'assert_country_detail CAN 2 "On-Road Vehicle and Engine Emission Regulations"',
      'assert_country_detail USA 2 "40 CFR § 1036.104"',
      'assert_country_detail CHN 3 "GB 20891-2014" "" "" CN-MEE 10000000-0000-4000-8000-000000000732 10000000-0000-4000-8000-000000000201',
      'assert_country_detail MLT 2 "EU countries: official country profiles and accession dates"',
      'assert_country_detail BRN 0 "Road Traffic Regulations (Chapter 68)"',
      'assert_country_detail BTN 0 "Environmental Standards, 2020"',
      'assert_country_detail SLB 0 "Road Transport Act (Cap. 131)"',
      'assert_country_detail TLS 0 "Lei de Bases do Ambiente"',
      'assert_country_detail MWI 0 "Road Traffic Act"',
      'assert_country_detail SLE 0 "The Environment Protection Agency Act, 2022"',
      'assert_country_detail SOM 0 "Environmental Protection and Management Act"',
      'assert_country_detail SSD 0 "National Bureau of Standards Act, 2012"',
      'assert_country_detail TCD 0 "Décret n° 904/PR/PM/MERH/2009"',
      'assert_country_detail SLV 0 "Acuerdo No. 126"',
      'assert_country_detail SUR 0 "Milieu Raamwet"',
      'assert_country_detail TTO 0 "The Air Pollution Rules, 2014"',
    ]) {
      expect(protectedBlock).toContain(assertion);
    }
    expect(protectedBlock).not.toContain(
      'assert_country_detail CHN 2 "GB 20891-2014"',
    );
    const exportIndex = protectedBlock.indexOf(
      "scripts/db/export-governance-snapshot.ts",
    );
    const staleMarkerCheckIndex = protectedBlock.indexOf(
      "find /opt/diesel/backups -name RECOVERY_REQUIRED -print -quit",
    );
    const stalePublishCommitCheckIndex = protectedBlock.indexOf(
      "find /opt/diesel/backups -name PUBLISH_COMMITTED -print -quit",
    );
    const validationScriptIndex = protectedBlock.indexOf(
      'public_validation_script="${snapshot_dir}/validate-public-governance.sh"',
    );
    const dryRunIndex = protectedBlock.indexOf(
      '--input="${snapshot_path}" --sha256="${snapshot_sha256}"\n',
    );
    const recoveryMarkerIndex = protectedBlock.indexOf(
      'chmod 600 "${recovery_marker}"',
    );
    const rehearsalIndex = protectedBlock.indexOf(
      '--input="${snapshot_path}" --sha256="${snapshot_sha256}" --apply',
      recoveryMarkerIndex,
    );
    const errTrapIndex = protectedBlock.indexOf(
      "trap 'restore_governance_on_failure \"$?\"' ERR",
    );
    const childCommitGuardIndex = protectedBlock.indexOf(
      'if [ -e "${publish_commit_marker}" ]; then',
    );
    const restoreStatusNormalizationIndex = protectedBlock.indexOf(
      'if [ "${restore_status}" -eq 0 ]; then',
      childCommitGuardIndex,
    );
    const failureRestoreApplyIndex = protectedBlock.indexOf(
      '--input="${snapshot_path}" --sha256="${snapshot_sha256}" --apply',
      childCommitGuardIndex,
    );
    const firstIngestIndex = protectedBlock.indexOf(
      "scripts/db/ingest-accepted-fixtures.ts --country=CRI",
    );
    const publicValidationIndex = protectedBlock.indexOf(
      'validate_public_governance "${release_id}"',
    );
    const publishCommitMoveIndex = protectedBlock.indexOf(
      'mv -Tf "${recovery_marker}" "${publish_commit_marker}"',
      publicValidationIndex,
    );
    const childTrapClearAfterCommitIndex = protectedBlock.indexOf(
      "trap - ERR INT TERM HUP EXIT",
      publishCommitMoveIndex,
    );
    expect(deploymentRunbook.indexOf("scripts/db/export-governance-snapshot.ts")).toBe(
      protectedBlockStart + exportIndex,
    );
    expect(staleMarkerCheckIndex).toBeGreaterThanOrEqual(0);
    expect(staleMarkerCheckIndex).toBeLessThan(exportIndex);
    expect(stalePublishCommitCheckIndex).toBeGreaterThan(
      staleMarkerCheckIndex,
    );
    expect(stalePublishCommitCheckIndex).toBeLessThan(exportIndex);
    expect(validationScriptIndex).toBeGreaterThan(
      stalePublishCommitCheckIndex,
    );
    expect(validationScriptIndex).toBeLessThan(exportIndex);
    expect(exportIndex).toBeGreaterThanOrEqual(0);
    expect(dryRunIndex).toBeGreaterThan(exportIndex);
    expect(childCommitGuardIndex).toBeGreaterThan(dryRunIndex);
    expect(restoreStatusNormalizationIndex).toBeGreaterThan(
      childCommitGuardIndex,
    );
    expect(failureRestoreApplyIndex).toBeGreaterThan(childCommitGuardIndex);
    expect(errTrapIndex).toBeGreaterThan(dryRunIndex);
    expect(recoveryMarkerIndex).toBeGreaterThan(errTrapIndex);
    expect(rehearsalIndex).toBeGreaterThan(errTrapIndex);
    expect(firstIngestIndex).toBeGreaterThan(rehearsalIndex);
    expect(publicValidationIndex).toBeGreaterThan(firstIngestIndex);
    expect(protectedBlock).toContain(
      'test ! -e "${publish_commit_marker}"\nmv -Tf "${recovery_marker}" "${publish_commit_marker}"',
    );
    expect(publishCommitMoveIndex).toBeGreaterThan(publicValidationIndex);
    expect(childTrapClearAfterCommitIndex).toBeGreaterThan(
      publishCommitMoveIndex,
    );

    const governanceHostRollbackStart = deploymentRunbook.indexOf(
      "rollback_host_release_after_governance_failure() {",
    );
    const governanceHostRollbackEnd = deploymentRunbook.indexOf(
      "\n}\n\nfixed_vps_path=",
      governanceHostRollbackStart,
    );
    const governanceHostRollbackBlock = deploymentRunbook.slice(
      governanceHostRollbackStart,
      governanceHostRollbackEnd,
    );
    expect(governanceHostRollbackStart).toBeGreaterThan(
      currentReleaseSwitchIndex,
    );
    expect(governanceHostRollbackEnd).toBeGreaterThan(
      governanceHostRollbackStart,
    );
    expect(governanceHostRollbackStart).toBeLessThan(protectedBlockStart);
    expect(governanceHostRollbackBlock).toContain(
      'restore_precommit_host_state "${release_id}"',
    );
    expect(governanceHostRollbackBlock).not.toContain("id -u diesel");
    const governanceStatusIndex = deploymentRunbook.indexOf(
      'governance_status="$?"',
      protectedBlockEnd,
    );
    const outerPublishCommitBranchIndex = deploymentRunbook.indexOf(
      'if [ -e "${publish_commit_marker}" ]; then',
      governanceStatusIndex,
    );
    const committedStatusNormalizationIndex = deploymentRunbook.indexOf(
      "governance_status=0",
      outerPublishCommitBranchIndex,
    );
    const outerReleaseCommitIndex = deploymentRunbook.indexOf(
      "release_committed=1",
      committedStatusNormalizationIndex,
    );
    const outerTrapClearIndex = deploymentRunbook.indexOf(
      "trap - ERR INT TERM HUP EXIT",
      outerReleaseCommitIndex,
    );
    const committedHealthIndex = deploymentRunbook.indexOf(
      "Unexpected application health after governance commit",
      outerTrapClearIndex,
    );
    const publishCommitRemovalIndex = deploymentRunbook.indexOf(
      'rm -f "${publish_commit_marker}"',
      committedHealthIndex,
    );
    const missingCommitMarkerIndex = deploymentRunbook.indexOf(
      'elif [ "${governance_status}" -eq 0 ]; then',
      publishCommitRemovalIndex,
    );
    const hostRollbackInvocationIndex = deploymentRunbook.indexOf(
      "rollback_host_release_after_governance_failure",
      governanceStatusIndex,
    );
    const hostRollbackStatusIndex = deploymentRunbook.indexOf(
      'host_rollback_status="$?"',
      hostRollbackInvocationIndex,
    );
    const hostRollbackFailureIndex = deploymentRunbook.indexOf(
      'if [ "${host_rollback_status}" -ne 0 ]; then',
      hostRollbackStatusIndex,
    );
    const originalStatusExitIndex = deploymentRunbook.indexOf(
      'exit "${governance_status}"',
      hostRollbackFailureIndex,
    );
    expect(governanceStatusIndex).toBeGreaterThan(protectedBlockEnd);
    expect(outerPublishCommitBranchIndex).toBeGreaterThan(
      governanceStatusIndex,
    );
    expect(
      deploymentRunbook.slice(
        outerPublishCommitBranchIndex,
        committedStatusNormalizationIndex,
      ),
    ).toContain(
      'test "$(readlink -f /opt/diesel/current)" = "/opt/diesel/releases/${release_id}"',
    );
    expect(committedStatusNormalizationIndex).toBeGreaterThan(
      outerPublishCommitBranchIndex,
    );
    expect(outerReleaseCommitIndex).toBeGreaterThan(
      committedStatusNormalizationIndex,
    );
    expect(outerTrapClearIndex).toBeGreaterThan(outerReleaseCommitIndex);
    expect(committedHealthIndex).toBeGreaterThan(outerTrapClearIndex);
    expect(publishCommitRemovalIndex).toBeGreaterThan(committedHealthIndex);
    expect(missingCommitMarkerIndex).toBeGreaterThan(
      publishCommitRemovalIndex,
    );
    expect(deploymentRunbook).toContain(
      "Governance wrapper exited nonzero after the publish commit point; preserving the committed release",
    );
    expect(deploymentRunbook).toContain(
      "Governance wrapper exited successfully without the required publish commit marker",
    );
    expect(hostRollbackInvocationIndex).toBeGreaterThan(
      missingCommitMarkerIndex,
    );
    expect(hostRollbackStatusIndex).toBeGreaterThan(
      hostRollbackInvocationIndex,
    );
    expect(hostRollbackFailureIndex).toBeGreaterThan(
      hostRollbackStatusIndex,
    );
    expect(deploymentRunbook).toContain(
      'echo "Host-level release rollback failed after governance failure" >&2\n    exit 70',
    );
    expect(originalStatusExitIndex).toBeGreaterThan(hostRollbackFailureIndex);

    const cleanPm2Starts = deploymentRunbook.match(
      /env -i \\\n\s+HOME=\/root \\\n\s+PATH="\$\{(?:PATH|fixed_vps_path)\}" \\\n\s+APP_VERSION="\$\{(?:release_id|previous_app_version)\}" \\\n\s+NODE_ENV=production \\\n\s+pm2 start \/opt\/diesel\/current\/deploy\/ecosystem\.config\.cjs/g,
    );
    expect(cleanPm2Starts).toHaveLength(3);
    expect(
      deploymentRunbook.match(/pm2 start \/opt\/diesel\/current/g),
    ).toHaveLength(3);
    expect(
      deploymentRunbook.match(/^\s*pm2 delete diesel-demo$/gmu),
    ).toHaveLength(3);
    expect(deploymentRunbook).not.toContain("pm2 reload ");
    expect(deploymentRunbook.match(/ps -o uid=/g)).toHaveLength(1);
    expect(
      deploymentRunbook.match(
        /Unexpected PM2 process or release version/g,
      ),
    ).toHaveLength(3);
    expect(deploymentRunbook.match(/^\s*pm2 save$/gmu)).toHaveLength(3);
    expect(deploymentRunbook).toContain(
      "pm2 startup systemd -u root --hp /root",
    );
    const pm2StartupIndex = deploymentRunbook.indexOf(
      "pm2 startup systemd -u root --hp /root",
    );
    const pm2DaemonReloadIndex = deploymentRunbook.indexOf(
      "systemctl daemon-reload",
      pm2StartupIndex,
    );
    const pm2EnableNowIndex = deploymentRunbook.indexOf(
      "systemctl enable --now pm2-root",
      pm2DaemonReloadIndex,
    );
    const firstPm2EnabledCheckIndex = deploymentRunbook.indexOf(
      "systemctl is-enabled --quiet pm2-root",
      pm2EnableNowIndex,
    );
    expect(pm2StartupIndex).toBeGreaterThanOrEqual(0);
    expect(pm2DaemonReloadIndex).toBeGreaterThan(pm2StartupIndex);
    expect(pm2EnableNowIndex).toBeGreaterThan(pm2DaemonReloadIndex);
    expect(firstPm2EnabledCheckIndex).toBeGreaterThan(pm2EnableNowIndex);
    expect(
      deploymentRunbook.match(/systemctl is-enabled --quiet pm2-root/g),
    ).toHaveLength(4);
    expect(
      deploymentRunbook.match(/systemctl is-active --quiet pm2-root/g),
    ).toHaveLength(4);

    const manualRecoveryCommandStart = deploymentRunbook.indexOf(
      'release_id="<marker 对应的 release-id>"',
    );
    const manualRecoveryStart = deploymentRunbook.indexOf(
      "<<'GOVERNANCE_RECOVERY'",
      manualRecoveryCommandStart,
    );
    const manualRecoveryEnd = deploymentRunbook.indexOf(
      "\nGOVERNANCE_RECOVERY\n",
      manualRecoveryStart,
    );
    const manualRecovery = deploymentRunbook.slice(
      manualRecoveryStart,
      manualRecoveryEnd,
    );
    const manualRecoveryPrelude = deploymentRunbook.slice(
      manualRecoveryCommandStart,
      manualRecoveryStart,
    );
    const manualReleaseDirectoryIndex = manualRecoveryPrelude.indexOf(
      'release_dir="/opt/diesel/releases/${release_id}"',
    );
    const manualCdIndex = manualRecoveryPrelude.indexOf(
      'cd "${release_dir}"',
    );
    const manualEnvironmentIndex = manualRecoveryPrelude.indexOf(
      "governance_env=(\n  env -i",
    );
    const manualPreflightIndex = manualRecoveryPrelude.indexOf(
      "Governance commands require NODE_ENV=production and DATABASE_MODE=postgres",
    );
    expect(manualRecoveryCommandStart).toBeGreaterThanOrEqual(0);
    expect(manualReleaseDirectoryIndex).toBeGreaterThanOrEqual(0);
    expect(manualCdIndex).toBeGreaterThan(manualReleaseDirectoryIndex);
    expect(manualEnvironmentIndex).toBeGreaterThan(manualCdIndex);
    expect(manualRecoveryPrelude).toContain(
      'fixed_vps_path="/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    );
    expect(manualRecoveryPrelude).toContain(
      "  NODE_ENV=production\n  DATABASE_MODE=postgres",
    );
    expect(manualPreflightIndex).toBeGreaterThan(manualEnvironmentIndex);
    expect(manualRecoveryPrelude).toContain(
      "Governance commands require a PostgreSQL DATABASE_URL",
    );
    expect(manualRecoveryPrelude).toContain(
      'test ! -e "${publish_commit_marker}"',
    );
    const manualApplyIndex = manualRecovery.indexOf(
      '--input="${snapshot_path}" --sha256="${snapshot_sha256}" --apply',
    );
    const manualExportIndex = manualRecovery.indexOf(
      '--output="${recovery_export_path}"',
    );
    const manualDeepCompareIndex = manualRecovery.indexOf(
      "Governance recovery does not match the pre-publish snapshot",
    );
    const manualHealthIndex = manualRecovery.indexOf(
      "Unexpected public health payload after governance recovery",
    );
    const manualMarkerRemovalIndex = manualRecovery.indexOf(
      'rm -f "${recovery_marker}"',
    );
    expect(manualRecoveryStart).toBeGreaterThanOrEqual(0);
    expect(manualRecoveryEnd).toBeGreaterThan(manualRecoveryStart);
    expect(manualApplyIndex).toBeGreaterThanOrEqual(0);
    expect(manualExportIndex).toBeGreaterThan(manualApplyIndex);
    expect(manualDeepCompareIndex).toBeGreaterThan(manualExportIndex);
    expect(manualHealthIndex).toBeGreaterThan(manualDeepCompareIndex);
    expect(manualMarkerRemovalIndex).toBeGreaterThan(manualHealthIndex);
    expect(manualRecovery).not.toContain("validate_public_governance");
    expect(manualRecovery).not.toContain("countries.length !== 178");
    const committedCleanupStart = deploymentRunbook.indexOf(
      'release_id="<commit marker 对应的 release-id>"',
    );
    const committedCleanupEnd = deploymentRunbook.indexOf(
      "\n```\n\n上述 97 个唯一国家命令",
      committedCleanupStart,
    );
    const committedCleanupBlock = deploymentRunbook.slice(
      committedCleanupStart,
      committedCleanupEnd,
    );
    const committedCleanupValidationIndex = committedCleanupBlock.indexOf(
      'bash "${public_validation_script}" "${release_id}"',
    );
    const committedCleanupRemovalIndex = committedCleanupBlock.indexOf(
      'rm -f "${publish_commit_marker}"',
    );
    expect(committedCleanupStart).toBeGreaterThan(manualRecoveryEnd);
    expect(committedCleanupEnd).toBeGreaterThan(committedCleanupStart);
    expect(committedCleanupBlock).toContain(
      'test "$(readlink -f /opt/diesel/current)" = "${release_dir}"',
    );
    expect(committedCleanupBlock).toContain(
      'test ! -e "${recovery_marker}"',
    );
    expect(committedCleanupValidationIndex).toBeGreaterThanOrEqual(0);
    expect(committedCleanupRemovalIndex).toBeGreaterThan(
      committedCleanupValidationIndex,
    );
    expect(committedCleanupBlock).not.toContain(
      "restore-governance-snapshot.ts",
    );
    expect(committedCleanupBlock).not.toContain("--apply");
    expect(
      deploymentRunbook.match(
        /Governance commands require NODE_ENV=production and DATABASE_MODE=postgres/g,
      ),
    ).toHaveLength(2);
    expect(deploymentRunbook.match(/set -euo pipefail/g)).toHaveLength(7);
  });
});
