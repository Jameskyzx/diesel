import { describe, expect, it } from "vitest";
import { capacityPolicy, evaluateCapacity } from "../scripts/ops/capacity-policy";

const sample = { totalBytes: 60 * 1024 ** 3, freeBytes: 10 * 1024 ** 3, totalInodes: 1_000_000, freeInodes: 500_000 };
describe("backup-preserving capacity policy", () => {
  it("reserves five GiB before release and warns before reaching that floor", () => {
    expect(evaluateCapacity(sample)).toMatchObject({ releaseAllowed: true, warning: false });
    expect(evaluateCapacity({ ...sample, freeBytes: 7 * 1024 ** 3 })).toMatchObject({ releaseAllowed: true, warning: true });
    expect(evaluateCapacity({ ...sample, freeBytes: capacityPolicy.minimumReleaseFreeBytes - 1 }).releaseAllowed).toBe(false);
    expect(evaluateCapacity({ ...sample, freeBytes: capacityPolicy.minimumReleaseFreeBytes }).releaseAllowed).toBe(true);
  });
  it("rejects full disks and inode exhaustion without proposing backup deletion", () => {
    expect(evaluateCapacity({ ...sample, totalBytes: 200 * 1024 ** 3, freeBytes: 5 * 1024 ** 3 }).releaseAllowed).toBe(false);
    expect(evaluateCapacity({ ...sample, freeInodes: 19999 }).releaseAllowed).toBe(false);
    expect(capacityPolicy.databaseBackupDeletion).toBe("never");
    expect(capacityPolicy.incidentRecordDeletion).toBe("never");
  });
  it.each([
    { freeBytes: -1 }, { totalBytes: 0 }, { freeBytes: Number.POSITIVE_INFINITY },
    { freeBytes: 61 * 1024 ** 3 }, { freeInodes: 1_000_001 }, { privateEnvironment: "secret" },
  ])("fails closed for invalid filesystem readings %j", (change) => {
    expect(() => evaluateCapacity({ ...sample, ...change })).toThrow();
  });
});
