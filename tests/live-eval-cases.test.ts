import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  salesChatLiveCaseSchema,
  salesChatLiveCases,
} from "../evals/sales-chat-live-cases";

describe("live eval bilingual case suite", () => {
  it("keeps 18 unique schema-valid cases with aligned tool expectations", () => {
    const ids = salesChatLiveCases.map(({ id }) => id);

    expect(salesChatLiveCases).toHaveLength(18);
    expect(new Set(ids).size).toBe(ids.length);
    for (const testCase of salesChatLiveCases) {
      expect(salesChatLiveCaseSchema.safeParse(testCase).success).toBe(true);
      expect(Object.keys(testCase.expectedArgs).sort()).toEqual(
        [...testCase.expectedTools].sort(),
      );
      expect(testCase.responseContract.factAnchors.length).toBeGreaterThan(0);
      expect(testCase.responseContract.decisionAnchors.length).toBeGreaterThan(
        0,
      );
      const responseAnchorIds = [
        ...testCase.responseContract.factAnchors,
        ...testCase.responseContract.decisionAnchors,
        ...(testCase.responseContract.disclaimerAnchor
          ? [testCase.responseContract.disclaimerAnchor]
          : []),
      ].map(({ id }) => id);
      expect(new Set(responseAnchorIds).size).toBe(responseAnchorIds.length);
    }
  });

  it("covers six explicit English cases and twelve Chinese cases", () => {
    const englishCases = salesChatLiveCases.filter(
      ({ locale }) => locale === "en",
    );
    const chineseCases = salesChatLiveCases.filter(
      ({ locale }) => locale === "zh-CN",
    );

    expect(englishCases).toHaveLength(6);
    expect(chineseCases).toHaveLength(12);
    expect(englishCases.map(({ id }) => id)).toEqual([
      "country-overview-china",
      "single-country-market-profile",
      "product-ready-dual-axis",
      "unknown-product-fails-closed",
      "source-document-retrieval",
      "irrelevant-source-query-fails-closed",
    ]);
    for (const testCase of englishCases) {
      expect(testCase.userTexts.join(" ")).not.toMatch(/\p{Script=Han}/u);
    }
    for (const testCase of chineseCases) {
      expect(testCase.userTexts.join(" ")).toMatch(/\p{Script=Han}/u);
    }
  });

  it("requires a unique bounded query contract only for knowledge searches", () => {
    const searchCases = salesChatLiveCases.filter(({ expectedTools }) =>
      expectedTools.includes("searchKnowledgeBase")
    );
    expect(searchCases).toHaveLength(3);
    for (const testCase of searchCases) {
      expect(testCase.knowledgeQueryContract?.required.length).toBeGreaterThan(
        0,
      );
    }

    const sourceCase = searchCases.find(
      ({ id }) => id === "source-document-retrieval",
    );
    const nonSearchCase = salesChatLiveCases.find(
      ({ id }) => id === "country-overview-china",
    );
    if (!sourceCase?.knowledgeQueryContract || !nonSearchCase) {
      throw new Error("Expected live-eval query-contract fixtures.");
    }

    const missingContract = structuredClone(sourceCase) as Record<
      string,
      unknown
    >;
    Reflect.deleteProperty(missingContract, "knowledgeQueryContract");
    expect(salesChatLiveCaseSchema.safeParse(missingContract).success).toBe(
      false,
    );

    const unrelatedContract = structuredClone(nonSearchCase) as Record<
      string,
      unknown
    >;
    unrelatedContract.knowledgeQueryContract =
      structuredClone(sourceCase.knowledgeQueryContract);
    expect(salesChatLiveCaseSchema.safeParse(unrelatedContract).success).toBe(
      false,
    );

    const duplicateVariant = structuredClone(sourceCase) as Record<
      string,
      unknown
    >;
    const duplicateContract = duplicateVariant.knowledgeQueryContract as {
      required: Array<{ anyOf: string[] }>;
    };
    duplicateContract.required[0]!.anyOf = ["non-road", "NON-ROAD"];
    expect(salesChatLiveCaseSchema.safeParse(duplicateVariant).success).toBe(
      false,
    );

    const overlappingTerms = structuredClone(sourceCase) as Record<
      string,
      unknown
    >;
    const overlapContract = overlappingTerms.knowledgeQueryContract as {
      forbidden: Array<{ anyOf: string[]; id: string }>;
      required: Array<{ anyOf: string[] }>;
    };
    overlapContract.forbidden = [
      {
        anyOf: [overlapContract.required[0]!.anyOf[0]!],
        id: "query:forbidden-overlap",
      },
    ];
    expect(salesChatLiveCaseSchema.safeParse(overlappingTerms).success).toBe(
      false,
    );
  });

  it("passes each case locale into the production stream runner", async () => {
    const runnerSource = await readFile(
      resolve(process.cwd(), "scripts/ai/live-eval.ts"),
      "utf8",
    );

    expect(runnerSource).toContain("locale: testCase.locale,");
  });

  it("binds persisted result locales to canonical case IDs during verification", async () => {
    const verifierSource = await readFile(
      resolve(process.cwd(), "scripts/portfolio/verify-live-eval.ts"),
      "utf8",
    );

    expect(verifierSource).toContain(
      "assertEqual(result.locale, expected.locale, `${result.id} locale`);",
    );
    expect(verifierSource).toContain(
      "`${result.id} response anchor coverage`",
    );
    expect(verifierSource).toContain(
      "`${result.id} response grounding judgement`",
    );
    expect(verifierSource).toContain(
      "`${result.id} response locale judgement`",
    );
  });
});
