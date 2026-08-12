export default async function globalTeardown() {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    return;
  }

  const response = await fetch("http://127.0.0.1:3100/__e2e/shutdown", {
    method: "POST",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`E2E server shutdown failed with ${response.status}`);
  }
}
