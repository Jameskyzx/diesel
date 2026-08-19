import "server-only";

import {
  buildConversationBusinessContext,
  hasConversationComparisonIntent,
} from "@/server/ai/conversation-context";
import type { Locale } from "@/i18n/locale";

type DirectChatResponseInput = {
  locale?: Locale;
  selectedCountryIso3: string | null;
  text: string;
  userTexts?: readonly string[];
};

const greetingPattern =
  /^(?:你好|您好|嗨|哈喽|在吗|早上好|下午好|晚上好|hello|hi|hey)[!！?？。,.，\s]*$/iu;
const thanksPattern =
  /^(?:谢谢|感谢|多谢|好的谢谢|明白了|收到|thanks|thank you)[!！。,.，\s]*$/iu;
const capabilityPattern =
  /(?:你能(?:做|干|帮我做)(?:什么|啥)|你会什么|有哪些功能|可以做什么|怎么使用|怎么用|使用帮助|介绍一下(?:你自己)?|what can you do|how (?:do i|to) use (?:this|you)|help me use (?:this|you))/iu;
const vagueAnalysisPattern =
  /^(?:(?:帮我)?(?:分析一下|看看|给点建议|怎么卖|该怎么做|你怎么看)|(?:please )?(?:analy[sz]e this|take a look|give me advice|what should i do))[!！?？。,.，\s]*$/iu;
const pureAttachmentContentRequestPatterns = [
  /^(?:(?:请|请你|帮我|麻烦你?|能否|可以)\s*)?(?:概述|总结|摘要|描述|识别|提取|读取|读出|转录|翻译|ocr)\s*(?:一下)?\s*(?:我)?\s*(?:刚刚|刚才)?\s*(?:上传的|所附的|这个|这张|这份|这些)?\s*(?:附件|文件|图片|图像|照片|截图|pdf|csv|markdown)\s*(?:中|里|内|上)?\s*(?:的)?\s*(?:文字|文本|内容|表格|信息)?\s*(?:(?:并)?\s*(?:翻译)?(?:成|为)\s*(?:中文|英文|英语|汉语))?\s*[!！?？。,.，]*$/iu,
  /^(?:(?:请|请你|帮我|麻烦你?)\s*)?(?:这张|这个|这份|这些)\s*(?:图片|图像|照片|截图|附件|文件|pdf)\s*(?:里|内|上|中)?\s*(?:有|写着|写了|包含)\s*(?:什么|哪些)\s*(?:内容|文字|信息)?\s*[!！?？。,.，]*$/iu,
  /^(?:please\s+)?(?:summari[sz]e|describe|transcribe|translate|extract|read|ocr)\s+(?:(?:the|this|these|my|attached|uploaded)\s+)*(?:attachment|file|image|photo|screenshot|pdf|csv|markdown)(?:\s+(?:text|content|table))?(?:\s+(?:to|into)\s+(?:chinese|english))?\s*[.!?]*$/iu,
  /^(?:please\s+)?(?:extract|read|transcribe|ocr)\s+(?:the\s+)?(?:text|content|table)\s+from\s+(?:(?:the|this|my|attached|uploaded)\s+)*(?:attachment|file|image|photo|screenshot|pdf)\s*[.!?]*$/iu,
] as const;

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function contextLine(selectedCountryIso3: string | null): string {
  return selectedCountryIso3
    ? `当前国家上下文是 ${selectedCountryIso3}；你明确写出的国家会覆盖它。`
    : "当前没有国家上下文，提问时请写国家名称或 ISO3。";
}

/**
 * Only pure extraction/description turns may answer without a fact tool.
 * Mixed prompts fail closed: an unrelated upload must never weaken the
 * evidence boundary for regulations, certifications, products, or markets.
 */
export function allowsToolFreeAttachmentResponse(text: string): boolean {
  const normalized = normalize(text);
  return pureAttachmentContentRequestPatterns.some((pattern) =>
    pattern.test(normalized),
  );
}

function capabilityResponse(selectedCountryIso3: string | null): string {
  return `可以。我会先查询平台里的结构化事实和可追溯来源，再给出解释，不会拿模型记忆冒充法规依据。

我适合处理四类任务：
1. 查询单个国家当前有效或未来已采纳的排放法规；
2. 比较 2–5 个国家的法规或结构化市场指标；
3. 按国家、用途、功率和日期判断产品适配；
4. 生成带确定性评分、风险、产品和行动项的销售简报。

${contextLine(selectedCountryIso3)}

你可以直接问：“对比 CHN 与 DEU 在 2026-08-08 的 non-road 120 kW 法规，并说明产品适配风险。”`;
}

function structuredAnalysisMissingParameters(
  context: ReturnType<typeof buildConversationBusinessContext>,
): string[] {
  const missing: string[] = [];
  if (context.countryIso3s.length < 2) {
    missing.push("至少两个国家");
  }
  if (context.applicationScope === null) {
    missing.push("应用场景（如 non-road、on-road-truck、marine）");
  }
  if (context.powerKw === null) {
    missing.push("额定功率（kW）");
  }
  return missing;
}

function profileTopicLabel(
  topics: ReturnType<typeof buildConversationBusinessContext>["profileTopics"],
): string {
  return topics
    .map((topic) =>
      topic === "regulations"
        ? "法规"
        : topic === "market"
          ? "市场数据"
          : "国家资料",
    )
    .join("、");
}

function buildEnglishDirectChatResponse({
  context,
  normalized,
  selectedCountryIso3,
}: {
  context: ReturnType<typeof buildConversationBusinessContext>;
  normalized: string;
  selectedCountryIso3: string | null;
}): string | null {
  const contextText = selectedCountryIso3
    ? `The current country context is ${selectedCountryIso3}; a country named in your question takes precedence.`
    : "There is no country context. Include a country name or ISO3 code in your question.";
  const disclaimer = "For information only; not a substitute for formal certification or legal advice.";
  const missingStructuredParameters = (): string[] => {
    const missing: string[] = [];
    if (context.countryIso3s.length < 2) missing.push("at least two countries");
    if (context.applicationScope === null) missing.push("an application scope, such as non-road or on-road-truck");
    if (context.powerKw === null) missing.push("rated power in kW");
    return missing;
  };

  if (greetingPattern.test(normalized) || capabilityPattern.test(normalized)) {
    return `Yes. I query structured facts and traceable sources before explaining a result; I do not present model memory as regulatory evidence.

I can:
1. find current effective or future adopted rules for one country;
2. compare regulations or structured market metrics across 2–5 countries;
3. evaluate product fit by country, application, power, and date; and
4. create a sales brief with deterministic scores, risks, products, and actions.

${contextText}

Try: “Compare CHN and DEU non-road rules at 120 kW as of 2026-08-08, then explain the product-fit risk.”`;
  }
  if (thanksPattern.test(normalized)) {
    return `You’re welcome. For the next question, include the country, topic, and any required application, power, or date so I can query current evidence again.\n\n${contextText}`;
  }
  if (vagueAnalysisPattern.test(normalized) && context.activeTask === null) {
    return `I can help, but first specify:\n1. one target country or 2–5 countries to compare;\n2. regulations, market data, product fit, or a complete sales brief;\n3. application scope and power when a product is involved; and\n4. an as-of date when needed.\n\n${contextText}`;
  }
  if (context.activeTask === "country_profile" && context.focusedCountryIso3 === null) {
    const topics = context.profileTopics.map((topic) =>
      topic === "regulations" ? "regulations" : topic === "market" ? "market data" : "country profile",
    ).join(", ");
    return `A country is required to query ${topics || "country information"}. Provide a country name or ISO3 code such as CHN, BRA, or DEU.\n\n${contextText}`;
  }
  if (context.activeTask === "product_fit") {
    const missing: string[] = [];
    if (context.applicationScope === null) missing.push("an application scope, such as non-road or on-road-truck");
    if (context.powerKw === null) missing.push("rated power in kW");
    if (missing.length > 0) {
      return `A deterministic product-fit decision still needs ${missing.join(" and ")}. Add the missing values and retry; if no date is supplied I use the current UTC date.\n\n${contextText}\n\n${disclaimer}`;
    }
  }
  if (context.activeTask === "sales_brief" || context.activeTask === "opportunity_score") {
    const missing = missingStructuredParameters();
    if (missing.length > 0) {
      return `A deterministic ${context.activeTask === "sales_brief" ? "sales brief" : "opportunity score"} still needs ${missing.join(", ")}. Add the missing values and retry; if no date is supplied I use the current UTC date.\n\n${contextText}\n\n${disclaimer}`;
    }
  }
  if (
    context.activeTask === "regulation_compare" ||
    context.activeTask === "market_compare" ||
    hasConversationComparisonIntent(normalized)
  ) {
    const isRegulationComparison = context.activeTask === "regulation_compare";
    const missing = isRegulationComparison
      ? missingStructuredParameters()
      : context.countryIso3s.length < 2
        ? ["at least two countries"]
        : [];
    if (missing.length > 0) {
      return `A deterministic cross-country ${isRegulationComparison ? "regulatory" : "market"} comparison still needs ${missing.join(", ")}. Add the missing values and retry; if no date is supplied I use the current UTC date.\n\n${contextText}\n\n${disclaimer}`;
    }
  }
  return null;
}

export function buildDirectChatResponse({
  locale = "zh-CN",
  selectedCountryIso3,
  text,
  userTexts = [text],
}: DirectChatResponseInput): string | null {
  const normalized = normalize(text);
  const contextTexts =
    userTexts.at(-1) === text ? userTexts : [...userTexts, text];
  const context = buildConversationBusinessContext(contextTexts, {
    selectedCountryIso3,
  });

  if (locale === "en") {
    return buildEnglishDirectChatResponse({
      context,
      normalized,
      selectedCountryIso3,
    });
  }

  if (greetingPattern.test(normalized) || capabilityPattern.test(normalized)) {
    return capabilityResponse(selectedCountryIso3);
  }

  if (thanksPattern.test(normalized)) {
    return `不客气。继续提问时给我国家、要查的主题，以及用途、功率或日期等必要条件，我会重新查询当前证据。\n\n${contextLine(selectedCountryIso3)}`;
  }

  if (vagueAnalysisPattern.test(normalized) && context.activeTask === null) {
    return `可以，但需要先确定分析目标。请至少补充：\n1. 目标国家，或需要比较的 2–5 个国家；\n2. 要看法规、市场、产品适配还是完整销售简报；\n3. 涉及产品时提供应用场景和功率；\n4. 有指定判断日期时写明日期。\n\n${contextLine(selectedCountryIso3)}`;
  }

  if (
    context.activeTask === "country_profile" &&
    context.focusedCountryIso3 === null
  ) {
    return `要查询${profileTopicLabel(context.profileTopics)}，还缺少国家。请写国家名称或 ISO3，例如 CHN、BRA、DEU。\n\n${contextLine(selectedCountryIso3)}`;
  }

  if (context.activeTask === "product_fit") {
    const missing: string[] = [];
    if (context.applicationScope === null) {
      missing.push("应用场景（如 non-road、on-road-truck、marine）");
    }
    if (context.powerKw === null) {
      missing.push("额定功率（kW）");
    }

    if (missing.length > 0) {
      return `要做确定性的产品适配判断，还缺少：${missing.join("、")}。请补充后重试；日期未写时我会使用当前 UTC 日期。\n\n${contextLine(selectedCountryIso3)}\n\n信息参考，不替代正式认证或法律意见`;
    }
  }

  if (
    context.activeTask === "sales_brief" ||
    context.activeTask === "opportunity_score"
  ) {
    const missing = structuredAnalysisMissingParameters(context);
    if (missing.length > 0) {
      return `要生成确定性的${context.activeTask === "sales_brief" ? "销售简报" : "机会评分"}，还缺少：${missing.join("、")}。请补充后重试；日期未写时我会使用当前 UTC 日期。\n\n${contextLine(selectedCountryIso3)}\n\n信息参考，不替代正式认证或法律意见`;
    }
  }

  if (
    context.activeTask === "regulation_compare" ||
    context.activeTask === "market_compare" ||
    hasConversationComparisonIntent(normalized)
  ) {
    const isRegulationComparison = context.activeTask === "regulation_compare";
    const missing = isRegulationComparison
      ? structuredAnalysisMissingParameters(context)
      : context.countryIso3s.length < 2
        ? ["至少两个国家"]
        : [];
    if (missing.length > 0) {
      return `要完成确定性的跨国${isRegulationComparison ? "法规" : "市场"}比较，还缺少：${missing.join("、")}。请补充后重试；日期未写时我会使用当前 UTC 日期。\n\n${contextLine(selectedCountryIso3)}\n\n信息参考，不替代正式认证或法律意见`;
    }
  }

  return null;
}
