import {
  clientAiToolResultSchema,
  type ClientAiToolResult,
} from "@/features/ai/client-schemas";
import type { DynamicToolUIPart } from "ai";

type ToolPartLike = {
  output?: unknown;
  state: DynamicToolUIPart["state"];
};

export type ToolPartPresentation =
  | { kind: "loading" }
  | { kind: "result"; result: ClientAiToolResult }
  | { kind: "error"; message: string };

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
        kind: "error",
        message: "确定性查询失败，未生成事实结果。请重试本轮问题。",
      };
    case "output-denied":
      return {
        kind: "error",
        message: "确定性查询未获执行许可，本轮没有可用事实结果。",
      };
    case "output-available": {
      const parsed = clientAiToolResultSchema.safeParse(part.output);
      return parsed.success
        ? { kind: "result", result: parsed.data }
        : {
          kind: "error",
          message: "确定性查询返回了无法验证的结果，已停止展示该结果。",
        };
    }
    default: {
      const exhaustiveState: never = part.state;
      return exhaustiveState;
    }
  }
}
