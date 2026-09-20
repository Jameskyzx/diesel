import { z } from "zod";

export const databaseModeSchema = z.enum(["postgres", "pglite-demo"]);

const protectedDatabaseUrlParameters = new Set([
  "idle_in_transaction_session_timeout",
  "lock_timeout",
  "options",
  "statement_timeout",
]);
const databaseUrlControlCharacters = /[\u0000-\u001f\u007f]/u;

function hasUnsafeDatabaseUrlControlCharacters(value: string): boolean {
  // WHATWG URL parsing silently removes raw HT/LF/CR. Inspect the validated,
  // trimmed source first so parser normalization cannot weaken this boundary.
  if (databaseUrlControlCharacters.test(value)) {
    return true;
  }

  const url = new URL(value);
  const encodedComponents = [
    url.username,
    url.password,
    url.pathname,
  ];
  for (const component of encodedComponents) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(component);
    } catch {
      return true;
    }
    if (databaseUrlControlCharacters.test(decoded)) {
      return true;
    }
  }

  return [...url.searchParams.entries()].some(
    ([key, parameterValue]) =>
      databaseUrlControlCharacters.test(key) ||
      databaseUrlControlCharacters.test(parameterValue),
  );
}

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
  )
  .refine(
    (value) => {
      const url = new URL(value);
      return [...url.searchParams.keys()].every(
        (key) => !protectedDatabaseUrlParameters.has(key.toLowerCase()),
      );
    },
    {
      message:
        "DATABASE_URL must not override application-controlled database timeouts",
    },
  )
  .refine((value) => !hasUnsafeDatabaseUrlControlCharacters(value), {
    message: "DATABASE_URL must not contain control characters",
  });

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
