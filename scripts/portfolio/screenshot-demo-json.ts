const maximumResponseBytes = 4 * 1024;

function cancelWithoutWaiting(cancel: () => Promise<void>): void {
  try {
    void cancel().catch(() => undefined);
  } catch {
    // A failed or uncooperative cleanup must not replace the admission failure.
  }
}

export function discardScreenshotDemoResponse(response: Response): void {
  cancelWithoutWaiting(async () => {
    await response.body?.cancel();
  });
}

/** Read the actual streamed bytes within the request's existing deadline. */
export async function readScreenshotDemoJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const abortedError = () =>
    new Error("Screenshot demo response reading was aborted.");
  if (signal.aborted) {
    discardScreenshotDemoResponse(response);
    throw abortedError();
  }
  const declaredLength = response.headers.get("content-length")?.trim();
  if (
    declaredLength &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > maximumResponseBytes
  ) {
    discardScreenshotDemoResponse(response);
    throw new Error("Screenshot demo response exceeded its size limit.");
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    if (!response.body) throw new Error("Missing body");
    reader = response.body.getReader();
  } catch {
    throw new Error("Screenshot demo response body is unavailable.");
  }
  let finished = false;
  let canceled = false;
  const cancel = () => {
    if (canceled) return;
    canceled = true;
    cancelWithoutWaiting(() => reader.cancel());
  };
  let abortListener: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => {
      reject(abortedError());
      cancel();
    };
    signal.addEventListener("abort", abortListener, { once: true });
    if (signal.aborted) abortListener();
  });
  const bytes = new Uint8Array(maximumResponseBytes);
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await Promise.race([
        reader.read().catch(() => {
          throw new Error("Screenshot demo response could not be read.");
        }),
        aborted,
      ]);
      if (signal.aborted) throw abortedError();
      if (chunk.done) {
        finished = true;
        break;
      }
      if (chunk.value.byteLength > maximumResponseBytes - byteLength) {
        throw new Error("Screenshot demo response exceeded its size limit.");
      }
      bytes.set(chunk.value, byteLength);
      byteLength += chunk.value.byteLength;
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, byteLength),
      );
    } catch {
      throw new Error("Screenshot demo response is not valid UTF-8.");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Screenshot demo response is not valid JSON.");
    }
  } finally {
    signal.removeEventListener("abort", abortListener);
    if (!finished) cancel();
    reader.releaseLock();
  }
}
