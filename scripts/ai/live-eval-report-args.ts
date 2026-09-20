import { createHash } from "node:crypto";

import { chatRuntimeContextSchema } from "../../src/domain/ai/chat-runtime-context";
import type { AiToolName } from "../../src/features/ai/schemas";
import {
  findCompatibleProductsInputSchema,
  getCountryProfileInputSchema,
  salesChatKnowledgeSearchInputSchema,
} from "../../src/features/ai/schemas";
import {
  calculateOpportunityScoreInputSchema,
  compareMarketsInputSchema,
  compareRegulationsInputSchema,
  generateSalesBriefInputSchema,
} from "../../src/features/marketing/schemas";
import {
  evaluateLiveEvalKnowledgeQuery,
  type LiveEvalKnowledgeQueryContract,
  type LiveEvalKnowledgeQueryObservation,
} from "../../src/domain/ai/live-eval-query-contract";

export type LiveEvalStringFingerprint = {
  algorithm: "sha256";
  characterCount: number;
  digest: string;
};

export type LiveEvalQueryFingerprint = LiveEvalStringFingerprint;

export type LiveEvalQueryObservation = LiveEvalStringFingerprint &
  LiveEvalKnowledgeQueryObservation;

export function fingerprintLiveEvalString(
  value: string,
): LiveEvalStringFingerprint {
  return {
    algorithm: "sha256",
    characterCount: Array.from(value).length,
    digest: createHash("sha256").update(value, "utf8").digest("hex"),
  };
}

// Retained as the explicit v9 compatibility name. V10 uses the same bounded
// commitment for every model-controlled free string, not only search queries.
export function fingerprintLiveEvalQuery(
  query: string,
): LiveEvalQueryFingerprint {
  return fingerprintLiveEvalString(query);
}

function parseToolInput(
  tool: AiToolName,
  input: unknown,
): Record<string, unknown> | null {
  const parsed = (() => {
    switch (tool) {
      case "calculateOpportunityScore":
        return calculateOpportunityScoreInputSchema.safeParse(input);
      case "compareMarkets":
        return compareMarketsInputSchema.safeParse(input);
      case "compareRegulations":
        return compareRegulationsInputSchema.safeParse(input);
      case "findCompatibleProducts":
        return findCompatibleProductsInputSchema.safeParse(input);
      case "generateSalesBrief":
        return generateSalesBriefInputSchema.safeParse(input);
      case "getCountryProfile":
        return getCountryProfileInputSchema.safeParse(input);
      case "searchKnowledgeBase":
        return salesChatKnowledgeSearchInputSchema.safeParse(input);
    }
  })();
  return parsed.success
    ? Object.fromEntries(Object.entries(parsed.data))
    : null;
}

function buildQueryObservation(
  query: string,
  contract: LiveEvalKnowledgeQueryContract | undefined,
): LiveEvalQueryObservation {
  const expectation = contract
    ? evaluateLiveEvalKnowledgeQuery(query, contract)
    : {
        expectationPassed: true,
        matchedForbiddenTermIds: [],
        matchedRequiredTermIds: [],
        missingRequiredTermIds: [],
      };
  return {
    ...fingerprintLiveEvalQuery(query),
    ...expectation,
  };
}

export function sanitizeLiveEvalReportArgs(input: {
  args: unknown;
  invalid?: boolean;
  knowledgeQueryContract?: LiveEvalKnowledgeQueryContract;
  tool: AiToolName;
}): Record<string, unknown> {
  if (input.invalid === true) {
    return {};
  }
  const parsed = parseToolInput(input.tool, input.args);
  if (parsed === null) {
    // The empty object is the v10 invalid-input sentinel. Never persist a
    // partially parsed provider value because it may contain private text.
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => {
      if (key === "query" && typeof value === "string") {
        return [
          key,
          buildQueryObservation(value, input.knowledgeQueryContract),
        ];
      }
      if (key === "productModelCode" && typeof value === "string") {
        return [key, fingerprintLiveEvalString(value)];
      }
      if (
        key === "metricCodes" &&
        Array.isArray(value) &&
        value.every((item) => typeof item === "string")
      ) {
        return [key, value.map(fingerprintLiveEvalString)];
      }
      if (key === "jurisdictionId" && typeof value === "string") {
        return [key, fingerprintLiveEvalString(value.toLowerCase())];
      }
      return [key, value];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJsonValue(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function expectedPersistedValue(key: string, value: unknown): unknown {
  if (key === "productModelCode" && typeof value === "string") {
    return fingerprintLiveEvalString(value.trim().toUpperCase());
  }
  if (
    key === "metricCodes" &&
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  ) {
    return value.map((item) =>
      fingerprintLiveEvalString(item.trim().toUpperCase())
    );
  }
  if (key === "jurisdictionId" && typeof value === "string") {
    return fingerprintLiveEvalString(value.toLowerCase());
  }
  return value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}

export function liveEvalQueryObservationMatchesContract(
  value: unknown,
  contract: LiveEvalKnowledgeQueryContract,
): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const requiredIds = contract.required.map(({ id }) => id);
  const forbiddenIds = contract.forbidden.map(({ id }) => id);
  const matchedRequired = value.matchedRequiredTermIds;
  const missingRequired = value.missingRequiredTermIds;
  const matchedForbidden = value.matchedForbiddenTermIds;
  if (
    !isStringArray(matchedRequired) ||
    !isStringArray(missingRequired) ||
    !isStringArray(matchedForbidden) ||
    typeof value.expectationPassed !== "boolean"
  ) {
    return false;
  }
  const matchedRequiredSet = new Set(matchedRequired);
  const missingRequiredSet = new Set(missingRequired);
  const matchedForbiddenSet = new Set(matchedForbidden);
  const expectedPass =
    missingRequired.length === 0 && matchedForbidden.length === 0;

  return sameJsonValue(
    matchedRequired,
    requiredIds.filter((id) => matchedRequiredSet.has(id)),
  ) &&
    sameJsonValue(
      missingRequired,
      requiredIds.filter((id) => missingRequiredSet.has(id)),
    ) &&
    matchedRequired.length + missingRequired.length === requiredIds.length &&
    sameJsonValue(
      matchedForbidden,
      forbiddenIds.filter((id) => matchedForbiddenSet.has(id)),
    ) &&
    value.expectationPassed === expectedPass;
}

export function matchesExpectedLiveEvalReportArgs(input: {
  actual: unknown;
  expected: Readonly<Record<string, unknown>>;
  knowledgeQueryContract?: LiveEvalKnowledgeQueryContract;
  /** V14 scores parsed tool inputs using the clock captured for this case. */
  runtimeContext?: unknown;
  tool: AiToolName;
}): boolean {
  if (!isRecord(input.actual) || Object.keys(input.actual).length === 0) {
    return false;
  }
  const actual = input.actual;
  const expected = { ...input.expected };
  if (input.runtimeContext !== undefined) {
    const runtime = chatRuntimeContextSchema.safeParse(input.runtimeContext);
    if (!runtime.success) return false;
    if (input.tool === "getCountryProfile" && !Object.hasOwn(expected, "asOf")) {
      // The production Zod transform inserts this value before the SDK exposes
      // generated.toolCalls. It is required in a post-schema observation, not
      // an arbitrary extra provider filter. Explicit user dates stay exact.
      expected.asOf = runtime.data.utcDate;
    }
  }
  // No runtime context retains the historical v13 exact-key contract. Never
  // reinterpret an archived observation using today's wall clock.
  const allowedKeys = new Set(Object.keys(expected));
  if (input.tool === "searchKnowledgeBase") {
    // Search text is intentionally committed as a bounded observation instead
    // of being copied into the case fixture. Every other optional filter still
    // has to be declared by the case or the call changes the evidence scope.
    allowedKeys.add("query");
  }
  if (
    !sameJsonValue(
      Object.keys(actual).sort(),
      [...allowedKeys].sort(),
    )
  ) {
    return false;
  }
  const expectedFieldsMatch = Object.entries(expected).every(
    ([key, value]) =>
      sameJsonValue(
        actual[key],
        expectedPersistedValue(key, value),
      ),
  );
  if (!expectedFieldsMatch) {
    return false;
  }
  if (input.tool !== "searchKnowledgeBase") {
    return true;
  }
  return input.knowledgeQueryContract !== undefined &&
    liveEvalQueryObservationMatchesContract(
      actual.query,
      input.knowledgeQueryContract,
    ) &&
    isRecord(actual.query) &&
    actual.query.expectationPassed === true;
}

export function liveEvalKnowledgeQueryContractPassed(input: {
  args: unknown;
  contract: LiveEvalKnowledgeQueryContract | undefined;
}): boolean {
  if (input.contract === undefined) {
    return false;
  }
  const parsed = salesChatKnowledgeSearchInputSchema.safeParse(input.args);
  return parsed.success &&
    evaluateLiveEvalKnowledgeQuery(parsed.data.query, input.contract)
      .expectationPassed;
}
