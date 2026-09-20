import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SALES_CHAT_LIVE_EVAL_VERSION,
  salesChatLiveCases,
} from "../evals/sales-chat-live-cases";
import { evaluateLiveEvalResponseContract } from "@/domain/ai/live-eval";
import { buildEvidenceGapResponse } from "@/domain/ai/evidence-gap-response";
import { evaluateProductFit } from "@/domain/product-fit/evaluate-product-fit";
import { productFitQuerySchema } from "@/features/database/schemas";
import {
  findCompatibleProductsInputSchema,
  findCompatibleProductsResultSchema,
} from "@/features/ai/schemas";
import { formatUtcDate } from "@/i18n/date";
import { createSalesChatTools } from "@/server/ai/sales-chat";
import { liveEvalReportSchema } from "../scripts/portfolio/live-eval-report-schema";
import { verifyLiveEvalReportConsistency } from "../scripts/portfolio/verify-live-eval";

function dateAnchor(date: string) {
  const anchor = salesChatLiveCases.flatMap(
    ({ responseContract }) => responseContract.factAnchors,
  ).find(({ id }) => id === `fact:date-${date}`);
  if (!anchor) throw new Error(`Missing canonical date anchor: ${date}`);
  return anchor;
}

describe("v13 localized calendar-date evidence", () => {
  it("preserves the v12 observation and every canonical evidence expectation", async () => {
    const archive = liveEvalReportSchema.parse(JSON.parse(await readFile(resolve(
      process.cwd(),
      "docs/evals/archive/ai-live-eval-20260906T140639473Z-b0893459-1cd0-46a8-8534-96ce2e9ef099.json",
    ), "utf8")));
    expect(archive.version).toBe("sales-chat-live-v12");
    expect(archive.results.map(({ id, expectedEvidenceAllowed }) => ({
      id, expectedEvidenceAllowed,
    }))).toEqual(salesChatLiveCases.map(({ id, expectedEvidenceAllowed }) => ({
      id, expectedEvidenceAllowed,
    })));
    expect(archive.results.find(({ id }) => id === "unknown-product-fails-closed"))
      .toMatchObject({
        expectedEvidenceAllowed: false,
        evidenceAllowed: false,
        missingResponseAnchorIds: ["fact:date-2026-08-13"],
        safetyPassed: false,
      });
    expect(archive.thresholdsPassed).toBe(false);
    await expect(verifyLiveEvalReportConsistency(archive)).rejects.toThrow(
      "incompatible report version",
    );
  });

  it("versions the changed date contract without changing the 18 case identities", () => {
    expect(SALES_CHAT_LIVE_EVAL_VERSION).toBe("sales-chat-live-v25");
    expect(salesChatLiveCases).toHaveLength(18);
  });

  it.each(["2026-08-13", "2031-01-01"])(
    "accepts only the ISO and app-rendered forms of %s",
    (date) => {
      const anchor = dateAnchor(date);
      expect(anchor.anyOf).toEqual([
        date,
        formatUtcDate(date, "en"),
        formatUtcDate(date, "zh-CN"),
      ]);
      for (const variant of anchor.anyOf) {
        expect(evaluateLiveEvalResponseContract({
          expectedLocale: "en",
          responseContract: {
            decisionAnchors: [], disclaimerAnchor: null, factAnchors: [anchor],
          },
          responseText: `As of ${variant}.`,
        }).responseGroundingPassed).toBe(true);
      }
    },
  );

  it.each([
    "2026-08-12", "2026-09-13", "2025-08-13", "2026-08-130",
    "12026-08-13", "Aug 12, 2026", "Sep 13, 2026", "Aug 13, 2025",
    "Aug 13, 20260", "2026年8月12日", "2026年9月13日", "2025年8月13日",
    "12026年8月13日", "the requested date",
  ])("rejects a wrong, incomplete, or numeric-substring date: %s", (date) => {
    expect(evaluateLiveEvalResponseContract({
      expectedLocale: "en",
      responseContract: {
        decisionAnchors: [],
        disclaimerAnchor: null,
        factAnchors: [dateAnchor("2026-08-13")],
      },
      responseText: `As of ${date}.`,
    }).missingResponseAnchorIds).toEqual(["fact:date-2026-08-13"]);
  });

  it.each(["en", "zh-CN"] as const)(
    "recognizes the production unknown-product refusal in %s without permitting evidence",
    async (locale) => {
      const testCase = salesChatLiveCases.find(
        ({ id }) => id === "unknown-product-fails-closed",
      );
      if (!testCase) throw new Error("Missing unknown-product case.");
      const tools = createSalesChatTools({
        auditRepository: { recordToolCall: async () => undefined },
        selectedCountryIso3: testCase.selectedCountryIso3,
        services: {
          findCompatibleProducts: async (input) => [evaluateProductFit({
            applicableRegulations: [],
            certifications: [],
            product: null,
            query: productFitQuerySchema.parse(input),
          })],
        },
        sessionId: "11111111-1111-4111-8111-111111111111",
      });
      const execute = tools.findCompatibleProducts.execute;
      if (!execute) throw new Error("Expected executable product-fit tool.");
      const result = findCompatibleProductsResultSchema.parse(await execute(
        findCompatibleProductsInputSchema.parse(
          testCase.expectedArgs.findCompatibleProducts,
        ),
        { context: undefined as never, messages: [], toolCallId: "date-fixture" },
      ));
      expect(testCase.expectedEvidenceAllowed).toBe(false);
      expect(result.evidenceSufficient).toBe(false);
      expect(result.status).toBe("no_data");
      const responseText = buildEvidenceGapResponse([result], false, false, locale);
      expect(responseText).toContain(formatUtcDate("2026-08-13", locale));
      expect(responseText).not.toContain("2026-08-13");
      expect(evaluateLiveEvalResponseContract({
        expectedLocale: locale,
        responseContract: testCase.responseContract,
        responseText,
      })).toMatchObject({
        missingResponseAnchorIds: [],
        responseGroundingPassed: true,
        responseLocalePassed: true,
      });

      // Preserve a reproduction of the v12 false negative. Historical reports
      // must retain this old outcome, not be relabeled with v13's interpretation.
      const legacyContract = structuredClone(testCase.responseContract);
      const legacyDate = legacyContract.factAnchors.find(
        ({ id }) => id === "fact:date-2026-08-13",
      );
      if (!legacyDate) throw new Error("Missing legacy date anchor.");
      legacyDate.anyOf = ["2026-08-13"];
      expect(evaluateLiveEvalResponseContract({
        expectedLocale: locale,
        responseContract: legacyContract,
        responseText,
      }).missingResponseAnchorIds).toEqual(["fact:date-2026-08-13"]);
    },
  );
});
