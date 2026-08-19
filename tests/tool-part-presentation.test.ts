import { describe, expect, it } from "vitest";

import { toolPartPresentation } from "@/features/ai/tool-part-presentation";

describe("AI tool-part presentation", () => {
  it("keeps only active tool states loading", () => {
    expect(toolPartPresentation({ state: "input-streaming" })).toEqual({
      kind: "loading",
    });
    expect(toolPartPresentation({ state: "input-available" })).toEqual({
      kind: "loading",
    });
    expect(toolPartPresentation({ state: "approval-requested" })).toEqual({
      kind: "loading",
    });
    expect(toolPartPresentation({ state: "approval-responded" })).toEqual({
      kind: "loading",
    });
  });

  it.each(["output-error", "output-denied"] as const)(
    "renders %s as a terminal error instead of an infinite spinner",
    (state) => {
      expect(toolPartPresentation({ state })).toMatchObject({
        kind: "error",
      });
    },
  );

  it("returns typed terminal error codes for locale-aware rendering", () => {
    expect(toolPartPresentation({ state: "output-error" })).toEqual({
      code: "execution_error",
      kind: "error",
    });
    expect(toolPartPresentation({ state: "output-denied" })).toEqual({
      code: "permission_denied",
      kind: "error",
    });
    expect(
      toolPartPresentation({ output: {}, state: "output-available" }),
    ).toEqual({ code: "invalid_result", kind: "error" });
  });

  it("fails closed when a completed output does not match the client schema", () => {
    expect(
      toolPartPresentation({ output: { status: "ok" }, state: "output-available" }),
    ).toMatchObject({ kind: "error" });
  });
});
