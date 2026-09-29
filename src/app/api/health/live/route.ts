import { env } from "@/env";
import { createHealthPayload } from "@/lib/health";
import { createPublicApiRequestObserver } from "@/server/http/public-api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  const observer = createPublicApiRequestObserver("/api/health/live");
  return observer.finish(
    Response.json(createHealthPayload({
      version: env.APP_VERSION,
    })),
  );
}
