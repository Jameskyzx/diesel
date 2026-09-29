import type { ApplicationScope } from "@/features/database/schemas";
import type { JurisdictionType } from "@/features/countries/schemas";
import type { CertificationStatus } from "@/features/product-fit/schemas";
import { interpolate, type Dictionary } from "@/i18n/dictionaries";
import { formatCountryDisplayName } from "@/i18n/country-name";
import type { Locale } from "@/i18n/locale";

const applicationScopeKeys = {
  agriculture: "scopeAgriculture",
  construction: "scopeConstruction",
  "generator-set": "scopeGenerator",
  marine: "scopeMarine",
  "non-road": "scopeNonRoad",
  "on-road": "scopeOnRoad",
  "on-road-bus": "scopeBus",
  "on-road-truck": "scopeTruck",
} as const satisfies Record<ApplicationScope, keyof Dictionary["productFit"]>;

const jurisdictionTypeKeys = {
  country: "jurisdictionTypeCountry",
  international: "jurisdictionTypeInternational",
  regional: "jurisdictionTypeRegional",
} as const satisfies Record<JurisdictionType, keyof Dictionary["country"]>;

type CountryRegionCode =
  | "AFRICA"
  | "AMERICAS"
  | "ANTARCTICA"
  | "ASIA"
  | "EUROPE"
  | "OCEANIA";

const countryRegionKeys = {
  AFRICA: "regionAfrica",
  AMERICAS: "regionAmericas",
  ANTARCTICA: "regionAntarctica",
  ASIA: "regionAsia",
  EUROPE: "regionEurope",
  OCEANIA: "regionOceania",
} as const satisfies Record<CountryRegionCode, keyof Dictionary["country"]>;

type CountrySubregionCode =
  | "ANTARCTICA"
  | "AUSTRALIA_AND_NEW_ZEALAND"
  | "CARIBBEAN"
  | "CENTRAL_AMERICA"
  | "CENTRAL_ASIA"
  | "EASTERN_AFRICA"
  | "EASTERN_ASIA"
  | "EASTERN_EUROPE"
  | "MELANESIA"
  | "MIDDLE_AFRICA"
  | "NORTHERN_AFRICA"
  | "NORTHERN_AMERICA"
  | "NORTHERN_EUROPE"
  | "SEVEN_SEAS_OPEN_OCEAN"
  | "SOUTHERN_AFRICA"
  | "SOUTHERN_ASIA"
  | "SOUTHERN_EUROPE"
  | "SOUTH_AMERICA"
  | "SOUTH_EASTERN_ASIA"
  | "WESTERN_AFRICA"
  | "WESTERN_ASIA"
  | "WESTERN_EUROPE";

const countrySubregionKeys = {
  ANTARCTICA: "regionAntarctica",
  AUSTRALIA_AND_NEW_ZEALAND: "subregionAustraliaAndNewZealand",
  CARIBBEAN: "subregionCaribbean",
  CENTRAL_AMERICA: "subregionCentralAmerica",
  CENTRAL_ASIA: "subregionCentralAsia",
  EASTERN_AFRICA: "subregionEasternAfrica",
  EASTERN_ASIA: "subregionEasternAsia",
  EASTERN_EUROPE: "subregionEasternEurope",
  MELANESIA: "subregionMelanesia",
  MIDDLE_AFRICA: "subregionMiddleAfrica",
  NORTHERN_AFRICA: "subregionNorthernAfrica",
  NORTHERN_AMERICA: "subregionNorthernAmerica",
  NORTHERN_EUROPE: "subregionNorthernEurope",
  SEVEN_SEAS_OPEN_OCEAN: "subregionSevenSeasOpenOcean",
  SOUTHERN_AFRICA: "subregionSouthernAfrica",
  SOUTHERN_ASIA: "subregionSouthernAsia",
  SOUTHERN_EUROPE: "subregionSouthernEurope",
  SOUTH_AMERICA: "subregionSouthAmerica",
  SOUTH_EASTERN_ASIA: "subregionSouthEasternAsia",
  WESTERN_AFRICA: "subregionWesternAfrica",
  WESTERN_ASIA: "subregionWesternAsia",
  WESTERN_EUROPE: "subregionWesternEurope",
} as const satisfies Record<
  CountrySubregionCode,
  keyof Dictionary["country"]
>;

const certificationStatusKeys = {
  active: "certificationStatusActive",
  expired: "certificationStatusExpired",
  pending: "certificationStatusPending",
  unknown: "certificationStatusUnknown",
  withdrawn: "certificationStatusWithdrawn",
} as const satisfies Record<
  CertificationStatus,
  keyof Dictionary["productFit"]
>;

// Presentation-only allowlists mirror the deterministic public Demo fixture IDs
// and canonical copy. Requiring both makes fixture drift fail closed to raw text,
// while keeping the server seed module out of client bundles.
const demoProductFixtures = {
  "00000000-0000-4000-8000-000000000201": {
    dictionaryKey: "demoProductEngine100Name",
    modelCode: "DEMO-ENG-100",
    name: "DEMO ONLY — Fictional Engine 100",
    sourceId: "00000000-0000-4000-8000-000000000003",
    sourceTitle: "DEMO ONLY — Fictional product manual",
    specificationVersion: "demo-v1",
  },
  "00000000-0000-4000-8000-000000000202": {
    dictionaryKey: "demoProductEngine200Name",
    modelCode: "DEMO-ENG-200",
    name: "DEMO ONLY — Fictional Engine 200",
    sourceId: "00000000-0000-4000-8000-000000000003",
    sourceTitle: "DEMO ONLY — Fictional product manual",
    specificationVersion: "demo-v1",
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      dictionaryKey: keyof Dictionary["productFit"];
      modelCode: string;
      name: string;
      sourceId: string;
      sourceTitle: string;
      specificationVersion: string;
    }
  >
>;

const demoJurisdictionFixtures = {
  "00000000-0000-4000-8000-000000000101": {
    code: "DEMO-CHN-AUTHORITY",
    countryIso2: "CN",
    countryIso3: "CHN",
    countryNameEn: "China — demo fixture",
    name: "DEMO ONLY — Fictional China Emissions Authority",
    sourceId: "00000000-0000-4000-8000-000000000002",
    sourceTitle: "DEMO ONLY — Fictional emissions bulletin",
  },
  "00000000-0000-4000-8000-000000000102": {
    code: "DEMO-BRA-AUTHORITY",
    countryIso2: "BR",
    countryIso3: "BRA",
    countryNameEn: "Brazil — demo fixture",
    name: "DEMO ONLY — Fictional Brazil Emissions Authority",
    sourceId: "00000000-0000-4000-8000-000000000002",
    sourceTitle: "DEMO ONLY — Fictional emissions bulletin",
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      code: string;
      countryIso2: string;
      countryIso3: string;
      countryNameEn: string;
      name: string;
      sourceId: string;
      sourceTitle: string;
    }
  >
>;

const demoRegulationFixtures = {
  "00000000-0000-4000-8000-000000000201": {
    canonicalName: "DEMO ONLY — Fictional China Non-road Stage A",
    dictionaryKey: "demoRegulationChinaStageA",
  },
  "00000000-0000-4000-8000-000000000202": {
    canonicalName: "DEMO ONLY — Fictional China Non-road Stage B Proposal",
    dictionaryKey: "demoRegulationChinaStageBProposal",
  },
  "00000000-0000-4000-8000-000000000203": {
    canonicalName: "DEMO ONLY — Fictional China Non-road Stage Z",
    dictionaryKey: "demoRegulationChinaStageZ",
  },
  "00000000-0000-4000-8000-000000000204": {
    canonicalName: "DEMO ONLY — Fictional Brazil Non-road Stage A",
    dictionaryKey: "demoRegulationBrazilStageA",
  },
  "00000000-0000-4000-8000-000000000205": {
    canonicalName: "DEMO ONLY — Fictional China Non-road Stage C Adopted",
    dictionaryKey: "demoRegulationChinaStageCAdopted",
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      canonicalName: string;
      dictionaryKey: keyof Dictionary["country"];
    }
  >
>;

const demoMarketMetricIds = new Set([
  "00000000-0000-4000-8000-000000000701",
  "00000000-0000-4000-8000-000000000702",
]);
const demoMarketMetricCode = "DEMO_ADDRESSABLE_UNITS";
const demoMarketMetricName = "DEMO ONLY — Fictional addressable units";
const demoMarketMetricDefinition =
  "FICTIONAL DEMO DATA — NOT A REAL REGULATION, CERTIFICATION, OR MARKET SOURCE. Fictional annual addressable unit count.";

type MarketMetricDisplayIdentity = {
  isDemo: boolean;
  metricCode: string;
  metricIds: readonly string[];
  metricName: string;
};

function isKnownDemoMarketMetric(
  input: MarketMetricDisplayIdentity,
): boolean {
  return (
    input.isDemo &&
    input.metricCode === demoMarketMetricCode &&
    input.metricName === demoMarketMetricName &&
    input.metricIds.length > 0 &&
    input.metricIds.every((id) => demoMarketMetricIds.has(id))
  );
}

export function applicationScopeLabel(
  scope: string,
  dictionary: Dictionary,
): string {
  const key = applicationScopeKeys[scope as ApplicationScope];
  return key ? dictionary.productFit[key] : dictionary.common.notRecorded;
}

export function applicationScopeListLabel(
  scopes: readonly string[],
  dictionary: Dictionary,
  locale: Locale,
): string {
  return localizedList(
    scopes.map((scope) => applicationScopeLabel(scope, dictionary)),
    locale,
  );
}

export function localizedList(
  values: readonly string[],
  locale: Locale,
): string {
  return values.join(locale === "en" ? ", " : "、");
}

export function certificationStatusLabel(
  status: CertificationStatus,
  dictionary: Dictionary,
): string {
  return dictionary.productFit[certificationStatusKeys[status]];
}

export function jurisdictionTypeLabel(
  type: JurisdictionType,
  dictionary: Dictionary,
): string {
  return dictionary.country[jurisdictionTypeKeys[type]];
}

export function countryRegionLabel(
  code: string | null | undefined,
  dictionary: Dictionary,
): string {
  const key = code
    ? countryRegionKeys[code as CountryRegionCode]
    : undefined;
  return key ? dictionary.country[key] : dictionary.common.notRecorded;
}

export function countrySubregionLabel(
  code: string | null | undefined,
  dictionary: Dictionary,
): string {
  const key = code
    ? countrySubregionKeys[code as CountrySubregionCode]
    : undefined;
  return key ? dictionary.country[key] : dictionary.common.notRecorded;
}

export function jurisdictionDisplayName(
  input: {
    code: string;
    countryIso3: string;
    id: string;
    isDemo: boolean;
    name: string;
    sourceId: string;
    sourceIsDemo: boolean;
    sourceTitle: string;
    type: JurisdictionType;
  },
  dictionary: Dictionary,
  locale: Locale,
): string {
  if (locale === "en" || !input.isDemo || input.type !== "country") {
    return input.name;
  }

  const fixture = demoJurisdictionFixtures[
    input.id as keyof typeof demoJurisdictionFixtures
  ];
  if (
    !fixture ||
    !input.sourceIsDemo ||
    input.code !== fixture.code ||
    input.countryIso3 !== fixture.countryIso3 ||
    input.name !== fixture.name ||
    input.sourceId !== fixture.sourceId ||
    input.sourceTitle !== fixture.sourceTitle
  ) {
    return input.name;
  }

  const countryName = formatCountryDisplayName(
    {
      isDemo: input.isDemo,
      iso2: fixture.countryIso2,
      iso3: fixture.countryIso3,
      nameEn: fixture.countryNameEn,
    },
    locale,
  );
  return interpolate(dictionary.country.demoJurisdictionName, {
    country: countryName,
  });
}

export function productDisplayName(
  input: {
    id: string;
    isDemo: boolean;
    modelCode: string;
    name: string;
    source: {
      id: string;
      isDemo: boolean;
      title: string;
    };
    specificationVersion: string;
  },
  dictionary: Dictionary,
  locale: Locale,
): string {
  if (locale === "en" || !input.isDemo) {
    return input.name;
  }

  const fixture = demoProductFixtures[
    input.id as keyof typeof demoProductFixtures
  ];
  if (
    !fixture ||
    !input.source.isDemo ||
    input.modelCode !== fixture.modelCode ||
    input.name !== fixture.name ||
    input.source.id !== fixture.sourceId ||
    input.source.title !== fixture.sourceTitle ||
    input.specificationVersion !== fixture.specificationVersion
  ) {
    return input.name;
  }

  return dictionary.productFit[fixture.dictionaryKey];
}

export function marketMetricDisplayName(
  input: MarketMetricDisplayIdentity,
  dictionary: Dictionary,
  locale: Locale,
): string {
  if (locale === "en" || !isKnownDemoMarketMetric(input)) {
    return input.metricName;
  }

  return dictionary.country.demoMarketMetricName;
}

export function marketMetricDisplayDefinition(
  input: MarketMetricDisplayIdentity & { definition: string },
  dictionary: Dictionary,
  locale: Locale,
): string {
  if (
    locale === "en" ||
    !isKnownDemoMarketMetric(input) ||
    input.definition !== demoMarketMetricDefinition
  ) {
    return input.definition;
  }

  return dictionary.country.demoMarketMetricDefinition;
}

export function regulationDisplayName(
  input: {
    canonicalName: string;
    id: string;
    isDemo: boolean;
  },
  dictionary: Dictionary,
  locale: Locale,
): string {
  if (locale === "en" || !input.isDemo) {
    return input.canonicalName;
  }

  const fixture = demoRegulationFixtures[
    input.id as keyof typeof demoRegulationFixtures
  ];
  if (!fixture || fixture.canonicalName !== input.canonicalName) {
    return input.canonicalName;
  }

  return dictionary.country[fixture.dictionaryKey];
}

export function nameWithCode(
  name: string,
  code: string,
  locale: Locale,
): string {
  return locale === "en" ? `${name} (${code})` : `${name}（${code}）`;
}

export function countryApplicabilityMissingDataMessages(
  input: {
    countryIso3: string;
    countryName: string | null;
    currentEffectiveRegulationCount: number;
    futureAdoptedRegulationCount: number;
    hasMissingData: boolean;
  },
  dictionary: Dictionary,
): string[] {
  if (!input.hasMissingData) {
    return [];
  }

  const values = { iso3: input.countryIso3 };
  if (input.countryName === null) {
    return [interpolate(dictionary.country.applicabilityMissingCountry, values)];
  }
  if (
    input.currentEffectiveRegulationCount === 0 &&
    input.futureAdoptedRegulationCount === 0
  ) {
    return [
      interpolate(
        dictionary.country.applicabilityMissingRegulations,
        values,
      ),
    ];
  }
  return [
    interpolate(dictionary.country.applicabilityMissingEvidence, values),
  ];
}
