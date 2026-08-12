import { beforeAll, afterAll, describe, expect, it } from "vitest";

import {
  seedAcceptanceFixtures,
  acceptedLimitUnavailableRegulationIds,
  acceptanceFixtureIds,
  buildFixtureLimits,
  euMemberCountryIso3,
  euOfficialMemberCountryIso3,
  fixtureCountryJurisdictions,
  fixtureJurisdictions,
  fixtureRegulations,
  fixtureSources,
} from "@/server/db/seed/acceptance-fixtures";
import {
  fixtureMarketMetrics,
  fixtureMarketSources,
} from "@/server/db/seed/accepted-market-fixtures";
import { seedDemoData } from "@/server/db/seed/demo-data";
import { createCountryRepository } from "@/server/repositories/country-repository";
import { createRegulationRepository } from "@/server/repositories/regulation-repository";
import {
  CANADA_COMPLETENESS_SIGNOFF_ISO,
  TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO,
} from "../scripts/db/ingest-signoff";
import { createTestDatabase } from "./helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  await seedDemoData(testDatabase.database);
  await seedAcceptanceFixtures(testDatabase.database);
}, 30_000);

afterAll(async () => {
  await testDatabase.client.close();
});

const cfr1039RoundedPowerBandValues = {
  below8: new Map([
    ["CO", 8],
    ["NOX+NMHC", 7.5],
    ["PM", 0.4],
  ]),
  from8To19: new Map([
    ["CO", 6.6],
    ["NOX+NMHC", 7.5],
    ["PM", 0.4],
  ]),
  from19To37: new Map([
    ["CO", 5.5],
    ["NOX+NMHC", 4.7],
    ["PM", 0.03],
  ]),
  from37To56: new Map([
    ["CO", 5],
    ["NOX+NMHC", 4.7],
    ["PM", 0.03],
  ]),
  from56To130: new Map([
    ["CO", 5],
    ["NMHC", 0.19],
    ["NOX", 0.4],
    ["PM", 0.02],
  ]),
  from130To560: new Map([
    ["CO", 3.5],
    ["NMHC", 0.19],
    ["NOX", 0.4],
    ["PM", 0.02],
  ]),
} as const;

const cfr1039RoundedPowerCases = [
  [
    7.499,
    "NRTC AND NRSC (6-mode OR 8-mode/RMC)",
    cfr1039RoundedPowerBandValues.below8,
  ],
  [
    7.5,
    "NRTC AND NRSC (6-mode OR 8-mode/RMC)",
    cfr1039RoundedPowerBandValues.from8To19,
  ],
  [
    18.5,
    "NRTC AND NRSC (6-mode OR 8-mode/RMC)",
    cfr1039RoundedPowerBandValues.from8To19,
  ],
  [
    18.501,
    "NRTC AND NRSC-C1 (8-mode OR RMC)",
    cfr1039RoundedPowerBandValues.from19To37,
  ],
  [
    36.5,
    "NRTC AND NRSC-C1 (8-mode OR RMC)",
    cfr1039RoundedPowerBandValues.from19To37,
  ],
  [
    36.501,
    "NRTC AND NRSC-C1 (8-mode OR RMC)",
    cfr1039RoundedPowerBandValues.from37To56,
  ],
  [
    55.499,
    "NRTC AND NRSC-C1 (8-mode OR RMC)",
    cfr1039RoundedPowerBandValues.from37To56,
  ],
  [
    55.5,
    "NRTC AND NRSC-C1 (8-mode OR RMC)",
    cfr1039RoundedPowerBandValues.from56To130,
  ],
  [
    129.499,
    "NRTC AND NRSC-C1 (8-mode OR RMC)",
    cfr1039RoundedPowerBandValues.from56To130,
  ],
  [
    129.5,
    "NRTC AND NRSC-C1 (8-mode OR RMC)",
    cfr1039RoundedPowerBandValues.from130To560,
  ],
  [
    560.5,
    "NRTC AND NRSC-C1 (8-mode OR RMC)",
    cfr1039RoundedPowerBandValues.from130To560,
  ],
] as const;

const cfr1039FirstRawPowerAboveRounded560Kw = 560.501;

/**
 * M1 签核验收（docs/ACCEPTANCE.md 总签核，2026-07-30）。
 * 每个期望结果都不依赖模型推理：适用法规身份、状态、日期/功率边界、
 * proposed 不作为 effective 返回。
 */
describe("accepted real-fact fixtures (ADR-015 sign-off)", () => {
  const repository = () => createRegulationRepository(testDatabase.database);

  it("keeps signed market source identities separate from regulation sources", () => {
    const regulationSourceIds = new Set(
      fixtureSources.map(({ id }) => id).filter((id) => id !== undefined),
    );
    const marketSourceIds = new Set(
      fixtureMarketSources.map(({ id }) => id).filter((id) => id !== undefined),
    );

    expect(fixtureMarketSources).toHaveLength(9);
    expect(fixtureMarketMetrics).toHaveLength(24);
    expect(
      [...marketSourceIds].filter((id) => regulationSourceIds.has(id)),
    ).toEqual([]);
    expect(
      fixtureMarketMetrics.every(({ dataSourceId }) =>
        marketSourceIds.has(dataSourceId),
      ),
    ).toBe(true);
    expect(
      fixtureMarketSources.every(
        ({ sourceType }) => sourceType !== "official-regulation",
      ),
    ).toBe(true);
  });

  it("CHN truck and bus share GB 17691-2018 6b with verified WHTC limits", async () => {
    const truckRows = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2026-07-30",
      countryIso3: "CHN",
      powerKw: 350,
    });
    const busRows = await repository().findEffectiveByCountry({
      applicationScope: "on-road-bus",
      asOf: "2026-07-30",
      countryIso3: "CHN",
      powerKw: 350,
    });

    const truckRegulationIds = new Set(
      truckRows.map((row) => row.regulationId),
    );
    expect(truckRegulationIds).toEqual(
      new Set([acceptanceFixtureIds.regulation.cnGb17691]),
    );
    expect(new Set(busRows.map((row) => row.regulationId))).toEqual(
      truckRegulationIds,
    );
    expect(truckRows.every((row) => row.status === "effective")).toBe(true);
    expect(truckRows.every((row) => !row.isDemo)).toBe(true);

    const nox = truckRows.find((row) => row.limit.pollutantCode === "NOX");
    expect(nox).toMatchObject({
      citationCode: "GB 17691-2018",
      limit: { unitCode: "mg/kWh" },
    });
    expect(Number(nox?.limit.limitValue)).toBe(460);
  });

  it("CHN construction and agriculture publish every current GB 20891 Stage IV band", async () => {
    const expectedBands = [
      {
        powerKw: 36.999,
        values: new Map([
          ["CO", 5.5],
          ["HC+NOx", 7.5],
          ["PM", 0.6],
        ]),
      },
      {
        powerKw: 37,
        values: new Map([
          ["CO", 5],
          ["HC+NOx", 4.7],
          ["PM", 0.025],
          ["PN", 5000],
        ]),
      },
      {
        powerKw: 55.999,
        values: new Map([
          ["CO", 5],
          ["HC+NOx", 4.7],
          ["PM", 0.025],
          ["PN", 5000],
        ]),
      },
      {
        powerKw: 56,
        values: new Map([
          ["CO", 5],
          ["HC", 0.19],
          ["NOX", 3.3],
          ["PM", 0.025],
          ["PN", 5000],
        ]),
      },
      {
        powerKw: 129.999,
        values: new Map([
          ["CO", 5],
          ["HC", 0.19],
          ["NOX", 3.3],
          ["PM", 0.025],
          ["PN", 5000],
        ]),
      },
      {
        powerKw: 130,
        values: new Map([
          ["CO", 3.5],
          ["HC", 0.19],
          ["NOX", 2],
          ["PM", 0.025],
          ["PN", 5000],
        ]),
      },
      {
        powerKw: 560,
        values: new Map([
          ["CO", 3.5],
          ["HC", 0.19],
          ["NOX", 2],
          ["PM", 0.025],
          ["PN", 5000],
        ]),
      },
    ] as const;

    for (const applicationScope of ["construction", "agriculture"] as const) {
      for (const expected of expectedBands) {
        const rows = await repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-11",
          countryIso3: "CHN",
          powerKw: expected.powerKw,
        });
        const values = new Map(
          rows.map((row) => [
            row.limit.pollutantCode,
            Number(row.limit.limitValue),
          ]),
        );

        expect(values).toEqual(expected.values);
        expect(
          rows.every(
            (row) =>
              row.regulationId === acceptanceFixtureIds.regulation.cnGb20891 &&
              row.limit.testCycleCode === "NRSC AND applicable NRTC" &&
              row.limit.verifiedAt?.toISOString() ===
                "2026-08-11T04:38:07.000Z",
          ),
        ).toBe(true);
        expect(values.has("NH3")).toBe(false);
      }
    }
    const stage4FixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId === acceptanceFixtureIds.regulation.cnGb20891 &&
        row.validFrom === "2022-12-01",
    );
    expect(stage4FixtureRows).toHaveLength(34);
    expect(
      stage4FixtureRows.every((row) =>
        row.measurementBasis?.includes(
          "NH3 25 ppm applies only to reagent-using engines",
        ),
      ),
    ).toBe(true);
    expect(
      fixtureSources.find(
        (source) => source.id === acceptanceFixtureIds.source.cnHj1014,
      ),
    ).toMatchObject({
      publishedOn: "2020-12-28",
      publisher: "生态环境部",
      sourceType: "official-regulation",
      title: "HJ 1014-2020 非道路柴油移动机械污染物排放控制技术要求",
      url: "https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/dqhjbh/dqydywrwpfbz/202012/t20201231_815684.shtml",
      verifiedAt: new Date("2026-08-11T04:38:07.000Z"),
    });
    expect(
      fixtureJurisdictions.find(
        (jurisdiction) =>
          jurisdiction.id === acceptanceFixtureIds.jurisdiction.cnMee,
      )?.dataSourceId,
    ).toBe(acceptanceFixtureIds.source.cnHj1014);
  });

  it("CHN preserves the Stage III history and switches exactly at the Stage IV boundaries", async () => {
    const query = (
      applicationScope: "construction" | "agriculture",
      asOf: string,
      powerKw: number,
    ) =>
      repository().findEffectiveByCountry({
        applicationScope,
        asOf,
        countryIso3: "CHN",
        powerKw,
      });
    const values = (rows: Awaited<ReturnType<typeof query>>) =>
      new Map(
        rows.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
    const stage3Bands = [
      {
        powerKw: 36.999,
        values: new Map([
          ["CO", 5.5],
          ["HC+NOx", 7.5],
          ["PM", 0.6],
        ]),
      },
      {
        powerKw: 37,
        values: new Map([
          ["CO", 5],
          ["HC+NOx", 4.7],
          ["PM", 0.4],
        ]),
      },
      {
        powerKw: 75,
        values: new Map([
          ["CO", 5],
          ["HC+NOx", 4],
          ["PM", 0.3],
        ]),
      },
      {
        powerKw: 130,
        values: new Map([
          ["CO", 3.5],
          ["HC+NOx", 4],
          ["PM", 0.2],
        ]),
      },
      {
        powerKw: 560,
        values: new Map([
          ["CO", 3.5],
          ["HC+NOx", 4],
          ["PM", 0.2],
        ]),
      },
    ] as const;

    for (const applicationScope of ["construction", "agriculture"] as const) {
      await expect(
        query(applicationScope, "2016-03-31", 100),
      ).resolves.toHaveLength(0);
      for (const expected of stage3Bands) {
        const atStart = await query(
          applicationScope,
          "2016-04-01",
          expected.powerKw,
        );
        const finalDay = await query(
          applicationScope,
          "2022-11-30",
          expected.powerKw,
        );
        expect(values(atStart)).toEqual(expected.values);
        expect(values(finalDay)).toEqual(expected.values);
        expect(
          [...atStart, ...finalDay].every(
            (row) =>
              row.limit.testCycleCode === "NRSC" &&
              row.limit.validFrom === "2016-04-01" &&
              row.limit.validTo === "2022-12-01",
          ),
        ).toBe(true);
      }

      expect(values(await query(applicationScope, "2022-12-01", 560))).toEqual(
        new Map([
          ["CO", 3.5],
          ["HC", 0.19],
          ["NOX", 2],
          ["PM", 0.025],
          ["PN", 5000],
        ]),
      );
      const continuation = await query(
        applicationScope,
        "2026-08-11",
        560.001,
      );
      expect(values(continuation)).toEqual(
        new Map([
          ["CO", 3.5],
          ["HC+NOx", 6.4],
          ["PM", 0.2],
        ]),
      );
      expect(
        continuation.every(
          (row) =>
            row.limit.testCycleCode === "NRSC" &&
            row.limit.validFrom === "2016-04-01" &&
            row.limit.validTo === null,
        ),
      ).toBe(true);
    }
  });

  it("CHN resolves accepted provenance alongside the retained demo jurisdiction", async () => {
    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-11",
      iso3: "CHN",
    });
    const cnMeeJurisdiction = details?.jurisdictions.find(
      (jurisdiction) =>
        jurisdiction.id === acceptanceFixtureIds.jurisdiction.cnMee,
    );

    expect(details?.jurisdictions.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["DEMO-CHN-AUTHORITY", "CN-MEE"]),
    );
    expect(cnMeeJurisdiction?.code).toBe("CN-MEE");
    expect(cnMeeJurisdiction?.source.id).toBe(
      acceptanceFixtureIds.source.cnHj1014,
    );
    expect(cnMeeJurisdiction?.source.verifiedAt.toISOString()).toBe(
      "2026-08-11T04:38:07.000Z",
    );
    const currentEffectiveRegulations = details?.regulations.filter(
      (regulation) =>
        regulation.status === "effective" &&
        regulation.effectiveFrom !== null &&
        regulation.effectiveFrom <= "2026-08-11" &&
        (regulation.effectiveTo === null ||
          regulation.effectiveTo > "2026-08-11"),
    );

    expect(currentEffectiveRegulations).toHaveLength(3);
    expect(
      currentEffectiveRegulations?.map(({ citationCode }) => citationCode),
    ).toEqual(
      expect.arrayContaining([
        "DEMO-CHN-NR-A",
        "GB 17691-2018",
        "GB 20891-2014",
      ]),
    );
  });

  it("USA switches complete representative road paths at MY2027", async () => {
    const query = (applicationScope: "on-road-truck" | "on-road-bus", asOf: string) =>
      repository().findEffectiveByCountry({
        applicationScope,
        asOf,
        countryIso3: "USA",
        powerKw: 350,
      });

    await expect(query("on-road-truck", "2009-12-31")).resolves.toHaveLength(0);
    for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
      const beforeRows = await query(applicationScope, "2026-12-31");
      const afterRows = await query(applicationScope, "2027-01-01");
      const beforeValues = new Map(
        beforeRows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      const afterValues = new Map(
        afterRows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );

      expect(beforeRows).toHaveLength(7);
      expect(beforeRows.every((row) => row.citationCode === "40 CFR 86.007-11")).toBe(true);
      expect(beforeRows.every((row) => row.limit.sourceId === acceptanceFixtureIds.source.usEcfr86)).toBe(true);
      expect(beforeValues.get("FTP/SET:NOX")).toBe(0.2);
      expect(beforeValues.get("FTP/SET:NMHC")).toBe(0.14);
      expect(beforeValues.get("FTP/SET:CO")).toBe(15.5);
      expect(beforeValues.get("FTP/SET:PM")).toBe(0.01);
      expect(beforeValues.get("CFR86-SMOKE-ACCEL:OPACITY")).toBe(20);
      expect(beforeValues.get("CFR86-SMOKE-LUG:OPACITY")).toBe(15);
      expect(beforeValues.get("CFR86-SMOKE-PEAK:OPACITY")).toBe(50);

      expect(afterRows).toHaveLength(8);
      expect(afterRows.every((row) => row.citationCode === "40 CFR 1036.104")).toBe(true);
      expect(afterRows.every((row) => row.limit.sourceId === acceptanceFixtureIds.source.usEcfr1036)).toBe(true);
      expect(afterValues.get("FTP/SET:NOX")).toBe(0.035);
      expect(afterValues.get("FTP/SET:NMHC")).toBe(0.06);
      expect(afterValues.get("FTP/SET:PM")).toBe(0.005);
      expect(afterValues.get("FTP/SET:CO")).toBe(6);
      expect(afterValues.get("LLC:NOX")).toBe(0.05);
      expect(afterValues.get("LLC:NMHC")).toBe(0.14);
      expect(afterValues.get("LLC:PM")).toBe(0.005);
      expect(afterValues.get("LLC:CO")).toBe(6);
    }
  });

  it("USA Tier 4 nonroad path applies nearest-whole-kW classification to every Table 1 band", async () => {
    for (const applicationScope of ["construction", "agriculture"] as const) {
      for (const [
        powerKw,
        testCycleCode,
        expectedValues,
      ] of cfr1039RoundedPowerCases) {
        const rows = await repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-07-30",
          countryIso3: "USA",
          powerKw,
        });
        const values = new Map(
          rows.map((row) => [
            row.limit.pollutantCode,
            Number(row.limit.limitValue),
          ]),
        );

        expect(values).toEqual(expectedValues);
        expect(
          rows.every(
            (row) =>
              row.regulationId ===
                acceptanceFixtureIds.regulation.us1039101 &&
              row.limit.sourceId === acceptanceFixtureIds.source.usEcfr1039 &&
              row.limit.testCycleCode === testCycleCode,
          ),
        ).toBe(true);
        expect(values.has("OPACITY")).toBe(false);
      }
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-07-30",
          countryIso3: "USA",
          powerKw: cfr1039FirstRawPowerAboveRounded560Kw,
        }),
      ).resolves.toHaveLength(0);
    }
    const fixtureRows = buildFixtureLimits().filter(
      (row) => row.regulationId === acceptanceFixtureIds.regulation.us1039101,
    );
    expect(fixtureRows).toHaveLength(40);
    expect(
      fixtureRows.every(
        ({ measurementBasis }) =>
          measurementBasis?.includes("40 CFR 1039.140") === true &&
          measurementBasis.includes("40 CFR 1065.20(e)"),
      ),
    ).toBe(true);
  });

  it("proposed rules never appear in effective queries", async () => {
    for (const asOf of ["2026-07-30", "2028-01-01"]) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf,
        countryIso3: "USA",
        powerKw: 350,
      });

      expect(rows.some((row) => row.citationCode === "91 FR 43154")).toBe(
        false,
      );
    }
  });

  it("DEU resolves EU instruments with explicit statuses and the 2027-11-29 switch", async () => {
    const countryRepository = createCountryRepository(testDatabase.database);
    const details = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-05",
      iso3: "DEU",
    });

    const byCitation = new Map(
      details?.regulations.map((regulation) => [
        regulation.citationCode,
        regulation,
      ]),
    );

    const euroVi = byCitation.get("CELEX:32009R0595");
    expect(euroVi).toMatchObject({
      effectiveFrom: "2012-12-31",
      effectiveTo: "2027-11-29",
      status: "effective",
    });

    const euro7 = byCitation.get("CELEX:32024R1257");
    expect(euro7).toMatchObject({
      effectiveFrom: "2027-11-29",
      status: "adopted",
    });

    const stageV = byCitation.get("CELEX:32016R1628");
    expect(stageV).toMatchObject({
      effectiveFrom: "2019-01-01",
      status: "effective",
    });
  });

  it("BRA P7 switches to P8 on 2023-01-01 and MAR-I remains effective", async () => {
    const countryRepository = createCountryRepository(testDatabase.database);
    const details = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-05",
      iso3: "BRA",
    });

    const byCitation = new Map(
      details?.regulations.map((regulation) => [
        regulation.citationCode,
        regulation,
      ]),
    );

    const p7 = byCitation.get("CONAMA 403/2008");
    expect(p7).toMatchObject({
      effectiveFrom: "2012-01-01",
      effectiveTo: "2023-01-01",
      status: "effective",
    });

    const p8 = byCitation.get("CONAMA 490/2018");
    expect(p8).toMatchObject({
      effectiveFrom: "2023-01-01",
      status: "effective",
    });
    // 2023-01-01 之前的 as-of 查询不得包含 P8（生效日期硬边界）。
    expect(p8?.effectiveFrom && p8.effectiveFrom > "2022-12-31").toBe(true);

    const marI = byCitation.get("CONAMA 433/2011");
    expect(marI).toMatchObject({
      effectiveFrom: "2019-01-01",
      status: "effective",
    });
  });

  it("BRA P8 diesel limits apply identically to trucks and buses", async () => {
    for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2026-07-30",
        countryIso3: "BRA",
        powerKw: 300,
      });
      const noxValues = rows
        .filter((row) => row.limit.pollutantCode === "NOX")
        .map((row) => Number(row.limit.limitValue));
      const pmValues = rows
        .filter((row) => row.limit.pollutantCode === "PM")
        .map((row) => Number(row.limit.limitValue));
      const pnValues = rows
        .filter((row) => row.limit.pollutantCode === "PN")
        .map((row) => Number(row.limit.limitValue));

      expect(rows.length).toBeGreaterThan(0);
      expect(
        rows.every((row) => row.citationCode === "CONAMA 490/2018"),
      ).toBe(true);
      expect(noxValues).toEqual(expect.arrayContaining([400, 460]));
      expect(pmValues).toHaveLength(2);
      expect(new Set(pmValues)).toEqual(new Set([10]));
      expect(pnValues).toEqual(expect.arrayContaining([600, 800]));
      expect(
        new Set(rows.map((row) => row.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-05T12:00:00.000Z"]));
      expect(
        new Set(rows.map((row) => row.limit.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-05T12:00:00.000Z"]));
      expect(
        new Set(rows.map((row) => row.source.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-05T12:00:00.000Z"]));
    }
  });

  it("BRA P7 applies to trucks and buses immediately before the P8 boundary", async () => {
    for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2022-12-31",
        countryIso3: "BRA",
        powerKw: 300,
      });
      const noxValues = rows
        .filter((row) => row.limit.pollutantCode === "NOX")
        .map((row) => Number(row.limit.limitValue));

      expect(rows).toHaveLength(11);
      expect(
        rows.every((row) => row.citationCode === "CONAMA 403/2008"),
      ).toBe(true);
      expect(noxValues).toEqual([2, 2]);
      expect(
        rows.some((row) => row.citationCode === "CONAMA 490/2018"),
      ).toBe(false);
      expect(
        new Set(rows.map((row) => row.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-05T12:50:00.000Z"]));
      expect(
        new Set(rows.map((row) => row.limit.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-05T12:50:00.000Z"]));
      expect(
        new Set(rows.map((row) => row.source.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-05T12:50:00.000Z"]));
    }
  });

  it("BRA switches exclusively to P8 on the general effective date", async () => {
    for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2023-01-01",
        countryIso3: "BRA",
        powerKw: 300,
      });

      expect(rows).toHaveLength(12);
      expect(
        rows.every((row) => row.citationCode === "CONAMA 490/2018"),
      ).toBe(true);
      expect(
        rows.some((row) => row.citationCode === "CONAMA 403/2008"),
      ).toBe(false);
    }
  });

  it("DEU Euro VI limits apply to trucks and buses (WHTC NOx 460 mg/kWh)", async () => {
    for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2026-07-30",
        countryIso3: "DEU",
        powerKw: 300,
      });
      const noxValues = rows
        .filter((row) => row.limit.pollutantCode === "NOX")
        .map((row) => Number(row.limit.limitValue));
      expect(rows.length).toBeGreaterThan(0);
      expect(
        rows.every((row) => row.citationCode === "CELEX:32009R0595"),
      ).toBe(true);
      expect(noxValues).toContain(460); // WHTC (CI)
      expect(noxValues).toContain(400); // WHSC (CI)
      expect(
        rows.find((row) => row.limit.pollutantCode === "NOX")?.limit.unitCode,
      ).toBe("mg/kWh");
    }
  });

  it("DEU Stage V limits apply to construction and agriculture in the 130-560 kW band", async () => {
    for (const applicationScope of ["construction", "agriculture"] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2025-06-01",
        countryIso3: "DEU",
        powerKw: 150,
      });
      const byPollutant = new Map(
        rows.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      expect(
        rows.every((row) => row.citationCode === "CELEX:32016R1628"),
      ).toBe(true);
      expect(byPollutant.get("NOX")).toBe(0.4);
      expect(byPollutant.get("PM")).toBe(0.015);
      expect(byPollutant.get("CO")).toBe(3.5);
    }
  });

  it("JPN applies the 2016 heavy-duty diesel mean limits to trucks and buses", async () => {
    for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2026-08-06",
        countryIso3: "JPN",
        powerKw: 300,
      });
      const noxRows = rows.filter(
        (row) => row.limit.pollutantCode === "NOX",
      );

      expect(rows).toHaveLength(8);
      expect(
        rows.every((row) => row.citationCode === "JPN 2016 HD Diesel"),
      ).toBe(true);
      expect(noxRows).toHaveLength(2);
      expect(
        noxRows.every(
          (row) =>
            Number(row.limit.limitValue) === 0.4 &&
            row.limit.unitCode === "g/kWh",
        ),
      ).toBe(true);
      expect(
        new Set(rows.map((row) => row.limit.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-06T02:41:52.000Z"]));
    }

    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId === acceptanceFixtureIds.regulation.japanRoad2016,
    );
    expect(new Set(fixtureRows.map((row) => row.testCycleCode))).toEqual(
      new Set(["WHSC", "WHTC"]),
    );
    expect(
      fixtureRows.every((row) =>
        row.measurementBasis?.includes("括弧内の平均値"),
      ),
    ).toBe(true);
  });

  it("JPN Off-Road 2014 limits cover construction and agriculture across all five power bands", async () => {
    const cases = [
      { co: 5, nmhc: 0.7, nox: 4, pm: 0.03, powerKw: 19 },
      { co: 5, nmhc: 0.7, nox: 4, pm: 0.025, powerKw: 37 },
      { co: 5, nmhc: 0.19, nox: 0.4, pm: 0.02, powerKw: 56 },
      { co: 5, nmhc: 0.19, nox: 0.4, pm: 0.02, powerKw: 75 },
      { co: 3.5, nmhc: 0.19, nox: 0.4, pm: 0.02, powerKw: 130 },
    ] as const;

    for (const applicationScope of ["construction", "agriculture"] as const) {
      for (const expected of cases) {
        const rows = await repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-06",
          countryIso3: "JPN",
          powerKw: expected.powerKw,
        });
        const byPollutant = new Map(
          rows.map((row) => [
            row.limit.pollutantCode,
            Number(row.limit.limitValue),
          ]),
        );

        expect(rows).toHaveLength(4);
        expect(
          rows.every(
            (row) =>
              row.citationCode ===
              "平成26年三省告示第1号（2014年基準）",
          ),
        ).toBe(true);
        expect(byPollutant).toMatchObject(
          new Map([
            ["CO", expected.co],
            ["NMHC", expected.nmhc],
            ["NOX", expected.nox],
            ["PM", expected.pm],
          ]),
        );
      }
    }
  });

  it("JPN Off-Road 2014 preserves the official 19<=P<560 kW boundary", async () => {
    const query = (powerKw: number) =>
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-08-06",
        countryIso3: "JPN",
        powerKw,
      });

    await expect(query(18.999)).resolves.toHaveLength(0);
    await expect(query(19)).resolves.toHaveLength(4);
    await expect(query(559.999)).resolves.toHaveLength(4);
    await expect(query(560)).resolves.toHaveLength(0);
  });

  it("KOR Annex 17 applies the 2017 heavy-duty diesel limits to trucks and buses", async () => {
    for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2026-08-06",
        countryIso3: "KOR",
        powerKw: 300,
      });
      const noxValues = rows
        .filter((row) => row.limit.pollutantCode === "NOX")
        .map((row) => Number(row.limit.limitValue));

      expect(rows).toHaveLength(12);
      expect(
        rows.every(
          (row) => row.citationCode === "KOR Annex 17 HD Diesel 2017",
        ),
      ).toBe(true);
      expect(noxValues).toEqual(expect.arrayContaining([0.4, 0.46]));
      expect(new Set(rows.map((row) => row.limit.testCycleCode))).toEqual(
        new Set(["WHSC", "WHTC"]),
      );
      expect(
        new Set(rows.map((row) => row.limit.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-06T04:57:42.000Z"]));
    }
  });

  it("KOR Annex 17 nonroad limits apply to construction and agriculture with separate effective dates", async () => {
    const currentQueries = await Promise.all(
      (["construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-06",
          countryIso3: "KOR",
          powerKw: 150,
        }),
      ),
    );
    for (const rows of currentQueries) {
      const byPollutant = new Map(
        rows.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      expect(rows).toHaveLength(6);
      expect(byPollutant.get("CO")).toBe(3.5);
      expect(byPollutant.get("HC")).toBe(0.19);
      expect(byPollutant.get("NOX")).toBe(0.4);
      expect(byPollutant.get("PM")).toBe(0.015);
      expect(byPollutant.get("PN")).toBe(1000);
      expect(byPollutant.get("NH3")).toBe(10);
    }

    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2020-11-30",
        countryIso3: "KOR",
        powerKw: 150,
      }),
    ).resolves.toHaveLength(0);
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2021-06-30",
        countryIso3: "KOR",
        powerKw: 150,
      }),
    ).resolves.toHaveLength(0);
  });

  it("KOR Annex 17 nonroad keeps the official half-open [19,560) boundary", async () => {
    const query = (powerKw: number) =>
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-08-06",
        countryIso3: "KOR",
        powerKw,
      });

    await expect(query(560)).resolves.toHaveLength(0);
    await expect(query(559.999)).resolves.toHaveLength(6);
    await expect(query(19)).resolves.toHaveLength(5);
    await expect(query(37)).resolves.toHaveLength(5);
    await expect(query(56)).resolves.toHaveLength(6);
    await expect(query(130)).resolves.toHaveLength(6);
  });

  it("MEX NOM-044 road tables provide alternative CT/CSE and CEEMAP/CETMAP paths", async () => {
    const truckRows = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2026-08-06",
      countryIso3: "MEX",
      powerKw: 300,
    });
    const busRows = await repository().findEffectiveByCountry({
      applicationScope: "on-road-bus",
      asOf: "2026-08-06",
      countryIso3: "MEX",
      powerKw: 300,
    });

    expect(truckRows).toHaveLength(16);
    expect(busRows).toHaveLength(16);
    expect(
      new Set(truckRows.map((row) => row.regulationId)),
    ).toEqual(
      new Set([
        acceptanceFixtureIds.regulation.mexicoNom044Table1,
        acceptanceFixtureIds.regulation.mexicoNom044Table2,
      ]),
    );
    expect(new Set(busRows.map((row) => row.regulationId))).toEqual(
      new Set(truckRows.map((row) => row.regulationId)),
    );
    expect(
      new Set(truckRows.map((row) => row.limit.testCycleCode)),
    ).toEqual(new Set(["CT/CSE", "CEEMAP", "CETMAP"]));

    const table1Nox = truckRows.find(
      (row) =>
        row.citationCode === "NOM-044-SEMARNAT-2017 Tabla 1B" &&
        row.limit.pollutantCode === "NOX",
    );
    expect(table1Nox?.limit.unitCode).toBe("g/bhp-hr");
    expect(table1Nox?.limit.testCycleCode).toBe("CT/CSE");
    expect(Number(table1Nox?.limit.limitValue)).toBe(0.2);

    const ceemapNox = truckRows.find(
      (row) =>
        row.limit.testCycleCode === "CEEMAP" &&
        row.limit.pollutantCode === "NOX",
    );
    const cetmapNox = truckRows.find(
      (row) =>
        row.limit.testCycleCode === "CETMAP" &&
        row.limit.pollutantCode === "NOX",
    );
    expect(Number(ceemapNox?.limit.limitValue)).toBe(0.4);
    expect(Number(cetmapNox?.limit.limitValue)).toBe(0.46);
    expect(
      truckRows
        .filter((row) => row.limit.pollutantCode === "NH3")
        .every((row) => row.limit.unitCode === "ppm"),
    ).toBe(true);
  });

  it("MEX NOM-044 uses the 2025-01-01 B-standard effective boundary", async () => {
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2024-12-31",
        countryIso3: "MEX",
        powerKw: 300,
      }),
    ).resolves.toHaveLength(0);

    const rows = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2025-01-01",
      countryIso3: "MEX",
      powerKw: 300,
    });
    expect(rows).toHaveLength(16);
    expect(rows.every((row) => row.status === "effective")).toBe(true);
    expect(rows.every((row) => !row.isDemo)).toBe(true);
  });

  it("MEX NOM-044 does not infer construction or agriculture nonroad limits", async () => {
    for (const applicationScope of ["construction", "agriculture"] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-06",
          countryIso3: "MEX",
          powerKw: 150,
        }),
      ).resolves.toHaveLength(0);
    }
  });

  it("TUR Euro VI road limits apply identically to trucks and buses", async () => {
    const truckRows = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2026-08-06",
      countryIso3: "TUR",
      powerKw: 300,
    });
    const busRows = await repository().findEffectiveByCountry({
      applicationScope: "on-road-bus",
      asOf: "2026-08-06",
      countryIso3: "TUR",
      powerKw: 300,
    });

    expect(truckRows).toHaveLength(12);
    expect(busRows).toHaveLength(12);
    expect(new Set(truckRows.map((row) => row.regulationId))).toEqual(
      new Set([acceptanceFixtureIds.regulation.turkeyRoad2016]),
    );
    expect(new Set(busRows.map((row) => row.regulationId))).toEqual(
      new Set([acceptanceFixtureIds.regulation.turkeyRoad2016]),
    );
    expect(
      truckRows
        .filter((row) => row.limit.pollutantCode === "NOX")
        .map((row) => Number(row.limit.limitValue)),
    ).toEqual(expect.arrayContaining([400, 460]));
    expect(new Set(truckRows.map((row) => row.limit.testCycleCode))).toEqual(
      new Set(["WHSC", "WHTC"]),
    );
    expect(
      new Set(truckRows.map((row) => row.verifiedAt.toISOString())),
    ).toEqual(new Set(["2026-08-06T07:30:00.000Z"]));
  });

  it("TUR NRE Stage V applies to construction from the 2022-10-01 market date", async () => {
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2022-09-30",
        countryIso3: "TUR",
        powerKw: 150,
      }),
    ).resolves.toHaveLength(0);

    const rows = await repository().findEffectiveByCountry({
      applicationScope: "construction",
      asOf: "2022-10-01",
      countryIso3: "TUR",
      powerKw: 150,
    });
    const byPollutant = new Map(
      rows.map((row) => [
        row.limit.pollutantCode,
        Number(row.limit.limitValue),
      ]),
    );
    expect(rows).toHaveLength(5);
    expect(byPollutant.get("CO")).toBe(3.5);
    expect(byPollutant.get("HC")).toBe(0.19);
    expect(byPollutant.get("NOX")).toBe(0.4);
    expect(byPollutant.get("PM")).toBe(0.015);
    expect(byPollutant.get("PN")).toBe(1000);
    expect(rows.every((row) => row.applicationScope === "construction")).toBe(
      true,
    );
  });

  it("TUR NRE Stage V preserves power boundaries and does not infer agriculture limits", async () => {
    const query = (powerKw: number) =>
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-08-06",
        countryIso3: "TUR",
        powerKw,
      });

    await expect(query(0)).resolves.toHaveLength(0);
    await expect(query(7.999)).resolves.toHaveLength(3);
    await expect(query(8)).resolves.toHaveLength(3);
    await expect(query(19)).resolves.toHaveLength(4);
    await expect(query(37)).resolves.toHaveLength(4);
    await expect(query(56)).resolves.toHaveLength(5);
    await expect(query(130)).resolves.toHaveLength(5);
    await expect(query(560)).resolves.toHaveLength(0);

    const highPowerRows = await query(600);
    expect(highPowerRows).toHaveLength(4);
    expect(
      Number(
        highPowerRows.find((row) => row.limit.pollutantCode === "NOX")?.limit
          .limitValue,
      ),
    ).toBe(3.5);

    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2026-08-06",
        countryIso3: "TUR",
        powerKw: 150,
      }),
    ).resolves.toHaveLength(0);
  });

  it("AUS ADR 80/04 applies the complete official WHSC/WHTC CI table to trucks and buses", async () => {
    for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2026-08-06",
        countryIso3: "AUS",
        powerKw: 300,
      });
      expect(rows).toHaveLength(12);
      expect(rows.every((row) => row.citationCode === "ADR 80/04")).toBe(true);
      expect(new Set(rows.map((row) => row.limit.testCycleCode))).toEqual(
        new Set(["WHSC", "WHTC"]),
      );
      expect(
        rows
          .filter((row) => row.limit.pollutantCode === "NOX")
          .map((row) => Number(row.limit.limitValue)),
      ).toEqual(expect.arrayContaining([400, 460]));
      expect(
        rows
          .filter((row) => row.limit.pollutantCode === "PM")
          .every((row) => Number(row.limit.limitValue) === 10),
      ).toBe(true);
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values).toEqual(
        new Map([
          ["WHSC:CO", 1500],
          ["WHSC:THC", 130],
          ["WHSC:NOX", 400],
          ["WHSC:NH3", 10],
          ["WHSC:PM", 10],
          ["WHSC:PN", 800],
          ["WHTC:CO", 4000],
          ["WHTC:THC", 160],
          ["WHTC:NOX", 460],
          ["WHTC:NH3", 10],
          ["WHTC:PM", 10],
          ["WHTC:PN", 600],
        ]),
      );
      expect(
        new Set(rows.map((row) => row.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-10T23:00:23.000Z"]));
      expect(
        rows.every(
          (row) =>
            row.limit.sourceUrl ===
              "https://www.legislation.gov.au/F2023L00129/latest/text" &&
            row.limit.validFrom === "2025-11-01",
        ),
      ).toBe(true);
    }
  });

  it("AUS ADR 80/03 to ADR 80/04 uses the all-vehicle coverage dates", async () => {
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2010-12-31",
        countryIso3: "AUS",
        powerKw: 300,
      }),
    ).resolves.toHaveLength(0);

    const firstFullCoverageDay = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2011-01-01",
      countryIso3: "AUS",
      powerKw: 300,
    });
    expect(firstFullCoverageDay).toHaveLength(9);
    expect(
      firstFullCoverageDay.every(
        (row) => row.citationCode === "ADR 80/03",
      ),
    ).toBe(true);

    const before = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2025-10-31",
      countryIso3: "AUS",
      powerKw: 300,
    });
    expect(before).toHaveLength(9);
    expect(before.every((row) => row.citationCode === "ADR 80/03")).toBe(true);
    expect(
      Number(
        before.find(
          (row) =>
            row.limit.pollutantCode === "NOX" &&
            row.limit.testCycleCode === "ESC",
        )?.limit.limitValue,
      ),
    ).toBe(2);
    expect(
      Number(
        before.find(
          (row) =>
            row.limit.pollutantCode === "OPACITY" &&
            row.limit.testCycleCode === "ELR",
        )?.limit.limitValue,
      ),
    ).toBe(0.5);

    const atBoundary = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2025-11-01",
      countryIso3: "AUS",
      powerKw: 300,
    });
    expect(atBoundary).toHaveLength(12);
    expect(atBoundary.every((row) => row.citationCode === "ADR 80/04")).toBe(
      true,
    );
  });

  it("AUS has explicit no-data for construction and agriculture nonroad engines", async () => {
    for (const applicationScope of ["construction", "agriculture"] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-06",
          countryIso3: "AUS",
          powerKw: 150,
        }),
      ).resolves.toHaveLength(0);
    }
  });

  it("CAN SOR/2003-2 applies representative road limits to trucks and buses", async () => {
    const expectedPollutants = new Map([
      ["CO", 15.5],
      ["NMHC", 0.14],
      ["NOX", 0.2],
      ["PM", 0.01],
    ]);
    for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2026-08-06",
        countryIso3: "CAN",
        powerKw: 300,
      });
      expect(rows).toHaveLength(4);
      expect(rows.every((row) => row.citationCode === "SOR/2003-2")).toBe(
        true,
      );
      expect(
        new Map(
          rows.map((row) => [
            row.limit.pollutantCode,
            Number(row.limit.limitValue),
          ]),
        ),
      ).toEqual(expectedPollutants);
      expect(
        rows.every(
          (row) =>
            row.limit.sourceId === acceptanceFixtureIds.source.usEcfr86 &&
            row.limit.testCycleCode === "FTP/SET" &&
            row.limit.unitCode === "g/hp-hr" &&
            row.limit.validFrom === "2010-01-01" &&
            row.limit.verifiedAt.toISOString() ===
              CANADA_COMPLETENESS_SIGNOFF_ISO,
        ),
      ).toBe(true);
    }

    expect(
      buildFixtureLimits()
        .filter(
          ({ regulationId }) =>
            regulationId === acceptanceFixtureIds.regulation.canadaRoad2003,
        )
        .every(
          ({ measurementBasis }) =>
            measurementBasis?.includes("g/bhp-hr") === true &&
            measurementBasis.includes("GVWR > 14,000 lb"),
        ),
    ).toBe(true);

    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2009-12-31",
        countryIso3: "CAN",
        powerKw: 300,
      }),
    ).resolves.toHaveLength(0);
  });

  it("CAN SOR/2020-258 preserves every rounded-power Tier 4 band", async () => {
    for (const applicationScope of ["construction", "agriculture"] as const) {
      for (const [
        powerKw,
        testCycleCode,
        expectedValues,
      ] of cfr1039RoundedPowerCases) {
        const rows = await repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-06",
          countryIso3: "CAN",
          powerKw,
        });
        const values = new Map(
          rows.map((row) => [
            row.limit.pollutantCode,
            Number(row.limit.limitValue),
          ]),
        );

        expect(values).toEqual(expectedValues);
        expect(
          rows.every(
            (row) =>
              row.citationCode === "SOR/2020-258" &&
              row.limit.sourceId === acceptanceFixtureIds.source.usEcfr1039 &&
              row.limit.testCycleCode === testCycleCode &&
              row.limit.validFrom === "2021-06-04" &&
              row.limit.verifiedAt.toISOString() ===
                CANADA_COMPLETENESS_SIGNOFF_ISO,
          ),
        ).toBe(true);
        expect(values.has("OPACITY")).toBe(false);
      }
    }

    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2021-06-03",
        countryIso3: "CAN",
        powerKw: 250,
      }),
    ).resolves.toHaveLength(0);
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-08-10",
        countryIso3: "CAN",
        powerKw: 560.5,
      }),
    ).resolves.toHaveLength(4);
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-08-10",
        countryIso3: "CAN",
        powerKw: cfr1039FirstRawPowerAboveRounded560Kw,
      }),
    ).resolves.toHaveLength(0);
    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
        acceptanceFixtureIds.regulation.canadaOffroad2020,
    );
    expect(fixtureRows).toHaveLength(40);
    expect(
      fixtureRows.every(
        ({ measurementBasis }) =>
          measurementBasis?.includes("40 CFR 1039.140") === true &&
          measurementBasis.includes("40 CFR 1065.20(e)"),
      ),
    ).toBe(true);
  });

  it("CAN carries the corrected direct legal dates and unified verification timestamp", () => {
    const road = fixtureRegulations.find(
      ({ id }) => id === acceptanceFixtureIds.regulation.canadaRoad2003,
    );
    const nonroad = fixtureRegulations.find(
      ({ id }) => id === acceptanceFixtureIds.regulation.canadaOffroad2020,
    );
    const offroadSource = fixtureSources.find(
      ({ id }) => id === acceptanceFixtureIds.source.canadaOffroadRegulation,
    );

    expect(road).toMatchObject({
      adoptedOn: "2002-12-12",
      verifiedAt: new Date(CANADA_COMPLETENESS_SIGNOFF_ISO),
    });
    expect(nonroad).toMatchObject({
      adoptedOn: "2020-12-04",
      effectiveFrom: "2021-06-04",
      verifiedAt: new Date(CANADA_COMPLETENESS_SIGNOFF_ISO),
    });
    expect(offroadSource).toMatchObject({
      publishedOn: "2020-12-23",
      verifiedAt: new Date(CANADA_COMPLETENESS_SIGNOFF_ISO),
    });
  });

  it("CAN keeps road and nonroad regulations isolated by application scope", async () => {
    const roadRows = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2026-08-06",
      countryIso3: "CAN",
      powerKw: 250,
    });
    const nonroadRows = await repository().findEffectiveByCountry({
      applicationScope: "construction",
      asOf: "2026-08-06",
      countryIso3: "CAN",
      powerKw: 250,
    });

    expect(roadRows.every((row) => row.citationCode === "SOR/2003-2")).toBe(
      true,
    );
    expect(
      nonroadRows.every((row) => row.citationCode === "SOR/2020-258"),
    ).toBe(true);
    expect(
      roadRows.every(
        (row) =>
          row.limit.sourceId === acceptanceFixtureIds.source.usEcfr86,
      ),
    ).toBe(true);
    expect(
      nonroadRows.every(
        (row) =>
          row.limit.sourceId === acceptanceFixtureIds.source.usEcfr1039,
      ),
    ).toBe(true);
  });

  it("GBR applies Stage V to construction and keeps road and agriculture explicit no-data", async () => {
    const rows = await repository().findEffectiveByCountry({
      applicationScope: "construction",
      asOf: "2026-08-07",
      countryIso3: "GBR",
      powerKw: 150,
    });
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.citationCode === "GB NRMM Stage V")).toBe(true);
    expect(
      new Map(rows.map((row) => [row.limit.pollutantCode, Number(row.limit.limitValue)])),
    ).toEqual(
      new Map([
        ["CO", 3.5],
        ["HC", 0.19],
        ["NOX", 0.4],
        ["PM", 0.015],
        ["PN", 1000],
      ]),
    );
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
      "agriculture",
    ] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-07",
          countryIso3: "GBR",
          powerKw: 150,
        }),
      ).resolves.toHaveLength(0);
    }
  });

  it("IND applies verified BS VI WHSC and WHTC limits to trucks and buses", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2026-08-07",
        countryIso3: "IND",
        powerKw: 300,
      });
      expect(rows).toHaveLength(12);
      expect(new Set(rows.map((row) => row.regulationId))).toEqual(
        new Set([acceptanceFixtureIds.regulation.indiaBs6]),
      );
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values.get("WHSC:NOX")).toBe(400);
      expect(values.get("WHSC:PM")).toBe(10);
      expect(values.get("WHSC:PN")).toBe(800);
      expect(values.get("WHTC:NOX")).toBe(460);
      expect(values.get("WHTC:PM")).toBe(10);
      expect(values.get("WHTC:PN")).toBe(600);
    }
  });

  it("IND BS VI starts exactly on 2020-04-01", async () => {
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2020-03-31",
        countryIso3: "IND",
        powerKw: 300,
      }),
    ).resolves.toHaveLength(0);
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2020-04-01",
        countryIso3: "IND",
        powerKw: 300,
      }),
    ).resolves.toHaveLength(12);
  });

  it("IND construction switches from CEV-IV to CEV-V on 2024-04-01", async () => {
    const before = await repository().findEffectiveByCountry({
      applicationScope: "construction",
      asOf: "2024-03-31",
      countryIso3: "IND",
      powerKw: 100,
    });
    const after = await repository().findEffectiveByCountry({
      applicationScope: "construction",
      asOf: "2024-04-01",
      countryIso3: "IND",
      powerKw: 100,
    });
    expect(before).toHaveLength(4);
    expect(
      before.every(
        (row) => row.citationCode === "G.S.R. 598(E) CEV Stage IV",
      ),
    ).toBe(true);
    expect(
      Number(
        before.find((row) => row.limit.pollutantCode === "PM")?.limit
          .limitValue,
      ),
    ).toBe(0.025);
    expect(after).toHaveLength(5);
    expect(
      after.every(
        (row) => row.citationCode === "G.S.R. 598(E) CEV Stage V",
      ),
    ).toBe(true);
    expect(
      Number(
        after.find((row) => row.limit.pollutantCode === "PM")?.limit
          .limitValue,
      ),
    ).toBe(0.015);
  });

  it("IND agriculture honors the TREM-IV extension and TREM-V transition", async () => {
    const beforeTremIv = await repository().findEffectiveByCountry({
      applicationScope: "agriculture",
      asOf: "2022-12-31",
      countryIso3: "IND",
      powerKw: 45,
    });
    const tremIv = await repository().findEffectiveByCountry({
      applicationScope: "agriculture",
      asOf: "2023-01-01",
      countryIso3: "IND",
      powerKw: 45,
    });
    const lowPowerBeforeTremV = await repository().findEffectiveByCountry({
      applicationScope: "agriculture",
      asOf: "2026-03-31",
      countryIso3: "IND",
      powerKw: 15,
    });
    const lowPowerTremV = await repository().findEffectiveByCountry({
      applicationScope: "agriculture",
      asOf: "2026-04-01",
      countryIso3: "IND",
      powerKw: 15,
    });
    expect(beforeTremIv).toHaveLength(0);
    expect(tremIv).toHaveLength(3);
    expect(
      tremIv.every(
        (row) =>
          row.citationCode ===
          "G.S.R. 850(E) / G.S.R. 598(E) TREM Stage IV",
      ),
    ).toBe(true);
    expect(lowPowerBeforeTremV).toHaveLength(0);
    expect(lowPowerTremV).toHaveLength(3);
    expect(
      lowPowerTremV.every(
        (row) =>
          row.citationCode ===
          "G.S.R. 141(E) / G.S.R. 598(E) TREM Stage V",
      ),
    ).toBe(true);
  });

  it("IND preserves the 560 kW Stage V boundary and excludes the 2026 draft", async () => {
    const below = await repository().findEffectiveByCountry({
      applicationScope: "construction",
      asOf: "2026-08-07",
      countryIso3: "IND",
      powerKw: 559.999,
    });
    const atBoundary = await repository().findEffectiveByCountry({
      applicationScope: "construction",
      asOf: "2026-08-07",
      countryIso3: "IND",
      powerKw: 560,
    });
    const aboveBoundary = await repository().findEffectiveByCountry({
      applicationScope: "construction",
      asOf: "2026-08-07",
      countryIso3: "IND",
      powerKw: 560.001,
    });
    expect(below).toHaveLength(5);
    expect(
      Number(
        below.find((row) => row.limit.pollutantCode === "NOX")?.limit
          .limitValue,
      ),
    ).toBe(0.4);
    expect(atBoundary).toHaveLength(5);
    expect(
      Number(
        atBoundary.find((row) => row.limit.pollutantCode === "NOX")?.limit
          .limitValue,
      ),
    ).toBe(0.4);
    expect(atBoundary.some((row) => row.limit.pollutantCode === "PN")).toBe(
      true,
    );
    expect(aboveBoundary).toHaveLength(4);
    expect(
      Number(
        aboveBoundary.find((row) => row.limit.pollutantCode === "NOX")?.limit
          .limitValue,
      ),
    ).toBe(3.5);
    expect(
      Number(
        aboveBoundary.find((row) => row.limit.pollutantCode === "PM")?.limit
          .limitValue,
      ),
    ).toBe(0.045);
    expect(aboveBoundary.some((row) => row.limit.pollutantCode === "PN")).toBe(
      false,
    );

    const draft = fixtureRegulations.find(
      (row) => row.id === acceptanceFixtureIds.regulation.indiaTrem2026Draft,
    );
    expect(draft).toMatchObject({
      citationCode: "G.S.R. 151(E) (Draft)",
      effectiveFrom: null,
      proposedOn: "2026-02-27",
      status: "proposed",
    });
    const futureRows = await repository().findEffectiveByCountry({
      applicationScope: "agriculture",
      asOf: "2028-04-01",
      countryIso3: "IND",
      powerKw: 45,
    });
    expect(
      futureRows.some((row) => row.citationCode === "G.S.R. 151(E) (Draft)"),
    ).toBe(false);
  });

  it("RUS applies TR CU 018/2011 class 5 B2 limits to trucks and buses", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2026-08-07",
        countryIso3: "RUS",
        powerKw: 300,
      });
      expect(rows).toHaveLength(11);
      expect(
        rows.every(
          (row) => row.citationCode === "TR CU 018/2011 Class 5",
        ),
      ).toBe(true);
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values.get("ESC/ELR:NOX")).toBe(2);
      expect(values.get("ESC/ELR:PM")).toBe(0.02);
      expect(values.get("ETC:NOX")).toBe(2);
      expect(values.get("ETC:PM")).toBe(0.03);
    }
  });

  it("RUS road fixture uses the conservative all-type class 5 boundary", async () => {
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2018-12-31",
        countryIso3: "RUS",
        powerKw: 300,
      }),
    ).resolves.toHaveLength(0);
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2019-01-01",
        countryIso3: "RUS",
        powerKw: 300,
      }),
    ).resolves.toHaveLength(11);
  });

  it("RUS applies the 2025 J/K and H/I tractor transition dates", async () => {
    const lowBand = await repository().findEffectiveByCountry({
      applicationScope: "agriculture",
      asOf: "2025-01-01",
      countryIso3: "RUS",
      powerKw: 50,
    });
    const highBefore = await repository().findEffectiveByCountry({
      applicationScope: "agriculture",
      asOf: "2025-09-30",
      countryIso3: "RUS",
      powerKw: 100,
    });
    const highAtBoundary = await repository().findEffectiveByCountry({
      applicationScope: "agriculture",
      asOf: "2025-10-01",
      countryIso3: "RUS",
      powerKw: 100,
    });
    expect(lowBand).toHaveLength(3);
    expect(
      Number(
        lowBand.find((row) => row.limit.pollutantCode === "HC+NOx")?.limit
          .limitValue,
      ),
    ).toBe(4.7);
    expect(highBefore).toHaveLength(0);
    expect(highAtBoundary).toHaveLength(3);
    expect(
      Number(
        highAtBoundary.find(
          (row) => row.limit.pollutantCode === "HC+NOx",
        )?.limit.limitValue,
      ),
    ).toBe(4);
  });

  it("RUS preserves strict tractor power endpoints and construction no-data", async () => {
    const powers = [19, 19.001, 37, 75, 130, 560, 560.001] as const;
    const results = await Promise.all(
      powers.map((powerKw) =>
        repository().findEffectiveByCountry({
          applicationScope: "agriculture",
          asOf: "2026-08-07",
          countryIso3: "RUS",
          powerKw,
        }),
      ),
    );
    expect(results.map((rows) => rows.length)).toEqual([0, 3, 3, 3, 3, 3, 0]);
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-08-07",
        countryIso3: "RUS",
        powerKw: 150,
      }),
    ).resolves.toHaveLength(0);
  });

  it("IDN applies KLHK P.20/2017 Euro 4 to road trucks and buses", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      const before = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2022-03-31",
        countryIso3: "IDN",
        powerKw: 300,
      });
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2022-04-01",
        countryIso3: "IDN",
        powerKw: 300,
      });
      expect(before).toHaveLength(0);
      expect(rows).toHaveLength(8);
      expect(
        rows.every(
          (row) =>
            row.citationCode ===
            "P.20/MENLHK/SETJEN/KUM.1/3/2017",
        ),
      ).toBe(true);
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values.get("ESC:NOX")).toBe(3.5);
      expect(values.get("ESC:PM")).toBe(0.02);
      expect(values.get("ETC:NOX")).toBe(3.5);
      expect(values.get("ETC:PM")).toBe(0.03);
    }
  });

  it("IDN keeps non-road scopes explicit no-data", async () => {
    const results = await Promise.all(
      (["construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-07",
          countryIso3: "IDN",
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], []]);
  });

  it("THA applies TIS 3046 Level 6 to heavy road vehicles from 2024-01-01", async () => {
    const before = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2023-12-31",
      countryIso3: "THA",
      powerKw: 150,
    });
    const atStart = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2024-01-01",
      countryIso3: "THA",
      powerKw: 150,
    });
    const [truck, bus, construction, agriculture] = await Promise.all(
      ([
        "on-road-truck",
        "on-road-bus",
        "construction",
        "agriculture",
      ] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "THA",
          powerKw: 150,
        }),
      ),
    );
    expect(before).toEqual([]);
    expect(atStart).toHaveLength(9);
    expect(truck).toHaveLength(9);
    expect(bus).toHaveLength(9);
    expect(construction).toEqual([]);
    expect(agriculture).toEqual([]);

    const values = new Map(
      truck.map((row) => [
        `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
        Number(row.limit.limitValue),
      ]),
    );
    expect(values.get("ESC:NOX")).toBe(2);
    expect(values.get("ELR:OPACITY")).toBe(0.5);
    expect(values.get("ETC:NMHC")).toBe(0.55);
    expect(values.get("ETC:PM")).toBe(0.03);
    expect(
      truck.every(
        (row) =>
          row.regulationId ===
          acceptanceFixtureIds.regulation.thailandHeavyDieselLevel6,
      ),
    ).toBe(true);
    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
          acceptanceFixtureIds.regulation.thailandHeavyDieselLevel6 &&
        row.applicationScope === "on-road-truck",
    );
    expect(fixtureRows).toHaveLength(9);
    expect(
      fixtureRows.every(
        (row) =>
          row.measurementBasis?.includes("reference mass >2,610 kg") === true &&
          row.measurementBasis?.includes("not cumulative") === true,
      ),
    ).toBe(true);

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({ asOf: "2026-08-10", iso3: "THA" });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "TH-TISI",
        membershipSource: {
          url: "https://service.tisi.go.th/fulltext/TIS3046-2563p_5055.pdf",
        },
        source: {
          url: "https://ratchakitcha.soc.go.th/documents/140A040N0000000000500.pdf",
        },
        validFrom: "2024-01-01",
      },
    ]);
  });

  it("VNM switches new heavy-duty road vehicles to QCVN 109 Level 5 on 2022-01-01", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      const before = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2021-12-31",
        countryIso3: "VNM",
        powerKw: 300,
      });
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2022-01-01",
        countryIso3: "VNM",
        powerKw: 300,
      });

      expect(before).toHaveLength(0);
      expect(rows).toHaveLength(9);
      expect(
        rows.every(
          (row) => row.citationCode === "QCVN 109:2021/BGTVT",
        ),
      ).toBe(true);
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values.get("ESC:NOX")).toBe(2);
      expect(values.get("ESC:PM")).toBe(0.02);
      expect(values.get("ETC:NOX")).toBe(2);
      expect(values.get("ETC:PM")).toBe(0.03);
      expect(values.get("ELR:OPACITY")).toBe(0.5);
      expect(values.has("ETC:CH4")).toBe(false);
    }
  });

  it("VNM keeps QCVN 109 outside construction and agriculture", async () => {
    const results = await Promise.all(
      (["construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-07",
          countryIso3: "VNM",
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], []]);
  });

  it("MYS applies the DOE VTA Euro II heavy-duty diesel baseline from 2017", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      const before = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2016-12-31",
        countryIso3: "MYS",
        powerKw: 300,
      });
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2017-01-01",
        countryIso3: "MYS",
        powerKw: 300,
      });

      expect(before).toHaveLength(0);
      expect(rows).toHaveLength(4);
      expect(
        rows.every(
          (row) => row.citationCode === "P.U.(A) 429/96 / VTA Euro II",
        ),
      ).toBe(true);
      const values = new Map(
        rows.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values).toEqual(
        new Map([
          ["CO", 4],
          ["HC", 1.1],
          ["NOX", 7],
          ["PM", 0.15],
        ]),
      );
      expect(
        rows.every(
          (row) => row.limit.testCycleCode === "UN R49-02(B) 13-mode",
        ),
      ).toBe(true);
    }
  });

  it("MYS does not promote tentative Euro IV dates or road limits into non-road scopes", async () => {
    const roadRows = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2026-08-07",
      countryIso3: "MYS",
      powerKw: 300,
    });
    expect(
      roadRows.every(
        (row) => row.citationCode === "P.U.(A) 429/96 / VTA Euro II",
      ),
    ).toBe(true);

    const nonRoadResults = await Promise.all(
      (["construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-07",
          countryIso3: "MYS",
          powerKw: 150,
        }),
      ),
    );
    expect(nonRoadResults).toEqual([[], []]);
  });

  it("ARG applies Resolution 1464/2014 B2 limits to ordinary heavy-duty trucks and buses from 2018", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      const before = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2017-12-31",
        countryIso3: "ARG",
        powerKw: 300,
      });
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2018-01-01",
        countryIso3: "ARG",
        powerKw: 300,
      });

      expect(before).toHaveLength(0);
      expect(rows).toHaveLength(9);
      expect(
        rows.every(
          (row) =>
            row.citationCode ===
            "Resolución 1464/2014 / Directive 2005/55 B2",
        ),
      ).toBe(true);
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values.get("ESC/ELR:CO")).toBe(1.5);
      expect(values.get("ESC/ELR:HC")).toBe(0.46);
      expect(values.get("ESC/ELR:NOX")).toBe(2);
      expect(values.get("ESC/ELR:PM")).toBe(0.02);
      expect(values.get("ESC/ELR:OPACITY")).toBe(0.5);
      expect(values.get("ETC:CO")).toBe(4);
      expect(values.get("ETC:NMHC")).toBe(0.55);
      expect(values.get("ETC:NOX")).toBe(2);
      expect(values.get("ETC:PM")).toBe(0.03);
    }
  });

  it("ARG keeps the military exception and non-road scopes outside ordinary effective results", async () => {
    const nonRoadResults = await Promise.all(
      (["construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-07",
          countryIso3: "ARG",
          powerKw: 150,
        }),
      ),
    );
    expect(nonRoadResults).toEqual([[], []]);

    const militaryException = fixtureSources.find(
      (source) =>
        source.id ===
        acceptanceFixtureIds.source.argentinaResolution128Exception,
    );
    expect(militaryException).toMatchObject({
      publishedOn: "2018-03-26",
      title:
        "Resolución 128/2018: temporary Euro III exception for special Ejército Argentino vehicles",
    });
    expect(
      fixtureRegulations.some(
        (regulation) =>
          regulation.citationCode?.includes("Resolución 128/2018") ?? false,
      ),
    ).toBe(false);

    const countryRepository = createCountryRepository(testDatabase.database);
    const details = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-07",
      iso3: "ARG",
    });
    expect(details?.jurisdictions).toHaveLength(1);
    expect(details?.jurisdictions[0]).toMatchObject({
      code: "AR-SAyDS",
      source: {
        title:
          "Resolución 1464/2014: heavy-duty vehicle emission implementation under Decreto 779/95",
      },
    });
  });

  it("NZL applies the unified Table 2B Euro VI Step C pathway to trucks and buses from 2025-11-01", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      const before = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2025-10-31",
        countryIso3: "NZL",
        powerKw: 300,
      });
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2025-11-01",
        countryIso3: "NZL",
        powerKw: 300,
      });

      expect(before).toHaveLength(0);
      expect(rows).toHaveLength(12);
      expect(
        rows.every(
          (row) =>
            row.citationCode ===
            "Land Transport Rule 33001 Table 2B / Euro VI Step C",
        ),
      ).toBe(true);
      expect(new Set(rows.map((row) => row.limit.testCycleCode))).toEqual(
        new Set(["WHSC", "WHTC"]),
      );
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values.get("WHSC:NOX")).toBe(400);
      expect(values.get("WHSC:PM")).toBe(10);
      expect(values.get("WHSC:PN")).toBe(800);
      expect(values.get("WHTC:NOX")).toBe(460);
      expect(values.get("WHTC:PM")).toBe(10);
      expect(values.get("WHTC:PN")).toBe(600);
      const fixtureRows = buildFixtureLimits().filter(
        (row) =>
          row.regulationId ===
            acceptanceFixtureIds.regulation.newZealandEuroVi &&
          row.applicationScope === applicationScope,
      );
      expect(fixtureRows).toHaveLength(12);
      expect(
        fixtureRows.every(
          (row) =>
            row.measurementBasis?.includes("alternative pathway") === true &&
            row.measurementBasis?.includes("not cumulative") === true &&
            row.measurementBasis?.includes("ADR 80/04") === true &&
            row.measurementBasis?.includes("UNR49/06(Supp.4)") === true,
        ),
      ).toBe(true);
    }
  });

  it("NZL keeps tractors and other non-road scopes outside the road entry rule", async () => {
    const nonRoadResults = await Promise.all(
      (["construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-07",
          countryIso3: "NZL",
          powerKw: 150,
        }),
      ),
    );
    expect(nonRoadResults).toEqual([[], []]);

    const regulation = fixtureRegulations.find(
      (row) => row.id === acceptanceFixtureIds.regulation.newZealandEuroVi,
    );
    expect(regulation?.summary).toContain("2.1(2)(b) 明确排除 tractors");
    expect(regulation?.summary).toContain("各替代标准不是累计要求");

    const countryRepository = createCountryRepository(testDatabase.database);
    const details = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-07",
      iso3: "NZL",
    });
    expect(details?.jurisdictions).toHaveLength(1);
    expect(details?.jurisdictions[0]).toMatchObject({
      code: "NZ-NZTA",
      source: {
        title:
          "Land Transport Rule: Vehicle Exhaust Emissions 2007, Rule 33001 (as at 30 May 2025)",
      },
      validFrom: "2008-01-03",
    });
  });

  it("CHL applies the D.S. 50 Euro VI road pathway from 2026-01-06", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-01-05",
          countryIso3: "CHL",
          powerKw: 300,
        }),
      ).resolves.toHaveLength(0);

      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2026-01-06",
        countryIso3: "CHL",
        powerKw: 300,
      });
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(rows).toHaveLength(12);
      expect(
        rows.every(
          (row) =>
            row.citationCode ===
            "D.S. 55/1994 art. 8 quater / D.S. 50/2023",
        ),
      ).toBe(true);
      expect(values.get("WHSC:NOX")).toBe(400);
      expect(values.get("WHSC:PN")).toBe(800);
      expect(values.get("WHTC:NOX")).toBe(460);
      expect(values.get("WHTC:PN")).toBe(600);

      const fixtureRows = buildFixtureLimits().filter(
        (row) =>
          row.regulationId ===
            acceptanceFixtureIds.regulation.chileHeavyVehicleEuroVi &&
          row.applicationScope === applicationScope,
      );
      expect(fixtureRows).toHaveLength(12);
      expect(
        fixtureRows.every(
          (row) =>
            row.measurementBasis?.includes("alternative pathway") === true &&
            row.measurementBasis?.includes("not cumulative") === true &&
            row.dataSourceId ===
              acceptanceFixtureIds.source.chileHeavyVehicleDecree50,
        ),
      ).toBe(true);
    }
  });

  it("CHL applies D.S. 39 Table 2 to construction from 2023-10-21 with exact power boundaries", async () => {
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2023-10-20",
        countryIso3: "CHL",
        powerKw: 150,
      }),
    ).resolves.toHaveLength(0);

    const query = (powerKw: number) =>
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2023-10-21",
        countryIso3: "CHL",
        powerKw,
      });
    await expect(query(18.999)).resolves.toHaveLength(0);
    await expect(query(19)).resolves.toHaveLength(4);
    await expect(query(37)).resolves.toHaveLength(4);
    await expect(query(56)).resolves.toHaveLength(5);
    await expect(query(75)).resolves.toHaveLength(5);
    await expect(query(130)).resolves.toHaveLength(5);
    await expect(query(560)).resolves.toHaveLength(5);
    await expect(query(560.001)).resolves.toHaveLength(0);

    const rows = await query(150);
    const values = new Map(
      rows.map((row) => [row.limit.pollutantCode, Number(row.limit.limitValue)]),
    );
    expect(values).toEqual(
      new Map([
        ["CO", 3.5],
        ["HC", 0.19],
        ["NOX", 0.4],
        ["PM", 0.015],
        ["PN", 1000],
      ]),
    );
    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
          acceptanceFixtureIds.regulation.chileMobileMachineryStageV &&
        row.applicationScope === "construction",
    );
    expect(fixtureRows).toHaveLength(23);
    expect(
      fixtureRows.every(
        (row) =>
          row.measurementBasis?.includes("alternative") === true &&
          row.measurementBasis?.includes("not cumulative") === true,
      ),
    ).toBe(true);
  });

  it("CHL keeps agriculture out of effective results until the adopted tractor date", async () => {
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2026-08-07",
        countryIso3: "CHL",
        powerKw: 150,
      }),
    ).resolves.toHaveLength(0);

    const tractorRegulation = fixtureRegulations.find(
      (row) => row.id === acceptanceFixtureIds.regulation.chileTractorStageV,
    );
    expect(tractorRegulation).toMatchObject({
      effectiveFrom: "2030-01-01",
      status: "adopted",
    });
    expect(tractorRegulation?.summary).toContain("其他农业机械明确排除");
    const tractorLimits = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
        acceptanceFixtureIds.regulation.chileTractorStageV,
    );
    expect(tractorLimits).toHaveLength(23);
    expect(tractorLimits.every((row) => row.validFrom === "2030-01-01")).toBe(
      true,
    );

    const countryRepository = createCountryRepository(testDatabase.database);
    const details = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-07",
      iso3: "CHL",
    });
    expect(details?.jurisdictions).toHaveLength(1);
    expect(details?.jurisdictions[0]).toMatchObject({
      code: "CL-MMA",
      source: {
        title:
          "Decreto Supremo 50/2023: heavy-duty vehicle emission limits added as D.S. 55/1994 article 8 quater",
      },
      validFrom: "2021-10-21",
    });
  });

  it("COL applies Resolucion 0762 Table 22 to heavy road vehicles from 2023-01-01", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2022-12-31",
          countryIso3: "COL",
          powerKw: 300,
        }),
      ).resolves.toHaveLength(0);

      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2023-01-01",
        countryIso3: "COL",
        powerKw: 300,
      });
      expect(rows).toHaveLength(12);
      expect(
        rows.every(
          (row) =>
            row.citationCode === "Resolucion 0762/2022 art. 18 Table 22",
        ),
      ).toBe(true);
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values.get("WHSC:NOX")).toBe(400);
      expect(values.get("WHSC:PM")).toBe(10);
      expect(values.get("WHSC:PN")).toBe(800);
      expect(values.get("WHTC:NOX")).toBe(460);
      expect(values.get("WHTC:PM")).toBe(10);
      expect(values.get("WHTC:PN")).toBe(600);

      const fixtureRows = buildFixtureLimits().filter(
        (row) =>
          row.regulationId ===
            acceptanceFixtureIds.regulation.colombiaHeavyVehicleEuroVi &&
          row.applicationScope === applicationScope,
      );
      expect(fixtureRows).toHaveLength(12);
      expect(
        fixtureRows.every(
          (row) =>
            row.measurementBasis?.includes("alternative") === true &&
            row.measurementBasis?.includes("not cumulative") === true &&
            row.dataSourceId ===
              acceptanceFixtureIds.source.colombiaResolution762,
        ),
      ).toBe(true);
    }
  });

  it("COL applies Table 23 to construction from 2024-07-18 with exact power and cycle boundaries", async () => {
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2024-07-17",
        countryIso3: "COL",
        powerKw: 150,
      }),
    ).resolves.toHaveLength(0);

    const query = (powerKw: number) =>
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2024-07-18",
        countryIso3: "COL",
        powerKw,
      });
    await expect(query(18.999)).resolves.toHaveLength(0);
    await expect(query(19)).resolves.toHaveLength(3);
    await expect(query(37)).resolves.toHaveLength(3);
    await expect(query(56)).resolves.toHaveLength(4);
    await expect(query(75)).resolves.toHaveLength(4);
    await expect(query(130)).resolves.toHaveLength(4);
    await expect(query(560)).resolves.toHaveLength(4);
    await expect(query(560.001)).resolves.toHaveLength(0);

    const lowBand = await query(19);
    expect(new Set(lowBand.map((row) => row.limit.testCycleCode))).toEqual(
      new Set(["NRSC"]),
    );
    const rows = await query(150);
    expect(new Set(rows.map((row) => row.limit.testCycleCode))).toEqual(
      new Set(["NRSC/NRTC"]),
    );
    expect(
      new Map(
        rows.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      ),
    ).toEqual(
      new Map([
        ["CO", 3.5],
        ["HC", 0.19],
        ["NOX", 2.0],
        ["PM", 0.025],
      ]),
    );

    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
        acceptanceFixtureIds.regulation.colombiaNonRoadTable23,
    );
    expect(fixtureRows).toHaveLength(18);
    expect(
      fixtureRows.every(
        (row) =>
          row.applicationScope === "construction" &&
          row.measurementBasis?.includes("alternative") === true &&
          row.measurementBasis?.includes("not cumulative") === true &&
          row.measurementBasis?.includes("excludes agricultural") === true,
      ),
    ).toBe(true);
  });

  it("COL keeps agriculture excluded and traces all facts to MinAmbiente", async () => {
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2026-08-07",
        countryIso3: "COL",
        powerKw: 150,
      }),
    ).resolves.toHaveLength(0);

    const countryRepository = createCountryRepository(testDatabase.database);
    const details = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-07",
      iso3: "COL",
    });
    expect(details?.jurisdictions).toHaveLength(1);
    expect(details?.jurisdictions[0]).toMatchObject({
      code: "CO-MADS",
      source: {
        title:
          "Resolucion 0762 de 2022: limites de emisiones para fuentes moviles terrestres",
      },
      validFrom: "2022-07-18",
    });
    const nonRoadRegulation = fixtureRegulations.find(
      (row) =>
        row.id === acceptanceFixtureIds.regulation.colombiaNonRoadTable23,
    );
    expect(nonRoadRegulation?.summary).toContain(
      "article 3(c) 明确排除专用于农业作业",
    );
  });

  it("PER applies D.S. 029 Euro VI/A to heavy trucks and buses from 2024-10-01", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2024-09-30",
          countryIso3: "PER",
          powerKw: 300,
        }),
      ).resolves.toHaveLength(0);

      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2024-10-01",
        countryIso3: "PER",
        powerKw: 300,
      });
      expect(rows).toHaveLength(12);
      expect(
        rows.every(
          (row) =>
            row.citationCode ===
            "D.S. 010-2017-MINAM annex I.7 / D.S. 029-2021-MINAM",
        ),
      ).toBe(true);
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values.get("WHSC:NOX")).toBe(400);
      expect(values.get("WHSC:PM")).toBe(10);
      expect(values.get("WHSC:PN")).toBe(800);
      expect(values.get("WHTC:NOX")).toBe(460);
      expect(values.get("WHTC:PM")).toBe(10);
      expect(values.get("WHTC:PN")).toBe(600);

      const fixtureRows = buildFixtureLimits().filter(
        (row) =>
          row.regulationId ===
            acceptanceFixtureIds.regulation.peruHeavyVehicleEuroVi &&
          row.applicationScope === applicationScope,
      );
      expect(fixtureRows).toHaveLength(12);
      expect(
        fixtureRows.every(
          (row) =>
            row.measurementBasis?.includes("alternative") === true &&
            row.measurementBasis?.includes("not cumulative") === true &&
            row.measurementBasis?.includes("EPA 2010") === true &&
            row.dataSourceId === acceptanceFixtureIds.source.peruDecree029,
        ),
      ).toBe(true);
    }
  });

  it("PER keeps construction and agriculture outside the road transport decree", async () => {
    const nonRoadResults = await Promise.all(
      (["construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-08",
          countryIso3: "PER",
          powerKw: 150,
        }),
      ),
    );
    expect(nonRoadResults).toEqual([[], []]);

    const countryRepository = createCountryRepository(testDatabase.database);
    const details = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-08",
      iso3: "PER",
    });
    expect(details?.jurisdictions).toHaveLength(1);
    expect(details?.jurisdictions[0]).toMatchObject({
      code: "PE-MINAM",
      source: {
        title:
          "Decreto Supremo 029-2021-MINAM: modificacion de los limites para vehiculos automotores",
      },
      validFrom: "2021-10-16",
    });
    const regulation = fixtureRegulations.find(
      (row) => row.id === acceptanceFixtureIds.regulation.peruHeavyVehicleEuroVi,
    );
    expect(regulation?.summary).toContain(
      "construction/agriculture 不从道路车辆规则外推",
    );
  });

  it("PHL applies the complete Euro IV heavy-duty R49 path from 2016-01-01", async () => {
    const [before, truck, bus, construction, agriculture] = await Promise.all([
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2015-12-31",
        countryIso3: "PHL",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2016-01-01",
        countryIso3: "PHL",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-bus",
        asOf: "2016-01-01",
        countryIso3: "PHL",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-08-10",
        countryIso3: "PHL",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2026-08-10",
        countryIso3: "PHL",
        powerKw: 150,
      }),
    ]);
    const values = new Map(
      truck.map((row) => [
        `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
        Number(row.limit.limitValue),
      ]),
    );
    expect(before).toEqual([]);
    expect(truck).toHaveLength(9);
    expect(bus).toHaveLength(9);
    expect(construction).toEqual([]);
    expect(agriculture).toEqual([]);
    expect(values.get("ESC:CO")).toBe(1.5);
    expect(values.get("ESC:HC")).toBe(0.46);
    expect(values.get("ESC:NOX")).toBe(3.5);
    expect(values.get("ESC:PM")).toBe(0.02);
    expect(values.get("ELR:OPACITY")).toBe(0.5);
    expect(values.get("ETC:NOX")).toBe(3.5);
    expect(values.get("ETC:PM")).toBe(0.03);
    expect(
      [...truck, ...bus].every(
        (row) =>
          row.regulationId ===
          acceptanceFixtureIds.regulation.philippinesHeavyDieselEuroIv,
      ),
    ).toBe(true);
    expect(
      buildFixtureLimits()
        .filter(
          (row) =>
            row.regulationId ===
            acceptanceFixtureIds.regulation.philippinesHeavyDieselEuroIv,
        )
        .every(
          (row) =>
            row.measurementBasis?.includes("all new vehicles") === true &&
            row.measurementBasis?.includes("not cumulative") === true,
        ),
    ).toBe(true);
    expect(
      truck.find((row) => row.limit.pollutantCode === "OPACITY")?.limit
        .unitCode,
    ).toBe("m-1");

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({ asOf: "2016-01-01", iso3: "PHL" });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "PH-DENR",
        membershipSource: {
          url: "https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/70901",
        },
        source: {
          url: "https://www.boi.gov.ph/wp-content/uploads/2018/03/Implementation-of-DENR-Administrative-Order-on-Euro-4IV-Vehicle-Emission-Limits.pdf",
        },
        validFrom: "2016-01-01",
      },
    ]);
  });

  it("locks the three-source Philippines Euro IV evidence chain", () => {
    const sourceById = new Map(
      fixtureSources.map((source) => [source.id, source]),
    );
    const verifiedAt = new Date("2026-08-10T16:26:05.000Z");
    expect(
      sourceById.get(acceptanceFixtureIds.source.philippinesLtoMc20151946),
    ).toMatchObject({
      publishedOn: "2015-05-28",
      sourceType: "official-regulation",
      url: "https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/70901",
      verifiedAt,
    });
    expect(
      sourceById.get(acceptanceFixtureIds.source.philippinesEuro4LimitsBoI),
    ).toMatchObject({
      publishedOn: null,
      sourceType: "government-notice",
      url: "https://www.boi.gov.ph/wp-content/uploads/2018/03/Implementation-of-DENR-Administrative-Order-on-Euro-4IV-Vehicle-Emission-Limits.pdf",
      verifiedAt,
    });
    expect(
      sourceById.get(acceptanceFixtureIds.source.philippinesUnr49CycleNotice),
    ).toMatchObject({
      publishedOn: "2024-10-04",
      sourceType: "government-notice",
      url: "https://www.negor.gov.ph/supplemental-bid-bulletin-b-354-2024/",
      verifiedAt,
    });
  });

  it("SGP applies the Euro VI heavy-vehicle alternative path from 2018-01-01", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2017-12-31",
          countryIso3: "SGP",
          powerKw: 300,
        }),
      ).resolves.toHaveLength(0);

      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2018-01-01",
        countryIso3: "SGP",
        powerKw: 300,
      });
      expect(rows).toHaveLength(12);
      expect(
        rows.every(
          (row) =>
            row.citationCode ===
            "S 480/2017 / EPMA Vehicular Emissions Regulations Second Schedule",
        ),
      ).toBe(true);
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values.get("WHSC:NOX")).toBe(400);
      expect(values.get("WHSC:PN")).toBe(800);
      expect(values.get("WHTC:NOX")).toBe(460);
      expect(values.get("WHTC:PN")).toBe(600);

      const fixtureRows = buildFixtureLimits().filter(
        (row) =>
          row.regulationId ===
            acceptanceFixtureIds.regulation.singaporeHeavyVehicleEuroVi &&
          row.applicationScope === applicationScope,
      );
      expect(fixtureRows).toHaveLength(12);
      expect(
        fixtureRows.every(
          (row) =>
            row.dataSourceId ===
              acceptanceFixtureIds.source.singaporeVehicularAmendment2017 &&
            row.measurementBasis?.includes("alternative") === true &&
            row.measurementBasis?.includes("not cumulative") === true,
        ),
      ).toBe(true);
    }
  });

  it("SGP applies Stage II to construction power bands and keeps agriculture no-data", async () => {
    const queries = await Promise.all(
      [17.999, 18, 37, 75, 130, 559.999, 560].map((powerKw) =>
        repository().findEffectiveByCountry({
          applicationScope: "construction",
          asOf: "2026-08-08",
          countryIso3: "SGP",
          powerKw,
        }),
      ),
    );
    expect(queries.map((rows) => rows.length)).toEqual([0, 4, 4, 4, 4, 4, 0]);
    expect(
      queries.slice(1, 6).map((rows) =>
        Number(
          rows.find((row) => row.limit.pollutantCode === "NOX")?.limit
            .limitValue,
        ),
      ),
    ).toEqual([8, 7, 6, 6, 6]);
    expect(
      queries.slice(1, 6).every((rows) =>
        rows.every((row) => row.limit.testCycleCode === "ISO 8178"),
      ),
    ).toBe(true);
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2026-08-08",
        countryIso3: "SGP",
        powerKw: 150,
      }),
    ).resolves.toHaveLength(0);

    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
        acceptanceFixtureIds.regulation.singaporeOffRoadStageIi,
    );
    expect(fixtureRows).toHaveLength(16);
    expect(
      fixtureRows.every(
        (row) =>
          row.applicationScope === "construction" &&
          row.dataSourceId === acceptanceFixtureIds.source.singaporeOffRoad2012 &&
          row.measurementBasis?.includes("alternative") === true &&
          row.measurementBasis?.includes("not cumulative") === true,
      ),
    ).toBe(true);

    const countryRepository = createCountryRepository(testDatabase.database);
    const details = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-08",
      iso3: "SGP",
    });
    expect(details?.jurisdictions).toHaveLength(1);
    expect(details?.jurisdictions[0]).toMatchObject({
      code: "SG-NEA",
      source: {
        title: "Air Pollution Regulations",
        url: "https://www.nea.gov.sg/our-services/pollution-control/air-pollution/air-pollution-regulations",
      },
      validFrom: "2012-07-01",
    });
  });

  it("NOR applies the current Bilforskriften Euro VI path only within its modeled validity window", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2022-09-30",
          countryIso3: "NOR",
          powerKw: 300,
        }),
      ).resolves.toHaveLength(0);

      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2022-10-01",
        countryIso3: "NOR",
        powerKw: 300,
      });
      expect(rows).toHaveLength(12);
      expect(
        rows.every(
          (row) =>
            row.citationCode ===
            "FOR-2022-06-28-1233 § 1-4 / Vedlegg 1 G3",
        ),
      ).toBe(true);
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values.get("WHSC:NOX")).toBe(400);
      expect(values.get("WHSC:PN")).toBe(800);
      expect(values.get("WHTC:NOX")).toBe(460);
      expect(values.get("WHTC:PN")).toBe(600);
      expect(
        new Set(rows.map((row) => row.limit.dataSourceId)),
      ).toEqual(new Set([acceptanceFixtureIds.source.euReg595]));
      expect(
        new Set(rows.map((row) => row.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-08T03:00:00.000Z"]));
    }

    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2029-05-28",
        countryIso3: "NOR",
        powerKw: 300,
      }),
    ).resolves.toHaveLength(12);
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2029-05-29",
        countryIso3: "NOR",
        powerKw: 300,
      }),
    ).resolves.toHaveLength(0);
  });

  it("NOR applies incorporated Stage V limits to construction and agriculture across the power boundary", async () => {
    for (const applicationScope of [
      "construction",
      "agriculture",
    ] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2020-06-30",
          countryIso3: "NOR",
          powerKw: 150,
        }),
      ).resolves.toHaveLength(0);

      const results = await Promise.all(
        [150, 560, 560.001].map((powerKw) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf: "2020-07-01",
            countryIso3: "NOR",
            powerKw,
          }),
        ),
      );
      expect(results.map((rows) => rows.length)).toEqual([5, 5, 4]);
      const lowerBand = new Map(
        results[0]?.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      expect(lowerBand.get("NOX")).toBe(0.4);
      expect(lowerBand.get("PM")).toBe(0.015);
      expect(lowerBand.get("PN")).toBe(1000);
      const upperBand = new Map(
        results[2]?.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      expect(upperBand.get("NOX")).toBe(3.5);
      expect(upperBand.get("PM")).toBe(0.045);
      expect(upperBand.has("PN")).toBe(false);
      expect(
        results.flat().every(
          (row) =>
            row.limit.dataSourceId ===
            acceptanceFixtureIds.source.euReg1628,
        ),
      ).toBe(true);
    }

    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId === acceptanceFixtureIds.regulation.norwayNrmmStageV,
    );
    expect(fixtureRows).not.toHaveLength(0);
    expect(
      fixtureRows.every(
        (row) =>
          row.measurementBasis?.includes("Norway") === true &&
          row.measurementBasis?.includes("traced to") === true,
      ),
    ).toBe(true);

    const countryRepository = createCountryRepository(testDatabase.database);
    const details = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-08",
      iso3: "NOR",
    });
    expect(details?.jurisdictions).toHaveLength(1);
    expect(details?.jurisdictions[0]).toMatchObject({
      code: "NO-NATIONAL",
      source: {
        title:
          "Forskrift om godkjenning av bil og tilhenger til bil (bilforskriften), FOR-2022-06-28-1233",
        url: "https://lovdata.no/dokument/SF/forskrift/2022-06-28-1233",
      },
      validFrom: "2020-07-01",
    });
    expect(
      fixtureSources.find(
        (row) =>
          row.id === acceptanceFixtureIds.source.norwayMachineryRegulation,
      ),
    ).toMatchObject({
      sourceType: "official-regulation",
      url: "https://lovdata.no/dokument/SF/forskrift/2009-05-20-544/kapittel_17",
    });
  });

  it("ISL applies the nationally incorporated Euro VI path within the Euro 7 transition window", async () => {
    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2013-04-14",
          countryIso3: "ISL",
          powerKw: 300,
        }),
      ).resolves.toHaveLength(0);

      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2013-04-15",
        countryIso3: "ISL",
        powerKw: 300,
      });
      expect(rows).toHaveLength(12);
      expect(
        rows.every(
          (row) =>
            row.citationCode ===
            "Reglugerð 377/2013 art. 12 and Annex IV items 45zzk/45zzl",
        ),
      ).toBe(true);
      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values.get("WHSC:NOX")).toBe(400);
      expect(values.get("WHSC:PN")).toBe(800);
      expect(values.get("WHTC:NOX")).toBe(460);
      expect(values.get("WHTC:PN")).toBe(600);
      expect(
        new Set(rows.map((row) => row.limit.dataSourceId)),
      ).toEqual(new Set([acceptanceFixtureIds.source.euReg595]));
      expect(
        new Set(rows.map((row) => row.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-08T03:55:43.000Z"]));
    }

    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2027-11-28",
        countryIso3: "ISL",
        powerKw: 300,
      }),
    ).resolves.toHaveLength(12);
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2027-11-29",
        countryIso3: "ISL",
        powerKw: 300,
      }),
    ).resolves.toHaveLength(0);
  });

  it("ISL keeps the Stage V succession gap-free for construction and agriculture", async () => {
    for (const applicationScope of [
      "construction",
      "agriculture",
    ] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2020-11-30",
          countryIso3: "ISL",
          powerKw: 150,
        }),
      ).resolves.toHaveLength(0);

      const succession = await Promise.all(
        ["2020-12-01", "2021-02-22", "2021-02-23"].map((asOf) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf,
            countryIso3: "ISL",
            powerKw: 150,
          }),
        ),
      );
      expect(succession.map((rows) => rows.length)).toEqual([5, 5, 5]);
      expect(new Set(succession[0]?.map((row) => row.regulationId))).toEqual(
        new Set([acceptanceFixtureIds.regulation.icelandNrmmStageV2020]),
      );
      expect(new Set(succession[2]?.map((row) => row.regulationId))).toEqual(
        new Set([acceptanceFixtureIds.regulation.icelandNrmmStageV2021]),
      );

      const powerResults = await Promise.all(
        [150, 560, 560.001].map((powerKw) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf: "2026-08-08",
            countryIso3: "ISL",
            powerKw,
          }),
        ),
      );
      expect(powerResults.map((rows) => rows.length)).toEqual([5, 5, 4]);
      const lowerBand = new Map(
        powerResults[0]?.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      expect(lowerBand.get("NOX")).toBe(0.4);
      expect(lowerBand.get("PM")).toBe(0.015);
      expect(lowerBand.get("PN")).toBe(1000);
      const upperBand = new Map(
        powerResults[2]?.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      expect(upperBand.get("NOX")).toBe(3.5);
      expect(upperBand.get("PM")).toBe(0.045);
      expect(upperBand.has("PN")).toBe(false);
      expect(
        powerResults.flat().every(
          (row) =>
            row.limit.dataSourceId ===
            acceptanceFixtureIds.source.euReg1628,
        ),
      ).toBe(true);
    }

    const fixtureRows = buildFixtureLimits().filter((row) =>
      [
        acceptanceFixtureIds.regulation.icelandHeavyVehicleEuroVi,
        acceptanceFixtureIds.regulation.icelandNrmmStageV2020,
        acceptanceFixtureIds.regulation.icelandNrmmStageV2021,
      ].includes(row.regulationId),
    );
    expect(fixtureRows).not.toHaveLength(0);
    expect(
      fixtureRows.every(
        (row) =>
          row.measurementBasis?.includes("Iceland") === true &&
          row.measurementBasis?.includes("traced to") === true,
      ),
    ).toBe(true);

    const countryRepository = createCountryRepository(testDatabase.database);
    const details = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-08",
      iso3: "ISL",
    });
    expect(details?.jurisdictions).toHaveLength(1);
    expect(details?.jurisdictions[0]).toMatchObject({
      code: "IS-NATIONAL",
      source: {
        title:
          "Reglugerð nr. 377/2013 um breytingu á reglugerð nr. 822/2004 um gerð og búnað ökutækja",
        url: "https://www.reglugerd.is/reglugerdir/allar/nr/377-2013",
      },
      validFrom: "2013-04-15",
    });
    expect(
      fixtureSources.find(
        (row) =>
          row.id === acceptanceFixtureIds.source.icelandRoadAmendment2026,
      ),
    ).toMatchObject({
      publishedOn: "2026-05-29",
      sourceType: "official-regulation",
      url: "https://www.reglugerd.is/reglugerdir/allar/nr/0603-2026",
    });
    expect(
      fixtureSources.find(
        (row) =>
          row.id === acceptanceFixtureIds.source.icelandNrmmRegulation2021,
      ),
    ).toMatchObject({
      publishedOn: "2021-02-22",
      sourceType: "official-regulation",
      url: "https://www.reglugerd.is/reglugerdir/allar/nr/179-2021",
    });
  });

  it("LIE keeps current VTS road evidence separate from EWR Stage V evidence", async () => {
    for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-06-30",
          countryIso3: "LIE",
          powerKw: 300,
        }),
      ).resolves.toHaveLength(0);
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2026-07-01",
        countryIso3: "LIE",
        powerKw: 300,
      });
      expect(rows).toHaveLength(12);
      expect(new Set(rows.map((row) => row.regulationId))).toEqual(
        new Set([acceptanceFixtureIds.regulation.liechtensteinHeavyVehicleEuroVi]),
      );
    }
    for (const applicationScope of ["construction", "agriculture"] as const) {
      const before = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2020-07-31",
        countryIso3: "LIE",
        powerKw: 150,
      });
      const after = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2020-08-01",
        countryIso3: "LIE",
        powerKw: 150,
      });
      expect(before).toHaveLength(0);
      expect(after).toHaveLength(5);
      expect(new Set(after.map((row) => row.regulationId))).toEqual(
        new Set([acceptanceFixtureIds.regulation.liechtensteinNrmmStageV]),
      );
    }
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({
      asOf: "2026-08-08",
      iso3: "LIE",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "LI-NATIONAL",
        validFrom: "2020-08-01",
        source: { url: "https://www.gesetze.li/konso/1996143000" },
      },
    ]);
  });

  it("CHE keeps current VTS road and non-road evidence traceable", async () => {
    const road = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2026-07-01",
      countryIso3: "CHE",
      powerKw: 300,
    });
    const nonRoad = await repository().findEffectiveByCountry({
      applicationScope: "construction",
      asOf: "2026-07-01",
      countryIso3: "CHE",
      powerKw: 150,
    });
    expect(road).toHaveLength(12);
    expect(nonRoad).toHaveLength(5);
    expect(new Set(road.map((row) => row.regulationId))).toEqual(
      new Set([acceptanceFixtureIds.regulation.switzerlandHeavyVehicleEuroVi]),
    );
    expect(new Set(nonRoad.map((row) => row.regulationId))).toEqual(
      new Set([acceptanceFixtureIds.regulation.switzerlandNrmmStageV]),
    );
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({
      asOf: "2026-08-08",
      iso3: "CHE",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "CH-NATIONAL",
        validFrom: "2026-07-01",
        source: { url: "https://www.fedlex.admin.ch/eli/cc/1995/4425_4425_4425/de" },
      },
    ]);
  });

  it("SRB preserves no-data because R49/06 lacks a binding full-coverage implementation date", async () => {
    const results = await Promise.all(
      ([
        "on-road-truck",
        "on-road-bus",
        "construction",
        "agriculture",
      ] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "SRB",
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3: "SRB",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "RS-NATIONAL",
        membershipSource: {
          url: "https://www.mgsi.gov.rs/sites/default/files/pravilnik_o_podeli_motornih_i_prikljucnih_vozila_i_tehnickim_uslovima_za_vozila_u_saobracaju_na_putevima.pdf",
        },
        validFrom: "2026-08-10",
        source: {
          url: "https://www.mgsi.gov.rs/sites/default/files/pravilnik_o_homologaciji_0.pdf",
        },
      },
    ]);
    expect(
      fixtureRegulations.some(
        (regulation) =>
          regulation.jurisdictionId === acceptanceFixtureIds.jurisdiction.serbia,
      ),
    ).toBe(false);
  });

  it("BIH applies UN R49/06 to heavy road vehicles from 2019-06-01", async () => {
    const before = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2019-05-31",
      countryIso3: "BIH",
      powerKw: 150,
    });
    const atStart = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2019-06-01",
      countryIso3: "BIH",
      powerKw: 150,
    });
    const [truck, bus, construction, agriculture] = await Promise.all(
      ([
        "on-road-truck",
        "on-road-bus",
        "construction",
        "agriculture",
      ] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "BIH",
          powerKw: 150,
        }),
      ),
    );
    expect(before).toEqual([]);
    expect(atStart).toHaveLength(12);
    expect(truck).toHaveLength(12);
    expect(bus).toHaveLength(12);
    expect(construction).toEqual([]);
    expect(agriculture).toEqual([]);
    const values = new Map(
      truck.map((row) => [
        `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
        Number(row.limit.limitValue),
      ]),
    );
    expect(values.get("WHSC:NOX")).toBe(400);
    expect(values.get("WHSC:PN")).toBe(800);
    expect(values.get("WHTC:NOX")).toBe(460);
    expect(values.get("WHTC:PN")).toBe(600);
    expect(
      truck.every(
        (row) =>
          row.regulationId ===
          acceptanceFixtureIds.regulation.bosniaR49Series06,
      ),
    ).toBe(true);
    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId === acceptanceFixtureIds.regulation.bosniaR49Series06 &&
        row.applicationScope === "on-road-truck",
    );
    expect(fixtureRows).toHaveLength(12);
    expect(
      fixtureRows.every(
        (row) =>
          row.measurementBasis?.includes("reference mass >2,610 kg") === true,
      ),
    ).toBe(true);
    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3: "BIH",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "BA-NATIONAL",
        membershipSource: {
          url: "https://homologacija.gov.ba/Documents/Naredbe%20o%20homologaciji.pdf",
        },
        validFrom: "2019-06-01",
        source: {
          url: "https://homologacija.gov.ba/Documents/Odluka%20o%20najnizim...%20Sl%20Gl%20BiH%20BR%20023_19.pdf",
        },
      },
    ]);
    expect(
      fixtureRegulations.some(
        (regulation) =>
          regulation.id === acceptanceFixtureIds.regulation.bosniaR49Series06,
      ),
    ).toBe(true);
  });

  it("MKD preserves no-data because incorporated stage references lack complete tables and cycle mapping", async () => {
    const results = await Promise.all(
      ([
        "on-road-truck",
        "on-road-bus",
        "construction",
        "agriculture",
      ] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "MKD",
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3: "MKD",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "MK-NATIONAL",
        membershipSource: {
          url: "https://slvesnik.com.mk/Issues/93BA570BCB131F4B93814D076C9003A0.pdf",
        },
        validFrom: "2026-08-10",
        source: {
          url: "https://slvesnik.com.mk/Issues/BC95C8FDB2BB1C41969F17BE58E7F316.pdf",
        },
      },
    ]);
    expect(
      fixtureRegulations.some(
        (regulation) =>
          regulation.jurisdictionId ===
          acceptanceFixtureIds.jurisdiction.northMacedonia,
      ),
    ).toBe(false);
  });

  it("MNE applies Euro VI / UN R49.06 to new road vehicles from 2018-10-15", async () => {
    const before = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2018-10-14",
      countryIso3: "MNE",
      powerKw: 150,
    });
    const atStart = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2018-10-15",
      countryIso3: "MNE",
      powerKw: 15.001,
    });
    const atExcludedPower = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2026-08-10",
      countryIso3: "MNE",
      powerKw: 15,
    });
    const atIncludedPower = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2026-08-10",
      countryIso3: "MNE",
      powerKw: 15.001,
    });
    const [truck, bus, construction, agriculture] = await Promise.all(
      ([
        "on-road-truck",
        "on-road-bus",
        "construction",
        "agriculture",
      ] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "MNE",
          powerKw: 150,
        }),
      ),
    );
    expect(before).toEqual([]);
    expect(atStart).toHaveLength(16);
    expect(atExcludedPower).toEqual([]);
    expect(atIncludedPower).toHaveLength(16);
    expect(truck).toHaveLength(16);
    expect(bus).toHaveLength(16);
    expect(construction).toEqual([]);
    expect(agriculture).toEqual([]);
    const values = new Map(
      truck.map((row) => [
        `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
        Number(row.limit.limitValue),
      ]),
    );
    expect(values.get("WHSC:NOX")).toBe(400);
    expect(values.get("WHSC:PN")).toBe(800);
    expect(values.get("WHTC:NOX")).toBe(460);
    expect(values.get("WHTC:PN")).toBe(600);
    expect(values.get("WNTE:NOX")).toBe(600);
    expect(values.get("WNTE:PM")).toBe(16);
    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId === acceptanceFixtureIds.regulation.montenegroEuroVi &&
        row.applicationScope === "on-road-truck",
    );
    expect(fixtureRows).toHaveLength(16);
    expect(
      fixtureRows.every(
        (row) =>
          row.powerMinKw === 15.001 &&
          row.measurementBasis?.includes("not cumulative") === true,
      ),
    ).toBe(true);
    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3: "MNE",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "ME-NATIONAL",
        membershipSource: {
          url: "https://www.gov.me/clanak/191855--izmjene-i-dopune-pravilnika-o-tehnickim-zahtjevima-za-vozila-koja-se-uvoze-ili-prvi-put-stavljaju-na-trziste-u-crnoj-gori",
        },
        validFrom: "2018-10-15",
        source: {
          url: "https://www.gov.me/dokumenta/d11477e6-31d9-41c5-b787-ffbcda492f2a",
        },
      },
    ]);
    expect(
      fixtureRegulations.some(
        (regulation) =>
          regulation.id === acceptanceFixtureIds.regulation.montenegroEuroVi,
      ),
    ).toBe(true);
  });

  it("ALB keeps non-binding Gothenburg annex tables out of effective regulations", async () => {
    const results = await Promise.all(
      ([
        "on-road-truck",
        "on-road-bus",
        "construction",
        "agriculture",
      ] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "ALB",
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3: "ALB",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "AL-NATIONAL",
        membershipSource: {
          url: "https://treaties.un.org/Pages/ViewDetails.aspx?src=TREATY&mtdsg_no=XXVII-1-h&chapter=27&clang=_en",
        },
        validFrom: "2026-08-10",
        source: {
          url: "https://qbz.gov.al/alfresco/webdav/FZ/2011/155/fz-2011-155.pdf",
        },
      },
    ]);
    expect(
      fixtureRegulations.some(
        (regulation) =>
          regulation.jurisdictionId ===
          acceptanceFixtureIds.jurisdiction.albania,
      ),
    ).toBe(false);
  });

  it("THA/SRB/BIH/ALB lock exact primary-source metadata and verification time", () => {
    const sourceById = new Map(
      fixtureSources.map((source) => [source.id, source]),
    );
    const verifiedAt = new Date("2026-08-10T13:09:56.000Z");
    const expectedSources = [
      [
        acceptanceFixtureIds.source.thailandTis3046,
        {
          publishedOn: "2020-08-18",
          publisher: "Thai Industrial Standards Institute, Ministry of Industry",
          sourceType: "official-regulation",
          url: "https://service.tisi.go.th/fulltext/TIS3046-2563p_5055.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.thailandMinisterialRegulation,
        {
          publishedOn: "2023-07-03",
          publisher: "Ministry of Industry / Royal Thai Government Gazette",
          sourceType: "official-regulation",
          url: "https://ratchakitcha.soc.go.th/documents/140A040N0000000000500.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.serbiaHomologationRulebook,
        {
          publishedOn: "2021-12-28",
          publisher:
            "Ministry of Construction, Transport and Infrastructure of the Republic of Serbia",
          sourceType: "official-regulation",
          url: "https://www.mgsi.gov.rs/sites/default/files/pravilnik_o_homologaciji_0.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.serbiaTechnicalConditions,
        {
          publishedOn: null,
          publisher:
            "Ministry of Construction, Transport and Infrastructure of the Republic of Serbia",
          sourceType: "official-regulation",
          url: "https://www.mgsi.gov.rs/sites/default/files/pravilnik_o_podeli_motornih_i_prikljucnih_vozila_i_tehnickim_uslovima_za_vozila_u_saobracaju_na_putevima.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.bosniaMinimumRequirements,
        {
          publishedOn: "2019-03-26",
          publisher:
            "Ministry of Communications and Transport of Bosnia and Herzegovina",
          sourceType: "official-regulation",
          title:
            "Odluka o najnižim tehničkim zahtjevima za novoproizvedena i korištena vozila pri homologaciji tipa vozila i homologaciji pojedinačnog vozila, te za dijelove, uređaje i opremu vozila pri homologaciji tipa",
          url: "https://homologacija.gov.ba/Documents/Odluka%20o%20najnizim...%20Sl%20Gl%20BiH%20BR%20023_19.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.bosniaR49Orders,
        {
          publishedOn: "2010-10-28",
          publisher:
            "Ministry of Communications and Transport of Bosnia and Herzegovina",
          sourceType: "official-regulation",
          url: "https://homologacija.gov.ba/Documents/Naredbe%20o%20homologaciji.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.uneceR49Rev6,
        {
          publishedOn: "2013-06-24",
          publisher:
            "United Nations Economic Commission for Europe / EUR-Lex",
          sourceType: "official-regulation",
          url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:42013X0624(01)",
        },
      ],
      [
        acceptanceFixtureIds.source.albaniaGothenburgAccession,
        {
          publishedOn: "2011-11-25",
          publisher:
            "Assembly of the Republic of Albania / Official Publications Centre",
          sourceType: "official-regulation",
          url: "https://qbz.gov.al/alfresco/webdav/FZ/2011/155/fz-2011-155.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.albaniaTreatyStatus,
        {
          publishedOn: null,
          publisher: "United Nations Treaty Collection",
          sourceType: "government-notice",
          url: "https://treaties.un.org/Pages/ViewDetails.aspx?src=TREATY&mtdsg_no=XXVII-1-h&chapter=27&clang=_en",
        },
      ],
    ] as const;

    for (const [sourceId, expected] of expectedSources) {
      expect(sourceById.get(sourceId)).toMatchObject({
        ...expected,
        verifiedAt,
      });
    }
  });

  it("MKD/MNE lock exact primary-source metadata and verification time", () => {
    const sourceById = new Map(
      fixtureSources.map((source) => [source.id, source]),
    );
    const verifiedAt = new Date("2026-08-10T13:17:36.000Z");
    const expectedSources = [
      [
        acceptanceFixtureIds.source.northMacedoniaRoadApproval,
        {
          publishedOn: "2009-11-02",
          publisher:
            "Ministry of Economy / Official Gazette of the Republic of Macedonia",
          sourceType: "official-regulation",
          url: "https://slvesnik.com.mk/Issues/BC95C8FDB2BB1C41969F17BE58E7F316.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.northMacedoniaTractorApproval,
        {
          publishedOn: "2009-11-06",
          publisher:
            "Ministry of Economy / Official Gazette of the Republic of Macedonia",
          sourceType: "official-regulation",
          url: "https://slvesnik.com.mk/Issues/93BA570BCB131F4B93814D076C9003A0.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.montenegroVehicleRequirements,
        {
          publishedOn: "2015-01-30",
          publisher: "Ministry of Transport / Government of Montenegro",
          sourceType: "official-regulation",
          url: "https://www.gov.me/dokumenta/d11477e6-31d9-41c5-b787-ffbcda492f2a",
        },
      ],
      [
        acceptanceFixtureIds.source.montenegroUneceR49,
        {
          publishedOn: "2013-03-04",
          publisher: "United Nations Economic Commission for Europe",
          sourceType: "official-regulation",
          url: "https://documents.un.org/api/symbol/access?l=en&s=E%2FECE%2F324%2FREV.1%2FADD.48%2FREV.6&t=pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.montenegroEuro6Implementation,
        {
          publishedOn: "2018-09-24",
          publisher: "Government of Montenegro / Ministry of Transport",
          sourceType: "government-notice",
          url: "https://www.gov.me/clanak/191855--izmjene-i-dopune-pravilnika-o-tehnickim-zahtjevima-za-vozila-koja-se-uvoze-ili-prvi-put-stavljaju-na-trziste-u-crnoj-gori",
        },
      ],
    ] as const;

    for (const [sourceId, expected] of expectedSources) {
      expect(sourceById.get(sourceId)).toMatchObject({
        ...expected,
        verifiedAt,
      });
    }
  });

  it("UKR applies Euro V B2 to road vehicles and fails closed at the 2027 Euro VI switch", async () => {
    const before = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2015-12-31",
      countryIso3: "UKR",
      powerKw: 150,
    });
    const atStart = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2016-01-01",
      countryIso3: "UKR",
      powerKw: 150,
    });
    const [truck, bus, construction, agriculture] = await Promise.all(
      ([
        "on-road-truck",
        "on-road-bus",
        "construction",
        "agriculture",
      ] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "UKR",
          powerKw: 150,
        }),
      ),
    );
    const afterEuroV = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2027-01-01",
      countryIso3: "UKR",
      powerKw: 150,
    });
    const finalEuroVDay = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2026-12-31",
      countryIso3: "UKR",
      powerKw: 150,
    });

    expect(before).toEqual([]);
    expect(atStart).toHaveLength(9);
    expect(truck).toHaveLength(9);
    expect(bus).toHaveLength(9);
    expect(construction).toEqual([]);
    expect(agriculture).toEqual([]);
    expect(finalEuroVDay).toHaveLength(9);
    expect(afterEuroV).toEqual([]);
    expect(
      truck.every(
        (row) =>
          row.regulationId === acceptanceFixtureIds.regulation.ukraineRoadEuroV,
      ),
    ).toBe(true);
    expect(
      Number(
        truck.find(
          (row) =>
            row.limit.testCycleCode === "ESC/ELR" &&
            row.limit.pollutantCode === "NOX",
        )?.limit.limitValue,
      ),
    ).toBe(2);
    expect(
      Number(
        truck.find(
          (row) =>
            row.limit.testCycleCode === "ETC" &&
            row.limit.pollutantCode === "PM",
        )?.limit.limitValue,
      ),
    ).toBe(0.03);

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3: "UKR",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "UA-NATIONAL",
        validFrom: "2016-01-01",
        source: {
          url: "https://zakon.rada.gov.ua/laws/show/z1586-12#Text",
        },
      },
    ]);

    const verifiedAt = new Date("2026-08-10T12:59:02.000Z");
    expect(
      fixtureSources.find(
        (source) =>
          source.id === acceptanceFixtureIds.source.ukraineImportRegistrationLaw,
      ),
    ).toMatchObject({
      publishedOn: "2005-07-06",
      publisher: "Verkhovna Rada of Ukraine / Legislation of Ukraine",
      sourceType: "official-regulation",
      url: "https://zakon.rada.gov.ua/laws/show/2739-15#Text",
      verifiedAt,
    });
    expect(
      fixtureSources.find(
        (source) =>
          source.id === acceptanceFixtureIds.source.ukraineTypeApprovalOrder,
      ),
    ).toMatchObject({
      publishedOn: "2012-08-17",
      sourceType: "official-regulation",
      url: "https://zakon.rada.gov.ua/laws/show/z1586-12#Text",
      verifiedAt,
    });
  });

  it("MDA preserves no-data while its first unified type-approval system remains draft", async () => {
    const results = await Promise.all(
      ([
        "on-road-truck",
        "on-road-bus",
        "construction",
        "agriculture",
      ] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "MDA",
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3: "MDA",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "MD-NATIONAL",
        validFrom: "2026-08-10",
        source: {
          url: "https://gov.md/en/comunicate-de-presa/more-road-safety-government-sets-clearer-rules-market-surveillance-motor",
        },
      },
    ]);
    expect(
      fixtureRegulations.some(
        (regulation) =>
          regulation.jurisdictionId === acceptanceFixtureIds.jurisdiction.moldova,
      ),
    ).toBe(false);

    const verifiedAt = new Date("2026-08-10T13:04:28.000Z");
    expect(
      fixtureSources.find(
        (source) =>
          source.id === acceptanceFixtureIds.source.moldovaTypeApprovalDraftLaw,
      ),
    ).toMatchObject({
      publishedOn: "2026-07-01",
      publisher: "Government of the Republic of Moldova",
      sourceType: "government-notice",
      verifiedAt,
    });
    expect(
      fixtureSources.find(
        (source) =>
          source.id ===
          acceptanceFixtureIds.source.moldovaTypeApprovalSecondaryConsultation,
      ),
    ).toMatchObject({
      publishedOn: "2026-07-17",
      sourceType: "government-notice",
      url: "https://particip.gov.md/ro/document/stages/proiectul-hotararii-guvernului-cu-privire-la-modificarea-unor-hotarari-ale-guvernului-si-aprobarea-r/17988",
      verifiedAt,
    });
  });

  it("NPL applies Standard 2082 to >3,500 kg CI road vehicles from 2025-06-23", async () => {
    const before = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2025-06-22",
      countryIso3: "NPL",
      powerKw: 150,
    });
    const atStart = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2025-06-23",
      countryIso3: "NPL",
      powerKw: 150,
    });
    const [truck, bus, construction, agriculture] = await Promise.all(
      ([
        "on-road-truck",
        "on-road-bus",
        "construction",
        "agriculture",
      ] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "NPL",
          powerKw: 150,
        }),
      ),
    );
    expect(before).toEqual([]);
    expect(atStart).toHaveLength(16);
    expect(truck).toHaveLength(16);
    expect(bus).toHaveLength(16);
    expect(construction).toEqual([]);
    expect(agriculture).toEqual([]);
    const values = new Map(
      truck.map((row) => [
        `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
        Number(row.limit.limitValue),
      ]),
    );
    expect(values.get("WHSC:NOX")).toBe(400);
    expect(values.get("WHSC:PN")).toBe(800);
    expect(values.get("WHTC:NOX")).toBe(460);
    expect(values.get("WHTC:PN")).toBe(600);
    expect(values.get("WNTE:NOX")).toBe(600);
    expect(values.get("WNTE:PM")).toBe(16);
    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId === acceptanceFixtureIds.regulation.nepalHeavyVehicle2082 &&
        row.applicationScope === "on-road-truck",
    );
    expect(fixtureRows).toHaveLength(16);
    expect(
      fixtureRows.every(
        (row) =>
          row.powerMinKw === undefined &&
          row.powerMaxKw === undefined &&
          row.measurementBasis?.includes("gross vehicle weight >3,500 kg") ===
            true &&
          row.measurementBasis?.includes("grandfathering") === true,
      ),
    ).toBe(true);
    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3: "NPL",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "NP-NATIONAL",
        validFrom: "2025-06-23",
        source: {
          url: "https://dop.gov.np/content/12562/nepal-vehicle-pollution-criteria--2082--no--14-/",
        },
        membershipSource: {
          url: "https://doenv.gov.np/content/71/nepal-vehicle-pollution-standards--2082/",
        },
      },
    ]);
    expect(
      fixtureRegulations.some(
        (regulation) =>
          regulation.id === acceptanceFixtureIds.regulation.nepalHeavyVehicle2082,
      ),
    ).toBe(true);

    const sourceById = new Map(
      fixtureSources.map((source) => [source.id, source]),
    );
    const verifiedAt = new Date("2026-08-10T13:22:24.000Z");
    expect(
      sourceById.get(acceptanceFixtureIds.source.nepalVehicleEmissionGazette),
    ).toMatchObject({
      publishedOn: "2025-06-23",
      publisher:
        "Government of Nepal / Ministry of Forests and Environment / Department of Printing",
      sourceType: "official-regulation",
      verifiedAt,
    });
    expect(
      sourceById.get(
        acceptanceFixtureIds.source.nepalVehiclePollutionStandardDoenv,
      ),
    ).toMatchObject({
      publishedOn: "2026-03-12",
      publisher: "Government of Nepal / Department of Environment",
      sourceType: "official-regulation",
      verifiedAt,
    });
  });

  it("locks the Caucasus exact official-source metadata and shared verification time", () => {
    const verifiedAt = new Date("2026-08-10T14:20:51.000Z");
    const expectedSources = [
      {
        id: acceptanceFixtureIds.source.armeniaTrCu018Consolidated,
        publishedOn: "2011-12-09",
        publisher:
          "Eurasian Economic Commission / ARLIS Legal Information System of Armenia",
        sourceType: "official-regulation",
        title:
          "TR CU 018/2011 On safety of wheeled vehicles — current consolidated Armenian official text, Annex 2 item 39",
        url: "https://www.arlis.am/hy/acts/158010/print/act",
      },
      {
        id: acceptanceFixtureIds.source.armeniaTrCu031Consolidated,
        publishedOn: "2012-07-20",
        publisher:
          "Eurasian Economic Commission / ARLIS Legal Information System of Armenia",
        sourceType: "official-regulation",
        title:
          "TR CU 031/2012 On safety of agricultural and forestry tractors and trailers — current consolidated Armenian official text, Annex 5 clause 14.1 and Table 5.1",
        url: "https://www.arlis.am/hy/acts/202066/print/act",
      },
      {
        id: acceptanceFixtureIds.source.azerbaijanEuro4Decision,
        publishedOn: "2014-01-14",
        publisher:
          "Cabinet of Ministers of the Republic of Azerbaijan / AZSTAND",
        sourceType: "official-regulation",
        title:
          "Cabinet Decision No. 2 of 14 January 2014 — Euro 4 environmental requirements for motor vehicles imported into and circulated in Azerbaijan",
        url: "https://azstand.gov.az/upload/files/avro%204.pdf",
      },
      {
        id: acceptanceFixtureIds.source.azerbaijanAzs6362025,
        publishedOn: "2025-03-19",
        publisher: "Azerbaijan Standardization Institute (AZSTAND)",
        sourceType: "other",
        title:
          "AZS 636:2025 Road transport — environmental classes (official metadata; M/N scope, non-reference standard, numeric pages not publicly readable)",
        url:
          "https://e-standart.gov.az/Standard/Details/838c95ea-0693-4ec2-afe5-808234f0748a",
      },
      {
        id: acceptanceFixtureIds.source.georgiaResolution238,
        publishedOn: "2023-06-28",
        publisher: "Georgia / LEPL Legislative Herald of Georgia",
        sourceType: "official-regulation",
        title:
          "Government Resolution No. 238 of 28 June 2023 — Technical Regulation on vehicle emission standards, current publication 12",
        url:
          "https://www.matsne.gov.ge/ka/document/view/5845990?publication=12",
      },
      {
        id: acceptanceFixtureIds.source.georgiaResolution238Mepa,
        publishedOn: "2023-06-28",
        publisher:
          "Ministry of Environmental Protection and Agriculture of Georgia",
        sourceType: "official-regulation",
        title:
          "Government Resolution No. 238 — Technical Regulation on vehicle emission standards (MEPA official document mirror)",
        url: "https://www.mepa.gov.ge/Ge/Files/Download/55101",
      },
      {
        id: acceptanceFixtureIds.source.belarusTrCu018,
        publishedOn: "2011-12-09",
        publisher: "Eurasian Economic Commission",
        sourceType: "official-regulation",
        title:
          "TR CU 018/2011 On safety of wheeled vehicles — current official regulation page and consolidated text",
        url:
          "https://eec.eaeunion.org/comission/department/deptexreg/realizatsiya-soglasheniya-o-vvedenii-edinykh-form-pts/normativnaya-baza/tr-ts-018-2011.php",
      },
      {
        id: acceptanceFixtureIds.source.belarusTrCu031,
        publishedOn: "2012-07-20",
        publisher: "Eurasian Economic Commission",
        sourceType: "official-regulation",
        title:
          "TR CU 031/2012 On safety of agricultural and forestry tractors and trailers — current official regulation page and consolidated text",
        url:
          "https://eec.eaeunion.org/comission/department/deptexreg/realizatsiya-soglasheniya-o-vvedenii-edinykh-form-pts/normativnaya-baza/tr-ts-031-2.php",
      },
    ] as const;

    for (const expected of expectedSources) {
      expect(fixtureSources.find(({ id }) => id === expected.id)).toMatchObject({
        ...expected,
        verifiedAt,
      });
    }
  });

  it("keeps Caucasus memberships and effective regulations on country jurisdictions", () => {
    const expectedMembershipDates = new Map([
      [acceptanceFixtureIds.jurisdiction.armenia, "2019-01-01"],
      [acceptanceFixtureIds.jurisdiction.belarus, "2019-01-01"],
      [acceptanceFixtureIds.jurisdiction.georgia, "2025-01-01"],
      [acceptanceFixtureIds.jurisdiction.azerbaijan, "2026-08-10"],
    ]);
    for (const [jurisdictionId, validFrom] of expectedMembershipDates) {
      expect(
        fixtureCountryJurisdictions.find(
          (membership) => membership.jurisdictionId === jurisdictionId,
        ),
      ).toMatchObject({ validFrom });
    }

    const expectedRegulations = [
      [
        acceptanceFixtureIds.regulation.armeniaRoadClass5,
        acceptanceFixtureIds.jurisdiction.armenia,
        "2019-01-01",
      ],
      [
        acceptanceFixtureIds.regulation.armeniaAgricultureStageIIIA,
        acceptanceFixtureIds.jurisdiction.armenia,
        "2025-01-01",
      ],
      [
        acceptanceFixtureIds.regulation.belarusRoadClass5,
        acceptanceFixtureIds.jurisdiction.belarus,
        "2019-01-01",
      ],
      [
        acceptanceFixtureIds.regulation.belarusAgricultureStageIIIA,
        acceptanceFixtureIds.jurisdiction.belarus,
        "2025-01-01",
      ],
      [
        acceptanceFixtureIds.regulation.georgiaRoadClass5,
        acceptanceFixtureIds.jurisdiction.georgia,
        "2025-01-01",
      ],
    ] as const;
    for (const [id, jurisdictionId, effectiveFrom] of expectedRegulations) {
      expect(fixtureRegulations.find((regulation) => regulation.id === id)).toMatchObject({
        effectiveFrom,
        jurisdictionId,
        status: "effective",
        verifiedAt: new Date("2026-08-10T14:20:51.000Z"),
      });
    }
    expect(
      expectedRegulations.every(
        ([, jurisdictionId]) =>
          jurisdictionId !== acceptanceFixtureIds.jurisdiction.eaeu,
      ),
    ).toBe(true);
  });

  it("RWA publishes the complete Euro IV truck/bus path at its gazetted boundary", async () => {
    expect(
      fixtureRegulations.find(
        (row) => row.id === acceptanceFixtureIds.regulation.rwandaRoadEuroIv,
      ),
    ).toMatchObject({
      dataSourceId:
        acceptanceFixtureIds.source.rwandaEas1047Implementation,
      effectiveFrom: "2023-01-23",
    });
    const before = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2023-01-22",
      countryIso3: "RWA",
      powerKw: 150,
    });
    const [truck, bus, construction, agriculture] = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map(
        (applicationScope) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf: "2023-01-23",
            countryIso3: "RWA",
            powerKw: 150,
          }),
      ),
    );

    expect(before).toEqual([]);
    expect([truck.length, bus.length, construction.length, agriculture.length]).toEqual([
      9, 9, 0, 0,
    ]);
    expect(
      new Map(
        truck.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      ),
    ).toEqual(
      new Map([
        ["ESC:CO", 1.5],
        ["ESC:HC", 0.46],
        ["ESC:NOX", 3.5],
        ["ESC:PM", 0.02],
        ["ELR:OPACITY", 0.5],
        ["ETC:CO", 4],
        ["ETC:NMHC", 0.55],
        ["ETC:NOX", 3.5],
        ["ETC:PM", 0.03],
      ]),
    );
    expect(
      [...truck, ...bus].every(
        (row) =>
          row.regulationId ===
            acceptanceFixtureIds.regulation.rwandaRoadEuroIv &&
          row.limit.sourceId === acceptanceFixtureIds.source.uneceR49Rev4 &&
          row.limit.validFrom === "2023-01-23" &&
          row.limit.sourceUrl ===
            "https://digitallibrary.un.org/record/640040/files/E_ECE_324_Rev.1_Add.48_Rev.4_E_ECE_TRANS_505_Rev.1_Add.48_Rev.4-EN.pdf",
      ),
    ).toBe(true);
    expect(
      buildFixtureLimits().filter(
        (row) =>
          row.regulationId ===
          acceptanceFixtureIds.regulation.rwandaRoadEuroIv,
      ),
    ).toHaveLength(18);

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({ asOf: "2026-08-10", iso3: "RWA" });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "RW-NATIONAL",
        membershipSource: {
          url: "https://www.rsb.gov.rw/fileadmin/Standard_Publications/Gazetted_Standards/National_Standards_as_published_in_Official_Gazette_n___04_of_23_01_2023.pdf",
        },
        source: {
          url: "https://rwandalii.org/akn/rw/act/mo/2018/2/eng@2018-09-24/source.pdf",
        },
        validFrom: "2023-01-23",
      },
    ]);
  });

  it.each([
    [
      "ARM",
      acceptanceFixtureIds.regulation.armeniaRoadClass5,
      acceptanceFixtureIds.regulation.armeniaAgricultureStageIIIA,
    ],
    [
      "BLR",
      acceptanceFixtureIds.regulation.belarusRoadClass5,
      acceptanceFixtureIds.regulation.belarusAgricultureStageIIIA,
    ],
  ] as const)(
    "%s publishes one nine-row B2 road path per scope without cumulative alternatives or unconditional NH3",
    async (countryIso3, roadRegulationId, agricultureRegulationId) => {
      const [beforeRows, truckRows, busRows, constructionRows] =
        await Promise.all([
          repository().findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2018-12-31",
            countryIso3,
            powerKw: 150,
          }),
          repository().findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-08-10",
            countryIso3,
            powerKw: 150,
          }),
          repository().findEffectiveByCountry({
            applicationScope: "on-road-bus",
            asOf: "2026-08-10",
            countryIso3,
            powerKw: 150,
          }),
          repository().findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2026-08-10",
            countryIso3,
            powerKw: 150,
          }),
        ]);
      expect(beforeRows).toEqual([]);
      expect(truckRows).toHaveLength(9);
      expect(busRows).toHaveLength(9);
      expect(constructionRows).toEqual([]);
      expect(
        [...truckRows, ...busRows].every(
          (row) =>
            row.regulationId === roadRegulationId &&
            row.limit.sourceId === acceptanceFixtureIds.source.uneceR49Rev4 &&
            row.limit.pollutantCode !== "NH3",
        ),
      ).toBe(true);
      const cycleCounts = new Map<string, number>();
      for (const row of truckRows) {
        const cycle = row.limit.testCycleCode ?? "";
        cycleCounts.set(cycle, (cycleCounts.get(cycle) ?? 0) + 1);
      }
      expect(cycleCounts).toEqual(
        new Map([
          ["ESC", 4],
          ["ETC", 4],
          ["ELR", 1],
        ]),
      );
      const values = new Map(
        truckRows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values).toMatchObject(
        new Map([
          ["ESC:CO", 1.5],
          ["ESC:HC", 0.46],
          ["ESC:NOX", 2],
          ["ESC:PM", 0.02],
          ["ETC:CO", 4],
          ["ETC:NMHC", 0.55],
          ["ETC:NOX", 2],
          ["ETC:PM", 0.03],
          ["ELR:OPACITY", 0.5],
        ]),
      );
      const rawRoadRows = buildFixtureLimits().filter(
        (row) => row.regulationId === roadRegulationId,
      );
      expect(rawRoadRows).toHaveLength(18);
      expect(
        rawRoadRows.every(
          (row) =>
            row.measurementBasis?.includes("alternative") === true &&
            row.measurementBasis?.includes("substitute") === true,
        ),
      ).toBe(true);
      expect(
        buildFixtureLimits().filter(
          (row) => row.regulationId === agricultureRegulationId,
        ),
      ).toHaveLength(12);
    },
  );

  it.each(["ARM", "BLR"] as const)(
    "%s applies four half-open Stage IIIA power bands and the two legal start dates",
    async (countryIso3) => {
      const query = (asOf: string, powerKw: number) =>
        repository().findEffectiveByCountry({
          applicationScope: "agriculture",
          asOf,
          countryIso3,
          powerKw,
        });
      const rowsByPower = await Promise.all(
        [19, 19.001, 37, 75, 130, 560, 560.001].map((powerKw) =>
          query("2026-08-10", powerKw),
        ),
      );
      expect(rowsByPower.map((rows) => rows.length)).toEqual([
        0, 3, 3, 3, 3, 3, 0,
      ]);
      expect(await query("2024-12-31", 37)).toEqual([]);
      expect(await query("2025-01-01", 37)).toHaveLength(3);
      expect(await query("2025-09-30", 75)).toEqual([]);
      expect(await query("2025-10-01", 75)).toHaveLength(3);
      const rowsAt150Kw = await query("2026-08-10", 150);
      expect(rowsAt150Kw).toHaveLength(3);
      expect(
        rowsAt150Kw.every(
          (row) =>
            row.limit.testCycleCode === "UN R96-02" &&
            row.limit.powerMinKw === 130 &&
            row.limit.powerMaxKw === 560.001,
        ),
      ).toBe(true);
    },
  );

  it("GEO publishes N3/M3 B2 only from 2025-01-01 and preserves both non-road scopes as no-data", async () => {
    const query = (
      applicationScope:
        | "on-road-truck"
        | "on-road-bus"
        | "construction"
        | "agriculture",
      asOf: string,
    ) =>
      repository().findEffectiveByCountry({
        applicationScope,
        asOf,
        countryIso3: "GEO",
        powerKw: 150,
      });
    const [beforeRows, truckRows, busRows, constructionRows, agricultureRows] =
      await Promise.all([
        query("on-road-truck", "2024-12-31"),
        query("on-road-truck", "2026-08-10"),
        query("on-road-bus", "2026-08-10"),
        query("construction", "2026-08-10"),
        query("agriculture", "2026-08-10"),
      ]);
    expect(beforeRows).toEqual([]);
    expect(truckRows).toHaveLength(9);
    expect(busRows).toHaveLength(9);
    expect(constructionRows).toEqual([]);
    expect(agricultureRows).toEqual([]);
    expect(
      [...truckRows, ...busRows].every(
        (row) =>
          row.regulationId === acceptanceFixtureIds.regulation.georgiaRoadClass5 &&
          row.limit.sourceId === acceptanceFixtureIds.source.uneceR49Rev4 &&
          !["PN", "CH4", "NH3"].includes(row.limit.pollutantCode),
      ),
    ).toBe(true);
    const rawRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId === acceptanceFixtureIds.regulation.georgiaRoadClass5,
    );
    expect(rawRows).toHaveLength(18);
    expect(
      rawRows.every(
        (row) =>
          row.measurementBasis?.includes("N3 trucks and M3 buses only") === true &&
          row.measurementBasis?.includes("older >2,610 kg") === true,
      ),
    ).toBe(true);
  });

  it("AZE keeps all four scopes no-data across its exact two-source boundary", async () => {
    const results = await Promise.all(
      ([
        "on-road-truck",
        "on-road-bus",
        "construction",
        "agriculture",
      ] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "AZE",
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3: "AZE",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "AZ-NATIONAL",
        validFrom: "2026-08-10",
        source: { url: "https://azstand.gov.az/upload/files/avro%204.pdf" },
        membershipSource: {
          url:
            "https://e-standart.gov.az/Standard/Details/838c95ea-0693-4ec2-afe5-808234f0748a",
        },
      },
    ]);
    expect(
      fixtureRegulations.some(
        (regulation) =>
          regulation.jurisdictionId ===
          acceptanceFixtureIds.jurisdiction.azerbaijan,
      ),
    ).toBe(false);
  });

  it("locks the Central Asia official-source metadata and shared UNECE numeric source", () => {
    const verifiedAt = new Date("2026-08-10T13:40:00.000Z");
    const expectedSources = [
      {
        id: acceptanceFixtureIds.source.uzbekistanAgricultureRegulation,
        publishedOn: "2025-01-13",
        publisher:
          "Cabinet of Ministers of the Republic of Uzbekistan / LEX.UZ",
        sourceType: "official-regulation",
        title:
          "Cabinet Decision No. 10 of 11 January 2025 — UzTR.10-006:2025 Safety of agricultural and forestry vehicles and machinery",
        url: "https://lex.uz/uz/docs/7315394",
      },
      {
        id: acceptanceFixtureIds.source.uzbekistanRoadRegulation,
        publishedOn: "2017-04-25",
        publisher:
          "Cabinet of Ministers of the Republic of Uzbekistan / LEX.UZ",
        sourceType: "official-regulation",
        title:
          "Cabinet Decision No. 237 of 25 April 2017 — UzTR.237-016:2017 General Technical Regulation on Safety of Wheeled Vehicles, Annex 8 environmental-class boundary",
        url: "https://lex.uz/docs/3180907",
      },
      {
        id: acceptanceFixtureIds.source.kazakhstanRoadRegulation,
        publishedOn: "2011-12-09",
        publisher:
          "Eurasian Economic Commission / Adilet Legal Information System of Kazakhstan",
        sourceType: "official-regulation",
        title:
          "TR CU 018/2011 On safety of wheeled vehicles — current consolidated text, Annex 2 item 39",
        url: "https://adilet.zan.kz/rus/docs/H11T0000877",
      },
      {
        id: acceptanceFixtureIds.source.kazakhstanAgricultureRegulation,
        publishedOn: "2012-07-20",
        publisher:
          "Eurasian Economic Commission / Adilet Legal Information System of Kazakhstan",
        sourceType: "official-regulation",
        title:
          "TR CU 031/2012 On safety of agricultural and forestry tractors and trailers — current consolidated text, Annex 5 clause 14.1 and Table 5.1",
        url: "https://adilet.zan.kz/rus/docs/H12EV000060",
      },
      {
        id: acceptanceFixtureIds.source.tajikistanRoadEnvironmentalLaw,
        publishedOn: "2015-08-08",
        publisher:
          "National Legislation Center under the President of the Republic of Tajikistan",
        sourceType: "official-regulation",
        title:
          "Law of the Republic of Tajikistan No. 1214 on ensuring environmental safety of road transport",
        url: "https://ncz.tj/system/files/Legislation/1214_ru.pdf",
      },
      {
        id: acceptanceFixtureIds.source.tajikistanEngineTermsDraft,
        publishedOn: null,
        publisher:
          "Agency for Standardization, Metrology, Certification and Trade Inspection under the Government of the Republic of Tajikistan",
        sourceType: "government-notice",
        title:
          "Draft ST JT ____-2024 — Engine emissions: terms and definitions (blank approval and effective-date fields)",
        url: "https://standard.tj/documents/files/file_328.pdf",
      },
      {
        id: acceptanceFixtureIds.source.kyrgyzstanRoadImplementation,
        publishedOn: null,
        publisher: "Ministry of Economy and Commerce of the Kyrgyz Republic",
        sourceType: "government-notice",
        title:
          "Official implementation notice for TR CU 018/2011 — entry into force on 12 February 2016 and transitional documents through 12 February 2018",
        url: "https://www.mineconom.gov.kg/ru/post/4112",
      },
      {
        id: acceptanceFixtureIds.source.kyrgyzstanAgricultureRegulation,
        publishedOn: "2012-07-20",
        publisher: "Eurasian Economic Commission",
        sourceType: "official-regulation",
        title:
          "TR CU 031/2012 On safety of agricultural and forestry tractors and trailers — official regulation and current text",
        url:
          "https://eec.eaeunion.org/comission/department/deptexreg/tr/bezopSH.php",
      },
      {
        id: acceptanceFixtureIds.source.turkmenistanAirProtectionLaw,
        publishedOn: "2016-01-01",
        publisher: "Ministry of Justice of Turkmenistan",
        sourceType: "official-regulation",
        title:
          "Law of Turkmenistan on protection of atmospheric air — Article 21, with 2018 and 2021 amendments",
        url:
          "https://minjust.gov.tm/assets/files/law_documents/hukuknama_406_ru.pdf",
      },
      {
        id: acceptanceFixtureIds.source.turkmenistanGasolineMeasurementStandard,
        publishedOn: "2019-01-01",
        publisher: "Main State Service Turkmenstandartlary",
        sourceType: "government-notice",
        title:
          "TDS 1286-2019 — Gasoline-engine exhaust gases: measurement of carbon monoxide and hydrocarbons",
        url: "https://tds.gov.tm/ru/state/standards?page=32",
      },
      {
        id: acceptanceFixtureIds.source.uneceR49Rev4,
        publishedOn: "2008-08-13",
        publisher: "United Nations Economic Commission for Europe",
        sourceType: "official-regulation",
        title:
          "UN Regulation No. 49, Revision 4 — Uniform provisions concerning measures against gaseous and particulate pollutants from compression-ignition engines and positive ignition engines for use in vehicles",
        url:
          "https://digitallibrary.un.org/record/640040/files/E_ECE_324_Rev.1_Add.48_Rev.4_E_ECE_TRANS_505_Rev.1_Add.48_Rev.4-EN.pdf",
      },
    ] as const;

    for (const expected of expectedSources) {
      expect(fixtureSources.find(({ id }) => id === expected.id)).toMatchObject({
        ...expected,
        verifiedAt,
      });
    }
  });

  it("keeps Central Asia national memberships and regulations on their signed dates", () => {
    const expectedMembershipDates = new Map([
      [acceptanceFixtureIds.jurisdiction.kazakhstan, "2019-01-01"],
      [acceptanceFixtureIds.jurisdiction.kyrgyzstan, "2019-01-01"],
      [acceptanceFixtureIds.jurisdiction.uzbekistan, "2025-10-01"],
      [acceptanceFixtureIds.jurisdiction.tajikistan, "2026-08-10"],
      [acceptanceFixtureIds.jurisdiction.turkmenistan, "2026-08-10"],
    ]);
    for (const [jurisdictionId, validFrom] of expectedMembershipDates) {
      expect(
        fixtureCountryJurisdictions.find(
          (membership) => membership.jurisdictionId === jurisdictionId,
        ),
      ).toMatchObject({ validFrom });
    }

    const expectedRegulations = [
      [
        acceptanceFixtureIds.regulation.kazakhstanRoadClass5,
        acceptanceFixtureIds.jurisdiction.kazakhstan,
        "2019-01-01",
      ],
      [
        acceptanceFixtureIds.regulation.kazakhstanAgricultureStageIIIA,
        acceptanceFixtureIds.jurisdiction.kazakhstan,
        "2025-01-01",
      ],
      [
        acceptanceFixtureIds.regulation.kyrgyzstanRoadClass5,
        acceptanceFixtureIds.jurisdiction.kyrgyzstan,
        "2019-01-01",
      ],
      [
        acceptanceFixtureIds.regulation.kyrgyzstanAgricultureStageIIIA,
        acceptanceFixtureIds.jurisdiction.kyrgyzstan,
        "2025-01-01",
      ],
      [
        acceptanceFixtureIds.regulation.uzbekistanAgricultureStageIIIA,
        acceptanceFixtureIds.jurisdiction.uzbekistan,
        "2025-10-01",
      ],
    ] as const;
    for (const [id, jurisdictionId, effectiveFrom] of expectedRegulations) {
      expect(fixtureRegulations.find((regulation) => regulation.id === id)).toMatchObject({
        effectiveFrom,
        jurisdictionId,
        status: "effective",
      });
    }
  });

  it.each([
    [
      "KAZ",
      acceptanceFixtureIds.regulation.kazakhstanRoadClass5,
      acceptanceFixtureIds.regulation.kazakhstanAgricultureStageIIIA,
    ],
    [
      "KGZ",
      acceptanceFixtureIds.regulation.kyrgyzstanRoadClass5,
      acceptanceFixtureIds.regulation.kyrgyzstanAgricultureStageIIIA,
    ],
  ] as const)(
    "%s publishes one B2 road path and keeps C/EEV alternative limits non-cumulative",
    async (countryIso3, roadRegulationId, agricultureRegulationId) => {
      const [truckRows, busRows, constructionRows] = await Promise.all([
        repository().findEffectiveByCountry({
          applicationScope: "on-road-truck",
          asOf: "2026-08-10",
          countryIso3,
          powerKw: 150,
        }),
        repository().findEffectiveByCountry({
          applicationScope: "on-road-bus",
          asOf: "2026-08-10",
          countryIso3,
          powerKw: 150,
        }),
        repository().findEffectiveByCountry({
          applicationScope: "construction",
          asOf: "2026-08-10",
          countryIso3,
          powerKw: 150,
        }),
      ]);
      const cycleCounts = new Map<string, number>();
      for (const row of truckRows) {
        const cycle = row.limit.testCycleCode ?? "";
        cycleCounts.set(cycle, (cycleCounts.get(cycle) ?? 0) + 1);
      }
      expect(truckRows).toHaveLength(9);
      expect(busRows).toHaveLength(9);
      expect(constructionRows).toEqual([]);
      expect(cycleCounts).toEqual(new Map([["ESC", 4], ["ETC", 4], ["ELR", 1]]));
      expect(
        [...truckRows, ...busRows].every(
          (row) =>
            row.regulationId === roadRegulationId &&
            row.limit.sourceId === acceptanceFixtureIds.source.uneceR49Rev4,
        ),
      ).toBe(true);
      const rawRoadRows = buildFixtureLimits().filter(
        (row) => row.regulationId === roadRegulationId,
      );
      expect(rawRoadRows).toHaveLength(18);
      expect(
        rawRoadRows.every((row) =>
          row.measurementBasis?.includes("C/EEV is an alternative"),
        ),
      ).toBe(true);
      expect(
        buildFixtureLimits().filter(
          (row) => row.regulationId === agricultureRegulationId,
        ),
      ).toHaveLength(12);
    },
  );

  it.each(["KAZ", "KGZ"] as const)(
    "%s applies the four Stage IIIA power bands at exact lower and upper boundaries",
    async (countryIso3) => {
      const query = (asOf: string, powerKw: number) =>
        repository().findEffectiveByCountry({
          applicationScope: "agriculture",
          asOf,
          countryIso3,
          powerKw,
        });
      const rowsByPower = await Promise.all(
        [19, 19.001, 37, 75, 130, 560, 560.001].map((powerKw) =>
          query("2026-08-10", powerKw),
        ),
      );
      expect(rowsByPower.map((rows) => rows.length)).toEqual([
        0, 3, 3, 3, 3, 3, 0,
      ]);
      expect(await query("2024-12-31", 37)).toEqual([]);
      expect(await query("2025-01-01", 37)).toHaveLength(3);
      expect(await query("2025-09-30", 75)).toEqual([]);
      expect(await query("2025-10-01", 75)).toHaveLength(3);
      const rowsAt150Kw = await query("2026-08-10", 150);
      expect(rowsAt150Kw).toHaveLength(3);
      expect(
        rowsAt150Kw.every(
          (row) =>
            row.limit.testCycleCode === "UN R96-02" &&
            row.limit.powerMinKw === 130 &&
            row.limit.powerMaxKw === 560.001,
        ),
      ).toBe(true);
    },
  );

  it("UZB publishes only the verified current H agriculture band", async () => {
    const query = (applicationScope: "on-road-truck" | "on-road-bus" | "construction" | "agriculture", asOf: string, powerKw: number) =>
      repository().findEffectiveByCountry({
        applicationScope,
        asOf,
        countryIso3: "UZB",
        powerKw,
      });
    const [truckRows, busRows, constructionRows, beforeRows, ...powerRows] =
      await Promise.all([
        query("on-road-truck", "2026-08-10", 150),
        query("on-road-bus", "2026-08-10", 150),
        query("construction", "2026-08-10", 150),
        query("agriculture", "2025-09-30", 150),
        ...[129.999, 130, 560, 560.001].map((powerKw) =>
          query("agriculture", "2026-08-10", powerKw),
        ),
      ]);
    expect([truckRows, busRows, constructionRows, beforeRows]).toEqual([
      [],
      [],
      [],
      [],
    ]);
    expect(powerRows.map((rows) => rows.length)).toEqual([0, 3, 3, 0]);
    expect(
      powerRows[1]?.every(
        (row) =>
          row.regulationId ===
            acceptanceFixtureIds.regulation.uzbekistanAgricultureStageIIIA &&
          row.limit.testCycleCode === "NRSC",
      ),
    ).toBe(true);
    const rawUzbekistanRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
        acceptanceFixtureIds.regulation.uzbekistanAgricultureStageIIIA,
    );
    expect(rawUzbekistanRows).toHaveLength(3);
    expect(
      rawUzbekistanRows.every(
        (row) =>
          row.measurementBasis?.includes("Stage II") === true &&
          row.measurementBasis?.includes("Stage V") === true,
      ),
    ).toBe(true);
  });

  it.each(["TJK", "TKM"] as const)(
    "%s keeps all four scopes as signed no-data",
    async (countryIso3) => {
      const results = await Promise.all(
        ([
          "on-road-truck",
          "on-road-bus",
          "construction",
          "agriculture",
        ] as const).map((applicationScope) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf: "2026-08-10",
            countryIso3,
            powerKw: 150,
          }),
        ),
      );
      expect(results).toEqual([[], [], [], []]);
      const jurisdictionId =
        countryIso3 === "TJK"
          ? acceptanceFixtureIds.jurisdiction.tajikistan
          : acceptanceFixtureIds.jurisdiction.turkmenistan;
      expect(
        fixtureRegulations.some(
          (regulation) => regulation.jurisdictionId === jurisdictionId,
        ),
      ).toBe(false);
    },
  );

  it("locks the final ten countries' exact 20-source metadata", () => {
    const verifiedAt = new Date("2026-08-10T14:35:00.000Z");
    const expectedSources = [
      {
        id: acceptanceFixtureIds.source.afghanistanAirPollutionRegulation,
        publishedOn: "2009-08-11",
        publisher:
          "Islamic Republic of Afghanistan / Ministry of Justice / National Environmental Protection Agency",
        sourceType: "official-regulation",
        url: "https://parse.nepa.gov.af/parse/files/nepa/mqrrh_kahsh_w_jlwgyry_az_alwdgy_hwa.pdf",
      },
      {
        id: acceptanceFixtureIds.source.afghanistanAirPollutionAmendment,
        publishedOn: "2020-11-21",
        publisher:
          "Islamic Republic of Afghanistan / Ministry of Justice / National Environmental Protection Agency",
        sourceType: "official-regulation",
        url: "https://parse.nepa.gov.af/parse/files/nepa/tadyl_mqrrh_kahsh_w_jlwgyry_az_alwdgy_hwa_nafdh_shdh_shmarh_mslsl_1393.pdf",
      },
      {
        id: acceptanceFixtureIds.source.angolaVehicleInspectionRegulation,
        publishedOn: "2013-11-07",
        publisher:
          "President of the Republic / Diário da República de Angola",
        sourceType: "official-regulation",
        url: "https://files.lex.ao/presidente-da-republica/2013/decreto-presidencial-n-o-185-13-de-07-de-novembro/download/decreto-presidencial-n-o-185-13-de-07-de-novembro_presidente-da-republica_lex-ao.pdf",
      },
      {
        id: acceptanceFixtureIds.source
          .angolaEnvironmentalStandardizationProgram,
        publishedOn: "2020-04-13",
        publisher:
          "President of the Republic / Diário da República de Angola",
        sourceType: "government-notice",
        url: "https://files.lex.ao/presidente-da-republica/2020/decreto-presidencial-n-o-99-20-de-13-de-abril/download/decreto-presidencial-n-o-99-20-de-13-de-abril_presidente-da-republica_lex-ao.pdf",
      },
      {
        id: acceptanceFixtureIds.source.burundiRoadTrafficCode2012,
        publishedOn: "2012-11-23",
        publisher:
          "Bulletin Officiel du Burundi / Amategeko government legal database",
        sourceType: "official-regulation",
        url: "https://amategeko.gov.bi/wp-content/uploads/2019/12/BOB_No11-2012.pdf",
      },
      {
        id: acceptanceFixtureIds.source.burundiVehicleInspectionOrder2025,
        publishedOn: "2025-01-27",
        publisher:
          "Burundi Ministry of Commerce and Transport / Ministry of Finance",
        sourceType: "official-regulation",
        url: "https://finances.gov.bi/wp-content/uploads/2025/02/OM-PORTANT-FIXATION-DES-MODALITES-DE-DELIVRANCE-DES-SERVICES-DE-CONTROLE-TECHNIQUE-AUTOMOBILE-ET-DES-PERMIS-DE-TRANSPORT-ROUTIER.pdf",
      },
      {
        id: acceptanceFixtureIds.source.beninAirQualityDecree2001,
        publishedOn: "2001-04-04",
        publisher:
          "Presidency of the Republic / General Secretariat of the Government of Benin",
        sourceType: "official-regulation",
        url: "https://sgg.gouv.bj/doc/decret-2001-110/download",
      },
      {
        id: acceptanceFixtureIds.source.beninAirQualityDecreeIndex,
        publishedOn: "2001-04-04",
        publisher: "General Secretariat of the Government of Benin",
        sourceType: "government-notice",
        url: "https://sgg.gouv.bj/documentheque/763/",
      },
      {
        id: acceptanceFixtureIds.source.burkinaFasoAirQualityDecree2001,
        publishedOn: "2001-05-07",
        publisher:
          "President of Burkina Faso / Journal Officiel (FAOLEX facsimile)",
        sourceType: "official-regulation",
        url: "https://faolex.fao.org/docs/pdf/bkf26794.pdf",
      },
      {
        id: acceptanceFixtureIds.source.burkinaFasoCurrentCitation2025,
        publishedOn: null,
        publisher:
          "Burkina Faso Ministry of Infrastructure / Ministry of Environment",
        sourceType: "government-notice",
        url: "https://www.environnement.gov.bf/fileadmin/user_upload/storages/images/mediatheque/accueil/past_nies_garage_brigade_ziniare.pdf",
      },
      {
        id: acceptanceFixtureIds.source.bangladeshAirPollutionRules2022,
        publishedOn: "2022-07-26",
        publisher:
          "Bangladesh Ministry of Environment, Forest and Climate Change / Bangladesh Government Press",
        sourceType: "official-regulation",
        url: "https://www.dpp.gov.bd/upload_file/gazettes/45501_95134.pdf",
      },
      {
        id: acceptanceFixtureIds.source.bangladeshGazetteIndex2022,
        publishedOn: "2022-07-26",
        publisher:
          "Bangladesh Department of Printing and Publications / Government Press",
        sourceType: "government-notice",
        url: "https://www.dpp.gov.bd/bgpress/index.php/document/get_extraordinary/45501",
      },
      {
        id: acceptanceFixtureIds.source.bahamasRoadTrafficAct,
        publishedOn: "1958-09-18",
        publisher: "Government of The Bahamas / Statute Law of The Bahamas",
        sourceType: "official-regulation",
        url: "https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/1958/1958-0057/1958-0057_2.pdf",
      },
      {
        id: acceptanceFixtureIds.source.bahamasEnvironmentalPlanningAct,
        publishedOn: "2019-12-20",
        publisher:
          "Parliament / Official Gazette of The Bahamas / Government of The Bahamas",
        sourceType: "official-regulation",
        url: "https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/2019/2019-0040/2019-0040_1.pdf",
      },
      {
        id: acceptanceFixtureIds.source.boliviaRm064Regulation,
        publishedOn: "2022-04-01",
        publisher:
          "Bolivia Ministry of Public Works, Services and Housing / Vice Ministry of Transport",
        sourceType: "official-regulation",
        url: "https://www.oopp.gob.bo/wp-content/uploads/2022/04/RM-064-Y-REGLAMENTO.pdf",
      },
      {
        id: acceptanceFixtureIds.source.boliviaIbmetroAcceptance,
        publishedOn: null,
        publisher: "Bolivian Institute of Metrology (IBMETRO)",
        sourceType: "government-notice",
        url: "https://ibmetro.gob.bo/certificado-de-aceptacion",
      },
      {
        id: acceptanceFixtureIds.source.moroccoEuro6Order2094,
        publishedOn: "2024-12-16",
        publisher: "General Secretariat of the Government of Morocco",
        sourceType: "official-regulation",
        title: "Bulletin Officiel n°7361 — Arrêté conjoint n°2094.24",
        url: "https://www.sgg.gov.ma/BO/AR/3111/2024/BO_7361_Ar.pdf",
        verifiedAt: new Date("2026-08-10T18:48:04.000Z"),
      },
      {
        id: acceptanceFixtureIds.source.moroccoEuro6Order2251,
        publishedOn: "2021-10-07",
        publisher: "General Secretariat of the Government of Morocco",
        sourceType: "official-regulation",
        title:
          "Bulletin Officiel n°7028 — Arrêté conjoint n°2251-21 du 5 août 2021",
        url: "https://www.sgg.gov.ma/BO/bo_fr/2021/BO_7028_Fr.pdf",
        verifiedAt: new Date("2026-08-10T18:48:04.000Z"),
      },
      {
        id: acceptanceFixtureIds.source.kenyaAirQualityRegulations2024,
        publishedOn: "2024-12-06",
        publisher: "Kenya Law / Republic of Kenya",
        sourceType: "official-regulation",
        title:
          "The Environmental Management and Coordination (Air Quality) Regulations (Legal Notice 180 of 2024) — legislation as at 24 March 2025",
        url: "https://new.kenyalaw.org/akn/ke/act/ln/2024/180/eng@2025-03-24/source.pdf",
        verifiedAt: new Date("2026-08-10T18:48:04.000Z"),
      },
      {
        id: acceptanceFixtureIds.source.kenyaInspectionRules2026,
        publishedOn: "2026-02-13",
        publisher: "Kenya Law / Republic of Kenya",
        sourceType: "official-regulation",
        title:
          "The Traffic (Motor Vehicle Inspection) Rules, 2026 — Legal Notice No. 13 of 2026",
        url: "https://new.kenyalaw.org/akn/ke/act/ln/2026/13/eng@2026-02-13/source.pdf",
        verifiedAt: new Date("2026-08-10T18:48:04.000Z"),
      },
    ] as const;

    expect(expectedSources).toHaveLength(20);
    for (const expected of expectedSources) {
      const expectedVerifiedAt =
        "verifiedAt" in expected ? expected.verifiedAt : verifiedAt;
      expect(fixtureSources.find(({ id }) => id === expected.id)).toMatchObject({
        ...expected,
        verifiedAt: expectedVerifiedAt,
      });
    }
    expect([
      acceptanceFixtureIds.source.moroccoEuro6Order2094,
      acceptanceFixtureIds.source.moroccoEuro6Order2251,
      acceptanceFixtureIds.source.kenyaAirQualityRegulations2024,
      acceptanceFixtureIds.source.kenyaInspectionRules2026,
    ]).toEqual([
      "10000000-0000-4000-8000-000000000393",
      "10000000-0000-4000-8000-000000000394",
      "10000000-0000-4000-8000-000000000396",
      "10000000-0000-4000-8000-000000000397",
    ]);
    expect(Object.keys(acceptanceFixtureIds.source)).not.toContain(
      "moroccoOrder2094ConsultationMatrix",
    );
    const sourceUrls = fixtureSources.map(({ url }) => url);
    expect(sourceUrls).not.toContain(
      "https://www.sgg.gov.ma/portals/0/AvantProjet/262/Matrice_2094.24.PDF",
    );
    expect(sourceUrls).not.toContain(
      "https://new.kenyalaw.org/akn/ke/act/ln/2024/180/eng@2024-12-06/source.pdf",
    );
  });

  it("locks the final ten jurisdiction and membership dates and source chains", async () => {
    const verifiedAt = new Date("2026-08-10T14:35:00.000Z");
    const expectedJurisdictions = [
      {
        code: "AF-NATIONAL",
        countryIso3: "AFG",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.afghanistan,
        membershipSourceId:
          acceptanceFixtureIds.source.afghanistanAirPollutionAmendment,
        membershipSourceUrl:
          "https://parse.nepa.gov.af/parse/files/nepa/tadyl_mqrrh_kahsh_w_jlwgyry_az_alwdgy_hwa_nafdh_shdh_shmarh_mslsl_1393.pdf",
        sourceId:
          acceptanceFixtureIds.source.afghanistanAirPollutionRegulation,
        sourceUrl:
          "https://parse.nepa.gov.af/parse/files/nepa/mqrrh_kahsh_w_jlwgyry_az_alwdgy_hwa.pdf",
        validFrom: "2026-08-10",
      },
      {
        code: "AO-NATIONAL",
        countryIso3: "AGO",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.angola,
        membershipSourceId:
          acceptanceFixtureIds.source.angolaEnvironmentalStandardizationProgram,
        membershipSourceUrl:
          "https://files.lex.ao/presidente-da-republica/2020/decreto-presidencial-n-o-99-20-de-13-de-abril/download/decreto-presidencial-n-o-99-20-de-13-de-abril_presidente-da-republica_lex-ao.pdf",
        sourceId: acceptanceFixtureIds.source.angolaVehicleInspectionRegulation,
        sourceUrl:
          "https://files.lex.ao/presidente-da-republica/2013/decreto-presidencial-n-o-185-13-de-07-de-novembro/download/decreto-presidencial-n-o-185-13-de-07-de-novembro_presidente-da-republica_lex-ao.pdf",
        validFrom: "2026-08-10",
      },
      {
        code: "BI-NATIONAL",
        countryIso3: "BDI",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.burundi,
        membershipSourceId:
          acceptanceFixtureIds.source.burundiVehicleInspectionOrder2025,
        membershipSourceUrl:
          "https://finances.gov.bi/wp-content/uploads/2025/02/OM-PORTANT-FIXATION-DES-MODALITES-DE-DELIVRANCE-DES-SERVICES-DE-CONTROLE-TECHNIQUE-AUTOMOBILE-ET-DES-PERMIS-DE-TRANSPORT-ROUTIER.pdf",
        sourceId: acceptanceFixtureIds.source.burundiRoadTrafficCode2012,
        sourceUrl:
          "https://amategeko.gov.bi/wp-content/uploads/2019/12/BOB_No11-2012.pdf",
        validFrom: "2026-08-10",
      },
      {
        code: "BJ-NATIONAL",
        countryIso3: "BEN",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.benin,
        membershipSourceId:
          acceptanceFixtureIds.source.beninAirQualityDecreeIndex,
        membershipSourceUrl: "https://sgg.gouv.bj/documentheque/763/",
        sourceId: acceptanceFixtureIds.source.beninAirQualityDecree2001,
        sourceUrl: "https://sgg.gouv.bj/doc/decret-2001-110/download",
        validFrom: "2026-08-10",
      },
      {
        code: "BF-NATIONAL",
        countryIso3: "BFA",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.burkinaFaso,
        membershipSourceId:
          acceptanceFixtureIds.source.burkinaFasoCurrentCitation2025,
        membershipSourceUrl:
          "https://www.environnement.gov.bf/fileadmin/user_upload/storages/images/mediatheque/accueil/past_nies_garage_brigade_ziniare.pdf",
        sourceId:
          acceptanceFixtureIds.source.burkinaFasoAirQualityDecree2001,
        sourceUrl: "https://faolex.fao.org/docs/pdf/bkf26794.pdf",
        validFrom: "2026-08-10",
      },
      {
        code: "BD-NATIONAL",
        countryIso3: "BGD",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.bangladesh,
        membershipSourceId:
          acceptanceFixtureIds.source.bangladeshGazetteIndex2022,
        membershipSourceUrl:
          "https://www.dpp.gov.bd/bgpress/index.php/document/get_extraordinary/45501",
        sourceId: acceptanceFixtureIds.source.bangladeshAirPollutionRules2022,
        sourceUrl:
          "https://www.dpp.gov.bd/upload_file/gazettes/45501_95134.pdf",
        validFrom: "2022-07-26",
      },
      {
        code: "BS-NATIONAL",
        countryIso3: "BHS",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.bahamas,
        membershipSourceId:
          acceptanceFixtureIds.source.bahamasEnvironmentalPlanningAct,
        membershipSourceUrl:
          "https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/2019/2019-0040/2019-0040_1.pdf",
        sourceId: acceptanceFixtureIds.source.bahamasRoadTrafficAct,
        sourceUrl:
          "https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/1958/1958-0057/1958-0057_2.pdf",
        validFrom: "2026-08-10",
      },
      {
        code: "BO-NATIONAL",
        countryIso3: "BOL",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.bolivia,
        membershipSourceId:
          acceptanceFixtureIds.source.boliviaIbmetroAcceptance,
        membershipSourceUrl:
          "https://ibmetro.gob.bo/certificado-de-aceptacion",
        sourceId: acceptanceFixtureIds.source.boliviaRm064Regulation,
        sourceUrl:
          "https://www.oopp.gob.bo/wp-content/uploads/2022/04/RM-064-Y-REGLAMENTO.pdf",
        validFrom: "2022-04-01",
      },
      {
        code: "MA-NATIONAL",
        countryIso3: "MAR",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.morocco,
        membershipSourceId:
          acceptanceFixtureIds.source.moroccoEuro6Order2251,
        membershipSourceUrl:
          "https://www.sgg.gov.ma/BO/bo_fr/2021/BO_7028_Fr.pdf",
        sourceId: acceptanceFixtureIds.source.moroccoEuro6Order2094,
        sourceUrl:
          "https://www.sgg.gov.ma/BO/AR/3111/2024/BO_7361_Ar.pdf",
        validFrom: "2026-08-10",
        verifiedAt: new Date("2026-08-10T18:48:04.000Z"),
      },
      {
        code: "KE-NATIONAL",
        countryIso3: "KEN",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.kenya,
        membershipSourceId: acceptanceFixtureIds.source.kenyaInspectionRules2026,
        membershipSourceUrl:
          "https://new.kenyalaw.org/akn/ke/act/ln/2026/13/eng@2026-02-13/source.pdf",
        sourceId: acceptanceFixtureIds.source.kenyaAirQualityRegulations2024,
        sourceUrl:
          "https://new.kenyalaw.org/akn/ke/act/ln/2024/180/eng@2025-03-24/source.pdf",
        validFrom: "2026-08-10",
        verifiedAt: new Date("2026-08-10T18:48:04.000Z"),
      },
    ] as const;

    for (const expected of expectedJurisdictions) {
      const expectedVerifiedAt =
        "verifiedAt" in expected ? expected.verifiedAt : verifiedAt;
      expect(
        fixtureJurisdictions.find(
          ({ id }) => id === expected.jurisdictionId,
        ),
      ).toMatchObject({
        countryIso3: expected.countryIso3,
        dataSourceId: expected.sourceId,
        verifiedAt: expectedVerifiedAt,
      });
      expect(
        fixtureCountryJurisdictions.find(
          (membership) =>
            membership.countryIso3 === expected.countryIso3 &&
            membership.jurisdictionId === expected.jurisdictionId,
        ),
      ).toMatchObject({
        dataSourceId: expected.membershipSourceId,
        validFrom: expected.validFrom,
        verifiedAt: expectedVerifiedAt,
      });

      const details = await createCountryRepository(
        testDatabase.database,
      ).findDetailsByIso3({
        asOf: "2026-08-10",
        iso3: expected.countryIso3,
      });
      expect(details?.jurisdictions).toMatchObject([
        {
          code: expected.code,
          membershipSource: {
            id: expected.membershipSourceId,
            url: expected.membershipSourceUrl,
          },
          source: { id: expected.sourceId, url: expected.sourceUrl },
          validFrom: expected.validFrom,
        },
      ]);
    }
  });

  it.each([
    ["AFG", acceptanceFixtureIds.jurisdiction.afghanistan],
    ["AGO", acceptanceFixtureIds.jurisdiction.angola],
    ["BDI", acceptanceFixtureIds.jurisdiction.burundi],
    ["BEN", acceptanceFixtureIds.jurisdiction.benin],
    ["BFA", acceptanceFixtureIds.jurisdiction.burkinaFaso],
    ["BHS", acceptanceFixtureIds.jurisdiction.bahamas],
    ["MAR", acceptanceFixtureIds.jurisdiction.morocco],
    ["KEN", acceptanceFixtureIds.jurisdiction.kenya],
  ] as const)(
    "%s keeps all four scopes as signed no-data without a fixture regulation",
    async (countryIso3, jurisdictionId) => {
      const results = await Promise.all(
        ([
          "on-road-truck",
          "on-road-bus",
          "construction",
          "agriculture",
        ] as const).map((applicationScope) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf: "2026-08-10",
            countryIso3,
            powerKw: 150,
          }),
        ),
      );

      expect(results).toEqual([[], [], [], []]);
      expect(
        fixtureRegulations.some(
          (regulation) => regulation.jurisdictionId === jurisdictionId,
        ),
      ).toBe(false);
    },
  );

  it("BGD switches to four heavy-road limits per scope on 2022-07-26", async () => {
    const query = (
      applicationScope:
        | "on-road-truck"
        | "on-road-bus"
        | "construction"
        | "agriculture",
      asOf: string,
    ) =>
      repository().findEffectiveByCountry({
        applicationScope,
        asOf,
        countryIso3: "BGD",
        powerKw: 150,
      });
    const [beforeTruck, beforeBus, truck, bus, construction, agriculture] =
      await Promise.all([
        query("on-road-truck", "2022-07-25"),
        query("on-road-bus", "2022-07-25"),
        query("on-road-truck", "2022-07-26"),
        query("on-road-bus", "2022-07-26"),
        query("construction", "2022-07-26"),
        query("agriculture", "2022-07-26"),
      ]);

    expect([beforeTruck, beforeBus, construction, agriculture]).toEqual([
      [],
      [],
      [],
      [],
    ]);
    for (const rows of [truck, bus]) {
      expect(rows).toHaveLength(4);
      expect(
        new Map(
          rows.map((row) => [
            row.limit.pollutantCode,
            Number(row.limit.limitValue),
          ]),
        ),
      ).toEqual(
        new Map([
          ["CO", 4],
          ["HC", 1.1],
          ["NOX", 7],
          ["PM", 0.15],
        ]),
      );
      expect(
        rows.every(
          (row) =>
            row.regulationId ===
              acceptanceFixtureIds.regulation.bangladeshHeavyDiesel2022 &&
            row.citationCode ===
              "Air Pollution (Control) Rules 2022, Schedule 2, item 1(b)" &&
            row.status === "effective" &&
            row.limit.testCycleCode === "88/77/EEC (91/542/EEC)" &&
            row.limit.unitCode === "g/kWh" &&
            row.limit.validFrom === "2022-07-26" &&
            row.limit.sourceUrl ===
              "https://www.dpp.gov.bd/upload_file/gazettes/45501_95134.pdf",
        ),
      ).toBe(true);
    }

    const measurementBasis =
      "Bangladesh Air Pollution (Control) Rules 2022 Schedule 2 item 1(b): new compression-ignition heavy-duty vehicle with gross vehicle weight >3,500 kg; 88/77/EEC as amended by 91/542/EEC; effective immediately on 2022-07-26";
    const rawRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
        acceptanceFixtureIds.regulation.bangladeshHeavyDiesel2022,
    );
    expect(rawRows).toHaveLength(8);
    expect(
      rawRows.every(
        (row) =>
          row.measurementBasis === measurementBasis &&
          row.testCycleCode === "88/77/EEC (91/542/EEC)" &&
          row.validFrom === "2022-07-26" &&
          row.verifiedAt.toISOString() === "2026-08-10T14:35:00.000Z",
      ),
    ).toBe(true);
    expect(
      fixtureRegulations.find(
        ({ id }) =>
          id === acceptanceFixtureIds.regulation.bangladeshHeavyDiesel2022,
      ),
    ).toMatchObject({
      dataSourceId:
        acceptanceFixtureIds.source.bangladeshAirPollutionRules2022,
      effectiveFrom: "2022-07-26",
      jurisdictionId: acceptanceFixtureIds.jurisdiction.bangladesh,
      status: "effective",
      verifiedAt: new Date("2026-08-10T14:35:00.000Z"),
    });
  });

  it("BOL switches to its four-limit ECE 49 road path on 2022-04-01", async () => {
    const query = (
      applicationScope:
        | "on-road-truck"
        | "on-road-bus"
        | "construction"
        | "agriculture",
      asOf: string,
    ) =>
      repository().findEffectiveByCountry({
        applicationScope,
        asOf,
        countryIso3: "BOL",
        powerKw: 150,
      });
    const [beforeTruck, beforeBus, truck, bus, construction, agriculture] =
      await Promise.all([
        query("on-road-truck", "2022-03-31"),
        query("on-road-bus", "2022-03-31"),
        query("on-road-truck", "2022-04-01"),
        query("on-road-bus", "2022-04-01"),
        query("construction", "2022-04-01"),
        query("agriculture", "2022-04-01"),
      ]);

    expect([beforeTruck, beforeBus, construction, agriculture]).toEqual([
      [],
      [],
      [],
      [],
    ]);
    for (const rows of [truck, bus]) {
      expect(rows).toHaveLength(4);
      expect(
        new Map(
          rows.map((row) => [
            row.limit.pollutantCode,
            Number(row.limit.limitValue),
          ]),
        ),
      ).toEqual(
        new Map([
          ["CO", 4],
          ["HC", 1.1],
          ["NOX", 7],
          ["PM", 0.15],
        ]),
      );
      expect(
        rows.every(
          (row) =>
            row.regulationId ===
              acceptanceFixtureIds.regulation.boliviaRm064HeavyDiesel &&
            row.citationCode ===
              "Resolución Ministerial N° 064/2022, Annex III, Table 4" &&
            row.status === "effective" &&
            row.limit.testCycleCode === "ECE 49" &&
            row.limit.unitCode === "g/kWh" &&
            row.limit.validFrom === "2022-04-01" &&
            row.limit.sourceUrl ===
              "https://www.oopp.gob.bo/wp-content/uploads/2022/04/RM-064-Y-REGLAMENTO.pdf",
        ),
      ).toBe(true);
    }

    const measurementBasis =
      "Bolivia RM 064/2022 Annex III Table 4: model-year 2017 and later N2/N3/M2/M3 diesel vehicle with gross vehicle weight >3,500 kg; ECE 49 representative route. The US heavy-duty transient route is an alternative and is not cumulative";
    const rawRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
        acceptanceFixtureIds.regulation.boliviaRm064HeavyDiesel,
    );
    expect(rawRows).toHaveLength(8);
    expect(
      rawRows.every(
        (row) =>
          row.measurementBasis === measurementBasis &&
          row.testCycleCode === "ECE 49" &&
          row.validFrom === "2022-04-01" &&
          row.verifiedAt.toISOString() === "2026-08-10T14:35:00.000Z",
      ),
    ).toBe(true);
    expect(
      fixtureRegulations.find(
        ({ id }) =>
          id === acceptanceFixtureIds.regulation.boliviaRm064HeavyDiesel,
      ),
    ).toMatchObject({
      dataSourceId: acceptanceFixtureIds.source.boliviaRm064Regulation,
      effectiveFrom: "2022-04-01",
      jurisdictionId: acceptanceFixtureIds.jurisdiction.bolivia,
      status: "effective",
      verifiedAt: new Date("2026-08-10T14:35:00.000Z"),
    });
  });

  it("NGA fails closed because Schedule VIII does not close the PM and certification-cycle gates", async () => {
    const rows = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map(
        (applicationScope) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf: "2026-08-11",
            countryIso3: "NGA",
            powerKw: 150,
          }),
      ),
    );

    expect(rows).toEqual([[], [], [], []]);
    expect(
      fixtureRegulations.some(
        (regulation) =>
          regulation.id ===
          acceptanceFixtureIds.regulation.nigeriaVehicularEmissions2011,
      ),
    ).toBe(false);
    expect(
      buildFixtureLimits().some(
        (row) =>
          row.regulationId ===
          acceptanceFixtureIds.regulation.nigeriaVehicularEmissions2011,
      ),
    ).toBe(false);

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-11",
      iso3: "NGA",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "NG-NATIONAL",
        validFrom: "2026-08-11",
        source: {
          url: "https://nesrea.gov.ng/wp-content/uploads/2025/05/Control_of_Vehicular_Emissions_from_Petrol_and_Diesel_Engines_Regulation-2011-.pdf",
        },
        membershipSource: {
          url: "https://nesrea.gov.ng/laws-regulations/",
        },
      },
    ]);
  });

  it.each([
    [
      "EGY",
      "EG-NATIONAL",
      "https://www.eeaa.gov.eg/Uploads/Laws/Files/20221010124857366.doc",
      "https://www.eeaa.gov.eg/Uploads/Laws/Files/20250526101230761.pdf",
      "2026-08-10",
    ],
    [
      "GHA",
      "GH-NATIONAL",
      "https://repository.parliament.gh/server/api/core/bitstreams/1e06a2ff-8e7a-494e-a4d9-795f9c89002e/content",
      "https://webstore.gsa.gov.gh/detail.php?ID=1756",
      "2026-08-10",
    ],
  ] as const)("%s preserves no-data without a publishable heavy-duty limit table", async (iso3, code, sourceUrl, membershipUrl, asOf) => {
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3: iso3,
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({
      asOf,
      iso3,
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code,
        validFrom: asOf,
        source: { url: sourceUrl },
        membershipSource: { url: membershipUrl },
      },
    ]);
  });

  it("PAK applies the S.R.O. 72(KE)/2009 Pak-II ECE-R-49 truck/bus table from 2012-07-01", async () => {
    const [before, truck, bus, construction, agriculture] = await Promise.all([
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2012-06-30",
        countryIso3: "PAK",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2012-07-01",
        countryIso3: "PAK",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-bus",
        asOf: "2012-07-01",
        countryIso3: "PAK",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-08-10",
        countryIso3: "PAK",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2026-08-10",
        countryIso3: "PAK",
        powerKw: 150,
      }),
    ]);
    const values = new Map(
      truck.map((row) => [
        row.limit.pollutantCode,
        Number(row.limit.limitValue),
      ]),
    );
    expect(before).toEqual([]);
    expect(truck).toHaveLength(4);
    expect(bus).toHaveLength(4);
    expect(construction).toEqual([]);
    expect(agriculture).toEqual([]);
    expect(values).toEqual(
      new Map([
        ["CO", 4],
        ["HC", 1.1],
        ["NOX", 7],
        ["PM", 0.15],
      ]),
    );
    expect(
      [...truck, ...bus].every(
        (row) =>
          row.regulationId ===
            acceptanceFixtureIds.regulation.pakistanHeavyDieselPakIi &&
          row.limit.testCycleCode === "ECE-R-49" &&
          row.limit.unitCode === "g/kWh",
      ),
    ).toBe(true);
    expect(
      buildFixtureLimits()
        .filter(
          (row) =>
            row.regulationId ===
            acceptanceFixtureIds.regulation.pakistanHeavyDieselPakIi,
        )
        .every(
          (row) =>
            row.measurementBasis?.includes("Trucks and Buses") === true &&
            row.measurementBasis?.includes(
              "all imported and locally manufactured",
            ) === true,
        ),
    ).toBe(true);
    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({ asOf: "2012-07-01", iso3: "PAK" });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "PK-NATIONAL",
        membershipSource: {
          url: "https://www.yumpu.com/it/document/view/46322181/sro-72ke-2009-pakistan-standards-and-quality-control-authority",
        },
        source: {
          url: "https://www.mocc.gov.pk/Detail/MDUzMDI1OGItYWYzZC00NzQ0LTlhZWItZjYzY2RkOTkyZGVh",
        },
        validFrom: "2012-07-01",
      },
    ]);
  });

  it("locks the Pakistan S.R.O. 72 government index and Gazette-scan metadata", () => {
    const sourceById = new Map(
      fixtureSources.map((source) => [source.id, source]),
    );
    const verifiedAt = new Date("2026-08-10T16:28:30.000Z");
    expect(
      sourceById.get(acceptanceFixtureIds.source.pakistanSro72OfficialIndex),
    ).toMatchObject({
      publishedOn: "2009-08-18",
      sourceType: "official-regulation",
      url: "https://www.mocc.gov.pk/Detail/MDUzMDI1OGItYWYzZC00NzQ0LTlhZWItZjYzY2RkOTkyZGVh",
      verifiedAt,
    });
    expect(
      sourceById.get(acceptanceFixtureIds.source.pakistanSro72GazetteScan),
    ).toMatchObject({
      publishedOn: "2009-08-18",
      sourceType: "official-regulation",
      url: "https://www.yumpu.com/it/document/view/46322181/sro-72ke-2009-pakistan-standards-and-quality-control-authority",
      verifiedAt,
    });
  });

  it("ISR publishes CY2026 Euro VI road and construction-only Stage V paths", async () => {
    const [
      roadBefore,
      constructionBefore,
      truck,
      bus,
      construction150,
      construction560,
      constructionAbove560,
      agriculture,
    ] = await Promise.all([
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2025-12-31",
        countryIso3: "ISR",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2025-12-31",
        countryIso3: "ISR",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2026-01-01",
        countryIso3: "ISR",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-bus",
        asOf: "2026-01-01",
        countryIso3: "ISR",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-01-01",
        countryIso3: "ISR",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-01-01",
        countryIso3: "ISR",
        powerKw: 560,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-01-01",
        countryIso3: "ISR",
        powerKw: 560.001,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2026-08-10",
        countryIso3: "ISR",
        powerKw: 150,
      }),
    ]);
    const roadValues = new Map(
      truck.map((row) => [
        `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
        Number(row.limit.limitValue),
      ]),
    );
    const nonRoadValues = (rows: typeof construction150) =>
      new Map(
        rows.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
    expect(roadBefore).toEqual([]);
    expect(constructionBefore).toEqual([]);
    expect(truck).toHaveLength(12);
    expect(bus).toHaveLength(12);
    expect(roadValues.get("WHSC:NOX")).toBe(400);
    expect(roadValues.get("WHSC:PN")).toBe(800);
    expect(roadValues.get("WHTC:NOX")).toBe(460);
    expect(roadValues.get("WHTC:PN")).toBe(600);
    expect(construction150).toHaveLength(5);
    expect(
      construction150.every(
        (row) => row.limit.testCycleCode === "NRSC/NRTC",
      ),
    ).toBe(true);
    expect(nonRoadValues(construction150).get("NOX")).toBe(0.4);
    expect(nonRoadValues(construction150).get("PN")).toBe(1000);
    expect(construction560).toHaveLength(5);
    expect(nonRoadValues(construction560).get("NOX")).toBe(0.4);
    expect(nonRoadValues(construction560).get("PM")).toBe(0.015);
    expect(constructionAbove560).toHaveLength(4);
    expect(nonRoadValues(constructionAbove560).get("NOX")).toBe(3.5);
    expect(nonRoadValues(constructionAbove560).get("PM")).toBe(0.045);
    expect(agriculture).toEqual([]);

    const israelFixtureRows = buildFixtureLimits().filter((row) =>
      [
        acceptanceFixtureIds.regulation.israelRoadEuroVi2026,
        acceptanceFixtureIds.regulation.israelConstructionStageV2026,
      ].includes(row.regulationId),
    );
    expect(israelFixtureRows).toHaveLength(52);
    expect(
      israelFixtureRows.every(
        (row) =>
          row.measurementBasis?.includes("alternative") === true &&
          row.measurementBasis?.includes("not cumulative") === true,
      ),
    ).toBe(true);

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({ asOf: "2026-01-01", iso3: "ISR" });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "IL-NATIONAL",
        membershipSource: {
          url: "https://www.gov.il/BlobFolder/policy/imr_nrmm_2026/he/000201.docx",
        },
        source: {
          url: "https://www.gov.il/BlobFolder/policy/imr_rr_m_n_o_2026/he/000211.docx",
        },
        validFrom: "2026-01-01",
      },
    ]);
  });

  it("locks the two current Israel IMR source records", () => {
    const sourceById = new Map(
      fixtureSources.map((source) => [source.id, source]),
    );
    const verifiedAt = new Date("2026-08-10T16:40:00.000Z");
    for (const [sourceId, url] of [
      [
        acceptanceFixtureIds.source.israelRoadImr2026,
        "https://www.gov.il/BlobFolder/policy/imr_rr_m_n_o_2026/he/000211.docx",
      ],
      [
        acceptanceFixtureIds.source.israelNrmmImr2026,
        "https://www.gov.il/BlobFolder/policy/imr_nrmm_2026/he/000201.docx",
      ],
    ] as const) {
      expect(sourceById.get(sourceId)).toMatchObject({
        publishedOn: "2025-09-25",
        publisher: "Israel Ministry of Transport and Road Safety",
        sourceType: "official-regulation",
        url,
        verifiedAt,
      });
    }
  });

  it("locks the eight current QAT/KWT/OMN/JOR source records", () => {
    const sourceById = new Map(
      fixtureSources.map((source) => [source.id, source]),
    );
    const verifiedAt = new Date("2026-08-10T18:48:04.000Z");
    const expectedSources = [
      [
        acceptanceFixtureIds.source.qatarEuro5Policy2023,
        {
          publishedOn: "2021-11-08",
          publisher: "Qatar Ministry of Transport",
          sourceType: "government-notice",
          title:
            "Ministry to Apply EURO5-Equivalent Clean Diesel Fuel Policy for Buses, Trucks in 2023",
          url: "https://www.mot.gov.qa/en/news/ministry-apply-euro5-equivalent-clean-diesel-fuel-policy-buses-trucks-2023",
        },
      ],
      [
        acceptanceFixtureIds.source.qatarTechnicalRegulationsDecision125,
        {
          publishedOn: "2019-06-20",
          publisher: "Qatar Ministry of Justice / Al Meezan Legal Portal",
          sourceType: "official-regulation",
          title:
            "Ministerial Decision No. 125 of 2019 Adopting Qatari Technical Regulations",
          url: "https://www.almeezan.qa/LawPage.aspx?id=8020&language=ar",
        },
      ],
      [
        acceptanceFixtureIds.source.kuwaitGulfStandardsDecision372,
        {
          publishedOn: "1992-11-15",
          publisher:
            "Kuwait Ministry of Commerce and Industry / Kuwait Today / Public Authority for Industry",
          sourceType: "official-regulation",
          title:
            "Ministerial Decision No. 372/1992 Adopting Gulf Standards as Kuwaiti Standards",
          url: "https://ksm.pai.gov.kw/_vti_bin/Store_WCF/Store.svc/RetrieveBinaryDocumentForPDFViewerMinisterial?docid=39",
        },
      ],
      [
        acceptanceFixtureIds.source.kuwaitTechnicalRegulationsDecision44,
        {
          publishedOn: "2015-11-29",
          publisher: "Kuwait Public Authority for Industry",
          sourceType: "official-regulation",
          title:
            "Ministerial Resolution No. 44/2015 and List of Adopted Standards and Technical Regulations",
          url: "https://www.pai.gov.kw/en/documents",
        },
      ],
      [
        acceptanceFixtureIds.source.omanBindingVehicleStandardsDecision120,
        {
          publishedOn: "2024-04-07",
          publisher:
            "Oman Ministry of Justice and Legal Affairs / Official Gazette",
          sourceType: "official-regulation",
          title:
            "Official Gazette No. 1540 — Ministerial Decision No. 120/2024 Considering GCC Standards Binding Omani Standards",
          url: "https://www.mjla.gov.om/images/legislation/file/Book699179.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.omanGsoMotorVehicleRegulationsMy2026,
        {
          publishedOn: "2025-01-02",
          publisher: "GCC Standardization Organization (GSO)",
          sourceType: "official-regulation",
          title:
            "List of GSO Technical Regulations for Motor Vehicles (2026 Model Year), MY2026-D5",
          url: "https://www.gso.org.sa/wp-content/uploads/2025/01/GSO-Technical-Regulations-MV-2026-MY-D5.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.jordanTransportGreenGrowthPlan,
        {
          publishedOn: null,
          publisher: "Jordan Ministry of Environment",
          sourceType: "government-notice",
          title: "Transport Sector Green Growth National Action Plan 2021–2025",
          url: "http://moenv.gov.jo/ebv4.0/root_storage/en/eb_list_page/2022_jordan_transport_v10.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.jordanTransportEmissionsStandardsCatalogue,
        {
          publishedOn: null,
          publisher: "Jordan Standards and Metrology Organization",
          sourceType: "government-notice",
          title:
            "JSMO Standards Catalogue — Transport Exhaust Emissions (JS 1053:1998 and JS 1054:1998)",
          url: "https://eservice.jsmo.gov.jo/en/Standards/IcsAmfn/1304050",
        },
      ],
    ] as const;

    expect(expectedSources.map(([sourceId]) => sourceId)).toEqual([
      "10000000-0000-4000-8000-000000000513",
      "10000000-0000-4000-8000-000000000514",
      "10000000-0000-4000-8000-000000000515",
      "10000000-0000-4000-8000-000000000516",
      "10000000-0000-4000-8000-000000000517",
      "10000000-0000-4000-8000-000000000518",
      "10000000-0000-4000-8000-000000000519",
      "10000000-0000-4000-8000-000000000520",
    ]);
    for (const [sourceId, metadata] of expectedSources) {
      expect(sourceById.get(sourceId)).toMatchObject({
        ...metadata,
        verifiedAt,
      });
    }
    const sourceAliases = Object.keys(acceptanceFixtureIds.source);
    for (const retiredAlias of [
      "qatarEnvironment",
      "qatarCommerce",
      "kuwaitEnvironment",
      "kuwaitLegalPortal",
      "omanEnvironment",
      "omanLegislation",
      "jordanEnvironment",
      "jordanTransport",
    ]) {
      expect(sourceAliases).not.toContain(retiredAlias);
    }
  });

  it.each([
    [
      "QAT",
      "QA-NATIONAL",
      acceptanceFixtureIds.jurisdiction.qatar,
      acceptanceFixtureIds.source.qatarEuro5Policy2023,
      acceptanceFixtureIds.source.qatarTechnicalRegulationsDecision125,
    ],
    [
      "KWT",
      "KW-NATIONAL",
      acceptanceFixtureIds.jurisdiction.kuwait,
      acceptanceFixtureIds.source.kuwaitGulfStandardsDecision372,
      acceptanceFixtureIds.source.kuwaitTechnicalRegulationsDecision44,
    ],
    [
      "OMN",
      "OM-NATIONAL",
      acceptanceFixtureIds.jurisdiction.oman,
      acceptanceFixtureIds.source.omanBindingVehicleStandardsDecision120,
      acceptanceFixtureIds.source.omanGsoMotorVehicleRegulationsMy2026,
    ],
    [
      "JOR",
      "JO-NATIONAL",
      acceptanceFixtureIds.jurisdiction.jordan,
      acceptanceFixtureIds.source.jordanTransportGreenGrowthPlan,
      acceptanceFixtureIds.source.jordanTransportEmissionsStandardsCatalogue,
    ],
  ] as const)(
    "%s preserves an exact two-source no-data graph without regulations",
    async (
      iso3,
      code,
      jurisdictionId,
      jurisdictionSourceId,
      membershipSourceId,
    ) => {
      const results = await Promise.all(
        ([
          "on-road-truck",
          "on-road-bus",
          "construction",
          "agriculture",
        ] as const).map((applicationScope) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf: "2026-08-09",
            countryIso3: iso3,
            powerKw: 150,
          }),
        ),
      );
      expect(results).toEqual([[], [], [], []]);

      const jurisdiction = fixtureJurisdictions.find(
        ({ id }) => id === jurisdictionId,
      );
      const memberships = fixtureCountryJurisdictions.filter(
        ({ countryIso3 }) => countryIso3 === iso3,
      );
      expect(jurisdiction).toMatchObject({
        dataSourceId: jurisdictionSourceId,
        id: jurisdictionId,
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({
        dataSourceId: membershipSourceId,
        jurisdictionId,
        validFrom: "2026-08-09",
      });
      expect(
        new Set([jurisdiction?.dataSourceId, memberships[0]?.dataSourceId]),
      ).toEqual(new Set([jurisdictionSourceId, membershipSourceId]));
      expect(
        fixtureRegulations.filter(
          (regulation) => regulation.jurisdictionId === jurisdictionId,
        ),
      ).toEqual([]);

      const details = await createCountryRepository(
        testDatabase.database,
      ).findDetailsByIso3({
        asOf: "2026-08-09",
        iso3,
      });
      expect(details?.jurisdictions).toMatchObject([
        {
          code,
          membershipSource: { id: membershipSourceId },
          source: { id: jurisdictionSourceId },
          validFrom: "2026-08-09",
        },
      ]);
      expect(details?.regulations).toEqual([]);
    },
  );

  it("LKA applies Gazette 2079/42 heavy-road and construction limits without extending them to agriculture", async () => {
    const before = await Promise.all([
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2018-07-12",
        countryIso3: "LKA",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2018-07-12",
        countryIso3: "LKA",
        powerKw: 150,
      }),
    ]);
    expect(before).toEqual([[], []]);

    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2018-07-13",
        countryIso3: "LKA",
        powerKw: 150,
      });
      expect(rows).toHaveLength(5);
      expect(
        new Map(
          rows.map((row) => [
            row.limit.pollutantCode,
            Number(row.limit.limitValue),
          ]),
        ),
      ).toEqual(
        new Map([
          ["CO", 1.5],
          ["THC", 0.46],
          ["NOX", 3.5],
          ["PM", 0.02],
          ["OPACITY", 0.5],
        ]),
      );
      expect(
        rows.every(
          (row) =>
            row.regulationId ===
              acceptanceFixtureIds.regulation.sriLankaVehicleEmission2018 &&
            row.citationCode ===
              "Gazette 2079/42 Third Schedule, Tables 5-6" &&
            row.limit.sourceUrl ===
              "https://documents.gov.lk/view/egz/2018/7/2079-42_E.pdf" &&
            row.limit.validFrom === "2018-07-13",
        ),
      ).toBe(true);
      expect(
        new Set(rows.map((row) => row.source.verifiedAt.toISOString())),
      ).toEqual(new Set(["2026-08-10T17:38:18.000Z"]));
      expect(
        new Map(
          rows.map((row) => [
            row.limit.pollutantCode,
            [row.limit.unitCode, row.limit.testCycleCode],
          ]),
        ),
      ).toEqual(
        new Map([
          ["CO", ["g/kWh", "ESC"]],
          ["THC", ["g/kWh", "ESC"]],
          ["NOX", ["g/kWh", "ESC"]],
          ["PM", ["g/kWh", "ESC"]],
          ["OPACITY", ["m-1", "FREE_ACCELERATION"]],
        ]),
      );
    }

    const constructionPowers = [
      7.999,
      8,
      18.999,
      19,
      36.999,
      37,
      74.999,
      75,
      129.999,
      130,
    ] as const;
    const constructionRows = await Promise.all(
      constructionPowers.map((powerKw) =>
        repository().findEffectiveByCountry({
          applicationScope: "construction",
          asOf: "2018-07-13",
          countryIso3: "LKA",
          powerKw,
        }),
      ),
    );
    expect(constructionRows.map((rows) => rows.length)).toEqual(
      constructionPowers.map(() => 4),
    );
    expect(
      constructionRows.map((rows) =>
        Number(
          rows.find((row) => row.limit.pollutantCode === "CO")?.limit
            .limitValue,
        ),
      ),
    ).toEqual([8, 6.6, 6.6, 5.5, 5.5, 5, 5, 5, 5, 3.5]);
    expect(
      constructionRows.map((rows) =>
        Number(
          rows.find((row) => row.limit.pollutantCode === "HC+NOx")?.limit
            .limitValue,
        ),
      ),
    ).toEqual([7.5, 7.5, 7.5, 7.5, 7.5, 4.7, 4.7, 4, 4, 4]);
    expect(
      constructionRows.map((rows) =>
        Number(
          rows.find((row) => row.limit.pollutantCode === "PM")?.limit
            .limitValue,
        ),
      ),
    ).toEqual([0.8, 0.8, 0.8, 0.6, 0.6, 0.4, 0.4, 0.3, 0.3, 0.2]);
    expect(
      constructionRows.every(
        (rows) =>
          rows.map((row) => row.limit.pollutantCode).sort().join(",") ===
            "CO,HC+NOx,OPACITY,PM" &&
          rows.every(
            (row) =>
              row.limit.testCycleCode ===
                "ISO 8178-4 C1 (variable-speed) OR D2 (constant-speed)",
          ) &&
          Number(
            rows.find((row) => row.limit.pollutantCode === "OPACITY")
              ?.limit.limitValue,
          ) === 3.25,
      ),
    ).toBe(true);
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2026-08-10",
        countryIso3: "LKA",
        powerKw: 150,
      }),
    ).resolves.toEqual([]);

    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
        acceptanceFixtureIds.regulation.sriLankaVehicleEmission2018,
    );
    expect(fixtureRows).toHaveLength(34);
    expect(
      fixtureRows.filter(
        (row) =>
          row.applicationScope === "on-road-truck" ||
          row.applicationScope === "on-road-bus",
      ),
    ).toHaveLength(10);
    expect(
      fixtureRows.filter((row) => row.applicationScope === "construction"),
    ).toHaveLength(24);
    expect(
      fixtureRows.every(
        (row) =>
          row.measurementBasis?.includes(
            "letter-of-credit grandfathering",
          ) === true &&
          row.measurementBasis.includes("2018-10-31"),
      ),
    ).toBe(true);
    expect(
      fixtureRows
        .filter((row) => row.applicationScope === "construction")
        .every(
          (row) =>
            row.measurementBasis?.includes(
              "alternatives and not cumulative",
            ) === true,
        ),
    ).toBe(true);
    expect(
      fixtureRows.filter((row) => row.applicationScope === "agriculture"),
    ).toEqual([]);
    expect(
      fixtureRegulations.find(
        (row) =>
          row.id ===
          acceptanceFixtureIds.regulation.sriLankaVehicleEmission2018,
      ),
    ).toMatchObject({
      adoptedOn: "2018-07-10",
      effectiveFrom: "2018-07-13",
      status: "effective",
      summary: expect.stringContaining(
        "letter of credit established on or before 2018-07-12",
      ),
    });
    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3: "LKA",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "LK-NATIONAL",
        membershipSource: {
          url: "https://documents.gov.lk/view/egz/2018/7/2079-70_E.pdf",
        },
        source: {
          url: "https://documents.gov.lk/view/egz/2018/7/2079-42_E.pdf",
        },
        validFrom: "2018-07-13",
      },
    ]);
  });

  it("locks the KHM, LAO, LKA, MMR, and MNG official evidence metadata", () => {
    const sourceById = new Map(
      fixtureSources.map((source) => [source.id, source]),
    );
    const verifiedAt = new Date("2026-08-10T17:38:18.000Z");
    const expectedSources = [
      {
        id: acceptanceFixtureIds.source.cambodiaEnvironment,
        publishedOn: "2016-06-15",
        publisher:
          "Cambodia Ministry of Industry and Handicraft / Institute of Standards of Cambodia",
        sourceType: "official-regulation",
        title:
          "Prakas No. 150 MIH/2016 on 19 Automotive Technical Regulations",
        url: "https://res.cloudinary.com/dgvyfitu8/image/upload/v1733987381/Prakas_No_150_MIH_2016_on_19_Automotives_Technical_Regulations_bdb6d255a4.pdf",
      },
      {
        id: acceptanceFixtureIds.source.cambodiaTransport,
        publishedOn: "2000-07-01",
        publisher:
          "Royal Government of Cambodia / Ministry of Environment / National Trade Repository",
        sourceType: "official-regulation",
        title:
          "Sub-Decree No. 042 Air Pollution and Noise Disturbance Control",
        url: "https://cambodiantr.gov.kh/en/document/?title=sub-decree-no-042-air-pollution-and-noise-disturbance-control",
      },
      {
        id: acceptanceFixtureIds.source.laosEnvironment,
        publishedOn: "2021-11-16",
        publisher: "Lao National Assembly / Lao Trade Portal",
        sourceType: "official-regulation",
        title: "Law on Inland Vehicles No. 04/NA, dated 16 November 2021",
        url: "https://www.laotradeportal.gov.la/en-gb/site/display/2475",
      },
      {
        id: acceptanceFixtureIds.source.laosTransport,
        publishedOn: "2002-11-11",
        publisher:
          "Lao Ministry of Communication, Transport, Posts and Construction / Lao Trade Portal",
        sourceType: "official-regulation",
        title:
          "Provisions on Technical Standards and Accessories of Vehicles Authorized for Import, Registration and Assembly No. 4312/MCTPC",
        url: "https://www.laotradeportal.gov.la/en-gb/site/display/45",
      },
      {
        id: acceptanceFixtureIds.source.sriLankaEnvironment,
        publishedOn: "2018-07-12",
        publisher:
          "Sri Lanka Department of Government Printing / President of Sri Lanka",
        sourceType: "official-regulation",
        title:
          "Gazette Extraordinary No. 2079/42 — National Environmental (Air Emission, Fuel and Vehicle Importation Standards) amendment",
        url: "https://documents.gov.lk/view/egz/2018/7/2079-42_E.pdf",
      },
      {
        id: acceptanceFixtureIds.source.sriLankaTransport,
        publishedOn: "2018-07-13",
        publisher:
          "Sri Lanka Department of Government Printing / Minister of Development Strategies and International Trade",
        sourceType: "official-regulation",
        title:
          "Gazette Extraordinary No. 2079/70 — Imports and Exports (Control) Regulation No. 2 of 2018",
        url: "https://documents.gov.lk/view/egz/2018/7/2079-70_E.pdf",
      },
      {
        id: acceptanceFixtureIds.source.myanmarEnvironment,
        publishedOn: "2015-12-29",
        publisher:
          "Myanmar Ministry of Environmental Conservation and Forestry / Environmental Conservation Department",
        sourceType: "government-notice",
        title:
          "National Environmental Quality (Emission) Guidelines (Final), Notification No. 615/2015",
        url: "https://www.ecd.gov.mm/national-environmental-quality-emission-guidelines-final/",
      },
      {
        id: acceptanceFixtureIds.source.myanmarTransport,
        publishedOn: "2020-05-26",
        publisher:
          "Republic of the Union of Myanmar / Ministry of Transport and Communications / Road Transport Administration Department",
        sourceType: "official-regulation",
        title:
          "Road Safety and Motor Vehicle Management Law (2020), Pyidaungsu Hluttaw Law No. 6/2020",
        url: "https://www.myanmarrtad.com/?q=en%2Fnode%2F1925",
      },
      {
        id: acceptanceFixtureIds.source.mongoliaEnvironment,
        publishedOn: "2021-05-19",
        publisher: "Government of Mongolia / Legalinfo",
        sourceType: "official-regulation",
        title:
          "АГААР ЧАНАРЫН ТЕХНИКИЙН ЗОХИЦУУЛАЛТ (Air Quality Technical Regulation)",
        url: "https://legalinfo.mn/mn/detail?lawId=16207241573351&showType=1",
      },
      {
        id: acceptanceFixtureIds.source.mongoliaTransport,
        publishedOn: "2021-05-19",
        publisher: "Government of Mongolia / Legalinfo",
        sourceType: "official-regulation",
        title:
          "ТЕХНИКИЙН ЗОХИЦУУЛАЛТ БАТЛАХ ТУХАЙ (Government Resolution No. 148 of 2021)",
        url: "https://legalinfo.mn/mn/detail?lawId=16207241555111&type=3",
      },
    ] as const;

    for (const { id, ...expected } of expectedSources) {
      expect(sourceById.get(id)).toMatchObject({
        ...expected,
        verifiedAt,
      });
    }
  });

  it.each([
    [
      "KHM",
      "KH-NATIONAL",
      "https://res.cloudinary.com/dgvyfitu8/image/upload/v1733987381/Prakas_No_150_MIH_2016_on_19_Automotives_Technical_Regulations_bdb6d255a4.pdf",
      "https://cambodiantr.gov.kh/en/document/?title=sub-decree-no-042-air-pollution-and-noise-disturbance-control",
    ],
    [
      "LAO",
      "LA-NATIONAL",
      "https://www.laotradeportal.gov.la/en-gb/site/display/2475",
      "https://www.laotradeportal.gov.la/en-gb/site/display/45",
    ],
    [
      "MMR",
      "MM-NATIONAL",
      "https://www.ecd.gov.mm/national-environmental-quality-emission-guidelines-final/",
      "https://www.myanmarrtad.com/?q=en%2Fnode%2F1925",
    ],
    [
      "MNG",
      "MN-NATIONAL",
      "https://legalinfo.mn/mn/detail?lawId=16207241573351&showType=1",
      "https://legalinfo.mn/mn/detail?lawId=16207241555111&type=3",
    ],
  ] as const)("%s preserves no-data without a publishable heavy-duty limit table", async (iso3, code, sourceUrl, membershipUrl) => {
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: iso3,
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3,
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code,
        validFrom: "2026-08-10",
        source: { url: sourceUrl },
        membershipSource: { url: membershipUrl },
      },
    ]);
  });

  it.each([
    [
      "CRI",
      "CR-NATIONAL",
      "https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_norma.aspx?nValor1=1&nValor2=81619&nValor3=0&param1=NRM&strTipM=FN",
      "https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_articulo.aspx?nValor1=1&nValor2=73504&nValor3=130675&nValor5=39&param1=NRA",
    ],
    [
      "DOM",
      "DO-NATIONAL",
      "https://ambiente.gob.do/portal-transparencia/wp/download/280/gestion-de-la-calidad-ambiental/3845/reglamento-tecnico-ambental-control-fuentes-moviles-2018.pdf",
      "https://intrant.gob.do/transparencia/phocadownload/PlanEstrategico/MemoriasInstitucionales/Memoria%20Institucional%202022.pdf",
    ],
  ] as const)("%s preserves no-data without a publishable heavy-duty limit table", async (iso3, code, sourceUrl, membershipUrl) => {
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: iso3,
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3,
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code,
        validFrom: "2026-08-10",
        source: { url: sourceUrl },
        membershipSource: { url: membershipUrl },
      },
    ]);
  });

  it("ECU applies the RTE 017 / NTE 2207 ECE-49 heavy-diesel path from 2009-02-07", async () => {
    const [before, truck, bus, construction, agriculture] = await Promise.all([
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2009-02-06",
        countryIso3: "ECU",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2009-02-07",
        countryIso3: "ECU",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-bus",
        asOf: "2009-02-07",
        countryIso3: "ECU",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-08-10",
        countryIso3: "ECU",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2026-08-10",
        countryIso3: "ECU",
        powerKw: 150,
      }),
    ]);
    const values = new Map(
      truck.map((row) => [
        row.limit.pollutantCode,
        Number(row.limit.limitValue),
      ]),
    );
    expect(before).toEqual([]);
    expect(truck).toHaveLength(4);
    expect(bus).toHaveLength(4);
    expect(construction).toEqual([]);
    expect(agriculture).toEqual([]);
    expect(values).toEqual(
      new Map([
        ["CO", 4],
        ["HC", 1.1],
        ["NOX", 7],
        ["PM", 0.15],
      ]),
    );
    expect(
      [...truck, ...bus].every(
        (row) =>
          row.regulationId ===
            acceptanceFixtureIds.regulation.ecuadorHeavyDieselRte017 &&
          row.limit.testCycleCode === "ECE-49",
      ),
    ).toBe(true);
    expect(
      buildFixtureLimits()
        .filter(
          (row) =>
            row.regulationId ===
            acceptanceFixtureIds.regulation.ecuadorHeavyDieselRte017,
        )
        .every(
          (row) =>
            row.measurementBasis?.includes("N2/N3/M2/M3") === true &&
            row.measurementBasis?.includes("not cumulative") === true,
        ),
    ).toBe(true);

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({ asOf: "2009-02-07", iso3: "ECU" });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "EC-NATIONAL",
        membershipSource: {
          url: "https://www.normalizacion.gob.ec/buzon/reglamentos/RTE-017.pdf",
        },
        source: {
          url: "https://www.registroficial.gob.ec/suplemento-no-160/",
        },
        validFrom: "2009-02-07",
      },
    ]);
  });

  it("locks ECU/PAN/CRI/DOM upgraded exact sources and shared verification time", () => {
    const sourceById = new Map(
      fixtureSources.map((source) => [source.id, source]),
    );
    const verifiedAt = new Date("2026-08-10T16:18:20.000Z");
    for (const sourceId of [
      acceptanceFixtureIds.source.ecuadorDieselStandard2207,
      acceptanceFixtureIds.source.ecuadorRte017,
      acceptanceFixtureIds.source.ecuadorRte017Amendment2025,
      acceptanceFixtureIds.source.panamaEnvironment,
      acceptanceFixtureIds.source.panamaTransport,
      acceptanceFixtureIds.source.costaRicaEnvironment,
      acceptanceFixtureIds.source.costaRicaTransport,
      acceptanceFixtureIds.source.dominicanRepublicEnvironment,
      acceptanceFixtureIds.source.dominicanRepublicTransport,
    ]) {
      expect(sourceById.get(sourceId)?.verifiedAt).toEqual(verifiedAt);
    }
    expect(
      sourceById.get(acceptanceFixtureIds.source.ecuadorDieselStandard2207),
    ).toMatchObject({
      publishedOn: "2002-09-30",
      sourceType: "official-regulation",
      url: "https://www.aeade.net/wp-content/uploads/2016/12/2207-1.pdf",
    });
    expect(
      sourceById.get(acceptanceFixtureIds.source.panamaTransport),
    ).toMatchObject({
      publishedOn: "2022-04-25",
      sourceType: "official-regulation",
      url: "https://infojuridica.procuraduria-admon.gob.pa/norma_screen.php?numsec=58095",
    });
    expect(
      sourceById.get(acceptanceFixtureIds.source.costaRicaTransport),
    ).toMatchObject({ publishedOn: "2012-10-26" });
    expect(
      sourceById.get(acceptanceFixtureIds.source.dominicanRepublicTransport),
    ).toMatchObject({
      publishedOn: null,
      sourceType: "government-notice",
      title: expect.stringContaining("Consultas Públicas"),
    });
  });

  it.each([
    [
      "DZA",
      "DZ-NATIONAL",
      "https://www.joradp.dz/FTP/jo-francais/2003/F2003068.pdf",
      "https://www.joradp.dz/FTP/jo-francais/2018/F2018003.pdf",
    ],
    [
      "TUN",
      "TN-NATIONAL",
      "http://www.citet.nat.tn/portail/digitalCollection/DigitalCollectionInlineDownloadHandler.ashx?_cb=20210408113957&documentId=42883&parentDocumentId=40549",
      "https://www.transport.tn/uploads/Loi/Route.pdf",
    ],
    [
      "ETH",
      "ET-NATIONAL",
      "https://motl.gov.et/sites/default/files/resource/5051_Emission%20of%20pollutant%20gas%20Directive.pdf",
      "https://www.motl.gov.et/sites/default/files/resource/emission%20standard.pdf",
    ],
    [
      "CMR",
      "CM-NATIONAL",
      "https://minepded.gov.cm/wp-content/uploads/2021/09/NC-2858.pdf",
      "https://minepded.gov.cm/wp-content/uploads/2020/01/D%C3%89CRET-N%C2%B020112582PM-DU-23-AO%C3%9BT-2011-FIXANT-LES-MODALIT%C3%89S-DE-PROTECTION-DE-L%E2%80%99ATMOSPH%C3%88RE.pdf",
    ],
    [
      "SEN",
      "SN-NATIONAL",
      "https://www.asn.sn/sites/default/files/ASN%20CATALOGUE%202025%20v2_0.pdf",
      "https://www.archives.sn/api/fichiers/3d690f87-c01d-49e9-8fc3-655f40c27d9b?download=1",
    ],
  ] as const)("%s preserves four-scope no-data after five-gate source review", async (iso3, code, sourceUrl, membershipUrl) => {
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-11",
          countryIso3: iso3,
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({
      asOf: "2026-08-11",
      iso3,
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code,
        source: { url: sourceUrl },
        membershipSource: { url: membershipUrl },
        validFrom: "2026-08-11",
      },
    ]);
  });

  it("keeps DZA, ETH, and NGA regulation tombstone IDs out of publishable fixtures", () => {
    const retiredRegulationIds = new Set([
      acceptanceFixtureIds.regulation.algeriaVehicleEmissions2003,
      acceptanceFixtureIds.regulation.ethiopiaVehicleEmission2025,
      acceptanceFixtureIds.regulation.nigeriaVehicularEmissions2011,
    ]);

    expect(
      fixtureRegulations.filter(
        ({ id }) => id !== undefined && retiredRegulationIds.has(id),
      ),
    ).toEqual([]);
    expect(
      buildFixtureLimits().filter(({ regulationId }) =>
        retiredRegulationIds.has(regulationId),
      ),
    ).toEqual([]);
  });

  it("keeps stable source IDs live and limits non-publishable regulation IDs to governance tombstones", () => {
    const fixtureSourceIds = new Set(
      fixtureSources.map(({ id }) => id).filter((id): id is string => id !== undefined),
    );
    expect(new Set(Object.values(acceptanceFixtureIds.source))).toEqual(
      fixtureSourceIds,
    );

    const fixtureRegulationIds = new Set(
      fixtureRegulations
        .map(({ id }) => id)
        .filter((id): id is string => id !== undefined),
    );
    const nonPublishableStableRegulationIds = new Set(
      Object.values(acceptanceFixtureIds.regulation).filter(
        (id) => !fixtureRegulationIds.has(id),
      ),
    );
    expect(nonPublishableStableRegulationIds).toEqual(
      new Set([
        acceptanceFixtureIds.regulation.algeriaVehicleEmissions2003,
        acceptanceFixtureIds.regulation.ethiopiaVehicleEmission2025,
        acceptanceFixtureIds.regulation.nigeriaVehicularEmissions2011,
      ]),
    );
  });

  it("locks the IRN/IRQ/LBN/SYR source refresh graph, UUIDs, and retired identities", () => {
    const refreshedAt = new Date("2026-08-10T18:55:45.000Z");
    const refreshedJurisdictions = [
      {
        countryIso3: "IRN",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.iran,
        membershipSourceId: acceptanceFixtureIds.source.iranArticle4Amendment2024,
        sourceId: acceptanceFixtureIds.source.iranTechnicalPollutionRegulation,
        websiteUrl: "https://nezamat.ir/post-41054/",
      },
      {
        countryIso3: "IRQ",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.iraq,
        membershipSourceId: acceptanceFixtureIds.source.iraqTr167ImplementationNotice2025,
        sourceId: acceptanceFixtureIds.source.iraqTr167AmendmentDecision2024,
        websiteUrl: "https://www.iraqi-standards.org/wan/ns/p/0000018.html",
      },
      {
        countryIso3: "LBN",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.lebanon,
        membershipSourceId: acceptanceFixtureIds.source.lebanonThirdBur2019,
        sourceId: acceptanceFixtureIds.source.lebanonEnvironmentalProtectionLaw444,
        websiteUrl: "https://moe.gov.lb/%D8%A7%D9%84%D9%88%D8%B2%D8%A7%D8%B1%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86-%D9%88%D8%A7%D9%84%D8%A7%D9%86%D8%B8%D9%85%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-444-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9.aspx?lang=ar-LB",
      },
      {
        countryIso3: "SYR",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.syria,
        membershipSourceId: acceptanceFixtureIds.source.syriaVehicleImportNotice2025,
        sourceId: acceptanceFixtureIds.source.syriaEnvironmentLaw12,
        websiteUrl: "https://sana.sy/economy/2238146/",
      },
    ] as const;

    expect(refreshedJurisdictions.map(({ sourceId, membershipSourceId }) => [sourceId, membershipSourceId])).toEqual([
      ["10000000-0000-4000-8000-000000000652", "10000000-0000-4000-8000-000000000653"],
      ["10000000-0000-4000-8000-000000000654", "10000000-0000-4000-8000-000000000655"],
      ["10000000-0000-4000-8000-000000000658", "10000000-0000-4000-8000-000000000659"],
      ["10000000-0000-4000-8000-000000000700", "10000000-0000-4000-8000-000000000701"],
    ]);

    for (const expected of refreshedJurisdictions) {
      expect(
        fixtureJurisdictions.find(({ id }) => id === expected.jurisdictionId),
      ).toMatchObject({
        countryIso3: expected.countryIso3,
        createdAt: refreshedAt,
        dataSourceId: expected.sourceId,
        updatedAt: refreshedAt,
        verifiedAt: refreshedAt,
        websiteUrl: expected.websiteUrl,
      });
      expect(
        fixtureCountryJurisdictions.find(
          ({ countryIso3, jurisdictionId }) =>
            countryIso3 === expected.countryIso3 &&
            jurisdictionId === expected.jurisdictionId,
        ),
      ).toMatchObject({
        createdAt: refreshedAt,
        dataSourceId: expected.membershipSourceId,
        updatedAt: refreshedAt,
        validFrom: "2026-08-10",
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureRegulations.some(
          ({ jurisdictionId }) => jurisdictionId === expected.jurisdictionId,
        ),
      ).toBe(false);
    }

    const sourceAliases = Object.keys(acceptanceFixtureIds.source);
    for (const retiredAlias of [
      "iranEnvironment",
      "iranTransport",
      "iraqEnvironment",
      "iraqTransport",
      "lebanonEnvironment",
      "lebanonTransport",
      "syriaEnvironment",
      "syriaTransport",
    ]) {
      expect(sourceAliases).not.toContain(retiredAlias);
    }

    const sourceUrls = fixtureSources.map(({ url }) => url);
    for (const retiredUrl of [
      "https://nezamat.ir/post-40634/",
      "https://moen.gov.iq/en/legislation",
      "https://moen.gov.iq/en/air-quality",
      "https://climatechange.moe.gov.lb/transport",
      "https://unfccc.int/documents/497960",
    ]) {
      expect(sourceUrls).not.toContain(retiredUrl);
    }
  });

  it("locks the BLZ/CUB/GUY/HTI/JAM source refresh graph, stable UUIDs, and no-data boundary", () => {
    const refreshedAt = new Date("2026-08-10T19:36:45.000Z");
    const refreshedJurisdictions = [
      {
        countryIso3: "BLZ",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.belize,
        membershipSourceId: acceptanceFixtureIds.source.belizeTransport,
        sourceId: acceptanceFixtureIds.source.belizeEnvironment,
      },
      {
        countryIso3: "CUB",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.cuba,
        membershipSourceId: acceptanceFixtureIds.source.cubaTransport,
        sourceId: acceptanceFixtureIds.source.cubaEnvironment,
      },
      {
        countryIso3: "GUY",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.guyana,
        membershipSourceId: acceptanceFixtureIds.source.guyanaTransport,
        sourceId: acceptanceFixtureIds.source.guyanaEnvironment,
      },
      {
        countryIso3: "HTI",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.haiti,
        membershipSourceId: acceptanceFixtureIds.source.haitiTransport,
        sourceId: acceptanceFixtureIds.source.haitiEnvironment,
      },
      {
        countryIso3: "JAM",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.jamaica,
        membershipSourceId: acceptanceFixtureIds.source.jamaicaTransport,
        sourceId: acceptanceFixtureIds.source.jamaicaEnvironment,
      },
    ] as const;

    expect(
      refreshedJurisdictions.map(({ sourceId, membershipSourceId }) => [
        sourceId,
        membershipSourceId,
      ]),
    ).toEqual([
      ["10000000-0000-4000-8000-000000000618", "10000000-0000-4000-8000-000000000619"],
      ["10000000-0000-4000-8000-000000000630", "10000000-0000-4000-8000-000000000631"],
      ["10000000-0000-4000-8000-000000000648", "10000000-0000-4000-8000-000000000649"],
      ["10000000-0000-4000-8000-000000000650", "10000000-0000-4000-8000-000000000651"],
      ["10000000-0000-4000-8000-000000000656", "10000000-0000-4000-8000-000000000657"],
    ]);
    expect(refreshedJurisdictions.map(({ jurisdictionId }) => jurisdictionId)).toEqual([
      "10000000-0000-4000-8000-000000000618",
      "10000000-0000-4000-8000-000000000624",
      "10000000-0000-4000-8000-000000000633",
      "10000000-0000-4000-8000-000000000634",
      "10000000-0000-4000-8000-000000000637",
    ]);

    for (const expected of refreshedJurisdictions) {
      const sourceRecords = fixtureSources.filter(
        ({ id }) =>
          id === expected.sourceId || id === expected.membershipSourceId,
      );
      expect(sourceRecords).toHaveLength(2);
      expect(
        sourceRecords.every(
          ({ createdAt, updatedAt, verifiedAt }) =>
            createdAt?.toISOString() === refreshedAt.toISOString() &&
            updatedAt?.toISOString() === refreshedAt.toISOString() &&
            verifiedAt?.toISOString() === refreshedAt.toISOString(),
        ),
      ).toBe(true);

      expect(
        fixtureJurisdictions.find(({ id }) => id === expected.jurisdictionId),
      ).toMatchObject({
        countryIso3: expected.countryIso3,
        createdAt: refreshedAt,
        dataSourceId: expected.sourceId,
        updatedAt: refreshedAt,
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureCountryJurisdictions.find(
          ({ countryIso3, jurisdictionId }) =>
            countryIso3 === expected.countryIso3 &&
            jurisdictionId === expected.jurisdictionId,
        ),
      ).toMatchObject({
        createdAt: refreshedAt,
        dataSourceId: expected.membershipSourceId,
        updatedAt: refreshedAt,
        validFrom: "2026-08-10",
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureRegulations.some(
          ({ jurisdictionId }) => jurisdictionId === expected.jurisdictionId,
        ),
      ).toBe(false);
    }
  });

  it("limits metadata-only publication to explicitly accepted regulation identities", () => {
    expect(acceptedLimitUnavailableRegulationIds).toEqual([
      acceptanceFixtureIds.regulation.ugandaAirQuality2024,
      acceptanceFixtureIds.regulation.indiaTrem2026Draft,
    ]);
  });

  it.each([
    [
      acceptanceFixtureIds.source.algeriaEnvironment,
      {
        publishedOn: "2003-11-09",
        publisher:
          "Journal officiel de la République algérienne démocratique et populaire / Secrétariat général du Gouvernement",
        sourceType: "official-regulation",
        title:
          "Décret exécutif n° 03-410 du 5 novembre 2003 fixant les seuils limites des émissions des fumées, des gaz toxiques et des bruits par les véhicules automobiles",
        url: "https://www.joradp.dz/FTP/jo-francais/2003/F2003068.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.algeriaTransport,
      {
        publishedOn: "2018-01-24",
        publisher:
          "Journal officiel de la République algérienne démocratique et populaire / Secrétariat général du Gouvernement",
        sourceType: "official-regulation",
        title:
          "Décret exécutif n° 18-05 du 15 janvier 2018 fixant l’organisation du contrôle de conformité de véhicules et les modalités de son exercice",
        url: "https://www.joradp.dz/FTP/jo-francais/2018/F2018003.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.tunisiaEnvironment,
      {
        publishedOn: "2000-01-28",
        publisher:
          "Présidence de la République tunisienne / Imprimerie officielle de la République tunisienne",
        sourceType: "official-regulation",
        title:
          "Décret n° 2000-147 du 24 janvier 2000 fixant les règles techniques d’équipement et d’aménagement des véhicules",
        url: "http://www.citet.nat.tn/portail/digitalCollection/DigitalCollectionInlineDownloadHandler.ashx?_cb=20210408113957&documentId=42883&parentDocumentId=40549",
      },
    ],
    [
      acceptanceFixtureIds.source.tunisiaTransport,
      {
        publishedOn: "1999-07-26",
        publisher:
          "Imprimerie officielle de la République tunisienne / Ministère du Transport",
        sourceType: "official-regulation",
        title:
          "Loi n° 99-71 du 26 juillet 1999 portant promulgation du Code de la route",
        url: "https://www.transport.tn/uploads/Loi/Route.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.ethiopiaEnvironment,
      {
        publishedOn: "2026-07-25",
        publisher:
          "Federal Democratic Republic of Ethiopia, Ministry of Transport and Logistics",
        sourceType: "official-regulation",
        title:
          "Directive on Emission Control of Pollutants from Vehicle No. 1051/2025",
        url: "https://motl.gov.et/sites/default/files/resource/5051_Emission%20of%20pollutant%20gas%20Directive.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.ethiopiaTransport,
      {
        publishedOn: "2022-12-28",
        publisher: "Institute of Ethiopian Standards",
        sourceType: "government-notice",
        title:
          "ES 6725:2022 — Emission limits — Specification — Part 1 — Road vehicles",
        url: "https://www.motl.gov.et/sites/default/files/resource/emission%20standard.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.cameroonEnvironment,
      {
        publishedOn: null,
        publisher: "Agence des Normes et de la Qualité (ANOR) / MINEPDED",
        sourceType: "government-notice",
        title:
          "NC 2858:2021 — Environnement — Exigences relatives aux rejets atmosphériques",
        url: "https://minepded.gov.cm/wp-content/uploads/2021/09/NC-2858.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.cameroonTransport,
      {
        publishedOn: "2011-08-23",
        publisher: "Premier Ministre, Chef du Gouvernement / MINEPDED",
        sourceType: "official-regulation",
        title:
          "Décret n°2011/2582/PM du 23 août 2011 fixant les modalités de protection de l’atmosphère",
        url: "https://minepded.gov.cm/wp-content/uploads/2020/01/D%C3%89CRET-N%C2%B020112582PM-DU-23-AO%C3%9BT-2011-FIXANT-LES-MODALIT%C3%89S-DE-PROTECTION-DE-L%E2%80%99ATMOSPH%C3%88RE.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.senegalEnvironment,
      {
        publishedOn: null,
        publisher:
          "Association Sénégalaise de Normalisation (ASN), Ministère de l’Industrie et du Commerce",
        sourceType: "government-notice",
        title: "Catalogue des normes Sénégalaises 2025",
        url: "https://www.asn.sn/sites/default/files/ASN%20CATALOGUE%202025%20v2_0.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.senegalTransport,
      {
        publishedOn: "2004-01-19",
        publisher: "République du Sénégal / Archives publiques du Sénégal",
        sourceType: "official-regulation",
        title:
          "Décret n°2004-13 du 19 janvier 2004 fixant les règles d’application de la loi n°2002-30 du 24 décembre 2002 portant Code de la route — Annexe G",
        url: "https://www.archives.sn/api/fichiers/3d690f87-c01d-49e9-8fc3-655f40c27d9b?download=1",
      },
    ],
  ] as const)("preserves exact reviewed source metadata for %s", (sourceId, expected) => {
    expect(fixtureSources.find(({ id }) => id === sourceId)).toMatchObject({
      ...expected,
      verifiedAt: new Date("2026-08-10T17:12:15.000Z"),
    });
  });

  it.each([
    [
      "GTM",
      "GT-NATIONAL",
      "https://www.marn.gob.gt/wpfd_file/normativa-de-combustible-y-vehiculos/",
      "https://mingob.gob.gt/wp-content/uploads/2020/10/Ley-y-Reglamento-Transito.pdf",
    ],
    [
      "HND",
      "HN-NATIONAL",
      "https://www.tsc.gob.hn/web/leyes/Decreto-36-2024.pdf",
      "https://tsc.gob.hn/biblioteca/index.php/leyes/142-ley-de-transito?tmpl=component",
    ],
    [
      "NIC",
      "NI-NATIONAL",
      "https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNormaJuridica.xsp?action=openDocument&documentId=0404E60D225D0ACF062588E2006EE9F8",
      "https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNorma.xsp?action=openDocument&documentId=DDDCD831D507891D06258844005A7F39",
    ],
    [
      "PRY",
      "PY-NATIONAL",
      "https://www.mades.gov.py/wp-content/uploads/2025/03/DECRETO-Nro-1269-de-fecha-13-de-febrero-de-2019.pdf",
      "https://www.mades.gov.py/wp-content/uploads/2025/04/RESOLUCION-N%C2%B0-605-DE-FECHA-29-DE-DICIEMBRE-DE-2021.pdf",
    ],
    [
      "PAN",
      "PA-NATIONAL",
      "https://www.gacetaoficial.gob.pa/pdfTemp/26303/18123.pdf",
      "https://infojuridica.procuraduria-admon.gob.pa/norma_screen.php?numsec=58095",
    ],
  ] as const)("%s preserves no-data without a publishable heavy-duty limit table", async (iso3, code, sourceUrl, membershipUrl) => {
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: iso3,
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3,
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code,
        source: { url: sourceUrl },
        membershipSource: { url: membershipUrl },
      },
    ]);
  });

  it("keeps stable IDs for the five-country Latin America review", () => {
    expect({
      guatemalaEnvironment: acceptanceFixtureIds.source.guatemalaEnvironment,
      guatemalaTransport: acceptanceFixtureIds.source.guatemalaTransport,
      hondurasEnvironment: acceptanceFixtureIds.source.hondurasEnvironment,
      hondurasTransport: acceptanceFixtureIds.source.hondurasTransport,
      nicaraguaEnvironment: acceptanceFixtureIds.source.nicaraguaEnvironment,
      nicaraguaTransport: acceptanceFixtureIds.source.nicaraguaTransport,
      paraguayEnvironment: acceptanceFixtureIds.source.paraguayEnvironment,
      paraguayTransport: acceptanceFixtureIds.source.paraguayTransport,
      uruguayEnvironment: acceptanceFixtureIds.source.uruguayEnvironment,
      uruguayRegulation: acceptanceFixtureIds.regulation.uruguayDecree1352021,
      uruguayTransport: acceptanceFixtureIds.source.uruguayTransport,
    }).toEqual({
      guatemalaEnvironment: "10000000-0000-4000-8000-000000000555",
      guatemalaTransport: "10000000-0000-4000-8000-000000000556",
      hondurasEnvironment: "10000000-0000-4000-8000-000000000557",
      hondurasTransport: "10000000-0000-4000-8000-000000000558",
      nicaraguaEnvironment: "10000000-0000-4000-8000-000000000674",
      nicaraguaTransport: "10000000-0000-4000-8000-000000000675",
      paraguayEnvironment: "10000000-0000-4000-8000-000000000682",
      paraguayTransport: "10000000-0000-4000-8000-000000000683",
      uruguayEnvironment: "10000000-0000-4000-8000-000000000561",
      uruguayRegulation: "10000000-0000-4000-8000-000000000461",
      uruguayTransport: "10000000-0000-4000-8000-000000000562",
    });
  });

  it.each([
    [
      acceptanceFixtureIds.source.guatemalaEnvironment,
      {
        publishedOn: null,
        publisher: "Guatemala Ministry of Environment and Natural Resources",
        sourceType: "government-notice",
        title: "Normativa de Combustible y Vehículos",
        url: "https://www.marn.gob.gt/wpfd_file/normativa-de-combustible-y-vehiculos/",
      },
    ],
    [
      acceptanceFixtureIds.source.guatemalaTransport,
      {
        publishedOn: null,
        publisher: "Guatemala Ministry of the Interior (MINGOB)",
        sourceType: "official-regulation",
        title: "Ley de Tránsito y su Reglamento",
        url: "https://mingob.gob.gt/wp-content/uploads/2020/10/Ley-y-Reglamento-Transito.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.hondurasEnvironment,
      {
        publishedOn: "2024-07-24",
        publisher: "Honduras National Congress / La Gaceta",
        sourceType: "official-regulation",
        title: "Decree 36-2024 — Law for the Rational and Efficient Use of Energy",
        url: "https://www.tsc.gob.hn/web/leyes/Decreto-36-2024.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.hondurasTransport,
      {
        publishedOn: "2006-01-03",
        publisher: "Honduras National Congress / Tribunal Superior de Cuentas",
        sourceType: "official-regulation",
        title: "Decree 205-2005 — Traffic Law",
        url: "https://tsc.gob.hn/biblioteca/index.php/leyes/142-ley-de-transito?tmpl=component",
      },
    ],
    [
      acceptanceFixtureIds.source.nicaraguaEnvironment,
      {
        publishedOn: "1997-06-18",
        publisher: "National Assembly of Nicaragua",
        sourceType: "official-regulation",
        title:
          "Consolidated Decree No. 32-97 — motor vehicle emission control, Articles 10–25",
        url: "https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNormaJuridica.xsp?action=openDocument&documentId=0404E60D225D0ACF062588E2006EE9F8",
      },
    ],
    [
      acceptanceFixtureIds.source.nicaraguaTransport,
      {
        publishedOn: "2022-02-22",
        publisher: "National Assembly of Nicaragua",
        sourceType: "official-regulation",
        title:
          "Consolidated Law No. 431 — vehicle emission-control certificates, Articles 59–60",
        url: "https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNorma.xsp?action=openDocument&documentId=DDDCD831D507891D06258844005A7F39",
      },
    ],
    [
      acceptanceFixtureIds.source.paraguayEnvironment,
      {
        publishedOn: "2019-02-13",
        publisher: "Presidency of the Republic of Paraguay / MADES",
        sourceType: "official-regulation",
        title:
          "Decree No. 1269/2019 implementing Air Quality Law No. 5211/2014",
        url: "https://www.mades.gov.py/wp-content/uploads/2025/03/DECRETO-Nro-1269-de-fecha-13-de-febrero-de-2019.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.paraguayTransport,
      {
        publishedOn: "2021-12-29",
        publisher:
          "Paraguay Ministry of Environment and Sustainable Development (MADES)",
        sourceType: "official-regulation",
        title:
          "Resolución N° 605/2021 — Por la cual se modifican los artículos 10 y 11 de la Resolución N° 78/18 y el artículo 2° de la Resolución N° 98/19 referentes a emisiones de fuentes móviles y se disponen procedimientos para medición de gases provenientes de las mismas",
        url: "https://www.mades.gov.py/wp-content/uploads/2025/04/RESOLUCION-N%C2%B0-605-DE-FECHA-29-DE-DICIEMBRE-DE-2021.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.uruguayEnvironment,
      {
        publishedOn: "2021-05-13",
        publisher: "Uruguay Ministry of Environment",
        sourceType: "official-regulation",
        title: "Decree No. 135/021: Air Quality Regulation",
        url: "https://www.ambiente.gub.uy/oan/documentos/DCA-Decreto_135_021_calidad_de_aire-2021.pdf",
      },
    ],
    [
      acceptanceFixtureIds.source.uruguayTransport,
      {
        publishedOn: "2025-11-13",
        publisher: "Uruguay Ministry of Environment",
        sourceType: "government-notice",
        title: "Vehicle-emission homologation procedure V5",
        url: "https://www.gub.uy/ministerio-ambiente/comunicacion/publicaciones/procedimiento-homologacion-emisiones-vehiculares-v5",
      },
    ],
  ] as const)("locks exact reviewed source metadata for %s", (sourceId, expected) => {
    expect(fixtureSources.find(({ id }) => id === sourceId)).toMatchObject({
      ...expected,
      verifiedAt: new Date("2026-08-10T20:09:01.000Z"),
    });
  });

  it("applies one review timestamp while preserving membership validity boundaries", () => {
    const reviewedAt = new Date("2026-08-10T20:09:01.000Z");
    const sourceIds = new Set([
      acceptanceFixtureIds.source.guatemalaEnvironment,
      acceptanceFixtureIds.source.guatemalaTransport,
      acceptanceFixtureIds.source.hondurasEnvironment,
      acceptanceFixtureIds.source.hondurasTransport,
      acceptanceFixtureIds.source.nicaraguaEnvironment,
      acceptanceFixtureIds.source.nicaraguaTransport,
      acceptanceFixtureIds.source.paraguayEnvironment,
      acceptanceFixtureIds.source.paraguayTransport,
      acceptanceFixtureIds.source.uruguayEnvironment,
      acceptanceFixtureIds.source.uruguayTransport,
    ]);
    const jurisdictionIds = new Set([
      acceptanceFixtureIds.jurisdiction.guatemala,
      acceptanceFixtureIds.jurisdiction.honduras,
      acceptanceFixtureIds.jurisdiction.nicaragua,
      acceptanceFixtureIds.jurisdiction.paraguay,
      acceptanceFixtureIds.jurisdiction.uruguay,
    ]);
    const reviewedSources = fixtureSources.filter(({ id }) =>
      id ? sourceIds.has(id) : false,
    );
    const reviewedJurisdictions = fixtureJurisdictions.filter(({ id }) =>
      id ? jurisdictionIds.has(id) : false,
    );
    const reviewedMemberships = fixtureCountryJurisdictions.filter(
      ({ countryIso3 }) =>
        ["GTM", "HND", "NIC", "PRY", "URY"].includes(countryIso3),
    );

    expect(reviewedSources).toHaveLength(10);
    expect(reviewedJurisdictions).toHaveLength(5);
    expect(reviewedMemberships).toHaveLength(5);
    for (const row of [...reviewedSources, ...reviewedJurisdictions]) {
      expect(row).toMatchObject({
        createdAt: reviewedAt,
        updatedAt: reviewedAt,
        verifiedAt: reviewedAt,
      });
    }
    for (const row of reviewedMemberships) {
      expect(row).toMatchObject({
        createdAt: reviewedAt,
        updatedAt: reviewedAt,
        verifiedAt: reviewedAt,
      });
    }
    expect(
      Object.fromEntries(
        reviewedMemberships.map(({ countryIso3, validFrom }) => [
          countryIso3,
          validFrom,
        ]),
      ),
    ).toEqual({
      GTM: "2026-08-10",
      HND: "2026-08-10",
      NIC: "2026-08-10",
      PRY: "2026-08-10",
      URY: "2023-05-14",
    });
  });

  it("URY publishes Decree 135/021 heavy truck and bus ESC/ETC limits", async () => {
    const before = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2023-05-13",
      countryIso3: "URY",
      powerKw: 150,
    });
    const [truck, bus, construction, agriculture] = await Promise.all(
      ([
        "on-road-truck",
        "on-road-bus",
        "construction",
        "agriculture",
      ] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2023-05-14",
          countryIso3: "URY",
          powerKw: 150,
        }),
      ),
    );
    expect(before).toEqual([]);
    expect([truck.length, bus.length, construction.length, agriculture.length]).toEqual([
      9, 9, 0, 0,
    ]);
    const values = new Map(
      truck.map((row) => [
        `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
        Number(row.limit.limitValue),
      ]),
    );
    expect(Object.fromEntries(values)).toEqual({
      "ESC:CO": 1.5,
      "ESC:HC": 0.46,
      "ESC:NOX": 2,
      "ESC:OPACITY": 0.5,
      "ESC:PM": 0.02,
      "ETC:CO": 4,
      "ETC:NMHC": 0.55,
      "ETC:NOX": 2,
      "ETC:PM": 0.03,
    });
    expect(
      [...truck, ...bus].every(
        (row) =>
          row.regulationId ===
            acceptanceFixtureIds.regulation.uruguayDecree1352021 &&
          row.citationCode ===
            "Decreto 135/021 arts. 42, 45, 48 and Table 17" &&
          row.limit.sourceUrl ===
            "https://www.ambiente.gub.uy/oan/documentos/DCA-Decreto_135_021_calidad_de_aire-2021.pdf" &&
          row.limit.validFrom === "2023-05-14" &&
          row.source.verifiedAt.toISOString() === "2026-08-10T20:09:01.000Z",
      ),
    ).toBe(true);
    const fixtureRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
        acceptanceFixtureIds.regulation.uruguayDecree1352021,
    );
    expect(fixtureRows).toHaveLength(18);
    expect(
      fixtureRows.every(
        (row) =>
          row.dataSourceId === acceptanceFixtureIds.source.uruguayEnvironment &&
          row.validFrom === "2023-05-14" &&
          row.verifiedAt.toISOString() === "2026-08-10T20:09:01.000Z" &&
          ["on-road-truck", "on-road-bus"].includes(row.applicationScope) &&
          (row.testCycleCode === "ESC" || row.testCycleCode === "ETC"),
      ),
    ).toBe(true);
    expect(
      fixtureRegulations.find(
        (row) =>
          row.id === acceptanceFixtureIds.regulation.uruguayDecree1352021,
      ),
    ).toMatchObject({
      adoptedOn: "2021-05-04",
      effectiveFrom: "2023-05-14",
      status: "effective",
      verifiedAt: new Date("2026-08-10T20:09:01.000Z"),
    });

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-10",
      iso3: "URY",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "UY-NATIONAL",
        membershipSource: {
          url: "https://www.gub.uy/ministerio-ambiente/comunicacion/publicaciones/procedimiento-homologacion-emisiones-vehiculares-v5",
        },
        source: {
          url: "https://www.ambiente.gub.uy/oan/documentos/DCA-Decreto_135_021_calidad_de_aire-2021.pdf",
        },
        validFrom: "2023-05-14",
      },
    ]);
  });

  it("publishes Uganda's effective regulation metadata without normalizing its contradictory heavy-duty table", async () => {
    expect(
      fixtureRegulations.find(
        (row) =>
          row.id === acceptanceFixtureIds.regulation.ugandaAirQuality2024,
      ),
    ).toMatchObject({
      adoptedOn: "2023-11-09",
      effectiveFrom: "2024-04-26",
      status: "effective",
      summary: expect.stringContaining("kg/kWh"),
    });
    expect(
      buildFixtureLimits().filter(
        (row) =>
          row.regulationId ===
          acceptanceFixtureIds.regulation.ugandaAirQuality2024,
      ),
    ).toHaveLength(0);

    const regulationSource = fixtureSources.find(
      (row) => row.id === acceptanceFixtureIds.source.ugandaEnvironment,
    );
    const standardSource = fixtureSources.find(
      (row) => row.id === acceptanceFixtureIds.source.ugandaTransport,
    );
    expect(regulationSource).toMatchObject({
      publishedOn: "2024-04-26",
      sourceType: "official-regulation",
      url: "https://www.nema.go.ug/en/wp-content/uploads/2025/01/The-National-Environment-Air-Quality-Standards-Regulations-S.I.-No.-22-of-2024-1.pdf",
      verifiedAt: new Date("2026-08-10T17:13:30.000Z"),
    });
    expect(standardSource).toMatchObject({
      publishedOn: "2022-12-13",
      url: "https://webstore.unbs.go.ug/store.php?preview=&src=5321",
      verifiedAt: new Date("2026-08-10T17:13:30.000Z"),
    });

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({
      asOf: "2026-08-11",
      iso3: "UGA",
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "UG-NATIONAL",
        membershipSource: {
          url: "https://webstore.unbs.go.ug/store.php?preview=&src=5321",
        },
        source: {
          url: "https://www.nema.go.ug/en/wp-content/uploads/2025/01/The-National-Environment-Air-Quality-Standards-Regulations-S.I.-No.-22-of-2024-1.pdf",
        },
        validFrom: "2026-08-11",
      },
    ]);
  });

  it("locks the NGA/UGA/BWA/NAM/SWZ deep-review sources, signoff, and membership boundary", () => {
    const verifiedAt = new Date("2026-08-10T17:13:30.000Z");
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));

    expect(sourceById.get(acceptanceFixtureIds.source.nigeriaVehicularEmissions2011)).toMatchObject({
      publishedOn: "2011-05-17",
      sourceType: "official-regulation",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.ugandaEnvironment)).toMatchObject({
      publishedOn: "2024-04-26",
      sourceType: "official-regulation",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.botswanaGovernment)).toMatchObject({
      publishedOn: "2014-08-21",
      publisher: "Botswana Bureau of Standards",
      sourceType: "government-notice",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.botswanaTransport)).toMatchObject({
      publishedOn: "2024-06-24",
      publisher: "Botswana Bureau of Standards",
      title: "Botswana Standards Catalogue — June 2024",
      url: "https://bobstandards.bw/wp-content/uploads/2024/06/BOBS-Standards-Catalogue-June-2024.pdf",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.namibiaEnvironment)).toMatchObject({
      publishedOn: "2005-12-30",
      publisher: "Republic of Namibia / Namibian Standards Institution",
      sourceType: "official-regulation",
      title: "Standards Act, 2005 (Act No. 18 of 2005)",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.namibiaTransport)).toMatchObject({
      publishedOn: "2013-09-20",
      sourceType: "official-regulation",
      title: "Government Notice Nos. 248–249 of 2013 — Standards Regulations",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.eswatiniGovernment)).toMatchObject({
      sourceType: "official-regulation",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.eswatiniTransport)).toMatchObject({
      title: "Road Transportation Department — roadworthiness testing and statutory mandate",
      verifiedAt,
    });

    const reviewedMemberships = fixtureCountryJurisdictions.filter((membership) =>
      ["NGA", "UGA", "BWA", "NAM", "SWZ"].includes(membership.countryIso3),
    );
    expect(reviewedMemberships).toHaveLength(5);
    expect(reviewedMemberships.every((membership) =>
      membership.validFrom === "2026-08-11" &&
      membership.verifiedAt.toISOString() === verifiedAt.toISOString(),
    )).toBe(true);
  });

  it("locks exact primary-source metadata for TZA/ZMB/ZWE/RWA/CIV", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const verifiedAt = new Date("2026-08-10T16:55:00.000Z");

    expect(sourceById.get(acceptanceFixtureIds.source.tanzaniaEnvironment)).toMatchObject({
      publishedOn: "2007-12-07",
      publisher: "Tanzania National Environment Management Council",
      sourceType: "official-regulation",
      title:
        "Environmental Management (Air Quality Standards) Regulations, 2007 — NEMC copy",
      url: "https://www.nemc.or.tz/uploads/publications/sw-1645446559-Air_Quality_Standards_Regulations_2007.pdf",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.tanzaniaTransport)).toMatchObject({
      publishedOn: "2007-12-07",
      publisher: "TanzLII / Official Gazette of the United Republic of Tanzania",
      sourceType: "official-regulation",
      title:
        "Environmental Management (Air Quality Standards) Regulations, 2007 — Government Notice No. 237",
      url: "https://tanzlii.org/akn/tz/act/gn/2007/237/eng@2007-01-01/publication",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.zambiaEnvironment)).toMatchObject({
      publishedOn: null,
      publisher: "National Assembly of Zambia",
      sourceType: "official-regulation",
      title: "Environmental Management Act No. 12 of 2011",
      url: "https://www.parliament.gov.zm/sites/default/files/documents/acts/Environmetal%20Mangement%20Act%2012%20of%202011.pdf",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.zambiaTransport)).toMatchObject({
      publishedOn: null,
      publisher: "Zambia Compulsory Standards Agency",
      sourceType: "government-notice",
      title: "List of Compulsory Standards",
      url: "https://www.zcsa.org.zm/index.php/list-of-compulsory-standards/",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.zimbabweEnvironment)).toMatchObject({
      publishedOn: null,
      publisher: "Zimbabwe Environmental Management Agency",
      sourceType: "official-regulation",
      title: "Environmental Management Act [Chapter 20:27]",
      url: "https://ema.co.zw/wp-content/uploads/2026/03/EMA-ACT.pdf",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.zimbabweTransport)).toMatchObject({
      publishedOn: null,
      publisher: "Zimbabwe Environmental Management Agency",
      sourceType: "government-notice",
      title: "Air Emission Licence requirements under S.I. 72 of 2009",
      url: "https://ema.co.zw/air-emission/",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.rwandaEnvironment)).toMatchObject({
      publishedOn: "2018-09-24",
      publisher: "Official Gazette of the Republic of Rwanda / Ministry of Environment",
      sourceType: "official-regulation",
      title:
        "Ministerial Order No. 02/2018 of 17/09/2018 Relating to Air Pollutants Emission",
      url: "https://rwandalii.org/akn/rw/act/mo/2018/2/eng@2018-09-24/source.pdf",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.rwandaTransport)).toMatchObject({
      publishedOn: "2023-01-23",
      publisher: "Rwanda Standards Board",
      sourceType: "official-regulation",
      title:
        "National Standards as published in Official Gazette No. 04 of 23/01/2023",
      url: "https://www.rsb.gov.rw/fileadmin/Standard_Publications/Gazetted_Standards/National_Standards_as_published_in_Official_Gazette_n___04_of_23_01_2023.pdf",
      verifiedAt,
    });
    expect(
      sourceById.get(
        acceptanceFixtureIds.source.rwandaEas1047Implementation,
      ),
    ).toMatchObject({
      publishedOn: null,
      publisher: "East African Community Secretariat",
      sourceType: "government-notice",
      title:
        "Harmonization of Vehicle Emission Standards — Case of East African Community (EAC)",
      url: "https://sustmob.org/UsedVehicles/CITA_Nairobi_harmonization.pdf",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.coteDIvoireEnvironment)).toMatchObject({
      publishedOn: "2017-02-22",
      publisher: "Official Gazette of the Republic of Côte d’Ivoire / AfricanLII",
      sourceType: "official-regulation",
      title: "Décret n°2017-125 du 22 février 2017 relatif à la qualité de l’air",
      url: "https://agp.africanlii.org/fr/akn/ci/act/decree/2017/125/fra@2017-09-14",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.coteDIvoireTransport)).toMatchObject({
      publishedOn: null,
      publisher: "Comité Ivoirien de Normalisation (CODINORM)",
      sourceType: "government-notice",
      title: "PNI 15004 : Février 2025 — Véhicules N2 et N3 (Projet de Norme Ivoirienne)",
      url: "https://www.codinorm.ci/doc/enquete/vehicules/PNI%2015004%20Vehic%20N2%20et%20N3%20janv%202025%20V01.pdf",
      verifiedAt,
    });
  });

  it("uses exact source metadata and the real verification time for Mozambique and Eswatini", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const sourceRefreshedAt = new Date("2026-08-10T20:50:58.000Z");

    expect(sourceById.get(acceptanceFixtureIds.source.mozambiqueEnvironment)).toMatchObject({
      publishedOn: "2010-12-31",
      publisher:
        "Conselho de Ministros / Boletim da República; official copy hosted by SIBMOZ",
      sourceType: "official-regulation",
      title:
        "Decreto n.º 67/2010, de 31 de Dezembro — altera o Regulamento sobre Padrões de Qualidade Ambiental e de Emissão de Efluentes aprovado pelo Decreto n.º 18/2004",
      url: "https://sibmoz.gov.mz/content/uploads/2022/01/Regulamento-sobre-Padroes-de-Qualidade-Ambiental-e-de-Emissao-de-Efluentes.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.mozambiqueTransport)).toMatchObject({
      publishedOn: "2017-08-16",
      publisher:
        "Conselho de Ministros / Imprensa Nacional de Moçambique; official copy hosted by INATRO",
      sourceType: "official-regulation",
      title:
        "Decreto n.º 44/2017, de 16 de Agosto — Regulamento sobre as Regras de Aprovação de Marcas e Modelos de Veículos Automóveis, Motociclos, Ciclomotores, Tractores Agrícolas ou Florestais, Máquinas Industriais, Agrícolas ou Florestais, Tractocarros, Reboques e Semi-Reboques",
      url: "https://inatro.gov.mz/wp-content/uploads/2019/08/Decreto-44-e-45-2017-matriculas-e-regras-de-apro-de-marcas-e-modelos.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.eswatiniGovernment)).toMatchObject({
      publisher: "Eswatini Environment Authority",
      sourceType: "official-regulation",
      verifiedAt: new Date("2026-08-10T17:13:30.000Z"),
    });
    expect(sourceById.get(acceptanceFixtureIds.source.eswatiniTransport)).toMatchObject({
      publisher: expect.stringContaining("Road Transportation Department"),
      verifiedAt: new Date("2026-08-10T17:13:30.000Z"),
    });
  });

  it("uses exact source metadata and the real verification time for Lesotho, Madagascar, Mauritius, and Malawi", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const sourceRefreshedAt = new Date("2026-08-10T20:50:58.000Z");
    const malawiVerifiedAt = new Date(
      TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO,
    );

    expect(sourceById.get(acceptanceFixtureIds.source.lesothoGovernment)).toMatchObject({
      publishedOn: "2026-02-16",
      publisher: "Government of Lesotho / Ministry of Public Works and Transport",
      sourceType: "government-notice",
      title: "Roadworthiness (RW)/Fitness (F) of Motor Vehicles",
      url: "https://www.gov.ls/eservice/roadworthiness-rw-fitness-f-of-motor-vehicles/",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.lesothoTransport)).toMatchObject({
      publishedOn: "2006-02-28",
      publisher:
        "Government of the Kingdom of Lesotho, Ministry of Public Works and Transport, Planning Unit",
      sourceType: "government-notice",
      title: "Transport Sector Policy",
      url: "https://www.mopwt.gov.ls/wp-content/uploads/2018/07/Transport_Sector_Policy.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.madagascarEnvironment)).toMatchObject({
      publishedOn: "2024-04-30",
      publisher:
        "Ministère de l’Agriculture et de l’Élevage, Direction Régionale de l’Agriculture et de l’Élevage Atsimo Andrefana",
      sourceType: "government-notice",
      title:
        "Étude de l’aménagement du secteur d’Antanamanintsy et l’actualisation d’une partie des études de réhabilitation des aménagements actuels dans le périmètre du Bas Mangoky — Étude d’impact environnemental et social, version définitive",
      url: "https://www.minae.gov.mg/wp-content/uploads/2025/05/1.0.EIES-VERSION-DEFINITIVE_FIN.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.madagascarTransport)).toMatchObject({
      publishedOn: null,
      publisher: "Direction de la Législation et du Contentieux / CNLEGIS, Madagascar",
      sourceType: "government-notice",
      title: "CNLEGIS — Recherche directe par numéros",
      url: "https://cnlegis.gov.mg/page_cherche_dir_numeros/",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.mauritiusEnvironment)).toMatchObject({
      publishedOn: "2023-11-08",
      publisher:
        "Mauritius Ministry of Environment, Solid Waste Management and Climate Change, Environment and Climate Change Division",
      sourceType: "government-notice",
      title:
        "Returns on Enforcement of Vehicular Smoke Emissions (March 2022 – August 2023)",
      url: "https://environment.govmu.org/Documents/communique/Returns%20on%20Enforcement%20of%20Vehicular%20Smoke%20Emissions%20%28March%202022%20to%20August%202023%29.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.mauritiusTransport)).toMatchObject({
      publishedOn: "2018-08-11",
      publisher: "Government of Mauritius / Government Gazette of Mauritius",
      sourceType: "official-regulation",
      title: "Road Traffic (Amendment) Act 2018 (Act No. 12 of 2018)",
      url: "https://landtransport.govmu.org/Documents/Legislations/act1218.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.malawiGovernment)).toMatchObject({
      publishedOn: "1998-01-15",
      publisher: "Government of Malawi — Trade Portal",
      sourceType: "official-regulation",
      title: "Road Traffic Act — section 108 exhaust smoke and fumes",
      url: "https://portal.trade.gov.mw/en-gb/site/display/62",
      verifiedAt: malawiVerifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.malawiTransport)).toMatchObject({
      publishedOn: null,
      publisher: "Government of Malawi — Trade Portal",
      sourceType: "official-regulation",
      title: "Road Traffic Regulations — regulation 97 exhaust gas and smoke",
      url: "https://portal.trade.gov.mw/en-gb/site/display/101",
      verifiedAt: malawiVerifiedAt,
    });
  });

  it("uses exact source metadata and the real verification time for Fiji, Belize, Brunei, and Bhutan", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const verifiedAt = new Date(
      TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO,
    );
    const refreshedVerifiedAt = new Date("2026-08-10T19:36:45.000Z");
    const fijiRefreshedAt = new Date("2026-08-10T20:50:58.000Z");

    expect(sourceById.get(acceptanceFixtureIds.source.fijiEnvironment)).toMatchObject({
      publishedOn: "2025-01-28",
      publisher: "Fiji Revenue and Customs Service",
      sourceType: "government-notice",
      title:
        "Standard Interpretation Guideline 2025-04 — Customs (Prohibited Imports and Exports) Regulations 1986 – Importation of Motor Vehicles",
      url: "https://frcs.org.fj/wp-content/uploads/2025/01/SIG-2025-04-Importation-of-Motor-Vehicles-Customs-Prohibited-Imports-and-Exports-Regulations-1986.pdf",
      verifiedAt: fijiRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.fijiTransport)).toMatchObject({
      publishedOn: null,
      publisher: "Fiji Revenue and Customs Service",
      sourceType: "government-notice",
      title: "Importation of Used or Reconditioned Motor Vehicles in 2026",
      url: "https://frcs.org.fj/public-notice/importation-of-used-or-reconditioned-motor-vehicles-in-2026/",
      verifiedAt: fijiRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.belizeEnvironment)).toMatchObject({
      publishedOn: "1996-04-20",
      publisher: "Belize Department of the Environment / Government of Belize",
      sourceType: "official-regulation",
      title: "Pollution Regulations (S.I. No. 56 of 1996), Chapter 328, Revised Edition 2020 — regulations 25–26 (PDF pp. 25–26)",
      url: "https://doe.gov.bz/wp-content/uploads/2024/02/Pollution-Regulations.pdf",
      verifiedAt: refreshedVerifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.belizeTransport)).toMatchObject({
      publishedOn: null,
      publisher: "Government of Belize / Department of the Environment",
      sourceType: "official-regulation",
      title: "Environmental Protection Act, Chapter 328, Revised Edition 2020 — sections 6 and 45 (PDF pp. 21 and 45)",
      url: "https://doe.gov.bz/download/environmental-protection-act-chapter-328-re-2020/?wpdmdl=17080",
      verifiedAt: refreshedVerifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.bruneiEnvironment)).toMatchObject({
      publishedOn: null,
      publisher: "Attorney General’s Chambers, Brunei Darussalam",
      sourceType: "official-regulation",
      title: "Road Traffic Regulations (Chapter 68), Revised Edition 2022",
      url: "https://www.agc.gov.bn/AGC%20Images/LAWS/ACT_PDF/R/CHAPTER%20068%20RG1%20%282022%29.pdf",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.bruneiTransport)).toMatchObject({
      publishedOn: null,
      publisher:
        "Ministry of Communications & Land Transport Department, in collaboration with Brunei National Road Safety Council",
      sourceType: "government-notice",
      title: "Safe and Smart Driving in Brunei Darussalam",
      url: "https://www.jpd.gov.bn/SiteAssets/SitePages/Land%20Transport%20Department/Adverts/Safe%20and%20Smart%20Driving%20In%20Brunei%20Darussalam/Safe%20and%20Smart%20Driving%20in%20Brunei%20Darussalam%201st%20edition.pdf",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.bhutanEnvironment)).toMatchObject({
      publishedOn: null,
      publisher: "National Environment Commission, Royal Government of Bhutan",
      sourceType: "government-notice",
      title: "Environmental Standards, 2020",
      url: "https://www.nec.gov.bt/publications/download/environment-standards-2020",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.bhutanTransport)).toMatchObject({
      publishedOn: "2026-07-03",
      publisher: "Bhutan Construction and Transport Authority",
      sourceType: "government-notice",
      title:
        "Public Notification – Implementation of the Road Safety and Transport Rules and Regulations (RSTRR) 2026",
      url: "https://bcta.gov.bt/public-notification-implementation-of-the-road-safety-and-transport-rules-and-regulations-rstrr-2026/",
      verifiedAt,
    });
  });

  it("locks the MOZ/LSO/MDG/MUS/FJI two-source no-data graph and source-refresh record time", () => {
    const refreshedAt = new Date("2026-08-10T20:50:58.000Z");
    const refreshedJurisdictions = [
      {
        countryIso3: "MOZ",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.mozambique,
        membershipSourceId: acceptanceFixtureIds.source.mozambiqueTransport,
        sourceId: acceptanceFixtureIds.source.mozambiqueEnvironment,
      },
      {
        countryIso3: "LSO",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.lesotho,
        membershipSourceId: acceptanceFixtureIds.source.lesothoTransport,
        sourceId: acceptanceFixtureIds.source.lesothoGovernment,
      },
      {
        countryIso3: "MDG",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.madagascar,
        membershipSourceId: acceptanceFixtureIds.source.madagascarTransport,
        sourceId: acceptanceFixtureIds.source.madagascarEnvironment,
      },
      {
        countryIso3: "MUS",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.mauritius,
        membershipSourceId: acceptanceFixtureIds.source.mauritiusTransport,
        sourceId: acceptanceFixtureIds.source.mauritiusEnvironment,
      },
      {
        countryIso3: "FJI",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.fiji,
        membershipSourceId: acceptanceFixtureIds.source.fijiTransport,
        sourceId: acceptanceFixtureIds.source.fijiEnvironment,
      },
    ] as const;

    for (const expected of refreshedJurisdictions) {
      const sources = fixtureSources.filter(
        ({ id }) =>
          id === expected.sourceId || id === expected.membershipSourceId,
      );
      expect(sources).toHaveLength(2);
      expect(
        sources.every(
          ({ createdAt, updatedAt, verifiedAt }) =>
            createdAt?.toISOString() === refreshedAt.toISOString() &&
            updatedAt?.toISOString() === refreshedAt.toISOString() &&
            verifiedAt?.toISOString() === refreshedAt.toISOString(),
        ),
      ).toBe(true);
      expect(
        fixtureJurisdictions.find(({ id }) => id === expected.jurisdictionId),
      ).toMatchObject({
        countryIso3: expected.countryIso3,
        createdAt: refreshedAt,
        dataSourceId: expected.sourceId,
        updatedAt: refreshedAt,
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureCountryJurisdictions.find(
          ({ countryIso3, jurisdictionId }) =>
            countryIso3 === expected.countryIso3 &&
            jurisdictionId === expected.jurisdictionId,
        ),
      ).toMatchObject({
        createdAt: refreshedAt,
        dataSourceId: expected.membershipSourceId,
        updatedAt: refreshedAt,
        validFrom: "2026-08-10",
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureRegulations.filter(
          ({ jurisdictionId }) => jurisdictionId === expected.jurisdictionId,
        ),
      ).toEqual([]);
    }

    expect({
      fijiEnvironment: acceptanceFixtureIds.source.fijiEnvironment,
      fijiTransport: acceptanceFixtureIds.source.fijiTransport,
      lesothoGovernment: acceptanceFixtureIds.source.lesothoGovernment,
      lesothoTransport: acceptanceFixtureIds.source.lesothoTransport,
      madagascarEnvironment: acceptanceFixtureIds.source.madagascarEnvironment,
      madagascarTransport: acceptanceFixtureIds.source.madagascarTransport,
      mauritiusEnvironment: acceptanceFixtureIds.source.mauritiusEnvironment,
      mauritiusTransport: acceptanceFixtureIds.source.mauritiusTransport,
      mozambiqueEnvironment: acceptanceFixtureIds.source.mozambiqueEnvironment,
      mozambiqueTransport: acceptanceFixtureIds.source.mozambiqueTransport,
    }).toEqual({
      fijiEnvironment: "10000000-0000-4000-8000-000000000612",
      fijiTransport: "10000000-0000-4000-8000-000000000613",
      lesothoGovernment: "10000000-0000-4000-8000-000000000601",
      lesothoTransport: "10000000-0000-4000-8000-000000000602",
      madagascarEnvironment: "10000000-0000-4000-8000-000000000606",
      madagascarTransport: "10000000-0000-4000-8000-000000000607",
      mauritiusEnvironment: "10000000-0000-4000-8000-000000000608",
      mauritiusTransport: "10000000-0000-4000-8000-000000000609",
      mozambiqueEnvironment: "10000000-0000-4000-8000-000000000597",
      mozambiqueTransport: "10000000-0000-4000-8000-000000000598",
    });
  });

  it("uses exact source metadata and the real verification time for CAF, COD, COG, and CUB", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const sourceRefreshedAt = new Date("2026-08-10T21:00:43.000Z");
    const refreshedVerifiedAt = new Date("2026-08-10T19:36:45.000Z");

    expect(sourceById.get(acceptanceFixtureIds.source.centralAfricanRepublicEnvironment)).toMatchObject({
      publishedOn: "2007-12-28",
      publisher: "Présidence de la République / Journal officiel de la République centrafricaine",
      sourceType: "official-regulation",
      title: "Loi n° 07.018 du 28 décembre 2007 portant Code de l’environnement de la République centrafricaine",
      url: "https://faolex.fao.org/docs/pdf/caf105925.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.centralAfricanRepublicTransport)).toMatchObject({
      publishedOn: "2026-03-09",
      publisher: "République centrafricaine / Ministère de l’Environnement et du Développement durable / UNFCCC NDC Registry",
      sourceType: "government-notice",
      title: "Contribution déterminée au niveau national (CDN 3.0) de la République centrafricaine",
      url: "https://unfccc.int/sites/default/files/2026-03/CDN%203.0%20CAR%202025.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.democraticRepublicOfCongoEnvironment)).toMatchObject({
      publishedOn: "2011-07-16",
      publisher: "Journal officiel de la République démocratique du Congo / Cabinet du Président; official copy hosted by the Ministry of Environment",
      sourceType: "official-regulation",
      title: "Loi n° 11/009 du 09 juillet 2011 portant principes fondamentaux relatifs à la protection de l’environnement",
      url: "https://medd.gouv.cd/wp-content/uploads/2020/07/attachment1.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.democraticRepublicOfCongoTransport)).toMatchObject({
      publishedOn: "2025-11-24",
      publisher: "Vice-Primature, Ministère des Transports, Voies de Communication et Désenclavement, République démocratique du Congo",
      sourceType: "official-regulation",
      title: "Arrêté ministériel n° VPM/MTVCD/CAB/085/2025 du 12 novembre 2025 portant réglementation du contrôle technique des véhicules automobiles et des remorques en circulation en République démocratique du Congo",
      url: "https://transports.gouv.cd/wp-content/uploads/2025/11/ARRETE-MINISTERIEL-N%C2%B0085-DU-12-NOV-2025-PORTANT-RE_251124_152526.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.republicOfCongoEnvironment)).toMatchObject({
      publishedOn: "2023-11-17",
      publisher: "Présidence de la République / Ministère de l’Environnement, du Développement durable et du Bassin du Congo",
      sourceType: "official-regulation",
      title: "Loi n° 33-2023 du 17 novembre 2023 portant gestion durable de l’environnement en République du Congo",
      url: "https://www.developpement-durable.gouv.cg/wp-content/uploads/2023/11/Loi_n_33-2023_du_17_novembre_portant_gestion_durable_de_l_environnement_en_Republique_du_Congo_.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.republicOfCongoTransport)).toMatchObject({
      publishedOn: "2019-07-18",
      publisher: "Secrétariat général du Gouvernement / Journal officiel de la République du Congo",
      sourceType: "official-regulation",
      title: "Journal officiel n° 29 du 18 juillet 2019 — Décret n° 2019-171 du 1er juillet 2019 portant réglementation du contrôle technique des véhicules routiers",
      url: "https://www.sgg.cg/JO/2019/congo-jo-2019-29.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.cubaEnvironment)).toMatchObject({
      publishedOn: "2023-09-13",
      publisher: "Gaceta Oficial de la República de Cuba / Ministerio de Justicia / Asamblea Nacional del Poder Popular",
      sourceType: "official-regulation",
      title: "Gaceta Oficial No. 87 Ordinaria de 13 de septiembre de 2023 — Ley 150/2022 Del Sistema de los Recursos Naturales y el Medio Ambiente (GOC-2023-771-O87)",
      url: "https://www.gacetaoficial.gob.cu/sites/default/files/goc-2023-o87.pdf",
      verifiedAt: refreshedVerifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.cubaTransport)).toMatchObject({
      publishedOn: "2011-03-15",
      publisher: "Gaceta Oficial de la República de Cuba / Ministerio de Justicia / Ministerio del Transporte",
      sourceType: "official-regulation",
      title: "Gaceta Oficial No. 014 Extraordinaria de 15 de marzo de 2011 — Resolución No. 151/2011, Normas Complementarias para la Seguridad Vial",
      url: "https://www.gacetaoficial.gob.cu/sites/default/files/go_x_014_2011.pdf",
      verifiedAt: refreshedVerifiedAt,
    });
  });

  it("uses exact source metadata and the real verification time for DJI, ERI, GAB, and GIN", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const verifiedAt = new Date("2026-08-10T21:00:43.000Z");
    const sourceRefreshedAt = new Date("2026-08-10T20:39:16.000Z");

    expect(sourceById.get(acceptanceFixtureIds.source.djiboutiEnvironment)).toMatchObject({
      publishedOn: "2009-07-01",
      publisher: "Journal Officiel de la République de Djibouti / Présidence de la République",
      sourceType: "official-regulation",
      title: "Loi n° 51/AN/09/6ème L portant Code de l’Environnement",
      url: "https://www.journalofficiel.dj/texte-juridique/loi-n51-an-09-6eme-l-portant-code-de-lenvironnement/",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.djiboutiTransport)).toMatchObject({
      publishedOn: "2010-12-15",
      publisher: "Journal Officiel de la République de Djibouti / Présidence de la République",
      sourceType: "official-regulation",
      title: "Décret n° 2010-0230/PR/MID du 4 décembre 2010 relatif aux nouvelles dispositions réglementaires du Code de la Route",
      url: "https://www.journalofficiel.dj/texte-juridique/decret-n2010-0230-pr-mid-relatif-aux-nouvelles-dispositions-reglementaires-du-code-de-la-route/",
      verifiedAt,
    });
    expect(
      acceptanceFixtureIds.source
        .eritreaEnvironmentalProtectionManagementRegulations127_2017,
    ).toBe("10000000-0000-4000-8000-000000000634");
    expect(
      acceptanceFixtureIds.source
        .eritreaVehicleTechnicalStandardsRegulations61_2002,
    ).toBe("10000000-0000-4000-8000-000000000635");
    expect(
      acceptanceFixtureIds.source.gabonEnvironmentalProtectionLaw007_2014,
    ).toBe("10000000-0000-4000-8000-000000000636");
    expect(
      acceptanceFixtureIds.source.gabonHeavyVehicleHomologationOrder00097_2017,
    ).toBe("10000000-0000-4000-8000-000000000637");
    expect(
      sourceById.get(
        acceptanceFixtureIds.source
          .eritreaEnvironmentalProtectionManagementRegulations127_2017,
      ),
    ).toMatchObject({
      publishedOn: "2017-01-26",
      publisher: "Government of the State of Eritrea / Gazette of Eritrean Laws",
      sourceType: "official-regulation",
      title: "Environmental Protection and Management Regulations 127/2017",
      url: "https://tile.loc.gov/storage-services/service/ll/lleritrea/eritrean-notice-127-2017/eritrean-notice-127-2017.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(
      sourceById.get(
        acceptanceFixtureIds.source
          .eritreaVehicleTechnicalStandardsRegulations61_2002,
      ),
    ).toMatchObject({
      publishedOn: "2002-05-13",
      publisher: "Government of the State of Eritrea / Gazette of Eritrean Laws",
      sourceType: "official-regulation",
      title: "Regulations on Vehicle Technical and Related Standards Specifications 61/2002",
      url: "https://tile.loc.gov/storage-services/service/ll/lleritrea/eritrean-notice-61-2002/eritrean-notice-61-2002.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(
      sourceById.get(
        acceptanceFixtureIds.source.gabonEnvironmentalProtectionLaw007_2014,
      ),
    ).toMatchObject({
      publishedOn: "2014-09-16",
      publisher: "Journal Officiel de la République Gabonaise / Présidence de la République",
      sourceType: "official-regulation",
      title: "JOURNAL OFFICIEL N°222 DU 16 SEPTEMBRE 2014 — Loi N° 007/2014 du 31/07/2014 relative à la protection de l'environnement en République Gabonaise",
      url: "https://journal-officiel.ga/6186-007-2014/",
      verifiedAt: sourceRefreshedAt,
    });
    expect(
      sourceById.get(
        acceptanceFixtureIds.source
          .gabonHeavyVehicleHomologationOrder00097_2017,
      ),
    ).toMatchObject({
      publishedOn: "2017-04-23",
      publisher: "Journal Officiel de la République Gabonaise / Ministère des Transports et de la Logistique",
      sourceType: "official-regulation",
      title: "JOURNAL OFFICIEL N°345 TER DU 23 AVRIL 2017 — Arrêté N° 00097/MTL/2017 du 24/02/2017 relatif à la conduite, la certification et l'homologation des véhicules poids lourds, remorques, semi-remorques, engins et tous les équipements de levage et de manutention, les engins spéciaux et leurs agrès",
      url: "https://journal-officiel.ga/5680-00097-mtl-2017-/",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.guineaEnvironment)).toMatchObject({
      publishedOn: "2019-07-26",
      publisher: "Présidence de la République / Secrétariat général du Gouvernement, République de Guinée",
      sourceType: "official-regulation",
      title: "Décret D/2019/221/PRG/SGG portant promulgation de la Loi L/2019/0034/AN du 04 juillet 2019 portant Code de l’environnement de la République de Guinée",
      url: "https://medd.gov.gn/file/2022/12/Code-de-lEnvironnement-du-04-juillet-2019-1.pdf",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.guineaTransport)).toMatchObject({
      publishedOn: "2018-06-20",
      publisher: "Assemblée nationale de la République de Guinée / official archive hosted by the Conseil national de la transition",
      sourceType: "official-regulation",
      title: "Loi ordinaire n° L/2018/023/AN du 20 juin 2018 portant Code de la route de la République de Guinée",
      url: "https://cnt.gov.gn/archive.assemblee/www.assemblee.gov.gn/node/739.html",
      verifiedAt,
    });
  });

  it("locks CAF/COD/COG/GIN/DJI to stable exact two-source no-data records", () => {
    const refreshedAt = new Date("2026-08-10T21:00:43.000Z");
    const refreshedJurisdictions = [
      {
        countryIso3: "CAF",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.centralAfricanRepublic,
        membershipSourceId: acceptanceFixtureIds.source.centralAfricanRepublicTransport,
        sourceId: acceptanceFixtureIds.source.centralAfricanRepublicEnvironment,
      },
      {
        countryIso3: "COD",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.democraticRepublicOfCongo,
        membershipSourceId: acceptanceFixtureIds.source.democraticRepublicOfCongoTransport,
        sourceId: acceptanceFixtureIds.source.democraticRepublicOfCongoEnvironment,
      },
      {
        countryIso3: "COG",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.republicOfCongo,
        membershipSourceId: acceptanceFixtureIds.source.republicOfCongoTransport,
        sourceId: acceptanceFixtureIds.source.republicOfCongoEnvironment,
      },
      {
        countryIso3: "GIN",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.guinea,
        membershipSourceId: acceptanceFixtureIds.source.guineaTransport,
        sourceId: acceptanceFixtureIds.source.guineaEnvironment,
      },
      {
        countryIso3: "DJI",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.djibouti,
        membershipSourceId: acceptanceFixtureIds.source.djiboutiTransport,
        sourceId: acceptanceFixtureIds.source.djiboutiEnvironment,
      },
    ] as const;

    expect(
      refreshedJurisdictions.map(({ sourceId, membershipSourceId }) => [
        sourceId,
        membershipSourceId,
      ]),
    ).toEqual([
      ["10000000-0000-4000-8000-000000000624", "10000000-0000-4000-8000-000000000625"],
      ["10000000-0000-4000-8000-000000000626", "10000000-0000-4000-8000-000000000627"],
      ["10000000-0000-4000-8000-000000000628", "10000000-0000-4000-8000-000000000629"],
      ["10000000-0000-4000-8000-000000000638", "10000000-0000-4000-8000-000000000639"],
      ["10000000-0000-4000-8000-000000000632", "10000000-0000-4000-8000-000000000633"],
    ]);
    expect(
      refreshedJurisdictions.map(({ jurisdictionId }) => jurisdictionId),
    ).toEqual([
      "10000000-0000-4000-8000-000000000621",
      "10000000-0000-4000-8000-000000000622",
      "10000000-0000-4000-8000-000000000623",
      "10000000-0000-4000-8000-000000000628",
      "10000000-0000-4000-8000-000000000625",
    ]);

    for (const expected of refreshedJurisdictions) {
      const sources = fixtureSources.filter(
        ({ id }) =>
          id === expected.sourceId || id === expected.membershipSourceId,
      );
      expect(sources).toHaveLength(2);
      expect(
        sources.every(
          ({ createdAt, updatedAt, verifiedAt }) =>
            createdAt?.toISOString() === refreshedAt.toISOString() &&
            updatedAt?.toISOString() === refreshedAt.toISOString() &&
            verifiedAt?.toISOString() === refreshedAt.toISOString(),
        ),
      ).toBe(true);
      expect(
        fixtureJurisdictions.find(({ id }) => id === expected.jurisdictionId),
      ).toMatchObject({
        countryIso3: expected.countryIso3,
        createdAt: refreshedAt,
        dataSourceId: expected.sourceId,
        updatedAt: refreshedAt,
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureCountryJurisdictions.find(
          ({ countryIso3, jurisdictionId }) =>
            countryIso3 === expected.countryIso3 &&
            jurisdictionId === expected.jurisdictionId,
        ),
      ).toMatchObject({
        createdAt: refreshedAt,
        dataSourceId: expected.membershipSourceId,
        updatedAt: refreshedAt,
        validFrom: "2026-08-10",
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureRegulations.filter(
          ({ jurisdictionId }) => jurisdictionId === expected.jurisdictionId,
        ),
      ).toEqual([]);
    }
  });

  it("uses exact source metadata and the real verification time for GMB, GNB, GNQ, and GRL", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const verifiedAt = new Date("2026-08-10T06:44:56.000Z");
    const sourceRefreshedAt = new Date("2026-08-10T20:39:16.000Z");

    expect(
      acceptanceFixtureIds.source
        .gambiaEnvironmentalQualityStandardsRegulations1999,
    ).toBe("10000000-0000-4000-8000-000000000640");
    expect(acceptanceFixtureIds.source.gambiaMotorTrafficAmendmentAct2013).toBe(
      "10000000-0000-4000-8000-000000000641",
    );
    expect(
      acceptanceFixtureIds.source.guineaBissauBasicEnvironmentLaw1_2011,
    ).toBe("10000000-0000-4000-8000-000000000642");
    expect(
      acceptanceFixtureIds.source.guineaBissauTransportMinistryDirectory,
    ).toBe("10000000-0000-4000-8000-000000000643");
    expect(
      acceptanceFixtureIds.source.equatorialGuineaEnvironmentalLaw7_2003,
    ).toBe("10000000-0000-4000-8000-000000000644");
    expect(
      acceptanceFixtureIds.source
        .equatorialGuineaGeneralRoadTransportLaw4_2018,
    ).toBe("10000000-0000-4000-8000-000000000645");
    expect(
      sourceById.get(
        acceptanceFixtureIds.source
          .gambiaEnvironmentalQualityStandardsRegulations1999,
      ),
    ).toMatchObject({
      publishedOn: null,
      publisher: "National Environment Management Council / National Environment Agency, The Gambia",
      sourceType: "official-regulation",
      title: "Environmental Quality Standards Regulations, 1999",
      url: "https://faolex.fao.org/docs/pdf/gam95812.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(
      sourceById.get(
        acceptanceFixtureIds.source.gambiaMotorTrafficAmendmentAct2013,
      ),
    ).toMatchObject({
      publishedOn: "2014-01-23",
      publisher: "The Gambia Gazette / National Assembly of The Gambia",
      sourceType: "official-regulation",
      title: "Supplement “C” to The Gambia Gazette No. 1 of 23rd January, 2014 — Motor Traffic (Amendment) Act, 2013 (No. 12 of 2013)",
      url: "https://security-legislation.gm/wp-content/uploads/2022/10/Motor-Traffic-Amendment-Act-2013.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(
      sourceById.get(
        acceptanceFixtureIds.source.guineaBissauBasicEnvironmentLaw1_2011,
      ),
    ).toMatchObject({
      publishedOn: "2011-03-02",
      publisher: "Assembleia Nacional Popular / Boletim Oficial da República da Guiné-Bissau",
      sourceType: "official-regulation",
      title: "2.º Suplemento ao Boletim Oficial da República da Guiné-Bissau n.º 9 — Lei n.º 1/2011, de 2 de Março — Lei de Bases do Ambiente",
      url: "https://faolex.fao.org/docs/pdf/gbs118164.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(
      sourceById.get(
        acceptanceFixtureIds.source.guineaBissauTransportMinistryDirectory,
      ),
    ).toMatchObject({
      publishedOn: null,
      publisher: "Governo da República da Guiné-Bissau / Ministério dos Transportes e Comunicações",
      sourceType: "government-notice",
      title: "Ministério dos Transportes e Comunicações — Governo da Guiné-Bissau",
      url: "https://bissaugov.com/ministerios/transportes-comunicacoes",
      verifiedAt: sourceRefreshedAt,
    });
    expect(
      sourceById.get(
        acceptanceFixtureIds.source.equatorialGuineaEnvironmentalLaw7_2003,
      ),
    ).toMatchObject({
      publishedOn: "2003-11-27",
      publisher: "Presidencia de la República de Guinea Ecuatorial / Boletín Oficial del Estado",
      sourceType: "official-regulation",
      title: "Ley número 7/2003, de fecha 27 de noviembre, Reguladora del Medio Ambiente en Guinea Ecuatorial",
      url: "https://faolex.fao.org/docs/pdf/eqg102892.pdf",
      verifiedAt: sourceRefreshedAt,
    });
    expect(
      sourceById.get(
        acceptanceFixtureIds.source
          .equatorialGuineaGeneralRoadTransportLaw4_2018,
      ),
    ).toMatchObject({
      publishedOn: "2019-03-25",
      publisher: "Dirección General del Boletín Oficial del Estado / Presidencia del Gobierno de Guinea Ecuatorial",
      sourceType: "official-regulation",
      title: "Ley General de Transporte por Carretera Nº 4 — Ley Núm. 4/2.018, de fecha 19 de Diciembre, General de Transporte por Carretera en la República de Guinea Ecuatorial",
      url: "https://minhacienda-gob.com/media/stream/8301",
      verifiedAt: sourceRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.greenlandEnvironment)).toMatchObject({
      publishedOn: "1979-03-27",
      publisher: "Government of Greenland / Nalunaarutit",
      sourceType: "official-regulation",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.greenlandTransport)).toMatchObject({
      publishedOn: "2009-10-26",
      publisher: "Danish Ministry of Justice / Official Legal Information System",
      sourceType: "official-regulation",
      verifiedAt,
    });
  });

  it("locks the ERI/GAB/GMB/GNB/GNQ two-source no-data graph and source-refresh record time", () => {
    const refreshedAt = new Date("2026-08-10T20:39:16.000Z");
    const refreshedJurisdictions = [
      {
        countryIso3: "ERI",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.eritrea,
        membershipSourceId:
          acceptanceFixtureIds.source
            .eritreaVehicleTechnicalStandardsRegulations61_2002,
        sourceId:
          acceptanceFixtureIds.source
            .eritreaEnvironmentalProtectionManagementRegulations127_2017,
      },
      {
        countryIso3: "GAB",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.gabon,
        membershipSourceId:
          acceptanceFixtureIds.source
            .gabonHeavyVehicleHomologationOrder00097_2017,
        sourceId:
          acceptanceFixtureIds.source.gabonEnvironmentalProtectionLaw007_2014,
      },
      {
        countryIso3: "GMB",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.gambia,
        membershipSourceId:
          acceptanceFixtureIds.source.gambiaMotorTrafficAmendmentAct2013,
        sourceId:
          acceptanceFixtureIds.source
            .gambiaEnvironmentalQualityStandardsRegulations1999,
      },
      {
        countryIso3: "GNB",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.guineaBissau,
        membershipSourceId:
          acceptanceFixtureIds.source.guineaBissauTransportMinistryDirectory,
        sourceId:
          acceptanceFixtureIds.source.guineaBissauBasicEnvironmentLaw1_2011,
      },
      {
        countryIso3: "GNQ",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.equatorialGuinea,
        membershipSourceId:
          acceptanceFixtureIds.source
            .equatorialGuineaGeneralRoadTransportLaw4_2018,
        sourceId:
          acceptanceFixtureIds.source.equatorialGuineaEnvironmentalLaw7_2003,
      },
    ] as const;

    for (const expected of refreshedJurisdictions) {
      const sourceRecords = fixtureSources.filter(
        ({ id }) =>
          id === expected.sourceId || id === expected.membershipSourceId,
      );
      expect(sourceRecords).toHaveLength(2);
      expect(
        sourceRecords.every(
          ({ createdAt, updatedAt, verifiedAt }) =>
            createdAt?.toISOString() === refreshedAt.toISOString() &&
            updatedAt?.toISOString() === refreshedAt.toISOString() &&
            verifiedAt?.toISOString() === refreshedAt.toISOString(),
        ),
      ).toBe(true);
      expect(
        fixtureJurisdictions.find(({ id }) => id === expected.jurisdictionId),
      ).toMatchObject({
        countryIso3: expected.countryIso3,
        createdAt: refreshedAt,
        dataSourceId: expected.sourceId,
        updatedAt: refreshedAt,
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureCountryJurisdictions.find(
          ({ countryIso3, jurisdictionId }) =>
            countryIso3 === expected.countryIso3 &&
            jurisdictionId === expected.jurisdictionId,
        ),
      ).toMatchObject({
        createdAt: refreshedAt,
        dataSourceId: expected.membershipSourceId,
        updatedAt: refreshedAt,
        validFrom: "2026-08-10",
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureRegulations.some(
          ({ jurisdictionId }) => jurisdictionId === expected.jurisdictionId,
        ),
      ).toBe(false);
    }

    const sourceAliases = Object.keys(acceptanceFixtureIds.source);
    for (const retiredAlias of [
      "eritreaEnvironment",
      "eritreaTransport",
      "gabonEnvironment",
      "gabonTransport",
      "gambiaEnvironment",
      "gambiaTransport",
      "guineaBissauEnvironment",
      "guineaBissauTransport",
      "equatorialGuineaEnvironment",
      "equatorialGuineaTransport",
    ]) {
      expect(sourceAliases).not.toContain(retiredAlias);
    }

    const sourceUrls = fixtureSources.map(({ url }) => url);
    for (const retiredUrl of [
      "https://faolex.fao.org/docs/pdf/eri201709.pdf",
      "https://shabait.com/2021/05/19/improved-public-transportation-service/",
      "https://journal-officiel.ga/15254-1823-mtact/",
      "https://op.gov.gm/conclusions-3rd-cabinet-meeting-2022-held-thursday-21st-july",
      "https://www.guineaecuatorialpress.com/index.php/noticias/medidas_para_la_conservacion_del_medio_ambiente",
      "https://www.guineaecuatorialpress.com/noticias/sesion_de_control_sobre_la_gestion_de_la_itv_y_el_consejo_de_cargadores_maritimos",
    ]) {
      expect(sourceUrls).not.toContain(retiredUrl);
    }
  });

  it("uses exact source metadata and the real verification time for GUY, HTI, IRN, and IRQ", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const caribbeanRefreshedAt = new Date("2026-08-10T19:36:45.000Z");
    const levantRefreshedAt = new Date("2026-08-10T18:55:45.000Z");

    expect(sourceById.get(acceptanceFixtureIds.source.guyanaEnvironment)).toMatchObject({
      publishedOn: "2000-12-13",
      publisher: "Ministry of Legal Affairs, Guyana",
      sourceType: "official-regulation",
      title: "Environmental Protection (Air Quality) Regulations, 2000 (Reg. 9/2000) — regulations 18–20 (PDF pp. 167–168)",
      url: "https://mola.gov.gy/laws/Volume%206%20Cap.%2018.01%20-%2023.011696964321.pdf",
      verifiedAt: caribbeanRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.guyanaTransport)).toMatchObject({
      publishedOn: "1940-12-20",
      publisher: "Ministry of Legal Affairs, Guyana",
      sourceType: "official-regulation",
      title: "Motor Vehicles and Road Traffic Act, Chapter 51:02 — section 103(1)(xxii) (PDF p. 108)",
      url: "https://mola.gov.gy/laws/Volume%2011%20Cap.%2049.02%20-%2058.011696827006.pdf",
      verifiedAt: caribbeanRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.haitiEnvironment)).toMatchObject({
      publishedOn: "2006-01-26",
      publisher: "Le Moniteur — Journal officiel de la République d’Haïti / Presses Nationales d’Haïti",
      sourceType: "official-regulation",
      title: "Décret portant sur la Gestion de l’Environnement et de Régulation de la Conduite des Citoyens et Citoyennes pour un Développement Durable — Le Moniteur No. 11",
      url: "https://faolex.fao.org/docs/pdf/hai65901.pdf",
      verifiedAt: caribbeanRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.haitiTransport)).toMatchObject({
      publishedOn: "2025-07-18",
      publisher: "Gouvernement de la République d’Haïti / Ministère du Commerce et de l’Industrie",
      sourceType: "government-notice",
      title: "Le MCI intensifie son soutien aux MPME et déploie davantage d’actions sur le territoire national",
      url: "https://communication.gouv.ht/communiques/le-mci-intensifie-son-soutien-aux-mpme-et-deploie-davantage-dactions-sur-le-territoire-national/",
      verifiedAt: caribbeanRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.iranTechnicalPollutionRegulation)).toMatchObject({
      publishedOn: "2018-10-31",
      publisher: "Cabinet of Ministers of the Islamic Republic of Iran",
      sourceType: "official-regulation",
      title: "آیین‌نامه فنی در زمینه کنترل و کاهش آلودگی‌ها (موضوع ماده (۲) قانون هوای پاک)",
      url: "https://nezamat.ir/post-41054/",
      verifiedAt: levantRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.iranArticle4Amendment2024)).toMatchObject({
      publishedOn: "2024-02-18",
      publisher: "Cabinet of Ministers of the Islamic Republic of Iran",
      sourceType: "official-regulation",
      title: "اصلاح ماده (۴) آیین‌نامه فنی در زمینه کنترل و کاهش آلودگی‌ها (موضوع ماده (۲) قانون هوای پاک)",
      url: "https://nezamat.ir/post-44973/",
      verifiedAt: levantRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.iraqTr167AmendmentDecision2024)).toMatchObject({
      publishedOn: "2024-04-15",
      publisher: "Iraq Central Organization for Standardization and Quality Control (COSQC)",
      sourceType: "official-regulation",
      title: "قرارات هيئة اعتماد المواصفات العراقية في اجتماعها المرقم (507) في 3/3/2024",
      url: "https://www.iraqi-standards.org/wan/ns/p/0000018.html",
      verifiedAt: levantRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.iraqTr167ImplementationNotice2025)).toMatchObject({
      publishedOn: "2025-12-12",
      publisher: "Iraqi News Agency (INA) / Iraq Ministry of Trade",
      sourceType: "government-notice",
      title: "تشمل جميع المركبات.. التجارة: بدء تطبيق المواصفة العراقية للسيارات مطلع 2026",
      url: "https://ina.iq/ar/local/250006-2026.html",
      verifiedAt: levantRefreshedAt,
    });
  });

  it("uses exact source metadata and the real verification time for JAM, LBN, LBR, and LBY", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const africaRefreshedAt = new Date("2026-08-10T19:46:12.000Z");
    const caribbeanRefreshedAt = new Date("2026-08-10T19:36:45.000Z");
    const levantRefreshedAt = new Date("2026-08-10T18:55:45.000Z");

    expect(sourceById.get(acceptanceFixtureIds.source.jamaicaEnvironment)).toMatchObject({
      publishedOn: "2022-05-20",
      publisher: "Jamaica Ministry of Energy, Transport and Telecommunications",
      sourceType: "official-regulation",
      title: "The Road Traffic Regulations, 2022 — Regulation 66 (PDF pp. 66–68) and Eighth Schedule Part A (PDF pp. 287–289)",
      url: "https://mtm.gov.jm/wp-content/uploads/2023/02/Road-Traffic-Regulations-May-20-2022-complete.pdf",
      verifiedAt: caribbeanRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.jamaicaTransport)).toMatchObject({
      publishedOn: null,
      publisher: "Jamaica Ministry of Energy, Transport and Telecommunications",
      sourceType: "government-notice",
      title: "Forms and Documents – Ministry of Energy, Transport and Telecommunications",
      url: "https://mtm.gov.jm/forms/",
      verifiedAt: caribbeanRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.lebanonEnvironmentalProtectionLaw444)).toMatchObject({
      publishedOn: "2002-07-29",
      publisher: "Lebanon Ministry of Environment",
      sourceType: "official-regulation",
      title: "قانون رقم 444 - حماية البيئة",
      url: "https://moe.gov.lb/%D8%A7%D9%84%D9%88%D8%B2%D8%A7%D8%B1%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86-%D9%88%D8%A7%D9%84%D8%A7%D9%86%D8%B8%D9%85%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-444-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9.aspx?lang=ar-LB",
      verifiedAt: levantRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.lebanonThirdBur2019)).toMatchObject({
      publishedOn: "2019-12-31",
      publisher: "Lebanon Ministry of Environment / UNDP / GEF",
      sourceType: "government-notice",
      title: "Lebanon’s Third Biennial Update Report to the UNFCCC",
      url: "https://lebanon.un.org/en/download/60471/107789",
      verifiedAt: levantRefreshedAt,
    });
    expect(acceptanceFixtureIds.source.liberiaEnvironmentalProtectionManagementLaw).toBe(
      "10000000-0000-4000-8000-000000000660",
    );
    expect(acceptanceFixtureIds.source.liberiaVehicleAdministrativeRegulation2011).toBe(
      "10000000-0000-4000-8000-000000000661",
    );
    expect(acceptanceFixtureIds.source.libyaEnvironmentalProtectionLaw15).toBe(
      "10000000-0000-4000-8000-000000000662",
    );
    expect(acceptanceFixtureIds.source.libyaEnvironmentalExecutiveRegulation448).toBe(
      "10000000-0000-4000-8000-000000000663",
    );
    expect(sourceById.get(acceptanceFixtureIds.source.liberiaEnvironmentalProtectionManagementLaw)).toMatchObject({
      publishedOn: "2003-04-30",
      publisher: "Republic of Liberia / Ministry of Foreign Affairs; official EPA host",
      sourceType: "official-regulation",
      title: "Environmental Protection and Management Law of Liberia",
      url: "https://epa.gov.lr/wp-content/uploads/2025/10/lbr53038.pdf",
      verifiedAt: africaRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.liberiaVehicleAdministrativeRegulation2011)).toMatchObject({
      publishedOn: "2011-06-18",
      publisher: "Liberia Ministry of Transport",
      sourceType: "official-regulation",
      title: "Ministry of Transport Administrative Regulation PG/No.002/82997 June, 2011",
      url: "https://mot.gov.lr/sites/default/files/documents/ADMINISTRATIVE%20REGULATION%20%20AA%20June%2017%2C%202016%20-%20Copy.pdf",
      verifiedAt: africaRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.libyaEnvironmentalProtectionLaw15)).toMatchObject({
      publishedOn: "2003-06-13",
      publisher: "General People's Congress / Libya Ministry of Environment",
      sourceType: "official-regulation",
      title: "Law No. 15 of 2003 on Environmental Protection",
      url: "https://environment.gov.ly/wp-content/uploads/2022/04/Image-to-PDF-%D8%A7%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-15-%D9%A2%D9%A0%D9%A2%D9%A2-%D9%A0%D9%A4-%D9%A1%D9%A5-%D9%A1%D9%A5-%D9%A5%D9%A2-%D9%A1%D9%A0.pdf",
      verifiedAt: africaRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.libyaEnvironmentalExecutiveRegulation448)).toMatchObject({
      publishedOn: "2009-10-09",
      publisher: "General People's Committee / Libya Ministry of Environment",
      sourceType: "official-regulation",
      title: "Decision No. 448 of 2009 — executive regulation for Law No. 15 of 2003 on Environmental Protection",
      url: "https://environment.gov.ly/wp-content/uploads/2022/04/%D8%A7%D9%84%D9%84%D8%A7%D8%A6%D8%AD%D8%A9-%D8%A7%D9%84%D8%AA%D9%86%D9%81%D9%8A%D8%B0%D9%8A%D8%A9-%D9%84%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-15.pdf",
      verifiedAt: africaRefreshedAt,
    });
  });

  it("uses exact source metadata and the real verification time for MLI, MMR, MRT, and NCL", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const nclRefreshedAt = new Date("2026-08-10T20:20:37.000Z");
    const africaRefreshedAt = new Date("2026-08-10T19:46:12.000Z");
    const myanmarVerifiedAt = new Date("2026-08-10T17:38:18.000Z");

    expect(acceptanceFixtureIds.source.maliTechnicalInspectionOrder2020).toBe(
      "10000000-0000-4000-8000-000000000664",
    );
    expect(acceptanceFixtureIds.source.maliRoadUseVehicleCirculationDecree2023).toBe(
      "10000000-0000-4000-8000-000000000665",
    );
    expect(acceptanceFixtureIds.source.mauritaniaAirPollutionLaw2018).toBe(
      "10000000-0000-4000-8000-000000000668",
    );
    expect(acceptanceFixtureIds.source.mauritaniaEnvironmentCode2000).toBe(
      "10000000-0000-4000-8000-000000000669",
    );
    expect(sourceById.get(acceptanceFixtureIds.source.maliTechnicalInspectionOrder2020)).toMatchObject({
      publishedOn: "2020-03-27",
      publisher: "Republic of Mali / Secretariat General of Government",
      sourceType: "official-regulation",
      title: "Journal officiel de la République du Mali n°08 du 27 mars 2020 — Arrêté n°2020-1080/MTMU-SG du 20 mars 2020 fixant les modalités de mise en œuvre du contrôle technique automobile",
      url: "https://sgg-mali.ml/JO/2020/mali-jo-2020-08.pdf",
      verifiedAt: africaRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.maliRoadUseVehicleCirculationDecree2023)).toMatchObject({
      publishedOn: "2023-09-29",
      publisher: "Republic of Mali / Secretariat General of Government",
      sourceType: "official-regulation",
      title: "Journal officiel de la République du Mali n°26 du 29 septembre 2023 — Décret n°2023-0509/PT-RM du 12 septembre 2023 fixant les conditions de l’usage des voies ouvertes à la circulation publique et de la mise en circulation des véhicules",
      url: "https://sgg-mali.ml/JO/2023/mali-jo-2023-26.pdf",
      verifiedAt: africaRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.myanmarEnvironment)).toMatchObject({
      publishedOn: "2015-12-29",
      publisher: "Myanmar Ministry of Environmental Conservation and Forestry / Environmental Conservation Department",
      sourceType: "government-notice",
      verifiedAt: myanmarVerifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.myanmarTransport)).toMatchObject({
      publishedOn: "2020-05-26",
      publisher: "Republic of the Union of Myanmar / Ministry of Transport and Communications / Road Transport Administration Department",
      sourceType: "official-regulation",
      verifiedAt: myanmarVerifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.mauritaniaAirPollutionLaw2018)).toMatchObject({
      publishedOn: "2018-01-02",
      publisher: "Mauritania Ministry of Environment and Sustainable Development",
      sourceType: "official-regulation",
      title: "Law No. 2018-002 on air-pollution prevention and control",
      url: "http://www.environnement.gov.mr/fr/images/reglementations/Loi_pollution_Air_FR.pdf",
      verifiedAt: africaRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.mauritaniaEnvironmentCode2000)).toMatchObject({
      publishedOn: "2000-10-30",
      publisher: "Islamic Republic of Mauritania",
      sourceType: "official-regulation",
      title: "Journal Officiel de la République Islamique de Mauritanie n°985 — Law No. 2000-045 of 26 July 2000 establishing the Environment Code",
      url: "http://www.environnement.gov.mr/fr/images/reglementations/LOI_Code_de_l_Environnement.pdf",
      verifiedAt: africaRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.newCaledoniaEnvironment)).toMatchObject({
      publishedOn: "1965-09-27",
      publisher: "Congress of New Caledonia / Juridoc",
      sourceType: "official-regulation",
      title: "Délibération n° 224 des 9, 10 et 11 juin 1965 portant règlement général sur la police de la circulation et le roulage",
      url: "https://juridoc.gouv.nc/juridoc/jdcodes.nsf/0/59295762BD9870FE4B258184001CDC1D/%24File/Code_route_NC_9-10-11-06-1965_ChG_07-10-2025.pdf?OpenElement=",
      verifiedAt: nclRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.newCaledoniaTransport)).toMatchObject({
      publishedOn: "2019-10-03",
      publisher: "New Caledonia Directorate of Infrastructure, Topography and Land Transport",
      sourceType: "government-notice",
      title: "Importation, transformation ou remise en circulation d'un véhicule",
      url: "https://dittt.gouv.nc/vehicule-formalites/importation-transformation-ou-remise-en-circulation-dun-vehicule",
      verifiedAt: nclRefreshedAt,
    });
  });

  it.each([
    ["BWA", "BW-NATIONAL", "https://bobstandards.bw/product/bos-1342014-ed-2/", "https://bobstandards.bw/wp-content/uploads/2024/06/BOBS-Standards-Catalogue-June-2024.pdf"],
    ["NAM", "NA-NATIONAL", "https://nsi.com.na/wp-content/uploads/2026/03/Standards-Act-18-of-2005.pdf", "https://nsi.com.na/wp-content/uploads/2026/03/5290-Gov-N248-249-Standard-Regulations.pdf"],
    ["TZA", "TZ-NATIONAL", "https://www.nemc.or.tz/uploads/publications/sw-1645446559-Air_Quality_Standards_Regulations_2007.pdf", "https://tanzlii.org/akn/tz/act/gn/2007/237/eng@2007-01-01/publication"],
    ["UGA", "UG-NATIONAL", "https://www.nema.go.ug/en/wp-content/uploads/2025/01/The-National-Environment-Air-Quality-Standards-Regulations-S.I.-No.-22-of-2024-1.pdf", "https://webstore.unbs.go.ug/store.php?preview=&src=5321"],
    ["ZMB", "ZM-NATIONAL", "https://www.parliament.gov.zm/sites/default/files/documents/acts/Environmetal%20Mangement%20Act%2012%20of%202011.pdf", "https://www.zcsa.org.zm/index.php/list-of-compulsory-standards/"],
    ["ZWE", "ZW-NATIONAL", "https://ema.co.zw/wp-content/uploads/2026/03/EMA-ACT.pdf", "https://ema.co.zw/air-emission/"],
    ["CIV", "CI-NATIONAL", "https://agp.africanlii.org/fr/akn/ci/act/decree/2017/125/fra@2017-09-14", "https://www.codinorm.ci/doc/enquete/vehicules/PNI%2015004%20Vehic%20N2%20et%20N3%20janv%202025%20V01.pdf"],
    ["MOZ", "MZ-NATIONAL", "https://sibmoz.gov.mz/content/uploads/2022/01/Regulamento-sobre-Padroes-de-Qualidade-Ambiental-e-de-Emissao-de-Efluentes.pdf", "https://inatro.gov.mz/wp-content/uploads/2019/08/Decreto-44-e-45-2017-matriculas-e-regras-de-apro-de-marcas-e-modelos.pdf"],
    ["SWZ", "SZ-NATIONAL", "https://eea.org.sz/wp-content/uploads/2020/08/Air-Pollution-Regulations-2010.pdf", "https://www.gov.sz/index.php/ministry-department/road-transportation-department"],
    ["LSO", "LS-NATIONAL", "https://www.gov.ls/eservice/roadworthiness-rw-fitness-f-of-motor-vehicles/", "https://www.mopwt.gov.ls/wp-content/uploads/2018/07/Transport_Sector_Policy.pdf"],
    ["MDG", "MG-NATIONAL", "https://www.minae.gov.mg/wp-content/uploads/2025/05/1.0.EIES-VERSION-DEFINITIVE_FIN.pdf", "https://cnlegis.gov.mg/page_cherche_dir_numeros/"],
    ["MUS", "MU-NATIONAL", "https://environment.govmu.org/Documents/communique/Returns%20on%20Enforcement%20of%20Vehicular%20Smoke%20Emissions%20%28March%202022%20to%20August%202023%29.pdf", "https://landtransport.govmu.org/Documents/Legislations/act1218.pdf"],
    ["MWI", "MW-NATIONAL", "https://portal.trade.gov.mw/en-gb/site/display/62", "https://portal.trade.gov.mw/en-gb/site/display/101"],
    ["FJI", "FJ-NATIONAL", "https://frcs.org.fj/wp-content/uploads/2025/01/SIG-2025-04-Importation-of-Motor-Vehicles-Customs-Prohibited-Imports-and-Exports-Regulations-1986.pdf", "https://frcs.org.fj/public-notice/importation-of-used-or-reconditioned-motor-vehicles-in-2026/"],
    ["BLZ", "BZ-NATIONAL", "https://doe.gov.bz/wp-content/uploads/2024/02/Pollution-Regulations.pdf", "https://doe.gov.bz/download/environmental-protection-act-chapter-328-re-2020/?wpdmdl=17080"],
    ["BRN", "BN-NATIONAL", "https://www.agc.gov.bn/AGC%20Images/LAWS/ACT_PDF/R/CHAPTER%20068%20RG1%20%282022%29.pdf", "https://www.jpd.gov.bn/SiteAssets/SitePages/Land%20Transport%20Department/Adverts/Safe%20and%20Smart%20Driving%20In%20Brunei%20Darussalam/Safe%20and%20Smart%20Driving%20in%20Brunei%20Darussalam%201st%20edition.pdf"],
    ["BTN", "BT-NATIONAL", "https://www.nec.gov.bt/publications/download/environment-standards-2020", "https://bcta.gov.bt/public-notification-implementation-of-the-road-safety-and-transport-rules-and-regulations-rstrr-2026/"],
    ["CAF", "CF-NATIONAL", "https://faolex.fao.org/docs/pdf/caf105925.pdf", "https://unfccc.int/sites/default/files/2026-03/CDN%203.0%20CAR%202025.pdf"],
    ["COD", "CD-NATIONAL", "https://medd.gouv.cd/wp-content/uploads/2020/07/attachment1.pdf", "https://transports.gouv.cd/wp-content/uploads/2025/11/ARRETE-MINISTERIEL-N%C2%B0085-DU-12-NOV-2025-PORTANT-RE_251124_152526.pdf"],
    ["COG", "CG-NATIONAL", "https://www.developpement-durable.gouv.cg/wp-content/uploads/2023/11/Loi_n_33-2023_du_17_novembre_portant_gestion_durable_de_l_environnement_en_Republique_du_Congo_.pdf", "https://www.sgg.cg/JO/2019/congo-jo-2019-29.pdf"],
    ["CUB", "CU-NATIONAL", "https://www.gacetaoficial.gob.cu/sites/default/files/goc-2023-o87.pdf", "https://www.gacetaoficial.gob.cu/sites/default/files/go_x_014_2011.pdf"],
    ["DJI", "DJ-NATIONAL", "https://www.journalofficiel.dj/texte-juridique/loi-n51-an-09-6eme-l-portant-code-de-lenvironnement/", "https://www.journalofficiel.dj/texte-juridique/decret-n2010-0230-pr-mid-relatif-aux-nouvelles-dispositions-reglementaires-du-code-de-la-route/"],
    ["ERI", "ER-NATIONAL", "https://tile.loc.gov/storage-services/service/ll/lleritrea/eritrean-notice-127-2017/eritrean-notice-127-2017.pdf", "https://tile.loc.gov/storage-services/service/ll/lleritrea/eritrean-notice-61-2002/eritrean-notice-61-2002.pdf"],
    ["GAB", "GA-NATIONAL", "https://journal-officiel.ga/6186-007-2014/", "https://journal-officiel.ga/5680-00097-mtl-2017-/"],
    ["GIN", "GN-NATIONAL", "https://medd.gov.gn/file/2022/12/Code-de-lEnvironnement-du-04-juillet-2019-1.pdf", "https://cnt.gov.gn/archive.assemblee/www.assemblee.gov.gn/node/739.html"],
    ["GMB", "GM-NATIONAL", "https://faolex.fao.org/docs/pdf/gam95812.pdf", "https://security-legislation.gm/wp-content/uploads/2022/10/Motor-Traffic-Amendment-Act-2013.pdf"],
    ["GNB", "GW-NATIONAL", "https://faolex.fao.org/docs/pdf/gbs118164.pdf", "https://bissaugov.com/ministerios/transportes-comunicacoes"],
    ["GNQ", "GQ-NATIONAL", "https://faolex.fao.org/docs/pdf/eqg102892.pdf", "https://minhacienda-gob.com/media/stream/8301"],
    ["GRL", "GL-NATIONAL", "https://nalunaarutit.gl/Rigslovgivning/1979/Bekendtgoerelse-nr-141-af-27_03_1979?sc_lang=da", "https://www.retsinformation.dk/eli/lta/2009/995"],
    ["GUY", "GY-NATIONAL", "https://mola.gov.gy/laws/Volume%206%20Cap.%2018.01%20-%2023.011696964321.pdf", "https://mola.gov.gy/laws/Volume%2011%20Cap.%2049.02%20-%2058.011696827006.pdf"],
    ["HTI", "HT-NATIONAL", "https://faolex.fao.org/docs/pdf/hai65901.pdf", "https://communication.gouv.ht/communiques/le-mci-intensifie-son-soutien-aux-mpme-et-deploie-davantage-dactions-sur-le-territoire-national/"],
    ["IRN", "IR-NATIONAL", "https://nezamat.ir/post-41054/", "https://nezamat.ir/post-44973/"],
    ["IRQ", "IQ-NATIONAL", "https://www.iraqi-standards.org/wan/ns/p/0000018.html", "https://ina.iq/ar/local/250006-2026.html"],
    ["JAM", "JM-NATIONAL", "https://mtm.gov.jm/wp-content/uploads/2023/02/Road-Traffic-Regulations-May-20-2022-complete.pdf", "https://mtm.gov.jm/forms/"],
    ["LBN", "LB-NATIONAL", "https://moe.gov.lb/%D8%A7%D9%84%D9%88%D8%B2%D8%A7%D8%B1%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86-%D9%88%D8%A7%D9%84%D8%A7%D9%86%D8%B8%D9%85%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-444-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9.aspx?lang=ar-LB", "https://lebanon.un.org/en/download/60471/107789"],
    ["LBR", "LR-NATIONAL", "https://epa.gov.lr/wp-content/uploads/2025/10/lbr53038.pdf", "https://mot.gov.lr/sites/default/files/documents/ADMINISTRATIVE%20REGULATION%20%20AA%20June%2017%2C%202016%20-%20Copy.pdf"],
    ["LBY", "LY-NATIONAL", "https://environment.gov.ly/wp-content/uploads/2022/04/Image-to-PDF-%D8%A7%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-15-%D9%A2%D9%A0%D9%A2%D9%A2-%D9%A0%D9%A4-%D9%A1%D9%A5-%D9%A1%D9%A5-%D9%A5%D9%A2-%D9%A1%D9%A0.pdf", "https://environment.gov.ly/wp-content/uploads/2022/04/%D8%A7%D9%84%D9%84%D8%A7%D8%A6%D8%AD%D8%A9-%D8%A7%D9%84%D8%AA%D9%86%D9%81%D9%8A%D8%B0%D9%8A%D8%A9-%D9%84%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-15.pdf"],
    ["MLI", "ML-NATIONAL", "https://sgg-mali.ml/JO/2020/mali-jo-2020-08.pdf", "https://sgg-mali.ml/JO/2023/mali-jo-2023-26.pdf"],
    ["MMR", "MM-NATIONAL", "https://www.ecd.gov.mm/national-environmental-quality-emission-guidelines-final/", "https://www.myanmarrtad.com/?q=en%2Fnode%2F1925"],
    ["MRT", "MR-NATIONAL", "http://www.environnement.gov.mr/fr/images/reglementations/Loi_pollution_Air_FR.pdf", "http://www.environnement.gov.mr/fr/images/reglementations/LOI_Code_de_l_Environnement.pdf"],
    ["NCL", "NC-NATIONAL", "https://juridoc.gouv.nc/juridoc/jdcodes.nsf/0/59295762BD9870FE4B258184001CDC1D/%24File/Code_route_NC_9-10-11-06-1965_ChG_07-10-2025.pdf?OpenElement=", "https://dittt.gouv.nc/vehicule-formalites/importation-transformation-ou-remise-en-circulation-dun-vehicule"],
  ] as const)("%s preserves no-data without a publishable heavy-duty limit table", async (iso3, code, sourceUrl, membershipUrl) => {
    const asOf = ["BWA", "NAM", "UGA", "SWZ", "BLZ", "CAF", "COD", "COG", "CUB", "DJI", "GIN", "GUY", "HTI", "JAM", "NCL"].includes(iso3)
      ? "2026-08-11"
      : "2026-08-10";
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3: iso3,
          powerKw: 150,
        }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({
      asOf,
      iso3,
    });
    expect(details?.jurisdictions).toMatchObject([
      {
        code,
        source: { url: sourceUrl },
        membershipSource: { url: membershipUrl },
      },
    ]);
  });

  it.each([
    ["NER", "NE-NATIONAL", "https://hydraulique.gouv.ne/wp-content/uploads/2025/07/LoiN%C2%B098-056gestiondelEnvironnement.pdf", "https://transports.gouv.ne/e-services"],
    ["NIC", "NI-NATIONAL", "https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNormaJuridica.xsp?action=openDocument&documentId=0404E60D225D0ACF062588E2006EE9F8", "https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNorma.xsp?action=openDocument&documentId=DDDCD831D507891D06258844005A7F39"],
  ] as const)("%s preserves no-data after exact official-text review", async (iso3, code, sourceUrl, membershipUrl) => {
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({ applicationScope, asOf: "2026-08-10", countryIso3: iso3, powerKw: 150 }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({ asOf: "2026-08-10", iso3 });
    expect(details?.jurisdictions).toMatchObject([{ code, source: { url: sourceUrl }, membershipSource: { url: membershipUrl } }]);
  });

  it("PNG publishes only the ADR 80/03 representative route for 2012-and-later heavy diesel motor trucks", async () => {
    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2018-12-31",
        countryIso3: "PNG",
        powerKw: 150,
      }),
    ).resolves.toEqual([]);

    await expect(
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2019-01-01",
        countryIso3: "PNG",
        powerKw: 150,
      }),
    ).resolves.toEqual([]);

    const rows = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2026-08-10",
      countryIso3: "PNG",
      powerKw: 150,
    });
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map((row) => row.limit.testCycleCode))).toEqual(
      new Set(["ESC", "ELR", "ETC"]),
    );
    expect(
      new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      ),
    ).toEqual(
      new Map([
        ["ESC:CO", 1.5],
        ["ESC:THC", 0.46],
        ["ESC:NOX", 2],
        ["ESC:PM", 0.02],
        ["ETC:CO", 4],
        ["ETC:NMHC", 0.55],
        ["ETC:NOX", 2],
        ["ETC:PM", 0.03],
        ["ELR:OPACITY", 0.5],
      ]),
    );
    expect(
      rows.every(
        (row) =>
          row.regulationId ===
            acceptanceFixtureIds.regulation.papuaNewGuineaHeavyTruckAdr803 &&
          row.citationCode ===
            "Road Traffic Rules — Vehicle Standards and Compliance 2017, Sections 6A(4)(b) and 64B" &&
          row.effectiveFrom === "2019-01-01" &&
          row.limit.sourceUrl ===
            "https://www.legislation.gov.au/F2006L04062/latest/text" &&
          row.limit.validFrom === "2019-01-01",
      ),
    ).toBe(true);

    const excludedScopes = await Promise.all(
      (["on-road-bus", "construction", "agriculture"] as const).map(
        (applicationScope) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf: "2026-08-10",
            countryIso3: "PNG",
            powerKw: 150,
          }),
      ),
    );
    expect(excludedScopes).toEqual([[], [], []]);
    const fixtureRows = buildFixtureLimits().filter(
        (row) =>
          row.regulationId ===
          acceptanceFixtureIds.regulation.papuaNewGuineaHeavyTruckAdr803,
      );
    expect(fixtureRows).toHaveLength(9);
    expect(
      fixtureRows.every((row) =>
        row.measurementBasis?.includes("manufactured on or after 2012"),
      ),
    ).toBe(true);

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({ asOf: "2026-08-10", iso3: "PNG" });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "PG-NATIONAL",
        membershipSource: {
          url: "https://www.rta.gov.pg/resources/rules/",
        },
        source: {
          url: "https://rta.gov.pg/pdfs/resources/legislation/rules/RTR_VehicleStandardsAndCompliance2018.pdf",
        },
        validFrom: "2026-08-10",
      },
    ]);
  });

  it.each([
    ["PRI", "PR-NATIONAL", "https://www.drna.pr.gov/wp-content/uploads/2019/10/Reglamento-5300-Reglamento-Control-Contaminacion-Atmosferica-1995.pdf", "https://docs.pr.gov/files/DTOP/Avisos/Reglamentos%20para%20estaciones%20oficiales.pdf"],
  ] as const)("%s preserves no-data after official portal review", async (iso3, code, sourceUrl, membershipUrl) => {
    const asOf = "2026-08-11";
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({ applicationScope, asOf, countryIso3: iso3, powerKw: 150 }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({ asOf, iso3 });
    expect(details?.jurisdictions).toMatchObject([{ code, source: { url: sourceUrl }, membershipSource: { url: membershipUrl } }]);
  });

  it("NER/NIC/PNG/PRI lock exact source metadata and actual verification time", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const verifiedAt = new Date("2026-08-10T23:00:23.000Z");
    const priRefreshedAt = new Date("2026-08-10T20:20:37.000Z");
    const latinAmericaReviewedAt = new Date("2026-08-10T20:09:01.000Z");
    const africaRefreshedAt = new Date("2026-08-10T19:46:12.000Z");

    expect(acceptanceFixtureIds.source.nigerEnvironmentalFrameworkLaw9856).toBe(
      "10000000-0000-4000-8000-000000000672",
    );
    expect(acceptanceFixtureIds.source.nigerMotorVehicleHomologationEServices).toBe(
      "10000000-0000-4000-8000-000000000673",
    );
    expect(sourceById.get(acceptanceFixtureIds.source.nigerEnvironmentalFrameworkLaw9856)).toMatchObject({
      publishedOn: "1998-12-29",
      publisher: "Republic of Niger",
      sourceType: "official-regulation",
      title: "Law No. 98-56 of 29 December 1998 — framework law on environmental management",
      url: "https://hydraulique.gouv.ne/wp-content/uploads/2025/07/LoiN%C2%B098-056gestiondelEnvironnement.pdf",
      verifiedAt: africaRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.nigerMotorVehicleHomologationEServices)).toMatchObject({
      publishedOn: null,
      publisher: "Niger Ministry of Transport and Civil Aviation",
      sourceType: "government-notice",
      title: "Services en Ligne — Homologation des Véhicules Terrestres à Moteur",
      url: "https://transports.gouv.ne/e-services",
      verifiedAt: africaRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.nicaraguaEnvironment)).toMatchObject({
      publishedOn: "1997-06-18",
      publisher: "National Assembly of Nicaragua",
      sourceType: "official-regulation",
      verifiedAt: latinAmericaReviewedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.papuaNewGuineaEnvironment)).toMatchObject({
      publishedOn: "2018-11-30",
      publisher: "Papua New Guinea Road Traffic Authority",
      sourceType: "official-regulation",
      verifiedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.puertoRicoEnvironment)).toMatchObject({
      publishedOn: null,
      publisher: "Puerto Rico Department of Natural and Environmental Resources",
      sourceType: "official-regulation",
      title: "Regulation No. 5300 — Air Pollution Control Regulation, Rule 403(B)",
      url: "https://www.drna.pr.gov/wp-content/uploads/2019/10/Reglamento-5300-Reglamento-Control-Contaminacion-Atmosferica-1995.pdf",
      verifiedAt: priRefreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.puertoRicoTransport)).toMatchObject({
      publishedOn: null,
      publisher: "Puerto Rico Department of Transportation and Public Works",
      sourceType: "official-regulation",
      title: "Regulation No. 9526 — official inspection stations and motor vehicle inspection",
      url: "https://docs.pr.gov/files/DTOP/Avisos/Reglamentos%20para%20estaciones%20oficiales.pdf",
      verifiedAt: priRefreshedAt,
    });
  });

  it.each([
    ["PRK", "KP-NATIONAL", "https://faolex.fao.org/docs/pdf/prk22293.pdf", "https://unfccc.int/documents/497842"],
    ["PRY", "PY-NATIONAL", "https://www.mades.gov.py/wp-content/uploads/2025/03/DECRETO-Nro-1269-de-fecha-13-de-febrero-de-2019.pdf", "https://www.mades.gov.py/wp-content/uploads/2025/04/RESOLUCION-N%C2%B0-605-DE-FECHA-29-DE-DICIEMBRE-DE-2021.pdf"],
    ["PSE", "PS-NATIONAL", "https://mjr.ogb.gov.ps/MergedLegislations/ViewText/66/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-7-%D9%84%D8%B3%D9%86%D8%A9-1999%D9%85-%D8%A8%D8%B4%D8%A3%D9%86-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9-%D9%81%D9%84%D8%B3%D8%B7%D9%8A%D9%86", "https://mjr.ogb.gov.ps/MergedLegislations/ViewText/31/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%A7%D9%84%D9%85%D8%B1%D9%88%D8%B1-%D8%B1%D9%82%D9%85-5-%D9%84%D8%B3%D9%86%D8%A9-2000%D9%85-%D9%81%D9%84%D8%B3%D8%B7%D9%8A%D9%86"],
    ["SDN", "SD-NATIONAL", "https://hcenr.gov.sd/wp-content/uploads/2021/05/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9-%D9%84%D8%B3%D9%86%D8%A9-2001.pdf", "https://unfccc.int/documents/646439"],
  ] as const)("%s preserves no-data after exact official-text review", async (iso3, code, sourceUrl, membershipUrl) => {
    const asOf = iso3 === "PRY" ? "2026-08-10" : "2026-08-11";
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({ applicationScope, asOf, countryIso3: iso3, powerKw: 150 }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({ asOf, iso3 });
    expect(details?.jurisdictions).toMatchObject([
      {
        code,
        membershipSource: { url: membershipUrl },
        source: { url: sourceUrl },
        validFrom: "2026-08-10",
      },
    ]);
  });

  it("PRK/PRY/PSE/SDN lock exact source metadata and actual verification time", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const refreshedAt = new Date("2026-08-10T20:20:37.000Z");
    const latinAmericaReviewedAt = new Date("2026-08-10T20:09:01.000Z");

    expect(sourceById.get(acceptanceFixtureIds.source.northKoreaEnvironment)).toMatchObject({
      publishedOn: "1986-04-09",
      publisher: "Democratic People's Republic of Korea",
      sourceType: "official-regulation",
      title: "Law of the Democratic People's Republic of Korea on the Protection of the Environment",
      url: "https://faolex.fao.org/docs/pdf/prk22293.pdf",
      verifiedAt: refreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.northKoreaTransport)).toMatchObject({
      publishedOn: "2022-06-02",
      publisher: "Democratic People's Republic of Korea / UNFCCC",
      sourceType: "government-notice",
      title: "Democratic People's Republic of Korea First NDC (Updated submission)",
      url: "https://unfccc.int/documents/497842",
      verifiedAt: refreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.northKoreaTransport)?.url).not.toContain(".go.kr");
    expect(sourceById.get(acceptanceFixtureIds.source.paraguayEnvironment)).toMatchObject({
      publishedOn: "2019-02-13",
      publisher: "Presidency of the Republic of Paraguay / MADES",
      sourceType: "official-regulation",
      verifiedAt: latinAmericaReviewedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.palestineEnvironment)).toMatchObject({
      publishedOn: "1999-12-28",
      publisher: "Palestine Bureau of Legislation and Legal Opinion",
      sourceType: "official-regulation",
      title: "Environment Law No. 7 of 1999 — Articles 19 and 22 air standards and vehicle exhaust",
      verifiedAt: refreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.palestineTransport)).toMatchObject({
      publishedOn: "2000-09-17",
      publisher: "Palestine Bureau of Legislation and Legal Opinion",
      sourceType: "official-regulation",
      title: "Traffic Law No. 5 of 2000 — vehicle specifications, first registration and periodic inspection",
      verifiedAt: refreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.sudanEnvironment)).toMatchObject({
      publishedOn: null,
      publisher: "Republic of the Sudan / Higher Council for Environment and Natural Resources",
      sourceType: "official-regulation",
      title: "قانون حماية البيئة لسنة 2001 / Environment Protection Act 2001 (Act No. 18 of 2001)",
      url: "https://hcenr.gov.sd/wp-content/uploads/2021/05/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9-%D9%84%D8%B3%D9%86%D8%A9-2001.pdf",
      verifiedAt: refreshedAt,
    });
    expect(sourceById.get(acceptanceFixtureIds.source.sudanTransport)).toMatchObject({
      publishedOn: "2025-04-14",
      publisher: "Republic of the Sudan, Council of Ministers, Higher Council for Environment and Natural Resources / UNFCCC",
      sourceType: "government-notice",
      title: "Sudan. National Communication (NC). NC 3.",
      url: "https://unfccc.int/documents/646439",
      verifiedAt: refreshedAt,
    });
  });

  it("keeps PRK/PSE/SDN/PRI/NCL stable identities and refreshes every source, jurisdiction, and membership record", () => {
    const refreshedAt = new Date("2026-08-10T20:20:37.000Z");
    const refreshedJurisdictions = [
      {
        countryIso3: "PRK",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.northKorea,
        membershipSourceId: acceptanceFixtureIds.source.northKoreaTransport,
        sourceId: acceptanceFixtureIds.source.northKoreaEnvironment,
      },
      {
        countryIso3: "PSE",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.palestine,
        membershipSourceId: acceptanceFixtureIds.source.palestineTransport,
        sourceId: acceptanceFixtureIds.source.palestineEnvironment,
      },
      {
        countryIso3: "SDN",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.sudan,
        membershipSourceId: acceptanceFixtureIds.source.sudanTransport,
        sourceId: acceptanceFixtureIds.source.sudanEnvironment,
      },
      {
        countryIso3: "PRI",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.puertoRico,
        membershipSourceId: acceptanceFixtureIds.source.puertoRicoTransport,
        sourceId: acceptanceFixtureIds.source.puertoRicoEnvironment,
      },
      {
        countryIso3: "NCL",
        jurisdictionId: acceptanceFixtureIds.jurisdiction.newCaledonia,
        membershipSourceId: acceptanceFixtureIds.source.newCaledoniaTransport,
        sourceId: acceptanceFixtureIds.source.newCaledoniaEnvironment,
      },
    ] as const;

    expect(
      refreshedJurisdictions.map(({ sourceId, membershipSourceId }) => [
        sourceId,
        membershipSourceId,
      ]),
    ).toEqual([
      ["10000000-0000-4000-8000-000000000680", "10000000-0000-4000-8000-000000000681"],
      ["10000000-0000-4000-8000-000000000684", "10000000-0000-4000-8000-000000000685"],
      ["10000000-0000-4000-8000-000000000686", "10000000-0000-4000-8000-000000000687"],
      ["10000000-0000-4000-8000-000000000678", "10000000-0000-4000-8000-000000000679"],
      ["10000000-0000-4000-8000-000000000670", "10000000-0000-4000-8000-000000000671"],
    ]);
    expect(
      refreshedJurisdictions.map(({ jurisdictionId }) => jurisdictionId),
    ).toEqual([
      "10000000-0000-4000-8000-000000000649",
      "10000000-0000-4000-8000-000000000651",
      "10000000-0000-4000-8000-000000000652",
      "10000000-0000-4000-8000-000000000648",
      "10000000-0000-4000-8000-000000000644",
    ]);

    for (const expected of refreshedJurisdictions) {
      const sourceRecords = fixtureSources.filter(
        ({ id }) =>
          id === expected.sourceId || id === expected.membershipSourceId,
      );
      expect(sourceRecords).toHaveLength(2);
      expect(
        sourceRecords.every(
          ({ createdAt, updatedAt, verifiedAt }) =>
            createdAt?.toISOString() === refreshedAt.toISOString() &&
            updatedAt?.toISOString() === refreshedAt.toISOString() &&
            verifiedAt?.toISOString() === refreshedAt.toISOString(),
        ),
      ).toBe(true);

      expect(
        fixtureJurisdictions.find(({ id }) => id === expected.jurisdictionId),
      ).toMatchObject({
        countryIso3: expected.countryIso3,
        createdAt: refreshedAt,
        dataSourceId: expected.sourceId,
        updatedAt: refreshedAt,
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureCountryJurisdictions.find(
          ({ countryIso3, jurisdictionId }) =>
            countryIso3 === expected.countryIso3 &&
            jurisdictionId === expected.jurisdictionId,
        ),
      ).toMatchObject({
        createdAt: refreshedAt,
        dataSourceId: expected.membershipSourceId,
        updatedAt: refreshedAt,
        validFrom: "2026-08-10",
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureRegulations.filter(
          ({ jurisdictionId }) => jurisdictionId === expected.jurisdictionId,
        ),
      ).toEqual([]);
    }
  });

  it.each([
    [
      "SLB",
      "SB-NATIONAL",
      "https://attorneygenerals.gov.sb/legislation-dashboard/download-info/road-transport-act-cap-131/",
      "https://unfccc.int/node/649205",
    ],
    [
      "SLE",
      "SL-NATIONAL",
      "https://www.parliament.gov.sl/uploads/acts/THE%20ENVIRONMENT%20PROTECTION%20AGENCY%20ACT%2C%202022.pdf",
      "https://epa.gov.sl/wp-content/uploads/2025/03/Gender-Sesitive-National-e-Mobility_-Strategy-2024-35_EPA-converted0.pdf",
    ],
    [
      "SLV",
      "SV-NATIONAL",
      "https://osartec.gob.sv/wp-content/uploads/download-manager-files/RTS-Calidad-del-aire_Fuentes-Moviles.pdf",
      "https://osartec.gob.sv/servicios/derogaciones/",
    ],
    [
      "SOM",
      "SO-NATIONAL",
      "https://moecc.gov.so/wp-content/uploads/2024/10/Environmental-Protection-and-Management-Act-Engl_240625_145520-2.pdf",
      "https://unfccc.int/sites/default/files/2025-09/Somalia%20NDC%203.0_Official_2025.pdf",
    ],
  ] as const)("%s preserves no-data after exact official-text review", async (iso3, code, sourceUrl, membershipUrl) => {
    const asOf = "2026-08-10";
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({ applicationScope, asOf, countryIso3: iso3, powerKw: 150 }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({ asOf, iso3 });
    expect(details?.jurisdictions).toMatchObject([
      {
        code,
        membershipSource: { url: membershipUrl },
        source: { url: sourceUrl },
        validFrom: "2026-08-10",
      },
    ]);
    expect(
      fixtureRegulations.some(
        (regulation) => regulation.jurisdictionId === details?.jurisdictions[0]?.id,
      ),
    ).toBe(false);
  });

  it("SLB/SLE/SLV/SOM lock exact source metadata and actual verification time", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const verifiedAt = new Date(
      TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO,
    );
    const expectedSources = [
      [
        acceptanceFixtureIds.source.solomonIslandsEnvironment,
        {
          publishedOn: null,
          publisher:
            "Attorney-General’s Chambers, Solomon Islands Government / Ministry of Justice and Legal Affairs",
          sourceType: "official-regulation",
          title: "Road Transport Act (Cap. 131)",
          url: "https://attorneygenerals.gov.sb/legislation-dashboard/download-info/road-transport-act-cap-131/",
        },
      ],
      [
        acceptanceFixtureIds.source.solomonIslandsTransport,
        {
          publishedOn: "2025-08-13",
          publisher:
            "Solomon Islands Government, Climate Change Division, Ministry of Environment, Climate Change, Disaster Management and Meteorology / UNFCCC",
          sourceType: "government-notice",
          title:
            "Solomon Islands Nationally Determined Contribution 3.0, 2025–2035",
          url: "https://unfccc.int/node/649205",
        },
      ],
      [
        acceptanceFixtureIds.source.sierraLeoneEnvironment,
        {
          publishedOn: "2022-09-15",
          publisher: "Government Printing Department / Parliament of Sierra Leone",
          sourceType: "official-regulation",
          title:
            "The Environment Protection Agency Act, 2022 (Act No. 15 of 2022)",
          url: "https://www.parliament.gov.sl/uploads/acts/THE%20ENVIRONMENT%20PROTECTION%20AGENCY%20ACT%2C%202022.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.sierraLeoneTransport,
        {
          publishedOn: "2024-11-22",
          publisher: "Environment Protection Agency Sierra Leone",
          sourceType: "government-notice",
          title:
            "National e-Mobility Strategy 2024–2035 — no type approval and proposed Euro IV–VI pathway",
          url: "https://epa.gov.sl/wp-content/uploads/2025/03/Gender-Sesitive-National-e-Mobility_-Strategy-2024-35_EPA-converted0.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.elSalvadorEnvironment,
        {
          publishedOn: "2024-06-13",
          publisher:
            "Ministerio de Medio Ambiente y Recursos Naturales / Diario Oficial / Imprenta Nacional, El Salvador",
          sourceType: "official-regulation",
          title:
            "Acuerdo No. 126 — Reglamento Técnico Salvadoreño RTS 13.01.02:23 Calidad del Aire. Control de Emisiones Atmosféricas Generadas por Fuentes Móviles. Vehículos Terrestres. Límites Permisibles, Especificaciones Técnicas del Equipo y Procesos de Medición",
          url: "https://osartec.gob.sv/wp-content/uploads/download-manager-files/RTS-Calidad-del-aire_Fuentes-Moviles.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.elSalvadorTransport,
        {
          publishedOn: null,
          publisher: "Organismo Salvadoreño de Reglamentación Técnica (OSARTEC)",
          sourceType: "government-notice",
          title: "Derogaciones",
          url: "https://osartec.gob.sv/servicios/derogaciones/",
        },
      ],
      [
        acceptanceFixtureIds.source.somaliaEnvironment,
        {
          publishedOn: null,
          publisher: "Federal Government of Somalia / Ministry of Environment and Climate Change",
          sourceType: "official-regulation",
          title: "Environmental Protection and Management Act",
          url: "https://moecc.gov.so/wp-content/uploads/2024/10/Environmental-Protection-and-Management-Act-Engl_240625_145520-2.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.somaliaTransport,
        {
          publishedOn: "2025-09-08",
          publisher: "Federal Republic of Somalia / UNFCCC",
          sourceType: "government-notice",
          title:
            "Updated Somalia's Third Generation Nationally Determined Contribution (NDC 3.0) — transport mitigation actions",
          url: "https://unfccc.int/sites/default/files/2025-09/Somalia%20NDC%203.0_Official_2025.pdf",
        },
      ],
    ] as const;

    for (const [sourceId, expectedSource] of expectedSources) {
      expect(sourceById.get(sourceId)).toMatchObject({
        ...expectedSource,
        verifiedAt,
      });
    }
  });

  it.each([
    [
      "SSD",
      "SS-NATIONAL",
      "https://ssnbs.gov.ss/wp-content/uploads/2026/02/National-Bureau-of-Standards-Act-2012-.pdf",
      "https://unfccc.int/documents/497930",
    ],
    [
      "SUR",
      "SR-NATIONAL",
      "https://www.dna.sr/media/bkih12kt/sb_2020___97.pdf",
      "https://www.dna.sr/media/fadicptr/s-b-_2024_no-_56__wet_van_21_mei_2024__houdende_wijziging_van_de_milieu_raamwet__s-b-_2020_no-_97_.pdf",
    ],
    [
      "SYR",
      "SY-NATIONAL",
      "https://faolex.fao.org/docs/pdf/syr212392.pdf",
      "https://sana.sy/economy/2238146/",
    ],
    [
      "TCD",
      "TD-NATIONAL",
      "https://www.environnement.gouv.td/sites/default/files/inline-files/7.pdf",
      "https://unfccc.int/documents/645659",
    ],
  ] as const)("%s preserves no-data after exact official-text review", async (iso3, code, sourceUrl, membershipUrl) => {
    const asOf = "2026-08-10";
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({ applicationScope, asOf, countryIso3: iso3, powerKw: 150 }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);
    const details = await createCountryRepository(testDatabase.database).findDetailsByIso3({ asOf, iso3 });
    expect(details?.jurisdictions).toMatchObject([
      {
        code,
        membershipSource: { url: membershipUrl },
        source: { url: sourceUrl },
        validFrom: "2026-08-10",
      },
    ]);
    expect(
      fixtureRegulations.some(
        (regulation) => regulation.jurisdictionId === details?.jurisdictions[0]?.id,
      ),
    ).toBe(false);
  });

  it("SSD/SUR/SYR/TCD lock exact source metadata and actual verification time", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const verifiedAt = new Date(
      TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO,
    );
    const refreshedVerifiedAt = new Date("2026-08-10T18:55:45.000Z");
    const expectedSources = [
      [
        acceptanceFixtureIds.source.southSudanEnvironment,
        {
          publishedOn: null,
          publisher: "South Sudan National Bureau of Standards",
          sourceType: "official-regulation",
          title: "National Bureau of Standards Act, 2012",
          url: "https://ssnbs.gov.ss/wp-content/uploads/2026/02/National-Bureau-of-Standards-Act-2012-.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.southSudanTransport,
        {
          publishedOn: "2022-06-02",
          publisher: "South Sudan Ministry of Environment and Forestry / UNFCCC",
          sourceType: "government-notice",
          title: "South Sudan's Second Nationally Determined Contribution",
          url: "https://unfccc.int/documents/497930",
        },
      ],
      [
        acceptanceFixtureIds.source.surinameEnvironment,
        {
          publishedOn: "2020-05-14",
          publisher: "De Nationale Assemblée / Staatsblad van de Republiek Suriname",
          sourceType: "official-regulation",
          title:
            "WET van 07 mei 2020, houdende regels voor duurzaam milieumanagement (Milieu Raamwet), S.B. 2020 no. 97",
          url: "https://www.dna.sr/media/bkih12kt/sb_2020___97.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.surinameTransport,
        {
          publishedOn: "2024-05-28",
          publisher:
            "De Nationale Assemblée / Staatsblad van de Republiek Suriname",
          sourceType: "official-regulation",
          title:
            "Wet van 21 mei 2024, houdende wijziging van de Milieu Raamwet (S.B. 2020 no. 97), S.B. 2024 no. 56",
          url: "https://www.dna.sr/media/fadicptr/s-b-_2024_no-_56__wet_van_21_mei_2024__houdende_wijziging_van_de_milieu_raamwet__s-b-_2020_no-_97_.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.syriaEnvironmentLaw12,
        {
          publishedOn: "2012-03-29",
          publisher: "Syrian Arab Republic / FAOLEX",
          sourceType: "official-regulation",
          title: "القانون 12 لعام 2012 قانون وزارة الدولة لشؤون البيئة",
          url: "https://faolex.fao.org/docs/pdf/syr212392.pdf",
          verifiedAt: refreshedVerifiedAt,
        },
      ],
      [
        acceptanceFixtureIds.source.syriaVehicleImportNotice2025,
        {
          publishedOn: "2025-06-30",
          publisher: "Syrian Arab News Agency (SANA) / Ministry of Economy and Industry",
          sourceType: "government-notice",
          title: "وزارة الاقتصاد والصناعة توضح أسباب منع استيراد السيارات المستعملة",
          url: "https://sana.sy/economy/2238146/",
          verifiedAt: refreshedVerifiedAt,
        },
      ],
      [
        acceptanceFixtureIds.source.chadEnvironment,
        {
          publishedOn: "2009-08-06",
          publisher: "Republic of Chad / Ministry of Environment and Fisheries Resources",
          sourceType: "official-regulation",
          title:
            "Décret n° 904/PR/PM/MERH/2009 portant réglementation des pollutions et des nuisances à l'environnement",
          url: "https://www.environnement.gouv.td/sites/default/files/inline-files/7.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.chadTransport,
        {
          publishedOn: "2025-02-12",
          publisher: "Republic of Chad / UNFCCC",
          sourceType: "government-notice",
          title: "Chad. Biennial update reports (BUR). BUR 1.",
          url: "https://unfccc.int/documents/645659",
        },
      ],
    ] as const;

    for (const [sourceId, expectedSource] of expectedSources) {
      const expectedVerifiedAt =
        "verifiedAt" in expectedSource ? expectedSource.verifiedAt : verifiedAt;
      expect(sourceById.get(sourceId)).toMatchObject({
        ...expectedSource,
        verifiedAt: expectedVerifiedAt,
      });
    }
  });

  it.each([
    [
      "TGO",
      "TG-NATIONAL",
      "https://jo.gouv.tg/sites/default/files/JO/JO_SPECIAL_BIS_71E_N_25.pdf",
      "https://www.jo.gouv.tg/sites/default/files/JO/JOS_07_10_2022%20-%2067%20E%20ANNEE%20N%C2%B041%20BIS.pdf",
    ],
    [
      "TLS",
      "TL-NATIONAL",
      "https://www.mj.gov.tl/jornal/public/docs/2012/serie_1/serie1_no24.pdf",
      "https://www.mj.gov.tl/jornal/public/docs/2002_2005/decreto_lei_governo/6_2003.pdf",
    ],
    [
      "TTO",
      "TT-NATIONAL",
      "https://www.ema.co.tt/our-environment/air/",
      "https://laws.gov.tt/ttdll-web/revision/download/123556?type=amendment",
    ],
  ] as const)(
    "%s preserves no-data after exact official-text review",
    async (iso3, code, sourceUrl, membershipUrl) => {
      const asOf = "2026-08-10";
      const results = await Promise.all(
        ([
          "on-road-truck",
          "on-road-bus",
          "construction",
          "agriculture",
        ] as const).map((applicationScope) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf,
            countryIso3: iso3,
            powerKw: 150,
          }),
        ),
      );
      expect(results).toEqual([[], [], [], []]);

      const details = await createCountryRepository(
        testDatabase.database,
      ).findDetailsByIso3({ asOf, iso3 });
      expect(details?.jurisdictions).toMatchObject([
        {
          code,
          membershipSource: { url: membershipUrl },
          source: { url: sourceUrl },
          validFrom: "2026-08-10",
        },
      ]);
      expect(
        fixtureRegulations.some(
          (regulation) =>
            regulation.jurisdictionId === details?.jurisdictions[0]?.id,
        ),
      ).toBe(false);

    },
  );

  it("TWN applies full-coverage Phase 6 road limits from 2021-09-01 without extending them to non-road scopes", async () => {
    const roadScopes = ["on-road-truck", "on-road-bus"] as const;
    const taiwanLimitRows = buildFixtureLimits().filter(
      (row) =>
        row.regulationId ===
        acceptanceFixtureIds.regulation.taiwanHeavyDieselPhase6,
    );

    for (const applicationScope of roadScopes) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2021-08-31",
          countryIso3: "TWN",
          powerKw: 150,
        }),
      ).resolves.toEqual([]);

      const rows = await repository().findEffectiveByCountry({
        applicationScope,
        asOf: "2021-09-01",
        countryIso3: "TWN",
        powerKw: 150,
      });
      expect(rows).toHaveLength(16);
      expect(new Set(rows.map((row) => row.regulationId))).toEqual(
        new Set([acceptanceFixtureIds.regulation.taiwanHeavyDieselPhase6]),
      );
      expect(new Set(rows.map((row) => row.limit.testCycleCode))).toEqual(
        new Set(["WHSC", "WHTC", "WNTE"]),
      );

      const values = new Map(
        rows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      expect(values).toEqual(
        new Map([
          ["WHSC:CO", 1500],
          ["WHSC:THC", 130],
          ["WHSC:NOX", 400],
          ["WHSC:PM", 10],
          ["WHSC:PN", 800],
          ["WHSC:NH3", 10],
          ["WHTC:CO", 4000],
          ["WHTC:THC", 160],
          ["WHTC:NOX", 460],
          ["WHTC:PM", 10],
          ["WHTC:PN", 600],
          ["WHTC:NH3", 10],
          ["WNTE:CO", 2000],
          ["WNTE:THC", 220],
          ["WNTE:NOX", 600],
          ["WNTE:PM", 16],
        ]),
      );
      expect(
        rows.every((row) => {
          if (row.limit.pollutantCode === "NH3") {
            return row.limit.unitCode === "ppm";
          }
          if (row.limit.pollutantCode === "PN") {
            return row.limit.unitCode === "e9/kWh";
          }
          return row.limit.unitCode === "mg/kWh";
        }),
      ).toBe(true);
      const fixtureRows = taiwanLimitRows.filter(
        (row) => row.applicationScope === applicationScope,
      );
      expect(fixtureRows).toHaveLength(16);
      expect(
        fixtureRows.every(
          (row) =>
            row.validFrom === "2021-09-01" &&
            row.measurementBasis?.includes(
              "gross vehicle weight > 3,500 kg",
            ) === true &&
            row.measurementBasis.includes("at least 10 seats") &&
            row.measurementBasis.includes("2019-09-01 transition") &&
            row.measurementBasis.includes("2021-09-01 full coverage") &&
            row.measurementBasis.includes("representative") &&
            row.measurementBasis.includes("alternative") &&
            row.measurementBasis.includes("not cumulative"),
        ),
      ).toBe(true);
    }

    const nonRoadResults = await Promise.all(
      (["construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "TWN",
          powerKw: 150,
        }),
      ),
    );
    expect(nonRoadResults).toEqual([[], []]);

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({ asOf: "2026-08-10", iso3: "TWN" });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "TW-NATIONAL",
        membershipSource: {
          url: "https://oaout.moenv.gov.tw/law/LawContent.aspx?id=FL020193",
        },
        source: {
          url: "https://oaout.moenv.gov.tw/law/Download.ashx?FileID=133507&id=FL015347&type=LAW",
        },
        validFrom: "2021-09-01",
      },
    ]);
  });

  it("TGO/TLS/TTO/TWN lock exact source metadata and actual verification time", () => {
    const sourceById = new Map(fixtureSources.map((source) => [source.id, source]));
    const verifiedAt = new Date(
      TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO,
    );
    const legacyVerifiedAt = new Date("2026-08-10T11:21:32.000Z");
    const expectedSources = [
      [
        acceptanceFixtureIds.source.togoEnvironment,
        {
          publishedOn: "2026-04-09",
          publisher:
            "République togolaise / Journal Officiel de la République Togolaise",
          sourceType: "official-regulation",
          url: "https://jo.gouv.tg/sites/default/files/JO/JO_SPECIAL_BIS_71E_N_25.pdf",
          verifiedAt: legacyVerifiedAt,
        },
      ],
      [
        acceptanceFixtureIds.source.togoTransport,
        {
          publishedOn: "2022-10-07",
          publisher:
            "République togolaise / Journal Officiel de la République Togolaise",
          sourceType: "official-regulation",
          url: "https://www.jo.gouv.tg/sites/default/files/JO/JOS_07_10_2022%20-%2067%20E%20ANNEE%20N%C2%B041%20BIS.pdf",
          verifiedAt: legacyVerifiedAt,
        },
      ],
      [
        acceptanceFixtureIds.source.timorLesteEnvironment,
        {
          publishedOn: "2012-07-04",
          publisher:
            "Jornal da República / Ministério da Justiça, República Democrática de Timor-Leste",
          sourceType: "official-regulation",
          title:
            "Decreto-Lei n.º 26/2012, de 4 de Julho — Lei de Bases do Ambiente",
          url: "https://www.mj.gov.tl/jornal/public/docs/2012/serie_1/serie1_no24.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.timorLesteTransport,
        {
          publishedOn: "2003-04-03",
          publisher:
            "Jornal da República / Ministério da Justiça, República Democrática de Timor-Leste",
          sourceType: "official-regulation",
          title:
            "Decreto-Lei n.º 6/2003, de 3 de Abril — Código da Estrada",
          url: "https://www.mj.gov.tl/jornal/public/docs/2002_2005/decreto_lei_governo/6_2003.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.trinidadTobagoEnvironment,
        {
          publishedOn: "2015-01-23",
          publisher:
            "Republic of Trinidad and Tobago / Environmental Management Authority",
          sourceType: "official-regulation",
          title: "The Air Pollution Rules, 2014 — Legal Notice No. 12",
          url: "https://www.ema.co.tt/our-environment/air/",
        },
      ],
      [
        acceptanceFixtureIds.source.trinidadTobagoTransport,
        {
          publishedOn: "2026-02-02",
          publisher:
            "Parliament / Government Printer / Digital Legislative Library, Republic of Trinidad and Tobago",
          sourceType: "official-regulation",
          title:
            "Motor Vehicles and Road Traffic (Amendment) Act, 2026 — Act No. 2 of 2026",
          url: "https://laws.gov.tt/ttdll-web/revision/download/123556?type=amendment",
        },
      ],
      [
        acceptanceFixtureIds.source.taiwanEnvironment,
        {
          publishedOn: "2023-06-30",
          publisher: "Taiwan Ministry of Environment",
          sourceType: "official-regulation",
          url: "https://oaout.moenv.gov.tw/law/Download.ashx?FileID=133507&id=FL015347&type=LAW",
          verifiedAt: legacyVerifiedAt,
        },
      ],
      [
        acceptanceFixtureIds.source.taiwanTransport,
        {
          publishedOn: "2024-02-01",
          publisher: "Taiwan Ministry of Environment",
          sourceType: "official-regulation",
          url: "https://oaout.moenv.gov.tw/law/LawContent.aspx?id=FL020193",
          verifiedAt: legacyVerifiedAt,
        },
      ],
    ] as const;

    for (const [sourceId, expectedSource] of expectedSources) {
      const expectedVerifiedAt =
        "verifiedAt" in expectedSource ? expectedSource.verifiedAt : verifiedAt;
      expect(sourceById.get(sourceId)).toMatchObject({
        ...expectedSource,
        verifiedAt: expectedVerifiedAt,
      });
    }
  });

  it("locks the refreshed 12-country source-only graph to one membership, two sources, and zero numeric rows", () => {
    const refreshedAt = new Date(
      TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO,
    );
    const graphs = [
      ["BRN", acceptanceFixtureIds.jurisdiction.brunei, acceptanceFixtureIds.source.bruneiEnvironment, acceptanceFixtureIds.source.bruneiTransport],
      ["BTN", acceptanceFixtureIds.jurisdiction.bhutan, acceptanceFixtureIds.source.bhutanEnvironment, acceptanceFixtureIds.source.bhutanTransport],
      ["SLB", acceptanceFixtureIds.jurisdiction.solomonIslands, acceptanceFixtureIds.source.solomonIslandsEnvironment, acceptanceFixtureIds.source.solomonIslandsTransport],
      ["TLS", acceptanceFixtureIds.jurisdiction.timorLeste, acceptanceFixtureIds.source.timorLesteEnvironment, acceptanceFixtureIds.source.timorLesteTransport],
      ["MWI", acceptanceFixtureIds.jurisdiction.malawi, acceptanceFixtureIds.source.malawiGovernment, acceptanceFixtureIds.source.malawiTransport],
      ["SLE", acceptanceFixtureIds.jurisdiction.sierraLeone, acceptanceFixtureIds.source.sierraLeoneEnvironment, acceptanceFixtureIds.source.sierraLeoneTransport],
      ["SOM", acceptanceFixtureIds.jurisdiction.somalia, acceptanceFixtureIds.source.somaliaEnvironment, acceptanceFixtureIds.source.somaliaTransport],
      ["SSD", acceptanceFixtureIds.jurisdiction.southSudan, acceptanceFixtureIds.source.southSudanEnvironment, acceptanceFixtureIds.source.southSudanTransport],
      ["TCD", acceptanceFixtureIds.jurisdiction.chad, acceptanceFixtureIds.source.chadEnvironment, acceptanceFixtureIds.source.chadTransport],
      ["SLV", acceptanceFixtureIds.jurisdiction.elSalvador, acceptanceFixtureIds.source.elSalvadorEnvironment, acceptanceFixtureIds.source.elSalvadorTransport],
      ["SUR", acceptanceFixtureIds.jurisdiction.suriname, acceptanceFixtureIds.source.surinameEnvironment, acceptanceFixtureIds.source.surinameTransport],
      ["TTO", acceptanceFixtureIds.jurisdiction.trinidadTobago, acceptanceFixtureIds.source.trinidadTobagoEnvironment, acceptanceFixtureIds.source.trinidadTobagoTransport],
    ] as const;

    for (const [
      countryIso3,
      jurisdictionId,
      sourceId,
      membershipSourceId,
    ] of graphs) {
      const sources = fixtureSources.filter(
        ({ id }) => id === sourceId || id === membershipSourceId,
      );
      expect(sources).toHaveLength(2);
      expect(
        sources.every(
          ({ createdAt, updatedAt, verifiedAt }) =>
            createdAt?.toISOString() === refreshedAt.toISOString() &&
            updatedAt?.toISOString() === refreshedAt.toISOString() &&
            verifiedAt?.toISOString() === refreshedAt.toISOString(),
        ),
      ).toBe(true);
      expect(
        fixtureJurisdictions.find(({ id }) => id === jurisdictionId),
      ).toMatchObject({
        countryIso3,
        createdAt: refreshedAt,
        dataSourceId: sourceId,
        updatedAt: refreshedAt,
        verifiedAt: refreshedAt,
      });
      expect(
        fixtureCountryJurisdictions.filter(
          (membership) =>
            membership.countryIso3 === countryIso3 &&
            membership.jurisdictionId === jurisdictionId,
        ),
      ).toMatchObject([
        {
          createdAt: refreshedAt,
          dataSourceId: membershipSourceId,
          updatedAt: refreshedAt,
          validFrom: "2026-08-10",
          verifiedAt: refreshedAt,
        },
      ]);
      expect(
        fixtureRegulations.filter(
          (regulation) => regulation.jurisdictionId === jurisdictionId,
        ),
      ).toEqual([]);
    }
  });

  it("VEN applies the MY2000 European heavy-diesel road pathway without accumulating the US alternative", async () => {
    const regulationId =
      acceptanceFixtureIds.regulation.venezuelaHeavyDieselMy2000;
    const fixtureRows = buildFixtureLimits().filter(
      (row) => row.regulationId === regulationId,
    );

    expect(regulationId).toBe("10000000-0000-4000-8000-000000000465");
    expect(fixtureRows).toHaveLength(10);
    expect(
      fixtureRegulations.find((regulation) => regulation.id === regulationId),
    ).toMatchObject({
      citationCode: "Decreto Nº 2.673/1998, artículo 7, tabla Nº 4",
      effectiveFrom: "2000-01-01",
      status: "effective",
    });

    for (const applicationScope of [
      "on-road-truck",
      "on-road-bus",
    ] as const) {
      await expect(
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "1999-12-31",
          countryIso3: "VEN",
          powerKw: 150,
        }),
      ).resolves.toEqual([]);

      const scopedFixtureRows = fixtureRows.filter(
        (row) => row.applicationScope === applicationScope,
      );
      expect(scopedFixtureRows).toHaveLength(5);
      expect(
        scopedFixtureRows.every(
          (row) =>
            row.validFrom === "2000-01-01" &&
            row.testCycleCode === "Directive 91/542/EEC" &&
            row.measurementBasis?.includes("MY2000 normalized boundary") ===
              true &&
            row.measurementBasis.includes("representative pathway") &&
            row.measurementBasis.includes("alternative") &&
            row.measurementBasis.includes("not cumulative"),
        ),
      ).toBe(true);

      for (const [powerKw, expectedPm] of [
        [50, 0.612],
        [85, 0.612],
        [85.001, 0.36],
        [150, 0.36],
      ] as const) {
        const rows = await repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2000-01-01",
          countryIso3: "VEN",
          powerKw,
        });

        expect(rows).toHaveLength(4);
        expect(new Set(rows.map((row) => row.regulationId))).toEqual(
          new Set([regulationId]),
        );
        expect(new Set(rows.map((row) => row.limit.testCycleCode))).toEqual(
          new Set(["Directive 91/542/EEC"]),
        );
        expect(rows.every((row) => row.limit.unitCode === "g/kWh")).toBe(
          true,
        );
        expect(
          new Map(
            rows.map((row) => [
              row.limit.pollutantCode,
              Number(row.limit.limitValue),
            ]),
          ),
        ).toEqual(
          new Map([
            ["CO", 4.5],
            ["HC", 1.1],
            ["NOX", 8],
            ["PM", expectedPm],
          ]),
        );
      }
    }

    const nonRoadResults = await Promise.all(
      (["construction", "agriculture"] as const).map((applicationScope) =>
        repository().findEffectiveByCountry({
          applicationScope,
          asOf: "2026-08-10",
          countryIso3: "VEN",
          powerKw: 150,
        }),
      ),
    );
    expect(nonRoadResults).toEqual([[], []]);

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({ asOf: "2026-08-10", iso3: "VEN" });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "VE-NATIONAL",
        membershipSource: {
          url: "https://faolex.fao.org/docs/pdf/ven151760.pdf",
        },
        source: { url: "https://faolex.fao.org/docs/pdf/ven181032.pdf" },
        validFrom: "2000-01-01",
      },
    ]);
  });

  it.each([
    [
      "VUT",
      "VU-NATIONAL",
      "https://mocca.gov.vu/images/publications/legislation/DEPC/Legislation/Pollution%20%28Control%29%20Act..pdf",
      "https://parliament.gov.vu/images/Bills/Second%20Ordinary%20session%202025/Bill%20for%20the%20Motor%20Vehicles/Bill%20for%20the%20Motor%20Vehicles%20Control%20Am%20Act%20No.%20%20of%202025.pdf",
    ],
    [
      "ATA",
      "AQ-BOUNDARY",
      "https://documents.ats.aq/recatt/Att006_e.pdf",
      "https://documents.ats.aq/recatt/Att006_e.pdf",
    ],
    [
      "ATF",
      "TF-BOUNDARY",
      "https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006143761",
      "https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006143761",
    ],
    [
      "ESH",
      "EH-BOUNDARY",
      "https://www.un.org/dppa/decolonization/en/nsgt/western-sahara",
      "https://www.un.org/dppa/decolonization/en/nsgt/western-sahara",
    ],
    [
      "FLK",
      "FK-BOUNDARY",
      "https://www.legislation.gov.fk/download/pdf/4150cf28-4b25-4f23-ae56-456251ea2378/5a0dfa5f-ceaf-4652-9566-c911493a27c1/fisl-1986-5_2017-07-31.pdf",
      "https://www.legislation.gov.fk/download/pdf/4150cf28-4b25-4f23-ae56-456251ea2378/5a0dfa5f-ceaf-4652-9566-c911493a27c1/fisl-1986-5_2017-07-31.pdf",
    ],
  ] as const)(
    "%s preserves four-scope no-data after exact boundary review",
    async (iso3, code, sourceUrl, membershipUrl) => {
      const results = await Promise.all(
        ([
          "on-road-truck",
          "on-road-bus",
          "construction",
          "agriculture",
        ] as const).map((applicationScope) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf: "2026-08-10",
            countryIso3: iso3,
            powerKw: 150,
          }),
        ),
      );
      expect(results).toEqual([[], [], [], []]);

      const details = await createCountryRepository(
        testDatabase.database,
      ).findDetailsByIso3({ asOf: "2026-08-10", iso3 });
      expect(details?.jurisdictions).toMatchObject([
        {
          code,
          membershipSource: { url: membershipUrl },
          source: { url: sourceUrl },
          validFrom: "2026-08-10",
        },
      ]);
      expect(
        fixtureRegulations.some(
          (regulation) =>
            regulation.jurisdictionId === details?.jurisdictions[0]?.id,
        ),
      ).toBe(false);

      if (iso3 !== "VUT") {
        expect(
          fixtureJurisdictions.find(
            (jurisdiction) =>
              jurisdiction.id === details?.jurisdictions[0]?.id,
          ),
        ).toMatchObject({
          countryIso3: null,
          type: "international",
        });
      }
    },
  );

  it("YEM preserves four-scope no-data without inventing a regulation", async () => {
    const results = await Promise.all(
      (["on-road-truck", "on-road-bus", "construction", "agriculture"] as const).map(
        (applicationScope) =>
          repository().findEffectiveByCountry({
            applicationScope,
            asOf: "2026-08-10",
            countryIso3: "YEM",
            powerKw: 150,
          }),
      ),
    );
    expect(results).toEqual([[], [], [], []]);

    const details = await createCountryRepository(
      testDatabase.database,
    ).findDetailsByIso3({ asOf: "2026-08-10", iso3: "YEM" });
    expect(details?.jurisdictions).toMatchObject([
      {
        code: "YE-NATIONAL",
        membershipSource: {
          url: "https://www.agoye.gov.ye/page.php?id=275&lng=arabic",
        },
        source: {
          url: "https://www.agoye.gov.ye/page.php?id=323&lng=arabic",
        },
        validFrom: "2026-08-10",
      },
    ]);
    expect(
      fixtureRegulations.some(
        (regulation) =>
          regulation.jurisdictionId === details?.jurisdictions[0]?.id,
      ),
    ).toBe(false);
  });

  it("VEN/VUT/YEM and special-region boundaries lock exact source metadata and verification time", () => {
    const sourceById = new Map(
      fixtureSources.map((source) => [source.id, source]),
    );
    const verifiedAt = new Date("2026-08-10T11:58:54.000Z");
    const expectedSources = [
      [
        acceptanceFixtureIds.source.venezuelaEnvironment,
        {
          publishedOn: "1998-09-04",
          publisher:
            "Presidencia de la República / Gaceta Oficial de la República de Venezuela",
          sourceType: "official-regulation",
          title:
            "Decreto Nº 2.673 de 19 de agosto de 1998 — Normas sobre emisiones de fuentes móviles",
          url: "https://faolex.fao.org/docs/pdf/ven181032.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.venezuelaTransport,
        {
          publishedOn: "2015-12-28",
          publisher:
            "Asamblea Nacional / Gaceta Oficial de la República Bolivariana de Venezuela",
          sourceType: "official-regulation",
          title:
            "Ley de Calidad de las Aguas y del Aire — mobile-source limits and preservation of prior technical rules",
          url: "https://faolex.fao.org/docs/pdf/ven151760.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.vanuatuEnvironment,
        {
          publishedOn: "2014-06-27",
          publisher:
            "Republic of Vanuatu / Department of Environmental Protection and Conservation",
          sourceType: "official-regulation",
          title:
            "Pollution (Control) Act No. 10 of 2013 — prescribed vehicle-emission standards and delegated regulations",
          url: "https://mocca.gov.vu/images/publications/legislation/DEPC/Legislation/Pollution%20%28Control%29%20Act..pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.vanuatuTransport,
        {
          publishedOn: null,
          publisher:
            "Parliament of the Republic of Vanuatu / Ministry of Infrastructure and Public Utilities",
          sourceType: "government-notice",
          title:
            "Bill for the Import of Motor Vehicles (Control) (Amendment) Act No. of 2025",
          url: "https://parliament.gov.vu/images/Bills/Second%20Ordinary%20session%202025/Bill%20for%20the%20Motor%20Vehicles/Bill%20for%20the%20Motor%20Vehicles%20Control%20Am%20Act%20No.%20%20of%202025.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.yemenEnvironment,
        {
          publishedOn: "1995-10-29",
          publisher:
            "Yemen Public Prosecution (Office of the Attorney General) / Republic of Yemen",
          sourceType: "official-regulation",
          title:
            "قانون رقم (26) لسنة 1995م بشأن حماية البيئة — Law No. 26 of 1995 on Environmental Protection",
          url: "https://www.agoye.gov.ye/page.php?id=323&lng=arabic",
        },
      ],
      [
        acceptanceFixtureIds.source.yemenTransport,
        {
          publishedOn: "2002-03-18",
          publisher:
            "Yemen Public Prosecution (Office of the Attorney General) / Republic of Yemen",
          sourceType: "official-regulation",
          title:
            "قانون المرور وتعديلاته — Traffic Law No. 46 of 1991, consolidated through Law No. 12 of 2002",
          url: "https://www.agoye.gov.ye/page.php?id=275&lng=arabic",
        },
      ],
      [
        acceptanceFixtureIds.source.antarcticaBoundary,
        {
          publishedOn: "1991-10-04",
          publisher: "Antarctic Treaty Secretariat",
          sourceType: "official-regulation",
          title:
            "Protocol on Environmental Protection to the Antarctic Treaty — environmental governance boundary",
          url: "https://documents.ats.aq/recatt/Att006_e.pdf",
        },
      ],
      [
        acceptanceFixtureIds.source.frenchSouthernLandsBoundary,
        {
          publishedOn: null,
          publisher: "République française / Légifrance",
          sourceType: "official-regulation",
          title:
            "Code de l'environnement, articles L640-1 à L640-5 — provisions applicable in the French Southern and Antarctic Lands",
          url: "https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006143761",
        },
      ],
      [
        acceptanceFixtureIds.source.westernSaharaBoundary,
        {
          publishedOn: "2024-09-09",
          publisher:
            "United Nations Department of Political and Peacebuilding Affairs / Decolonization",
          sourceType: "government-notice",
          title:
            "Western Sahara — Non-Self-Governing Territory status and administering-power boundary",
          url: "https://www.un.org/dppa/decolonization/en/nsgt/western-sahara",
        },
      ],
      [
        acceptanceFixtureIds.source.falklandIslandsBoundary,
        {
          publishedOn: "2017-07-31",
          publisher: "Falkland Islands Government / Falkland Islands Legislation",
          sourceType: "official-regulation",
          title:
            "Road Traffic (Provisional) Regulations Order 1986 — silencers and vehicle inspection",
          url: "https://www.legislation.gov.fk/download/pdf/4150cf28-4b25-4f23-ae56-456251ea2378/5a0dfa5f-ceaf-4652-9566-c911493a27c1/fisl-1986-5_2017-07-31.pdf",
        },
      ],
    ] as const;

    for (const [sourceId, expectedSource] of expectedSources) {
      expect(sourceById.get(sourceId)).toMatchObject({
        ...expectedSource,
        verifiedAt,
      });
    }
  });

  it("SAU publishes the MY2026 Euro V representative road path without inferring non-road limits", async () => {
    const [before, truck, bus, construction, agriculture] = await Promise.all([
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2025-12-31",
        countryIso3: "SAU",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2026-01-01",
        countryIso3: "SAU",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-bus",
        asOf: "2026-01-01",
        countryIso3: "SAU",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-08-10",
        countryIso3: "SAU",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2026-08-10",
        countryIso3: "SAU",
        powerKw: 150,
      }),
    ]);
    const values = new Map(
      truck.map((row) => [
        `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
        Number(row.limit.limitValue),
      ]),
    );
    expect(before).toEqual([]);
    expect(truck).toHaveLength(9);
    expect(bus).toHaveLength(9);
    expect(construction).toEqual([]);
    expect(agriculture).toEqual([]);
    expect(values.get("ESC:NOX")).toBe(2);
    expect(values.get("ELR:OPACITY")).toBe(0.5);
    expect(values.get("ETC:PM")).toBe(0.03);
    expect(
      [...truck, ...bus].every(
        (row) =>
          row.regulationId ===
          acceptanceFixtureIds.regulation.saudiHeavyVehicleEuroVMy2026,
      ),
    ).toBe(true);
    expect(
      buildFixtureLimits()
        .filter(
          (row) =>
            row.regulationId ===
            acceptanceFixtureIds.regulation.saudiHeavyVehicleEuroVMy2026,
        )
        .every(
          (row) =>
            row.measurementBasis?.includes(
              "normalized model-year boundary",
            ) === true &&
            row.measurementBasis?.includes("not cumulative") === true,
        ),
    ).toBe(true);
  });

  it("ARE publishes the Euro VI/B WHSC/WHTC road table only at the all-import boundary", async () => {
    const [before, truck, bus, construction, agriculture] = await Promise.all([
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2027-06-30",
        countryIso3: "ARE",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-truck",
        asOf: "2027-07-01",
        countryIso3: "ARE",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "on-road-bus",
        asOf: "2027-07-01",
        countryIso3: "ARE",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "construction",
        asOf: "2026-08-10",
        countryIso3: "ARE",
        powerKw: 150,
      }),
      repository().findEffectiveByCountry({
        applicationScope: "agriculture",
        asOf: "2026-08-10",
        countryIso3: "ARE",
        powerKw: 150,
      }),
    ]);
    const values = new Map(
      truck.map((row) => [
        `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
        Number(row.limit.limitValue),
      ]),
    );
    expect(before).toEqual([]);
    expect(truck).toHaveLength(12);
    expect(bus).toHaveLength(12);
    expect(construction).toEqual([]);
    expect(agriculture).toEqual([]);
    expect(values.get("WHSC:NOX")).toBe(400);
    expect(values.get("WHSC:PN")).toBe(800);
    expect(values.get("WHTC:NOX")).toBe(460);
    expect(values.get("WHTC:PN")).toBe(600);
    expect(
      [...truck, ...bus].every(
        (row) =>
          row.regulationId ===
          acceptanceFixtureIds.regulation.uaeHeavyVehicleEuro6B,
      ),
    ).toBe(true);
    expect(
      buildFixtureLimits()
        .filter(
          (row) =>
            row.regulationId ===
            acceptanceFixtureIds.regulation.uaeHeavyVehicleEuro6B,
        )
        .every(
          (row) =>
            row.measurementBasis?.includes("newly introduced models") ===
              true &&
            row.measurementBasis?.includes("2027-07-01") === true &&
            row.validFrom === "2027-07-01",
        ),
    ).toBe(true);
  });

  it("ZAF publishes the SANS/ECE R49.02B road path with the exact 85 kW particulate split", async () => {
    const [before, truckAt85, truckAbove85, busAbove85, construction, agriculture] =
      await Promise.all([
        repository().findEffectiveByCountry({
          applicationScope: "on-road-truck",
          asOf: "2009-12-31",
          countryIso3: "ZAF",
          powerKw: 150,
        }),
        repository().findEffectiveByCountry({
          applicationScope: "on-road-truck",
          asOf: "2010-01-01",
          countryIso3: "ZAF",
          powerKw: 85,
        }),
        repository().findEffectiveByCountry({
          applicationScope: "on-road-truck",
          asOf: "2010-01-01",
          countryIso3: "ZAF",
          powerKw: 85.001,
        }),
        repository().findEffectiveByCountry({
          applicationScope: "on-road-bus",
          asOf: "2010-01-01",
          countryIso3: "ZAF",
          powerKw: 85.001,
        }),
        repository().findEffectiveByCountry({
          applicationScope: "construction",
          asOf: "2026-08-10",
          countryIso3: "ZAF",
          powerKw: 150,
        }),
        repository().findEffectiveByCountry({
          applicationScope: "agriculture",
          asOf: "2026-08-10",
          countryIso3: "ZAF",
          powerKw: 150,
        }),
      ]);
    const pm = (rows: typeof truckAt85) =>
      Number(
        rows.find((row) => row.limit.pollutantCode === "PM")?.limit
          .limitValue,
      );
    expect(before).toEqual([]);
    expect(truckAt85).toHaveLength(4);
    expect(truckAbove85).toHaveLength(4);
    expect(busAbove85).toHaveLength(4);
    expect(pm(truckAt85)).toBe(0.255);
    expect(pm(truckAbove85)).toBe(0.15);
    expect(pm(busAbove85)).toBe(0.15);
    expect(construction).toEqual([]);
    expect(agriculture).toEqual([]);
    expect(
      [...truckAt85, ...truckAbove85, ...busAbove85].every(
        (row) =>
          row.regulationId ===
          acceptanceFixtureIds.regulation.southAfricaR4902B,
      ),
    ).toBe(true);
    expect(
      buildFixtureLimits()
        .filter(
          (row) =>
            row.regulationId ===
            acceptanceFixtureIds.regulation.southAfricaR4902B,
        )
        .every(
          (row) =>
            row.measurementBasis?.includes("alternatives") === true &&
            row.measurementBasis?.includes("not cumulative") === true,
        ),
    ).toBe(true);
  });

  it("locks the upgraded SAU/ARE/ZAF source metadata and verification timestamps", () => {
    const sourceById = new Map(
      fixtureSources.map((source) => [source.id, source]),
    );
    expect(
      sourceById.get(
        acceptanceFixtureIds.source.saudiVehicle2026TechnicalRegulations,
      ),
    ).toMatchObject({
      publishedOn: null,
      publisher: "GCC Standardization Organization",
      sourceType: "government-notice",
      url: "https://www.gso.org.sa/wp-content/uploads/2024/12/GSO-Technical-Regulations-MV-2026-MY-D4.pdf",
      verifiedAt: new Date("2026-08-10T16:12:30.000Z"),
    });
    expect(
      sourceById.get(acceptanceFixtureIds.source.uaeVehicleEmissionGuide),
    ).toMatchObject({
      publishedOn: null,
      publisher:
        "United Arab Emirates Ministry of Industry and Advanced Technology",
      sourceType: "government-notice",
      url: "https://www.gso.org.sa/wp-content/uploads/2025/04/Implementation-guideline-for-new-vehicle-emission-limits-in-the-UAE.pdf",
      verifiedAt: new Date("2026-08-10T16:09:15.000Z"),
    });
    expect(
      sourceById.get(acceptanceFixtureIds.source.southAfricaDirective91542),
    ).toMatchObject({
      publishedOn: "1991-10-25",
      publisher: "Council of the European Communities / EUR-Lex",
      sourceType: "official-regulation",
      url: "https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:31991L0542",
      verifiedAt: new Date("2026-08-10T16:04:06.000Z"),
    });
  });

  it("records and publishes all EU-27 members, including Malta's accession boundary", async () => {
    expect(euOfficialMemberCountryIso3).toHaveLength(27);
    expect(new Set(euOfficialMemberCountryIso3)).toEqual(
      new Set([
        "AUT",
        "BEL",
        "BGR",
        "HRV",
        "CYP",
        "CZE",
        "DNK",
        "EST",
        "FIN",
        "FRA",
        "DEU",
        "GRC",
        "HUN",
        "IRL",
        "ITA",
        "LVA",
        "LTU",
        "LUX",
        "MLT",
        "NLD",
        "POL",
        "PRT",
        "ROU",
        "SVK",
        "SVN",
        "ESP",
        "SWE",
      ]),
    );
    expect(euMemberCountryIso3).toHaveLength(27);
    expect(euMemberCountryIso3).toEqual(euOfficialMemberCountryIso3);

    const countryRepository = createCountryRepository(testDatabase.database);
    const france = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-06",
      iso3: "FRA",
    });
    expect(france?.jurisdictions).toHaveLength(1);
    expect(france?.jurisdictions[0]).toMatchObject({
      code: "EU",
      membershipSource: {
        title:
          "EU countries: official country profiles and accession dates (27 Member States)",
      },
      validFrom: "1958-01-01",
    });

    const maltaBeforeAccession = await countryRepository.findDetailsByIso3({
      asOf: "2004-04-30",
      iso3: "MLT",
    });
    const maltaAfterAccession = await countryRepository.findDetailsByIso3({
      asOf: "2026-08-11",
      iso3: "MLT",
    });
    expect(maltaBeforeAccession?.jurisdictions).toHaveLength(0);
    expect(maltaAfterAccession?.jurisdictions).toHaveLength(1);
    expect(maltaAfterAccession?.jurisdictions[0]).toMatchObject({
      code: "EU",
      membershipSource: {
        title:
          "EU countries: official country profiles and accession dates (27 Member States)",
      },
      validFrom: "2004-05-01",
    });
    expect(maltaAfterAccession?.jurisdictions[0]?.membershipSource.verifiedAt)
      .toEqual(new Date("2026-08-11T04:27:59.000Z"));
  });

  it("applies signed EU limits to member countries without crossing accession dates", async () => {
    const franceRows = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2026-07-30",
      countryIso3: "FRA",
      powerKw: 300,
    });
    expect(franceRows.length).toBeGreaterThan(0);
    expect(
      franceRows.every((row) => row.citationCode === "CELEX:32009R0595"),
    ).toBe(true);

    const croatiaBeforeAccession = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2013-06-30",
      countryIso3: "HRV",
      powerKw: 300,
    });
    const croatiaAfterAccession = await repository().findEffectiveByCountry({
      applicationScope: "on-road-truck",
      asOf: "2013-07-01",
      countryIso3: "HRV",
      powerKw: 300,
    });
    expect(croatiaBeforeAccession).toHaveLength(0);
    expect(croatiaAfterAccession.length).toBeGreaterThan(0);
    expect(
      croatiaAfterAccession.every(
        (row) => row.citationCode === "CELEX:32009R0595",
      ),
    ).toBe(true);
  });

  it("BRA MAR-I limits apply to construction and agriculture per power band", async () => {
    const constructionRows = await repository().findEffectiveByCountry({
      applicationScope: "construction",
      asOf: "2026-07-30",
      countryIso3: "BRA",
      powerKw: 100,
    });
    const constructionByPollutant = new Map(
      constructionRows.map((row) => [
        row.limit.pollutantCode,
        Number(row.limit.limitValue),
      ]),
    );
    expect(
      constructionRows.every((row) => row.citationCode === "CONAMA 433/2011"),
    ).toBe(true);
    expect(constructionByPollutant.get("CO")).toBe(5);
    expect(constructionByPollutant.get("HC+NOx")).toBe(4);
    expect(constructionByPollutant.get("PM")).toBe(0.3);

    const agricultureRows = await repository().findEffectiveByCountry({
      applicationScope: "agriculture",
      asOf: "2026-07-30",
      countryIso3: "BRA",
      powerKw: 30,
    });
    const agricultureByPollutant = new Map(
      agricultureRows.map((row) => [
        row.limit.pollutantCode,
        Number(row.limit.limitValue),
      ]),
    );
    expect(agricultureByPollutant.get("CO")).toBe(5.5);
    expect(agricultureByPollutant.get("HC+NOx")).toBe(7.5);
    expect(agricultureByPollutant.get("PM")).toBe(0.6);
  });
});
