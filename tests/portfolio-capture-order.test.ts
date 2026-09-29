import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const captureOrder = [
  "pnpm portfolio:capture-screenshots",
  "pnpm portfolio:capture-playwright-evidence",
  "pnpm portfolio:capture-vitest-evidence",
  "pnpm portfolio:verify",
] as const;

describe("documented portfolio capture dependency order", () => {
  it.each(["README.md", "README.zh-CN.md"])(
    "%s captures upstream artifacts before their consumers",
    (file) => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      const blocks = [...source.matchAll(/```bash\n([\s\S]*?)\n```/gu)]
        .map((match) => (match[1] ?? "").split("\n"))
        .filter((lines) => lines.includes(captureOrder[2]));
      expect(blocks).toHaveLength(1);
      const commands = blocks[0]!.filter((line) =>
        captureOrder.some((command) => line === command),
      );
      expect(commands).toEqual(captureOrder);
    },
  );
});
