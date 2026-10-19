import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSalesChatTools } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";
import { buildSalesChatEvidenceContract, evidenceContractAllowsModelText } from "@/server/ai/evidence-contract";
import { searchKnowledgeBaseResultSchema } from "@/features/ai/schemas";

const originalDatabaseMode = process.env.DATABASE_MODE;
let database: Awaited<ReturnType<typeof getDemoDatabase>>;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  database = await getDemoDatabase();
}, 15_000);

afterAll(async () => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
  await database?.$client.close();
});

describe("knowledge delivery denial through the production stream", () => {
  it("retrieves original source sections with business terms, without a fabricated date filter", async () => {
    const tools = createSalesChatTools({ auditRepository: { recordToolCall: async () => undefined }, selectedCountryIso3: null, sessionId: crypto.randomUUID() });
    const result = searchKnowledgeBaseResultSchema.parse(await tools.searchKnowledgeBase.execute!({
      query: "non road emissions regulation", countryIso3: "CHN", applicationScope: "non-road",
    }, { context: undefined as never, messages: [], toolCallId: "natural-source" }));
    expect(result.evidenceSufficient).toBe(true);
    const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: ["Retrieve the original text, sections, and source evidence for CHN non-road emissions regulations."] });
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(true);
  }, 15000);
});
