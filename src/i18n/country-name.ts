import type { Locale } from "@/i18n/locale";

export type CountryDisplayNameInput = {
  iso2?: string | null;
  iso3?: string | null;
  nameEn: string;
  nameLocal?: string | null;
};

const trustedChineseLocalNameIso3s = new Set(["CHN"]);
const chineseDemoSuffix = "（演示数据）";
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

function hasDemoFixtureSuffix(nameEn: string): boolean {
  return /\s+—\s+demo fixture$/iu.test(nameEn.trim());
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

  const trusted = trustedLocalName(country);
  if (trusted) {
    return trusted;
  }

  const regionName = chineseRegionName(country.iso2);
  if (!regionName) {
    return country.nameEn;
  }

  return hasDemoFixtureSuffix(country.nameEn)
    ? `${regionName}${chineseDemoSuffix}`
    : regionName;
}
