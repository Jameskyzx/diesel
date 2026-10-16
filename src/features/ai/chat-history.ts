import { isToolUIPart } from "ai";
import { z } from "zod";
import { catalogResultSchema } from "@/features/product-catalog/schemas";

import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import { aiToolNames } from "@/features/ai/schemas";
import { MAX_AI_BUFFERED_TEXT_CHARACTERS, MAX_CHAT_HISTORY_USER_MESSAGES } from "@/features/ai/constants";
import {
  parseReleasedAttachmentPart,
  releaseSalesChatMessageAttachments,
  type SalesChatUiMessage,
} from "@/features/ai/released-attachment";
import { toolPartPresentation } from "@/features/ai/tool-part-presentation";
import { conversationMetadataSchema, readConversationMetadata } from "@/features/ai/conversation-state";

export const CHAT_HISTORY_STORAGE_KEY = "diesel_chat_history_v1";
export const CHAT_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const CHAT_HISTORY_MAX_BYTES = 1_000_000;

const textPartSchema = z.object({
  type: z.literal("text"), text: z.string().max(MAX_AI_BUFFERED_TEXT_CHARACTERS),
}).strict();
const attachmentPartSchema = z.object({
  type: z.literal("data-releasedAttachment"),
  data: z.object({ filename: z.string().max(200).nullable() }).strict(),
}).strict();
const toolIdentity = {
  type: z.literal("dynamic-tool"), toolName: z.enum(aiToolNames),
  toolCallId: z.string().min(1).max(200), input: z.unknown(),
};
const toolPartSchema = z.object({
  ...toolIdentity, state: z.literal("output-available"), output: clientAiToolResultSchema,
}).strict().refine(part => toolPartPresentation(part).kind === "result");
const toolErrorSchema = z.object({
  ...toolIdentity, state: z.literal("output-error"),
  errorText: z.literal("Stored tool execution error"),
}).strict();
const historyMessageSchema = z.object({
  id: z.string().min(1).max(200), role: z.enum(["user", "assistant"]),
  metadata: conversationMetadataSchema.optional(),
  parts: z.array(z.union([textPartSchema, attachmentPartSchema, toolPartSchema, toolErrorSchema,
    z.object({type: z.literal("data-productCatalog"), data: catalogResultSchema}).strict()])).min(1).max(16),
}).strict();
export const chatHistorySnapshotSchema = z.object({
  version: z.literal(1), contextKey: z.string().min(1).max(1_000),
  sessionId: z.uuid(), savedAt: z.iso.datetime(),
  omittedUserTurns: z.number().int().nonnegative().default(0),
  messages: z.array(historyMessageSchema).min(2).max(MAX_CHAT_HISTORY_USER_MESSAGES * 2),
}).strict().refine(({ messages }) =>
  messages[0]?.role === "user" && messages.at(-1)?.role === "assistant" &&
  messages.filter(message => message.role === "user").length <= MAX_CHAT_HISTORY_USER_MESSAGES &&
  new Set(messages.map(message => message.id)).size === messages.length);

export type ChatHistorySnapshot = {
  contextKey: string;
  sessionId: string;
  savedAt: string;
  omittedUserTurns: number;
  messages: SalesChatUiMessage[];
};

/** Store completed public parts only; never retain upload bytes or provider metadata. */
export function serializeChatHistory(input: Omit<ChatHistorySnapshot, "savedAt" | "omittedUserTurns"> & { omittedUserTurns?: number },
  now = new Date()): string | null {
  const messages = releaseSalesChatMessageAttachments(input.messages).map(message => ({
    id: message.id, role: message.role,
    ...(message.role === "assistant" && readConversationMetadata(message.metadata)
      ? { metadata: readConversationMetadata(message.metadata)! } : {}),
    parts: message.parts.flatMap((part): unknown[] => {
      if (part.type === "text") return [{ type: "text", text: part.text }];
      if (part.type === "data-productCatalog") { const parsed = catalogResultSchema.safeParse(part.data); return parsed.success ? [{type: part.type, data: parsed.data}] : []; }
      const attachment = parseReleasedAttachmentPart(part);
      if (attachment) return [{ type: "data-releasedAttachment", data: attachment }];
      if (!isToolUIPart(part)) return [];
      const presentation = toolPartPresentation(part);
      const toolName = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
      const identity = { type: "dynamic-tool", toolName, toolCallId: part.toolCallId, input: part.input };
      if (presentation.kind === "result") return [{ ...identity, state: "output-available", output: presentation.result }];
      if (presentation.kind === "error") return [{ ...identity, state: "output-error", errorText: "Stored tool execution error" }];
      return [];
    }),
  }));
  // Retain complete recent exchanges, not an all-or-nothing twelve-turn cache.
  // Only the newest signed receipt is needed for the next request. It carries
  // authenticated query state even when older visible exchanges leave the window.
  const latestReceipt = messages.findLastIndex(message => "metadata" in message);
  messages.forEach((message, index) => { if (index !== latestReceipt) delete message.metadata; });
  let omittedUserTurns = input.omittedUserTurns ?? 0;
  while (messages.filter(message => message.role === "user").length > MAX_CHAT_HISTORY_USER_MESSAGES) {
    const nextUser = messages.findIndex((message, index) => index > 0 && message.role === "user");
    if (nextUser < 0) return null;
    omittedUserTurns += messages.splice(0, nextUser).filter(message => message.role === "user").length;
  }
  for (;;) {
    const parsed = chatHistorySnapshotSchema.safeParse({ ...input, messages, omittedUserTurns, savedAt: now.toISOString(), version: 1 });
    if (!parsed.success) return null;
    const serialized = JSON.stringify(parsed.data);
    if (new TextEncoder().encode(serialized).byteLength <= CHAT_HISTORY_MAX_BYTES) return serialized;
    const nextUser = messages.findIndex((message, index) => index > 0 && message.role === "user");
    if (nextUser < 0) return null; // Never discard the newest completed exchange.
    omittedUserTurns += messages.splice(0, nextUser).filter(message => message.role === "user").length;
  }
}

/** Browser storage is untrusted input and cannot establish new server evidence. */
export function parseChatHistory(serialized: string | null, contextKey: string,
  now = new Date()): ChatHistorySnapshot | null {
  if (!serialized || serialized.length > CHAT_HISTORY_MAX_BYTES ||
    new TextEncoder().encode(serialized).byteLength > CHAT_HISTORY_MAX_BYTES) return null;
  try {
    const parsed = chatHistorySnapshotSchema.safeParse(JSON.parse(serialized));
    if (!parsed.success || parsed.data.contextKey !== contextKey) return null;
    const age = now.getTime() - new Date(parsed.data.savedAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age >= CHAT_HISTORY_MAX_AGE_MS) return null;
    return {
      contextKey: parsed.data.contextKey, sessionId: parsed.data.sessionId,
      savedAt: parsed.data.savedAt,
      omittedUserTurns: parsed.data.omittedUserTurns,
      messages: parsed.data.messages.map(message => ({ ...message,
        parts: message.parts.map(part => part.type === "dynamic-tool" ? { ...part, input: part.input } : part),
      })),
    };
  } catch { return null; }
}
