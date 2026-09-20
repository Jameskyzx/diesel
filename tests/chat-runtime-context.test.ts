import { describe, expect, it } from "vitest";

import {
  captureChatRuntimeContext,
  chatRuntimeContextSchema,
} from "@/domain/ai/chat-runtime-context";

describe("server-captured chat runtime clock", () => {
  it.each([
    ["2026-09-06T23:59:59.999Z", "2026-09-06"],
    ["2026-09-07T00:00:00.000Z", "2026-09-07"],
    ["2028-02-29T12:00:00.000Z", "2028-02-29"],
  ])("captures %s as UTC day %s", (timestamp, utcDate) => {
    const result = captureChatRuntimeContext(new Date(timestamp));
    expect(result).toEqual({ capturedAt: timestamp, utcDate });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("uses the UTC day even when the input instant is expressed in another zone", () => {
    expect(captureChatRuntimeContext(new Date("2026-09-07T00:00:00+08:00")))
      .toEqual({ capturedAt: "2026-09-06T16:00:00.000Z", utcDate: "2026-09-06" });
  });

  it("does not retain a mutable Date reference", () => {
    const date = new Date("2026-09-06T23:59:59.999Z");
    const captured = captureChatRuntimeContext(date);
    date.setUTCDate(7);
    expect(captured.utcDate).toBe("2026-09-06");
    expect(captured.capturedAt).toBe("2026-09-06T23:59:59.999Z");
  });

  it.each([
    { capturedAt: "2026-09-06T23:59:59.999Z", utcDate: "2026-09-07" },
    { capturedAt: "2026-09-06T23:59:59.999+08:00", utcDate: "2026-09-06" },
    { capturedAt: "2026-09-06T23:59:59Z", utcDate: "2026-09-06" },
    { capturedAt: "2025-02-29T00:00:00.000Z", utcDate: "2025-02-29" },
    { capturedAt: "2026-09-06T00:00:00.000Z", utcDate: "2026-09-06", extra: true },
    { capturedAt: "2026-09-06T00:00:00.000Z" },
    { utcDate: "2026-09-06" },
    null,
  ])("rejects a malformed or inconsistent runtime context %#", (value) => {
    expect(chatRuntimeContextSchema.safeParse(value).success).toBe(false);
  });

  it("rejects an invalid clock value", () => {
    expect(() => captureChatRuntimeContext(new Date(Number.NaN))).toThrow();
  });
});
