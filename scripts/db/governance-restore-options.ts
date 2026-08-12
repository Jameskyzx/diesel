import { isAbsolute } from "node:path";

import { z } from "zod";

const inputPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isAbsolute, "Snapshot input path must be absolute")
  .refine((value) => value.endsWith(".json"), {
    message: "Snapshot input path must end in .json",
  });

const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "Expected a 64-character SHA-256 digest")
  .transform((value) => value.toLowerCase());

export type GovernanceRestoreOptions =
  | { help: true }
  | {
      apply: boolean;
      expectedSha256: string;
      help: false;
      inputPath: string;
    };

export const governanceRestoreHelp = `Usage:
  tsx scripts/db/restore-governance-snapshot.ts \\
    --input=/absolute/path/governance-before.json \\
    --sha256=<64-hex-digest> [--apply]

The default is a database-free dry run that verifies the file SHA-256,
strict snapshot schema, referential closure, and declared table counts.
Pass --apply explicitly to restore within one database transaction. Production
apply must run as a child of with-governance-maintenance-lock.ts and prove that
the parent token lock is still held.
`;

export function parseGovernanceRestoreOptions(
  args: readonly string[],
): GovernanceRestoreOptions {
  if (args.length === 1 && ["--help", "-h"].includes(args[0] ?? "")) {
    return { help: true };
  }

  const seen = new Set<string>();
  let inputPath: string | undefined;
  let expectedSha256: string | undefined;
  let apply = false;

  for (const argument of z.array(z.string()).parse(args)) {
    const [name] = argument.split("=", 1);
    if (seen.has(name)) {
      throw new Error(`Duplicate option: ${name}`);
    }
    seen.add(name);

    if (argument.startsWith("--input=")) {
      inputPath = inputPathSchema.parse(argument.slice("--input=".length));
    } else if (argument.startsWith("--sha256=")) {
      expectedSha256 = sha256Schema.parse(
        argument.slice("--sha256=".length),
      );
    } else if (argument === "--apply") {
      apply = true;
    } else {
      throw new Error(`Unknown option: ${name}`);
    }
  }

  if (!inputPath || !expectedSha256) {
    throw new Error("Both --input and --sha256 are required");
  }

  return {
    apply,
    expectedSha256,
    help: false,
    inputPath,
  };
}
