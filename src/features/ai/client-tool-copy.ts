import type { ClientAiToolResult } from "@/features/ai/client-schemas";
import type { ToolPartErrorCode } from "@/features/ai/tool-part-presentation";
import { OPPORTUNITY_SCORE_RULESET_VERSION } from "@/features/marketing/constants";
import type {
  ProductFitEvaluation,
  ProductFitReasonCode,
} from "@/features/product-fit/schemas";
import type { Dictionary } from "@/i18n/dictionaries";
import { interpolate } from "@/i18n/dictionaries";
import { formatUtcDate } from "@/i18n/date";
import type { Locale } from "@/i18n/locale";

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

type ClientSalesBriefItem = ClientSalesBrief["risks"][number];
type ClientSalesAction = ClientSalesBrief["salesActions"][number];

export function productFitReasonMessage(
  reason: ProductFitReason,
  locale: Locale,
): string {
  return locale === "en"
    ? englishProductFitReasonCopy[reason.code]
    : reason.message;
}

export function localizedCitationTitle(
  title: string,
  locale: Locale,
  copy: Dictionary["chat"],
): string {
  if (locale === "zh-CN") {
    return title;
  }

  const jurisdiction = title.match(/^(.+) 适用辖区：(.+)$/u);
  if (jurisdiction) {
    return interpolate(copy.citationJurisdiction, {
      jurisdiction: jurisdiction[2] ?? "",
      regulation: jurisdiction[1] ?? "",
    });
  }
  const membership = title.match(/^(.+) 对 ([A-Z]{3}) 的成员关系$/u);
  if (membership) {
    return interpolate(copy.citationMembership, {
      country: membership[2] ?? "",
      jurisdiction: membership[1] ?? "",
    });
  }
  const countryProfile = title.match(/^(.+) 国家概览$/u);
  if (countryProfile) {
    return interpolate(copy.citationCountryProfile, {
      country: countryProfile[1] ?? "",
    });
  }
  const applicableLimits = title.match(/^(.+) 适用限值$/u);
  if (applicableLimits) {
    return interpolate(copy.citationLimits, {
      regulation: applicableLimits[1] ?? "",
    });
  }
  const certification = title.match(/^(.+)认证记录$/u);
  if (certification) {
    return interpolate(copy.citationCertificationRecord, {
      product: certification[1] ?? "",
    });
  }
  const pollutantLimit = title.match(/^(.+) ([^ ]+) 限值$/u);
  if (pollutantLimit) {
    return interpolate(copy.citationPollutantLimit, {
      pollutant: pollutantLimit[2] ?? "",
      regulation: pollutantLimit[1] ?? "",
    });
  }

  return title;
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
  locale: Locale,
  copy: Dictionary["chat"],
): { explanation: string; inputSummary: string | null } {
  if (locale === "zh-CN") {
    return {
      explanation: component.explanation,
      inputSummary:
        component.inputFacts.length > 0
          ? component.inputFacts.join(" · ")
          : null,
    };
  }

  const values = {
    component: scoreComponentLabel(component.key, copy),
    count: component.inputFacts.length,
    score: component.score ?? "—",
  };
  return {
    explanation: interpolate(
      component.status === "available" && component.score !== null
        ? copy.scoreComponentAvailable
        : copy.scoreComponentMissing,
      values,
    ),
    inputSummary:
      component.inputFacts.length > 0
        ? interpolate(copy.scoreInputSummary, {
            count: component.inputFacts.length,
          })
        : null,
  };
}

export function localizedSalesBriefSummary(
  brief: ClientSalesBrief,
  locale: Locale,
  copy: Dictionary["chat"],
): string {
  if (locale === "zh-CN") {
    return brief.executiveSummary;
  }

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
  locale: Locale,
  copy: Dictionary["chat"],
): string {
  if (locale === "zh-CN") {
    return `${item.title} — ${item.text}`;
  }

  return interpolate(
    kind === "risk" ? copy.briefRisk : copy.briefOpportunity,
    {
      count: item.evidenceIds.length,
      index: index + 1,
    },
  );
}

export function localizedSalesBriefAction(
  action: ClientSalesAction,
  index: number,
  locale: Locale,
  copy: Dictionary["chat"],
): string {
  if (locale === "zh-CN") {
    return action.action;
  }

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

function requiredFieldsForReasonCode(
  code: ProductFitReasonCode,
  copy: Dictionary["productFit"],
): string {
  if (code === "PRODUCT_NOT_FOUND") {
    return copy.requiredProductFields;
  }
  if (code === "NO_APPLICABLE_REGULATION_DATA") {
    return copy.requiredRegulationFields;
  }
  if (code.startsWith("CERTIFICATION_")) {
    return copy.requiredCertificationFields;
  }
  return copy.requiredGenericFields;
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
  const reasonCodes = evaluation.reasons.map(({ code }) => code);
  const requiredFields = Array.from(
    new Set(
      reasonCodes.map((code) => requiredFieldsForReasonCode(code, copy)),
    ),
  );
  const product = evaluation.product
    ? `${evaluation.product.modelCode} · ${evaluation.product.name}`
    : evaluation.input.productModelCode;
  const separator = dictionary.common.labelSeparator;
  const itemSeparator = locale === "en" ? "; " : "；";

  return [
    copy.dataGapSummaryTitle,
    `${copy.dataGapSummaryCountry}${separator}${evaluation.input.countryIso3}`,
    `${copy.dataGapSummaryProduct}${separator}${product}`,
    `${copy.dataGapSummaryApplication}${separator}${scopeLabel} (${evaluation.input.applicationScope})`,
    `${copy.dataGapSummaryPower}${separator}${evaluation.input.powerKw} kW`,
    `${copy.dataGapSummaryAsOf}${separator}${formatUtcDate(evaluation.asOf, locale)}`,
    `${copy.dataGapSummaryReasonCodes}${separator}${reasonCodes.join(locale === "en" ? ", " : "、")}`,
    `${copy.dataGapSummaryReasons}${separator}${evaluation.reasons
      .map((reason) => productFitReasonMessage(reason, locale))
      .join(itemSeparator)}`,
    `${copy.dataGapSummaryRequiredFields}${separator}${requiredFields.join(itemSeparator)}`,
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
    return {
      display: new Set(result.comparison.missingData).size,
      rawWarnings: result.comparison.missingData.length,
    };
  }
  if (result.tool === "compareMarkets") {
    return {
      display: new Set([
        ...result.comparison.missingData,
        ...result.comparison.metrics.flatMap(({ issues }) => issues),
      ]).size,
      rawWarnings: result.comparison.missingData.length,
    };
  }
  if (result.tool === "calculateOpportunityScore") {
    const gaps = result.scorecard.scores.flatMap(({ missingData }) => missingData);
    return { display: new Set(gaps).size, rawWarnings: gaps.length };
  }
  if (result.tool === "generateSalesBrief") {
    return {
      display: new Set([
        ...result.brief.missingData,
        ...result.brief.marketScore.missingData,
      ]).size,
      rawWarnings: result.brief.missingData.length,
    };
  }
  return { display: 0, rawWarnings: 0 };
}

export function localizedToolWarnings(
  result: ClientAiToolResult,
  locale: Locale,
  copy: Dictionary["chat"],
): string[] {
  if (locale === "zh-CN") {
    return result.warnings;
  }

  const messages: string[] = [];
  let representedRawWarnings = 0;

  if (result.status === "error") {
    messages.push(copy.toolQueryFailedWarning);
    representedRawWarnings += 1;
  } else if (!result.evidenceSufficient) {
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
