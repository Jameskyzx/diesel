import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import demoConfig from "../playwright.demo.config";
import e2eConfig from "../playwright.config";
import fdeConfig from "../playwright.fde.config";
import productionConfig from "../playwright.production.config";

function firstWebServer(
  configuration:
    | typeof e2eConfig
    | typeof demoConfig
    | typeof fdeConfig
    | typeof productionConfig,
) {
  const value = configuration.webServer;
  return Array.isArray(value) ? value[0] : value;
}

describe("Playwright server contracts", () => {
  it.each([
    ["", "a".repeat(40)],
    ["false", "a".repeat(40)],
    ["true", ""],
    ["true", "master"],
    ["true", "A".repeat(40)],
  ])("refuses paid live browser execution without explicit opt-in and an exact release (%s, %s)", (optIn, release) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "playwright.live.config.ts"], {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, DIESEL_LIVE_ACCEPTANCE: optIn, DIESEL_LIVE_RELEASE: release },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
  });

  it("bounds paid live acceptance to the production origin without retries or a local server", () => {
    const result = spawnSync(process.execPath, [
      "--import", "tsx", "--input-type=module", "--eval",
      "const imported = (await import(process.argv[1])).default; process.stdout.write(JSON.stringify(imported.default ?? imported));",
      pathToFileURL(resolve("playwright.live.config.ts")).href,
    ], {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, DIESEL_LIVE_ACCEPTANCE: "true", DIESEL_LIVE_RELEASE: "a".repeat(40) },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const config: unknown = JSON.parse(result.stdout);
    expect(config).toMatchObject({
      testDir: "./e2e-live", forbidOnly: true, fullyParallel: false, workers: 1,
      retries: 0, maxFailures: 1, timeout: 120_000, globalTimeout: 900_000,
      use: { baseURL: "https://diesel.jamesky.site", serviceWorkers: "block" },
    });
    expect(config).not.toHaveProperty("webServer");
  });

  it("leaves CI time for honest interruption receipts and prints case progress", async () => {
    const result = spawnSync(process.execPath, [
      "--import", "tsx", "--input-type=module", "--eval",
      "const imported = (await import(process.argv[1])).default; const config = imported.default ?? imported; process.stdout.write(JSON.stringify({ globalTimeout: config.globalTimeout, timeout: config.timeout, retries: config.retries, reporter: config.reporter }));",
      pathToFileURL(resolve("playwright.config.ts")).href,
    ], { env: { ...process.env, CI: "true" }, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout) as unknown).toMatchObject({
      globalTimeout: 50 * 60_000,
      timeout: 60_000,
      retries: 2,
      reporter: expect.arrayContaining([["github"], ["list"]]),
    });
    const workflow = await readFile(resolve(".github/workflows/ci.yml"), "utf8");
    const publicJob = workflow.split("\n  e2e:\n")[1]?.split("\n  portfolio-demo-e2e:\n")[0];
    expect(publicJob).toContain("    timeout-minutes: 60\n");
  });

  it("ignores generated HTML reports without ignoring authored test inputs", () => {
    const result = spawnSync("/usr/bin/git", [
      "-c", "core.excludesFile=/dev/null", "check-ignore", "--no-index", "-v", "--",
      "playwright-demo-report/index.html", "playwright-report/index.html",
      "e2e/demo.spec.ts", "scripts/portfolio/playwright-run-reporter.ts",
    ], {
      cwd: process.cwd(),
      env: { NODE_ENV: "test", PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
      encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n").map((line) => line.split("\t")[1]))
      .toEqual(["playwright-demo-report/index.html", "playwright-report/index.html"]);
    expect(result.stdout).toMatch(/\.gitignore:\d+:\/playwright-demo-report\t/u);
  });

  it("forbids test.only in every evidence config even when capture removes CI", () => {
    const configUrls = [
      "playwright.config.ts",
      "playwright.demo.config.ts",
      "playwright.fde.config.ts",
      "playwright.production.config.ts",
    ].map((path) => pathToFileURL(resolve(process.cwd(), path)).href);
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        [
          "const urls = JSON.parse(process.argv[1]);",
          "const values = [];",
          "for (const url of urls) {",
          "  const imported = (await import(url)).default;",
          "  const config = imported?.default ?? imported;",
          "  values.push(config.forbidOnly);",
          "}",
          "process.stdout.write(JSON.stringify(values));",
        ].join("\n"),
        JSON.stringify(configUrls),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "",
          DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "1",
        },
      },
    );

    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stderr).toBe("");
    expect(JSON.parse(child.stdout) as unknown).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("forces the in-memory limiter with the PGlite E2E database", () => {
    expect(firstWebServer(e2eConfig)?.env).toMatchObject({
      AI_CHAT_RATE_LIMIT_BACKEND: "memory",
      DATABASE_MODE: "pglite-demo",
    });
    expect(e2eConfig.workers).toBe(1);
  });

  it("runs the formal demo entry for desktop and mobile without a conditional skip", () => {
    expect(firstWebServer(demoConfig)?.command).toBe("pnpm demo");
    expect(firstWebServer(demoConfig)?.env).toMatchObject({
      AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR: "10000",
      AI_CHAT_RATE_LIMIT_PER_HOUR: "10000",
    });
    expect(demoConfig.projects?.map(({ name }) => name)).toEqual([
      "portfolio-demo-chromium",
      "portfolio-demo-mobile-chromium",
    ]);
  });

  it("uses explicit graceful teardown handshakes for every development server", () => {
    expect(e2eConfig.globalTeardown).toBe(
      "./scripts/e2e/global-teardown.ts",
    );
    expect(demoConfig.globalTeardown).toBe(
      "./scripts/e2e/demo-global-teardown.ts",
    );
    expect(fdeConfig.globalTeardown).toBe(
      "./scripts/e2e/fde-global-teardown.ts",
    );
  });

  it("runs the CSP regression against an explicit production server", () => {
    expect(firstWebServer(productionConfig)).toMatchObject({
      command: "pnpm start --hostname 127.0.0.1 --port 3400",
      env: {
        AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY: "500",
        AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY: "50000",
        AI_CHAT_RATE_LIMIT_BACKEND: "postgres",
        AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR: "300",
        AI_CHAT_RATE_LIMIT_PER_HOUR: "30",
        DATABASE_MODE: "postgres",
        NODE_ENV: "production",
        PORTFOLIO_DEMO_MODE: "false",
      },
    });
    expect(productionConfig.projects?.map(({ name }) => name)).toEqual([
      "production-csp-chromium",
    ]);
  });

  it("isolates the stateful knowledge flow from development HMR", () => {
    const projects = e2eConfig.projects ?? [];
    const knowledgeProject = projects.find(
      ({ name }) => name === "knowledge-chromium",
    );

    expect(knowledgeProject).toMatchObject({
      dependencies: [
        "desktop-chromium",
        "mobile-chromium",
        "core-webkit",
      ],
      fullyParallel: false,
      testMatch: "knowledge.spec.ts",
    });
    for (const projectName of ["desktop-chromium", "mobile-chromium"]) {
      const project = projects.find(({ name }) => name === projectName);
      expect(project?.testIgnore).toContain("knowledge.spec.ts");
      expect(project?.testIgnore).toContain("fde-demo.spec.ts");
    }
  });

  it("continuously runs the production CSP contract in the required e2e job", async () => {
    const workflow = await readFile(
      resolve(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );
    const e2eStart = workflow.indexOf("\n  e2e:\n");
    const e2eEnd = workflow.indexOf("\n  portfolio-demo-e2e:\n", e2eStart);
    const e2eJob = workflow.slice(e2eStart, e2eEnd);
    const developmentTestIndex = e2eJob.indexOf("run: pnpm test:e2e\n");
    const productionBuildIndex = e2eJob.indexOf("run: pnpm build\n");
    const productionTestIndex = e2eJob.indexOf(
      "run: pnpm test:e2e:csp:production\n",
    );

    expect(e2eStart).toBeGreaterThanOrEqual(0);
    expect(e2eEnd).toBeGreaterThan(e2eStart);
    expect(productionBuildIndex).toBeGreaterThan(developmentTestIndex);
    expect(productionTestIndex).toBeGreaterThan(productionBuildIndex);
  });
});
