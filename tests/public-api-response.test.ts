import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  applyPublicApiCachePolicy,
  createPublicApiRequestObserver,
  PUBLIC_API_CACHE_CONTROL,
} from "@/server/http/public-api-response";

function expectPublicNoStore(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe(
    PUBLIC_API_CACHE_CONTROL,
  );
  expect(response.headers.get("Pragma")).toBe("no-cache");
}

async function collectRouteFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return collectRouteFiles(path);
      }
      return entry.isFile() && entry.name === "route.ts" ? [path] : [];
    }),
  );
  return paths.flat().toSorted();
}

describe("public API response cache policy", () => {
  it("overrides a cacheable handler response after observation without consuming its SSE body", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: streamed\n\n"));
        controller.close();
      },
    });

    try {
      const observer = createPublicApiRequestObserver("/api/chat");
      const response = observer.finish(new Response(source, {
        headers: {
          "Cache-Control": "public, max-age=3600",
          "Content-Type": "text/event-stream",
          "Retry-After": "7",
        },
      }));

      expectPublicNoStore(response);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Retry-After")).toBe("7");
      expect(response.headers.get("X-Request-Id")).toBe(observer.requestId);
      await expect(response.text()).resolves.toBe("data: streamed\n\n");
      expect(consoleInfo).toHaveBeenCalledOnce();
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("applies the same fail-safe to unobserved public responses", () => {
    const response = applyPublicApiCachePolicy(Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "public, max-age=86400" } },
    ));

    expectPublicNoStore(response);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("keeps every public route attached to the shared cache boundary", async () => {
    const apiRoot = resolve(process.cwd(), "src/app/api");
    const publicRouteFiles = (await collectRouteFiles(apiRoot)).filter((path) => {
      const route = relative(apiRoot, path);
      return !route.startsWith("admin/") && !route.startsWith("dev/");
    });

    expect(publicRouteFiles.map((path) => relative(apiRoot, path))).toEqual([
      "chat/route.ts",
      "countries/[iso3]/route.ts",
      "countries/route.ts",
      "health/live/route.ts",
      "health/ready/route.ts",
      "health/route.ts",
      "preferences/locale/route.ts",
      "product-fit/route.ts",
      "products/route.ts",
    ]);

    for (const path of publicRouteFiles) {
      await expect(readFile(path, "utf8")).resolves.toMatch(
        /from ["']@\/server\/http\/public-api-response["']/u,
      );
    }
  });
});
