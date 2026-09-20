import { z } from "zod";

/** Server-captured clock context; never accepted from a chat request body. */
export const chatRuntimeContextSchema = z.object({
  capturedAt: z.iso.datetime({ precision: 3 }),
  utcDate: z.iso.date(),
}).strict().superRefine((value, context) => {
  if (value.utcDate !== value.capturedAt.slice(0, 10)) {
    context.addIssue({
      code: "custom",
      message: "The runtime date must equal the captured UTC calendar date.",
      path: ["utcDate"],
    });
  }
}).readonly();

export type ChatRuntimeContext = z.infer<typeof chatRuntimeContextSchema>;

export function captureChatRuntimeContext(now: Date = new Date()): ChatRuntimeContext {
  const capturedAt = now.toISOString();
  return chatRuntimeContextSchema.parse({
    capturedAt,
    utcDate: capturedAt.slice(0, 10),
  });
}
