import { describe, expect, it } from "vitest";

import { awaitStartedOperationsInOrder } from "@/server/http/settled-operation-barrier";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("settled operation barrier", () => {
  it("returns heterogeneous values in input order", async () => {
    await expect(
      awaitStartedOperationsInOrder([
        Promise.resolve("first"),
        Promise.resolve(2),
      ] as const),
    ).resolves.toEqual(["first", 2]);
  });

  it("does not reject until every already-started sibling settles", async () => {
    const firstError = new Error("first failed");
    const sibling = createDeferred<number>();
    let settled = false;
    const operation = awaitStartedOperationsInOrder([
      Promise.reject(firstError),
      sibling.promise,
    ] as const).finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);

    sibling.resolve(2);
    await expect(operation).rejects.toBe(firstError);
  });

  it("selects a rejection by input order rather than settlement order", async () => {
    const first = createDeferred<number>();
    const firstError = new Error("first input failed later");
    const secondError = new Error("second input failed first");
    const operation = awaitStartedOperationsInOrder([
      first.promise,
      Promise.reject(secondError),
    ] as const);
    await Promise.resolve();
    first.reject(firstError);

    await expect(operation).rejects.toBe(firstError);
  });
});
