import { powerToKw } from "@/domain/feedback/resolve-extraction";
import { engineFeedbackDraftPayloadSchema, type EngineFeedbackDraftPayload } from "@/features/feedback/schemas";
import { demoEngineCatalogFixture } from "@/server/db/seed/demo-engine-catalog";

/**
 * Fictional customer feedback for the fictional demo catalogue. Every record
 * is invented to exercise the model page, trends and chat lookup; none comes
 * from a real customer. The offline demo seeds it directly; production
 * publishes it through governance with scripts/db/ingest-demo-catalogue.ts.
 */

type Seed = Omit<EngineFeedbackDraftPayload,
  "catalogEngineId" | "customerRef" | "evidenceVerified" | "isDemo" | "requestedPowerKw" | "sourceBatchId" | "id"> & { key: string };

const seeds: Seed[] = [
  { key: "a01", modelCode: "DEMO-H13-460", countryIso3: "BRA", occurredOn: "2026-04-12", receivedOn: "2026-04-15", category: "failure", system: "intake", component: "进气管", symptom: "运行约 800 小时后进气管断裂", customerRequest: "要求更换加强型进气管", tags: ["进气", "断裂"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: 2, severity: "high", evidenceQuote: "两台车的进气管都裂了，才跑了800小时左右", sourceKind: "chat_screenshot", sourceLanguage: "zh" },
  { key: "a02", modelCode: "DEMO-H13-460", countryIso3: "BRA", occurredOn: "2026-06-03", receivedOn: "2026-06-05", category: "failure", system: "intake", component: "进气管卡箍", symptom: "进气管卡箍松脱导致漏气", customerRequest: null, tags: ["进气", "漏气"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: 1, severity: "medium", evidenceQuote: "进气管卡箍松了，一直漏气", sourceKind: "chat_screenshot", sourceLanguage: "zh" },
  { key: "a03", modelCode: "DEMO-H13-460", countryIso3: "ZAF", occurredOn: null, receivedOn: "2026-07-20", category: "performance_request", system: "power_output", component: null, symptom: "Customer finds power short on long climbs", customerRequest: "Asks for a 500 hp rating", tags: ["power"], requestedPowerValue: 500, requestedPowerUnit: "hp", quantityAffected: null, severity: "low", evidenceQuote: "on the long climbs it is short of power, can you do 500 hp", sourceKind: "email", sourceLanguage: "en" },
  { key: "a04", modelCode: "DEMO-H13-460E", countryIso3: "DEU", occurredOn: "2026-05-18", receivedOn: "2026-05-20", category: "failure", system: "aftertreatment", component: "SCR 尿素喷嘴", symptom: "尿素喷嘴结晶导致排放报警", customerRequest: "需要清洗方案和备件", tags: ["后处理", "结晶"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: 3, severity: "medium", evidenceQuote: "三台车尿素喷嘴结晶，仪表报排放故障", sourceKind: "paper_photo", sourceLanguage: "zh" },
  { key: "a05", modelCode: "DEMO-H13-460E", countryIso3: "DEU", occurredOn: null, receivedOn: "2026-08-02", category: "documentation", system: "other", component: null, symptom: "Dealer needs the emission certificate copy", customerRequest: "Send the certificate and test report", tags: ["certificate"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: null, severity: "low", evidenceQuote: "please send us the emission certificate and the test report", sourceKind: "email", sourceLanguage: "en" },
  { key: "a06", modelCode: "DEMO-H10-375", countryIso3: "IND", occurredOn: "2026-03-22", receivedOn: "2026-03-25", category: "failure", system: "cooling", component: "水泵", symptom: "高温工况下水温过高", customerRequest: "希望更换大流量水泵", tags: ["过热", "水泵"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: 4, severity: "high", evidenceQuote: "4台车夏天水温过高，经常报警停机", sourceKind: "chat_screenshot", sourceLanguage: "zh" },
  { key: "a07", modelCode: "DEMO-H10-375", countryIso3: "IND", occurredOn: null, receivedOn: "2026-09-14", category: "commercial", system: "other", component: null, symptom: "经销商反映报价高于竞品", customerRequest: "希望降价或延长质保", tags: ["价格"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: null, severity: "low", evidenceQuote: "价格比竞品高，客户希望降价或者延长质保", sourceKind: "text", sourceLanguage: "zh" },
  { key: "a08", modelCode: "DEMO-N6-220", countryIso3: "SAU", occurredOn: "2026-07-08", receivedOn: "2026-07-10", category: "failure", system: "lubrication", component: "油底壳", symptom: "油底壳密封处渗油", customerRequest: "要求上门维修", tags: ["漏油"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: 1, severity: "medium", evidenceQuote: "挖机油底壳那里一直渗油", sourceKind: "chat_screenshot", sourceLanguage: "zh" },
  { key: "a09", modelCode: "DEMO-N6-220", countryIso3: "MEX", occurredOn: null, receivedOn: "2026-08-21", category: "performance_request", system: "power_output", component: null, symptom: "Customer wants more power for a larger excavator", customerRequest: "Asks for 180 kW", tags: ["power"], requestedPowerValue: 180, requestedPowerUnit: "kW", quantityAffected: null, severity: "low", evidenceQuote: "we need 180 kW for the new excavator", sourceKind: "text", sourceLanguage: "en" },
  { key: "a10", modelCode: "DEMO-N4-110", countryIso3: "CHN", occurredOn: "2026-09-02", receivedOn: "2026-09-03", category: "quality", system: "structure", component: "飞轮壳", symptom: "怠速时飞轮壳附近异响", customerRequest: null, tags: ["噪音", "异响"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: 2, severity: "medium", evidenceQuote: "怠速的时候飞轮壳那边有异响，2台都这样", sourceKind: "paper_photo", sourceLanguage: "zh" },
  { key: "a11", modelCode: "DEMO-A4-90", countryIso3: "BRA", occurredOn: null, receivedOn: "2026-05-30", category: "service_parts", system: "fuel", component: "燃油滤清器", symptom: "当地买不到原厂燃油滤清器", customerRequest: "希望在当地设备件库存", tags: ["配件"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: null, severity: "low", evidenceQuote: "这边买不到原厂的燃油滤清器", sourceKind: "chat_screenshot", sourceLanguage: "zh" },
  { key: "a12", modelCode: "DEMO-G12-500", countryIso3: "ZAF", occurredOn: "2026-10-04", receivedOn: "2026-10-06", category: "failure", system: "electronics", component: "ECU", symptom: "Genset stops with a sensor fault code during load steps", customerRequest: "Asks for a firmware update", tags: ["fault code"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: 1, severity: "high", evidenceQuote: "the genset stops with a sensor fault code when the load steps up", sourceKind: "email", sourceLanguage: "en" },
  { key: "a13", modelCode: "DEMO-W6-250", countryIso3: "IDN", occurredOn: "2026-06-25", receivedOn: "2026-06-28", category: "failure", system: "cooling", component: "海水泵", symptom: "海水泵叶轮磨损导致温度上升", customerRequest: "需要叶轮备件", tags: ["过热", "配件"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: 1, severity: "medium", evidenceQuote: "海水泵叶轮磨坏了，温度一直往上走", sourceKind: "chat_screenshot", sourceLanguage: "zh" },
  { key: "a14", modelCode: "DEMO-B7-280", countryIso3: "MEX", occurredOn: "2026-08-11", receivedOn: "2026-08-12", category: "failure", system: "exhaust", component: "排气管", symptom: "Exhaust pipe joint cracked on a city bus", customerRequest: null, tags: ["exhaust", "crack"], requestedPowerValue: null, requestedPowerUnit: null, quantityAffected: 1, severity: "high", evidenceQuote: "the exhaust pipe joint cracked on one city bus", sourceKind: "paper_photo", sourceLanguage: "en" },
];

const engineIdByModel = new Map(demoEngineCatalogFixture.records.map(record => [record.model, record.id]));

/** Governance draft payloads (engine_feedback) for every fixture record. */
export function demoFeedbackDraftPayloads(): EngineFeedbackDraftPayload[] {
  return seeds.map(({ key, ...seed }) => {
    const catalogEngineId = engineIdByModel.get(seed.modelCode);
    if (!catalogEngineId) throw new Error(`Demo feedback ${key} names an unknown model ${seed.modelCode}.`);
    return engineFeedbackDraftPayloadSchema.parse({
      ...seed,
      catalogEngineId,
      customerRef: null,
      evidenceVerified: true,
      id: `00000000-0000-4000-8000-000000000${key}`,
      isDemo: true,
      requestedPowerKw: seed.requestedPowerValue !== null && seed.requestedPowerUnit !== null
        ? powerToKw(seed.requestedPowerValue, seed.requestedPowerUnit) : null,
      sourceBatchId: null,
    });
  });
}
