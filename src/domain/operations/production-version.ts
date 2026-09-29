import { z } from "zod";

const productionVersionSchema = z.string().regex(/^[0-9a-f]{40}$/u);

const snapshotSchema = z
  .object({
    publicRuntime: z
      .object({
        version: productionVersionSchema,
      })
      .passthrough(),
  })
  .passthrough();

const snapshotPattern =
  /<!-- portfolio-verification:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- portfolio-verification:end -->/u;

export function parseProductionVersion(value: string): string {
  const parsed = productionVersionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Expected production version must be a full lowercase Git SHA.");
  }
  return parsed.data;
}

export function productionVersionFromStatus(markdown: string): string {
  const match = snapshotPattern.exec(markdown);
  if (!match?.[1]) {
    throw new Error(
      "STATUS.md is missing the portfolio verification snapshot.",
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(match[1]);
  } catch {
    throw new Error("STATUS.md contains an invalid portfolio JSON snapshot.");
  }

  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "STATUS.md publicRuntime.version must be a full lowercase Git SHA.",
    );
  }
  return parseProductionVersion(parsed.data.publicRuntime.version);
}
