import { env } from "@/env";
import { createReadinessPayload } from "@/lib/health";
import { checkDatabaseReadiness } from "@/server/health/readiness";
import { createApiRequestObserver } from "@/server/observability/structured-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const observer = createApiRequestObserver("/api/health/ready");
  const ready = await checkDatabaseReadiness();

  return observer.finish(Response.json(
    createReadinessPayload({
      ready,
      version: env.APP_VERSION,
    }),
    {
      headers: {
        "Cache-Control": "no-store",
      },
      status: ready ? 200 : 503,
    },
  ), ready ? null : "DATABASE_NOT_READY");
}
