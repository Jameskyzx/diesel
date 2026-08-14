import { env } from "@/env";
import { createHealthPayload } from "@/lib/health";
import { createApiRequestObserver } from "@/server/observability/structured-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  const observer = createApiRequestObserver("/api/health/live");
  return observer.finish(Response.json(
    createHealthPayload({
      version: env.APP_VERSION,
    }),
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  ));
}
