/**
 * M3 首批真实事实入库（ADR-015/042，docs/ACCEPTANCE.md 总签核）。
 *
 * 流程（全部经后台治理 Draft → Reviewed → Published，ADR-043）：
 * 1. 数据来源发布。
 * 2. 辖区（jurisdiction 实体，含国家成员关系 memberships）发布。
 * 3. 法规（含限值）与国家覆盖状态发布（editor 与 reviewer 分设，
 *    遵守非自审规则），产生审计日志。
 * 4. 发布后对目标库运行验收查询（与 tests/acceptance-fixtures.test.ts
 *    同一组断言），打印 PASS/FAIL；任一失败以非零码退出。
 *
 * 范围：由 `ingestedCountryMemberships`、`ingestedRegulationIds` 与
 * `ingestedSourceIds` 三组已签核清单共同决定；运行前会从国家图派生闭包并校验
 * 法域、法规与必需来源，避免注释枚举或单一 allowlist 漂移。
 * MEX 工程/农业非道路 scope 保持 no-data；TUR 农业拖拉机因官方 NRE 文书明确排除而保持 no-data；
 * AUS 工程/农业非道路 scope 依据 DCCEEW 官方评估保持 no-data；
 * EU 官方列表的 27 国均已进入国家目录；MLT 使用同一固定 Natural Earth 修订的
 * 1:10m 原始 feature，并复用直接适用的 EU 法规。其余成员同样以官方成员国页面
 * 证明辖区关系。土库曼斯坦
 * (`TKM`) 仅登记司法部来源与 no-data 边界。未来 Euro 7
 * 与美国提案文书不在本批。可重复运行（草稿按实体升版，发布为幂等 upsert）。
 *
 * 用法：pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts
 * 定向发布单一国家：在命令末尾追加 --country=NGA；该模式只发布目标国家引用的
 * 来源、辖区成员关系、可用法规、限值和覆盖状态，并运行聚焦验收。没有可发布法规
 * 的国家也可定向发布来源边界，验收会确认四个 scope 继续返回 no-data。
 * 仅重发市场事实：在命令末尾追加 --market-only；该模式只验收市场来源和 24 条
 * 观测，不因未重发的法规覆盖检查失败。
 */
import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  acceptedLimitUnavailableRegulationIds,
  acceptanceFixtureIds,
  buildFixtureLimits,
  euMemberCountryIso3,
  fixtureJurisdictions,
  fixtureRegulations,
  fixtureSources,
} from "../../src/server/db/seed/acceptance-fixtures";
import {
  acceptedMarketFixtureIds,
  fixtureMarketMetrics,
  fixtureMarketSources,
} from "../../src/server/db/seed/accepted-market-fixtures";
import { countryCatalog } from "../../src/server/db/seed/country-catalog";
import * as schema from "../../src/server/db/schema";
import { getDatabaseUrl } from "../../src/server/db/environment";
import { createGovernanceRepository } from "../../src/server/repositories/governance-repository";
import { createRegulationRepository } from "../../src/server/repositories/regulation-repository";
import { createCountryRepository } from "../../src/server/repositories/country-repository";
import {
  parseIngestOptions,
  selectMarketFixturesForIngestion,
} from "./ingest-options";
import {
  CAF_COD_COG_GIN_DJI_SOURCE_REFRESH_SIGNOFF_ISO,
  CANADA_COMPLETENESS_SIGNOFF_ISO,
  findSourceRefreshSignoffVerifiedAt,
  LATAM_SOURCE_REFRESH_SIGNOFF_ISO,
  MOZ_LSO_MDG_MUS_FJI_SOURCE_REFRESH_SIGNOFF_ISO,
  PRK_PSE_SDN_PRI_NCL_SOURCE_REFRESH_SIGNOFF_ISO,
  TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO,
  UNITED_STATES_COMPLETENESS_SIGNOFF_ISO,
} from "./ingest-signoff";
import {
  buildFullIngestSelection,
  buildTargetSelection,
  selectJurisdictionMembershipsForIngest,
  signedPublishableRegulationIds,
} from "./fixture-target-selection";

const editor = {
  email: "m3-ingest-editor@automation.local",
  role: "editor" as const,
};
const reviewer = {
  email: "m3-ingest-reviewer@automation.local",
  role: "reviewer" as const,
};
const marketReadbackReason =
  "M3 official market facts: 2022/2023 registration tables and deterministic YoY, signed off in docs/ACCEPTANCE.md (ADR-020).";
const ingestOptions = parseIngestOptions(
  process.argv.slice(2),
);
const { countryIso3: targetCountryIso3, marketOnly } = ingestOptions;
const signoffReason =
  "M3 regulation coverage: facts signed off in docs/ACCEPTANCE.md (ADR-015/042).";
const acceptedLimitUnavailableRegulationIdSet = new Set<string>(
  acceptedLimitUnavailableRegulationIds,
);
const retiredRegulationIdsByCountry = new Map<string, readonly string[]>([
  ["DZA", [acceptanceFixtureIds.regulation.algeriaVehicleEmissions2003]],
  ["ETH", [acceptanceFixtureIds.regulation.ethiopiaVehicleEmission2025]],
  ["NGA", [acceptanceFixtureIds.regulation.nigeriaVehicularEmissions2011]],
]);

const SIGNOFF_ISO = "2026-07-30T00:00:00.000Z";
const AFRICA_DEEP_REVIEW_SIGNOFF_ISO = "2026-08-10T17:13:30.000Z";
const GULF_DEEP_REVIEW_SIGNOFF_ISO = "2026-08-10T18:48:04.000Z";
const MAR_KEN_SOURCE_REFRESH_SIGNOFF_ISO = "2026-08-10T18:48:04.000Z";
const CHINA_NONROAD_COMPLETENESS_SIGNOFF_ISO = "2026-08-11T04:38:07.000Z";
const EU_MEMBERSHIP_SIGNOFF_ISO = "2026-08-11T04:27:59.000Z";
const JAPAN_SIGNOFF_ISO = "2026-08-06T02:41:52.000Z";
const KOREA_SIGNOFF_ISO = "2026-08-06T04:57:42.000Z";
const MEXICO_SIGNOFF_ISO = "2026-08-06T06:00:00.000Z";
const TURKEY_SIGNOFF_ISO = "2026-08-06T07:30:00.000Z";
const AUSTRALIA_SIGNOFF_ISO = "2026-08-10T23:00:23.000Z";
const UNITED_KINGDOM_SIGNOFF_ISO = "2026-08-07T02:00:00.000Z";
const INDIA_SIGNOFF_ISO = "2026-08-07T03:30:00.000Z";
const RUSSIA_SIGNOFF_ISO = "2026-08-07T05:50:00.000Z";
const INDONESIA_SIGNOFF_ISO = "2026-08-07T07:30:00.000Z";
const THAILAND_SIGNOFF_ISO = "2026-08-10T13:09:56.000Z";
const VIETNAM_SIGNOFF_ISO = "2026-08-07T10:15:00.000Z";
const MALAYSIA_SIGNOFF_ISO = "2026-08-07T11:00:00.000Z";
const SAUDI_ARABIA_SIGNOFF_ISO = "2026-08-10T16:12:30.000Z";
const UNITED_ARAB_EMIRATES_SIGNOFF_ISO = "2026-08-10T16:09:15.000Z";
const SOUTH_AFRICA_SIGNOFF_ISO = "2026-08-10T16:04:06.000Z";
const ARGENTINA_SIGNOFF_ISO = "2026-08-07T16:00:00.000Z";
const NEW_ZEALAND_SIGNOFF_ISO = "2026-08-07T17:00:00.000Z";
const CHILE_SIGNOFF_ISO = "2026-08-07T18:00:00.000Z";
const COLOMBIA_SIGNOFF_ISO = "2026-08-07T19:00:00.000Z";
const PERU_SIGNOFF_ISO = "2026-08-08T00:00:00.000Z";
const PHILIPPINES_SIGNOFF_ISO = "2026-08-10T16:26:05.000Z";
const SINGAPORE_SIGNOFF_ISO = "2026-08-08T02:00:00.000Z";
const NORWAY_SIGNOFF_ISO = "2026-08-08T03:00:00.000Z";
const ICELAND_SIGNOFF_ISO = "2026-08-08T03:55:43.000Z";
const LIECHTENSTEIN_SIGNOFF_ISO = "2026-08-08T05:30:00.000Z";
const SWITZERLAND_SIGNOFF_ISO = "2026-08-08T06:30:00.000Z";
const CENTRAL_ASIA_SIGNOFF_ISO = "2026-08-10T13:40:00.000Z";
const CAUCASUS_SIGNOFF_ISO = "2026-08-10T14:20:51.000Z";
const FINAL_COUNTRY_BATCH_SIGNOFF_ISO = "2026-08-10T14:35:00.000Z";
const AFRICA_FIVE_GATE_REVIEW_SIGNOFF_ISO = "2026-08-10T17:12:15.000Z";
const ASIA_FIVE_GATE_REVIEW_SIGNOFF_ISO = "2026-08-10T17:38:18.000Z";
const DIRECTORY_SOURCE_ID = "00000000-0000-4000-8000-000000000006";
const euMemberCountrySet = new Set(euMemberCountryIso3);
const japanCountrySet = new Set(["JPN"]);
const koreaCountrySet = new Set(["KOR"]);
const mexicoCountrySet = new Set(["MEX"]);
const turkeyCountrySet = new Set(["TUR"]);
const australiaCountrySet = new Set(["AUS"]);
const canadaCountrySet = new Set(["CAN"]);
const unitedKingdomCountrySet = new Set(["GBR"]);
const indiaCountrySet = new Set(["IND"]);
const russiaCountrySet = new Set(["RUS"]);
const indonesiaCountrySet = new Set(["IDN"]);
const thailandCountrySet = new Set(["THA"]);
const vietnamCountrySet = new Set(["VNM"]);
const malaysiaCountrySet = new Set(["MYS"]);
const saudiArabiaCountrySet = new Set(["SAU"]);
const unitedArabEmiratesCountrySet = new Set(["ARE"]);
const southAfricaCountrySet = new Set(["ZAF"]);
const argentinaCountrySet = new Set(["ARG"]);
const newZealandCountrySet = new Set(["NZL"]);
const chileCountrySet = new Set(["CHL"]);
const colombiaCountrySet = new Set(["COL"]);
const peruCountrySet = new Set(["PER"]);
const philippinesCountrySet = new Set(["PHL"]);
const singaporeCountrySet = new Set(["SGP"]);
const norwayCountrySet = new Set(["NOR"]);
const icelandCountrySet = new Set(["ISL"]);
const liechtensteinCountrySet = new Set(["LIE"]);
const switzerlandCountrySet = new Set(["CHE"]);
const serbiaCountrySet = new Set(["SRB"]);
const bosniaCountrySet = new Set(["BIH"]);
const northMacedoniaCountrySet = new Set(["MKD"]);
const montenegroCountrySet = new Set(["MNE"]);
const albaniaCountrySet = new Set(["ALB"]);
const ukraineCountrySet = new Set(["UKR"]);
const moldovaCountrySet = new Set(["MDA"]);
const nepalCountrySet = new Set(["NPL"]);
const armeniaCountrySet = new Set(["ARM"]);
const azerbaijanCountrySet = new Set(["AZE"]);
const georgiaCountrySet = new Set(["GEO"]);
const uzbekistanCountrySet = new Set(["UZB"]);
const kazakhstanCountrySet = new Set(["KAZ"]);
const tajikistanCountrySet = new Set(["TJK"]);
const kyrgyzstanCountrySet = new Set(["KGZ"]);
const turkmenistanCountrySet = new Set(["TKM"]);
const afghanistanCountrySet = new Set(["AFG"]);
const angolaCountrySet = new Set(["AGO"]);
const burundiCountrySet = new Set(["BDI"]);
const beninCountrySet = new Set(["BEN"]);
const burkinaFasoCountrySet = new Set(["BFA"]);
const bangladeshCountrySet = new Set(["BGD"]);
const bahamasCountrySet = new Set(["BHS"]);
const belarusCountrySet = new Set(["BLR"]);
const boliviaCountrySet = new Set(["BOL"]);
const moroccoCountrySet = new Set(["MAR"]);
const kenyaCountrySet = new Set(["KEN"]);
const nigeriaCountrySet = new Set(["NGA"]);
const egyptCountrySet = new Set(["EGY"]);
const ghanaCountrySet = new Set(["GHA"]);
const israelCountrySet = new Set(["ISR"]);
const pakistanCountrySet = new Set(["PAK"]);
const qatarCountrySet = new Set(["QAT"]);
const kuwaitCountrySet = new Set(["KWT"]);
const omanCountrySet = new Set(["OMN"]);
const jordanCountrySet = new Set(["JOR"]);
const cambodiaCountrySet = new Set(["KHM"]);
const laosCountrySet = new Set(["LAO"]);
const sriLankaCountrySet = new Set(["LKA"]);
const mongoliaCountrySet = new Set(["MNG"]);
const costaRicaCountrySet = new Set(["CRI"]);
const ecuadorCountrySet = new Set(["ECU"]);
const dominicanRepublicCountrySet = new Set(["DOM"]);
const algeriaCountrySet = new Set(["DZA"]);
const tunisiaCountrySet = new Set(["TUN"]);
const ethiopiaCountrySet = new Set(["ETH"]);
const guatemalaCountrySet = new Set(["GTM"]);
const hondurasCountrySet = new Set(["HND"]);
const panamaCountrySet = new Set(["PAN"]);
const uruguayCountrySet = new Set(["URY"]);
const botswanaCountrySet = new Set(["BWA"]);
const namibiaCountrySet = new Set(["NAM"]);
const tanzaniaCountrySet = new Set(["TZA"]);
const ugandaCountrySet = new Set(["UGA"]);
const zambiaCountrySet = new Set(["ZMB"]);
const zimbabweCountrySet = new Set(["ZWE"]);
const rwandaCountrySet = new Set(["RWA"]);
const coteDIvoireCountrySet = new Set(["CIV"]);
const cameroonCountrySet = new Set(["CMR"]);
const senegalCountrySet = new Set(["SEN"]);
const africaFiveGateReviewCountrySet = new Set([
  "DZA",
  "TUN",
  "ETH",
  "CMR",
  "SEN",
]);
const mozambiqueCountrySet = new Set(["MOZ"]);
const eswatiniCountrySet = new Set(["SWZ"]);
const lesothoCountrySet = new Set(["LSO"]);
const madagascarCountrySet = new Set(["MDG"]);
const mauritiusCountrySet = new Set(["MUS"]);
const malawiCountrySet = new Set(["MWI"]);
const fijiCountrySet = new Set(["FJI"]);
const belizeCountrySet = new Set(["BLZ"]);
const bruneiCountrySet = new Set(["BRN"]);
const bhutanCountrySet = new Set(["BTN"]);
const centralAfricanRepublicCountrySet = new Set(["CAF"]);
const democraticRepublicOfCongoCountrySet = new Set(["COD"]);
const republicOfCongoCountrySet = new Set(["COG"]);
const cubaCountrySet = new Set(["CUB"]);
const djiboutiCountrySet = new Set(["DJI"]);
const guineaCountrySet = new Set(["GIN"]);
const greenlandCountrySet = new Set(["GRL"]);
const guyanaCountrySet = new Set(["GUY"]);
const haitiCountrySet = new Set(["HTI"]);
const iranCountrySet = new Set(["IRN"]);
const iraqCountrySet = new Set(["IRQ"]);
const jamaicaCountrySet = new Set(["JAM"]);
const lebanonCountrySet = new Set(["LBN"]);
const liberiaCountrySet = new Set(["LBR"]);
const libyaCountrySet = new Set(["LBY"]);
const maliCountrySet = new Set(["MLI"]);
const myanmarCountrySet = new Set(["MMR"]);
const mauritaniaCountrySet = new Set(["MRT"]);
const newCaledoniaCountrySet = new Set(["NCL"]);
const nigerCountrySet = new Set(["NER"]);
const nicaraguaCountrySet = new Set(["NIC"]);
const papuaNewGuineaCountrySet = new Set(["PNG"]);
const puertoRicoCountrySet = new Set(["PRI"]);
const northKoreaCountrySet = new Set(["PRK"]);
const paraguayCountrySet = new Set(["PRY"]);
const latinAmericaFiveGateSourceIdsByCountryIso3 = new Map<
  string,
  ReadonlySet<string>
>([
  [
    "GTM",
    new Set([
      acceptanceFixtureIds.source.guatemalaEnvironment,
      acceptanceFixtureIds.source.guatemalaTransport,
    ]),
  ],
  [
    "HND",
    new Set([
      acceptanceFixtureIds.source.hondurasEnvironment,
      acceptanceFixtureIds.source.hondurasTransport,
    ]),
  ],
  [
    "NIC",
    new Set([
      acceptanceFixtureIds.source.nicaraguaEnvironment,
      acceptanceFixtureIds.source.nicaraguaTransport,
    ]),
  ],
  [
    "PRY",
    new Set([
      acceptanceFixtureIds.source.paraguayEnvironment,
      acceptanceFixtureIds.source.paraguayTransport,
    ]),
  ],
  [
    "URY",
    new Set([
      acceptanceFixtureIds.source.uruguayEnvironment,
      acceptanceFixtureIds.source.uruguayTransport,
    ]),
  ],
]);
const palestineCountrySet = new Set(["PSE"]);
const sudanCountrySet = new Set(["SDN"]);
const solomonIslandsCountrySet = new Set(["SLB"]);
const sierraLeoneCountrySet = new Set(["SLE"]);
const elSalvadorCountrySet = new Set(["SLV"]);
const somaliaCountrySet = new Set(["SOM"]);
const southSudanCountrySet = new Set(["SSD"]);
const surinameCountrySet = new Set(["SUR"]);
const syriaCountrySet = new Set(["SYR"]);
const chadCountrySet = new Set(["TCD"]);
const togoCountrySet = new Set(["TGO"]);
const timorLesteCountrySet = new Set(["TLS"]);
const trinidadTobagoCountrySet = new Set(["TTO"]);
const taiwanCountrySet = new Set(["TWN"]);
const venezuelaCountrySet = new Set(["VEN"]);
const vanuatuCountrySet = new Set(["VUT"]);
const yemenCountrySet = new Set(["YEM"]);
const specialBoundaryCountrySet = new Set(["ATA", "ATF", "ESH", "FLK"]);
const explicitlyCoveredCountryIso3 = [
  "BRA",
  "CHN",
  "JPN",
  "KOR",
  "MEX",
  "TUR",
  "AUS",
  "CAN",
  "GBR",
  "IND",
  "RUS",
  "IDN",
  "THA",
  "VNM",
  "MYS",
  "SAU",
  "ARE",
  "ZAF",
  "ARG",
  "NZL",
  "CHL",
  "COL",
  "PER",
  "PHL",
  "SGP",
  "NOR",
  "ISL",
  "LIE",
  "CHE",
  "SRB",
  "BIH",
  "MKD",
  "MNE",
  "ALB",
  "UKR",
  "MDA",
  "NPL",
  "ARM",
  "BLR",
  "AZE",
  "GEO",
  "UZB",
  "KAZ",
  "TJK",
  "KGZ",
  "USA",
  "MAR",
  "KEN",
  "NGA",
  "EGY",
  "GHA",
  "ISR",
  "PAK",
  "QAT",
  "KWT",
  "OMN",
  "JOR",
  "KHM",
  "LAO",
  "LKA",
  "MNG",
  "CRI",
  "ECU",
  "DOM",
  "DZA",
  "TUN",
  "ETH",
  "GTM",
  "HND",
  "PAN",
  "URY",
  "TGO",
  "TLS",
  "TTO",
  "TWN",
  "VEN",
  "VUT",
  "YEM",
  "ATA",
  "ATF",
  "ESH",
  "FLK",
  ...euMemberCountryIso3,
];

function countrySignoffVerifiedAt(iso3: string): string {
  const sourceRefreshSignoff = findSourceRefreshSignoffVerifiedAt(iso3);
  if (sourceRefreshSignoff) {
    return sourceRefreshSignoff;
  }
  if (iso3 === "CHN") {
    return CHINA_NONROAD_COMPLETENESS_SIGNOFF_ISO;
  }
  if (euMemberCountrySet.has(iso3)) {
    return EU_MEMBERSHIP_SIGNOFF_ISO;
  }
  if (japanCountrySet.has(iso3)) {
    return JAPAN_SIGNOFF_ISO;
  }
  if (koreaCountrySet.has(iso3)) {
    return KOREA_SIGNOFF_ISO;
  }
  if (mexicoCountrySet.has(iso3)) {
    return MEXICO_SIGNOFF_ISO;
  }
  if (turkeyCountrySet.has(iso3)) {
    return TURKEY_SIGNOFF_ISO;
  }
  if (australiaCountrySet.has(iso3)) {
    return AUSTRALIA_SIGNOFF_ISO;
  }
  if (canadaCountrySet.has(iso3)) {
    return CANADA_COMPLETENESS_SIGNOFF_ISO;
  }
  if (unitedKingdomCountrySet.has(iso3)) {
    return UNITED_KINGDOM_SIGNOFF_ISO;
  }
  if (indiaCountrySet.has(iso3)) {
    return INDIA_SIGNOFF_ISO;
  }
  if (russiaCountrySet.has(iso3)) {
    return RUSSIA_SIGNOFF_ISO;
  }
  if (indonesiaCountrySet.has(iso3)) {
    return INDONESIA_SIGNOFF_ISO;
  }
  if (thailandCountrySet.has(iso3)) {
    return THAILAND_SIGNOFF_ISO;
  }
  if (vietnamCountrySet.has(iso3)) {
    return VIETNAM_SIGNOFF_ISO;
  }
  if (malaysiaCountrySet.has(iso3)) {
    return MALAYSIA_SIGNOFF_ISO;
  }
  if (saudiArabiaCountrySet.has(iso3)) {
    return SAUDI_ARABIA_SIGNOFF_ISO;
  }
  if (unitedArabEmiratesCountrySet.has(iso3)) {
    return UNITED_ARAB_EMIRATES_SIGNOFF_ISO;
  }
  if (southAfricaCountrySet.has(iso3)) {
    return SOUTH_AFRICA_SIGNOFF_ISO;
  }
  if (argentinaCountrySet.has(iso3)) {
    return ARGENTINA_SIGNOFF_ISO;
  }
  if (newZealandCountrySet.has(iso3)) {
    return NEW_ZEALAND_SIGNOFF_ISO;
  }
  if (chileCountrySet.has(iso3)) {
    return CHILE_SIGNOFF_ISO;
  }
  if (colombiaCountrySet.has(iso3)) {
    return COLOMBIA_SIGNOFF_ISO;
  }
  if (peruCountrySet.has(iso3)) {
    return PERU_SIGNOFF_ISO;
  }
  if (philippinesCountrySet.has(iso3)) {
    return PHILIPPINES_SIGNOFF_ISO;
  }
  if (singaporeCountrySet.has(iso3)) {
    return SINGAPORE_SIGNOFF_ISO;
  }
  if (norwayCountrySet.has(iso3)) {
    return NORWAY_SIGNOFF_ISO;
  }
  if (icelandCountrySet.has(iso3)) {
    return ICELAND_SIGNOFF_ISO;
  }
  if (liechtensteinCountrySet.has(iso3)) {
    return LIECHTENSTEIN_SIGNOFF_ISO;
  }
  if (switzerlandCountrySet.has(iso3)) {
    return SWITZERLAND_SIGNOFF_ISO;
  }
  if (serbiaCountrySet.has(iso3)) {
    return "2026-08-10T13:09:56.000Z";
  }
  if (bosniaCountrySet.has(iso3)) {
    return "2026-08-10T13:09:56.000Z";
  }
  if (northMacedoniaCountrySet.has(iso3)) {
    return "2026-08-10T13:17:36.000Z";
  }
  if (montenegroCountrySet.has(iso3)) {
    return "2026-08-10T13:17:36.000Z";
  }
  if (albaniaCountrySet.has(iso3)) {
    return "2026-08-10T13:09:56.000Z";
  }
  if (ukraineCountrySet.has(iso3)) {
    return "2026-08-10T12:59:02.000Z";
  }
  if (moldovaCountrySet.has(iso3)) {
    return "2026-08-10T13:04:28.000Z";
  }
  if (nepalCountrySet.has(iso3)) {
    return "2026-08-10T13:22:24.000Z";
  }
  if (armeniaCountrySet.has(iso3)) {
    return CAUCASUS_SIGNOFF_ISO;
  }
  if (azerbaijanCountrySet.has(iso3)) {
    return CAUCASUS_SIGNOFF_ISO;
  }
  if (georgiaCountrySet.has(iso3)) {
    return CAUCASUS_SIGNOFF_ISO;
  }
  if (uzbekistanCountrySet.has(iso3)) {
    return CENTRAL_ASIA_SIGNOFF_ISO;
  }
  if (kazakhstanCountrySet.has(iso3)) {
    return CENTRAL_ASIA_SIGNOFF_ISO;
  }
  if (tajikistanCountrySet.has(iso3)) {
    return CENTRAL_ASIA_SIGNOFF_ISO;
  }
  if (kyrgyzstanCountrySet.has(iso3)) {
    return CENTRAL_ASIA_SIGNOFF_ISO;
  }
  if (turkmenistanCountrySet.has(iso3)) {
    return CENTRAL_ASIA_SIGNOFF_ISO;
  }
  if (belarusCountrySet.has(iso3)) {
    return CAUCASUS_SIGNOFF_ISO;
  }
  if (afghanistanCountrySet.has(iso3)) {
    return FINAL_COUNTRY_BATCH_SIGNOFF_ISO;
  }
  if (angolaCountrySet.has(iso3)) {
    return FINAL_COUNTRY_BATCH_SIGNOFF_ISO;
  }
  if (burundiCountrySet.has(iso3)) {
    return FINAL_COUNTRY_BATCH_SIGNOFF_ISO;
  }
  if (beninCountrySet.has(iso3)) {
    return FINAL_COUNTRY_BATCH_SIGNOFF_ISO;
  }
  if (burkinaFasoCountrySet.has(iso3)) {
    return FINAL_COUNTRY_BATCH_SIGNOFF_ISO;
  }
  if (bangladeshCountrySet.has(iso3)) {
    return FINAL_COUNTRY_BATCH_SIGNOFF_ISO;
  }
  if (bahamasCountrySet.has(iso3)) {
    return FINAL_COUNTRY_BATCH_SIGNOFF_ISO;
  }
  if (boliviaCountrySet.has(iso3)) {
    return FINAL_COUNTRY_BATCH_SIGNOFF_ISO;
  }
  if (moroccoCountrySet.has(iso3)) {
    return MAR_KEN_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (kenyaCountrySet.has(iso3)) {
    return MAR_KEN_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (nigeriaCountrySet.has(iso3)) {
    return AFRICA_DEEP_REVIEW_SIGNOFF_ISO;
  }
  if (egyptCountrySet.has(iso3)) {
    return "2026-08-10T16:36:28.000Z";
  }
  if (ghanaCountrySet.has(iso3)) {
    return "2026-08-10T16:36:28.000Z";
  }
  if (israelCountrySet.has(iso3)) {
    return "2026-08-10T16:40:00.000Z";
  }
  if (pakistanCountrySet.has(iso3)) {
    return "2026-08-10T16:28:30.000Z";
  }
  if (qatarCountrySet.has(iso3)) {
    return GULF_DEEP_REVIEW_SIGNOFF_ISO;
  }
  if (kuwaitCountrySet.has(iso3)) {
    return GULF_DEEP_REVIEW_SIGNOFF_ISO;
  }
  if (omanCountrySet.has(iso3)) {
    return GULF_DEEP_REVIEW_SIGNOFF_ISO;
  }
  if (jordanCountrySet.has(iso3)) {
    return GULF_DEEP_REVIEW_SIGNOFF_ISO;
  }
  if (cambodiaCountrySet.has(iso3)) {
    return ASIA_FIVE_GATE_REVIEW_SIGNOFF_ISO;
  }
  if (laosCountrySet.has(iso3)) {
    return ASIA_FIVE_GATE_REVIEW_SIGNOFF_ISO;
  }
  if (sriLankaCountrySet.has(iso3)) {
    return ASIA_FIVE_GATE_REVIEW_SIGNOFF_ISO;
  }
  if (mongoliaCountrySet.has(iso3)) {
    return ASIA_FIVE_GATE_REVIEW_SIGNOFF_ISO;
  }
  if (costaRicaCountrySet.has(iso3)) {
    return "2026-08-10T16:18:20.000Z";
  }
  if (ecuadorCountrySet.has(iso3)) {
    return "2026-08-10T16:18:20.000Z";
  }
  if (dominicanRepublicCountrySet.has(iso3)) {
    return "2026-08-10T16:18:20.000Z";
  }
  if (algeriaCountrySet.has(iso3)) {
    return AFRICA_FIVE_GATE_REVIEW_SIGNOFF_ISO;
  }
  if (tunisiaCountrySet.has(iso3)) {
    return AFRICA_FIVE_GATE_REVIEW_SIGNOFF_ISO;
  }
  if (ethiopiaCountrySet.has(iso3)) {
    return AFRICA_FIVE_GATE_REVIEW_SIGNOFF_ISO;
  }
  if (guatemalaCountrySet.has(iso3)) {
    return LATAM_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (hondurasCountrySet.has(iso3)) {
    return LATAM_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (panamaCountrySet.has(iso3)) {
    return "2026-08-10T16:18:20.000Z";
  }
  if (uruguayCountrySet.has(iso3)) {
    return LATAM_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (botswanaCountrySet.has(iso3)) {
    return AFRICA_DEEP_REVIEW_SIGNOFF_ISO;
  }
  if (namibiaCountrySet.has(iso3)) {
    return AFRICA_DEEP_REVIEW_SIGNOFF_ISO;
  }
  if (tanzaniaCountrySet.has(iso3)) {
    return "2026-08-10T16:55:00.000Z";
  }
  if (ugandaCountrySet.has(iso3)) {
    return AFRICA_DEEP_REVIEW_SIGNOFF_ISO;
  }
  if (zambiaCountrySet.has(iso3)) {
    return "2026-08-10T16:55:00.000Z";
  }
  if (zimbabweCountrySet.has(iso3)) {
    return "2026-08-10T16:55:00.000Z";
  }
  if (rwandaCountrySet.has(iso3)) {
    return "2026-08-10T16:55:00.000Z";
  }
  if (coteDIvoireCountrySet.has(iso3)) {
    return "2026-08-10T16:55:00.000Z";
  }
  if (cameroonCountrySet.has(iso3)) {
    return AFRICA_FIVE_GATE_REVIEW_SIGNOFF_ISO;
  }
  if (senegalCountrySet.has(iso3)) {
    return AFRICA_FIVE_GATE_REVIEW_SIGNOFF_ISO;
  }
  if (mozambiqueCountrySet.has(iso3)) {
    return MOZ_LSO_MDG_MUS_FJI_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (eswatiniCountrySet.has(iso3)) {
    return AFRICA_DEEP_REVIEW_SIGNOFF_ISO;
  }
  if (lesothoCountrySet.has(iso3)) {
    return MOZ_LSO_MDG_MUS_FJI_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (madagascarCountrySet.has(iso3)) {
    return MOZ_LSO_MDG_MUS_FJI_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (mauritiusCountrySet.has(iso3)) {
    return MOZ_LSO_MDG_MUS_FJI_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (malawiCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (fijiCountrySet.has(iso3)) {
    return MOZ_LSO_MDG_MUS_FJI_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (belizeCountrySet.has(iso3)) return "2026-08-10T05:06:30.000Z";
  if (bruneiCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (bhutanCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (centralAfricanRepublicCountrySet.has(iso3)) {
    return CAF_COD_COG_GIN_DJI_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (democraticRepublicOfCongoCountrySet.has(iso3)) {
    return CAF_COD_COG_GIN_DJI_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (republicOfCongoCountrySet.has(iso3)) {
    return CAF_COD_COG_GIN_DJI_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (cubaCountrySet.has(iso3)) return "2026-08-10T05:38:27.000Z";
  if (djiboutiCountrySet.has(iso3)) {
    return CAF_COD_COG_GIN_DJI_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (guineaCountrySet.has(iso3)) {
    return CAF_COD_COG_GIN_DJI_SOURCE_REFRESH_SIGNOFF_ISO;
  }
  if (greenlandCountrySet.has(iso3)) return "2026-08-10T06:44:56.000Z";
  if (guyanaCountrySet.has(iso3)) return "2026-08-10T07:34:48.000Z";
  if (haitiCountrySet.has(iso3)) return "2026-08-10T07:34:48.000Z";
  if (iranCountrySet.has(iso3)) return "2026-08-10T07:34:48.000Z";
  if (iraqCountrySet.has(iso3)) return "2026-08-10T07:34:48.000Z";
  if (jamaicaCountrySet.has(iso3)) return "2026-08-10T07:58:42.000Z";
  if (lebanonCountrySet.has(iso3)) return "2026-08-10T07:58:42.000Z";
  if (liberiaCountrySet.has(iso3)) return "2026-08-10T07:58:42.000Z";
  if (libyaCountrySet.has(iso3)) return "2026-08-10T07:58:42.000Z";
  if (maliCountrySet.has(iso3)) return "2026-08-10T08:31:37.000Z";
  if (myanmarCountrySet.has(iso3)) return ASIA_FIVE_GATE_REVIEW_SIGNOFF_ISO;
  if (mauritaniaCountrySet.has(iso3)) return "2026-08-10T08:31:37.000Z";
  if (newCaledoniaCountrySet.has(iso3)) return PRK_PSE_SDN_PRI_NCL_SOURCE_REFRESH_SIGNOFF_ISO;
  if (nigerCountrySet.has(iso3)) return "2026-08-10T09:11:38.000Z";
  if (nicaraguaCountrySet.has(iso3)) return LATAM_SOURCE_REFRESH_SIGNOFF_ISO;
  if (papuaNewGuineaCountrySet.has(iso3)) return "2026-08-10T23:00:23.000Z";
  if (puertoRicoCountrySet.has(iso3)) return PRK_PSE_SDN_PRI_NCL_SOURCE_REFRESH_SIGNOFF_ISO;
  if (northKoreaCountrySet.has(iso3)) return PRK_PSE_SDN_PRI_NCL_SOURCE_REFRESH_SIGNOFF_ISO;
  if (paraguayCountrySet.has(iso3)) return LATAM_SOURCE_REFRESH_SIGNOFF_ISO;
  if (palestineCountrySet.has(iso3)) return PRK_PSE_SDN_PRI_NCL_SOURCE_REFRESH_SIGNOFF_ISO;
  if (sudanCountrySet.has(iso3)) return PRK_PSE_SDN_PRI_NCL_SOURCE_REFRESH_SIGNOFF_ISO;
  if (solomonIslandsCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (sierraLeoneCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (elSalvadorCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (somaliaCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (southSudanCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (surinameCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (syriaCountrySet.has(iso3)) return "2026-08-10T10:54:10.000Z";
  if (chadCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (togoCountrySet.has(iso3)) return "2026-08-10T11:21:32.000Z";
  if (timorLesteCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (trinidadTobagoCountrySet.has(iso3)) {
    return TWELVE_COUNTRY_SOURCE_ONLY_REFRESH_SIGNOFF_ISO;
  }
  if (taiwanCountrySet.has(iso3)) return "2026-08-10T11:21:32.000Z";
  if (venezuelaCountrySet.has(iso3)) return "2026-08-10T11:58:54.000Z";
  if (vanuatuCountrySet.has(iso3)) return "2026-08-10T11:58:54.000Z";
  if (yemenCountrySet.has(iso3)) return "2026-08-10T11:58:54.000Z";
  if (specialBoundaryCountrySet.has(iso3)) return "2026-08-10T11:58:54.000Z";
  return SIGNOFF_ISO;
}

function requireId(value: string | undefined, what: string): string {
  if (!value) {
    throw new Error(`Missing explicit id for ${what}.`);
  }
  return value;
}

function countrySignoffAsOf(iso3: string): string {
  return africaFiveGateReviewCountrySet.has(iso3)
    ? "2026-08-11"
    : countrySignoffVerifiedAt(iso3).slice(0, 10);
}

function requireVerifiedAt(value: unknown, what: string): string {
  if (!(value instanceof Date)) {
    throw new Error(`Missing verified_at for ${what}.`);
  }
  return value.toISOString();
}

const ingestedSourceIds = new Set<string>([
  acceptanceFixtureIds.source.cnGb17691,
  acceptanceFixtureIds.source.cnGb20891,
  acceptanceFixtureIds.source.cnHj1014,
  acceptanceFixtureIds.source.usEcfr1036,
  acceptanceFixtureIds.source.usEcfr86,
  acceptanceFixtureIds.source.usEcfr1039,
  acceptanceFixtureIds.source.euReg595,
  acceptanceFixtureIds.source.euReg1628,
  acceptanceFixtureIds.source.euCountries,
  acceptanceFixtureIds.source.eaeuMemberStates,
  acceptanceFixtureIds.source.brConama403,
  acceptanceFixtureIds.source.brConama490,
  acceptanceFixtureIds.source.brConama433,
  acceptanceFixtureIds.source.japanRoadSafety,
  acceptanceFixtureIds.source.japanRoadHistory,
  acceptanceFixtureIds.source.japanOffroadNotice,
  acceptanceFixtureIds.source.koreaRulePage,
  acceptanceFixtureIds.source.koreaRuleAnnex17,
  acceptanceFixtureIds.source.mexicoNom044,
  acceptanceFixtureIds.source.mexicoNom044Amend2020,
  acceptanceFixtureIds.source.mexicoNom044Amend2021,
  acceptanceFixtureIds.source.turkeyRoadRegulation,
  acceptanceFixtureIds.source.turkeyRoadAmendment2021,
  acceptanceFixtureIds.source.turkeyNonroadRegulation,
  acceptanceFixtureIds.source.turkeyNonroadAnnex,
  acceptanceFixtureIds.source.turkeyAgricultureTypeApproval,
  acceptanceFixtureIds.source.australiaAdrCurrent,
  acceptanceFixtureIds.source.australiaAdr80_03,
  acceptanceFixtureIds.source.australiaAdr80_04,
  acceptanceFixtureIds.source.australiaAdr80Qna,
  acceptanceFixtureIds.source.australiaNrdeEvaluation,
  acceptanceFixtureIds.source.australiaDieselHdStandards,
  acceptanceFixtureIds.source.canadaRoadRegulation,
  acceptanceFixtureIds.source.canadaOffroadRegulation,
  acceptanceFixtureIds.source.unitedKingdomNrmm,
  acceptanceFixtureIds.source.unitedKingdomAgricultureApproval,
  acceptanceFixtureIds.source.indiaBs6,
  acceptanceFixtureIds.source.indiaCevTrem,
  acceptanceFixtureIds.source.indiaTremIvExtension,
  acceptanceFixtureIds.source.indiaTremVExtension,
  acceptanceFixtureIds.source.indiaTrem2026Draft,
  acceptanceFixtureIds.source.russiaRoadRegulation,
  acceptanceFixtureIds.source.russiaNationalDeviation,
  acceptanceFixtureIds.source.russiaAgricultureRegulation,
  acceptanceFixtureIds.source.russiaAgricultureAmendment2021,
  acceptanceFixtureIds.source.russiaAgricultureAmendment2024,
  acceptanceFixtureIds.source.russiaUneceR49,
  acceptanceFixtureIds.source.indonesiaEuro4,
  acceptanceFixtureIds.source.thailandTis3046,
  acceptanceFixtureIds.source.thailandMinisterialRegulation,
  acceptanceFixtureIds.source.vietnamDecision49,
  acceptanceFixtureIds.source.vietnamQcvn109,
  acceptanceFixtureIds.source.malaysiaDieselRegulation,
  acceptanceFixtureIds.source.malaysiaVtaGuideline,
  acceptanceFixtureIds.source.saudiGso42,
  acceptanceFixtureIds.source.saudiGso144,
  acceptanceFixtureIds.source.saudiMachinerySafetyPart2,
  acceptanceFixtureIds.source.saudiVehicle2026TechnicalRegulations,
  acceptanceFixtureIds.source.uaeMandatoryStandards2018,
  acceptanceFixtureIds.source.uaeVehicleEmissionGuide,
  acceptanceFixtureIds.source.southAfricaMotorVehiclesM23,
  acceptanceFixtureIds.source.southAfricaMotorVehiclesN23,
  acceptanceFixtureIds.source.southAfricaDirective91542,
  acceptanceFixtureIds.source.argentinaResolution1464,
  acceptanceFixtureIds.source.argentinaResolution128Exception,
  acceptanceFixtureIds.source.euDirective200555,
  acceptanceFixtureIds.source.newZealandVehicleExhaustRule,
  acceptanceFixtureIds.source.chileMobileMachineryDecree39,
  acceptanceFixtureIds.source.chileTractorAmendmentDecree33,
  acceptanceFixtureIds.source.chileHeavyVehicleDecree50,
  acceptanceFixtureIds.source.colombiaResolution762,
  acceptanceFixtureIds.source.peruDecree029,
  acceptanceFixtureIds.source.philippinesLtoMc20151946,
  acceptanceFixtureIds.source.philippinesEuro4LimitsBoI,
  acceptanceFixtureIds.source.philippinesUnr49CycleNotice,
  acceptanceFixtureIds.source.singaporeVehicularAmendment2017,
  acceptanceFixtureIds.source.singaporeOffRoad2012,
  acceptanceFixtureIds.source.singaporeAirPollutionGuide,
  acceptanceFixtureIds.source.norwayRoadRegulation,
  acceptanceFixtureIds.source.norwayMachineryRegulation,
  acceptanceFixtureIds.source.icelandRoadRegulation2013,
  acceptanceFixtureIds.source.icelandRoadAmendment2026,
  acceptanceFixtureIds.source.icelandNrmmRegulation2020,
  acceptanceFixtureIds.source.icelandNrmmRegulation2021,
  acceptanceFixtureIds.source.liechtensteinVts,
  acceptanceFixtureIds.source.liechtensteinEwrStageV,
  acceptanceFixtureIds.source.switzerlandVts,
  acceptanceFixtureIds.source.serbiaHomologationRulebook,
  acceptanceFixtureIds.source.serbiaTechnicalConditions,
  acceptanceFixtureIds.source.bosniaMinimumRequirements,
  acceptanceFixtureIds.source.bosniaR49Orders,
  acceptanceFixtureIds.source.uneceR49Rev6,
  acceptanceFixtureIds.source.uneceR49Rev4,
  acceptanceFixtureIds.source.northMacedoniaRoadApproval,
  acceptanceFixtureIds.source.northMacedoniaTractorApproval,
  acceptanceFixtureIds.source.montenegroVehicleRequirements,
  acceptanceFixtureIds.source.montenegroUneceR49,
  acceptanceFixtureIds.source.montenegroEuro6Implementation,
  acceptanceFixtureIds.source.albaniaGothenburgAccession,
  acceptanceFixtureIds.source.albaniaTreatyStatus,
  acceptanceFixtureIds.source.ukraineImportRegistrationLaw,
  acceptanceFixtureIds.source.ukraineTypeApprovalOrder,
  acceptanceFixtureIds.source.moldovaTypeApprovalDraftLaw,
  acceptanceFixtureIds.source.moldovaTypeApprovalSecondaryConsultation,
  acceptanceFixtureIds.source.nepalVehicleEmissionGazette,
  acceptanceFixtureIds.source.nepalVehiclePollutionStandardDoenv,
  acceptanceFixtureIds.source.armeniaTrCu018Consolidated,
  acceptanceFixtureIds.source.armeniaTrCu031Consolidated,
  acceptanceFixtureIds.source.azerbaijanEuro4Decision,
  acceptanceFixtureIds.source.azerbaijanAzs6362025,
  acceptanceFixtureIds.source.georgiaResolution238,
  acceptanceFixtureIds.source.georgiaResolution238Mepa,
  acceptanceFixtureIds.source.uzbekistanAgricultureRegulation,
  acceptanceFixtureIds.source.uzbekistanRoadRegulation,
  acceptanceFixtureIds.source.kazakhstanRoadRegulation,
  acceptanceFixtureIds.source.kazakhstanAgricultureRegulation,
  acceptanceFixtureIds.source.tajikistanRoadEnvironmentalLaw,
  acceptanceFixtureIds.source.tajikistanEngineTermsDraft,
  acceptanceFixtureIds.source.kyrgyzstanRoadImplementation,
  acceptanceFixtureIds.source.kyrgyzstanAgricultureRegulation,
  acceptanceFixtureIds.source.turkmenistanAirProtectionLaw,
  acceptanceFixtureIds.source.turkmenistanGasolineMeasurementStandard,
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
  acceptanceFixtureIds.source.belarusTrCu018,
  acceptanceFixtureIds.source.belarusTrCu031,
  acceptanceFixtureIds.source.boliviaRm064Regulation,
  acceptanceFixtureIds.source.boliviaIbmetroAcceptance,
  acceptanceFixtureIds.source.moroccoEuro6Order2094,
  acceptanceFixtureIds.source.moroccoEuro6Order2251,
  acceptanceFixtureIds.source.kenyaAirQualityRegulations2024,
  acceptanceFixtureIds.source.kenyaInspectionRules2026,
  acceptanceFixtureIds.source.nigeriaNesrea,
  acceptanceFixtureIds.source.nigeriaVehicularEmissions2011,
  acceptanceFixtureIds.source.egyptExecRegulation338,
  acceptanceFixtureIds.source.egyptDecision710,
  acceptanceFixtureIds.source.ghanaEnvironmentalProtectionAct2025,
  acceptanceFixtureIds.source.ghanaMotorVehicleEmissionsStandard1219,
  acceptanceFixtureIds.source.israelRoadImr2026,
  acceptanceFixtureIds.source.israelNrmmImr2026,
  acceptanceFixtureIds.source.pakistanSro72OfficialIndex,
  acceptanceFixtureIds.source.pakistanSro72GazetteScan,
  acceptanceFixtureIds.source.qatarEuro5Policy2023,
  acceptanceFixtureIds.source.qatarTechnicalRegulationsDecision125,
  acceptanceFixtureIds.source.kuwaitGulfStandardsDecision372,
  acceptanceFixtureIds.source.kuwaitTechnicalRegulationsDecision44,
  acceptanceFixtureIds.source.omanBindingVehicleStandardsDecision120,
  acceptanceFixtureIds.source.omanGsoMotorVehicleRegulationsMy2026,
  acceptanceFixtureIds.source.jordanTransportGreenGrowthPlan,
  acceptanceFixtureIds.source.jordanTransportEmissionsStandardsCatalogue,
  acceptanceFixtureIds.source.cambodiaEnvironment,
  acceptanceFixtureIds.source.cambodiaTransport,
  acceptanceFixtureIds.source.laosEnvironment,
  acceptanceFixtureIds.source.laosTransport,
  acceptanceFixtureIds.source.sriLankaEnvironment,
  acceptanceFixtureIds.source.sriLankaTransport,
  acceptanceFixtureIds.source.mongoliaEnvironment,
  acceptanceFixtureIds.source.mongoliaTransport,
  acceptanceFixtureIds.source.costaRicaEnvironment,
  acceptanceFixtureIds.source.costaRicaTransport,
  acceptanceFixtureIds.source.ecuadorDieselStandard2207,
  acceptanceFixtureIds.source.ecuadorRte017,
  acceptanceFixtureIds.source.ecuadorRte017Amendment2025,
  acceptanceFixtureIds.source.dominicanRepublicEnvironment,
  acceptanceFixtureIds.source.dominicanRepublicTransport,
  acceptanceFixtureIds.source.algeriaEnvironment,
  acceptanceFixtureIds.source.algeriaTransport,
  acceptanceFixtureIds.source.tunisiaEnvironment,
  acceptanceFixtureIds.source.tunisiaTransport,
  acceptanceFixtureIds.source.ethiopiaEnvironment,
  acceptanceFixtureIds.source.ethiopiaTransport,
  acceptanceFixtureIds.source.guatemalaEnvironment,
  acceptanceFixtureIds.source.guatemalaTransport,
  acceptanceFixtureIds.source.hondurasEnvironment,
  acceptanceFixtureIds.source.hondurasTransport,
  acceptanceFixtureIds.source.panamaEnvironment,
  acceptanceFixtureIds.source.panamaTransport,
  acceptanceFixtureIds.source.uruguayEnvironment,
  acceptanceFixtureIds.source.uruguayTransport,
  acceptanceFixtureIds.source.botswanaGovernment,
  acceptanceFixtureIds.source.botswanaTransport,
  acceptanceFixtureIds.source.namibiaEnvironment,
  acceptanceFixtureIds.source.namibiaTransport,
  acceptanceFixtureIds.source.tanzaniaEnvironment,
  acceptanceFixtureIds.source.tanzaniaTransport,
  acceptanceFixtureIds.source.ugandaEnvironment,
  acceptanceFixtureIds.source.ugandaTransport,
  acceptanceFixtureIds.source.zambiaEnvironment,
  acceptanceFixtureIds.source.zambiaTransport,
  acceptanceFixtureIds.source.zimbabweEnvironment,
  acceptanceFixtureIds.source.zimbabweTransport,
  acceptanceFixtureIds.source.rwandaEnvironment,
  acceptanceFixtureIds.source.rwandaTransport,
  acceptanceFixtureIds.source.rwandaEas1047Implementation,
  acceptanceFixtureIds.source.coteDIvoireEnvironment,
  acceptanceFixtureIds.source.coteDIvoireTransport,
  acceptanceFixtureIds.source.cameroonEnvironment,
  acceptanceFixtureIds.source.cameroonTransport,
  acceptanceFixtureIds.source.senegalEnvironment,
  acceptanceFixtureIds.source.senegalTransport,
  acceptanceFixtureIds.source.mozambiqueEnvironment,
  acceptanceFixtureIds.source.mozambiqueTransport,
  acceptanceFixtureIds.source.eswatiniGovernment,
  acceptanceFixtureIds.source.eswatiniTransport,
  acceptanceFixtureIds.source.lesothoGovernment,
  acceptanceFixtureIds.source.lesothoTransport,
  acceptanceFixtureIds.source.madagascarEnvironment,
  acceptanceFixtureIds.source.madagascarTransport,
  acceptanceFixtureIds.source.mauritiusEnvironment,
  acceptanceFixtureIds.source.mauritiusTransport,
  acceptanceFixtureIds.source.malawiGovernment,
  acceptanceFixtureIds.source.malawiTransport,
  acceptanceFixtureIds.source.fijiEnvironment,
  acceptanceFixtureIds.source.fijiTransport,
  acceptanceFixtureIds.source.belizeEnvironment,
  acceptanceFixtureIds.source.belizeTransport,
  acceptanceFixtureIds.source.bruneiEnvironment,
  acceptanceFixtureIds.source.bruneiTransport,
  acceptanceFixtureIds.source.bhutanEnvironment,
  acceptanceFixtureIds.source.bhutanTransport,
  acceptanceFixtureIds.source.centralAfricanRepublicEnvironment,
  acceptanceFixtureIds.source.centralAfricanRepublicTransport,
  acceptanceFixtureIds.source.democraticRepublicOfCongoEnvironment,
  acceptanceFixtureIds.source.democraticRepublicOfCongoTransport,
  acceptanceFixtureIds.source.republicOfCongoEnvironment,
  acceptanceFixtureIds.source.republicOfCongoTransport,
  acceptanceFixtureIds.source.cubaEnvironment,
  acceptanceFixtureIds.source.cubaTransport,
  acceptanceFixtureIds.source.djiboutiEnvironment,
  acceptanceFixtureIds.source.djiboutiTransport,
  acceptanceFixtureIds.source.eritreaEnvironmentalProtectionManagementRegulations127_2017,
  acceptanceFixtureIds.source.eritreaVehicleTechnicalStandardsRegulations61_2002,
  acceptanceFixtureIds.source.gabonEnvironmentalProtectionLaw007_2014,
  acceptanceFixtureIds.source.gabonHeavyVehicleHomologationOrder00097_2017,
  acceptanceFixtureIds.source.guineaEnvironment,
  acceptanceFixtureIds.source.guineaTransport,
  acceptanceFixtureIds.source.gambiaEnvironmentalQualityStandardsRegulations1999,
  acceptanceFixtureIds.source.gambiaMotorTrafficAmendmentAct2013,
  acceptanceFixtureIds.source.guineaBissauBasicEnvironmentLaw1_2011,
  acceptanceFixtureIds.source.guineaBissauTransportMinistryDirectory,
  acceptanceFixtureIds.source.equatorialGuineaEnvironmentalLaw7_2003,
  acceptanceFixtureIds.source.equatorialGuineaGeneralRoadTransportLaw4_2018,
  acceptanceFixtureIds.source.greenlandEnvironment,
  acceptanceFixtureIds.source.greenlandTransport,
  acceptanceFixtureIds.source.guyanaEnvironment,
  acceptanceFixtureIds.source.guyanaTransport,
  acceptanceFixtureIds.source.haitiEnvironment,
  acceptanceFixtureIds.source.haitiTransport,
  acceptanceFixtureIds.source.iranTechnicalPollutionRegulation,
  acceptanceFixtureIds.source.iranArticle4Amendment2024,
  acceptanceFixtureIds.source.iraqTr167AmendmentDecision2024,
  acceptanceFixtureIds.source.iraqTr167ImplementationNotice2025,
  acceptanceFixtureIds.source.jamaicaEnvironment,
  acceptanceFixtureIds.source.jamaicaTransport,
  acceptanceFixtureIds.source.lebanonEnvironmentalProtectionLaw444,
  acceptanceFixtureIds.source.lebanonThirdBur2019,
  acceptanceFixtureIds.source.liberiaEnvironmentalProtectionManagementLaw,
  acceptanceFixtureIds.source.liberiaVehicleAdministrativeRegulation2011,
  acceptanceFixtureIds.source.libyaEnvironmentalProtectionLaw15,
  acceptanceFixtureIds.source.libyaEnvironmentalExecutiveRegulation448,
  acceptanceFixtureIds.source.maliTechnicalInspectionOrder2020,
  acceptanceFixtureIds.source.maliRoadUseVehicleCirculationDecree2023,
  acceptanceFixtureIds.source.myanmarEnvironment,
  acceptanceFixtureIds.source.myanmarTransport,
  acceptanceFixtureIds.source.mauritaniaAirPollutionLaw2018,
  acceptanceFixtureIds.source.mauritaniaEnvironmentCode2000,
  acceptanceFixtureIds.source.newCaledoniaEnvironment,
  acceptanceFixtureIds.source.newCaledoniaTransport,
  acceptanceFixtureIds.source.nigerEnvironmentalFrameworkLaw9856,
  acceptanceFixtureIds.source.nigerMotorVehicleHomologationEServices,
  acceptanceFixtureIds.source.nicaraguaEnvironment,
  acceptanceFixtureIds.source.nicaraguaTransport,
  acceptanceFixtureIds.source.papuaNewGuineaEnvironment,
  acceptanceFixtureIds.source.papuaNewGuineaTransport,
  acceptanceFixtureIds.source.puertoRicoEnvironment,
  acceptanceFixtureIds.source.puertoRicoTransport,
  acceptanceFixtureIds.source.northKoreaEnvironment,
  acceptanceFixtureIds.source.northKoreaTransport,
  acceptanceFixtureIds.source.paraguayEnvironment,
  acceptanceFixtureIds.source.paraguayTransport,
  acceptanceFixtureIds.source.palestineEnvironment,
  acceptanceFixtureIds.source.palestineTransport,
  acceptanceFixtureIds.source.sudanEnvironment,
  acceptanceFixtureIds.source.sudanTransport,
  acceptanceFixtureIds.source.solomonIslandsEnvironment,
  acceptanceFixtureIds.source.solomonIslandsTransport,
  acceptanceFixtureIds.source.sierraLeoneEnvironment,
  acceptanceFixtureIds.source.sierraLeoneTransport,
  acceptanceFixtureIds.source.elSalvadorEnvironment,
  acceptanceFixtureIds.source.elSalvadorTransport,
  acceptanceFixtureIds.source.somaliaEnvironment,
  acceptanceFixtureIds.source.somaliaTransport,
  acceptanceFixtureIds.source.southSudanEnvironment,
  acceptanceFixtureIds.source.southSudanTransport,
  acceptanceFixtureIds.source.surinameEnvironment,
  acceptanceFixtureIds.source.surinameTransport,
  acceptanceFixtureIds.source.syriaEnvironmentLaw12,
  acceptanceFixtureIds.source.syriaVehicleImportNotice2025,
  acceptanceFixtureIds.source.chadEnvironment,
  acceptanceFixtureIds.source.chadTransport,
  acceptanceFixtureIds.source.togoEnvironment,
  acceptanceFixtureIds.source.togoTransport,
  acceptanceFixtureIds.source.timorLesteEnvironment,
  acceptanceFixtureIds.source.timorLesteTransport,
  acceptanceFixtureIds.source.trinidadTobagoEnvironment,
  acceptanceFixtureIds.source.trinidadTobagoTransport,
  acceptanceFixtureIds.source.taiwanEnvironment,
  acceptanceFixtureIds.source.taiwanTransport,
  acceptanceFixtureIds.source.venezuelaEnvironment,
  acceptanceFixtureIds.source.venezuelaTransport,
  acceptanceFixtureIds.source.vanuatuEnvironment,
  acceptanceFixtureIds.source.vanuatuTransport,
  acceptanceFixtureIds.source.yemenEnvironment,
  acceptanceFixtureIds.source.yemenTransport,
  acceptanceFixtureIds.source.antarcticaBoundary,
  acceptanceFixtureIds.source.frenchSouthernLandsBoundary,
  acceptanceFixtureIds.source.westernSaharaBoundary,
  acceptanceFixtureIds.source.falklandIslandsBoundary,
  ...Object.values(acceptedMarketFixtureIds.source),
]);
const marketSourceIds = new Set<string>(
  Object.values(acceptedMarketFixtureIds.source),
);

const ingestedRegulationIds = signedPublishableRegulationIds;

const ingestedJurisdictionCodes = new Set<string>([
  "CN-MEE",
  "US-EPA",
  "EU",
  "EAEU",
  "BR-CONAMA",
  "JP-NATIONAL",
  "KR-ME",
  "MX-SEMARNAT",
  "TR-MOIT",
  "AU-DITRDCSA",
  "CA-ECCC",
  "GB-VCA",
  "IN-MORTH",
  "RU-EAEU",
  "ID-KLHK",
  "TH-TISI",
  "VN-MOT",
  "MY-DOE",
  "SA-SASO",
  "AE-MOIAT",
  "ZA-NRCS",
  "AR-SAyDS",
  "NZ-NZTA",
  "CL-MMA",
  "CO-MADS",
  "PE-MINAM",
  "PH-DENR",
  "SG-NEA",
  "NO-NATIONAL",
  "IS-NATIONAL",
  "LI-NATIONAL",
  "CH-NATIONAL",
  "RS-NATIONAL",
  "BA-NATIONAL",
  "MK-NATIONAL",
  "ME-NATIONAL",
  "AL-NATIONAL",
  "UA-NATIONAL",
  "MD-NATIONAL",
  "NP-NATIONAL",
  "AM-NATIONAL",
  "AZ-NATIONAL",
  "GE-NATIONAL",
  "UZ-NATIONAL",
  "KZ-NATIONAL",
  "TJ-NATIONAL",
  "KG-NATIONAL",
  "TM-NATIONAL",
  "AF-NATIONAL",
  "AO-NATIONAL",
  "BI-NATIONAL",
  "BJ-NATIONAL",
  "BF-NATIONAL",
  "BD-NATIONAL",
  "BS-NATIONAL",
  "BY-NATIONAL",
  "BO-NATIONAL",
  "MA-NATIONAL",
  "KE-NATIONAL",
  "NG-NATIONAL",
  "EG-NATIONAL",
  "GH-NATIONAL",
  "IL-NATIONAL",
  "PK-NATIONAL",
  "QA-NATIONAL",
  "KW-NATIONAL",
  "OM-NATIONAL",
  "JO-NATIONAL",
  "KH-NATIONAL",
  "LA-NATIONAL",
  "LK-NATIONAL",
  "MN-NATIONAL",
  "CR-NATIONAL",
  "EC-NATIONAL",
  "DO-NATIONAL",
  "DZ-NATIONAL",
  "TN-NATIONAL",
  "ET-NATIONAL",
  "GT-NATIONAL",
  "HN-NATIONAL",
  "PA-NATIONAL",
  "UY-NATIONAL",
  "BW-NATIONAL",
  "NA-NATIONAL",
  "TZ-NATIONAL",
  "UG-NATIONAL",
  "ZM-NATIONAL",
  "ZW-NATIONAL",
  "RW-NATIONAL",
  "CI-NATIONAL",
  "CM-NATIONAL",
  "SN-NATIONAL",
  "MZ-NATIONAL",
  "SZ-NATIONAL",
  "LS-NATIONAL",
  "MG-NATIONAL",
  "MU-NATIONAL",
  "MW-NATIONAL",
  "FJ-NATIONAL",
  "BZ-NATIONAL",
  "BN-NATIONAL",
  "BT-NATIONAL",
  "CF-NATIONAL",
  "CD-NATIONAL",
  "CG-NATIONAL",
  "CU-NATIONAL",
  "DJ-NATIONAL",
  "ER-NATIONAL",
  "GA-NATIONAL",
  "GN-NATIONAL",
  "GM-NATIONAL",
  "GW-NATIONAL",
  "GQ-NATIONAL",
  "GL-NATIONAL",
  "GY-NATIONAL",
  "HT-NATIONAL",
  "IR-NATIONAL",
  "IQ-NATIONAL",
  "JM-NATIONAL",
  "LB-NATIONAL",
  "LR-NATIONAL",
  "LY-NATIONAL",
  "ML-NATIONAL",
  "MM-NATIONAL",
  "MR-NATIONAL",
  "NC-NATIONAL",
  "NE-NATIONAL",
  "NI-NATIONAL",
  "PG-NATIONAL",
  "PR-NATIONAL",
  "KP-NATIONAL",
  "PY-NATIONAL",
  "PS-NATIONAL",
  "SD-NATIONAL",
  "SB-NATIONAL",
  "SL-NATIONAL",
  "SV-NATIONAL",
  "SO-NATIONAL",
  "SS-NATIONAL",
  "SR-NATIONAL",
  "SY-NATIONAL",
  "TD-NATIONAL",
  "TG-NATIONAL",
  "TL-NATIONAL",
  "TT-NATIONAL",
  "TW-NATIONAL",
  "VE-NATIONAL",
  "VU-NATIONAL",
  "YE-NATIONAL",
  "AQ-BOUNDARY",
  "TF-BOUNDARY",
  "EH-BOUNDARY",
  "FK-BOUNDARY",
]);

const ingestedCountryMemberships = new Set<string>([
  "BRA",
  "CHN",
  "USA",
  "JPN",
  "KOR",
  "MEX",
  "TUR",
  "AUS",
  "CAN",
  "GBR",
  "IND",
  "RUS",
  "IDN",
  "THA",
  "VNM",
  "MYS",
  "SAU",
  "ARE",
  "ZAF",
  "ARG",
  "NZL",
  "CHL",
  "COL",
  "PER",
  "PHL",
  "SGP",
  "NOR",
  "ISL",
  "LIE",
  "CHE",
  "SRB",
  "BIH",
  "MKD",
  "MNE",
  "ALB",
  "UKR",
  "MDA",
  "NPL",
  "ARM",
  "AZE",
  "GEO",
  "UZB",
  "KAZ",
  "TJK",
  "KGZ",
  "TKM",
  "AFG",
  "AGO",
  "BDI",
  "BEN",
  "BFA",
  "BGD",
  "BHS",
  "BLR",
  "BOL",
  "MAR",
  "KEN",
  "NGA",
  "EGY",
  "GHA",
  "ISR",
  "PAK",
  "QAT",
  "KWT",
  "OMN",
  "JOR",
  "KHM",
  "LAO",
  "LKA",
  "MNG",
  "CRI",
  "ECU",
  "DOM",
  "DZA",
  "TUN",
  "ETH",
  "GTM",
  "HND",
  "PAN",
  "URY",
  "BWA",
  "NAM",
  "TZA",
  "UGA",
  "ZMB",
  "ZWE",
  "RWA",
  "CIV",
  "CMR",
  "SEN",
  "MOZ",
  "SWZ",
  "LSO",
  "MDG",
  "MUS",
  "MWI",
  "FJI",
  "BLZ",
  "BRN",
  "BTN",
  "CAF",
  "COD",
  "COG",
  "CUB",
  "DJI",
  "ERI",
  "GAB",
  "GIN",
  "GMB",
  "GNB",
  "GNQ",
  "GRL",
  "GUY",
  "HTI",
  "IRN",
  "IRQ",
  "JAM",
  "LBN",
  "LBR",
  "LBY",
  "MLI",
  "MMR",
  "MRT",
  "NCL",
  "NER",
  "NIC",
  "PNG",
  "PRI",
  "PRK",
  "PRY",
  "PSE",
  "SDN",
  "SLB",
  "SLE",
  "SLV",
  "SOM",
  "SSD",
  "SUR",
  "SYR",
  "TCD",
  "TGO",
  "TLS",
  "TTO",
  "TWN",
  "VEN",
  "VUT",
  "YEM",
  "ATA",
  "ATF",
  "ESH",
  "FLK",
  ...euMemberCountryIso3,
]);
const coveredCountryIso3 = [
  ...new Set([
    ...explicitlyCoveredCountryIso3,
    ...ingestedCountryMemberships,
  ]),
];

function assertExactSelectionSet(
  label: string,
  declared: ReadonlySet<string>,
  derived: ReadonlySet<string>,
  options: { allowSupplementaryEntries?: boolean } = {},
): void {
  const missing = [...derived].filter((value) => !declared.has(value));
  const extra = options.allowSupplementaryEntries
    ? []
    : [...declared].filter((value) => !derived.has(value));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${label} allowlist is not closed over signed country graphs; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}].`,
    );
  }
}

async function main(): Promise<void> {
  const allFixtureLimits = buildFixtureLimits();
  const targetSelection = targetCountryIso3
    ? buildTargetSelection(targetCountryIso3, allFixtureLimits)
    : null;
  const targetMembershipsToPublish = targetSelection
    ? [...targetSelection.jurisdictionIds].flatMap((jurisdictionId) =>
        selectJurisdictionMembershipsForIngest({
          jurisdictionId,
          signedCountryIso3s: ingestedCountryMemberships,
          targetCountryIso3: targetSelection.countryIso3,
        }),
      )
    : [];
  const targetSourceIds = targetSelection
    ? new Set([
        ...targetSelection.sourceIds,
        ...targetMembershipsToPublish.map(
          (membership) => membership.dataSourceId,
        ),
      ])
    : null;
  const fullIngestSelection = buildFullIngestSelection(
    [...ingestedCountryMemberships],
    allFixtureLimits,
  );
  const derivedFullSourceIds = new Set([
    ...fullIngestSelection.sourceIds,
    ...marketSourceIds,
  ]);
  const derivedFullJurisdictionCodes = new Set(
    fixtureJurisdictions
      .filter((jurisdiction) =>
        fullIngestSelection.jurisdictionIds.has(
          requireId(jurisdiction.id, jurisdiction.code),
        ),
      )
      .map((jurisdiction) => jurisdiction.code),
  );
  assertExactSelectionSet(
    "source",
    ingestedSourceIds,
    derivedFullSourceIds,
    { allowSupplementaryEntries: true },
  );
  assertExactSelectionSet(
    "regulation",
    ingestedRegulationIds,
    fullIngestSelection.regulationIds,
  );
  assertExactSelectionSet(
    "jurisdiction",
    ingestedJurisdictionCodes,
    derivedFullJurisdictionCodes,
  );
  const client = postgres(getDatabaseUrl(), { max: 1, prepare: false });
  const database = drizzle(client, { schema });
  const governance = createGovernanceRepository(database);
  const countryRepository = createCountryRepository(database);
  const failures: string[] = [];

  try {
    // 2a) 数据来源（治理发布）。
    for (const source of [...fixtureSources, ...fixtureMarketSources].filter(
      (row) => {
        const sourceId = requireId(row.id, row.title);
        return (
          (targetSelection
            ? targetSourceIds?.has(sourceId) === true
            : ingestedSourceIds.has(sourceId)) &&
          (!marketOnly || marketSourceIds.has(sourceId))
        );
      },
    )) {
      const sourceId = requireId(source.id, source.title);
      const sourceReason = marketSourceIds.has(sourceId)
        ? marketReadbackReason
        : signoffReason;
      const draft = await governance.createDraft({
        actor: editor,
        changeReason: sourceReason,
        entityKey: sourceId,
        entityType: "data_source",
        payload: {
          id: sourceId,
          isDemo: source.isDemo,
          publishedOn: source.publishedOn ?? null,
          publisher: source.publisher ?? null,
          sourceType: source.sourceType,
          title: source.title,
          url: source.url ?? null,
          verifiedAt: requireVerifiedAt(
            source.verifiedAt,
            `data source ${sourceId}`,
          ),
        },
      });
      await governance.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: sourceReason,
      });
      await governance.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: sourceReason,
      });
      process.stdout.write(`data_source ${sourceId}: published\n`);
    }

    // 新增到静态目录、但尚未同步到目标库的国家必须先以 planned 建档，
    // 否则辖区发布会因活跃父记录校验而失败。已有国家不降级；目标图
    // 完整发布后，2c 再统一提升为 covered。
    if (targetSelection) {
      const iso3 = targetSelection.countryIso3;
      const existingCountry = await countryRepository.findByIso3({ iso3 });
      if (!existingCountry) {
        const entry = countryCatalog.find((row) => row.iso3 === iso3);
        if (!entry) {
          throw new Error(`Catalog entry for ${iso3} is missing.`);
        }
        const draft = await governance.createDraft({
          actor: editor,
          changeReason: signoffReason,
          entityKey: iso3,
          entityType: "country",
          payload: {
            dataCoverageStatus: "planned",
            dataSourceId: DIRECTORY_SOURCE_ID,
            isDemo: false,
            iso2: entry.iso2,
            iso3: entry.iso3,
            nameEn: entry.nameEn,
            nameLocal: null,
            regionCode: entry.regionCode,
            subregionCode: entry.subregionCode,
            verifiedAt: countrySignoffVerifiedAt(iso3),
          },
        });
        await governance.reviewDraft({
          actor: reviewer,
          draftId: draft.id,
          reason: signoffReason,
        });
        await governance.publishDraft({
          actor: reviewer,
          draftId: draft.id,
          reason: signoffReason,
        });
        process.stdout.write(`country ${iso3}: catalog entry -> planned\n`);
      }
    }

    // 2a.75) 官方注册车队与确定性同比。同比在 fixture 构建时由两期
    // 年末值计算，并在 definition 中保留两条上游观察值 ID。
    for (const metric of selectMarketFixturesForIngestion(
      fixtureMarketMetrics,
      ingestOptions,
    )) {
      const metricId = requireId(metric.id, metric.metricCode);
      const draft = await governance.createDraft({
        actor: editor,
        changeReason: marketReadbackReason,
        entityKey: metricId,
        entityType: "market_metric",
        payload: {
          applicationScope: metric.applicationScope ?? null,
          countryIso3: metric.countryIso3,
          currencyCode: metric.currencyCode ?? null,
          dataSourceId: metric.dataSourceId,
          definition: metric.definition,
          id: metricId,
          isDemo: metric.isDemo,
          methodologyVersion: metric.methodologyVersion,
          metricCode: metric.metricCode,
          metricName: metric.metricName,
          periodEnd: metric.periodEnd,
          periodStart: metric.periodStart,
          publishedOn: metric.publishedOn ?? null,
          unitCode: metric.unitCode,
          valueNumeric: Number(metric.valueNumeric),
          verifiedAt: requireVerifiedAt(
            metric.verifiedAt,
            `${metric.countryIso3}:${metric.metricCode}:${metric.applicationScope}:${metric.periodStart}`,
          ),
        },
      });
      await governance.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: marketReadbackReason,
      });
      await governance.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: marketReadbackReason,
      });
      process.stdout.write(
        `market_metric ${metric.countryIso3}/${metric.applicationScope}/${metric.metricCode}/${metric.periodStart}: published\n`,
      );
    }

    // 2a.5) 辖区与国家成员关系（治理发布，ADR-043）。
    for (const jurisdiction of fixtureJurisdictions.filter((row) => {
      if (marketOnly) {
        return false;
      }
      const jurisdictionId = requireId(row.id, row.code);
      return targetSelection
        ? targetSelection.jurisdictionIds.has(jurisdictionId)
        : fullIngestSelection.jurisdictionIds.has(jurisdictionId);
    })) {
      const jurisdictionId = requireId(jurisdiction.id, jurisdiction.code);
      const memberships = selectJurisdictionMembershipsForIngest({
        jurisdictionId,
        signedCountryIso3s: ingestedCountryMemberships,
        targetCountryIso3: targetSelection?.countryIso3,
      })
        .map((membership) => ({
          countryIso3: membership.countryIso3,
          dataSourceId: membership.dataSourceId,
          isDemo: membership.isDemo,
          validFrom: membership.validFrom,
          validTo: membership.validTo ?? null,
          verifiedAt: requireVerifiedAt(
            membership.verifiedAt,
            `jurisdiction membership ${membership.countryIso3}`,
          ),
        }));
      const draft = await governance.createDraft({
        actor: editor,
        changeReason: signoffReason,
        entityKey: jurisdictionId,
        entityType: "jurisdiction",
        payload: {
          code: jurisdiction.code,
          countryIso3: jurisdiction.countryIso3 ?? null,
          dataSourceId: jurisdiction.dataSourceId,
          id: jurisdictionId,
          isDemo: jurisdiction.isDemo,
          memberships,
          name: jurisdiction.name,
          type: jurisdiction.type,
          verifiedAt: requireVerifiedAt(
            jurisdiction.verifiedAt,
            `jurisdiction ${jurisdiction.code}`,
          ),
          websiteUrl: jurisdiction.websiteUrl ?? null,
        },
      });
      await governance.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: signoffReason,
      });
      await governance.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: signoffReason,
      });
      process.stdout.write(
        `jurisdiction ${jurisdiction.code} (${memberships.length} memberships): published\n`,
      );
    }

    // 五门槛复核降级为 no-data 的历史法规必须先通过治理归档；仅从
    // fixture/allowlist 移除并不会停用目标库中已经发布的旧限值。
    const countriesToRetire = targetSelection
      ? [targetSelection.countryIso3]
      : [...retiredRegulationIdsByCountry.keys()].filter((countryIso3) =>
          ingestedCountryMemberships.has(countryIso3),
        );
    for (const countryIso3 of marketOnly ? [] : countriesToRetire) {
      const retiredRegulationIds = retiredRegulationIdsByCountry.get(countryIso3);
      if (!retiredRegulationIds) {
        continue;
      }
      const activeRetiredRegulations = await database
        .select({ id: schema.regulations.id })
        .from(schema.regulations)
        .where(
          and(
            inArray(schema.regulations.id, retiredRegulationIds),
            isNull(schema.regulations.archivedAt),
          ),
        );
      for (const regulation of activeRetiredRegulations) {
        await governance.archiveEntity({
          actor: reviewer,
          entityKey: regulation.id,
          entityType: "regulation",
          reason:
            "Five-gate source review found no publishable new-engine regulation/limit table; preserve all four application scopes as no-data.",
        });
        process.stdout.write(
          `regulation ${regulation.id}: archived after five-gate no-data review\n`,
        );
      }
    }

    // 2b) 法规与限值（治理发布）。
    // 限值 id 每次运行重新生成：publishDraft 的替换语义是“归档旧限值行 +
    // 插入新限值行”，固定 id 会与已归档行主键冲突；重跑因此可幂等，
    // 历史限值保留在归档中。
    const limitsByRegulation = new Map<string, unknown[]>();
    for (const limit of allFixtureLimits) {
      const selectedRegulationIds = targetSelection
        ? targetSelection.regulationIds
        : fullIngestSelection.regulationIds;
      if (!selectedRegulationIds.has(limit.regulationId)) {
        continue;
      }
      const list = limitsByRegulation.get(limit.regulationId) ?? [];
      list.push({
        applicationScope: limit.applicationScope,
        dataSourceId: limit.dataSourceId,
        id: randomUUID(),
        isDemo: limit.isDemo,
        limitValue: limit.limitValue,
        measurementBasis: limit.measurementBasis ?? null,
        pollutantCode: limit.pollutantCode,
        powerMaxKw: limit.powerMaxKw ?? null,
        powerMinKw: limit.powerMinKw ?? null,
        testCycleCode: limit.testCycleCode ?? null,
        unitCode: limit.unitCode,
        validFrom: limit.validFrom,
        validTo: limit.validTo ?? null,
        verifiedAt: requireVerifiedAt(
          limit.verifiedAt,
          `limit ${limit.id}`,
        ),
      });
      limitsByRegulation.set(limit.regulationId, list);
    }

    for (const regulation of fixtureRegulations.filter((row) => {
      if (marketOnly) {
        return false;
      }
      const regulationId = requireId(row.id, row.canonicalName);
      return targetSelection
        ? targetSelection.regulationIds.has(regulationId)
        : fullIngestSelection.regulationIds.has(regulationId);
    })) {
      const regulationId = requireId(regulation.id, regulation.canonicalName);
      const limits = limitsByRegulation.get(regulationId) ?? [];
      const limitsUnavailable =
        acceptedLimitUnavailableRegulationIdSet.has(regulationId);
      if (limits.length === 0 && !limitsUnavailable) {
        throw new Error(`Regulation ${regulationId} has no limits to publish.`);
      }
      const draft = await governance.createDraft({
        actor: editor,
        changeReason: signoffReason,
        entityKey: regulationId,
        entityType: "regulation",
        payload: {
          adoptedOn: regulation.adoptedOn ?? null,
          canonicalName: regulation.canonicalName,
          citationCode: regulation.citationCode ?? null,
          dataSourceId: regulation.dataSourceId,
          effectiveFrom: regulation.effectiveFrom ?? null,
          effectiveTo: regulation.effectiveTo ?? null,
          id: regulationId,
          isDemo: regulation.isDemo,
          jurisdictionId: regulation.jurisdictionId,
          limits,
          limitsUnavailable,
          proposedOn: regulation.proposedOn ?? null,
          status: regulation.status,
          summary: regulation.summary ?? null,
          verifiedAt: requireVerifiedAt(
            regulation.verifiedAt,
            `regulation ${regulationId}`,
          ),
        },
      });
      await governance.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: signoffReason,
      });
      await governance.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: signoffReason,
      });
      process.stdout.write(
        `regulation ${regulation.citationCode} (${limits.length} limits): published\n`,
      );
    }

    // 2c) 国家覆盖状态 planned → covered（治理发布）。
    const countriesToPublish = targetSelection
      ? [targetSelection.countryIso3]
      : coveredCountryIso3;
    for (const iso3 of marketOnly ? [] : countriesToPublish) {
      const entry = countryCatalog.find((row) => row.iso3 === iso3);
      if (!entry) {
        throw new Error(`Catalog entry for ${iso3} is missing.`);
      }
      const draft = await governance.createDraft({
        actor: editor,
        changeReason: signoffReason,
        entityKey: iso3,
        entityType: "country",
        payload: {
          dataCoverageStatus: "covered",
          dataSourceId: DIRECTORY_SOURCE_ID,
          isDemo: false,
          iso2: entry.iso2,
          iso3: entry.iso3,
          nameEn: entry.nameEn,
          nameLocal: null,
          regionCode: entry.regionCode,
          subregionCode: entry.subregionCode,
          verifiedAt: countrySignoffVerifiedAt(iso3),
        },
      });
      await governance.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: signoffReason,
      });
      await governance.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: signoffReason,
      });
      process.stdout.write(`country ${iso3}: coverage -> covered\n`);
    }

    if (marketOnly) {
      const expectedById = new Map(
        fixtureMarketMetrics.map((metric) => [
          requireId(metric.id, metric.metricCode),
          {
            dataSourceId: metric.dataSourceId,
            valueNumeric: Number(metric.valueNumeric),
          },
        ]),
      );
      const rows = await database
        .select({
          dataSourceId: schema.marketMetrics.dataSourceId,
          id: schema.marketMetrics.id,
          sourceType: schema.dataSources.sourceType,
          valueNumeric: schema.marketMetrics.valueNumeric,
        })
        .from(schema.marketMetrics)
        .innerJoin(
          schema.dataSources,
          eq(schema.marketMetrics.dataSourceId, schema.dataSources.id),
        )
        .where(
          and(
            inArray(schema.marketMetrics.countryIso3, [
              "BRA",
              "CHN",
              "DEU",
              "USA",
            ]),
            inArray(schema.marketMetrics.metricCode, [
              "REGISTERED_FLEET_YEAR_END",
              "REGISTERED_FLEET_YOY_CHANGE_PCT",
            ]),
            isNull(schema.marketMetrics.archivedAt),
            isNull(schema.dataSources.archivedAt),
          ),
        );
      const passed =
        rows.length === expectedById.size &&
        rows.every((row) => {
          const expected = expectedById.get(row.id);
          return (
            expected !== undefined &&
            expected.dataSourceId === row.dataSourceId &&
            expected.valueNumeric === Number(row.valueNumeric) &&
            row.sourceType !== "official-regulation"
          );
        });
      process.stdout.write(
        `${passed ? "PASS" : "FAIL"}  24 signed market observations have unique market-source identities\n`,
      );
      if (!passed) {
        process.exitCode = 1;
      }
      return;
    }

    // 3) 验收查询（与 acceptance-fixtures.test.ts 同一组期望）。
    const regulationRepository = createRegulationRepository(database);
    type EffectiveRegulationRows = Awaited<
      ReturnType<typeof regulationRepository.findEffectiveByCountry>
    >;
    const cfr1039RoundedPowerCases = [
      {
        powerMaxKw: 7.5,
        powerMinKw: 0,
        powerKw: 7.499,
        testCycleCode: "NRTC AND NRSC (6-mode OR 8-mode/RMC)",
        values: { CO: 8, "NOX+NMHC": 7.5, PM: 0.4 },
      },
      {
        powerMaxKw: 18.501,
        powerMinKw: 7.5,
        powerKw: 7.5,
        testCycleCode: "NRTC AND NRSC (6-mode OR 8-mode/RMC)",
        values: { CO: 6.6, "NOX+NMHC": 7.5, PM: 0.4 },
      },
      {
        powerMaxKw: 18.501,
        powerMinKw: 7.5,
        powerKw: 18.5,
        testCycleCode: "NRTC AND NRSC (6-mode OR 8-mode/RMC)",
        values: { CO: 6.6, "NOX+NMHC": 7.5, PM: 0.4 },
      },
      {
        powerMaxKw: 36.501,
        powerMinKw: 18.501,
        powerKw: 18.501,
        testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
        values: { CO: 5.5, "NOX+NMHC": 4.7, PM: 0.03 },
      },
      {
        powerMaxKw: 36.501,
        powerMinKw: 18.501,
        powerKw: 36.5,
        testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
        values: { CO: 5.5, "NOX+NMHC": 4.7, PM: 0.03 },
      },
      {
        powerMaxKw: 55.5,
        powerMinKw: 36.501,
        powerKw: 36.501,
        testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
        values: { CO: 5, "NOX+NMHC": 4.7, PM: 0.03 },
      },
      {
        powerMaxKw: 55.5,
        powerMinKw: 36.501,
        powerKw: 55.499,
        testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
        values: { CO: 5, "NOX+NMHC": 4.7, PM: 0.03 },
      },
      {
        powerMaxKw: 129.5,
        powerMinKw: 55.5,
        powerKw: 55.5,
        testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
        values: { CO: 5, NMHC: 0.19, NOX: 0.4, PM: 0.02 },
      },
      {
        powerMaxKw: 129.5,
        powerMinKw: 55.5,
        powerKw: 129.499,
        testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
        values: { CO: 5, NMHC: 0.19, NOX: 0.4, PM: 0.02 },
      },
      {
        powerMaxKw: 560.501,
        powerMinKw: 129.5,
        powerKw: 129.5,
        testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
        values: { CO: 3.5, NMHC: 0.19, NOX: 0.4, PM: 0.02 },
      },
      {
        powerMaxKw: 560.501,
        powerMinKw: 129.5,
        powerKw: 560.5,
        testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
        values: { CO: 3.5, NMHC: 0.19, NOX: 0.4, PM: 0.02 },
      },
    ] as const;
    const firstRawPowerAboveCfr1039Rounded560Kw = 560.501;
    const matchesCfr1039RoundedPowerCase = (
      rows: EffectiveRegulationRows,
      expected: (typeof cfr1039RoundedPowerCases)[number],
      regulationId: string,
      validFrom: string,
      verifiedAt: string,
    ): boolean => {
      const values = new Map(
        rows.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      return (
        rows.length === Object.keys(expected.values).length &&
        Object.entries(expected.values).every(
          ([pollutantCode, expectedValue]) =>
            values.get(pollutantCode) === expectedValue,
        ) &&
        rows.every(
          (row) =>
            row.regulationId === regulationId &&
            row.limit.sourceId === acceptanceFixtureIds.source.usEcfr1039 &&
            row.limit.testCycleCode === expected.testCycleCode &&
            row.limit.validFrom === validFrom &&
            row.limit.verifiedAt.toISOString() === verifiedAt &&
            Number(row.limit.powerMinKw) === expected.powerMinKw &&
            Number(row.limit.powerMaxKw) === expected.powerMaxKw,
        )
      );
    };

    const signedRoadCountryIso3s = [
      "THA",
      "BIH",
      "MNE",
      "NPL",
      "UKR",
      "BGD",
      "BOL",
      "ZAF",
      "ARE",
      "SAU",
      "ECU",
      "PHL",
      "PAK",
      "RWA",
    ] as const;
    type SignedRoadCountryIso3 = (typeof signedRoadCountryIso3s)[number];
    type SignedRoadBoundaryConfig = {
      beforeEffectiveFrom: string;
      currentAsOf?: string;
      effectiveFrom: string;
      expectedRoadRows: number;
      expectedValues: Readonly<Record<string, number>>;
      finalIncludedAsOf?: string;
      firstExcludedAsOf?: string;
      includedPowerKw?: number;
      excludedPowerKw?: number;
      name: string;
      powerKw: number;
      regulationId: string;
    };
    const signedRoadBoundaryConfigs: Record<
      SignedRoadCountryIso3,
      SignedRoadBoundaryConfig
    > = {
      THA: {
        beforeEffectiveFrom: "2023-12-31",
        effectiveFrom: "2024-01-01",
        expectedRoadRows: 9,
        expectedValues: {
          "ELR:OPACITY": 0.5,
          "ESC:NOX": 2,
          "ETC:PM": 0.03,
        },
        name:
          "THA TIS 3046 starts exactly on 2024-01-01 and preserves non-road no-data",
        powerKw: 150,
        regulationId:
          acceptanceFixtureIds.regulation.thailandHeavyDieselLevel6,
      },
      BIH: {
        beforeEffectiveFrom: "2019-05-31",
        effectiveFrom: "2019-06-01",
        expectedRoadRows: 12,
        expectedValues: {
          "WHSC:PN": 800,
          "WHTC:NOX": 460,
        },
        name:
          "BIH UN R49/06 starts exactly on 2019-06-01 and preserves non-road no-data",
        powerKw: 150,
        regulationId: acceptanceFixtureIds.regulation.bosniaR49Series06,
      },
      MNE: {
        beforeEffectiveFrom: "2018-10-14",
        effectiveFrom: "2018-10-15",
        excludedPowerKw: 15,
        expectedRoadRows: 16,
        expectedValues: {
          "WHSC:PN": 800,
          "WHTC:NOX": 460,
          "WNTE:NOX": 600,
          "WNTE:PM": 16,
        },
        includedPowerKw: 15.001,
        name:
          "MNE Euro VI starts exactly on 2018-10-15 with a strict >15 kW boundary",
        powerKw: 150,
        regulationId: acceptanceFixtureIds.regulation.montenegroEuroVi,
      },
      NPL: {
        beforeEffectiveFrom: "2025-06-22",
        effectiveFrom: "2025-06-23",
        expectedRoadRows: 16,
        expectedValues: {
          "WHSC:PN": 800,
          "WHTC:NOX": 460,
          "WNTE:NOX": 600,
          "WNTE:PM": 16,
        },
        name:
          "NPL Standard 2082 starts exactly on 2025-06-23 and preserves excluded machinery no-data",
        powerKw: 150,
        regulationId: acceptanceFixtureIds.regulation.nepalHeavyVehicle2082,
      },
      UKR: {
        beforeEffectiveFrom: "2015-12-31",
        effectiveFrom: "2016-01-01",
        expectedRoadRows: 9,
        expectedValues: {
          "ESC/ELR:NOX": 2,
          "ESC/ELR:OPACITY": 0.5,
          "ETC:PM": 0.03,
        },
        finalIncludedAsOf: "2026-12-31",
        firstExcludedAsOf: "2027-01-01",
        name:
          "UKR Euro V starts on 2016-01-01, remains through 2026-12-31 and fails closed on 2027-01-01",
        powerKw: 150,
        regulationId: acceptanceFixtureIds.regulation.ukraineRoadEuroV,
      },
      BGD: {
        beforeEffectiveFrom: "2022-07-25",
        effectiveFrom: "2022-07-26",
        expectedRoadRows: 4,
        expectedValues: {
          "88/77/EEC (91/542/EEC):CO": 4,
          "88/77/EEC (91/542/EEC):HC": 1.1,
          "88/77/EEC (91/542/EEC):NOX": 7,
          "88/77/EEC (91/542/EEC):PM": 0.15,
        },
        name:
          "BGD Air Pollution Rules Schedule 2 starts exactly on 2022-07-26 and preserves non-road no-data",
        powerKw: 150,
        regulationId:
          acceptanceFixtureIds.regulation.bangladeshHeavyDiesel2022,
      },
      BOL: {
        beforeEffectiveFrom: "2022-03-31",
        effectiveFrom: "2022-04-01",
        expectedRoadRows: 4,
        expectedValues: {
          "ECE 49:CO": 4,
          "ECE 49:HC": 1.1,
          "ECE 49:NOX": 7,
          "ECE 49:PM": 0.15,
        },
        name:
          "BOL RM 064 Annex III starts exactly on 2022-04-01 and preserves non-road no-data",
        powerKw: 150,
        regulationId: acceptanceFixtureIds.regulation.boliviaRm064HeavyDiesel,
      },
      ZAF: {
        beforeEffectiveFrom: "2009-12-31",
        effectiveFrom: "2010-01-01",
        expectedRoadRows: 4,
        expectedValues: {
          "ECE R49.02B / European 13-mode:CO": 4,
          "ECE R49.02B / European 13-mode:HC": 1.1,
          "ECE R49.02B / European 13-mode:NOX": 7,
          "ECE R49.02B / European 13-mode:PM": 0.15,
        },
        name:
          "ZAF SANS/ECE R49.02B representative route starts at the full manufacture/import boundary and preserves non-road no-data",
        powerKw: 150,
        regulationId: acceptanceFixtureIds.regulation.southAfricaR4902B,
      },
      ARE: {
        beforeEffectiveFrom: "2027-06-30",
        currentAsOf: "2027-07-01",
        effectiveFrom: "2027-07-01",
        expectedRoadRows: 12,
        expectedValues: {
          "WHSC:NOX": 400,
          "WHSC:PN": 800,
          "WHTC:NOX": 460,
          "WHTC:PN": 600,
        },
        name:
          "ARE Euro VI/B generic road limits start at the all-import boundary on 2027-07-01 and preserve the 2026 new-model caveat plus non-road no-data",
        powerKw: 150,
        regulationId: acceptanceFixtureIds.regulation.uaeHeavyVehicleEuro6B,
      },
      SAU: {
        beforeEffectiveFrom: "2025-12-31",
        effectiveFrom: "2026-01-01",
        expectedRoadRows: 9,
        expectedValues: {
          "ELR:OPACITY": 0.5,
          "ESC:NOX": 2,
          "ETC:PM": 0.03,
        },
        name:
          "SAU MY2026 Euro V representative route preserves the normalized model-year and non-road no-data boundaries",
        powerKw: 150,
        regulationId:
          acceptanceFixtureIds.regulation.saudiHeavyVehicleEuroVMy2026,
      },
      ECU: {
        beforeEffectiveFrom: "2009-02-06",
        effectiveFrom: "2009-02-07",
        expectedRoadRows: 4,
        expectedValues: {
          "ECE-49:CO": 4,
          "ECE-49:HC": 1.1,
          "ECE-49:NOX": 7,
          "ECE-49:PM": 0.15,
        },
        name:
          "ECU RTE 017 / NTE 2207 ECE-49 route starts exactly on 2009-02-07 and preserves the explicit machinery exclusions",
        powerKw: 150,
        regulationId: acceptanceFixtureIds.regulation.ecuadorHeavyDieselRte017,
      },
      PHL: {
        beforeEffectiveFrom: "2015-12-31",
        effectiveFrom: "2016-01-01",
        expectedRoadRows: 9,
        expectedValues: {
          "ESC:CO": 1.5,
          "ESC:HC": 0.46,
          "ESC:NOX": 3.5,
          "ESC:PM": 0.02,
          "ELR:OPACITY": 0.5,
          "ETC:NOX": 3.5,
          "ETC:PM": 0.03,
        },
        name:
          "PHL LTO MC AVT-2015-1946 starts Euro IV for new heavy-duty vehicles exactly on 2016-01-01 and preserves non-road no-data",
        powerKw: 150,
        regulationId:
          acceptanceFixtureIds.regulation.philippinesHeavyDieselEuroIv,
      },
      RWA: {
        beforeEffectiveFrom: "2023-01-22",
        effectiveFrom: "2023-01-23",
        expectedRoadRows: 9,
        expectedValues: {
          "ELR:OPACITY": 0.5,
          "ESC:CO": 1.5,
          "ESC:HC": 0.46,
          "ESC:NOX": 3.5,
          "ESC:PM": 0.02,
          "ETC:CO": 4,
          "ETC:NMHC": 0.55,
          "ETC:NOX": 3.5,
          "ETC:PM": 0.03,
        },
        name:
          "RWA RS EAS 1047:2022 Euro IV new-heavy-duty road pathway starts exactly on 2023-01-23 and preserves non-road no-data",
        powerKw: 150,
        regulationId: acceptanceFixtureIds.regulation.rwandaRoadEuroIv,
      },
      PAK: {
        beforeEffectiveFrom: "2012-06-30",
        effectiveFrom: "2012-07-01",
        expectedRoadRows: 4,
        expectedValues: {
          "ECE-R-49:CO": 4,
          "ECE-R-49:HC": 1.1,
          "ECE-R-49:NOX": 7,
          "ECE-R-49:PM": 0.15,
        },
        name:
          "PAK S.R.O. 72(KE)/2009 applies Pak-II ECE-R-49 to imported and locally manufactured truck/bus diesel engines from 2012-07-01",
        powerKw: 150,
        regulationId: acceptanceFixtureIds.regulation.pakistanHeavyDieselPakIi,
      },
    };
    const signedRoadCountrySet = new Set<string>(signedRoadCountryIso3s);
    const runSignedRoadBoundaryCheck = async (
      countryIso3: SignedRoadCountryIso3,
    ): Promise<boolean> => {
      const config = signedRoadBoundaryConfigs[countryIso3];
      const currentAsOf = config.currentAsOf ?? "2026-08-10";
      const query = (
        applicationScope:
          | "on-road-truck"
          | "on-road-bus"
          | "construction"
          | "agriculture",
        asOf: string,
        powerKw = config.powerKw,
      ) =>
        regulationRepository.findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3,
          powerKw,
        });
      const [
        before,
        truckAtStart,
        busAtStart,
        truckCurrent,
        busCurrent,
        construction,
        agriculture,
      ] = await Promise.all([
        query("on-road-truck", config.beforeEffectiveFrom),
        query("on-road-truck", config.effectiveFrom),
        query("on-road-bus", config.effectiveFrom),
        query("on-road-truck", currentAsOf),
        query("on-road-bus", currentAsOf),
        query("construction", currentAsOf),
        query("agriculture", currentAsOf),
      ]);
      const roadRows = [
        ...truckAtStart,
        ...busAtStart,
        ...truckCurrent,
        ...busCurrent,
      ];
      const values = new Map(
        truckCurrent.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      const expectedValuesMatch = Object.entries(config.expectedValues).every(
        ([key, value]) => values.get(key) === value,
      );
      const [includedPowerRows, excludedPowerRows, finalIncludedRows, firstExcludedRows] =
        await Promise.all([
          config.includedPowerKw === undefined
            ? Promise.resolve(null)
            : query(
                "on-road-truck",
                config.effectiveFrom,
                config.includedPowerKw,
              ),
          config.excludedPowerKw === undefined
            ? Promise.resolve(null)
            : query(
                "on-road-truck",
                currentAsOf,
                config.excludedPowerKw,
              ),
          config.finalIncludedAsOf === undefined
            ? Promise.resolve(null)
            : query("on-road-truck", config.finalIncludedAsOf),
          config.firstExcludedAsOf === undefined
            ? Promise.resolve(null)
            : query("on-road-truck", config.firstExcludedAsOf),
        ]);
      return (
        before.length === 0 &&
        truckAtStart.length === config.expectedRoadRows &&
        busAtStart.length === config.expectedRoadRows &&
        truckCurrent.length === config.expectedRoadRows &&
        busCurrent.length === config.expectedRoadRows &&
        roadRows.every((row) => row.regulationId === config.regulationId) &&
        construction.length === 0 &&
        agriculture.length === 0 &&
        expectedValuesMatch &&
        (includedPowerRows === null ||
          includedPowerRows.length === config.expectedRoadRows) &&
        (excludedPowerRows === null || excludedPowerRows.length === 0) &&
        (finalIncludedRows === null ||
          finalIncludedRows.length === config.expectedRoadRows) &&
        (firstExcludedRows === null || firstExcludedRows.length === 0)
      );
    };

    const signedNoDataCountryIso3s = [
      "MDA",
      "ALB",
      "SRB",
      "MKD",
      "TJK",
      "TKM",
      "AZE",
      "AFG",
      "AGO",
      "BDI",
      "BEN",
      "BFA",
      "BHS",
      "MAR",
      "KEN",
      "BLZ",
      "CUB",
      "GUY",
      "HTI",
      "JAM",
      "TZA",
      "ZMB",
      "ZWE",
      "CIV",
      "NGA",
      "BWA",
      "NAM",
      "UGA",
      "SWZ",
      "KHM",
      "LAO",
      "MMR",
      "MNG",
    ] as const;
    const runSignedNoDataBoundaryCheck = async (
      countryIso3: (typeof signedNoDataCountryIso3s)[number],
    ): Promise<boolean> => {
      const rows = await Promise.all(
        ([
          "on-road-truck",
          "on-road-bus",
          "construction",
          "agriculture",
        ] as const).map((applicationScope) =>
          regulationRepository.findEffectiveByCountry({
            applicationScope,
            asOf: "2026-08-11",
            countryIso3,
            powerKw: 150,
          }),
        ),
      );
      return rows.every((result) => result.length === 0);
    };

    const centralAsiaPublishedCountryIso3s = ["KAZ", "KGZ", "UZB"] as const;
    const centralAsiaPublishedCountrySet = new Set<string>(
      centralAsiaPublishedCountryIso3s,
    );
    type CentralAsiaPublishedCountryIso3 =
      (typeof centralAsiaPublishedCountryIso3s)[number];
    const centralAsiaRegulationIds = {
      KAZ: {
        agriculture:
          acceptanceFixtureIds.regulation.kazakhstanAgricultureStageIIIA,
        road: acceptanceFixtureIds.regulation.kazakhstanRoadClass5,
      },
      KGZ: {
        agriculture:
          acceptanceFixtureIds.regulation.kyrgyzstanAgricultureStageIIIA,
        road: acceptanceFixtureIds.regulation.kyrgyzstanRoadClass5,
      },
      UZB: {
        agriculture:
          acceptanceFixtureIds.regulation.uzbekistanAgricultureStageIIIA,
        road: null,
      },
    } as const;
    const runCentralAsiaBoundaryCheck = async (
      countryIso3: CentralAsiaPublishedCountryIso3,
    ): Promise<boolean> => {
      const query = (
        applicationScope:
          | "on-road-truck"
          | "on-road-bus"
          | "construction"
          | "agriculture",
        asOf: string,
        powerKw: number,
      ) =>
        regulationRepository.findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3,
          powerKw,
        });
      const powerBoundaries =
        countryIso3 === "UZB"
          ? ([129.999, 130, 560, 560.001] as const)
          : ([19, 19.001, 37, 75, 130, 560, 560.001] as const);
      const expectedPowerCounts =
        countryIso3 === "UZB"
          ? ([0, 3, 3, 0] as const)
          : ([0, 3, 3, 3, 3, 3, 0] as const);
      const [truckRows, busRows, constructionRows, agricultureRows, ...powerRows] =
        await Promise.all([
          query("on-road-truck", "2026-08-10", 150),
          query("on-road-bus", "2026-08-10", 150),
          query("construction", "2026-08-10", 150),
          query("agriculture", "2026-08-10", 150),
          ...powerBoundaries.map((powerKw) =>
            query("agriculture", "2026-08-10", powerKw),
          ),
        ]);
      const beforeAgriculture = await query(
        "agriculture",
        countryIso3 === "UZB" ? "2025-09-30" : "2024-12-31",
        150,
      );
      const agricultureMatches =
        agricultureRows.length === 3 &&
        agricultureRows.every(
          (row) =>
            row.regulationId ===
              centralAsiaRegulationIds[countryIso3].agriculture &&
            row.limit.unitCode === "g/kWh",
        ) &&
        powerRows.every(
          (rows, index) => rows.length === expectedPowerCounts[index],
        ) &&
        beforeAgriculture.length === 0;

      if (countryIso3 === "UZB") {
        return (
          truckRows.length === 0 &&
          busRows.length === 0 &&
          constructionRows.length === 0 &&
          agricultureMatches
        );
      }

      const roadRows = [...truckRows, ...busRows];
      const roadCycleCounts = new Map<string, number>();
      for (const row of truckRows) {
        const cycle = row.limit.testCycleCode ?? "";
        roadCycleCounts.set(cycle, (roadCycleCounts.get(cycle) ?? 0) + 1);
      }
      const roadValues = new Map(
        truckRows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      const beforeRoad = await query(
        "on-road-truck",
        "2018-12-31",
        150,
      );
      const [earlyBandAtStart, laterBandBeforeStart, laterBandAtStart] =
        await Promise.all([
          query("agriculture", "2025-01-01", 37),
          query("agriculture", "2025-09-30", 75),
          query("agriculture", "2025-10-01", 75),
        ]);
      return (
        truckRows.length === 9 &&
        busRows.length === 9 &&
        roadRows.every(
          (row) =>
            row.regulationId === centralAsiaRegulationIds[countryIso3].road &&
            row.limit.sourceId === acceptanceFixtureIds.source.uneceR49Rev4,
        ) &&
        roadCycleCounts.get("ESC") === 4 &&
        roadCycleCounts.get("ETC") === 4 &&
        roadCycleCounts.get("ELR") === 1 &&
        roadValues.get("ESC:NOX") === 2 &&
        roadValues.get("ETC:PM") === 0.03 &&
        roadValues.get("ELR:OPACITY") === 0.5 &&
        constructionRows.length === 0 &&
        agricultureMatches &&
        beforeRoad.length === 0 &&
        earlyBandAtStart.length === 3 &&
        laterBandBeforeStart.length === 0 &&
        laterBandAtStart.length === 3
      );
    };

    const caucasusPublishedCountryIso3s = ["ARM", "BLR", "GEO"] as const;
    const caucasusPublishedCountrySet = new Set<string>(
      caucasusPublishedCountryIso3s,
    );
    type CaucasusPublishedCountryIso3 =
      (typeof caucasusPublishedCountryIso3s)[number];
    const caucasusRegulationIds = {
      ARM: {
        agriculture:
          acceptanceFixtureIds.regulation.armeniaAgricultureStageIIIA,
        road: acceptanceFixtureIds.regulation.armeniaRoadClass5,
        roadStart: "2019-01-01",
      },
      BLR: {
        agriculture:
          acceptanceFixtureIds.regulation.belarusAgricultureStageIIIA,
        road: acceptanceFixtureIds.regulation.belarusRoadClass5,
        roadStart: "2019-01-01",
      },
      GEO: {
        agriculture: null,
        road: acceptanceFixtureIds.regulation.georgiaRoadClass5,
        roadStart: "2025-01-01",
      },
    } as const;
    const runCaucasusBoundaryCheck = async (
      countryIso3: CaucasusPublishedCountryIso3,
    ): Promise<boolean> => {
      const query = (
        applicationScope:
          | "on-road-truck"
          | "on-road-bus"
          | "construction"
          | "agriculture",
        asOf: string,
        powerKw: number,
      ) =>
        regulationRepository.findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3,
          powerKw,
        });
      const config = caucasusRegulationIds[countryIso3];
      const beforeRoad =
        countryIso3 === "GEO" ? "2024-12-31" : "2018-12-31";
      const [
        truckRows,
        busRows,
        constructionRows,
        agricultureRows,
        roadRowsBeforeStart,
        roadRowsAtStart,
      ] = await Promise.all([
        query("on-road-truck", "2026-08-10", 150),
        query("on-road-bus", "2026-08-10", 150),
        query("construction", "2026-08-10", 150),
        query("agriculture", "2026-08-10", 150),
        query("on-road-truck", beforeRoad, 150),
        query("on-road-truck", config.roadStart, 150),
      ]);
      const roadRows = [...truckRows, ...busRows];
      const cycleCounts = new Map<string, number>();
      for (const row of truckRows) {
        const cycle = row.limit.testCycleCode ?? "";
        cycleCounts.set(cycle, (cycleCounts.get(cycle) ?? 0) + 1);
      }
      const roadValues = new Map(
        truckRows.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      const roadMatches =
        truckRows.length === 9 &&
        busRows.length === 9 &&
        roadRowsBeforeStart.length === 0 &&
        roadRowsAtStart.length === 9 &&
        constructionRows.length === 0 &&
        roadRows.every(
          (row) =>
            row.regulationId === config.road &&
            row.limit.sourceId === acceptanceFixtureIds.source.uneceR49Rev4 &&
            row.limit.pollutantCode !== "NH3",
        ) &&
        cycleCounts.get("ESC") === 4 &&
        cycleCounts.get("ETC") === 4 &&
        cycleCounts.get("ELR") === 1 &&
        roadValues.get("ESC:NOX") === 2 &&
        roadValues.get("ETC:PM") === 0.03 &&
        roadValues.get("ELR:OPACITY") === 0.5;

      if (!roadMatches) {
        return false;
      }
      if (countryIso3 === "GEO") {
        return agricultureRows.length === 0;
      }

      const [
        beforeAgriculture,
        earlyBandAtStart,
        laterBandBeforeStart,
        laterBandAtStart,
        ...powerRows
      ] = await Promise.all([
        query("agriculture", "2024-12-31", 37),
        query("agriculture", "2025-01-01", 37),
        query("agriculture", "2025-09-30", 75),
        query("agriculture", "2025-10-01", 75),
        ...[19, 19.001, 37, 75, 130, 560, 560.001].map((powerKw) =>
          query("agriculture", "2026-08-10", powerKw),
        ),
      ]);
      return (
        agricultureRows.length === 3 &&
        agricultureRows.every(
          (row) =>
            row.regulationId === config.agriculture &&
            row.limit.testCycleCode === "UN R96-02",
        ) &&
        beforeAgriculture.length === 0 &&
        earlyBandAtStart.length === 3 &&
        laterBandBeforeStart.length === 0 &&
        laterBandAtStart.length === 3 &&
        powerRows.map((rows) => rows.length).join(",") === "0,3,3,3,3,3,0"
      );
    };

    const runIsraelBoundaryCheck = async (): Promise<boolean> => {
      const query = (
        applicationScope:
          | "on-road-truck"
          | "on-road-bus"
          | "construction"
          | "agriculture",
        asOf: string,
        powerKw: number,
      ) =>
        regulationRepository.findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3: "ISR",
          powerKw,
        });
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
        query("on-road-truck", "2025-12-31", 150),
        query("construction", "2025-12-31", 150),
        query("on-road-truck", "2026-01-01", 150),
        query("on-road-bus", "2026-01-01", 150),
        query("construction", "2026-01-01", 150),
        query("construction", "2026-01-01", 560),
        query("construction", "2026-01-01", 560.001),
        query("agriculture", "2026-08-10", 150),
      ]);
      const roadValues = new Map(
        truck.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      const constructionValues = new Map(
        construction150.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      const at560 = new Map(
        construction560.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      const above560 = new Map(
        constructionAbove560.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      return (
        roadBefore.length === 0 &&
        constructionBefore.length === 0 &&
        truck.length === 12 &&
        bus.length === 12 &&
        [...truck, ...bus].every(
          (row) =>
            row.regulationId ===
            acceptanceFixtureIds.regulation.israelRoadEuroVi2026,
        ) &&
        roadValues.get("WHSC:NOX") === 400 &&
        roadValues.get("WHTC:PN") === 600 &&
        construction150.length === 5 &&
        construction150.every(
          (row) =>
            row.regulationId ===
              acceptanceFixtureIds.regulation.israelConstructionStageV2026 &&
            row.limit.testCycleCode === "NRSC/NRTC",
        ) &&
        constructionValues.get("NOX") === 0.4 &&
        constructionValues.get("PN") === 1000 &&
        construction560.length === 5 &&
        at560.get("NOX") === 0.4 &&
        at560.get("PM") === 0.015 &&
        constructionAbove560.length === 4 &&
        above560.get("NOX") === 3.5 &&
        above560.get("PM") === 0.045 &&
        agriculture.length === 0
      );
    };

    const runSriLankaBoundaryCheck = async (): Promise<boolean> => {
      const query = (
        applicationScope:
          | "on-road-truck"
          | "on-road-bus"
          | "construction"
          | "agriculture",
        asOf: string,
        powerKw: number,
      ) =>
        regulationRepository.findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3: "LKA",
          powerKw,
        });
      const constructionCycle =
        "ISO 8178-4 C1 (variable-speed) OR D2 (constant-speed)";
      const [
        roadBefore,
        constructionBefore,
        truck,
        bus,
        ...constructionAndAgriculture
      ] = await Promise.all([
        query("on-road-truck", "2018-07-12", 150),
        query("construction", "2018-07-12", 150),
        query("on-road-truck", "2018-07-13", 150),
        query("on-road-bus", "2018-07-13", 150),
        ...[7.999, 8, 19, 37, 75, 130].map((powerKw) =>
          query("construction", "2018-07-13", powerKw),
        ),
        query("agriculture", "2026-08-10", 150),
      ]);
      const constructionRows = constructionAndAgriculture.slice(0, 6);
      const agriculture = constructionAndAgriculture[6] ?? [];
      const roadValues = new Map(
        truck.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      const valuesFor = (pollutantCode: string) =>
        constructionRows.map((rows) =>
          Number(
            rows.find((row) => row.limit.pollutantCode === pollutantCode)
              ?.limit.limitValue,
          ),
        );
      return (
        roadBefore.length === 0 &&
        constructionBefore.length === 0 &&
        truck.length === 5 &&
        bus.length === 5 &&
        [...truck, ...bus].every(
          (row) =>
            row.regulationId ===
              acceptanceFixtureIds.regulation.sriLankaVehicleEmission2018 &&
            row.limit.validFrom === "2018-07-13",
        ) &&
        roadValues.get("CO") === 1.5 &&
        roadValues.get("THC") === 0.46 &&
        roadValues.get("NOX") === 3.5 &&
        roadValues.get("PM") === 0.02 &&
        roadValues.get("OPACITY") === 0.5 &&
        constructionRows.every(
          (rows) =>
            rows.length === 4 &&
            rows.every(
              (row) =>
                row.limit.testCycleCode === constructionCycle &&
                row.limit.validFrom === "2018-07-13",
            ) &&
            rows.some((row) => row.limit.pollutantCode === "HC+NOx") &&
            rows.every(
              (row) =>
                !["HC", "THC", "NOX"].includes(row.limit.pollutantCode),
            ),
        ) &&
        valuesFor("CO").join(",") === "8,6.6,5.5,5,5,3.5" &&
        valuesFor("HC+NOx").join(",") === "7.5,7.5,7.5,4.7,4,4" &&
        valuesFor("PM").join(",") === "0.8,0.8,0.6,0.4,0.3,0.2" &&
        valuesFor("OPACITY").every((value) => value === 3.25) &&
        agriculture.length === 0
      );
    };

    const runAustraliaBoundaryCheck = async (): Promise<boolean> => {
      const query = (
        applicationScope:
          | "on-road-truck"
          | "on-road-bus"
          | "construction"
          | "agriculture",
        asOf: string,
      ) =>
        regulationRepository.findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3: "AUS",
          powerKw: 300,
        });
      const [
        beforeFullCoverage,
        adr803AtStart,
        adr803FinalDay,
        adr804AtStart,
        busCurrent,
        construction,
        agriculture,
      ] = await Promise.all([
        query("on-road-truck", "2010-12-31"),
        query("on-road-truck", "2011-01-01"),
        query("on-road-truck", "2025-10-31"),
        query("on-road-truck", "2025-11-01"),
        query("on-road-bus", "2026-08-10"),
        query("construction", "2026-08-10"),
        query("agriculture", "2026-08-10"),
      ]);
      const adr804Values = new Map(
        adr804AtStart.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );
      const adr803Rows = [...adr803AtStart, ...adr803FinalDay];
      const adr804Rows = [...adr804AtStart, ...busCurrent];

      return (
        beforeFullCoverage.length === 0 &&
        adr803AtStart.length === 9 &&
        adr803FinalDay.length === 9 &&
        adr803Rows.every(
          (row) =>
            row.citationCode === "ADR 80/03" &&
            row.limit.sourceId === acceptanceFixtureIds.source.australiaAdr80_03,
        ) &&
        adr803AtStart.some(
          (row) =>
            row.limit.testCycleCode === "ELR" &&
            row.limit.pollutantCode === "OPACITY" &&
            Number(row.limit.limitValue) === 0.5 &&
            row.limit.unitCode === "m-1",
        ) &&
        adr804AtStart.length === 12 &&
        busCurrent.length === 12 &&
        adr804Rows.every(
          (row) =>
            row.citationCode === "ADR 80/04" &&
            row.limit.sourceId === acceptanceFixtureIds.source.australiaAdr80_04,
        ) &&
        adr804Values.get("WHSC:CO") === 1500 &&
        adr804Values.get("WHSC:THC") === 130 &&
        adr804Values.get("WHSC:NOX") === 400 &&
        adr804Values.get("WHSC:NH3") === 10 &&
        adr804Values.get("WHSC:PM") === 10 &&
        adr804Values.get("WHSC:PN") === 800 &&
        adr804Values.get("WHTC:CO") === 4000 &&
        adr804Values.get("WHTC:THC") === 160 &&
        adr804Values.get("WHTC:NOX") === 460 &&
        adr804Values.get("WHTC:NH3") === 10 &&
        adr804Values.get("WHTC:PM") === 10 &&
        adr804Values.get("WHTC:PN") === 600 &&
        construction.length === 0 &&
        agriculture.length === 0
      );
    };

    const runChinaNonroadBoundaryCheck = async (): Promise<boolean> => {
      const query = (
        applicationScope: "construction" | "agriculture",
        asOf: string,
        powerKw: number,
      ) =>
        regulationRepository.findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3: "CHN",
          powerKw,
        });
      const scopes = ["construction", "agriculture"] as const;
      const stage3PowerCases = [
        {
          powerMaxKw: 37,
          powerMinKw: 0,
          powerKw: 36.999,
          values: { CO: 5.5, "HC+NOx": 7.5, PM: 0.6 },
        },
        {
          powerMaxKw: 75,
          powerMinKw: 37,
          powerKw: 37,
          values: { CO: 5, "HC+NOx": 4.7, PM: 0.4 },
        },
        {
          powerMaxKw: 130,
          powerMinKw: 75,
          powerKw: 75,
          values: { CO: 5, "HC+NOx": 4, PM: 0.3 },
        },
        {
          powerMaxKw: 560.001,
          powerMinKw: 130,
          powerKw: 130,
          values: { CO: 3.5, "HC+NOx": 4, PM: 0.2 },
        },
        {
          powerMaxKw: 560.001,
          powerMinKw: 130,
          powerKw: 560,
          values: { CO: 3.5, "HC+NOx": 4, PM: 0.2 },
        },
      ] as const;
      const transitionRows = await Promise.all(
        scopes.flatMap((applicationScope) => [
          query(applicationScope, "2016-03-31", 150),
          query(applicationScope, "2016-04-01", 150),
          query(applicationScope, "2022-11-30", 150),
          query(applicationScope, "2022-12-01", 150),
        ]),
      );
      const currentRows = await Promise.all(
        scopes.flatMap((applicationScope) =>
          [36.999, 37, 56, 130, 560, 560.001].map((powerKw) =>
            query(applicationScope, "2026-08-11", powerKw),
          ),
        ),
      );
      const stage3PowerRows = await Promise.all(
        scopes.flatMap((applicationScope) =>
          stage3PowerCases.map(({ powerKw }) =>
            query(applicationScope, "2022-11-30", powerKw),
          ),
        ),
      );
      const details = await countryRepository.findDetailsByIso3({
        asOf: "2026-08-11",
        iso3: "CHN",
      });
      const cnMeeJurisdiction = details?.jurisdictions.find(
        (jurisdiction) =>
          jurisdiction.id === acceptanceFixtureIds.jurisdiction.cnMee,
      );
      const stage3AtStartRows = [transitionRows[1], transitionRows[5]].flatMap(
        (rows) => rows ?? [],
      );
      const stage4AtStartRows = [transitionRows[3], transitionRows[7]].flatMap(
        (rows) => rows ?? [],
      );
      const stage3ContinuationRows = [currentRows[5], currentRows[11]].flatMap(
        (rows) => rows ?? [],
      );
      const stage4CurrentRows = currentRows.flatMap((rows, index) =>
        index === 5 || index === 11 ? [] : rows,
      );
      const valuesFor = (rows: EffectiveRegulationRows): Map<string, number> =>
        new Map(
          rows.map((row) => [
            row.limit.pollutantCode,
            Number(row.limit.limitValue),
          ]),
        );
      const matchesStage3PowerCase = (
        rows: EffectiveRegulationRows,
        expected: (typeof stage3PowerCases)[number],
      ): boolean => {
        const values = valuesFor(rows);
        return (
          rows.length === Object.keys(expected.values).length &&
          Object.entries(expected.values).every(
            ([pollutantCode, expectedValue]) =>
              values.get(pollutantCode) === expectedValue,
          ) &&
          rows.every(
            (row) =>
              row.regulationId === acceptanceFixtureIds.regulation.cnGb20891 &&
              row.limit.sourceId === acceptanceFixtureIds.source.cnGb20891 &&
              row.limit.testCycleCode === "NRSC" &&
              row.limit.validFrom === "2016-04-01" &&
              row.limit.validTo === "2022-12-01" &&
              row.limit.verifiedAt.toISOString() ===
                CHINA_NONROAD_COMPLETENESS_SIGNOFF_ISO &&
              Number(row.limit.powerMinKw) === expected.powerMinKw &&
              Number(row.limit.powerMaxKw) === expected.powerMaxKw,
          )
        );
      };

      return (
        transitionRows.map((rows) => rows.length).join(",") ===
          "0,3,3,5,0,3,3,5" &&
        currentRows.map((rows) => rows.length).join(",") ===
          "3,4,5,5,5,3,3,4,5,5,5,3" &&
        stage3PowerRows.every((rows, index) => {
          const expected = stage3PowerCases[index % stage3PowerCases.length];
          return expected !== undefined && matchesStage3PowerCase(rows, expected);
        }) &&
        valuesFor(currentRows[4] ?? []).get("NOX") === 2 &&
        valuesFor(currentRows[5] ?? []).get("HC+NOx") === 6.4 &&
        stage3AtStartRows.every(
          (row) =>
            row.regulationId === acceptanceFixtureIds.regulation.cnGb20891 &&
            row.limit.sourceId === acceptanceFixtureIds.source.cnGb20891 &&
            row.limit.testCycleCode === "NRSC" &&
            row.limit.validFrom === "2016-04-01" &&
            row.limit.validTo === "2022-12-01" &&
            row.limit.verifiedAt.toISOString() ===
              CHINA_NONROAD_COMPLETENESS_SIGNOFF_ISO,
        ) &&
        stage4AtStartRows.every(
          (row) =>
            row.regulationId === acceptanceFixtureIds.regulation.cnGb20891 &&
            row.limit.sourceId === acceptanceFixtureIds.source.cnGb20891 &&
            row.limit.testCycleCode === "NRSC AND applicable NRTC" &&
            row.limit.validFrom === "2022-12-01" &&
            row.limit.verifiedAt.toISOString() ===
              CHINA_NONROAD_COMPLETENESS_SIGNOFF_ISO,
        ) &&
        stage3ContinuationRows.every(
          (row) =>
            row.limit.testCycleCode === "NRSC" &&
            row.limit.validFrom === "2016-04-01" &&
            row.limit.validTo === null,
        ) &&
        stage4CurrentRows.every(
          (row) =>
            row.limit.testCycleCode === "NRSC AND applicable NRTC" &&
            row.limit.validFrom === "2022-12-01" &&
            row.limit.pollutantCode !== "NH3",
        ) &&
        cnMeeJurisdiction?.code === "CN-MEE" &&
        cnMeeJurisdiction.source.id ===
          acceptanceFixtureIds.source.cnHj1014 &&
        cnMeeJurisdiction.source.verifiedAt.toISOString() ===
          CHINA_NONROAD_COMPLETENESS_SIGNOFF_ISO
      );
    };

    const runMaltaMembershipBoundaryCheck = async (): Promise<boolean> => {
      const [beforeAccession, atAccession, current, roadTruck, roadBus, plant, agri] =
        await Promise.all([
          countryRepository.findDetailsByIso3({
            asOf: "2004-04-30",
            iso3: "MLT",
          }),
          countryRepository.findDetailsByIso3({
            asOf: "2004-05-01",
            iso3: "MLT",
          }),
          countryRepository.findDetailsByIso3({
            asOf: "2026-08-11",
            iso3: "MLT",
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-08-11",
            countryIso3: "MLT",
            powerKw: 300,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-bus",
            asOf: "2026-08-11",
            countryIso3: "MLT",
            powerKw: 300,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2026-08-11",
            countryIso3: "MLT",
            powerKw: 150,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "agriculture",
            asOf: "2026-08-11",
            countryIso3: "MLT",
            powerKw: 150,
          }),
        ]);
      const membership = current?.jurisdictions[0];

      return (
        beforeAccession?.jurisdictions.length === 0 &&
        atAccession?.jurisdictions.length === 1 &&
        atAccession.jurisdictions[0]?.validFrom === "2004-05-01" &&
        membership?.code === "EU" &&
        membership.validFrom === "2004-05-01" &&
        membership.source.id === acceptanceFixtureIds.source.euReg595 &&
        membership.membershipSource.id ===
          acceptanceFixtureIds.source.euCountries &&
        membership.verifiedAt.toISOString() === EU_MEMBERSHIP_SIGNOFF_ISO &&
        membership.membershipSource.verifiedAt.toISOString() ===
          EU_MEMBERSHIP_SIGNOFF_ISO &&
        roadTruck.length === 12 &&
        roadBus.length === 12 &&
        plant.length === 5 &&
        agri.length === 5 &&
        [...roadTruck, ...roadBus].every(
          (row) => row.citationCode === "CELEX:32009R0595",
        ) &&
        [...plant, ...agri].every(
          (row) => row.citationCode === "CELEX:32016R1628",
        )
      );
    };

    const runCanadaBoundaryCheck = async (): Promise<boolean> => {
      const query = (
        applicationScope:
          | "on-road-truck"
          | "on-road-bus"
          | "construction"
          | "agriculture",
        asOf: string,
        powerKw: number,
      ) =>
        regulationRepository.findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3: "CAN",
          powerKw,
        });
      const [
        roadBefore,
        truckAtStart,
        busCurrent,
        nonroadBefore,
        constructionAtStart,
        agricultureCurrent,
        atUpperBoundary,
        aboveUpperBoundary,
        agricultureAboveUpperBoundary,
      ] = await Promise.all([
        query("on-road-truck", "2009-12-31", 300),
        query("on-road-truck", "2010-01-01", 300),
        query("on-road-bus", "2026-08-10", 300),
        query("construction", "2021-06-03", 250),
        query("construction", "2021-06-04", 250),
        query("agriculture", "2026-08-10", 250),
        query("construction", "2026-08-10", 560.5),
        query(
          "construction",
          "2026-08-10",
          firstRawPowerAboveCfr1039Rounded560Kw,
        ),
        query(
          "agriculture",
          "2026-08-10",
          firstRawPowerAboveCfr1039Rounded560Kw,
        ),
      ]);
      const nonroadPowerRows = await Promise.all(
        (["construction", "agriculture"] as const).flatMap(
          (applicationScope) =>
            cfr1039RoundedPowerCases.map(({ powerKw }) =>
              query(applicationScope, "2026-08-10", powerKw),
            ),
        ),
      );
      const expectedRoadValues = new Map([
        ["CO", 15.5],
        ["NMHC", 0.14],
        ["NOX", 0.2],
        ["PM", 0.01],
      ]);
      const expectedNonroadValues = new Map([
        ["CO", 3.5],
        ["NMHC", 0.19],
        ["NOX", 0.4],
        ["PM", 0.02],
      ]);
      const valuesFor = (
        rows: Awaited<ReturnType<typeof query>>,
      ): Map<string, number> =>
        new Map(
          rows.map((row) => [
            row.limit.pollutantCode,
            Number(row.limit.limitValue),
          ]),
        );
      const roadRows = [...truckAtStart, ...busCurrent];
      const nonroadRows = [
        ...constructionAtStart,
        ...agricultureCurrent,
        ...atUpperBoundary,
      ];

      return (
        roadBefore.length === 0 &&
        nonroadBefore.length === 0 &&
        truckAtStart.length === 4 &&
        busCurrent.length === 4 &&
        constructionAtStart.length === 4 &&
        agricultureCurrent.length === 4 &&
        atUpperBoundary.length === 4 &&
        aboveUpperBoundary.length === 0 &&
        agricultureAboveUpperBoundary.length === 0 &&
        nonroadPowerRows.every((rows, index) => {
          const expected =
            cfr1039RoundedPowerCases[
              index % cfr1039RoundedPowerCases.length
            ];
          return (
            expected !== undefined &&
            matchesCfr1039RoundedPowerCase(
              rows,
              expected,
              acceptanceFixtureIds.regulation.canadaOffroad2020,
              "2021-06-04",
              CANADA_COMPLETENESS_SIGNOFF_ISO,
            )
          );
        }) &&
        JSON.stringify([...valuesFor(truckAtStart)].sort()) ===
          JSON.stringify([...expectedRoadValues].sort()) &&
        JSON.stringify([...valuesFor(constructionAtStart)].sort()) ===
          JSON.stringify([...expectedNonroadValues].sort()) &&
        roadRows.every(
          (row) =>
            row.regulationId ===
              acceptanceFixtureIds.regulation.canadaRoad2003 &&
            row.limit.sourceId === acceptanceFixtureIds.source.usEcfr86 &&
            row.limit.testCycleCode === "FTP/SET" &&
            row.limit.validFrom === "2010-01-01" &&
            row.limit.verifiedAt.toISOString() ===
              CANADA_COMPLETENESS_SIGNOFF_ISO,
        ) &&
        nonroadRows.every(
          (row) =>
            row.regulationId ===
              acceptanceFixtureIds.regulation.canadaOffroad2020 &&
            row.limit.sourceId === acceptanceFixtureIds.source.usEcfr1039 &&
            row.limit.testCycleCode ===
              "NRTC AND NRSC-C1 (8-mode OR RMC)" &&
            row.limit.validFrom === "2021-06-04" &&
            row.limit.verifiedAt.toISOString() ===
              CANADA_COMPLETENESS_SIGNOFF_ISO,
        )
      );
    };

    const runUnitedStatesBoundaryCheck = async (): Promise<boolean> => {
      const query = (
        applicationScope:
          | "on-road-truck"
          | "on-road-bus"
          | "construction"
          | "agriculture",
        asOf: string,
        powerKw: number,
      ) =>
        regulationRepository.findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3: "USA",
          powerKw,
        });
      const [
        roadBefore,
        truckBefore2027,
        busBefore2027,
        truckFrom2027,
        busFrom2027,
        construction,
        agriculture,
        atUpperBoundary,
        aboveUpperBoundary,
        agricultureAboveUpperBoundary,
      ] = await Promise.all([
        query("on-road-truck", "2009-12-31", 350),
        query("on-road-truck", "2026-12-31", 350),
        query("on-road-bus", "2026-12-31", 350),
        query("on-road-truck", "2027-01-01", 350),
        query("on-road-bus", "2027-01-01", 350),
        query("construction", "2026-08-10", 250),
        query("agriculture", "2026-08-10", 250),
        query("construction", "2026-08-10", 560.5),
        query(
          "construction",
          "2026-08-10",
          firstRawPowerAboveCfr1039Rounded560Kw,
        ),
        query(
          "agriculture",
          "2026-08-10",
          firstRawPowerAboveCfr1039Rounded560Kw,
        ),
      ]);
      const nonroadPowerRows = await Promise.all(
        (["construction", "agriculture"] as const).flatMap(
          (applicationScope) =>
            cfr1039RoundedPowerCases.map(({ powerKw }) =>
              query(applicationScope, "2026-08-10", powerKw),
            ),
        ),
      );
      const valuesFor = (
        rows: Awaited<ReturnType<typeof query>>,
      ): Map<string, number> =>
        new Map(
          rows.map((row) => [
            `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
            Number(row.limit.limitValue),
          ]),
        );
      const cfr86Values = valuesFor(truckBefore2027);
      const cfr1036Values = valuesFor(truckFrom2027);
      const cfr1039Values = new Map(
        construction.map((row) => [
          row.limit.pollutantCode,
          Number(row.limit.limitValue),
        ]),
      );
      const cfr86Rows = [...truckBefore2027, ...busBefore2027];
      const cfr1036Rows = [...truckFrom2027, ...busFrom2027];
      const cfr1039Rows = [
        ...construction,
        ...agriculture,
        ...atUpperBoundary,
      ];

      return (
        roadBefore.length === 0 &&
        truckBefore2027.length === 7 &&
        busBefore2027.length === 7 &&
        truckFrom2027.length === 8 &&
        busFrom2027.length === 8 &&
        construction.length === 4 &&
        agriculture.length === 4 &&
        atUpperBoundary.length === 4 &&
        aboveUpperBoundary.length === 0 &&
        agricultureAboveUpperBoundary.length === 0 &&
        nonroadPowerRows.every((rows, index) => {
          const expected =
            cfr1039RoundedPowerCases[
              index % cfr1039RoundedPowerCases.length
            ];
          return (
            expected !== undefined &&
            matchesCfr1039RoundedPowerCase(
              rows,
              expected,
              acceptanceFixtureIds.regulation.us1039101,
              "2015-01-01",
              UNITED_STATES_COMPLETENESS_SIGNOFF_ISO,
            )
          );
        }) &&
        cfr86Values.get("FTP/SET:NOX") === 0.2 &&
        cfr86Values.get("FTP/SET:NMHC") === 0.14 &&
        cfr86Values.get("FTP/SET:CO") === 15.5 &&
        cfr86Values.get("FTP/SET:PM") === 0.01 &&
        cfr86Values.get("CFR86-SMOKE-ACCEL:OPACITY") === 20 &&
        cfr86Values.get("CFR86-SMOKE-LUG:OPACITY") === 15 &&
        cfr86Values.get("CFR86-SMOKE-PEAK:OPACITY") === 50 &&
        cfr1036Values.get("FTP/SET:NOX") === 0.035 &&
        cfr1036Values.get("FTP/SET:NMHC") === 0.06 &&
        cfr1036Values.get("FTP/SET:PM") === 0.005 &&
        cfr1036Values.get("FTP/SET:CO") === 6 &&
        cfr1036Values.get("LLC:NOX") === 0.05 &&
        cfr1036Values.get("LLC:NMHC") === 0.14 &&
        cfr1036Values.get("LLC:PM") === 0.005 &&
        cfr1036Values.get("LLC:CO") === 6 &&
        cfr1039Values.get("NOX") === 0.4 &&
        cfr1039Values.get("NMHC") === 0.19 &&
        cfr1039Values.get("PM") === 0.02 &&
        cfr1039Values.get("CO") === 3.5 &&
        cfr86Rows.every(
          (row) =>
            row.regulationId === acceptanceFixtureIds.regulation.us8600711 &&
            row.limit.sourceId === acceptanceFixtureIds.source.usEcfr86 &&
            row.limit.validFrom === "2010-01-01" &&
            row.limit.validTo === "2027-01-01" &&
            row.limit.verifiedAt.toISOString() ===
              UNITED_STATES_COMPLETENESS_SIGNOFF_ISO,
        ) &&
        cfr1036Rows.every(
          (row) =>
            row.regulationId === acceptanceFixtureIds.regulation.us1036104 &&
            row.limit.sourceId === acceptanceFixtureIds.source.usEcfr1036 &&
            row.limit.validFrom === "2027-01-01" &&
            row.limit.verifiedAt.toISOString() ===
              UNITED_STATES_COMPLETENESS_SIGNOFF_ISO,
        ) &&
        cfr1039Rows.every(
          (row) =>
            row.regulationId === acceptanceFixtureIds.regulation.us1039101 &&
            row.limit.sourceId === acceptanceFixtureIds.source.usEcfr1039 &&
            row.limit.testCycleCode ===
              "NRTC AND NRSC-C1 (8-mode OR RMC)" &&
            row.limit.validFrom === "2015-01-01" &&
            row.limit.verifiedAt.toISOString() ===
              UNITED_STATES_COMPLETENESS_SIGNOFF_ISO,
        )
      );
    };

    const runPapuaNewGuineaBoundaryCheck = async (): Promise<boolean> => {
      const query = (
        applicationScope:
          | "on-road-truck"
          | "on-road-bus"
          | "construction"
          | "agriculture",
        asOf: string,
      ) =>
        regulationRepository.findEffectiveByCountry({
          applicationScope,
          asOf,
          countryIso3: "PNG",
          powerKw: 300,
        });
      const [before, truck, bus, construction, agriculture] = await Promise.all([
        query("on-road-truck", "2018-12-31"),
        query("on-road-truck", countrySignoffAsOf("PNG")),
        query("on-road-bus", countrySignoffAsOf("PNG")),
        query("construction", countrySignoffAsOf("PNG")),
        query("agriculture", countrySignoffAsOf("PNG")),
      ]);
      const values = new Map(
        truck.map((row) => [
          `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
          Number(row.limit.limitValue),
        ]),
      );

      return (
        before.length === 0 &&
        truck.length === 9 &&
        truck.every(
          (row) =>
            row.regulationId ===
              acceptanceFixtureIds.regulation.papuaNewGuineaHeavyTruckAdr803 &&
            row.effectiveFrom === "2019-01-01" &&
            row.limit.sourceId === acceptanceFixtureIds.source.australiaAdr80_03 &&
            row.limit.validFrom === "2019-01-01",
        ) &&
        values.get("ESC:NOX") === 2 &&
        values.get("ELR:OPACITY") === 0.5 &&
        values.get("ETC:PM") === 0.03 &&
        bus.length === 0 &&
        construction.length === 0 &&
        agriculture.length === 0
      );
    };

    if (targetSelection) {
      const expectedSourceIds = [...targetSelection.sourceIds];
      const expectedJurisdictionIds = [...targetSelection.jurisdictionIds];
      const expectedRegulationIds = [...targetSelection.regulationIds];
      const [sourceRows, jurisdictionRows, membershipRows] = await Promise.all([
          database
            .select({ id: schema.dataSources.id })
            .from(schema.dataSources)
            .where(
              and(
                inArray(schema.dataSources.id, expectedSourceIds),
                isNull(schema.dataSources.archivedAt),
              ),
            ),
          database
            .select({ id: schema.jurisdictions.id })
            .from(schema.jurisdictions)
            .where(
              and(
                inArray(schema.jurisdictions.id, expectedJurisdictionIds),
                isNull(schema.jurisdictions.archivedAt),
              ),
            ),
          database
            .select({ jurisdictionId: schema.countryJurisdictions.jurisdictionId })
            .from(schema.countryJurisdictions)
            .where(
              and(
                eq(
                  schema.countryJurisdictions.countryIso3,
                  targetSelection.countryIso3,
                ),
                inArray(
                  schema.countryJurisdictions.jurisdictionId,
                  expectedJurisdictionIds,
                ),
                isNull(schema.countryJurisdictions.archivedAt),
              ),
            ),
        ]);
      const regulationRows =
        expectedRegulationIds.length === 0
          ? []
          : await database
              .select({ id: schema.regulations.id })
              .from(schema.regulations)
              .where(
                and(
                  inArray(schema.regulations.id, expectedRegulationIds),
                  isNull(schema.regulations.archivedAt),
                ),
              );
      const limitRows =
        expectedRegulationIds.length === 0
          ? []
          : await database
              .select({ id: schema.regulationLimits.id })
              .from(schema.regulationLimits)
              .where(
                and(
                  inArray(
                    schema.regulationLimits.regulationId,
                    expectedRegulationIds,
                  ),
                  isNull(schema.regulationLimits.archivedAt),
                ),
              );
      const country = await countryRepository.findByIso3({
        iso3: targetSelection.countryIso3,
      });
      const targetChecks: Array<{ name: string; passed: boolean }> = [
        {
          name: `${targetSelection.countryIso3} target graph has all active sources, jurisdictions, memberships, regulations and limits`,
          passed:
            sourceRows.length === expectedSourceIds.length &&
            jurisdictionRows.length === expectedJurisdictionIds.length &&
            membershipRows.length === expectedJurisdictionIds.length &&
            regulationRows.length === expectedRegulationIds.length &&
            limitRows.length === targetSelection.limitRows.length,
        },
        {
          name: `${targetSelection.countryIso3} coverage status is covered`,
          passed: country?.dataCoverageStatus === "covered",
        },
      ];

      const latinAmericaFiveGateSourceIds =
        latinAmericaFiveGateSourceIdsByCountryIso3.get(
          targetSelection.countryIso3,
        );
      if (latinAmericaFiveGateSourceIds) {
        targetChecks.push({
          name: `${targetSelection.countryIso3} keeps the exact reviewed two-source graph`,
          passed:
            sourceRows.length === latinAmericaFiveGateSourceIds.size &&
            sourceRows.every(({ id }) =>
              latinAmericaFiveGateSourceIds.has(id),
            ) &&
            targetSelection.sourceIds.size ===
              latinAmericaFiveGateSourceIds.size &&
            [...targetSelection.sourceIds].every((id) =>
              latinAmericaFiveGateSourceIds.has(id),
            ),
        });
      }

      if (targetSelection.limitRows.length === 0) {
        const noDataRows = await Promise.all(
          ([
            "on-road-truck",
            "on-road-bus",
            "construction",
            "agriculture",
          ] as const).map((applicationScope) =>
            regulationRepository.findEffectiveByCountry({
              applicationScope,
              asOf: countrySignoffAsOf(targetSelection.countryIso3),
              countryIso3: targetSelection.countryIso3,
              powerKw: 150,
            }),
          ),
        );
        targetChecks.push({
          name: `${targetSelection.countryIso3} preserves no-data for all four scopes`,
          passed: noDataRows.every((rows) => rows.length === 0),
        });
      }

      if (signedRoadCountrySet.has(targetSelection.countryIso3)) {
        const countryIso3 =
          targetSelection.countryIso3 as SignedRoadCountryIso3;
        targetChecks.push({
          name: signedRoadBoundaryConfigs[countryIso3].name,
          passed: await runSignedRoadBoundaryCheck(countryIso3),
        });
      }

      if (targetSelection.countryIso3 === "ISR") {
        targetChecks.push({
          name:
            "ISR preserves the CY2026 Euro VI road, construction Stage V and agriculture no-data boundaries",
          passed: await runIsraelBoundaryCheck(),
        });
      }

      if (targetSelection.countryIso3 === "LKA") {
        targetChecks.push({
          name:
            "LKA preserves the 2018-07-13 Table 5 road and six-band Table 6 construction boundaries without agriculture inference",
          passed: await runSriLankaBoundaryCheck(),
        });
      }

      if (targetSelection.countryIso3 === "AUS") {
        targetChecks.push({
          name:
            "AUS preserves the full-coverage ADR 80/03 to ADR 80/04 succession and complete diesel tables",
          passed: await runAustraliaBoundaryCheck(),
        });
      }

      if (targetSelection.countryIso3 === "CHN") {
        targetChecks.push({
          name:
            "CHN preserves Stage III history, the Stage IV switch, all current power bands and HJ 1014 provenance",
          passed: await runChinaNonroadBoundaryCheck(),
        });
      }

      if (targetSelection.countryIso3 === "MLT") {
        targetChecks.push({
          name:
            "MLT preserves the 2004-05-01 EU accession boundary and current shared Euro VI/Stage V graph",
          passed: await runMaltaMembershipBoundaryCheck(),
        });
      }

      if (targetSelection.countryIso3 === "CAN") {
        targetChecks.push({
          name:
            "CAN preserves complete direct-source road and nonroad tables, effective dates, cycles, scopes and inclusive 560 kW boundary",
          passed: await runCanadaBoundaryCheck(),
        });
      }

      if (targetSelection.countryIso3 === "USA") {
        targetChecks.push({
          name:
            "USA preserves complete representative CFR 86/1036 road succession and CFR 1039 variable-speed Tier 4 boundaries",
          passed: await runUnitedStatesBoundaryCheck(),
        });
      }

      if (targetSelection.countryIso3 === "PNG") {
        targetChecks.push({
          name:
            "PNG preserves the 2019 ADR 80/03 truck-only ESC/ELR/ETC pathway and all other scopes as no-data",
          passed: await runPapuaNewGuineaBoundaryCheck(),
        });
      }

      if (centralAsiaPublishedCountrySet.has(targetSelection.countryIso3)) {
        const countryIso3 =
          targetSelection.countryIso3 as CentralAsiaPublishedCountryIso3;
        targetChecks.push({
          name: `${countryIso3} preserves signed Central Asia road, agriculture and no-data boundaries`,
          passed: await runCentralAsiaBoundaryCheck(countryIso3),
        });
      }

      if (caucasusPublishedCountrySet.has(targetSelection.countryIso3)) {
        const countryIso3 =
          targetSelection.countryIso3 as CaucasusPublishedCountryIso3;
        targetChecks.push({
          name: `${countryIso3} preserves signed Caucasus scope, cycle, date and power boundaries`,
          passed: await runCaucasusBoundaryCheck(countryIso3),
        });
      }

      if (targetSelection.countryIso3 === "URY") {
        const [
          truckRows,
          busRows,
          constructionRows,
          agricultureRows,
          truckBeforeEffectiveDate,
        ] =
          await Promise.all(
            [
              ...([
                "on-road-truck",
                "on-road-bus",
                "construction",
                "agriculture",
              ] as const).map((applicationScope) =>
                regulationRepository.findEffectiveByCountry({
                  applicationScope,
                  asOf: "2026-08-10",
                  countryIso3: "URY",
                  powerKw: 150,
                }),
              ),
              regulationRepository.findEffectiveByCountry({
                applicationScope: "on-road-truck",
                asOf: "2023-05-13",
                countryIso3: "URY",
                powerKw: 150,
              }),
            ],
          );
        const values = new Map(
          truckRows.map((row) => [
            `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
            Number(row.limit.limitValue),
          ]),
        );
        targetChecks.push({
          name:
            "URY Decree 135/021 returns separate ESC/ETC truck and bus paths and preserves non-road no-data",
          passed:
            targetSelection.regulationIds.size === 1 &&
            targetSelection.regulationIds.has(
              acceptanceFixtureIds.regulation.uruguayDecree1352021,
            ) &&
            targetSelection.limitRows.length === 18 &&
            targetSelection.limitRows.every(
              (row) => row.validFrom === "2023-05-14",
            ) &&
            truckBeforeEffectiveDate.length === 0 &&
            truckRows.length === 9 &&
            busRows.length === 9 &&
            [...truckRows, ...busRows].every(
              (row) =>
                row.regulationId ===
                  acceptanceFixtureIds.regulation.uruguayDecree1352021 &&
                row.limit.validFrom === "2023-05-14" &&
                row.source.verifiedAt.toISOString() ===
                  LATAM_SOURCE_REFRESH_SIGNOFF_ISO,
            ) &&
            values.get("ESC:CO") === 1.5 &&
            values.get("ESC:HC") === 0.46 &&
            values.get("ESC:NOX") === 2 &&
            values.get("ESC:PM") === 0.02 &&
            values.get("ESC:OPACITY") === 0.5 &&
            values.get("ETC:CO") === 4 &&
            values.get("ETC:NMHC") === 0.55 &&
            values.get("ETC:NOX") === 2 &&
            values.get("ETC:PM") === 0.03 &&
            constructionRows.length === 0 &&
            agricultureRows.length === 0,
        });
      }

      if (targetSelection.countryIso3 === "VEN") {
        const [
          truckAt85Kw,
          truckAbove85Kw,
          busAt85Kw,
          busAbove85Kw,
          constructionRows,
          agricultureRows,
          truckBeforeMy2000,
          busBeforeMy2000,
        ] = await Promise.all([
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2000-01-01",
            countryIso3: "VEN",
            powerKw: 85,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2000-01-01",
            countryIso3: "VEN",
            powerKw: 85.001,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-bus",
            asOf: "2000-01-01",
            countryIso3: "VEN",
            powerKw: 85,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-bus",
            asOf: "2000-01-01",
            countryIso3: "VEN",
            powerKw: 85.001,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2026-08-10",
            countryIso3: "VEN",
            powerKw: 150,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "agriculture",
            asOf: "2026-08-10",
            countryIso3: "VEN",
            powerKw: 150,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "1999-12-31",
            countryIso3: "VEN",
            powerKw: 150,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-bus",
            asOf: "1999-12-31",
            countryIso3: "VEN",
            powerKw: 150,
          }),
        ]);
        const hasExpectedRoadLimits = (
          rows: typeof truckAt85Kw,
          expectedPm: number,
        ): boolean => {
          const values = new Map(
            rows.map((row) => [
              row.limit.pollutantCode,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            rows.length === 4 &&
            rows.every(
              (row) =>
                row.regulationId ===
                  acceptanceFixtureIds.regulation
                    .venezuelaHeavyDieselMy2000 &&
                row.limit.testCycleCode === "Directive 91/542/EEC" &&
                row.limit.unitCode === "g/kWh",
            ) &&
            values.get("CO") === 4.5 &&
            values.get("HC") === 1.1 &&
            values.get("NOX") === 8 &&
            values.get("PM") === expectedPm
          );
        };
        targetChecks.push({
          name:
            "VEN Decreto 2.673 returns the MY2000 EU representative road path, exact 85 kW PM split and non-road no-data",
          passed:
            hasExpectedRoadLimits(truckAt85Kw, 0.612) &&
            hasExpectedRoadLimits(truckAbove85Kw, 0.36) &&
            hasExpectedRoadLimits(busAt85Kw, 0.612) &&
            hasExpectedRoadLimits(busAbove85Kw, 0.36) &&
            constructionRows.length === 0 &&
            agricultureRows.length === 0 &&
            truckBeforeMy2000.length === 0 &&
            busBeforeMy2000.length === 0,
        });
      }

      if (targetSelection.countryIso3 === "UKR") {
        const [
          truckRows,
          busRows,
          constructionRows,
          agricultureRows,
          beforeEuroV,
          afterEuroV,
        ] = await Promise.all([
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-08-10",
            countryIso3: "UKR",
            powerKw: 150,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-bus",
            asOf: "2026-08-10",
            countryIso3: "UKR",
            powerKw: 150,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2026-08-10",
            countryIso3: "UKR",
            powerKw: 150,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "agriculture",
            asOf: "2026-08-10",
            countryIso3: "UKR",
            powerKw: 150,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2015-12-31",
            countryIso3: "UKR",
            powerKw: 150,
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2027-01-01",
            countryIso3: "UKR",
            powerKw: 150,
          }),
        ]);
        const values = new Map(
          truckRows.map((row) => [
            `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
            Number(row.limit.limitValue),
          ]),
        );
        targetChecks.push({
          name:
            "UKR Euro V B2 returns road limits through 2026 and fails closed at the 2027 Euro VI switch",
          passed:
            truckRows.length === 9 &&
            busRows.length === 9 &&
            [...truckRows, ...busRows].every(
              (row) =>
                row.regulationId ===
                acceptanceFixtureIds.regulation.ukraineRoadEuroV,
            ) &&
            values.get("ESC/ELR:NOX") === 2 &&
            values.get("ESC/ELR:PM") === 0.02 &&
            values.get("ESC/ELR:OPACITY") === 0.5 &&
            values.get("ETC:NOX") === 2 &&
            values.get("ETC:PM") === 0.03 &&
            constructionRows.length === 0 &&
            agricultureRows.length === 0 &&
            beforeEuroV.length === 0 &&
            afterEuroV.length === 0,
        });
      }

      for (const check of targetChecks) {
        process.stdout.write(`${check.passed ? "PASS" : "FAIL"}  ${check.name}\n`);
        if (!check.passed) {
          failures.push(check.name);
        }
      }
      if (failures.length > 0) {
        process.stderr.write(
          `Targeted ingestion completed but ${failures.length} acceptance check(s) failed.\n`,
        );
        process.exitCode = 1;
        return;
      }
      process.stdout.write(
        `Targeted ingestion and acceptance checks completed for ${targetSelection.countryIso3}.\n`,
      );
      return;
    }

    const checks: Array<{
      name: string;
      run: () => Promise<boolean>;
    }> = [
      ...signedRoadCountryIso3s.map((countryIso3) => ({
        name: signedRoadBoundaryConfigs[countryIso3].name,
        run: () => runSignedRoadBoundaryCheck(countryIso3),
      })),
      ...signedNoDataCountryIso3s.map((countryIso3) => ({
        name: `${countryIso3} preserves all four signed scopes as no-data`,
        run: () => runSignedNoDataBoundaryCheck(countryIso3),
      })),
      ...centralAsiaPublishedCountryIso3s.map((countryIso3) => ({
        name: `${countryIso3} preserves signed Central Asia road, agriculture and no-data boundaries`,
        run: () => runCentralAsiaBoundaryCheck(countryIso3),
      })),
      ...caucasusPublishedCountryIso3s.map((countryIso3) => ({
        name: `${countryIso3} preserves signed Caucasus scope, cycle, date and power boundaries`,
        run: () => runCaucasusBoundaryCheck(countryIso3),
      })),
      {
        name:
          "ISR preserves the CY2026 Euro VI road, construction Stage V and agriculture no-data boundaries",
        run: runIsraelBoundaryCheck,
      },
      {
        name:
          "LKA preserves the 2018-07-13 Table 5 road and six-band Table 6 construction boundaries without agriculture inference",
        run: runSriLankaBoundaryCheck,
      },
      {
        name: "CHN on-road-truck 350kW @2026-07-30 -> GB 17691-2018, NOx 460 mg/kWh",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-07-30",
            countryIso3: "CHN",
            powerKw: 350,
          });
          const nox = rows.find(
            (row) => row.limit.pollutantCode === "NOX",
          );
          return (
            rows.length > 0 &&
            rows.every((row) => row.citationCode === "GB 17691-2018") &&
            Number(nox?.limit.limitValue) === 460 &&
            nox?.limit.unitCode === "mg/kWh"
          );
        },
      },
      {
        name:
          "CHN preserves Stage III history, the Stage IV switch, all current power bands and HJ 1014 provenance",
        run: runChinaNonroadBoundaryCheck,
      },
      {
        name:
          "MLT preserves the 2004-05-01 EU accession boundary and current shared Euro VI/Stage V graph",
        run: runMaltaMembershipBoundaryCheck,
      },
      {
        name:
          "USA preserves complete representative CFR 86/1036 road succession and CFR 1039 variable-speed Tier 4 boundaries",
        run: runUnitedStatesBoundaryCheck,
      },
      {
        name: "DEU on-road-truck 300kW @2026-07-30 -> Euro VI (CELEX:32009R0595), NOx 400/460 mg/kWh",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-07-30",
            countryIso3: "DEU",
            powerKw: 300,
          });
          const noxValues = rows
            .filter((row) => row.limit.pollutantCode === "NOX")
            .map((row) => Number(row.limit.limitValue));
          return (
            rows.length > 0 &&
            rows.every((row) => row.citationCode === "CELEX:32009R0595") &&
            noxValues.includes(460) &&
            noxValues.includes(400)
          );
        },
      },
      {
        name: "DEU construction 150kW @2025-06-01 -> Stage V (CELEX:32016R1628), NOx 0.40 / PM 0.015 g/kWh",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2025-06-01",
            countryIso3: "DEU",
            powerKw: 150,
          });
          const nox = rows.find((row) => row.limit.pollutantCode === "NOX");
          const pm = rows.find((row) => row.limit.pollutantCode === "PM");
          return (
            rows.length > 0 &&
            rows.every((row) => row.citationCode === "CELEX:32016R1628") &&
            Number(nox?.limit.limitValue) === 0.4 &&
            Number(pm?.limit.limitValue) === 0.015
          );
        },
      },
      {
        name: "BRA on-road-truck 300kW @2022-12-31 -> P7 (CONAMA 403/2008), ESC/ETC NOx 2 g/kWh",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2022-12-31",
            countryIso3: "BRA",
            powerKw: 300,
          });
          const noxValues = rows
            .filter((row) => row.limit.pollutantCode === "NOX")
            .map((row) => Number(row.limit.limitValue));
          return (
            rows.length > 0 &&
            rows.every((row) => row.citationCode === "CONAMA 403/2008") &&
            noxValues.length === 2 &&
            noxValues.every((value) => value === 2)
          );
        },
      },
      {
        name: "BRA on-road-truck 300kW @2023-01-01 -> P8 only (CONAMA 490/2018)",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2023-01-01",
            countryIso3: "BRA",
            powerKw: 300,
          });
          return (
            rows.length === 12 &&
            rows.every((row) => row.citationCode === "CONAMA 490/2018")
          );
        },
      },
      {
        name: "BRA on-road-truck 300kW @2026-07-30 -> P8 (CONAMA 490/2018), WHSC/WHTC NOx 400/460 mg/kWh",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-07-30",
            countryIso3: "BRA",
            powerKw: 300,
          });
          const noxValues = rows
            .filter((row) => row.limit.pollutantCode === "NOX")
            .map((row) => Number(row.limit.limitValue));
          return (
            rows.length > 0 &&
            rows.every((row) => row.citationCode === "CONAMA 490/2018") &&
            noxValues.includes(400) &&
            noxValues.includes(460)
          );
        },
      },
      {
        name: "BRA construction 100kW @2026-07-30 -> MAR-I (CONAMA 433/2011), CO 5.0 / HC+NOx 4.0 / PM 0.3",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2026-07-30",
            countryIso3: "BRA",
            powerKw: 100,
          });
          const byPollutant = new Map(
            rows.map((row) => [row.limit.pollutantCode, Number(row.limit.limitValue)]),
          );
          return (
            rows.length > 0 &&
            rows.every((row) => row.citationCode === "CONAMA 433/2011") &&
            byPollutant.get("CO") === 5 &&
            byPollutant.get("HC+NOx") === 4 &&
            byPollutant.get("PM") === 0.3
          );
        },
      },
      {
        name: "BRA agriculture 30kW @2026-07-30 -> MAR-I band 19-37, CO 5.5 / HC+NOx 7.5 / PM 0.6",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "agriculture",
            asOf: "2026-07-30",
            countryIso3: "BRA",
            powerKw: 30,
          });
          const byPollutant = new Map(
            rows.map((row) => [row.limit.pollutantCode, Number(row.limit.limitValue)]),
          );
          return (
            byPollutant.get("CO") === 5.5 &&
            byPollutant.get("HC+NOx") === 7.5 &&
            byPollutant.get("PM") === 0.6
          );
        },
      },
      {
        name: "JPN on-road-truck 300kW @2026-08-06 -> 2016 HD Diesel, mean NOx 0.4 g/kWh on WHSC/WHTC",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-08-06",
            countryIso3: "JPN",
            powerKw: 300,
          });
          const noxRows = rows.filter(
            (row) => row.limit.pollutantCode === "NOX",
          );
          return (
            rows.length === 8 &&
            rows.every(
              (row) => row.citationCode === "JPN 2016 HD Diesel",
            ) &&
            noxRows.length === 2 &&
            noxRows.every(
              (row) =>
                Number(row.limit.limitValue) === 0.4 &&
                row.limit.unitCode === "g/kWh",
            )
          );
        },
      },
      {
        name: "JPN construction 150kW @2026-08-06 -> Off-Road 2014, NOx 0.4 / PM 0.02 g/kWh",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2026-08-06",
            countryIso3: "JPN",
            powerKw: 150,
          });
          const byPollutant = new Map(
            rows.map((row) => [
              row.limit.pollutantCode,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            rows.length === 4 &&
            rows.every(
              (row) =>
                row.citationCode ===
                "平成26年三省告示第1号（2014年基準）",
            ) &&
            byPollutant.get("NOX") === 0.4 &&
            byPollutant.get("PM") === 0.02
          );
        },
      },
      {
        name: "JPN Off-Road 2014 keeps the official 19<=P<560 kW boundary",
        run: async () => {
          const query = (powerKw: number) =>
            regulationRepository.findEffectiveByCountry({
              applicationScope: "agriculture",
              asOf: "2026-08-06",
              countryIso3: "JPN",
              powerKw,
            });
          const [below, lowerBoundary, upperBoundary] = await Promise.all([
            query(18.999),
            query(19),
            query(560),
          ]);
          return (
            below.length === 0 &&
            lowerBoundary.length === 4 &&
            upperBoundary.length === 0
          );
        },
      },
      {
        name: "KOR on-road-truck 300kW @2026-08-06 -> Annex 17 2017, WHSC/WHTC NOx 0.40/0.46 g/kWh",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-08-06",
            countryIso3: "KOR",
            powerKw: 300,
          });
          const noxValues = rows
            .filter((row) => row.limit.pollutantCode === "NOX")
            .map((row) => Number(row.limit.limitValue));
          return (
            rows.length === 12 &&
            rows.every((row) => row.citationCode === "KOR Annex 17 HD Diesel 2017") &&
            noxValues.includes(0.4) &&
            noxValues.includes(0.46) &&
            rows.every((row) => row.limit.unitCode === "g/kWh" || row.limit.unitCode === "e9/kWh" || row.limit.unitCode === "ppm")
          );
        },
      },
      {
        name: "KOR construction/agriculture 150kW @2026-08-06 -> Annex 17 current bands",
        run: async () => {
          const results = await Promise.all(
            (["construction", "agriculture"] as const).map((applicationScope) =>
              regulationRepository.findEffectiveByCountry({
                applicationScope,
                asOf: "2026-08-06",
                countryIso3: "KOR",
                powerKw: 150,
              }),
            ),
          );
          return results.every((rows) => {
            const byPollutant = new Map(
              rows.map((row) => [
                row.limit.pollutantCode,
                Number(row.limit.limitValue),
              ]),
            );
            return (
              rows.length === 6 &&
              byPollutant.get("CO") === 3.5 &&
              byPollutant.get("HC") === 0.19 &&
              byPollutant.get("NOX") === 0.4 &&
              byPollutant.get("PM") === 0.015 &&
              byPollutant.get("PN") === 1000 &&
              byPollutant.get("NH3") === 10
            );
          });
        },
      },
      {
        name: "KOR Annex 17 nonroad keeps [19,560) and all official power bands",
        run: async () => {
          const query = (applicationScope: "construction" | "agriculture", powerKw: number) =>
            regulationRepository.findEffectiveByCountry({
              applicationScope,
              asOf: "2026-08-06",
              countryIso3: "KOR",
              powerKw,
            });
          const [at19, at37, at56, at130, at559, at560] = await Promise.all([
            query("construction", 19),
            query("construction", 37),
            query("construction", 56),
            query("construction", 130),
            query("construction", 559.999),
            query("construction", 560),
          ]);
          return (
            at19.length === 5 &&
            at37.length === 5 &&
            at56.length === 6 &&
            at130.length === 6 &&
            at559.length === 6 &&
            at560.length === 0
          );
        },
      },
      {
        name: "MEX NOM-044 2B/1B road standards @2026-08-06 -> CT/CSE and CEEMAP/CETMAP",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-08-06",
            countryIso3: "MEX",
            powerKw: 300,
          });
          const noxValues = rows
            .filter((row) => row.limit.pollutantCode === "NOX")
            .map((row) => Number(row.limit.limitValue));
          const cycles = new Set(
            rows.map((row) => row.limit.testCycleCode),
          );
          return (
            rows.length === 16 &&
            rows.some(
              (row) =>
                row.citationCode === "NOM-044-SEMARNAT-2017 Tabla 1B" &&
                row.limit.pollutantCode === "NOX" &&
                Number(row.limit.limitValue) === 0.2,
            ) &&
            rows.some(
              (row) =>
                row.citationCode === "NOM-044-SEMARNAT-2017 Tabla 2B" &&
                row.limit.pollutantCode === "NH3" &&
                Number(row.limit.limitValue) === 10,
            ) &&
            noxValues.includes(0.2) &&
            noxValues.includes(0.4) &&
            noxValues.includes(0.46) &&
            ["CT/CSE", "CEEMAP", "CETMAP"].every((cycle) =>
              cycles.has(cycle),
            )
          );
        },
      },
      {
        name: "MEX NOM-044 has explicit no-data for construction/agriculture",
        run: async () => {
          const [construction, agriculture] = await Promise.all([
            regulationRepository.findEffectiveByCountry({
              applicationScope: "construction",
              asOf: "2026-08-06",
              countryIso3: "MEX",
              powerKw: 150,
            }),
            regulationRepository.findEffectiveByCountry({
              applicationScope: "agriculture",
              asOf: "2026-08-06",
              countryIso3: "MEX",
              powerKw: 150,
            }),
          ]);
          return construction.length === 0 && agriculture.length === 0;
        },
      },
      {
        name: "TUR Euro VI road standards provide WHSC/WHTC diesel limits",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-08-06",
            countryIso3: "TUR",
            powerKw: 300,
          });
          const noxValues = rows
            .filter((row) => row.limit.pollutantCode === "NOX")
            .map((row) => Number(row.limit.limitValue));
          return (
            rows.length === 12 &&
            new Set(rows.map((row) => row.citationCode)).size === 1 &&
            new Set(rows.map((row) => row.limit.testCycleCode)).size === 2 &&
            noxValues.includes(400) &&
            noxValues.includes(460)
          );
        },
      },
      {
        name: "TUR NRE Stage V construction limits and agriculture no-data",
        run: async () => {
          const [construction, agriculture] = await Promise.all([
            regulationRepository.findEffectiveByCountry({
              applicationScope: "construction",
              asOf: "2026-08-06",
              countryIso3: "TUR",
              powerKw: 150,
            }),
            regulationRepository.findEffectiveByCountry({
              applicationScope: "agriculture",
              asOf: "2026-08-06",
              countryIso3: "TUR",
              powerKw: 150,
            }),
          ]);
          const nox = construction.find(
            (row) => row.limit.pollutantCode === "NOX",
          );
          return (
            construction.length === 5 &&
            Number(nox?.limit.limitValue) === 0.4 &&
            agriculture.length === 0
          );
        },
      },
      {
        name: "TUR NRE Stage V preserves 560 kW strict boundary",
        run: async () => {
          const [at130, at560, above560] = await Promise.all([
            regulationRepository.findEffectiveByCountry({
              applicationScope: "construction",
              asOf: "2026-08-06",
              countryIso3: "TUR",
              powerKw: 130,
            }),
            regulationRepository.findEffectiveByCountry({
              applicationScope: "construction",
              asOf: "2026-08-06",
              countryIso3: "TUR",
              powerKw: 560,
            }),
            regulationRepository.findEffectiveByCountry({
              applicationScope: "construction",
              asOf: "2026-08-06",
              countryIso3: "TUR",
              powerKw: 600,
            }),
          ]);
          return at130.length === 5 && at560.length === 0 && above560.length === 4;
        },
      },
      {
        name:
          "AUS preserves the full-coverage ADR 80/03 to ADR 80/04 succession and complete diesel tables",
        run: runAustraliaBoundaryCheck,
      },
      {
        name:
          "PNG preserves the 2019 ADR 80/03 truck-only ESC/ELR/ETC pathway and all other scopes as no-data",
        run: runPapuaNewGuineaBoundaryCheck,
      },
      {
        name:
          "CAN preserves complete direct-source road and nonroad tables, effective dates, cycles, scopes and inclusive 560 kW boundary",
        run: runCanadaBoundaryCheck,
      },
      {
        name: "IND BS VI road and current CEV-V/TREM-V limits are effective",
        run: async () => {
          const [road, construction, agriculture] = await Promise.all([
            regulationRepository.findEffectiveByCountry({
              applicationScope: "on-road-truck",
              asOf: "2026-08-07",
              countryIso3: "IND",
              powerKw: 300,
            }),
            regulationRepository.findEffectiveByCountry({
              applicationScope: "construction",
              asOf: "2026-08-07",
              countryIso3: "IND",
              powerKw: 150,
            }),
            regulationRepository.findEffectiveByCountry({
              applicationScope: "agriculture",
              asOf: "2026-08-07",
              countryIso3: "IND",
              powerKw: 150,
            }),
          ]);
          return (
            road.length === 12 &&
            road.every((row) => row.citationCode === "G.S.R. 889(E)") &&
            construction.length === 5 &&
            construction.every(
              (row) => row.citationCode === "G.S.R. 598(E) CEV Stage V",
            ) &&
            agriculture.length === 5 &&
            agriculture.every(
              (row) =>
                row.citationCode ===
                "G.S.R. 141(E) / G.S.R. 598(E) TREM Stage V",
            )
          );
        },
      },
      {
        name: "RUS TR CU 018/2011 class 5 road limits are effective",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-08-07",
            countryIso3: "RUS",
            powerKw: 300,
          });
          const values = new Map(
            rows.map((row) => [
              `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            rows.length === 11 &&
            rows.every(
              (row) => row.citationCode === "TR CU 018/2011 Class 5",
            ) &&
            values.get("ESC/ELR:NOX") === 2 &&
            values.get("ESC/ELR:PM") === 0.02 &&
            values.get("ETC:NOX") === 2 &&
            values.get("ETC:PM") === 0.03
          );
        },
      },
      {
        name: "RUS TR CU 031/2012 class 3A applies to a 150kW tractor",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "agriculture",
            asOf: "2026-08-07",
            countryIso3: "RUS",
            powerKw: 150,
          });
          const values = new Map(
            rows.map((row) => [
              row.limit.pollutantCode,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            rows.length === 3 &&
            rows.every(
              (row) => row.citationCode === "TR CU 031/2012 Class 3A",
            ) &&
            values.get("CO") === 3.5 &&
            values.get("HC+NOx") === 4 &&
            values.get("PM") === 0.2
          );
        },
      },
      {
        name: "RUS construction remains explicit no-data",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2026-08-07",
            countryIso3: "RUS",
            powerKw: 150,
          });
          return rows.length === 0;
        },
      },
      {
        name: "IDN P.20/2017 Euro 4 road limits are effective",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2022-04-01",
            countryIso3: "IDN",
            powerKw: 300,
          });
          const values = new Map(
            rows.map((row) => [
              `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            rows.length === 8 &&
            rows.every(
              (row) =>
                row.citationCode ===
                "P.20/MENLHK/SETJEN/KUM.1/3/2017",
            ) &&
            values.get("ESC:NOX") === 3.5 &&
            values.get("ESC:PM") === 0.02 &&
            values.get("ETC:NOX") === 3.5 &&
            values.get("ETC:PM") === 0.03
          );
        },
      },
      {
        name: "IDN non-road scopes remain explicit no-data",
        run: async () => {
          const results = await Promise.all(
            (["construction", "agriculture"] as const).map((applicationScope) =>
              regulationRepository.findEffectiveByCountry({
                applicationScope,
                asOf: "2026-08-07",
                countryIso3: "IDN",
                powerKw: 150,
              }),
            ),
          );
          return results.every((rows) => rows.length === 0);
        },
      },
      {
        name: "THA TIS 3046 road limits start on 2024-01-01 and non-road stays no-data",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2023-12-31",
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
              regulationRepository.findEffectiveByCountry({
                applicationScope,
                asOf: "2026-08-10",
                countryIso3: "THA",
                powerKw: 150,
              }),
            ),
          );
          const values = new Map(
            truck.map((row) => [
              `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            before.length === 0 &&
            truck.length === 9 &&
            bus.length === 9 &&
            construction.length === 0 &&
            agriculture.length === 0 &&
            values.get("ESC:NOX") === 2 &&
            values.get("ELR:OPACITY") === 0.5 &&
            values.get("ETC:PM") === 0.03
          );
        },
      },
      {
        name: "BIH UN R49/06 road limits start on 2019-06-01 and non-road stays no-data",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2019-05-31",
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
              regulationRepository.findEffectiveByCountry({
                applicationScope,
                asOf: "2026-08-10",
                countryIso3: "BIH",
                powerKw: 150,
              }),
            ),
          );
          const values = new Map(
            truck.map((row) => [
              `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            before.length === 0 &&
            truck.length === 12 &&
            bus.length === 12 &&
            construction.length === 0 &&
            agriculture.length === 0 &&
            values.get("WHSC:PN") === 800 &&
            values.get("WHTC:NOX") === 460
          );
        },
      },
      {
        name: "MNE Euro VI road limits start on 2018-10-15 with the >15 kW boundary",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2018-10-14",
            countryIso3: "MNE",
            powerKw: 150,
          });
          const atExcludedPower = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-08-10",
            countryIso3: "MNE",
            powerKw: 15,
          });
          const [truck, bus, construction, agriculture] = await Promise.all(
            ([
              "on-road-truck",
              "on-road-bus",
              "construction",
              "agriculture",
            ] as const).map((applicationScope) =>
              regulationRepository.findEffectiveByCountry({
                applicationScope,
                asOf: "2026-08-10",
                countryIso3: "MNE",
                powerKw: 150,
              }),
            ),
          );
          const values = new Map(
            truck.map((row) => [
              `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            before.length === 0 &&
            atExcludedPower.length === 0 &&
            truck.length === 16 &&
            bus.length === 16 &&
            construction.length === 0 &&
            agriculture.length === 0 &&
            values.get("WHSC:PN") === 800 &&
            values.get("WHTC:NOX") === 460 &&
            values.get("WNTE:NOX") === 600 &&
            values.get("WNTE:PM") === 16
          );
        },
      },
      {
        name: "NPL Standard 2082 road limits start on 2025-06-23 and excluded machinery stays no-data",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2025-06-22",
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
              regulationRepository.findEffectiveByCountry({
                applicationScope,
                asOf: "2026-08-10",
                countryIso3: "NPL",
                powerKw: 150,
              }),
            ),
          );
          const values = new Map(
            truck.map((row) => [
              `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            before.length === 0 &&
            truck.length === 16 &&
            bus.length === 16 &&
            construction.length === 0 &&
            agriculture.length === 0 &&
            values.get("WHSC:PN") === 800 &&
            values.get("WHTC:NOX") === 460 &&
            values.get("WNTE:NOX") === 600 &&
            values.get("WNTE:PM") === 16
          );
        },
      },
      {
        name: "VNM QCVN 109 Level 5 road limits are effective from 2022-01-01",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2021-12-31",
            countryIso3: "VNM",
            powerKw: 300,
          });
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2022-01-01",
            countryIso3: "VNM",
            powerKw: 300,
          });
          const values = new Map(
            rows.map((row) => [
              `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            before.length === 0 &&
            rows.length === 9 &&
            rows.every(
              (row) => row.citationCode === "QCVN 109:2021/BGTVT",
            ) &&
            values.get("ESC:NOX") === 2 &&
            values.get("ESC:PM") === 0.02 &&
            values.get("ETC:NOX") === 2 &&
            values.get("ETC:PM") === 0.03 &&
            values.get("ELR:OPACITY") === 0.5 &&
            !values.has("ETC:CH4")
          );
        },
      },
      {
        name: "VNM non-road scopes remain explicit no-data",
        run: async () => {
          const results = await Promise.all(
            (["construction", "agriculture"] as const).map(
              (applicationScope) =>
                regulationRepository.findEffectiveByCountry({
                  applicationScope,
                  asOf: "2026-08-07",
                  countryIso3: "VNM",
                  powerKw: 150,
                }),
            ),
          );
          return results.every((rows) => rows.length === 0);
        },
      },
      {
        name: "MYS DOE VTA Euro II road limits are effective from 2017-01-01",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2016-12-31",
            countryIso3: "MYS",
            powerKw: 300,
          });
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2017-01-01",
            countryIso3: "MYS",
            powerKw: 300,
          });
          const values = new Map(
            rows.map((row) => [
              row.limit.pollutantCode,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            before.length === 0 &&
            rows.length === 4 &&
            rows.every(
              (row) =>
                row.citationCode === "P.U.(A) 429/96 / VTA Euro II",
            ) &&
            values.get("CO") === 4 &&
            values.get("HC") === 1.1 &&
            values.get("NOX") === 7 &&
            values.get("PM") === 0.15
          );
        },
      },
      {
        name: "MYS keeps tentative Euro IV and non-road scopes out of effective results",
        run: async () => {
          const roadRows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-08-07",
            countryIso3: "MYS",
            powerKw: 300,
          });
          const nonRoadResults = await Promise.all(
            (["construction", "agriculture"] as const).map(
              (applicationScope) =>
                regulationRepository.findEffectiveByCountry({
                  applicationScope,
                  asOf: "2026-08-07",
                  countryIso3: "MYS",
                  powerKw: 150,
                }),
            ),
          );
          return (
            roadRows.length === 4 &&
            roadRows.every(
              (row) =>
                row.citationCode === "P.U.(A) 429/96 / VTA Euro II",
            ) &&
            nonRoadResults.every((rows) => rows.length === 0)
          );
        },
      },
      {
        name: "ARG Resolution 1464/2014 applies B2 road limits from 2018-01-01",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2017-12-31",
            countryIso3: "ARG",
            powerKw: 300,
          });
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2018-01-01",
            countryIso3: "ARG",
            powerKw: 300,
          });
          const values = new Map(
            rows.map((row) => [
              `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
              Number(row.limit.limitValue),
            ]),
          );
          return (
            before.length === 0 &&
            rows.length === 9 &&
            rows.every(
              (row) =>
                row.citationCode ===
                "Resolución 1464/2014 / Directive 2005/55 B2",
            ) &&
            values.get("ESC/ELR:NOX") === 2 &&
            values.get("ESC/ELR:PM") === 0.02 &&
            values.get("ESC/ELR:OPACITY") === 0.5 &&
            values.get("ETC:NOX") === 2 &&
            values.get("ETC:PM") === 0.03
          );
        },
      },
      {
        name: "ARG keeps Resolution 128 military exception and non-road scopes out of ordinary effective results",
        run: async () => {
          const roadRows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-bus",
            asOf: "2026-08-07",
            countryIso3: "ARG",
            powerKw: 300,
          });
          const nonRoadResults = await Promise.all(
            (["construction", "agriculture"] as const).map(
              (applicationScope) =>
                regulationRepository.findEffectiveByCountry({
                  applicationScope,
                  asOf: "2026-08-07",
                  countryIso3: "ARG",
                  powerKw: 150,
                }),
            ),
          );
          return (
            roadRows.length === 9 &&
            roadRows.every(
              (row) =>
                row.citationCode ===
                "Resolución 1464/2014 / Directive 2005/55 B2",
            ) &&
            nonRoadResults.every((rows) => rows.length === 0)
          );
        },
      },
      {
        name: "NZL applies the unified Table 2B Euro VI Step C pathway from 2025-11-01",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2025-10-31",
            countryIso3: "NZL",
            powerKw: 300,
          });
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2025-11-01",
            countryIso3: "NZL",
            powerKw: 300,
          });
          const values = new Map(
            rows.map((row) => [
              `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
              Number(row.limit.limitValue),
            ]),
          );
          const fixtureRows = buildFixtureLimits().filter(
            (row) =>
              row.regulationId ===
                acceptanceFixtureIds.regulation.newZealandEuroVi &&
              row.applicationScope === "on-road-truck",
          );
          return (
            before.length === 0 &&
            rows.length === 12 &&
            rows.every(
              (row) =>
                row.citationCode ===
                "Land Transport Rule 33001 Table 2B / Euro VI Step C",
            ) &&
            fixtureRows.length === 12 &&
            fixtureRows.every(
              (row) =>
                row.measurementBasis?.includes("alternative pathway") ===
                  true &&
                row.measurementBasis?.includes("not cumulative") === true,
            ) &&
            values.get("WHSC:NOX") === 400 &&
            values.get("WHSC:PM") === 10 &&
            values.get("WHTC:NOX") === 460 &&
            values.get("WHTC:PM") === 10
          );
        },
      },
      {
        name: "NZL keeps tractors and other non-road scopes outside the road entry rule",
        run: async () => {
          const busRows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-bus",
            asOf: "2026-08-07",
            countryIso3: "NZL",
            powerKw: 300,
          });
          const nonRoadResults = await Promise.all(
            (["construction", "agriculture"] as const).map(
              (applicationScope) =>
                regulationRepository.findEffectiveByCountry({
                  applicationScope,
                  asOf: "2026-08-07",
                  countryIso3: "NZL",
                  powerKw: 150,
                }),
            ),
          );
          return (
            busRows.length === 12 &&
            nonRoadResults.every((rows) => rows.length === 0)
          );
        },
      },
      {
        name: "CHL applies D.S. 50 Euro VI road limits from 2026-01-06",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-01-05",
            countryIso3: "CHL",
            powerKw: 300,
          });
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
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
          const fixtureRows = buildFixtureLimits().filter(
            (row) =>
              row.regulationId ===
                acceptanceFixtureIds.regulation.chileHeavyVehicleEuroVi &&
              row.applicationScope === "on-road-truck",
          );
          return (
            before.length === 0 &&
            rows.length === 12 &&
            rows.every(
              (row) =>
                row.citationCode ===
                "D.S. 55/1994 art. 8 quater / D.S. 50/2023",
            ) &&
            fixtureRows.every(
              (row) =>
                row.measurementBasis?.includes("alternative pathway") ===
                  true &&
                row.measurementBasis?.includes("not cumulative") === true,
            ) &&
            values.get("WHSC:NOX") === 400 &&
            values.get("WHSC:PN") === 800 &&
            values.get("WHTC:NOX") === 460 &&
            values.get("WHTC:PN") === 600
          );
        },
      },
      {
        name: "CHL applies D.S. 39 Table 2 to construction and preserves the 2030 tractor boundary",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2023-10-20",
            countryIso3: "CHL",
            powerKw: 150,
          });
          const atStart = await regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2023-10-21",
            countryIso3: "CHL",
            powerKw: 150,
          });
          const atUpperBoundary =
            await regulationRepository.findEffectiveByCountry({
              applicationScope: "construction",
              asOf: "2026-08-07",
              countryIso3: "CHL",
              powerKw: 560,
            });
          const aboveUpperBoundary =
            await regulationRepository.findEffectiveByCountry({
              applicationScope: "construction",
              asOf: "2026-08-07",
              countryIso3: "CHL",
              powerKw: 560.001,
            });
          const agriculture = await regulationRepository.findEffectiveByCountry(
            {
              applicationScope: "agriculture",
              asOf: "2026-08-07",
              countryIso3: "CHL",
              powerKw: 150,
            },
          );
          const tractor = fixtureRegulations.find(
            (row) =>
              row.id === acceptanceFixtureIds.regulation.chileTractorStageV,
          );
          return (
            before.length === 0 &&
            atStart.length === 5 &&
            atUpperBoundary.length === 5 &&
            aboveUpperBoundary.length === 0 &&
            agriculture.length === 0 &&
            tractor?.status === "adopted" &&
            tractor.effectiveFrom === "2030-01-01"
          );
        },
      },
      {
        name: "COL applies Resolucion 0762 Table 22 road limits from 2023-01-01",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2022-12-31",
            countryIso3: "COL",
            powerKw: 300,
          });
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2023-01-01",
            countryIso3: "COL",
            powerKw: 300,
          });
          const values = new Map(
            rows.map((row) => [
              `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
              Number(row.limit.limitValue),
            ]),
          );
          const fixtureRows = buildFixtureLimits().filter(
            (row) =>
              row.regulationId ===
                acceptanceFixtureIds.regulation.colombiaHeavyVehicleEuroVi &&
              row.applicationScope === "on-road-truck",
          );
          return (
            before.length === 0 &&
            rows.length === 12 &&
            fixtureRows.every(
              (row) =>
                row.measurementBasis?.includes("alternative") === true &&
                row.measurementBasis?.includes("not cumulative") === true,
            ) &&
            values.get("WHSC:NOX") === 400 &&
            values.get("WHSC:PN") === 800 &&
            values.get("WHTC:NOX") === 460 &&
            values.get("WHTC:PN") === 600
          );
        },
      },
      {
        name: "COL applies Table 23 to construction and excludes agriculture",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2024-07-17",
            countryIso3: "COL",
            powerKw: 150,
          });
          const atStart = await regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2024-07-18",
            countryIso3: "COL",
            powerKw: 150,
          });
          const atUpperBoundary =
            await regulationRepository.findEffectiveByCountry({
              applicationScope: "construction",
              asOf: "2026-08-07",
              countryIso3: "COL",
              powerKw: 560,
            });
          const aboveUpperBoundary =
            await regulationRepository.findEffectiveByCountry({
              applicationScope: "construction",
              asOf: "2026-08-07",
              countryIso3: "COL",
              powerKw: 560.001,
            });
          const agriculture = await regulationRepository.findEffectiveByCountry(
            {
              applicationScope: "agriculture",
              asOf: "2026-08-07",
              countryIso3: "COL",
              powerKw: 150,
            },
          );
          return (
            before.length === 0 &&
            atStart.length === 4 &&
            atUpperBoundary.length === 4 &&
            aboveUpperBoundary.length === 0 &&
            agriculture.length === 0 &&
            atStart.every(
              (row) => row.limit.testCycleCode === "NRSC/NRTC",
            )
          );
        },
      },
      {
        name: "PER applies D.S. 029 Euro VI/A to road vehicles and keeps non-road no-data",
        run: async () => {
          const before = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2024-09-30",
            countryIso3: "PER",
            powerKw: 300,
          });
          const truckRows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2024-10-01",
            countryIso3: "PER",
            powerKw: 300,
          });
          const busRows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-bus",
            asOf: "2024-10-01",
            countryIso3: "PER",
            powerKw: 300,
          });
          const nonRoadResults = await Promise.all(
            (["construction", "agriculture"] as const).map(
              (applicationScope) =>
                regulationRepository.findEffectiveByCountry({
                  applicationScope,
                  asOf: "2026-08-08",
                  countryIso3: "PER",
                  powerKw: 150,
                }),
            ),
          );
          const values = new Map(
            truckRows.map((row) => [
              `${row.limit.testCycleCode}:${row.limit.pollutantCode}`,
              Number(row.limit.limitValue),
            ]),
          );
          const fixtureRows = buildFixtureLimits().filter(
            (row) =>
              row.regulationId ===
                acceptanceFixtureIds.regulation.peruHeavyVehicleEuroVi &&
              row.applicationScope === "on-road-truck",
          );
          return (
            before.length === 0 &&
            truckRows.length === 12 &&
            busRows.length === 12 &&
            nonRoadResults.every((rows) => rows.length === 0) &&
            fixtureRows.every(
              (row) =>
                row.measurementBasis?.includes("alternative") === true &&
                row.measurementBasis?.includes("not cumulative") === true,
            ) &&
            values.get("WHSC:NOX") === 400 &&
            values.get("WHSC:PN") === 800 &&
            values.get("WHTC:NOX") === 460 &&
            values.get("WHTC:PN") === 600
          );
        },
      },
      {
        name: "SGP applies alternative Euro VI road and Stage II construction paths without agriculture inference",
        run: async () => {
          const roadBefore = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2017-12-31",
            countryIso3: "SGP",
            powerKw: 300,
          });
          const roadResults = await Promise.all(
            (["on-road-truck", "on-road-bus"] as const).map(
              (applicationScope) =>
                regulationRepository.findEffectiveByCountry({
                  applicationScope,
                  asOf: "2018-01-01",
                  countryIso3: "SGP",
                  powerKw: 300,
                }),
            ),
          );
          const constructionResults = await Promise.all(
            [17.999, 18, 37, 75, 130, 559.999, 560].map((powerKw) =>
              regulationRepository.findEffectiveByCountry({
                applicationScope: "construction",
                asOf: "2026-08-08",
                countryIso3: "SGP",
                powerKw,
              }),
            ),
          );
          const agriculture = await regulationRepository.findEffectiveByCountry({
            applicationScope: "agriculture",
            asOf: "2026-08-08",
            countryIso3: "SGP",
            powerKw: 150,
          });
          const fixtureRows = buildFixtureLimits().filter((row) =>
            [
              acceptanceFixtureIds.regulation.singaporeHeavyVehicleEuroVi,
              acceptanceFixtureIds.regulation.singaporeOffRoadStageIi,
            ].includes(row.regulationId),
          );
          const noxAt18 = constructionResults[1]?.find(
            (row) => row.limit.pollutantCode === "NOX",
          );
          const noxAt37 = constructionResults[2]?.find(
            (row) => row.limit.pollutantCode === "NOX",
          );
          return (
            roadBefore.length === 0 &&
            roadResults.every((rows) => rows.length === 12) &&
            constructionResults[0]?.length === 0 &&
            constructionResults.slice(1, 6).every((rows) => rows.length === 4) &&
            constructionResults[6]?.length === 0 &&
            agriculture.length === 0 &&
            Number(noxAt18?.limit.limitValue) === 8 &&
            Number(noxAt37?.limit.limitValue) === 7 &&
            fixtureRows.every(
              (row) =>
                row.measurementBasis?.includes("alternative") === true &&
                row.measurementBasis?.includes("not cumulative") === true,
            )
          );
        },
      },
      {
        name: "NOR applies incorporated Euro VI and Stage V paths with national source evidence",
        run: async () => {
          const roadResults = await Promise.all(
            [
              ["on-road-truck", "2022-09-30"],
              ["on-road-truck", "2022-10-01"],
              ["on-road-bus", "2022-10-01"],
              ["on-road-truck", "2029-05-28"],
              ["on-road-truck", "2029-05-29"],
            ].map(([applicationScope, asOf]) =>
              regulationRepository.findEffectiveByCountry({
                applicationScope: applicationScope as
                  | "on-road-truck"
                  | "on-road-bus",
                asOf: asOf as string,
                countryIso3: "NOR",
                powerKw: 300,
              }),
            ),
          );
          const nonRoadResults = await Promise.all(
            (["construction", "agriculture"] as const).flatMap(
              (applicationScope) =>
                [
                  ["2020-06-30", 150],
                  ["2020-07-01", 150],
                  ["2026-08-08", 559.999],
                  ["2026-08-08", 560],
                ].map(([asOf, powerKw]) =>
                  regulationRepository.findEffectiveByCountry({
                    applicationScope,
                    asOf: asOf as string,
                    countryIso3: "NOR",
                    powerKw: powerKw as number,
                  }),
                ),
            ),
          );
          const fixtureRows = buildFixtureLimits().filter((row) =>
            [
              acceptanceFixtureIds.regulation.norwayHeavyVehicleEuroVi,
              acceptanceFixtureIds.regulation.norwayNrmmStageV,
            ].includes(row.regulationId),
          );
          return (
            roadResults.map((rows) => rows.length).join(",") ===
              "0,12,12,12,0" &&
            nonRoadResults.map((rows) => rows.length).join(",") ===
              "0,5,5,4,0,5,5,4" &&
            fixtureRows.every(
              (row) =>
                row.measurementBasis?.includes("Norway") === true &&
                row.measurementBasis?.includes("traced to") === true,
            )
          );
        },
      },
      {
        name: "ISL preserves the Euro VI and Stage V national succession boundaries",
        run: async () => {
          const roadResults = await Promise.all(
            [
              ["on-road-truck", "2013-04-14"],
              ["on-road-truck", "2013-04-15"],
              ["on-road-bus", "2013-04-15"],
              ["on-road-truck", "2027-11-28"],
              ["on-road-truck", "2027-11-29"],
            ].map(([applicationScope, asOf]) =>
              regulationRepository.findEffectiveByCountry({
                applicationScope: applicationScope as
                  | "on-road-truck"
                  | "on-road-bus",
                asOf: asOf as string,
                countryIso3: "ISL",
                powerKw: 300,
              }),
            ),
          );
          const nonRoadResults = await Promise.all(
            (["construction", "agriculture"] as const).flatMap(
              (applicationScope) =>
                [
                  ["2020-11-30", 150],
                  ["2020-12-01", 150],
                  ["2021-02-22", 150],
                  ["2021-02-23", 150],
                  ["2026-08-08", 559.999],
                  ["2026-08-08", 560],
                ].map(([asOf, powerKw]) =>
                  regulationRepository.findEffectiveByCountry({
                    applicationScope,
                    asOf: asOf as string,
                    countryIso3: "ISL",
                    powerKw: powerKw as number,
                  }),
                ),
            ),
          );
          const fixtureRows = buildFixtureLimits().filter((row) =>
            [
              acceptanceFixtureIds.regulation.icelandHeavyVehicleEuroVi,
              acceptanceFixtureIds.regulation.icelandNrmmStageV2020,
              acceptanceFixtureIds.regulation.icelandNrmmStageV2021,
            ].includes(row.regulationId),
          );
          return (
            roadResults.map((rows) => rows.length).join(",") ===
              "0,12,12,12,0" &&
            nonRoadResults.map((rows) => rows.length).join(",") ===
              "0,5,5,5,5,4,0,5,5,5,5,4" &&
            fixtureRows.length > 0 &&
            fixtureRows.every(
              (row) =>
                row.measurementBasis?.includes("Iceland") === true &&
                row.measurementBasis?.includes("traced to") === true,
            )
          );
        },
      },
      {
        name: "LIE preserves current VTS and EWR Stage V boundaries",
        run: async () => {
          const road = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-07-01",
            countryIso3: "LIE",
            powerKw: 300,
          });
          const nonRoad = await regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2020-08-01",
            countryIso3: "LIE",
            powerKw: 150,
          });
          const fixtureRows = buildFixtureLimits().filter((row) =>
            [
              acceptanceFixtureIds.regulation.liechtensteinHeavyVehicleEuroVi,
              acceptanceFixtureIds.regulation.liechtensteinNrmmStageV,
            ].includes(row.regulationId),
          );
          return (
            road.length === 12 &&
            nonRoad.length === 5 &&
            fixtureRows.length > 0 &&
            fixtureRows.every(
              (row) =>
                row.measurementBasis?.includes("Liechtenstein") === true &&
                row.measurementBasis?.includes("traced to") === true,
            )
          );
        },
      },
      {
        name: "CHE preserves current VTS road and non-road boundaries",
        run: async () => {
          const road = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-07-01",
            countryIso3: "CHE",
            powerKw: 300,
          });
          const nonRoad = await regulationRepository.findEffectiveByCountry({
            applicationScope: "construction",
            asOf: "2026-07-01",
            countryIso3: "CHE",
            powerKw: 150,
          });
          const fixtureRows = buildFixtureLimits().filter((row) =>
            [
              acceptanceFixtureIds.regulation.switzerlandHeavyVehicleEuroVi,
              acceptanceFixtureIds.regulation.switzerlandNrmmStageV,
            ].includes(row.regulationId),
          );
          return (
            road.length === 12 &&
            nonRoad.length === 5 &&
            fixtureRows.length > 0 &&
            fixtureRows.every(
              (row) =>
                row.measurementBasis?.includes("Swiss VTS") === true &&
                row.measurementBasis?.includes("traced to") === true,
            )
          );
        },
      },
      {
        name: "signed country set including IND, RUS, IDN, THA, VNM, MYS and SAU has covered status and details available",
        run: async () => {
          const countries = await Promise.all(
            coveredCountryIso3.map((iso3) =>
              countryRepository.findByIso3({ iso3 }),
            ),
          );
          return countries.every(
            (country) => country?.dataCoverageStatus === "covered",
          );
        },
      },
      {
        name: "FRA inherits signed EU Euro VI limits through EU membership",
        run: async () => {
          const rows = await regulationRepository.findEffectiveByCountry({
            applicationScope: "on-road-truck",
            asOf: "2026-07-30",
            countryIso3: "FRA",
            powerKw: 300,
          });
          const noxValues = rows
            .filter((row) => row.limit.pollutantCode === "NOX")
            .map((row) => Number(row.limit.limitValue));
          return (
            rows.length > 0 &&
            rows.every((row) => row.citationCode === "CELEX:32009R0595") &&
            noxValues.includes(400) &&
            noxValues.includes(460)
          );
        },
      },
    ];

    for (const check of checks) {
      const passed = await check.run();
      process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${check.name}\n`);
      if (!passed) {
        failures.push(check.name);
      }
    }

    if (failures.length > 0) {
      process.stderr.write(
        `Ingestion completed but ${failures.length} acceptance check(s) failed.\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write("Ingestion and acceptance checks completed.\n");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Ingestion failed: ${message}\n`);
  process.exitCode = 1;
});
