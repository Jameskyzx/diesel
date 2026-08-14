import { z } from "zod";

export const governanceWorkflowStatuses = [
  "draft",
  "reviewed",
  "published",
] as const;
export const governanceWorkflowStatusSchema = z.enum(
  governanceWorkflowStatuses,
);

export const applicationScopes = [
  "on-road",
  "non-road",
  "marine",
  "generator-set",
  "agriculture",
  "construction",
  "on-road-truck",
  "on-road-bus",
] as const;

export const applicationScopeSchema = z.enum(applicationScopes);

/**
 * ADR-040：国家数据覆盖状态词表。`none` 是列默认（未设置），`demo`
 * 是虚构 fixture，`planned` 是分层覆盖目标，`no_data` 是目录内明确不
 * 覆盖，`covered` 是已签核真实事实经治理发布后的状态（ADR-042）。
 */
export const dataCoverageStatuses = [
  "none",
  "demo",
  "planned",
  "no_data",
  "covered",
] as const;

export const dataCoverageStatusSchema = z.enum(dataCoverageStatuses);

/**
 * 该覆盖状态是否让国家详情返回 `available`、并在地图上高亮为“有数据”。
 * `demo` fixture 国家与 `covered`（已签核真实事实）可见；`planned` /
 * `no_data` / `none` 的目录国家保持 ADR-029 的精确 no_data 契约
 * （ADR-040/042）。
 */
export function hasDetailedCountryCoverage(status: string): boolean {
  return status === "demo" || status === "covered";
}

export const iso3Schema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/, "ISO3 must contain three uppercase ASCII letters"),
);

export const isoDateSchema = z.iso.date();

export const decimalNumberStringSchema = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/,
    "Number must use decimal notation",
  );

function exactFixedScaleDecimalSchema(input: {
  allowNegative: boolean;
  precision: number;
  scale: number;
}) {
  const maximumIntegerDigits = input.precision - input.scale;
  const notation = input.allowNegative
    ? /^-?\d+(?:\.\d+)?$/
    : /^\d+(?:\.\d+)?$/;

  return z
    .string()
    .trim()
    .min(1)
    .regex(notation, "Value must be a plain decimal string")
    .superRefine((value, context) => {
      const unsigned = value.startsWith("-") ? value.slice(1) : value;
      const [integerPart = "", fractionalPart = ""] = unsigned.split(".");
      const significantIntegerDigits = integerPart.replace(/^0+/, "").length;
      if (Math.max(1, significantIntegerDigits) > maximumIntegerDigits) {
        context.addIssue({
          code: "custom",
          message: `Value exceeds numeric(${input.precision},${input.scale}) integer precision`,
        });
      }
      if (fractionalPart.length > input.scale) {
        context.addIssue({
          code: "custom",
          message: `Value exceeds numeric(${input.precision},${input.scale}) scale`,
        });
      }
    })
    .transform((value) => {
      const negative = value.startsWith("-");
      const unsigned = negative ? value.slice(1) : value;
      const [rawInteger = "0", rawFraction = ""] = unsigned.split(".");
      const integer = rawInteger.replace(/^0+(?=\d)/, "");
      const fraction = rawFraction.padEnd(input.scale, "0");
      const magnitude = `${integer}.${fraction}`;
      const isZero = /^0+\.0+$/.test(magnitude);
      return `${negative && !isZero ? "-" : ""}${magnitude}`;
    });
}

/** PostgreSQL numeric(18,6), retained as an exact canonical string. */
export const regulationLimitDecimalSchema = exactFixedScaleDecimalSchema({
  allowNegative: false,
  precision: 18,
  scale: 6,
});

/** PostgreSQL numeric(24,6), retained as an exact canonical string. */
export const marketMetricDecimalSchema = exactFixedScaleDecimalSchema({
  allowNegative: true,
  precision: 24,
  scale: 6,
});

export const httpUrlSchema = z
  .url()
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "URL must use HTTP or HTTPS",
      });
    }
    if (url.username.length > 0 || url.password.length > 0) {
      context.addIssue({
        code: "custom",
        message: "URL must not include embedded credentials",
      });
    }
  });

export const powerKwSchema = z
  .union([z.number(), decimalNumberStringSchema])
  .transform((value) =>
    typeof value === "number" ? value : Number(value),
  )
  .pipe(
    z
      .number()
      .finite()
      .nonnegative()
      .max(100_000)
      .multipleOf(0.001, {
        message: "Power must use at most three decimal places",
      }),
  );

export const countryQuerySchema = z
  .object({
    iso3: iso3Schema,
  })
  .strict();

export const countryDetailQuerySchema = countryQuerySchema.extend({
  asOf: isoDateSchema.optional(),
});

export const applicableRegulationsQuerySchema = z
  .object({
    applicationScope: applicationScopeSchema,
    asOf: isoDateSchema,
    countryIso3: iso3Schema,
    powerKw: powerKwSchema,
  })
  .strict();

export const productFitQuerySchema = applicableRegulationsQuerySchema
  .extend({
    productModelCode: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .transform((value) => value.toUpperCase()),
  })
  .strict();

/**
 * ADR-010/044：国家详情 URL 的筛选查询参数。全部可选，非 strict
 * （忽略未知键，兼容分析参数）；countryIso3 属于路径参数，不在此处。
 * 参数名与 productFitQuerySchema 保持一致（URL ↔ 请求体同构）。
 */
export const countryDetailFiltersSchema = z.object({
  applicationScope: applicationScopeSchema.optional(),
  asOf: isoDateSchema.optional(),
  powerKw: powerKwSchema.optional(),
  productModelCode: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .transform((value) => value.toUpperCase())
    .optional(),
});

export type ApplicationScope = z.infer<typeof applicationScopeSchema>;
export type ApplicableRegulationsQuery = z.infer<
  typeof applicableRegulationsQuerySchema
>;
export type CountryDetailQuery = z.infer<typeof countryDetailQuerySchema>;
export type CountryQuery = z.infer<typeof countryQuerySchema>;
export type ProductFitQuery = z.infer<typeof productFitQuerySchema>;
