import "server-only";
import { maskKnowledgeQueryLiterals } from "@/domain/knowledge/query-literal-spans";

import { countryDetailResponseMatchesDeterministicRules } from "@/domain/countries/detail-consistency";
import { buildKnowledgeRequestContext, knowledgeQuerySatisfies, knowledgeTermsIn } from "@/server/ai/knowledge-request-context";
import { knowledgeDeliverySatisfied, type KnowledgeDeliveryRequirements } from "@/domain/knowledge/delivery";
export { knowledgeTermsIn, knowledgeTermsMatch } from "@/server/ai/knowledge-request-context";
import {
  aiKnowledgeSearchResultMatchesDeterministicRules,
  aiKnowledgeSearchUsesCanonicalNarrowing,
} from "@/domain/knowledge/search-consistency";
import {
  marketComparisonMatchesDeterministicRules,
  regulationComparisonMatchesDeterministicRules,
} from "@/domain/marketing/comparison-consistency";
import { opportunityScorecardMatchesTrustedProvenance } from "@/domain/marketing/analysis-provenance";
import { salesBriefMatchesDeterministicRules } from "@/domain/marketing/sales-brief-consistency";
import { productFitEvaluationMatchesDeterministicRules } from "@/domain/product-fit/evaluation-consistency";
import {
  aiToolNames,
  type AiToolName,
  type AiToolResult,
} from "@/features/ai/schemas";
import {
  aiEvidenceCitationsMatchFacts,
  compatibleProductPayloadMatchesQuery,
  countryProfilePayloadMatchesQuery,
  expectedAiEvidenceSufficiency,
} from "@/features/ai/evidence-semantics";
import {
  aiToolResultWarningsMatchFacts,
  canonicalToolErrorResultMatchesNoFacts,
} from "@/features/ai/tool-result-envelope";
import { metricCodeSchema } from "@/features/marketing/schemas";
import type { CountryDetailResponse } from "@/features/countries/schemas";
import {
  activeConversationTaskIn,
  buildConversationBusinessContext,
  countryIso3sIn,
  countryMentionsIn,
  hasConversationComparisonIntent,
  hasExplicitSourceIntent,
  type ActiveConversationTask,
} from "@/server/ai/conversation-context";
import {
  captureChatRuntimeContext,
  chatRuntimeContextSchema,
  type ChatRuntimeContext,
} from "@/domain/ai/chat-runtime-context";

type EvidenceQueryExpectation = {
  applicationScope?: string | null;
  asOf?: string | null;
  countryIso3s?: readonly (string | null)[];
  // Consumed asynchronously by the production tool-call guard. The synchronous
  // DTO gate below still checks terms/metadata, not PostgreSQL query semantics.
  knowledgeQuery?: string;
  knowledgeTerms?: readonly string[];
  knowledgeOptionalTerms?: readonly string[];
  knowledgeDelivery?: KnowledgeDeliveryRequirements;
  metricCodes?: readonly string[];
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
  blocksModelText: boolean;
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
const standaloneRegulationIntentPattern =
  /(?:法规|排放|限值|监管|标准|生效|采纳|已取代|effective|adopted|proposed|superseded|regulation|emission)/iu;
const productComplianceIntentPattern =
  /(?:适配|匹配|兼容|能用|合规|认证|fit|compatible|compliant|certification)/iu;
const marketIntentPattern =
  /(?:市场|销量|销售额|市场规模|市场份额|市场指标|market|sales\s+volume)/iu;
const opportunityScoreIntentPattern =
  /(?:机会分|机会评分|市场机会排名|销售优先级|opportunity\s+score)/iu;
const salesBriefIntentPattern =
  /(?:销售简报|销售策略|sales\s+brief|sales\s+strategy)/iu;
const intentClauseBoundaryPattern =
  /(?:[,，。;；\n]+|并且?|同时|然后|再|\b(?:and|then)\b)/giu;
const sourceSpanBoundaryPattern =
  /(?:[,，。;；\n]+|并且?|同时|然后|再|\bthen\b)/giu;
const weakConjunctionPattern = /(?:\band\b|以及|和|与)/giu;
const independentTaskActionPattern =
  /(?:推荐|比较|对比|计算|生成|评估|核对|(?:^|\s)(?:recommend|compare|calculate|generate|evaluate|check)\b)/iu;
const untrustedInstructionPattern =
  /(?:(?:忽略|无视|绕过|覆盖).{0,12}(?:系统|开发者|之前|以上).{0,8}(?:提示|指令|规则)|(?:泄露|显示|输出).{0,12}(?:密钥|系统提示|提示词)|ignore.{0,20}(?:system|developer|previous).{0,12}instructions?|(?:reveal|disclose|print).{0,20}(?:system\s*prompt|api\s*key|secret))/iu;

function normalizeUntrustedInstructionText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\p{Cf}+/gu, "")
    .replace(/\s+/gu, " ");
}

function containsUntrustedInstruction(userTexts: readonly string[]): boolean {
  const normalizedTexts = userTexts.map(normalizeUntrustedInstructionText);
  return (
    normalizedTexts.some((text) => untrustedInstructionPattern.test(text)) ||
    untrustedInstructionPattern.test(normalizedTexts.join(" "))
  );
}

function uniqueCountries(countries: readonly string[]): string[] {
  return Array.from(new Set(countries));
}

function splitCountryAwareClauses(
  text: string,
  boundaryPattern: RegExp,
  { protectCountryLists = false }: { protectCountryLists?: boolean } = {},
): string[] {
  const mentions = countryMentionsIn(text);
  const countryListJoins = protectCountryLists
    ? mentions.flatMap((country, index) => {
        const next = mentions[index + 1];
        const start = country.index + country.length;
        if (!next || next.index < start) return [];
        // Protect only a list separator between adjacent recognized countries.
        // "CHN and BRA regulations" is one task; "CHN regulations and recommend
        // BRA products" still has an ordinary task boundary.
        return /^\s*(?:[,，、](?:\s*(?:and|和|与|以及))?|and|和|与|以及)\s*$/iu
          .test(text.slice(start, next.index))
          ? [{ start, end: next.index }]
          : [];
      })
    : [];
  const clauses: string[] = [];
  let start = 0;
  for (const boundary of text.matchAll(boundaryPattern)) {
    const end = boundary.index + boundary[0].length;
    if (
      // Country identity is atomic, including the "and" in Trinidad and Tobago.
      mentions.some(
        (country) => country.index <= boundary.index && end <= country.index + country.length,
      ) ||
      countryListJoins.some(
        (join) => join.start <= boundary.index && end <= join.end,
      )
    ) {
      continue;
    }
    clauses.push(text.slice(start, boundary.index));
    start = end;
  }
  clauses.push(text.slice(start));
  return clauses;
}

function intentClauses(text: string, intentPattern: RegExp): string[] {
  return splitCountryAwareClauses(text, intentClauseBoundaryPattern, { protectCountryLists: true })
    .filter((clause) => intentPattern.test(clause));
}

function hasStandaloneRegulationIntent(
  text: string,
  asksForProductFit: boolean,
): boolean {
  return intentClauses(text, standaloneRegulationIntentPattern).some(
    (clause) =>
      !asksForProductFit || activeConversationTaskIn(clause) !== "product_fit",
  );
}

function countriesInIntentClauses(text: string, intentPattern: RegExp): string[] {
  return uniqueCountries(
    intentClauses(text, intentPattern).flatMap((clause) =>
      countryIso3sIn(clause),
    ),
  );
}

function countriesInExplicitSourceSpans(text: string): string[] {
  const metadataText = maskKnowledgeQueryLiterals(text);
  if (!hasExplicitSourceIntent(metadataText) && hasExplicitSourceIntent(text)) {
    return countryIso3sIn(metadataText);
  }
  return uniqueCountries(
    splitCountryAwareClauses(metadataText, sourceSpanBoundaryPattern).flatMap((span) => {
      const clauses = splitCountryAwareClauses(span, weakConjunctionPattern);
      const sourceClauseIndexes = clauses.flatMap((clause, index) =>
        hasExplicitSourceIntent(clause) ? [index] : [],
      );

      return sourceClauseIndexes.flatMap((sourceClauseIndex) => {
        let start = sourceClauseIndex;
        while (
          start > 0 &&
          !hasExplicitSourceIntent(clauses[start - 1] ?? "") &&
          !independentTaskActionPattern.test(clauses[start - 1] ?? "")
        ) {
          start -= 1;
        }

        let end = sourceClauseIndex + 1;
        while (
          end < clauses.length &&
          !hasExplicitSourceIntent(clauses[end] ?? "") &&
          !independentTaskActionPattern.test(clauses[end] ?? "")
        ) {
          end += 1;
        }

        return countryIso3sIn(clauses.slice(start, end).join(" "));
      });
    }),
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

type MetricEvidenceTask = Extract<
  ActiveConversationTask,
  "market_compare" | "opportunity_score" | "sales_brief"
>;

function isMetricEvidenceTask(
  task: ActiveConversationTask,
): task is MetricEvidenceTask {
  return (
    task === "market_compare" ||
    task === "opportunity_score" ||
    task === "sales_brief"
  );
}

function metricCodesIn(text: string): string[] {
  const trustedText = text
    .replace(/\b(?:https?|ftp):\/\/\S+/giu, " ")
    .replace(/\b[^\s@]+@[^\s@]+\b/gu, " ");
  const candidates = trustedText.match(/[A-Za-z0-9_:-]+/gu) ?? [];
  const metricCodes = candidates.flatMap((candidate) => {
    const token = candidate.replace(/^:+|:+$/gu, "");
    if (
      token.length === 0 ||
      !/[A-Za-z]/u.test(token) ||
      (!token.includes("_") && !token.includes(":")) ||
      !/^[A-Za-z0-9].*[A-Za-z0-9]$/u.test(token)
    ) {
      return [];
    }
    const parsed = metricCodeSchema.safeParse(token);
    return parsed.success ? [parsed.data] : [];
  });
  return Array.from(new Set(metricCodes));
}

/** Shared by the evidence boundary and offline Demo; codes stay task-scoped. */
export function metricCodesByTask(
  userTexts: readonly string[],
): Partial<Record<MetricEvidenceTask, readonly string[]>> {
  const metricCodes: Partial<
    Record<MetricEvidenceTask, readonly string[]>
  > = {};
  let activeTask: ActiveConversationTask | null = null;

  for (const text of userTexts) {
    activeTask = activeConversationTaskIn(text) ?? activeTask;
    const codes = metricCodesIn(text);
    if (
      codes.length > 0 &&
      activeTask !== null &&
      isMetricEvidenceTask(activeTask)
    ) {
      metricCodes[activeTask] = codes;
    }
  }
  return metricCodes;
}

/**
 * Builds a fail-closed evidence contract from the validated user text captured
 * before attachment extraction. Unverified attachment text therefore never
 * enters intent or parameter inference.
 */
export function buildSalesChatEvidenceContract(input: {
  runtimeContext?: ChatRuntimeContext;
  selectedCountryIso3: string | null;
  userTexts: readonly string[];
}): SalesChatEvidenceContract {
  const runtimeContext = chatRuntimeContextSchema.parse(
    input.runtimeContext ?? captureChatRuntimeContext(),
  );
  const userTexts = input.userTexts
    .map((text) => text.trim())
    .filter((text) => text.length > 0);
  const latestUserText = userTexts.at(-1) ?? "";
  const context = buildConversationBusinessContext(userTexts, {
    selectedCountryIso3: input.selectedCountryIso3,
  });
  const metricCodes = metricCodesByTask(userTexts);
  const asksForProductFit =
    productFitIntentPattern.test(latestUserText) ||
    (context.productModelCode !== null &&
      productComplianceIntentPattern.test(latestUserText));
  const asksForRegulation =
    hasStandaloneRegulationIntent(latestUserText, asksForProductFit) ||
    (!asksForProductFit && regulationIntentPattern.test(latestUserText));
  const asksForMarket = marketIntentPattern.test(latestUserText);
  const asksForComparison = hasConversationComparisonIntent(latestUserText);
  const asksForSource = hasExplicitSourceIntent(latestUserText);
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
  const asOf = context.asOf ?? runtimeContext.utcDate;
  const addMissing = (condition: boolean, parameter: string) => {
    if (condition) {
      missingRequiredParameters.add(parameter);
    }
  };
  // A conflicting/excluded scope is not the same as an absent optional filter,
  // including on source-only requests where unscoped retrieval is otherwise valid.
  addMissing(context.hasScopeConflict, "applicationScope");
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
  const sourceCountriesFromLatest = countriesInExplicitSourceSpans(
    latestUserText,
  );
  const addKnowledgeRequirement = () => {
    const knowledgeContext = buildKnowledgeRequestContext(userTexts, context);
    addMissing(knowledgeContext.requiresRestatement, "knowledgeQuery");
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
          knowledgeQuery: knowledgeContext.query,
          knowledgeTerms: knowledgeContext.terms,
          knowledgeOptionalTerms: knowledgeContext.optionalTerms,
          knowledgeDelivery: knowledgeContext.delivery,
        },
      });
    }
  };

  if (asksForSource) {
    addKnowledgeRequirement();
  } else if (asksForSalesBrief || activeTask === "sales_brief") {
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
        ...(metricCodes.sales_brief === undefined
          ? {}
          : { metricCodes: metricCodes.sales_brief }),
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
        ...(metricCodes.opportunity_score === undefined
          ? {}
          : { metricCodes: metricCodes.opportunity_score }),
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

    if (activeTask === "knowledge") {
      addKnowledgeRequirement();
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
        const hasApplicationScope = context.applicationScope !== null;
        const hasPower = context.powerKw !== null;
        const hasPartialApplicabilityQuery =
          hasApplicationScope !== hasPower;
        addMissing(singleCountryRegulations.length === 0, "countryIso3");
        addMissing(
          hasPartialApplicabilityQuery && !hasApplicationScope,
          "applicationScope",
        );
        addMissing(
          hasPartialApplicabilityQuery && !hasPower,
          "powerKw",
        );
        for (const countryIso3 of singleCountryRegulations.length > 0
          ? singleCountryRegulations
          : [null]) {
          const hasExactRegulationFilters =
            hasApplicationScope && hasPower;
          requirements.push({
            acceptedTools:
              hasExactRegulationFilters
                ? ["compareRegulations"]
                : activeTask === "country_profile" && !asksForRegulation
                  ? ["getCountryProfile"]
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
            ...(hasExactRegulationFilters
              ? {}
              : {
                  requiredProfileTopics:
                    activeTask === "country_profile" && !asksForRegulation
                      ? context.profileTopics
                      : (["regulations"] as const),
                }),
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
            ...(metricCodes.market_compare === undefined
              ? {}
              : { metricCodes: metricCodes.market_compare }),
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
        // A country profile exposes broad market metrics and cannot prove that
        // they were filtered to a requested application scope. Keep the turn
        // fail closed until the user either removes that scope or supplies a
        // comparison country for the scope-aware compareMarkets tool.
        addMissing(
          context.applicationScope !== null,
          "marketApplicationScopeFilter",
        );
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
    // Every retained user turn is sent back to the provider. An injection in
    // an earlier turn therefore remains active even when the latest follow-up
    // is only "continue", and its trigger can be split across adjacent turns.
    // Check both the individual messages and the same retained history joined
    // with a neutral boundary; attachment text is intentionally absent here.
    blocksModelText: containsUntrustedInstruction(userTexts),
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
  knowledgeTerms?: readonly string[];
  metricCodes?: readonly string[];
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
      knowledgeTerms: knowledgeTermsIn(
        result.search.query,
        result.resolvedCountryIso3 === null
          ? []
          : [result.resolvedCountryIso3],
      ),
    };
  }
  if (result.tool === "getCountryProfile") {
    return {
      applicationScope: null,
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
      applicationScope:
        result.comparison.query.applicationScope ?? null,
      countryIso3s: result.comparison.query.countryIso3s,
      metricCodes: result.comparison.query.metricCodes,
    };
  }
  if (result.tool === "calculateOpportunityScore") {
    return {
      applicationScope: result.scorecard.query.applicationScope,
      asOf: result.scorecard.query.asOf,
      countryIso3s: result.scorecard.query.countryIso3s,
      metricCodes: result.scorecard.query.metricCodes,
      powerKw: result.scorecard.query.powerKw,
      productModelCode: result.scorecard.query.productModelCode,
    };
  }

  return {
    applicationScope: result.brief.query.applicationScope,
    asOf: result.brief.query.asOf,
    countryIso3s: result.brief.query.countryIso3s,
    metricCodes: result.brief.query.metricCodes,
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

function sameUniqueMetricCodeSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  const actualCodes = new Set(actual);
  const expectedCodes = new Set(expected);
  return (
    actualCodes.size === actual.length &&
    expectedCodes.size === expected.length &&
    actualCodes.size === expectedCodes.size &&
    [...actualCodes].every((metricCode) => expectedCodes.has(metricCode))
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
  if (!knowledgeQuerySatisfies(expectation.knowledgeTerms, query.knowledgeTerms, expectation.knowledgeOptionalTerms)) return false;
  if (expectation.knowledgeDelivery !== undefined &&
    (result.tool !== "searchKnowledgeBase" || !knowledgeDeliverySatisfied(expectation.knowledgeDelivery, result))) return false;
  if (
    Object.hasOwn(expectation, "metricCodes") &&
    (query.metricCodes === undefined ||
      expectation.metricCodes === undefined ||
      !sameUniqueMetricCodeSet(
        query.metricCodes,
        expectation.metricCodes,
      ))
  ) {
    return false;
  }
  if (
    Object.hasOwn(expectation, "applicationScope") &&
    (!Object.hasOwn(query, "applicationScope") ||
      query.applicationScope !== expectation.applicationScope)
  ) {
    return false;
  }
  if (
    Object.hasOwn(expectation, "asOf") &&
    (!Object.hasOwn(query, "asOf") || query.asOf !== expectation.asOf)
  ) {
    return false;
  }
  if (
    Object.hasOwn(expectation, "powerKw") &&
    (!Object.hasOwn(query, "powerKw") ||
      query.powerKw !== expectation.powerKw)
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
    (!Object.hasOwn(query, "targetCountryIso3") ||
      query.targetCountryIso3 !== expectation.targetCountryIso3)
  ) {
    return false;
  }

  return true;
}

function resultSatisfiesRequirement(
  requirement: EvidenceRequirement,
  result: AiToolResult,
): boolean {
  if (
    !aiEvidenceCitationsMatchFacts(result) ||
    !resultMatchesDeterministicRules(result) ||
    result.evidenceSufficient !==
      expectedAiEvidenceSufficiency(result) ||
    (result.tool === "getCountryProfile" &&
      !countryProfilePayloadMatchesQuery(result)) ||
    (result.tool === "findCompatibleProducts" &&
      !compatibleProductPayloadMatchesQuery(result))
  ) {
    return false;
  }
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

function resultMatchesDeterministicRules(result: AiToolResult): boolean {
  try {
    if (
      !aiToolResultWarningsMatchFacts(result) ||
      !canonicalToolErrorResultMatchesNoFacts(result)
    ) {
      return false;
    }
    if (result.status === "error") {
      return true;
    }
    if (result.tool === "searchKnowledgeBase") {
      return (
        aiKnowledgeSearchResultMatchesDeterministicRules(result) &&
        aiKnowledgeSearchUsesCanonicalNarrowing(result)
      );
    }
    if (result.tool === "findCompatibleProducts") {
      return result.evaluations.every(
        productFitEvaluationMatchesDeterministicRules,
      );
    }
    if (result.tool === "getCountryProfile") {
      return (
        result.profile === null ||
        countryDetailResponseMatchesDeterministicRules(
          result.profile as CountryDetailResponse,
        )
      );
    }
    if (result.tool === "compareRegulations") {
      return regulationComparisonMatchesDeterministicRules(result.comparison);
    }
    if (result.tool === "compareMarkets") {
      return marketComparisonMatchesDeterministicRules(result.comparison);
    }
    if (result.tool === "calculateOpportunityScore") {
      return opportunityScorecardMatchesTrustedProvenance(
        result.scorecard,
      );
    }
    if (result.tool === "generateSalesBrief") {
      return salesBriefMatchesDeterministicRules(result.brief);
    }
    return true;
  } catch {
    return false;
  }
}

/** Returns only tools that can satisfy requirements not yet covered. */
export function remainingEvidenceTools(
  contract: SalesChatEvidenceContract,
  results: readonly AiToolResult[],
): AiToolName[] {
  if (contract.missingRequiredParameters.length > 0) {
    return [];
  }

  const sufficientResults = results.filter(
    (result) => result.status === "ok" && result.evidenceSufficient,
  );
  const remainingToolNames = new Set(
    contract.requirements
      .filter(
        (requirement) =>
          !sufficientResults.some((result) =>
            resultSatisfiesRequirement(requirement, result),
          ),
      )
      .flatMap((requirement) => requirement.acceptedTools),
  );

  return aiToolNames.filter((toolName) => remainingToolNames.has(toolName));
}

/** A sufficient result is usable only when its tool and visible query match. */
export function evidenceContractAllowsModelText(
  contract: SalesChatEvidenceContract,
  results: readonly AiToolResult[],
): boolean {
  if (!results.every(resultMatchesDeterministicRules)) {
    return false;
  }
  if (
    results.some(
      (result) => result.status !== "ok" || !result.evidenceSufficient,
    )
  ) {
    return false;
  }
  if (contract.blocksModelText) {
    return false;
  }

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
