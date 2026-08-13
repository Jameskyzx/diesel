import "server-only";

import type {
  AiToolName,
  AiToolResult,
} from "@/features/ai/schemas";
import {
  buildConversationBusinessContext,
  countryIso3sIn,
} from "@/server/ai/conversation-context";
import { currentUtcDate } from "@/server/ai/tool-results";

type EvidenceQueryExpectation = {
  applicationScope?: string | null;
  asOf?: string | null;
  countryIso3s?: readonly (string | null)[];
  powerKw?: number;
  productModelCode?: string | null;
  targetCountryIso3?: string;
};

type EvidenceRequirement = {
  acceptedTools: readonly AiToolName[];
  query: EvidenceQueryExpectation;
  requiredProfileTopics?: readonly ("country" | "market" | "regulations")[];
};

export type SalesChatEvidenceContract = {
  applicationScope: string | null;
  asOf: string | null;
  countryIso3s: string[];
  missingRequiredParameters: string[];
  powerKw: number | null;
  productModelCode: string | null;
  requirements: EvidenceRequirement[];
  requiresRegulatoryDisclaimer: boolean;
  targetCountryIso3: string | null;
};

const productFitIntentPattern =
  /(?:产品适配|适配产品|兼容产品|产品推荐|推荐.{0,6}(?:产品|型号)|型号.{0,8}(?:适配|匹配|兼容|能用|合规|认证)|(?:产品|发动机).{0,8}(?:适配|匹配|兼容|能用|合规|认证)|product\s*(?:fit|compatib))/iu;
const regulationIntentPattern =
  /(?:法规|排放|限值|监管|合规|认证|标准|生效|采纳|已取代|effective|adopted|proposed|superseded|regulation|emission|certification)/iu;
const productComplianceIntentPattern =
  /(?:适配|匹配|兼容|能用|合规|认证|fit|compatible|compliant|certification)/iu;
const marketIntentPattern =
  /(?:市场|销量|销售额|市场规模|市场份额|市场指标|market|sales\s+volume)/iu;
const comparisonIntentPattern =
  /(?:比较|对比|差异|哪个(?:国家|市场)|vs\.?|versus|compare)/iu;
const sourceIntentPattern =
  /(?:原文|公告|出处|来源|页码|章节|依据|source|citation|原始文件)/iu;
const opportunityScoreIntentPattern =
  /(?:机会分|机会评分|市场机会排名|销售优先级|opportunity\s+score)/iu;
const salesBriefIntentPattern =
  /(?:销售简报|销售策略|sales\s+brief|sales\s+strategy)/iu;
const intentClauseBoundaryPattern =
  /(?:[,，。;；\n]+|并且?|同时|然后|再|\b(?:and|then)\b)/giu;

function uniqueCountries(countries: readonly string[]): string[] {
  return Array.from(new Set(countries));
}

function intentClauses(text: string, intentPattern: RegExp): string[] {
  return text
    .split(intentClauseBoundaryPattern)
    .filter((clause) => intentPattern.test(clause));
}

function countriesInIntentClauses(text: string, intentPattern: RegExp): string[] {
  return uniqueCountries(
    intentClauses(text, intentPattern).flatMap((clause) =>
      countryIso3sIn(clause),
    ),
  );
}

function powerKwsIn(text: string): number[] {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*(?:kw|千瓦)/giu)).map(
        (match) => Number(match[1]),
      ),
    ),
  );
}

function powerKwsInIntentClauses(text: string, intentPattern: RegExp): number[] {
  return Array.from(
    new Set(
      intentClauses(text, intentPattern).flatMap((clause) =>
        powerKwsIn(clause),
      ),
    ),
  );
}

/**
 * Builds a fail-closed evidence contract from the validated user text captured
 * before attachment extraction. Unverified attachment text therefore never
 * enters intent or parameter inference.
 */
export function buildSalesChatEvidenceContract(input: {
  selectedCountryIso3: string | null;
  userTexts: readonly string[];
}): SalesChatEvidenceContract {
  const userTexts = input.userTexts
    .map((text) => text.trim())
    .filter((text) => text.length > 0);
  const latestUserText = userTexts.at(-1) ?? "";
  const context = buildConversationBusinessContext(userTexts, {
    selectedCountryIso3: input.selectedCountryIso3,
  });
  const asksForProductFit =
    productFitIntentPattern.test(latestUserText) ||
    (context.productModelCode !== null &&
      productComplianceIntentPattern.test(latestUserText));
  const asksForRegulation = regulationIntentPattern.test(latestUserText);
  const asksForMarket = marketIntentPattern.test(latestUserText);
  const asksForComparison = comparisonIntentPattern.test(latestUserText);
  const asksForSource = sourceIntentPattern.test(latestUserText);
  const asksForOpportunityScore = opportunityScoreIntentPattern.test(
    latestUserText,
  );
  const asksForSalesBrief = salesBriefIntentPattern.test(latestUserText);
  const activeTask =
    asksForSalesBrief || asksForOpportunityScore || asksForProductFit ||
    asksForRegulation || asksForMarket || asksForSource
      ? null
      : context.activeTask;
  const requirements: EvidenceRequirement[] = [];
  const missingRequiredParameters = new Set<string>();
  const asOf = context.asOf ?? currentUtcDate();
  const addMissing = (condition: boolean, parameter: string) => {
    if (condition) {
      missingRequiredParameters.add(parameter);
    }
  };
  const productCountriesFromLatest = countriesInIntentClauses(
    latestUserText,
    productFitIntentPattern,
  );
  const productCountries =
    productCountriesFromLatest.length > 0
      ? productCountriesFromLatest
      : context.focusedCountryIso3
        ? [context.focusedCountryIso3]
        : [];
  const productPowerKwsFromLatest = powerKwsInIntentClauses(
    latestUserText,
    productFitIntentPattern,
  );
  const productPowerKws =
    productPowerKwsFromLatest.length > 0
      ? productPowerKwsFromLatest
      : context.powerKw === null
        ? []
        : [context.powerKw];
  const regulationCountriesFromLatest = countriesInIntentClauses(
    latestUserText,
    regulationIntentPattern,
  );
  const marketCountriesFromLatest = countriesInIntentClauses(
    latestUserText,
    marketIntentPattern,
  );
  const sourceCountriesFromLatest = countriesInIntentClauses(
    latestUserText,
    sourceIntentPattern,
  );

  if (asksForSalesBrief || activeTask === "sales_brief") {
    addMissing(context.countryIso3s.length < 2, "countryIso3s");
    addMissing(context.applicationScope === null, "applicationScope");
    addMissing(context.powerKw === null, "powerKw");
    addMissing(powerKwsIn(latestUserText).length > 1, "powerKw");
    addMissing(context.targetCountryIso3 === null, "targetCountryIso3");
    requirements.push({
      acceptedTools: ["generateSalesBrief"],
      query: {
        applicationScope: context.applicationScope,
        asOf,
        countryIso3s: context.countryIso3s,
        ...(context.powerKw === null ? {} : { powerKw: context.powerKw }),
        productModelCode: context.productModelCode,
        ...(context.targetCountryIso3 === null
          ? {}
          : { targetCountryIso3: context.targetCountryIso3 }),
      },
    });
  } else if (
    asksForOpportunityScore ||
    activeTask === "opportunity_score"
  ) {
    addMissing(context.countryIso3s.length < 2, "countryIso3s");
    addMissing(context.applicationScope === null, "applicationScope");
    addMissing(context.powerKw === null, "powerKw");
    addMissing(powerKwsIn(latestUserText).length > 1, "powerKw");
    requirements.push({
      acceptedTools: ["calculateOpportunityScore"],
      query: {
        applicationScope: context.applicationScope,
        asOf,
        countryIso3s: context.countryIso3s,
        ...(context.powerKw === null ? {} : { powerKw: context.powerKw }),
        productModelCode: context.productModelCode,
      },
    });
  } else {
    if (asksForProductFit || activeTask === "product_fit") {
      addMissing(productCountries.length === 0, "countryIso3");
      addMissing(context.applicationScope === null, "applicationScope");
      addMissing(productPowerKws.length === 0, "powerKw");
      for (const countryIso3 of productCountries.length > 0
        ? productCountries
        : [null]) {
        for (const powerKw of productPowerKws.length > 0
          ? productPowerKws
          : [null]) {
          requirements.push({
            acceptedTools: ["findCompatibleProducts"],
            query: {
              applicationScope: context.applicationScope,
              asOf,
              countryIso3s: [countryIso3],
              ...(powerKw === null ? {} : { powerKw }),
              productModelCode: context.productModelCode,
            },
          });
        }
      }
    }

    if (asksForSource || activeTask === "knowledge") {
      const sourceCountries =
        sourceCountriesFromLatest.length > 0
          ? sourceCountriesFromLatest
          : context.focusedCountryIso3
            ? [context.focusedCountryIso3]
            : [null];
      for (const countryIso3 of sourceCountries) {
        requirements.push({
          acceptedTools: ["searchKnowledgeBase"],
          query: {
            applicationScope: context.applicationScope,
            asOf,
            countryIso3s: [countryIso3],
          },
        });
      }
    } else if (
      asksForRegulation ||
      activeTask === "regulation_compare" ||
      activeTask === "country_profile"
    ) {
      const isRegulationComparison =
        asksForComparison || activeTask === "regulation_compare";
      const regulationCountries =
        regulationCountriesFromLatest.length > 0
          ? regulationCountriesFromLatest
          : context.countryIso3s;
      if (isRegulationComparison) {
        const regulationPowerKwsFromLatest = powerKwsInIntentClauses(
          latestUserText,
          regulationIntentPattern,
        );
        const regulationPowerKws =
          regulationPowerKwsFromLatest.length > 0
            ? regulationPowerKwsFromLatest
            : context.powerKw === null
              ? []
              : [context.powerKw];
        addMissing(regulationCountries.length < 2, "countryIso3s");
        addMissing(context.applicationScope === null, "applicationScope");
        addMissing(regulationPowerKws.length === 0, "powerKw");
        for (const powerKw of regulationPowerKws.length > 0
          ? regulationPowerKws
          : [null]) {
          requirements.push({
            acceptedTools: ["compareRegulations"],
            query: {
              applicationScope: context.applicationScope,
              asOf,
              countryIso3s: regulationCountries,
              ...(powerKw === null ? {} : { powerKw }),
            },
          });
        }
      } else {
        const singleCountryRegulations =
          regulationCountriesFromLatest.length > 0
            ? regulationCountriesFromLatest
            : context.focusedCountryIso3
              ? [context.focusedCountryIso3]
              : [];
        addMissing(singleCountryRegulations.length === 0, "countryIso3");
        for (const countryIso3 of singleCountryRegulations.length > 0
          ? singleCountryRegulations
          : [null]) {
          requirements.push({
            acceptedTools:
              activeTask === "country_profile" && !asksForRegulation
                ? ["getCountryProfile"]
                : asksForProductFit
                  ? [
                      "getCountryProfile",
                      "searchKnowledgeBase",
                      "findCompatibleProducts",
                    ]
                  : ["getCountryProfile", "searchKnowledgeBase"],
            query: {
              applicationScope: context.applicationScope,
              asOf,
              countryIso3s: [countryIso3],
              ...(context.powerKw === null ? {} : { powerKw: context.powerKw }),
              ...(asksForProductFit
                ? { productModelCode: context.productModelCode }
                : {}),
            },
            requiredProfileTopics:
              activeTask === "country_profile" && !asksForRegulation
                ? context.profileTopics
                : ["regulations"],
          });
        }
      }
    }

    if (asksForMarket || activeTask === "market_compare") {
      const isMarketComparison =
        asksForComparison || activeTask === "market_compare";
      const marketCountries =
        marketCountriesFromLatest.length > 0
          ? marketCountriesFromLatest
          : context.countryIso3s;
      if (isMarketComparison) {
        addMissing(marketCountries.length < 2, "countryIso3s");
        requirements.push({
          acceptedTools: ["compareMarkets"],
          query: {
            applicationScope: context.applicationScope,
            countryIso3s: marketCountries,
          },
        });
      } else {
        const singleCountryMarkets =
          marketCountriesFromLatest.length > 0
            ? marketCountriesFromLatest
            : context.focusedCountryIso3
              ? [context.focusedCountryIso3]
              : [];
        addMissing(singleCountryMarkets.length === 0, "countryIso3");
        for (const countryIso3 of singleCountryMarkets.length > 0
          ? singleCountryMarkets
          : [null]) {
          requirements.push({
            acceptedTools: ["getCountryProfile"],
            query: { asOf, countryIso3s: [countryIso3] },
            requiredProfileTopics: ["market"],
          });
        }
      }
    }
  }

  return {
    applicationScope: context.applicationScope,
    asOf,
    countryIso3s: context.countryIso3s,
    missingRequiredParameters: Array.from(missingRequiredParameters),
    powerKw: context.powerKw,
    productModelCode: context.productModelCode,
    requirements,
    requiresRegulatoryDisclaimer:
      asksForRegulation ||
      asksForProductFit ||
      asksForSalesBrief ||
      activeTask === "product_fit" ||
      activeTask === "regulation_compare" ||
      activeTask === "sales_brief" ||
      (activeTask === "country_profile" &&
        context.profileTopics.includes("regulations")) ||
      (activeTask === "knowledge" &&
        userTexts.slice(0, -1).some((text) =>
          regulationIntentPattern.test(text),
        )),
    targetCountryIso3: context.targetCountryIso3,
  };
}

type ResultQuery = {
  applicationScope?: string | null;
  asOf?: string | null;
  countryIso3s?: readonly (string | null)[];
  powerKw?: number;
  productModelCode?: string;
  targetCountryIso3?: string;
};

function resultQuery(result: AiToolResult): ResultQuery {
  if (result.tool === "searchKnowledgeBase") {
    return {
      applicationScope: result.search.filters.applicationScope,
      asOf: result.search.filters.asOf,
      countryIso3s: [result.resolvedCountryIso3],
    };
  }
  if (result.tool === "getCountryProfile") {
    return {
      asOf: result.informationAsOf,
      countryIso3s: [result.resolvedCountryIso3],
    };
  }
  if (result.tool === "findCompatibleProducts") {
    return {
      applicationScope: result.query.applicationScope,
      asOf: result.query.asOf,
      countryIso3s: [result.query.countryIso3],
      powerKw: result.query.powerKw,
      productModelCode: result.query.productModelCode,
    };
  }
  if (result.tool === "compareRegulations") {
    return {
      applicationScope: result.comparison.query.applicationScope,
      asOf: result.comparison.query.asOf,
      countryIso3s: result.comparison.query.countryIso3s,
      powerKw: result.comparison.query.powerKw,
    };
  }
  if (result.tool === "compareMarkets") {
    return {
      applicationScope: result.comparison.query.applicationScope,
      countryIso3s: result.comparison.query.countryIso3s,
    };
  }
  if (result.tool === "calculateOpportunityScore") {
    return {
      applicationScope: result.scorecard.query.applicationScope,
      asOf: result.scorecard.query.asOf,
      countryIso3s: result.scorecard.query.countryIso3s,
      powerKw: result.scorecard.query.powerKw,
      productModelCode: result.scorecard.query.productModelCode,
    };
  }

  return {
    applicationScope: result.brief.query.applicationScope,
    asOf: result.brief.query.asOf,
    countryIso3s: result.brief.query.countryIso3s,
    powerKw: result.brief.query.powerKw,
    productModelCode: result.brief.query.productModelCode,
    targetCountryIso3: result.brief.query.targetCountryIso3,
  };
}

function sameCountrySet(
  actual: readonly (string | null)[],
  expected: readonly (string | null)[],
) {
  return (
    actual.length === expected.length &&
    actual.every((countryIso3) => expected.includes(countryIso3))
  );
}

function queryMatchesExpectation(
  expectation: EvidenceQueryExpectation,
  result: AiToolResult,
): boolean {
  const query = resultQuery(result);

  if (expectation.countryIso3s !== undefined) {
    if (query.countryIso3s === undefined) {
      return false;
    }
    if (!sameCountrySet(query.countryIso3s, expectation.countryIso3s)) {
      return false;
    }
  }
  if (
    Object.hasOwn(expectation, "applicationScope") &&
    query.applicationScope !== undefined &&
    query.applicationScope !== expectation.applicationScope
  ) {
    return false;
  }
  if (
    Object.hasOwn(expectation, "asOf") &&
    query.asOf !== undefined &&
    query.asOf !== expectation.asOf
  ) {
    return false;
  }
  if (
    Object.hasOwn(expectation, "powerKw") &&
    query.powerKw !== undefined &&
    query.powerKw !== expectation.powerKw
  ) {
    return false;
  }
  if (Object.hasOwn(expectation, "productModelCode") &&
    (result.tool === "findCompatibleProducts" ||
      result.tool === "calculateOpportunityScore" ||
      result.tool === "generateSalesBrief")
  ) {
    if (expectation.productModelCode === null) {
      if (query.productModelCode !== undefined) {
        return false;
      }
    } else if (
      query.productModelCode === undefined ||
      query.productModelCode.toUpperCase() !==
        expectation.productModelCode?.toUpperCase()
    ) {
      return false;
    }
  }
  if (
    Object.hasOwn(expectation, "targetCountryIso3") &&
    query.targetCountryIso3 !== undefined &&
    query.targetCountryIso3 !== expectation.targetCountryIso3
  ) {
    return false;
  }

  return true;
}

function resultSatisfiesRequirement(
  requirement: EvidenceRequirement,
  result: AiToolResult,
): boolean {
  if (!requirement.acceptedTools.includes(result.tool)) {
    return false;
  }
  if (!queryMatchesExpectation(requirement.query, result)) {
    return false;
  }
  if (
    result.tool === "getCountryProfile" &&
    requirement.requiredProfileTopics &&
    !requirement.requiredProfileTopics.every((topic) =>
      result.requestedTopics.includes(topic),
    )
  ) {
    return false;
  }

  return true;
}

/** A sufficient result is usable only when its tool and visible query match. */
export function evidenceContractAllowsModelText(
  contract: SalesChatEvidenceContract,
  results: readonly AiToolResult[],
): boolean {
  const sufficientResults = results.filter(
    (result) => result.status === "ok" && result.evidenceSufficient,
  );
  if (sufficientResults.length === 0) {
    return false;
  }
  if (contract.requirements.length === 0) {
    return false;
  }
  if (contract.missingRequiredParameters.length > 0) {
    return false;
  }

  return (
    contract.requirements.every((requirement) =>
      sufficientResults.some((result) =>
        resultSatisfiesRequirement(requirement, result),
      ),
    ) &&
    sufficientResults.every((result) =>
      contract.requirements.some((requirement) =>
        resultSatisfiesRequirement(requirement, result),
      ),
    )
  );
}

export function evidenceNeedsRegulatoryDisclaimer(
  contract: SalesChatEvidenceContract,
  results: readonly AiToolResult[],
): boolean {
  if (contract.requiresRegulatoryDisclaimer) {
    return true;
  }

  return results.some((result) => {
    if (
      result.tool === "findCompatibleProducts" ||
      result.tool === "compareRegulations" ||
      result.tool === "calculateOpportunityScore" ||
      result.tool === "generateSalesBrief"
    ) {
      return true;
    }
    return (
      result.tool === "getCountryProfile" &&
      result.requestedTopics.includes("regulations")
    );
  });
}
