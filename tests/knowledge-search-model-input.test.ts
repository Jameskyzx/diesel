

import { describe, expect, it } from "vitest";

import { salesChatKnowledgeSearchInputSchema, salesChatModelKnowledgeSearchInputSchema } from "@/features/ai/schemas";

const runtimeContext = {
  capturedAt: "2026-09-11T12:00:00.000Z",
  utcDate: "2026-09-11",
} as const;
const topic = "CHN non-road Stage IV emission limits original text";
const validInput = {
  applicationScope: "non-road",
  asOf: runtimeContext.utcDate,
  countryIso3: "CHN",
  query: topic,
} as const;
const invalidKnobs = [
  { label: "small result count", fields: { limit: 1 } },
  { label: "legacy result count", fields: { limit: 8 } },
  { label: "jurisdiction UUID", fields: { jurisdictionId: "00000000-0000-4000-8000-000000000899" } },
  { label: "null jurisdiction", fields: { jurisdictionId: null } },
  { label: "both knobs", fields: { jurisdictionId: "00000000-0000-4000-8000-000000000899", limit: 8 } },
] as const;

describe("model-facing knowledge-search inputs expose only effective choices", () => {

  it.each(invalidKnobs)("keeps historical parsing separate from the model's $label", ({ fields }) => {
    const input = { ...validInput, ...fields };
    expect(salesChatKnowledgeSearchInputSchema.parse(input)).toEqual(input);
    expect(salesChatModelKnowledgeSearchInputSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    ["historical", salesChatKnowledgeSearchInputSchema],
    ["model-facing", salesChatModelKnowledgeSearchInputSchema],
  ] as const)(
    "keeps the reasoning-query guard on the %s schema", (_label, schema) => {
      expect(schema.safeParse({ ...validInput, query: `${topic} <reasoning>PRIVATE_REASONING</reasoning>` }).success).toBe(false);
    },
  );
});
