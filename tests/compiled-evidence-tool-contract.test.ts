import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
  findCompatibleProductsInputSchema, getCountryProfileInputSchema,
  salesChatModelKnowledgeSearchInputSchema, type AiToolName,
} from "@/features/ai/schemas";
import {
  calculateOpportunityScoreInputSchema, compareMarketsInputSchema,
  compareRegulationsInputSchema, generateSalesBriefInputSchema,
} from "@/features/marketing/schemas";
import { compiledEvidenceToolCalls } from "@/server/ai/sales-chat-loop";
import type { SalesChatEvidenceContract } from "@/server/ai/evidence-contract";

const engine = { applicationScope: "construction", asOf: "2026-10-14", powerKw: 180 };
type Requirement = SalesChatEvidenceContract["requirements"][number];
const cases = [
  { tool: "getCountryProfile", schema: getCountryProfileInputSchema,
    query: { countryIso3s: ["BRA"], asOf: "2023-12-31" }, topics: ["market"] },
  { tool: "compareMarkets", schema: compareMarketsInputSchema,
    query: { countryIso3s: ["BRA", "CHN"], applicationScope: null, metricCodes: ["VEHICLE_FLEET"] } },
  { tool: "compareRegulations", schema: compareRegulationsInputSchema,
    query: { ...engine, countryIso3s: ["JPN", "KOR"] } },
  { tool: "findCompatibleProducts", schema: findCompatibleProductsInputSchema,
    query: { ...engine, countryIso3s: ["JPN"], productModelCode: "CLIENT200" } },
  { tool: "calculateOpportunityScore", schema: calculateOpportunityScoreInputSchema,
    query: { ...engine, countryIso3s: ["BRA", "CHN"] } },
  { tool: "generateSalesBrief", schema: generateSalesBriefInputSchema,
    query: { ...engine, countryIso3s: ["BRA", "CHN"], targetCountryIso3: "BRA" } },
  { tool: "searchKnowledgeBase", schema: salesChatModelKnowledgeSearchInputSchema,
    query: { ...engine, powerKw: undefined, countryIso3s: ["DEU"], knowledgeQuery: "Regulation (EU) 2016/1628", knowledgeTerms: [] } },
] satisfies Array<{ tool: AiToolName; schema: ZodType; query: Requirement["query"]; topics?: Requirement["requiredProfileTopics"] }>;

function contract(requirement: Requirement): SalesChatEvidenceContract {
  return { applicationScope: null, asOf: null, blocksModelText: false, countryIso3s: [],
    missingRequiredParameters: [], powerKw: null, productModelCode: null,
    requirements: [requirement], requiresRegulatoryDisclaimer: false, targetCountryIso3: null };
}

describe("shared compiled evidence calls satisfy real tool input contracts", () => {
  it.each(cases)("$tool has the same valid shape in-process and over JSON", ({ tool, query, schema, ...entry }) => {
    const topics = "topics" in entry ? entry.topics : undefined;
    const [call] = compiledEvidenceToolCalls(contract({ acceptedTools: [tool], query,
      ...(topics ? { requiredProfileTopics: topics } : {}) }));
    expect(call?.tool).toBe(tool);
    expect(schema.safeParse(call?.input).success).toBe(true);
    expect(Object.values(call!.input)).not.toContain(undefined);
    expect(call!.input).toEqual(JSON.parse(JSON.stringify(call!.input)));
    expect(schema.parse(call!.input)).toEqual(schema.parse(JSON.parse(JSON.stringify(call!.input))));
  });

  it.each([undefined, null])("omits an absent comparison date (%s), without modifying the evidence requirement", asOf => {
    const requirement: Requirement = { acceptedTools: ["compareMarkets"], query: { countryIso3s: ["BRA", "CHN"], asOf } };
    const before = structuredClone(requirement);
    const [call] = compiledEvidenceToolCalls(contract(requirement));
    expect(Object.hasOwn(call!.input, "asOf")).toBe(false);
    expect(compareMarketsInputSchema.safeParse(call!.input).success).toBe(true);
    expect(requirement).toEqual(before);
  });

  it("does not silently discard a real unsupported constraint to force validation to pass", () => {
    const [call] = compiledEvidenceToolCalls(contract({ acceptedTools: ["compareMarkets"],
      query: { countryIso3s: ["BRA", "CHN"], asOf: "2023-12-31" } }));
    expect(call!.input.asOf).toBe("2023-12-31");
    expect(compareMarketsInputSchema.safeParse(call!.input).success).toBe(false);
  });
});
