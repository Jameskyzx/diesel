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
    // Diesel owns one TLS server; the independently managed blog is not part
    // of this release's template or redirect policy.
    expect(nginx.match(/Strict-Transport-Security/g)).toHaveLength(1);
    for (const server of nginx.split("server {").filter((block) => block.includes("listen 443 ssl;"))) {
      expect(server.match(/Strict-Transport-Security/g)).toHaveLength(1);
    }
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

  it("limits lock-fixture exceptions to exact public test lines", async () => {
    const configuration = await readFile(
      resolve(process.cwd(), ".gitleaks.toml"),
      "utf8",
    );
    const patterns = [...configuration.matchAll(/'''([^\n]+)'''/g)]
      .map((match) => new RegExp(match[1]));
    const allowed = (line: string) => patterns.some((pattern) => pattern.test(line));
    const fixture = "123e4567-e89b-42d3-a456-426614174000";
    expect(allowed(`    token: "${fixture}",`)).toBe(true);
    expect(allowed(`const OWNER_TOKEN = "${fixture}";`)).toBe(true);
    expect(allowed(`      receipt.token = "${fixture}";`)).toBe(true);
    expect(allowed(`        '  "token": "${fixture}",\\n' +`)).toBe(true);
    for (const suffix of ["1", "2"]) {
      expect(allowed(`const token = "${fixture.slice(0, -1)}${suffix}";`)).toBe(true);
    }
    expect(allowed(`const token = "${fixture.slice(0, -1)}9";`)).toBe(false);
    expect(allowed(`AI_API_KEY="${fixture}"`)).toBe(false);
    expect(allowed(`const token = "${fixture}"; const key = "another-value";`)).toBe(false);
    expect(allowed(`const token = "unrelated-private-value";`)).toBe(false);
  });
});
