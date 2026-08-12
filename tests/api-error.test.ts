import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  getErrorCode,
  parseSerializedApiErrorMessage,
  toUserFacingErrorMessage,
} from "@/lib/api-error";

describe("serialized API error messages", () => {
  const fallback = "请求暂时失败。";

  it("returns a message only from the expected JSON error envelope", () => {
    expect(
      parseSerializedApiErrorMessage(
        JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "聊天服务暂时不可用，请稍后重试。",
          },
        }),
        fallback,
      ),
    ).toBe("聊天服务暂时不可用，请稍后重试。");
  });

  it("does not expose raw non-JSON or malformed upstream errors", () => {
    expect(
      parseSerializedApiErrorMessage(
        "postgres://reader:secret@internal.example/database",
        fallback,
      ),
    ).toBe(fallback);
    expect(
      parseSerializedApiErrorMessage(
        JSON.stringify({ error: { message: "" } }),
        fallback,
      ),
    ).toBe(fallback);
  });
});

describe("user-facing client errors", () => {
  const fallback = "响应暂时不可用。";

  it("hides JSON parsing and response-schema details", async () => {
    const malformedResponseError = await new Response("<html>").json().catch(
      (error: unknown) => error,
    );

    expect(toUserFacingErrorMessage(malformedResponseError, fallback)).toBe(
      fallback,
    );
    expect(
      toUserFacingErrorMessage(
        z.object({ status: z.literal("ok") }).safeParse({ status: "bad" })
          .error,
        fallback,
      ),
    ).toBe(fallback);
  });

  it("keeps an already-sanitized ordinary Error message", () => {
    expect(
      toUserFacingErrorMessage(
        new Error("产品列表请求失败"),
        fallback,
      ),
    ).toBe("产品列表请求失败");
  });
});

describe("safe error codes", () => {
  it("uses the error constructor instead of the mutable name field", () => {
    const error = new Error("Database request failed.");
    error.name = "postgres://reader:secret@internal.example/database";

    expect(getErrorCode(error)).toBe("Error");
  });

  it("falls back for non-errors and unsafe constructor names", () => {
    const error = new Error("Unknown failure.");
    const unsafePrototype = Object.create(Error.prototype) as object;
    Object.defineProperty(unsafePrototype, "constructor", {
      value: {
        name: "postgres://reader:secret@internal.example/database",
      },
    });
    Object.setPrototypeOf(error, unsafePrototype);

    expect(getErrorCode(error)).toBe("UNKNOWN_ERROR");
    expect(getErrorCode({ name: "PostgresError" })).toBe("UNKNOWN_ERROR");
  });

  it("never throws when an Error prototype blocks constructor access", () => {
    const error = new Error("Hostile failure.");
    const hostilePrototype = Object.create(Error.prototype) as object;
    Object.defineProperty(hostilePrototype, "constructor", {
      get() {
        throw new Error("Constructor access is blocked.");
      },
    });
    Object.setPrototypeOf(error, hostilePrototype);

    expect(getErrorCode(error)).toBe("UNKNOWN_ERROR");
  });

  it("never throws when an Error proxy blocks prototype inspection", () => {
    const error = new Proxy(new Error("Hostile failure."), {
      getPrototypeOf() {
        throw new Error("Prototype access is blocked.");
      },
    });

    expect(getErrorCode(error)).toBe("UNKNOWN_ERROR");
  });
});
