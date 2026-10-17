

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareRegulationsResultSchema, type AiToolResult } from "@/features/ai/schemas";
import { buildSalesChatEvidenceContract, evidenceContractAllowsModelText } from "@/server/ai/evidence-contract";
import { createSalesChatTools } from "@/server/ai/sales-chat";

import { getDemoDatabase } from "@/server/db/demo-client";

const originalMode = process.env.DATABASE_MODE;
const runtimeContext = { capturedAt: "2026-08-20T12:00:00.000Z", utcDate: "2026-08-20" } as const;
const auditRepository = { recordToolCall: async () => undefined };
const query = { applicationScope: "non-road" as const, countryIso3s: ["CHN"], powerKw: 100, asOf: runtimeContext.utcDate };
const validRequests = [
  "Check CHN non-road regulations at 100 kW as of 2026-08-20, not marine.",
  "Check CHN marine regulations at 100 kW as of 2026-08-20. Actually use non-road.",
  "Check CHN nonroad regulations at 100 kW as of 2026-08-20. See https://example.test/marine/reference.",
  "查询 CHN 非道路 100 kW 法规，日期 2026-08-20，不是船用。",
];
let database: Awaited<ReturnType<typeof getDemoDatabase>> | undefined;
let evidence: AiToolResult;

function productionTools() {
  return createSalesChatTools({ auditRepository, runtimeContext, selectedCountryIso3: null, sessionId: crypto.randomUUID() });
}

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  database = await getDemoDatabase();
  const execute = productionTools().compareRegulations.execute;
  if (!execute) throw new Error("Missing production comparison tool");
  evidence = compareRegulationsResultSchema.parse(await execute(query, {
    context: undefined as never, messages: [], toolCallId: crypto.randomUUID(),
  }));
}, 15_000);

afterAll(async () => {
  if (originalMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalMode;
  await database?.$client.close();
});

describe("application-scope intent at the production evidence boundary", () => {
  it.each(validRequests)("allows the actual sufficient non-road result for %s", (text) => {
    expect(evidence.status).toBe("ok");
    expect(evidence.evidenceSufficient).toBe(true);
    expect(evidence.citations.length).toBeGreaterThan(0);
    const contract = buildSalesChatEvidenceContract({ runtimeContext, selectedCountryIso3: null, userTexts: [text] });
    expect(evidenceContractAllowsModelText(contract, [evidence])).toBe(true);
  });
});
