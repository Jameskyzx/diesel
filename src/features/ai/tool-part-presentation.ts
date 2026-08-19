import {
  clientAiToolResultSchema,
  type ClientAiToolResult,
} from "@/features/ai/client-schemas";
import type { DynamicToolUIPart } from "ai";

type ToolPartLike = {
  output?: unknown;
  state: DynamicToolUIPart["state"];
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
      return parsed.success
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
