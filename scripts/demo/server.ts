import { createServer } from "node:http";

import { z } from "zod";

const demoServerEnvironmentSchema = z
  .object({
    DEMO_HOST: z
      .enum(["127.0.0.1", "localhost"])
      .default("127.0.0.1"),
    DEMO_PORT: z.coerce.number().int().min(1_024).max(65_535).default(3_000),
  })
  .strict();

const serverEnvironment = demoServerEnvironmentSchema.parse({
  DEMO_HOST: process.env.DEMO_HOST,
  DEMO_PORT: process.env.DEMO_PORT,
});

delete process.env.AI_API_KEY;
delete process.env.AI_BASE_URL;
delete process.env.AI_ENABLE_THINKING;
delete process.env.AI_MODEL;
delete process.env.ADMIN_ROLE_BINDINGS_JSON;
delete process.env.DATABASE_URL;

process.env.AI_PROVIDER = "openai-compatible";
process.env.APP_VERSION = "portfolio-demo";
process.env.COUNTRY_STALE_AFTER_DAYS = "3650";
process.env.DATABASE_MODE = "pglite-demo";
process.env.KNOWLEDGE_STORAGE_ROOT = "portfolio-demo-knowledge";
Reflect.set(process.env, "NODE_ENV", "development");
process.env.PORTFOLIO_DEMO_MODE = "true";

async function startDemoServer() {
  const { default: next } = await import("next");
  const app = next({
    dev: true,
    hostname: serverEnvironment.DEMO_HOST,
    port: serverEnvironment.DEMO_PORT,
  });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = createServer((request, response) => {
    void handle(request, response);
  });

  const shutdown = () => {
    server.closeAllConnections();
    server.close(() => {
      void app.close().finally(() => process.exit(0));
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  server.listen(
    serverEnvironment.DEMO_PORT,
    serverEnvironment.DEMO_HOST,
    () => {
      const host =
        serverEnvironment.DEMO_HOST === "localhost"
          ? "localhost"
          : serverEnvironment.DEMO_HOST;
      console.log(
        `Portfolio demo ready at http://${host}:${serverEnvironment.DEMO_PORT}`,
      );
      console.log(
        "Uses an in-memory fixture database and deterministic offline demo AI; database and AI credentials are ignored.",
      );
    },
  );
}

void startDemoServer().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Portfolio demo failed to start.",
  );
  process.exit(1);
});
