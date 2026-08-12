import "server-only";

import { z } from "zod";

import { env } from "@/env";
import { getDatabaseMode } from "@/server/db/environment";

const portfolioDemoRuntimeSchema = z
  .object({
    databaseMode: z.enum(["postgres", "pglite-demo"]),
    enabled: z.boolean(),
    nodeEnv: z.enum(["development", "test", "production"]),
  })
  .strict();

export type PortfolioDemoRuntime = z.infer<
  typeof portfolioDemoRuntimeSchema
>;

/**
 * Demo mode is deliberately fail-closed: it can only run with the in-memory
 * fixture database outside production. A deployment cannot accidentally turn
 * a public production process into the portfolio simulation.
 */
export function resolvePortfolioDemoMode(
  input: PortfolioDemoRuntime,
): boolean {
  const runtime = portfolioDemoRuntimeSchema.parse(input);

  if (!runtime.enabled) {
    return false;
  }

  if (
    runtime.databaseMode !== "pglite-demo" ||
    runtime.nodeEnv !== "development"
  ) {
    throw new Error(
      "PORTFOLIO_DEMO_MODE requires development + pglite-demo.",
    );
  }

  return true;
}

export function isPortfolioDemoMode(): boolean {
  return resolvePortfolioDemoMode({
    databaseMode: getDatabaseMode(),
    enabled: env.PORTFOLIO_DEMO_MODE,
    nodeEnv: env.NODE_ENV,
  });
}
