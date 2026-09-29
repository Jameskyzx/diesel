import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import {
  assertPlaywrightObservationSourceLocations,
  assertPlaywrightReceiptInventoryMatchesEvidence,
  capturePlaywrightRepositoryState,
  parseCanonicalPlaywrightEvidence,
  parseCanonicalPlaywrightRunReceipt,
  playwrightEvidencePath,
  playwrightRunContracts,
  type PlaywrightRunId,
} from "./playwright-evidence";
import { assertVerificationEqual } from "./verification-issues";

const runIdSchema = z.enum(
  playwrightRunContracts.map(({ id }) => id) as [
    PlaywrightRunId,
    ...PlaywrightRunId[],
  ],
);

async function main(): Promise<void> {
  const rawArguments = process.argv.slice(2);
  const suiteArguments = rawArguments[0] === "--"
    ? rawArguments.slice(1)
    : rawArguments;
  const ids = z.array(runIdSchema).min(1).max(playwrightRunContracts.length).parse(
    suiteArguments,
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error("Playwright receipt verification received duplicate suites.");
  }
  const workspace = process.cwd();
  const checkedInEvidence = parseCanonicalPlaywrightEvidence(
    await readFile(resolve(workspace, playwrightEvidencePath), "utf8"),
  );
  const currentState = capturePlaywrightRepositoryState(workspace);
  for (const id of ids) {
    const contract = playwrightRunContracts.find((candidate) => candidate.id === id);
    if (!contract) throw new Error(`Unknown Playwright run contract: ${id}`);
    const receipt = parseCanonicalPlaywrightRunReceipt(
      await readFile(resolve(workspace, contract.receiptPath), "utf8"),
    );
    assertVerificationEqual(receipt.id, id, `${id} receipt identity`);
    const checkedInRun = checkedInEvidence.runs.find((run) => run.id === id);
    if (!checkedInRun) {
      throw new Error(`Checked-in Playwright evidence is missing the ${id} run.`);
    }
    assertPlaywrightObservationSourceLocations(workspace, receipt.tests);
    assertPlaywrightObservationSourceLocations(workspace, checkedInRun.tests);
    assertPlaywrightReceiptInventoryMatchesEvidence(
      receipt,
      checkedInEvidence,
    );
    assertVerificationEqual(
      receipt.provenance.completed,
      currentState,
      `${id} receipt/current source`,
    );
    if (!receipt.complete) {
      throw new Error(`${id} Playwright receipt is not a complete passing run.`);
    }
  }

  if (process.env.GITHUB_ACTIONS === "true") {
    const githubSha = z.string().regex(/^[0-9a-f]{40}$/u).parse(
      process.env.GITHUB_SHA,
    );
    assertVerificationEqual(currentState.worktreeState, "clean", "CI worktree state");
    assertVerificationEqual(currentState.headCommit, githubSha, "CI checkout commit");
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput !== undefined) {
    if (githubOutput.trim().length === 0) {
      throw new Error("GITHUB_OUTPUT must name the current step output file.");
    }
    await appendFile(githubOutput, "verified=true\n", "utf8");
  }
  process.stdout.write(`Verified Playwright receipts: ${ids.join(", ")}.\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Playwright receipt verification failed."}\n`,
  );
  process.exitCode = 1;
});
