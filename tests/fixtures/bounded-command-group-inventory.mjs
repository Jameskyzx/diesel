#!/usr/bin/env node

import { readFileSync } from "node:fs";

const guardianPid = Number(process.argv[2]);
const residualPidPath = process.argv[3];
const variant = process.argv[4];
if (!Number.isSafeInteger(guardianPid) || guardianPid <= 0) process.exit(2);
process.stdout.write(`${guardianPid} ${variant === "zero-sentinel" ? 0 : guardianPid}\n`);
process.stdout.write(`${process.pid} ${guardianPid}\n`);
process.stdout.write(`1 ${variant === "negative-pgid" ? -1 : 0}\n`);
if (variant === "duplicate-pid") {
  process.stdout.write(`${guardianPid} ${guardianPid}\n`);
}
if (residualPidPath !== "-") {
  const residualPid = Number(readFileSync(residualPidPath, "utf8").trim());
  if (!Number.isSafeInteger(residualPid) || residualPid <= 0) process.exit(3);
  process.stdout.write(`${residualPid} ${guardianPid}\n`);
}
