export const E2E_TS_BUILD_INFO_FILE =
  ".next-e2e/cache/tsconfig.tsbuildinfo";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createE2eTsconfig(config: unknown): Record<string, unknown> {
  if (!isRecord(config) || !isRecord(config.compilerOptions)) {
    throw new Error("tsconfig.json must contain compilerOptions");
  }

  return {
    ...config,
    compilerOptions: {
      ...config.compilerOptions,
      tsBuildInfoFile: E2E_TS_BUILD_INFO_FILE,
    },
  };
}
