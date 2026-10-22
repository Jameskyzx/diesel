import "server-only";

import { MockLanguageModelV4 } from "ai/test";

import { demoExtractFeedback } from "@/domain/feedback/demo-extraction";

const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Offline stand-in for the extraction model in `pnpm demo` and tests. It reads
 * only the text parts of the request and answers through the same
 * `record_feedback` tool a real provider uses.
 */
export function createFeedbackDemoModel() {
  return new MockLanguageModelV4({
    modelId: "feedback-demo-v1",
    provider: "portfolio-demo",
    doGenerate: async (options) => {
      const text = (options.prompt as readonly unknown[])
        .flatMap(message => isRecord(message) && message.role === "user" && Array.isArray(message.content) ? message.content : [])
        .flatMap((part: unknown) => isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])
        .join("\n")
        .replace(/^\[(?:BEGIN|END) [^\]]*\]$/gmu, "");
      return {
        warnings: [],
        usage,
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        content: [{ type: "tool-call" as const, toolCallId: "feedback-demo-1", toolName: "record_feedback", input: JSON.stringify(demoExtractFeedback(text)) }],
      };
    },
  });
}
