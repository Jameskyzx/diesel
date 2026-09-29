import { requestLocalServerShutdown } from "./shutdown-local-server";

export default async function globalTeardown() {
  const shutdowns = [
    requestLocalServerShutdown(
      "http://127.0.0.1:3200/__e2e/global-error-shutdown",
      "Global-error fixture",
    ),
  ];
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    shutdowns.push(
      requestLocalServerShutdown(
        "http://127.0.0.1:3100/__e2e/shutdown",
        "E2E server",
      ),
    );
  }

  const results = await Promise.allSettled(shutdowns);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "One or more Playwright servers could not shut down cleanly.",
    );
  }
}
