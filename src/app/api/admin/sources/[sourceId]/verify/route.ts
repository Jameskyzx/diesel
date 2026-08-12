import { NextResponse } from "next/server";

import {
  handleAdminRoute,
  readAdminJsonRequest,
} from "@/server/http/admin-route";
import { verifyDataSource } from "@/server/services/governance-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
): Promise<Response> {
  return handleAdminRoute(request, "editor", async (principal) => {
    const { sourceId } = await context.params;
    const body = await readAdminJsonRequest(request);

    return NextResponse.json({
      source: await verifyDataSource({
        actor: principal,
        reason:
          typeof body === "object" && body !== null && "reason" in body
            ? body.reason
            : undefined,
        sourceId,
        verifiedAt:
          typeof body === "object" && body !== null && "verifiedAt" in body
            ? body.verifiedAt
            : undefined,
      }),
      status: "verified",
    });
  });
}
