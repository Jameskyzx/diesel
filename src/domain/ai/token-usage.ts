export type TokenUsageCounts = {
  input: number | null | undefined;
  output: number | null | undefined;
  total: number | null | undefined;
};

export type NormalizedTokenUsageCounts = {
  input: number | null;
  output: number | null;
  total: number | null;
};

export function isTokenCount(
  value: number | null | undefined,
): value is number {
  return (
    value !== null &&
    value !== undefined &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function normalizeTokenUsageCounts(
  usage: TokenUsageCounts,
): NormalizedTokenUsageCounts {
  return {
    input: isTokenCount(usage.input) ? usage.input : null,
    output: isTokenCount(usage.output) ? usage.output : null,
    total: isTokenCount(usage.total) ? usage.total : null,
  };
}

export function hasConsistentTokenCounts(
  usage: TokenUsageCounts,
): usage is { input: number; output: number; total: number } {
  return (
    isTokenCount(usage.input) &&
    isTokenCount(usage.output) &&
    isTokenCount(usage.total) &&
    usage.total === usage.input + usage.output
  );
}

export function tokenUsageKnownLowerBound(usage: TokenUsageCounts): number {
  const normalized = normalizeTokenUsageCounts(usage);
  const inputAndOutput =
    normalized.input === null || normalized.output === null
      ? 0
      : normalized.input + normalized.output;

  return Math.max(
    normalized.total ?? 0,
    inputAndOutput,
    normalized.input ?? 0,
    normalized.output ?? 0,
  );
}

export function sumKnownTokenUsageCounts(
  usages: readonly TokenUsageCounts[],
): NormalizedTokenUsageCounts {
  const sumField = (
    select: (usage: TokenUsageCounts) => number | null | undefined,
  ) => {
    const values = usages.map(select).filter(isTokenCount);
    return values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0);
  };

  return {
    input: sumField(({ input }) => input),
    output: sumField(({ output }) => output),
    total: sumField(({ total }) => total),
  };
}
