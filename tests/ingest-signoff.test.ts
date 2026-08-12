import { describe, expect, it } from "vitest";

import {
  AFRICA_SOURCE_REFRESH_SIGNOFF_ISO,
  CAF_COD_COG_GIN_DJI_SOURCE_REFRESH_SIGNOFF_ISO,
  CARIBBEAN_SOURCE_REFRESH_SIGNOFF_ISO,
  ERI_GAB_GMB_GNB_GNQ_SOURCE_REFRESH_SIGNOFF_ISO,
  findSourceRefreshSignoffVerifiedAt,
  LATAM_SOURCE_REFRESH_SIGNOFF_ISO,
  LEVANT_SOURCE_REFRESH_SIGNOFF_ISO,
  MOZ_LSO_MDG_MUS_FJI_SOURCE_REFRESH_SIGNOFF_ISO,
  PRK_PSE_SDN_PRI_NCL_SOURCE_REFRESH_SIGNOFF_ISO,
} from "../scripts/db/ingest-signoff";

describe("accepted fixture source-refresh signoff policy", () => {
  it.each(["IRN", "IRQ", "LBN", "SYR"])(
    "uses the latest source-refresh signoff for %s",
    (countryIso3) => {
      expect(findSourceRefreshSignoffVerifiedAt(countryIso3)).toBe(
        LEVANT_SOURCE_REFRESH_SIGNOFF_ISO,
      );
      expect(LEVANT_SOURCE_REFRESH_SIGNOFF_ISO).toBe(
        "2026-08-10T18:55:45.000Z",
      );
    },
  );

  it.each(["BLZ", "CUB", "GUY", "HTI", "JAM"])(
    "uses the Caribbean source-refresh signoff for %s",
    (countryIso3) => {
      expect(findSourceRefreshSignoffVerifiedAt(countryIso3)).toBe(
        CARIBBEAN_SOURCE_REFRESH_SIGNOFF_ISO,
      );
      expect(CARIBBEAN_SOURCE_REFRESH_SIGNOFF_ISO).toBe(
        "2026-08-10T19:36:45.000Z",
      );
    },
  );

  it.each(["LBR", "LBY", "MLI", "MRT", "NER"])(
    "uses the Africa source-refresh signoff for %s",
    (countryIso3) => {
      expect(findSourceRefreshSignoffVerifiedAt(countryIso3)).toBe(
        AFRICA_SOURCE_REFRESH_SIGNOFF_ISO,
      );
      expect(AFRICA_SOURCE_REFRESH_SIGNOFF_ISO).toBe(
        "2026-08-10T19:46:12.000Z",
      );
    },
  );

  it.each(["GTM", "HND", "NIC", "PRY", "URY"])(
    "uses the Latin America five-gate review signoff for %s",
    (countryIso3) => {
      expect(findSourceRefreshSignoffVerifiedAt(countryIso3)).toBe(
        LATAM_SOURCE_REFRESH_SIGNOFF_ISO,
      );
      expect(LATAM_SOURCE_REFRESH_SIGNOFF_ISO).toBe(
        "2026-08-10T20:09:01.000Z",
      );
    },
  );

  it.each(["PRK", "PSE", "SDN", "PRI", "NCL"])(
    "uses the PRK/PSE/SDN/PRI/NCL source-refresh signoff for %s",
    (countryIso3) => {
      expect(findSourceRefreshSignoffVerifiedAt(countryIso3)).toBe(
        PRK_PSE_SDN_PRI_NCL_SOURCE_REFRESH_SIGNOFF_ISO,
      );
      expect(PRK_PSE_SDN_PRI_NCL_SOURCE_REFRESH_SIGNOFF_ISO).toBe(
        "2026-08-10T20:20:37.000Z",
      );
    },
  );

  it.each(["ERI", "GAB", "GMB", "GNB", "GNQ"])(
    "uses the ERI/GAB/GMB/GNB/GNQ source-refresh signoff for %s",
    (countryIso3) => {
      expect(findSourceRefreshSignoffVerifiedAt(countryIso3)).toBe(
        ERI_GAB_GMB_GNB_GNQ_SOURCE_REFRESH_SIGNOFF_ISO,
      );
      expect(ERI_GAB_GMB_GNB_GNQ_SOURCE_REFRESH_SIGNOFF_ISO).toBe(
        "2026-08-10T20:39:16.000Z",
      );
    },
  );

  it.each(["MOZ", "LSO", "MDG", "MUS", "FJI"])(
    "uses the MOZ/LSO/MDG/MUS/FJI source-refresh signoff for %s",
    (countryIso3) => {
      expect(findSourceRefreshSignoffVerifiedAt(countryIso3)).toBe(
        MOZ_LSO_MDG_MUS_FJI_SOURCE_REFRESH_SIGNOFF_ISO,
      );
      expect(MOZ_LSO_MDG_MUS_FJI_SOURCE_REFRESH_SIGNOFF_ISO).toBe(
        "2026-08-10T20:50:58.000Z",
      );
    },
  );

  it.each(["CAF", "COD", "COG", "GIN", "DJI"])(
    "uses the CAF/COD/COG/GIN/DJI source-refresh signoff for %s",
    (countryIso3) => {
      expect(findSourceRefreshSignoffVerifiedAt(countryIso3)).toBe(
        CAF_COD_COG_GIN_DJI_SOURCE_REFRESH_SIGNOFF_ISO,
      );
      expect(CAF_COD_COG_GIN_DJI_SOURCE_REFRESH_SIGNOFF_ISO).toBe(
        "2026-08-10T21:00:43.000Z",
      );
    },
  );

  it("does not replace unrelated country signoff policies", () => {
    expect(findSourceRefreshSignoffVerifiedAt("YEM")).toBeUndefined();
    expect(findSourceRefreshSignoffVerifiedAt("KEN")).toBeUndefined();
  });
});
