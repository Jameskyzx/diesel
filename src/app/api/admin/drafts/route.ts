import { NextResponse } from "next/server";

import {
  handleAdminRoute,
  readAdminJsonRequest,
} from "@/server/http/admin-route";
import { createGovernanceDraft } from "@/server/services/governance-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleAdminRoute(request, "editor", async (principal) =>
    NextResponse.json(
      {
        draft: await createGovernanceDraft(
          await readAdminJsonRequest(request),
          principal,
        ),
        status: "created",
      },
      { status: 201 },
    ),
  );
}
