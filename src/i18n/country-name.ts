import type { Locale } from "@/i18n/locale";

export type CountryDisplayNameInput = {
  isDemo: boolean;
  iso2?: string | null;
  iso3?: string | null;
  nameEn: string;
  nameLocal?: string | null;
  source?: {
    id: string;
    isDemo: boolean;
    title: string;
  } | null;
};

const trustedChineseLocalNameIso3s = new Set(["CHN"]);
const chineseDemoSuffix = "（演示数据）";
const demoCountrySource = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "DEMO ONLY — Fictional country metadata source",
} as const;
const demoCountryFixtures = {
  BRA: {
    iso2: "BR",
    iso3: "BRA",
    nameEn: "Brazil — demo fixture",
    nameZh: `巴西${chineseDemoSuffix}`,
  },
  CHN: {
    iso2: "CN",
    iso3: "CHN",
    nameEn: "China — demo fixture",
    nameZh: `中国${chineseDemoSuffix}`,
  },
  DEU: {
    iso2: "DE",
    iso3: "DEU",
    nameEn: "Germany — demo fixture",
    nameZh: `德国${chineseDemoSuffix}`,
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      iso2: string;
      iso3: string;
      nameEn: string;
      nameZh: string;
    }
  >
>;
const chineseRegionNameOverrides: Readonly<Record<string, string>> = {
  // Node and supported browsers ship different ICU aliases for these regions. Pin a
  // shared label so server and client hydration remain byte-for-byte stable.
  CN: "中国",
  FK: "福克兰群岛",
  PS: "巴勒斯坦",
};

function createChineseRegionNames(): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(["zh-CN"], {
      fallback: "code",
      type: "region",
    });
  } catch {
    return null;
  }
}

const chineseRegionNames = createChineseRegionNames();

function trustedLocalName({
  iso2,
  iso3,
  nameEn,
  nameLocal,
}: CountryDisplayNameInput): string | null {
  const candidate = nameLocal?.trim();
  const normalizedIso3 = iso3?.trim().toUpperCase();
  if (
    !candidate ||
    !normalizedIso3 ||
    !trustedChineseLocalNameIso3s.has(normalizedIso3)
  ) {
    return null;
  }

  const normalizedCandidate = candidate.toLocaleUpperCase("en-US");
  const placeholders = [iso2, iso3, nameEn]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toLocaleUpperCase("en-US"));

  return placeholders.includes(normalizedCandidate) ? null : candidate;
}

function demoCountryFixture(
  country: CountryDisplayNameInput,
): (typeof demoCountryFixtures)[keyof typeof demoCountryFixtures] | null {
  const fixture = demoCountryFixtures[
    country.iso3 as keyof typeof demoCountryFixtures
  ];
  if (
    !fixture ||
    country.iso2 !== fixture.iso2 ||
    country.iso3 !== fixture.iso3 ||
    country.nameEn !== fixture.nameEn
  ) {
    return null;
  }

  return fixture;
}

function knownDemoCountryName(
  country: CountryDisplayNameInput,
): string | null {
  if (!country.isDemo) {
    return null;
  }

  const fixture = demoCountryFixture(country);
  if (!fixture) {
    return null;
  }

  if (
    country.source !== undefined &&
    country.source !== null &&
    (!country.source.isDemo ||
      country.source.id !== demoCountrySource.id ||
      country.source.title !== demoCountrySource.title)
  ) {
    return null;
  }

  return fixture.nameZh;
}

function chineseRegionName(iso2: string | null | undefined): string | null {
  const normalizedIso2 = iso2?.trim().toUpperCase();
  if (!normalizedIso2 || !/^[A-Z]{2}$/.test(normalizedIso2)) {
    return null;
  }

  const overridden = chineseRegionNameOverrides[normalizedIso2];
  if (overridden) {
    return overridden;
  }

  const displayName = chineseRegionNames?.of(normalizedIso2);
  return displayName && displayName !== normalizedIso2 ? displayName : null;
}

/** Returns presentation-only country copy without mutating canonical names. */
export function formatCountryDisplayName(
  country: CountryDisplayNameInput,
  locale: Locale,
): string {
  if (locale === "en") {
    return country.nameEn;
  }

  if (country.isDemo) {
    return knownDemoCountryName(country) ?? country.nameEn;
  }

  // A canonical Demo identity with a real-data classification is inconsistent.
  // Preserve the raw name rather than laundering it into ordinary country copy.
  if (demoCountryFixture(country)) {
    return country.nameEn;
  }

  const trusted = trustedLocalName(country);
  if (trusted) {
    return trusted;
  }

  const regionName = chineseRegionName(country.iso2);
  if (!regionName) {
    return country.nameEn;
  }

  return regionName;
}
