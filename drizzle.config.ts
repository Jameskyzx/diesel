import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/server/db/schema/index.ts",
  strict: true,
  verbose: true,
});
