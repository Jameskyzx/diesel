export const LEVANT_SOURCE_REFRESH_SIGNOFF_ISO =
  "2026-08-10T18:55:45.000Z";
export const CARIBBEAN_SOURCE_REFRESH_SIGNOFF_ISO =
  "2026-08-10T19:36:45.000Z";
export const AFRICA_SOURCE_REFRESH_SIGNOFF_ISO =
  "2026-08-10T19:46:12.000Z";
export const LATAM_SOURCE_REFRESH_SIGNOFF_ISO =
  "2026-08-10T20:09:01.000Z";
export const PRK_PSE_SDN_PRI_NCL_SOURCE_REFRESH_SIGNOFF_ISO =
  "2026-08-10T20:20:37.000Z";
export const ERI_GAB_GMB_GNB_GNQ_SOURCE_REFRESH_SIGNOFF_ISO =
  "2026-08-10T20:39:16.000Z";
export const MOZ_LSO_MDG_MUS_FJI_SOURCE_REFRESH_SIGNOFF_ISO =
  "2026-08-10T20:50:58.000Z";
export const CAF_COD_COG_GIN_DJI_SOURCE_REFRESH_SIGNOFF_ISO =
  "2026-08-10T21:00:43.000Z";
export const TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO =
  "2026-08-10T23:08:11.000Z";
export const CANADA_COMPLETENESS_SIGNOFF_ISO =
  "2026-08-11T05:21:45.000Z";
export const UNITED_STATES_COMPLETENESS_SIGNOFF_ISO =
  "2026-08-11T05:21:45.000Z";

const sourceRefreshSignoffByCountryIso3 = new Map<string, string>([
  ["CAN", CANADA_COMPLETENESS_SIGNOFF_ISO],
  ["USA", UNITED_STATES_COMPLETENESS_SIGNOFF_ISO],
  ...["IRN", "IRQ", "LBN", "SYR"].map(
    (countryIso3) =>
      [countryIso3, LEVANT_SOURCE_REFRESH_SIGNOFF_ISO] as const,
  ),
  ...["BLZ", "CUB", "GUY", "HTI", "JAM"].map(
    (countryIso3) =>
      [countryIso3, CARIBBEAN_SOURCE_REFRESH_SIGNOFF_ISO] as const,
  ),
  ...["LBR", "LBY", "MLI", "MRT", "NER"].map(
    (countryIso3) =>
      [countryIso3, AFRICA_SOURCE_REFRESH_SIGNOFF_ISO] as const,
  ),
  ...["GTM", "HND", "NIC", "PRY", "URY"].map(
    (countryIso3) =>
      [countryIso3, LATAM_SOURCE_REFRESH_SIGNOFF_ISO] as const,
  ),
  ...["PRK", "PSE", "SDN", "PRI", "NCL"].map(
    (countryIso3) =>
      [
        countryIso3,
        PRK_PSE_SDN_PRI_NCL_SOURCE_REFRESH_SIGNOFF_ISO,
      ] as const,
  ),
  ...["ERI", "GAB", "GMB", "GNB", "GNQ"].map(
    (countryIso3) =>
      [
        countryIso3,
        ERI_GAB_GMB_GNB_GNQ_SOURCE_REFRESH_SIGNOFF_ISO,
      ] as const,
  ),
  ...["MOZ", "LSO", "MDG", "MUS", "FJI"].map(
    (countryIso3) =>
      [
        countryIso3,
        MOZ_LSO_MDG_MUS_FJI_SOURCE_REFRESH_SIGNOFF_ISO,
      ] as const,
  ),
  ...["CAF", "COD", "COG", "GIN", "DJI"].map(
    (countryIso3) =>
      [
        countryIso3,
        CAF_COD_COG_GIN_DJI_SOURCE_REFRESH_SIGNOFF_ISO,
      ] as const,
  ),
  ...[
    "BRN",
    "BTN",
    "SLB",
    "TLS",
    "MWI",
    "SLE",
    "SOM",
    "SSD",
    "TCD",
    "SLV",
    "SUR",
    "TTO",
  ].map(
    (countryIso3) =>
      [
        countryIso3,
        TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO,
      ] as const,
  ),
]);

export function findSourceRefreshSignoffVerifiedAt(
  countryIso3: string,
): string | undefined {
  return sourceRefreshSignoffByCountryIso3.get(countryIso3);
}
