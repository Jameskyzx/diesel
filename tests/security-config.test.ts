import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig, {
  APPLICATION_SECURITY_HEADERS,
} from "../next.config";
import {
  WORLD_COUNTRIES_GEOJSON_SHA256,
  WORLD_COUNTRIES_GEOJSON_URL,
} from "@/lib/geo-assets";

describe("security and immutable asset configuration", () => {
  it("applies browser security headers at both the app and TLS proxy", async () => {
    expect(APPLICATION_SECURITY_HEADERS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "Content-Security-Policy-Report-Only" }),
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

  it("redirects geometry to a versioned immutable URL", async () => {
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
