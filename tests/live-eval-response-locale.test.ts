import { describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import {
  detectLiveEvalResponseLocale,
  evaluateLiveEvalResponseContract,
  LIVE_EVAL_THRESHOLDS,
} from "@/domain/ai/live-eval";
import {
  liveEvalLocaleCitationTitles,
  projectLiveEvalLocaleText,
} from "@/domain/ai/live-eval-response-locale";

// Exact existing fictional seed labels; this pure test does not open a database.
const sourceTitle = "DEMO ONLY — Fictional emissions bulletin";
const documentTitle = "DEMO ONLY — Fictional regulation document";
const titles = [sourceTitle, documentTitle] as const;
const chineseBody = "这是虚构演示来源，不是真实法规。";
type ToolEnvelope = Parameters<typeof liveEvalLocaleCitationTitles>[0]["toolResults"][number];

function toolResult(overrides: Partial<ToolEnvelope> = {}): ToolEnvelope {
  return {
    citations: [{ sourceTitle, title: documentTitle }],
    evidenceSufficient: true,
    status: "ok",
    ...overrides,
  };
}

const inlineForms = [
  { label: "backticks", open: "`", close: "`" },
  { label: "curly quotes", open: "“", close: "”" },
  { label: "straight quotes", open: '"', close: '"' },
] as const;

describe("trusted citation titles are a bounded locale-only projection", () => {
  it("extracts both original source and document labels without rewriting or duplicates", () => {
    const toolResults = [toolResult(), toolResult()];
    const original = structuredClone(toolResults);
    expect(liveEvalLocaleCitationTitles({ evidenceAllowed: true, toolResults })).toEqual(titles);
    expect(toolResults).toEqual(original);
  });

  it.each([
    { label: "evidence denied", evidenceAllowed: false, toolResults: [toolResult()] },
    { label: "no tools", evidenceAllowed: true, toolResults: [] },
    { label: "empty citations", evidenceAllowed: true, toolResults: [toolResult({ citations: [] })] },
    { label: "insufficient evidence", evidenceAllowed: true, toolResults: [toolResult({ evidenceSufficient: false })] },
    { label: "tool error", evidenceAllowed: true, toolResults: [toolResult({ status: "error" })] },
    { label: "unknown tool status", evidenceAllowed: true, toolResults: [toolResult({ status: "unknown" })] },
    { label: "mixed insufficient tool", evidenceAllowed: true, toolResults: [toolResult(), toolResult({ evidenceSufficient: false })] },
    { label: "mixed failed tool with no citations", evidenceAllowed: true, toolResults: [toolResult(), toolResult({ status: "error", citations: [] })] },
  ])("does not derive trusted labels from $label", ({ evidenceAllowed, toolResults }) => {
    const extracted = liveEvalLocaleCitationTitles({ evidenceAllowed, toolResults });
    const response = `${chineseBody} \`${sourceTitle}\` \`${documentTitle}\``;
    expect(extracted).toEqual([]);
    expect(projectLiveEvalLocaleText(response, extracted)).toBe(response);
    expect(detectLiveEvalResponseLocale(response, extracted)).toBe("en");
  });

  it.each(inlineForms)("corrects the actual Demo-title ratio only for exact $label", ({ open, close }) => {
    const response = `${chineseBody} ${open}${sourceTitle}${close} ${open}${documentTitle}${close}`;
    const extracted = liveEvalLocaleCitationTitles({ evidenceAllowed: true, toolResults: [toolResult()] });
    expect(detectLiveEvalResponseLocale(response)).toBe("en");
    expect(projectLiveEvalLocaleText(response)).toBe(response);
    expect(projectLiveEvalLocaleText(response, extracted)).toBe(`${chineseBody}    `);
    expect(detectLiveEvalResponseLocale(response, extracted)).toBe("zh-CN");
    expect(evaluateLiveEvalResponseContract({
      expectedLocale: "zh-CN",
      localeEvidenceTitles: extracted,
      responseContract: { factAnchors: [], decisionAnchors: [], disclaimerAnchor: null },
      responseText: response,
    })).toMatchObject({ detectedResponseLocale: "zh-CN", responseLocalePassed: true });
  });

  it.each(inlineForms)("cannot turn titles without a substantive body into a language pass: $label", ({ open, close }) => {
    const response = `${open}${sourceTitle}${close} ${open}${documentTitle}${close}`;
    expect(detectLiveEvalResponseLocale(response, titles)).toBe("indeterminate");
    for (const expectedLocale of ["en", "zh-CN"] as const) {
      expect(evaluateLiveEvalResponseContract({
        expectedLocale,
        localeEvidenceTitles: titles,
        responseContract: { factAnchors: [], decisionAnchors: [], disclaimerAnchor: null },
        responseText: response,
      }).responseLocalePassed).toBe(false);
    }
  });

  it("keeps an actual English answer English after removing known titles", () => {
    const response = `This is a fictional source, not an actual regulatory requirement. “${sourceTitle}” “${documentTitle}”`;
    expect(detectLiveEvalResponseLocale(response, titles)).toBe("en");
    expect(evaluateLiveEvalResponseContract({
      expectedLocale: "zh-CN", localeEvidenceTitles: titles,
      responseContract: { factAnchors: [], decisionAnchors: [], disclaimerAnchor: null },
      responseText: response,
    }).responseLocalePassed).toBe(false);
  });

  it.each([
    ["unknown title", "UNKNOWN ONLY — Fictional emissions bulletin"],
    ["case drift", sourceTitle.toLowerCase()],
    ["extra internal space", sourceTitle.replace("Fictional emissions", "Fictional  emissions")],
    ["internal tab", sourceTitle.replace("Fictional emissions", "Fictional\temissions")],
    ["leading space", ` ${sourceTitle}`],
    ["trailing space", `${sourceTitle} `],
    ["normalized punctuation", sourceTitle.replace("—", "-")],
  ])("does not normalize an untrusted or changed literal: %s", (_label, title) => {
    const response = `${chineseBody} \`${title}\``;
    expect(projectLiveEvalLocaleText(response, titles)).toBe(response);
  });

  it.each([
    ["bare label", sourceTitle],
    ["single quote", `'${sourceTitle}'`],
    ["longer literal", `"${sourceTitle}; this is the entire answer"`],
    ["double backticks", `\`\`${sourceTitle}\`\``],
    ["unpaired opening backtick", `\`${sourceTitle}`],
    ["unpaired closing backtick", `${sourceTitle}\``],
    ["unpaired straight quote", `"${sourceTitle}`],
    ["unpaired curly quote", `“${sourceTitle}`],
    ["mismatched quotes", `“${sourceTitle}"`],
    ["newline before closing quote", `"${sourceTitle}\n"`],
    ["newline inside title", `"${sourceTitle.replace("Fictional ", "Fictional\n")}"`],
    ["CR inside title", `"${sourceTitle.replace("Fictional ", "Fictional\r")}"`],
    ["larger curly quote contains inline title", `“Example of \`${sourceTitle}\` as the answer”`],
    ["larger straight quote contains curly title", `"Example of “${sourceTitle}” as the answer"`],
    ["larger backtick literal contains straight title", `\`Example of "${sourceTitle}" as the answer\``],
    ["larger double-backtick literal contains straight title", `\`\`Example of "${sourceTitle}" as the answer\`\``],
    ["unpaired outer quote contains inline title", `“Example of \`${sourceTitle}\` as the answer`],
    ["multiline outer quote contains inline title", `“Example:\n\`${sourceTitle}\`\nThis is the whole quotation.”`],
  ])("preserves unsupported, incomplete or larger quotation contexts: %s", (_label, literal) => {
    const response = `${chineseBody}\n${literal}`;
    expect(projectLiveEvalLocaleText(response, titles)).toBe(response);
  });

  it.each([
    "ready", "effective", "not_ready", "not-ready", "compatible", "regulations", "ABC-123", "CHN", "100 kW",
  ])("does not treat short labels or a bare status word as a title: %s", (title) => {
    expect(liveEvalLocaleCitationTitles({
      evidenceAllowed: true,
      toolResults: [toolResult({ citations: [{ sourceTitle: title, title }] })],
    })).toEqual([]);
    expect(projectLiveEvalLocaleText(`“${title}”`, [title])).toBe(`“${title}”`);
  });

  it.each(["\n", "\r", "\r\n"])("rejects multiline metadata titles (%j)", (newline) => {
    const title = `${sourceTitle}${newline}More title text`;
    expect(liveEvalLocaleCitationTitles({
      evidenceAllowed: true,
      toolResults: [toolResult({ citations: [{ sourceTitle: title, title }] })],
    })).toEqual([]);
    expect(projectLiveEvalLocaleText(`"${title}"`, [title])).toBe(`"${title}"`);
  });
});

describe("locale projection respects complete fenced code regions", () => {
  it.each([
    ["backticks", "```text", "```"],
    ["tildes", "~~~text", "~~~"],
    ["three-space indent", "   ```text", "   ```"],
    ["longer closing marker", "```text", "````"],
  ])("preserves quoted titles within %s and resumes afterward", (_label, open, close) => {
    const fenced = `${open}\n\`${sourceTitle}\`\n“${documentTitle}”\n${close}`;
    const response = `${fenced}\n${chineseBody} \`${sourceTitle}\``;
    expect(projectLiveEvalLocaleText(response, titles)).toBe(`${fenced}\n${chineseBody}  `);
  });

  it.each([
    ["unclosed fence", "```text", ""],
    ["too-short close", "````text", "```"],
    ["wrong close character", "~~~text", "```"],
    ["closing marker has content", "```text", "```more"],
  ])("does not resume stripping after %s", (_label, open, close) => {
    const response = `${open}\n\`${sourceTitle}\`\n${close}\n“${documentTitle}”`;
    expect(projectLiveEvalLocaleText(response, titles)).toBe(response);
  });
});

describe("locale-only metadata cannot rewrite body, grounding or polarity", () => {
  const testCase = salesChatLiveCases.find(({ id }) => id === "product-ready-dual-axis");
  if (!testCase) throw new Error("Missing canonical product-ready case");
  const responseContract = testCase.responseContract;
  const facts = "DEMO-ENG-100 在 CHN non-road、100 kW、2026-08-13 的合规适配结论为通过，供应状态为可供货。";
  const disclaimer = "信息参考，不替代正式认证或法律意见";

  it.each([
    { label: "positive both-axis answer", body: facts, expectedGrounding: true },
    { label: "wrong product", body: facts.replace("DEMO-ENG-100", "DEMO-ENG-1000"), expectedGrounding: false },
    { label: "wrong country", body: facts.replace("CHN", "BRA"), expectedGrounding: false },
    { label: "wrong power", body: facts.replace("100 kW", "1100 kW"), expectedGrounding: false },
    { label: "wrong date", body: facts.replace("2026-08-13", "2026-08-14"), expectedGrounding: false },
    { label: "contradictory decision", body: `${facts}最终结论：不兼容，不可供货。`, expectedGrounding: false },
  ])("retains the original anchor judgement for $label", ({ body, expectedGrounding }) => {
    const responseText = `${body}\n${disclaimer}\n来源：\`${sourceTitle}\`、“${documentTitle}”。`;
    const withoutMetadata = evaluateLiveEvalResponseContract({ expectedLocale: "zh-CN", responseContract, responseText });
    const withMetadata = evaluateLiveEvalResponseContract({ expectedLocale: "zh-CN", responseContract, responseText, localeEvidenceTitles: titles });
    expect(projectLiveEvalLocaleText(responseText, titles)).toBe(`${body}\n${disclaimer}\n来源： 、 。`);
    expect(withMetadata.responseGroundingPassed).toBe(expectedGrounding);
    expect(withMetadata.matchedResponseAnchorIds).toEqual(withoutMetadata.matchedResponseAnchorIds);
    expect(withMetadata.missingResponseAnchorIds).toEqual(withoutMetadata.missingResponseAnchorIds);
    expect(withMetadata.responseGroundingPassed).toBe(withoutMetadata.responseGroundingPassed);
  });

  it("does not promote a metadata title containing business facts and decisions into an answer", () => {
    const title = "DEMO-ENG-100 in CHN non-road at 100 kW on 2026-08-13 is compatible and is ready for supply";
    const responseText = `${chineseBody} \`${title}\`。${disclaimer}`;
    const observation = evaluateLiveEvalResponseContract({
      expectedLocale: "zh-CN", responseContract, responseText, localeEvidenceTitles: [title],
    });
    expect(observation.responseLocalePassed).toBe(true);
    expect(observation.responseGroundingPassed).toBe(false);
    expect(observation.missingResponseAnchorIds).toContain("decision:product-compatible");
    expect(observation.missingResponseAnchorIds).toContain("decision:supply-ready");
  });

  it("retains the existing locale thresholds and exact boundary behavior", () => {
    expect(LIVE_EVAL_THRESHOLDS.responseLocaleAccuracyPct).toBe(100);
    expect(detectLiveEvalResponseLocale("汉".repeat(7))).toBe("indeterminate");
    expect(detectLiveEvalResponseLocale("汉".repeat(8))).toBe("zh-CN");
    expect(detectLiveEvalResponseLocale("a".repeat(11))).toBe("indeterminate");
    expect(detectLiveEvalResponseLocale("a".repeat(12))).toBe("en");
    expect(detectLiveEvalResponseLocale("汉".repeat(8) + "a".repeat(16))).toBe("zh-CN");
    expect(detectLiveEvalResponseLocale("汉".repeat(8) + "a".repeat(17))).toBe("indeterminate");
    expect(detectLiveEvalResponseLocale("汉".repeat(8) + "a".repeat(24))).toBe("en");
  });
});

describe("title bounds fail closed for the entire projection without partial stripping", () => {
  const encoder = new TextEncoder();
  const title512 = "A ".repeat(256);

  it("accepts 256 raw candidates but rejects 257 even if they are duplicates", () => {
    const response = `\`${sourceTitle}\``;
    expect(projectLiveEvalLocaleText(response, Array<string>(256).fill(sourceTitle))).toBe(" ");
    expect(projectLiveEvalLocaleText(response, Array<string>(257).fill(sourceTitle))).toBe(response);
    const citation = { sourceTitle, title: sourceTitle };
    expect(liveEvalLocaleCitationTitles({
      evidenceAllowed: true,
      toolResults: [toolResult({ citations: Array<typeof citation>(128).fill(citation) })],
    })).toEqual([sourceTitle]);
    expect(liveEvalLocaleCitationTitles({
      evidenceAllowed: true,
      toolResults: [toolResult({ citations: Array<typeof citation>(129).fill(citation) })],
    })).toEqual([]);
  });

  it("measures the single-value limit as UTF-8 bytes, including exact 512-byte acceptance", () => {
    const multibyte512 = "汉".repeat(170) + " A";
    const multibyte513 = "汉".repeat(171);
    expect(encoder.encode(title512)).toHaveLength(512);
    expect(encoder.encode(multibyte512)).toHaveLength(512);
    expect(encoder.encode(multibyte513)).toHaveLength(513);
    for (const title of [title512, multibyte512]) {
      expect(projectLiveEvalLocaleText(`“${title}”`, [title])).toBe(" ");
    }
    for (const oversized of [`${title512}A`, multibyte513]) {
      const response = `\`${sourceTitle}\` “${oversized}”`;
      expect(projectLiveEvalLocaleText(response, [sourceTitle, oversized])).toBe(response);
      expect(liveEvalLocaleCitationTitles({
        evidenceAllowed: true,
        toolResults: [toolResult({ citations: [{ sourceTitle, title: oversized }] })],
      })).toEqual([]);
    }
  });

  it("accepts exactly 32 KiB but rejects a one-byte excess before deduplication", () => {
    const atLimit = Array<string>(64).fill(title512);
    expect(atLimit.reduce((sum, title) => sum + encoder.encode(title).length, 0)).toBe(32 * 1024);
    const response = `\`${title512}\``;
    expect(projectLiveEvalLocaleText(response, atLimit)).toBe(" ");
    expect(projectLiveEvalLocaleText(response, [...atLimit, "A"])).toBe(response);
    const citation = { sourceTitle: title512, title: title512 };
    const citations = Array<typeof citation>(32).fill(citation);
    expect(liveEvalLocaleCitationTitles({ evidenceAllowed: true, toolResults: [toolResult({ citations })] })).toEqual([title512]);
    expect(liveEvalLocaleCitationTitles({
      evidenceAllowed: true,
      toolResults: [toolResult({ citations: [...citations, { sourceTitle: "A", title: "" }] })],
    })).toEqual([]);
  });
});
