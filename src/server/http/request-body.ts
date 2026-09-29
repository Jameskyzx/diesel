import "server-only";

export class RequestBodyTooLargeError extends Error {
  constructor(
    readonly maxBytes: number,
    readonly cleanup: Promise<void> = Promise.resolve(),
  ) {
    super(`Request body exceeds ${maxBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

export class RequestBodyTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly cleanup: Promise<void> = Promise.resolve(),
  ) {
    super(`Request body was not received within ${timeoutMs} milliseconds.`);
    this.name = "RequestBodyTimeoutError";
  }
}

export class RequestBodyAbortedError extends Error {
  constructor(readonly cleanup: Promise<void> = Promise.resolve()) {
    super("Request body reading was canceled by the client.");
    this.name = "RequestBodyAbortedError";
  }
}

async function readRequestBytes(
  request: Request,
  maxBytes: number,
  timeoutMs?: number,
  abortSignal?: AbortSignal,
): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const declaredBytes = Number(declaredLength);
    if (declaredBytes > maxBytes) {
      const cleanup = Promise.resolve()
        .then(() => request.body?.cancel("request-body-too-large"))
        .then(
          () => undefined,
          () => undefined,
        );
      throw new RequestBodyTooLargeError(maxBytes, cleanup);
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new SyntaxError("Request body is empty.");
  }

  if (
    timeoutMs !== undefined &&
    (!Number.isInteger(timeoutMs) || timeoutMs < 1)
  ) {
    throw new Error("Request body timeout must be a positive integer.");
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  let cancellation: Promise<void> | undefined;
  const cancelReader = (reason: string): Promise<void> => {
    cancellation ??= Promise.resolve()
      .then(() => reader.cancel(reason))
      .then(
        () => undefined,
        () => undefined,
      );
    return cancellation;
  };
  const deadline =
    timeoutMs === undefined
      ? null
      : new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new RequestBodyTimeoutError(
                timeoutMs,
                cancelReader("request-body-timeout"),
              ),
            );
          }, timeoutMs);
        });
  const aborted =
    abortSignal === undefined
      ? null
      : new Promise<never>((_resolve, reject) => {
          abortListener = () => {
            reject(
              new RequestBodyAbortedError(
                cancelReader("request-body-aborted"),
              ),
            );
          };
          abortSignal.addEventListener("abort", abortListener, { once: true });
          if (abortSignal.aborted) {
            abortListener();
          }
        });

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const read = reader.read();
      const { done, value } =
        deadline || aborted
          ? await Promise.race([
              read,
              ...(deadline ? [deadline] : []),
              ...(aborted ? [aborted] : []),
            ])
          : await read;
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new RequestBodyTooLargeError(
          maxBytes,
          cancelReader("request-body-too-large"),
        );
      }
      chunks.push(value);
    }
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (abortSignal !== undefined && abortListener !== undefined) {
      abortSignal.removeEventListener("abort", abortListener);
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export async function readFormDataRequest(
  request: Request,
  maxBytes: number,
  timeoutMs?: number,
  abortSignal?: AbortSignal,
): Promise<FormData> {
  const contentType = request.headers.get("content-type");
  const bytes = await readRequestBytes(
    request,
    maxBytes,
    timeoutMs,
    abortSignal,
  );
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new SyntaxError("Request body is not multipart form data.");
  }
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  try {
    return await new Request(request.url, {
      body,
      headers: { "content-type": contentType },
      method: "POST",
    }).formData();
  } catch {
    throw new SyntaxError("Request body is not valid multipart form data.");
  }
}

export async function readUtf8File(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SyntaxError("Uploaded file is not valid UTF-8.");
  }
}

export async function readJsonRequest(
  request: Request,
  maxBytes: number,
  timeoutMs?: number,
  abortSignal?: AbortSignal,
): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const bytes = await readRequestBytes(
    request,
    maxBytes,
    timeoutMs,
    abortSignal,
  );
  if (
    !contentType ||
    !/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/.test(contentType)
  ) {
    throw new SyntaxError("Request body is not JSON content.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SyntaxError("Request body is not valid UTF-8.");
  }

  const parsed: unknown = JSON.parse(text);
  return parsed;
}
