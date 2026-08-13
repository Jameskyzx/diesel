import { copyFile, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

import next from "next";

async function startServer() {
  const hostname = "127.0.0.1";
  const port = 3100;
  const originalNextEnv = await readFile("next-env.d.ts");

  await copyFile("tsconfig.json", "tsconfig.e2e.json");
  const app = next({
    dev: true,
    hostname,
    port,
  });
  const handle = app.getRequestHandler();

  try {
    await app.prepare();
  } finally {
    // Next writes generated route imports to the repository-level
    // next-env.d.ts even when the E2E server uses a separate distDir. Restore
    // the exact pre-test file so Playwright never dirties production config.
    await writeFile("next-env.d.ts", originalNextEnv);
  }

  const server = createServer((request, response) => {
    if (
      process.env.DATABASE_MODE === "pglite-demo" &&
      request.method === "POST" &&
      request.url === "/__e2e/shutdown"
    ) {
      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ status: "shutting_down" }));

      setTimeout(() => {
        server.closeAllConnections();
        server.close(() => {
          void app.close().finally(() => process.exit(0));
        });
      }, 50);
      return;
    }

    void handle(request, response);
  });

  server.listen(port, hostname, () => {
    console.log(`E2E server ready at http://${hostname}:${port}`);
  });
}

void startServer().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error("E2E server failed to start");
  }
  process.exit(1);
});
