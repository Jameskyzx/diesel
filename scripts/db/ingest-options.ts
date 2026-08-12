import { z } from "zod";

const ingestArgumentSchema = z.union([
  z.literal("--market-only"),
  z.string().regex(/^--country=[A-Za-z]{3}$/),
]);

const ingestOptionsSchema = z
  .object({
    countryIso3: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase())
      .optional(),
    countryOptionCount: z.number().int().min(0).max(1),
    marketOnly: z.boolean(),
  })
  .superRefine((options, context) => {
    if (options.countryIso3 && options.marketOnly) {
      context.addIssue({
        code: "custom",
        message: "--country and --market-only cannot be used together",
        path: ["countryIso3"],
      });
    }
  });

export type IngestOptions = {
  countryIso3?: string;
  marketOnly: boolean;
};

export function selectMarketFixturesForIngestion<T>(
  rows: readonly T[],
  options: IngestOptions,
): readonly T[] {
  return options.countryIso3 ? [] : rows;
}

export function parseIngestOptions(args: readonly string[]): IngestOptions {
  const parsedArguments = z.array(ingestArgumentSchema).parse(args);
  const countryArguments = parsedArguments.filter((argument) =>
    argument.startsWith("--country="),
  );
  const countryIso3 = countryArguments[0]?.slice("--country=".length);
  const parsed = ingestOptionsSchema.parse({
    countryIso3,
    countryOptionCount: countryArguments.length,
    marketOnly: parsedArguments.includes("--market-only"),
  });

  return {
    ...(parsed.countryIso3 ? { countryIso3: parsed.countryIso3 } : {}),
    marketOnly: parsed.marketOnly,
  };
}
