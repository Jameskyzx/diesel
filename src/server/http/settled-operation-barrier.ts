import "server-only";

/**
 * Wait for every operation that has already been started before propagating a
 * failure. Rejections are selected in input order so cleanup and admission
 * release do not depend on which sibling happens to fail first.
 */
export async function awaitStartedOperationsInOrder<
  TValues extends readonly unknown[],
>(
  operations: {
    [TIndex in keyof TValues]: Promise<TValues[TIndex]>;
  },
): Promise<TValues> {
  const outcomes = await Promise.allSettled(operations);
  const values: unknown[] = [];

  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      throw outcome.reason;
    }
    values.push(outcome.value);
  }

  return values as unknown as TValues;
}
