import { isAbsolute } from "node:path";

import { z } from "zod";

const snapshotPathSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .refine(isAbsolute, `${label} must be absolute`)
    .refine((value) => value.endsWith(".json"), {
      message: `${label} must end in .json`,
    });

const outputPathSchema = snapshotPathSchema("Snapshot output path");
const reusePathSchema = snapshotPathSchema("Snapshot reuse path");

export type GovernanceSnapshotOptions = {
  outputPath: string;
  // An earlier snapshot whose rows may be reused after digest verification.
  reusePath: string | null;
};

const usage =
  "Expected --output=/absolute/path.json and an optional --reuse=/absolute/previous.json";

export function parseGovernanceSnapshotOptions(
  args: readonly string[],
): GovernanceSnapshotOptions {
  const parsed = z.array(z.string()).min(1).max(2).parse(args);
  const [outputArgument, reuseArgument] = parsed;
  if (!outputArgument?.startsWith("--output=")) {
    throw new Error(usage);
  }
  if (reuseArgument !== undefined && !reuseArgument.startsWith("--reuse=")) {
    throw new Error(usage);
  }

  const outputPath = outputPathSchema.parse(
    outputArgument.slice("--output=".length),
  );
  const reusePath =
    reuseArgument === undefined
      ? null
      : reusePathSchema.parse(reuseArgument.slice("--reuse=".length));
  if (reusePath === outputPath) {
    throw new Error("Snapshot reuse path must differ from the output path");
  }

  return { outputPath, reusePath };
}
