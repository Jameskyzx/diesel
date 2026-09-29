import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { portfolioReleaseCountryIso3s } from "../src/domain/portfolio-evidence";

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
    const localeLocationStart = configuration.indexOf(
      "location = /api/preferences/locale {",
    );
    const catchAllLocationStart = configuration.indexOf("location / {");
    expect(localeLocationStart).toBeGreaterThan(
      configuration.indexOf("location = /api/chat {"),
    );
    expect(catchAllLocationStart).toBeGreaterThan(localeLocationStart);
    const localeLocation = configuration.slice(
      localeLocationStart,
      catchAllLocationStart,
    );
    expect(localeLocation).toContain("client_body_timeout 30s;");
    expect(localeLocation).toContain("proxy_request_buffering off;");
    expect(localeLocation).toContain("proxy_http_version 1.1;");
    expect(localeLocation).toContain("proxy_set_header Host $host;");
    expect(localeLocation).toContain(
      "proxy_set_header X-Forwarded-For $remote_addr;",
    );
    expect(localeLocation).toContain(
      'proxy_set_header oai-authenticated-user-email "";',
    );
    expect(localeLocation).toContain("proxy_buffering off;");
    expect(localeLocation).toContain("proxy_cache off;");
    expect(localeLocation).not.toContain("client_max_body_size 10m;");
    expect(localeLocation).not.toContain("limit_conn chat_per_client");
    expect(localeLocation).not.toContain("limit_conn chat_global");
    const catchAllLocation = configuration.slice(
      catchAllLocationStart,
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

    const privilegedExactRoutes = [
      "/admin",
      "/api/admin",
      "/dev",
      "/api/dev",
    ] as const;
    const privilegedRoutePrefixes = [
      "/admin/",
      "/api/admin/",
      "/dev/",
      "/api/dev/",
    ] as const;

    for (const route of privilegedExactRoutes) {
      const block = `location = ${route} {\n        return 404;\n    }`;
      expect(configuration).toContain(block);
      expect(configuration.indexOf(block)).toBeLessThan(catchAllLocationStart);
    }

    for (const route of privilegedRoutePrefixes) {
      const block = `location ^~ ${route} {\n        return 404;\n    }`;
      expect(configuration).toContain(block);
      expect(configuration.indexOf(block)).toBeLessThan(catchAllLocationStart);
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
    const stageRelease = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "stage-release.sh",
      ),
      "utf8",
    );
    const publicGovernanceValidator = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "validate-public-governance.sh",
      ),
      "utf8",
    );
    const governanceCountryFixturePublisher = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "publish-governance-country-fixtures.sh",
      ),
      "utf8",
    );
    const governancePublicationStateMachine = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "governance-publication-state-machine.sh",
      ),
      "utf8",
    );
    const hostActivationLedger = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "host-activation-ledger.sh",
      ),
      "utf8",
    );
    const runtimePreparer = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "prepare-release-runtime.sh",
      ),
      "utf8",
    );
    const hostActivator = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "activate-host-release.sh",
      ),
      "utf8",
    );
    const releasePublicationController = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "release-publication-controller.sh",
      ),
      "utf8",
    );
    const hostReleaseOrchestrator = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "host-release-orchestrator.sh",
      ),
      "utf8",
    );
    const runtimeEnvironmentContract = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "runtime-environment-contract.cjs",
      ),
      "utf8",
    );
    const pm2PersistenceHelper = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "persist-pm2-release-state.mjs",
      ),
      "utf8",
    );
    const rollbackHostRelease = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "rollback-host-release.sh",
      ),
      "utf8",
    );
    const artifactManifest = await readFile(
      resolve(
        process.cwd(),
        "scripts",
        "deploy",
        "release-artifact-manifest.mjs",
      ),
      "utf8",
    );

    expect(stageRelease).toContain(
      'run_git archive --format=tar --output="${release_archive}" "${release_id}"',
    );
    expect(stageRelease).toContain("-a --no-owner --no-group --no-perms");
    expect(stageRelease).not.toContain(
      "git ls-files -z | rsync -a --relative --from0 --files-from=-",
    );
    expect(stageRelease).toContain(
      'status="$(run_git status --porcelain=v1 --untracked-files=all --ignore-submodules=none)"',
    );
    expect(stageRelease).toContain(
      'head="$(run_git rev-parse --verify \'HEAD^{commit}\')"',
    );
    expect(stageRelease).toContain(
      'if [[ "$#" -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]',
    );
    const manifestAdmissionIndex = stageRelease.indexOf(
      '"${committed_manifest_helper}" create "${release_id}" "${generated_manifest}"',
    );
    const releaseArchiveIndex = stageRelease.indexOf(
      'run_git archive --format=tar --output="${release_archive}" "${release_id}"',
    );
    const releaseAuthorizationIndex = stageRelease.indexOf(
      '"${committed_authorization_bundle}" "${release_id}"',
    );
    const releaseAuthorizationOutputValidationIndex =
      stageRelease.indexOf(
        'validate-output "${release_id}"',
        releaseAuthorizationIndex,
      );
    const firstRemoteMutationIndex = stageRelease.indexOf(
      '"${ssh_environment[@]}" "${ssh_bin}" "${ssh_options[@]}"',
      releaseAuthorizationOutputValidationIndex,
    );
    expect(manifestAdmissionIndex).toBeGreaterThanOrEqual(0);
    expect(releaseArchiveIndex).toBeGreaterThan(manifestAdmissionIndex);
    expect(releaseAuthorizationIndex).toBeGreaterThanOrEqual(0);
    expect(
      stageRelease.slice(
        releaseAuthorizationIndex,
        releaseAuthorizationOutputValidationIndex,
      ),
    ).not.toContain("pnpm");
    expect(releaseAuthorizationOutputValidationIndex).toBeGreaterThan(
      releaseAuthorizationIndex,
    );
    expect(releaseAuthorizationIndex).toBeGreaterThan(releaseArchiveIndex);
    expect(firstRemoteMutationIndex).toBeGreaterThan(
      releaseAuthorizationOutputValidationIndex,
    );
    expect(stageRelease).not.toContain(
      'release_id="$(date -u +%Y%m%d%H%M%S)"',
    );
    expect(stageRelease).toContain(
      'readonly remote_release_dir="${releases_root}/${release_id}"',
    );
    expect(stageRelease).not.toContain('mkdir -p "${release_dir}"');
    const remotePreflightStart = stageRelease.indexOf("<<'REMOTE_PREFLIGHT'");
    const remotePreflightBodyStart = stageRelease.indexOf(
      "\n",
      remotePreflightStart,
    ) + 1;
    const remotePreflightEnd = stageRelease.indexOf(
      "\nREMOTE_PREFLIGHT\n",
      remotePreflightBodyStart,
    );
    const releaseAbsenceIndex = stageRelease.indexOf(
      '[[ ! -e "${release_dir}" && ! -L "${release_dir}" ]]',
      remotePreflightStart,
    );
    const releaseGroupIndex = stageRelease.indexOf(
      '"${groupadd_bin}" --system diesel',
      releaseAbsenceIndex,
    );
    const releaseDirectoryCreationIndex = stageRelease.indexOf(
      '"${mkdir_bin}" -- "${release_dir}"',
      releaseGroupIndex,
    );
    const emptyReleaseDirectoryIndex = stageRelease.indexOf(
      '"${find_bin}" "${release_dir}" -mindepth 1 -maxdepth 1 -print -quit',
      releaseDirectoryCreationIndex,
    );
    const releaseOwnershipIndex = stageRelease.indexOf(
      '"${chown_bin}" "0:${diesel_gid}" "${release_dir}"',
      emptyReleaseDirectoryIndex,
    );
    const releaseModeIndex = stageRelease.indexOf(
      '"${chmod_bin}" 750 "${release_dir}"',
      releaseOwnershipIndex,
    );
    const releasePermissionProbeIndex = stageRelease.indexOf(
      'release_identity="$("${stat_bin}" -c \'%u:%g:%a:%d:%i\' -- "${release_dir}")"',
      releaseModeIndex,
    );
    const trackedRsyncIndex = stageRelease.indexOf(
      "-a --no-owner --no-group --no-perms",
      remotePreflightEnd,
    );
    const remotePostcheckIndex = stageRelease.indexOf(
      "<<'REMOTE_POSTCHECK'",
      trackedRsyncIndex,
    );
    const postTransferPermissionProbeIndex = stageRelease.indexOf(
      '"${stat_bin}" -c \'%u:%g:%a:%d:%i\' -- "${release_dir}"',
      remotePostcheckIndex,
    );
    expect(remotePreflightStart).toBeGreaterThan(
      releaseAuthorizationOutputValidationIndex,
    );
    expect(remotePreflightBodyStart).toBeGreaterThan(remotePreflightStart);
    expect(remotePreflightEnd).toBeGreaterThan(remotePreflightBodyStart);
    expect(firstRemoteMutationIndex).toBeGreaterThan(remotePreflightEnd);
    expect(releaseAbsenceIndex).toBeGreaterThan(remotePreflightStart);
    expect(releaseGroupIndex).toBeGreaterThan(releaseAbsenceIndex);
    expect(releaseDirectoryCreationIndex).toBeGreaterThanOrEqual(0);
    expect(emptyReleaseDirectoryIndex).toBeGreaterThan(
      releaseDirectoryCreationIndex,
    );
    expect(releaseOwnershipIndex).toBeGreaterThan(emptyReleaseDirectoryIndex);
    expect(releaseModeIndex).toBeGreaterThan(releaseOwnershipIndex);
    expect(releasePermissionProbeIndex).toBeGreaterThan(releaseModeIndex);
    expect(trackedRsyncIndex).toBeGreaterThan(releasePermissionProbeIndex);
    expect(remotePostcheckIndex).toBeGreaterThan(trackedRsyncIndex);
    expect(postTransferPermissionProbeIndex).toBeGreaterThan(remotePostcheckIndex);
    expect(
      stageRelease.match(
        /"\$\{remote_target\}" \/usr\/bin\/env -i \\\n  HOME=\/root LANG=C LC_ALL=C PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin \\\n  \/bin\/bash --noprofile --norc -s --/gu,
      ),
    ).toHaveLength(2);
    expect(stageRelease).toContain(
      'remote_rsync_path="umask 022 && /usr/bin/env -i HOME=/root LANG=C LC_ALL=C PATH=/usr/bin:/bin /usr/bin/rsync"',
    );
    expect(stageRelease).toContain("--timeout=60");
    expect(stageRelease).toContain(
      'if ! run_bounded_command 60000 5000 512 8192',
    );
    expect(stageRelease).toContain(
      'if ! run_bounded_command 900000 5000 65536 65536',
    );
    expect(stageRelease).toContain(
      'if ! run_bounded_command 300000 5000 128 8192',
    );
    expect(stageRelease).toContain(
      'remote_identity_expected_bytes="$(( ${#remote_candidate_identity} + 1 ))"',
    );
    expect(
      stageRelease.split('^[A-Za-z0-9_./+@-]+$'),
    ).toHaveLength(3);
    expect(stageRelease).not.toContain("+@:-");
    expect(
      stageRelease.split(
        'for node_parent in "/opt" "${node_root}" "${node_root}/bin"; do',
      ),
    ).toHaveLength(3);
    expect(stageRelease).toContain(
      '[[ "${remote_candidate_identity}" =~ ^[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9]+:[0-9]+$ ]]',
    );
    const preflightNodeVersionIndex = stageRelease.indexOf(
      '"$("${node_bin}" --version)" == "v22.22.3"',
      remotePreflightBodyStart,
    );
    expect(preflightNodeVersionIndex).toBeGreaterThan(remotePreflightBodyStart);
    expect(preflightNodeVersionIndex).toBeLessThan(
      releaseDirectoryCreationIndex,
    );
    const helperVerificationIndex = stageRelease.indexOf(
      "verify_manifest_helper || exit 70",
      remotePostcheckIndex,
    );
    const remoteManifestExecutionIndex = stageRelease.indexOf(
      'actual_digest="$(',
      helperVerificationIndex,
    );
    expect(helperVerificationIndex).toBeGreaterThan(remotePostcheckIndex);
    expect(remoteManifestExecutionIndex).toBeGreaterThan(
      helperVerificationIndex,
    );
    expect(stageRelease).toContain(
      '"0:0:644:1:${expected_helper_size}"',
    );
    expect(stageRelease).toContain(
      '"${expected_helper_sha256}  ${manifest_helper}"',
    );
    expect(stageRelease).toContain(
      '[[ -d "${release_dir}" && ! -L "${release_dir}" ]]',
    );
    expect(stageRelease).toContain(
      'for forbidden_runtime_path in ".next" "node_modules" ".build-complete" ".deploy-ready"; do',
    );
    expect(stageRelease).toContain(
      '[[ ! -e "${release_dir}/${forbidden_runtime_path}" &&',
    );
    expect(stageRelease).toContain(
      '! -L "${release_dir}/${forbidden_runtime_path}" ]] || return 1',
    );
    expect(stageRelease).toContain('^0:${diesel_gid}:750:');
    expect(deploymentRunbook).toContain(
      'stage_script_path="scripts/deploy/stage-release.sh"',
    );
    expect(deploymentRunbook).toContain(
      '"${bootstrap_git[@]}" archive --format=tar --output="${stage_archive_path}"',
    );
    expect(deploymentRunbook).toContain(
      'bootstrap_git=(\n  /usr/bin/env -i',
    );
    expect(deploymentRunbook).toContain("GIT_CONFIG_GLOBAL=/dev/null");
    expect(deploymentRunbook).toContain("GIT_NO_REPLACE_OBJECTS=1");
    expect(deploymentRunbook).toContain("-c core.fsmonitor=false");
    expect(deploymentRunbook).toContain("-c core.hooksPath=/dev/null");
    expect(deploymentRunbook).toContain("-c diff.external=");
    expect(deploymentRunbook).toContain(
      'repo_root="$("${bootstrap_git[@]}" rev-parse --show-toplevel)" || return 1',
    );
    expect(deploymentRunbook).toContain(
      'test "$(pwd -P)" = "${repo_root}"',
    );
    expect(deploymentRunbook).toContain(
      'test "${branch_ref}" = "refs/heads/master"',
    );
    expect(deploymentRunbook).toContain(
      'status="$(\n    "${bootstrap_git[@]}" status --porcelain=v1',
    );
    expect(deploymentRunbook).toContain(
      ')" || return 1\n  test -z "${status}"',
    );
    expect(deploymentRunbook).toContain(
      'index_state="$("${bootstrap_git[@]}" -c core.quotePath=true ls-files -v)"',
    );
    expect(deploymentRunbook).toContain(
      'stage_tmp_dir="$(/usr/bin/mktemp -d /tmp/diesel-stage-bootstrap.XXXXXXXX)"',
    );
    expect(deploymentRunbook).toContain(
      'current_identity="$(stage_tmp_identity "${stage_tmp_dir}")"',
    );
    expect(deploymentRunbook).toContain(
      'test "${current_identity}" = "${stage_tmp_dir_identity}"',
    );
    expect(deploymentRunbook).toContain(
      'stage_env=(\n  /usr/bin/env -i',
    );
    expect(deploymentRunbook).toContain(
      '"${stage_env[@]}" \\\n    /bin/bash --noprofile --norc "${committed_stage_script}" "${release_id}"',
    );
    expect(deploymentRunbook).toContain(
      '"${bootstrap_git[@]}" hash-object --no-filters "${committed_stage_script}"',
    );
    expect(deploymentRunbook).toContain(
      '"${bootstrap_git[@]}" hash-object --no-filters "${stage_script_path}"',
    );
    expect(deploymentRunbook).toContain(
      'test -x "${committed_stage_script}"',
    );
    expect(deploymentRunbook).not.toContain('authorization_json="$(');
    expect(deploymentRunbook).not.toContain("release_export_dir=");
    expect(deploymentRunbook).not.toMatch(
      /^rsync -a --no-owner --no-group --no-perms/gmu,
    );
    expect(deploymentRunbook).not.toContain("ssh root@111.228.50.85");
    const stageReceiptCaptureIndex =
      deploymentRunbook.indexOf('stage_receipt="$(');
    const outerCleanupIndex = deploymentRunbook.indexOf(
      "remove_stage_bootstrap\ntrap - EXIT",
      stageReceiptCaptureIndex,
    );
    const receiptOutputIndex = deploymentRunbook.indexOf(
      "printf '%s\\n' \"${stage_receipt}\"",
      outerCleanupIndex,
    );
    expect(stageReceiptCaptureIndex).toBeGreaterThanOrEqual(0);
    expect(outerCleanupIndex).toBeGreaterThan(stageReceiptCaptureIndex);
    expect(receiptOutputIndex).toBeGreaterThan(outerCleanupIndex);
    expect(deploymentRunbook).toContain(
      'test -f "${release_dir}/.deploy-ready"',
    );
    expect(deploymentRunbook).toContain("id -u diesel");
    expect(deploymentRunbook).toContain("getent group diesel");
    expect(deploymentRunbook).toContain("groupadd --system diesel");
    expect(deploymentRunbook).toContain("useradd --system --gid diesel");
    expect(hostReleaseOrchestrator).toContain(
      "fchownSync(destination, 0, Number(dieselGidText));",
    );
    expect(hostReleaseOrchestrator).toContain(
      [
        "host_release_orchestrator_require_exact_file \\",
        '      "${HOST_RELEASE_ORCHESTRATOR_LIVE_ENVIRONMENT}"',
      ].join("\n"),
    );
    expect(deploymentRunbook).toContain(
      "install -d -m 0750 -o root -g diesel /opt/diesel/shared",
    );
    expect(deploymentRunbook).toContain(
      'test "$(stat -c \'%U:%G:%a\' /opt/diesel)" = "root:root:755"',
    );
    expect(deploymentRunbook).toContain(
      'test "$(stat -c \'%U:%G:%a\' /opt/diesel/releases)" = "root:root:755"',
    );
    expect(hostReleaseOrchestrator).toContain(
      [
        "host_release_orchestrator_require_exact_directory \\",
        '      "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}/backups" "0:0:700"',
      ].join("\n"),
    );
    expect(deploymentRunbook).toContain(
      "install -d -m 0750 -o diesel -g diesel /opt/diesel/shared/.data",
    );
    expect(deploymentRunbook).toContain(
      'release_build_lock_path="/opt/diesel/.release-build.lock"',
    );
    expect(deploymentRunbook).toContain(
      'release_lifecycle_lock_path="/opt/diesel/.release-lifecycle.lock"',
    );
    expect(deploymentRunbook).toContain(
      '(umask 077; set -o noclobber; : >"${immutable_lock_path}") 2>/dev/null || true',
    );
    expect(deploymentRunbook).toContain(
      'test "$(stat -c \'%U:%G:%a\' "${immutable_lock_path}")" = "root:root:600"',
    );
    expect(deploymentRunbook).not.toContain(
      "install -m 0600 -o root -g root /dev/null /opt/diesel/.release-build.lock",
    );
    expect(runtimePreparer).toContain(
      'ln -s "${data_root}" "${release_dir}/.data"',
    );
    expect(runtimePreparer).toContain(
      'runuser -u diesel -- test -r "${release_dir}/.env.production.local"',
    );
    expect(runtimePreparer).toContain(
      'runuser -u diesel -- test -w "${release_dir}/.data"',
    );
    expect(runtimePreparer).toContain(
      'mktemp "$1/.write-probe.XXXXXX"',
    );
    expect(runtimePreparer).toContain('runtime_uid="$(id -u diesel)"');
    expect(runtimePreparer).toContain('runtime_gid="$(id -g diesel)"');
    expect(runtimePreparer).toContain(
      '0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}"',
    );
    expect(hostActivator).toContain(
      '0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}"',
    );
    for (const rootEntry of [
      runtimePreparer,
      hostActivator,
      governancePublicationStateMachine,
      releasePublicationController,
      hostReleaseOrchestrator,
    ]) {
      expect(rootEntry.startsWith("#!/bin/bash\n")).toBe(true);
      expect(rootEntry).toMatch(
        /(?:export PATH|HOST_RELEASE_ORCHESTRATOR_ROOT_PATH)="\/usr\/sbin:\/usr\/bin:\/sbin:\/bin"/u,
      );
      expect(rootEntry).toContain("/usr/bin/realpath");
      expect(rootEntry).toContain("/usr/bin/stat");
    }
    expect(runtimePreparer).toContain(
      "prepare_release_require_fixed_root_command_boundary",
    );
    expect(hostActivator).toContain(
      "activate_host_release_require_cli_bootstrap_directory",
    );
    expect(governancePublicationStateMachine).toContain(
      "governance_require_cli_command_boundary",
    );
    for (const artifact of [
      ".next/BUILD_ID",
      ".next/required-server-files.json",
      ".next/server/app-paths-manifest.json",
    ]) {
      expect(runtimePreparer).toContain(
        `runuser -u diesel -- test -r "\${release_dir}/${artifact}"`,
      );
    }
    const orchestratorLauncher = [
      "command /usr/bin/env -i \\",
      "  HOME=/root \\",
      "  LANG=C \\",
      "  LC_ALL=C \\",
      '  PATH="${root_system_path}" \\',
      "  /usr/bin/bash --noprofile --norc -- \\",
      '    "${orchestrator_path}" "${release_id}" "${candidate_path}"',
    ].join("\n");
    const orchestratorLauncherIndex = deploymentRunbook.indexOf(
      orchestratorLauncher,
    );
    const normalPathFenceStart = deploymentRunbook.lastIndexOf(
      "```bash\n",
      orchestratorLauncherIndex,
    );
    const normalPathFenceEnd = deploymentRunbook.indexOf(
      "\n```",
      orchestratorLauncherIndex,
    );
    const normalPathBlock = deploymentRunbook.slice(
      normalPathFenceStart,
      normalPathFenceEnd,
    );
    const buildIndex = runtimePreparer.indexOf("systemd-run \\");
    const buildScriptIndex = runtimePreparer.indexOf(
      "/usr/bin/bash scripts/deploy/build-release.sh",
      buildIndex,
    );
    const quiescenceIndex = runtimePreparer.indexOf(
      "prepare_release_quiesce_build_unit",
      buildScriptIndex,
    );
    const freezeIndex = runtimePreparer.indexOf(
      "# Revoke the build identity's directory and file write permissions",
    );
    const runtimeEnvironmentLinkIndex = runtimePreparer.indexOf(
      'ln -s "${environment_path}" "${release_dir}/.env.production.local"',
      buildIndex,
    );
    const nextReadProbeIndex = runtimePreparer.indexOf(
      'runuser -u diesel -- test -r "${release_dir}/.next/BUILD_ID"',
    );
    const deployReadyIndex = runtimePreparer.indexOf(
      'finalize "${release_id}" .build-complete .deploy-ready',
    );
    const preserveBuildEvidenceIndex = runtimePreparer.indexOf(
      "PREPARE_RELEASE_PRESERVE_BUILD_ARTIFACTS=1",
    );
    const firstDurabilityReadyIndex = runtimePreparer.indexOf(
      'check-ready "${release_id}" .build-complete .deploy-ready',
      deployReadyIndex,
    );
    const persistCandidateIndex = runtimePreparer.indexOf(
      "prepare_release_persist_candidate \\",
      firstDurabilityReadyIndex,
    );
    const durableCandidateMetadataIndex = runtimePreparer.indexOf(
      '"durable target release"',
      persistCandidateIndex,
    );
    const secondDurabilityReadyIndex = runtimePreparer.indexOf(
      'check-ready "${release_id}" .build-complete .deploy-ready',
      firstDurabilityReadyIndex + 1,
    );
    const allowBuildEvidenceCleanupIndex = runtimePreparer.indexOf(
      "PREPARE_RELEASE_PRESERVE_BUILD_ARTIFACTS=0",
      secondDurabilityReadyIndex,
    );
    expect(orchestratorLauncherIndex).toBeGreaterThanOrEqual(0);
    expect(normalPathFenceStart).toBeGreaterThanOrEqual(0);
    expect(normalPathFenceEnd).toBeGreaterThan(orchestratorLauncherIndex);
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(buildScriptIndex).toBeGreaterThan(buildIndex);
    expect(quiescenceIndex).toBeGreaterThan(buildScriptIndex);
    expect(freezeIndex).toBeGreaterThan(quiescenceIndex);
    expect(runtimeEnvironmentLinkIndex).toBeGreaterThan(buildScriptIndex);
    expect(deploymentRunbook).toContain("groupadd --system diesel-build");
    expect(deploymentRunbook).toContain(
      "useradd --system --gid diesel-build",
    );
    expect(deploymentRunbook).not.toContain(
      'chown -R diesel-build:diesel "${release_dir}"',
    );
    expect(deploymentRunbook).not.toContain(
      'chown -hR root:diesel-build "${release_dir}"',
    );
    expect(runtimePreparer).toContain(
      '"${build_workspace}/node_modules" "${build_workspace}/.next"',
    );
    expect(runtimePreparer).toContain(
      'cp -a "${release_dir}/." "${build_workspace}/"',
    );
    expect(runtimePreparer).toContain(
      'chown -hR diesel-build:diesel-build "${build_workspace}"',
    );
    expect(runtimePreparer).toContain("--reflink=never");
    expect(runtimePreparer).not.toContain(
      'mv "${build_workspace}/${build_output}" "${release_dir}/${build_output}"',
    );
    expect(`${deploymentRunbook}\n${runtimePreparer}`).not.toContain(
      "npm_config_registry",
    );
    expect(`${deploymentRunbook}\n${runtimePreparer}`).not.toContain(
      "pnpm config set registry",
    );
    expect(nextReadProbeIndex).toBeGreaterThan(buildIndex);
    expect(deployReadyIndex).toBeGreaterThan(nextReadProbeIndex);
    expect(preserveBuildEvidenceIndex).toBeGreaterThan(freezeIndex);
    expect(firstDurabilityReadyIndex).toBeGreaterThan(deployReadyIndex);
    expect(persistCandidateIndex).toBeGreaterThan(firstDurabilityReadyIndex);
    expect(durableCandidateMetadataIndex).toBeGreaterThan(
      persistCandidateIndex,
    );
    expect(secondDurabilityReadyIndex).toBeGreaterThan(
      durableCandidateMetadataIndex,
    );
    expect(allowBuildEvidenceCleanupIndex).toBeGreaterThan(
      secondDurabilityReadyIndex,
    );
    expect(runtimePreparer).toContain(
      'if ! sync -f -- "${release_dir}" "${release_root}" "${deploy_root}"; then',
    );
    expect(runtimePreparer).toContain(
      'const rootDevice = lstatSync(root, { bigint: true }).dev;',
    );
    expect(runtimePreparer).toContain(
      'if (metadata.dev !== rootDevice)',
    );
    expect(runtimePreparer).toContain(
      [
        '    "${build_marker}" \\',
        '    "${ready_marker}" \\',
        '    "${release_dir}/node_modules" \\',
        '    "${release_dir}/.next" \\',
        '    "${release_dir}" \\',
        '    "${release_root}" \\',
        '    "${deploy_root}"; then',
      ].join("\n"),
    );
    expect(normalPathBlock).toContain(orchestratorLauncher);
    expect(normalPathBlock).toContain(
      'candidate_path="/opt/diesel/release-inputs/${release_id}/env.production.local"',
    );
    expect(normalPathBlock).toContain(
      'orchestrator_path="${release_dir}/scripts/deploy/host-release-orchestrator.sh"',
    );
    expect(normalPathBlock).not.toContain("trap ");
    expect(normalPathBlock).not.toContain("exec 8<>");
    expect(normalPathBlock).not.toContain("--begin-activation");
    expect(normalPathBlock).not.toContain("release-publication-controller.sh");
    const stagedLedgerProofIndex = runtimePreparer.indexOf(
      "prepare_release_require_staged_or_normalized_executable \\",
    );
    const releaseNormalizationIndex = runtimePreparer.indexOf(
      'chown -hR root:diesel "${release_dir}"',
      stagedLedgerProofIndex,
    );
    const normalizedLedgerProofIndex = runtimePreparer.indexOf(
      '"normalized versioned host activation ledger"',
      releaseNormalizationIndex,
    );
    expect(stagedLedgerProofIndex).toBeGreaterThanOrEqual(0);
    expect(releaseNormalizationIndex).toBeGreaterThan(stagedLedgerProofIndex);
    expect(normalizedLedgerProofIndex).toBeGreaterThan(
      releaseNormalizationIndex,
    );
    expect(deploymentRunbook.split(orchestratorLauncher)).toHaveLength(2);
    expect(deploymentRunbook).not.toContain("touch .deploy-ready");
    expect(deploymentRunbook).not.toContain(
      'mv "${build_workspace}/${build_output}" "${release_dir}/${build_output}"',
    );
    expect(runtimePreparer).toContain(
      'build_workspace_root="${deploy_root}/build-workspaces"',
    );
    expect(runtimePreparer).toContain(
      'build_home="${build_root}/${release_id}"',
    );
    expect(runtimePreparer).toContain(
      "prepare_release_require_identity_boundary",
    );
    for (const fixedRootCommand of [
      '"findmnt:/usr/bin/findmnt"',
      '"flock:/usr/bin/flock"',
      '"systemctl:/usr/bin/systemctl"',
      '"systemd:/usr/bin/systemd"',
      '"systemd-run:/usr/bin/systemd-run"',
    ]) {
      expect(runtimePreparer).toContain(fixedRootCommand);
    }
    expect(runtimePreparer).toContain(
      'export PATH="/usr/sbin:/usr/bin:/sbin:/bin"',
    );
    expect(runtimePreparer).toContain(
      'HOME="${build_home}"',
    );
    expect(runtimePreparer).toContain(
      'BUILD_HOME="${build_home}"',
    );
    expect(runtimePreparer).toContain("COREPACK_ENABLE_DOWNLOAD_PROMPT=0");
    expect(runtimePreparer).toContain(
      'trap \'prepare_release_cleanup_on_exit "$?"\' EXIT',
    );
    expect(runtimePreparer).toContain(
      'install -d -m 0710 -o root -g diesel-build "${build_workspace_root}"',
    );
    expect(runtimePreparer).toContain(
      'prepare_release_require_directory "${build_root}" "root:diesel-build:710"',
    );
    expect(runtimePreparer).toContain("--service-type=exec");
    expect(runtimePreparer).toContain("--remain-after-exit");
    expect(runtimePreparer).toContain("--property=KillMode=control-group");
    expect(runtimePreparer).toContain("--property=RuntimeMaxSec=45min");
    expect(runtimePreparer).toContain("--property=TimeoutStopSec=30s");
    expect(runtimePreparer).toContain("--property=Restart=no");
    expect(runtimePreparer).toContain("--property=Delegate=no");
    expect(runtimePreparer).toContain("--property=NoNewPrivileges=yes");
    expect(runtimePreparer).toContain("--property=ProtectControlGroups=yes");
    for (const verifiedProperty of [
      "Type",
      "KillSignal",
      "FinalKillSignal",
      "SendSIGKILL",
      "RuntimeMaxUSec",
      "TimeoutStopUSec",
      "UMask",
      "NoNewPrivileges",
      "ProtectControlGroups",
    ]) {
      expect(runtimePreparer).toContain(`--property=${verifiedProperty}`);
    }
    expect(runtimePreparer).toContain(
      "systemctl show --property=Version --value",
    );
    expect(runtimePreparer).toContain("duplicate unit property");
    expect(runtimePreparer).toContain("systemctl show --all --no-pager");
    expect(runtimePreparer).toContain("PREPARE_RELEASE_UNIT_RESULT");
    expect(runtimePreparer).toContain("PREPARE_RELEASE_UNIT_EXEC_MAIN_CODE");
    expect(runtimePreparer).toContain("PREPARE_RELEASE_UNIT_EXEC_MAIN_STATUS");
    expect(runtimePreparer).not.toContain(
      '"${PREPARE_RELEASE_UNIT_ACTIVE_STATE}" == inactive',
    );
    expect(runtimePreparer).toContain("prepare_release_prove_build_quiescent");
    expect(runtimePreparer).toContain("flock -n 9");
    expect(runtimePreparer).toContain(
      'prepare_release_require_file "${build_lock_path}" "root:root:600"',
    );
    expect(runtimePreparer).not.toContain("runuser -u diesel-build");
    expect(runtimePreparer).not.toContain("systemd-run --wait");
    expect(runtimePreparer).not.toContain("systemd-run --collect");
    expect(runtimePreparer).toContain(
      'input_manifest_script="${release_dir}/scripts/deploy/release-input-manifest.mjs"',
    );
    expect(runtimePreparer).toContain(
      'next_environment="${release_dir}/next-env.d.ts"',
    );
    expect(runtimePreparer).toContain(
      [
        'cp -P --preserve=mode --reflink=never -- \\',
        '    "${next_environment}" "${build_workspace}/next-env.d.ts"',
      ].join("\n"),
    );
    const rootNextEnvironmentRestoreIndex = runtimePreparer.indexOf(
      '"${next_environment}" "${build_workspace}/next-env.d.ts"',
    );
    expect(rootNextEnvironmentRestoreIndex).toBeGreaterThan(
      runtimePreparer.indexOf(
        'prepare_release_run_build_unit \\\n    "${release_id}"',
      ),
    );
    expect(rootNextEnvironmentRestoreIndex).toBeLessThan(
      runtimePreparer.indexOf(
        '"${node_binary}" "${input_manifest_script}"',
      ),
    );
    expect(runtimePreparer).toContain(
      [
        'env -i HOME=/root PATH="${root_child_path}" \\',
        '      "${node_binary}" "${input_manifest_script}"',
      ].join("\n"),
    );
    expect(runtimePreparer).toContain(
      [
        'env -i HOME=/root PATH="${root_child_path}" \\',
        '      "${node_binary}" "${artifact_script}"',
      ].join("\n"),
    );
    expect(runtimePreparer).toContain(
      'cmp --silent -- \\\n    "${input_manifest}" "${build_workspace}/.release-input-manifest.json"',
    );
    expect(runtimePreparer).not.toContain(
      '"${node_binary}" scripts/deploy/release-artifact-manifest.mjs',
    );
    expect(runtimePreparer).toContain(
      'prepare_release_require_file \\\n    "${release_dir}/.deploy-ready" "root:diesel:640" no',
    );
    expect(artifactManifest).toContain(
      'const BUILD_MARKER_FORMAT = "diesel-build-complete-v2"',
    );
    expect(artifactManifest).toContain(
      'const READY_MARKER_FORMAT = "diesel-deploy-ready-v1"',
    );
    expect(artifactManifest).toContain(
      'fail("Deploy-ready verification must run as the immutable release owner.")',
    );
    expect(artifactManifest).toContain(
      'const CONTROLLER_DIRECTORY_MODE = 0o755n',
    );
    expect(artifactManifest).toContain(
      'fail("Production check-ready must run as the root controller identity.")',
    );
    expect(artifactManifest).toContain(
      '"Production check-ready requires root:<runtime-group> immutable ownership and a distinct non-root runtime identity."',
    );
    expect(artifactManifest).toContain(
      'fail("Shared runtime directory changed while links were verified.")',
    );
    expect(governancePublicationStateMachine).toContain(
      "scripts/db/export-governance-snapshot.ts",
    );
    expect(governancePublicationStateMachine).toContain(
      '--output="${output_path}"',
    );
    expect(governancePublicationStateMachine).toContain(
      "scripts/db/restore-governance-snapshot.ts",
    );
    expect(governancePublicationStateMachine).toContain(
      '--input="${snapshot_path}" --sha256="${snapshot_sha256}"',
    );
    expect(deploymentRunbook).toContain(
      '"${release_dir}/scripts/db/with-governance-maintenance-lock.ts" \\',
    );
    expect(deploymentRunbook).toContain("--database-env-file=");
    expect(deploymentRunbook).not.toContain(
      "scripts/db/with-governance-maintenance-lock.ts -- bash -s",
    );
    expect(governancePublicationStateMachine).toContain(
      "trap 'restore_governance_on_failure \"$?\"' ERR",
    );
    expect(governancePublicationStateMachine).toContain(
      "trap 'restore_governance_on_failure 130' INT",
    );
    expect(governancePublicationStateMachine).toContain(
      "trap 'restore_governance_on_failure 143' TERM",
    );
    expect(governancePublicationStateMachine).toContain(
      "trap 'restore_governance_on_failure 129' HUP",
    );
    expect(governancePublicationStateMachine).toContain(
      "trap 'restore_governance_on_failure \"$?\"' EXIT",
    );
    expect(governancePublicationStateMachine).toContain(
      "trap - ERR INT TERM HUP EXIT",
    );
    expect(governancePublicationStateMachine).toContain(
      'recovery_marker="${snapshot_directory}/RECOVERY_REQUIRED"',
    );
    expect(governancePublicationStateMachine).toContain(
      'publish_commit_marker="${snapshot_directory}/PUBLISH_COMMITTED"',
    );
    expect(governancePublicationStateMachine).toContain(
      'publish_finalized_marker="${snapshot_directory}/PUBLISH_FINALIZED"',
    );
    expect(governancePublicationStateMachine).toContain(
      'rehearsal_path="${snapshot_directory}/governance-after-rehearsal.json"',
    );
    expect(governancePublicationStateMachine).toContain(
      'expected_snapshot_path="${deploy_root}/backups/${expected_release_id}/governance-before.json"',
    );
    expect(deploymentRunbook).toContain("governance_env=(\n  /usr/bin/env -i");
    expect(deploymentRunbook).toContain(
      "  DATABASE_MODE=postgres\n  DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8\n  release_id=\"${release_id}\"",
    );
    expect(governancePublicationStateMachine).toContain(
      "-name RECOVERY_REQUIRED -o \\\n      -name HOST_ROLLBACK_REQUIRED -o -name PUBLISH_COMMITTED",
    );
    expect(governancePublicationStateMachine).toContain(
      'find -- "${backups_root}" -name HOST_ROLLBACK_COMPLETED -print',
    );
    expect(governancePublicationStateMachine).toContain(
      'public_validation_script="${snapshot_directory}/validate-public-governance.sh"',
    );
    expect(governancePublicationStateMachine).toContain(
      'source_public_validation_script="${release_dir}/scripts/deploy/validate-public-governance.sh"',
    );
    expect(governancePublicationStateMachine).toContain(
      'governance_run_isolated_saved_public_validator \\\n    "${public_validation_script}" "${expected_release_id}"',
    );
    expect(governancePublicationStateMachine).toContain(
      "env -i HOME=/var/lib/diesel PATH=\"${PATH}\" bash -s -- \"$@\"",
    );
    expect(governancePublicationStateMachine).toContain(
      "scripts/db/assert-governance-maintenance-lock.ts",
    );
    expect(governancePublicationStateMachine).toContain(
      'governance_fsync_paths \\\n    "${public_validation_script}" "${snapshot_directory}"',
    );
    expect(deploymentRunbook).not.toContain(
      "GOVERNANCE_PUBLIC_VALIDATION_FUNCTION_BEGIN",
    );
    expect(deploymentRunbook).not.toContain(
      "GOVERNANCE_PUBLIC_VALIDATION_FUNCTION_END",
    );
    expect(publicGovernanceValidator).toContain(
      '"${public_origin}/api/countries"',
    );
    expect(publicGovernanceValidator).toContain("countries.length !== 178");
    expect(publicGovernanceValidator).toContain(
      '"${public_origin}/countries/${iso3}"',
    );
    expect(publicGovernanceValidator).toContain(
      '"${public_origin}/api/countries/${iso3}?asOf=2026-08-11"',
    );
    expect(publicGovernanceValidator).toContain(
      'body.asOf !== "2026-08-11"',
    );
    expect(publicGovernanceValidator).toContain(
      'response_status="$(curl "${curl_common[@]}" --output /dev/null',
    );
    expect(publicGovernanceValidator).toContain(
      'test "${response_status}" = "200"',
    );
    expect(publicGovernanceValidator).toContain(
      'assert_country_detail URY 1 "Vehicle-emission homologation procedure V5" 2023-05-14 2025-11-13 UY-NATIONAL 10000000-0000-4000-8000-000000000561 10000000-0000-4000-8000-000000000562',
    );
    expect(publicGovernanceValidator).toContain(
      "curl_common=(\n  --disable",
    );
    expect(publicGovernanceValidator).toContain("--max-filesize 4194304");
    expect(publicGovernanceValidator).toContain("--noproxy '*'");
    expect(publicGovernanceValidator).toContain("--proto '=https'");

    const immutableLockCreationIndex = deploymentRunbook.indexOf(
      '(umask 077; set -o noclobber; : >"${immutable_lock_path}")',
    );
    const reconcileStart = hostReleaseOrchestrator.indexOf(
      "host_release_orchestrator_reconcile() {",
    );
    const reconcileEnd = hostReleaseOrchestrator.indexOf(
      "\nhost_release_orchestrator_run_main() {",
      reconcileStart,
    );
    const reconcile = hostReleaseOrchestrator.slice(reconcileStart, reconcileEnd);
    const acquireIndex = reconcile.indexOf(
      "host_release_orchestrator_acquire_lock",
    );
    const persistBasisIndex = reconcile.indexOf(
      "host_release_orchestrator_persist_basis",
      acquireIndex,
    );
    const rollbackArmedIndex = reconcile.indexOf(
      "HOST_RELEASE_ORCHESTRATOR_ROLLBACK_ARMED=1",
      persistBasisIndex,
    );
    const beginIndex = reconcile.indexOf(
      "host_release_orchestrator_begin_activation",
      rollbackArmedIndex,
    );
    const strictStateIndex = reconcile.indexOf(
      "host_release_orchestrator_read_strict_state",
      beginIndex,
    );
    const installCandidateIndex = reconcile.indexOf(
      "host_release_orchestrator_install_candidate",
      strictStateIndex,
    );
    const environmentReadbackIndex = reconcile.indexOf(
      "host_release_orchestrator_readback_environment",
      installCandidateIndex,
    );
    const runControllerIndex = reconcile.indexOf(
      "host_release_orchestrator_run_controller",
      environmentReadbackIndex,
    );
    const mainStart = hostReleaseOrchestrator.indexOf(
      "host_release_orchestrator_run_main() {",
    );
    const trapInstallIndex = hostReleaseOrchestrator.indexOf(
      "host_release_orchestrator_install_traps",
      mainStart,
    );
    const reconcileCallIndex = hostReleaseOrchestrator.indexOf(
      "host_release_orchestrator_reconcile",
      trapInstallIndex,
    );
    expect(immutableLockCreationIndex).toBeGreaterThanOrEqual(0);
    expect(reconcileStart).toBeGreaterThanOrEqual(0);
    expect(reconcileEnd).toBeGreaterThan(reconcileStart);
    expect(acquireIndex).toBeGreaterThanOrEqual(0);
    expect(persistBasisIndex).toBeGreaterThan(acquireIndex);
    expect(rollbackArmedIndex).toBeGreaterThan(persistBasisIndex);
    expect(beginIndex).toBeGreaterThan(rollbackArmedIndex);
    expect(strictStateIndex).toBeGreaterThan(beginIndex);
    expect(installCandidateIndex).toBeGreaterThan(strictStateIndex);
    expect(environmentReadbackIndex).toBeGreaterThan(installCandidateIndex);
    expect(runControllerIndex).toBeGreaterThan(environmentReadbackIndex);
    expect(trapInstallIndex).toBeGreaterThan(mainStart);
    expect(reconcileCallIndex).toBeGreaterThan(trapInstallIndex);
    expect(hostReleaseOrchestrator).toContain(
      'exec 8<>"${HOST_RELEASE_ORCHESTRATOR_LOCK_PATH}"',
    );
    expect(hostReleaseOrchestrator).toContain(
      "export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8",
    );
    expect(hostReleaseOrchestrator).toContain(
      '"${HOST_RELEASE_ORCHESTRATOR_STATE_DIR}" || return 70',
    );
    expect(hostReleaseOrchestrator).toContain(
      '"${HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_BACKUP}" \\',
    );
    expect(hostReleaseOrchestrator).toContain(
      '"${HOST_RELEASE_ORCHESTRATOR_NGINX_PRIMARY_BACKUP}" \\',
    );
    expect(hostReleaseOrchestrator).toContain(
      '"${HOST_RELEASE_ORCHESTRATOR_NGINX_ALTERNATE_BACKUP}" \\',
    );
    expect(hostReleaseOrchestrator).toContain(
      "host_release_orchestrator_fsync_paths \\",
    );
    expect(deploymentRunbook).not.toContain(
      'cp "${release_dir}/deploy/nginx/jamesky.site.conf" /etc/nginx/sites-available/jamesky.site',
    );
    expect(deploymentRunbook).not.toContain(
      "mv -Tf /opt/diesel/current.next /opt/diesel/current",
    );
    expect(deploymentRunbook).not.toContain(
      "if pm2 describe diesel-demo 8>&-",
    );
    expect(deploymentRunbook).not.toMatch(
      /^\s*pm2 start \/opt\/diesel\/current\/deploy\/ecosystem\.config\.cjs 8>&-$/gmu,
    );
    expect(deploymentRunbook).not.toMatch(/^\s*pm2 save 8>&-$/gmu);

    const activationReadyIndex = hostActivator.indexOf(
      'check-ready "${release_id}" .build-complete .deploy-ready',
    );
    const activationCleanupTrapIndex = hostActivator.indexOf(
      "trap activate_host_release_cleanup EXIT",
      activationReadyIndex,
    );
    const activationNginxPrimaryStageIndex = hostActivator.indexOf(
      [
        "  install -m 0644 -o root -g root -- \\",
        '    "${nginx_primary_source}" \\',
        '    "${activate_host_release_nginx_primary_stage}" 8>&-',
      ].join("\n"),
      activationCleanupTrapIndex,
    );
    const activationNginxAlternateStageIndex = hostActivator.indexOf(
      [
        "  install -m 0644 -o root -g root -- \\",
        '    "${nginx_alternate_source}" \\',
        '    "${activate_host_release_nginx_alternate_stage}" 8>&-',
      ].join("\n"),
      activationNginxPrimaryStageIndex,
    );
    const activationStagedPrimaryValidationIndex = hostActivator.indexOf(
      [
        "  host_activation_ledger_require_file \\",
        '    "${activate_host_release_nginx_primary_stage}" "root:root:644" \\',
        '    "staged primary Nginx configuration"',
      ].join("\n"),
      activationNginxAlternateStageIndex,
    );
    const activationStagedAlternateValidationIndex = hostActivator.indexOf(
      [
        "  host_activation_ledger_require_file \\",
        '    "${activate_host_release_nginx_alternate_stage}" "root:root:644" \\',
        '    "staged alternate Nginx configuration"',
      ].join("\n"),
      activationStagedPrimaryValidationIndex,
    );
    const activationOfflineNginxValidationIndex = hostActivator.indexOf(
      [
        "  rollback_validate_nginx_backups \\",
        '    "${activate_host_release_nginx_primary_stage}" \\',
        '    "${activate_host_release_nginx_alternate_stage}" 8>&-',
      ].join("\n"),
      activationStagedAlternateValidationIndex,
    );
    const activationPrewriteLockIndex = hostActivator.indexOf(
      'host_activation_ledger_require_lifecycle_lock "${deploy_root}"',
      activationOfflineNginxValidationIndex,
    );
    const activationPrewritePendingIndex = hostActivator.indexOf(
      [
        "  host_activation_ledger_require_pending \\",
        '    "${release_id}" "${deploy_root}" "${node_binary}"',
      ].join("\n"),
      activationPrewriteLockIndex,
    );
    const activationPrewriteDirectoryValidationIndex = hostActivator.indexOf(
      [
        "  host_activation_ledger_require_directory \\",
        '    "${nginx_sites_root}" "root:root:755" \\',
        '    "Nginx sites directory"',
      ].join("\n"),
      activationPrewritePendingIndex,
    );
    const activationPrewritePrimaryValidationIndex = hostActivator.indexOf(
      [
        "  host_activation_ledger_require_file \\",
        '    "${nginx_primary_path}" "root:root:644" \\',
        '    "live primary Nginx configuration"',
      ].join("\n"),
      activationPrewriteDirectoryValidationIndex,
    );
    const activationPrewriteAlternateValidationIndex = hostActivator.indexOf(
      [
        "  host_activation_ledger_require_file \\",
        '    "${nginx_alternate_path}" "root:root:644" \\',
        '    "live alternate Nginx configuration"',
      ].join("\n"),
      activationPrewritePrimaryValidationIndex,
    );
    const activationPrewriteBasisIndex = hostActivator.indexOf(
      '"live Nginx state changed before atomic installation"',
      activationPrewriteAlternateValidationIndex,
    );
    const activationPrimaryNginxRenameIndex = hostActivator.indexOf(
      [
        "  mv -Tf -- \\",
        '    "${activate_host_release_nginx_primary_stage}" \\',
        '    "${nginx_primary_path}" 8>&-',
      ].join("\n"),
      activationPrewriteBasisIndex,
    );
    const activationAlternateNginxRenameIndex = hostActivator.indexOf(
      [
        "  mv -Tf -- \\",
        '    "${activate_host_release_nginx_alternate_stage}" \\',
        '    "${nginx_alternate_path}" 8>&-',
      ].join("\n"),
      activationPrimaryNginxRenameIndex,
    );
    const activationInstalledPrimaryValidationIndex = hostActivator.indexOf(
      [
        "  host_activation_ledger_require_file \\",
        '    "${nginx_primary_path}" "root:root:644" \\',
        '    "installed primary Nginx configuration"',
      ].join("\n"),
      activationAlternateNginxRenameIndex,
    );
    const activationInstalledAlternateValidationIndex = hostActivator.indexOf(
      [
        "  host_activation_ledger_require_file \\",
        '    "${nginx_alternate_path}" "root:root:644" \\',
        '    "installed alternate Nginx configuration"',
      ].join("\n"),
      activationInstalledPrimaryValidationIndex,
    );
    const activationInstalledComparisonIndex = hostActivator.indexOf(
      '"installed Nginx configuration does not match the target release"',
      activationInstalledAlternateValidationIndex,
    );
    const activationNginxValidationIndex = hostActivator.indexOf(
      "nginx -t 8>&-",
      activationInstalledComparisonIndex,
    );
    const activationNginxDurabilityIndex = hostActivator.indexOf(
      "rollback_fsync_paths \\",
      activationNginxValidationIndex,
    );
    const activationCurrentLinkIndex = hostActivator.indexOf(
      'ln -s -- "${release_dir}" "${activate_host_release_current_next}" 8>&-',
      activationNginxDurabilityIndex,
    );
    const activationCurrentSwitchIndex = hostActivator.indexOf(
      'mv -Tf -- "${activate_host_release_current_next}" "${current_link}" 8>&-',
      activationCurrentLinkIndex,
    );
    const activationCurrentDurabilityIndex = hostActivator.indexOf(
      'rollback_fsync_paths "${node_binary}" "${deploy_root}" 8>&-',
      activationCurrentSwitchIndex,
    );
    const activationPm2StartIndex = hostActivator.indexOf(
      '"${pm2_command[@]}" start "${current_ecosystem_path}" 8>&-',
      activationCurrentDurabilityIndex,
    );
    const activationProcessValidationIndex = hostActivator.indexOf(
      "rollback_validate_pm2_process \\",
      activationPm2StartIndex,
    );
    const activationReadinessIndex = hostActivator.indexOf(
      "http://127.0.0.1:8788/api/health/ready 8>&-",
      activationProcessValidationIndex,
    );
    const activationPm2SaveIndex = hostActivator.indexOf(
      '"${pm2_command[@]}" save 8>&-',
      activationReadinessIndex,
    );
    const activationPm2PersistenceIndex = hostActivator.indexOf(
      "rollback_validate_durable_pm2_state \\",
      activationPm2SaveIndex,
    );
    const activationPm2EnabledReadbackIndex = hostActivator.indexOf(
      '"${systemctl_command}" is-enabled --quiet pm2-root 8>&-',
      activationPm2PersistenceIndex,
    );
    const activationPm2ActiveReadbackIndex = hostActivator.indexOf(
      '"${systemctl_command}" is-active --quiet pm2-root 8>&-',
      activationPm2EnabledReadbackIndex,
    );
    const activationNginxReloadIndex = hostActivator.indexOf(
      '"${systemctl_command}" reload nginx 8>&-',
      activationPm2ActiveReadbackIndex,
    );
    const ledgerFileValidatorStart = hostActivationLedger.indexOf(
      "host_activation_ledger_require_file() {",
    );
    const ledgerFileValidatorEnd = hostActivationLedger.indexOf(
      "\n}\n",
      ledgerFileValidatorStart,
    );
    const ledgerFileValidator = hostActivationLedger.slice(
      ledgerFileValidatorStart,
      ledgerFileValidatorEnd,
    );
    expect(hostActivator).toContain(
      [
        "if source -- \\",
        '    "${activate_host_release_script_directory}/rollback-host-release.sh"; then',
      ].join("\n"),
    );
    expect(hostActivator).toContain('if [[ "$#" -ne 1 ]]');
    expect(hostActivator).toContain(
      'if [[ "$#" -ne 9 && "$#" -ne 12 ]]',
    );
    expect(hostActivator).toContain(
      ['    "/opt/diesel" \\', '    "/etc/nginx/sites-available" \\'].join(
        "\n",
      ),
    );
    expect(hostActivator).toContain(
      'if [[ "${DIESEL_RELEASE_LIFECYCLE_LOCK_FD:-}" != 8 ]]',
    );
    expect(hostActivator).toContain(
      'local activation_script="${release_dir}/scripts/deploy/activate-host-release.sh"',
    );
    expect(hostActivator).toContain(
      '"host activation CLI must execute the target release entry"',
    );
    expect(
      hostActivator.match(/host_activation_ledger_require_pending/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(5);
    expect(hostActivator).not.toContain("host_activation_ledger_transition");
    expect(hostActivator).not.toContain("host_activation_ledger_begin");
    expect(hostActivator).not.toContain(
      'cp -- "${nginx_primary_source}" "${nginx_primary_path}"',
    );
    expect(hostActivator).not.toContain(
      'cp -- "${nginx_alternate_source}" "${nginx_alternate_path}"',
    );
    expect(ledgerFileValidatorStart).toBeGreaterThanOrEqual(0);
    expect(ledgerFileValidatorEnd).toBeGreaterThan(ledgerFileValidatorStart);
    expect(ledgerFileValidator).toContain(
      'canonical_path="$(realpath -- "${path}")"',
    );
    expect(ledgerFileValidator).toContain(
      'actual_metadata="$(stat -c \'%U:%G:%a\' -- "${path}")"',
    );
    expect(ledgerFileValidator).toContain(
      'link_count="$(stat -c \'%h\' -- "${path}")"',
    );
    expect(ledgerFileValidator).toContain('[[ "${link_count}" != "1" ]]');
    expect(activationReadyIndex).toBeGreaterThanOrEqual(0);
    expect(activationCleanupTrapIndex).toBeGreaterThan(activationReadyIndex);
    expect(activationNginxPrimaryStageIndex).toBeGreaterThan(
      activationCleanupTrapIndex,
    );
    expect(activationNginxAlternateStageIndex).toBeGreaterThan(
      activationNginxPrimaryStageIndex,
    );
    expect(activationStagedPrimaryValidationIndex).toBeGreaterThan(
      activationNginxAlternateStageIndex,
    );
    expect(activationStagedAlternateValidationIndex).toBeGreaterThan(
      activationStagedPrimaryValidationIndex,
    );
    expect(activationOfflineNginxValidationIndex).toBeGreaterThan(
      activationStagedAlternateValidationIndex,
    );
    expect(activationPrewriteLockIndex).toBeGreaterThan(
      activationOfflineNginxValidationIndex,
    );
    expect(activationPrewritePendingIndex).toBeGreaterThan(
      activationPrewriteLockIndex,
    );
    expect(activationPrewriteDirectoryValidationIndex).toBeGreaterThan(
      activationPrewritePendingIndex,
    );
    expect(activationPrewritePrimaryValidationIndex).toBeGreaterThan(
      activationPrewriteDirectoryValidationIndex,
    );
    expect(activationPrewriteAlternateValidationIndex).toBeGreaterThan(
      activationPrewritePrimaryValidationIndex,
    );
    expect(activationPrewriteBasisIndex).toBeGreaterThan(
      activationPrewriteAlternateValidationIndex,
    );
    expect(activationPrimaryNginxRenameIndex).toBeGreaterThan(
      activationPrewriteBasisIndex,
    );
    expect(activationAlternateNginxRenameIndex).toBeGreaterThan(
      activationPrimaryNginxRenameIndex,
    );
    expect(activationInstalledPrimaryValidationIndex).toBeGreaterThan(
      activationAlternateNginxRenameIndex,
    );
    expect(activationInstalledAlternateValidationIndex).toBeGreaterThan(
      activationInstalledPrimaryValidationIndex,
    );
    expect(activationInstalledComparisonIndex).toBeGreaterThan(
      activationInstalledAlternateValidationIndex,
    );
    expect(activationNginxValidationIndex).toBeGreaterThan(
      activationInstalledComparisonIndex,
    );
    expect(activationNginxDurabilityIndex).toBeGreaterThan(
      activationNginxValidationIndex,
    );
    expect(activationCurrentLinkIndex).toBeGreaterThan(
      activationNginxDurabilityIndex,
    );
    expect(activationCleanupTrapIndex).toBeLessThan(activationCurrentLinkIndex);
    expect(activationCurrentSwitchIndex).toBeGreaterThan(
      activationCurrentLinkIndex,
    );
    expect(activationCurrentDurabilityIndex).toBeGreaterThan(
      activationCurrentSwitchIndex,
    );
    expect(activationPm2StartIndex).toBeGreaterThan(
      activationCurrentDurabilityIndex,
    );
    expect(activationProcessValidationIndex).toBeGreaterThan(
      activationPm2StartIndex,
    );
    expect(activationReadinessIndex).toBeGreaterThan(
      activationProcessValidationIndex,
    );
    expect(activationPm2SaveIndex).toBeGreaterThan(activationReadinessIndex);
    expect(activationPm2PersistenceIndex).toBeGreaterThan(
      activationPm2SaveIndex,
    );
    expect(activationPm2EnabledReadbackIndex).toBeGreaterThan(
      activationPm2PersistenceIndex,
    );
    expect(activationPm2ActiveReadbackIndex).toBeGreaterThan(
      activationPm2EnabledReadbackIndex,
    );
    expect(activationNginxReloadIndex).toBeGreaterThan(
      activationPm2ActiveReadbackIndex,
    );
    expect(hostActivator).toContain(
      [
        "  env -i \\",
        "    HOME=/root \\",
        '    PATH="${root_child_path}" \\',
        '    APP_VERSION="${release_id}" \\',
        "    NODE_ENV=production \\",
        '    "${pm2_command[@]}" start "${current_ecosystem_path}" 8>&-',
      ].join("\n"),
    );
    expect(hostActivator).toContain(
      "curl --disable --connect-timeout 10 --fail --max-filesize 65536",
    );
    expect(hostActivator).toContain("--noproxy '*' --proto '=http'");
    expect(hostActivator).not.toContain("pm2 reload ");
    expect(hostReleaseOrchestrator).toContain(
      'const { parseEnv } = require("node:util");',
    );
    expect(hostReleaseOrchestrator).toContain(
      'if (protocol !== "postgres:" && protocol !== "postgresql:") throw new Error();',
    );
    expect(runtimeEnvironmentContract).toContain(
      "backup.databaseUrl !== candidate.databaseUrl",
    );
    expect(runtimeEnvironmentContract).toContain(
      "backup.databaseUrl !== live.databaseUrl",
    );
    expect(runtimeEnvironmentContract).toContain(
      "!timingSafeEqual(candidate.bytes, live.bytes)",
    );
    expect(hostReleaseOrchestrator).toContain(
      'process.stderr.write("environment candidate validation failed\\n");',
    );
    expect(hostReleaseOrchestrator).toContain(
      '"production database identity changed during release"',
    );
    expect(deploymentRunbook).toContain(
      "应用 release 不得同时轮换 `DATABASE_URL` 的端点、用户名或凭据",
    );
    const runtimeIdentityIndex = runtimePreparer.indexOf(
      "prepare_release_require_stable_database_identity \\",
    );
    const runtimeRollbackBasisBlock = [
      "prepare_release_fsync_rollback_basis \\",
      '    "${node_binary}" \\',
      '    "${previous_release_file}" \\',
      '    "${environment_backup}" \\',
      '    "${nginx_primary_backup}" \\',
      '    "${nginx_alternate_backup}" \\',
      '    "${deployment_state_dir}" \\',
      '    "${backups_root}" \\',
      '    "${deploy_root}"',
    ].join("\n");
    const runtimeRollbackBasisIndex = runtimePreparer.indexOf(
      runtimeRollbackBasisBlock,
    );
    const runtimeIdentityFsyncIndex = runtimePreparer.indexOf(
      "for (const path of [livePath, sharedRoot])",
    );
    const runtimeSystemdPreflightIndex = runtimePreparer.indexOf(
      'prepare_release_require_systemd_host "${proc_root}"',
      runtimeIdentityIndex,
    );
    expect(runtimePreparer).toContain(
      'const { parseEnv } = require("node:util");',
    );
    expect(runtimePreparer).toContain(
      "backupDatabaseUrl !== liveDatabaseUrl",
    );
    expect(runtimePreparer).toContain(runtimeRollbackBasisBlock);
    expect(runtimePreparer).toContain(
      'process.stderr.write("rollback basis durability proof failed\\n");',
    );
    expect(runtimeIdentityFsyncIndex).toBeGreaterThanOrEqual(0);
    expect(runtimeRollbackBasisIndex).toBeGreaterThanOrEqual(0);
    expect(runtimeIdentityIndex).toBeGreaterThan(runtimeRollbackBasisIndex);
    expect(runtimeIdentityIndex).toBeGreaterThan(runtimeIdentityFsyncIndex);
    expect(runtimeSystemdPreflightIndex).toBeGreaterThan(runtimeIdentityIndex);
    expect(hostReleaseOrchestrator).toContain(
      "trap 'host_release_orchestrator_handle_exit \"$?\"' EXIT",
    );
    expect(hostReleaseOrchestrator).toContain('"find:/usr/bin/find"');
    expect(hostReleaseOrchestrator).toContain(
      "if (( ++HOST_RELEASE_ORCHESTRATOR_SIGNAL_FORWARD_CLAIMS == 1 )); then",
    );
    expect(hostReleaseOrchestrator).toContain(
      '"${HOST_RELEASE_ORCHESTRATOR_RELEASE_ID}" --abort-if-uncommitted',
    );
    const abortFunctionStart = hostReleaseOrchestrator.indexOf(
      "host_release_orchestrator_abort_once() {",
    );
    const abortFunctionClosingBrace = hostReleaseOrchestrator.indexOf(
      "\n}\n",
      abortFunctionStart,
    );
    const abortFunctionEnd = abortFunctionClosingBrace < 0
      ? -1
      : abortFunctionClosingBrace + "\n}\n".length;
    const abortFunction = hostReleaseOrchestrator.slice(
      abortFunctionStart,
      abortFunctionEnd,
    );
    const abortCloseLockIndex = abortFunction.indexOf(
      "host_release_orchestrator_close_lock",
    );
    const abortRollbackIndex = abortFunction.indexOf(
      "host_release_orchestrator_run_direct_abort",
      abortCloseLockIndex,
    );
    expect(abortFunctionStart).toBeGreaterThanOrEqual(0);
    expect(abortFunctionEnd).toBeGreaterThan(abortFunctionStart);
    expect(abortCloseLockIndex).toBeGreaterThanOrEqual(0);
    expect(abortRollbackIndex).toBeGreaterThan(abortCloseLockIndex);
    expect(abortFunction).not.toMatch(/^\s*flock -u\b/gmu);
    expect(hostReleaseOrchestrator).toContain(
      "exec 8>&-\n    unset DIESEL_RELEASE_LIFECYCLE_LOCK_FD",
    );
    for (const markdownTrapOwner of [
      "release_rollback_armed",
      "rollback_release_id",
      "abort_release_and_restore_host",
      "publication_controller_status",
      "publication_controller_parent_signal",
    ]) {
      expect(deploymentRunbook).not.toContain(markdownTrapOwner);
    }
    expect(rollbackHostRelease).toContain(
      'exec 8<>"${lock_path}"\n    export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8',
    );
    expect(rollbackHostRelease).toContain("if ! flock -n 8; then");
    expect(hostActivationLedger).toContain(
      "host_activation_ledger_require_lifecycle_lock()",
    );
    expect(hostActivationLedger).toContain(
      'if ! command -v flock >/dev/null 2>&1 || ! flock -n 8 2>/dev/null; then',
    );
    expect(hostActivationLedger).toContain(
      '"release lifecycle lock descriptor 8 is not exclusively locked"',
    );
    expect(rollbackHostRelease).toContain(
      'rollback_fsync_paths \\\n    "${node_binary}" \\\n    "${nginx_primary_path}" \\\n    "${nginx_alternate_path}" \\\n    "${nginx_sites_root}"',
    );
    expect(rollbackHostRelease).toContain(
      'rollback_fsync_paths "${node_binary}" "${environment_path}" "${shared_root}"',
    );
    expect(rollbackHostRelease).toContain(
      'rollback_fsync_paths "${node_binary}" "${deploy_root}"',
    );
    const rollbackPm2Lines = rollbackHostRelease
      .split("\n")
      .filter((line) => /\bpm2 (?:delete|describe|jlist|save|start)\b/u.test(line));
    expect(rollbackPm2Lines.length).toBeGreaterThan(0);
    expect(rollbackPm2Lines.every((line) => line.includes("8>&-"))).toBe(true);
    expect(deploymentRunbook).toContain(
      "只有 maintenance-locked\n状态机可调用 `--restore-governance-host`",
    );
    expect(deploymentRunbook).toContain(
      "rollback 不移动 ledger。状态机\n在 host 后进行第二次 DB 深比较和 lock/current 复核，最后才 durable 转为\n`HOST_ROLLBACK_COMPLETED`",
    );
    expect(governancePublicationStateMachine).toContain(
      '"${rollback_script}" "${expected_release_id}" \\\n      --restore-governance-host',
    );
    expect(rollbackHostRelease).toContain(
      '"HOST_ROLLBACK_REQUIRED requires maintenance-locked governance recovery"',
    );
    expect(rollbackHostRelease).toContain(
      '"HOST_ROLLBACK_COMPLETED is a terminal audit ledger"',
    );
    expect(deploymentRunbook).toContain(
      "所有 live 环境/Nginx 文件及父目录、`current` 的父目录和 ledger 目录都会在成功返回前无条件",
    );
    const releaseInputGuardStart = hostReleaseOrchestrator.indexOf(
      "host_release_orchestrator_require_release_inputs() {",
    );
    const releaseInputGuardEnd = hostReleaseOrchestrator.indexOf(
      "\nhost_release_orchestrator_capture_candidate_fingerprint() {",
      releaseInputGuardStart,
    );
    const releaseInputGuard = hostReleaseOrchestrator.slice(
      releaseInputGuardStart,
      releaseInputGuardEnd,
    );
    expect(releaseInputGuardStart).toBeGreaterThanOrEqual(0);
    expect(releaseInputGuardEnd).toBeGreaterThan(releaseInputGuardStart);
    for (const trustedReleaseInput of [
      "host-release-orchestrator.sh",
      "release-publication-controller.sh",
      "prepare-release-runtime.sh",
      "activate-host-release.sh",
      "rollback-host-release.sh",
      "governance-publication-state-machine.sh",
      "host-activation-ledger.sh",
      "with-governance-maintenance-lock.ts",
      "runtime-environment-contract.cjs",
    ]) {
      expect(hostReleaseOrchestrator).toContain(trustedReleaseInput);
    }
    expect(
      releaseInputGuard.match(/release-executable/gu),
    ).toHaveLength(1);
    expect(releaseInputGuard).toContain(
      '"${HOST_RELEASE_ORCHESTRATOR_MAINTENANCE_WRAPPER}" release-file',
    );
    expect(releaseInputGuard).toContain(
      '"${HOST_RELEASE_ORCHESTRATOR_RUNTIME_ENVIRONMENT_CONTRACT}" release-file',
    );
    expect(hostReleaseOrchestrator).toContain(
      'if [[ "${final_status}" -eq 0 && "${status}" -ne 0 ]]; then',
    );
    expect(deploymentRunbook).toMatch(
      /受支持的 production direct\s+activation 发生在 prepare 后，只接受 normalized 状态，并在其合法 source rollback 前同时验完\s+rollback 与 rollback 将加载的 ledger。/u,
    );
    expect(deploymentRunbook).toContain(
      "controller 的 executable inventory 包含 prepare、activation、rollback、\ngovernance、ledger 与 controller 自身",
    );
    expect(deploymentRunbook).toContain(
      "`rollback-host-release.sh --validate-committed` 只验 current/host/PM2；只有状态机 `finalize-committed` 重跑完整 host/public/current/lock 验收",
    );
    expect(deploymentRunbook).not.toContain("restore_precommit_host_state");
    expect(deploymentRunbook).not.toContain(
      'release_id="<失败发布的 release-id>"',
    );
    expect(deploymentRunbook).not.toContain(
      "Unexpected application health after manual host rollback",
    );
    const governanceCountryQueueBody =
      governanceCountryFixturePublisher.match(
        /local -a country_iso3s=\(\n([\s\S]*?)\n  \)/,
      )?.[1] ?? "";
    const protectedCountries =
      governanceCountryQueueBody.match(/[A-Z]{3}/g) ?? [];
    const publishedCountries = publicGovernanceValidator
      .match(/published_countries="([A-Z ]+)"/)?.[1]
      .split(" ");
    const expectedProtectedCountries = [...portfolioReleaseCountryIso3s];
    expect(deploymentRunbook).toContain(
      "  NODE_ENV=production\n  DATABASE_MODE=postgres",
    );
    expect(deploymentRunbook).toContain(
      '"${governance_env[@]}" "${node_binary}" --import tsx',
    );
    expect(deploymentRunbook).not.toContain(
      '"${governance_env[@]}" node --env-file=',
    );
    const databaseEnvironmentBindingIndex = deploymentRunbook.indexOf(
      'governance_database_environment="/opt/diesel/backups/${release_id}/env.production.local.pre-switch"',
    );
    const databaseEnvironmentMetadataIndex = deploymentRunbook.indexOf(
      'test "$(stat -c \'%U:%G:%a:%h\' "${governance_database_environment}")" = "root:root:600:1"',
      databaseEnvironmentBindingIndex,
    );
    expect(databaseEnvironmentBindingIndex).toBeGreaterThanOrEqual(0);
    expect(databaseEnvironmentMetadataIndex).toBeGreaterThan(
      databaseEnvironmentBindingIndex,
    );
    for (const legacyNormalPathCommand of [
      "prepare-release-runtime.sh",
      "activate-host-release.sh",
      "governance-publication-state-machine.sh",
      "finalize-committed",
    ]) {
      expect(normalPathBlock).not.toContain(legacyNormalPathCommand);
    }
    for (const rawMarkerContract of [
      "publish_commit_marker",
      "publish_finalized_marker",
      '[ -e "${publish_commit_marker}" ]',
      '[ -L "${publish_commit_marker}" ]',
      '[ -e "${publish_finalized_marker}" ]',
      '[ -L "${publish_finalized_marker}" ]',
    ]) {
      expect(normalPathBlock).not.toContain(rawMarkerContract);
    }
    expect(deploymentRunbook).toContain(
      '/bin/bash --noprofile --norc -- \\\n    "${release_dir}/scripts/deploy/governance-publication-state-machine.sh" \\\n    recover-required "${release_id}"',
    );
    expect(deploymentRunbook).toContain(
      '/bin/bash --noprofile --norc -- \\\n    "${release_dir}/scripts/deploy/governance-publication-state-machine.sh" \\\n    finalize-committed "${release_id}"',
    );
    expect(deploymentRunbook).not.toContain("GOVERNANCE_PUBLISH");
    expect(deploymentRunbook).not.toContain("GOVERNANCE_RECOVERY");
    expect(deploymentRunbook).not.toContain(
      "scripts/db/export-governance-snapshot.ts",
    );
    expect(deploymentRunbook).not.toContain(
      "scripts/db/restore-governance-snapshot.ts",
    );
    expect(protectedCountries).toEqual(expectedProtectedCountries);
    expect(protectedCountries).toHaveLength(97);
    expect(new Set(protectedCountries).size).toBe(97);
    expect(publishedCountries).toEqual(protectedCountries);
    expect(governanceCountryFixturePublisher).not.toContain(
      "validate-public-governance.sh",
    );
    expect(governanceCountryFixturePublisher).not.toContain(
      'mv -Tf "${recovery_marker}"',
    );
    expect(governanceCountryFixturePublisher).not.toContain(
      'rm -f "${recovery_marker}"',
    );
    expect(publicGovernanceValidator).toContain(
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
      expect(publicGovernanceValidator).toContain(assertion);
    }
    expect(publicGovernanceValidator).not.toContain(
      'assert_country_detail CHN 2 "GB 20891-2014"',
    );
    const publishFunctionStart = governancePublicationStateMachine.indexOf(
      "governance_publish_release() {",
    );
    const publishFunctionEnd = governancePublicationStateMachine.indexOf(
      "\ngovernance_cleanup_recovery_compare() {",
      publishFunctionStart,
    );
    const publishFunction = governancePublicationStateMachine.slice(
      publishFunctionStart,
      publishFunctionEnd,
    );
    const staleMarkerCheckIndex = publishFunction.indexOf(
      'governance_scan_stale_markers "${backups_root}"',
    );
    const validationScriptIndex = publishFunction.indexOf(
      "install -m 0700 -o root -g root --",
    );
    const exportIndex = publishFunction.indexOf(
      'governance_export_snapshot "${snapshot_path}"',
    );
    const dryRunIndex = publishFunction.indexOf(
      'governance_restore_snapshot "${snapshot_path}" "${snapshot_sha256}" dry-run',
    );
    const errTrapIndex = publishFunction.indexOf(
      "trap 'restore_governance_on_failure \"$?\"' ERR",
    );
    const recoveryMarkerIndex = publishFunction.indexOf(
      "governance_atomic_write_marker",
      errTrapIndex,
    );
    const rehearsalIndex = publishFunction.indexOf(
      'governance_restore_snapshot "${snapshot_path}" "${snapshot_sha256}" apply',
      recoveryMarkerIndex,
    );
    const countryPublisherSourceIndex = publishFunction.indexOf(
      'source -- "${country_queue}"',
      rehearsalIndex,
    );
    const firstIngestIndex = publishFunction.indexOf(
      "publish_governance_country_fixtures_for_root",
      countryPublisherSourceIndex,
    );
    const publicValidationIndex = publishFunction.indexOf(
      'governance_run_isolated_saved_public_validator \\\n    "${public_validation_script}" "${expected_release_id}"',
      firstIngestIndex,
    );
    const finalLockProofIndex = publishFunction.indexOf(
      'governance_assert_maintenance_lock "${release_dir}"',
      publicValidationIndex,
    );
    const publishCommitMoveIndex = publishFunction.indexOf(
      'governance_durable_rename_publication_marker \\\n    "${recovery_marker}" "${publish_commit_marker}"',
      publicValidationIndex,
    );
    const childCommitFlagIndex = publishFunction.indexOf(
      "GOVERNANCE_COMMIT_REACHED=1",
      publishCommitMoveIndex,
    );
    const childTrapClearAfterCommitIndex = publishFunction.indexOf(
      "trap - ERR INT TERM HUP EXIT",
      childCommitFlagIndex,
    );
    expect(publishFunctionStart).toBeGreaterThanOrEqual(0);
    expect(publishFunctionEnd).toBeGreaterThan(publishFunctionStart);
    expect(staleMarkerCheckIndex).toBeGreaterThanOrEqual(0);
    expect(staleMarkerCheckIndex).toBeLessThan(validationScriptIndex);
    expect(validationScriptIndex).toBeLessThan(exportIndex);
    expect(exportIndex).toBeGreaterThanOrEqual(0);
    expect(dryRunIndex).toBeGreaterThan(exportIndex);
    expect(errTrapIndex).toBeGreaterThan(dryRunIndex);
    expect(recoveryMarkerIndex).toBeGreaterThan(errTrapIndex);
    expect(rehearsalIndex).toBeGreaterThan(recoveryMarkerIndex);
    expect(countryPublisherSourceIndex).toBeGreaterThan(rehearsalIndex);
    expect(firstIngestIndex).toBeGreaterThan(countryPublisherSourceIndex);
    expect(publicValidationIndex).toBeGreaterThan(firstIngestIndex);
    expect(finalLockProofIndex).toBeGreaterThan(publicValidationIndex);
    expect(publishCommitMoveIndex).toBeGreaterThan(finalLockProofIndex);
    expect(childCommitFlagIndex).toBeGreaterThan(publishCommitMoveIndex);
    expect(childTrapClearAfterCommitIndex).toBeGreaterThan(
      childCommitFlagIndex,
    );

    const strictStateFunctionStart = releasePublicationController.indexOf(
      "release_publication_controller_read_strict_state() {",
    );
    const strictStateFunctionEnd = releasePublicationController.indexOf(
      "\nrelease_publication_controller_require_pending_state() {",
      strictStateFunctionStart,
    );
    const strictStateFunction = releasePublicationController.slice(
      strictStateFunctionStart,
      strictStateFunctionEnd,
    );
    const currentProofFunctionStart = releasePublicationController.indexOf(
      "release_publication_controller_require_current() {",
    );
    const currentProofFunctionEnd = releasePublicationController.indexOf(
      "\nrelease_publication_controller_run_governance_mode() (",
      currentProofFunctionStart,
    );
    const currentProofFunction = releasePublicationController.slice(
      currentProofFunctionStart,
      currentProofFunctionEnd,
    );
    const finalizeFunctionStart = releasePublicationController.indexOf(
      "release_publication_controller_finalize_and_require_terminal() {",
    );
    const finalizeFunctionEnd = releasePublicationController.indexOf(
      "\nrelease_publication_controller_reconcile_committed() (",
      finalizeFunctionStart,
    );
    const finalizeFunction = releasePublicationController.slice(
      finalizeFunctionStart,
      finalizeFunctionEnd,
    );
    const committedReconcileFunctionStart = releasePublicationController.indexOf(
      "release_publication_controller_reconcile_committed() (",
    );
    const committedReconcileFunctionEnd = releasePublicationController.indexOf(
      "\n# Pure orchestration entry point.",
      committedReconcileFunctionStart,
    );
    const committedReconcileFunction = releasePublicationController.slice(
      committedReconcileFunctionStart,
      committedReconcileFunctionEnd,
    );
    const reconcileFunctionStart = releasePublicationController.indexOf(
      "release_publication_controller_reconcile() (",
    );
    const reconcileFunctionEnd = releasePublicationController.indexOf(
      "\nrelease_publication_controller_impl() {",
      reconcileFunctionStart,
    );
    const reconcileFunction = releasePublicationController.slice(
      reconcileFunctionStart,
      reconcileFunctionEnd,
    );
    const controllerFunctionStart = reconcileFunctionEnd + 1;
    const controllerFunctionEnd = releasePublicationController.indexOf(
      "\nrelease_publication_controller() (",
      controllerFunctionStart,
    );
    const controllerFunction = releasePublicationController.slice(
      controllerFunctionStart,
      controllerFunctionEnd,
    );
    const controllerPendingProofIndex = controllerFunction.indexOf(
      "host_activation_ledger_require_pending",
    );
    const controllerReconcileIndex = controllerFunction.indexOf(
      'release_publication_controller_reconcile "${release_id}"',
      controllerPendingProofIndex,
    );
    const initialPendingStateIndex = reconcileFunction.indexOf(
      "release_publication_controller_require_pending_state",
    );
    const preparePhaseIndex = reconcileFunction.indexOf(
      "release_publication_controller_run_prepare",
      initialPendingStateIndex,
    );
    const postPreparePendingStateIndex = reconcileFunction.indexOf(
      "release_publication_controller_require_pending_state",
      preparePhaseIndex,
    );
    const activatePhaseIndex = reconcileFunction.indexOf(
      "release_publication_controller_run_activate",
      postPreparePendingStateIndex,
    );
    const currentProofIndex = reconcileFunction.indexOf(
      "release_publication_controller_require_current",
      activatePhaseIndex,
    );
    const publishPhaseIndex = reconcileFunction.indexOf(
      "release_publication_controller_run_governance_mode \\\n    publish",
      currentProofIndex,
    );
    const postPublishStrictStateIndex = reconcileFunction.indexOf(
      "release_publication_controller_read_strict_state",
      publishPhaseIndex,
    );
    const finalizePhaseIndex = reconcileFunction.indexOf(
      "release_publication_controller_finalize_and_require_terminal",
      postPublishStrictStateIndex,
    );

    expect(strictStateFunctionStart).toBeGreaterThanOrEqual(0);
    expect(strictStateFunctionEnd).toBeGreaterThan(strictStateFunctionStart);
    expect(strictStateFunction).toContain(
      "host_activation_ledger_require_lifecycle_lock",
    );
    expect(strictStateFunction).toContain("host_activation_ledger_scan_all");
    expect(strictStateFunction).toContain(
      "host_activation_ledger_validate_release_state",
    );
    expect(controllerFunctionEnd).toBeGreaterThan(controllerFunctionStart);
    expect(controllerPendingProofIndex).toBeGreaterThanOrEqual(0);
    expect(controllerReconcileIndex).toBeGreaterThan(
      controllerPendingProofIndex,
    );
    expect(currentProofFunctionStart).toBeGreaterThanOrEqual(0);
    expect(currentProofFunctionEnd).toBeGreaterThan(currentProofFunctionStart);
    expect(currentProofFunction).toContain(
      "host_activation_ledger_require_pending",
    );
    expect(currentProofFunction).toContain('[[ ! -L "${current_link}" ]]');
    expect(currentProofFunction).toContain(
      '[[ "${current_release}" != "${release_dir}" ]]',
    );
    expect(initialPendingStateIndex).toBeGreaterThanOrEqual(0);
    expect(preparePhaseIndex).toBeGreaterThan(initialPendingStateIndex);
    expect(postPreparePendingStateIndex).toBeGreaterThan(preparePhaseIndex);
    expect(activatePhaseIndex).toBeGreaterThan(postPreparePendingStateIndex);
    expect(currentProofIndex).toBeGreaterThan(activatePhaseIndex);
    expect(publishPhaseIndex).toBeGreaterThan(currentProofIndex);
    expect(postPublishStrictStateIndex).toBeGreaterThan(publishPhaseIndex);
    expect(finalizePhaseIndex).toBeGreaterThan(postPublishStrictStateIndex);
    expect(finalizeFunctionStart).toBeGreaterThanOrEqual(0);
    expect(finalizeFunctionEnd).toBeGreaterThan(finalizeFunctionStart);
    expect(finalizeFunction).toContain(
      "release_publication_controller_run_governance_mode \\\n    finalize-committed",
    );
    expect(finalizeFunction).toContain(
      '"${strict_state}" == "COMMITTED:PUBLISH_FINALIZED"',
    );
    const exactTerminalProofIndex = finalizeFunction.indexOf(
      '"${strict_state}" == "COMMITTED:PUBLISH_FINALIZED"',
    );
    const exactTerminalReturnIndex = finalizeFunction.indexOf(
      "return 0",
      exactTerminalProofIndex,
    );
    const nonTerminalPreserveIndex = finalizeFunction.indexOf(
      '"${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"',
      exactTerminalReturnIndex,
    );
    expect(exactTerminalProofIndex).toBeGreaterThanOrEqual(0);
    expect(exactTerminalReturnIndex).toBeGreaterThan(exactTerminalProofIndex);
    expect(nonTerminalPreserveIndex).toBeGreaterThan(exactTerminalReturnIndex);
    expect(committedReconcileFunctionStart).toBeGreaterThanOrEqual(0);
    expect(committedReconcileFunctionEnd).toBeGreaterThan(
      committedReconcileFunctionStart,
    );
    expect(committedReconcileFunction).toContain(
      "PENDING:PUBLISH_COMMITTED | PENDING:PUBLISH_FINALIZED | \\\n      COMMITTED:PUBLISH_FINALIZED)",
    );
    expect(controllerFunction).toContain("COMMITTED:PUBLISH_FINALIZED)");
    expect(controllerFunction).toContain(
      "release_publication_controller_reconcile_committed",
    );
    expect(releasePublicationController).toContain(
      "release_publication_controller_run_supervised",
    );
    expect(releasePublicationController).toContain(
      "release_publication_controller_require_fixed_node_runtime",
    );
    expect(releasePublicationController).toContain(
      "RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS=75",
    );
    expect(reconcileFunction).toContain(
      '"${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"',
    );
    expect(finalizeFunction).toContain(
      '"${RELEASE_PUBLICATION_CONTROLLER_PRESERVE_STATUS}"',
    );

    for (const forbiddenControllerMutation of [
      "host_activation_ledger_transition",
      "host_activation_ledger_write_record",
      "governance_durable_rename_publication_marker",
      "rollback_host_release",
      "abort_release_and_restore_host",
      "recover-required",
      "publish_commit_marker=",
      "publish_finalized_marker=",
      "recovery_marker=",
      "host_rollback_marker=",
    ]) {
      expect(releasePublicationController).not.toContain(
        forbiddenControllerMutation,
      );
    }
    expect(
      releasePublicationController.match(
        /"\$\{release_dir\}\/scripts\/deploy\/rollback-host-release\.sh"/gu,
      ),
    ).toHaveLength(1);
    expect(releasePublicationController).not.toMatch(
      /^\s*(?:mv|rm|touch|install)\b[^\n]*(?:PUBLISH_|RECOVERY_REQUIRED|HOST_ROLLBACK_)/gmu,
    );

    const controllerDispatchStart = reconcile.indexOf(
      'case "${controller_status}" in',
    );
    const controllerDispatch = reconcile.slice(controllerDispatchStart);
    const controllerSuccessIndex = controllerDispatch.indexOf("    0)");
    const controllerPreserveIndex = controllerDispatch.indexOf(
      '    "${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}")',
      controllerSuccessIndex,
    );
    const controllerFailureIndex = controllerDispatch.indexOf(
      "    *)",
      controllerPreserveIndex,
    );
    expect(controllerDispatchStart).toBeGreaterThanOrEqual(0);
    expect(controllerPreserveIndex).toBeGreaterThan(controllerSuccessIndex);
    expect(controllerFailureIndex).toBeGreaterThan(controllerPreserveIndex);
    expect(controllerDispatch).toContain(
      "host_release_orchestrator_finish_without_rollback 0",
    );
    expect(controllerDispatch).toContain(
      [
        "host_release_orchestrator_finish_without_rollback \\",
        '        "${HOST_RELEASE_ORCHESTRATOR_PRESERVE_STATUS}"',
      ].join("\n"),
    );
    expect(controllerDispatch).toContain(
      'host_release_orchestrator_finish_failure "${controller_status}"',
    );
    expect(abortFunction).toContain(
      "PENDING:PUBLISH_COMMITTED | PENDING:PUBLISH_FINALIZED | \\",
    );
    expect(abortFunction).toContain("PENDING:none)");
    expect(abortFunction).toContain(
      "PENDING:RECOVERY_REQUIRED | PENDING:HOST_ROLLBACK_REQUIRED | \\",
    );
    expect(deploymentRunbook).not.toContain(
      "rollback_host_release_after_governance_failure",
    );

    expect(deploymentRunbook).toContain('pm2_state_root="/root/.pm2"');
    expect(deploymentRunbook).toContain(
      'test "$(stat -c \'%U:%G:%a\' /root)" = "root:root:700"',
    );
    expect(deploymentRunbook).toContain(
      'install -d -m 0700 -o root -g root "${pm2_state_root}"',
    );
    expect(deploymentRunbook).toContain('chown root:root "${pm2_state_root}"');
    expect(deploymentRunbook).toContain('chmod 700 "${pm2_state_root}"');
    expect(deploymentRunbook).toContain(
      '\' -- "${pm2_state_root}" /root 8>&-',
    );
    expect(pm2PersistenceHelper).toContain(
      'const FIXED_PM2_ROOT = "/root/.pm2";',
    );
    expect(pm2PersistenceHelper).toContain(
      "const MAX_DUMP_BYTES = 16 * 1024 * 1024;",
    );
    expect(pm2PersistenceHelper).toContain("fchownSync(descriptor, 0, 0)");
    expect(pm2PersistenceHelper).toContain("fchmodSync(descriptor, 0o600)");
    expect(pm2PersistenceHelper).toContain("fsyncSync(primary.descriptor)");
    expect(pm2PersistenceHelper).toContain("fsyncSync(backup.descriptor)");
    expect(pm2PersistenceHelper).toContain("fsyncSync(directoryDescriptor)");
    expect(deploymentRunbook).toContain(
      '"${node_binary}" "${pm2_exec}" startup systemd -u root --hp /root',
    );
    const pm2StartupIndex = deploymentRunbook.indexOf(
      '"${node_binary}" "${pm2_exec}" startup systemd -u root --hp /root',
    );
    const pm2DaemonReloadIndex = deploymentRunbook.indexOf(
      "/usr/bin/systemctl daemon-reload",
      pm2StartupIndex,
    );
    const pm2EnableNowIndex = deploymentRunbook.indexOf(
      "/usr/bin/systemctl enable --now pm2-root",
      pm2DaemonReloadIndex,
    );
    const firstPm2EnabledCheckIndex = deploymentRunbook.indexOf(
      "/usr/bin/systemctl is-enabled --quiet pm2-root",
      pm2EnableNowIndex,
    );
    expect(pm2StartupIndex).toBeGreaterThanOrEqual(0);
    expect(pm2DaemonReloadIndex).toBeGreaterThan(pm2StartupIndex);
    expect(pm2EnableNowIndex).toBeGreaterThan(pm2DaemonReloadIndex);
    expect(firstPm2EnabledCheckIndex).toBeGreaterThan(pm2EnableNowIndex);
    const manualHostCheckIndex = deploymentRunbook.indexOf(
      '"/opt/diesel/releases/${release_id}/scripts/deploy/rollback-host-release.sh" \\\n  "${release_id}" --check',
    );
    const manualHostRollbackBlockStart = deploymentRunbook.lastIndexOf(
      'release_lifecycle_lock_path="/opt/diesel/.release-lifecycle.lock"',
      manualHostCheckIndex,
    );
    const manualHostRollbackBlockEnd = deploymentRunbook.indexOf(
      "\n```",
      manualHostCheckIndex,
    );
    const manualHostRollbackBlock = deploymentRunbook.slice(
      manualHostRollbackBlockStart,
      manualHostRollbackBlockEnd,
    );
    expect(manualHostRollbackBlockStart).toBeGreaterThanOrEqual(0);
    expect(manualHostRollbackBlockEnd).toBeGreaterThan(
      manualHostRollbackBlockStart,
    );
    expect(manualHostRollbackBlock).toContain(
      'exec 8<>"${release_lifecycle_lock_path}"\nflock -n 8\nexport DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8',
    );
    expect(manualHostRollbackBlock).toContain(
      '"/opt/diesel/releases/${release_id}/scripts/deploy/rollback-host-release.sh" \\\n  "${release_id}" --check',
    );
    expect(manualHostRollbackBlock).toContain(
      '"/opt/diesel/releases/${release_id}/scripts/deploy/rollback-host-release.sh" \\\n  "${release_id}" --apply',
    );
    expect(manualHostRollbackBlock).toContain(
      "exec 8>&-\nunset DIESEL_RELEASE_LIFECYCLE_LOCK_FD",
    );
    expect(manualHostRollbackBlock).not.toContain("flock -u");

    const manualRecoveryCommandStart = deploymentRunbook.indexOf(
      'release_id="<marker 对应的 release-id>"',
    );
    const committedCleanupStart = deploymentRunbook.indexOf(
      'release_id="<commit marker 对应的 release-id>"',
    );
    const manualRecoveryBlock = deploymentRunbook.slice(
      manualRecoveryCommandStart,
      committedCleanupStart,
    );
    expect(manualRecoveryCommandStart).toBeGreaterThanOrEqual(0);
    expect(committedCleanupStart).toBeGreaterThan(manualRecoveryCommandStart);
    expect(manualRecoveryBlock).toContain(
      '[[ "${release_id}" =~ ^[0-9a-f]{40}$ ]]',
    );
    expect(manualRecoveryBlock).toContain(
      '"${release_dir}/scripts/db/with-governance-maintenance-lock.ts" \\\n  --database-env-file="${governance_database_environment}" -- \\',
    );
    expect(manualRecoveryBlock).toContain(
      'recover-required "${release_id}"',
    );
    expect(manualRecoveryBlock).toContain(
      'exec 8<>"${release_lifecycle_lock_path}"\nflock -n 8\nexport DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8',
    );
    expect(manualRecoveryBlock).toContain(
      "  DATABASE_MODE=postgres\n  DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8",
    );
    expect(manualRecoveryBlock).toContain(
      "exec 8>&-\nunset DIESEL_RELEASE_LIFECYCLE_LOCK_FD",
    );
    expect(manualRecoveryBlock).not.toContain("flock -u");
    expect(manualRecoveryBlock).not.toContain(
      "scripts/db/restore-governance-snapshot.ts",
    );
    expect(manualRecoveryBlock).not.toContain(
      "scripts/db/export-governance-snapshot.ts",
    );
    expect(manualRecoveryBlock).not.toContain("curl ");
    const committedCleanupEnd = deploymentRunbook.indexOf(
      "\n```\n\n上述 97 个唯一国家命令",
      committedCleanupStart,
    );
    const committedCleanupBlock = deploymentRunbook.slice(
      committedCleanupStart,
      committedCleanupEnd,
    );
    expect(committedCleanupEnd).toBeGreaterThan(committedCleanupStart);
    expect(committedCleanupBlock).toContain(
      '[[ "${release_id}" =~ ^[0-9a-f]{40}$ ]]',
    );
    expect(committedCleanupBlock).toContain(
      'finalize-committed "${release_id}"',
    );
    expect(committedCleanupBlock).toContain(
      '"${release_dir}/scripts/db/with-governance-maintenance-lock.ts" \\\n  --database-env-file="${governance_database_environment}" -- \\',
    );
    expect(committedCleanupBlock).toContain(
      'exec 8<>"${release_lifecycle_lock_path}"\nflock -n 8\nexport DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8',
    );
    expect(committedCleanupBlock).toContain(
      "  DATABASE_MODE=postgres\n  DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8",
    );
    expect(committedCleanupBlock).toContain(
      "exec 8>&-\nunset DIESEL_RELEASE_LIFECYCLE_LOCK_FD",
    );
    expect(committedCleanupBlock).not.toContain("flock -u");
    expect(committedCleanupBlock).not.toContain(
      "rollback-host-release.sh",
    );
    expect(committedCleanupBlock).not.toContain(
      "restore-governance-snapshot.ts",
    );
    expect(committedCleanupBlock).not.toContain("--apply");
    expect(deploymentRunbook).not.toContain("IFS=$'\\t' read -r snapshot");
  });
});

describe("parallel CI test partition", () => {
  it("keeps app coverage and deployment contracts complete and independently blocking", async () => {
    const [workflow, packageText] = await Promise.all([
      readFile(
        resolve(process.cwd(), ".github/workflows/ci.yml"),
        "utf8",
      ),
      readFile(resolve(process.cwd(), "package.json"), "utf8"),
    ]);
    const packageManifest = JSON.parse(packageText) as {
      scripts: Record<string, string>;
    };
    const qualityStart = workflow.indexOf("\n  quality:\n");
    const deployContractsStart = workflow.indexOf(
      "\n  deploy-contracts:\n",
      qualityStart,
    );
    const postgresStart = workflow.indexOf(
      "\n  postgres-migrations:\n",
      deployContractsStart,
    );
    const qualityJob = workflow.slice(qualityStart, deployContractsStart);
    const deployContractsJob = workflow.slice(
      deployContractsStart,
      postgresStart,
    );

    expect(packageManifest.scripts.test).toBe("vitest run");
    expect(packageManifest.scripts["test:coverage"]).toBe(
      "vitest run --coverage",
    );
    expect(packageManifest.scripts["test:coverage:app"]).toBe(
      "vitest run --coverage --exclude tests/deploy-scripts.test.ts --exclude tests/host-activation-ledger.test.ts --exclude tests/release-publication-controller.test.ts --exclude tests/host-release-orchestrator.test.ts",
    );
    expect(packageManifest.scripts["test:deploy:contracts"]).toBe(
      "vitest run tests/deploy-scripts.test.ts tests/host-activation-ledger.test.ts tests/release-publication-controller.test.ts tests/host-release-orchestrator.test.ts --reporter=verbose --slowTestThreshold=0",
    );

    expect(qualityStart).toBeGreaterThanOrEqual(0);
    expect(deployContractsStart).toBeGreaterThan(qualityStart);
    expect(postgresStart).toBeGreaterThan(deployContractsStart);
    expect(qualityJob).toContain("timeout-minutes: 30");
    expect(qualityJob).toContain("run: pnpm test:coverage:app");
    expect(qualityJob).not.toContain("run: pnpm test:coverage\n");
    expect(qualityJob).toContain("name: coverage-report");

    expect(deployContractsJob).toContain(
      "name: Linux deployment script contracts",
    );
    expect(deployContractsJob).toContain(
      "if: github.event_name != 'schedule'",
    );
    expect(deployContractsJob).toContain("runs-on: ubuntu-latest");
    expect(deployContractsJob).toContain("timeout-minutes: 45");
    expect(deployContractsJob).toContain("fetch-depth: 0");
    expect(deployContractsJob).toContain(
      "run: pnpm install --frozen-lockfile",
    );
    expect(deployContractsJob).toContain(
      "run: pnpm test:deploy:contracts",
    );
    expect(deployContractsJob).not.toContain("needs: quality");
    expect(deployContractsJob).not.toContain("--coverage");
    expect(deployContractsJob).not.toContain("name: coverage-report");
  });
});

describe("merge-blocking Linux release handoff", () => {
  it("runs the real handoff only on an ephemeral GitHub-hosted runner", async () => {
    const [workflow, smokeScript] = await Promise.all([
      readFile(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8"),
      readFile(
        resolve(
          process.cwd(),
          "scripts/ci/linux-release-handoff-smoke.sh",
        ),
        "utf8",
      ),
    ]);
    const jobStart = workflow.indexOf("\n  linux-release-handoff:\n");
    const jobEnd = workflow.indexOf("\n  required:\n", jobStart);
    const job = workflow.slice(jobStart, jobEnd);

    expect(jobStart).toBeGreaterThanOrEqual(0);
    expect(jobEnd).toBeGreaterThan(jobStart);
    expect(job).toContain("needs: quality");
    expect(job).toContain("runs-on: ubuntu-24.04");
    expect(job).toContain("timeout-minutes: 60");
    expect(job).toContain("fetch-depth: 0");
    expect(job).toContain("persist-credentials: false");
    expect(job).toContain("RUNNER_ENVIRONMENT: ${{ runner.environment }}");
    expect(job).toContain(
      'test "${RUNNER_ENVIRONMENT}" = "github-hosted"',
    );
    expect(job).toContain("sudo -n true");
    expect(job).toContain('handoff_temp="$(mktemp -d /tmp/diesel-handoff-runner.XXXXXX)"');
    expect(job).toContain('chmod 0755 "${handoff_temp}"');
    expect(job).not.toContain('${RUNNER_TEMP}');
    expect(smokeScript).toContain('runuser -u diesel-build -- /usr/bin/test -x "${canary_workspace}"');
    expect(smokeScript).toContain('"${node_binary}" /opt/node-v22.22.3-linux-x64');
    expect(smokeScript).toContain('node_binary=/opt/node-v22.22.3-linux-x64/bin/node');
    expect(smokeScript).toContain('prepare_release_require_fixed_root_command_boundary "${fixed_path}" "${node_binary}"');
    expect(smokeScript.indexOf('prepare_release_require_fixed_root_command_boundary "${fixed_path}" "${node_binary}"'))
      .toBeLessThan(smokeScript.indexOf('groupadd --system'));
    expect(smokeScript).not.toContain("prepare_release_require_fixed_root_command_boundary()");
    expect(job).toContain(
      "node scripts/deploy/release-input-manifest.mjs",
    );
    expect(job).toContain("sudo -n /usr/bin/env -i");
    expect(job).toContain(
      '/bin/bash "${release_export}/scripts/ci/linux-release-handoff-smoke.sh"',
    );
    expect(job).toContain(
      "Linux release handoff (systemd cgroup + real build)",
    );
    expect(job).not.toContain("pnpm/action-setup");
    for (const credential of [
      "${{ secrets.",
      "github.token",
      "GH_TOKEN=",
      "GITHUB_TOKEN=",
      "NODE_AUTH_TOKEN=",
      "NPM_TOKEN=",
    ]) {
      expect(job).not.toContain(credential);
    }
    expect(smokeScript).toContain(
      "DATABASE_URL=postgresql://database.invalid/diesel",
    );
    expect(smokeScript).toContain(
      "AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY=50000",
    );
    expect(smokeScript).toContain(
      "AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY=500",
    );
    expect(smokeScript).toContain(
      "AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR=300",
    );
    expect(smokeScript).toContain("AI_CHAT_RATE_LIMIT_PER_HOUR=30");
    expect(smokeScript).toContain("AI_CHAT_RATE_LIMIT_BACKEND=postgres");
  });

  it("makes the Linux handoff a dependency of the single required gate", async () => {
    const workflow = await readFile(
      resolve(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );
    const requiredStart = workflow.indexOf("\n  required:\n");
    const required = workflow.slice(requiredStart);

    expect(requiredStart).toBeGreaterThanOrEqual(0);
    expect(required).toContain("- linux-release-handoff");
    expect(required).toContain(
      "LINUX_RELEASE_HANDOFF_RESULT: ${{ needs['linux-release-handoff'].result }}",
    );
    expect(required).toContain(
      'test "${LINUX_RELEASE_HANDOFF_RESULT}" = "success"',
    );
  });

  it("locks every merge-blocking job into the fail-closed required gate", async () => {
    const workflow = await readFile(
      resolve(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );
    const jobsStart = workflow.indexOf("\njobs:\n");
    const workflowJobIds = [...workflow.slice(jobsStart).matchAll(
      /^  ([a-z][a-z0-9-]*):\n/gmu,
    )].map((match) => match[1]);
    const requiredStart = workflow.indexOf("\n  required:\n");
    const required = workflow.slice(requiredStart);
    const needsBlock = required.match(
      /\n    needs:\n((?:      - [^\n]+\n)+)/u,
    )?.[1];
    const expectedNeeds = [
      "quality",
      "deploy-contracts",
      "postgres-migrations",
      "e2e",
      "fde-demo-e2e",
      "portfolio-demo-e2e",
      "secrets",
      "audit",
      "linux-release-handoff",
    ] as const;
    const resultVariables = {
      audit: "AUDIT_RESULT",
      "deploy-contracts": "DEPLOY_CONTRACTS_RESULT",
      e2e: "E2E_RESULT",
      "fde-demo-e2e": "FDE_DEMO_RESULT",
      "linux-release-handoff": "LINUX_RELEASE_HANDOFF_RESULT",
      "portfolio-demo-e2e": "DEMO_RESULT",
      "postgres-migrations": "POSTGRES_RESULT",
      quality: "QUALITY_RESULT",
      secrets: "SECRETS_RESULT",
    } as const satisfies Record<(typeof expectedNeeds)[number], string>;
    const resultExpressions = {
      audit: "${{ needs.audit.result }}",
      "deploy-contracts": "${{ needs['deploy-contracts'].result }}",
      e2e: "${{ needs.e2e.result }}",
      "fde-demo-e2e": "${{ needs.fde-demo-e2e.result }}",
      "linux-release-handoff":
        "${{ needs['linux-release-handoff'].result }}",
      "portfolio-demo-e2e": "${{ needs.portfolio-demo-e2e.result }}",
      "postgres-migrations": "${{ needs.postgres-migrations.result }}",
      quality: "${{ needs.quality.result }}",
      secrets: "${{ needs.secrets.result }}",
    } as const satisfies Record<(typeof expectedNeeds)[number], string>;

    expect(jobsStart).toBeGreaterThanOrEqual(0);
    expect(workflowJobIds.at(-1)).toBe("required");
    expect(workflowJobIds.toSorted()).toEqual(
      [...expectedNeeds, "required"].toSorted(),
    );
    expect(requiredStart).toBeGreaterThanOrEqual(0);
    expect(required).toContain(
      "if: ${{ always() && github.event_name != 'schedule' }}",
    );
    expect(
      needsBlock
        ?.trim()
        .split("\n")
        .map((line) => line.replace(/^\s*-\s+/u, "")),
    ).toEqual(expectedNeeds);

    for (const job of expectedNeeds) {
      const variable = resultVariables[job];
      const resultExpression = resultExpressions[job];
      expect(required).toContain(`${variable}: ${resultExpression}`);
      expect(required).toContain(`test "\${${variable}}" = "success"`);
    }

    expect(required.match(/^          [A-Z0-9_]+_RESULT:/gmu)).toHaveLength(
      expectedNeeds.length,
    );
    expect(
      required.match(/test "\$\{[A-Z0-9_]+_RESULT\}" = "success"/gu),
    ).toHaveLength(expectedNeeds.length);
  });
});

describe("country detail PostgreSQL snapshot smoke", () => {
  it("fails closed on fixture collisions before creating or cleaning rows", async () => {
    const smoke = await readFile(
      resolve(
        process.cwd(),
        "scripts/db/postgres-country-detail-consistency-smoke.ts",
      ),
      "utf8",
    );
    const collisionCheck = smoke.indexOf(
      "await assertFixturesAbsent(writerClient)",
    );
    const fixtureCreation = smoke.indexOf(
      "await createFixtures(writerClient)",
    );
    const ownershipClaim = smoke.indexOf("ownsFixtures = true", fixtureCreation);
    const ownershipGuard = smoke.indexOf("if (ownsFixtures)", ownershipClaim);
    const ownedCleanup = smoke.indexOf(
      "await cleanupOwnedFixtures(writerClient)",
      ownershipGuard,
    );

    expect(collisionCheck).toBeGreaterThanOrEqual(0);
    expect(fixtureCreation).toBeGreaterThan(collisionCheck);
    expect(ownershipClaim).toBeGreaterThan(fixtureCreation);
    expect(ownershipGuard).toBeGreaterThan(ownershipClaim);
    expect(ownedCleanup).toBeGreaterThan(ownershipGuard);
    const lifecycleStart = smoke.indexOf("const readerDatabase =");
    expect(lifecycleStart).toBeGreaterThanOrEqual(0);
    expect(smoke.slice(lifecycleStart, fixtureCreation)).not.toContain(
      "await cleanupOwnedFixtures",
    );
    expect(smoke).toContain(
      "country detail consistency smoke fixture identity collided",
    );
    expect(smoke).toContain("[1, 1, 1, 1, 1, 1]");
  });
});

describe("release authorization wiring", () => {
  it("keeps pnpm as a convenience while staging executes the committed verifier", async () => {
    const [
      packageJson,
      deploymentRunbook,
      stageRelease,
      verifier,
      bundledLicense,
      zodLicense,
    ] = await Promise.all([
      readFile(resolve(process.cwd(), "package.json"), "utf8"),
      readFile(resolve(process.cwd(), "docs/DEPLOYMENT.md"), "utf8"),
      readFile(
        resolve(process.cwd(), "scripts/deploy/stage-release.sh"),
        "utf8",
      ),
      readFile(
        resolve(
          process.cwd(),
          "scripts/deploy/verify-release-authorization.ts",
        ),
        "utf8",
      ),
      readFile(
        resolve(
          process.cwd(),
          "scripts/deploy/verify-release-authorization.bundle.LICENSE",
        ),
        "utf8",
      ),
      readFile(resolve(process.cwd(), "node_modules/zod/LICENSE"), "utf8"),
    ]);
    const manifest = JSON.parse(packageJson) as {
      scripts?: Record<string, unknown>;
    };

    expect(manifest.scripts?.["release:authorize"]).toBe(
      "env -u NODE_OPTIONS node scripts/deploy/verify-release-authorization.bundle.mjs",
    );
    expect(manifest.scripts?.["release:authorize:bundle"]).toBe(
      "env -u ESBUILD_BINARY_PATH -u NODE_OPTIONS node scripts/deploy/build-release-authorization.mjs",
    );
    expect(stageRelease).toContain(
      'readonly authorization_bundle_path="scripts/deploy/verify-release-authorization.bundle.mjs"',
    );
    expect(stageRelease).toContain(
      'readonly authorization_license_path="scripts/deploy/verify-release-authorization.bundle.LICENSE"',
    );
    expect(stageRelease).toContain(
      'run_git archive --format=tar --output="${authorization_archive}" "${release_id}" --',
    );
    expect(stageRelease).toContain(
      'committed_authorization_bundle="${authorization_export}/${authorization_bundle_path}"',
    );
    expect(stageRelease).toContain(
      'committed_authorization_license="${authorization_export}/${authorization_license_path}"',
    );
    expect(stageRelease).toContain(
      'assert_bound_file "${committed_authorization_bundle}" 100644 "${authorization_bundle_blob}"',
    );
    expect(stageRelease).toContain(
      'authorization_output="${temp_root}/authorization.json"',
    );
    expect(stageRelease).toContain(
      'authorization_environment=(\n  "${env_bin}" -i',
    );
    expect(stageRelease).toContain("-c core.fsmonitor=false");
    expect(stageRelease).toContain("-c core.hooksPath=/dev/null");
    expect(stageRelease).toContain("-c diff.external=");
    expect(stageRelease).toContain("ulimit -f 129");
    expect(stageRelease).toContain(') > "${authorization_output}"');
    expect(stageRelease).toContain(
      'authorization_bytes="$("${wc_bin}" -c < "${authorization_output}")"',
    );
    expect(stageRelease).toContain('"${authorization_bytes}" -le 65536');
    expect(stageRelease).toContain(
      '"${committed_authorization_bundle}" validate-output "${release_id}"',
    );
    expect(stageRelease).toContain(
      '< "${authorization_output}" > /dev/null',
    );
    expect(stageRelease).not.toContain(
      "node --import tsx scripts/deploy/verify-release-authorization.ts",
    );
    expect(stageRelease).not.toContain("authorization_export}/node_modules");
    expect(stageRelease).not.toContain("--experimental-strip-types");
    expect(stageRelease).not.toContain("pnpm --silent release:authorize");
    expect(stageRelease).toContain('validate-output "${release_id}"');
    expect(deploymentRunbook).not.toContain("authorization_environment=(");
    expect(verifier).toContain('format: "diesel-release-authorization-v1"');
    expect(verifier).toContain("/attempts/${selectedRun.run_attempt}/jobs");
    expect(verifier).not.toContain("status=success");
    expect(verifier).toContain('GIT_CONFIG_KEY_0: "core.fsmonitor"');
    expect(verifier).toContain('GIT_CONFIG_VALUE_0: "false"');
    expect(verifier).toContain('GIT_CONFIG_KEY_1: "core.hooksPath"');
    expect(verifier).toContain('GIT_CONFIG_KEY_2: "diff.external"');
    expect(verifier).toContain(
      'cwd: scope === "isolated" ? ISOLATED_GIT_CWD : root',
    );
    expect(verifier).toContain(
      "GIT_SSH_COMMAND: ISOLATED_GIT_SSH_COMMAND",
    );
    expect(verifier).toContain(
      '["ls-remote", "--exit-code", "--refs", fetchUrl, RELEASE_BRANCH_REF]',
    );
    expect(verifier).not.toContain(
      '["ls-remote", "--exit-code", "--refs", "origin", RELEASE_BRANCH_REF]',
    );
    expect(bundledLicense).toContain(zodLicense.trim());
  });
});
