import { NextResponse } from "next/server";

import {
  handleAdminRoute,
  readAdminJsonRequest,
} from "@/server/http/admin-route";
import { createGovernanceDraft } from "@/server/services/governance-service";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleAdminRoute(
    request,
    "editor",
    "/api/admin/drafts",
    async (principal) => {
      await createGovernanceDraft(
        await readAdminJsonRequest(request),
        principal,
      );

      return NextResponse.json({ status: "created" }, { status: 201 });
    },
  );
}
