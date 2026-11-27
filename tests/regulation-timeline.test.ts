import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildRegulationTimeline,
  evaluateTimelineCatalogImpact,
  type RegulationTimelineSourceRow,
} from "@/domain/regulation-timeline/build-timeline";
import type { CatalogRecord } from "@/features/product-catalog/schemas";
import { regulationTimelineQuerySchema } from "@/features/regulation-timeline/schemas";
import {
  addUtcMonths,
  getRegulationTimeline,
  regulationTimelineWindow,
} from "@/server/services/regulation-timeline-service";

const verifiedAt = new Date("2026-11-20T00:00:00.000Z");

function row(
  overrides: Partial<RegulationTimelineSourceRow> = {},
): RegulationTimelineSourceRow {
  return {
    applicationScope: "non-road",
    canonicalName: "Stage VI",
    citationCode: "XX-STAGE-VI",
    countryIso3: "AAA",
    effectiveFrom: "2027-01-01",
    effectiveTo: null,
    isDemo: false,
    jurisdictionCode: "XX",
    limitIsDemo: false,
    limitValidFrom: "2027-01-01",
    limitValidTo: null,
    membershipIsDemo: false,
    membershipValidFrom: "2000-01-01",
    membershipValidTo: null,
    powerMaxKw: "560",
    powerMinKw: "56",
    regulationId: "reg-1",
    source: {
      id: "src-1",
      isDemo: false,
      title: "Official notice",
      url: "https://example.test/notice",
      verifiedAt,
    },
    status: "adopted",
    verifiedAt,
    ...overrides,
  };
}

function record(overrides: Partial<CatalogRecord>): CatalogRecord {
  return {
    id: "DEMO-A",
    model: "DEMO-A",
    series: "DEMO",
    category: "industrial",
    applicationScopes: ["non-road"],
    ratedPowerKw: 100,
    ratedSpeedRpm: 2200,
    powerMinKw: 75,
    powerMaxKw: 130,
    displacementL: 4.5,
    cylinders: 4,
    aftertreatment: "DOC+DPF+SCR",
    emissionLabel: "Stage V",
    declaredCitationCodes: [],
    ...overrides,
  } as CatalogRecord;
}

const window = { from: "2025-11-26", to: "2031-11-26" };

describe("regulation timeline", () => {
  it("adds calendar months in UTC and clamps short months", () => {
    expect(addUtcMonths("2026-11-26", 60)).toBe("2031-11-26");
    expect(addUtcMonths("2026-11-26", -12)).toBe("2025-11-26");
    expect(addUtcMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(regulationTimelineWindow("2026-11-26", 12)).toEqual({
      from: "2025-11-26",
      to: "2027-11-26",
    });
  });

  it("parses URL filters, ignores power without an application and rejects unknown horizons", () => {
    expect(regulationTimelineQuerySchema.parse({})).toEqual({
      horizonMonths: 60,
    });
    expect(
      regulationTimelineQuerySchema.parse({
        applicationScope: "construction",
        powerKw: "300",
        horizonMonths: "36",
      }),
    ).toEqual({
      applicationScope: "construction",
      powerKw: 300,
      horizonMonths: 36,
    });
    expect(
      regulationTimelineQuerySchema.parse({
        applicationScope: "",
        powerKw: "",
      }),
    ).toEqual({ horizonMonths: 60 });
    expect(() =>
      regulationTimelineQuerySchema.parse({ horizonMonths: "24" }),
    ).toThrow();
    expect(() =>
      regulationTimelineQuerySchema.parse({ applicationScope: "rocket" }),
    ).toThrow();
  });

  it("emits dated start and end events with countries applying on that date", () => {
    const events = buildRegulationTimeline({
      today: "2026-11-26",
      window,
      rows: [
        row({ countryIso3: "BBB" }),
        row({ countryIso3: "AAA" }),
        // Joins only after the start date, so it must not widen the event.
        row({ countryIso3: "CCC", membershipValidFrom: "2028-01-01" }),
        row({
          regulationId: "reg-0",
          canonicalName: "Stage V",
          citationCode: "XX-STAGE-V",
          status: "effective",
          effectiveFrom: "2019-01-01",
          effectiveTo: "2027-01-01",
          limitValidFrom: "2019-01-01",
          limitValidTo: "2027-01-01",
        }),
      ],
    });

    expect(
      events.map(({ key, date, kind, countryIso3s, timing, status }) => ({
        key,
        date,
        kind,
        countryIso3s,
        timing,
        status,
      })),
    ).toEqual([
      {
        key: "reg-0:ends",
        date: "2027-01-01",
        kind: "ends",
        countryIso3s: ["AAA"],
        timing: "upcoming",
        status: "effective",
      },
      {
        key: "reg-1:takes_effect",
        date: "2027-01-01",
        kind: "takes_effect",
        countryIso3s: ["AAA", "BBB"],
        timing: "upcoming",
        status: "adopted",
      },
    ]);
    expect(events.every((event) => event.catalogImpact === null)).toBe(true);
  });

  it("keeps proposed dates proposed and marks past events and demo evidence", () => {
    const [proposed, past] = buildRegulationTimeline({
      today: "2026-11-26",
      window,
      rows: [
        row({
          regulationId: "reg-p",
          status: "proposed",
          effectiveFrom: "2030-01-01",
          limitValidFrom: "2030-01-01",
          limitIsDemo: true,
        }),
        row({
          regulationId: "reg-past",
          status: "effective",
          effectiveFrom: "2026-01-01",
          limitValidFrom: "2026-01-01",
        }),
      ],
    }).toSorted((left, right) => right.date.localeCompare(left.date));
    expect(proposed).toMatchObject({ status: "proposed", isDemo: true });
    expect(past).toMatchObject({ timing: "past", isDemo: false });
  });

  it("filters by exact application and half-open power band", () => {
    const rows = [
      row({ regulationId: "road", applicationScope: "on-road" }),
      row({ regulationId: "low", powerMinKw: "19", powerMaxKw: "56" }),
      row({ regulationId: "mid" }),
    ];
    const ids = (powerKw?: number) =>
      buildRegulationTimeline({
        today: "2026-11-26",
        window,
        rows,
        filter: { applicationScope: "non-road", powerKw },
      }).map((event) => event.regulationId);
    expect(ids()).toEqual(["low", "mid"].toSorted());
    expect(ids(56)).toEqual(["mid"]);
    expect(ids(55.9)).toEqual(["low"]);
  });

  it("lists declared models and declaration gaps literally by citation code", () => {
    const catalog = [
      record({ model: "DEMO-B", declaredCitationCodes: ["XX-STAGE-VI"] }),
      record({ model: "DEMO-A" }),
      record({ model: "DEMO-MARINE", applicationScopes: ["marine"] }),
      record({ model: "DEMO-BIG", powerMinKw: 200, powerMaxKw: 400 }),
    ];
    const [event] = buildRegulationTimeline({
      today: "2026-11-26",
      window,
      rows: [row()],
      filter: { applicationScope: "non-road", powerKw: 100 },
      catalog,
    });
    expect(event!.catalogImpact).toEqual({
      declared: ["DEMO-B"],
      gaps: ["DEMO-A"],
    });
    expect(
      evaluateTimelineCatalogImpact(catalog, null, "non-road", 100),
    ).toEqual({ declared: [], gaps: ["DEMO-A", "DEMO-B"] });
  });
});

describe("regulation timeline on the seeded demo database", () => {
  const originalMode = process.env.DATABASE_MODE;
  beforeAll(() => {
    process.env.DATABASE_MODE = "pglite-demo";
  });
  afterAll(() => {
    process.env.DATABASE_MODE = originalMode;
  });

  it("returns ordered events inside the window with sources", async () => {
    const result = await getRegulationTimeline(
      regulationTimelineQuerySchema.parse({}),
      "2026-11-26",
    );
    expect(result.window).toEqual({ from: "2025-11-26", to: "2031-11-26" });
    expect(result.catalogEvaluated).toBe(false);
    expect(result.events.length).toBeGreaterThan(0);
    for (const event of result.events) {
      expect(event.date >= result.window.from).toBe(true);
      expect(event.date <= result.window.to).toBe(true);
      expect(event.countryIso3s.length).toBeGreaterThan(0);
      expect(event.source.title.length).toBeGreaterThan(0);
    }
    const dates = result.events.map((event) => event.date);
    expect(dates).toEqual(dates.toSorted());
  }, 60_000);

  it("evaluates catalogue impact only when application and power are given", async () => {
    const result = await getRegulationTimeline(
      regulationTimelineQuerySchema.parse({
        applicationScope: "non-road",
        powerKw: "100",
      }),
      "2026-11-26",
    );
    expect(result.catalogEvaluated).toBe(true);
    for (const event of result.events) {
      expect(event.applicationScopes).toEqual(["non-road"]);
      if (event.kind === "takes_effect")
        expect(event.catalogImpact).not.toBeNull();
    }
  }, 60_000);
});
