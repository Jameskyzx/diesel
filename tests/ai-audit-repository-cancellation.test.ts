import { describe, expect, it, vi } from "vitest";

import { createAiAuditRepository } from "@/server/repositories/ai-audit-repository";

const sessionInput = {
  modelId: "mock/cancellation",
  selectedCountryIso3: "CHN",
  sessionId: "00000000-0000-4000-8000-000000000981",
};

describe("AI audit repository cancellation", () => {
  it("does not start an audit-session query for a pre-aborted request", async () => {
    const controller = new AbortController();
    controller.abort("caller-controlled-secret");
    const insert = vi.fn();
    const repository = createAiAuditRepository({ insert } as never);

    await expect(
      repository.ensureSession(sessionInput, { signal: controller.signal }),
    ).rejects.toMatchObject({
      message: "The request was canceled.",
      name: "AbortError",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("waits for a started query and then returns a fixed AbortError", async () => {
    let resolveQuery!: () => void;
    const query = new Promise<void>((resolve) => {
      resolveQuery = resolve;
    });
    const onConflictDoUpdate = vi.fn(() => query);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const repository = createAiAuditRepository({ insert } as never);
    const controller = new AbortController();

    const ensuring = repository.ensureSession(sessionInput, {
      signal: controller.signal,
    });
    expect(insert).toHaveBeenCalledOnce();
    controller.abort("caller-controlled-secret");

    let settled = false;
    void ensuring.finally(() => {
      settled = true;
    }).catch(() => undefined);
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveQuery();
    await expect(ensuring).rejects.toMatchObject({
      message: "The request was canceled.",
      name: "AbortError",
    });
  });
});
