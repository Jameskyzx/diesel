import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/env";
import { conversationStateSchema, conversationMemorySchema, type ConversationMemory, type ConversationState } from "@/features/ai/conversation-state";

const lifetimeMs = 24 * 60 * 60 * 1_000;
// Domain-separated from provider authentication. Rotation invalidates receipts;
// development without credentials uses a process-local key, never a public key.
const key = createHmac("sha256", env.AI_API_KEY ?? randomBytes(32))
  .update("diesel:conversation-context:v1").digest();
const receiptSchema = z.object({
  version: z.literal(1), sessionId: z.uuid(), selectedCountryIso3: z.string().nullable(),
  issuedAt: z.number().int(), userText: z.string().max(2_000),
  answer: z.string().max(6_000), state: conversationStateSchema,
  memory: conversationMemorySchema.optional(),
  history: z.array(z.object({ user: z.string().max(700), answer: z.string().max(1_000) }).strict()).max(2),
}).strict();
export type ConversationReceipt = z.infer<typeof receiptSchema>;

export function signConversationReceipt(input: {
  sessionId: string; selectedCountryIso3: string | null; userText: string;
  answer: string; state: ConversationState; memory?: ConversationMemory; previous?: ConversationReceipt | null;
}, now = Date.now()): string {
  const { previous, ...current } = input;
  const history = previous ? [...previous.history, { user: previous.userText.slice(0, 700), answer: previous.answer.slice(0, 1_000) }].slice(-2) : [];
  const value = receiptSchema.parse({ ...current, memory: current.memory ?? previous?.memory, history, answer: input.answer.slice(0, 6_000), issuedAt: now, version: 1 });
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** Authentic conversation context, not a reusable statement of current facts. */
export function verifyConversationReceipt(token: string | undefined, binding: {
  sessionId: string; selectedCountryIso3: string | null; previousUserText: string | undefined;
}, now = Date.now()): ConversationReceipt | null {
  if (!token || token.length > 64_000) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/u.test(part))) return null;
  const [payload, signature] = parts as [string, string];
  const expected = createHmac("sha256", key).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = receiptSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    const value = parsed.data;
    if (value.sessionId !== binding.sessionId || value.selectedCountryIso3 !== binding.selectedCountryIso3 ||
      value.userText !== binding.previousUserText || now < value.issuedAt || now - value.issuedAt >= lifetimeMs) return null;
    return value;
  } catch { return null; }
}
