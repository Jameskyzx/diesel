import type { AiToolResult } from "@/features/ai/schemas";
import { formatUtcDate } from "@/i18n/date";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locale";
import { applicationScopeLabel } from "@/i18n/structured-labels";

const profileTopicLabels = {
  country: "国家基础信息",
  market: "市场指标",
  regulations: "当前或未来法规",
} as const;

const englishProfileTopicLabels = {
  country: "country-profile",
  market: "market-metric",
  regulations: "current or future regulatory",
} as const;

export function regulatoryDisclaimer(locale: Locale): string {
  return locale === "en"
    ? "For information only; not a substitute for formal certification or legal advice."
    : "信息参考，不替代正式认证或法律意见";
}

/**
 * Builds the fixed public response emitted when the evidence boundary withholds
 * model prose. This formatter stays free of provider, model, repository, and
 * service imports so an isolated verifier can reproduce the boundary output.
 */
export function buildEvidenceGapResponse(
  results: AiToolResult[],
  hasExecutionFailure: boolean,
  hasOutputLimitExceeded = false,
  locale: Locale = "en",
  hasEmbeddedReasoningMarkup = false,
): string {
  const details = new Set<string>();
  const dictionary = getDictionary(locale);
  let queryExecutionFailed = hasExecutionFailure;

  for (const result of results) {
    // An error placeholder cannot establish that the requested data is absent.
    // Derive this from the result too: a service error is a valid tool-result,
    // not necessarily an SDK tool-error event.
    if (result.status === "error") {
      queryExecutionFailed = true;
      continue;
    }
    if (result.status === "ok" && result.evidenceSufficient) {
      continue;
    }

    if (result.tool === "getCountryProfile") {
      if (!result.resolvedCountryIso3) {
        details.add(
          locale === "en"
            ? "A country is missing. Provide a country name or ISO3 code such as CHN, DEU, or AUS."
            : "缺少国家：请写国家名称或 ISO3，例如 CHN、DEU、AUS。",
        );
      } else {
        const topics = result.requestedTopics
          .map((topic) =>
            locale === "en"
              ? englishProfileTopicLabels[topic]
              : profileTopicLabels[topic],
          )
          .join(locale === "en" ? ", " : "、");
        details.add(
          locale === "en"
            ? `${result.resolvedCountryIso3} lacks the ${topics} evidence required for this request. Try another topic, date, or country.`
            : `${result.resolvedCountryIso3} 缺少本次请求所需的${topics}证据；可以换主题、日期或国家。`,
        );
      }
      continue;
    }

    if (result.tool === "findCompatibleProducts") {
      if (!result.query.countryIso3) {
        details.add(
          locale === "en"
            ? "Product fit requires a country name or ISO3 code."
            : "产品适配缺少国家，请指定国家名称或 ISO3。",
        );
      } else {
        const applicationScope = applicationScopeLabel(
          result.query.applicationScope,
          dictionary,
        );
        const asOf = formatUtcDate(result.query.asOf, locale);
        details.add(
          locale === "en"
            ? `${result.query.countryIso3} lacks sufficient evidence for a conclusive product-fit decision for ${applicationScope}, ${result.query.powerKw} kW, as of ${asOf}. Check product, certification, and regulatory evidence.`
            : `${result.query.countryIso3} 在${applicationScope}、${result.query.powerKw} kW、${asOf}条件下没有确定的适配结论；请核对产品目录、认证或法规证据。`,
        );
      }
      continue;
    }

    if (result.tool === "compareRegulations") {
      const { applicationScope, asOf, countryIso3s, powerKw } =
        result.comparison.query;
      const countries = countryIso3s.join(locale === "en" ? ", " : "、");
      const scope = applicationScopeLabel(applicationScope, dictionary);
      const date = formatUtcDate(asOf, locale);
      const effectiveStatus = dictionary.country.statusEffective;
      const adoptedStatus = dictionary.country.statusAdopted;
      details.add(
        locale === "en"
          ? `${countries} has no sufficient visible ${effectiveStatus} or ${adoptedStatus} regulatory evidence for ${scope}, ${powerKw} kW, as of ${date}.`
          : `${countries} 在${scope}、${powerKw} kW、${date}条件下没有足够的可见${effectiveStatus}或${adoptedStatus}法规证据。`,
      );
      continue;
    }

    if (result.tool === "compareMarkets") {
      details.add(
        locale === "en"
          ? "No directly comparable market metric was found. Specify a metric and align period, unit, currency, methodology, and application."
          : "市场比较没有找到可直接比较的指标；请指定指标，并确保期间、单位、币种、口径和应用场景一致。",
      );
      continue;
    }

    if (result.tool === "calculateOpportunityScore") {
      details.add(
        locale === "en"
          ? "Opportunity ranking needs deterministic scores for at least two countries. Add market, product-readiness, or regulatory evidence."
          : "机会排名至少需要两个国家产生确定性分数；请补齐市场、产品准备度或法规覆盖数据。",
      );
      continue;
    }

    if (result.tool === "generateSalesBrief") {
      details.add(
        locale === "en"
          ? "The sales brief lacks a scorable market or a clear product-fit result. Add the target, benchmarks, application, and power."
          : "销售简报缺少可评分市场或明确适配产品；请补充目标国家、对比国家、应用场景和功率。",
      );
      continue;
    }

    details.add(
      locale === "en"
        ? result.resolvedCountryIso3
          ? `The knowledge base has no matching source text for ${result.resolvedCountryIso3}. Narrow the regulation, pollutant, section, or date range.`
          : "The knowledge base has no matching source text. Add a country and narrow the regulation, pollutant, section, or date range."
        : result.resolvedCountryIso3
          ? `${result.resolvedCountryIso3} 的知识库没有检索到匹配原文；请缩小法规名称、污染物、章节或日期范围。`
          : "知识库没有检索到匹配原文；请补充国家并缩小法规名称、污染物、章节或日期范围。",
    );
  }

  if (queryExecutionFailed) {
    details.add(
      locale === "en"
        ? "At least one query or parameter validation failed. Check the input and retry."
        : "至少一项查询执行或参数校验失败，请检查输入后重试。",
    );
  }
  if (hasOutputLimitExceeded) {
    details.add(
      locale === "en"
        ? "The AI explanation exceeded the safe output limit and was discarded. Narrow the question and retry."
        : "AI 解释超过安全输出上限，已丢弃该段文本；请缩小问题后重试。",
    );
  }
  if (hasEmbeddedReasoningMarkup) {
    details.add(
      locale === "en"
        ? "The AI explanation contained private reasoning markup and was discarded. Retry the request; use only the structured evidence cards until a clean explanation is available."
        : "AI 解释包含私有推理标记，整段文本已丢弃。请重试；在获得干净解释前，只使用结构化证据卡。",
    );
  }

  const detailLines = Array.from(details);
  const partialEvidence = results.some(
    (result) => result.status === "ok" && result.evidenceSufficient,
  );
  const lead = hasEmbeddedReasoningMarkup
    ? locale === "en"
      ? "The model explanation was withheld because it contained private reasoning markup. Successful structured cards remain independently reviewable."
      : "模型解释因包含私有推理标记而未展示。已成功的结构化卡片仍可单独查看。"
    : partialEvidence
      ? locale === "en"
        ? "This request lacks enough evidence for a complete affirmative conclusion. Successful structured cards remain independently reviewable."
        : "这次请求没有足够证据支持完整的肯定结论。已成功的结构化卡片仍可单独查看。"
      : locale === "en"
        ? "This request lacks enough evidence for an affirmative regulatory, market, or product conclusion."
        : "这次请求没有足够证据，暂时不能给出肯定的法规、市场或产品结论。";

  return `${lead}${
    detailLines.length > 0
      ? `\n\n${locale === "en" ? "Next steps:\n" : "下一步：\n"}${detailLines.map((line, index) => `${index + 1}. ${line}`).join("\n")}`
      : locale === "en"
        ? "\n\nAdd a country, query topic, and required business parameters, then retry."
        : "\n\n请补充国家、查询主题和必要业务参数后重试。"
  }\n\n${regulatoryDisclaimer(locale)}`;
}
