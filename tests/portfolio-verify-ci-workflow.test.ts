import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertCanonicalCiPackageScripts,
  assertCiGitleaksGuardSource,
  assertCiInstallBoundarySource,
  assertRequiredCiGateWorkflow,
  assertUniqueRequiredCiGateAcrossWorkflows,
  ciGitleaksGuardPath,
  ciInstallBoundaryPath,
  ciInstallBoundarySha256,
  requiredCiWorkflowPath,
  resolveCiWorkflowSource,
} from "../scripts/portfolio/verify-ci-workflow";

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

async function readWorkflow(): Promise<string> {
  return readFile(
    resolve(process.cwd(), ".github/workflows/ci.yml"),
    "utf8",
  );
}

async function readPackageManifest(): Promise<string> {
  return readFile(resolve(process.cwd(), "package.json"), "utf8");
}

const installBoundaryInputPaths = [
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  ".nvmrc",
  "patches/next@16.3.6.patch",
  "patches/@next__eslint-plugin-next@16.3.6.patch",
  "patches/@vitest__runner@4.1.11.patch",
  "patches/vaul@1.1.2.patch",
] as const;

async function createInstallBoundaryFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "diesel-ci-install-boundary-"));
  await Promise.all(
    installBoundaryInputPaths.map(async (path) => {
      const bytes = await readFile(resolve(process.cwd(), path));
      await mkdir(dirname(resolve(directory, path)), { recursive: true });
      await writeFile(resolve(directory, path), bytes, { mode: 0o644 });
    }),
  );
  return directory;
}

function runInstallBoundaryGuard(directory: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    "/usr/bin/python3",
    ["-I", "-S", resolve(process.cwd(), ciInstallBoundaryPath)],
    {
      cwd: directory,
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: "/usr/bin:/bin" },
    },
  );
}

async function withInstallBoundaryFixture(
  run: (directory: string) => Promise<void> | void,
): Promise<void> {
  const directory = await createInstallBoundaryFixture();
  try {
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function readCheckedInWorkflows(): Promise<
  Array<{ path: string; source: string }>
> {
  const productionCanaryPath = ".github/workflows/production-canary.yml";
  const [ci, productionCanary] = await Promise.all([
    readWorkflow(),
    readFile(resolve(process.cwd(), productionCanaryPath), "utf8"),
  ]);
  return [
    { path: requiredCiWorkflowPath, source: ci },
    { path: productionCanaryPath, source: productionCanary },
  ];
}

function replaceRequired(source: string, before: string, after: string): string {
  const requiredStart = source.indexOf("\n  required:\n");
  if (requiredStart < 0) {
    throw new Error("Test workflow does not contain the required job.");
  }

  const prefix = source.slice(0, requiredStart);
  const required = source.slice(requiredStart);
  const mutated = required.replace(before, after);
  if (mutated === required) {
    throw new Error(`Test mutation did not match: ${before}`);
  }

  return `${prefix}${mutated}`;
}

function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) {
    throw new Error(`Test mutation must match exactly once: ${before}`);
  }
  return source.replace(before, after);
}

function replaceInJob(
  source: string,
  jobId: string,
  before: string,
  after: string,
): string {
  const marker = `\n  ${jobId}:\n`;
  const jobStart = source.indexOf(marker);
  if (jobStart < 0) {
    throw new Error(`Test workflow does not contain the ${jobId} job.`);
  }
  const contentStart = jobStart + marker.length;
  const followingJob = /\n  [a-z][a-z0-9-]*:\n/u.exec(
    source.slice(contentStart),
  );
  const jobEnd = followingJob === null
    ? source.length
    : contentStart + followingJob.index;
  const jobSource = source.slice(jobStart, jobEnd);
  const mutatedJob = replaceOnce(jobSource, before, after);

  return `${source.slice(0, jobStart)}${mutatedJob}${source.slice(jobEnd)}`;
}

describe("Required CI gate workflow contract", () => {
  it("accepts the checked-in canonical fail-closed gate", async () => {
    await expect(
      readWorkflow().then(assertRequiredCiGateWorkflow),
    ).resolves.toBeUndefined();
  });

  it.each([
    {
      after: "          set -euo pipefail\n          set +e\n",
      before: "          set -euo pipefail\n",
      name: "errexit disablement",
    },
    {
      after: "        shell: true {0}\n",
      before:
        "        shell: /bin/bash --noprofile --norc -Eeuo pipefail {0}\n",
      name: "a no-op aggregation shell",
    },
    {
      after: "          BASH_ENV: /tmp/injected-shell\n",
      before: "          BASH_ENV: /dev/null\n",
      name: "aggregation shell startup injection",
    },
    {
      after:
        '          /usr/bin/test "${QUALITY_RESULT}" = "success" || true\n',
      before:
        '          /usr/bin/test "${QUALITY_RESULT}" = "success" || exit 1\n',
      name: "successful failure fallback",
    },
    {
      after: '          /usr/bin/test "${QUALITY_RESULT}" = "success"\n',
      before:
        '          /usr/bin/test "${QUALITY_RESULT}" = "success" || exit 1\n',
      name: "implicit errexit dependency",
    },
    {
      after:
        '          /usr/bin/test "${QUALITY_RESULT}" = "success" || exit 1\n' +
        "          true\n",
      before:
        '          /usr/bin/test "${QUALITY_RESULT}" = "success" || exit 1\n',
      name: "additional shell command",
    },
    {
      after: "      - quality\n      - quality\n",
      before: "      - quality\n",
      name: "duplicate dependency",
    },
    {
      after: "",
      before: "      - quality\n",
      name: "missing dependency",
    },
    {
      after: "    needs:\n    needs:\n",
      before: "    needs:\n",
      name: "duplicate needs mapping",
    },
    {
      after: "",
      before: "    needs:\n",
      name: "missing needs mapping",
    },
    {
      after:
        "          QUALITY_RESULT: ${{ needs.quality.result }}\n" +
        "          QUALITY_RESULT: ${{ needs.quality.result }}\n",
      before: "          QUALITY_RESULT: ${{ needs.quality.result }}\n",
      name: "duplicate result binding",
    },
    {
      after: "",
      before: "          QUALITY_RESULT: ${{ needs.quality.result }}\n",
      name: "missing result binding",
    },
    {
      after: "",
      before:
        "          QUALITY_EVIDENCE_VERIFIED: ${{ needs.quality.outputs.portfolio-evidence-verified }}\n",
      name: "missing portfolio execution proof binding",
    },
    {
      after: "",
      before:
        '          /usr/bin/test "${QUALITY_EVIDENCE_VERIFIED}" = "true" || exit 1\n',
      name: "missing portfolio execution proof assertion",
    },
    {
      after: "        env:\n        env:\n",
      before: "        env:\n",
      name: "duplicate env mapping",
    },
    {
      after: "",
      before: "        env:\n",
      name: "missing env mapping",
    },
    {
      after: "        run: |\n        run: |\n",
      before: "        run: |\n",
      name: "duplicate run mapping",
    },
    {
      after: "",
      before: "        run: |\n",
      name: "missing run mapping",
    },
  ])("rejects $name", async ({ after, before }) => {
    const workflow = replaceRequired(await readWorkflow(), before, after);

    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow(
      /canonical fail-closed contract/u,
    );
  });

  it("rejects duplicate required job declarations", async () => {
    const workflow = (await readWorkflow()).replace(
      "\n  required:\n",
      "\n  required:\n  required:\n",
    );

    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow();
  });

  it.each([
    {
      mutate: (source: string) =>
        replaceOnce(source, `${portfolioEvidenceStep}\n\n`, ""),
      name: "a deleted portfolio evidence step",
    },
    {
      mutate: (source: string) =>
        replaceOnce(
          source,
          "        run: ${{ runner.tool_cache }}/node/22.22.3/x64/bin/node --conditions=react-server --import tsx scripts/portfolio/verify.ts --release-evidence",
          "        run: true",
        ),
      name: "a no-op portfolio evidence command",
    },
    {
      mutate: (source: string) =>
        replaceOnce(
          source,
          "        run: ${{ runner.tool_cache }}/node/22.22.3/x64/bin/node --conditions=react-server --import tsx scripts/portfolio/verify.ts --release-evidence",
          "        run: ${{ runner.tool_cache }}/node/22.22.3/x64/bin/node --conditions=react-server --import tsx scripts/portfolio/verify.ts",
        ),
      name: "portfolio verification without release-evidence enforcement",
    },
    {
      mutate: (source: string) =>
        replaceOnce(
          source,
          "          PORTFOLIO_EXPECTED_HEAD_SHA: ${{ github.sha }}\n",
          "",
        ),
      name: "portfolio verification without an event commit binding",
    },
    {
      mutate: (source: string) =>
        replaceOnce(
          source,
          "          PORTFOLIO_EXPECTED_HEAD_SHA: ${{ github.sha }}",
          "          PORTFOLIO_EXPECTED_HEAD_SHA: ${{ github.event.pull_request.base.sha }}",
        ),
      name: "portfolio verification bound to the pull request base",
    },
    {
      mutate: (source: string) =>
        replaceOnce(source, "          PORTFOLIO_TRUSTED_GIT: /usr/bin/git\n", ""),
      name: "portfolio verification without a trusted Git executable",
    },
    {
      mutate: (source: string) =>
        replaceOnce(
          source,
          "          PORTFOLIO_TRUSTED_GIT: /usr/bin/git",
          "          PORTFOLIO_TRUSTED_GIT: /tmp/fake-git",
        ),
      name: "portfolio verification with a non-canonical Git executable",
    },
    {
      mutate: (source: string) =>
        replaceOnce(
          source,
          portfolioEvidenceStep,
          `${portfolioEvidenceStep}\n\n${portfolioEvidenceStep}`,
        ),
      name: "a duplicate portfolio evidence step",
    },
    {
      mutate: (source: string) => {
        const withoutQualityStep = replaceOnce(
          source,
          `${portfolioEvidenceStep}\n\n`,
          "",
        );
        return replaceOnce(
          withoutQualityStep,
          "      - name: Run deployment script contracts\n        run: pnpm test:deploy:contracts",
          "      - name: Run deployment script contracts\n" +
            "        run: pnpm test:deploy:contracts\n\n" +
            portfolioEvidenceStep,
        );
      },
      name: "a portfolio evidence step moved to another job",
    },
  ])("rejects $name", async ({ mutate }) => {
    const workflow = mutate(await readWorkflow());
    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow(
      /portfolio evidence step/u,
    );
  });

  it.each([
    {
      expectedError: /workflow preamble/u,
      mutate: (source: string) =>
        replaceOnce(
          source,
          "\npermissions:\n",
          "\ndefaults:\n  run:\n    shell: true {0}\n\npermissions:\n",
        ),
      name: "workflow-level no-op shell inheritance",
    },
    {
      expectedError: /workflow preamble/u,
      mutate: (source: string) =>
        replaceOnce(
          source,
          "\npermissions:\n",
          "\nenv:\n  PATH: /tmp/fake-bin\n\npermissions:\n",
        ),
      name: "workflow-level command-path injection",
    },
    {
      expectedError: /quality job/u,
      mutate: (source: string) =>
        replaceOnce(
          source,
          "      portfolio-evidence-verified: ${{ steps.portfolio-evidence.outputs.verified }}",
          "      portfolio-evidence-verified: true",
        ),
      name: "a forged portfolio execution proof",
    },
    {
      expectedError: /quality job/u,
      mutate: (source: string) =>
        replaceOnce(
          source,
          "    outputs:\n" +
            "      portfolio-evidence-verified: ${{ steps.portfolio-evidence.outputs.verified }}\n" +
            "    runs-on: ubuntu-latest\n" +
            "    timeout-minutes: 30\n" +
            "    steps:\n",
          "    outputs:\n" +
            "      portfolio-evidence-verified: ${{ steps.portfolio-evidence.outputs.verified }}\n" +
            "    runs-on: ubuntu-latest\n" +
            "    timeout-minutes: 30\n" +
            "    defaults:\n" +
            "      run:\n" +
            "        shell: true {0}\n" +
            "    steps:\n",
        ),
      name: "quality-level no-op shell inheritance",
    },
    {
      expectedError: /quality job/u,
      mutate: (source: string) =>
        replaceOnce(
          source,
          "    outputs:\n" +
            "      portfolio-evidence-verified: ${{ steps.portfolio-evidence.outputs.verified }}\n" +
            "    runs-on: ubuntu-latest\n" +
            "    timeout-minutes: 30\n" +
            "    steps:\n",
          "    outputs:\n" +
            "      portfolio-evidence-verified: ${{ steps.portfolio-evidence.outputs.verified }}\n" +
            "    runs-on: ubuntu-latest\n" +
            "    timeout-minutes: 30\n" +
            "    env:\n" +
            '      NODE_OPTIONS: "--import=data:text/javascript,process.exit(0)"\n' +
            "    steps:\n",
        ),
      name: "quality-level Node preload injection",
    },
    {
      expectedError: /quality job/u,
      mutate: (source: string) =>
        replaceOnce(
          source,
          "    outputs:\n" +
            "      portfolio-evidence-verified: ${{ steps.portfolio-evidence.outputs.verified }}\n" +
            "    runs-on: ubuntu-latest\n" +
            "    timeout-minutes: 30\n" +
            "    steps:\n",
          "    outputs:\n" +
            "      portfolio-evidence-verified: ${{ steps.portfolio-evidence.outputs.verified }}\n" +
            "    runs-on: ubuntu-latest\n" +
            "    timeout-minutes: 30\n" +
            "    continue-on-error: true\n" +
            "    steps:\n",
        ),
      name: "quality-level continue-on-error ambiguity",
    },
    {
      expectedError: /portfolio evidence step/u,
      mutate: (source: string) =>
        replaceOnce(
          source,
          "      - name: Verify portfolio evidence snapshot\n" +
            "        id: portfolio-evidence\n" +
            "        env:\n",
          "      - name: Verify portfolio evidence snapshot\n" +
            "        id: portfolio-evidence\n" +
            "        continue-on-error: true\n" +
            "        env:\n",
        ),
      name: "step-level swallowed verifier failure",
    },
    {
      expectedError: /portfolio evidence step/u,
      mutate: (source: string) =>
        replaceOnce(
          source,
          "      - name: Verify portfolio evidence snapshot\n" +
            "        id: portfolio-evidence\n" +
            "        env:\n",
          "      - name: Verify portfolio evidence snapshot\n" +
            "        id: portfolio-evidence\n" +
            "        if: false\n" +
            "        env:\n",
        ),
      name: "step-level skipped verifier",
    },
    {
      expectedError: /portfolio evidence step/u,
      mutate: (source: string) => {
        const mutatedStep = portfolioEvidenceStep.replace(
          '          NODE_PATH: ""\n' +
            "          PORTFOLIO_EXPECTED_HEAD_SHA: ${{ github.sha }}\n" +
            "          PORTFOLIO_TRUSTED_GIT: /usr/bin/git\n" +
            "        shell: /bin/bash --noprofile --norc -Eeuo pipefail {0}",
          '          NODE_PATH: ""\n' +
            "          PORTFOLIO_EXPECTED_HEAD_SHA: ${{ github.sha }}\n" +
            "          PORTFOLIO_TRUSTED_GIT: /usr/bin/git\n" +
            "        shell: true {0}",
        );
        return replaceOnce(source, portfolioEvidenceStep, mutatedStep);
      },
      name: "step-level no-op shell override",
    },
    {
      expectedError: /portfolio evidence step/u,
      mutate: (source: string) => {
        const mutatedStep = portfolioEvidenceStep.replace(
          '          NODE_OPTIONS: ""',
          '          NODE_OPTIONS: "--import=data:text/javascript,process.exit(0)"',
        );
        return replaceOnce(source, portfolioEvidenceStep, mutatedStep);
      },
      name: "step-level Node preload injection",
    },
  ])("rejects $name", async ({ expectedError, mutate }) => {
    const workflow = mutate(await readWorkflow());
    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow(expectedError);
  });

  it("rejects a workflow job that is omitted from the required dependency closure", async () => {
    const workflow = (await readWorkflow()).replace(
      "\n  required:\n",
      "\n  unaggregated-check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: false\n\n  required:\n",
    );

    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow(
      /job inventory/u,
    );
  });
});

describe("canonical merge-blocking job execution", () => {
  it.each([
    {
      after: "        run: true",
      before: "        run: pnpm test:deploy:contracts",
      jobId: "deploy-contracts",
      name: "deployment contract no-op",
    },
    {
      after: "    timeout-minutes: 30",
      before: "    timeout-minutes: 45",
      jobId: "deploy-contracts",
      name: "deployment contract timeout margin removed",
    },
    {
      after: "",
      before:
        "\n      - name: Run deployment script contracts\n" +
        "        run: pnpm test:deploy:contracts",
      jobId: "deploy-contracts",
      name: "deleted deployment contract step",
    },
    {
      after:
        "        image: pgvector/pgvector:pg16 # mutable tag",
      before:
        "        image: pgvector/pgvector@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b # pg16",
      jobId: "postgres-migrations",
      name: "mutable PostgreSQL service image",
    },
    {
      after: "        run: true",
      before: "        run: pnpm db:smoke:upgrade",
      jobId: "postgres-migrations",
      name: "PostgreSQL upgrade smoke no-op",
    },
    {
      after:
        "        run: |\n" +
        "          pnpm install --frozen-lockfile\n" +
        "          true",
      before: "        run: pnpm install --frozen-lockfile",
      jobId: "e2e",
      name: "public Playwright dependency-install command injection",
    },
    {
      after: "        run: pnpm install --no-frozen-lockfile",
      before: "        run: pnpm install --frozen-lockfile",
      jobId: "portfolio-demo-e2e",
      name: "portfolio Playwright unlocked dependency install",
    },
    {
      after: "        run: pnpm exec playwright install chromium",
      before: "        run: pnpm exec playwright install --with-deps chromium",
      jobId: "fde-demo-e2e",
      name: "FDE Playwright browser install without system dependencies",
    },
    {
      after: "",
      before:
        "\n      - name: Verify governance PostgreSQL concurrency\n" +
        "        env:\n" +
        "          DATABASE_MODE: postgres\n" +
        '          DIESEL_POSTGRES_CONCURRENCY_SMOKE: "1"\n' +
        "          NODE_ENV: production\n" +
        "        run: pnpm db:smoke:governance-concurrency",
      jobId: "postgres-migrations",
      name: "deleted PostgreSQL concurrency check",
    },
    {
      after: "",
      before:
        "\n      - name: Verify AI chat rate-limit PostgreSQL concurrency\n" +
        "        env:\n" +
        "          DATABASE_MODE: postgres\n" +
        '          DIESEL_POSTGRES_CONCURRENCY_SMOKE: "1"\n' +
        "          NODE_ENV: production\n" +
        "        run: pnpm db:smoke:rate-limit-concurrency",
      jobId: "postgres-migrations",
      name: "deleted AI chat rate-limit PostgreSQL concurrency check",
    },
    {
      after:
        "          /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -S scripts/ci/run-gitleaks.py ./gitleaks || true",
      before:
        "          /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -S scripts/ci/run-gitleaks.py ./gitleaks",
      jobId: "secrets",
      name: "swallowed full-history secret scan failure",
    },
    {
      after: "",
      before:
        "          /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -S scripts/ci/run-gitleaks.py ./gitleaks",
      jobId: "secrets",
      name: "deleted full-history scan and canary verification",
    },
    {
      after: "",
      before:
        "\n      - name: Enforce immutable GitHub Action references\n" +
        "        run: pnpm audit:actions",
      jobId: "audit",
      name: "deleted action pin audit",
    },
    {
      after: "        run: true",
      before: "        run: pnpm audit:security",
      jobId: "audit",
      name: "dependency advisory audit no-op",
    },
    {
      after: "          true # release input manifest bypassed",
      before:
        "          node scripts/deploy/release-input-manifest.mjs \\\n" +
        '            create "${release_id}" "${release_export}/.release-input-manifest.json"',
      jobId: "linux-release-handoff",
      name: "Linux release manifest no-op",
    },
    {
      after:
        "    timeout-minutes: 60\n    continue-on-error: true\n    steps:",
      before: "    timeout-minutes: 60\n    steps:",
      jobId: "linux-release-handoff",
      name: "failure-swallowing Linux handoff job",
    },
  ])("rejects $name", async ({ after, before, jobId }) => {
    const workflow = replaceInJob(
      await readWorkflow(),
      jobId,
      before,
      after,
    );

    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow(
      new RegExp(`${jobId} job.*canonical merge-blocking`, "u"),
    );
  });
});

describe("pre-install repository-code boundary", () => {
  const guardedJobIds = [
    "quality",
    "deploy-contracts",
    "postgres-migrations",
    "e2e",
    "portfolio-demo-e2e",
    "fde-demo-e2e",
    "audit",
    "linux-release-handoff",
  ] as const;
  const dependencyInstallJobIds = guardedJobIds.filter(
    (jobId) => jobId !== "linux-release-handoff",
  );

  it.each(guardedJobIds)(
    "rejects removing the pre-pnpm guard from %s",
    async (jobId) => {
      const workflow = replaceInJob(
        await readWorkflow(),
        jobId,
        "      - name: Reject install-time repository code",
        "      - name: Trust unverified install-time repository code",
      );

      expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow();
    },
  );

  it.each(guardedJobIds)(
    "rejects changing the pinned guard digest in %s",
    async (jobId) => {
      const workflow = replaceInJob(
        await readWorkflow(),
        jobId,
        ciInstallBoundarySha256,
        "0".repeat(64),
      );

      expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow();
    },
  );

  it.each(
    dependencyInstallJobIds.flatMap((jobId) => [
      { flag: "--ignore-scripts", jobId },
      { flag: "--ignore-pnpmfile", jobId },
    ]),
  )("rejects removing $flag from the $jobId install", async ({ flag, jobId }) => {
    const canonical =
      "pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile";
    const workflow = replaceInJob(
      await readWorkflow(),
      jobId,
      canonical,
      canonical.replace(` ${flag}`, ""),
    );

    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow();
  });
});

describe("Playwright CI evidence contracts", () => {
  it.each([
    {
      after:
        "      - name: Run Playwright tests\n" +
        "        run: pnpm test:e2e",
      before:
        "      - name: Run Playwright tests\n" +
        "        env:\n" +
        '          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "1"\n' +
        "        run: pnpm test:e2e",
      jobId: "e2e",
      name: "public suite",
    },
    {
      after:
        "      - name: Run the production CSP contract\n" +
        "        env:\n" +
        '          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "0"\n' +
        "        run: pnpm test:e2e:csp:production",
      before:
        "      - name: Run the production CSP contract\n" +
        "        env:\n" +
        '          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "1"\n' +
        "        run: pnpm test:e2e:csp:production",
      jobId: "e2e",
      name: "production CSP suite",
    },
    {
      after:
        "      - name: Run the portfolio demo contract\n" +
        "        run: pnpm test:e2e:demo",
      before:
        "      - name: Run the portfolio demo contract\n" +
        "        env:\n" +
        '          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "1"\n' +
        "        run: pnpm test:e2e:demo",
      jobId: "portfolio-demo-e2e",
      name: "portfolio demo suite",
    },
    {
      after:
        "      - name: Run the failure-first FDE workflow\n" +
        "        env:\n" +
        '          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "true"\n' +
        "        run: pnpm test:e2e:fde",
      before:
        "      - name: Run the failure-first FDE workflow\n" +
        "        env:\n" +
        '          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "1"\n' +
        "        run: pnpm test:e2e:fde",
      jobId: "fde-demo-e2e",
      name: "failure-first FDE suite",
    },
  ])("rejects disabled evidence capture for the $name", async ({
    after,
    before,
    jobId,
  }) => {
    const workflow = replaceInJob(
      await readWorkflow(),
      jobId,
      before,
      after,
    );

    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow(
      /Playwright evidence/u,
    );
  });

  it.each([
    {
      after:
        "        run: pnpm portfolio:verify-playwright-runs -- public demo",
      before:
        "        run: pnpm portfolio:verify-playwright-runs -- public production-csp",
      jobId: "e2e",
      name: "public and production CSP",
    },
    {
      after:
        "        run: pnpm portfolio:verify-playwright-runs -- public",
      before: "        run: pnpm portfolio:verify-playwright-runs -- demo",
      jobId: "portfolio-demo-e2e",
      name: "portfolio demo",
    },
    {
      after:
        "        run: pnpm portfolio:verify-playwright-runs -- demo",
      before: "        run: pnpm portfolio:verify-playwright-runs -- fde",
      jobId: "fde-demo-e2e",
      name: "failure-first FDE",
    },
  ])("rejects a wrong receipt suite for the $name job", async ({
    after,
    before,
    jobId,
  }) => {
    const workflow = replaceInJob(
      await readWorkflow(),
      jobId,
      before,
      after,
    );

    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow(
      /Playwright evidence/u,
    );
  });

  it.each([
    {
      after:
        "      - name: Upload public Playwright receipt\n" +
        "        if: ${{ failure() }}",
      before:
        "      - name: Upload public Playwright receipt\n" +
        "        if: ${{ always() }}",
      jobId: "e2e",
      name: "a receipt that is only uploaded on failure",
    },
    {
      after: "          path: test-results/public/",
      before: "          path: test-results/public/playwright-run.json",
      jobId: "e2e",
      name: "an over-broad receipt artifact path",
    },
    {
      after:
        "      - name: Upload portfolio demo report\n" +
        "        if: ${{ always() }}",
      before:
        "      - name: Upload portfolio demo report\n" +
        "        if: ${{ failure() }}",
      jobId: "portfolio-demo-e2e",
      name: "a raw report uploaded on success",
    },
    {
      after:
        "      - name: Upload FDE Playwright traces and screenshots\n" +
        "        if: ${{ always() }}",
      before:
        "      - name: Upload FDE Playwright traces and screenshots\n" +
        "        if: ${{ failure() }}",
      jobId: "fde-demo-e2e",
      name: "raw traces uploaded on success",
    },
  ])("rejects $name", async ({ after, before, jobId }) => {
    const workflow = replaceInJob(
      await readWorkflow(),
      jobId,
      before,
      after,
    );

    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow(
      /Playwright evidence/u,
    );
  });

  it("rejects an extra Playwright artifact upload", async () => {
    const workflow = replaceInJob(
      await readWorkflow(),
      "fde-demo-e2e",
      "      - name: Upload FDE Playwright traces and screenshots\n",
      "      - name: Upload unreviewed browser state\n" +
        "        if: ${{ always() }}\n" +
        "        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n" +
        "        with:\n" +
        "          name: browser-state\n" +
        "          path: test-results/\n\n" +
        "      - name: Upload FDE Playwright traces and screenshots\n",
    );

    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow(
      /Playwright (?:step|artifact upload) inventory drifted/u,
    );
  });

  it("rejects an unreviewed step inserted after receipt verification", async () => {
    const workflow = replaceInJob(
      await readWorkflow(),
      "e2e",
      "      - name: Upload public Playwright receipt\n",
      "      - name: Rewrite verified receipt\n" +
        "        run: node scripts/unreviewed-rewrite.mjs\n\n" +
        "      - name: Upload public Playwright receipt\n",
    );

    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow(
      /Playwright step inventory drifted/u,
    );
  });

  it("rejects a job-level failure-swallowing override", async () => {
    const workflow = replaceInJob(
      await readWorkflow(),
      "e2e",
      "    needs: quality\n    steps:\n",
      "    needs: quality\n    continue-on-error: true\n    steps:\n",
    );

    expect(() => assertRequiredCiGateWorkflow(workflow)).toThrow(
      /job-level execution override/u,
    );
  });
});

describe("Required CI gate name reservation across workflows", () => {
  const canonicalWorkflow = {
    path: requiredCiWorkflowPath,
    source:
      "name: CI\n\n" +
      "jobs:\n" +
      "  required:\n" +
      "    name: Required CI gate\n" +
      "    runs-on: ubuntu-latest\n" +
      "    steps:\n" +
      "      - name: Pass\n" +
      "        run: 'true'\n",
  } as const;

  it("accepts every checked-in workflow", async () => {
    await expect(
      readCheckedInWorkflows().then(
        assertUniqueRequiredCiGateAcrossWorkflows,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts an unrelated static job from a .yaml workflow", () => {
    expect(() =>
      assertUniqueRequiredCiGateAcrossWorkflows([
        canonicalWorkflow,
        {
          path: ".github/workflows/maintenance.yaml",
          source:
            "name: Maintenance\n" +
            "jobs:\n" +
            "  cleanup:\n" +
            "    name: 'Static maintenance'\n" +
            "    runs-on: ubuntu-latest\n" +
            "    steps:\n" +
            "      - name: Required CI gate\n" +
            "        run: 'true'\n",
        },
      ])
    ).not.toThrow();
  });

  it.each([
    {
      name: "plain scalar",
      source:
        "jobs:\n  shadow:\n    name: Required CI gate\n    runs-on: ubuntu-latest\n",
    },
    {
      name: "single-quoted scalar",
      source:
        "jobs:\n  shadow:\n    name: 'Required CI gate'\n    runs-on: ubuntu-latest\n",
    },
    {
      name: "double-quoted scalar",
      source:
        'jobs:\n  shadow:\n    name: "Required CI gate"\n    runs-on: ubuntu-latest\n',
    },
    {
      name: "escaped double-quoted scalar",
      source:
        'jobs:\n  shadow:\n    name: "Required CI \\u0067ate"\n    runs-on: ubuntu-latest\n',
    },
  ])("rejects a second gate rendered from a $name", ({ source }) => {
    expect(() =>
      assertUniqueRequiredCiGateAcrossWorkflows([
        canonicalWorkflow,
        { path: ".github/workflows/shadow.yml", source },
      ])
    ).toThrow(/declared exactly once/u);
  });

  it.each([
    {
      name: "plain expression",
      source:
        "jobs:\n  shadow:\n    name: ${{ inputs.job_name }}\n    runs-on: ubuntu-latest\n",
    },
    {
      name: "quoted expression",
      source:
        'jobs:\n  shadow:\n    name: "${{ matrix.job_name }}"\n    runs-on: ubuntu-latest\n',
    },
    {
      name: "aliased job name",
      source:
        "jobs:\n  shadow:\n    name: *gate-name\n    runs-on: ubuntu-latest\n",
    },
    {
      name: "merged job mapping",
      source:
        "jobs:\n  shadow:\n    <<: *gate-job\n    runs-on: ubuntu-latest\n",
    },
    {
      name: "aliased whole job",
      source: "jobs:\n  shadow: *gate-job\n",
    },
    {
      name: "flow-mapped job",
      source:
        "jobs:\n  shadow: {name: Required CI gate, runs-on: ubuntu-latest}\n",
    },
    {
      name: "flow-mapped jobs root",
      source:
        "jobs: {shadow: {name: Required CI gate, runs-on: ubuntu-latest}}\n",
    },
    // YAML folds the deeper plain-scalar line into "Required CI gate".
    {
      name: "multiline plain-scalar job name",
      source:
        "jobs:\n" +
        "  shadow:\n" +
        "    name: Required CI\n" +
        "      gate\n" +
        "    runs-on: ubuntu-latest\n",
    },
  ])("rejects a non-auditable $name", ({ source }) => {
    expect(() =>
      assertUniqueRequiredCiGateAcrossWorkflows([
        canonicalWorkflow,
        { path: ".github/workflows/shadow.yaml", source },
      ])
    ).toThrow(/job|jobs/u);
  });

  it("does not reserve the context from a root workflow or step name", () => {
    expect(() =>
      assertUniqueRequiredCiGateAcrossWorkflows([
        canonicalWorkflow,
        {
          path: ".github/workflows/unrelated.yml",
          source:
            "name: Required CI gate\n" +
            "jobs:\n" +
            "  unrelated:\n" +
            "    name: Unrelated check\n" +
            "    runs-on: ubuntu-latest\n" +
            "    steps:\n" +
            "      - name: Required CI gate\n" +
            "        run: 'true'\n",
        },
      ])
    ).not.toThrow();
  });

  it.each([
    {
      expected: /paths must be unique/u,
      workflows: [canonicalWorkflow, canonicalWorkflow],
    },
    {
      expected: /missing.*ci\.yml/u,
      workflows: [
        {
          path: ".github/workflows/other.yml",
          source: "jobs:\n  other:\n    name: Other\n",
        },
      ],
    },
    {
      expected: /Unsafe or unsupported/u,
      workflows: [
        canonicalWorkflow,
        {
          path: ".github/workflows/nested/other.yml",
          source: "jobs:\n  other:\n    name: Other\n",
        },
      ],
    },
  ])("rejects an invalid workflow source set", ({ expected, workflows }) => {
    expect(() =>
      assertUniqueRequiredCiGateAcrossWorkflows(workflows)
    ).toThrow(expected);
  });
});

describe("CI package-script execution contract", () => {
  const indirectScriptNames = [
    "audit:actions",
    "audit:security",
    "build",
    "demo",
    "demo:fde",
    "db:check",
    "db:smoke:country-detail-consistency",
    "db:smoke:governance-concurrency",
    "db:smoke:postgres",
    "db:smoke:rate-limit-concurrency",
    "db:smoke:upgrade",
    "lint",
    "portfolio:verify-playwright-runs",
    "test:coverage:app",
    "test:deploy:contracts",
    "test:e2e",
    "test:e2e:csp:production",
    "test:e2e:demo",
    "test:e2e:fde",
    "start",
    "typecheck",
  ] as const;

  function mutatePackageScript(
    source: string,
    name: (typeof indirectScriptNames)[number],
    mutate: (value: string) => string,
  ): string {
    const manifest = JSON.parse(source) as {
      scripts: Record<string, string>;
    };
    const current = manifest.scripts[name];
    if (current === undefined) {
      throw new Error(`Test package manifest is missing ${name}.`);
    }
    manifest.scripts[name] = mutate(current);
    return `${JSON.stringify(manifest, null, 2)}\n`;
  }

  it("accepts every checked-in CI package-script expansion", async () => {
    await expect(
      readPackageManifest().then(assertCanonicalCiPackageScripts),
    ).resolves.toBeUndefined();
  });

  it.each(indirectScriptNames)(
    "rejects replacing the %s script with true",
    async (name) => {
      const packageManifest = mutatePackageScript(
        await readPackageManifest(),
        name,
        () => "true",
      );

      expect(() => assertCanonicalCiPackageScripts(packageManifest)).toThrow(
        /canonical execution contract/u,
      );
    },
  );

  it.each(indirectScriptNames)(
    "rejects appending a success fallback to the %s script",
    async (name) => {
      const packageManifest = mutatePackageScript(
        await readPackageManifest(),
        name,
        (value) => `${value} || true`,
      );

      expect(() => assertCanonicalCiPackageScripts(packageManifest)).toThrow(
        /canonical execution contract/u,
      );
    },
  );

  it.each([
    {
      name: "application coverage excludes its own package-contract test",
      script: "test:coverage:app" as const,
      value:
        "vitest run --coverage --exclude tests/portfolio-verify-ci-workflow.test.ts",
    },
    {
      name: "deployment contracts omit one governed suite",
      script: "test:deploy:contracts" as const,
      value:
        "vitest run tests/deploy-scripts.test.ts --reporter=verbose --slowTestThreshold=0",
    },
    {
      name: "deployment contracts omit the extracted host activation ledger suite",
      script: "test:deploy:contracts" as const,
      value:
        "vitest run tests/deploy-scripts.test.ts tests/release-publication-controller.test.ts tests/host-release-orchestrator.test.ts --reporter=verbose --slowTestThreshold=0",
    },
    {
      name: "application coverage retains the extracted deployment ledger suite",
      script: "test:coverage:app" as const,
      value:
        "vitest run --coverage --exclude tests/deploy-scripts.test.ts --exclude tests/release-publication-controller.test.ts --exclude tests/host-release-orchestrator.test.ts",
    },
    {
      name: "public Playwright runs only one spec",
      script: "test:e2e" as const,
      value:
        'playwright test e2e/locale.spec.ts --grep "defaults to English"',
    },
    {
      name: "production CSP Playwright permits an empty selection",
      script: "test:e2e:csp:production" as const,
      value:
        'playwright test --config playwright.production.config.ts --pass-with-no-tests --grep "never matches"',
    },
    {
      name: "Demo Playwright runs only one scenario",
      script: "test:e2e:demo" as const,
      value:
        'playwright test --config playwright.demo.config.ts --grep "explicitly named product"',
    },
    {
      name: "FDE Playwright runs only one scenario",
      script: "test:e2e:fde" as const,
      value:
        'playwright test --config playwright.fde.config.ts --grep "persona switching"',
    },
  ])("rejects narrowed coverage: $name", async ({ script, value }) => {
    const packageManifest = mutatePackageScript(
      await readPackageManifest(),
      script,
      () => value,
    );

    expect(() => assertCanonicalCiPackageScripts(packageManifest)).toThrow(
      /canonical execution contract/u,
    );
  });

  it.each([
    { flag: " --reporter=verbose", name: "verbose reporter" },
    { flag: " --slowTestThreshold=0", name: "zero slow-test threshold" },
  ])("rejects removing the deployment $name", async ({ flag }) => {
    const packageManifest = mutatePackageScript(
      await readPackageManifest(),
      "test:deploy:contracts",
      (value) => value.replace(flag, ""),
    );

    expect(() => assertCanonicalCiPackageScripts(packageManifest)).toThrow(
      /canonical execution contract/u,
    );
  });

  it.each(
    indirectScriptNames.flatMap((script) =>
      (["pre", "post"] as const).map((prefix) => ({
        lifecycleName: `${prefix}${script}`,
        script,
      })),
    ),
  )(
    "rejects an injected $lifecycleName lifecycle companion for $script",
    async ({ lifecycleName }) => {
      const manifest = JSON.parse(await readPackageManifest()) as {
        scripts: Record<string, string>;
      };
      manifest.scripts[lifecycleName] = "true";
      const packageManifest = `${JSON.stringify(manifest, null, 2)}\n`;

      expect(() => assertCanonicalCiPackageScripts(packageManifest)).toThrow(
        /unsupported lifecycle companion/u,
      );
    },
  );

  it.each([
    "preinstall",
    "install",
    "postinstall",
    "prepublish",
    "preprepare",
    "prepare",
    "postprepare",
    "pnpm:devPreinstall",
  ])("rejects the root %s install lifecycle", async (lifecycleName) => {
    const manifest = JSON.parse(await readPackageManifest()) as {
      scripts: Record<string, string>;
    };
    manifest.scripts[lifecycleName] = "true";

    expect(() =>
      assertCanonicalCiPackageScripts(`${JSON.stringify(manifest, null, 2)}\n`)
    ).toThrow(/unsupported root install lifecycle/u);
  });

  it("rejects non-canonical or duplicate-key package JSON", async () => {
    const source = await readPackageManifest();
    const nonCanonical = source.replace(/\n$/u, "");
    const duplicateKey = source.replace(
      '  "name": "global-diesel-regulations",\n',
      '  "name": "global-diesel-regulations",\n  "name": "shadow",\n',
    );

    expect(() => assertCanonicalCiPackageScripts(nonCanonical)).toThrow(
      /canonical two-space JSON/u,
    );
    expect(() => assertCanonicalCiPackageScripts(duplicateKey)).toThrow(
      /canonical two-space JSON/u,
    );
  });
});

describe("dependency-free CI gitleaks guard", () => {
  it("binds the executable scan guard to its reviewed digest", async () => {
    const source = await readFile(resolve(process.cwd(), ciGitleaksGuardPath));
    expect(() => assertCiGitleaksGuardSource(source)).not.toThrow();
    expect(() => assertCiGitleaksGuardSource("pass\n")).toThrow(/reviewed SHA-256 contract/u);
    expect(() => assertCiGitleaksGuardSource(Buffer.concat([source, Buffer.from("\n")]))).toThrow(
      /reviewed SHA-256 contract/u,
    );
  });
});

describe("dependency-free CI install-boundary guard", () => {
  it("binds the checked-in guard to the reviewed workflow digest", async () => {
    const source = await readFile(resolve(process.cwd(), ciInstallBoundaryPath));
    expect(() => assertCiInstallBoundarySource(source)).not.toThrow();
    expect(() =>
      assertCiInstallBoundarySource(Buffer.concat([source, Buffer.from("\n")]))
    ).toThrow(/reviewed SHA-256 contract/u);
  });

  it("accepts the canonical repository inputs in an isolated environment", async () => {
    await withInstallBoundaryFixture((directory) => {
      const result = runInstallBoundaryGuard(directory);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("CI install boundary accepted");
    });
  });

  it.each([
    "preinstall",
    "install",
    "postinstall",
    "prepublish",
    "preprepare",
    "prepare",
    "postprepare",
    "pnpm:devPreinstall",
  ])("rejects root lifecycle %s before pnpm setup", async (lifecycleName) => {
    await withInstallBoundaryFixture(async (directory) => {
      const packagePath = resolve(directory, "package.json");
      const manifest = JSON.parse(await readFile(packagePath, "utf8")) as {
        scripts: Record<string, string>;
      };
      manifest.scripts[lifecycleName] = "true";
      await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);

      const result = runInstallBoundaryGuard(directory);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("root install lifecycle scripts are forbidden");
    });
  });

  it.each([".npmrc", ".pnpmfile.cjs"])(
    "rejects repository config hook %s before pnpm setup",
    async (path) => {
      await withInstallBoundaryFixture(async (directory) => {
        await writeFile(resolve(directory, path), "script-shell=/bin/true\n");

        const result = runInstallBoundaryGuard(directory);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`repository ${path} is forbidden`);
      });
    },
  );

  it("rejects pnpm workspace execution-config drift", async () => {
    await withInstallBoundaryFixture(async (directory) => {
      const workspacePath = resolve(directory, "pnpm-workspace.yaml");
      const source = await readFile(workspacePath, "utf8");
      await writeFile(workspacePath, `${source}scriptShell: /bin/true\n`);

      const result = runInstallBoundaryGuard(directory);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("reviewed execution config");
    });
  });

  it.each(["patches/next@16.3.6.patch", "patches/@next__eslint-plugin-next@16.3.6.patch", "patches/@vitest__runner@4.1.11.patch", "patches/vaul@1.1.2.patch"]
    .flatMap((path) => ["missing", "changed", "symlink"].map((state) => ({ path, state }))))(
    "rejects a $state $path before installing dependencies",
    async ({ path, state }) => {
      await withInstallBoundaryFixture(async (directory) => {
        const patchPath = resolve(directory, path);
        const bytes = await readFile(patchPath);
        if (state === "changed") {
          await writeFile(patchPath, Buffer.concat([bytes, Buffer.from("\n")]));
        } else {
          await rm(patchPath);
          if (state === "symlink") {
            await writeFile(resolve(directory, "patches/target.patch"), bytes);
            await symlink("target.patch", patchPath);
          }
        }
        const result = runInstallBoundaryGuard(directory);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/patch.*(?:reviewed source|cannot be opened safely)/u);
      });
    },
  );

  it("rejects a symlinked package manifest", async () => {
    await withInstallBoundaryFixture(async (directory) => {
      const packagePath = resolve(directory, "package.json");
      const targetPath = resolve(directory, "package-target.json");
      await writeFile(targetPath, await readFile(packagePath));
      await rm(packagePath);
      await symlink("package-target.json", packagePath);

      const result = runInstallBoundaryGuard(directory);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("cannot be opened safely");
    });
  });
});

describe("CI workflow commit binding", () => {
  it("keeps local dirty-worktree verification independent from Git", () => {
    const workspaceSource = Buffer.from("locally edited workflow\n", "utf8");
    let headReadCount = 0;

    const resolved = resolveCiWorkflowSource({
      headBound: false,
      readHeadSource: () => {
        headReadCount += 1;
        throw new Error("Git must not run locally.");
      },
      workspaceSource,
    });

    expect(resolved).toBe(workspaceSource);
    expect(headReadCount).toBe(0);
  });

  it("returns the HEAD workflow when CI workspace bytes match", () => {
    const workspaceSource = Buffer.from("canonical workflow\n", "utf8");
    const headSource = Buffer.from(workspaceSource);

    const resolved = resolveCiWorkflowSource({
      headBound: true,
      readHeadSource: () => headSource,
      workspaceSource,
    });

    expect(resolved).toBe(headSource);
  });

  it("rejects commit/workspace byte drift in GitHub Actions", () => {
    expect(() =>
      resolveCiWorkflowSource({
        headBound: true,
        readHeadSource: () => Buffer.from("committed workflow\n", "utf8"),
        workspaceSource: Buffer.from("rewritten workflow\n", "utf8"),
      }),
    ).toThrow(/workspace bytes do not match the HEAD blob/u);
  });

  it("fails closed when Git cannot read the HEAD workflow blob", () => {
    const gitFailure = new Error("fatal: missing HEAD blob");

    try {
      resolveCiWorkflowSource({
        headBound: true,
        readHeadSource: () => {
          throw gitFailure;
        },
        workspaceSource: Buffer.from("workflow\n", "utf8"),
      });
      throw new Error("Expected HEAD workflow resolution to fail.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) return;

      expect(error.message).toMatch(/could not read.*HEAD blob/u);
      expect(error.cause).toBe(gitFailure);
    }
  });
});
