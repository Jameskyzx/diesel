import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { catalogHarnessResponse, harnessEvidenceContract, harnessNarrativeMayPublish, resolveHarnessMarketPeriod, resolveHarnessMarketScope, validateHarnessState } from "@/server/ai/catalog-harness";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getApprovedRealProductIds, getApprovedRealCertificationIds } from "@/server/config/public-product-publication";
import { createSalesChatTools } from "@/server/ai/sales-chat";
import { readConversationMetadata, type ConversationState } from "@/features/ai/conversation-state";
import { signConversationReceipt, verifyConversationReceipt } from "@/server/ai/conversation-receipt";
import { searchProductCatalog } from "@/server/services/product-catalog";
import { serializeChatHistory, parseChatHistory } from "@/features/ai/chat-history";
import { demoEngineCatalogFixture } from "@/server/db/seed/demo-engine-catalog";
import { compiledEvidenceToolCalls } from "@/server/ai/sales-chat-loop";

const h10 = demoEngineCatalogFixture.records.find(record => record.model === "DEMO-H10-375")!.id;
const empty: ConversationState = { tasks: [], countryIso3s: [], applicationScope: null, powerKw: null, asOf: null, productModelCode: null };
const usage = {inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0}};
const sessionId = crypto.randomUUID();
let demoDatabase: Awaited<ReturnType<typeof getDemoDatabase>> | undefined;
const fileDatabaseMode = process.env.DATABASE_MODE;
// Catalogue lookups read the governed catalogue table from the demo database.
beforeAll(() => { process.env.DATABASE_MODE = "pglite-demo"; });
afterAll(async()=>{
  await demoDatabase?.$client.close();
  if (fileDatabaseMode === undefined) delete process.env.DATABASE_MODE; else process.env.DATABASE_MODE = fileDatabaseMode;
});
function modelFor(actions: unknown[]) { let index = 0; return new MockLanguageModelV4({doGenerate: async () => ({
  warnings:[],usage,finishReason:{unified:"tool-calls",raw:undefined},content:[{type:"reasoning",text:"PRIVATE_REASONING_MARKER"},
    {type:"tool-call",toolCallId:`action-${index}`,toolName:"act",input:JSON.stringify(actions[index++] ?? {state:empty,locale:"en",action:{type:"answer",message:"Which configuration would you like to inspect?"}})}],
})}); }
function request(model: MockLanguageModelV4, text: string, previous: ReturnType<typeof verifyConversationReceipt> = null, signal = new AbortController().signal) {
  return catalogHarnessResponse({model,tools:createSalesChatTools({auditRepository:{recordToolCall:async()=>undefined},sessionId,selectedCountryIso3:null}),
    signal,locale:"en",today:"2026-10-16",userText:text,messages:[{role:"user",content:text}],previous,sessionId,selectedCountryIso3:null,requestId:crypto.randomUUID()});
}
function metadata(body: string) {
  return body.split("\n").filter(l=>l.startsWith("data: {")).map(l=>JSON.parse(l.slice(6))).map(p=>readConversationMetadata(p.messageMetadata)).findLast(Boolean);
}
describe("single typed multi-turn catalogue harness", () => {
  it("isolates source filters from engine context and does not broaden unsupported market filters", () => {
    const state = {...empty,countryIso3s:["CHN"],applicationScope:"non-road" as const,powerKw:120};
    const contract = harnessEvidenceContract(state,{type:"evidence",task:"knowledge",countryIso3:null,sourceQuery:"EU 2016/1628 Annex II page 9",marketPeriod:null},"2026-10-16");
    // The existing tool compiler omits an unscoped filter rather than sending null.
    expect(compiledEvidenceToolCalls(contract)[0]?.input).toEqual({countryIso3:null,asOf:"2026-10-16",query:"EU 2016/1628 Annex II page 9"});
    expect(()=>resolveHarnessMarketScope("Compare 2023 market data","non-road",null)).toThrow();
    expect(resolveHarnessMarketScope("只看巴西",undefined,"non-road")).toBe("non-road");
    expect(()=>resolveHarnessMarketScope("只看巴西",null,"non-road")).toThrow("do not silently broaden");
    expect(resolveHarnessMarketScope("取消用途筛选",null,"non-road")).toBeNull();
  });
  it("normalizes selected human reporting years rather than guessing model-computed inclusive ends", () => {
    const action = {type:"evidence" as const,task:"market" as const,countryIso3:null,sourceQuery:null,marketPeriod:{start:"2023-01-01",end:"2023-12-31"}};
    expect(resolveHarnessMarketPeriod("Compare 2023 market data",action)).toEqual({start:"2023-01-01",end:"2024-01-01"});
    expect(resolveHarnessMarketPeriod("不看2023了，改成2022",{...action,marketPeriodText:"2022"})).toEqual({start:"2022-01-01",end:"2023-01-01"});
    expect(()=>resolveHarnessMarketPeriod("不看2023了，改成2022",{...action,marketPeriod:null})).toThrow("Do not remove");
    expect(resolveHarnessMarketPeriod("Only BRA now",{...action,marketPeriod:null},{start:"2022-01-01",end:"2023-01-01"})).toEqual({start:"2022-01-01",end:"2023-01-01"});
    expect(resolveHarnessMarketPeriod("只看巴西，保留年份",{...action,marketPeriodUpdate:"retain",marketPeriodText:"2022"},{start:"2022-01-01",end:"2023-01-01"})).toEqual({start:"2022-01-01",end:"2023-01-01"});
  });
  it("requires every requested evidence task before finishing, and never approves an imported catalogue model", async () => {
    const original = process.env.DATABASE_MODE; process.env.DATABASE_MODE = "pglite-demo";
    try {
      demoDatabase = await getDemoDatabase();
      const state: ConversationState = {...empty,tasks:["regulations","product_fit"],countryIso3s:["CHN"],applicationScope:"construction",powerKw:120,productModelCode:"DEMO-H10-375"};
      const evidence = (task: "regulations"|"product_fit")=>({state,locale:"en",action:{type:"evidence",task,countryIso3:null,sourceQuery:null,marketPeriod:null}});
      const finish = {state,locale:"en",action:{type:"answer",message:"Review the missing evidence before making a commitment."}};
      const model = modelFor([evidence("regulations"),finish,evidence("product_fit"),finish]);
      const body = await request(model,"CHN construction 120 kW DEMO-H10-375: check both regulations and product fit").text();
      expect(model.doGenerateCalls).toHaveLength(4);
      expect(body).toContain('"toolName":"findCompatibleProducts"');
      expect(body).toContain('"toolName":"compareRegulations"');
      expect(body).toContain('"finishReason":"stop"');
      expect(getApprovedRealProductIds()).toEqual([]); expect(getApprovedRealCertificationIds()).toEqual([]);
      expect(body).not.toContain('"status":"fit"');
    } finally { if(original === undefined) delete process.env.DATABASE_MODE; else process.env.DATABASE_MODE=original; }
  });
  it("retains grounded country edits after an incomplete tool call and asks only for the missing field", async () => {
    const state: ConversationState = {...empty,tasks:["product_fit"],countryIso3s:["DEU"],applicationScope:"on-road-truck",productModelCode:"DEMO-H10-375"};
    const model = modelFor([{state,locale:"en",action:{type:"evidence",task:"product_fit",countryIso3:null,sourceQuery:null,marketPeriod:null}},
      {state,locale:"en",action:{type:"answer",message:"Please confirm the rated power for this configuration."}}]);
    const body = await request(model,"DEMO-H10-375 truck for Germany").text();
    expect(metadata(body)?.conversation.state).toEqual(state);
    expect(body).toContain("Please confirm the rated power"); expect(body).not.toContain("tool-input-available");
  });
  it("never turns missing certification into either a positive or negative legal verdict", () => {
    expect(harnessNarrativeMayPublish("可以直接卖")).toBe(false);
    expect(harnessNarrativeMayPublish("不能直接卖")).toBe(false);
    expect(harnessNarrativeMayPublish("This engine is certified.")).toBe(false);
    expect(harnessNarrativeMayPublish("目前不能确认是否可销售；还需核验证据。")).toBe(true);
  });
  it("keeps market reporting periods separate and does not send unsupported asOf or product filters", () => {
    const state = {...empty,countryIso3s:["CHN","BRA"],productModelCode:"DEMO-H10-375",powerKw:120};
    const contract = harnessEvidenceContract(state,{type:"evidence",task:"market",countryIso3:null,sourceQuery:null,marketPeriod:{start:"2022-01-01",end:"2023-01-01"}},"2026-10-16");
    expect(compiledEvidenceToolCalls(contract)[0]).toEqual({tool:"compareMarkets",input:{countryIso3s:["CHN","BRA"],marketPeriod:{start:"2022-01-01",end:"2023-01-01"}}});
    expect(()=>harnessEvidenceContract({...state,countryIso3s:["CHN"]},{type:"evidence",task:"market",countryIso3:null,sourceQuery:null,marketPeriod:null,marketScope:"construction"},"2026-10-16")).toThrow("cannot filter");
  });
  it("searches then clarifies in the same loop, without publishing reasoning or claiming certification", async () => {
    const model = modelFor([{state:empty,locale:"en",action:{type:"catalog",query:{query:"DEMO-H10"}}},
      {state:empty,locale:"en",action:{type:"answer",message:"Which application do you intend to use? The source rows need to be kept separate."}}]);
    const body = await request(model,"Show DEMO-H10 variants").text();
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(body).toContain("data-productCatalog"); expect(body).toContain("fictional_declaration");
    expect(body).toContain("not certification"); expect(body).not.toContain("PRIVATE_REASONING_MARKER");
    expect(body).toContain('"finishReason":"stop"');
  });
  it("retains signed product selection across follow-up turns and ignores browser-authored facts", async () => {
    const firstText = `Look up ${h10}`;
    const first = await request(modelFor([{state:empty,locale:"en",action:{type:"catalog",query:{recordIds:[h10]}}},
      {state:empty,locale:"en",action:{type:"answer",message:"Which country is the target market?"}}]),firstText).text();
    const previous = verifyConversationReceipt(metadata(first)!.conversation.receipt,{sessionId,selectedCountryIso3:null,previousUserText:firstText});
    expect(previous?.memory?.catalogRecordIds).toEqual([h10]);
    const next = {...empty,countryIso3s:["DEU"]};
    const model = modelFor([{state:next,locale:"zh-CN",action:{type:"answer",message:"请确认实际用途和功率，目录参数尚不能作为认证证明。"}}]);
    const second = await request(model,"德国，用中文，先别查法规",previous).text();
    expect(metadata(second)?.conversation.state).toEqual(next);
    expect(second).not.toContain("tool-input-available");
    expect(verifyConversationReceipt(metadata(second)!.conversation.receipt,{sessionId,selectedCountryIso3:null,previousUserText:"德国，用中文，先别查法规"})?.memory?.catalogRecordIds).toEqual([h10]);
  });
  it("applies country removals and power resets without a second intent parser", () => {
    const prior = {...empty,countryIso3s:["DEU","FRA"],applicationScope:"construction" as const,powerKw:120,asOf:"2026-10-01"};
    const next = {...prior,countryIso3s:["DEU"],powerKw:null};
    expect(()=>validateHarnessState(next,prior,"只保留德国，不要法国，功率先清空",null,[])).not.toThrow();
    expect(()=>validateHarnessState({...next,countryIso3s:["USA"]},prior,"只保留德国",null,[])).toThrow();
    expect(()=>validateHarnessState({...next,powerKw:999},prior,"只保留德国",null,[])).toThrow();
  });
  it("does not derive certification scope or regulatory power from a catalogue record", async () => {
    const catalog = await searchProductCatalog({recordIds:[h10]});
    expect(()=>validateHarnessState({...empty,powerKw:276},empty,"用这个型号",null,[catalog])).toThrow();
    expect(()=>validateHarnessState({...empty,applicationScope:"on-road-truck"},empty,"用这个型号",null,[catalog])).toThrow();
    expect(()=>validateHarnessState({...empty,productModelCode:h10},empty,`选${h10}`,null,[])).toThrow("not a model code");
  });
  it("compiles selected evidence tasks exactly and independently", () => {
    const state: ConversationState = {...empty,tasks:["product_fit"],countryIso3s:["DEU"],applicationScope:"construction",powerKw:120,productModelCode:"DEMO-H10"};
    const contract = harnessEvidenceContract(state,{type:"evidence",task:"product_fit",countryIso3:null,sourceQuery:null,marketPeriod:null},"2026-10-16");
    expect(compiledEvidenceToolCalls(contract).map(c=>c.tool)).toEqual(["findCompatibleProducts"]);
    const source = harnessEvidenceContract(state,{type:"evidence",task:"knowledge",countryIso3:null,sourceQuery:"EU 2016/1628 Annex II page 9 原文",marketPeriod:null},"2026-10-16");
    expect(compiledEvidenceToolCalls(source).map(c=>c.tool)).toEqual(["searchKnowledgeBase"]);
    expect(source.requirements[0]?.query.knowledgeQuery).toContain("page 9");
  });
  it("keeps previous confirmed conditions after provider failure, without leaking provider details", async () => {
    const state = {...empty,countryIso3s:["DEU"]};
    const token = signConversationReceipt({sessionId,selectedCountryIso3:null,userText:"Germany",answer:"Which application?",state});
    const previous = verifyConversationReceipt(token,{sessionId,selectedCountryIso3:null,previousUserText:"Germany"});
    const model = new MockLanguageModelV4({doGenerate:async()=>{throw new Error("PROVIDER_SECRET_DETAIL");}});
    const body = await request(model,"switch to France",previous).text();
    expect(body).toContain('"finishReason":"error"'); expect(body).not.toContain("PROVIDER_SECRET_DETAIL");
    expect(metadata(body)?.conversation.state).toEqual(state);
  });
  it("bounds invalid-action repair without emitting invented product approval", async () => {
    const model = modelFor(Array.from({length:8},()=>({state:empty,locale:"en",action:{type:"answer",message:"This engine is guaranteed compliant and legally sold in DEU."}})));
    const body = await request(model,"Can you guarantee a sale?").text();
    expect(model.doGenerateCalls).toHaveLength(1); expect(body).not.toContain("guaranteed compliant");
    expect(body).toContain("does not establish compliance");
    expect(body).toContain('"finishReason":"stop"');
  });
  it("retains catalogue provenance in browser history without converting it to verified evidence", async () => {
    const data = await searchProductCatalog({recordIds:[h10]});
    const serialized = serializeChatHistory({contextKey:"catalog",sessionId,messages:[{id:"u",role:"user",parts:[{type:"text",text:"Show row 2"}]},
      {id:"a",role:"assistant",parts:[{type:"data-productCatalog",data},{type:"text",text:"Fictional declaration only"}]}]});
    expect(parseChatHistory(serialized,"catalog")?.messages[1]?.parts[0]).toEqual({type:"data-productCatalog",data});
  });
});
