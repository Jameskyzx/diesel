/**
 * Paid live evaluation of the production sales-chat loop.
 *
 *   pnpm ai:eval:live
 *
 * Runs every case in evals/sales-chat-live-cases.ts through the production
 * harness loop (catalogHarnessResponse) with the model configured in
 * .env.local, on the fictional PGlite demo database. Multi-turn cases are sent
 * turn by turn with the signed receipt, as the browser does. Each case is
 * judged with the deterministic rules in src/domain/ai/live-eval.ts; the
 * required evidence is derived independently from the user's text. The
 * pass-rate report goes to docs/evals/ai-live-eval-latest.json. A failing case
 * is recorded as a failure and the process exits non-zero; nothing is retried.
 * Raw model text is not stored.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { salesChatLiveCases, SALES_CHAT_LIVE_EVAL_VERSION } from "../../evals/sales-chat-live-cases";
import { captureChatRuntimeContext } from "../../src/domain/ai/chat-runtime-context";
import {
  LIVE_EVAL_CASE_TIMEOUT_MS,
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

type StreamPart = { type: string; toolCallId?: string; toolName?: string; input?: unknown; output?: unknown; delta?: string; messageMetadata?: unknown };

async function readUiStream(response: Response): Promise<StreamPart[]> {
  const body = await response.text();
  return body.split("\n").flatMap(line => {
    if (!line.startsWith("data: {")) return [];
    try { return [JSON.parse(line.slice(6)) as StreamPart]; } catch { return []; }
  });
}

export async function runLiveEval() {
  const [
    { aiToolResultSchema },
    { buildSalesChatEvidenceContract, evidenceContractAllowsModelText },
    { createSalesChatTools },
    { catalogHarnessResponse },
    { verifyConversationReceipt },
    { readConversationMetadata },
    { buildEvidenceGapResponse },
    { getConfiguredAiModel },
    { getDemoDatabase },
  ] = await Promise.all([
    import("../../src/features/ai/schemas"),
    import("../../src/server/ai/evidence-contract"),
    import("../../src/server/ai/sales-chat"),
    import("../../src/server/ai/catalog-harness"),
    import("../../src/server/ai/conversation-receipt"),
    import("../../src/features/ai/conversation-state"),
    import("../../src/domain/ai/evidence-gap-response"),
    import("../../src/server/ai/model"),
    import("../../src/server/db/demo-client"),
  ]);
  await getDemoDatabase();
  const { model, modelId, providerProfile } = getConfiguredAiModel();
  type TurnSummary = Parameters<NonNullable<Parameters<typeof catalogHarnessResponse>[0]["onTurnComplete"]>>[0];

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
    let errorCode: LiveEvalResultErrorCode | null = null;
    let report: Omit<CaseReport, "latencyMs">;
    let caseTokens: number | null = 0;

    try {
      const signal = AbortSignal.timeout(LIVE_EVAL_CASE_TIMEOUT_MS);
      let previous: ReturnType<typeof verifyConversationReceipt> = null;
      let parts: StreamPart[] = [];
      let summary: TurnSummary | null = null;
      for (const [turn, userText] of testCase.userTexts.entries()) {
        summary = null;
        const tools = createSalesChatTools({ auditRepository, runtimeContext, selectedCountryIso3: testCase.selectedCountryIso3,
          sessionId, turnId: `live-eval-${testCase.id}-${turn}` });
        const response = catalogHarnessResponse({ model, tools, signal, locale: testCase.locale, today: runtimeContext.utcDate,
          userText, messages: [{ role: "user", content: userText }], previous, sessionId,
          selectedCountryIso3: testCase.selectedCountryIso3, requestId: crypto.randomUUID(),
          onStepUsage: usage => { caseTokens = caseTokens === null || usage.totalTokens === undefined ? null : caseTokens + usage.totalTokens; },
          onTurnComplete: value => { summary = value; } });
        parts = await readUiStream(response);
        const receipt = readConversationMetadata(parts.findLast(part => part.type === "finish")?.messageMetadata)?.conversation.receipt;
        previous = verifyConversationReceipt(receipt, { sessionId, selectedCountryIso3: testCase.selectedCountryIso3, previousUserText: userText });
      }
      const turnSummary = summary as TurnSummary | null;
      if (!turnSummary) throw new Error("The harness did not report a completed turn.");
      totalTokens += caseTokens ?? 0;

      const toolCalls = parts.filter(part => part.type === "tool-input-available");
      const outputs = parts.filter(part => part.type === "tool-output-available" || part.type === "tool-output-error");
      const toolSequence = toolCalls.map(({ toolName }) => toolName ?? "unknown");
      const normalizedArgs = toolCalls.flatMap(call => {
        const tool = aiToolNameSchema.safeParse(call.toolName);
        return tool.success ? [{ tool: tool.data, args: sanitizeLiveEvalReportArgs({ args: call.input, tool: tool.data,
          knowledgeQueryContract: testCase.knowledgeQueryContract }) }] : [];
      });
      const argsPassed = Object.entries(testCase.expectedArgs).every(([toolName, expected]) => {
        const call = normalizedArgs.find(candidate => candidate.tool === toolName);
        return call !== undefined && expected !== undefined && matchesExpectedLiveEvalReportArgs({ actual: call.args, expected,
          runtimeContext, knowledgeQueryContract: testCase.knowledgeQueryContract, tool: call.tool });
      });
      const parsedResults = outputs.flatMap(({ output }) => { const parsed = aiToolResultSchema.safeParse(output); return parsed.success ? [parsed.data] : []; });
      const evidenceAllowed = evidenceContractAllowsModelText(contract, parsedResults);
      if (!turnSummary.completed || outputs.length !== toolCalls.length || outputs.length !== parsedResults.length ||
        parsedResults.some(({ status }) => status === "error")) errorCode = "TOOL_RESULT_ERROR";

      const responseText = turnSummary.text;
      // In the harness the narrative cannot carry facts; a denied case fails
      // closed when every insufficient result's evidence-gap text is rendered.
      const gapTexts = turnSummary.evidence.filter(({ result }) => !(result.status === "ok" && result.evidenceSufficient))
        .map(({ result }) => buildEvidenceGapResponse([result], result.status === "error", false, testCase.locale));
      const responseDisposition = testCase.expectedEvidenceAllowed || errorCode !== null
        ? resolveLiveEvalResponseDisposition({ errorCode, responseText })
        : responseText.trim().length === 0 ? "empty" as const
          : gapTexts.length > 0 && gapTexts.every(text => responseText.includes(text)) ? "whole_request_refusal" as const : "answered" as const;
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
