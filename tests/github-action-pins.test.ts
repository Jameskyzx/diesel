import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findUnpinnedWorkflowUses,
  scanWorkflowActionPins,
} from "../scripts/security/check-github-action-pins";

const commitSha = "0123456789abcdef0123456789abcdef01234567";
const digest = "a".repeat(64);

describe("GitHub workflow pin policy", () => {
  it("allows immutable repository, reusable-workflow, Docker, container, and local references", () => {
    expect(
      findUnpinnedWorkflowUses(`
steps:
  - uses: actions/checkout@${commitSha} # v4
  - uses: owner/repository/path/to/action@${commitSha}
  - uses: "docker://registry.example/action@sha256:${digest}"
  - uses: ./.github/actions/local
jobs:
  delegated:
    uses: owner/repository/.github/workflows/reusable.yml@${commitSha}
  tested-in-container:
    container:
      image: "ghcr.io/owner/build@sha256:${digest}"
    services:
      postgres:
        image: pgvector/pgvector@sha256:${digest} # pg16
  tested-in-container-shorthand:
    container: ghcr.io/owner/build@sha256:${digest}
`),
    ).toEqual([]);
  });

  it.each([
    ["release tag", "actions/checkout@v4"],
    ["branch", "actions/checkout@main"],
    ["short SHA", "actions/checkout@0123456789ab"],
    ["uppercase SHA", `actions/checkout@${commitSha.toUpperCase()}`],
    ["hash-suffixed branch", `actions/checkout@${commitSha}#branch`],
    ["Docker tag", "docker://alpine:3.22"],
    ["empty reference", ""],
  ])("rejects a mutable or malformed %s", (_label, reference) => {
    expect(
      findUnpinnedWorkflowUses(`steps:\n  - uses: ${reference}`, "ci.yml"),
    ).toEqual([
      expect.objectContaining({
        file: "ci.yml",
        line: 2,
        reference,
      }),
    ]);
  });

  it.each([
    ["space", " "],
    ["tab", "\t"],
  ])("allows a pinned reference followed by a %s-separated comment", (
    _label,
    separator,
  ) => {
    expect(
      findUnpinnedWorkflowUses(
        `steps:\n  - uses: actions/checkout@${commitSha}${separator}# pinned`,
      ),
    ).toEqual([]);
  });

  it.each([
    ["non-breaking space", "\u00A0"],
    ["em space", "\u2003"],
  ])("does not treat %s as a YAML comment separator", (_label, separator) => {
    const reference = `actions/checkout@${commitSha}${separator}#branch`;
    expect(
      findUnpinnedWorkflowUses(`steps:\n  - uses: ${reference}`, "ci.yml"),
    ).toEqual([
      expect.objectContaining({
        file: "ci.yml",
        line: 2,
        reference,
      }),
    ]);
  });

  it("does not allow YAML spacing to bypass the pin check", () => {
    expect(
      findUnpinnedWorkflowUses(
        "steps:\n  - uses : actions/checkout@v4",
        "spaced.yml",
      ),
    ).toEqual([
      expect.objectContaining({
        file: "spaced.yml",
        line: 2,
        reference: "actions/checkout@v4",
      }),
    ]);
  });

  it.each([
    ["service tag", "services:\n      postgres:\n        image: pgvector/pgvector:pg16"],
    ["job-container tag", "container:\n      image: node:22"],
    ["scalar job-container tag", "container: node:22"],
    [
      "uppercase service digest",
      `services:\n      postgres:\n        image: pgvector/pgvector@sha256:${digest.toUpperCase()}`,
    ],
    [
      "dynamic service image",
      "services:\n      postgres:\n        image: ${{ matrix.postgresImage }}",
    ],
    [
      "flow-mapped services",
      `services: {postgres: {image: pgvector/pgvector@sha256:${digest}}}`,
    ],
    [
      "flow-mapped job container",
      `container: {image: node@sha256:${digest}}`,
    ],
    ["aliased services", "services: *postgresServices"],
    [
      "anchored service definition",
      `services:\n      postgres: &postgres\n        image: pgvector/pgvector@sha256:${digest}`,
    ],
    [
      "aliased service image",
      "services:\n      postgres:\n        image: *postgresImage",
    ],
    [
      "merged service definition",
      "services:\n      postgres:\n        <<: *postgresService",
    ],
    ["dynamic services", "services: ${{ matrix.postgresServices }}"],
    ["aliased job container", "container: *buildContainer"],
    [
      "merged job container",
      "container:\n      <<: *buildContainer",
    ],
    ["empty service image", "services:\n      postgres:\n        image:"],
  ])("rejects a mutable or malformed %s", (_label, fragment) => {
    expect(
      findUnpinnedWorkflowUses(`jobs:\n  quality:\n    ${fragment}`, "ci.yml"),
    ).toEqual([
      expect.objectContaining({
        file: "ci.yml",
        reason: "Service and job container images must use an immutable sha256 digest",
      }),
    ]);
  });

  it("ignores image-shaped keys outside service and job-container definitions", () => {
    expect(
      findUnpinnedWorkflowUses(`
image: ./docs/workflow-diagram.png
jobs:
  quality:
    steps:
      - name: Pass an action-specific image input
        with:
          image: node:22
      - name: Keep flow-style action inputs opaque
        with: {image: node:22, uses: actions/checkout@v4}
      - name: Keep shell examples opaque
        run: |
          services:
            postgres:
              image: pgvector/pgvector:pg16
          - {uses: actions/checkout@v4}
          ? jobs
          : {quality: {steps: [{uses: actions/checkout@v4}]}}
    services:
      postgres:
        image: pgvector/pgvector@sha256:${digest}
        env:
          image: application-owned-value
`),
    ).toEqual([]);
  });

  it.each([
    [
      "flow-mapped jobs",
      "jobs: {quality: {steps: [{uses: actions/checkout@v4}]}}",
    ],
    [
      "flow-mapped job",
      "jobs:\n  quality: {steps: [{uses: actions/checkout@v4}]}",
    ],
    [
      "next-line flow-mapped job",
      "jobs:\n  quality:\n    {steps: [{uses: actions/checkout@v4}]}",
    ],
    [
      "aliased job",
      "jobs:\n  quality: *sharedJob",
    ],
    [
      "anchored job",
      "jobs:\n  quality: &sharedJob\n    steps:\n      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567",
    ],
    [
      "dynamic job",
      "jobs:\n  quality: ${{ fromJSON(inputs.job) }}",
    ],
    [
      "dynamic jobs",
      "jobs: ${{ fromJSON(inputs.jobs) }}",
    ],
    [
      "aliased steps",
      "jobs:\n  quality:\n    steps: *sharedSteps",
    ],
    [
      "anchored steps",
      "jobs:\n  quality:\n    steps: &sharedSteps",
    ],
    [
      "flow steps",
      "jobs:\n  quality:\n    steps: [{uses: actions/checkout@v4}]",
    ],
    [
      "next-line flow steps",
      "jobs:\n  quality:\n    steps:\n      [{uses: actions/checkout@v4}]",
    ],
    [
      "dynamic steps",
      "jobs:\n  quality:\n    steps: ${{ fromJSON(inputs.steps) }}",
    ],
    [
      "flow-mapped step item",
      "jobs:\n  quality:\n    steps:\n      - {uses: actions/checkout@v4}",
    ],
    [
      "aliased step item",
      "jobs:\n  quality:\n    steps:\n      - *sharedStep",
    ],
    [
      "bare nested step item",
      "jobs:\n  quality:\n    steps:\n      -\n        uses: actions/checkout@v4",
    ],
    [
      "flow-mapped root workflow",
      "{name: CI, jobs: {quality: {steps: [{uses: actions/checkout@v4}]}}}",
    ],
    [
      "document-prefixed flow-mapped root workflow",
      "--- {jobs: {quality: {steps: [{uses: actions/checkout@v4}]}}}",
    ],
    [
      "document-prefixed tagged root workflow",
      "--- !workflow {jobs: {quality: {steps: [{uses: actions/checkout@v4}]}}}",
    ],
    [
      "byte-order-mark-prefixed root workflow",
      "\uFEFFjobs:\n  quality:\n    steps:\n      - uses: actions/checkout@v4",
    ],
    ["other opaque root syntax", "opaque-root"],
    [
      "root-anchored jobs mapping",
      '&workflow jobs:\n  quality:\n    steps:\n      - "us\\u0065s": actions/checkout@v4',
    ],
    [
      "root-tagged jobs mapping",
      '!workflow jobs:\n  quality:\n    steps:\n      - "us\\u0065s": actions/checkout@v4',
    ],
    [
      "merged job",
      `x-job: &sharedJob\n  runs-on: ubuntu-latest\njobs:\n  quality:\n    <<: *sharedJob\n    steps:\n      - uses: actions/checkout@${commitSha}`,
    ],
    [
      "merged step",
      `x-step: &sharedStep\n  uses: actions/checkout@${commitSha}\njobs:\n  quality:\n    steps:\n      - name: Merged action\n        <<: *sharedStep`,
    ],
    [
      "escaped uses key",
      "jobs:\n  quality:\n    steps:\n      - \"us\\u0065s\": actions/checkout@v4",
    ],
  ])("rejects a non-block %s that can hide uses", (_label, source) => {
    expect(findUnpinnedWorkflowUses(source, "ci.yml")).toEqual([
      expect.objectContaining({
        file: "ci.yml",
        reason: "Workflow jobs and steps must use auditable block mappings",
      }),
    ]);
  });

  it.each([
    [
      "top-level jobs key",
      "? jobs\n: {quality: {steps: [{uses: actions/checkout@v4}]}}",
    ],
    [
      "step uses key",
      "jobs:\n  quality:\n    steps:\n      - ? uses\n        : actions/checkout@v4",
    ],
  ])("rejects YAML explicit-key syntax for %s", (_label, source) => {
    expect(findUnpinnedWorkflowUses(source, "explicit.yml")).toContainEqual(
      expect.objectContaining({
        file: "explicit.yml",
        reason: "Workflow jobs and steps must use auditable block mappings",
      }),
    );
  });

  it.each([
    ["double-quoted", '"quality"'],
    ["single-quoted", "'quality'"],
    ["uppercase", "Quality"],
    ["underscore-prefixed", "_quality"],
  ])("rejects a workflow job ID that is %s", (_label, jobId) => {
    expect(
      findUnpinnedWorkflowUses(
        `jobs:\n  ${jobId}:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/local`,
        "ci.yml",
      ),
    ).toEqual([
      {
        file: "ci.yml",
        line: 2,
        reason:
          "Workflow job declarations must use exactly two spaces, a bare lowercase [a-z][a-z0-9-]* ID, and a bare colon",
        reference: jobId,
      },
    ]);
  });

  it.each([
    ["space before the colon", "  shadow-check :"],
    ["inline comment", "  shadow-check: # comment"],
    ["tab and inline comment", "  shadow-check:\t# comment"],
    ["different indentation", "   shadow-check:"],
    ["trailing spaces", "  shadow-check:   "],
  ])("rejects a workflow job declaration with %s", (_label, declaration) => {
    expect(
      findUnpinnedWorkflowUses(
        `jobs:\n${declaration}\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/local`,
        "ci.yml",
      ),
    ).toEqual([
      {
        file: "ci.yml",
        line: 2,
        reason:
          "Workflow job declarations must use exactly two spaces, a bare lowercase [a-z][a-z0-9-]* ID, and a bare colon",
        reference: "shadow-check",
      },
    ]);
  });

  it("allows a bare lowercase workflow job ID", () => {
    expect(
      findUnpinnedWorkflowUses(`
jobs:
  unlisted-job-2:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/local
`),
    ).toEqual([]);
  });

  it("allows bare YAML document boundary markers", () => {
    expect(
      findUnpinnedWorkflowUses(`---
jobs:
  quality:
    steps:
      - uses: ./.github/actions/local
...`),
    ).toEqual([]);
  });

  it("keeps every checked-in workflow pinned", async () => {
    await expect(
      scanWorkflowActionPins(resolve(process.cwd(), ".github/workflows")),
    ).resolves.toEqual([]);
  });
});
