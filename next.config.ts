import type { NextConfig } from "next";

const isPlaywrightE2e = process.env.PLAYWRIGHT_E2E === "true";

const nextConfig: NextConfig = {
  distDir: isPlaywrightE2e ? ".next-e2e" : ".next",
  reactStrictMode: true,
  typescript: {
    tsconfigPath: isPlaywrightE2e ? "tsconfig.e2e.json" : "tsconfig.json",
  },
};

export default nextConfig;
