import { env } from "@/env";
import { createReadinessPayload } from "@/lib/health";
import { checkDatabaseReadiness } from "@/server/health/readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const ready = await checkDatabaseReadiness();

  return Response.json(
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
  );
}
