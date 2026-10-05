import { statfsSync } from "node:fs";
import { z } from "zod";

const gibibyte = 1024 ** 3;
export const capacityPolicy = {
  version: "diesel-capacity-policy-v1",
  minimumReleaseFreeBytes: 5 * gibibyte,
  warningFreeBytes: 8 * gibibyte,
  minimumFreeInodes: 20_000,
  maximumReleaseUsedPercent: 95,
  warningUsedPercent: 85,
  databaseBackupDeletion: "never",
  incidentRecordDeletion: "never",
} as const;
const capacitySchema = z.strictObject({
  totalBytes: z.number().int().positive().safe(),
  freeBytes: z.number().int().nonnegative().safe(),
  totalInodes: z.number().int().positive().safe(),
  freeInodes: z.number().int().nonnegative().safe(),
}).refine((input) => input.freeBytes <= input.totalBytes && input.freeInodes <= input.totalInodes);

export function evaluateCapacity(value: unknown) {
  const input = capacitySchema.parse(value);
  const usedPercent = 100 * (input.totalBytes - input.freeBytes) / input.totalBytes;
  const releaseAllowed = input.freeBytes >= capacityPolicy.minimumReleaseFreeBytes &&
    input.freeInodes >= capacityPolicy.minimumFreeInodes && usedPercent < capacityPolicy.maximumReleaseUsedPercent;
  return {
    policy: capacityPolicy,
    ...input,
    usedPercent: Math.round(usedPercent * 100) / 100,
    releaseAllowed,
    warning: !releaseAllowed || input.freeBytes < capacityPolicy.warningFreeBytes || usedPercent >= capacityPolicy.warningUsedPercent,
    remedy: "Only reviewed inactive build-cache cleanup is permitted automatically; preserve current/rollback releases, all database backups and incident records. Archive to approved external storage or expand capacity before the next release if necessary.",
  };
}

export function readDeploymentCapacity() {
  const filesystem = statfsSync("/opt/diesel", { bigint: true });
  // bavail accounts for the filesystem reserve. Root's bfree would overstate
  // the capacity available to the unprivileged build/runtime users.
  return evaluateCapacity({
    totalBytes: Number(filesystem.blocks * filesystem.bsize),
    freeBytes: Number(filesystem.bavail * filesystem.bsize),
    totalInodes: Number(filesystem.files), freeInodes: Number(filesystem.ffree),
  });
}
