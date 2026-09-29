import { Buffer } from "node:buffer";

import { expect, test, type ElementHandle, type Page, type TestInfo } from "@playwright/test";

import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";

test.describe.configure({ timeout: 30_000 });

const workerPath = "/maplibre/6.9.0/maplibre-gl-worker.mjs";
const probeKey = "__dieselMapRuntimeProbe";
type FaultMode = "healthy" | "no-webgl" | "webgl1-only" | "map-canvas-only";
type RemoveMapObservation = {
  id: string;
  sourceMapId: number;
  origin: string;
  responseCount: number;
  response: null | {
    origin: string | null;
    errorIsNull: boolean;
    dataIsUndefined: boolean;
    nativeEvent: boolean;
  };
};
type WorkerObservation = {
  workerId: number;
  url: string;
  type: string;
  terminated: boolean;
  errors: string[];
  sourceMapIds: number[];
  removeMapRequests: RemoveMapObservation[];
};
type CanvasReadback = {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  bounds: { x: number; y: number; width: number; height: number };
  parent: null | {
    clientWidth: number;
    clientHeight: number;
    bounds: { x: number; y: number; width: number; height: number };
  };
  drawingBufferWidth: number | null;
  drawingBufferHeight: number | null;
  viewport: number[] | null;
};
type RuntimeProbe = {
  mode: FaultMode;
  documentTimeOrigin: number;
  independentProbe: { webgl: boolean; webgl2: boolean };
  contexts: Array<{ type: string; mapCanvas: boolean; blocked: boolean; available: boolean }>;
  workers: WorkerObservation[];
  canvasReadback: CanvasReadback | null;
};
type Snapshot = (stage: string, details?: Record<string, unknown>) => Promise<RuntimeProbe>;
type MapInstanceObservation = {
  canvas: ElementHandle<SVGElement | HTMLElement>;
  before: RuntimeProbe;
  mapId: number;
};

async function installRuntimeProbe(page: Page, mode: FaultMode) {
  await page.addInitScript(({ key, fault }) => {
    const probe: RuntimeProbe = {
      mode: fault,
      documentTimeOrigin: performance.timeOrigin,
      independentProbe: { webgl: false, webgl2: false },
      contexts: [],
      workers: [],
      canvasReadback: null,
    };
    Object.defineProperty(window, key, { configurable: true, value: probe });
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        const isGl = ["webgl", "experimental-webgl", "webgl2"].includes(type);
        const mapCanvas = this.classList.contains("maplibregl-canvas") ||
          this.closest('[data-testid="map-canvas-container"]') !== null;
        const blocked = isGl && (
          probe.mode === "no-webgl" ||
          (probe.mode === "webgl1-only" && type === "webgl2") ||
          (probe.mode === "map-canvas-only" && mapCanvas && type === "webgl2")
        );
        const context = blocked ? null : Reflect.apply(originalGetContext, this, [type, ...args]);
        if (isGl) probe.contexts.push({ type, mapCanvas, blocked, available: context !== null });
        return context;
      },
    });

    // These are real independent contexts, not fabricated support results.
    // Release the test-owned probes before the application constructs its map.
    for (const type of ["webgl", "webgl2"] as const) {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext(type) as WebGLRenderingContext | WebGL2RenderingContext | null;
      probe.independentProbe[type] = context !== null;
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    }

    const OriginalWorker = window.Worker;
    window.Worker = new Proxy(OriginalWorker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        const observation: WorkerObservation = {
          workerId: probe.workers.length + 1,
          url: new URL(String(args[0]), location.href).href,
          type: (args[1] as WorkerOptions | undefined)?.type ?? "classic",
          terminated: false,
          errors: [],
          sourceMapIds: [],
          removeMapRequests: [],
        };
        probe.workers.push(observation);
        worker.addEventListener("error", (event) => {
          // Preserve native propagation: no preventDefault or error filtering.
          observation.errors.push(event.message);
        });
        const postMessage = worker.postMessage;
        worker.postMessage = function (this: Worker, ...messageArgs: unknown[]) {
          // Forward the exact native call first; never manufacture a removal,
          // alter transfer lists, or count a postMessage that threw as sent.
          const result = Reflect.apply(postMessage, this, messageArgs);
          const message: unknown = messageArgs[0];
          if (typeof message !== "object" || message === null) return result;
          const data = message as Record<string, unknown>;
          // The pinned Map._getMapId() is numeric; the shared dispatcher uses
          // the distinct string 'global-dispatcher' and is not a map instance.
          if (typeof data.sourceMapId === "number" && Number.isSafeInteger(data.sourceMapId)) {
            if (!observation.sourceMapIds.includes(data.sourceMapId)) observation.sourceMapIds.push(data.sourceMapId);
            if (data.type === "RM") {
              if (typeof data.id !== "string" || typeof data.origin !== "string") {
                observation.errors.push("Malformed native map removal request");
              } else {
                if (observation.removeMapRequests.some(({ id }) => id === data.id)) {
                  observation.errors.push("Duplicate native map removal request identity");
                }
                observation.removeMapRequests.push({
                  id: data.id, sourceMapId: data.sourceMapId, origin: data.origin,
                  responseCount: 0, response: null,
                });
              }
            }
          }
          return result;
        };
        worker.addEventListener("message", (event: MessageEvent<unknown>) => {
          if (typeof event.data !== "object" || event.data === null) return;
          const data = event.data as Record<string, unknown>;
          if (data.type !== "<response>" || typeof data.id !== "string") return;
          for (const removal of observation.removeMapRequests.filter(({ id }) => id === data.id)) {
            removal.responseCount++;
            removal.response = {
              origin: typeof data.origin === "string" ? data.origin : null,
              errorIsNull: data.error === null,
              dataIsUndefined: data.data === undefined,
              nativeEvent: event.isTrusted,
            };
          }
        });
        const terminate = worker.terminate;
        worker.terminate = function () {
          observation.terminated = true;
          return Reflect.apply(terminate, this, []);
        };
        return worker;
      },
    });
  }, { key: probeKey, fault: mode });
}

async function readProbe(page: Page): Promise<RuntimeProbe> {
  return page.evaluate((key) => {
    const probe = (window as unknown as Record<string, RuntimeProbe>)[key];
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="world-map"] canvas.maplibregl-canvas');
    const rect = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const context = canvas?.getContext("webgl2");
    return {
      ...probe,
      canvasReadback: canvas ? {
        width: canvas.width, height: canvas.height,
        clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight,
        bounds: rect(canvas),
        parent: canvas.parentElement ? {
          clientWidth: canvas.parentElement.clientWidth, clientHeight: canvas.parentElement.clientHeight,
          bounds: rect(canvas.parentElement),
        } : null,
        drawingBufferWidth: context?.drawingBufferWidth ?? null,
        drawingBufferHeight: context?.drawingBufferHeight ?? null,
        viewport: context ? Array.from(context.getParameter(context.VIEWPORT) as Int32Array) : null,
      } : null,
    };
  }, probeKey);
}

function mapWorkers(probe: RuntimeProbe) {
  return probe.workers.filter(({ url }) => new URL(url).pathname === workerPath);
}

function workerIdentities(probe: RuntimeProbe) {
  return mapWorkers(probe).map(({ workerId, url, type, terminated }) => ({ workerId, url, type, terminated }));
}

function activeMapIds(worker: WorkerObservation) {
  return worker.sourceMapIds.filter((mapId) => !worker.removeMapRequests.some(({ sourceMapId }) => sourceMapId === mapId));
}

async function captureMapInstance(page: Page, locale: "en" | "zh-CN"): Promise<MapInstanceObservation> {
  const before = await expectReadyMap(page, locale);
  const workers = mapWorkers(before);
  const mapIds = [...new Set(workers.flatMap(activeMapIds))];
  expect(mapIds).toHaveLength(1);
  for (const worker of workers) expect(activeMapIds(worker)).toEqual(mapIds);
  const canvas = await page.getByTestId("world-map").locator("canvas.maplibregl-canvas").elementHandle();
  if (!canvas) throw new Error("The ready map must retain its actual canvas until removal is observed.");
  return { canvas, before, mapId: mapIds[0] };
}

async function expectReleasedMap(page: Page, instance: MapInstanceObservation) {
  // MapLibre 6.9's RTL singleton keeps the global dispatcher/pool alive.
  // Verify the removed map's actual worker acknowledgement instead of asking
  // the test to terminate shared workers or invoke an internal global teardown.
  const { before, canvas, mapId } = instance;
  const origin = new URL(page.url()).origin;
  await expect.poll(async () => {
    const probe = await readProbe(page);
    return {
      documentTimeOrigin: probe.documentTimeOrigin,
      workers: mapWorkers(probe).map((worker) => ({
        workerId: worker.workerId,
        activeMapIds: activeMapIds(worker),
        removals: worker.removeMapRequests.filter(({ sourceMapId }) => sourceMapId === mapId).map((removal) => ({
          validRequestId: removal.id.length > 0,
          requestOrigin: removal.origin,
          responseCount: removal.responseCount,
          response: removal.response,
        })),
      })),
    };
  }).toEqual({
    documentTimeOrigin: before.documentTimeOrigin,
    workers: mapWorkers(before).map(({ workerId }) => ({
      workerId, activeMapIds: [],
      removals: [{
        validRequestId: true, requestOrigin: origin, responseCount: 1,
        response: { origin, errorIsNull: true, dataIsUndefined: true, nativeEvent: true },
      }],
    })),
  });
  expect(workerIdentities(await readProbe(page))).toEqual(workerIdentities(before));
  const readOldCanvas = () => canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext("webgl2");
    return { connected: element.isConnected, contextAvailable: context !== null, contextLost: context?.isContextLost() ?? false };
  });
  await expect.poll(readOldCanvas).toEqual({ connected: false, contextAvailable: true, contextLost: true });
  return readOldCanvas();
}

function copy(locale: "en" | "zh-CN") {
  return locale === "en" ? {
    close: "Close country details", select: "Select country", retry: "Retry map",
    zoomIn: "Zoom in", zoomOut: "Zoom out",
  } : {
    close: "关闭国家详情", select: "选择国家", retry: "重试加载地图",
    zoomIn: "放大地图", zoomOut: "缩小地图",
  };
}

async function expectReadyMap(page: Page, locale: "en" | "zh-CN") {
  const map = page.getByTestId("world-map");
  const labels = copy(locale);
  await expect(page.getByTestId("map-canvas-container")).toHaveAttribute("data-map-ready", "true");
  await expect(map.locator("canvas.maplibregl-canvas")).toHaveCount(1);
  await expect(map.getByRole("button", { name: labels.zoomIn, exact: true })).toHaveCount(1);
  await expect(map.getByRole("button", { name: labels.zoomOut, exact: true })).toHaveCount(1);
  await expect(map.getByRole("button", { name: labels.zoomIn, exact: true })).toBeVisible();
  await expect(map.getByRole("button", { name: labels.zoomOut, exact: true })).toBeVisible();
  await expect(map.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("#error-title")).toHaveCount(0);
  await expect(page.locator("#country-select")).toBeVisible();
  await expect(page.locator("#country-select")).toHaveAccessibleName(labels.select);

  const graphics = await map.locator("canvas.maplibregl-canvas").evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext("webgl2");
    return {
      webgl2: context !== null && context instanceof WebGL2RenderingContext,
      version: context?.getParameter(context.VERSION) as string | undefined,
    };
  });
  expect(graphics).toMatchObject({ webgl2: true, version: expect.stringContaining("WebGL 2.0") });
  const probe = await readProbe(page);
  const workers = mapWorkers(probe);
  expect(workers.length).toBeGreaterThan(0);
  expect(workers.every(({ url, type }) => type === "module" && new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(probe.workers.flatMap(({ errors }) => errors)).toEqual([]);
  expect(workers.filter(({ terminated }) => !terminated).length).toBeGreaterThan(0);
  return probe;
}

async function expectLocalFailure(page: Page, locale: "en" | "zh-CN") {
  const map = page.getByTestId("world-map");
  await expect(map.getByRole("alert")).toBeVisible();
  await expect(map.getByRole("button", { name: copy(locale).retry, exact: true })).toBeVisible();
  await expect(page.locator("#error-title")).toHaveCount(0);
  await expect(page.getByTestId("map-canvas-container")).toHaveAttribute("data-map-ready", "false");
  await expect(page.locator("#country-select")).toBeVisible();
  await expect(page.locator("#country-select")).toBeEnabled();
  await expect(page.locator("#country-select")).toHaveAccessibleName(copy(locale).select);
  await expect(map.locator("canvas.maplibregl-canvas")).toHaveCount(0);
  await expect(map.locator(".maplibregl-ctrl-zoom-in, .maplibregl-ctrl-zoom-out")).toHaveCount(0);
}

async function expectUnmountAndRemount(page: Page, locale: "en" | "zh-CN", snapshot: Snapshot) {
  const baseline = await expectReadyMap(page, locale);
  for (let cycle = 1; cycle <= 2; cycle++) {
    const instance = await captureMapInstance(page, locale);
    expect(workerIdentities(instance.before)).toEqual(workerIdentities(baseline));
    try {
      await page.locator('header nav a[href="/chat"]').click();
      await expect(page).toHaveURL((url) => url.pathname === "/chat");
      await expect(page.getByTestId("world-map")).toHaveCount(0);
      const oldCanvas = await expectReleasedMap(page, instance);
      await snapshot(`cycle-${cycle}-map-removal-acknowledged`, { mapId: instance.mapId, oldCanvas });
    } finally {
      // Keep the detached native canvas only for the bounded lifecycle check.
      await instance.canvas.dispose();
    }
    await page.locator('header nav a[href="/map"]').click();
    await expect(page).toHaveURL((url) => url.pathname === "/map");
    const after = await expectReadyMap(page, locale);
    expect(after.documentTimeOrigin).toBe(baseline.documentTimeOrigin);
    expect(workerIdentities(after)).toEqual(workerIdentities(baseline));
    const currentMapIds = [...new Set(mapWorkers(after).flatMap(activeMapIds))];
    expect(currentMapIds).toHaveLength(1);
    expect(currentMapIds).not.toContain(instance.mapId);
    await snapshot(`cycle-${cycle}-fresh-map-shared-workers-reused`);
  }
}

async function observeRuntime(
  page: Page,
  testInfo: TestInfo,
  locale: "en" | "zh-CN",
  mode: FaultMode,
  action: (snapshot: Snapshot) => Promise<void>,
) {
  await page.context().clearCookies();
  if (locale === "zh-CN") await page.context().addCookies([{
    name: "diesel_locale", value: locale,
    url: testInfo.project.use.baseURL ?? "http://127.0.0.1:3100",
  }]);
  await installRuntimeProbe(page, mode);
  const snapshots: Array<{ stage: string; probe: RuntimeProbe; details?: Record<string, unknown> }> = [];
  const snapshot: Snapshot = async (stage, details) => {
    const probe = await readProbe(page);
    snapshots.push({ stage, probe, details });
    return probe;
  };
  try {
    await checkBrowserRuntimeErrors(page, testInfo, async () => {
      await page.goto("/map");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await action(snapshot);
    });
  } finally {
    await testInfo.attach("map-runtime-observations", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({
        version: "maplibre-webgl2-runtime-v3", locale, mode,
        project: testInfo.project.name, retry: testInfo.retry,
        nativeWorkerAndContextCallsForwarded: true,
        cleanupScope: "Native map-specific RM requests and successful same-worker replies, detached lost WebGL contexts, and stable shared Worker identities across two same-document remounts; not hidden-closure GC proof",
        snapshots,
      }, null, 2)),
    });
  }
}

for (const locale of ["en", "zh-CN"] as const) {
  test(`renders real WebGL2 with a same-origin module worker and remounts cleanly (${locale})`, async ({ page }, testInfo) => {
    await observeRuntime(page, testInfo, locale, "healthy", async (snapshot) => {
      await expectReadyMap(page, locale);
      expect((await snapshot("ready")).independentProbe.webgl2).toBe(true);
      if ((testInfo.project.name === "desktop-chromium" && locale === "en") ||
        (testInfo.project.name === "mobile-chromium" && locale === "zh-CN")) {
        await snapshot("before-initial-full-page-screenshot");
        await testInfo.attach("maplibre-v6-ready", {
          contentType: "image/png", body: await page.screenshot({ fullPage: true }),
        });
        await snapshot("after-initial-full-page-screenshot");
        await snapshot("before-initial-map-only-screenshot");
        await testInfo.attach("maplibre-v6-ready-map-only", {
          contentType: "image/png", body: await page.getByTestId("world-map").screenshot(),
        });
        await snapshot("after-initial-map-only-screenshot");
      }
      if (testInfo.project.name !== "core-webkit") {
        const canvas = page.getByTestId("map-canvas-container").locator("canvas.maplibregl-canvas");
        const bounds = await canvas.boundingBox();
        expect(bounds).not.toBeNull();
        if (!bounds) throw new Error("The ready canvas must have actual CSS bounds for geographic selection.");
        const mercatorY = (latitude: number) =>
          (1 - Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) / Math.PI) / 2;
        const configuredWorldSize = 512 * 2 ** 1.15;
        // MapLibre 6.9 MercatorTransform.defaultConstrain fits a single world
        // when renderWorldCopies is false. A canvas wider than the configured
        // world raises zoom and centers longitude at 0; mobile retains 8.
        // Use the same real DEU coordinate in both viewports, not the old FRA
        // screen-point expectation derived from an unconstrained camera.
        const worldSize = Math.max(configuredWorldSize, bounds.width);
        const centerLng = bounds.width >= configuredWorldSize ? 0 : 8;
        expect(bounds.height).toBeLessThan(worldSize);
        const centerY = mercatorY(18) * worldSize;
        expect(centerY - bounds.height / 2).toBeGreaterThanOrEqual(0);
        expect(centerY + bounds.height / 2).toBeLessThanOrEqual(worldSize);
        const position = {
          x: bounds.width / 2 + (10 - centerLng) / 360 * worldSize,
          y: bounds.height / 2 + (mercatorY(51) - mercatorY(18)) * worldSize,
        };
        await snapshot("before-geographic-deu-selection", {
          longitude: 10, latitude: 51, configuredWorldSize,
          effectiveWorldSize: worldSize, effectiveCenterLng: centerLng,
          canvasBounds: bounds, position,
        });
        if (testInfo.project.name === "mobile-chromium") await canvas.tap({ position });
        else await canvas.click({ position });
        await expect(page).toHaveURL((url) => url.pathname === "/countries/DEU");
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page.getByRole("dialog").getByRole("heading", {
          name: locale === "en" ? "Germany — demo fixture" : "德国（演示数据）", exact: true,
        })).toBeVisible();
        await page.getByRole("button", { name: copy(locale).close, exact: true }).click();
        await expect(page).toHaveURL((url) => url.pathname === "/map");
        if (testInfo.project.name === "desktop-chromium" && locale === "en") {
          await expectReadyMap(page, locale);
          await snapshot("after-polygon-round-trip-before-screenshot");
          await testInfo.attach("maplibre-v6-after-polygon-round-trip", {
            contentType: "image/png", body: await page.screenshot({ fullPage: true }),
          });
          await snapshot("after-polygon-round-trip-after-screenshot");
        }
      }
      await expectUnmountAndRemount(page, locale, snapshot);
      await snapshot("remounted-without-accumulation");
    });
  });

  for (const mode of ["no-webgl", "webgl1-only", "map-canvas-only"] as const) {
    test(`keeps country navigation usable and really recovers after ${mode} (${locale})`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === "core-webkit", "Chromium desktop/mobile cover the injected fault matrix; WebKit runs real normal rendering.");
      await observeRuntime(page, testInfo, locale, mode, async (snapshot) => {
        await expectLocalFailure(page, locale);
        const failed = await snapshot("local-failure");
        if (mode === "map-canvas-only" && locale === "en" && testInfo.project.name === "desktop-chromium") {
          await testInfo.attach("maplibre-v6-local-gpu-error", {
            contentType: "image/png", body: await page.screenshot({ fullPage: true }),
          });
        }
        if (mode === "no-webgl") expect(failed.independentProbe).toEqual({ webgl: false, webgl2: false });
        if (mode === "webgl1-only") expect(failed.independentProbe).toEqual({ webgl: true, webgl2: false });
        if (mode === "map-canvas-only") {
          expect(failed.independentProbe.webgl2).toBe(true);
          expect(failed.contexts.some(({ type, mapCanvas, blocked }) => type === "webgl2" && mapCanvas && blocked)).toBe(true);
        }
        const retry = page.getByTestId("world-map").getByRole("button", { name: copy(locale).retry, exact: true });
        const deniedBeforeRetry = failed.contexts.filter(({ blocked }) => blocked).length;
        await retry.click();
        await expect.poll(async () => (await readProbe(page)).contexts.filter(({ blocked }) => blocked).length).toBeGreaterThan(deniedBeforeRetry);
        await expectLocalFailure(page, locale);

        // The fallback must preserve an actual country workflow, not merely
        // leave a disabled select visible beside a failed renderer.
        await page.locator("#country-select").selectOption("CHN");
        await expect(page).toHaveURL((url) => url.pathname === "/countries/CHN");
        await expect(page.getByTestId("country-detail")).toBeVisible();
        await page.getByRole("button", { name: copy(locale).close, exact: true }).click();
        await expect(page).toHaveURL((url) => url.pathname === "/map");
        await expectLocalFailure(page, locale);
        await snapshot("failed-retry-and-country-round-trip");

        await page.evaluate((key) => {
          (window as unknown as Record<string, RuntimeProbe>)[key].mode = "healthy";
        }, probeKey);
        await retry.click();
        await expectReadyMap(page, locale);
        await snapshot("real-retry-recovered");
        await expectUnmountAndRemount(page, locale, snapshot);
        await snapshot("recovered-remount-without-accumulation");
      });
    });
  }
}

test("recovers with a fresh real map after native WebGL context loss", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "The actual context-loss lifecycle is checked once on desktop Chromium in English.");
  await observeRuntime(page, testInfo, "en", "healthy", async (snapshot) => {
    const instance = await captureMapInstance(page, "en");
    await snapshot("ready-before-native-context-loss");
    try {
      const loss = await instance.canvas.evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext("webgl2");
        const extension = context?.getExtension("WEBGL_lose_context");
        if (!context || !extension) throw new Error("The real map must expose WEBGL_lose_context for this regression.");
        return new Promise<{ trusted: boolean; contextLost: boolean }>((resolve) => {
          canvas.addEventListener("webglcontextlost", (event) => {
            // Observe the native event without preventing or synthesizing it.
            resolve({ trusted: event.isTrusted, contextLost: context.isContextLost() });
          }, { once: true });
          extension.loseContext();
        });
      });
      expect(loss).toEqual({ trusted: true, contextLost: true });
      await expectLocalFailure(page, "en");
      const oldCanvas = await expectReleasedMap(page, instance);
      await snapshot("native-context-loss-map-removal-acknowledged", { mapId: instance.mapId, loss, oldCanvas });
    } finally {
      await instance.canvas.dispose();
    }
    await page.getByTestId("world-map").getByRole("button", { name: copy("en").retry, exact: true }).click();
    const recovered = await expectReadyMap(page, "en");
    expect(recovered.documentTimeOrigin).toBe(instance.before.documentTimeOrigin);
    expect(workerIdentities(recovered)).toEqual(workerIdentities(instance.before));
    const currentMapIds = [...new Set(mapWorkers(recovered).flatMap(activeMapIds))];
    expect(currentMapIds).toHaveLength(1);
    expect(currentMapIds).not.toContain(instance.mapId);
    await snapshot("native-context-loss-real-retry-recovered");
  });
});
