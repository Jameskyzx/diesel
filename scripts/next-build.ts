import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { formatErrorTree } from "./format-error";
import {
  createNextEnvironmentFileGuard,
  restoreNextEnvironmentAfterFailure,
  restoreNextEnvironmentAfterOperation,
} from "./next-environment-file";

export type NextBuildRunner = () => Promise<number>;

type NextBuildChild = Readonly<{
  exitCode: number | null;
  kill: (signal: NodeJS.Signals) => boolean;
  signalCode: NodeJS.Signals | null;
}>;

export type NextBuildSignalController = Readonly<{
  attachChild: (child: NextBuildChild | null) => void;
  handleSignal: (signal: NodeJS.Signals) => void;
  requestedSignal: NodeJS.Signals | null;
}>;

export function createNextBuildChildEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  delete environment.PLAYWRIGHT_E2E;
  return environment;
}

export function createNextBuildSignalController(): NextBuildSignalController {
  let child: NextBuildChild | null = null;
  let requestedSignal: NodeJS.Signals | null = null;

  return {
    attachChild(nextChild) {
      child = nextChild;
    },
    handleSignal(signal) {
      requestedSignal ??= signal;
      if (child?.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    },
    get requestedSignal() {
      return requestedSignal;
    },
  };
}

export async function runNextBuildWithEnvironmentGuard(input: Readonly<{
  nextEnvironmentPath?: string;
  runner: NextBuildRunner;
}>): Promise<number> {
  const guard = await createNextEnvironmentFileGuard(
    {
      allowedGeneratedRouteImports: ["./.next/types/routes.d.ts"],
      path: input.nextEnvironmentPath,
    },
  );
  let exitCode: number;
  try {
    exitCode = await input.runner();
  } catch (error: unknown) {
    return restoreNextEnvironmentAfterFailure(guard, error);
  }
  await restoreNextEnvironmentAfterOperation(guard);
  return exitCode;
}

function spawnNextBuild(
  signalController: NextBuildSignalController,
): Promise<number> {
  if (signalController.requestedSignal !== null) {
    return Promise.reject(
      new Error(
        `Next.js build was cancelled by ${signalController.requestedSignal}.`,
      ),
    );
  }
  const require = createRequire(import.meta.url);
  const nextCli = require.resolve("next/dist/bin/next");
  return new Promise((resolveExitCode, reject) => {
    const child = spawn(
      process.execPath,
      [nextCli, "build", "--webpack"],
      {
        cwd: process.cwd(),
        env: createNextBuildChildEnvironment(process.env),
        stdio: "inherit",
      },
    );
    signalController.attachChild(child);
    let settled = false;
    const childErrors: unknown[] = [];
    child.on("error", (error) => {
      childErrors.push(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      signalController.attachChild(null);
      const terminalErrors = [...childErrors];
      if (signal !== null) {
        terminalErrors.push(
          new Error(`Next.js build was terminated by ${signal}.`),
        );
      } else if (code === null || !Number.isSafeInteger(code)) {
        terminalErrors.push(
          new Error("Next.js build returned no valid exit status."),
        );
      }
      if (terminalErrors.length === 1) {
        reject(terminalErrors[0]);
        return;
      }
      if (terminalErrors.length > 1) {
        reject(new AggregateError(
          terminalErrors,
          "Next.js build child failed and reported multiple terminal errors.",
        ));
        return;
      }
      if (code === null) {
        reject(new Error("Next.js build returned no exit status."));
        return;
      }
      resolveExitCode(code);
    });
  });
}

async function main(): Promise<void> {
  const signalController = createNextBuildSignalController();
  const forwardedSignals = ["SIGINT", "SIGTERM"] as const;
  for (const signal of forwardedSignals) {
    process.on(signal, signalController.handleSignal);
  }
  try {
    const exitCode = await runNextBuildWithEnvironmentGuard({
      runner: () => spawnNextBuild(signalController),
    });
    if (signalController.requestedSignal !== null) {
      throw new Error(
        `Next.js build was cancelled by ${signalController.requestedSignal}.`,
      );
    }
    process.exitCode = exitCode;
  } finally {
    for (const signal of forwardedSignals) {
      process.off(signal, signalController.handleSignal);
    }
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error: unknown) => {
    process.stderr.write(formatErrorTree(error, "next-build"));
    process.exitCode = 1;
  });
}
