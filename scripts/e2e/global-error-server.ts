import { createServer } from "node:http";

import next from "next";

import { formatErrorTree } from "../format-error";
import {
  createNextEnvironmentFileGuard,
  restoreNextEnvironmentAfterFailure,
  restoreRecordedNextEnvironmentAfterFailure,
  restoreRecordedNextEnvironmentAfterOperation,
} from "../next-environment-file";

const fixtureDirectory = "tests/fixtures/global-error-app";

async function startServer() {
  const hostname = "127.0.0.1";
  const port = 3200;
  const nextEnvPath = `${fixtureDirectory}/next-env.d.ts`;
  const nextEnvironmentGuard =
    await createNextEnvironmentFileGuard({
      allowedGeneratedRouteImports: ["./.next/dev/types/routes.d.ts"],
      path: nextEnvPath,
    });
  let terminationRequested = false;
  let activeSignalShutdown: (() => void) | null = null;
  const handleTerminationSignal = () => {
    terminationRequested = true;
    activeSignalShutdown?.();
  };
  process.on("SIGINT", handleTerminationSignal);
  process.on("SIGTERM", handleTerminationSignal);
  const app = next({
    dev: true,
    dir: fixtureDirectory,
    hostname,
    port,
    webpack: true,
  });

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

  const handle = app.getRequestHandler();
  let shuttingDown = false;
  const server = createServer((request, response) => {
    if (
      request.method === "POST" &&
      request.url === "/__e2e/global-error-shutdown"
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
          console.error(
            formatErrorTree(error, "global-error-shutdown").trimEnd(),
          );
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
        console.error(
          formatErrorTree(error, "global-error-shutdown").trimEnd(),
        );
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
      server.listen(port, hostname);
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
    `Global-error fixture ready at http://${hostname}:${port}`,
  );
}

void startServer().catch((error: unknown) => {
  console.error(formatErrorTree(error, "global-error-server").trimEnd());
  process.exit(1);
});
