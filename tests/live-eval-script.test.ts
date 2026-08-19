import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("live eval initialization reporting", () => {
  it.each([
    {
      linkMigrations: false,
      stage: "module_import",
      useWorkspaceTsconfig: false,
    },
    {
      linkMigrations: false,
      stage: "database",
      useWorkspaceTsconfig: true,
    },
    {
      linkMigrations: true,
      stage: "model_configuration",
      useWorkspaceTsconfig: true,
    },
  ] as const)(
    "persists an honest v2 report for a $stage failure before any case",
    async ({ linkMigrations, stage, useWorkspaceTsconfig }) => {
      const workspace = process.cwd();
      const temporaryWorkspace = await mkdtemp(
        resolve(tmpdir(), "diesel-live-eval-init-"),
      );

      try {
        if (linkMigrations) {
          await symlink(
            resolve(workspace, "drizzle"),
            resolve(temporaryWorkspace, "drizzle"),
            "dir",
          );
        }
        const secret = "INIT-SECRET-SHOULD-NOT-APPEAR";
        const childEnvironment: NodeJS.ProcessEnv = {
          ...process.env,
          AI_API_KEY: secret,
          AI_BASE_URL: "",
          AI_ENABLE_THINKING: "",
          AI_MODEL: "",
          AI_MULTIMODAL_MODEL: "",
          AI_PROVIDER: "openai-compatible",
          NODE_ENV: "development",
        };
        if (useWorkspaceTsconfig) {
          childEnvironment.TSX_TSCONFIG_PATH = resolve(
            workspace,
            "tsconfig.json",
          );
        } else {
          delete childEnvironment.TSX_TSCONFIG_PATH;
        }
        const execution = spawnSync(
          process.execPath,
          [
            "--conditions=react-server",
            "--import",
            import.meta.resolve("tsx"),
            resolve(workspace, "scripts/ai/live-eval.ts"),
          ],
          {
            cwd: temporaryWorkspace,
            encoding: "utf8",
            env: childEnvironment,
            timeout: 30_000,
          },
        );

        expect(execution.error).toBeUndefined();
        expect(
          execution.status,
          `${execution.stderr}\n${execution.stdout}`,
        ).toBe(1);
        const reportText = await readFile(
          resolve(
            temporaryWorkspace,
            "docs/evals/ai-live-eval-latest.json",
          ),
          "utf8",
        );
        const report = JSON.parse(reportText) as Record<string, unknown>;

        expect(report).toMatchObject({
          budget: {
            caseCount: 0,
            modelStepCount: 0,
            totalTokens: 0,
          },
          complete: false,
          modelId: null,
          results: [],
          runError: {
            code: "INITIALIZATION_ERROR",
            stage,
          },
          sampleCount: 0,
          thresholdsPassed: false,
          version: "sales-chat-live-v2",
        });
        expect(reportText).toMatch(
          /"errorName": "[A-Za-z][A-Za-z0-9._-]{0,63}"/u,
        );
        expect(
          Object.keys(report.runError as Record<string, unknown>).sort(),
        ).toEqual(["code", "errorName", "stage"]);
        expect(reportText).not.toContain(secret);
        expect(execution.stderr).not.toContain(secret);
      } finally {
        await rm(temporaryWorkspace, { force: true, recursive: true });
      }
    },
    30_000,
  );
});
