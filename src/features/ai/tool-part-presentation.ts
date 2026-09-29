import {
  clientAiToolResultSchema,
  type ClientAiToolResult,
} from "@/features/ai/client-schemas";
import {
  findCompatibleProductsInputSchema,
  getCountryProfileInputSchema,
  salesChatModelKnowledgeSearchInputSchema,
} from "@/features/ai/schemas";
import {
  calculateOpportunityScoreInputSchema,
  compareMarketsInputSchema,
  compareRegulationsInputSchema,
  generateSalesBriefInputSchema,
} from "@/features/marketing/schemas";
import type { DynamicToolUIPart } from "ai";

type ToolPartLike = {
  input?: unknown;
  output?: unknown;
  state: DynamicToolUIPart["state"];
  toolName?: string;
  type?: string;
};

export type ToolPartErrorCode =
  | "execution_error"
  | "invalid_result"
  | "permission_denied";

export type ToolPartPresentation =
  | { kind: "loading" }
  | { kind: "result"; result: ClientAiToolResult }
  | {
      code: ToolPartErrorCode;
      kind: "error";
    };

function exactValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => exactValue(value, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).toSorted();
  const rightKeys = Object.keys(rightRecord).toSorted();
  return (
    exactValue(leftKeys, rightKeys) &&
    leftKeys.every((key) => exactValue(leftRecord[key], rightRecord[key]))
  );
}

/**
 * Rebinds a completed client-visible result to the AI SDK tool input that
 * produced it. Optional country/date fields may be resolved from trusted map
 * or server context; every explicit provider field must still match.
 */
export function clientToolResultMatchesPartInput(
  result: ClientAiToolResult,
  input: unknown,
): boolean {
  if (result.tool === "calculateOpportunityScore") {
    const parsed = calculateOpportunityScoreInputSchema.safeParse(input);
    return (
      parsed.success &&
      exactValue(parsed.data, result.scorecard.query) &&
      result.informationAsOf === parsed.data.asOf
    );
  }
  if (result.tool === "generateSalesBrief") {
    const parsed = generateSalesBriefInputSchema.safeParse(input);
    return (
      parsed.success &&
      exactValue(parsed.data, result.brief.query) &&
      result.informationAsOf === parsed.data.asOf
    );
  }
  if (result.tool === "compareRegulations") {
    const parsed = compareRegulationsInputSchema.safeParse(input);
    return (
      parsed.success &&
      exactValue(parsed.data, result.comparison.query) &&
      result.informationAsOf === parsed.data.asOf
    );
  }
  if (result.tool === "compareMarkets") {
    const parsed = compareMarketsInputSchema.safeParse(input);
    return parsed.success && exactValue(parsed.data, result.comparison.query);
  }
  if (result.tool === "findCompatibleProducts") {
    const parsed = findCompatibleProductsInputSchema.safeParse(input);
    if (!parsed.success) return false;
    const expectedQuery = {
      applicationScope: parsed.data.applicationScope,
      asOf: parsed.data.asOf,
      countryIso3: parsed.data.countryIso3 ?? result.query.countryIso3,
      powerKw: parsed.data.powerKw,
      ...(parsed.data.productModelCode === undefined
        ? {}
        : { productModelCode: parsed.data.productModelCode }),
    };
    return (
      exactValue(expectedQuery, result.query) &&
      result.informationAsOf === parsed.data.asOf
    );
  }
  if (result.tool === "getCountryProfile") {
    const parsed = getCountryProfileInputSchema.safeParse(input);
    return (
      parsed.success &&
      exactValue(parsed.data.topics, result.requestedTopics) &&
      (parsed.data.countryIso3 == null ||
        parsed.data.countryIso3 === result.resolvedCountryIso3) &&
      (parsed.data.asOf === undefined ||
        parsed.data.asOf === result.informationAsOf)
    );
  }

  const parsed = salesChatModelKnowledgeSearchInputSchema.safeParse(input);
  return (
    parsed.success &&
    parsed.data.query === result.search.query &&
    (parsed.data.applicationScope ?? null) ===
      result.search.filters.applicationScope &&
    (parsed.data.countryIso3 == null ||
      parsed.data.countryIso3 === result.resolvedCountryIso3) &&
    (parsed.data.asOf == null ||
      parsed.data.asOf === result.informationAsOf)
  );
}

function toolNameFromPart(part: ToolPartLike): string | null {
  if (part.type === "dynamic-tool") {
    return part.toolName ?? null;
  }
  if (part.type?.startsWith("tool-")) {
    return part.type.slice("tool-".length);
  }
  return null;
}

export function toolPartPresentation(
  part: ToolPartLike,
): ToolPartPresentation {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
    case "approval-requested":
    case "approval-responded":
      return { kind: "loading" };
    case "output-error":
      return {
        code: "execution_error",
        kind: "error",
      };
    case "output-denied":
      return {
        code: "permission_denied",
        kind: "error",
      };
    case "output-available": {
      const parsed = clientAiToolResultSchema.safeParse(part.output);
      return parsed.success &&
        part.input !== undefined &&
        toolNameFromPart(part) === parsed.data.tool &&
        clientToolResultMatchesPartInput(parsed.data, part.input)
        ? { kind: "result", result: parsed.data }
        : {
          code: "invalid_result",
          kind: "error",
        };
    }
    default: {
      const exhaustiveState: never = part.state;
      return exhaustiveState;
    }
  }
}
