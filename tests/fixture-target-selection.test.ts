import { describe, expect, it } from "vitest";

import {
  buildFullIngestSelection,
  buildTargetSelection,
  selectJurisdictionMembershipsForIngest,
  signedPublishableRegulationIds,
} from "../scripts/db/fixture-target-selection";
import { portfolioReleaseCountryIso3s } from "../src/domain/portfolio-evidence";
import {
  acceptanceFixtureIds,
  buildFixtureLimits,
  fixtureCountryJurisdictions,
} from "../src/server/db/seed/acceptance-fixtures";
import { CANADA_COMPLETENESS_SIGNOFF_ISO } from "../scripts/db/ingest-signoff";

describe("accepted fixture target selection", () => {
  const limits = buildFixtureLimits();
  const twelveCountrySourceOnlyGraphs = [
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

  it("applies the signed publication boundary to USA target and full selection", () => {
    const expectedRegulationIds = new Set([
      acceptanceFixtureIds.regulation.us1036104,
      acceptanceFixtureIds.regulation.us8600711,
      acceptanceFixtureIds.regulation.us1039101,
    ]);
    const target = buildTargetSelection("USA", limits);
    const full = buildFullIngestSelection(["USA"], limits);

    expect(target.regulationIds).toEqual(expectedRegulationIds);
    expect(full.regulationIds).toEqual(expectedRegulationIds);
    expect(target.limitRows).toEqual(full.limitRows);
    expect(target.limitRows).toHaveLength(70);
    expect(target.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.usEcfr86,
        acceptanceFixtureIds.source.usEcfr1036,
        acceptanceFixtureIds.source.usEcfr1039,
      ]),
    );
    expect(target.regulationIds).not.toContain(
      acceptanceFixtureIds.regulation.usFr91x43154,
    );
    expect(target.sourceIds).not.toContain(
      acceptanceFixtureIds.source.usFr91x43154,
    );
  });

  it("applies the signed publication boundary to DEU target and full selection", () => {
    const expectedRegulationIds = new Set([
      acceptanceFixtureIds.regulation.euReg595,
      acceptanceFixtureIds.regulation.euReg1628,
    ]);
    const target = buildTargetSelection("DEU", limits);
    const full = buildFullIngestSelection(["DEU"], limits);

    expect(target.regulationIds).toEqual(expectedRegulationIds);
    expect(full.regulationIds).toEqual(expectedRegulationIds);
    expect(target.limitRows).toEqual(full.limitRows);
    expect(target.regulationIds).not.toContain(
      acceptanceFixtureIds.regulation.euReg1257,
    );
    expect(target.sourceIds).not.toContain(
      acceptanceFixtureIds.source.euReg1257,
    );
  });

  it("keeps the current 33-country signed batch closed between target and full selection", () => {
    const countryIso3s = [
      "CRI",
      "ECU",
      "PAN",
      "DOM",
      "PHL",
      "PAK",
      "SAU",
      "ARE",
      "ISR",
      "ZAF",
      "EGY",
      "GHA",
      "KEN",
      "RWA",
      "TZA",
      "ZMB",
      "ZWE",
      "CIV",
      "DZA",
      "TUN",
      "ETH",
      "CMR",
      "SEN",
      "NGA",
      "UGA",
      "BWA",
      "NAM",
      "SWZ",
      "KHM",
      "LAO",
      "LKA",
      "MMR",
      "MNG",
    ] as const;
    const targets = countryIso3s.map((countryIso3) =>
      buildTargetSelection(countryIso3, limits),
    );
    const full = buildFullIngestSelection(countryIso3s, limits);
    const targetJurisdictionIds = new Set(
      targets.flatMap((target) => [...target.jurisdictionIds]),
    );
    const targetRegulationIds = new Set(
      targets.flatMap((target) => [...target.regulationIds]),
    );
    const targetSourceIds = new Set(
      targets.flatMap((target) => [...target.sourceIds]),
    );
    const targetLimitIds = targets
      .flatMap((target) => target.limitRows.map((limit) => limit.id))
      .sort();

    expect(countryIso3s).toHaveLength(33);
    expect(full.jurisdictionIds.size).toBe(33);
    expect(full.regulationIds.size).toBe(11);
    expect(full.limitRows).toHaveLength(190);
    expect(full.sourceIds.size).toBe(72);
    expect(full.jurisdictionIds).toEqual(targetJurisdictionIds);
    expect(full.regulationIds).toEqual(targetRegulationIds);
    expect(full.sourceIds).toEqual(targetSourceIds);
    expect(full.limitRows.map((limit) => limit.id).sort()).toEqual(
      targetLimitIds,
    );
    expect(
      [...full.regulationIds].every((regulationId) =>
        signedPublishableRegulationIds.has(regulationId),
      ),
    ).toBe(true);
  });

  it("keeps the current 97-country deployment queue unique and closed between target and full selection", () => {
    const targets = portfolioReleaseCountryIso3s.map((countryIso3) =>
      buildTargetSelection(countryIso3, limits),
    );
    const full = buildFullIngestSelection(
      portfolioReleaseCountryIso3s,
      limits,
    );
    const targetJurisdictionIds = new Set(
      targets.flatMap((target) => [...target.jurisdictionIds]),
    );
    const targetRegulationIds = new Set(
      targets.flatMap((target) => [...target.regulationIds]),
    );
    const targetSourceIds = new Set(
      targets.flatMap((target) => [...target.sourceIds]),
    );
    const targetLimitIds = targets
      .flatMap((target) => target.limitRows.map((limit) => limit.id))
      .sort();

    expect(portfolioReleaseCountryIso3s).toHaveLength(97);
    expect(new Set(portfolioReleaseCountryIso3s).size).toBe(97);
    expect(full.jurisdictionIds.size).toBe(97);
    expect(full.regulationIds.size).toBe(28);
    expect(full.limitRows).toHaveLength(651);
    expect(full.sourceIds.size).toBe(203);
    expect(full.jurisdictionIds).toEqual(targetJurisdictionIds);
    expect(full.regulationIds).toEqual(targetRegulationIds);
    expect(full.sourceIds).toEqual(targetSourceIds);
    expect(full.limitRows.map((limit) => limit.id).sort()).toEqual(
      targetLimitIds,
    );
  });

  it("selects CHN's corrected GB 20891 history and current power bands", () => {
    const target = buildTargetSelection("CHN", limits);
    const full = buildFullIngestSelection(["CHN"], limits);

    expect(target.jurisdictionIds).toEqual(
      new Set([acceptanceFixtureIds.jurisdiction.cnMee]),
    );
    expect(target.regulationIds).toEqual(
      new Set([
        acceptanceFixtureIds.regulation.cnGb17691,
        acceptanceFixtureIds.regulation.cnGb20891,
      ]),
    );
    expect(target.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.cnGb17691,
        acceptanceFixtureIds.source.cnGb20891,
        acceptanceFixtureIds.source.cnHj1014,
      ]),
    );
    expect(target.limitRows).toHaveLength(74);
    expect(full.jurisdictionIds).toEqual(target.jurisdictionIds);
    expect(full.regulationIds).toEqual(target.regulationIds);
    expect(full.sourceIds).toEqual(target.sourceIds);
    expect(full.limitRows).toEqual(target.limitRows);
  });

  it("selects Malta's direct EU membership graph and shared regulations", () => {
    const target = buildTargetSelection("MLT", limits);
    const full = buildFullIngestSelection(["MLT"], limits);

    expect(target.jurisdictionIds).toEqual(
      new Set([acceptanceFixtureIds.jurisdiction.eu]),
    );
    expect(target.regulationIds).toEqual(
      new Set([
        acceptanceFixtureIds.regulation.euReg595,
        acceptanceFixtureIds.regulation.euReg1628,
      ]),
    );
    expect(target.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.euCountries,
        acceptanceFixtureIds.source.euReg595,
        acceptanceFixtureIds.source.euReg1628,
      ]),
    );
    expect(target.limitRows).toHaveLength(80);
    expect(full.jurisdictionIds).toEqual(target.jurisdictionIds);
    expect(full.regulationIds).toEqual(target.regulationIds);
    expect(full.sourceIds).toEqual(target.sourceIds);
    expect(full.limitRows).toEqual(target.limitRows);
  });

  it("selects CAN's complete direct-source graph identically for target and full publication", () => {
    const target = buildTargetSelection("CAN", limits);
    const full = buildFullIngestSelection(["CAN"], limits);
    const expectedRegulationIds = new Set([
      acceptanceFixtureIds.regulation.canadaRoad2003,
      acceptanceFixtureIds.regulation.canadaOffroad2020,
    ]);
    const expectedSourceIds = new Set([
      acceptanceFixtureIds.source.canadaRoadRegulation,
      acceptanceFixtureIds.source.canadaOffroadRegulation,
      acceptanceFixtureIds.source.usEcfr86,
      acceptanceFixtureIds.source.usEcfr1039,
    ]);
    const roadRows = target.limitRows.filter(
      ({ regulationId }) =>
        regulationId === acceptanceFixtureIds.regulation.canadaRoad2003,
    );
    const nonroadRows = target.limitRows.filter(
      ({ regulationId }) =>
        regulationId === acceptanceFixtureIds.regulation.canadaOffroad2020,
    );

    expect(target.jurisdictionIds).toEqual(
      new Set([acceptanceFixtureIds.jurisdiction.canada]),
    );
    expect(target.regulationIds).toEqual(expectedRegulationIds);
    expect(target.sourceIds).toEqual(expectedSourceIds);
    expect(target.limitRows).toHaveLength(48);
    expect(roadRows).toHaveLength(8);
    expect(nonroadRows).toHaveLength(40);
    expect(
      roadRows.every(
        (row) =>
          row.dataSourceId === acceptanceFixtureIds.source.usEcfr86 &&
          row.testCycleCode === "FTP/SET" &&
          row.validFrom === "2010-01-01" &&
          row.verifiedAt.toISOString() === CANADA_COMPLETENESS_SIGNOFF_ISO,
      ),
    ).toBe(true);
    expect(
      nonroadRows.every(
        (row) =>
          row.dataSourceId === acceptanceFixtureIds.source.usEcfr1039 &&
          row.validFrom === "2021-06-04" &&
          row.verifiedAt.toISOString() === CANADA_COMPLETENESS_SIGNOFF_ISO,
      ),
    ).toBe(true);
    expect(
      new Set(
        nonroadRows.map(
          (row) =>
            `${row.powerMinKw}-${row.powerMaxKw}:${row.testCycleCode}`,
        ),
      ),
    ).toEqual(
      new Set([
        "0-7.5:NRTC AND NRSC (6-mode OR 8-mode/RMC)",
        "7.5-18.501:NRTC AND NRSC (6-mode OR 8-mode/RMC)",
        "18.501-36.501:NRTC AND NRSC-C1 (8-mode OR RMC)",
        "36.501-55.5:NRTC AND NRSC-C1 (8-mode OR RMC)",
        "55.5-129.5:NRTC AND NRSC-C1 (8-mode OR RMC)",
        "129.5-560.501:NRTC AND NRSC-C1 (8-mode OR RMC)",
      ]),
    );
    expect(
      nonroadRows.every(
        ({ measurementBasis }) =>
          measurementBasis?.includes("40 CFR 1039.140") === true &&
          measurementBasis.includes("40 CFR 1065.20(e)"),
      ),
    ).toBe(true);
    expect(full.jurisdictionIds).toEqual(target.jurisdictionIds);
    expect(full.regulationIds).toEqual(target.regulationIds);
    expect(full.sourceIds).toEqual(target.sourceIds);
    expect(full.limitRows.map(({ id }) => id).sort()).toEqual(
      target.limitRows.map(({ id }) => id).sort(),
    );
  });

  it.each(twelveCountrySourceOnlyGraphs)(
    "selects %s's exact refreshed two-source no-data graph",
    (countryIso3, jurisdictionId, firstSourceId, secondSourceId) => {
      const target = buildTargetSelection(countryIso3, limits);
      const full = buildFullIngestSelection([countryIso3], limits);

      expect(target.jurisdictionIds).toEqual(new Set([jurisdictionId]));
      expect(target.sourceIds).toEqual(
        new Set([firstSourceId, secondSourceId]),
      );
      expect(target.regulationIds).toEqual(new Set());
      expect(target.limitRows).toEqual([]);
      expect(full.jurisdictionIds).toEqual(target.jurisdictionIds);
      expect(full.sourceIds).toEqual(target.sourceIds);
      expect(full.regulationIds).toEqual(target.regulationIds);
      expect(full.limitRows).toEqual(target.limitRows);
      expect(
        fixtureCountryJurisdictions.filter(
          (membership) => membership.countryIso3 === countryIso3,
        ),
      ).toHaveLength(1);
    },
  );

  it("keeps the refreshed 12-country source-only batch closed and empty of numeric data", () => {
    const countryIso3s = twelveCountrySourceOnlyGraphs.map(
      ([countryIso3]) => countryIso3,
    );
    const full = buildFullIngestSelection(countryIso3s, limits);

    expect(full.jurisdictionIds).toEqual(
      new Set(twelveCountrySourceOnlyGraphs.map(([, jurisdictionId]) => jurisdictionId)),
    );
    expect(full.sourceIds).toEqual(
      new Set(
        twelveCountrySourceOnlyGraphs.flatMap(
          ([, , firstSourceId, secondSourceId]) => [firstSourceId, secondSourceId],
        ),
      ),
    );
    expect(full.jurisdictionIds.size).toBe(12);
    expect(full.sourceIds.size).toBe(24);
    expect(full.regulationIds).toEqual(new Set());
    expect(full.limitRows).toEqual([]);
  });

  it.each([
    [
      "MOZ",
      acceptanceFixtureIds.jurisdiction.mozambique,
      acceptanceFixtureIds.source.mozambiqueEnvironment,
      acceptanceFixtureIds.source.mozambiqueTransport,
    ],
    [
      "LSO",
      acceptanceFixtureIds.jurisdiction.lesotho,
      acceptanceFixtureIds.source.lesothoGovernment,
      acceptanceFixtureIds.source.lesothoTransport,
    ],
    [
      "MDG",
      acceptanceFixtureIds.jurisdiction.madagascar,
      acceptanceFixtureIds.source.madagascarEnvironment,
      acceptanceFixtureIds.source.madagascarTransport,
    ],
    [
      "MUS",
      acceptanceFixtureIds.jurisdiction.mauritius,
      acceptanceFixtureIds.source.mauritiusEnvironment,
      acceptanceFixtureIds.source.mauritiusTransport,
    ],
    [
      "FJI",
      acceptanceFixtureIds.jurisdiction.fiji,
      acceptanceFixtureIds.source.fijiEnvironment,
      acceptanceFixtureIds.source.fijiTransport,
    ],
  ] as const)(
    "selects %s exact two-source no-data graph after source-currentness review",
    (countryIso3, jurisdictionId, environmentSourceId, transportSourceId) => {
      const target = buildTargetSelection(countryIso3, limits);
      const full = buildFullIngestSelection([countryIso3], limits);

      expect(target.jurisdictionIds).toEqual(new Set([jurisdictionId]));
      expect(target.sourceIds).toEqual(
        new Set([environmentSourceId, transportSourceId]),
      );
      expect(target.regulationIds).toEqual(new Set());
      expect(target.limitRows).toEqual([]);
      expect(full.jurisdictionIds).toEqual(target.jurisdictionIds);
      expect(full.sourceIds).toEqual(target.sourceIds);
      expect(full.regulationIds).toEqual(target.regulationIds);
      expect(full.limitRows).toEqual(target.limitRows);
    },
  );

  it.each([
    [
      "CAF",
      acceptanceFixtureIds.jurisdiction.centralAfricanRepublic,
      acceptanceFixtureIds.source.centralAfricanRepublicEnvironment,
      acceptanceFixtureIds.source.centralAfricanRepublicTransport,
    ],
    [
      "COD",
      acceptanceFixtureIds.jurisdiction.democraticRepublicOfCongo,
      acceptanceFixtureIds.source.democraticRepublicOfCongoEnvironment,
      acceptanceFixtureIds.source.democraticRepublicOfCongoTransport,
    ],
    [
      "COG",
      acceptanceFixtureIds.jurisdiction.republicOfCongo,
      acceptanceFixtureIds.source.republicOfCongoEnvironment,
      acceptanceFixtureIds.source.republicOfCongoTransport,
    ],
    [
      "GIN",
      acceptanceFixtureIds.jurisdiction.guinea,
      acceptanceFixtureIds.source.guineaEnvironment,
      acceptanceFixtureIds.source.guineaTransport,
    ],
    [
      "DJI",
      acceptanceFixtureIds.jurisdiction.djibouti,
      acceptanceFixtureIds.source.djiboutiEnvironment,
      acceptanceFixtureIds.source.djiboutiTransport,
    ],
  ] as const)(
    "selects %s exact two-source no-data graph after current-source review",
    (countryIso3, jurisdictionId, firstSourceId, secondSourceId) => {
      const target = buildTargetSelection(countryIso3, limits);
      const full = buildFullIngestSelection([countryIso3], limits);

      expect(target.jurisdictionIds).toEqual(new Set([jurisdictionId]));
      expect(target.sourceIds).toEqual(
        new Set([firstSourceId, secondSourceId]),
      );
      expect(target.regulationIds).toEqual(new Set());
      expect(target.limitRows).toEqual([]);
      expect(full.jurisdictionIds).toEqual(target.jurisdictionIds);
      expect(full.sourceIds).toEqual(target.sourceIds);
      expect(full.regulationIds).toEqual(target.regulationIds);
      expect(full.limitRows).toEqual(target.limitRows);
      expect(
        fixtureCountryJurisdictions.filter(
          (membership) => membership.countryIso3 === countryIso3,
        ),
      ).toHaveLength(1);
    },
  );

  it.each([
    [
      "ERI",
      acceptanceFixtureIds.jurisdiction.eritrea,
      acceptanceFixtureIds.source
        .eritreaEnvironmentalProtectionManagementRegulations127_2017,
      acceptanceFixtureIds.source
        .eritreaVehicleTechnicalStandardsRegulations61_2002,
    ],
    [
      "GAB",
      acceptanceFixtureIds.jurisdiction.gabon,
      acceptanceFixtureIds.source.gabonEnvironmentalProtectionLaw007_2014,
      acceptanceFixtureIds.source.gabonHeavyVehicleHomologationOrder00097_2017,
    ],
    [
      "GMB",
      acceptanceFixtureIds.jurisdiction.gambia,
      acceptanceFixtureIds.source
        .gambiaEnvironmentalQualityStandardsRegulations1999,
      acceptanceFixtureIds.source.gambiaMotorTrafficAmendmentAct2013,
    ],
    [
      "GNB",
      acceptanceFixtureIds.jurisdiction.guineaBissau,
      acceptanceFixtureIds.source.guineaBissauBasicEnvironmentLaw1_2011,
      acceptanceFixtureIds.source.guineaBissauTransportMinistryDirectory,
    ],
    [
      "GNQ",
      acceptanceFixtureIds.jurisdiction.equatorialGuinea,
      acceptanceFixtureIds.source.equatorialGuineaEnvironmentalLaw7_2003,
      acceptanceFixtureIds.source
        .equatorialGuineaGeneralRoadTransportLaw4_2018,
    ],
  ] as const)(
    "selects %s exact two-source no-data graph after source-currentness review",
    (countryIso3, jurisdictionId, environmentSourceId, transportSourceId) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.jurisdictionIds).toEqual(new Set([jurisdictionId]));
      expect(selection.sourceIds).toEqual(
        new Set([environmentSourceId, transportSourceId]),
      );
      expect(selection.regulationIds).toEqual(new Set());
      expect(selection.limitRows).toEqual([]);
    },
  );

  it.each([
    [
      "PRK",
      acceptanceFixtureIds.jurisdiction.northKorea,
      acceptanceFixtureIds.source.northKoreaEnvironment,
      acceptanceFixtureIds.source.northKoreaTransport,
    ],
    [
      "PSE",
      acceptanceFixtureIds.jurisdiction.palestine,
      acceptanceFixtureIds.source.palestineEnvironment,
      acceptanceFixtureIds.source.palestineTransport,
    ],
    [
      "SDN",
      acceptanceFixtureIds.jurisdiction.sudan,
      acceptanceFixtureIds.source.sudanEnvironment,
      acceptanceFixtureIds.source.sudanTransport,
    ],
    [
      "PRI",
      acceptanceFixtureIds.jurisdiction.puertoRico,
      acceptanceFixtureIds.source.puertoRicoEnvironment,
      acceptanceFixtureIds.source.puertoRicoTransport,
    ],
    [
      "NCL",
      acceptanceFixtureIds.jurisdiction.newCaledonia,
      acceptanceFixtureIds.source.newCaledoniaEnvironment,
      acceptanceFixtureIds.source.newCaledoniaTransport,
    ],
  ] as const)(
    "selects %s's exact refreshed two-source no-data graph",
    (countryIso3, jurisdictionId, firstSourceId, secondSourceId) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.countryIso3).toBe(countryIso3);
      expect(selection.jurisdictionIds).toEqual(new Set([jurisdictionId]));
      expect(selection.sourceIds).toEqual(
        new Set([firstSourceId, secondSourceId]),
      );
      expect(selection.regulationIds).toEqual(new Set());
      expect(selection.limitRows).toEqual([]);
      expect(
        fixtureCountryJurisdictions.filter(
          (membership) => membership.countryIso3 === countryIso3,
        ),
      ).toHaveLength(1);
    },
  );

  it.each([
    [
      "GTM",
      acceptanceFixtureIds.source.guatemalaEnvironment,
      acceptanceFixtureIds.source.guatemalaTransport,
      null,
      0,
    ],
    [
      "HND",
      acceptanceFixtureIds.source.hondurasEnvironment,
      acceptanceFixtureIds.source.hondurasTransport,
      null,
      0,
    ],
    [
      "NIC",
      acceptanceFixtureIds.source.nicaraguaEnvironment,
      acceptanceFixtureIds.source.nicaraguaTransport,
      null,
      0,
    ],
    [
      "PRY",
      acceptanceFixtureIds.source.paraguayEnvironment,
      acceptanceFixtureIds.source.paraguayTransport,
      null,
      0,
    ],
    [
      "URY",
      acceptanceFixtureIds.source.uruguayEnvironment,
      acceptanceFixtureIds.source.uruguayTransport,
      acceptanceFixtureIds.regulation.uruguayDecree1352021,
      18,
    ],
  ] as const)(
    "locks %s to its exact reviewed two-source graph",
    (
      countryIso3,
      environmentSourceId,
      transportSourceId,
      regulationId,
      expectedLimitCount,
    ) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.jurisdictionIds.size).toBe(1);
      expect(selection.sourceIds).toEqual(
        new Set([environmentSourceId, transportSourceId]),
      );
      expect(selection.regulationIds).toEqual(
        regulationId === null ? new Set() : new Set([regulationId]),
      );
      expect(selection.limitRows).toHaveLength(expectedLimitCount);
      if (regulationId === null) {
        expect(selection.limitRows).toEqual([]);
      } else {
        expect(
          selection.limitRows.every(
            (row) =>
              row.regulationId === regulationId &&
              row.validFrom === "2023-05-14",
          ),
        ).toBe(true);
      }
    },
  );

  it.each([
    [
      "QAT",
      acceptanceFixtureIds.source.qatarEuro5Policy2023,
      acceptanceFixtureIds.source.qatarTechnicalRegulationsDecision125,
    ],
    [
      "KWT",
      acceptanceFixtureIds.source.kuwaitGulfStandardsDecision372,
      acceptanceFixtureIds.source.kuwaitTechnicalRegulationsDecision44,
    ],
    [
      "OMN",
      acceptanceFixtureIds.source.omanBindingVehicleStandardsDecision120,
      acceptanceFixtureIds.source.omanGsoMotorVehicleRegulationsMy2026,
    ],
    [
      "JOR",
      acceptanceFixtureIds.source.jordanTransportGreenGrowthPlan,
      acceptanceFixtureIds.source.jordanTransportEmissionsStandardsCatalogue,
    ],
    [
      "IRN",
      acceptanceFixtureIds.source.iranTechnicalPollutionRegulation,
      acceptanceFixtureIds.source.iranArticle4Amendment2024,
    ],
    [
      "IRQ",
      acceptanceFixtureIds.source.iraqTr167AmendmentDecision2024,
      acceptanceFixtureIds.source.iraqTr167ImplementationNotice2025,
    ],
    [
      "LBN",
      acceptanceFixtureIds.source.lebanonEnvironmentalProtectionLaw444,
      acceptanceFixtureIds.source.lebanonThirdBur2019,
    ],
    [
      "SYR",
      acceptanceFixtureIds.source.syriaEnvironmentLaw12,
      acceptanceFixtureIds.source.syriaVehicleImportNotice2025,
    ],
    [
      "GUY",
      acceptanceFixtureIds.source.guyanaEnvironment,
      acceptanceFixtureIds.source.guyanaTransport,
    ],
    [
      "HTI",
      acceptanceFixtureIds.source.haitiEnvironment,
      acceptanceFixtureIds.source.haitiTransport,
    ],
    [
      "JAM",
      acceptanceFixtureIds.source.jamaicaEnvironment,
      acceptanceFixtureIds.source.jamaicaTransport,
    ],
    [
      "BLZ",
      acceptanceFixtureIds.source.belizeEnvironment,
      acceptanceFixtureIds.source.belizeTransport,
    ],
    [
      "CUB",
      acceptanceFixtureIds.source.cubaEnvironment,
      acceptanceFixtureIds.source.cubaTransport,
    ],
    [
      "LBR",
      acceptanceFixtureIds.source.liberiaEnvironmentalProtectionManagementLaw,
      acceptanceFixtureIds.source.liberiaVehicleAdministrativeRegulation2011,
    ],
    [
      "LBY",
      acceptanceFixtureIds.source.libyaEnvironmentalProtectionLaw15,
      acceptanceFixtureIds.source.libyaEnvironmentalExecutiveRegulation448,
    ],
    [
      "MLI",
      acceptanceFixtureIds.source.maliTechnicalInspectionOrder2020,
      acceptanceFixtureIds.source.maliRoadUseVehicleCirculationDecree2023,
    ],
    [
      "MRT",
      acceptanceFixtureIds.source.mauritaniaAirPollutionLaw2018,
      acceptanceFixtureIds.source.mauritaniaEnvironmentCode2000,
    ],
    [
      "NER",
      acceptanceFixtureIds.source.nigerEnvironmentalFrameworkLaw9856,
      acceptanceFixtureIds.source.nigerMotorVehicleHomologationEServices,
    ],
  ] as const)(
    "selects %s's refreshed exact two-source no-data graph",
    (countryIso3, firstSourceId, secondSourceId) => {
      const target = buildTargetSelection(countryIso3, limits);
      const full = buildFullIngestSelection([countryIso3], limits);

      expect(target.sourceIds).toEqual(
        new Set([firstSourceId, secondSourceId]),
      );
      expect(target.regulationIds.size).toBe(0);
      expect(target.limitRows).toEqual([]);
      expect(full.jurisdictionIds).toEqual(target.jurisdictionIds);
      expect(full.sourceIds).toEqual(target.sourceIds);
      expect(full.regulationIds).toEqual(target.regulationIds);
      expect(full.limitRows).toEqual(target.limitRows);
    },
  );

  it("keeps the complete fixture membership graph closed over the signed regulation allowlist", () => {
    const countryIso3s = [
      ...new Set(
        fixtureCountryJurisdictions.map(
          (membership) => membership.countryIso3,
        ),
      ),
    ];
    const full = buildFullIngestSelection(countryIso3s, limits);

    expect(full.regulationIds).toEqual(signedPublishableRegulationIds);
  });

  it("builds a closed full-ingest graph from signed country memberships", () => {
    const selection = buildFullIngestSelection(
      ["IND", "THA"],
      limits,
    );

    expect(selection.jurisdictionIds).toContain(
      acceptanceFixtureIds.jurisdiction.india,
    );
    expect(selection.jurisdictionIds).toContain(
      acceptanceFixtureIds.jurisdiction.thailand,
    );
    expect(selection.sourceIds).toContain(
      acceptanceFixtureIds.source.indiaTrem2026Draft,
    );
    expect(selection.sourceIds).toContain(
      acceptanceFixtureIds.source.thailandTis3046,
    );
    expect(selection.regulationIds).toContain(
      acceptanceFixtureIds.regulation.indiaTrem2026Draft,
    );
    expect(selection.regulationIds).toContain(
      acceptanceFixtureIds.regulation.thailandHeavyDieselLevel6,
    );
  });

  it("builds the closed Central Asia full-ingest graph", () => {
    const regulationIds = new Set([
      acceptanceFixtureIds.regulation.kazakhstanRoadClass5,
      acceptanceFixtureIds.regulation.kazakhstanAgricultureStageIIIA,
      acceptanceFixtureIds.regulation.kyrgyzstanRoadClass5,
      acceptanceFixtureIds.regulation.kyrgyzstanAgricultureStageIIIA,
      acceptanceFixtureIds.regulation.uzbekistanAgricultureStageIIIA,
    ]);
    const selection = buildFullIngestSelection(
      ["KAZ", "KGZ", "UZB", "TJK", "TKM"],
      limits,
    );

    expect(selection.jurisdictionIds.size).toBe(6);
    expect(selection.regulationIds).toEqual(regulationIds);
    expect(selection.limitRows).toHaveLength(63);
    expect(selection.sourceIds.size).toBe(12);
    expect(selection.sourceIds).toContain(
      acceptanceFixtureIds.source.uneceR49Rev4,
    );
    expect(selection.sourceIds).toContain(
      acceptanceFixtureIds.source.tajikistanEngineTermsDraft,
    );
    expect(selection.sourceIds).toContain(
      acceptanceFixtureIds.source.turkmenistanAirProtectionLaw,
    );
  });

  it("builds the closed KHM, LAO, LKA, MMR, and MNG full-ingest graph", () => {
    const regulationIds = new Set([
      acceptanceFixtureIds.regulation.sriLankaVehicleEmission2018,
    ]);
    const selection = buildFullIngestSelection(
      ["KHM", "LAO", "LKA", "MMR", "MNG"],
      limits,
    );

    expect(selection.jurisdictionIds.size).toBe(5);
    expect(selection.regulationIds).toEqual(regulationIds);
    expect(selection.limitRows).toHaveLength(34);
    expect(selection.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.cambodiaEnvironment,
        acceptanceFixtureIds.source.cambodiaTransport,
        acceptanceFixtureIds.source.laosEnvironment,
        acceptanceFixtureIds.source.laosTransport,
        acceptanceFixtureIds.source.sriLankaEnvironment,
        acceptanceFixtureIds.source.sriLankaTransport,
        acceptanceFixtureIds.source.myanmarEnvironment,
        acceptanceFixtureIds.source.myanmarTransport,
        acceptanceFixtureIds.source.mongoliaEnvironment,
        acceptanceFixtureIds.source.mongoliaTransport,
      ]),
    );
  });

  it("selects Sri Lanka's exact 34-row road and construction graph", () => {
    const selection = buildTargetSelection("LKA", limits);

    expect(selection.jurisdictionIds).toEqual(
      new Set([acceptanceFixtureIds.jurisdiction.sriLanka]),
    );
    expect(selection.regulationIds).toEqual(
      new Set([
        acceptanceFixtureIds.regulation.sriLankaVehicleEmission2018,
      ]),
    );
    expect(selection.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.sriLankaEnvironment,
        acceptanceFixtureIds.source.sriLankaTransport,
      ]),
    );
    expect(selection.limitRows).toHaveLength(34);
    expect(
      selection.limitRows.filter(
        (row) => row.applicationScope === "on-road-truck",
      ),
    ).toHaveLength(5);
    expect(
      selection.limitRows.filter(
        (row) => row.applicationScope === "on-road-bus",
      ),
    ).toHaveLength(5);
    expect(
      selection.limitRows.filter(
        (row) => row.applicationScope === "construction",
      ),
    ).toHaveLength(24);
    expect(
      selection.limitRows.filter(
        (row) => row.applicationScope === "agriculture",
      ),
    ).toEqual([]);
  });

  it.each([
    [
      "KHM",
      acceptanceFixtureIds.source.cambodiaEnvironment,
      acceptanceFixtureIds.source.cambodiaTransport,
    ],
    [
      "LAO",
      acceptanceFixtureIds.source.laosEnvironment,
      acceptanceFixtureIds.source.laosTransport,
    ],
    [
      "MMR",
      acceptanceFixtureIds.source.myanmarEnvironment,
      acceptanceFixtureIds.source.myanmarTransport,
    ],
    [
      "MNG",
      acceptanceFixtureIds.source.mongoliaEnvironment,
      acceptanceFixtureIds.source.mongoliaTransport,
    ],
  ] as const)(
    "selects %s's exact two-source no-data graph",
    (countryIso3, firstSourceId, secondSourceId) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.jurisdictionIds.size).toBe(1);
      expect(selection.regulationIds.size).toBe(0);
      expect(selection.limitRows).toEqual([]);
      expect(selection.sourceIds).toEqual(
        new Set([firstSourceId, secondSourceId]),
      );
    },
  );

  it("preserves every signed EAEU membership across sequential country-scoped publishes", () => {
    const signedCountryIso3s = new Set(["ARM", "BLR", "KAZ", "KGZ", "RUS"]);
    const expectedMemberships = [
      ["ARM", "2015-01-02"],
      ["BLR", "2015-01-01"],
      ["KAZ", "2015-01-01"],
      ["KGZ", "2015-08-12"],
      ["RUS", "2015-01-01"],
    ];

    for (const targetCountryIso3 of ["ARM", "KAZ", "KGZ", "BLR"] as const) {
      const memberships = selectJurisdictionMembershipsForIngest({
        jurisdictionId: acceptanceFixtureIds.jurisdiction.eaeu,
        signedCountryIso3s,
        targetCountryIso3,
      });

      expect(
        memberships
          .map((membership) => [
            membership.countryIso3,
            membership.validFrom,
          ])
          .sort(([left], [right]) => left.localeCompare(right)),
      ).toEqual(expectedMemberships);
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
    "selects the complete %s road and agriculture graph without expanding EAEU limits",
    (countryIso3, roadRegulationId, agricultureRegulationId) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.countryIso3).toBe(countryIso3);
      expect(selection.jurisdictionIds.size).toBe(2);
      expect(selection.regulationIds).toEqual(
        new Set([roadRegulationId, agricultureRegulationId]),
      );
      expect(selection.limitRows).toHaveLength(30);
      expect(selection.sourceIds.size).toBe(4);
      expect(selection.sourceIds).toContain(
        acceptanceFixtureIds.source.uneceR49Rev4,
      );
      expect(
        selection.limitRows.filter(
          (row) => row.regulationId === roadRegulationId,
        ),
      ).toHaveLength(18);
      expect(
        selection.limitRows.filter(
          (row) => row.regulationId === agricultureRegulationId,
        ),
      ).toHaveLength(12);
    },
  );

  it("selects Uzbekistan's agriculture-only graph", () => {
    const selection = buildTargetSelection("UZB", limits);

    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds).toEqual(
      new Set([
        acceptanceFixtureIds.regulation.uzbekistanAgricultureStageIIIA,
      ]),
    );
    expect(selection.limitRows).toHaveLength(3);
    expect(selection.sourceIds.size).toBe(2);
  });

  it.each([
    [
      "TJK",
      acceptanceFixtureIds.source.tajikistanRoadEnvironmentalLaw,
      acceptanceFixtureIds.source.tajikistanEngineTermsDraft,
    ],
    [
      "TKM",
      acceptanceFixtureIds.source.turkmenistanAirProtectionLaw,
      acceptanceFixtureIds.source.turkmenistanGasolineMeasurementStandard,
    ],
  ] as const)(
    "selects %s's exact two-source no-data graph",
    (countryIso3, firstSourceId, secondSourceId) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.jurisdictionIds.size).toBe(1);
      expect(selection.regulationIds.size).toBe(0);
      expect(selection.limitRows).toEqual([]);
      expect(selection.sourceIds).toEqual(
        new Set([firstSourceId, secondSourceId]),
      );
    },
  );

  it.each([
    [
      "DZA",
      acceptanceFixtureIds.source.algeriaEnvironment,
      acceptanceFixtureIds.source.algeriaTransport,
    ],
    [
      "TUN",
      acceptanceFixtureIds.source.tunisiaEnvironment,
      acceptanceFixtureIds.source.tunisiaTransport,
    ],
    [
      "ETH",
      acceptanceFixtureIds.source.ethiopiaEnvironment,
      acceptanceFixtureIds.source.ethiopiaTransport,
    ],
    [
      "CMR",
      acceptanceFixtureIds.source.cameroonEnvironment,
      acceptanceFixtureIds.source.cameroonTransport,
    ],
    [
      "SEN",
      acceptanceFixtureIds.source.senegalEnvironment,
      acceptanceFixtureIds.source.senegalTransport,
    ],
  ] as const)(
    "selects %s's exact two-source five-gate no-data graph",
    (countryIso3, firstSourceId, secondSourceId) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.jurisdictionIds.size).toBe(1);
      expect(selection.regulationIds.size).toBe(0);
      expect(selection.limitRows).toEqual([]);
      expect(selection.sourceIds).toEqual(
        new Set([firstSourceId, secondSourceId]),
      );
    },
  );

  it("selects Rwanda's closed Euro IV road graph", () => {
    const selection = buildTargetSelection("RWA", limits);

    expect(selection.jurisdictionIds).toEqual(
      new Set([acceptanceFixtureIds.jurisdiction.rwanda]),
    );
    expect(selection.regulationIds).toEqual(
      new Set([acceptanceFixtureIds.regulation.rwandaRoadEuroIv]),
    );
    expect(selection.limitRows).toHaveLength(18);
    expect(selection.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.rwandaEnvironment,
        acceptanceFixtureIds.source.rwandaTransport,
        acceptanceFixtureIds.source.rwandaEas1047Implementation,
        acceptanceFixtureIds.source.uneceR49Rev4,
      ]),
    );
    expect(
      selection.limitRows.filter(
        (row) => row.applicationScope === "on-road-truck",
      ),
    ).toHaveLength(9);
    expect(
      selection.limitRows.filter(
        (row) => row.applicationScope === "on-road-bus",
      ),
    ).toHaveLength(9);
  });

  it.each([
    [
      "TZA",
      acceptanceFixtureIds.source.tanzaniaEnvironment,
      acceptanceFixtureIds.source.tanzaniaTransport,
    ],
    [
      "ZMB",
      acceptanceFixtureIds.source.zambiaEnvironment,
      acceptanceFixtureIds.source.zambiaTransport,
    ],
    [
      "ZWE",
      acceptanceFixtureIds.source.zimbabweEnvironment,
      acceptanceFixtureIds.source.zimbabweTransport,
    ],
    [
      "CIV",
      acceptanceFixtureIds.source.coteDIvoireEnvironment,
      acceptanceFixtureIds.source.coteDIvoireTransport,
    ],
  ] as const)(
    "selects %s's exact two-source no-data graph",
    (countryIso3, firstSourceId, secondSourceId) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.jurisdictionIds.size).toBe(1);
      expect(selection.regulationIds.size).toBe(0);
      expect(selection.limitRows).toEqual([]);
      expect(selection.sourceIds).toEqual(
        new Set([firstSourceId, secondSourceId]),
      );
    },
  );

  it("builds the closed TZA/ZMB/ZWE/RWA/CIV full-ingest graph", () => {
    const regulationIds = new Set([
      acceptanceFixtureIds.regulation.rwandaRoadEuroIv,
    ]);
    const selection = buildFullIngestSelection(
      ["TZA", "ZMB", "ZWE", "RWA", "CIV"],
      limits,
    );

    expect(selection.jurisdictionIds.size).toBe(5);
    expect(selection.regulationIds).toEqual(regulationIds);
    expect(selection.limitRows).toHaveLength(18);
    expect(selection.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.tanzaniaEnvironment,
        acceptanceFixtureIds.source.tanzaniaTransport,
        acceptanceFixtureIds.source.zambiaEnvironment,
        acceptanceFixtureIds.source.zambiaTransport,
        acceptanceFixtureIds.source.zimbabweEnvironment,
        acceptanceFixtureIds.source.zimbabweTransport,
        acceptanceFixtureIds.source.rwandaEnvironment,
        acceptanceFixtureIds.source.rwandaTransport,
        acceptanceFixtureIds.source.rwandaEas1047Implementation,
        acceptanceFixtureIds.source.coteDIvoireEnvironment,
        acceptanceFixtureIds.source.coteDIvoireTransport,
        acceptanceFixtureIds.source.uneceR49Rev4,
      ]),
    );
  });

  it("builds the closed Caucasus full-ingest graph", () => {
    const regulationIds = new Set([
      acceptanceFixtureIds.regulation.armeniaRoadClass5,
      acceptanceFixtureIds.regulation.armeniaAgricultureStageIIIA,
      acceptanceFixtureIds.regulation.belarusRoadClass5,
      acceptanceFixtureIds.regulation.belarusAgricultureStageIIIA,
      acceptanceFixtureIds.regulation.georgiaRoadClass5,
    ]);
    const selection = buildFullIngestSelection(
      ["ARM", "AZE", "GEO", "BLR"],
      limits,
    );

    expect(selection.jurisdictionIds.size).toBe(5);
    expect(selection.regulationIds).toEqual(regulationIds);
    expect(selection.limitRows).toHaveLength(78);
    expect(selection.sourceIds.size).toBe(10);
    expect(selection.sourceIds).toContain(
      acceptanceFixtureIds.source.uneceR49Rev4,
    );
    expect(selection.sourceIds).toContain(
      acceptanceFixtureIds.source.azerbaijanEuro4Decision,
    );
    expect(selection.sourceIds).toContain(
      acceptanceFixtureIds.source.georgiaResolution238Mepa,
    );
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
    "selects the complete %s Caucasus road and agriculture graph without expanding EAEU limits",
    (countryIso3, roadRegulationId, agricultureRegulationId) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.jurisdictionIds.size).toBe(2);
      expect(selection.regulationIds).toEqual(
        new Set([roadRegulationId, agricultureRegulationId]),
      );
      expect(selection.limitRows).toHaveLength(30);
      expect(selection.sourceIds.size).toBe(4);
      expect(selection.sourceIds).toContain(
        acceptanceFixtureIds.source.uneceR49Rev4,
      );
      expect(
        selection.limitRows.filter(
          (row) => row.regulationId === roadRegulationId,
        ),
      ).toHaveLength(18);
      expect(
        selection.limitRows.filter(
          (row) => row.regulationId === agricultureRegulationId,
        ),
      ).toHaveLength(12);
    },
  );

  it("selects Georgia's N3/M3 road-only graph", () => {
    const selection = buildTargetSelection("GEO", limits);

    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds).toEqual(
      new Set([acceptanceFixtureIds.regulation.georgiaRoadClass5]),
    );
    expect(selection.limitRows).toHaveLength(18);
    expect(selection.sourceIds.size).toBe(3);
    expect(selection.sourceIds).toContain(
      acceptanceFixtureIds.source.uneceR49Rev4,
    );
  });

  it("selects Azerbaijan's exact two-source all-scope no-data graph", () => {
    const selection = buildTargetSelection("AZE", limits);

    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds.size).toBe(0);
    expect(selection.limitRows).toEqual([]);
    expect(selection.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.azerbaijanEuro4Decision,
        acceptanceFixtureIds.source.azerbaijanAzs6362025,
      ]),
    );
  });

  it("builds the closed final-ten-country ingest graph", () => {
    const regulationIds = new Set([
      acceptanceFixtureIds.regulation.bangladeshHeavyDiesel2022,
      acceptanceFixtureIds.regulation.boliviaRm064HeavyDiesel,
    ]);
    const selection = buildFullIngestSelection(
      ["AFG", "AGO", "BDI", "BEN", "BFA", "BGD", "BHS", "BOL", "MAR", "KEN"],
      limits,
    );

    expect(selection.jurisdictionIds.size).toBe(10);
    expect(selection.regulationIds).toEqual(regulationIds);
    expect(selection.limitRows).toHaveLength(16);
    expect(selection.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.afghanistanAirPollutionRegulation,
        acceptanceFixtureIds.source.afghanistanAirPollutionAmendment,
        acceptanceFixtureIds.source.angolaVehicleInspectionRegulation,
        acceptanceFixtureIds.source.angolaEnvironmentalStandardizationProgram,
        acceptanceFixtureIds.source.burundiRoadTrafficCode2012,
        acceptanceFixtureIds.source.burundiVehicleInspectionOrder2025,
        acceptanceFixtureIds.source.beninAirQualityDecree2001,
        acceptanceFixtureIds.source.beninAirQualityDecreeIndex,
        acceptanceFixtureIds.source.burkinaFasoAirQualityDecree2001,
        acceptanceFixtureIds.source.burkinaFasoCurrentCitation2025,
        acceptanceFixtureIds.source.bangladeshAirPollutionRules2022,
        acceptanceFixtureIds.source.bangladeshGazetteIndex2022,
        acceptanceFixtureIds.source.bahamasRoadTrafficAct,
        acceptanceFixtureIds.source.bahamasEnvironmentalPlanningAct,
        acceptanceFixtureIds.source.boliviaRm064Regulation,
        acceptanceFixtureIds.source.boliviaIbmetroAcceptance,
        acceptanceFixtureIds.source.moroccoEuro6Order2094,
        acceptanceFixtureIds.source.moroccoEuro6Order2251,
        acceptanceFixtureIds.source.kenyaAirQualityRegulations2024,
        acceptanceFixtureIds.source.kenyaInspectionRules2026,
      ]),
    );
  });

  it.each([
    [
      "AFG",
      acceptanceFixtureIds.jurisdiction.afghanistan,
      acceptanceFixtureIds.source.afghanistanAirPollutionRegulation,
      acceptanceFixtureIds.source.afghanistanAirPollutionAmendment,
    ],
    [
      "AGO",
      acceptanceFixtureIds.jurisdiction.angola,
      acceptanceFixtureIds.source.angolaVehicleInspectionRegulation,
      acceptanceFixtureIds.source.angolaEnvironmentalStandardizationProgram,
    ],
    [
      "BDI",
      acceptanceFixtureIds.jurisdiction.burundi,
      acceptanceFixtureIds.source.burundiRoadTrafficCode2012,
      acceptanceFixtureIds.source.burundiVehicleInspectionOrder2025,
    ],
    [
      "BEN",
      acceptanceFixtureIds.jurisdiction.benin,
      acceptanceFixtureIds.source.beninAirQualityDecree2001,
      acceptanceFixtureIds.source.beninAirQualityDecreeIndex,
    ],
    [
      "BFA",
      acceptanceFixtureIds.jurisdiction.burkinaFaso,
      acceptanceFixtureIds.source.burkinaFasoAirQualityDecree2001,
      acceptanceFixtureIds.source.burkinaFasoCurrentCitation2025,
    ],
    [
      "BHS",
      acceptanceFixtureIds.jurisdiction.bahamas,
      acceptanceFixtureIds.source.bahamasRoadTrafficAct,
      acceptanceFixtureIds.source.bahamasEnvironmentalPlanningAct,
    ],
    [
      "MAR",
      acceptanceFixtureIds.jurisdiction.morocco,
      acceptanceFixtureIds.source.moroccoEuro6Order2094,
      acceptanceFixtureIds.source.moroccoEuro6Order2251,
    ],
    [
      "KEN",
      acceptanceFixtureIds.jurisdiction.kenya,
      acceptanceFixtureIds.source.kenyaAirQualityRegulations2024,
      acceptanceFixtureIds.source.kenyaInspectionRules2026,
    ],
  ] as const)(
    "selects %s's exact final-batch two-source no-data graph",
    (countryIso3, jurisdictionId, firstSourceId, secondSourceId) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.countryIso3).toBe(countryIso3);
      expect(selection.jurisdictionIds).toEqual(new Set([jurisdictionId]));
      expect(selection.sourceIds).toEqual(
        new Set([firstSourceId, secondSourceId]),
      );
      expect(selection.regulationIds.size).toBe(0);
      expect(selection.limitRows).toEqual([]);
      expect(
        fixtureCountryJurisdictions.filter(
          (membership) => membership.countryIso3 === countryIso3,
        ),
      ).toHaveLength(1);
    },
  );

  it.each([
    [
      "BGD",
      acceptanceFixtureIds.jurisdiction.bangladesh,
      acceptanceFixtureIds.regulation.bangladeshHeavyDiesel2022,
      acceptanceFixtureIds.source.bangladeshAirPollutionRules2022,
      acceptanceFixtureIds.source.bangladeshGazetteIndex2022,
    ],
    [
      "BOL",
      acceptanceFixtureIds.jurisdiction.bolivia,
      acceptanceFixtureIds.regulation.boliviaRm064HeavyDiesel,
      acceptanceFixtureIds.source.boliviaRm064Regulation,
      acceptanceFixtureIds.source.boliviaIbmetroAcceptance,
    ],
  ] as const)(
    "selects %s's complete final-batch heavy-road graph",
    (
      countryIso3,
      jurisdictionId,
      regulationId,
      firstSourceId,
      secondSourceId,
    ) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.countryIso3).toBe(countryIso3);
      expect(selection.jurisdictionIds).toEqual(new Set([jurisdictionId]));
      expect(selection.sourceIds).toEqual(
        new Set([firstSourceId, secondSourceId]),
      );
      expect(selection.regulationIds).toEqual(new Set([regulationId]));
      expect(selection.limitRows).toHaveLength(8);
      expect(
        selection.limitRows.filter(
          ({ applicationScope }) => applicationScope === "on-road-truck",
        ),
      ).toHaveLength(4);
      expect(
        selection.limitRows.filter(
          ({ applicationScope }) => applicationScope === "on-road-bus",
        ),
      ).toHaveLength(4);
      expect(
        selection.limitRows.every(
          (row) =>
            row.regulationId === regulationId &&
            row.dataSourceId === firstSourceId &&
            row.isDemo === false &&
            row.verifiedAt.toISOString() === "2026-08-10T14:35:00.000Z",
        ),
      ).toBe(true);
      expect(
        fixtureCountryJurisdictions.filter(
          (membership) => membership.countryIso3 === countryIso3,
        ),
      ).toHaveLength(1);
    },
  );

  it("selects Nigeria's exact two-source no-data graph", () => {
    const selection = buildTargetSelection("NGA", limits);

    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds).toEqual(new Set());
    expect(selection.limitRows).toEqual([]);
    expect(selection.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.nigeriaNesrea,
        acceptanceFixtureIds.source.nigeriaVehicularEmissions2011,
      ]),
    );
  });

  it("builds a closed full-ingest no-data graph for retired DZA, ETH, and NGA regulations", () => {
    const selection = buildFullIngestSelection(
      ["DZA", "ETH", "NGA"],
      limits,
    );

    expect(selection.jurisdictionIds.size).toBe(3);
    expect(selection.regulationIds).toEqual(new Set());
    expect(selection.limitRows).toEqual([]);
    expect(selection.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.algeriaEnvironment,
        acceptanceFixtureIds.source.algeriaTransport,
        acceptanceFixtureIds.source.ethiopiaEnvironment,
        acceptanceFixtureIds.source.ethiopiaTransport,
        acceptanceFixtureIds.source.nigeriaNesrea,
        acceptanceFixtureIds.source.nigeriaVehicularEmissions2011,
      ]),
    );
  });

  it.each([
    "EGY",
    "GHA",
    "MDA",
    "SRB",
    "ALB",
    "MKD",
    "TGO",
    "TLS",
    "TTO",
  ] as const)(
    "selects %s source-only no-data coverage without inventing regulations",
    (countryIso3) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.countryIso3).toBe(countryIso3);
      expect(selection.jurisdictionIds.size).toBe(1);
      expect(selection.sourceIds.size).toBe(2);
      expect(selection.regulationIds.size).toBe(0);
      expect(selection.limitRows).toEqual([]);
    },
  );

  it("selects Israel's complete CY2026 road and construction graph", () => {
    const selection = buildTargetSelection("ISR", limits);

    expect(selection.countryIso3).toBe("ISR");
    expect(selection.jurisdictionIds).toEqual(
      new Set([acceptanceFixtureIds.jurisdiction.israel]),
    );
    expect(selection.regulationIds).toEqual(
      new Set([
        acceptanceFixtureIds.regulation.israelRoadEuroVi2026,
        acceptanceFixtureIds.regulation.israelConstructionStageV2026,
      ]),
    );
    expect(selection.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.israelRoadImr2026,
        acceptanceFixtureIds.source.israelNrmmImr2026,
        acceptanceFixtureIds.source.euReg595,
        acceptanceFixtureIds.source.euReg1628,
      ]),
    );
    expect(selection.limitRows).toHaveLength(52);
    expect(
      selection.limitRows.filter(
        (row) => row.applicationScope === "on-road-truck",
      ),
    ).toHaveLength(12);
    expect(
      selection.limitRows.filter(
        (row) => row.applicationScope === "on-road-bus",
      ),
    ).toHaveLength(12);
    expect(
      selection.limitRows.filter(
        (row) => row.applicationScope === "construction",
      ),
    ).toHaveLength(28);
    expect(
      selection.limitRows.filter(
        (row) => row.applicationScope === "agriculture",
      ),
    ).toEqual([]);
  });

  it("selects the complete Taiwan Phase 6 road-regulation graph", () => {
    const selection = buildTargetSelection("TWN", limits);

    expect(selection.countryIso3).toBe("TWN");
    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds.size).toBe(1);
    expect(selection.limitRows).toHaveLength(32);
    expect(selection.sourceIds.size).toBe(2);
  });

  it("selects the complete Venezuela MY2000 road-regulation graph", () => {
    const selection = buildTargetSelection("VEN", limits);

    expect(selection.countryIso3).toBe("VEN");
    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds.size).toBe(1);
    expect(selection.limitRows).toHaveLength(10);
    expect(selection.sourceIds.size).toBe(2);
  });

  it("selects India's effective limits and metadata-only TREM proposal", () => {
    const selection = buildTargetSelection("IND", limits);

    expect(selection.countryIso3).toBe("IND");
    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds).toContain(
      acceptanceFixtureIds.regulation.indiaTrem2026Draft,
    );
    expect(selection.regulationIds.size).toBe(6);
    expect(selection.limitRows.length).toBeGreaterThan(0);
    expect(
      selection.limitRows.some(
        (limit) =>
          limit.regulationId ===
          acceptanceFixtureIds.regulation.indiaTrem2026Draft,
      ),
    ).toBe(false);
  });

  it("selects the complete Ukraine Euro V road-regulation graph", () => {
    const selection = buildTargetSelection("UKR", limits);

    expect(selection.countryIso3).toBe("UKR");
    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds).toEqual(
      new Set([acceptanceFixtureIds.regulation.ukraineRoadEuroV]),
    );
    expect(selection.limitRows).toHaveLength(18);
    expect(selection.sourceIds.size).toBe(3);
  });

  it("selects the complete Thailand TIS 3046 road-regulation graph", () => {
    const selection = buildTargetSelection("THA", limits);

    expect(selection.countryIso3).toBe("THA");
    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds).toEqual(
      new Set([acceptanceFixtureIds.regulation.thailandHeavyDieselLevel6]),
    );
    expect(selection.limitRows).toHaveLength(18);
    expect(selection.sourceIds.size).toBe(2);
  });

  it("selects the complete Bosnia and Herzegovina R49/06 road-regulation graph", () => {
    const selection = buildTargetSelection("BIH", limits);

    expect(selection.countryIso3).toBe("BIH");
    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds).toEqual(
      new Set([acceptanceFixtureIds.regulation.bosniaR49Series06]),
    );
    expect(selection.limitRows).toHaveLength(24);
    expect(selection.sourceIds.size).toBe(3);
  });

  it("selects the complete Montenegro Euro VI road-regulation graph", () => {
    const selection = buildTargetSelection("MNE", limits);

    expect(selection.countryIso3).toBe("MNE");
    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds).toEqual(
      new Set([acceptanceFixtureIds.regulation.montenegroEuroVi]),
    );
    expect(selection.limitRows).toHaveLength(32);
    expect(selection.sourceIds.size).toBe(3);
  });

  it("selects the complete Nepal Standard 2082 road-regulation graph", () => {
    const selection = buildTargetSelection("NPL", limits);

    expect(selection.countryIso3).toBe("NPL");
    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.regulationIds).toEqual(
      new Set([acceptanceFixtureIds.regulation.nepalHeavyVehicle2082]),
    );
    expect(selection.limitRows).toHaveLength(32);
    expect(selection.sourceIds.size).toBe(2);
  });

  it.each(["VUT", "YEM"] as const)(
    "selects %s two-source no-data coverage without inventing regulations",
    (countryIso3) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.countryIso3).toBe(countryIso3);
      expect(selection.jurisdictionIds.size).toBe(1);
      expect(selection.sourceIds.size).toBe(2);
      expect(selection.regulationIds.size).toBe(0);
      expect(selection.limitRows).toEqual([]);
    },
  );

  it.each([
    [
      "ZAF",
      acceptanceFixtureIds.jurisdiction.southAfrica,
      acceptanceFixtureIds.regulation.southAfricaR4902B,
      10,
      [
        acceptanceFixtureIds.source.southAfricaMotorVehiclesM23,
        acceptanceFixtureIds.source.southAfricaMotorVehiclesN23,
        acceptanceFixtureIds.source.southAfricaDirective91542,
      ],
    ],
    [
      "ARE",
      acceptanceFixtureIds.jurisdiction.unitedArabEmirates,
      acceptanceFixtureIds.regulation.uaeHeavyVehicleEuro6B,
      24,
      [
        acceptanceFixtureIds.source.uaeMandatoryStandards2018,
        acceptanceFixtureIds.source.uaeVehicleEmissionGuide,
      ],
    ],
    [
      "SAU",
      acceptanceFixtureIds.jurisdiction.saudiArabia,
      acceptanceFixtureIds.regulation.saudiHeavyVehicleEuroVMy2026,
      18,
      [
        acceptanceFixtureIds.source.saudiMachinerySafetyPart2,
        acceptanceFixtureIds.source.saudiVehicle2026TechnicalRegulations,
        acceptanceFixtureIds.source.uneceR49Rev4,
      ],
    ],
    [
      "ECU",
      acceptanceFixtureIds.jurisdiction.ecuador,
      acceptanceFixtureIds.regulation.ecuadorHeavyDieselRte017,
      8,
      [
        acceptanceFixtureIds.source.ecuadorRte017Amendment2025,
        acceptanceFixtureIds.source.ecuadorRte017,
        acceptanceFixtureIds.source.ecuadorDieselStandard2207,
      ],
    ],
    [
      "PHL",
      acceptanceFixtureIds.jurisdiction.philippines,
      acceptanceFixtureIds.regulation.philippinesHeavyDieselEuroIv,
      18,
      [
        acceptanceFixtureIds.source.philippinesEuro4LimitsBoI,
        acceptanceFixtureIds.source.philippinesLtoMc20151946,
        acceptanceFixtureIds.source.uneceR49Rev4,
      ],
    ],
    [
      "PAK",
      acceptanceFixtureIds.jurisdiction.pakistan,
      acceptanceFixtureIds.regulation.pakistanHeavyDieselPakIi,
      8,
      [
        acceptanceFixtureIds.source.pakistanSro72OfficialIndex,
        acceptanceFixtureIds.source.pakistanSro72GazetteScan,
      ],
    ],
  ] as const)(
    "selects %s's complete newly closed road-regulation graph",
    (countryIso3, jurisdictionId, regulationId, expectedLimits, sourceIds) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.countryIso3).toBe(countryIso3);
      expect(selection.jurisdictionIds).toEqual(new Set([jurisdictionId]));
      expect(selection.sourceIds).toEqual(new Set(sourceIds));
      expect(selection.regulationIds).toEqual(new Set([regulationId]));
      expect(selection.limitRows).toHaveLength(expectedLimits);
      expect(
        selection.limitRows.every(
          (row) => row.regulationId === regulationId && row.isDemo === false,
        ),
      ).toBe(true);
    },
  );

  it.each(["ATA", "ATF", "ESH", "FLK"] as const)(
    "selects %s one-source territorial boundary without inventing regulations",
    (countryIso3) => {
      const selection = buildTargetSelection(countryIso3, limits);

      expect(selection.countryIso3).toBe(countryIso3);
      expect(selection.jurisdictionIds.size).toBe(1);
      expect(selection.sourceIds.size).toBe(1);
      expect(selection.regulationIds.size).toBe(0);
      expect(selection.limitRows).toEqual([]);
    },
  );

  it("selects Uganda's explicitly signed-off effective regulation with zero limits", () => {
    const selection = buildTargetSelection("UGA", limits);

    expect(selection.countryIso3).toBe("UGA");
    expect(selection.jurisdictionIds.size).toBe(1);
    expect(selection.sourceIds.size).toBe(2);
    expect(selection.regulationIds.size).toBe(1);
    expect(selection.limitRows).toEqual([]);
  });

  it("keeps the NGA/UGA/BWA/NAM/SWZ deep-review graph closed without unverified limits", () => {
    const regulationIds = new Set([
      acceptanceFixtureIds.regulation.ugandaAirQuality2024,
    ]);
    const selection = buildFullIngestSelection(
      ["NGA", "UGA", "BWA", "NAM", "SWZ"],
      limits,
    );

    expect(selection.jurisdictionIds.size).toBe(5);
    expect(selection.regulationIds).toEqual(regulationIds);
    expect(selection.limitRows).toEqual([]);
    expect(selection.sourceIds).toEqual(
      new Set([
        acceptanceFixtureIds.source.nigeriaNesrea,
        acceptanceFixtureIds.source.nigeriaVehicularEmissions2011,
        acceptanceFixtureIds.source.ugandaEnvironment,
        acceptanceFixtureIds.source.ugandaTransport,
        acceptanceFixtureIds.source.botswanaGovernment,
        acceptanceFixtureIds.source.botswanaTransport,
        acceptanceFixtureIds.source.namibiaEnvironment,
        acceptanceFixtureIds.source.namibiaTransport,
        acceptanceFixtureIds.source.eswatiniGovernment,
        acceptanceFixtureIds.source.eswatiniTransport,
      ]),
    );

    for (const countryIso3 of ["BWA", "NAM", "SWZ"] as const) {
      const target = buildTargetSelection(countryIso3, limits);
      expect(target.sourceIds.size).toBe(2);
      expect(target.regulationIds).toEqual(new Set());
      expect(target.limitRows).toEqual([]);
    }
    expect(buildTargetSelection("UGA", limits).limitRows).toEqual([]);
    expect(buildTargetSelection("NGA", limits).limitRows).toEqual([]);
  });

  it("rejects a country outside the canonical catalog", () => {
    expect(() => buildTargetSelection("ZZZ", limits)).toThrow(
      "Catalog entry for ZZZ is missing.",
    );
  });
});
