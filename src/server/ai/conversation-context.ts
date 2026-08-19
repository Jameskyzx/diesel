import "server-only";

import type { ApplicationScope } from "@/features/database/schemas";
import { countryCatalog } from "@/server/db/seed/country-catalog";

export type ConversationBusinessContext = {
  activeTask: ActiveConversationTask | null;
  applicationScope: ApplicationScope | null;
  asOf: string | null;
  countryIso3s: string[];
  focusedCountryIso3: string | null;
  hasPowerConflict: boolean;
  powerKw: number | null;
  profileTopics: CountryProfileTopic[];
  productModelCode: string | null;
  targetCountryIso3: string | null;
};

export type CountryProfileTopic = "country" | "market" | "regulations";

export type ActiveConversationTask =
  | "country_profile"
  | "knowledge"
  | "market_compare"
  | "opportunity_score"
  | "product_fit"
  | "regulation_compare"
  | "sales_brief";

type BuildConversationBusinessContextOptions = {
  selectedCountryIso3?: string | null;
};

type LocatedCountry = {
  countryIso3: string;
  index: number;
  length: number;
};

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
const scopeMatchers: ReadonlyArray<{
  pattern: RegExp;
  scope: ApplicationScope;
}> = [
  { pattern: /on-road-truck|卡车|货车/iu, scope: "on-road-truck" },
  { pattern: /on-road-bus|客车|公交/iu, scope: "on-road-bus" },
  { pattern: /construction|工程机械|建筑机械/iu, scope: "construction" },
  { pattern: /agriculture|农业|农机/iu, scope: "agriculture" },
  { pattern: /generator-set|发电机组/iu, scope: "generator-set" },
  { pattern: /marine|船用/iu, scope: "marine" },
  { pattern: /non-road|非道路/iu, scope: "non-road" },
  { pattern: /on-road|道路/iu, scope: "on-road" },
];
const comparisonIntentPattern =
  /(?:比较|对比|排名|排行|哪个国家|哪个市场|compare|comparison|versus|\bvs\.?\b)/iu;
const negatedComparisonIntentPattern =
  /(?:不(?:做|进行|需要)?(?:任何)?(?:跨国|跨市场|国家间|市场间)?(?:比较|对比)|(?:无需|无须|不要|不必)(?:进行|做)?(?:任何)?(?:跨国|跨市场|国家间|市场间)?(?:比较|对比)|(?:without|no)\s+(?:cross[- ]country\s+|market\s+)?(?:comparison|compare))/giu;
const targetCountryIntentPattern =
  /(?:目标(?:国家|市场)|(?:国家|市场).{0,6}作为目标|target\s+(?:country|market))/iu;
const salesBriefIntentPattern =
  /(?:销售简报|客户复述|销售策略|下一步建议|sales\s*brief|sales\s*strategy)/iu;
const opportunityScoreIntentPattern =
  /(?:机会(?:评分|分数|排名)|市场机会(?:评分|分数|排名)|opportunity\s*(?:score|ranking))/iu;
const productSubjectPattern = /(?:产品|发动机|型号|product|engine|model)/iu;
const productFitActionPattern =
  /(?:适配|匹配|兼容|能用|合规|认证|推荐|fit|compatible|compliant|certif|recommend)/iu;
const nonModelHyphenatedCodes = new Set([
  "GENERATOR-SET",
  "NON-ROAD",
  "ON-ROAD",
  "ON-ROAD-BUS",
  "ON-ROAD-TRUCK",
]);
const deicticProductPattern =
  /(?:(?:这个|该|上述|前述)(?:产品|发动机|型号)|(?:this|the|that)\s+(?:product|engine|model))/iu;
const regulationTopicPattern =
  /(?:法规|排放|限值|regulation|emission|emissions\s*limit)/iu;
const marketTopicPattern =
  /(?:市场|销量|销售量|market|sales\s*volume)/iu;
const knowledgeIntentPattern =
  /(?:原文|公告|文档|章节|条款|知识库|检索证据|来源|出处|页码|依据|source\s*document|original\s*(?:text|wording)|knowledge\s*base|citation|section|clause)/iu;
const countryProfileIntentPattern =
  /(?:国家(?:基础)?概览|国家资料|国家信息|目前有哪些|当前有哪些|当前有效法规|市场数据|市场规模|country\s*profile|country\s*overview)/iu;
const countryProfileBaseTopicPattern =
  /(?:国家(?:基础)?概览|国家资料|国家信息|country\s*profile|country\s*overview)/iu;

function literalMatches(
  text: string,
  literal: string,
): Array<{ index: number; value: string }> {
  const matches: Array<{ index: number; value: string }> = [];
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = /\p{Script=Han}/u.test(literal)
    ? new RegExp(escaped, "giu")
    : new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");

  for (const match of text.matchAll(pattern)) {
    matches.push({ index: match.index, value: match[0] });
  }
  return matches;
}

export function countryIso3sIn(text: string): string[] {
  const locatedCountries: LocatedCountry[] = [];

  for (const [alias, iso3] of Object.entries(countryAliases)) {
    for (const match of literalMatches(text, alias)) {
      locatedCountries.push({
        countryIso3: iso3,
        index: match.index,
        length: match.value.length,
      });
    }
  }

  for (const country of countryCatalog) {
    for (const match of literalMatches(text, country.nameEn)) {
      locatedCountries.push({
        countryIso3: country.iso3,
        index: match.index,
        length: match.value.length,
      });
    }
  }

  for (const match of text.matchAll(/(?:^|[^a-z])([a-z]{3})(?=$|[^a-z])/giu)) {
    const iso3 = match[1].toUpperCase();
    if (countryIso3Codes.has(iso3)) {
      locatedCountries.push({
        countryIso3: iso3,
        index: match.index + match[0].indexOf(match[1]),
        length: match[1].length,
      });
    }
  }

  locatedCountries.sort(
    (left, right) => left.index - right.index || right.length - left.length,
  );

  const countries: string[] = [];
  let claimedIndex = -1;
  for (const locatedCountry of locatedCountries) {
    // Prefer the longest country name when aliases share a starting position,
    // such as 印度尼西亚 and 印度.
    if (locatedCountry.index === claimedIndex) {
      continue;
    }
    claimedIndex = locatedCountry.index;
    if (!countries.includes(locatedCountry.countryIso3)) {
      countries.push(locatedCountry.countryIso3);
    }
  }
  return countries;
}

export function activeConversationTaskIn(
  text: string,
): ActiveConversationTask | null {
  if (salesBriefIntentPattern.test(text)) {
    return "sales_brief";
  }
  if (opportunityScoreIntentPattern.test(text)) {
    return "opportunity_score";
  }
  if (
    deicticProductPattern.test(text) ||
    (productSubjectPattern.test(text) && productFitActionPattern.test(text)) ||
    (productModelCodeIn(text) !== null && productFitActionPattern.test(text))
  ) {
    return "product_fit";
  }
  if (
    hasConversationComparisonIntent(text) &&
    regulationTopicPattern.test(text)
  ) {
    return "regulation_compare";
  }
  if (hasConversationComparisonIntent(text) && marketTopicPattern.test(text)) {
    return "market_compare";
  }
  if (knowledgeIntentPattern.test(text)) {
    return "knowledge";
  }
  if (
    countryProfileIntentPattern.test(text) ||
    regulationTopicPattern.test(text) ||
    marketTopicPattern.test(text)
  ) {
    return "country_profile";
  }
  return null;
}

export function hasConversationComparisonIntent(text: string): boolean {
  return comparisonIntentPattern.test(
    text.replace(negatedComparisonIntentPattern, ""),
  );
}

function countryProfileTopicsIn(text: string): CountryProfileTopic[] {
  const topics: CountryProfileTopic[] = [];
  if (countryProfileBaseTopicPattern.test(text)) {
    topics.push("country");
  }
  if (regulationTopicPattern.test(text)) {
    topics.push("regulations");
  }
  if (marketTopicPattern.test(text)) {
    topics.push("market");
  }
  return topics.length > 0 ? topics : ["country"];
}

function explicitTargetCountryIso3In(text: string): string | null {
  const fromToTarget = text.match(
    /(?:目标(?:国家|市场)|target\s+(?:country|market))\s*(?:从|from)\s*([^,，。;；\n]{1,40}?)\s*(?:改成|改为|变成|调整为|to)\s*([^,，。;；\n]{1,40})/iu,
  );
  const fromToCountries = fromToTarget
    ? countryIso3sIn(fromToTarget[2] ?? "")
    : [];
  if (fromToCountries.length > 0) {
    return fromToCountries[0] ?? null;
  }

  const targetAfterMarker = text.match(
    /(?:目标(?:国家|市场)|target\s+(?:country|market))\s*(?:是|为|设为|改为|:|：|is|=)?\s*([^,，。;；\n]{1,80})/iu,
  )?.[1];
  const targetAfterMarkerCountries = targetAfterMarker
    ? countryIso3sIn(targetAfterMarker)
    : [];
  if (targetAfterMarkerCountries.length > 0) {
    return targetAfterMarkerCountries[0] ?? null;
  }

  const targetBeforeMarker = text.match(
    /([^,，。;；\n]{1,80}?)\s*(?:作为|设为|改成|改为|变成|为|as\s+(?:the\s+)?)\s*(?:目标(?:国家|市场)|target\s+(?:country|market))/iu,
  )?.[1];
  const targetBeforeMarkerCountries = targetBeforeMarker
    ? countryIso3sIn(targetBeforeMarker)
    : [];
  return targetBeforeMarkerCountries.at(-1) ?? null;
}

function applicationScopeIn(text: string): ApplicationScope | null {
  return scopeMatchers.find(({ pattern }) => pattern.test(text))?.scope ?? null;
}

function powerKwsIn(text: string): number[] {
  return Array.from(
    new Set(
      Array.from(
        text.matchAll(/(?:^|\D)(\d+(?:\.\d+)?)\s*(?:kw|千瓦)(?=\D|$)/giu),
        (match) => Number(match[1]),
      ),
    ),
  );
}

function explicitAsOfIn(text: string): string | null {
  return text.match(/\b\d{4}-\d{2}-\d{2}\b/u)?.[0] ?? null;
}

function productModelCodeIn(text: string): string | null {
  const candidates = text.toUpperCase().match(/\b[A-Z][A-Z0-9-]{2,99}\b/gu) ?? [];
  return (
    candidates.find(
      (candidate) =>
        !nonModelHyphenatedCodes.has(candidate) &&
        ((/\d/u.test(candidate) &&
          /[A-Z]/u.test(candidate) &&
          (/^[A-Z]{1,4}\d[A-Z0-9-]*$/u.test(candidate) ||
            /^[A-Z][A-Z0-9]*-[A-Z0-9-]*\d[A-Z0-9-]*$/u.test(candidate))) ||
          /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+){2,}$/u.test(candidate)),
    ) ?? null
  );
}

function appendCountry(countries: readonly string[], countryIso3: string) {
  return countries.includes(countryIso3)
    ? [...countries]
    : [...countries, countryIso3].slice(0, 5);
}

/**
 * Reduces trusted user turns into business parameters. A new complete country
 * set replaces the old set, while a target-country update changes only the
 * target. This keeps comparison peers separate from the currently focused
 * country used by a single-country follow-up.
 */
export function buildConversationBusinessContext(
  userTexts: readonly string[],
  options: BuildConversationBusinessContextOptions = {},
): ConversationBusinessContext {
  const selectedCountryIso3 = options.selectedCountryIso3 ?? null;
  const context: ConversationBusinessContext = {
    activeTask: null,
    applicationScope: null,
    asOf: null,
    countryIso3s: selectedCountryIso3 ? [selectedCountryIso3] : [],
    focusedCountryIso3: selectedCountryIso3,
    hasPowerConflict: false,
    powerKw: null,
    profileTopics: [],
    productModelCode: null,
    targetCountryIso3: selectedCountryIso3,
  };

  for (const text of userTexts) {
    const countries = countryIso3sIn(text).slice(0, 5);
    const powerKws = powerKwsIn(text);
    const explicitTargetCountryIso3 = explicitTargetCountryIso3In(text);
    const isComparisonTurn = hasConversationComparisonIntent(text);
    const isTargetCountryTurn =
      explicitTargetCountryIso3 !== null ||
      targetCountryIntentPattern.test(text) ||
      (countries.length === 1 && salesBriefIntentPattern.test(text));
    const explicitTask = activeConversationTaskIn(text);

    context.activeTask = explicitTask ?? context.activeTask;
    if (explicitTask === "country_profile") {
      context.profileTopics = countryProfileTopicsIn(text);
    }

    if (countries.length >= 2) {
      context.countryIso3s = countries;
      context.focusedCountryIso3 = countries[0] ?? null;
      context.targetCountryIso3 =
        explicitTargetCountryIso3 ?? countries[0] ?? null;
    } else if (countries.length === 1) {
      const countryIso3 = countries[0]!;
      context.focusedCountryIso3 = countryIso3;

      if (isTargetCountryTurn) {
        context.countryIso3s = appendCountry(context.countryIso3s, countryIso3);
        context.targetCountryIso3 = countryIso3;
      } else if (isComparisonTurn && context.countryIso3s.length > 0) {
        context.countryIso3s = appendCountry(context.countryIso3s, countryIso3);
      } else {
        context.countryIso3s = [countryIso3];
        context.targetCountryIso3 = countryIso3;
      }
    }

    context.applicationScope =
      applicationScopeIn(text) ?? context.applicationScope;
    if (powerKws.length > 1) {
      context.hasPowerConflict = true;
      context.powerKw = null;
    } else if (powerKws.length === 1) {
      context.hasPowerConflict = false;
      context.powerKw = powerKws[0] ?? null;
    }
    context.asOf = explicitAsOfIn(text) ?? context.asOf;
    context.productModelCode =
      productModelCodeIn(text) ?? context.productModelCode;
  }

  return context;
}
