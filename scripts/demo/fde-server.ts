import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { z } from "zod";

import { formatErrorTree } from "../format-error";
import {
  createNextEnvironmentFileGuard,
  restoreNextEnvironmentAfterFailure,
  restoreRecordedNextEnvironmentAfterFailure,
  restoreRecordedNextEnvironmentAfterOperation,
} from "../next-environment-file";
import {
  correctedFdeMarketCsv,
  invalidFdeMarketCsv,
} from "./fde-fixtures";

const environmentSchema = z
  .object({
    DEMO_HOST: z.enum(["127.0.0.1", "localhost"]).default("127.0.0.1"),
    DEMO_PORT: z.coerce.number().int().min(1_024).max(65_535).default(3_300),
  })
  .strict();
const personaSchema = z.enum(["editor", "reviewer", "admin"]);
type Persona = z.infer<typeof personaSchema>;

const serverEnvironment = environmentSchema.parse({
  DEMO_HOST: process.env.DEMO_HOST,
  DEMO_PORT: process.env.DEMO_PORT,
});

delete process.env.AI_API_KEY;
delete process.env.AI_BASE_URL;
delete process.env.AI_ENABLE_THINKING;
delete process.env.AI_MODEL;
delete process.env.DATABASE_URL;
delete process.env.PLAYWRIGHT_E2E;

process.env.AI_PROVIDER = "openai-compatible";
process.env.AI_CHAT_RATE_LIMIT_BACKEND = "memory";
process.env.APP_VERSION = "fde-implementation-demo";
process.env.COUNTRY_STALE_AFTER_DAYS = "3650";
process.env.DATABASE_MODE = "pglite-demo";
process.env.FDE_IMPLEMENTATION_DEMO_MODE = "true";
process.env.KNOWLEDGE_STORAGE_ROOT = "fde-implementation-demo-knowledge";
process.env.ADMIN_ROLE_BINDINGS_JSON = JSON.stringify({
  "admin@fde-demo.local": "admin",
  "editor@fde-demo.local": "editor",
  "reviewer@fde-demo.local": "reviewer",
});
Reflect.set(process.env, "NODE_ENV", "development");
process.env.PORTFOLIO_DEMO_MODE = "true";

function cookies(request: IncomingMessage): Map<string, string> {
  return new Map(
    (request.headers.cookie ?? "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf("=");
        return separator < 0
          ? [item, ""]
          : [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
      }),
  );
}

function activePersona(request: IncomingMessage): Persona {
  const parsed = personaSchema.safeParse(cookies(request).get("fde_demo_persona"));
  return parsed.success ? parsed.data : "editor";
}

function serveCsv(response: ServerResponse, contents: string, name: string): void {
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Content-Type": "text/csv; charset=utf-8",
  });
  response.end(contents);
}

async function startFdeDemoServer(): Promise<void> {
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
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${serverEnvironment.DEMO_HOST}:${serverEnvironment.DEMO_PORT}`,
    );

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/__fde/shutdown"
    ) {
      void shutdown(false).then(
        () => {
          response.once("finish", () => {
            server.closeAllConnections();
            process.exit(0);
          });
          response.writeHead(200, {
            "content-type": "application/json",
          });
          response.end(JSON.stringify({ status: "stopped" }));
        },
        (error: unknown) => {
          console.error(formatErrorTree(error, "fde-shutdown").trimEnd());
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

    if (requestUrl.pathname === "/__fde/persona") {
      const persona = personaSchema.safeParse(requestUrl.searchParams.get("role"));
      if (!persona.success) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Invalid local demo persona.");
        return;
      }
      response.writeHead(303, {
        "Cache-Control": "no-store",
        Location: "/admin",
        "Set-Cookie": `fde_demo_persona=${persona.data}; HttpOnly; SameSite=Lax; Path=/`,
      });
      response.end();
      return;
    }
    if (requestUrl.pathname === "/__fde/fixtures/invalid.csv") {
      serveCsv(response, invalidFdeMarketCsv, "fde-demo-invalid.csv");
      return;
    }
    if (requestUrl.pathname === "/__fde/fixtures/corrected.csv") {
      serveCsv(response, correctedFdeMarketCsv, "fde-demo-corrected.csv");
      return;
    }

    request.headers["oai-authenticated-user-email"] =
      `${activePersona(request)}@fde-demo.local`;
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
        console.error(formatErrorTree(error, "fde-shutdown").trimEnd());
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
  console.log(
    `FDE implementation demo ready at http://${serverEnvironment.DEMO_HOST}:${serverEnvironment.DEMO_PORT}/admin`,
  );
  console.log(
    "LOCAL / MUTABLE / FICTIONAL — fresh in-process PGlite; production credentials are ignored.",
  );
}

void startFdeDemoServer().catch((error: unknown) => {
  console.error(formatErrorTree(error, "fde-server").trimEnd());
  process.exit(1);
});
