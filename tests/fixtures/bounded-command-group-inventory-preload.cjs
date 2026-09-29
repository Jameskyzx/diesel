/* eslint-disable @typescript-eslint/no-require-imports */
const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");
const { resolve } = require("node:path");

const originalSpawn = childProcess.spawn;
const fixture = resolve(
  __dirname,
  "bounded-command-group-inventory.mjs",
);
const residualPidPath = process.argv[2] === "--bounded-command-guardian-v1"
  ? process.env.DIESEL_BOUNDED_COMMAND_TEST_RESIDUAL_PID_PATH ?? "-"
  : "-";
if (process.argv[2] === "--bounded-command-guardian-v1") {
  delete process.env.DIESEL_BOUNDED_COMMAND_TEST_RESIDUAL_PID_PATH;
}

childProcess.spawn = function patchedSpawn(command, args, options) {
  if (
    command === "/bin/ps" &&
    Array.isArray(args) &&
    args.join("\0") === "-axo\0pid=,pgid="
  ) {
    return originalSpawn.call(this, process.execPath, [
      fixture,
      String(process.pid),
      residualPidPath,
      process.env.DIESEL_BOUNDED_COMMAND_TEST_INVENTORY_VARIANT ?? "linux-kernel",
    ], options);
  }
  return originalSpawn.call(this, command, args, options);
};
syncBuiltinESMExports();
