import { requestLocalServerShutdown } from "./shutdown-local-server";

export default async function fdeGlobalTeardown(): Promise<void> {
  if (process.env.PLAYWRIGHT_FDE_BASE_URL) return;
  await requestLocalServerShutdown(
    "http://127.0.0.1:3300/__fde/shutdown",
    "FDE demo server",
  );
}
