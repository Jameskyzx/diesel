import { isAbsolute } from "node:path";

import { z } from "zod";

const outputPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isAbsolute, "Snapshot output path must be absolute")
  .refine((value) => value.endsWith(".json"), {
    message: "Snapshot output path must end in .json",
  });

export type GovernanceSnapshotOptions = {
  outputPath: string;
};

export function parseGovernanceSnapshotOptions(
  args: readonly string[],
): GovernanceSnapshotOptions {
  const parsed = z
    .array(z.string())
    .length(1, "Expected exactly one --output=/absolute/path.json option")
    .parse(args);
  const [outputArgument] = parsed;
  if (!outputArgument.startsWith("--output=")) {
    throw new Error(
      "Expected exactly one --output=/absolute/path.json option",
    );
  }

  return {
    outputPath: outputPathSchema.parse(outputArgument.slice("--output=".length)),
  };
}
