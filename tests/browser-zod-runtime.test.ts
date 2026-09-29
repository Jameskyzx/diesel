import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import * as zodCore from "zod/v4/core";

import { configureBrowserZodRuntime } from "@/lib/browser-zod-runtime";

const originalJitless = z.config().jitless;

afterEach(() => {
  if (originalJitless === undefined) {
    Reflect.deleteProperty(z.config(), "jitless");
  } else {
    z.config({ jitless: originalJitless });
  }
});

describe("browser Zod runtime", () => {
  it("disables the eval capability probe before the first object parse", () => {
    const originalFunction = globalThis.Function;
    let functionConstructorCalled = false;

    Reflect.set(globalThis, "Function", function FunctionStub() {
      functionConstructorCalled = true;
      throw new Error("The Function constructor must not run in jitless mode.");
    });

    try {
      configureBrowserZodRuntime();

      expect(z.config().jitless).toBe(true);
      expect(zodCore.util.allowsEval.value).toBe(false);
      expect(functionConstructorCalled).toBe(false);
    } finally {
      Reflect.set(globalThis, "Function", originalFunction);
    }
  });
});
