import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPortfolioDemoModel } from "@/server/ai/portfolio-demo-model";
import { createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";
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
  it.each(["en", "zh-CN"] as const)("finishes a missing-locator answer without a stream error in %s", async (locale) => {
    const topic = "CHN non-road fictional demo data not a real regulation certification market source searchable fictional source fixture for chn non road emissions regulation evidence original text section and citation";
    const texts = locale === "en" ? [
      "Retrieve CHN non-road emissions regulations original text sections source evidence as of 2026-08-20.",
      `Retrieve ${topic} page 2 section 2 as of 2026-08-20.`,
    ] : [
      "检索 CHN non-road emissions regulations original text sections source evidence，截至 2026-08-20。",
      `检索 ${topic} 第 2 页 第 2 节，截至 2026-08-20。`,
    ];
    const errors: unknown[] = [];
    const auditRepository = { recordToolCall: async () => undefined };
    const sessionId = crypto.randomUUID();
    const tools = createSalesChatTools({ auditRepository, selectedCountryIso3: null, sessionId });
    const result = streamSalesChat({
      auditRepository, locale, messages: texts.map((content) => ({ role: "user" as const, content })),
      model: createPortfolioDemoModel(), onStreamError: (error) => errors.push(error),
      selectedCountryIso3: null, sessionId, tools, trustedUserTexts: texts,
    });
    const response = result.toUIMessageStreamResponse({ sendReasoning: false });
    const [parts, sse] = await Promise.all([Array.fromAsync(result.fullStream), response.text()]);
    expect(errors).toEqual([]);
    expect(parts.map((part) => part.type)).not.toContain("error");
    expect(parts.at(-1)?.type).toBe("finish");
    // A mismatched locator is already an evidence gap; do not spend the
    // remaining loop budget repeating an unsatisfiable retrieval request.
    expect(parts.filter((part) => part.type === "tool-result")).toHaveLength(1);
    const answer = parts.flatMap((part) => part.type === "text-delta" ? [part.text] : []).join("");
    expect(answer).toContain(locale === "en" ? "This request lacks enough evidence" : "这次请求没有足够证据");
    expect(sse).toContain(JSON.stringify(answer));
    expect(sse).not.toContain('"type":"error"');
    expect(sse).toContain("[DONE]");
  }, 15_000);
});
