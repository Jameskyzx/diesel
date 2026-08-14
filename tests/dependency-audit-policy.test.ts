import { describe, expect, it } from "vitest";

import {
  auditPolicySchema,
  evaluateAuditPolicy,
  type AuditReport,
} from "../scripts/security/check-pnpm-audit";

function report(
  id: string,
  severity: "low" | "moderate" | "high" | "critical",
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

describe("dependency advisory policy", () => {
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
});
