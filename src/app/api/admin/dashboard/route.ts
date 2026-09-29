import { NextResponse } from "next/server";

import { admitAdminDashboardResponse } from "@/server/http/admin-dashboard-response";
import { handleAdminRoute } from "@/server/http/admin-route";
import { getGovernanceDashboard } from "@/server/services/governance-service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleAdminRoute(
    request,
    "editor",
    "/api/admin/dashboard",
    async (principal) => {
      const dashboard = await getGovernanceDashboard(principal);
      return NextResponse.json(
        admitAdminDashboardResponse(
          {
            ...dashboard,
            status: "ok",
          },
          principal,
        ),
      );
    },
  );
}
