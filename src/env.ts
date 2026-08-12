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

const serverEnvSchema = z.object({
  AI_CHAT_RATE_LIMIT_PER_HOUR: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce
      .number()
      .int()
      .positive()
      .max(10_000)
      .default(30),
  ),
  AI_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().min(1).max(4_096).optional(),
  ),
  AI_BASE_URL: optionalTrimmedString,
  AI_ENABLE_THINKING: optionalBoolean,
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
  AI_CHAT_RATE_LIMIT_PER_HOUR: process.env.AI_CHAT_RATE_LIMIT_PER_HOUR,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_ENABLE_THINKING: process.env.AI_ENABLE_THINKING,
  AI_MODEL: process.env.AI_MODEL,
  AI_MULTIMODAL_MODEL: process.env.AI_MULTIMODAL_MODEL,
  AI_PROVIDER: process.env.AI_PROVIDER,
  APP_VERSION: process.env.APP_VERSION,
  COUNTRY_STALE_AFTER_DAYS: process.env.COUNTRY_STALE_AFTER_DAYS,
  KNOWLEDGE_STORAGE_ROOT: process.env.KNOWLEDGE_STORAGE_ROOT,
  NODE_ENV: process.env.NODE_ENV,
  PORTFOLIO_DEMO_MODE: process.env.PORTFOLIO_DEMO_MODE,
});
