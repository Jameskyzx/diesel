import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PortfolioVerificationInputLedger } from "../scripts/portfolio/verification-input-snapshot";

async function createFixture(): Promise<{
  file: string;
  ledger: PortfolioVerificationInputLedger;
  workspace: string;
}> {
  const created = await mkdtemp(join(tmpdir(), "diesel-portfolio-inputs-"));
  const workspace = await realpath(created);
  const file = resolve(workspace, "input.txt");
  await writeFile(file, "before\n");
  return {
    file,
    ledger: new PortfolioVerificationInputLedger(workspace),
    workspace,
  };
}

describe("portfolio verification input snapshots", () => {
  it("accepts unchanged regular files across the final two-pass barrier", async () => {
    const { ledger } = await createFixture();

    await expect(ledger.readUtf8("input.txt")).resolves.toBe("before\n");
    await expect(ledger.assertUnchanged()).resolves.toBeUndefined();
  });

  it("deterministically catches a mutation while verification is deliberately paused", async () => {
    const { file, ledger } = await createFixture();
    await ledger.readUtf8("input.txt");
    let resume = (): void => {
      throw new Error("Pause was not initialized.");
    };
    const pause = new Promise<void>((resolvePause) => {
      resume = resolvePause;
    });
    const delayedVerification = (async () => {
      await pause;
      await ledger.assertUnchanged();
    })();

    await writeFile(file, "after\n");
    resume();

    await expect(delayedVerification).rejects.toThrow(
      "changed during portfolio verification",
    );
  });

  it.each<{
    mutate: (input: { file: string; workspace: string }) => Promise<void>;
    name: string;
  }>([
    {
      name: "disappearance",
      mutate: async ({ file }) => unlink(file),
    },
    {
      name: "a symlink replacement",
      mutate: async ({ file, workspace }) => {
        const target = resolve(workspace, "target.txt");
        await writeFile(target, "before\n");
        await unlink(file);
        await symlink("target.txt", file);
      },
    },
    {
      name: "a directory replacement",
      mutate: async ({ file }) => {
        await unlink(file);
        await mkdir(file);
      },
    },
    {
      name: "a mode change",
      mutate: async ({ file }) => {
        const before = await stat(file);
        await chmod(file, before.mode ^ 0o100);
      },
    },
    {
      name: "an atomic same-byte replacement",
      mutate: async ({ file, workspace }) => {
        const replacement = resolve(workspace, "replacement.txt");
        await writeFile(replacement, "before\n");
        await rename(replacement, file);
      },
    },
  ])("fails closed on $name", async ({ mutate }) => {
    const { file, ledger, workspace } = await createFixture();
    await ledger.readBytes("input.txt");

    await mutate({ file, workspace });

    await expect(ledger.assertUnchanged()).rejects.toThrow();
  });

  it("binds directory inventory and selected file bytes", async () => {
    const { ledger, workspace } = await createFixture();
    await mkdir(resolve(workspace, "records"));
    await writeFile(resolve(workspace, "records/a.json"), "{\"a\":1}\n");
    await writeFile(resolve(workspace, "records/b.json"), "{\"b\":1}\n");

    await expect(
      ledger.snapshotDirectoryFiles("records", {
        include: (filename) => filename.endsWith(".json"),
      }),
    ).resolves.toEqual(["records/a.json", "records/b.json"]);
    await writeFile(resolve(workspace, "records/c.json"), "{\"c\":1}\n");

    await expect(ledger.assertUnchanged()).rejects.toThrow(
      "changed during portfolio verification",
    );
  });

  it("wires the byte ledger into ordinary portfolio verification before success", async () => {
    const source = await readFile(
      resolve(process.cwd(), "scripts/portfolio/verify.ts"),
      "utf8",
    );
    const construction = source.indexOf(
      "new PortfolioVerificationInputLedger(workspace)",
    );
    const finalBarrier = source.indexOf(
      "await verificationInputs.assertUnchanged();",
    );
    const releaseRecheck = source.indexOf(
      "const completedReleaseEvidence = releaseEvidenceMode",
    );
    const vitestEvidenceRecheck = source.lastIndexOf(
      "readVitestExecutionEvidence(workspace).text",
    );
    const successRelease = source.indexOf("captureLock.release();", finalBarrier);

    expect(construction).toBeGreaterThan(-1);
    expect(finalBarrier).toBeGreaterThan(releaseRecheck);
    expect(finalBarrier).toBeGreaterThan(vitestEvidenceRecheck);
    expect(finalBarrier).toBeGreaterThan(construction);
    expect(successRelease).toBeGreaterThan(finalBarrier);
    for (const requiredInput of [
      "docs/STATUS.md",
      "docs/evals/ai-live-eval-latest.json",
      "docs/evals/README.md",
      "docs/evals/archive",
      "README.md",
      "README.zh-CN.md",
      "docs/FDE_CASE_STUDY.md",
      "docs/ARCHITECTURE.md",
      "package.json",
      "vitestExecutionEvidencePath",
    ]) {
      expect(source).toContain(requiredInput);
    }
  });
});
