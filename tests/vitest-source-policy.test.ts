import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isIndependentOperatorRecord, normalizeVitestSourceBytes } from "../scripts/portfolio/vitest-source-policy";

const statusPath = "docs/STATUS.md";
const status = readFileSync(statusPath, "utf8");
const normalized = (value: string) => normalizeVitestSourceBytes(statusPath, Buffer.from(value));

describe("Vitest v2 source scope", () => {
  it("keeps operator observations separate while retaining all executable/deployment inputs", () => {
    expect(isIndependentOperatorRecord("docs/evidence/operations/release-2026-10-04.json")).toBe(true);
    for (const path of [
      "docs/evidence/operations/script.ts", "docs/evidence/operations/run.sh",
      "docs/evidence/operations/nested/report.json", "docs/evidence/operations/.hidden.json",
      "docs/evidence/operations/report.json.bak", "docs/DEPLOYMENT.md",
      "docs/evidence/playwright-e2e-latest.json", "docs/evals/ai-live-eval-latest.json",
    ]) expect(isIndependentOperatorRecord(path)).toBe(false);
  });

  it("normalizes only observed release fields and their mirrored bullets", () => {
    const release = /"currentPublicRelease": \{\s*"commit": "([a-f0-9]{40})"/u.exec(status)?.[1];
    expect(release).toBeDefined();
    // The same SHA may appear in candidate narrative: that prose remains bound.
    const blockOnly = status.replace(
      /<!-- portfolio-verification:start -->[\s\S]*?<!-- portfolio-verification:end -->/u,
      (block) => block.replaceAll(release!, "f".repeat(40)),
    );
    expect(normalized(blockOnly)).toEqual(normalized(status));
    const observation = status.replace(/(observedAt=)`[^`]+`/u, "$1`2030-01-01T00:00+00:00`");
    expect(normalized(observation)).toEqual(normalized(status));
  });

  it("binds quality/browser/live-eval facts, evidence counts and ordinary prose", () => {
    for (const changed of [
      status.replace('"approvedRealProducts": 0', '"approvedRealProducts": 1'),
      status.replace('"suiteCaseCount": 18', '"suiteCaseCount": 19'),
      status.replace('"version": "diesel-playwright-evidence-v1"', '"version": "changed"'),
      `${status}\nA new behavior claim.\n`,
    ]) expect(normalized(changed)).not.toEqual(normalized(status));
    const deployment = Buffer.from("Executable deployment procedure.");
    expect(normalizeVitestSourceBytes("docs/DEPLOYMENT.md", deployment)).toBe(deployment);
  });

  it("rejects missing, duplicated or malformed snapshot/bullet boundaries", () => {
    for (const changed of [
      status.replace("<!-- portfolio-verification:start -->", ""),
      status + "\n- 公开只读演示：duplicate\n",
      status.replace('"currentPublicRelease": {', '"missingRelease": {'),
      status.replace('"currentPublicRelease": {', '"currentPublicRelease": invalid {'),
    ]) expect(() => normalized(changed)).toThrow();
  });
});
