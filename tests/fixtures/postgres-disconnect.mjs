import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

// Exercise the installed driver, not a mock of begin(). No network or database.
const load = createRequire(import.meta.url);
const [mode, scenario] = process.argv.slice(2);
const postgres = mode === "cjs" ? load("postgres") : (await import("postgres")).default;
const statements = [];
const sockets = [];

function frame(type, payload) {
  const header = Buffer.alloc(5);
  header[0] = type.charCodeAt(0);
  header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

class FakeSocket extends EventEmitter {
  readyState = "open";
  writable = true;
  writableLength = 0;
  initialized = false;
  transaction = false;
  parsedQuery = "";
  setKeepAlive() {}
  write(data, callback) {
    const bytes = Buffer.from(data);
    setImmediate(() => {
      if (this.readyState === "closed") return;
      if (!this.initialized) {
        this.initialized = true;
        const backend = Buffer.alloc(8);
        backend.writeInt32BE(123, 0);
        this.emit("data", Buffer.concat([
          frame("R", Buffer.alloc(4)), frame("K", backend), frame("Z", Buffer.from("I")),
        ]));
      } else {
        for (let offset = 0; offset + 5 <= bytes.length;) {
          const type = String.fromCharCode(bytes[offset]);
          const size = bytes.readInt32BE(offset + 1);
          const payload = bytes.subarray(offset + 5, offset + 1 + size);
          offset += size + 1;
          if (type === "P") {
            this.parsedQuery = payload.toString("utf8").split("\0")[1];
            this.emit("data", frame("1", Buffer.alloc(0)));
            continue;
          }
          if (type === "B" || type === "D" || type === "S") {
            this.emit("data", frame(type === "B" ? "2" : type === "D" ? "n" : "Z",
              type === "S" ? Buffer.from(this.transaction ? "T" : "I") : Buffer.alloc(0)));
            continue;
          }
          if (type !== "Q" && type !== "E") continue;
          const query = type === "Q" ? payload.toString("utf8").replace(/\0$/, "") : this.parsedQuery;
          statements.push(query);
          if (query === "select 77") { this.end(); return; }
          if (query.startsWith("begin")) this.transaction = true;
          if (/^(commit|rollback)$/.test(query)) this.transaction = false;
          const tag = query.startsWith("begin") ? "BEGIN" : "SELECT 0";
          this.emit("data", type === "Q" ? Buffer.concat([
            frame("C", Buffer.from(tag + "\0")), frame("Z", Buffer.from(this.transaction ? "T" : "I")),
          ]) : frame("C", Buffer.from(tag + "\0")));
        }
      }
      callback?.();
    });
    return true;
  }
  end() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.writable = false;
    this.emit("close", false);
  }
  destroy() { this.end(); }
}

const deadline = setTimeout(() => { process.exit(2); }, 5_000);
const client = postgres({
  host: "127.0.0.1", username: "offline", database: "offline", ssl: false,
  fetch_types: false, prepare: false, max: 1, max_pipeline: 1,
  max_lifetime: null, idle_timeout: 0, connect_timeout: 0,
  socket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
});

try {
  await client.unsafe("select 1");
  if (scenario === "idle-continuation") {
    let enter;
    let resume;
    const entered = new Promise(resolve => { enter = resolve; });
    const resumed = new Promise(resolve => { resume = resolve; });
    let lateError;
    let finishCallback;
    const callbackFinished = new Promise(resolve => { finishCallback = resolve; });
    const transaction = client.begin(async tx => {
      enter();
      await resumed;
      try { await tx.unsafe("select 99"); } catch (error) { lateError = error; }
      finishCallback();
    });
    const rejected = assert.rejects(transaction, { code: "CONNECTION_CLOSED" });
    await entered;
    sockets[0].end();
    await rejected;
    await client.unsafe("select 3"); // reconnect before the stale callback resumes
    resume();
    await callbackFinished;
    assert.equal(lateError?.code, "CONNECTION_CLOSED");
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(!statements.includes("select 99"));
    assert.ok(!statements.includes("commit"));
  } else if (scenario === "queue") {
    let outcomes;
    await assert.rejects(client.begin(async tx => {
      outcomes = await Promise.allSettled([
        tx.unsafe("select 77"), tx.unsafe("select 78"), tx.unsafe("select 79"),
      ]);
    }), { code: "CONNECTION_CLOSED" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(outcomes.length, 3);
    assert.ok(outcomes.every(item => item.status === "rejected" && item.reason.code === "CONNECTION_CLOSED"));
    assert.ok(!statements.includes("select 78"));
    assert.ok(!statements.includes("select 79"));
  } else {
    await assert.rejects(client.begin(tx => scenario === "savepoint"
      ? tx.savepoint(inner => inner.unsafe("select 77").simple())
      : tx.unsafe("select 77")), { code: "CONNECTION_CLOSED" });
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!statements.some(statement => statement.startsWith("rollback")));
  await client.begin(tx => tx.unsafe("select 4"));
  assert.equal(statements.filter(statement => statement === "commit").length, 1);
  await client.end({ timeout: 1 });
  clearTimeout(deadline);
  console.log(JSON.stringify({ mode, scenario, ok: true }));
} catch (error) {
  await client.end({ timeout: 1 });
  clearTimeout(deadline);
  throw error;
}
