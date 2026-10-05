import { Buffer } from "node:buffer";

import { expect, test, type ConsoleMessage, type Response } from "@playwright/test";
import { z } from "zod";

import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";
import { MAPLIBRE_VERSION, MAPLIBRE_WORKER_URL } from "../src/lib/maplibre-assets";

type SecurityPolicyViolation = {
  blockedUri: string;
  columnNumber: number;
  effectiveDirective: string;
  lineNumber: number;
  sourceFile: string;
};

const securityPolicyViolationMarker = "__DIESEL_CSP_VIOLATION__";
const workerMarker = "__DIESEL_MODULE_WORKER__";
const workerPath = MAPLIBRE_WORKER_URL;
const sharedPath = `/maplibre/${MAPLIBRE_VERSION}/maplibre-gl-shared.mjs`;
const workerObservationSchema = z.object({
  event: z.enum(["created", "error"]),
  message: z.string().optional(),
  type: z.string(),
  url: z.string().url(),
}).strict();

test("keeps enforced security headers on pre-render country redirects", async ({
  request,
}, testInfo) => {
  for (const method of ["get", "head"] as const) {
    const response = await request[method](
      "/countries/chn?powerKw=300.0&applicationScope=non-road&asOf=2026-01-20&utm_term=engine&utm_term=export",
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(307);
    const headers = response.headers();
    const source = new URL(response.url());
    expect(new URL(headers.location, source).href).toBe(new URL(
      "/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=300&utm_term=engine&utm_term=export",
      source,
    ).href);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
    const policy = headers["content-security-policy"];
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("object-src 'none'");
    if (testInfo.project.name === "production-csp-chromium") {
      expect(policy).not.toContain("'unsafe-eval'");
      expect(policy).toContain("connect-src 'self';");
    } else {
      expect(policy).toContain("'unsafe-eval'");
    }
  }
});

test("enforces CSP while MapLibre workers and attachment previews remain usable", async ({
  page,
}, testInfo) => {
  test.skip(
    !["desktop-chromium", "production-csp-chromium"].includes(
      testInfo.project.name,
    ),
    "One development and one production Chromium project cover the enforced browser policy contract.",
  );

  const securityPolicyViolations: SecurityPolicyViolation[] = [];
  const workerObservations: Array<z.infer<typeof workerObservationSchema>> = [];
  const workerResponses: Array<{ url: string; status: number; contentType: string }> = [];
  const onConsole = (message: ConsoleMessage) => {
    const text = message.text();
    if (text.startsWith(workerMarker)) {
      workerObservations.push(workerObservationSchema.parse(JSON.parse(text.slice(workerMarker.length))));
      return;
    }
    if (!text.startsWith(securityPolicyViolationMarker)) {
      return;
    }
    securityPolicyViolations.push(
      JSON.parse(
        text.slice(securityPolicyViolationMarker.length),
      ) as SecurityPolicyViolation,
    );
  };
  const onResponse = (response: Response) => {
    if ([workerPath, sharedPath].includes(new URL(response.url()).pathname)) {
      workerResponses.push({
        url: response.url(), status: response.status(),
        contentType: response.headers()["content-type"] ?? "",
      });
    }
  };
  page.on("console", onConsole);
  page.context().on("response", onResponse);
  await page.addInitScript(({ marker, workerEventMarker }) => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(
        `${marker}${JSON.stringify({
          blockedUri: event.blockedURI,
          columnNumber: event.columnNumber,
          effectiveDirective: event.effectiveDirective,
          lineNumber: event.lineNumber,
          sourceFile: event.sourceFile,
        })}`,
      );
    });
    const OriginalWorker = window.Worker;
    window.Worker = new Proxy(OriginalWorker, {
      construct(target, args, newTarget) {
        // This is observation only: construct and return the real native
        // worker with its original arguments, options and newTarget.
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        const observed = {
          type: (args[1] as WorkerOptions | undefined)?.type ?? "classic",
          url: new URL(String(args[0]), location.href).href,
        };
        console.info(`${workerEventMarker}${JSON.stringify({ event: "created", ...observed })}`);
        worker.addEventListener("error", (event) => {
          console.error(`${workerEventMarker}${JSON.stringify({ event: "error", message: event.message, ...observed })}`);
          // Do not preventDefault: native page/worker errors remain failures.
        });
        return worker;
      },
    });
  }, { marker: securityPolicyViolationMarker, workerEventMarker: workerMarker });

  await page.route("**/api/countries", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ countries: [], status: "ok" }),
      contentType: "application/json",
      status: 200,
    });
  });

  try {
    await checkBrowserRuntimeErrors(page, testInfo, async () => {
      const mapResponse = await page.goto("/map");
      const enforcedPolicy = mapResponse?.headers()["content-security-policy"];

      expect(enforcedPolicy?.split(";").map((directive) => directive.trim()).find((directive) => directive.startsWith("worker-src "))).toBe("worker-src 'self'");
      if (testInfo.project.name === "production-csp-chromium") {
        expect(enforcedPolicy).not.toContain("'unsafe-eval'");
        expect(enforcedPolicy).toContain("connect-src 'self';");
        expect(enforcedPolicy).not.toMatch(
          /connect-src[^;]*(?:https:|wss?:)/u,
        );
      } else {
        expect(enforcedPolicy).toContain("'unsafe-eval'");
        expect(enforcedPolicy).toContain("connect-src 'self' ws: wss:");
      }
      expect(
        mapResponse?.headers()["content-security-policy-report-only"],
      ).toBeUndefined();
      await expect(page.getByTestId("map-canvas-container")).toHaveAttribute(
        "data-map-ready",
        "true",
      );
      const canvas = page.getByTestId("map-canvas-container").locator("canvas.maplibregl-canvas");
      await expect(canvas).toHaveCount(1);
      expect(await canvas.evaluate((element) => {
        const context = (element as HTMLCanvasElement).getContext("webgl2");
        return context !== null && context instanceof WebGL2RenderingContext;
      })).toBe(true);
      const origin = new URL(page.url()).origin;
      const createdMapWorkers = workerObservations.filter(({ event, url }) => event === "created" && new URL(url).pathname === workerPath);
      expect(createdMapWorkers.length).toBeGreaterThan(0);
      expect(createdMapWorkers.every(({ type, url }) => type === "module" && new URL(url).origin === origin)).toBe(true);
      await expect.poll(() => [workerPath, sharedPath].every((path) => workerResponses.some(({ url }) => new URL(url).pathname === path))).toBe(true);
      expect(workerResponses.every(({ url, status, contentType }) => new URL(url).origin === origin && status === 200 && /(?:text|application)\/(?:javascript|ecmascript)/i.test(contentType))).toBe(true);
      expect(workerObservations.filter(({ event }) => event === "error")).toEqual([]);
      await expect.poll(() => securityPolicyViolations).toEqual([]);

      await page.goto("/chat");
      const assistant = page.getByRole("complementary", {
        name: "AI sales analysis assistant",
      });
      await assistant.getByLabel("Choose file or image").setInputFiles({
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=",
          "base64",
        ),
        mimeType: "image/png",
        name: "csp-preview.png",
      });

      await expect(
        assistant.getByRole("img", { name: "csp-preview.png preview" }),
      ).toBeVisible();
      await expect.poll(() => securityPolicyViolations).toEqual([]);

      if (testInfo.project.name === "production-csp-chromium") {
        const blockedUrl = "https://csp-probe.example.invalid/blocked";
        const fetchOutcome = await page.evaluate(async (url) => {
          try {
            await fetch(url);
            return "unexpectedly-connected";
          } catch {
            return "blocked";
          }
        }, blockedUrl);

        expect(fetchOutcome).toBe("blocked");
        await expect
          .poll(() =>
            securityPolicyViolations.some(
              (violation) =>
                violation.effectiveDirective === "connect-src" &&
                violation.blockedUri.startsWith(blockedUrl),
            ),
          )
          .toBe(true);
        expect(
          securityPolicyViolations.filter(
            (violation) =>
              violation.effectiveDirective !== "connect-src" ||
              !violation.blockedUri.startsWith(blockedUrl),
          ),
        ).toEqual([]);
      }
      expect(workerObservations.filter(({ event }) => event === "error")).toEqual([]);
    });
  } finally {
    page.off("console", onConsole);
    page.context().off("response", onResponse);
    await testInfo.attach("maplibre-module-worker-observations", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({
        version: "maplibre-module-worker-csp-v1", project: testInfo.project.name,
        nativeWorkerConstructed: true, workerObservations, workerResponses,
        securityPolicyViolations,
      }, null, 2)),
    });
  }
});
