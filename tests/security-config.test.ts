import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} from "next/constants";

import {
  APPLICATION_SECURITY_HEADERS,
  createApplicationSecurityHeaders,
  createNextConfig,
} from "../next.config";
import {
  WORLD_COUNTRIES_GEOJSON_SHA256,
  WORLD_COUNTRIES_GEOJSON_URL,
} from "@/lib/geo-assets";

describe("security and immutable asset configuration", () => {
  it("enforces browser security headers at both the app and TLS proxy", async () => {
    expect(APPLICATION_SECURITY_HEADERS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "Content-Security-Policy" }),
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
      ]),
    );

    const nginx = await readFile(
      resolve(process.cwd(), "deploy/nginx/jamesky.site.conf"),
      "utf8",
    );
    expect(nginx.match(/Strict-Transport-Security/g)).toHaveLength(1);
    expect(nginx.indexOf("Strict-Transport-Security")).toBeLessThan(
      nginx.indexOf("location = /admin"),
    );
  });

  it("keeps blob access scoped to rendered images, not module workers", () => {
    const contentSecurityPolicy = APPLICATION_SECURITY_HEADERS.find(
      ({ key }) => key === "Content-Security-Policy",
    );

    expect(contentSecurityPolicy?.value).toContain(
      "img-src 'self' data: blob:",
    );
    expect(contentSecurityPolicy?.value).toContain(
      "worker-src 'self'",
    );
    expect(contentSecurityPolicy?.value).toContain("default-src 'self'");
    expect(contentSecurityPolicy?.value).toContain("object-src 'none'");
    expect(contentSecurityPolicy?.value).not.toMatch(
      /(?:default|script|connect|worker)-src[^;]*blob:/u,
    );
    expect(APPLICATION_SECURITY_HEADERS).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "Content-Security-Policy-Report-Only",
        }),
      ]),
    );
  });

  it("allows development runtime sources only for the Next development-server phase", async () => {
    const developmentPolicy = createApplicationSecurityHeaders(true).find(
      ({ key }) => key === "Content-Security-Policy",
    )?.value;
    const productionPolicy = createApplicationSecurityHeaders(false).find(
      ({ key }) => key === "Content-Security-Policy",
    )?.value;
    const developmentConfigHeaders = await createNextConfig(
      PHASE_DEVELOPMENT_SERVER,
    ).headers?.();
    const productionConfigHeaders = await createNextConfig(
      PHASE_PRODUCTION_BUILD,
    ).headers?.();

    expect(developmentPolicy).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
    expect(developmentPolicy).toContain("connect-src 'self' ws: wss:");
    expect(developmentPolicy).not.toMatch(/connect-src[^;]*https:/u);
    expect(developmentPolicy).toContain("worker-src 'self'");
    expect(developmentPolicy).not.toMatch(/worker-src[^;]*blob:/u);
    expect(productionPolicy).toContain("worker-src 'self'");
    expect(productionPolicy).not.toMatch(/worker-src[^;]*blob:/u);
    expect(productionPolicy).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
    expect(productionPolicy).toContain("connect-src 'self';");
    expect(productionPolicy).not.toMatch(
      /connect-src[^;]*(?:https:|wss?:)/u,
    );
    expect(productionPolicy).not.toContain("'unsafe-eval'");
    expect(developmentConfigHeaders?.[0]?.headers[4]?.value).toBe(
      developmentPolicy,
    );
    expect(productionConfigHeaders?.[0]?.headers[4]?.value).toBe(
      productionPolicy,
    );
    expect(createNextConfig(PHASE_DEVELOPMENT_SERVER).serverExternalPackages)
      .toEqual([
        "@electric-sql/pglite",
        "@electric-sql/pglite-pgvector",
      ]);
  });

  it("redirects geometry to a versioned immutable URL", async () => {
    const nextConfig = createNextConfig(PHASE_PRODUCTION_BUILD);
    const redirects = await nextConfig.redirects?.();
    const rewrites = await nextConfig.rewrites?.();
    const headers = await nextConfig.headers?.();
    const versionedPath = WORLD_COUNTRIES_GEOJSON_URL;

    expect(redirects).toContainEqual({
      source: "/geo/world-countries.geojson",
      destination: versionedPath,
      permanent: false,
    });
    expect(rewrites).toContainEqual({
      source: versionedPath,
      destination: "/geo/world-countries.geojson",
    });
    expect(headers).toContainEqual({
      source: versionedPath,
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ],
    });
  });

  it("derives the client URL from the geometry content hash", async () => {
    const bytes = await readFile(
      resolve(process.cwd(), "public/geo/world-countries.geojson"),
    );
    const digest = createHash("sha256").update(bytes).digest("hex");

    expect(WORLD_COUNTRIES_GEOJSON_SHA256).toBe(digest);
    expect(WORLD_COUNTRIES_GEOJSON_URL).toBe(
      `/geo/world-countries.${digest.slice(0, 8)}.geojson`,
    );
  });

  it("never bypasses an entire file in the gitleaks allowlist", async () => {
    const configuration = await readFile(
      resolve(process.cwd(), ".gitleaks.toml"),
      "utf8",
    );

    expect(configuration).not.toMatch(/^paths\s*=/m);
    expect(configuration).not.toContain("pnpm-lock\\.yaml");
    expect(configuration).not.toContain("\\.env\\.example");
    expect(configuration).toContain(
      "^AI_API_KEY=replace-with-server-side-secret$",
    );
  });
});
