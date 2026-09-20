import { createServer } from "node:http";

import { z } from "zod";

import { formatErrorTree } from "../format-error";
import {
  createNextEnvironmentFileGuard,
  restoreNextEnvironmentAfterFailure,
  restoreRecordedNextEnvironmentAfterFailure,
  restoreRecordedNextEnvironmentAfterOperation,
} from "../next-environment-file";
import {
  screenshotDemoInstanceNonceEnvironmentVariable,
  screenshotDemoInstanceNonceSchema,
  screenshotDemoReadinessPath,
  screenshotDemoShutdownNonceHeader,
  screenshotDemoShutdownPath,
  serializeScreenshotDemoReadiness,
  serializeScreenshotDemoShutdown,
} from "../portfolio/screenshot-demo-session";

const demoServerEnvironmentSchema = z
  .object({
    DEMO_HOST: z
      .enum(["127.0.0.1", "localhost"])
      .default("127.0.0.1"),
    DEMO_INSTANCE_NONCE: screenshotDemoInstanceNonceSchema.optional(),
    DEMO_PORT: z.coerce.number().int().min(1_024).max(65_535).default(3_000),
  })
  .strict();

const serverEnvironment = demoServerEnvironmentSchema.parse({
  DEMO_HOST: process.env.DEMO_HOST,
  DEMO_INSTANCE_NONCE:
    process.env[screenshotDemoInstanceNonceEnvironmentVariable],
  DEMO_PORT: process.env.DEMO_PORT,
});

delete process.env.AI_API_KEY;
delete process.env.AI_BASE_URL;
delete process.env.AI_ENABLE_THINKING;
delete process.env.AI_MODEL;
delete process.env.ADMIN_ROLE_BINDINGS_JSON;
delete process.env.DATABASE_URL;
delete process.env[screenshotDemoInstanceNonceEnvironmentVariable];
delete process.env.PLAYWRIGHT_E2E;

process.env.AI_PROVIDER = "openai-compatible";
process.env.AI_CHAT_RATE_LIMIT_BACKEND = "memory";
process.env.APP_VERSION = "portfolio-demo";
process.env.COUNTRY_STALE_AFTER_DAYS = "3650";
process.env.DATABASE_MODE = "pglite-demo";
process.env.KNOWLEDGE_STORAGE_ROOT = "portfolio-demo-knowledge";
Reflect.set(process.env, "NODE_ENV", "development");
process.env.PORTFOLIO_DEMO_MODE = "true";

async function startDemoServer() {
  const nextEnvironmentGuard = await createNextEnvironmentFileGuard({
    allowedGeneratedRouteImports: ["./.next/dev/types/routes.d.ts"],
  });
  let terminationRequested = false;
  let activeSignalShutdown: (() => void) | null = null;
  const handleTerminationSignal = () => {
    terminationRequested = true;
    activeSignalShutdown?.();
  };
  process.on("SIGINT", handleTerminationSignal);
  process.on("SIGTERM", handleTerminationSignal);
  const { default: next } = await import("next");
  const app = next({
    dev: true,
    hostname: serverEnvironment.DEMO_HOST,
    port: serverEnvironment.DEMO_PORT,
  });
  const handle = app.getRequestHandler();

  try {
    await app.prepare();
  } catch (prepareError: unknown) {
    let operationError = prepareError;
    try {
      await app.close();
    } catch (closeError: unknown) {
      operationError = new AggregateError(
        [prepareError, closeError],
        "Next.js preparation and cleanup both failed.",
      );
    }
    await restoreNextEnvironmentAfterFailure(
      nextEnvironmentGuard,
      operationError,
    );
  }
  try {
    await nextEnvironmentGuard.recordGeneratedState();
  } catch (recordError: unknown) {
    let operationError = recordError;
    try {
      await app.close();
    } catch (closeError: unknown) {
      operationError = new AggregateError(
        [recordError, closeError],
        "next-env.d.ts validation and Next.js cleanup both failed.",
      );
    }
    await restoreRecordedNextEnvironmentAfterFailure(
      nextEnvironmentGuard,
      operationError,
    );
  }

  let shuttingDown = false;
  const server = createServer((request, response) => {
    if (
      request.method === "GET" &&
      request.url === screenshotDemoReadinessPath &&
      serverEnvironment.DEMO_INSTANCE_NONCE !== undefined
    ) {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json",
      });
      response.end(
        serializeScreenshotDemoReadiness(
          serverEnvironment.DEMO_INSTANCE_NONCE,
        ),
      );
      return;
    }
    if (
      request.method === "POST" &&
      request.url === screenshotDemoShutdownPath
    ) {
      if (
        serverEnvironment.DEMO_INSTANCE_NONCE !== undefined &&
        request.headers[screenshotDemoShutdownNonceHeader] !==
          serverEnvironment.DEMO_INSTANCE_NONCE
      ) {
        response.writeHead(403, {
          "cache-control": "no-store",
          connection: "close",
          "content-type": "application/json",
        });
        response.end(JSON.stringify({ status: "unauthorized" }));
        return;
      }
      void shutdown(false).then(
        () => {
          response.once("finish", () => {
            server.closeAllConnections();
            process.exit(0);
          });
          response.writeHead(200, {
            "cache-control": "no-store",
            "content-type": "application/json",
          });
          response.end(
            serverEnvironment.DEMO_INSTANCE_NONCE === undefined
              ? JSON.stringify({ status: "stopped" })
              : serializeScreenshotDemoShutdown(
                  serverEnvironment.DEMO_INSTANCE_NONCE,
                ),
          );
        },
        (error: unknown) => {
          console.error(formatErrorTree(error, "demo-shutdown").trimEnd());
          response.once("finish", () => {
            server.closeAllConnections();
            process.exit(1);
          });
          response.writeHead(500, {
            connection: "close",
            "content-type": "application/json",
          });
          response.end(JSON.stringify({ status: "shutdown_failed" }));
        },
      );
      return;
    }
    if (shuttingDown) {
      response.writeHead(503, {
        connection: "close",
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ status: "shutting_down" }));
      return;
    }
    void handle(request, response);
  });

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (forceConnections: boolean) => {
    shuttingDown = true;
    if (server.listening) {
      server.close();
    }
    if (forceConnections) server.closeAllConnections();
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      try {
        await app.close();
      } catch (closeError: unknown) {
        await restoreRecordedNextEnvironmentAfterFailure(
          nextEnvironmentGuard,
          closeError,
        );
      }
      await restoreRecordedNextEnvironmentAfterOperation(
        nextEnvironmentGuard,
      );
    })();
    return shutdownPromise;
  };
  let signalShutdownStarted = false;
  const shutdownFromSignal = () => {
    if (signalShutdownStarted) return;
    signalShutdownStarted = true;
    void shutdown(true).then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(formatErrorTree(error, "demo-shutdown").trimEnd());
        process.exit(1);
      },
    );
  };

  activeSignalShutdown = shutdownFromSignal;
  if (terminationRequested) {
    shutdownFromSignal();
    return;
  }

  try {
    await new Promise<void>((resolveListening, rejectListening) => {
      const handleListenError = (error: Error) => {
        server.off("listening", handleListening);
        rejectListening(error);
      };
      const handleListening = () => {
        server.off("error", handleListenError);
        resolveListening();
      };
      server.once("error", handleListenError);
      server.once("listening", handleListening);
      server.listen(
        serverEnvironment.DEMO_PORT,
        serverEnvironment.DEMO_HOST,
      );
    });
  } catch (listenError: unknown) {
    let operationError = listenError;
    try {
      await app.close();
    } catch (closeError: unknown) {
      operationError = new AggregateError(
        [listenError, closeError],
        "HTTP listen and Next.js cleanup both failed.",
      );
    }
    await restoreRecordedNextEnvironmentAfterFailure(
      nextEnvironmentGuard,
      operationError,
    );
  }
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
}

void startDemoServer().catch((error: unknown) => {
  console.error(formatErrorTree(error, "demo-server").trimEnd());
  process.exit(1);
});
