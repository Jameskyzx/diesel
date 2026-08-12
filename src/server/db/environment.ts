import { z } from "zod";

export const databaseModeSchema = z.enum(["postgres", "pglite-demo"]);

export const databaseUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(
    (value) => {
      const protocol = new URL(value).protocol;
      return protocol === "postgres:" || protocol === "postgresql:";
    },
    {
      message: "DATABASE_URL must use the postgres or postgresql protocol",
    },
  );

export function getDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return databaseUrlSchema.parse(environment.DATABASE_URL);
}

export function getDatabaseMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): z.infer<typeof databaseModeSchema> {
  return databaseModeSchema
    .default("postgres")
    .refine(
      (mode) => environment.NODE_ENV !== "production" || mode === "postgres",
      {
        message:
          "DATABASE_MODE=pglite-demo is forbidden when NODE_ENV=production",
      },
    )
    .parse(environment.DATABASE_MODE);
}
