import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { checkBrowserRuntimeErrors } from "../e2e/browser-runtime-errors";

type Attachment = { body: Buffer; contentType: string };
const reportSchema = z.object({
  totalErrors: z.number().int(),
  omittedErrors: z.number().int(),
  samples: z.array(z.object({ name: z.string(), message: z.string(), stack: z.string().nullable(), truncated: z.boolean() })),
});

function harness() {
  const page = new EventEmitter();
  const attach = vi.fn<(name: string, options: Attachment) => Promise<void>>().mockResolvedValue(undefined);
  return { page, artifacts: { attach }, attach };
}

describe("scoped browser runtime-error checks", () => {
  it("allows successful actions without creating an empty attachment", async () => {
    const { page, artifacts, attach } = harness();
    await checkBrowserRuntimeErrors(page, artifacts, async () => {});
    expect(attach).not.toHaveBeenCalled();
    expect(page.listenerCount("pageerror")).toBe(0);
  });

  it("fails an otherwise successful action and attaches its actual browser stack", async () => {
    const { page, artifacts, attach } = harness();
    const error = new TypeError("CountryPage cannot have a negative time stamp.");
    error.stack = "TypeError: fictional runtime failure\n at fictional-renderer.js:123:4";
    await expect(checkBrowserRuntimeErrors(page, artifacts, async () => {
      page.emit("pageerror", error);
    })).rejects.toThrow("1 unhandled browser runtime error");
    expect(attach).toHaveBeenCalledTimes(1);
    const [name, options] = attach.mock.calls[0]!;
    expect(name).toBe("unhandled-browser-runtime-errors");
    expect(options.contentType).toBe("application/json");
    const report = reportSchema.parse(JSON.parse(options.body.toString("utf8")));
    expect(report.totalErrors).toBe(1);
    expect(report.samples).toEqual([{ name: "TypeError", message: error.message, stack: error.stack, truncated: false }]);
    expect(page.listenerCount("pageerror")).toBe(0);
  });

  it("preserves an action failure when there is no browser error", async () => {
    const { page, artifacts, attach } = harness();
    const failure = new Error("Fictional URL assertion failure");
    await expect(checkBrowserRuntimeErrors(page, artifacts, async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(attach).not.toHaveBeenCalled();
    expect(page.listenerCount("pageerror")).toBe(0);
  });

  it("retains both an action failure and runtime-error failure", async () => {
    const { page, artifacts, attach } = harness();
    const failure = new Error("Fictional URL assertion failure");
    const result = checkBrowserRuntimeErrors(page, artifacts, async () => {
      page.emit("pageerror", new Error("Fictional browser error"));
      throw failure;
    });
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(result).rejects.toMatchObject({ errors: [failure, expect.any(Error)] });
    expect(attach).toHaveBeenCalledTimes(1);
    expect(page.listenerCount("pageerror")).toBe(0);
  });

  it("does not turn an attachment failure into a passing test", async () => {
    const { page } = harness();
    const attachmentFailure = new Error("Fictional attachment failure");
    const attach = vi.fn(async () => { throw attachmentFailure; });
    const result = checkBrowserRuntimeErrors(page, { attach }, async () => {
      page.emit("pageerror", new Error("Fictional browser error"));
    });
    await expect(result).rejects.toMatchObject({ errors: [expect.any(Error), attachmentFailure] });
    expect(page.listenerCount("pageerror")).toBe(0);
  });

  it("bounds diagnostic samples while still counting every error", async () => {
    const { page, artifacts, attach } = harness();
    const error = new Error("m".repeat(20_000));
    error.name = "n".repeat(500);
    error.stack = "s".repeat(20_000);
    await expect(checkBrowserRuntimeErrors(page, artifacts, async () => {
      for (let index = 0; index < 25; index++) page.emit("pageerror", error);
    })).rejects.toThrow("25 unhandled browser runtime errors");
    const [, options] = attach.mock.calls[0]!;
    const report = reportSchema.parse(JSON.parse(options.body.toString("utf8")));
    expect(report.totalErrors).toBe(25);
    expect(report.samples).toHaveLength(10);
    expect(report.omittedErrors).toBe(15);
    expect(report.samples[0]).toMatchObject({ truncated: true });
    expect(report.samples[0].name.length).toBeLessThanOrEqual(200);
    expect(report.samples[0].message.length).toBeLessThanOrEqual(2_000);
    expect(report.samples[0].stack?.length).toBeLessThanOrEqual(8_000);
    expect(options.body.length).toBeLessThan(110_000);
  });

  it("detaches only its own listener and does not inspect errors outside the action", async () => {
    const { page, artifacts, attach } = harness();
    const existing = vi.fn();
    page.on("pageerror", existing);
    await checkBrowserRuntimeErrors(page, artifacts, async () => {});
    page.emit("pageerror", new Error("Outside the observed action"));
    expect(existing).toHaveBeenCalledTimes(1);
    expect(page.listenerCount("pageerror")).toBe(1);
    expect(attach).not.toHaveBeenCalled();
  });
});
