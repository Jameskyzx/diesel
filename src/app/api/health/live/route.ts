import { env } from "@/env";
import { createHealthPayload } from "@/lib/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(
    createHealthPayload({
      version: env.APP_VERSION,
    }),
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
