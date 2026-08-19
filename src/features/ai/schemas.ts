import { z } from "zod";

import { defaultLocale, locales } from "@/i18n/locale";

import { countryDetailResponseSchema } from "@/features/countries/schemas";
import {
  applicationScopeSchema,
  httpUrlSchema,
  iso3Schema,
  isoDateSchema,
  powerKwSchema,
} from "@/features/database/schemas";
import { hybridSearchResponseSchema } from "@/features/knowledge/schemas";
import {
  calculateOpportunityScoreInputSchema,
  compareMarketsInputSchema,
  compareRegulationsInputSchema,
  generateSalesBriefInputSchema,
  marketComparisonSchema,
  opportunityScorecardSchema,
  regulationComparisonSchema,
  salesBriefSchema,
} from "@/features/marketing/schemas";
import { productFitEvaluationSchema } from "@/features/product-fit/schemas";

const isoTimestampSchema = z.iso.datetime({ offset: true });
const optionalCountrySchema = z
  .union([iso3Schema, z.null()])
  .optional()
  .describe(
    "ISO 3166-1 alpha-3 country code. Omit only when the map-selected country should be used.",
  );

const blockedAiEndpointHostnames = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google.com",
]);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

export const userAiConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(4_096),
    baseUrl: z
      .string()
      .trim()
      .url()
      .max(300)
      .superRefine((value, context) => {
        const url = new URL(value);
        const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        const isIpv6 = hostname.includes(":");
        const blockedByName =
          blockedAiEndpointHostnames.has(hostname) ||
          hostname.endsWith(".localhost") ||
          hostname.endsWith(".local") ||
          hostname.endsWith(".internal");

        if (url.protocol !== "https:") {
          context.addIssue({
            code: "custom",
            message: "AI 接口地址必须使用 HTTPS。",
          });
        }
        if (blockedByName || isPrivateIpv4(hostname) || isIpv6) {
          context.addIssue({
            code: "custom",
            message: "AI 接口地址必须是公开的 HTTPS 地址。",
          });
        }
        if (url.username || url.password) {
          context.addIssue({
            code: "custom",
            message: "AI 接口地址不能包含账号或密码。",
          });
        }
      })
      .transform((value) => value.replace(/\/+$/, "")),
    enableThinking: z.boolean().optional(),
    model: z.string().trim().min(1).max(160),
  })
  .strict();

export const countryProfileTopics = [
  "country",
  "regulations",
  "market",
] as const;
export const countryProfileTopicSchema = z.enum(countryProfileTopics);

export const aiToolNames = [
  "searchKnowledgeBase",
  "getCountryProfile",
  "findCompatibleProducts",
  "compareRegulations",
  "compareMarkets",
  "calculateOpportunityScore",
  "generateSalesBrief",
] as const;

export const aiToolNameSchema = z.enum(aiToolNames);

export const aiCitationSchema = z
  .object({
    chunkId: z.uuid().nullable(),
    countryIso3: z.union([iso3Schema, z.null()]),
    documentId: z.uuid().nullable(),
    documentTitle: z.string().nullable(),
    isDemo: z.boolean(),
    locator: z.string().nullable(),
    pageFrom: z.number().int().positive().nullable(),
    pageTo: z.number().int().positive().nullable(),
    productCertificationId: z.uuid().nullable(),
    publishedOn: z.union([isoDateSchema, z.null()]),
    regulationId: z.uuid().nullable(),
    regulationStatus: z
      .enum(["proposed", "adopted", "effective", "superseded"])
      .nullable(),
    sectionLocator: z.string().nullable(),
    sourceId: z.uuid(),
    sourceTitle: z.string().trim().min(1),
    sourceUrl: httpUrlSchema.nullable(),
    title: z.string().trim().min(1),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

const toolResultBase = z.object({
  citations: z.array(aiCitationSchema),
  evidenceSufficient: z.boolean(),
  informationAsOf: isoDateSchema,
  latestVerifiedAt: isoTimestampSchema.nullable(),
  status: z.enum(["ok", "no_data", "error"]),
  warnings: z.array(z.string()),
});

export const searchKnowledgeBaseInputSchema = z
  .object({
    applicationScope: z
      .union([applicationScopeSchema, z.null()])
      .optional()
      .describe("Optional diesel-engine application scope metadata filter."),
    asOf: z
      .union([isoDateSchema, z.null()])
      .optional()
      .describe("Optional YYYY-MM-DD validity-date filter."),
    countryIso3: optionalCountrySchema,
    jurisdictionId: z
      .union([z.uuid(), z.null()])
      .optional()
      .describe("Optional jurisdiction UUID metadata filter."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe("Maximum evidence chunks to return."),
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("Search terms for source-document evidence."),
  })
  .strict();

export const getCountryProfileInputSchema = z
  .object({
    asOf: isoDateSchema
      .optional()
      .describe("YYYY-MM-DD date used to classify current and future rules."),
    countryIso3: optionalCountrySchema,
    topics: z
      .array(countryProfileTopicSchema)
      .min(1)
      .max(countryProfileTopics.length)
      .refine(
        (topics) => new Set(topics).size === topics.length,
        "topics must not contain duplicates",
      )
      .describe(
        "Required evidence topics for this question: country, regulations, and/or market.",
      ),
  })
  .strict();

export const findCompatibleProductsInputSchema = z
  .object({
    applicationScope: applicationScopeSchema.describe(
      "Required diesel-engine application scope.",
    ),
    asOf: isoDateSchema.describe(
      "YYYY-MM-DD date used for regulation and certification validity.",
    ),
    countryIso3: optionalCountrySchema,
    powerKw: powerKwSchema.describe("Required engine power in kW."),
    productModelCode: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .transform((value) => value.toUpperCase())
      .optional()
      .describe(
        "Optional exact product model code. When supplied, evaluate only that product instead of the full catalog.",
      ),
  })
  .strict();

export const searchKnowledgeBaseResultSchema = toolResultBase
  .extend({
    resolvedCountryIso3: z.union([iso3Schema, z.null()]),
    search: hybridSearchResponseSchema,
    tool: z.literal("searchKnowledgeBase"),
  })
  .strict();

export const getCountryProfileResultSchema = toolResultBase
  .extend({
    profile: countryDetailResponseSchema.nullable(),
    requestedTopics: z.array(countryProfileTopicSchema).min(1),
    resolvedCountryIso3: z.union([iso3Schema, z.null()]),
    tool: z.literal("getCountryProfile"),
  })
  .strict();

export const findCompatibleProductsResultSchema = toolResultBase
  .extend({
    evaluations: z.array(productFitEvaluationSchema),
    query: z
      .object({
        applicationScope: applicationScopeSchema,
        asOf: isoDateSchema,
        countryIso3: z.union([iso3Schema, z.null()]),
        powerKw: z.number().finite().nonnegative(),
        productModelCode: z.string().trim().min(1).max(100).optional(),
      })
      .strict(),
    tool: z.literal("findCompatibleProducts"),
  })
  .strict();

export const compareRegulationsResultSchema = toolResultBase
  .extend({
    comparison: regulationComparisonSchema,
    tool: z.literal("compareRegulations"),
  })
  .strict();

export const compareMarketsResultSchema = toolResultBase
  .extend({
    comparison: marketComparisonSchema,
    tool: z.literal("compareMarkets"),
  })
  .strict();

export const calculateOpportunityScoreResultSchema = toolResultBase
  .extend({
    scorecard: opportunityScorecardSchema,
    tool: z.literal("calculateOpportunityScore"),
  })
  .strict();

export const generateSalesBriefResultSchema = toolResultBase
  .extend({
    brief: salesBriefSchema,
    tool: z.literal("generateSalesBrief"),
  })
  .strict();

export const aiToolResultSchema = z.discriminatedUnion("tool", [
  searchKnowledgeBaseResultSchema,
  getCountryProfileResultSchema,
  findCompatibleProductsResultSchema,
  compareRegulationsResultSchema,
  compareMarketsResultSchema,
  calculateOpportunityScoreResultSchema,
  generateSalesBriefResultSchema,
]);

export const chatRequestSchema = z
  .object({
    // AI SDK DefaultChatTransport 信封字段（非业务输入，忽略但允许）。
    id: z.string().trim().min(1).max(100).optional(),
    locale: z.enum(locales).optional().default(defaultLocale),
    messages: z.array(z.unknown()).min(1).max(40),
    messageId: z.string().trim().min(1).max(100).optional(),
    selectedCountryIso3: z
      .union([iso3Schema, z.null()])
      .optional()
      .default(null),
    sessionId: z.uuid(),
    trigger: z.string().trim().min(1).max(50).optional(),
  })
  .strict();

export const chatApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum([
          "INVALID_INPUT",
          "PAYLOAD_TOO_LARGE",
          "REQUEST_TIMEOUT",
          "AI_NOT_CONFIGURED",
          "RATE_LIMITED",
          "INTERNAL_ERROR",
        ]),
        message: z.string(),
      })
      .strict(),
  })
  .strict();

export type AiCitation = z.infer<typeof aiCitationSchema>;
export type UserAiConfig = z.infer<typeof userAiConfigSchema>;
export type AiToolName = z.infer<typeof aiToolNameSchema>;
export type AiToolResult = z.infer<typeof aiToolResultSchema>;
export type CalculateOpportunityScoreInput = z.infer<
  typeof calculateOpportunityScoreInputSchema
>;
export type CalculateOpportunityScoreResult = z.infer<
  typeof calculateOpportunityScoreResultSchema
>;
export type CompareMarketsInput = z.infer<
  typeof compareMarketsInputSchema
>;
export type CompareMarketsResult = z.infer<
  typeof compareMarketsResultSchema
>;
export type CompareRegulationsInput = z.infer<
  typeof compareRegulationsInputSchema
>;
export type CompareRegulationsResult = z.infer<
  typeof compareRegulationsResultSchema
>;
export type FindCompatibleProductsInput = z.infer<
  typeof findCompatibleProductsInputSchema
>;
export type FindCompatibleProductsResult = z.infer<
  typeof findCompatibleProductsResultSchema
>;
export type GetCountryProfileInput = z.infer<
  typeof getCountryProfileInputSchema
>;
export type GetCountryProfileResult = z.infer<
  typeof getCountryProfileResultSchema
>;
export type GenerateSalesBriefInput = z.infer<
  typeof generateSalesBriefInputSchema
>;
export type GenerateSalesBriefResult = z.infer<
  typeof generateSalesBriefResultSchema
>;
export type SearchKnowledgeBaseInput = z.infer<
  typeof searchKnowledgeBaseInputSchema
>;
export type SearchKnowledgeBaseResult = z.infer<
  typeof searchKnowledgeBaseResultSchema
>;
