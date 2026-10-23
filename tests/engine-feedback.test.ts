import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { demoExtractFeedback } from "@/domain/feedback/demo-extraction";
import {
  evidenceFoundIn,
  matchCatalogueModel,
  matchDirectoryCountry,
  powerToKw,
  redactContacts,
  resolveExtractedItem,
} from "@/domain/feedback/resolve-extraction";
import { compareModels, feedbackToCsv, summarizeFeedback } from "@/domain/feedback/summarize";
import type { FeedbackDraftItem, FeedbackExtraction, PublicFeedbackRecord } from "@/features/feedback/schemas";
import { createFeedbackDemoModel } from "@/server/ai/feedback-demo-model";
import { demoFeedbackDraftPayloads } from "@/server/db/seed/demo-engine-feedback";

const storedFiles = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("@/server/knowledge/local-document-storage", () => ({
  readDocumentFile: async (storagePath: string) => Buffer.from(storedFiles.get(storagePath) ?? new Uint8Array()),
  saveDocumentFile: async (input: { bytes: Uint8Array; contentSha256: string; namespace?: string }) => {
    const storagePath = `${input.namespace ? `${input.namespace}/` : ""}${input.contentSha256}/content`;
    storedFiles.set(storagePath, input.bytes);
    return { created: true, storagePath };
  },
}));

const catalogue = [
  { id: "00000000-0000-4000-8000-000000000801", model: "DEMO-H13-460", series: "DEMO-H13" },
  { id: "00000000-0000-4000-8000-000000000802", model: "DEMO-H13-460E", series: "DEMO-H13" },
  { id: "00000000-0000-4000-8000-000000000813", model: "DEMO-N6-220", series: "DEMO-N6" },
];
const directory = [
  { iso2: "BR", iso3: "BRA", name: "Brazil" },
  { iso2: "DE", iso3: "DEU", name: "Germany" },
];

describe("feedback extraction checks", () => {
  it("finds evidence regardless of spacing, width and punctuation", () => {
    expect(evidenceFoundIn("进气管都裂了", ["两台车的 进气管都裂了，才跑了８００小时"])).toBe(true);
    expect(evidenceFoundIn("排气管裂了", ["两台车的进气管都裂了"])).toBe(false);
  });

  it("matches catalogue models exactly and flags a series with several models", () => {
    expect(matchCatalogueModel("h13-460", catalogue)).toMatchObject({ status: "matched", record: { model: "DEMO-H13-460" } });
    expect(matchCatalogueModel("DEMO H13 460E", catalogue)).toMatchObject({ status: "matched", record: { model: "DEMO-H13-460E" } });
    expect(matchCatalogueModel("H13", catalogue)).toMatchObject({ status: "ambiguous" });
    expect(matchCatalogueModel("N6", catalogue)).toMatchObject({ status: "matched", record: { model: "DEMO-N6-220" } });
    expect(matchCatalogueModel("X9", catalogue)).toEqual({ status: "unmatched" });
  });

  it("maps Chinese, English and ISO country names, and nothing else", () => {
    expect(matchDirectoryCountry("巴西", directory)).toBe("BRA");
    expect(matchDirectoryCountry("brazil", directory)).toBe("BRA");
    expect(matchDirectoryCountry("DE", directory)).toBe("DEU");
    expect(matchDirectoryCountry("South America", directory)).toBeNull();
  });

  it("converts power and redacts contacts without touching dates or model codes", () => {
    expect(powerToKw(500, "hp")).toBe(372.85);
    expect(powerToKw(300, "PS")).toBe(220.65);
    expect(redactContacts("电话 13800138000，邮箱 a.b@example.com")).toEqual({ redacted: true, text: "[已隐去]，邮箱 [已隐去]" });
    expect(redactContacts("H13-460 在 2026-10-15 断裂").redacted).toBe(false);
  });

  it("resolves an item and reports every check it fails", () => {
    const { item, issues } = resolveExtractedItem({
      category: "performance_request", component: null, countryMention: "巴西", customerRequest: "提到 500 马力",
      evidenceQuote: "能不能做到更大功率", modelMention: "H13", occurredOn: null, quantityAffected: null,
      requestedPower: { unit: "hp", value: 500 }, severity: "low", sourceLanguage: "zh", symptom: "功率不足", system: "power_output", tags: ["功率"],
    }, { catalogue, directory, sources: ["客户问能不能做到更大功率"] });
    expect(item).toMatchObject({ catalogEngineId: null, countryIso3: "BRA", evidenceVerified: true, requestedPowerKw: 372.85 });
    expect(issues.map(({ code }) => code).sort()).toEqual(["model_ambiguous", "number_not_in_evidence"]);
  });

  it("accepts a count written as a Chinese numeral", () => {
    const { issues } = resolveExtractedItem({
      category: "failure", component: "进气管", countryMention: null, customerRequest: null, evidenceQuote: "两台车的进气管都裂了",
      modelMention: "DEMO-H13-460", occurredOn: null, quantityAffected: 2, requestedPower: null, severity: "high",
      sourceLanguage: "zh", symptom: "进气管断裂", system: "intake", tags: [],
    }, { catalogue, directory, sources: ["两台车的进气管都裂了"] });
    expect(issues).toEqual([]);
  });

  it("drafts items from Chinese text in the offline demo extractor", () => {
    const extraction = demoExtractFeedback("巴西客户：DEMO-H13-460 两台车的进气管都裂了。能不能做到500马力？");
    expect(extraction.items.map(item => [item.category, item.system, item.modelMention, item.countryMention])).toEqual([
      ["failure", "intake", "DEMO-H13-460", "巴西"],
      ["performance_request", "power_output", "DEMO-H13-460", "巴西"],
    ]);
    expect(extraction.items[0]).toMatchObject({ quantityAffected: 2, severity: "high" });
    expect(extraction.items[1]?.requestedPower).toEqual({ unit: "hp", value: 500 });
  });
});

describe("feedback summaries and export", () => {
  const records: PublicFeedbackRecord[] = demoFeedbackDraftPayloads().map(payload => ({
    category: payload.category, component: payload.component, countryIso3: payload.countryIso3, customerRequest: payload.customerRequest,
    evidenceQuote: payload.evidenceQuote, id: payload.id, isDemo: payload.isDemo, modelCode: payload.modelCode,
    occurredOn: payload.occurredOn, quantityAffected: payload.quantityAffected, receivedOn: payload.receivedOn,
    requestedPowerKw: payload.requestedPowerKw, requestedPowerUnit: payload.requestedPowerUnit, requestedPowerValue: payload.requestedPowerValue,
    severity: payload.severity, sourceKind: payload.sourceKind, symptom: payload.symptom, system: payload.system, tags: payload.tags,
  }));

  it("counts categories, countries and every month in the range", () => {
    const summary = summarizeFeedback(records.filter(record => record.modelCode === "DEMO-H13-460"));
    expect(summary.total).toBe(3);
    expect(summary.byCategory.failure).toBe(2);
    expect(summary.byCountry[0]).toEqual({ count: 2, countryIso3: "BRA" });
    expect(summary.byMonth.map(({ month }) => month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07"]);
    expect(summary.byMonth.find(({ month }) => month === "2026-05")?.count).toBe(0);
  });

  it("compares models by volume and severity", () => {
    const comparison = compareModels(records);
    expect(comparison[0]).toMatchObject({ modelCode: "DEMO-H13-460", total: 3, safetyOrHigh: 1 });
    expect(comparison.reduce((sum, row) => sum + row.total, 0)).toBe(records.length);
  });

  it("exports CSV that spreadsheets read safely", () => {
    const csv = feedbackToCsv([{ ...records[0]!, symptom: "=HYPERLINK(\"x\")", tags: ["a", "b"] }]);
    expect(csv.startsWith("﻿modelCode,")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv).toContain("a; b");
  });
});

/** The fields a person confirms; the server derives the rest. */
function confirmable(item: FeedbackDraftItem) {
  const derived = new Set(["evidenceVerified", "modelCode", "requestedPowerKw"]);
  return { ...Object.fromEntries(Object.entries(item).filter(([key]) => !derived.has(key))), catalogEngineId: item.catalogEngineId! };
}

/** A one-page PDF; `text` adds a text layer, otherwise it is a drawing only (a "scan"). */
function buildPdf(text: string | null): Uint8Array {
  const content = text ? `BT /F1 12 Tf 10 50 Td (${text}) Tj ET` : "0 0 1 rg 20 20 160 60 re f";
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("feedback capture through governance", () => {
  const originalDatabaseMode = process.env.DATABASE_MODE;
  beforeAll(() => { process.env.DATABASE_MODE = "pglite-demo"; });
  afterAll(() => {
    if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
    else process.env.DATABASE_MODE = originalDatabaseMode;
  });
  const reviewer = { email: "feedback-reviewer@example.test", role: "reviewer" as const };
  const editor = { email: "feedback-editor@example.test", role: "editor" as const };
  const text = (value: string) => ({ bytes: new TextEncoder().encode(value), name: "note.txt", type: "text/plain" });

  it("classifies uploads by their bytes", async () => {
    const { classifyFeedbackFile } = await import("@/server/services/feedback-service");
    expect(classifyFeedbackFile({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]), name: "x.bin", type: "" })).toBe("image");
    expect(classifyFeedbackFile({ bytes: buildPdf(null), name: "scan", type: "" })).toBe("pdf");
    expect(classifyFeedbackFile(text("From: a@example.test\nContent-Type: text/plain\n\nhi"))).toBe("email");
    expect(() => classifyFeedbackFile({ bytes: new Uint8Array([0x4d, 0x5a, 0x90]), name: "tool.exe", type: "application/x-msdownload" })).toThrow(/格式不支持/u);
  });

  it("previews, then publishes checked items that only editors can see", async () => {
    const { confirmEngineFeedback, extractEngineFeedback } = await import("@/server/services/feedback-service");
    const { listAdminFeedback, listPublicFeedback, readFeedbackSourceFile } = await import("@/server/services/feedback-read-service");
    const preview = await extractEngineFeedback({ files: [text("巴西客户：DEMO-N6-220 挖机油底壳那里一直渗油，电话 13800138000")], sourceKind: null, text: null },
      reviewer, { model: createFeedbackDemoModel() });
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]?.item).toMatchObject({ category: "failure", countryIso3: "BRA", evidenceVerified: true, modelCode: "DEMO-N6-220" });
    expect(preview.items[0]?.item.evidenceQuote).not.toContain("13800138000");
    expect(preview.items[0]?.issues.map(({ code }) => code)).toContain("contact_redacted");

    const confirmItem = confirmable(preview.items[0]!.item);
    const request = { customerRef: "BR-0042", items: [confirmItem], publish: true, reason: "Checked against the customer chat.", receivedOn: "2026-10-20" };
    await expect(confirmEngineFeedback({ batchId: preview.batchId, request }, editor)).rejects.toThrow(/reviewer/u);
    await expect(confirmEngineFeedback({ batchId: preview.batchId, request }, reviewer)).resolves.toEqual({ createdDrafts: 1, published: 1, status: "committed" });
    await expect(confirmEngineFeedback({ batchId: preview.batchId, request }, reviewer)).rejects.toThrow(/已经确认/u);

    const internal = await listAdminFeedback({ modelCode: "DEMO-N6-220" }, reviewer);
    const published = internal.find(record => record.customerRef === "BR-0042");
    expect(published).toMatchObject({ isDemo: false, sourceKind: "text" });
    expect(published?.sourceFiles).toHaveLength(1);
    const original = await readFeedbackSourceFile(published!.sourceFiles[0]!.id, reviewer);
    expect(new TextDecoder().decode(original?.bytes)).toContain("油底壳");

    const publicRecords = await listPublicFeedback({ modelCode: "DEMO-N6-220" });
    expect(publicRecords.every(record => record.isDemo)).toBe(true);
    expect(publicRecords.map(({ id }) => id)).not.toContain(published?.id);
  });

  it("marks a rewritten quote unverified and saves a draft without publishing", async () => {
    const { confirmEngineFeedback, extractEngineFeedback } = await import("@/server/services/feedback-service");
    const preview = await extractEngineFeedback({ files: [], sourceKind: null, text: "DEMO-H13-460E 尿素喷嘴结晶，仪表报排放故障" },
      editor, { model: createFeedbackDemoModel() });
    await expect(confirmEngineFeedback({ batchId: preview.batchId, request: {
      customerRef: null, items: [{ ...confirmable(preview.items[0]!.item), evidenceQuote: "人工补写的摘录" }],
      publish: false, reason: "Save the checked item as a draft.", receivedOn: "2026-10-21",
    } }, editor)).resolves.toEqual({ createdDrafts: 1, published: 0, status: "committed" });
    const { getGovernanceDashboard } = await import("@/server/services/governance-service");
    const draft = (await getGovernanceDashboard(editor)).drafts.find(row => row.entityType === "engine_feedback" && row.payload.evidenceQuote === "人工补写的摘录");
    expect(draft?.payload).toMatchObject({ evidenceVerified: false, isDemo: false });
  });

  it("reads e-mail bodies and renders scanned PDF pages for the model", async () => {
    const { extractEngineFeedback } = await import("@/server/services/feedback-service");
    const email = ["From: dealer@example.test", "Subject: DEMO-G12-500", "Content-Type: text/plain; charset=utf-8", "", "The genset stops with a sensor fault code when the load steps up."].join("\r\n");
    const fromEmail = await extractEngineFeedback({ files: [{ bytes: new TextEncoder().encode(email), name: "dealer.eml", type: "message/rfc822" }], sourceKind: null, text: null },
      reviewer, { model: createFeedbackDemoModel() });
    expect(fromEmail.sourceKind).toBe("email");
    expect(fromEmail.items[0]?.item).toMatchObject({ modelCode: "DEMO-G12-500", system: "electronics" });

    const prompts: unknown[] = [];
    const extraction: FeedbackExtraction = { transcript: "DEMO-W6-250 sea water pump impeller worn", items: [] };
    const model = new MockLanguageModelV4({ doGenerate: async (options) => {
      prompts.push(options.prompt);
      return { content: [{ input: JSON.stringify(extraction), toolCallId: "t1", toolName: "record_feedback", type: "tool-call" }],
        finishReason: { raw: undefined, unified: "tool-calls" }, usage: { inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 }, outputTokens: { reasoning: 0, text: 1, total: 1 } }, warnings: [] };
    } });
    const scanned = await extractEngineFeedback({ files: [{ bytes: buildPdf(null), name: "scan.pdf", type: "application/pdf" }], sourceKind: "paper_photo", text: null }, reviewer, { model });
    expect(scanned).toMatchObject({ sourceKind: "paper_photo", transcript: extraction.transcript });
    expect(JSON.stringify(prompts)).toContain("\"type\":\"file\"");

    const withText = await extractEngineFeedback({ files: [{ bytes: buildPdf("DEMO-H10-375 engines overheat in summer"), name: "report.pdf", type: "application/pdf" }], sourceKind: null, text: null },
      reviewer, { model: createFeedbackDemoModel() });
    expect(withText.items[0]?.item).toMatchObject({ modelCode: "DEMO-H10-375", system: "cooling", evidenceVerified: true });
  });

  it("rejects empty input, oversized text and unreadable images", async () => {
    const { extractEngineFeedback } = await import("@/server/services/feedback-service");
    const run = (input: Parameters<typeof extractEngineFeedback>[0]) => extractEngineFeedback(input, reviewer, { model: createFeedbackDemoModel() });
    await expect(run({ files: [], sourceKind: null, text: "   " })).rejects.toThrow(/没有可识别的内容/u);
    await expect(run({ files: [], sourceKind: null, text: "x".repeat(20_001) })).rejects.toThrow(/超过/u);
    await expect(run({ files: [{ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]), name: "broken.png", type: "image/png" }], sourceKind: null, text: null }))
      .rejects.toThrow(/无法作为图片读取/u);
  });
});
