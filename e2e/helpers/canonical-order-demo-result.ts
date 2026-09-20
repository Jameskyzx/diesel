import { aiToolResultSchema, type CompareRegulationsResult } from "../../src/features/ai/schemas";

export const canonicalDemoRegulationNames = [
  "DEMO ONLY — 中型标准",
  "DEMO ONLY — 阿型标准",
] as const;

/** Transport-only browser fixture; kept under the fingerprinted e2e source tree. */
export function withCanonicalDemoRegulationNames(input: unknown): CompareRegulationsResult {
  const result = aiToolResultSchema.parse(input);
  if (result.tool !== "compareRegulations" || result.status !== "ok") {
    throw new Error("Expected a successful offline Demo regulation comparison.");
  }
  const country = result.comparison.countries.find(({ countryIso3 }) => countryIso3 === "CHN");
  if (country?.currentEffectiveRegulations.length !== 1) {
    throw new Error("Expected the single existing CHN Demo regulation.");
  }
  const original = country.currentEffectiveRegulations[0]!;
  if (!original.isDemo) throw new Error("Only Demo facts may be varied by this fixture.");
  const extraId = "00000000-0000-4000-8000-000000099991";
  function renamed(replacements: readonly (readonly [string, string])[]): CompareRegulationsResult {
    let serialized = JSON.stringify(result);
    for (const [from, to] of replacements) serialized = serialized.replaceAll(from, to);
    const parsed = aiToolResultSchema.parse(JSON.parse(serialized) as unknown);
    if (parsed.tool !== "compareRegulations") throw new Error("Unexpected fixture tool.");
    return parsed;
  }
  const base = renamed([[original.canonicalName, canonicalDemoRegulationNames[0]]]);
  const extra = renamed([
    [original.canonicalName, canonicalDemoRegulationNames[1]],
    [original.id, extraId],
    ...original.limits.map(({ id }, index): readonly [string, string] => [
      id, `00000000-0000-4000-8000-${String(99980 + index).padStart(12, "0")}`,
    ]),
  ]);
  base.comparison.countries.find(({ countryIso3 }) => countryIso3 === "CHN")!
    .currentEffectiveRegulations.push(
      ...extra.comparison.countries.find(({ countryIso3 }) => countryIso3 === "CHN")!
        .currentEffectiveRegulations,
    );
  base.comparison.sources.push(...extra.comparison.sources.filter(({ regulationId }) => regulationId === extraId));
  base.citations.push(...extra.citations.filter(({ regulationId }) => regulationId === extraId));
  const validated = aiToolResultSchema.parse(base);
  if (validated.tool !== "compareRegulations") throw new Error("Unexpected fixture tool.");
  return validated;
}
