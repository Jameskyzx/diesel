import { NextResponse } from "next/server";

import { handleAdminRoute } from "@/server/http/admin-route";
import { getGovernanceDashboard } from "@/server/services/governance-service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleAdminRoute(request, "editor", async (principal) =>
    NextResponse.json({
      ...(await getGovernanceDashboard()),
      principal,
      status: "ok",
    }),
  );
}
