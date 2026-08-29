import { z } from "zod";

import {
  LIVE_EVAL_RESPONSE_DISPOSITIONS,
  liveEvalResponseDispositionPassed,
  recomputeLiveEvalCaseTokenUsage,
} from "../../src/domain/ai/live-eval";
import {
  findCompatibleProductsInputSchema,
  getCountryProfileInputSchema,
  searchKnowledgeBaseInputSchema,
} from "../../src/features/ai/schemas";
import {
  calculateOpportunityScoreInputSchema,
  compareMarketsInputSchema,
  compareRegulationsInputSchema,
  generateSalesBriefInputSchema,
} from "../../src/features/marketing/schemas";
import { SAFE_LIVE_EVAL_ERROR_NAMES } from "../ai/live-eval-error";

const liveEvalToolNameSchema = z.enum([
  "calculateOpportunityScore",
  "compareMarkets",
  "compareRegulations",
  "findCompatibleProducts",
  "generateSalesBrief",
  "getCountryProfile",
  "searchKnowledgeBase",
]);
const liveEvalAllowedArgKeys = new Set([
  "applicationScope",
  "asOf",
  "countryIso3",
  "countryIso3s",
  "jurisdictionId",
  "limit",
  "metricCodes",
  "powerKw",
  "productModelCode",
  "query",
  "targetCountryIso3",
  "topics",
]);
const sanitizedLiveEvalArgsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((args, context) => {
    for (const key of Object.keys(args)) {
      if (!liveEvalAllowedArgKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Unexpected live-eval argument key: ${key}.`,
        });
      }
    }
  });
const safeEvalFailureMessageSchema = z
  .string()
  .regex(
    new RegExp(
      `^(?:${SAFE_LIVE_EVAL_ERROR_NAMES.join("|")})(?: \\(HTTP [45]\\d{2}\\))?: Eval case execution failed\\.$`,
      "u",
    ),
  )
  .nullable();
const liveEvalToolInputSchemas = {
  calculateOpportunityScore: calculateOpportunityScoreInputSchema,
  compareMarkets: compareMarketsInputSchema,
  compareRegulations: compareRegulationsInputSchema,
  findCompatibleProducts: findCompatibleProductsInputSchema,
  generateSalesBrief: generateSalesBriefInputSchema,
  getCountryProfile: getCountryProfileInputSchema,
  searchKnowledgeBase: searchKnowledgeBaseInputSchema,
} as const;
const liveEvalNormalizedArgSchema = z
  .object({
    args: sanitizedLiveEvalArgsSchema,
    tool: liveEvalToolNameSchema,
  })
  .strict()
  .superRefine((call, context) => {
    const parsed = liveEvalToolInputSchemas[call.tool].safeParse(call.args);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: `Invalid normalized arguments for ${call.tool}.`,
        path: ["args"],
      });
    }
  });

export const liveEvalResultSchema = z
  .object({
    argsPassed: z.boolean(),
    errorCode: z.enum(["EVAL_CASE_ERROR", "TOOL_RESULT_ERROR"]).nullable(),
    evidenceAllowed: z.boolean(),
    evidenceExpectationPassed: z.boolean(),
    evidenceResult: z.enum(["sufficient", "insufficient", "error"]),
    expectedEvidenceAllowed: z.boolean(),
    failureMessage: safeEvalFailureMessageSchema,
    id: z.string().min(1),
    latencyMs: z.number().int().nonnegative(),
    loopSteps: z.number().int().nonnegative(),
    mismatchReason: z.string().min(1).nullable(),
    normalizedArgs: z.array(liveEvalNormalizedArgSchema),
    pass: z.boolean(),
    responseCharacterCount: z.number().int().nonnegative(),
    responseDisposition: z.enum(LIVE_EVAL_RESPONSE_DISPOSITIONS),
    responseDispositionPassed: z.boolean(),
    safetyCritical: z.boolean(),
    safetyPassed: z.boolean().nullable(),
    tokenUsage: z
      .object({
        input: z.number().int().nonnegative().nullable(),
        ledger: z.array(
          z
            .object({
              input: z.number().int().nonnegative().nullable(),
              output: z.number().int().nonnegative().nullable(),
              total: z.number().int().nonnegative().nullable(),
            })
            .strict(),
        ),
        output: z.number().int().nonnegative().nullable(),
        total: z.number().int().nonnegative().nullable(),
        usageComplete: z.boolean(),
      })
      .strict(),
    toolBearingSteps: z.number().int().nonnegative(),
    toolSelectionPassed: z.boolean(),
    toolSequence: z.array(liveEvalToolNameSchema),
  })
  .strict()
  .superRefine((result, context) => {
    const expectsFailureMessage = result.errorCode === "EVAL_CASE_ERROR";
    if (expectsFailureMessage !== (result.failureMessage !== null)) {
      context.addIssue({
        code: "custom",
        message:
          "failureMessage must be present only for EVAL_CASE_ERROR results.",
        path: ["failureMessage"],
      });
    }
    const completed = result.errorCode === null;
    const expectedDispositionPassed = liveEvalResponseDispositionPassed({
      completed,
      expectedEvidenceAllowed: result.expectedEvidenceAllowed,
      responseDisposition: result.responseDisposition,
    });
    if (result.responseDispositionPassed !== expectedDispositionPassed) {
      context.addIssue({
        code: "custom",
        message: "responseDispositionPassed does not match the safe classification.",
        path: ["responseDispositionPassed"],
      });
    }
    if (!completed && result.responseDisposition !== "not_evaluated") {
      context.addIssue({
        code: "custom",
        message: "Errored cases must not claim an evaluated response disposition.",
        path: ["responseDisposition"],
      });
    }
    if (completed && result.responseDisposition === "not_evaluated") {
      context.addIssue({
        code: "custom",
        message: "Completed cases require an evaluated response disposition.",
        path: ["responseDisposition"],
      });
    }
    if (
      completed &&
      (result.responseCharacterCount === 0) !==
        (result.responseDisposition === "empty")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "responseCharacterCount must agree with the empty response disposition.",
        path: ["responseCharacterCount"],
      });
    }
    const recomputedTokenUsage = recomputeLiveEvalCaseTokenUsage({
      aggregate: result.tokenUsage,
      ledger: result.tokenUsage.ledger,
      loopSteps: result.loopSteps,
      modelStreamCompleted: result.errorCode !== "EVAL_CASE_ERROR",
    }).tokenUsage;
    if (
      result.tokenUsage.usageComplete !== recomputedTokenUsage.usageComplete
    ) {
      context.addIssue({
        code: "custom",
        message: "tokenUsage.usageComplete does not match the token ledger.",
        path: ["tokenUsage", "usageComplete"],
      });
    }
  });
