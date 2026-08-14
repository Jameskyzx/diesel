import type { NextConfig } from "next";

import {
  WORLD_COUNTRIES_GEOJSON_URL,
} from "./src/lib/geo-assets";

const isPlaywrightE2e = process.env.PLAYWRIGHT_E2E === "true";

export const APPLICATION_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self' https: wss:",
    ].join("; "),
  },
] as const;

const nextConfig: NextConfig = {
  distDir: isPlaywrightE2e ? ".next-e2e" : ".next",
  reactStrictMode: true,
  typescript: {
    tsconfigPath: isPlaywrightE2e ? "tsconfig.e2e.json" : "tsconfig.json",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...APPLICATION_SECURITY_HEADERS],
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

export default nextConfig;
