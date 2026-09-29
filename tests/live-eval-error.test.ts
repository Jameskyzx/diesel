import { describe, expect, it } from "vitest";

import {
  safeLiveEvalErrorName,
  safeLiveEvalHttpStatus,
  summarizeLiveEvalError,
} from "../scripts/ai/live-eval-error";

describe("live eval safe error diagnostics", () => {
  it.each(["AbortError", "TimeoutError"])(
    "preserves only the %s category from a DOMException",
    (name) => {
      const error = new DOMException(
        "private timeout detail https://sensitive.example/api?key=secret",
        name,
      );

      expect(safeLiveEvalErrorName(error)).toBe(name);
      expect(safeLiveEvalHttpStatus(error)).toBeNull();
      expect(summarizeLiveEvalError(error)).toBe(
        `${name}: Eval case execution failed.`,
      );
    },
  );

  it.each(["AbortError", "TimeoutError"])(
    "preserves nested %s without exposing retry or abort details",
    (name) => {
      const error = {
        cause: {
          errors: [new DOMException("sensitive abort reason", name)],
          message: "private retry metadata",
          name: "AI_RetryError",
          requestBodyValues: { apiKey: "secret" },
          responseBody: "private provider response",
          url: "https://sensitive.example/api",
        },
        message: "private wrapper detail",
        name: "Error",
      };

      expect(summarizeLiveEvalError(error)).toBe(
        `${name}: Eval case execution failed.`,
      );
    },
  );

  it("does not infer a timeout category from an unstructured abort reason", () => {
    expect(summarizeLiveEvalError("TimeoutError: sensitive timeout reason"))
      .toBe("UnknownError: Eval case execution failed.");
    expect(summarizeLiveEvalError({
      message: "Step timeout of 30000ms exceeded",
      name: "Error",
    })).toBe("Error: Eval case execution failed.");
  });

  it("preserves only an allowlisted AI error class and numeric HTTP status", () => {
    const error = {
      errors: [
        {
          message: "provider secret must not survive",
          name: "AI_APICallError",
          requestBodyValues: { apiKey: "secret" },
          responseBody: "sensitive upstream body",
          statusCode: 401,
          url: "https://sensitive.example/v1/chat",
        },
      ],
      lastError: {
        name: "AI_APICallError",
        statusCode: 401,
      },
      message: "retry details",
      name: "AI_RetryError",
    };

    expect(safeLiveEvalErrorName(error)).toBe("AI_APICallError");
    expect(safeLiveEvalHttpStatus(error)).toBe(401);
    const summary = summarizeLiveEvalError(error);
    expect(summary).toBe(
      "AI_APICallError (HTTP 401): Eval case execution failed.",
    );
    expect(summary).not.toMatch(/secret|provider|sensitive|example/u);
  });

  it("uses a nested specific category instead of a generic wrapper", () => {
    expect(
      summarizeLiveEvalError({
        cause: { name: "AI_InvalidPromptError" },
        name: "Error",
      }),
    ).toBe("AI_InvalidPromptError: Eval case execution failed.");
  });

  it("prefers an actionable nested category over a retry wrapper", () => {
    expect(
      summarizeLiveEvalError({
        errors: [{ name: "TypeError" }],
        name: "AI_RetryError",
      }),
    ).toBe("TypeError: Eval case execution failed.");
  });

  it("fails unknown names and invalid statuses closed to stable categories", () => {
    expect(
      summarizeLiveEvalError({
        name: "SensitiveVendorAccountError",
        statusCode: 200,
      }),
    ).toBe("UnknownError: Eval case execution failed.");
    expect(safeLiveEvalHttpStatus({ statusCode: 999 })).toBeNull();
    expect(summarizeLiveEvalError(new Error("private detail"))).toBe(
      "Error: Eval case execution failed.",
    );
  });

  it("remains total for hostile objects with throwing property access", () => {
    const throwingGetter = Object.defineProperties({}, {
      cause: {
        get() {
          throw new Error("sensitive cause");
        },
      },
      name: {
        get() {
          throw new Error("sensitive name");
        },
      },
      statusCode: {
        get() {
          throw new Error("sensitive status");
        },
      },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    expect(summarizeLiveEvalError(throwingGetter)).toBe(
      "UnknownError: Eval case execution failed.",
    );
    expect(summarizeLiveEvalError(revoked.proxy)).toBe(
      "UnknownError: Eval case execution failed.",
    );
  });
});
