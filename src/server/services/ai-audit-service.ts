import "server-only";

import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import {
  createAiAuditRepository,
  type AiAuditRepository,
} from "@/server/repositories/ai-audit-repository";

export async function getAiAuditRepository(): Promise<AiAuditRepository> {
  if (getDatabaseMode() === "pglite-demo") {
    return createAiAuditRepository(await getDemoDatabase());
  }

  return createAiAuditRepository(getDatabase());
}
