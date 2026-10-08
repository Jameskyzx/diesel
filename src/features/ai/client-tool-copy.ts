import type {
  ClientAiCitation,
  ClientAiToolResult,
} from "@/features/ai/client-schemas";
export { localizedCitationLocator } from "@/features/ai/citation-locator-copy";
import type { ToolPartErrorCode } from "@/features/ai/tool-part-presentation";
import { OPPORTUNITY_SCORE_RULESET_VERSION } from "@/features/marketing/constants";
import {
  productFitReasonCodeSchema,
  type ProductFitEvaluation,
  type ProductFitReasonCode,
} from "@/features/product-fit/schemas";
import { interpolate } from "@/i18n/dictionaries";
import type { Dictionary } from "@/i18n/dictionaries";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { formatUtcDate } from "@/i18n/date";
import type { Locale } from "@/i18n/locale";
import {
  marketMetricDisplayName,
  productDisplayName,
} from "@/i18n/structured-labels";

const englishProductFitReasonCopy = {
  APPLICATION_SCOPE_MATCH: "The product covers the requested application.",
  APPLICATION_SCOPE_MISMATCH:
    "The product does not cover the requested application.",
  CERTIFICATION_EXPIRED:
    "The certification expired before the evaluation date.",
  CERTIFICATION_INACTIVE: "The certification is not active.",
  CERTIFICATION_MATCH:
    "A traceable certification covers the regulation and evaluation conditions.",
  CERTIFICATION_MISSING:
    "No traceable certification record links this product to the applicable regulation; the fit remains unknown.",
  CERTIFICATION_PRODUCT_MISMATCH:
    "The certification belongs to a different product and cannot support this evaluation.",
  CERTIFICATION_NOT_YET_VALID:
    "The certification is not yet valid on the evaluation date.",
  CERTIFICATION_POWER_OUT_OF_RANGE:
    "The certification power range does not cover the requested power.",
  CERTIFICATION_POWER_RANGE_UNKNOWN:
    "The certification power range is incomplete, so coverage remains unknown.",
  CERTIFICATION_SCOPE_MISMATCH:
    "The certification does not cover the requested application.",
  CERTIFICATION_STATUS_UNKNOWN:
    "The certification status is unknown, so current validity cannot be confirmed.",
  CERTIFICATION_VALIDITY_UNKNOWN:
    "The certification validity period is incomplete, so date coverage remains unknown.",
  NO_APPLICABLE_REGULATION_DATA:
    "No effective regulation record covers the country, application, power, and date; compliance cannot be inferred.",
  PRODUCT_AVAILABILITY_UNKNOWN:
    "The product availability period is incomplete, so availability on the query date remains unknown.",
  PRODUCT_AVAILABLE: "The product is available on the query date.",
  PRODUCT_NOT_FOUND:
    "No structured record was found for this product model.",
  PRODUCT_NOT_YET_AVAILABLE:
    "The product is not yet available on the query date.",
  PRODUCT_NO_LONGER_AVAILABLE:
    "The product is no longer available on the query date.",
  PRODUCT_POWER_MATCH: "The product power range covers the requested power.",
  PRODUCT_POWER_OUT_OF_RANGE:
    "The product power range does not cover the requested power.",
} satisfies Record<ProductFitReasonCode, string>;

const chineseProductFitReasonCopy = {
  APPLICATION_SCOPE_MATCH: "产品覆盖请求的应用场景。",
  APPLICATION_SCOPE_MISMATCH: "产品不覆盖请求的应用场景。",
  CERTIFICATION_EXPIRED: "认证在评估日期前已到期。",
  CERTIFICATION_INACTIVE: "认证当前不是有效状态。",
  CERTIFICATION_MATCH: "一条可追溯认证覆盖该法规和本次评估条件。",
  CERTIFICATION_MISSING:
    "没有可追溯认证记录将该产品与适用法规关联，适配结论保持未知。",
  CERTIFICATION_PRODUCT_MISMATCH:
    "认证记录属于其他产品，不能作为本次评估的依据。",
  CERTIFICATION_NOT_YET_VALID: "认证在评估日期尚未生效。",
  CERTIFICATION_POWER_OUT_OF_RANGE: "认证功率范围不覆盖请求的功率。",
  CERTIFICATION_POWER_RANGE_UNKNOWN:
    "认证功率范围信息不完整，因此无法确认覆盖情况。",
  CERTIFICATION_SCOPE_MISMATCH: "认证不覆盖请求的应用场景。",
  CERTIFICATION_STATUS_UNKNOWN:
    "认证状态未知，因此无法确认当前有效性。",
  CERTIFICATION_VALIDITY_UNKNOWN:
    "认证有效期信息不完整，因此无法确认日期覆盖情况。",
  NO_APPLICABLE_REGULATION_DATA:
    "没有生效法规记录覆盖该国家、应用场景、功率和日期，因此无法推断合规。",
  PRODUCT_AVAILABILITY_UNKNOWN:
    "产品供应期信息不完整，因此无法判断查询日是否可供应。",
  PRODUCT_AVAILABLE: "产品在查询日处于供应期内。",
  PRODUCT_NOT_FOUND: "没有找到该产品型号的结构化记录。",
  PRODUCT_NOT_YET_AVAILABLE: "产品在查询日尚未开始供应。",
  PRODUCT_NO_LONGER_AVAILABLE: "产品在查询日已不再供应。",
  PRODUCT_POWER_MATCH: "产品功率范围覆盖请求的功率。",
  PRODUCT_POWER_OUT_OF_RANGE: "产品功率范围不覆盖请求的功率。",
} satisfies Record<ProductFitReasonCode, string>;

type ProductFitReason = {
  code: ProductFitReasonCode;
  message: string;
};

type ClientOpportunityScoreComponent = Extract<
  ClientAiToolResult,
  { tool: "calculateOpportunityScore" }
>["scorecard"]["scores"][number]["components"][number];

type ClientSalesBrief = Extract<
  ClientAiToolResult,
  { tool: "generateSalesBrief" }
>["brief"];

type ClientSalesBriefItem =
  | ClientSalesBrief["opportunities"][number]
  | ClientSalesBrief["risks"][number];
type ClientSalesAction = ClientSalesBrief["salesActions"][number];

type ClientRegulationComparisonCountry = Extract<
  ClientAiToolResult,
  { tool: "compareRegulations" }
>["comparison"]["countries"][number];

type ClientCountryProfileTopic = Extract<
  ClientAiToolResult,
  { tool: "getCountryProfile" }
>["requestedTopics"][number];

const countryProfileTopicKeys = {
  country: "countryProfileTopicCountry",
  market: "countryProfileTopicMarket",
  regulations: "countryProfileTopicRegulations",
} as const satisfies Record<
  ClientCountryProfileTopic,
  keyof Dictionary["chat"]
>;

export function countryProfileTopicLabel(
  topic: ClientCountryProfileTopic,
  dictionary: Dictionary,
): string {
  return dictionary.chat[countryProfileTopicKeys[topic]];
}

export function localizedRegulationComparisonCountryName(
  country: Pick<
    ClientRegulationComparisonCountry,
    "countryIsDemo" | "countryIso3" | "countryName" | "countrySource"
  >,
  locale: Locale,
  countryIso2ByIso3: Readonly<Record<string, string>>,
): string | null {
  if (country.countryName === null) {
    return null;
  }

  return formatCountryDisplayName(
    {
      isDemo: country.countryIsDemo,
      iso2: countryIso2ByIso3[country.countryIso3],
      iso3: country.countryIso3,
      nameEn: country.countryName,
      nameLocal: null,
      source: country.countrySource,
    },
    locale,
  );
}

export function productFitReasonMessage(
  reason: ProductFitReason,
  locale: Locale,
): string {
  const code = productFitReasonCodeSchema.safeParse(reason.code);
  if (!code.success) {
    return locale === "en"
      ? "The product-fit result contains an unrecognized reason code; review the structured record before drawing a conclusion."
      : "产品适配结果包含无法识别的原因码；请先核对结构化记录，再得出结论。";
  }

  // The service-authored `message` remains diagnostic data only. Visible copy
  // is selected exclusively by the validated reason code; contextual scope,
  // power, status and date facts are rendered from their typed fields nearby.
  return locale === "en"
    ? englishProductFitReasonCopy[code.data]
    : chineseProductFitReasonCopy[code.data];
}

export function localizedCitationTitle(
  citation: ClientAiCitation,
  locale: Locale,
  dictionary: Dictionary,
): string {
  if (
    citation.chunkId !== null ||
    citation.documentId !== null ||
    citation.documentTitle !== null
  ) {
    return citation.title;
  }

  const descriptor = citation.titleDescriptor;
  if (descriptor?.kind === "regulation_jurisdiction") {
    return interpolate(dictionary.chat.citationJurisdiction, {
      jurisdiction: descriptor.jurisdictionName,
      regulation: descriptor.regulationName,
    });
  }
  if (descriptor?.kind === "country_jurisdiction_membership") {
    return interpolate(dictionary.chat.citationMembership, {
      country: descriptor.countryIso3,
      jurisdiction: descriptor.jurisdictionName,
    });
  }
  if (descriptor?.kind === "country_profile") {
    return interpolate(dictionary.chat.citationCountryProfile, {
      country: formatCountryDisplayName(
        {
          iso2: descriptor.countryIso2,
          iso3: descriptor.countryIso3,
          isDemo: descriptor.countryIsDemo,
          nameEn: descriptor.countryNameEn,
          nameLocal: descriptor.countryNameLocal,
          source: {
            id: descriptor.countrySourceId,
            isDemo: descriptor.countrySourceIsDemo,
            title: descriptor.countrySourceTitle,
          },
        },
        locale,
      ),
    });
  }
  if (descriptor?.kind === "regulation_limits") {
    return interpolate(dictionary.chat.citationLimits, {
      regulation: descriptor.regulationName,
    });
  }
  if (descriptor?.kind === "regulation_pollutant_limit") {
    return interpolate(dictionary.chat.citationPollutantLimit, {
      pollutant: descriptor.pollutantCode,
      regulation: descriptor.regulationName,
    });
  }
  if (descriptor?.kind === "product_certification_record") {
    return interpolate(dictionary.chat.citationCertificationRecord, {
      product: descriptor.productModelCode ?? dictionary.chat.product,
    });
  }
  if (descriptor?.kind === "market_metric") {
    return marketMetricDisplayName(
      {
        isDemo: descriptor.isDemo,
        metricCode: descriptor.metricCode,
        metricIds: [descriptor.metricId],
        metricName: descriptor.metricName,
      },
      dictionary,
      locale,
    );
  }

  return citation.title;
}

function scoreComponentLabel(
  key: ClientOpportunityScoreComponent["key"],
  copy: Dictionary["chat"],
): string {
  if (key === "marketPotential") {
    return copy.scoreMarketPotential;
  }
  if (key === "productReadiness") {
    return copy.scoreProductReadiness;
  }
  return copy.scoreRegulatoryCoverage;
}

export function localizedScoreComponentContent(
  component: ClientOpportunityScoreComponent,
  _locale: Locale,
  copy: Dictionary["chat"],
): { explanation: string; inputSummary: string | null } {
  const values = {
    component: scoreComponentLabel(component.key, copy),
    count: 0,
    score: component.score ?? "—",
  };
  return {
    explanation: interpolate(
      component.status === "available" && component.score !== null
        ? copy.scoreComponentAvailable
        : copy.scoreComponentMissing,
      values,
    ),
    inputSummary: null,
  };
}

export function localizedSalesBriefSummary(
  brief: ClientSalesBrief,
  _locale: Locale,
  copy: Dictionary["chat"],
): string {
  return interpolate(
    brief.marketScore.overallScore === null
      ? copy.briefSummaryMissing
      : copy.briefSummaryAvailable,
    {
      actions: brief.salesActions.length,
      country: brief.query.targetCountryIso3,
      coverage: brief.marketScore.dataCoveragePct,
      opportunities: brief.opportunities.length,
      products: brief.recommendedProducts.length,
      risks: brief.risks.length,
      ruleset: OPPORTUNITY_SCORE_RULESET_VERSION,
      score: brief.marketScore.overallScore ?? "—",
    },
  );
}

export function localizedSalesBriefItem(
  item: ClientSalesBriefItem,
  index: number,
  kind: "opportunity" | "risk",
  _locale: Locale,
  copy: Dictionary["chat"],
): string {
  const count =
    "metricCodes" in item
      ? item.metricCodes.length
      : "regulationIds" in item
        ? item.regulationIds.length
        : item.productIds.length;
  return interpolate(
    kind === "risk" ? copy.briefRisk : copy.briefOpportunity,
    {
      count,
      index: index + 1,
    },
  );
}

export function localizedSalesBriefAction(
  action: ClientSalesAction,
  index: number,
  _locale: Locale,
  copy: Dictionary["chat"],
): string {
  const priority = {
    high: copy.priorityHigh,
    low: copy.priorityLow,
    medium: copy.priorityMedium,
  }[action.priority];
  return interpolate(copy.briefAction, {
    index: index + 1,
    priority,
  });
}

type ProductFitRequiredFieldsCopyKey =
  | "requiredCertificationFields"
  | "requiredProductFields"
  | "requiredRegulationFields";

const requiredFieldsCopyKeyByReasonCode = {
  APPLICATION_SCOPE_MATCH: "requiredProductFields",
  APPLICATION_SCOPE_MISMATCH: "requiredProductFields",
  CERTIFICATION_EXPIRED: "requiredCertificationFields",
  CERTIFICATION_INACTIVE: "requiredCertificationFields",
  CERTIFICATION_MATCH: "requiredCertificationFields",
  CERTIFICATION_MISSING: "requiredCertificationFields",
  CERTIFICATION_PRODUCT_MISMATCH: "requiredCertificationFields",
  CERTIFICATION_NOT_YET_VALID: "requiredCertificationFields",
  CERTIFICATION_POWER_OUT_OF_RANGE: "requiredCertificationFields",
  CERTIFICATION_POWER_RANGE_UNKNOWN: "requiredCertificationFields",
  CERTIFICATION_SCOPE_MISMATCH: "requiredCertificationFields",
  CERTIFICATION_STATUS_UNKNOWN: "requiredCertificationFields",
  CERTIFICATION_VALIDITY_UNKNOWN: "requiredCertificationFields",
  NO_APPLICABLE_REGULATION_DATA: "requiredRegulationFields",
  PRODUCT_AVAILABILITY_UNKNOWN: "requiredProductFields",
  PRODUCT_AVAILABLE: "requiredProductFields",
  PRODUCT_NOT_FOUND: "requiredProductFields",
  PRODUCT_NOT_YET_AVAILABLE: "requiredProductFields",
  PRODUCT_NO_LONGER_AVAILABLE: "requiredProductFields",
  PRODUCT_POWER_MATCH: "requiredProductFields",
  PRODUCT_POWER_OUT_OF_RANGE: "requiredProductFields",
} as const satisfies Record<
  ProductFitReasonCode,
  ProductFitRequiredFieldsCopyKey
>;

function requiredFieldsForReasonCode(
  code: ProductFitReasonCode,
  copy: Dictionary["productFit"],
): string {
  return copy[requiredFieldsCopyKeyByReasonCode[code]];
}

const passingReasons = new Set<ProductFitReasonCode>([
  "APPLICATION_SCOPE_MATCH", "CERTIFICATION_MATCH", "PRODUCT_AVAILABLE", "PRODUCT_POWER_MATCH",
]);

export function productFitNextSteps(
  reasons: readonly { code: ProductFitReasonCode }[],
  dictionary: Dictionary,
): string[] {
  const copy = dictionary.queryEditor;
  const steps = reasons.filter(({ code }) => !passingReasons.has(code)).map(({ code }) => {
    const category = requiredFieldsCopyKeyByReasonCode[code];
    if (category === "requiredCertificationFields") return copy.certificationEvidence;
    if (category === "requiredRegulationFields") return copy.regulationEvidence;
    return copy.productEvidence;
  });
  return [...new Set(steps)];
}

export function toolEvidenceNextSteps(result: ClientAiToolResult, dictionary: Dictionary): string[] {
  if (result.status !== "no_data") return [];
  const copy = dictionary.queryEditor;
  if (result.tool === "findCompatibleProducts") {
    const steps = productFitNextSteps(result.evaluations.flatMap(({ reasons }) => reasons), dictionary);
    return [copy.checkQuery, ...(steps.length ? steps : [copy.productEvidence])];
  }
  if (result.tool === "searchKnowledgeBase") return [copy.knowledgeEvidence];
  if (result.tool === "compareMarkets") return [copy.marketEvidence];
  if (result.tool === "getCountryProfile") return [
    copy.checkQuery,
    ...(result.requestedTopics.includes("regulations") ? [copy.regulationEvidence] : []),
    ...(result.requestedTopics.includes("market") ? [copy.marketEvidence] : []),
    ...(result.requestedTopics.length === 1 && result.requestedTopics[0] === "country" ? [copy.reviewEvidence] : []),
  ];
  if (result.tool === "compareRegulations") return [copy.checkQuery, copy.regulationEvidence];
  return [copy.checkQuery, copy.reviewEvidence];
}

export function buildProductFitDataGapSummary({
  dictionary,
  evaluation,
  locale,
  scopeLabel,
}: {
  dictionary: Dictionary;
  evaluation: ProductFitEvaluation;
  locale: Locale;
  scopeLabel: string;
}): string {
  const copy = dictionary.productFit;
  const requiredFields = Array.from(
    new Set(
      evaluation.reasons.filter(({ code }) => !passingReasons.has(code)).map(({ code }) =>
        requiredFieldsForReasonCode(code, copy),
      ),
    ),
  );
  const product = evaluation.product
    ? `${evaluation.product.modelCode} · ${productDisplayName(
        evaluation.product,
        dictionary,
        locale,
      )}`
    : evaluation.input.productModelCode;
  const separator = dictionary.common.labelSeparator;
  const itemSeparator = locale === "en" ? "; " : "；";

  return [
    copy.dataGapSummaryTitle,
    `${copy.dataGapSummaryCountry}${separator}${evaluation.input.countryIso3}`,
    `${copy.dataGapSummaryProduct}${separator}${product}`,
    `${copy.dataGapSummaryApplication}${separator}${scopeLabel}`,
    `${copy.dataGapSummaryPower}${separator}${evaluation.input.powerKw} kW`,
    `${copy.dataGapSummaryAsOf}${separator}${formatUtcDate(evaluation.asOf, locale)}`,
    `${copy.dataGapSummaryReasons}${separator}${evaluation.reasons
      .map((reason) => productFitReasonMessage(reason, locale))
      .join(itemSeparator)}`,
    `${copy.dataGapSummaryRequiredFields}${separator}${requiredFields.join(itemSeparator)}`,
    `${dictionary.queryEditor.nextSteps}${separator}${productFitNextSteps(evaluation.reasons, dictionary).join(itemSeparator)}`,
  ].join("\n");
}

function resultHasDemoEvidence(result: ClientAiToolResult): boolean {
  return result.citations.some(({ isDemo }) => isDemo);
}

function structuredGapCounts(result: ClientAiToolResult): {
  display: number;
  rawWarnings: number;
} {
  if (result.tool === "compareRegulations") {
    const countryGapCount = result.comparison.countries.filter(
      (country) =>
        country.countryName === null ||
        (country.currentEffectiveRegulations.length === 0 &&
          country.futureAdoptedRegulations.length === 0),
    ).length;
    return {
      display: countryGapCount,
      rawWarnings: countryGapCount,
    };
  }
  if (result.tool === "compareMarkets") {
    const nonComparableMetricCount = result.comparison.metrics.filter(
      ({ comparisonStatus }) => comparisonStatus !== "comparable",
    ).length;
    const emptyComparisonGap = result.comparison.metrics.length === 0 ? 1 : 0;
    return {
      display:
        new Set(
          result.comparison.metrics.flatMap(({ issues }) => issues),
        ).size + emptyComparisonGap,
      rawWarnings: nonComparableMetricCount + emptyComparisonGap,
    };
  }
  if (result.tool === "calculateOpportunityScore") {
    return {
      display: result.scorecard.scores.reduce(
        (count, score) =>
          count +
          score.components.filter(({ status }) => status === "missing").length,
        0,
      ),
      rawWarnings: 0,
    };
  }
  if (result.tool === "generateSalesBrief") {
    return {
      display: result.brief.marketScore.components.filter(
        ({ status }) => status === "missing",
      ).length,
      rawWarnings: 0,
    };
  }
  return { display: 0, rawWarnings: 0 };
}

export function localizedToolWarnings(
  result: ClientAiToolResult,
  _locale: Locale,
  copy: Dictionary["chat"],
): string[] {
  const messages: string[] = [];
  let representedRawWarnings = 0;

  if (result.status === "error") {
    return [copy.toolQueryFailedWarning];
  }

  if (!result.evidenceSufficient) {
    messages.push(copy.insufficientEvidenceWarning);
    representedRawWarnings += 1;
  }

  if (resultHasDemoEvidence(result)) {
    representedRawWarnings += 1;
  }

  if (result.tool === "findCompatibleProducts") {
    const unknownCount = result.evaluations.filter(
      ({ status }) => status === "unknown",
    ).length;
    if (unknownCount > 0) {
      messages.push(
        interpolate(copy.unknownProductsWarning, { count: unknownCount }),
      );
      representedRawWarnings += 1;
    }
  }

  if (result.tool === "searchKnowledgeBase") {
    const missingApplicationScopeCount = result.search.results.filter(
      ({ applicationScope }) => applicationScope === null,
    ).length;
    const missingCountryCount = result.search.results.filter(
      ({ countryIso3 }) => countryIso3 === null,
    ).length;
    const missingValidFromCount = result.search.results.filter(
      ({ validFrom }) => validFrom === null,
    ).length;

    if (missingApplicationScopeCount > 0) {
      messages.push(
        interpolate(copy.knowledgeMissingApplicationScopeWarning, {
          count: missingApplicationScopeCount,
        }),
      );
    }
    if (missingCountryCount > 0) {
      messages.push(
        interpolate(copy.knowledgeMissingCountryWarning, {
          count: missingCountryCount,
        }),
      );
    }
    if (missingValidFromCount > 0) {
      messages.push(
        interpolate(copy.knowledgeMissingValidFromWarning, {
          count: missingValidFromCount,
        }),
      );
    }
    representedRawWarnings +=
      missingApplicationScopeCount +
      missingCountryCount +
      missingValidFromCount;
  }

  if (
    result.tool === "getCountryProfile" &&
    result.profile?.status === "available"
  ) {
    const missingRegulations =
      result.requestedTopics.includes("regulations") &&
      result.profile.country.currentEffectiveRegulations.length === 0 &&
      result.profile.country.futureAdoptedRegulations.length === 0;
    const missingMarket =
      result.requestedTopics.includes("market") &&
      result.profile.country.marketMetrics.length === 0;

    if (missingRegulations) {
      messages.push(copy.countryProfileMissingRegulationsWarning);
      representedRawWarnings += 1;
    }
    if (missingMarket) {
      messages.push(copy.countryProfileMissingMarketWarning);
      representedRawWarnings += 1;
    }
  }

  const gapCounts = structuredGapCounts(result);
  if (gapCounts.display > 0) {
    messages.push(
      interpolate(copy.structuredGapsWarning, { count: gapCounts.display }),
    );
  }
  representedRawWarnings += gapCounts.rawWarnings;

  const additionalWarningCount = Math.max(
    0,
    result.warnings.length - representedRawWarnings,
  );
  if (additionalWarningCount > 0) {
    messages.push(
      interpolate(copy.additionalEvidenceWarnings, {
        count: additionalWarningCount,
      }),
    );
  }

  return Array.from(new Set(messages));
}

export function toolPartErrorMessage(
  code: ToolPartErrorCode,
  copy: Dictionary["chat"],
): string {
  if (code === "execution_error") {
    return copy.toolErrorExecution;
  }
  if (code === "permission_denied") {
    return copy.toolErrorPermissionDenied;
  }
  return copy.toolErrorInvalidResult;
}
