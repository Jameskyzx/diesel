import { NextResponse } from "next/server";

import {
  handleAdminRoute,
  readAdminJsonRequest,
} from "@/server/http/admin-route";
import { publishGovernanceDraft } from "@/server/services/governance-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
): Promise<Response> {
  return handleAdminRoute(request, "reviewer", async (principal) => {
    const { draftId } = await context.params;
    const body = await readAdminJsonRequest(request);

    return NextResponse.json({
      publication: await publishGovernanceDraft({
        actor: principal,
        draftId,
        reason:
          typeof body === "object" && body !== null && "reason" in body
            ? body.reason
            : undefined,
      }),
      status: "published",
    });
  });
}
