import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import { assertMapLibreWorkerAssets } from "./scripts/maplibre-worker-assets";

import {
  WORLD_COUNTRIES_GEOJSON_URL,
} from "./src/lib/geo-assets";

export function createApplicationSecurityHeaders(
  allowDevelopmentRuntimeSources: boolean,
) {
  const scriptSources = ["'self'", "'unsafe-inline'"];
  const connectSources = ["'self'"];
  if (allowDevelopmentRuntimeSources) {
    scriptSources.push("'unsafe-eval'");
    connectSources.push("ws:", "wss:");
  }

  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    {
      key: "Content-Security-Policy",
      value: [
        "default-src 'self'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
        "object-src 'none'",
        "form-action 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        `script-src ${scriptSources.join(" ")}`,
        `connect-src ${connectSources.join(" ")}`,
        "worker-src 'self'",
      ].join("; "),
    },
  ] as const;
}

export const APPLICATION_SECURITY_HEADERS =
  createApplicationSecurityHeaders(false);

export function createNextConfig(phase: string): NextConfig {
  // Next emits the worker URL without its relative shared module. Both
  // versioned, same-origin assets must match the installed package before use.
  assertMapLibreWorkerAssets();
  const isDevelopmentServer = phase === PHASE_DEVELOPMENT_SERVER;
  const isPlaywrightE2e = process.env.PLAYWRIGHT_E2E === "true";
  const securityHeaders = createApplicationSecurityHeaders(
    isDevelopmentServer,
  );

  return {
    distDir: isPlaywrightE2e ? ".next-e2e" : ".next",
    reactStrictMode: true,
    // PGlite resolves its WASM and pgvector tar bundle from import.meta.url.
    // Server bundling rewrites those file URLs into public /_next assets, which
    // are not valid filesystem inputs for the Node runtime.
    serverExternalPackages: [
      "@electric-sql/pglite",
      "@electric-sql/pglite-pgvector",
    ],
    typescript: {
      tsconfigPath: isPlaywrightE2e ? "tsconfig.e2e.json" : "tsconfig.json",
    },
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [...securityHeaders],
        },
        {
          source: WORLD_COUNTRIES_GEOJSON_URL,
          headers: [
            {
              key: "Cache-Control",
              value: "public, max-age=31536000, immutable",
            },
          ],
        },
      ];
    },
    async redirects() {
      return [
        {
          source: "/geo/world-countries.geojson",
          destination: WORLD_COUNTRIES_GEOJSON_URL,
          permanent: false,
        },
      ];
    },
    async rewrites() {
      return [
        {
          source: WORLD_COUNTRIES_GEOJSON_URL,
          destination: "/geo/world-countries.geojson",
        },
      ];
    },
  };
}

export default createNextConfig;
