import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  getAdmissionDatabaseErrorCode,
  getErrorCode,
  parseApiErrorCode,
  parseSerializedApiErrorCode,
  parseSerializedApiErrorMessage,
  toUserFacingErrorMessage,
} from "@/lib/api-error";

describe("admission database diagnostic codes", () => {
  it.each(["55P03", "57014", "25P03", "CONNECTION_CLOSED", "ECONNRESET"])(
    "retains allowlisted %s through wrappers regardless of constructor name", (code) => {
      class a extends Error {}
      const cause = Object.assign(new a("private connection information"), { code });
      expect(getAdmissionDatabaseErrorCode(new Error("private SQL", { cause }))).toBe(code);
    },
  );

  it("never derives a code from private messages or arbitrary properties", () => {
    expect(getAdmissionDatabaseErrorCode({ code: "postgres://secret", message: "55P03" }))
      .toBe("UNKNOWN_DATABASE_ERROR");
    expect(getAdmissionDatabaseErrorCode({ message: "57014", sql: "private" }))
      .toBe("UNKNOWN_DATABASE_ERROR");
  });

  it("bounds cause traversal and safely handles cycles and hostile getters", () => {
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(getAdmissionDatabaseErrorCode(cycle)).toBe("UNKNOWN_DATABASE_ERROR");
    expect(getAdmissionDatabaseErrorCode(new Proxy({}, { has() { throw new Error("private"); } })))
      .toBe("UNKNOWN_DATABASE_ERROR");
    let nested: unknown = { code: "55P03" };
    for (let i = 0; i < 5; i += 1) nested = { cause: nested };
    expect(getAdmissionDatabaseErrorCode(nested)).toBe("UNKNOWN_DATABASE_ERROR");
  });
});

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

describe("safe API error envelope codes", () => {
  it("retains only allowlisted codes from response and serialized envelopes", async () => {
    const envelope = JSON.stringify({
      error: { code: "INTERNAL_ERROR", message: "provider text" },
    });

    await expect(
      parseApiErrorCode(new Response(envelope)),
    ).resolves.toBe("INTERNAL_ERROR");
    expect(parseSerializedApiErrorCode(envelope)).toBe("INTERNAL_ERROR");
    expect(
      parseSerializedApiErrorCode(
        JSON.stringify({
          error: { code: "DATABASE_SECRET", message: "provider text" },
        }),
      ),
    ).toBeNull();
    expect(parseSerializedApiErrorCode("<html>upstream failure</html>")).toBeNull();
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
