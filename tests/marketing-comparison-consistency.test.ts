import { describe, expect, it } from "vitest";

import {
  marketComparisonMatchesDeterministicRules,
  regulationComparisonMatchesDeterministicRules,
} from "@/domain/marketing/comparison-consistency";
import type {
  AnalysisSource,
  MarketComparison,
  MarketObservation,
  RegulationComparison,
  RegulationComparisonItem,
} from "@/features/marketing/schemas";

const verifiedAt = "2026-01-15T00:00:00.000Z";

function analysisSource(input: {
  countryIso3: string;
  entityId: string;
  entityType: AnalysisSource["entityType"];
  regulationId?: string | null;
}): AnalysisSource {
  return {
    countryIso3: input.countryIso3,
    entityId: input.entityId,
    entityType: input.entityType,
    isDemo: true,
    locator: null,
    publishedOn: null,
    regulationId: input.regulationId ?? null,
    regulationStatus:
      input.regulationId === undefined || input.regulationId === null
        ? null
        : "effective",
    sourceId: "00000000-0000-4000-8000-000000009001",
    sourceTitle: "DEMO ONLY — Source",
    sourceUrl: "https://example.invalid/demo-evidence",
    title: "DEMO ONLY — Fact",
    verifiedAt,
  };
}

function buildRegulationItem(input: {
  countryIso3: "BRA" | "CHN";
  effectiveFrom: string | null;
  id: string;
  recordStatus: RegulationComparisonItem["recordStatus"];
  status: RegulationComparisonItem["status"];
}): RegulationComparisonItem {
  const jurisdictionId =
    input.countryIso3 === "CHN"
      ? "00000000-0000-4000-8000-000000000101"
      : "00000000-0000-4000-8000-000000000102";
  const limitId =
    input.countryIso3 === "CHN"
      ? "00000000-0000-4000-8000-000000000111"
      : "00000000-0000-4000-8000-000000000112";

  return {
    applicability: {
      countryIso3: input.countryIso3,
      jurisdiction: {
        code: `DEMO-${input.countryIso3}`,
        id: jurisdictionId,
        isDemo: true,
        name: `DEMO ONLY — ${input.countryIso3} jurisdiction`,
        source: analysisSource({
          countryIso3: input.countryIso3,
          entityId: jurisdictionId,
          entityType: "jurisdiction",
          regulationId: input.id,
        }),
        verifiedAt,
      },
      membership: {
        isDemo: true,
        source: analysisSource({
          countryIso3: input.countryIso3,
          entityId: jurisdictionId,
          entityType: "country_jurisdiction",
          regulationId: input.id,
        }),
        validFrom: "2020-01-01",
        validTo: null,
        verifiedAt,
      },
    },
    canonicalName: `DEMO ONLY — ${input.countryIso3} regulation`,
    citationCode: `DEMO-${input.countryIso3}-REG`,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    id: input.id,
    isDemo: true,
    limits: [
      {
        id: limitId,
        isDemo: true,
        limitValue: "1.000000",
        pollutantCode: "NOX",
        powerMaxKw: 120,
        powerMinKw: 80,
        source: analysisSource({
          countryIso3: input.countryIso3,
          entityId: limitId,
          entityType: "regulation_limit",
          regulationId: input.id,
        }),
        unitCode: "g/kWh",
        validFrom: "2025-01-01",
        validTo: null,
        verifiedAt,
      },
    ],
    recordStatus: input.recordStatus,
    source: analysisSource({
      countryIso3: input.countryIso3,
      entityId: input.id,
      entityType: "regulation",
      regulationId: input.id,
    }),
    status: input.status,
    verifiedAt,
  };
}

function buildRegulationComparison(): RegulationComparison {
  const current = buildRegulationItem({
    countryIso3: "CHN",
    effectiveFrom: "2025-01-01",
    id: "00000000-0000-4000-8000-000000000201",
    recordStatus: "effective",
    status: "effective",
  });
  const future = buildRegulationItem({
    countryIso3: "BRA",
    effectiveFrom: "2030-01-01",
    id: "00000000-0000-4000-8000-000000000202",
    recordStatus: "adopted",
    status: "adopted",
  });

  return {
    countries: [
      {
        countryIsDemo: true,
        countryIso3: "CHN",
        countryName: "China",
        countrySource: {
          countryIso2: "CN",
          countryNameLocal: "中国",
          id: "00000000-0000-4000-8000-000000000211",
          isDemo: true,
          publishedOn: null,
          title: "DEMO ONLY — China source",
          url: "https://example.invalid/china",
          verifiedAt,
        },
        currentEffectiveRegulations: [current],
        futureAdoptedRegulations: [],
        status: "available",
      },
      {
        countryIsDemo: true,
        countryIso3: "BRA",
        countryName: "Brazil",
        countrySource: {
          countryIso2: "BR",
          countryNameLocal: "Brasil",
          id: "00000000-0000-4000-8000-000000000212",
          isDemo: true,
          publishedOn: null,
          title: "DEMO ONLY — Brazil source",
          url: "https://example.invalid/brazil",
          verifiedAt,
        },
        currentEffectiveRegulations: [],
        futureAdoptedRegulations: [future],
        status: "available",
      },
    ],
    missingData: [],
    query: {
      applicationScope: "non-road",
      asOf: "2026-08-13",
      countryIso3s: ["CHN", "BRA"],
      powerKw: 100,
    },
    sources: [],
  };
}

function buildMarketObservation(input: {
  countryIso3: "BRA" | "CHN";
  id: string;
}): MarketObservation {
  return {
    applicationScope: "non-road",
    countryIso3: input.countryIso3,
    countryName: input.countryIso3 === "CHN" ? "China" : "Brazil",
    currencyCode: "USD",
    definition: "DEMO ONLY — Addressable units",
    id: input.id,
    isDemo: true,
    methodologyVersion: "demo-v1",
    metricCode: "DEMO_ADDRESSABLE_UNITS",
    metricName: "DEMO ONLY — Addressable units",
    periodEnd: "2026-01-01",
    periodStart: "2025-01-01",
    publishedOn: null,
    source: analysisSource({
      countryIso3: input.countryIso3,
      entityId: input.id,
      entityType: "market_metric",
    }),
    unitCode: "engine",
    valueNumeric: input.countryIso3 === "CHN" ? "100.000000" : "50.000000",
    verifiedAt,
  };
}

function buildMarketComparison(): MarketComparison {
  return {
    metrics: [
      {
        comparisonStatus: "comparable",
        issues: [],
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricName: "DEMO ONLY — Addressable units",
        observations: [
          buildMarketObservation({
            countryIso3: "CHN",
            id: "00000000-0000-4000-8000-000000000301",
          }),
          buildMarketObservation({
            countryIso3: "BRA",
            id: "00000000-0000-4000-8000-000000000302",
          }),
        ],
      },
    ],
    missingData: [],
    query: {
      applicationScope: "non-road",
      countryIso3s: ["CHN", "BRA"],
      metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
    },
    sources: [],
  };
}

describe("regulation comparison deterministic consistency", () => {
  it("accepts canonical current/future facts and visible half-open boundaries", () => {
    const baseline = buildRegulationComparison();
    const lowerPowerBoundary = structuredClone(baseline);
    lowerPowerBoundary.query.powerKw = 80;
    const effectiveDateBoundary = structuredClone(baseline);
    effectiveDateBoundary.query.asOf = "2025-01-01";
    const historicalEffective = structuredClone(baseline);
    const current =
      historicalEffective.countries[0]!.currentEffectiveRegulations[0]!;
    current.recordStatus = "superseded";
    current.effectiveTo = "2027-01-01";

    expect(
      [baseline, lowerPowerBoundary, effectiveDateBoundary, historicalEffective]
        .every(regulationComparisonMatchesDeterministicRules),
    ).toBe(true);
  });

  it("accepts the canonical no-data result at an excluded upper power boundary", () => {
    const noData = buildRegulationComparison();
    noData.query.powerKw = 120;
    for (const country of noData.countries) {
      country.currentEffectiveRegulations = [];
      country.futureAdoptedRegulations = [];
      country.status = "no_data";
    }
    noData.missingData = [
      "CHN 在所选范围、功率和日期下没有可比较法规记录。",
      "BRA 在所选范围、功率和日期下没有可比较法规记录。",
    ];

    expect(regulationComparisonMatchesDeterministicRules(noData)).toBe(true);
  });

  const driftCases: Array<{
    mutate: (comparison: RegulationComparison) => void;
    name: string;
  }> = [
    {
      mutate: (comparison) => {
        const future =
          comparison.countries[1]!.futureAdoptedRegulations.pop()!;
        future.status = "effective";
        comparison.countries[1]!.currentEffectiveRegulations.push(future);
      },
      name: "future regulation moved to current with synchronized status",
    },
    {
      mutate: (comparison) => {
        const current =
          comparison.countries[0]!.currentEffectiveRegulations.pop()!;
        current.status = "adopted";
        comparison.countries[0]!.futureAdoptedRegulations.push(current);
      },
      name: "current regulation moved to future with synchronized status",
    },
    {
      mutate: (comparison) => {
        comparison.countries[0]!.currentEffectiveRegulations[0]!.recordStatus =
          "adopted";
      },
      name: "record status",
    },
    {
      mutate: (comparison) => {
        comparison.countries[0]!.currentEffectiveRegulations[0]!.applicability.membership.validFrom =
          "2027-01-01";
      },
      name: "membership lower date boundary",
    },
    {
      mutate: (comparison) => {
        comparison.countries[0]!.currentEffectiveRegulations[0]!.applicability.membership.validTo =
          comparison.query.asOf;
      },
      name: "membership excluded upper date boundary",
    },
    {
      mutate: (comparison) => {
        comparison.countries[0]!.currentEffectiveRegulations[0]!.limits[0]!.powerMinKw =
          101;
      },
      name: "limit power lower boundary",
    },
    {
      mutate: (comparison) => {
        comparison.countries[0]!.currentEffectiveRegulations[0]!.limits[0]!.powerMaxKw =
          comparison.query.powerKw;
      },
      name: "limit power excluded upper boundary",
    },
    {
      mutate: (comparison) => {
        comparison.countries[0]!.currentEffectiveRegulations[0]!.limits[0]!.validFrom =
          "2027-01-01";
      },
      name: "current limit validity",
    },
    {
      mutate: (comparison) => {
        comparison.countries[1]!.futureAdoptedRegulations[0]!.limits[0]!.validTo =
          comparison.query.asOf;
      },
      name: "future limit excluded validity boundary",
    },
    {
      mutate: (comparison) => {
        comparison.countries[0]!.currentEffectiveRegulations[0]!.effectiveTo =
          "2024-01-01";
      },
      name: "invalid regulation effective interval",
    },
    {
      mutate: (comparison) => {
        comparison.countries[0]!.currentEffectiveRegulations[0]!.applicability.countryIso3 =
          "BRA";
      },
      name: "applicability country",
    },
    {
      mutate: (comparison) => {
        comparison.countries[0]!.status = "no_data";
      },
      name: "country status",
    },
    {
      mutate: (comparison) => {
        comparison.countries[0]!.countrySource = null;
      },
      name: "country record pairing",
    },
    {
      mutate: (comparison) => {
        comparison.countries.reverse();
      },
      name: "query country order",
    },
    {
      mutate: (comparison) => {
        const current =
          comparison.countries[0]!.currentEffectiveRegulations[0]!;
        comparison.countries[0]!.futureAdoptedRegulations.push(
          structuredClone(current),
        );
      },
      name: "duplicate regulation id",
    },
    {
      mutate: (comparison) => {
        const current =
          comparison.countries[0]!.currentEffectiveRegulations[0]!;
        current.limits.push(structuredClone(current.limits[0]!));
      },
      name: "duplicate limit id",
    },
    {
      mutate: (comparison) => {
        comparison.missingData.push("forged missing data");
      },
      name: "missing-data summary",
    },
  ];

  it.each(driftCases)("rejects $name drift", ({ mutate }) => {
    const drifted = buildRegulationComparison();
    mutate(drifted);

    expect(regulationComparisonMatchesDeterministicRules(drifted)).toBe(false);
  });
});

describe("market comparison deterministic consistency", () => {
  it("accepts comparable, global-only scoped, incomparable and insufficient results", () => {
    const comparable = buildMarketComparison();
    const globalOnly = structuredClone(comparable);
    for (const observation of globalOnly.metrics[0]!.observations) {
      observation.applicationScope = null;
    }

    const incomparable = structuredClone(comparable);
    incomparable.metrics[0]!.observations[0]!.unitCode = "vehicle";
    incomparable.metrics[0]!.issues = ["UNIT_MISMATCH"];
    incomparable.metrics[0]!.comparisonStatus = "incomparable";
    incomparable.missingData = [
      "DEMO_ADDRESSABLE_UNITS 不可比较：UNIT_MISMATCH。",
    ];

    const insufficient = structuredClone(comparable);
    insufficient.metrics[0]!.observations.pop();
    insufficient.metrics[0]!.issues = ["MISSING_COUNTRY_OBSERVATION"];
    insufficient.metrics[0]!.comparisonStatus = "insufficient_data";
    insufficient.missingData = [
      "DEMO_ADDRESSABLE_UNITS 不可比较：MISSING_COUNTRY_OBSERVATION。",
    ];

    const ambiguous = structuredClone(comparable);
    const duplicate = structuredClone(ambiguous.metrics[0]!.observations[0]!);
    duplicate.id = "00000000-0000-4000-8000-000000000303";
    ambiguous.metrics[0]!.observations.splice(1, 0, duplicate);
    ambiguous.metrics[0]!.issues = ["AMBIGUOUS_LATEST_OBSERVATION"];
    ambiguous.metrics[0]!.comparisonStatus = "insufficient_data";
    ambiguous.missingData = [
      "DEMO_ADDRESSABLE_UNITS 不可比较：AMBIGUOUS_LATEST_OBSERVATION。",
    ];

    expect(
      [comparable, globalOnly, incomparable, insufficient, ambiguous].every(
        marketComparisonMatchesDeterministicRules,
      ),
    ).toBe(true);
  });

  it("accepts canonical implicit metric ordering and an empty result", () => {
    const implicit = buildMarketComparison();
    delete implicit.query.metricCodes;
    const second = structuredClone(implicit.metrics[0]!);
    second.metricCode = "SECOND_METRIC";
    second.metricName = "DEMO ONLY — Second metric";
    second.observations = second.observations.map((observation, index) => ({
      ...observation,
      id:
        index === 0
          ? "00000000-0000-4000-8000-000000000311"
          : "00000000-0000-4000-8000-000000000312",
      metricCode: second.metricCode,
      metricName: second.metricName,
    }));
    implicit.metrics.push(second);

    const empty: MarketComparison = {
      metrics: [],
      missingData: ["所选国家没有结构化市场指标。"],
      query: {
        applicationScope: "non-road",
        countryIso3s: ["CHN", "BRA"],
      },
      sources: [],
    };

    expect(marketComparisonMatchesDeterministicRules(implicit)).toBe(true);
    expect(marketComparisonMatchesDeterministicRules(empty)).toBe(true);
  });

  const driftCases: Array<{
    mutate: (comparison: MarketComparison) => void;
    name: string;
  }> = [
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.observations[0]!.unitCode = "vehicle";
      },
      name: "undeclared unit mismatch",
    },
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.observations[0]!.currencyCode = "EUR";
      },
      name: "undeclared currency mismatch",
    },
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.observations[0]!.definition =
          "different definition";
      },
      name: "undeclared definition mismatch",
    },
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.observations[0]!.methodologyVersion = "demo-v2";
      },
      name: "undeclared methodology mismatch",
    },
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.observations[0]!.periodStart = "2025-02-01";
      },
      name: "undeclared period-start mismatch",
    },
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.observations[0]!.periodEnd = "2026-02-01";
      },
      name: "undeclared period-end mismatch",
    },
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.observations[0]!.applicationScope = null;
      },
      name: "undeclared global/scoped mismatch",
    },
    {
      mutate: (comparison) => {
        for (const observation of comparison.metrics[0]!.observations) {
          observation.applicationScope = "marine";
        }
      },
      name: "observation scope outside the scoped query",
    },
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.observations[0]!.countryIso3 = "MEX";
      },
      name: "observation country outside the query",
    },
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.observations[0]!.metricCode = "OTHER_METRIC";
      },
      name: "observation metric code",
    },
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.observations[0]!.metricName = "Other name";
      },
      name: "observation metric name",
    },
    {
      mutate: (comparison) => {
        const duplicate = structuredClone(
          comparison.metrics[0]!.observations[0]!,
        );
        duplicate.id = "00000000-0000-4000-8000-000000000399";
        comparison.metrics[0]!.observations.push(duplicate);
      },
      name: "undeclared duplicate latest observation",
    },
    {
      mutate: (comparison) => {
        const older = structuredClone(
          comparison.metrics[0]!.observations[0]!,
        );
        older.id = "00000000-0000-4000-8000-000000000398";
        older.periodStart = "2024-01-01";
        older.periodEnd = "2025-01-01";
        comparison.metrics[0]!.observations.push(older);
      },
      name: "non-latest visible observation",
    },
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.issues.push("UNIT_MISMATCH");
      },
      name: "unsupported issue",
    },
    {
      mutate: (comparison) => {
        comparison.metrics[0]!.comparisonStatus = "incomparable";
      },
      name: "comparison status",
    },
    {
      mutate: (comparison) => {
        comparison.missingData.push("forged missing data");
      },
      name: "missing-data summary",
    },
    {
      mutate: (comparison) => {
        comparison.metrics.push(structuredClone(comparison.metrics[0]!));
      },
      name: "duplicate metric code",
    },
    {
      mutate: (comparison) => {
        comparison.query.metricCodes = ["OTHER_METRIC"];
      },
      name: "metric/query code mismatch",
    },
    {
      mutate: (comparison) => {
        comparison.query.metricCodes!.push("DEMO_ADDRESSABLE_UNITS");
      },
      name: "duplicate query metric code",
    },
    {
      mutate: (comparison) => {
        const observation = comparison.metrics[0]!.observations[0]!;
        observation.periodEnd = observation.periodStart;
      },
      name: "invalid observation period",
    },
  ];

  it.each(driftCases)("rejects $name drift", ({ mutate }) => {
    const drifted = buildMarketComparison();
    mutate(drifted);

    expect(marketComparisonMatchesDeterministicRules(drifted)).toBe(false);
  });
});
