import { EventEmitter, once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type StaticModule = typeof import("next/dist/server/serve-static");
type ServeStatic = StaticModule["serveStatic"];
type Variant = "CJS" | "ESM body";
const require = createRequire(import.meta.url);

// Both VM variants read the installed package. ESM is transpiled only for this
// harness, not claimed as native Node ESM loading. Native CJS also runs below.
function installedModule(variant: Variant, sendOverride?: unknown): StaticModule {
  const source = readFileSync(require.resolve(variant === "CJS"
    ? "next/dist/server/serve-static" : "next/dist/esm/server/serve-static.js"), "utf8");
  const exports = {} as StaticModule;
  runInNewContext(variant === "CJS" ? source : ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports, Error,
    require: (name: string) => name === "next/dist/compiled/send" && sendOverride
      ? sendOverride : require(name),
  });
  return exports;
}

async function bounded<Value>(operation: Promise<Value>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then((value) => ({ state: "settled" as const, value })),
      new Promise<{ state: "pending" }>((resolve) => { timer = setTimeout(() => resolve({ state: "pending" }), 250); }),
    ]);
  } finally { clearTimeout(timer); }
}

let directory: string;
const contents = Buffer.from("static evidence\n".repeat(50));
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "diesel-next-static-"));
  await writeFile(join(directory, "small.txt"), contents);
  await writeFile(join(directory, "large.bin"), Buffer.alloc(8 * 1024 * 1024, 97));
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function httpCase(serve: ServeStatic, options: {
  file?: string; method?: string; headers?: Record<string, string>; cancel?: boolean;
} = {}) {
  const handled = Promise.withResolvers<{ error: unknown; rejected: boolean }>();
  const closed = Promise.withResolvers<void>();
  let outgoing: ServerResponse | undefined;
  let finishEvents = 0;
  const server = createServer((incoming, response) => {
    outgoing = response;
    response.once("finish", () => { finishEvents += 1; });
    response.once("close", closed.resolve);
    void serve(incoming, response, options.file ?? "small.txt", { root: directory }).then(
      () => handled.resolve({ rejected: false, error: null }),
      (error: unknown) => {
        handled.resolve({ rejected: true, error });
        if (!response.headersSent) { response.writeHead(500); response.end("fixture failure"); }
        else response.destroy();
      },
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const client = request({ hostname: "127.0.0.1", port: address.port, path: "/asset", agent: false,
    method: options.method ?? "GET", headers: options.headers });
  try {
    const received = await new Promise<{ status: number | undefined; headers: IncomingMessage["headers"]; body: Buffer }>((resolve, reject) => {
      client.once("error", reject);
      client.once("response", (response) => {
        const chunks: Buffer[] = [];
        response.on("error", (error: Error) => { if (!options.cancel) reject(error); });
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          if (options.cancel) { response.destroy(); client.destroy(); }
        });
        response.once(options.cancel ? "close" : "end", () => resolve({
          status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks),
        }));
      });
      client.end();
    });
    await closed.promise;
    const outcome = await bounded(handled.promise);
    return { received, outcome, finishEvents, transport: {
      destroyed: outgoing?.destroyed, finished: outgoing?.writableFinished, ended: outgoing?.writableEnded,
    } };
  } finally {
    client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe.each([
  ["CJS", (require("next/dist/server/serve-static") as StaticModule).serveStatic],
  ["ESM body", installedModule("ESM body").serveStatic],
] as const)("installed static-file HTTP lifecycle (%s)", (_variant, serve) => {
  it("delivers exact normal bytes and metadata", async () => {
    const result = await httpCase(serve);
    expect(result.received.status).toBe(200);
    expect(result.received.body).toEqual(contents);
    expect(result.received.headers["content-length"]).toBe(String(contents.length));
    expect(result.received.headers.etag).toEqual(expect.any(String));
    expect(result.outcome).toEqual({ state: "settled", value: { rejected: false, error: null } });
    expect(result.finishEvents).toBe(1);
  });

  it("preserves HEAD and conditional 304 without response bodies", async () => {
    const first = await httpCase(serve, { method: "HEAD" });
    expect(first.received.status).toBe(200);
    expect(first.received.body.length).toBe(0);
    const etag = first.received.headers.etag;
    if (!etag) throw new Error("Missing fixture etag");
    const second = await httpCase(serve, { headers: { "if-none-match": etag } });
    expect(second.received.status).toBe(304);
    expect(second.received.body.length).toBe(0);
    for (const result of [first, second]) {
      expect(result.outcome).toEqual({ state: "settled", value: { rejected: false, error: null } });
      expect(result.finishEvents).toBe(1);
    }
  });

  it("retains range response bytes", async () => {
    const result = await httpCase(serve, { headers: { range: "bytes=2-8" } });
    expect(result.received.status).toBe(206);
    expect(result.received.body).toEqual(contents.subarray(2, 9));
    expect(result.outcome).toMatchObject({ state: "settled", value: { rejected: false } });
  });

  it.each(["missing.txt", "."])("preserves missing-file/directory rejection (%s)", async (file) => {
    const result = await httpCase(serve, { file });
    expect(result.outcome).toMatchObject({ state: "settled", value: { rejected: true, error: { code: "ENOENT" } } });
  });

  it("settles a real mid-file disconnect without a synthetic finish or completed delivery", async () => {
    const result = await httpCase(serve, { file: "large.bin", cancel: true });
    expect(result.received.body.length).toBeGreaterThan(0);
    expect(result.received.body.length).toBeLessThan(8 * 1024 * 1024);
    expect(result.outcome).toEqual({ state: "settled", value: { rejected: false, error: null } });
    expect(result.transport).toMatchObject({ destroyed: true, finished: false });
    expect(result.finishEvents).toBe(0);
  });
});

class ResponseDouble extends EventEmitter {
  destroyed = false;
  closed = false;
  writableFinished = false;
  errored: Error | null = null;
  asResponse() { return this as unknown as ServerResponse; }
}

function controlled(variant: Variant, onPipe?: (response: ResponseDouble) => void) {
  const response = new ResponseDouble();
  const source = Object.assign(new EventEmitter(), {
    pipe: vi.fn((target: ResponseDouble) => { onPipe?.(target); return target; }),
  });
  const send = Object.assign(vi.fn(() => source), { mime: { define: vi.fn() } });
  const serve = installedModule(variant, send).serveStatic;
  return { response, source, send, run: () => serve({} as IncomingMessage, response.asResponse(), "fixture") };
}

describe.each(["CJS", "ESM body"] as const)("installed static-file terminal races (%s)", (variant) => {
  it.each(["destroyed", "closed", "writableFinished"] as const)("does not start new I/O for an already %s response", async (flag) => {
    const fixture = controlled(variant);
    fixture.response[flag] = true;
    expect(await bounded(fixture.run())).toEqual({ state: "settled", value: undefined });
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it("observes a close emitted synchronously by pipe", async () => {
    const fixture = controlled(variant, (response) => { response.destroyed = true; response.emit("close"); });
    expect(await bounded(fixture.run())).toEqual({ state: "settled", value: undefined });
    expect(fixture.response.writableFinished).toBe(false);
  });

  it.each(["source", "response", "pipe", "closed-response"] as const)("retains actual failure and cleans owned terminal listeners (%s)", async (origin) => {
    const failure = new Error("STATIC_READ_OR_WRITE_FAILURE");
    const fixture = controlled(variant, origin === "pipe" ? () => { throw failure; } : undefined);
    if (origin === "closed-response") {
      fixture.response.destroyed = true;
      fixture.response.errored = failure;
    }
    const operation = fixture.run();
    const observed = operation.catch((error: unknown) => error);
    if (origin === "source") fixture.source.emit("error", failure);
    if (origin === "response") {
      // Model the framework's independent error listener. Its existence cannot
      // make the serveStatic Promise silently resolve or stay pending.
      fixture.response.on("error", () => undefined);
      fixture.response.emit("error", failure);
    }
    expect(await bounded(observed)).toEqual({ state: "settled", value: failure });
    expect(fixture.response.listenerCount("close")).toBe(0);
    expect(fixture.response.listenerCount("finish")).toBe(0);
  });

  it("keeps late source errors observed after cancellation without changing its settled outcome", async () => {
    const fixture = controlled(variant);
    const operation = fixture.run();
    fixture.response.destroyed = true;
    fixture.response.emit("close");
    expect(await bounded(operation)).toEqual({ state: "settled", value: undefined });
    expect(() => fixture.source.emit("error", new Error("LATE_SOURCE_FAILURE"))).not.toThrow();
    expect(fixture.response.listenerCount("close")).toBe(0);
    expect(fixture.response.listenerCount("finish")).toBe(0);
  });
});
