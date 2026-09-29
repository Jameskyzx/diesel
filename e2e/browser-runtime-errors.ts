import { Buffer } from "node:buffer";

type ErrorListener = (error: Error) => void;
type PageErrorSource = {
  on: (event: "pageerror", listener: ErrorListener) => unknown;
  off: (event: "pageerror", listener: ErrorListener) => unknown;
};
type RuntimeErrorArtifacts = {
  attach: (name: string, options: { body: Buffer; contentType: string }) => Promise<void>;
};

function sampleError(error: Error) {
  const stack = error.stack ?? null;
  return {
    name: error.name.slice(0, 200),
    message: error.message.slice(0, 2_000),
    stack: stack?.slice(0, 8_000) ?? null,
    truncated: error.name.length > 200 || error.message.length > 2_000 || (stack?.length ?? 0) > 8_000,
  };
}

/** Checks only the wrapped actions; diagnostics do not enter passing run receipts. */
export async function checkBrowserRuntimeErrors(
  page: PageErrorSource,
  artifacts: RuntimeErrorArtifacts,
  action: () => Promise<void>,
): Promise<void> {
  let totalErrors = 0;
  const samples: ReturnType<typeof sampleError>[] = [];
  const failures: unknown[] = [];
  const listener: ErrorListener = (error) => {
    totalErrors++;
    if (samples.length < 10) samples.push(sampleError(error));
  };
  page.on("pageerror", listener);
  try {
    await action();
  } catch (error: unknown) {
    failures.push(error);
  } finally {
    page.off("pageerror", listener);
  }
  if (totalErrors > 0) {
    failures.push(new Error(
      `${totalErrors} unhandled browser runtime error${totalErrors === 1 ? "" : "s"}; see unhandled-browser-runtime-errors attachment.`,
    ));
    try {
      await artifacts.attach("unhandled-browser-runtime-errors", {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify({
          version: "scoped-browser-runtime-errors-v1",
          scope: "wrapped-browser-actions",
          totalErrors,
          omittedErrors: totalErrors - samples.length,
          samples,
        }, null, 2)),
      });
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Browser actions and runtime-error checks failed.");
  }
}
