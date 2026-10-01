import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";
import sharp from "sharp";

import {
  captureScreenshotArtifactsWithRollback,
  screenshotCandidatePath,
} from "./atomic-screenshot-publication";
import { recoverStaleScreenshotCaptureLock } from "./screenshot-capture-lock";
import {
  observeScreenshotDemoProcess,
  screenshotDemoInstanceNonceEnvironmentVariable,
  stopOwnedScreenshotDemoServer,
  waitForOwnedScreenshotDemoReadiness,
  type ObservedScreenshotDemoProcess,
} from "./screenshot-demo-session";
import { expectedScreenshotSourceFiles, fingerprintSourceFiles, screenshotManifestPath, screenshotManifestVersion, screenshotSpecifications, screenshotViewport, type ScreenshotManifest, verifyScreenshotManifest } from "./screenshot-manifest";
import { formatErrorTree } from "../format-error";

const workspace = process.cwd();
const baseURL = "http://127.0.0.1:3210";

async function captureCandidates(
  stagingRoot: string,
  demoProcess: ObservedScreenshotDemoProcess,
  instanceNonce: string,
): Promise<void> {
  await waitForOwnedScreenshotDemoReadiness(
    demoProcess,
    baseURL,
    instanceNonce,
  );
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: "en-US", viewport: screenshotViewport });
    await context.addCookies([{ name: "diesel_locale", url: baseURL, value: "en" }]);
    const page = await context.newPage();
    const assets: ScreenshotManifest["assets"] = [];
    for (const [index, specification] of screenshotSpecifications.entries()) {
      const sourceFilesBefore = await expectedScreenshotSourceFiles(workspace, index);
      const sourceFingerprintBefore = await fingerprintSourceFiles(workspace, sourceFilesBefore);
      await page.goto(`${baseURL}${specification.route}`, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      if (await page.locator("html").getAttribute("lang") !== "en") {
        throw new Error(`${specification.path} did not render the English locale.`);
      }
      if (index === 0) {
        await page.getByRole("heading", { level: 1, name: "Global diesel regulations and product database" }).waitFor({ state: "visible" });
        await page.getByText("China — demo fixture", { exact: true }).first().waitFor({ state: "visible" });
      }
      if (specification.path.endsWith("offline-evidence-chat.jpg")) {
        await page.getByRole("heading", { name: "AI sales analysis assistant" }).waitFor({ state: "visible" });
        await page.getByRole("button", { name: "Send question" }).click();
        await page.getByText("DEMO ONLY — Fictional Engine 200", { exact: true }).first().waitFor({ state: "visible" });
        await page
          .locator('[data-sales-chat-root] [role="status"][aria-busy="false"]')
          .filter({ hasText: "Answer complete." })
          .waitFor({ state: "attached" });
        const finalResponse = page
          .getByText("This request lacks enough evidence for an affirmative regulatory, market, or product conclusion.", {
            exact: false,
          })
          .first();
        await finalResponse.waitFor({ state: "visible" });
        await page.locator("#sales-chat-panel").evaluate((panel) => {
          const globalHeader = document.querySelector<HTMLElement>(
            '[data-testid="app-navigation-shell"]',
          );
          const headerBounds = globalHeader?.getBoundingClientRect();
          // Only the horizontal mobile bar occludes the top of the content.
          const topBarHeight = headerBounds && headerBounds.width >= window.innerWidth - 1
            ? headerBounds.height
            : 0;
          const panelTop =
            panel.getBoundingClientRect().top + window.scrollY;
          window.scrollTo(
            0,
            Math.max(
              0,
              panelTop - topBarHeight - 16,
            ),
          );
        });
        await page.evaluate(
          () =>
            new Promise<void>((resolveFrame) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
            }),
        );
        const finalResponseBounds = await finalResponse.boundingBox();
        if (
          !finalResponseBounds ||
          finalResponseBounds.y < 0 ||
          finalResponseBounds.y + finalResponseBounds.height >
            screenshotViewport.height
        ) {
          throw new Error(
            `${specification.path} does not frame the completed AI response.`,
          );
        }
      } else {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(() => window.scrollY === 0);
      }
      const clippedLabels = await page.locator("[data-screenshot-label]").evaluateAll((elements) => elements.filter((element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight).length);
      if (clippedLabels > 0) throw new Error(`${specification.path} contains clipped key labels.`);
      const candidatePath = screenshotCandidatePath(
        stagingRoot,
        specification.path,
      );
      await mkdir(dirname(candidatePath), { recursive: true });
      await page.screenshot({ path: candidatePath, quality: 90, type: "jpeg" });
      const bytes = await readFile(candidatePath);
      const metadata = await sharp(bytes).metadata();
      const sourceFiles = await expectedScreenshotSourceFiles(workspace, index);
      const sourceFingerprint = await fingerprintSourceFiles(workspace, sourceFiles);
      if (JSON.stringify(sourceFiles) !== JSON.stringify(sourceFilesBefore) || sourceFingerprint !== sourceFingerprintBefore) {
        throw new Error(`${specification.path} source state changed during capture.`);
      }
      assets.push({ capturedAt: new Date().toISOString(), height: metadata.height!, locale: "en", path: specification.path, route: specification.route, sha256: createHash("sha256").update(bytes).digest("hex"), sourceFiles, sourceFingerprint, viewport: screenshotViewport, width: metadata.width! });
    }
    const manifestText = `${JSON.stringify({ assets, version: screenshotManifestVersion }, null, 2)}\n`;
    const candidateManifestPath = screenshotCandidatePath(
      stagingRoot,
      screenshotManifestPath,
    );
    await mkdir(dirname(candidateManifestPath), { recursive: true });
    await writeFile(candidateManifestPath, manifestText, "utf8");
  } finally { await browser.close(); }
}

async function capture(): Promise<void> {
  const instanceNonce = randomUUID();
  const environment = {
    ...process.env,
    AI_API_KEY: "",
    AI_BASE_URL: "",
    AI_ENABLE_THINKING: "",
    AI_MODEL: "",
    DATABASE_URL: "",
    DEMO_HOST: "127.0.0.1",
    [screenshotDemoInstanceNonceEnvironmentVariable]: instanceNonce,
    DEMO_PORT: "3210",
  };
  await captureScreenshotArtifactsWithRollback({
    openCaptureSession: async () => {
      const server = spawn("pnpm", ["demo"], { cwd: workspace, env: environment, stdio: "inherit" });
      const demoProcess = observeScreenshotDemoProcess(server);
      return {
        captureCandidates: async (stagingRoot) =>
          captureCandidates(stagingRoot, demoProcess, instanceNonce),
        stop: async () =>
          stopOwnedScreenshotDemoServer(
            demoProcess,
            baseURL,
            instanceNonce,
          ),
      };
    },
    verifyCandidates: async (stagingRoot, manifestText) =>
      verifyScreenshotManifest(workspace, manifestText, {
        assetRoot: stagingRoot,
      }),
    verifyPublished: async (manifestText) =>
      verifyScreenshotManifest(workspace, manifestText),
    workspace,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--recover-stale-lock") {
    await recoverStaleScreenshotCaptureLock(workspace);
    process.stdout.write("Recovered the proven-stale screenshot capture lock.\n");
    return;
  }
  if (args.length !== 0) {
    throw new Error(
      "Usage: capture-screenshots.ts [--recover-stale-lock]",
    );
  }
  await capture();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error: unknown) => {
    process.stderr.write(formatErrorTree(error, "screenshot-capture"));
    process.exitCode = 1;
  });
}
