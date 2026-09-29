import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

type CapturedFailure = Readonly<{ error: unknown }>;

/**
 * Persist a complete UTF-8 artifact without exposing a partially written
 * destination. The temporary path is cleaned up only while this invocation
 * still owns the file it created, and concurrent persistence/cleanup failures
 * remain independently inspectable.
 */
export async function persistAtomicTextFile(input: {
  combinedFailureMessage: string;
  contents: string;
  outputPath: string;
}): Promise<void> {
  const temporaryPath =
    `${input.outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(input.outputPath), { recursive: true });

  let ownsTemporaryFile = false;
  let persistenceFailure: CapturedFailure | null = null;
  try {
    const temporaryFile = await open(temporaryPath, "wx");
    ownsTemporaryFile = true;

    let writeFailure: CapturedFailure | null = null;
    try {
      await temporaryFile.writeFile(input.contents, { encoding: "utf8" });
    } catch (error: unknown) {
      writeFailure = { error };
    }

    let closeFailure: CapturedFailure | null = null;
    try {
      await temporaryFile.close();
    } catch (error: unknown) {
      closeFailure = { error };
    }

    if (writeFailure && closeFailure) {
      throw new AggregateError(
        [writeFailure.error, closeFailure.error],
        "Atomic temporary file write and close failed.",
      );
    }
    if (writeFailure) throw writeFailure.error;
    if (closeFailure) throw closeFailure.error;

    await rename(temporaryPath, input.outputPath);
    ownsTemporaryFile = false;
  } catch (error: unknown) {
    persistenceFailure = { error };
  }

  let cleanupFailure: CapturedFailure | null = null;
  if (ownsTemporaryFile) {
    try {
      await rm(temporaryPath, { force: true });
    } catch (error: unknown) {
      cleanupFailure = { error };
    }
  }

  if (persistenceFailure && cleanupFailure) {
    throw new AggregateError(
      [persistenceFailure.error, cleanupFailure.error],
      input.combinedFailureMessage,
    );
  }
  if (persistenceFailure) throw persistenceFailure.error;
  if (cleanupFailure) throw cleanupFailure.error;
}
