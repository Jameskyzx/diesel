type DemoSource = {
  isDemo: boolean;
};

type CountrySummaryClassification = {
  dataCoverageStatus: string;
  isDemo: boolean;
};

type CountryProfileClassification = CountrySummaryClassification & {
  source: DemoSource;
};

type JurisdictionClassification = {
  isDemo: boolean;
  membershipIsDemo: boolean;
  membershipSource: DemoSource;
  source: DemoSource;
};

type RegulationClassification = {
  applicability: {
    jurisdictionIsDemo: boolean;
    jurisdictionSourceIsDemo: boolean;
    membershipIsDemo: boolean;
    membershipSourceIsDemo: boolean;
  };
  isDemo: boolean;
  source: DemoSource;
};

type MarketMetricClassification = {
  isDemo: boolean;
  source: DemoSource;
};

export function isDemoCountrySummary(
  country: CountrySummaryClassification,
): boolean {
  return country.isDemo || country.dataCoverageStatus === "demo";
}

export function publicMapClassification(
  country: CountrySummaryClassification,
  includeDemoData: boolean,
): CountrySummaryClassification {
  if (includeDemoData || !isDemoCountrySummary(country)) {
    return country;
  }

  return {
    dataCoverageStatus: "no_data",
    isDemo: false,
  };
}

export function isDemoCountryProfile(
  country: CountryProfileClassification,
): boolean {
  return isDemoCountrySummary(country) || country.source.isDemo;
}

export function isDemoJurisdiction(
  jurisdiction: JurisdictionClassification,
): boolean {
  return (
    jurisdiction.isDemo ||
    jurisdiction.membershipIsDemo ||
    jurisdiction.source.isDemo ||
    jurisdiction.membershipSource.isDemo
  );
}

export function isDemoRegulation(
  regulation: RegulationClassification,
): boolean {
  return (
    regulation.isDemo ||
    regulation.source.isDemo ||
    regulation.applicability.jurisdictionIsDemo ||
    regulation.applicability.jurisdictionSourceIsDemo ||
    regulation.applicability.membershipIsDemo ||
    regulation.applicability.membershipSourceIsDemo
  );
}

export function isDemoMarketMetric(
  metric: MarketMetricClassification,
): boolean {
  return metric.isDemo || metric.source.isDemo;
}
