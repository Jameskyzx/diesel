export const MAX_CHAT_USER_MESSAGE_CHARACTERS = 2_000;
export const MAX_CHAT_HISTORY_TEXT_CHARACTERS = 12_000;
export const MAX_CHAT_HISTORY_USER_MESSAGES = 12;
export const MAX_AI_OUTPUT_TOKENS = 2_048;
export const MAX_AI_BUFFERED_TEXT_CHARACTERS = 16_000;
export const MAX_AI_TOOL_STEPS = 5;
export const SALES_CHAT_SYSTEM_PROMPT_VERSION = "sales-chat-system-v7";
export const SALES_CHAT_BOUNDARY_REJECTION_REASONS = [
  "dynamic",
  "embedded_reasoning_markup",
  "incomplete_input",
  "invalid_input",
  "invalid_result",
  "model_output_budget",
  "output_denied",
  "provider_executed",
  "provider_part",
  "tool_error",
] as const;
