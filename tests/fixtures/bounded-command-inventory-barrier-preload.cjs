/* eslint-disable @typescript-eslint/no-require-imports */
const childProcess = require("node:child_process");
const { appendFileSync, existsSync, writeFileSync } = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const { join, resolve } = require("node:path");

const variable = "DIESEL_BOUNDED_COMMAND_TEST_INVENTORY_BARRIER";
const config = JSON.parse(process.env[variable] ?? "null");
if (
  config === null ||
  typeof config.root !== "string" ||
  !config.root.startsWith("/") ||
  !["valid", "held", "malformed", "denied"].includes(config.mode) ||
  !["stdout", "stderr"].includes(config.stream)
) {
  throw new Error("invalid bounded-command inventory barrier fixture");
}
const isGuardian = process.argv[2] === "--bounded-command-guardian-v1";
const readyPath = join(config.root, "inventory.ready");
const releasePath = join(config.root, "inventory.release");
const completedPath = join(config.root, "inventory.completed");
const originalSpawn = childProcess.spawn;
const originalKill = process.kill.bind(process);
const inventoryFixture = resolve(__dirname, "bounded-command-group-inventory.mjs");

if (isGuardian) {
  delete process.env[variable];
  process.on("message", (message) => {
    if (message?.type !== "signal") return;
    writeFileSync(join(config.root, "signal.received"), `${message.signal}\n`);
    // Release only after the production signal handler has run. This makes
    // TERM-during-inventory deterministic without relying on a sleep race.
    if (config.mode !== "held") {
      setImmediate(() => writeFileSync(releasePath, "release\n"));
    }
  });
  process.kill = function (pid, signal) {
    if (pid === -process.pid && signal !== 0) {
      appendFileSync(
        join(config.root, "group-signals.log"),
        `${signal}:${existsSync(completedPath) ? "complete" : "pending"}\n`,
      );
      if (config.mode === "denied" && signal === "SIGTERM") {
        const error = new Error("controlled deferred signal denial");
        error.code = "EPERM";
        throw error;
      }
    }
    return originalKill(pid, signal);
  };
}

childProcess.spawn = function (...args) {
  // The existing inventory preload routes exactly /bin/ps to this fixture.
  // Capability probes remain unchanged; only the guardian inspection is held.
  if (
    isGuardian && args[0] === process.execPath &&
    Array.isArray(args[1]) && args[1][0] === inventoryFixture
  ) {
    return originalSpawn.call(this, process.execPath, [
      "-e",
      [
        'const { existsSync, writeFileSync } = require("node:fs");',
        'const { join } = require("node:path");',
        "const [root, guardianPid, mode] = process.argv.slice(1);",
        'writeFileSync(join(root, "inventory.ready"), String(process.pid));',
        // Bounded self-exit also cleans up a broken supervisor in a red test.
        "const deadline = setTimeout(() => process.exit(99), 2000);",
        "const poll = setInterval(() => {",
        '  if (!existsSync(join(root, "inventory.release"))) return;',
        "  clearInterval(poll);",
        "  clearTimeout(deadline);",
        '  writeFileSync(join(root, "inventory.completed"), "complete\\n");',
        '  if (mode === "malformed") {',
        '    process.stdout.write("invalid inventory\\n");',
        "  } else {",
        '    process.stdout.write(`${guardianPid} ${guardianPid}\\n${process.pid} ${guardianPid}\\n`);',
        "  }",
        "}, 5);",
      ].join("\n"),
      config.root, args[1][1], config.mode,
    ], args[2]);
  }
  const child = originalSpawn.apply(this, args);
  if (
    !Array.isArray(args[1]) ||
    !args[1].includes("--bounded-command-guardian-v1")
  ) return child;
  const stream = child[config.stream];
  const originalEmit = stream.emit;
  stream.emit = function (event, ...eventArgs) {
    if (event !== "data") return originalEmit.call(this, event, ...eventArgs);
    const deadline = Date.now() + 2000;
    const poll = setInterval(() => {
      if (!existsSync(readyPath) && Date.now() < deadline) return;
      clearInterval(poll);
      originalEmit.call(stream, event, ...eventArgs);
    }, 5);
    return true;
  };
  return child;
};
syncBuiltinESMExports();
