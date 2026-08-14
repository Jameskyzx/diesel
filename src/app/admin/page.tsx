import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { AdminDashboard } from "@/components/admin/admin-dashboard";
import {
  AdminAuthorizationError,
  resolveAdminPrincipal,
} from "@/server/auth/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "数据治理后台",
};

async function getAdminPrincipal() {
  try {
    return resolveAdminPrincipal(await headers());
  } catch (error: unknown) {
    if (error instanceof AdminAuthorizationError) {
      notFound();
    }
    throw error;
  }
}

export default async function AdminPage() {
  const principal = await getAdminPrincipal();
  return (
    <AdminDashboard
      initialPrincipal={principal}
      initialUtcNow={new Date().toISOString()}
    />
  );
}
