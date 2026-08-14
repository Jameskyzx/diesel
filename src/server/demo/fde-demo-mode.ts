import "server-only";

export function isFdeImplementationDemoMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.NODE_ENV === "development" &&
    environment.DATABASE_MODE === "pglite-demo" &&
    environment.PORTFOLIO_DEMO_MODE === "true" &&
    environment.FDE_IMPLEMENTATION_DEMO_MODE === "true";
}
