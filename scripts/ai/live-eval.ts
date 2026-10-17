/**
 * Paid live evaluation of the production sales-chat loop.
 *
 *   pnpm ai:eval:live
 *
 * Runs every case in evals/sales-chat-live-cases.ts against the model
 * configured in .env.local, on the fictional PGlite demo database, judges each
 * case with the deterministic rules in src/domain/ai/live-eval.ts and writes a
 * pass-rate report to docs/evals/ai-live-eval-latest.json. A failing case is
 * recorded as a failure and the process exits non-zero; nothing is retried.
 * Raw model text is not stored.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { salesChatLiveCases, SALES_CHAT_LIVE_EVAL_VERSION } from "../../evals/sales-chat-live-cases";
import { captureChatRuntimeContext } from "../../src/domain/ai/chat-runtime-context";
import {
  LIVE_EVAL_CASE_TIMEOUT_MS,
  LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL,
  LIVE_EVAL_MAX_TOKENS,
  evaluateLiveEvalResponseContract,
  judgeLiveEvalCase,
  liveEvalResponseContractAnchorIds,
  resolveLiveEvalResponseDisposition,
  type LiveEvalResultErrorCode,
} from "../../src/domain/ai/live-eval";
import { liveEvalLocaleCitationTitles } from "../../src/domain/ai/live-eval-response-locale";
import { SALES_CHAT_SYSTEM_PROMPT_VERSION } from "../../src/features/ai/constants";
import { aiToolNameSchema } from "../../src/features/ai/schemas";
import { matchesExpectedLiveEvalReportArgs, sanitizeLiveEvalReportArgs } from "./live-eval-report-args";

process.env.DATABASE_MODE = "pglite-demo";
process.env.PORTFOLIO_DEMO_MODE = "false";
process.env.AI_CHAT_RATE_LIMIT_BACKEND = "memory";
process.env.AI_INCLUDE_USAGE = "true";
if (!process.env.NODE_ENV) Reflect.set(process.env, "NODE_ENV", "development");

export const LIVE_EVAL_REPORT_PATH = "docs/evals/ai-live-eval-latest.json";

type CaseReport = {
  id: string;
  locale: string;
  safetyCritical: boolean;
  pass: boolean;
  mismatchReason: string | null;
  expectedTools: readonly string[];
  toolSequence: string[];
  responseDisposition: string;
  missingResponseAnchorIds: string[];
  totalTokens: number | null;
  latencyMs: number;
};

function sameTools(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && actual.every((tool, index) => tool === expected[index]);
}

export async function runLiveEval() {
  const [
    { aiToolResultSchema },
    { buildSalesChatEvidenceContract, evidenceContractAllowsModelText },
    { buildEvidenceGapResponse, createSalesChatTools, streamSalesChat },
    { getConfiguredAiModel },
    { getDemoDatabase },
  ] = await Promise.all([
    import("../../src/features/ai/schemas"),
    import("../../src/server/ai/evidence-contract"),
    import("../../src/server/ai/sales-chat"),
    import("../../src/server/ai/model"),
    import("../../src/server/db/demo-client"),
  ]);
  await getDemoDatabase();
  const { model, modelId, providerProfile } = getConfiguredAiModel();

  const cases: CaseReport[] = [];
  let totalTokens = 0;
  let stoppedForBudget = false;

  for (const testCase of salesChatLiveCases) {
    // The budget is checked after each case: usage is only known once a call ends.
    if (totalTokens >= LIVE_EVAL_MAX_TOKENS) { stoppedForBudget = true; break; }
    const startedAt = performance.now();
    const runtimeContext = captureChatRuntimeContext();
    const auditRepository = { recordToolCall: async () => undefined };
    const contract = buildSalesChatEvidenceContract({ runtimeContext, selectedCountryIso3: testCase.selectedCountryIso3, userTexts: testCase.userTexts });
    const sessionId = crypto.randomUUID();
    const turnId = `live-eval-${testCase.id}`;
    let streamFailed = false;
    let boundaryRejected = false;
    let errorCode: LiveEvalResultErrorCode | null = null;
    let report: Omit<CaseReport, "latencyMs">;

    try {
      const tools = createSalesChatTools({ auditRepository, runtimeContext, ...(contract.asOf ? { defaultAsOf: contract.asOf } : {}),
        selectedCountryIso3: testCase.selectedCountryIso3, sessionId, turnId });
      const generated = streamSalesChat({
        abortSignal: AbortSignal.timeout(LIVE_EVAL_CASE_TIMEOUT_MS), auditRepository, runtimeContext, locale: testCase.locale,
        maxOutputTokens: LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL, maxRetries: 0,
        messages: testCase.userTexts.map(text => ({ content: text, role: "user" as const })),
        model, onStreamError: () => { streamFailed = true; }, onBoundaryRejection: () => { boundaryRejected = true; },
        selectedCountryIso3: testCase.selectedCountryIso3, sessionId, tools, trustedUserTexts: testCase.userTexts, turnId,
      });
      const [responseText, toolCalls, toolResults, usage] = await Promise.all([generated.text, generated.toolCalls, generated.toolResults, generated.usage]);
      if (streamFailed) throw new Error("The provider stream reported an execution failure.");
      const caseTokens = usage.totalTokens ?? null;
      totalTokens += caseTokens ?? 0;

      const toolSequence = toolCalls.map(({ toolName }) => toolName);
      const normalizedArgs = toolCalls.map(call => {
        const tool = aiToolNameSchema.parse(call.toolName);
        return { tool, args: sanitizeLiveEvalReportArgs({ args: call.input, tool, knowledgeQueryContract: testCase.knowledgeQueryContract,
          invalid: ("invalid" in call && call.invalid === true) || ("dynamic" in call && call.dynamic === true) }) };
      });
      const argsPassed = Object.entries(testCase.expectedArgs).every(([toolName, expected]) => {
        const call = normalizedArgs.find(candidate => candidate.tool === toolName);
        return call !== undefined && expected !== undefined && matchesExpectedLiveEvalReportArgs({ actual: call.args, expected,
          runtimeContext, knowledgeQueryContract: testCase.knowledgeQueryContract, tool: call.tool });
      });
      const parsedResults = toolResults.flatMap(({ output }) => { const parsed = aiToolResultSchema.safeParse(output); return parsed.success ? [parsed.data] : []; });
      const evidenceAllowed = evidenceContractAllowsModelText(contract, parsedResults);
      if (boundaryRejected || toolResults.length !== toolCalls.length || toolResults.length !== parsedResults.length ||
        parsedResults.some(({ status }) => status === "error")) errorCode = "TOOL_RESULT_ERROR";

      const allSufficient = parsedResults.length > 0 && parsedResults.every(result => result.status === "ok" && result.evidenceSufficient);
      const responseDisposition = resolveLiveEvalResponseDisposition({ errorCode, responseText,
        ...(testCase.expectedEvidenceAllowed ? {} : { requiredEvidenceBoundaryText: buildEvidenceGapResponse(parsedResults, allSufficient && !evidenceAllowed, false, testCase.locale) }) });
      const observation = errorCode === null
        ? evaluateLiveEvalResponseContract({ expectedLocale: testCase.locale, responseContract: testCase.responseContract, responseText,
          localeEvidenceTitles: liveEvalLocaleCitationTitles({ evidenceAllowed, toolResults: parsedResults }) })
        : { missingResponseAnchorIds: liveEvalResponseContractAnchorIds(testCase.responseContract), responseGroundingPassed: false, responseLocalePassed: false };
      const judgement = judgeLiveEvalCase({ argsPassed, errorCode, evidenceAllowed, expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        responseDisposition, responseGroundingPassed: observation.responseGroundingPassed, responseLocalePassed: observation.responseLocalePassed,
        safetyCritical: testCase.safetyCritical, tokenUsageComplete: caseTokens !== null, toolSelectionPassed: sameTools(toolSequence, testCase.expectedTools) });
      report = { id: testCase.id, locale: testCase.locale, safetyCritical: testCase.safetyCritical, pass: judgement.pass,
        mismatchReason: judgement.mismatchReason, expectedTools: testCase.expectedTools, toolSequence, responseDisposition,
        missingResponseAnchorIds: observation.missingResponseAnchorIds, totalTokens: caseTokens };
    } catch (error) {
      report = { id: testCase.id, locale: testCase.locale, safetyCritical: testCase.safetyCritical, pass: false,
        mismatchReason: `error:${error instanceof Error ? error.name : "UnknownError"}`, expectedTools: testCase.expectedTools,
        toolSequence: [], responseDisposition: "not_evaluated", missingResponseAnchorIds: liveEvalResponseContractAnchorIds(testCase.responseContract), totalTokens: null };
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    cases.push({ ...report, latencyMs });
    process.stdout.write(`${report.pass ? "PASS" : "FAIL"}  ${testCase.id}${report.mismatchReason ? `  (${report.mismatchReason})` : ""}  ${latencyMs} ms\n`);
  }

  const passed = cases.filter(item => item.pass).length;
  const result = {
    version: SALES_CHAT_LIVE_EVAL_VERSION,
    runAt: new Date().toISOString(),
    modelId, providerProfile, promptVersion: SALES_CHAT_SYSTEM_PROMPT_VERSION,
    summary: {
      cases: salesChatLiveCases.length, evaluated: cases.length, passed,
      passRatePct: Math.round((passed / salesChatLiveCases.length) * 1000) / 10,
      safetyCriticalFailed: cases.filter(item => item.safetyCritical && !item.pass).length,
      totalTokens, tokenBudget: LIVE_EVAL_MAX_TOKENS, stoppedForBudget,
    },
    cases,
  };
  const path = resolve(process.cwd(), LIVE_EVAL_REPORT_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`\n${passed}/${salesChatLiveCases.length} passed · ${totalTokens} tokens${stoppedForBudget ? " · stopped at token budget" : ""} · report: ${LIVE_EVAL_REPORT_PATH}\n`);
  if (passed !== salesChatLiveCases.length) process.exitCode = 1;
}

// Importing the module (tests) must not start a paid run. Scripts run as CommonJS
// under tsx, so this uses the entry path rather than top-level await/import.meta.
if (/[\\/]scripts[\\/]ai[\\/]live-eval\.ts$/u.test(process.argv[1] ?? "")) {
  runLiveEval().catch((error: unknown) => {
    process.stderr.write(`Live eval failed to run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
