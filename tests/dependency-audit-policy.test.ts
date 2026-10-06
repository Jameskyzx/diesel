import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  auditPolicySchema,
  evaluateAuditPolicy,
  interpretPnpmAuditProcessResult,
  type AuditReport,
  type PnpmAuditProcessResult,
} from "../scripts/security/check-pnpm-audit";

function report(
  id: string,
  severity: "info" | "low" | "moderate" | "high" | "critical",
): AuditReport {
  return {
    advisories: {
      "1": {
        github_advisory_id: id,
        severity,
        title: "Synthetic advisory",
      },
    },
  };
}

const registeredPolicy = auditPolicySchema.parse({
  reviewedAt: "2026-08-15",
  advisories: [
    {
      expiresOn: "2026-08-22",
      id: "GHSA-aaaa-bbbb-cccc",
      owner: "maintainer",
      reason: "Temporary test exception with a documented mitigation.",
      severity: "high",
    },
  ],
});

function pnpmAuditOutput(
  advisories: Record<string, Record<string, unknown>> = {},
  vulnerabilityOverrides: Partial<Record<
    "critical" | "high" | "info" | "low" | "moderate",
    number
  >> = {},
): string {
  const vulnerabilities = {
    critical: 0,
    high: 0,
    info: 0,
    low: 0,
    moderate: 0,
  };
  for (const advisory of Object.values(advisories)) {
    const severity = advisory.severity;
    if (typeof severity === "string" && severity in vulnerabilities) {
      vulnerabilities[severity as keyof typeof vulnerabilities] += 1;
    }
  }
  return JSON.stringify({
    actions: [],
    advisories,
    metadata: {
      dependencies: 10,
      devDependencies: 20,
      optionalDependencies: 2,
      totalDependencies: 32,
      vulnerabilities: { ...vulnerabilities, ...vulnerabilityOverrides },
    },
    muted: [],
  });
}

function pnpmAdvisory(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    cwe: "CWE-79",
    findings: [
      {
        bundled: false,
        dev: false,
        optional: false,
        paths: ["package-a>package-b"],
        version: "1.0.0",
      },
    ],
    github_advisory_id: "GHSA-aaaa-bbbb-cccc",
    id: 1,
    module_name: "package-b",
    patched_versions: ">=1.0.1",
    severity: "high",
    title: "Synthetic advisory",
    url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
    vulnerable_versions: "<1.0.1",
    ...overrides,
  };
}

function processResult(
  overrides: Partial<PnpmAuditProcessResult> = {},
): PnpmAuditProcessResult {
  return {
    signal: null,
    status: 0,
    stderr: "",
    stdout: pnpmAuditOutput(),
    ...overrides,
  };
}

describe("dependency advisory policy", () => {
  it("rejects unknown policy and exception fields", () => {
    expect(
      auditPolicySchema.safeParse({
        advisories: [],
        reviewedAt: "2026-08-15",
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      auditPolicySchema.safeParse({
        advisories: [
          {
            ...registeredPolicy.advisories[0],
            unexpected: true,
          },
        ],
        reviewedAt: "2026-08-15",
      }).success,
    ).toBe(false);
  });

  it("allows a current, registered high advisory", () => {
    expect(
      evaluateAuditPolicy({
        policy: registeredPolicy,
        report: report("GHSA-aaaa-bbbb-cccc", "high"),
        today: "2026-08-15",
      }),
    ).toEqual([]);
  });

  it("blocks new and expired high advisories", () => {
    expect(
      evaluateAuditPolicy({
        policy: registeredPolicy,
        report: report("GHSA-dddd-eeee-ffff", "high"),
        today: "2026-08-15",
      }),
    ).toEqual([
      "GHSA-dddd-eeee-ffff is high and has no registered exception",
    ]);
    expect(
      evaluateAuditPolicy({
        policy: registeredPolicy,
        report: report("GHSA-aaaa-bbbb-cccc", "high"),
        today: "2026-08-23",
      }),
    ).toEqual([
      "GHSA-aaaa-bbbb-cccc exception expired on 2026-08-22",
    ]);
  });

  it("blocks every expired exception even after its advisory disappears", () => {
    expect(
      evaluateAuditPolicy({
        policy: registeredPolicy,
        report: { advisories: {} },
        today: "2026-08-23",
      }),
    ).toEqual([
      "GHSA-aaaa-bbbb-cccc exception expired on 2026-08-22",
    ]);
  });

  it("always blocks critical advisories", () => {
    expect(
      evaluateAuditPolicy({
        policy: registeredPolicy,
        report: report("GHSA-aaaa-bbbb-cccc", "critical"),
        today: "2026-08-15",
      }),
    ).toEqual([
      "GHSA-aaaa-bbbb-cccc is critical and cannot be allowlisted",
    ]);
  });

  it("does not escalate informational advisories into the high-severity policy", () => {
    expect(
      evaluateAuditPolicy({
        policy: registeredPolicy,
        report: report("GHSA-dddd-eeee-ffff", "info"),
        today: "2026-08-15",
      }),
    ).toEqual([]);
  });
});

describe("remediated braces tooling exception", () => {
  const policy = auditPolicySchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../.github/dependency-audit-allowlist.json", import.meta.url),
        "utf8",
      ),
    ) as unknown,
  );
  const id = "GHSA-vfj7-8cjw-p6xm";

  it("removes the exception after removing the vulnerable dependency graph", () => {
    // Re-reviewed for GHSA-68fv-2mgg-jv7q; the old braces exception stays removed.
    expect(policy.reviewedAt).toBe("2026-10-06");
    expect(policy.advisories).toEqual([]);
  });

  it("rejects a reintroduced braces finding even before the old expiry", () => {
    expect(
      evaluateAuditPolicy({ policy, report: report(id, "high"), today: "2026-10-09" }),
    ).toEqual([`${id} is high and has no registered exception`]);
  });

  it("still rejects a different high advisory and a critical escalation", () => {
    expect(
      evaluateAuditPolicy({
        policy,
        report: report("GHSA-aaaa-bbbb-cccc", "high"),
        today: "2026-10-03",
      }),
    ).toEqual(["GHSA-aaaa-bbbb-cccc is high and has no registered exception"]);
    expect(
      evaluateAuditPolicy({ policy, report: report(id, "critical"), today: "2026-10-03" }),
    ).toEqual([`${id} is critical and cannot be allowlisted`]);
  });

  it("does not retain an expired exception for a removed dependency", () => {
    expect(evaluateAuditPolicy({ policy, report: { advisories: {} }, today: "2026-10-10" })).toEqual([]);
    expect(evaluateAuditPolicy({ policy, report: report(id, "high"), today: "2026-10-10" }))
      .toEqual([`${id} is high and has no registered exception`]);
  });
});

describe("pnpm audit subprocess contract", () => {
  it("accepts a complete zero-advisory report only with exit status 0", () => {
    expect(interpretPnpmAuditProcessResult(processResult())).toEqual({
      advisories: {},
    });
  });

  it("accepts exit status 1 only when a complete report contains advisories", () => {
    expect(
      interpretPnpmAuditProcessResult(
        processResult({
          status: 1,
          stdout: pnpmAuditOutput({ "1": pnpmAdvisory() }),
        }),
      ),
    ).toEqual({
      advisories: {
        "1": {
          github_advisory_id: "GHSA-aaaa-bbbb-cccc",
          severity: "high",
          title: "Synthetic advisory",
        },
      },
    });
  });

  it("accepts documented top-level arrays and extensible pnpm detail fields", () => {
    const decoded = JSON.parse(
      pnpmAuditOutput({
        "1": pnpmAdvisory({
          cves: ["CVE-2026-0001"],
          cvss: { score: 7.5, vectorString: "CVSS:3.1/AV:N" },
          findings: [
            {
              bundled: false,
              dev: false,
              optional: false,
              paths: ["package-a>package-b"],
              peer: false,
              version: "1.0.0",
            },
          ],
          overview: "Additional pnpm advisory detail.",
          recommendation: "Upgrade package-b.",
        }),
      }),
    ) as {
      metadata: Record<string, unknown>;
      [key: string]: unknown;
    };
    decoded.metadata.registry = "https://registry.example.invalid";

    expect(
      interpretPnpmAuditProcessResult(
        processResult({ status: 1, stdout: JSON.stringify(decoded) }),
      ),
    ).toEqual({
      advisories: {
        "1": {
          github_advisory_id: "GHSA-aaaa-bbbb-cccc",
          severity: "high",
          title: "Synthetic advisory",
        },
      },
    });
  });

  it("accepts a self-consistent informational advisory report", () => {
    expect(
      interpretPnpmAuditProcessResult(
        processResult({
          status: 1,
          stdout: pnpmAuditOutput({
            "1": pnpmAdvisory({ severity: "info" }),
          }),
        }),
      ),
    ).toEqual({
      advisories: {
        "1": {
          github_advisory_id: "GHSA-aaaa-bbbb-cccc",
          severity: "info",
          title: "Synthetic advisory",
        },
      },
    });
  });

  it.each([
    {
      label: "status 0 with a metadata-only critical vulnerability",
      result: processResult({
        stdout: pnpmAuditOutput({}, { critical: 1 }),
      }),
    },
    {
      label: "empty advisories with a non-zero metadata count",
      result: processResult({
        status: 1,
        stdout: pnpmAuditOutput({}, { high: 1 }),
      }),
    },
    {
      label: "a status 1 advisory with a missing severity count",
      result: processResult({
        status: 1,
        stdout: pnpmAuditOutput(
          { "1": pnpmAdvisory() },
          { high: 0 },
        ),
      }),
    },
    {
      label: "a status 1 advisory counted under the wrong severity",
      result: processResult({
        status: 1,
        stdout: pnpmAuditOutput(
          { "1": pnpmAdvisory() },
          { high: 0, moderate: 1 },
        ),
      }),
    },
  ])("rejects $label", ({ result }) => {
    expect(() => interpretPnpmAuditProcessResult(result)).toThrow(
      /vulnerability count does not match/u,
    );
  });

  it.each([
    {
      label: "a signal",
      result: processResult({ signal: "SIGTERM", status: null }),
    },
    {
      label: "empty stdout",
      result: processResult({ status: 1, stdout: "" }),
    },
    {
      label: "malformed JSON",
      result: processResult({ status: 1, stdout: "{" }),
    },
    {
      label: "an explicit error envelope",
      result: processResult({
        status: 1,
        stdout: JSON.stringify({
          advisories: {},
          error: { code: "ERR_PNPM_AUDIT_BAD_RESPONSE" },
          metadata: JSON.parse(pnpmAuditOutput()).metadata,
        }),
      }),
    },
    {
      label: "exit status 1 without advisories",
      result: processResult({ status: 1 }),
    },
    {
      label: "an unexpected non-zero exit status",
      result: processResult({
        status: 2,
        stdout: pnpmAuditOutput({ "1": pnpmAdvisory() }),
      }),
    },
    {
      label: "advisories with a successful exit status",
      result: processResult({
        stdout: pnpmAuditOutput({ "1": pnpmAdvisory() }),
      }),
    },
    {
      label: "an incomplete report",
      result: processResult({ stdout: JSON.stringify({ advisories: {} }) }),
    },
  ])("fails closed for $label", ({ result }) => {
    expect(() => interpretPnpmAuditProcessResult(result)).toThrow();
  });

  it("does not echo audit stderr into operational errors", () => {
    expect(() =>
      interpretPnpmAuditProcessResult(
        processResult({
          status: 2,
          stderr: "registry credential marker",
        }),
      )
    ).toThrowError(/exit status 2/u);
    try {
      interpretPnpmAuditProcessResult(
        processResult({ status: 2, stderr: "registry credential marker" }),
      );
    } catch (error: unknown) {
      expect(String(error)).not.toContain("registry credential marker");
    }
  });
});
