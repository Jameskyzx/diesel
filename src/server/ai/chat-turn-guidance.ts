import "server-only";

import { countryCatalog } from "@/server/db/seed/country-catalog";

type DirectChatResponseInput = {
  selectedCountryIso3: string | null;
  text: string;
};

const greetingPattern =
  /^(?:你好|您好|嗨|哈喽|在吗|早上好|下午好|晚上好|hello|hi|hey)[!！?？。,.，\s]*$/iu;
const thanksPattern =
  /^(?:谢谢|感谢|多谢|好的谢谢|明白了|收到|thanks|thank you)[!！。,.，\s]*$/iu;
const capabilityPattern =
  /(?:你能(?:做|干|帮我做)(?:什么|啥)|你会什么|有哪些功能|可以做什么|怎么使用|怎么用|使用帮助|介绍一下(?:你自己)?)/u;
const vagueAnalysisPattern =
  /^(?:帮我)?(?:分析一下|看看|给点建议|怎么卖|该怎么做|你怎么看)[!！?？。,.，\s]*$/u;
const productIntentPattern =
  /(?:产品适配|适配产品|兼容产品|产品推荐|推荐.{0,4}(?:产品|型号)|型号.{0,5}(?:适配|匹配|兼容|能用)|(?:产品|发动机).{0,5}(?:适配|匹配|兼容|能用))/u;
const comparisonIntentPattern = /(?:比较|对比|排名|排行|哪个国家|哪个市场)/u;
const powerPattern = /(?:^|\D)\d+(?:\.\d+)?\s*(?:kw|千瓦)(?:\D|$)/iu;
const scopePattern =
  /(?:on-road|non-road|marine|generator-set|agriculture|construction|on-road-truck|on-road-bus|道路|非道路|船用|发电机组|农业|农机|工程机械|建筑机械|卡车|货车|客车|公交)/iu;
const pureAttachmentContentRequestPatterns = [
  /^(?:(?:请|请你|帮我|麻烦你?|能否|可以)\s*)?(?:概述|总结|摘要|描述|识别|提取|读取|读出|转录|翻译|ocr)\s*(?:一下)?\s*(?:我)?\s*(?:刚刚|刚才)?\s*(?:上传的|所附的|这个|这张|这份|这些)?\s*(?:附件|文件|图片|图像|照片|截图|pdf|csv|markdown)\s*(?:中|里|内|上)?\s*(?:的)?\s*(?:文字|文本|内容|表格|信息)?\s*(?:(?:并)?\s*(?:翻译)?(?:成|为)\s*(?:中文|英文|英语|汉语))?\s*[!！?？。,.，]*$/iu,
  /^(?:(?:请|请你|帮我|麻烦你?)\s*)?(?:这张|这个|这份|这些)\s*(?:图片|图像|照片|截图|附件|文件|pdf)\s*(?:里|内|上|中)?\s*(?:有|写着|写了|包含)\s*(?:什么|哪些)\s*(?:内容|文字|信息)?\s*[!！?？。,.，]*$/iu,
  /^(?:please\s+)?(?:summari[sz]e|describe|transcribe|translate|extract|read|ocr)\s+(?:(?:the|this|these|my|attached|uploaded)\s+)*(?:attachment|file|image|photo|screenshot|pdf|csv|markdown)(?:\s+(?:text|content|table))?(?:\s+(?:to|into)\s+(?:chinese|english))?\s*[.!?]*$/iu,
  /^(?:please\s+)?(?:extract|read|transcribe|ocr)\s+(?:the\s+)?(?:text|content|table)\s+from\s+(?:(?:the|this|my|attached|uploaded)\s+)*(?:attachment|file|image|photo|screenshot|pdf)\s*[.!?]*$/iu,
] as const;

const countryAliases: Readonly<Record<string, string>> = {
  中国: "CHN",
  美国: "USA",
  德国: "DEU",
  巴西: "BRA",
  澳大利亚: "AUS",
  日本: "JPN",
  韩国: "KOR",
  加拿大: "CAN",
  墨西哥: "MEX",
  土耳其: "TUR",
  英国: "GBR",
  法国: "FRA",
  意大利: "ITA",
  西班牙: "ESP",
  印度: "IND",
  印度尼西亚: "IDN",
  印尼: "IDN",
  马来西亚: "MYS",
  越南: "VNM",
  泰国: "THA",
  新加坡: "SGP",
  南非: "ZAF",
  沙特阿拉伯: "SAU",
  沙特: "SAU",
  阿联酋: "ARE",
  俄罗斯: "RUS",
  阿根廷: "ARG",
  瑞士: "CHE",
  波兰: "POL",
  china: "CHN",
  uk: "GBR",
  "united states": "USA",
};

const countryIso3Codes = new Set(countryCatalog.map(({ iso3 }) => iso3));

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function normalizedWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function containsName(text: string, name: string): boolean {
  const normalizedText = normalizedWords(text);
  const normalizedName = normalizedWords(name);

  return /\p{Script=Han}/u.test(normalizedName)
    ? normalizedText.includes(normalizedName)
    : ` ${normalizedText} `.includes(` ${normalizedName} `);
}

function detectedCountries(text: string): Set<string> {
  const countries = new Set<string>();

  for (const [alias, iso3] of Object.entries(countryAliases)) {
    if (containsName(text, alias)) {
      countries.add(iso3);
    }
  }

  for (const country of countryCatalog) {
    if (containsName(text, country.nameEn)) {
      countries.add(country.iso3);
    }
  }

  for (const match of text.matchAll(/(?:^|[^a-z])([a-z]{3})(?=$|[^a-z])/giu)) {
    const iso3 = match[1].toUpperCase();
    if (countryIso3Codes.has(iso3)) {
      countries.add(iso3);
    }
  }

  return countries;
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

export function buildDirectChatResponse({
  selectedCountryIso3,
  text,
}: DirectChatResponseInput): string | null {
  const normalized = normalize(text);

  if (greetingPattern.test(normalized) || capabilityPattern.test(normalized)) {
    return capabilityResponse(selectedCountryIso3);
  }

  if (thanksPattern.test(normalized)) {
    return `不客气。继续提问时给我国家、要查的主题，以及用途、功率或日期等必要条件，我会重新查询当前证据。\n\n${contextLine(selectedCountryIso3)}`;
  }

  if (vagueAnalysisPattern.test(normalized)) {
    return `可以，但需要先确定分析目标。请至少补充：\n1. 目标国家，或需要比较的 2–5 个国家；\n2. 要看法规、市场、产品适配还是完整销售简报；\n3. 涉及产品时提供应用场景和功率；\n4. 有指定判断日期时写明日期。\n\n${contextLine(selectedCountryIso3)}`;
  }

  if (productIntentPattern.test(normalized)) {
    const missing: string[] = [];
    if (!scopePattern.test(normalized)) {
      missing.push("应用场景（如 non-road、on-road-truck、marine）");
    }
    if (!powerPattern.test(normalized)) {
      missing.push("额定功率（kW）");
    }

    if (missing.length > 0) {
      return `要做确定性的产品适配判断，还缺少：${missing.join("、")}。请补充后重试；日期未写时我会使用当前 UTC 日期。\n\n${contextLine(selectedCountryIso3)}\n\n信息参考，不替代正式认证或法律意见`;
    }
  }

  if (comparisonIntentPattern.test(normalized)) {
    const countries = detectedCountries(normalized);
    if (selectedCountryIso3) {
      countries.add(selectedCountryIso3);
    }

    if (countries.size < 2) {
      return `跨国比较至少需要两个明确国家。请写国家名称或 ISO3，并说明要比较法规、市场、机会评分还是销售简报；法规比较还需要应用场景和功率。\n\n${contextLine(selectedCountryIso3)}`;
    }
  }

  return null;
}
