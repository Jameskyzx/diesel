import { describe, expect, it } from "vitest";

import {
  SALES_CHAT_HARNESS_VERSION,
  salesChatHarnessCases,
  type SalesChatHarnessCase,
} from "../evals/sales-chat-harness-cases";
import {
  allowsToolFreeAttachmentResponse,
  buildDirectChatResponse,
} from "@/server/ai/chat-turn-guidance";
import { buildSalesChatEvidenceContract } from "@/server/ai/evidence-contract";
import { resolveSalesChatLoopPolicy } from "@/server/ai/sales-chat-loop";
import {
  buildSalesChatInstructions,
  SALES_CHAT_SYSTEM_PROMPT_VERSION,
} from "@/server/ai/sales-chat-prompt";

function evaluateHarnessCase(testCase: SalesChatHarnessCase) {
  const latestUserText = testCase.userTexts.at(-1) ?? "";
  const directResponse = testCase.hasAttachments
    ? null
    : buildDirectChatResponse({
        selectedCountryIso3: testCase.selectedCountryIso3,
        text: latestUserText,
        userTexts: testCase.userTexts,
      });

  if (directResponse !== null) {
    return {
      activeTools: [],
      missingRequiredParameters: [],
      phase: "direct_response" as const,
    };
  }

  const contract = buildSalesChatEvidenceContract({
    selectedCountryIso3: testCase.selectedCountryIso3,
    userTexts: testCase.userTexts,
  });
  const policy = resolveSalesChatLoopPolicy({
    allowToolFreeAttachmentResponse:
      testCase.hasAttachments === true &&
      allowsToolFreeAttachmentResponse(latestUserText),
    contract,
    hasExecutionFailure: false,
    results: [],
  });

  return {
    activeTools: policy.activeTools,
    missingRequiredParameters: contract.missingRequiredParameters,
    phase: policy.phase,
  };
}

describe("sales chat offline harness", () => {
  it.each(salesChatHarnessCases)("$id", (testCase) => {
    expect(evaluateHarnessCase(testCase)).toEqual(testCase.expected);
  });

  it("versions and sections the system prompt", () => {
    const prompt = buildSalesChatInstructions("CHN");

    expect(SALES_CHAT_SYSTEM_PROMPT_VERSION).toBe("sales-chat-system-v3");
    expect(SALES_CHAT_HARNESS_VERSION).toBe("sales-chat-harness-v1");
    expect(prompt).toContain("<source_of_truth>");
    expect(prompt).toContain("<tool_routing>");
    expect(prompt).toContain("<loop_policy>");
    expect(prompt).toContain("<answer_contract>");
    expect(prompt).toContain("<untrusted_attachments>");
  });
});
