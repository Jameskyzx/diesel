import {
  dataSources,
  marketMetrics,
} from "@/server/db/schema";

const marketReadbackTimestamp = new Date("2026-08-03T00:00:00.000Z");
const marketRecordTimestamps = {
  createdAt: marketReadbackTimestamp,
  updatedAt: marketReadbackTimestamp,
  verifiedAt: marketReadbackTimestamp,
} as const;

const ID_PREFIX = "10000000-0000-4000-8000-00000000";
const id = (suffix: string): string => `${ID_PREFIX}${suffix}`;

export const acceptedMarketFixtureIds = {
  source: {
    braSenatran2022: id("1201"),
    braSenatran2023: id("1202"),
    chnNbs2024: id("1203"),
    deuEurostatBus: id("1204"),
    deuEurostatTruck: id("1205"),
    usaFhwaMv10x2022: id("1206"),
    usaFhwaMv10x2023: id("1207"),
    usaFhwaMv1x2022: id("1208"),
    usaFhwaMv1x2023: id("1209"),
  },
  observation: {
    braBus2022: id("1301"),
    braBus2023: id("1302"),
    braBusYoy2023: id("1303"),
    braTruck2022: id("1304"),
    braTruck2023: id("1305"),
    braTruckYoy2023: id("1306"),
    chnBus2022: id("1307"),
    chnBus2023: id("1308"),
    chnBusYoy2023: id("1309"),
    chnTruck2022: id("1310"),
    chnTruck2023: id("1311"),
    chnTruckYoy2023: id("1312"),
    deuBus2022: id("1313"),
    deuBus2023: id("1314"),
    deuBusYoy2023: id("1315"),
    deuTruck2022: id("1316"),
    deuTruck2023: id("1317"),
    deuTruckYoy2023: id("1318"),
    usaBus2022: id("1319"),
    usaBus2023: id("1320"),
    usaBusYoy2023: id("1321"),
    usaTruck2022: id("1322"),
    usaTruck2023: id("1323"),
    usaTruckYoy2023: id("1324"),
  },
} as const;

export const fixtureMarketSources: (typeof dataSources.$inferInsert)[] = [
  {
    ...marketRecordTimestamps,
    id: acceptedMarketFixtureIds.source.chnNbs2024,
    isDemo: false,
    publishedOn: null,
    publisher: "中华人民共和国国家统计局",
    sourceType: "other",
    title: "中国统计年鉴 2024 表 16-20 民用汽车拥有量",
    url: "https://www.stats.gov.cn/sj/ndsj/2024/left.htm",
  },
  {
    ...marketRecordTimestamps,
    id: acceptedMarketFixtureIds.source.usaFhwaMv1x2022,
    isDemo: false,
    publishedOn: null,
    publisher: "U.S. Federal Highway Administration",
    sourceType: "other",
    title: "Highway Statistics 2022 Table MV-1 State Motor-Vehicle Registrations",
    url: "https://www.fhwa.dot.gov/policyinformation/statistics/2022/mv1.cfm",
  },
  {
    ...marketRecordTimestamps,
    id: acceptedMarketFixtureIds.source.usaFhwaMv1x2023,
    isDemo: false,
    publishedOn: null,
    publisher: "U.S. Federal Highway Administration",
    sourceType: "other",
    title: "Highway Statistics 2023 Table MV-1 State Motor-Vehicle Registrations",
    url: "https://www.fhwa.dot.gov/policyinformation/statistics/2023/mv1.cfm",
  },
  {
    ...marketRecordTimestamps,
    id: acceptedMarketFixtureIds.source.usaFhwaMv10x2022,
    isDemo: false,
    publishedOn: null,
    publisher: "U.S. Federal Highway Administration",
    sourceType: "other",
    title: "Highway Statistics 2022 Table MV-10 Bus Registrations",
    url: "https://www.fhwa.dot.gov/policyinformation/statistics/2022/mv10.cfm",
  },
  {
    ...marketRecordTimestamps,
    id: acceptedMarketFixtureIds.source.usaFhwaMv10x2023,
    isDemo: false,
    publishedOn: null,
    publisher: "U.S. Federal Highway Administration",
    sourceType: "other",
    title: "Highway Statistics 2023 Table MV-10 Bus Registrations",
    url: "https://www.fhwa.dot.gov/policyinformation/statistics/2023/mv10.cfm",
  },
  {
    ...marketRecordTimestamps,
    id: acceptedMarketFixtureIds.source.deuEurostatTruck,
    isDemo: false,
    publishedOn: null,
    publisher: "Eurostat",
    sourceType: "other",
    title: "ROAD_EQS_LORROA Goods road vehicle fleet by vehicle and age",
    url: "https://doi.org/10.2908/ROAD_EQS_LORROA",
  },
  {
    ...marketRecordTimestamps,
    id: acceptedMarketFixtureIds.source.deuEurostatBus,
    isDemo: false,
    publishedOn: null,
    publisher: "Eurostat",
    sourceType: "other",
    title: "ROAD_EQS_BUSMOT Buses and coaches by motor energy",
    url: "https://doi.org/10.2908/ROAD_EQS_BUSMOT",
  },
  {
    ...marketRecordTimestamps,
    id: acceptedMarketFixtureIds.source.braSenatran2022,
    isDemo: false,
    publishedOn: null,
    publisher: "Ministério dos Transportes / SENATRAN",
    sourceType: "other",
    title: "Frota Nacional Dezembro 2022 — por UF e tipo de veículo",
    url: "https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/frota-de-veiculos-2022",
  },
  {
    ...marketRecordTimestamps,
    id: acceptedMarketFixtureIds.source.braSenatran2023,
    isDemo: false,
    publishedOn: null,
    publisher: "Ministério dos Transportes / SENATRAN",
    sourceType: "other",
    title: "Frota Nacional Dezembro 2023 — por UF e tipo de veículo",
    url: "https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/frota-de-veiculos-2023",
  },
];

type MarketFixture = typeof marketMetrics.$inferInsert;
type RoadScope = "on-road-bus" | "on-road-truck";

function yearEndObservation(input: {
  applicationScope: RoadScope;
  countryIso3: "BRA" | "CHN" | "DEU" | "USA";
  dataSourceId: string;
  definition: string;
  id: string;
  methodologyVersion: string;
  value: number;
  year: 2022 | 2023;
}): MarketFixture {
  return {
    ...marketRecordTimestamps,
    applicationScope: input.applicationScope,
    countryIso3: input.countryIso3,
    currencyCode: null,
    dataSourceId: input.dataSourceId,
    definition: input.definition,
    id: input.id,
    isDemo: false,
    methodologyVersion: input.methodologyVersion,
    metricCode: "REGISTERED_FLEET_YEAR_END",
    metricName: "年末注册车队",
    periodEnd: `${input.year + 1}-01-01`,
    periodStart: `${input.year}-01-01`,
    publishedOn: null,
    unitCode: "vehicle",
    valueNumeric: input.value.toFixed(6),
  };
}

function yoyObservation(input: {
  current: MarketFixture;
  id: string;
  prior: MarketFixture;
}): MarketFixture {
  if (
    input.current.countryIso3 !== input.prior.countryIso3 ||
    input.current.applicationScope !== input.prior.applicationScope ||
    input.current.methodologyVersion !== input.prior.methodologyVersion ||
    input.current.periodStart !== "2023-01-01" ||
    input.prior.periodStart !== "2022-01-01"
  ) {
    throw new Error("YoY fixtures require consecutive, method-compatible observations.");
  }

  const currentValue = Number(input.current.valueNumeric);
  const priorValue = Number(input.prior.valueNumeric);
  if (!Number.isFinite(currentValue) || !Number.isFinite(priorValue) || priorValue <= 0) {
    throw new Error("YoY fixtures require finite values and a positive prior value.");
  }

  return {
    ...marketRecordTimestamps,
    applicationScope: input.current.applicationScope,
    countryIso3: input.current.countryIso3,
    currencyCode: null,
    dataSourceId: input.current.dataSourceId,
    definition:
      `由年末观察值 ${input.prior.id}（${priorValue}）与 ${input.current.id}（${currentValue}）` +
      `按 ((current / prior) - 1) × 100 确定性计算；两期方法版本均为 ${input.current.methodologyVersion}。`,
    id: input.id,
    isDemo: false,
    methodologyVersion: input.current.methodologyVersion,
    metricCode: "REGISTERED_FLEET_YOY_CHANGE_PCT",
    metricName: "年末注册车队同比变化",
    periodEnd: input.current.periodEnd,
    periodStart: input.current.periodStart,
    publishedOn: input.current.publishedOn,
    unitCode: "percent",
    valueNumeric: (((currentValue / priorValue) - 1) * 100).toFixed(6),
  };
}

const yearEndFixtures: MarketFixture[] = [
  yearEndObservation({
    applicationScope: "on-road-truck",
    countryIso3: "CHN",
    dataSourceId: acceptedMarketFixtureIds.source.chnNbs2024,
    definition: "国家统计局《中国统计年鉴 2024》表 16-20：载货汽车合计；原表单位万辆，乘以 10,000 转为 vehicle。",
    id: acceptedMarketFixtureIds.observation.chnTruck2022,
    methodologyVersion: "official-register-stock-chn-nbs-v1",
    value: 33_176_500,
    year: 2022,
  }),
  yearEndObservation({
    applicationScope: "on-road-truck",
    countryIso3: "CHN",
    dataSourceId: acceptedMarketFixtureIds.source.chnNbs2024,
    definition: "国家统计局《中国统计年鉴 2024》表 16-20：载货汽车合计；原表单位万辆，乘以 10,000 转为 vehicle。",
    id: acceptedMarketFixtureIds.observation.chnTruck2023,
    methodologyVersion: "official-register-stock-chn-nbs-v1",
    value: 33_589_400,
    year: 2023,
  }),
  yearEndObservation({
    applicationScope: "on-road-bus",
    countryIso3: "CHN",
    dataSourceId: acceptedMarketFixtureIds.source.chnNbs2024,
    definition: "国家统计局《中国统计年鉴 2024》表 16-20：大型载客汽车 + 中型载客汽车；原表单位万辆，求和后乘以 10,000 转为 vehicle。",
    id: acceptedMarketFixtureIds.observation.chnBus2022,
    methodologyVersion: "official-register-stock-chn-nbs-v1",
    value: 2_094_800,
    year: 2022,
  }),
  yearEndObservation({
    applicationScope: "on-road-bus",
    countryIso3: "CHN",
    dataSourceId: acceptedMarketFixtureIds.source.chnNbs2024,
    definition: "国家统计局《中国统计年鉴 2024》表 16-20：大型载客汽车 + 中型载客汽车；原表单位万辆，求和后乘以 10,000 转为 vehicle。",
    id: acceptedMarketFixtureIds.observation.chnBus2023,
    methodologyVersion: "official-register-stock-chn-nbs-v1",
    value: 2_010_900,
    year: 2023,
  }),
  yearEndObservation({
    applicationScope: "on-road-truck",
    countryIso3: "USA",
    dataSourceId: acceptedMarketFixtureIds.source.usaFhwaMv1x2022,
    definition: "FHWA Highway Statistics 2022 Table MV-1：Trucks total（private/commercial + publicly owned）；该宽口径包含轻型卡车类。",
    id: acceptedMarketFixtureIds.observation.usaTruck2022,
    methodologyVersion: "official-register-stock-usa-fhwa-v1",
    value: 172_364_078,
    year: 2022,
  }),
  yearEndObservation({
    applicationScope: "on-road-truck",
    countryIso3: "USA",
    dataSourceId: acceptedMarketFixtureIds.source.usaFhwaMv1x2023,
    definition: "FHWA Highway Statistics 2023 Table MV-1：Trucks total（private/commercial + publicly owned）；该宽口径包含轻型卡车类。",
    id: acceptedMarketFixtureIds.observation.usaTruck2023,
    methodologyVersion: "official-register-stock-usa-fhwa-v1",
    value: 177_228_271,
    year: 2023,
  }),
  yearEndObservation({
    applicationScope: "on-road-bus",
    countryIso3: "USA",
    dataSourceId: acceptedMarketFixtureIds.source.usaFhwaMv10x2022,
    definition: "FHWA Highway Statistics 2022 Table MV-10：Grand total buses（private/commercial + publicly owned + federal）。",
    id: acceptedMarketFixtureIds.observation.usaBus2022,
    methodologyVersion: "official-register-stock-usa-fhwa-v1",
    value: 958_055,
    year: 2022,
  }),
  yearEndObservation({
    applicationScope: "on-road-bus",
    countryIso3: "USA",
    dataSourceId: acceptedMarketFixtureIds.source.usaFhwaMv10x2023,
    definition: "FHWA Highway Statistics 2023 Table MV-10：Grand total buses（private/commercial + publicly owned + federal）。",
    id: acceptedMarketFixtureIds.observation.usaBus2023,
    methodologyVersion: "official-register-stock-usa-fhwa-v1",
    value: 967_525,
    year: 2023,
  }),
  yearEndObservation({
    applicationScope: "on-road-truck",
    countryIso3: "DEU",
    dataSourceId: acceptedMarketFixtureIds.source.deuEurostatTruck,
    definition: "Eurostat ROAD_EQS_LORROA：LOR_GT3P5/TOTAL + TRC/TOTAL；排除 VG_LE3P5。",
    id: acceptedMarketFixtureIds.observation.deuTruck2022,
    methodologyVersion: "official-register-stock-deu-eurostat-v1",
    value: 757_813,
    year: 2022,
  }),
  yearEndObservation({
    applicationScope: "on-road-truck",
    countryIso3: "DEU",
    dataSourceId: acceptedMarketFixtureIds.source.deuEurostatTruck,
    definition: "Eurostat ROAD_EQS_LORROA：LOR_GT3P5/TOTAL + TRC/TOTAL；排除 VG_LE3P5。",
    id: acceptedMarketFixtureIds.observation.deuTruck2023,
    methodologyVersion: "official-register-stock-deu-eurostat-v1",
    value: 757_491,
    year: 2023,
  }),
  yearEndObservation({
    applicationScope: "on-road-bus",
    countryIso3: "DEU",
    dataSourceId: acceptedMarketFixtureIds.source.deuEurostatBus,
    definition: "Eurostat ROAD_EQS_BUSMOT：BUSMOT / TOTAL（客车、长途客车与无轨电车，全部动力）。",
    id: acceptedMarketFixtureIds.observation.deuBus2022,
    methodologyVersion: "official-register-stock-deu-eurostat-v1",
    value: 82_932,
    year: 2022,
  }),
  yearEndObservation({
    applicationScope: "on-road-bus",
    countryIso3: "DEU",
    dataSourceId: acceptedMarketFixtureIds.source.deuEurostatBus,
    definition: "Eurostat ROAD_EQS_BUSMOT：BUSMOT / TOTAL（客车、长途客车与无轨电车，全部动力）。",
    id: acceptedMarketFixtureIds.observation.deuBus2023,
    methodologyVersion: "official-register-stock-deu-eurostat-v1",
    value: 84_628,
    year: 2023,
  }),
  yearEndObservation({
    applicationScope: "on-road-truck",
    countryIso3: "BRA",
    dataSourceId: acceptedMarketFixtureIds.source.braSenatran2022,
    definition: "SENATRAN Frota Nacional Dezembro 2022：CAMINHÃO + CAMINHÃO TRATOR；排除 CAMINHONETE/CAMIONETA。",
    id: acceptedMarketFixtureIds.observation.braTruck2022,
    methodologyVersion: "official-register-stock-bra-senatran-v1",
    value: 3_871_687,
    year: 2022,
  }),
  yearEndObservation({
    applicationScope: "on-road-truck",
    countryIso3: "BRA",
    dataSourceId: acceptedMarketFixtureIds.source.braSenatran2023,
    definition: "SENATRAN Frota Nacional Dezembro 2023：CAMINHÃO + CAMINHÃO TRATOR；排除 CAMINHONETE/CAMIONETA。",
    id: acceptedMarketFixtureIds.observation.braTruck2023,
    methodologyVersion: "official-register-stock-bra-senatran-v1",
    value: 3_980_714,
    year: 2023,
  }),
  yearEndObservation({
    applicationScope: "on-road-bus",
    countryIso3: "BRA",
    dataSourceId: acceptedMarketFixtureIds.source.braSenatran2022,
    definition: "SENATRAN Frota Nacional Dezembro 2022：ÔNIBUS + MICROÔNIBUS。",
    id: acceptedMarketFixtureIds.observation.braBus2022,
    methodologyVersion: "official-register-stock-bra-senatran-v1",
    value: 1_123_588,
    year: 2022,
  }),
  yearEndObservation({
    applicationScope: "on-road-bus",
    countryIso3: "BRA",
    dataSourceId: acceptedMarketFixtureIds.source.braSenatran2023,
    definition: "SENATRAN Frota Nacional Dezembro 2023：ÔNIBUS + MICROÔNIBUS。",
    id: acceptedMarketFixtureIds.observation.braBus2023,
    methodologyVersion: "official-register-stock-bra-senatran-v1",
    value: 1_152_852,
    year: 2023,
  }),
];

const yearEndById = new Map(yearEndFixtures.map((fixture) => [fixture.id, fixture]));

function requiredYearEnd(idValue: string): MarketFixture {
  const fixture = yearEndById.get(idValue);
  if (!fixture) {
    throw new Error(`Missing year-end fixture ${idValue}.`);
  }
  return fixture;
}

const yoySpecs = [
  [acceptedMarketFixtureIds.observation.chnTruckYoy2023, acceptedMarketFixtureIds.observation.chnTruck2022, acceptedMarketFixtureIds.observation.chnTruck2023],
  [acceptedMarketFixtureIds.observation.chnBusYoy2023, acceptedMarketFixtureIds.observation.chnBus2022, acceptedMarketFixtureIds.observation.chnBus2023],
  [acceptedMarketFixtureIds.observation.usaTruckYoy2023, acceptedMarketFixtureIds.observation.usaTruck2022, acceptedMarketFixtureIds.observation.usaTruck2023],
  [acceptedMarketFixtureIds.observation.usaBusYoy2023, acceptedMarketFixtureIds.observation.usaBus2022, acceptedMarketFixtureIds.observation.usaBus2023],
  [acceptedMarketFixtureIds.observation.deuTruckYoy2023, acceptedMarketFixtureIds.observation.deuTruck2022, acceptedMarketFixtureIds.observation.deuTruck2023],
  [acceptedMarketFixtureIds.observation.deuBusYoy2023, acceptedMarketFixtureIds.observation.deuBus2022, acceptedMarketFixtureIds.observation.deuBus2023],
  [acceptedMarketFixtureIds.observation.braTruckYoy2023, acceptedMarketFixtureIds.observation.braTruck2022, acceptedMarketFixtureIds.observation.braTruck2023],
  [acceptedMarketFixtureIds.observation.braBusYoy2023, acceptedMarketFixtureIds.observation.braBus2022, acceptedMarketFixtureIds.observation.braBus2023],
] as const;

export const fixtureMarketMetrics: MarketFixture[] = [
  ...yearEndFixtures,
  ...yoySpecs.map(([yoyId, priorId, currentId]) =>
    yoyObservation({
      current: requiredYearEnd(currentId),
      id: yoyId,
      prior: requiredYearEnd(priorId),
    }),
  ),
];
