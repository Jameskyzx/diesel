import type { ReactNode } from "react";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export default async function FixtureLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();

  if (cookieStore.get("__e2e_global_error")?.value === "1") {
    throw new Error("Controlled root-layout failure for global-error E2E");
  }

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

