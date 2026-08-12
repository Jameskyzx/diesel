import { NextResponse } from "next/server";

import {
  handleAdminRoute,
  readAdminJsonRequest,
} from "@/server/http/admin-route";
import { confirmMarketCsvImport } from "@/server/services/governance-service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  return handleAdminRoute(request, "editor", async (principal) => {
    const { batchId } = await context.params;
    const body = await readAdminJsonRequest(request);

    return NextResponse.json(
      await confirmMarketCsvImport({
        actor: principal,
        batchId,
        reason:
          typeof body === "object" && body !== null && "reason" in body
            ? body.reason
            : undefined,
      }),
    );
  });
}
