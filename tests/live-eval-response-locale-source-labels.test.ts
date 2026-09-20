import { describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { detectLiveEvalResponseLocale, evaluateLiveEvalResponseContract, LIVE_EVAL_THRESHOLDS } from "@/domain/ai/live-eval";
import { liveEvalLocaleCitationTitles, projectLiveEvalLocaleResponse, projectLiveEvalLocaleText } from "@/domain/ai/live-eval-response-locale";

const sourceTitle = "DEMO ONLY — Fictional emissions bulletin";
const certificateTitle = "DEMO ONLY — Fictional product certificate";
const productTitle = "DEMO ONLY — Fictional Engine 100";
const regulationTitle = "DEMO ONLY — Fictional China Non-road Stage A";
const candidates = [sourceTitle, certificateTitle, productTitle, regulationTitle];
const chineseBody = "这是虚构演示来源，不是真实法规。";
const disclaimer = "信息参考，不替代正式认证或法律意见";
const englishBody = "The product is not available for supply because its availability period has ended. Please verify an alternative product using real evidence.";
const approvedTitles = () => liveEvalLocaleCitationTitles({
  evidenceAllowed: true,
  toolResults: [{ status: "ok", evidenceSufficient: true, citations: [
    { sourceTitle, title: certificateTitle }, { sourceTitle: productTitle, title: regulationTitle },
  ] }],
});

describe("bounded exact source-label titles are locale-only evidence metadata", () => {
  it.each(["来源：", "Source: ", "Sources: ", "SOURCES：", "- 来源：", "  * Sources: "])(
    "recognizes the supported field label %s without removing that label", (label) => {
      const source = `${label}${sourceTitle}`;
      expect(projectLiveEvalLocaleText(`${chineseBody}\n${source}`, approvedTitles())).toBe(`${chineseBody}\n${label} `);
      expect(detectLiveEvalResponseLocale(`${chineseBody}\n${source}`, approvedTitles())).toBe("zh-CN");
    },
  );

  it.each([", ", "，", "、"])("recognizes a complete title list separated by %j", (separator) => {
    const text = `${chineseBody}\nSources: ${sourceTitle}${separator}${certificateTitle}.`;
    expect(projectLiveEvalLocaleText(text, approvedTitles())).toBe(`${chineseBody}\nSources:  ${separator} .`);
    expect(detectLiveEvalResponseLocale(text, approvedTitles())).toBe("zh-CN");
  });

  it("supports a mixed exact literal and bare list without weakening literal matching", () => {
    const text = `${chineseBody}\n来源：“${sourceTitle}”、${certificateTitle}、\`${productTitle}\`。`;
    expect(projectLiveEvalLocaleText(text, approvedTitles())).toBe(`${chineseBody}\n来源： 、 、 。`);
  });

  it.each([
    ["（locator: DEMO-CHN-NR-A）", "。"],
    [" (locator: DEMO-CERT-CHN-100)", "."],
    ["（locatorDescriptor kind=product_availability, availableFrom=2025-01-01, availableTo=2030-01-01）", "。"],
  ])("preserves every locator/field character in the ratio projection: %s", (annotation, punctuation) => {
    const text = `${chineseBody}来源：${sourceTitle}${annotation}${punctuation}实际结论仍须中文解释。`;
    const projection = projectLiveEvalLocaleResponse(text, approvedTitles());
    expect(projection.text).toBe(`${chineseBody}来源： ${annotation}${punctuation}实际结论仍须中文解释。`);
    expect(projection.nonCitationText).toBe(`${chineseBody} 实际结论仍须中文解释。`);
  });

  it("retains ordinary enum, field, model and scope terms in the language ratio", () => {
    const fields = "commercialReadiness=not_ready, modelCode DEMO-ENG-100, powerMinKw=50, effective, fit, CHN non-road";
    const text = `${chineseBody}\n${fields}\n来源：${sourceTitle}。`;
    expect(projectLiveEvalLocaleText(text, approvedTitles())).toContain(fields);
    expect(projectLiveEvalLocaleResponse(text, approvedTitles()).nonCitationText).toContain(fields);
  });

  it("bounds the annotation closing search at 256 characters without partial recovery", () => {
    const annotation = `(locator:${" ".repeat(246)}A)`;
    expect(annotation.length).toBe(257);
    const atLimit = `Sources: ${sourceTitle}${annotation}`;
    expect(projectLiveEvalLocaleText(atLimit, approvedTitles())).toBe(`Sources:  ${annotation}`);
    for (const unsupported of [`(locator:${" ".repeat(247)}A)`, `(locator:${" ".repeat(246)}A`]) {
      const text = `Sources: ${sourceTitle}${unsupported}`;
      expect(projectLiveEvalLocaleText(text, approvedTitles())).toBe(text);
    }
  });

  it.each([
    "UNKNOWN ONLY — Fictional emissions bulletin", sourceTitle.toLowerCase(),
    sourceTitle.replace("Fictional emissions", "Fictional  emissions"),
    sourceTitle.replace("Fictional emissions", "Fictional\temissions"), sourceTitle.replace("—", "-"),
    `${sourceTitle}0`, `${sourceTitle}-2027`, `${sourceTitle}/appendix`, `${sourceTitle} Revised`,
    `${sourceTitle}, Revised`, `${sourceTitle}. Revised`, `${sourceTitle} (Revised edition)`,
    `${sourceTitle}: approved`, `${sourceTitle}（this product is ready）`,
  ])("does not strip unknown, changed or suffixed source text: %s", (title) => {
    const text = `${chineseBody}\n来源：${title}`;
    expect(projectLiveEvalLocaleText(text, approvedTitles())).toBe(text);
  });

  it("matches the entire longest approved title rather than its approved prefix", () => {
    const longer = `${sourceTitle}, revised edition`;
    const text = `${chineseBody}\nSources: ${longer}`;
    expect(projectLiveEvalLocaleText(text, [sourceTitle, longer])).toBe(`${chineseBody}\nSources:  `);
    expect(projectLiveEvalLocaleText(text, [sourceTitle])).toBe(text);
  });

  it.each([
    sourceTitle, `Resource: ${sourceTitle}`, `upstreamSource: ${sourceTitle}`,
    `Description: ${sourceTitle}`, `Sources:\n${sourceTitle}`, `来源：${sourceTitle}\ncontinued title`,
    `    Sources: ${sourceTitle}`, `来源：${sourceTitle}（locator: not a valid locator）`,
    `来源：${sourceTitle}（locator: DEMO-CHN-NR-A`, `来源：${sourceTitle},`,
  ])("keeps unsupported or incomplete field formats: %s", (source) => {
    const text = `${chineseBody}\n${source}`;
    // A complete field on one line is supported even if later prose follows.
    if (source.includes("\ncontinued title")) {
      expect(projectLiveEvalLocaleText(text, approvedTitles())).toContain("continued title");
    } else expect(projectLiveEvalLocaleText(text, approvedTitles())).toBe(text);
  });

  it.each([
    [`“Sources: ${sourceTitle}”`], [`"Sources: ${sourceTitle}"`], [`\`Sources: ${sourceTitle}\``],
    [`“Sources: ${sourceTitle}\n”`], [`“Sources: ${sourceTitle}`],
    [`\`\`Sources: ${sourceTitle}\`\``], [`\`\`\`text\nSources: ${sourceTitle}\n\`\`\``],
    [`~~~text\n来源：${sourceTitle}\n~~~`],
  ])("does not recover a source field from an outer literal or fence: %s", (source) => {
    const text = `${chineseBody}\n${source}`;
    expect(projectLiveEvalLocaleText(text, approvedTitles())).toBe(text);
  });

  it("does not strip arbitrary English from backticks or parentheses", () => {
    const text = `${chineseBody}\n\`${englishBody}\`\n来源：${sourceTitle} (The product is available.)`;
    expect(projectLiveEvalLocaleText(text, approvedTitles())).toBe(text);
    expect(detectLiveEvalResponseLocale(text, approvedTitles())).toBe("en");
  });
});

describe("source-only presence guard never supplies or fabricates narrative language", () => {
  it("handles the supplied v24 public wording only under an explicit counterfactual title set", () => {
    // Historical localeEvidenceTitles were not retained. This supplies a new,
    // explicit candidate set; it neither replays nor changes the v24 report.
    const responseText = "在 2031-01-01，DEMO-ENG-100 对 CHN non-road 100 kW 的法规适配为“fit”，但供应状态不可用（commercialReadiness=not_ready），因为产品可用期已于 2030-01-01 结束。\n\n关键证据（均为明确标记的 Demo 数据）：\n- 法规与认证：适用法规 “DEMO ONLY — Fictional China Non-road Stage A” 状态 effective；证书 “DEMO-CERT-CHN-100” 状态 active，覆盖 50–150 kW、non-road，判定 CERTIFICATION_MATCH=pass。来源：DEMO ONLY — Fictional emissions bulletin（locator: DEMO-CHN-NR-A）、DEMO ONLY — Fictional product certificate（locator: DEMO-CERT-CHN-100）。asOf=2031-01-01，最近核验时间 2026-01-15T00:00:00.000Z。\n- 产品规格与功率/范围匹配：modelCode DEMO-ENG-100，powerMinKw=50、powerMaxKw=150，applicationScopes=[\"non-road\",\"construction\"]；APPLICATION_SCOPE_MATCH=pass、PRODUCT_POWER_MATCH=pass。来源：DEMO ONLY — Fictional Engine 100（locatorDescriptor kind=product_availability, availableFrom=2025-01-01, availableTo=2030-01-01）。\n- 供应可用性：PRODUCT_NO_LONGER_AVAILABLE=fail（availableTo=2030-01-01 < asOf=2031-01-01），因此整体 commercialReadiness=not_ready。\n\n风险/缺口：\n- 所有条目均标注 isDemo=true，且工具警告“结果包含明确标记的虚构 Demo 数据，不得作为真实法规或市场事实”。不能据此得出真实世界的合规或供货结论。\n- 未提供针对 2031-01-01 之后的替代型号或延长供货计划的信息。\n\n下一步建议：\n- 若需真实可执行判断，请改用非 Demo 的产品与法规数据源重新取证；或在现有 Demo 范围内查询 2030-01-01 之前日期的适配与供应情况以验证趋势。\n\n信息参考，不替代正式认证或法律意见。";
    expect(responseText).toHaveLength(1148);
    expect(detectLiveEvalResponseLocale(responseText)).toBe("indeterminate");
    expect(detectLiveEvalResponseLocale(responseText, approvedTitles())).toBe("zh-CN");
    const projection = projectLiveEvalLocaleText(responseText, approvedTitles());
    for (const unchanged of ["commercialReadiness=not_ready", "PRODUCT_NO_LONGER_AVAILABLE=fail", "asOf=2031-01-01", "DEMO-ENG-100", "locator: DEMO-CHN-NR-A", "applicationScopes=[\"non-road\",\"construction\"]", "不能据此得出真实世界的合规或供货结论"]) {
      expect(projection).toContain(unchanged);
    }
  });

  it.each([
    `来源：${sourceTitle}。`, `Sources: ${sourceTitle}, ${certificateTitle}.`,
    `来源：${sourceTitle}（locator: DEMO-CHN-NR-A）。`,
    `Source: ${productTitle} (locatorDescriptor kind=product_availability, availableFrom=2025-01-01, availableTo=2030-01-01).`,
    `来源：${sourceTitle}。\n来源：${certificateTitle}。\n来源：${productTitle}。\n来源：${regulationTitle}。`,
    `Sources: \`${sourceTitle}\`.\n${disclaimer}。`,
    `1. Sources: ${sourceTitle}\n2. Sources: ${certificateTitle}`,
    `1. Source: ${sourceTitle} (locator: DEMO-CHN-NR-A).`,
    `2031-01-01\nSources: ${sourceTitle} (locator: DEMO-CHN-NR-A).`,
  ])("does not pass either locale with only exact citation containers: %s", (text) => {
    expect(detectLiveEvalResponseLocale(text, approvedTitles())).toBe("indeterminate");
    for (const expectedLocale of ["en", "zh-CN"] as const) {
      expect(evaluateLiveEvalResponseContract({ expectedLocale, localeEvidenceTitles: approvedTitles(),
        responseContract: { factAnchors: [], decisionAnchors: [], disclaimerAnchor: null }, responseText: text,
      }).responseLocalePassed).toBe(false);
    }
  });

  it("keeps actual English decisions English with Chinese headings and disclaimer", () => {
    const text = `关键证据：\n${englishBody}\n来源：${sourceTitle}（locator: DEMO-CHN-NR-A）。\n${disclaimer}。`;
    expect(detectLiveEvalResponseLocale(text, approvedTitles())).toBe("en");
  });

  it("does not count known Chinese citation titles as Chinese narrative", () => {
    const title = "这是明确标记的虚构法规来源标题";
    const text = `${englishBody}\n来源：${title}，${title}，${title}。`;
    expect(detectLiveEvalResponseLocale(text, [title])).toBe("en");
  });

  it("does not change grounding, facts, polarity or the locale threshold", () => {
    const testCase = salesChatLiveCases.find(({ id }) => id === "product-ready-dual-axis");
    if (!testCase) throw new Error("Missing canonical product-ready case");
    for (const body of [
      "DEMO-ENG-100 在 CHN non-road、100 kW、2026-08-13 的合规适配结论为通过，供应状态为可供货。",
      "DEMO-ENG-1000 在 BRA non-road、1100 kW、2026-08-14 的合规适配结论为通过，供应状态为可供货。",
      "DEMO-ENG-100 在 CHN non-road、100 kW、2026-08-13 的合规适配结论为通过，供应状态为可供货。最终结论：不兼容，不可供货。",
    ]) {
      const responseText = `${body}\n来源：${sourceTitle}（locator: DEMO-CHN-NR-A）。\n${disclaimer}`;
      const input = { expectedLocale: "zh-CN" as const, responseContract: testCase.responseContract, responseText };
      const before = evaluateLiveEvalResponseContract(input);
      const after = evaluateLiveEvalResponseContract({ ...input, localeEvidenceTitles: approvedTitles() });
      expect(after.matchedResponseAnchorIds).toEqual(before.matchedResponseAnchorIds);
      expect(after.missingResponseAnchorIds).toEqual(before.missingResponseAnchorIds);
      expect(after.responseGroundingPassed).toBe(before.responseGroundingPassed);
    }
    expect(LIVE_EVAL_THRESHOLDS.responseLocaleAccuracyPct).toBe(100);
  });
});

describe("the same approved-metadata and bounded-work protections apply to source fields", () => {
  it.each([
    { evidenceAllowed: false, toolResults: [{ status: "ok", evidenceSufficient: true, citations: [{ sourceTitle, title: certificateTitle }] }] },
    { evidenceAllowed: true, toolResults: [] },
    { evidenceAllowed: true, toolResults: [{ status: "ok", evidenceSufficient: false, citations: [{ sourceTitle, title: certificateTitle }] }] },
    { evidenceAllowed: true, toolResults: [{ status: "ok", evidenceSufficient: true, citations: [{ sourceTitle, title: certificateTitle }] }, { status: "error", evidenceSufficient: false, citations: [] }] },
  ])("keeps unapproved source labels unchanged (%j)", (input) => {
    const text = `${chineseBody}\n来源：${sourceTitle}`;
    expect(projectLiveEvalLocaleText(text, liveEvalLocaleCitationTitles(input))).toBe(text);
    expect(projectLiveEvalLocaleText(text)).toBe(text);
  });

  it("fails the whole projection closed on title-list and response bounds", () => {
    const atLimit = `来源：${Array<string>(32).fill(sourceTitle).join(", ")}`;
    expect(projectLiveEvalLocaleText(atLimit, candidates)).not.toContain(sourceTitle);
    expect(detectLiveEvalResponseLocale(atLimit, candidates)).toBe("indeterminate");
    const text = `${chineseBody}\n来源：${Array<string>(33).fill(sourceTitle).join(", ")}`;
    expect(projectLiveEvalLocaleText(text, candidates)).toBe(text);
    const tooLong = `${chineseBody}\n来源：${sourceTitle}\n${"x".repeat(131_072)}`;
    expect(projectLiveEvalLocaleText(tooLong, candidates)).toBe(tooLong);
  });

  it("retains full original text on candidate count, bytes or projection-work overflow", () => {
    const text = `${chineseBody}\n来源：${sourceTitle}`;
    expect(projectLiveEvalLocaleText(text, Array<string>(257).fill(sourceTitle))).toBe(text);
    expect(projectLiveEvalLocaleText(text, [sourceTitle, "A ".repeat(257)])).toBe(text);
    expect(projectLiveEvalLocaleText(text, Array<string>(65).fill("A ".repeat(256)))).toBe(text);
    const manyTitles = Array.from({ length: 64 }, (_, index) => `${"A".repeat(495)} title ${String(index).padStart(3, "0")}`);
    const repeated = `\`${sourceTitle}\`\n${`Sources: ${sourceTitle}\n`.repeat(40)}`;
    expect(projectLiveEvalLocaleText(repeated, [...manyTitles, sourceTitle])).toBe(repeated);
  });
});
