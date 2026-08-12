import "server-only";

export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

export class RequestBodyTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Request body was not received within ${timeoutMs} milliseconds.`);
    this.name = "RequestBodyTimeoutError";
  }
}

async function readRequestBytes(
  request: Request,
  maxBytes: number,
  timeoutMs?: number,
): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const declaredBytes = Number(declaredLength);
    if (declaredBytes > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
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
  const deadline =
    timeoutMs === undefined
      ? null
      : new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new RequestBodyTimeoutError(timeoutMs));
            void reader.cancel("request-body-timeout").catch(() => undefined);
          }, timeoutMs);
        });

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = deadline
        ? await Promise.race([reader.read(), deadline])
        : await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the deterministic payload-too-large error.
        }
        throw new RequestBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
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
): Promise<FormData> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new SyntaxError("Request body is not multipart form data.");
  }

  const bytes = await readRequestBytes(request, maxBytes);
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
): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    !contentType ||
    !/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/.test(contentType)
  ) {
    throw new SyntaxError("Request body is not JSON content.");
  }

  const bytes = await readRequestBytes(request, maxBytes, timeoutMs);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SyntaxError("Request body is not valid UTF-8.");
  }

  const parsed: unknown = JSON.parse(text);
  return parsed;
}
