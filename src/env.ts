import "server-only";

import { z } from "zod";

const optionalTrimmedString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalBoolean = z.preprocess(
  (value) => {
    if (value === "") {
      return undefined;
    }
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return value;
  },
  z.boolean().optional(),
);

const optionalAiAdmissionUnitLimit = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce
    .number()
    .int()
    .min(5)
    .max(2_000_000_000)
    .refine((value) => value % 5 === 0, {
      message: "AI admission unit limits must be multiples of 5.",
    })
    .optional(),
);

const serverEnvSchema = z.object({
  AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY:
    optionalAiAdmissionUnitLimit,
  AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY:
    optionalAiAdmissionUnitLimit,
  AI_CHAT_RATE_LIMIT_BACKEND: z
    .enum(["memory", "postgres"])
    .optional(),
  AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce
      .number()
      .int()
      .positive()
      .max(10_000)
      .default(10_000),
  ),
  AI_CHAT_RATE_LIMIT_PER_HOUR: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce
      .number()
      .int()
      .positive()
      .max(10_000)
      .default(30),
  ),
  AI_COST_PROFILE_JSON: optionalTrimmedString,
  AI_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().min(1).max(4_096).optional(),
  ),
  AI_BASE_URL: optionalTrimmedString,
  AI_ENABLE_THINKING: optionalBoolean,
  AI_INCLUDE_USAGE: optionalBoolean.default(false),
  AI_MODEL: optionalTrimmedString,
  AI_MULTIMODAL_MODEL: optionalTrimmedString,
  AI_PROVIDER: z.enum(["openai-compatible"]).default("openai-compatible"),
  APP_VERSION: z.string().trim().min(1).default("dev"),
  COUNTRY_STALE_AFTER_DAYS: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce
      .number()
      .int()
      .positive()
      .max(3650)
      .default(90),
  ),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORTFOLIO_DEMO_MODE: optionalBoolean.default(false),
  KNOWLEDGE_STORAGE_ROOT: z
    .string()
    .trim()
    .min(1)
    .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/)
    .refine(
      (value) => !value.split("/").includes(".."),
      "KNOWLEDGE_STORAGE_ROOT must be a safe subdirectory under .data",
    )
    .default("knowledge"),
});

export const env = serverEnvSchema.parse({
  AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY:
    process.env.AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY,
  AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY:
    process.env.AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY,
  AI_CHAT_RATE_LIMIT_BACKEND: process.env.AI_CHAT_RATE_LIMIT_BACKEND,
  AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR:
    process.env.AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR,
  AI_CHAT_RATE_LIMIT_PER_HOUR: process.env.AI_CHAT_RATE_LIMIT_PER_HOUR,
  AI_COST_PROFILE_JSON: process.env.AI_COST_PROFILE_JSON,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_ENABLE_THINKING: process.env.AI_ENABLE_THINKING,
  AI_INCLUDE_USAGE: process.env.AI_INCLUDE_USAGE,
  AI_MODEL: process.env.AI_MODEL,
  AI_MULTIMODAL_MODEL: process.env.AI_MULTIMODAL_MODEL,
  AI_PROVIDER: process.env.AI_PROVIDER,
  APP_VERSION: process.env.APP_VERSION,
  COUNTRY_STALE_AFTER_DAYS: process.env.COUNTRY_STALE_AFTER_DAYS,
  KNOWLEDGE_STORAGE_ROOT: process.env.KNOWLEDGE_STORAGE_ROOT,
  NODE_ENV: process.env.NODE_ENV,
  PORTFOLIO_DEMO_MODE: process.env.PORTFOLIO_DEMO_MODE,
});
