import type { ProductFitQuery } from "@/features/database/schemas";
import {
  productFitEvaluationSchema,
  type CertificationEvidence,
  type FitEvidenceSource,
  type ProductFitEvaluation,
  type ProductSummary,
  type RegulationEvidence,
} from "@/features/product-fit/schemas";

type ProductFitFacts = {
  applicableRegulations: RegulationEvidence[];
  certifications: CertificationEvidence[];
  product: ProductSummary | null;
  query: ProductFitQuery;
};

type Check = ProductFitEvaluation["reasons"][number];
type CertificationCheck =
  ProductFitEvaluation["regulationChecks"][number]["certifications"][number];

function check(
  status: Check["status"],
  code: Check["code"],
  message: string,
): Check {
  return { code, message, status };
}

function isInHalfOpenNumberRange(
  value: number,
  minimum: number | null,
  maximum: number | null,
): boolean {
  return (minimum === null || value >= minimum) &&
    (maximum === null || value < maximum);
}

function isInHalfOpenDateRange(
  value: string,
  start: string | null,
  end: string | null,
): boolean {
  return (start === null || value >= start) && (end === null || value < end);
}

function evaluateCertification(
  certification: CertificationEvidence,
  query: ProductFitQuery,
): CertificationCheck {
  const reasons: Check[] = [];

  if (certification.status === "unknown") {
    reasons.push(
      check(
        "unknown",
        "CERTIFICATION_STATUS_UNKNOWN",
        "认证状态未知，不能判断其是否当前有效。",
      ),
    );
  } else if (certification.status !== "active") {
    reasons.push(
      check(
        "fail",
        "CERTIFICATION_INACTIVE",
        `认证状态为 ${certification.status}，不是 active。`,
      ),
    );
  }

  if (certification.applicationScope !== query.applicationScope) {
    reasons.push(
      check(
        "fail",
        "CERTIFICATION_SCOPE_MISMATCH",
        `认证适用场景为 ${certification.applicationScope}，不覆盖 ${query.applicationScope}。`,
      ),
    );
  }

  if (certification.powerMinKw === null) {
    reasons.push(
      check(
        "unknown",
        "CERTIFICATION_POWER_RANGE_UNKNOWN",
        "认证功率下界未知，不能判断其是否覆盖本次评估功率。",
      ),
    );
  }

  if (
    (certification.powerMinKw !== null &&
      query.powerKw < certification.powerMinKw) ||
    (certification.powerMaxKw !== null &&
      query.powerKw >= certification.powerMaxKw)
  ) {
    reasons.push(
      check(
        "fail",
        "CERTIFICATION_POWER_OUT_OF_RANGE",
        `认证功率范围不覆盖 ${query.powerKw} kW（区间按 [min, max) 判断）。`,
      ),
    );
  }

  if (certification.validFrom === null) {
    reasons.push(
      check(
        "unknown",
        "CERTIFICATION_VALIDITY_UNKNOWN",
        "认证生效日期未知，不能判断其是否覆盖本次评估日期。",
      ),
    );
  }

  if (
    certification.validFrom !== null &&
    query.asOf < certification.validFrom
  ) {
    reasons.push(
      check(
        "fail",
        "CERTIFICATION_NOT_YET_VALID",
        `认证自 ${certification.validFrom} 起有效，晚于评估日期 ${query.asOf}。`,
      ),
    );
  }

  if (
    certification.validTo !== null &&
    query.asOf >= certification.validTo
  ) {
    reasons.push(
      check(
        "fail",
        "CERTIFICATION_EXPIRED",
        `认证有效期截止 ${certification.validTo}（不含当日），评估日期为 ${query.asOf}。`,
      ),
    );
  }

  if (
    reasons.length === 0 &&
    isInHalfOpenDateRange(
      query.asOf,
      certification.validFrom,
      certification.validTo,
    )
  ) {
    reasons.push(
      check(
        "pass",
        "CERTIFICATION_MATCH",
        "认证状态、应用场景、功率范围和有效期均覆盖本次评估。",
      ),
    );
  }

  return {
    certification,
    reasons,
    status: reasons.some(({ status }) => status === "fail")
      ? "fail"
      : reasons.some(({ status }) => status === "unknown")
        ? "unknown"
        : "pass",
  };
}

function uniqueSources(
  product: ProductSummary | null,
  regulations: RegulationEvidence[],
  certifications: CertificationEvidence[],
): FitEvidenceSource[] {
  const sources = [
    ...(product
      ? [
          {
            ...product.source,
            isDemo: product.isDemo || product.source.isDemo,
          },
        ]
      : []),
    ...regulations.map(({ isDemo, source }) => ({
      ...source,
      isDemo: isDemo || source.isDemo,
    })),
    ...regulations.map(({ applicability }) => ({
      ...applicability.jurisdiction.source,
      isDemo:
        applicability.jurisdiction.isDemo ||
        applicability.jurisdiction.source.isDemo,
    })),
    ...regulations.map(({ applicability }) => ({
      ...applicability.membership.source,
      isDemo:
        applicability.membership.isDemo ||
        applicability.membership.source.isDemo,
    })),
    ...regulations.flatMap(({ limitSources }) => limitSources),
    ...certifications.map(({ isDemo, source }) => ({
      ...source,
      isDemo: isDemo || source.isDemo,
    })),
  ];

  const sourcesById = new Map<string, FitEvidenceSource>();
  for (const source of sources) {
    const existing = sourcesById.get(source.id);
    sourcesById.set(
      source.id,
      existing
        ? { ...existing, isDemo: existing.isDemo || source.isDemo }
        : source,
    );
  }

  return Array.from(sourcesById.values());
}

export function evaluateProductFit(
  facts: ProductFitFacts,
): ProductFitEvaluation {
  const { applicableRegulations, certifications, product, query } = facts;

  const applicationScopeCheck = product
    ? product.applicationScopes.includes(query.applicationScope)
      ? check(
          "pass",
          "APPLICATION_SCOPE_MATCH",
          `产品覆盖 ${query.applicationScope} 应用场景。`,
        )
      : check(
          "fail",
          "APPLICATION_SCOPE_MISMATCH",
          `产品应用场景不包含 ${query.applicationScope}。`,
        )
    : check("unknown", "PRODUCT_NOT_FOUND", "未找到该产品型号的结构化记录。");

  const powerCheck = product
    ? isInHalfOpenNumberRange(
        query.powerKw,
        product.powerMinKw,
        product.powerMaxKw,
      )
      ? check(
          "pass",
          "PRODUCT_POWER_MATCH",
          `产品功率范围覆盖 ${query.powerKw} kW（区间按 [min, max) 判断）。`,
        )
      : check(
          "fail",
          "PRODUCT_POWER_OUT_OF_RANGE",
          `产品功率范围 [${product.powerMinKw}, ${product.powerMaxKw}) kW 不覆盖 ${query.powerKw} kW。`,
        )
    : check("unknown", "PRODUCT_NOT_FOUND", "缺少产品记录，无法核对功率范围。");

  const availabilityCheck = product
    ? product.availableFrom === null || product.availableTo === null
      ? check(
          "unknown",
          "PRODUCT_AVAILABILITY_UNKNOWN",
          "产品供应期的开始或结束日期证据不足，无法判断查询日是否可供应。",
        )
      : query.asOf < product.availableFrom
        ? check(
            "fail",
            "PRODUCT_NOT_YET_AVAILABLE",
            `产品自 ${product.availableFrom} 起供应，晚于查询日 ${query.asOf}。`,
          )
        : query.asOf >= product.availableTo
          ? check(
              "fail",
              "PRODUCT_NO_LONGER_AVAILABLE",
              `产品供应期截止 ${product.availableTo}（不含当日），查询日为 ${query.asOf}。`,
            )
          : check(
              "pass",
              "PRODUCT_AVAILABLE",
              `查询日 ${query.asOf} 位于产品供应期 [${product.availableFrom}, ${product.availableTo}) 内。`,
            )
    : check(
        "unknown",
        "PRODUCT_NOT_FOUND",
        "缺少产品记录，无法核对查询日供应状态。",
      );

  const regulationChecks = applicableRegulations.map((regulation) => {
    const certificationChecks = certifications
      .filter(({ regulationId }) => regulationId === regulation.regulationId)
      .map((certification) => evaluateCertification(certification, query));
    const matchingCertification = certificationChecks.find(
      ({ status }) => status === "pass",
    );

    if (matchingCertification) {
      return {
        certifications: certificationChecks,
        code: "CERTIFICATION_MATCH" as const,
        message: "存在一条覆盖当前法规、场景、功率和日期的有效认证。",
        regulation,
        status: "pass" as const,
      };
    }

    if (certificationChecks.length === 0) {
      return {
        certifications: certificationChecks,
        code: "CERTIFICATION_MISSING" as const,
        message: "未找到产品与该法规之间的认证记录，结论保持未知。",
        regulation,
        status: "unknown" as const,
      };
    }

    if (certificationChecks.some(({ status }) => status === "unknown")) {
      const unknownReason = certificationChecks
        .flatMap(({ reasons }) => reasons)
        .find(({ status }) => status === "unknown");
      return {
        certifications: certificationChecks,
        code: unknownReason?.code ?? ("CERTIFICATION_STATUS_UNKNOWN" as const),
        message: "认证记录的状态或有效期证据不完整，结论保持未知。",
        regulation,
        status: "unknown" as const,
      };
    }

    return {
      certifications: certificationChecks,
      code: certificationChecks[0]?.reasons[0]?.code ??
        "CERTIFICATION_INACTIVE",
      message: "已有认证记录，但没有一条同时覆盖状态、场景、功率和有效期。",
      regulation,
      status: "fail" as const,
    };
  });

  let status: ProductFitEvaluation["status"];
  let summary: Check;

  if (!product) {
    status = "unknown";
    summary = check(
      "unknown",
      "PRODUCT_NOT_FOUND",
      "产品未知：数据库中没有该型号，无法判断适配。",
    );
  } else if (
    applicationScopeCheck.status === "fail" ||
    powerCheck.status === "fail"
  ) {
    status = "not_fit";
    summary =
      applicationScopeCheck.status === "fail"
        ? applicationScopeCheck
        : powerCheck;
  } else if (applicableRegulations.length === 0) {
    status = "unknown";
    summary = check(
      "unknown",
      "NO_APPLICABLE_REGULATION_DATA",
      "未找到覆盖该国家、场景、功率和日期的有效法规，不能推断合规。",
    );
  } else if (regulationChecks.some((item) => item.status === "fail")) {
    status = "not_fit";
    const failed = regulationChecks.find((item) => item.status === "fail");
    summary = check(
      "fail",
      failed?.code ?? "CERTIFICATION_INACTIVE",
      failed?.message ?? "认证记录明确不覆盖本次评估条件。",
    );
  } else if (regulationChecks.some((item) => item.status === "unknown")) {
    const unknown = regulationChecks.find((item) => item.status === "unknown");
    status = "unknown";
    summary = check(
      "unknown",
      unknown?.code ?? "CERTIFICATION_MISSING",
      unknown?.message ?? "至少一项适用法规缺少认证证据，结论保持未知。",
    );
  } else {
    status = "fit";
    summary = check(
      "pass",
      "CERTIFICATION_MATCH",
      "产品范围匹配，且每项当前适用法规均有覆盖本次条件的有效认证。",
    );
  }

  const commercialReadiness: ProductFitEvaluation["commercialReadiness"] =
    status === "not_fit" || availabilityCheck.status === "fail"
      ? "not_ready"
      : status === "fit" && availabilityCheck.status === "pass"
        ? "ready"
        : "unknown";

  return productFitEvaluationSchema.parse({
    asOf: query.asOf,
    commercialReadiness,
    input: query,
    product,
    productChecks: {
      applicationScope: applicationScopeCheck,
      availability: availabilityCheck,
      power: powerCheck,
    },
    reasons: [summary],
    regulationChecks,
    rulesetVersion: "product-fit-v2",
    sources: uniqueSources(product, applicableRegulations, certifications),
    status,
  });
}
