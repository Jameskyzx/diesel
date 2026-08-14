import { z } from "zod";

export type KnowledgeOrphanOptions = {
  deleteFiles: boolean;
  minimumAgeHours: number;
};

const minimumAgeHoursSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(24 * 365);

export function parseKnowledgeOrphanOptions(
  args: readonly string[],
): KnowledgeOrphanOptions {
  let deleteFiles = false;
  let minimumAgeHours = 24;
  let sawDelete = false;
  let sawMinimumAge = false;

  for (const argument of args) {
    if (argument === "--delete") {
      if (sawDelete) {
        throw new Error("--delete may be specified only once");
      }
      sawDelete = true;
      deleteFiles = true;
      continue;
    }
    if (argument.startsWith("--minimum-age-hours=")) {
      if (sawMinimumAge) {
        throw new Error("--minimum-age-hours may be specified only once");
      }
      sawMinimumAge = true;
      minimumAgeHours = minimumAgeHoursSchema.parse(
        argument.slice("--minimum-age-hours=".length),
      );
      continue;
    }
    throw new Error(`Unknown knowledge orphan option: ${argument}`);
  }

  return { deleteFiles, minimumAgeHours };
}
