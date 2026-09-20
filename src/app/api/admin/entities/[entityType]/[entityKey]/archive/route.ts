import { NextResponse } from "next/server";

import {
  handleAdminRoute,
  readAdminJsonRequest,
} from "@/server/http/admin-route";
import { archiveGovernedEntity } from "@/server/services/governance-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ entityKey: string; entityType: string }>;
  },
): Promise<Response> {
  return handleAdminRoute(
    request,
    "admin",
    "/api/admin/entities/:entityType/:entityKey/archive",
    async (principal) => {
      const { entityKey, entityType } = await context.params;
      const body = await readAdminJsonRequest(request);

      await archiveGovernedEntity({
        actor: principal,
        entityKey,
        entityType,
        reason:
          typeof body === "object" && body !== null && "reason" in body
            ? body.reason
            : undefined,
      });

      return NextResponse.json({ status: "archived" });
    },
  );
}
