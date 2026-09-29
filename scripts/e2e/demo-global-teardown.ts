import { requestLocalServerShutdown } from "./shutdown-local-server";

export default async function demoGlobalTeardown(): Promise<void> {
  if (process.env.PLAYWRIGHT_DEMO_BASE_URL) return;
  await requestLocalServerShutdown(
    "http://127.0.0.1:3200/__demo/shutdown",
    "Portfolio demo server",
  );
}
