import { env } from "@/env";
import { createReadinessPayload } from "@/lib/health";
import { checkDatabaseReadiness } from "@/server/health/readiness";
import { validateAiChatAdmissionBudgetConfiguration } from "@/server/http/ai-admission-budget";
import { validateAiChatRateLimitConfiguration } from "@/server/http/rate-limit";
import { createPublicApiRequestObserver } from "@/server/http/public-api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const observer = createPublicApiRequestObserver("/api/health/ready");
  let aiChatAdmissionReady = true;
  try {
    validateAiChatAdmissionBudgetConfiguration();
  } catch {
    aiChatAdmissionReady = false;
  }
  let aiChatRateLimitReady = true;
  try {
    validateAiChatRateLimitConfiguration();
  } catch {
    aiChatRateLimitReady = false;
  }
  const databaseReady = await checkDatabaseReadiness();
  const ready =
    aiChatAdmissionReady && aiChatRateLimitReady && databaseReady;
  const failedCheckCount = [
    aiChatAdmissionReady,
    aiChatRateLimitReady,
    databaseReady,
  ].filter((checkReady) => !checkReady).length;
  const errorCode = ready
    ? null
    : failedCheckCount > 1
      ? "READINESS_CHECKS_FAILED"
      : !aiChatAdmissionReady
        ? "AI_CHAT_ADMISSION_CONFIG_NOT_READY"
        : !aiChatRateLimitReady
          ? "AI_CHAT_RATE_LIMIT_CONFIG_NOT_READY"
          : "DATABASE_NOT_READY";

  return observer.finish(
    Response.json(
      createReadinessPayload({
        aiChatAdmissionReady,
        aiChatRateLimitReady,
        databaseReady,
        version: env.APP_VERSION,
      }),
      { status: ready ? 200 : 503 },
    ),
    errorCode,
  );
}
