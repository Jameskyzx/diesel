import {
  acceptedLimitUnavailableRegulationIds,
  acceptanceFixtureIds,
  buildFixtureLimits,
  fixtureCountryJurisdictions,
  fixtureJurisdictions,
  fixtureRegulations,
} from "../../src/server/db/seed/acceptance-fixtures";
import { countryCatalog } from "../../src/server/db/seed/country-catalog";

type FixtureLimit = ReturnType<typeof buildFixtureLimits>[number];
const acceptedLimitUnavailableRegulationIdSet = new Set<string>(
  acceptedLimitUnavailableRegulationIds,
);

/**
 * Regulations explicitly signed off for publication. Both full and
 * country-targeted ingestion must use this same boundary so that a target
 * publish cannot accidentally promote an adjacent draft/adopted fixture from
 * the same jurisdiction.
 */
export const signedPublishableRegulationIds: ReadonlySet<string> = new Set([
  acceptanceFixtureIds.regulation.cnGb17691,
  acceptanceFixtureIds.regulation.cnGb20891,
  acceptanceFixtureIds.regulation.us1036104,
  acceptanceFixtureIds.regulation.us8600711,
  acceptanceFixtureIds.regulation.us1039101,
  acceptanceFixtureIds.regulation.euReg595,
  acceptanceFixtureIds.regulation.euReg1628,
  acceptanceFixtureIds.regulation.brConama403,
  acceptanceFixtureIds.regulation.brConama490,
  acceptanceFixtureIds.regulation.brConama433,
  acceptanceFixtureIds.regulation.japanRoad2016,
  acceptanceFixtureIds.regulation.japanOffroad2014,
  acceptanceFixtureIds.regulation.koreaRoad2017,
  acceptanceFixtureIds.regulation.koreaConstruction2020,
  acceptanceFixtureIds.regulation.koreaAgriculture2021,
  acceptanceFixtureIds.regulation.mexicoNom044Table1,
  acceptanceFixtureIds.regulation.mexicoNom044Table2,
  acceptanceFixtureIds.regulation.turkeyRoad2016,
  acceptanceFixtureIds.regulation.turkeyNonroadStageV,
  acceptanceFixtureIds.regulation.australiaAdr80_03,
  acceptanceFixtureIds.regulation.australiaAdr80_04,
  acceptanceFixtureIds.regulation.canadaRoad2003,
  acceptanceFixtureIds.regulation.canadaOffroad2020,
  acceptanceFixtureIds.regulation.unitedKingdomNrmmStageV,
  acceptanceFixtureIds.regulation.indiaBs6,
  acceptanceFixtureIds.regulation.indiaCevStageIv,
  acceptanceFixtureIds.regulation.indiaCevStageV,
  acceptanceFixtureIds.regulation.indiaTremStageIv,
  acceptanceFixtureIds.regulation.indiaTremStageV,
  acceptanceFixtureIds.regulation.indiaTrem2026Draft,
  acceptanceFixtureIds.regulation.russiaRoadClass5,
  acceptanceFixtureIds.regulation.russiaAgricultureClass3A,
  acceptanceFixtureIds.regulation.indonesiaEuro4,
  acceptanceFixtureIds.regulation.vietnamLevel5,
  acceptanceFixtureIds.regulation.malaysiaEuro2,
  acceptanceFixtureIds.regulation.argentinaEuroV,
  acceptanceFixtureIds.regulation.newZealandEuroVi,
  acceptanceFixtureIds.regulation.chileHeavyVehicleEuroVi,
  acceptanceFixtureIds.regulation.chileMobileMachineryStageV,
  acceptanceFixtureIds.regulation.chileTractorStageV,
  acceptanceFixtureIds.regulation.colombiaHeavyVehicleEuroVi,
  acceptanceFixtureIds.regulation.colombiaNonRoadTable23,
  acceptanceFixtureIds.regulation.peruHeavyVehicleEuroVi,
  acceptanceFixtureIds.regulation.singaporeHeavyVehicleEuroVi,
  acceptanceFixtureIds.regulation.singaporeOffRoadStageIi,
  acceptanceFixtureIds.regulation.norwayHeavyVehicleEuroVi,
  acceptanceFixtureIds.regulation.norwayNrmmStageV,
  acceptanceFixtureIds.regulation.icelandHeavyVehicleEuroVi,
  acceptanceFixtureIds.regulation.icelandNrmmStageV2020,
  acceptanceFixtureIds.regulation.icelandNrmmStageV2021,
  acceptanceFixtureIds.regulation.liechtensteinHeavyVehicleEuroVi,
  acceptanceFixtureIds.regulation.liechtensteinNrmmStageV,
  acceptanceFixtureIds.regulation.switzerlandHeavyVehicleEuroVi,
  acceptanceFixtureIds.regulation.switzerlandNrmmStageV,
  acceptanceFixtureIds.regulation.sriLankaVehicleEmission2018,
  acceptanceFixtureIds.regulation.uruguayDecree1352021,
  acceptanceFixtureIds.regulation.ugandaAirQuality2024,
  acceptanceFixtureIds.regulation.papuaNewGuineaHeavyTruckAdr803,
  acceptanceFixtureIds.regulation.taiwanHeavyDieselPhase6,
  acceptanceFixtureIds.regulation.venezuelaHeavyDieselMy2000,
  acceptanceFixtureIds.regulation.ukraineRoadEuroV,
  acceptanceFixtureIds.regulation.thailandHeavyDieselLevel6,
  acceptanceFixtureIds.regulation.bosniaR49Series06,
  acceptanceFixtureIds.regulation.montenegroEuroVi,
  acceptanceFixtureIds.regulation.nepalHeavyVehicle2082,
  acceptanceFixtureIds.regulation.kazakhstanRoadClass5,
  acceptanceFixtureIds.regulation.kazakhstanAgricultureStageIIIA,
  acceptanceFixtureIds.regulation.kyrgyzstanRoadClass5,
  acceptanceFixtureIds.regulation.kyrgyzstanAgricultureStageIIIA,
  acceptanceFixtureIds.regulation.uzbekistanAgricultureStageIIIA,
  acceptanceFixtureIds.regulation.armeniaRoadClass5,
  acceptanceFixtureIds.regulation.armeniaAgricultureStageIIIA,
  acceptanceFixtureIds.regulation.belarusRoadClass5,
  acceptanceFixtureIds.regulation.belarusAgricultureStageIIIA,
  acceptanceFixtureIds.regulation.georgiaRoadClass5,
  acceptanceFixtureIds.regulation.bangladeshHeavyDiesel2022,
  acceptanceFixtureIds.regulation.boliviaRm064HeavyDiesel,
  acceptanceFixtureIds.regulation.southAfricaR4902B,
  acceptanceFixtureIds.regulation.uaeHeavyVehicleEuro6B,
  acceptanceFixtureIds.regulation.saudiHeavyVehicleEuroVMy2026,
  acceptanceFixtureIds.regulation.ecuadorHeavyDieselRte017,
  acceptanceFixtureIds.regulation.philippinesHeavyDieselEuroIv,
  acceptanceFixtureIds.regulation.pakistanHeavyDieselPakIi,
  acceptanceFixtureIds.regulation.israelRoadEuroVi2026,
  acceptanceFixtureIds.regulation.israelConstructionStageV2026,
  acceptanceFixtureIds.regulation.rwandaRoadEuroIv,
]);

export type TargetSelection = {
  countryIso3: string;
  jurisdictionIds: ReadonlySet<string>;
  limitRows: readonly FixtureLimit[];
  regulationIds: ReadonlySet<string>;
  sourceIds: ReadonlySet<string>;
};

export type FullIngestSelection = Omit<TargetSelection, "countryIso3">;

type JurisdictionMembershipSelectionInput = {
  jurisdictionId: string;
  signedCountryIso3s: ReadonlySet<string>;
  targetCountryIso3?: string;
};

function requireId(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing fixture id for ${label}.`);
  }
  return value;
}

function selectSignedPublishableRegulations(
  jurisdictionIds: ReadonlySet<string>,
) {
  return fixtureRegulations.filter((regulation) => {
    const regulationId = requireId(regulation.id, regulation.canonicalName);
    return (
      jurisdictionIds.has(regulation.jurisdictionId) &&
      signedPublishableRegulationIds.has(regulationId)
    );
  });
}

export function selectJurisdictionMembershipsForIngest({
  jurisdictionId,
  signedCountryIso3s,
  targetCountryIso3,
}: JurisdictionMembershipSelectionInput) {
  const jurisdiction = fixtureJurisdictions.find(
    (row) => requireId(row.id, row.code) === jurisdictionId,
  );
  if (!jurisdiction) {
    throw new Error(`Jurisdiction ${jurisdictionId} is missing.`);
  }

  const signedMemberships = fixtureCountryJurisdictions.filter(
    (membership) =>
      membership.jurisdictionId === jurisdictionId &&
      signedCountryIso3s.has(membership.countryIso3),
  );

  if (!targetCountryIso3) {
    return signedMemberships;
  }

  // Jurisdiction publication replaces its complete active membership set.
  // A country-scoped publish must therefore preserve every signed member of a
  // shared regional/international jurisdiction, while a national jurisdiction
  // remains limited to the requested country.
  if (jurisdiction.type !== "country" && jurisdiction.countryIso3 == null) {
    return signedMemberships;
  }

  return signedMemberships.filter(
    (membership) => membership.countryIso3 === targetCountryIso3,
  );
}

export function buildTargetSelection(
  countryIso3: string,
  limitRows: readonly FixtureLimit[],
): TargetSelection {
  if (!countryCatalog.some((country) => country.iso3 === countryIso3)) {
    throw new Error(`Catalog entry for ${countryIso3} is missing.`);
  }

  const memberships = fixtureCountryJurisdictions.filter(
    (membership) => membership.countryIso3 === countryIso3,
  );
  if (memberships.length === 0) {
    throw new Error(
      `No jurisdiction membership is registered for ${countryIso3}.`,
    );
  }

  const jurisdictionIds = new Set(
    memberships.map((membership) => membership.jurisdictionId),
  );
  const jurisdictions = fixtureJurisdictions.filter((jurisdiction) =>
    jurisdictionIds.has(requireId(jurisdiction.id, jurisdiction.code)),
  );
  if (jurisdictions.length !== jurisdictionIds.size) {
    throw new Error(`Target jurisdiction graph for ${countryIso3} is incomplete.`);
  }

  const regulations = selectSignedPublishableRegulations(jurisdictionIds);
  const regulationIds = new Set(
    regulations.map((regulation) =>
      requireId(regulation.id, regulation.canonicalName),
    ),
  );
  const selectedLimits = limitRows.filter((limit) =>
    regulationIds.has(limit.regulationId),
  );
  const regulationIdsWithLimits = new Set(
    selectedLimits.map((limit) => limit.regulationId),
  );
  const regulationsWithoutLimits = [...regulationIds].filter(
    (regulationId) =>
      !regulationIdsWithLimits.has(regulationId) &&
      !acceptedLimitUnavailableRegulationIdSet.has(regulationId),
  );
  if (regulationsWithoutLimits.length > 0) {
    throw new Error(
      `Publishable regulations without limits are registered for ${countryIso3}: ${regulationsWithoutLimits.join(", ")}.`,
    );
  }

  const sourceIds = new Set<string>();
  for (const jurisdiction of jurisdictions) {
    sourceIds.add(jurisdiction.dataSourceId);
  }
  for (const membership of memberships) {
    sourceIds.add(membership.dataSourceId);
  }
  for (const regulation of regulations) {
    sourceIds.add(regulation.dataSourceId);
  }
  for (const limit of selectedLimits) {
    sourceIds.add(limit.dataSourceId);
  }

  return {
    countryIso3,
    jurisdictionIds,
    limitRows: selectedLimits,
    regulationIds,
    sourceIds,
  };
}

export function buildFullIngestSelection(
  countryIso3s: readonly string[],
  limitRows: readonly FixtureLimit[],
): FullIngestSelection {
  for (const countryIso3 of countryIso3s) {
    if (!countryCatalog.some((country) => country.iso3 === countryIso3)) {
      throw new Error(`Catalog entry for ${countryIso3} is missing.`);
    }
  }

  const selectedCountries = new Set(countryIso3s);
  const memberships = fixtureCountryJurisdictions.filter((membership) =>
    selectedCountries.has(membership.countryIso3),
  );
  const countriesWithoutMemberships = countryIso3s.filter(
    (countryIso3) =>
      !memberships.some(
        (membership) => membership.countryIso3 === countryIso3,
      ),
  );
  if (countriesWithoutMemberships.length > 0) {
    throw new Error(
      `No jurisdiction membership is registered for ${countriesWithoutMemberships.join(", ")}.`,
    );
  }

  const jurisdictionIds = new Set(
    memberships.map((membership) => membership.jurisdictionId),
  );
  const jurisdictions = fixtureJurisdictions.filter((jurisdiction) =>
    jurisdictionIds.has(requireId(jurisdiction.id, jurisdiction.code)),
  );
  if (jurisdictions.length !== jurisdictionIds.size) {
    throw new Error("Full-ingest jurisdiction graph is incomplete.");
  }

  const regulations = selectSignedPublishableRegulations(jurisdictionIds);
  const regulationIds = new Set(
    regulations.map((regulation) =>
      requireId(regulation.id, regulation.canonicalName),
    ),
  );
  const selectedLimits = limitRows.filter((limit) =>
    regulationIds.has(limit.regulationId),
  );
  const regulationIdsWithLimits = new Set(
    selectedLimits.map((limit) => limit.regulationId),
  );
  const regulationsWithoutLimits = [...regulationIds].filter(
    (regulationId) =>
      !regulationIdsWithLimits.has(regulationId) &&
      !acceptedLimitUnavailableRegulationIdSet.has(regulationId),
  );
  if (regulationsWithoutLimits.length > 0) {
    throw new Error(
      `Publishable regulations without limits are registered for full ingest: ${regulationsWithoutLimits.join(", ")}.`,
    );
  }

  const sourceIds = new Set<string>();
  for (const jurisdiction of jurisdictions) {
    sourceIds.add(jurisdiction.dataSourceId);
  }
  for (const membership of memberships) {
    sourceIds.add(membership.dataSourceId);
  }
  for (const regulation of regulations) {
    sourceIds.add(regulation.dataSourceId);
  }
  for (const limit of selectedLimits) {
    sourceIds.add(limit.dataSourceId);
  }

  return {
    jurisdictionIds,
    limitRows: selectedLimits,
    regulationIds,
    sourceIds,
  };
}
