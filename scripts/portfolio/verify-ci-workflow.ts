import { createHash } from "node:crypto";

import { z } from "zod";

export const ciGitleaksGuardPath = "scripts/ci/run-gitleaks.py" as const;
export const ciGitleaksGuardSha256 =
  "4619f93ccc00c792171a51db1081f1c3247a0aff7db10e78b25717f738c385a0" as const;

export function assertCiGitleaksGuardSource(source: string | Uint8Array): void {
  const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : source;
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > 64 * 1024 ||
    createHash("sha256").update(bytes).digest("hex") !== ciGitleaksGuardSha256
  ) {
    throw new Error("CI gitleaks guard does not match its reviewed SHA-256 contract.");
  }
}

export const ciInstallBoundaryPath =
  "scripts/ci/verify-install-boundary.py" as const;
export const ciInstallBoundarySha256 =
  "0bb2dfec1a365eef47b45db2eadcd0755f854a5be6f804badb2249be6eb96915" as const;
const maximumCiInstallBoundarySourceBytes = 64 * 1024;

export function assertCiInstallBoundarySource(
  source: string | Uint8Array,
): void {
  const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : source;
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > maximumCiInstallBoundarySourceBytes
  ) {
    throw new Error("CI install-boundary guard has an invalid byte length.");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== ciInstallBoundarySha256) {
    throw new Error(
      "CI install-boundary guard does not match its reviewed SHA-256 contract.",
    );
  }
}

const canonicalCiPackageScripts = {
  "audit:actions":
    "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/security/check-github-action-pins.ts",
  "audit:security": "tsx scripts/security/check-pnpm-audit.ts",
  build: "node --import tsx scripts/next-build.ts",
  demo: "tsx scripts/demo/server.ts",
  "demo:fde": "tsx scripts/demo/fde-server.ts",
  "db:check": "drizzle-kit check",
  "db:smoke:country-detail-consistency":
    "node --conditions=react-server --import tsx scripts/db/postgres-country-detail-consistency-smoke.ts",
  "db:smoke:governance-concurrency":
    "node --conditions=react-server --import tsx scripts/db/postgres-governance-concurrency-smoke.ts",
  "db:smoke:postgres": "tsx scripts/db/postgres-smoke.ts",
  "db:smoke:rate-limit-concurrency":
    "node --conditions=react-server --import tsx scripts/db/postgres-rate-limit-concurrency-smoke.ts",
  "db:smoke:upgrade": "tsx scripts/db/postgres-upgrade-smoke.ts",
  lint: "eslint .",
  "portfolio:verify-playwright-runs":
    "node --import tsx scripts/portfolio/verify-playwright-runs.ts",
  "test:coverage:app":
    "vitest run --coverage --exclude tests/deploy-scripts.test.ts --exclude tests/host-activation-ledger.test.ts --exclude tests/release-publication-controller.test.ts --exclude tests/host-release-orchestrator.test.ts",
  "test:deploy:contracts":
    "vitest run tests/deploy-scripts.test.ts tests/host-activation-ledger.test.ts tests/release-publication-controller.test.ts tests/host-release-orchestrator.test.ts --reporter=verbose --slowTestThreshold=0",
  "test:e2e": "playwright test",
  "test:e2e:csp:production":
    "playwright test --config playwright.production.config.ts",
  "test:e2e:demo": "playwright test --config playwright.demo.config.ts",
  "test:e2e:fde": "playwright test --config playwright.fde.config.ts",
  start: "next start",
  typecheck: "tsc --noEmit",
} as const;

const ciPackageManifestSchema = z.object({
  packageManager: z.literal("pnpm@11.9.0"),
  scripts: z.record(
    z.string().min(1).max(200),
    z.string().min(1).max(4_096),
  ),
}).passthrough();
const maximumCiPackageSourceBytes = 2 * 1024 * 1024;
const forbiddenRootInstallLifecycleScripts = [
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
  "pnpm:devPreinstall",
] as const;

/**
 * Binds every package-script indirection used by the merge-blocking workflow.
 * This assertion runs inside portfolio:verify itself, so weakening a script
 * cannot disable the check that validates that script's canonical expansion.
 */
export function assertCanonicalCiPackageScripts(source: string): void {
  if (Buffer.byteLength(source, "utf8") > maximumCiPackageSourceBytes) {
    throw new Error("CI package manifest exceeds the 2 MiB policy limit.");
  }
  if (source.includes("\0") || source.includes("\r")) {
    throw new Error("CI package manifest contains unsupported characters.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(source) as unknown;
  } catch (cause: unknown) {
    throw new Error("CI package manifest is not valid JSON.", { cause });
  }
  if (source !== `${JSON.stringify(decoded, null, 2)}\n`) {
    throw new Error(
      "CI package manifest must use canonical two-space JSON with one final newline.",
    );
  }

  const manifest = ciPackageManifestSchema.parse(decoded);
  for (const lifecycleName of forbiddenRootInstallLifecycleScripts) {
    if (Object.hasOwn(manifest.scripts, lifecycleName)) {
      throw new Error(
        `CI package manifest has an unsupported root install lifecycle script: ${lifecycleName}.`,
      );
    }
  }
  for (const [name, expected] of Object.entries(canonicalCiPackageScripts)) {
    if (manifest.scripts[name] !== expected) {
      throw new Error(
        `CI package script ${name} does not match its canonical execution contract.`,
      );
    }
    for (const lifecycleName of [`pre${name}`, `post${name}`]) {
      if (Object.hasOwn(manifest.scripts, lifecycleName)) {
        throw new Error(
          `CI package script ${name} has an unsupported lifecycle companion: ${lifecycleName}.`,
        );
      }
    }
  }
}

const requiredCiGateJob = `  required:
    name: Required CI gate
    if: \${{ always() && github.event_name != 'schedule' }}
    needs:
      - quality
      - deploy-contracts
      - postgres-migrations
      - e2e
      - fde-demo-e2e
      - portfolio-demo-e2e
      - secrets
      - audit
      - linux-release-handoff
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: Require every merge-blocking job to succeed
        env:
          AUDIT_RESULT: \${{ needs.audit.result }}
          BASH_ENV: /dev/null
          DEMO_RESULT: \${{ needs.portfolio-demo-e2e.result }}
          DEPLOY_CONTRACTS_RESULT: \${{ needs['deploy-contracts'].result }}
          ENV: /dev/null
          E2E_RESULT: \${{ needs.e2e.result }}
          FDE_DEMO_RESULT: \${{ needs.fde-demo-e2e.result }}
          LD_AUDIT: ""
          LD_LIBRARY_PATH: ""
          LD_PRELOAD: ""
          LINUX_RELEASE_HANDOFF_RESULT: \${{ needs['linux-release-handoff'].result }}
          POSTGRES_RESULT: \${{ needs.postgres-migrations.result }}
          QUALITY_EVIDENCE_VERIFIED: \${{ needs.quality.outputs.portfolio-evidence-verified }}
          QUALITY_RESULT: \${{ needs.quality.result }}
          SECRETS_RESULT: \${{ needs.secrets.result }}
        shell: /bin/bash --noprofile --norc -Eeuo pipefail {0}
        working-directory: \${{ github.workspace }}
        run: |
          set -euo pipefail
          /usr/bin/test "\${QUALITY_RESULT}" = "success" || exit 1
          /usr/bin/test "\${QUALITY_EVIDENCE_VERIFIED}" = "true" || exit 1
          /usr/bin/test "\${DEPLOY_CONTRACTS_RESULT}" = "success" || exit 1
          /usr/bin/test "\${POSTGRES_RESULT}" = "success" || exit 1
          /usr/bin/test "\${E2E_RESULT}" = "success" || exit 1
          /usr/bin/test "\${DEMO_RESULT}" = "success" || exit 1
          /usr/bin/test "\${FDE_DEMO_RESULT}" = "success" || exit 1
          /usr/bin/test "\${SECRETS_RESULT}" = "success" || exit 1
          /usr/bin/test "\${AUDIT_RESULT}" = "success" || exit 1
          /usr/bin/test "\${LINUX_RELEASE_HANDOFF_RESULT}" = "success" || exit 1
`;

const requiredCiWorkflowPreamble = `name: CI

on:
  push:
    branches: [master]
  pull_request:
  schedule:
    - cron: "17 3 * * 1"
  workflow_dispatch:

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  # master 上的推送不取消，避免最新提交只剩被取消的检查；PR 运行可取消。
  cancel-in-progress: \${{ github.ref != 'refs/heads/master' }}

permissions:
  contents: read

`;

const ciInstallBoundaryGuardStep = `      - name: Reject install-time repository code
        env:
          BASH_ENV: /dev/null
          ENV: /dev/null
          LD_AUDIT: ""
          LD_LIBRARY_PATH: ""
          LD_PRELOAD: ""
          PYTHONHOME: ""
          PYTHONPATH: ""
        shell: /bin/bash --noprofile --norc -Eeuo pipefail {0}
        working-directory: \${{ github.workspace }}
        run: |
          set -euo pipefail
          /usr/bin/test -f ${ciInstallBoundaryPath}
          /usr/bin/test ! -L ${ciInstallBoundaryPath}
          /usr/bin/printf '%s  %s\\n' '${ciInstallBoundarySha256}' '${ciInstallBoundaryPath}' | /usr/bin/sha256sum -c -
          /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -S ${ciInstallBoundaryPath}`;
const ciInstallBoundaryGuardStepName =
  "      - name: Reject install-time repository code";
const guardedCiJobIds = [
  "quality",
  "deploy-contracts",
  "postgres-migrations",
  "e2e",
  "portfolio-demo-e2e",
  "fde-demo-e2e",
  "audit",
  "linux-release-handoff",
] as const;

const qualityCiJob = `  quality:
    name: Lint, typecheck, app coverage, build
    if: github.event_name != 'schedule'
    outputs:
      portfolio-evidence-verified: \${{ steps.portfolio-evidence.outputs.verified }}
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Checkout
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          # portfolio:verify resolves both the current public runtime commit
          # and the last fully documented release lineage.
          fetch-depth: 0

${ciInstallBoundaryGuardStep}

      # pnpm/action-setup 从 package.json 的 packageManager 字段读取固定
      # 版本（pnpm@11.9.0），必须先于 setup-node，使 pnpm 缓存键与 store
      # 路径来自同一版本。
      - name: Install pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0

      - name: Setup Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version-file: .nvmrc
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Application tests with coverage gate (PGlite)
        run: pnpm test:coverage:app

      - name: Verify portfolio evidence snapshot
        id: portfolio-evidence
        env:
          BASH_ENV: /dev/null
          ENV: /dev/null
          LD_AUDIT: ""
          LD_LIBRARY_PATH: ""
          LD_PRELOAD: ""
          NODE_OPTIONS: ""
          NODE_PATH: ""
          PORTFOLIO_EXPECTED_HEAD_SHA: \${{ github.sha }}
          PORTFOLIO_TRUSTED_GIT: /usr/bin/git
        shell: /bin/bash --noprofile --norc -Eeuo pipefail {0}
        working-directory: \${{ github.workspace }}
        run: \${{ runner.tool_cache }}/node/22.22.3/x64/bin/node --conditions=react-server --import tsx scripts/portfolio/verify.ts --release-evidence

      - name: Drizzle migration check
        run: pnpm db:check

      - name: Build
        run: pnpm build

      - name: Upload coverage report
        if: \${{ always() }}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: coverage-report
          path: coverage/
          retention-days: 14
          if-no-files-found: warn`;

const portfolioEvidenceStep = `      - name: Verify portfolio evidence snapshot
        id: portfolio-evidence
        env:
          BASH_ENV: /dev/null
          ENV: /dev/null
          LD_AUDIT: ""
          LD_LIBRARY_PATH: ""
          LD_PRELOAD: ""
          NODE_OPTIONS: ""
          NODE_PATH: ""
          PORTFOLIO_EXPECTED_HEAD_SHA: \${{ github.sha }}
          PORTFOLIO_TRUSTED_GIT: /usr/bin/git
        shell: /bin/bash --noprofile --norc -Eeuo pipefail {0}
        working-directory: \${{ github.workspace }}
        run: \${{ runner.tool_cache }}/node/22.22.3/x64/bin/node --conditions=react-server --import tsx scripts/portfolio/verify.ts --release-evidence`;
const portfolioEvidenceStepName =
  "      - name: Verify portfolio evidence snapshot";

const playwrightEvidenceCiContracts = [
  {
    expectedArtifactUploadCount: 4,
    expectedCaptureCount: 2,
    expectedStepNames: [
      "Checkout",
      "Reject install-time repository code",
      "Install pnpm",
      "Setup Node.js",
      "Install dependencies",
      "Install Playwright Chromium and WebKit",
      "Run Playwright tests",
      "Build the production application for the CSP contract",
      "Run the production CSP contract",
      "Verify public and production CSP Playwright receipts",
      "Upload public Playwright receipt",
      "Upload production CSP Playwright receipt",
      "Upload Playwright report",
      "Upload Playwright traces and screenshots",
    ],
    jobId: "e2e",
    steps: [
      `      - name: Run Playwright tests
        env:
          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "1"
        run: pnpm test:e2e`,
      `      - name: Build the production application for the CSP contract
        run: pnpm build`,
      `      - name: Run the production CSP contract
        env:
          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "1"
        run: pnpm test:e2e:csp:production`,
      `      - name: Verify public and production CSP Playwright receipts
        env:
          BASH_ENV: /dev/null
          ENV: /dev/null
          LD_AUDIT: ""
          LD_LIBRARY_PATH: ""
          LD_PRELOAD: ""
          NODE_OPTIONS: ""
          NODE_PATH: ""
        shell: /bin/bash --noprofile --norc -Eeuo pipefail {0}
        working-directory: \${{ github.workspace }}
        run: pnpm portfolio:verify-playwright-runs -- public production-csp`,
      `      - name: Upload public Playwright receipt
        if: \${{ always() }}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: playwright-public-receipt
          path: test-results/public/playwright-run.json
          retention-days: 14
          if-no-files-found: warn`,
      `      - name: Upload production CSP Playwright receipt
        if: \${{ always() }}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: playwright-production-csp-receipt
          path: test-results/production-csp/playwright-run.json
          retention-days: 14
          if-no-files-found: warn`,
      `      - name: Upload Playwright report
        if: \${{ failure() }}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
          if-no-files-found: warn`,
      `      - name: Upload Playwright traces and screenshots
        if: \${{ failure() }}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: playwright-test-results
          path: test-results/
          retention-days: 14
          if-no-files-found: warn`,
    ],
  },
  {
    expectedArtifactUploadCount: 3,
    expectedCaptureCount: 1,
    expectedStepNames: [
      "Checkout",
      "Reject install-time repository code",
      "Install pnpm",
      "Setup Node.js",
      "Install dependencies",
      "Install Playwright Chromium",
      "Run the portfolio demo contract",
      "Verify portfolio demo Playwright receipt",
      "Upload portfolio demo Playwright receipt",
      "Upload portfolio demo report",
      "Upload Playwright traces and screenshots",
    ],
    jobId: "portfolio-demo-e2e",
    steps: [
      `      - name: Run the portfolio demo contract
        env:
          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "1"
        run: pnpm test:e2e:demo`,
      `      - name: Verify portfolio demo Playwright receipt
        env:
          BASH_ENV: /dev/null
          ENV: /dev/null
          LD_AUDIT: ""
          LD_LIBRARY_PATH: ""
          LD_PRELOAD: ""
          NODE_OPTIONS: ""
          NODE_PATH: ""
        shell: /bin/bash --noprofile --norc -Eeuo pipefail {0}
        working-directory: \${{ github.workspace }}
        run: pnpm portfolio:verify-playwright-runs -- demo`,
      `      - name: Upload portfolio demo Playwright receipt
        if: \${{ always() }}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: playwright-demo-receipt
          path: test-results/demo/playwright-run.json
          retention-days: 14
          if-no-files-found: warn`,
      `      - name: Upload portfolio demo report
        if: \${{ failure() }}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: playwright-demo-report
          path: playwright-demo-report/
          retention-days: 14
          if-no-files-found: warn`,
      `      - name: Upload Playwright traces and screenshots
        if: \${{ failure() }}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: playwright-demo-test-results
          path: test-results/
          retention-days: 14
          if-no-files-found: warn`,
    ],
  },
  {
    expectedArtifactUploadCount: 2,
    expectedCaptureCount: 1,
    expectedStepNames: [
      "Checkout",
      "Reject install-time repository code",
      "Install pnpm",
      "Setup Node.js",
      "Install dependencies",
      "Install Playwright Chromium",
      "Run the failure-first FDE workflow",
      "Verify failure-first FDE Playwright receipt",
      "Upload failure-first FDE Playwright receipt",
      "Upload FDE Playwright traces and screenshots",
    ],
    jobId: "fde-demo-e2e",
    steps: [
      `      - name: Run the failure-first FDE workflow
        env:
          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "1"
        run: pnpm test:e2e:fde`,
      `      - name: Verify failure-first FDE Playwright receipt
        env:
          BASH_ENV: /dev/null
          ENV: /dev/null
          LD_AUDIT: ""
          LD_LIBRARY_PATH: ""
          LD_PRELOAD: ""
          NODE_OPTIONS: ""
          NODE_PATH: ""
        shell: /bin/bash --noprofile --norc -Eeuo pipefail {0}
        working-directory: \${{ github.workspace }}
        run: pnpm portfolio:verify-playwright-runs -- fde`,
      `      - name: Upload failure-first FDE Playwright receipt
        if: \${{ always() }}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: playwright-fde-receipt
          path: test-results/fde/playwright-run.json
          retention-days: 14
          if-no-files-found: warn`,
      `      - name: Upload FDE Playwright traces and screenshots
        if: \${{ failure() }}
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: playwright-fde-test-results
          path: test-results/
          retention-days: 14
          if-no-files-found: warn`,
    ],
  },
] as const;

const canonicalMergeBlockingJobDigests = [
  {
    jobId: "deploy-contracts",
    sha256: "eef755f49d7d0e549c452c5adff3647f057c3423865176a029ff203e4d6b0f80",
  },
  {
    jobId: "postgres-migrations",
    sha256: "ec7a109c01a0653c5e671ff8b28644f7d2d1efc05cd9377acc750fe09c4a4b0c",
  },
  {
    jobId: "e2e",
    sha256: "f794a256d80e6807782be8fc72a34ea4f5ec2ab0574c50b47b2a8910a6d467d7",
  },
  {
    jobId: "portfolio-demo-e2e",
    sha256: "3bc8220fd13afc1623bf54ef18872cb4948fb4ecd5c02a9a69aa780a86a91343",
  },
  {
    jobId: "fde-demo-e2e",
    sha256: "4936be8bdc110e297886434efe0fea44b7ef17d04546c5cdfd0813d2dd0955d3",
  },
  {
    jobId: "secrets",
    sha256: "5599d2dfad7bff8937636c5c35c6d828057c62b3aabb3eff31f21de63dac860a",
  },
  {
    jobId: "audit",
    sha256: "7b883bba03731fee7efc3c5f4de71a72684593f431dd4e934b617c6f893f686f",
  },
  {
    jobId: "linux-release-handoff",
    sha256: "9ffc5646cdc2e480f823977f15b32909532d19d1c1b192915541187c418ee178",
  },
] as const;

export const requiredCiWorkflowPath = ".github/workflows/ci.yml" as const;
const requiredCiGateName = "Required CI gate" as const;
const workflowPathPattern =
  /^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/u;
const workflowJobIdPattern = /^[a-z][a-z0-9-]*$/u;
const workflowRootKeyPattern = /^[A-Za-z0-9_-]+:/gmu;
const maximumWorkflowSourceBytes = 2 * 1024 * 1024;

const directWorkflowJobDeclaration = /^  ([a-z][a-z0-9-]*):$/gmu;
const requiredCiWorkflowJobIds = [
  "quality",
  "deploy-contracts",
  "postgres-migrations",
  "e2e",
  "portfolio-demo-e2e",
  "fde-demo-e2e",
  "secrets",
  "audit",
  "linux-release-handoff",
  "required",
] as const;

type ResolveCiWorkflowSourceOptions = {
  headBound: boolean;
  readHeadSource: () => Uint8Array;
  workspaceSource: Uint8Array;
};

function workflowBytesEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.byteLength !== right.byteLength) return false;

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }

  return true;
}

/**
 * GitHub parses the committed workflow before this verifier starts. In that
 * environment, bind the source checked below to the HEAD blob and reject any
 * workspace rewrite performed by an earlier step. Local verification keeps
 * using the workspace source, so a dirty worktree does not require HEAD byte
 * equality; the canonical workflow check still applies to the selected bytes.
 */
export function resolveCiWorkflowSource({
  headBound,
  readHeadSource,
  workspaceSource,
}: ResolveCiWorkflowSourceOptions): Uint8Array {
  if (!headBound) return workspaceSource;

  let headSource: Uint8Array;
  try {
    headSource = readHeadSource();
  } catch (cause: unknown) {
    throw new Error(
      "Portfolio verification could not read the CI workflow from the HEAD blob.",
      { cause },
    );
  }

  if (!workflowBytesEqual(workspaceSource, headSource)) {
    throw new Error("CI workflow workspace bytes do not match the HEAD blob.");
  }

  return headSource;
}

function normalizeWorkflowSource(source: string): string {
  const normalized = source.replace(/\r\n/gu, "\n");
  if (
    normalized.includes("\r") ||
    normalized.includes("\0") ||
    normalized.includes("\t")
  ) {
    throw new Error("CI workflow contains unsupported control characters.");
  }

  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function directJobSource(
  jobsSource: string,
  jobDeclarations: readonly RegExpMatchArray[],
  jobId: string,
): string {
  const declarationIndex = jobDeclarations.findIndex(
    (match) => match[1] === jobId,
  );
  const jobOffset = jobDeclarations[declarationIndex]?.index;
  const nextJobOffset = jobDeclarations[declarationIndex + 1]?.index;
  if (jobOffset === undefined) {
    throw new Error(`CI workflow ${jobId} job boundary could not be located.`);
  }
  return jobsSource
    .slice(jobOffset, nextJobOffset ?? jobsSource.length)
    .trimEnd();
}

function assertCiInstallBoundaryGuards(
  jobsSource: string,
  jobDeclarations: readonly RegExpMatchArray[],
): void {
  for (const jobId of guardedCiJobIds) {
    const job = directJobSource(jobsSource, jobDeclarations, jobId);
    if (occurrenceCount(job, ciInstallBoundaryGuardStepName) !== 1) {
      throw new Error(
        `CI workflow ${jobId} job must contain exactly one install-boundary guard.`,
      );
    }

    const steps = [...job.matchAll(/^      - name: (.+)$/gmu)];
    if (
      steps[0]?.[1]?.startsWith("Checkout") !== true ||
      steps[1]?.[1] !== "Reject install-time repository code"
    ) {
      throw new Error(
        `CI workflow ${jobId} install-boundary guard must immediately follow checkout.`,
      );
    }
    const guardOffset = steps[1]?.index;
    if (guardOffset === undefined || steps[2]?.index === undefined) {
      throw new Error(
        `CI workflow ${jobId} install-boundary guard boundaries could not be located.`,
      );
    }
    const actualGuard = job
      .slice(guardOffset, guardOffset + ciInstallBoundaryGuardStep.length);
    const guardSuffix = job.slice(
      guardOffset + ciInstallBoundaryGuardStep.length,
    );
    if (
      actualGuard !== ciInstallBoundaryGuardStep ||
      !guardSuffix.startsWith("\n\n")
    ) {
      throw new Error(
        `CI workflow ${jobId} install-boundary guard does not match the canonical pre-pnpm contract.`,
      );
    }
  }
}

function assertCanonicalMergeBlockingJobs(
  jobsSource: string,
  jobDeclarations: readonly RegExpMatchArray[],
): void {
  for (const contract of canonicalMergeBlockingJobDigests) {
    const job = directJobSource(jobsSource, jobDeclarations, contract.jobId);
    const actualDigest = createHash("sha256").update(job, "utf8").digest("hex");
    if (actualDigest !== contract.sha256) {
      throw new Error(
        `CI workflow ${contract.jobId} job does not match its canonical merge-blocking execution contract.`,
      );
    }
  }
}

function parseDoubleQuotedJobName(
  value: string,
  label: string,
): string {
  const match = /^("(?:[^"\\]|\\.)*")(?: +#.*)?$/u.exec(value);
  if (!match) {
    throw new Error(`${label} has a non-static job name.`);
  }
  try {
    const parsed = JSON.parse(match[1] ?? "") as unknown;
    if (typeof parsed !== "string") throw new Error("Expected a string.");
    return parsed;
  } catch (cause: unknown) {
    throw new Error(`${label} has an unsupported quoted job name.`, { cause });
  }
}

function parseSingleQuotedJobName(
  value: string,
  label: string,
): string {
  const match = /^'((?:[^']|'')*)'(?: +#.*)?$/u.exec(value);
  if (!match) {
    throw new Error(`${label} has a non-static job name.`);
  }
  return (match[1] ?? "").replace(/''/gu, "'");
}

function parsePlainJobName(value: string, label: string): string {
  const commentOffset = value.search(/ +#/u);
  const name = (commentOffset === -1 ? value : value.slice(0, commentOffset))
    .trimEnd();
  if (
    name.length === 0 ||
    /^[>&*!|\[\]{}]/u.test(name) ||
    /[\\\[\]{}]/u.test(name) ||
    name.includes("${{") ||
    name.includes(": ")
  ) {
    throw new Error(`${label} has a dynamic or ambiguous job name.`);
  }
  return name;
}

function parseStaticJobName(value: string, label: string): string {
  const trimmed = value.trim();
  let name: string;
  if (trimmed.startsWith('"')) {
    name = parseDoubleQuotedJobName(trimmed, label);
  } else if (trimmed.startsWith("'")) {
    name = parseSingleQuotedJobName(trimmed, label);
  } else {
    name = parsePlainJobName(trimmed, label);
  }
  if (
    name.length === 0 ||
    name.includes("${{") ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    throw new Error(`${label} has a dynamic or invalid job name.`);
  }
  return name;
}

function directWorkflowJobNames(
  source: string,
  path: string,
): Array<{ id: string; name: string }> {
  const normalized = normalizeWorkflowSource(source);
  if (Buffer.byteLength(normalized, "utf8") > maximumWorkflowSourceBytes) {
    throw new Error(`GitHub workflow exceeds the 2 MiB policy limit: ${path}`);
  }
  const jobsMarkers = [...normalized.matchAll(/^jobs:$/gmu)];
  if (jobsMarkers.length !== 1 || jobsMarkers[0]?.index === undefined) {
    throw new Error(`${path} must contain exactly one auditable jobs mapping.`);
  }
  const jobsStart = jobsMarkers[0].index + "jobs:\n".length;
  const jobsTail = normalized.slice(jobsStart);
  const followingRoot = [...jobsTail.matchAll(workflowRootKeyPattern)]
    .find((match) => match.index !== undefined);
  const jobsSource = jobsTail.slice(0, followingRoot?.index ?? jobsTail.length);

  for (const line of jobsSource.split("\n")) {
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
    const indentation = /^ */u.exec(line)?.[0].length ?? 0;
    if (indentation < 2 || indentation === 3) {
      throw new Error(`${path} contains a non-auditable jobs mapping.`);
    }
    if (indentation === 2) {
      const declaration = /^  ([a-z][a-z0-9-]*):$/u.exec(line);
      if (!declaration || !workflowJobIdPattern.test(declaration[1] ?? "")) {
        throw new Error(`${path} contains a non-auditable job declaration.`);
      }
    }
  }

  const declarations = [...jobsSource.matchAll(directWorkflowJobDeclaration)];
  if (declarations.length === 0) {
    throw new Error(`${path} does not contain an auditable workflow job.`);
  }
  return declarations.map((declaration, index) => {
    const id = declaration[1] ?? "";
    const start = declaration.index;
    const end = declarations[index + 1]?.index ?? jobsSource.length;
    if (start === undefined) {
      throw new Error(`${path} has an invalid ${id || "unknown"} job boundary.`);
    }
    const jobSource = jobsSource.slice(start, end);
    const jobLines = jobSource.split("\n").slice(1);
    const names: string[] = [];
    for (const [lineIndex, line] of jobLines.entries()) {
      if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
        continue;
      }
      if ((/^ */u.exec(line)?.[0].length ?? 0) !== 4) continue;
      const mapping = /^    ([A-Za-z][A-Za-z0-9-]*):(?: +(.*))?$/u.exec(line);
      if (!mapping) {
        throw new Error(`${path} ${id} has a non-auditable job mapping.`);
      }
      if (mapping[1] === "name") {
        names.push(
          parseStaticJobName(
            mapping[2] ?? "",
            `${path} ${id}`,
          ),
        );
        for (const followingLine of jobLines.slice(lineIndex + 1)) {
          if (
            followingLine.trim().length === 0 ||
            followingLine.trimStart().startsWith("#")
          ) {
            continue;
          }
          const followingIndent = /^ */u.exec(followingLine)?.[0].length ?? 0;
          if (followingIndent <= 4) break;
          throw new Error(`${path} ${id} has a multiline job name.`);
        }
      }
    }
    if (names.length > 1) {
      throw new Error(`${path} ${id} contains duplicate job names.`);
    }
    return { id, name: names[0] ?? id };
  });
}

export type CiWorkflowSource = Readonly<{
  path: string;
  source: string;
}>;

/**
 * Reserves the branch-protection context for the canonical CI job. Dynamic or
 * structurally opaque job names fail closed because their rendered value
 * cannot be proven distinct without evaluating GitHub expressions.
 */
export function assertUniqueRequiredCiGateAcrossWorkflows(
  workflows: readonly CiWorkflowSource[],
): void {
  if (workflows.length === 0 || workflows.length > 100) {
    throw new Error("Expected between 1 and 100 GitHub workflow sources.");
  }
  const paths = workflows.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    throw new Error("GitHub workflow source paths must be unique.");
  }
  if (!paths.includes(requiredCiWorkflowPath)) {
    throw new Error(`GitHub workflow set is missing ${requiredCiWorkflowPath}.`);
  }

  const reservedJobs: Array<{ id: string; path: string }> = [];
  for (const workflow of workflows) {
    if (!workflowPathPattern.test(workflow.path)) {
      throw new Error(`Unsafe or unsupported GitHub workflow path: ${workflow.path}`);
    }
    for (const job of directWorkflowJobNames(workflow.source, workflow.path)) {
      if (job.name === requiredCiGateName) {
        reservedJobs.push({ id: job.id, path: workflow.path });
      }
    }
  }
  if (
    reservedJobs.length !== 1 ||
    reservedJobs[0]?.path !== requiredCiWorkflowPath ||
    reservedJobs[0]?.id !== "required"
  ) {
    throw new Error(
      "Required CI gate must be declared exactly once by the canonical ci.yml required job.",
    );
  }
}

function occurrenceCount(source: string, value: string): number {
  return source.split(value).length - 1;
}

function assertPlaywrightEvidenceCiJobs(
  jobsSource: string,
  jobDeclarations: readonly RegExpMatchArray[],
): void {
  for (const contract of playwrightEvidenceCiContracts) {
    const declarationIndex = jobDeclarations.findIndex(
      (match) => match[1] === contract.jobId,
    );
    const jobOffset = jobDeclarations[declarationIndex]?.index;
    const nextJobOffset = jobDeclarations[declarationIndex + 1]?.index;
    if (jobOffset === undefined || nextJobOffset === undefined) {
      throw new Error(
        `CI workflow ${contract.jobId} Playwright evidence job boundaries could not be located.`,
      );
    }

    const jobSource = jobsSource.slice(jobOffset, nextJobOffset);
    if (/^    (?:continue-on-error|defaults|env):/gmu.test(jobSource)) {
      throw new Error(
        `CI workflow ${contract.jobId} Playwright evidence job has an unsupported job-level execution override.`,
      );
    }
    const actualStepNames = [...jobSource.matchAll(/^      - name: (.+)$/gmu)]
      .map((match) => match[1]);
    const stepDeclarations = [...jobSource.matchAll(/^      - /gmu)];
    if (
      stepDeclarations.length !== contract.expectedStepNames.length ||
      JSON.stringify(actualStepNames) !==
        JSON.stringify(contract.expectedStepNames)
    ) {
      throw new Error(
        `CI workflow ${contract.jobId} Playwright step inventory drifted.`,
      );
    }

    let previousStepOffset = -1;
    for (const expectedStep of contract.steps) {
      const firstNewline = expectedStep.indexOf("\n");
      const stepName = firstNewline === -1
        ? expectedStep
        : expectedStep.slice(0, firstNewline);
      if (occurrenceCount(jobSource, stepName) !== 1) {
        throw new Error(
          `CI workflow ${contract.jobId} must contain exactly one canonical ${stepName.trim()} step.`,
        );
      }

      const stepOffset = jobSource.indexOf(stepName);
      const followingStepOffset = jobSource.indexOf(
        "\n      - ",
        stepOffset + stepName.length,
      );
      const actualStep = jobSource
        .slice(
          stepOffset,
          followingStepOffset === -1 ? jobSource.length : followingStepOffset,
        )
        .trimEnd();
      if (actualStep !== expectedStep) {
        throw new Error(
          `CI workflow ${contract.jobId} ${stepName.trim()} does not match the canonical Playwright evidence contract.`,
        );
      }
      if (stepOffset <= previousStepOffset) {
        throw new Error(
          `CI workflow ${contract.jobId} Playwright evidence steps are out of order.`,
        );
      }
      previousStepOffset = stepOffset;
    }

    if (
      occurrenceCount(
        jobSource,
        '          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "1"',
      ) !== contract.expectedCaptureCount
    ) {
      throw new Error(
        `CI workflow ${contract.jobId} Playwright evidence capture count drifted.`,
      );
    }
    if (
      occurrenceCount(jobSource, "portfolio:verify-playwright-runs") !== 1
    ) {
      throw new Error(
        `CI workflow ${contract.jobId} must execute exactly one Playwright receipt verifier.`,
      );
    }
    if (
      occurrenceCount(jobSource, "uses: actions/upload-artifact@") !==
      contract.expectedArtifactUploadCount
    ) {
      throw new Error(
        `CI workflow ${contract.jobId} Playwright artifact upload inventory drifted.`,
      );
    }
  }
}

/**
 * The branch-protected check is only trustworthy when both the evidence
 * producer and its aggregation shell remain canonical. Keep this parser
 * stricter than general YAML: inherited execution settings, the quality job,
 * Playwright capture/verification/artifact steps, every dependency, the
 * execution proof, and every explicit exit are locked so duplicate keys or
 * additional shell commands fail closed.
 */
export function assertRequiredCiGateWorkflow(source: string): void {
  const normalized = normalizeWorkflowSource(source);
  const jobsMarkers = [...normalized.matchAll(/^jobs:$/gmu)];
  if (jobsMarkers.length !== 1) {
    throw new Error(
      "CI workflow must contain exactly one canonical root jobs mapping.",
    );
  }

  const jobsOffset = jobsMarkers[0]?.index;
  if (jobsOffset === undefined) {
    throw new Error("CI workflow jobs mapping could not be located.");
  }

  const workflowPreamble = normalized.slice(0, jobsOffset);
  if (workflowPreamble !== requiredCiWorkflowPreamble) {
    throw new Error(
      "CI workflow preamble does not match the canonical execution contract.",
    );
  }

  const jobsSource = normalized.slice(jobsOffset + "jobs:\n".length);
  const jobDeclarations = [...jobsSource.matchAll(directWorkflowJobDeclaration)];
  const jobIds = jobDeclarations.map((match) => match[1]);
  if (
    jobIds.length !== requiredCiWorkflowJobIds.length ||
    jobIds.some((jobId, index) => jobId !== requiredCiWorkflowJobIds[index])
  ) {
    throw new Error(
      "CI workflow job inventory does not match the canonical merge-blocking contract.",
    );
  }

  const qualityIndex = jobIds.indexOf("quality");
  const qualityOffset = jobDeclarations[qualityIndex]?.index;
  const nextJobOffset = jobDeclarations[qualityIndex + 1]?.index;
  if (qualityOffset === undefined || nextJobOffset === undefined) {
    throw new Error("CI workflow quality job boundaries could not be located.");
  }
  const qualityJob = jobsSource.slice(qualityOffset, nextJobOffset);
  const namedStepLines = normalized
    .split("\n")
    .filter((line) => line === portfolioEvidenceStepName);
  if (namedStepLines.length !== 1) {
    throw new Error(
      "CI workflow must contain exactly one canonical portfolio evidence step.",
    );
  }
  const portfolioStepOffset = qualityJob.indexOf(portfolioEvidenceStepName);
  if (portfolioStepOffset === -1) {
    throw new Error(
      "CI workflow portfolio evidence step must belong to the quality job.",
    );
  }
  const followingStepOffset = qualityJob.indexOf(
    "\n      - ",
    portfolioStepOffset + portfolioEvidenceStepName.length,
  );
  const actualPortfolioStep = qualityJob
    .slice(
      portfolioStepOffset,
      followingStepOffset === -1 ? qualityJob.length : followingStepOffset,
    )
    .trimEnd();
  if (actualPortfolioStep !== portfolioEvidenceStep) {
    throw new Error(
      "CI workflow portfolio evidence step does not match the canonical direct verifier command.",
    );
  }
  if (qualityJob.trimEnd() !== qualityCiJob) {
    throw new Error(
      "CI workflow quality job does not match the canonical execution contract.",
    );
  }

  assertCiInstallBoundaryGuards(jobsSource, jobDeclarations);
  assertPlaywrightEvidenceCiJobs(jobsSource, jobDeclarations);
  assertCanonicalMergeBlockingJobs(jobsSource, jobDeclarations);

  const requiredDeclarations = jobDeclarations.filter(
    (match) => match[1] === "required",
  );
  if (requiredDeclarations.length !== 1) {
    throw new Error(
      "CI workflow must contain exactly one required job declaration.",
    );
  }

  const requiredDeclaration = requiredDeclarations[0];
  const requiredOffset = requiredDeclaration?.index;
  if (requiredOffset === undefined) {
    throw new Error("Required CI gate declaration could not be located.");
  }

  const followingJob = jobDeclarations.find(
    (match) => (match.index ?? -1) > requiredOffset,
  );
  if (followingJob !== undefined) {
    throw new Error("Required CI gate must be the final workflow job.");
  }

  const actualRequiredJob = jobsSource.slice(requiredOffset);
  if (actualRequiredJob !== requiredCiGateJob) {
    throw new Error(
      "Required CI gate does not match the canonical fail-closed contract.",
    );
  }
}
