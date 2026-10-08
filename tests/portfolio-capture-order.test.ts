import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const captureOrder = [
  "pnpm portfolio:capture-screenshots",
  "pnpm portfolio:capture-playwright-evidence",
  "pnpm portfolio:capture-vitest-evidence",
  "pnpm portfolio:verify -- --release-evidence",
] as const;

describe("documented portfolio capture dependency order", () => {
  it.each(["README.md", "README.zh-CN.md"])(
    "%s captures upstream artifacts before their consumers",
    (file) => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      // Capture is now an explicitly scoped numbered workflow, not an
      // unconditional code block under the daily verification heading.
      const commands = [...source.matchAll(/^\d+\.\s[^\n]*(?:\n[ \t]+[^\n]*)*/gmu)]
        .flatMap((step) => [...step[0].matchAll(/`(pnpm [^`]+)`/gu)].map((match) => match[1]));
      expect(commands).toEqual(captureOrder);
      expect(source).toContain("AGENTS.md#scope-and-validation");
    },
  );
});
