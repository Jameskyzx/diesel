import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const fromRepository = createRequire(resolve("package.json"));
const fromShadcn = createRequire(fromRepository.resolve("shadcn"));
const fromDotenv = createRequire(fromShadcn.resolve("@dotenvx/dotenvx"));
const consumers = [
  ["MCP SDK", createRequire(fromShadcn.resolve("@modelcontextprotocol/sdk/server/index.js"))],
  ["dotenvx conf", createRequire(fromDotenv.resolve("conf"))],
] as const;

type UriComponents = { scheme: string; host: string; port?: string | number; path?: string };
type FastUri = {
  parse(input: string): { host?: string; error?: string };
  serialize(input: UriComponents): string;
};

describe.each(consumers)("installed fast-uri security boundary: %s", (_label, consumer) => {
  const fromAjv = createRequire(consumer.resolve("ajv"));
  const uri: FastUri = fromAjv("fast-uri");

  it("loads the reviewed patch through the actual dependency edge", () => {
    const manifest = z.object({ version: z.literal("3.1.7") });
    expect(() => manifest.parse(JSON.parse(
      readFileSync(fromAjv.resolve("fast-uri/package.json"), "utf8"),
    ))).not.toThrow();
  });

  it("rejects an unclosed authority bracket instead of accepting a misleading host", () => {
    expect(uri.parse("http://[fe80").error).toBe("URI host is malformed.");
  });

  it.each(["80@127.0.0.1", "8080/path", "8080?query"])(
    "rejects authority injection through port %s", (port) => {
      expect(() => uri.serialize({ scheme: "http", host: "example.com", port }))
        .toThrow(/URI port is malformed/u);
    },
  );

  it("preserves valid DNS and IPv6 authorities and numeric ports", () => {
    expect(uri.serialize({ scheme: "https", host: "example.com", port: 8443, path: "/docs" }))
      .toBe("https://example.com:8443/docs");
    expect(uri.parse("https://[2001:db8::1]:8443/docs")).toMatchObject({ host: "2001:db8::1" });
    expect(uri.parse("https://[2001:db8::1]:8443/docs").error).toBeUndefined();
  });
});
