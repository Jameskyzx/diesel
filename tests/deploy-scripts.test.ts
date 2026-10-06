import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  chmod,
  chown,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  TEST_RELEASE_SHA,
  createHostActivationLedgerFixture,
  createPreparePreflightFixture,
  quoteShell,
  writeExecutable,
  type CommandResult,
} from "./helpers/deploy-runtime-fixtures";

import {
  productListResponseSchema,
  type ProductListResponse,
  type ProductSummary,
} from "@/features/product-fit/schemas";

const execFileAsync = promisify(execFile);
const deployScripts = [
  "activate-host-release.sh",
  "build-release.sh",
  "host-release-orchestrator.sh",
  "prepare-release-runtime.sh",
  "publish-governance-country-fixtures.sh",
  "release-publication-controller.sh",
  "stage-release.sh",
  "validate-public-governance.sh",
  "verify-release.sh",
  "rollback-host-release.sh",
] as const;

const buildOutputs = ["node_modules", ".next", ".build-complete"] as const;
const PRODUCTION_PM2_CWD = "/opt/diesel/current";
const PRODUCTION_PM2_EXEC_PATH = "/usr/bin/env";
const PRODUCTION_PM2_INTERPRETER = "none";
const PRODUCTION_NODE_BINARY = "/opt/node-v22.22.3-linux-x64/bin/node";
const TEST_RUNTIME_UID = "1001";
const TEST_RUNTIME_GID = "1001";
const TEST_PROCESS_UID = String(process.getuid?.() ?? 0);
const TEST_PROCESS_GID = String(process.getgid?.() ?? 0);
const PRODUCTION_PROCESS_PATH =
  "/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const MAX_RELEASE_HTML_RESPONSE_BYTES = 4_194_304;
const SYSTEMD_BUILD_UNIT_PROPERTIES = [
  "LoadState",
  "ActiveState",
  "SubState",
  "Result",
  "ExecMainCode",
  "ExecMainStatus",
  "ControlGroup",
  "Transient",
  "FragmentPath",
  "User",
  "Group",
  "WorkingDirectory",
  "Slice",
  "KillMode",
  "Delegate",
  "RemainAfterExit",
  "Restart",
  "Type",
  "KillSignal",
  "FinalKillSignal",
  "SendSIGKILL",
  "RuntimeMaxUSec",
  "TimeoutStopUSec",
  "UMask",
  "NoNewPrivileges",
  "ProtectControlGroups",
] as const;
const PM2_SYSTEMD_IDENTITY_PROPERTIES = [
  "Id",
  "Names",
  "LoadState",
  "ActiveState",
  "SubState",
  "UnitFileState",
  "Type",
  "User",
  "Environment",
  "EnvironmentFiles",
  "PIDFile",
  "ExecCondition",
  "ExecStart",
  "ExecStartPre",
  "ExecStartPost",
  "ExecReload",
  "ExecStop",
  "ExecStopPost",
  "Restart",
  "Wants",
  "Requires",
  "Upholds",
  "Requisite",
  "BindsTo",
  "OnFailure",
  "OnSuccess",
  "PartOf",
  "Conflicts",
  "RootDirectory",
  "RootImage",
  "Group",
  "SupplementaryGroups",
  "PAMName",
  "PassEnvironment",
  "UnsetEnvironment",
  "DynamicUser",
  "Slice",
  "WorkingDirectory",
  "MainPID",
  "ControlGroup",
  "FragmentPath",
  "DropInPaths",
  "NeedDaemonReload",
] as const;
const verifyReleaseScript = resolve(
  process.cwd(),
  "scripts/deploy/verify-release.sh",
);
const activateHostReleaseScript = resolve(
  process.cwd(),
  "scripts/deploy/activate-host-release.sh",
);
const readinessResponseContractScript = resolve(
  process.cwd(),
  "scripts/deploy/readiness-response-contract.cjs",
);
const rollbackHostReleaseScript = resolve(
  process.cwd(),
  "scripts/deploy/rollback-host-release.sh",
);
const publicGovernanceValidationScript = resolve(
  process.cwd(),
  "scripts/deploy/validate-public-governance.sh",
);
const prepareReleaseRuntimeScript = resolve(
  process.cwd(),
  "scripts/deploy/prepare-release-runtime.sh",
);
const persistPm2ReleaseStateScript = resolve(
  process.cwd(),
  "scripts/deploy/persist-pm2-release-state.mjs",
);
const hostActivationLedgerScript = resolve(
  process.cwd(),
  "scripts/deploy/host-activation-ledger.sh",
);
const governanceCountryFixturePublisherScript = resolve(
  process.cwd(),
  "scripts/deploy/publish-governance-country-fixtures.sh",
);
const linuxReleaseHandoffScript = resolve(
  process.cwd(),
  "scripts/ci/linux-release-handoff-smoke.sh",
);
const stageReleaseScript = resolve(
  process.cwd(),
  "scripts/deploy/stage-release.sh",
);
const boundedCommandScript = resolve(
  process.cwd(),
  "scripts/deploy/run-bounded-command.mjs",
);
const boundedCommandGroupInventoryPreload = resolve(
  process.cwd(),
  "tests/fixtures/bounded-command-group-inventory-preload.cjs",
);
const STAGE_SSH_OPTIONS = [
  "-F",
  "/dev/null",
  "-o",
  "BatchMode=yes",
  "-o",
  "CanonicalizeHostname=no",
  "-o",
  "CheckHostIP=yes",
  "-o",
  "ClearAllForwardings=yes",
  "-o",
  "ConnectTimeout=10",
  "-o",
  "ForwardAgent=no",
  "-o",
  "ForwardX11=no",
  "-o",
  "HostKeyAlias=111.228.50.85",
  "-o",
  "KbdInteractiveAuthentication=no",
  "-o",
  "LogLevel=ERROR",
  "-o",
  "NumberOfPasswordPrompts=0",
  "-o",
  "PasswordAuthentication=no",
  "-o",
  "PermitLocalCommand=no",
  "-o",
  "RequestTTY=no",
  "-o",
  "ServerAliveCountMax=2",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "UpdateHostKeys=no",
] as const;
const STAGE_REMOTE_SHELL_PREFIX = [
  "/usr/bin/env",
  "-i",
  "HOME=/root",
  "LANG=C",
  "LC_ALL=C",
  "PATH=/usr/sbin:/usr/bin:/sbin:/bin",
  "/bin/bash",
  "--noprofile",
  "--norc",
  "-s",
  "--",
] as const;

function expectedPm2Args(
  releaseId: string,
  deployRoot: string,
  processPath: string,
  nodeBinary: string,
): string[] {
  return [
    "-i",
    `HOME=${deployRoot}/shared`,
    `PATH=${processPath}`,
    "NODE_ENV=production",
    `APP_VERSION=${releaseId}`,
    nodeBinary,
    "--env-file=.env.production.local",
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "8788",
  ];
}

function expectedProductionPm2Args(releaseId: string): string[] {
  return expectedPm2Args(
    releaseId,
    "/opt/diesel",
    PRODUCTION_PROCESS_PATH,
    PRODUCTION_NODE_BINARY,
  );
}

function expectedPm2SystemdUnit(
  pm2StateRoot: string,
  pm2Exec: string,
  fixedPath: string,
): string {
  const unitPath = `${fixedPath}:/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin`;
  return [
    "[Unit]",
    "Description=PM2 process manager",
    "Documentation=https://pm2.keymetrics.io/",
    "After=network.target",
    "",
    "[Service]",
    "Type=forking",
    "User=root",
    "LimitNOFILE=infinity",
    "LimitNPROC=infinity",
    "LimitCORE=infinity",
    `Environment=PATH=${unitPath}`,
    `Environment=PM2_HOME=${pm2StateRoot}`,
    `PIDFile=${pm2StateRoot}/pm2.pid`,
    "Restart=on-failure",
    "",
    `ExecStart=${pm2Exec} resurrect`,
    `ExecReload=${pm2Exec} reload all`,
    `ExecStop=${pm2Exec} kill`,
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

function durablePm2Application(
  releaseId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "diesel-demo",
    APP_VERSION: releaseId,
    pm_cwd: PRODUCTION_PM2_CWD,
    pm_exec_path: PRODUCTION_PM2_EXEC_PATH,
    exec_interpreter: PRODUCTION_PM2_INTERPRETER,
    args: expectedProductionPm2Args(releaseId),
    exec_mode: "fork_mode",
    node_args: [],
    autorestart: true,
    max_memory_restart: 1_073_741_824,
    uid: 1_001,
    gid: 1_001,
    env: { APP_VERSION: releaseId },
    ...overrides,
  };
}

type VerificationStubMode =
  | "duplicate-done"
  | "event-after-done"
  | "extra-real-product"
  | "extra-readiness-check"
  | "extra-readiness-field"
  | "future-readiness-timestamp"
  | "malformed-products"
  | "missing-health-cache-control"
  | "missing-finish"
  | "missing-product-field"
  | "missing-products"
  | "missing-readiness-pragma"
  | "missing-readiness-check"
  | "missing-readiness-timestamp"
  | "missing-start"
  | "non-stop-finish"
  | "noncanonical-health-timestamp"
  | "noncanonical-readiness-timestamp"
  | "oversized-html"
  | "stale-health-timestamp"
  | "stale-readiness-timestamp"
  | "unclosed-text"
  | "unknown-event"
  | "success"
  | "wrong-health-service"
  | "wrong-health-status"
  | "wrong-health-version"
  | "wrong-health-pragma"
  | "wrong-readiness-admission-check"
  | "wrong-readiness-rate-limit-check"
  | "wrong-readiness-check"
  | "wrong-readiness-cache-control"
  | "wrong-readiness-service"
  | "wrong-readiness-status"
  | "wrong-readiness-version"
  | "wrong-default-locale"
  | "lost-locale"
  | "product-classification-drift"
  | "product-identity-drift"
  | "source-identity-drift"
  | "source-classification-drift"
  | "specification-version-drift"
  | "reasoning-part";

type RecordedRequest = {
  body: string;
  cookie: string;
  curlrcMarker: string | null;
  method: string;
  url: string;
};

async function execute(
  command: string,
  args: readonly string[],
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, [...args]);
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

async function executePm2StateHarness(
  action: "persist" | "validate",
  expectedReleaseId: string,
  payload: string,
): Promise<CommandResult> {
  const harness = `
    import {
      persistPm2ReleaseState,
      validatePm2DumpDocument,
    } from ${JSON.stringify(pathToFileURL(persistPm2ReleaseStateScript).href)};

    try {
      if (process.argv[1] === "validate") {
        validatePm2DumpDocument(
          JSON.parse(process.argv[3]),
          process.argv[2],
          process.argv[4],
          process.argv[5],
        );
      } else if (process.argv[1] === "persist") {
        persistPm2ReleaseState(
          process.argv[2],
          process.argv[3],
          process.argv[4],
          process.argv[5],
        );
      } else {
        throw new Error("invalid test action");
      }
      process.stdout.write("ok\\n");
    } catch (error) {
      process.stderr.write(
        error instanceof Error ? error.message + "\\n" : "unknown error\\n",
      );
      process.exitCode = 70;
    }
  `;

  try {
    const result = await execFileAsync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        harness,
        action,
        expectedReleaseId,
        payload,
        TEST_RUNTIME_UID,
        TEST_RUNTIME_GID,
      ],
    );
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

type SystemdBuildUnitProperty =
  (typeof SYSTEMD_BUILD_UNIT_PROPERTIES)[number];

type SystemdUnitMetadata = Record<SystemdBuildUnitProperty, string>;

type RollbackFixture = {
  currentLink: string;
  deployRoot: string;
  environmentPath: string;
  failedRelease: string;
  fakePath: string;
  lifecycleLock: string;
  lifecycleLog: string;
  hostActivationLedger: string;
  mutationLog: string;
  nginxAlternatePath: string;
  nginxPrimaryPath: string;
  nginxSitesRoot: string;
  nodeBinary: string;
  pm2State: string;
  pm2StateHelper: string;
  pm2Exec: string;
  pm2Home: string;
  pm2UnitFragment: string;
  previousRelease: string;
  procRoot: string;
  releaseArtifactManifest: string;
  releaseId: string;
  root: string;
  stateDir: string;
  systemdAbsentUnitRoot: string;
  systemdSecondaryUnitRoot: string;
  systemdUnitRoot: string;
};

async function executeLinuxReleaseHandoff(
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(linuxReleaseHandoffScript, args, {
      env: environment,
    });
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

async function executeStageRelease(
  script: string,
  cwd: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(script, args, {
      cwd,
      env: environment,
    });
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  response: ServerResponse,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(200, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function healthResponseHeaders(
  mode: VerificationStubMode,
  payloadKind: "liveness" | "readiness",
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (
    !(payloadKind === "liveness" && mode === "missing-health-cache-control")
  ) {
    headers["cache-control"] =
      payloadKind === "readiness" && mode === "wrong-readiness-cache-control"
        ? "public, max-age=300"
        : "private, no-store, max-age=0";
  }
  if (!(payloadKind === "readiness" && mode === "missing-readiness-pragma")) {
    headers.pragma = payloadKind === "liveness" && mode === "wrong-health-pragma"
      ? "cache"
      : "no-cache";
  }
  return headers;
}

function sendHtml(
  response: ServerResponse,
  locale: "en" | "zh-CN",
): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="${locale}"><body>stub</body></html>`);
}

function sendChatStream(
  response: ServerResponse,
  mode: VerificationStubMode,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "x-vercel-ai-ui-message-stream": "v1",
  });
  const events: unknown[] = [];
  if (mode !== "missing-start") {
    events.push({ type: "start" });
  }
  events.push({ id: "stub-answer", type: "text-start" });
  if (mode === "reasoning-part") {
    events.push({
      delta: "private chain of thought",
      id: "stub-reasoning",
      type: "reasoning-delta",
    });
  }
  events.push(
    {
      delta: "Deterministic capability response.",
      id: "stub-answer",
      type: "text-delta",
    },
  );
  if (mode !== "unclosed-text") {
    events.push({ id: "stub-answer", type: "text-end" });
  }
  if (mode === "unknown-event") {
    events.push({ type: "future-contract-event" });
  }
  if (mode !== "missing-finish") {
    events.push({
      finishReason: mode === "non-stop-finish" ? "length" : "stop",
      type: "finish",
    });
  }

  const eventStream = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  if (mode === "duplicate-done") {
    response.end(`${eventStream}data: [DONE]\n\ndata: [DONE]\n\n`);
    return;
  }
  if (mode === "event-after-done") {
    response.end(
      `${eventStream}data: [DONE]\n\ndata: ${JSON.stringify({ type: "finish" })}\n\n`,
    );
    return;
  }
  response.end(`${eventStream}data: [DONE]\n\n`);
}

function createReleasePublicProducts(): ProductListResponse {
  const verifiedAt = "2026-08-31T00:00:00.000Z";
  const productSource = {
    id: "00000000-0000-4000-8000-000000000003",
    isDemo: true,
    publishedOn: "2026-01-03",
    title: "DEMO ONLY — Fictional product manual",
    url: "https://example.invalid/demo/products",
    verifiedAt,
  } as const;
  return {
    products: [
      {
        applicationScopes: ["non-road", "construction"],
        availableFrom: "2025-01-01",
        availableTo: "2030-01-01",
        id: "00000000-0000-4000-8000-000000000201",
        isDemo: true,
        modelCode: "DEMO-ENG-100",
        name: "DEMO ONLY — Fictional Engine 100",
        powerMaxKw: 150,
        powerMinKw: 50,
        source: { ...productSource },
        specificationVersion: "demo-v1",
        verifiedAt,
      },
      {
        applicationScopes: ["non-road"],
        availableFrom: "2025-01-01",
        availableTo: "2030-01-01",
        id: "00000000-0000-4000-8000-000000000202",
        isDemo: true,
        modelCode: "DEMO-ENG-200",
        name: "DEMO ONLY — Fictional Engine 200",
        powerMaxKw: 120,
        powerMinKw: 40,
        source: { ...productSource },
        specificationVersion: "demo-v1",
        verifiedAt,
      },
    ],
    status: "ok",
  };
}

async function executeVerifyRelease(
  mode: VerificationStubMode,
  options?: { home?: string },
): Promise<{ command: CommandResult; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = [];
  const publicRoutes = new Set(["/", "/map", "/chat", "/countries/CHN"]);
  const server = createServer((request, response) => {
    void (async () => {
      const body = await readRequestBody(request);
      const method = request.method ?? "GET";
      const url = request.url ?? "/";
      const cookie = request.headers.cookie ?? "";
      const curlrcHeader = request.headers["x-curlrc-marker"];
      const curlrcMarker = Array.isArray(curlrcHeader)
        ? curlrcHeader.join(",")
        : curlrcHeader ?? null;
      requests.push({ body, cookie, curlrcMarker, method, url });

      if (method === "GET" && url === "/api/health") {
        const currentTimestamp = new Date().toISOString();
        sendJson(
          response,
          {
            service: mode === "wrong-health-service"
              ? "wrong-service"
              : "global-diesel-regulations",
            status: mode === "wrong-health-status" ? "unavailable" : "ok",
            timestamp: mode === "stale-health-timestamp"
              ? new Date(Date.now() - 60_000).toISOString()
              : mode === "noncanonical-health-timestamp"
                ? currentTimestamp.replace(/Z$/u, "+00:00")
                : currentTimestamp,
            version: mode === "wrong-health-version"
              ? "b".repeat(40)
              : TEST_RELEASE_SHA,
          },
          healthResponseHeaders(mode, "liveness"),
        );
        return;
      }
      if (method === "GET" && url === "/api/health/ready") {
        const currentTimestamp = new Date().toISOString();
        const checks: Record<string, string> = {
          aiChatAdmission:
            mode === "wrong-readiness-admission-check"
              ? "unavailable"
              : "ok",
          aiChatRateLimit:
            mode === "wrong-readiness-rate-limit-check"
              ? "unavailable"
              : "ok",
          database: mode === "wrong-readiness-check"
            ? "unavailable"
            : "ok",
        };
        if (mode === "extra-readiness-check") checks.provider = "ok";
        if (mode === "missing-readiness-check") {
          delete checks.aiChatAdmission;
        }
        const readinessBody: Record<string, unknown> = {
          checks,
          service: mode === "wrong-readiness-service"
            ? "wrong-service"
            : "global-diesel-regulations",
          status: mode === "wrong-readiness-status" ? "unavailable" : "ok",
          timestamp: mode === "future-readiness-timestamp"
            ? new Date(Date.now() + 60_000).toISOString()
            : mode === "stale-readiness-timestamp"
              ? new Date(Date.now() - 60_000).toISOString()
              : mode === "noncanonical-readiness-timestamp"
                ? currentTimestamp.replace(/Z$/u, "+00:00")
                : currentTimestamp,
          version: mode === "wrong-readiness-version"
            ? "b".repeat(40)
            : TEST_RELEASE_SHA,
        };
        if (mode === "extra-readiness-field") {
          readinessBody.provider = "unexpected";
        }
        if (mode === "missing-readiness-timestamp") {
          delete readinessBody.timestamp;
        }
        sendJson(
          response,
          readinessBody,
          healthResponseHeaders(mode, "readiness"),
        );
        return;
      }
      if (
        method === "GET" &&
        url === "/api/products" &&
        mode !== "missing-products"
      ) {
        if (mode === "malformed-products") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end('{"status":');
          return;
        }
        const publicProducts = createReleasePublicProducts();
        if (mode === "extra-real-product") {
          publicProducts.products.push({
            ...publicProducts.products[0]!,
            id: "00000000-0000-4000-8000-000000000999",
            isDemo: false,
            modelCode: "REAL-ENG-900",
            name: "Unapproved real engine",
            source: {
              ...publicProducts.products[0]!.source,
              id: "00000000-0000-4000-8000-000000000998",
              isDemo: false,
            },
          });
        } else if (mode === "missing-product-field") {
          delete (publicProducts.products[0] as Partial<ProductSummary>).name;
        } else if (mode === "product-classification-drift") {
          publicProducts.products[0]!.isDemo = false;
        } else if (mode === "product-identity-drift") {
          publicProducts.products[0]!.id =
            "00000000-0000-4000-8000-000000000997";
        } else if (mode === "source-classification-drift") {
          publicProducts.products[0]!.source.isDemo = false;
        } else if (mode === "source-identity-drift") {
          publicProducts.products[0]!.source.id =
            "00000000-0000-4000-8000-000000000996";
        } else if (mode === "specification-version-drift") {
          publicProducts.products[0]!.specificationVersion = "demo-v2";
        }
        sendJson(response, publicProducts);
        return;
      }
      if (method === "POST" && url === "/api/preferences/locale") {
        response.setHeader(
          "set-cookie",
          "diesel_locale=zh-CN; Max-Age=31536000; Path=/; SameSite=Lax; Secure",
        );
        sendJson(response, { locale: "zh-CN", status: "ok" });
        return;
      }
      if (method === "POST" && url === "/api/chat") {
        sendChatStream(response, mode);
        return;
      }
      if (method === "GET" && url === "/" && mode === "oversized-html") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(Buffer.alloc(MAX_RELEASE_HTML_RESPONSE_BYTES + 1, 0x78));
        return;
      }
      if (method === "GET" && publicRoutes.has(url)) {
        const hasChineseCookie = /(?:^|;\s*)diesel_locale=zh-CN(?:;|$)/u.test(
          cookie,
        );
        let locale: "en" | "zh-CN" = hasChineseCookie ? "zh-CN" : "en";
        if (mode === "wrong-default-locale" && url === "/" && !hasChineseCookie) {
          locale = "zh-CN";
        }
        if (mode === "lost-locale" && url === "/map" && hasChineseCookie) {
          locale = "en";
        }
        sendHtml(response, locale);
        return;
      }

      response.writeHead(404);
      response.end("not found");
    })().catch((error: unknown) => {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : "stub error");
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address() as AddressInfo;
  const commandEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    ALL_PROXY: "http://127.0.0.1:1",
    HTTP_PROXY: "http://127.0.0.1:1",
    all_proxy: "http://127.0.0.1:1",
    http_proxy: "http://127.0.0.1:1",
    ...(options?.home === undefined ? {} : { HOME: options.home }),
  };
  delete commandEnvironment.NO_PROXY;
  delete commandEnvironment.no_proxy;

  let command: CommandResult;
  try {
    const result = await execFileAsync(
      "bash",
      [verifyReleaseScript, `http://127.0.0.1:${address.port}`, TEST_RELEASE_SHA],
      {
        env: commandEnvironment,
      },
    );
    command = {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    command = {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }

  return { command, requests };
}

async function createBuildFixture(
  symlinkedOutput?: (typeof buildOutputs)[number],
): Promise<string> {
  const fixture = await mkdtemp(join(tmpdir(), "diesel-build-release-"));
  for (const input of [
    "package.json",
    "pnpm-lock.yaml",
    "next.config.ts",
    "next-env.d.ts",
  ]) {
    await copyFile(resolve(process.cwd(), input), join(fixture, input));
  }

  for (const output of buildOutputs) {
    const outputPath = join(fixture, output);
    if (output === symlinkedOutput) {
      const target =
        output === ".build-complete"
          ? resolve(process.cwd(), "package.json")
          : process.cwd();
      await symlink(target, outputPath, output === ".build-complete" ? "file" : "dir");
    } else if (output === ".build-complete") {
      await writeFile(outputPath, "", "utf8");
    } else {
      await mkdir(outputPath);
    }
  }

  return fixture;
}

async function resolveSearchPathExecutable(
  searchPath: string,
  name: string,
): Promise<string | undefined> {
  for (const directory of searchPath.split(":")) {
    if (!directory.startsWith("/")) continue;
    const candidate = join(directory, name);
    const metadata = await stat(candidate).catch(() => undefined);
    if (
      metadata?.isFile() &&
      (metadata.mode & 0o111) !== 0
    ) {
      return candidate;
    }
  }
  return undefined;
}

type StageReleaseAuthorizationMode =
  | "empty-output"
  | "oversized-output"
  | "success"
  | "validation-failure";

type StageReleaseFixture = {
  eventLog: string;
  fakePath: string;
  releaseId: string;
  repository: string;
  root: string;
  rsyncCapture: string;
  runnerPidPath: string;
  script: string;
  sshPath: string;
  sshPidPath: string;
  sshReadyPath: string;
  temporaryRoot: string;
  transportHome: string;
  transportPath: string;
  transportSocket: string;
};

async function runStageFixtureGit(
  cwd: string,
  args: string[],
): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "stage-release@example.invalid",
      GIT_AUTHOR_NAME: "Stage Release Test",
      GIT_COMMITTER_EMAIL: "stage-release@example.invalid",
      GIT_COMMITTER_NAME: "Stage Release Test",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return String(result.stdout).trim();
}

async function createStageReleaseFixture(options?: {
  authorizationMode?: StageReleaseAuthorizationMode;
  boundedCommandReceiptFault?:
    | "exit-mismatch"
    | "hardlink"
    | "malformed"
    | "missing"
    | "token-mismatch";
  forbiddenPath?: string;
  remoteDigestMismatch?: boolean;
  remoteIdentityOutputMode?: "extra-newline" | "oversized";
  realRsync?: boolean;
  rsyncFailure?: boolean;
  sshFailureAt?: 1 | 2;
  sshMode?: "hang-first";
}): Promise<StageReleaseFixture> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "diesel-stage-release-")),
  );
  const repository = join(root, "repository");
  const fakeBin = join(root, "bin");
  const fixtureRuntimeBin = join(root, "runtime-bin");
  const boundedCommandPreload = join(
    root,
    "bounded-command-stage-fixture-preload.cjs",
  );
  const fakePath = `${fakeBin}:${fixtureRuntimeBin}:${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`;
  const temporaryRoot = join(root, "tmp");
  const transportHome = join(root, "transport-home");
  const transportSocket = join(root, "agent.sock");
  const eventLog = join(root, "events.ndjson");
  const sshCount = join(root, "ssh-count");
  const sshPidPath = join(root, "ssh.pid");
  const sshReadyPath = join(root, "ssh.ready");
  const sshPath = join(fakeBin, "ssh");
  const rsyncCapture = join(root, "rsync-capture.json");
  const runnerPidPath = join(root, "runner.pid");
  const fixtureScript = join(
    repository,
    "scripts",
    "deploy",
    "stage-release.sh",
  );
  const authorizationBundle = join(
    repository,
    "scripts",
    "deploy",
    "verify-release-authorization.bundle.mjs",
  );
  const authorizationLicense = join(
    repository,
    "scripts",
    "deploy",
    "verify-release-authorization.bundle.LICENSE",
  );
  const inputManifest = join(
    repository,
    "scripts",
    "deploy",
    "release-input-manifest.mjs",
  );
  const boundedCommand = join(
    repository,
    "scripts",
    "deploy",
    "run-bounded-command.mjs",
  );
  const authorizationMode = options?.authorizationMode ?? "success";

  await Promise.all([
    mkdir(join(repository, "scripts", "deploy"), { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
    mkdir(fixtureRuntimeBin, { recursive: true }),
    mkdir(temporaryRoot, { recursive: true }),
    mkdir(transportHome, { recursive: true }),
  ]);
  await writeFile(
    boundedCommandPreload,
    `/* Test-only preload for the hermetic stage fixture. */
require(${JSON.stringify(boundedCommandGroupInventoryPreload)});
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const receiptFault = ${JSON.stringify(options?.boundedCommandReceiptFault ?? "none")};
const originalLinkSync = fs.linkSync;
fs.linkSync = function stageFixtureLinkSync(existingPath, newPath) {
  const receiptName = typeof newPath === "string"
    ? newPath.slice(newPath.lastIndexOf("/") + 1)
    : "";
  const isReceiptPublication =
    /^bounded-command-[1-9][0-9]*[.]completion[.]json$/u.test(receiptName);
  if (!isReceiptPublication) {
    return originalLinkSync.call(this, existingPath, newPath);
  }
  if (receiptFault === "missing") return undefined;
  const result = originalLinkSync.call(this, existingPath, newPath);
  if (receiptFault === "malformed") {
    fs.writeFileSync(newPath, '{"version":"fixture-malformed"}\\n', "utf8");
  } else if (receiptFault === "hardlink") {
    originalLinkSync.call(this, newPath, newPath + ".fixture-link");
  } else if (receiptFault === "token-mismatch" || receiptFault === "exit-mismatch") {
    const receipt = JSON.parse(fs.readFileSync(newPath, "utf8"));
    if (receiptFault === "token-mismatch") {
      receipt.token = "123e4567-e89b-42d3-a456-426614174000";
    } else {
      receipt.exitCode = receipt.exitCode === 0 ? 1 : 0;
    }
    fs.writeFileSync(newPath, JSON.stringify(receipt) + "\\n", "utf8");
  }
  return result;
};
syncBuiltinESMExports();
`,
    "utf8",
  );
  await writeExecutable(
    join(fixtureRuntimeBin, "node"),
    `#!/bin/sh
case "\${1:-}" in
  */scripts/deploy/run-bounded-command.mjs)
    NODE_OPTIONS=${quoteShell(`--require=${boundedCommandPreload}`)}
    export NODE_OPTIONS
    ;;
  ${quoteShell(sshPath)}|${quoteShell(join(fakeBin, "rsync"))})
    exec /usr/bin/env -i \
      "HOME=\${HOME:-}" "LANG=\${LANG:-}" "LC_ALL=\${LC_ALL:-}" \
      "PATH=\${PATH:-}" "SSH_AUTH_SOCK=\${SSH_AUTH_SOCK:-}" \
      ${quoteShell(process.execPath)} "$@"
    ;;
  *)
    unset NODE_OPTIONS
    ;;
esac
exec ${quoteShell(process.execPath)} "$@"
`,
  );
  const resolvedNode = await resolveSearchPathExecutable(fakePath, "node");
  const resolvedGit = await resolveSearchPathExecutable(fakePath, "git");
  const resolvedGh = await resolveSearchPathExecutable(fakePath, "gh");
  if (!resolvedNode || !resolvedGit) {
    throw new Error("stage fixture requires node and git in its controlled PATH");
  }
  const transportPath = [
    dirname(resolvedNode),
    dirname(resolvedGit),
    ...(resolvedGh ? [dirname(resolvedGh)] : []),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
  if (transportPath.split(":").includes(fakeBin)) {
    throw new Error("stage fixture transport PATH must exclude the fake tool directory");
  }
  await Promise.all([
    copyFile(stageReleaseScript, fixtureScript),
    copyFile(
      resolve(
        process.cwd(),
        "scripts/deploy/release-input-manifest.mjs",
      ),
      inputManifest,
    ),
    copyFile(boundedCommandScript, boundedCommand),
    writeFile(join(repository, "README.md"), "tracked release input\n", "utf8"),
    writeFile(authorizationLicense, "fixture bundled license\n", "utf8"),
    writeFile(
      authorizationBundle,
      `import { appendFileSync, readFileSync } from "node:fs";

const eventLog = ${JSON.stringify(eventLog)};
const mode = ${JSON.stringify(authorizationMode)};
const args = process.argv.slice(2);

if (args[0] === "validate-output") {
  appendFileSync(eventLog, JSON.stringify({ command: "authorization-validate" }) + "\\n");
  if (mode === "validation-failure") process.exit(19);
  const expectedCommit = args[1];
  const parsed = JSON.parse(readFileSync(0, "utf8"));
  if (parsed.commit !== expectedCommit) process.exit(20);
  process.stdout.write(JSON.stringify(parsed) + "\\n");
} else {
  appendFileSync(eventLog, JSON.stringify({ command: "authorization-read" }) + "\\n");
  if (mode === "empty-output") process.exit(0);
  if (mode === "oversized-output") {
    process.stdout.write("x".repeat(70_000));
    process.exit(0);
  }
  const commit = args[0];
  const runId = 101;
  const gateJobId = 202;
  process.stdout.write(JSON.stringify({
    branch: "master",
    commit,
    format: "diesel-release-authorization-v1",
    origin: {
      fetchUrl: "git@github.com:Jameskyzx/diesel.git",
      pushUrl: "git@github.com:Jameskyzx/diesel.git",
      remoteMaster: commit,
      remoteMasterReadback: commit,
    },
    protection: {
      allowDeletions: false,
      allowForcePushes: false,
      enforceAdmins: true,
      requiredCheck: "Required CI gate",
      requiredCheckAppId: null,
      strict: true,
    },
    repository: "Jameskyzx/diesel",
    verifiedAt: "2026-09-01T00:00:00.000Z",
    workflow: {
      gateJobId,
      gateJobUrl: "https://github.com/Jameskyzx/diesel/actions/runs/" + runId + "/job/" + gateJobId,
      id: 303,
      name: "CI",
      path: ".github/workflows/ci.yml",
      runAttempt: 1,
      runId,
      runUrl: "https://github.com/Jameskyzx/diesel/actions/runs/" + runId,
      state: "active",
    },
  }) + "\\n");
}
`,
      "utf8",
    ),
  ]);
  await chmod(fixtureScript, 0o755);

  if (options?.forbiddenPath) {
    const forbiddenFile = join(
      repository,
      ...options.forbiddenPath.split("/"),
    );
    await mkdir(dirname(forbiddenFile), { recursive: true });
    await writeFile(forbiddenFile, "PRIVATE_CANARY\n", "utf8");
  }

  await runStageFixtureGit(repository, ["init", "--quiet"]);
  await runStageFixtureGit(repository, [
    "symbolic-ref",
    "HEAD",
    "refs/heads/master",
  ]);
  await runStageFixtureGit(repository, ["add", "--all"]);
  await runStageFixtureGit(repository, [
    "commit",
    "--quiet",
    "-m",
    "stage release fixture",
  ]);
  const releaseId = await runStageFixtureGit(repository, [
    "rev-parse",
    "HEAD",
  ]);
  const committedExport = join(root, "committed-stage");
  const committedArchive = join(root, "committed-stage.tar");
  await mkdir(committedExport);
  await runStageFixtureGit(repository, [
    "archive",
    "--format=tar",
    `--output=${committedArchive}`,
    releaseId,
    "--",
    "scripts/deploy/stage-release.sh",
  ]);
  const tarEnvironment: NodeJS.ProcessEnv = { ...process.env };
  delete tarEnvironment.TAR_OPTIONS;
  await execFileAsync("tar", ["-xf", committedArchive, "-C", committedExport], {
    env: tarEnvironment,
  });
  await rm(committedArchive);
  const committedStageScript = join(
    committedExport,
    "scripts",
    "deploy",
    "stage-release.sh",
  );
  await runStageFixtureGit(repository, [
    "remote",
    "add",
    "origin",
    "git@github.com:Jameskyzx/diesel.git",
  ]);
  await runStageFixtureGit(repository, [
    "update-ref",
    "refs/remotes/origin/master",
    releaseId,
  ]);
  await runStageFixtureGit(repository, [
    "branch",
    "--set-upstream-to=origin/master",
    "master",
  ]);

  await writeExecutable(
    join(fakeBin, "mktemp"),
    `#!/usr/bin/env node
const { mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
const expectedRoot = ${JSON.stringify(temporaryRoot)};
if (JSON.stringify(args) !== JSON.stringify(["-d"])) process.exit(64);
if (process.env.TMPDIR !== expectedRoot) process.exit(65);
process.stdout.write(mkdtempSync(join(expectedRoot, "tmp.")) + "\\n");
`,
  );
  await writeExecutable(
    sshPath,
    `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const countPath = ${JSON.stringify(sshCount)};
const count = existsSync(countPath) ? Number(readFileSync(countPath, "utf8")) + 1 : 1;
writeFileSync(countPath, String(count));
const environment = Object.fromEntries(Object.entries(process.env).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
if (environment.__CF_USER_TEXT_ENCODING !== undefined && !/^0x[0-9A-Fa-f]+(?::0x[0-9A-Fa-f]+){2}$/u.test(environment.__CF_USER_TEXT_ENCODING)) process.exit(88);
delete environment.__CF_USER_TEXT_ENCODING;
const expectedEnvironment = ${JSON.stringify({
      HOME: transportHome,
      LANG: "C",
      LC_ALL: "C",
      PATH: transportPath,
      SSH_AUTH_SOCK: transportSocket,
    })};
appendFileSync(${JSON.stringify(eventLog)}, JSON.stringify({ command: "ssh", args, count, environmentKeys: Object.keys(environment) }) + "\\n");
if (JSON.stringify(environment) !== JSON.stringify(expectedEnvironment)) process.exit(89);
const body = readFileSync(0, "utf8");
const targetIndex = args.indexOf("root@111.228.50.85");
const sshOptions = ${JSON.stringify(STAGE_SSH_OPTIONS)};
const remotePrefix = ${JSON.stringify(STAGE_REMOTE_SHELL_PREFIX)};
if (targetIndex !== sshOptions.length || JSON.stringify(args.slice(0, targetIndex)) !== JSON.stringify(sshOptions)) process.exit(91);
if (count === 1 && (!body.includes('"\${mkdir_bin}" -- "\${release_dir}"') || !body.includes('"\${chmod_bin}" 750 "\${release_dir}"') || !body.includes('"v22.22.3"'))) process.exit(92);
if (count === 2 && (!body.includes("verify_manifest_helper") || !body.includes('actual_digest') || !body.includes("verify_forbidden_runtime_paths_absent") || !body.includes('"\${sha256sum_bin}"'))) process.exit(93);
if (count > 2) process.exit(94);
if (count === ${JSON.stringify(options?.sshFailureAt ?? 0)}) process.exit(40 + count);
if (count === 1) {
  const expectedArgs = [...sshOptions, "root@111.228.50.85", ...remotePrefix, "${releaseId}"];
  if (JSON.stringify(args) !== JSON.stringify(expectedArgs)) process.exit(97);
  if (${JSON.stringify(options?.sshMode ?? "normal")} === "hang-first") {
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        appendFileSync(${JSON.stringify(eventLog)}, JSON.stringify({ command: "ssh-signal", signal }) + "\\n");
        process.exit(0);
      });
    }
    writeFileSync(${JSON.stringify(runnerPidPath)}, String(process.ppid));
    writeFileSync(${JSON.stringify(sshPidPath)}, String(process.pid));
    writeFileSync(${JSON.stringify(sshReadyPath)}, "ready\\n");
    setInterval(() => {}, 1_000);
  } else {
    const identityMode = ${JSON.stringify(options?.remoteIdentityOutputMode ?? "valid")};
    if (identityMode === "extra-newline") process.stdout.write("11:12:21:22:31:32:1001\\n\\n");
    else if (identityMode === "oversized") process.stdout.write("1:".repeat(300) + "1\\n");
    else process.stdout.write("11:12:21:22:31:32:1001\\n");
  }
} else if (count === 2) {
  const capture = JSON.parse(readFileSync(${JSON.stringify(rsyncCapture)}, "utf8"));
  const expectedSuffix = [
    "${releaseId}", capture.manifest.inputDigest,
    "11", "12", "21", "22", "31", "32", "1001",
    String(capture.helperSize), capture.helperSha256,
  ];
  const expectedArgs = [...sshOptions, "root@111.228.50.85", ...remotePrefix, ...expectedSuffix];
  if (JSON.stringify(args) !== JSON.stringify(expectedArgs)) process.exit(98);
  process.stdout.write(${JSON.stringify(options?.remoteDigestMismatch ?? false)} ? "0".repeat(64) + "\\n" : capture.manifest.inputDigest + "\\n");
}
`,
  );
  await writeExecutable(
    join(fakeBin, "rsync"),
    `#!/usr/bin/env node
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { appendFileSync, chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
const environment = Object.fromEntries(Object.entries(process.env).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
if (environment.__CF_USER_TEXT_ENCODING !== undefined && !/^0x[0-9A-Fa-f]+(?::0x[0-9A-Fa-f]+){2}$/u.test(environment.__CF_USER_TEXT_ENCODING)) process.exit(88);
delete environment.__CF_USER_TEXT_ENCODING;
const expectedEnvironment = ${JSON.stringify({
      HOME: transportHome,
      LANG: "C",
      LC_ALL: "C",
      PATH: transportPath,
      SSH_AUTH_SOCK: transportSocket,
    })};
appendFileSync(${JSON.stringify(eventLog)}, JSON.stringify({ command: "rsync", args, environmentKeys: Object.keys(environment) }) + "\\n");
if (JSON.stringify(environment) !== JSON.stringify(expectedEnvironment)) process.exit(89);
const expectedPrefix = [
  "-a", "--no-owner", "--no-group", "--no-perms", "--timeout=60",
  "--rsync-path=umask 022 && /usr/bin/env -i HOME=/root LANG=C LC_ALL=C PATH=/usr/bin:/bin /usr/bin/rsync",
];
const sourceArgument = args.at(-2) ?? "";
const destination = "root@111.228.50.85:/opt/diesel/releases/${releaseId}/";
const expectedTransport = ${JSON.stringify([sshPath, ...STAGE_SSH_OPTIONS].join(" "))};
const expectedArgs = [...expectedPrefix, "-e", expectedTransport, "--", sourceArgument, destination];
if (JSON.stringify(args) !== JSON.stringify(expectedArgs)) process.exit(95);
if (!sourceArgument.startsWith(${JSON.stringify(`${temporaryRoot}/`)})) process.exit(96);
if (!sourceArgument.endsWith("/release/")) process.exit(99);
const source = sourceArgument.slice(0, -1);
function walk(root, prefix = "") {
  const paths = [];
  for (const name of readdirSync(root).sort()) {
    const relative = prefix ? prefix + "/" + name : name;
    const absolute = join(root, name);
    const metadata = lstatSync(absolute);
    paths.push({ mode: metadata.mode & 0o777, path: relative, type: metadata.isDirectory() ? "directory" : metadata.isFile() ? "file" : "other" });
    if (metadata.isDirectory()) paths.push(...walk(absolute, relative));
  }
  return paths;
}
const manifest = JSON.parse(readFileSync(join(source, ".release-input-manifest.json"), "utf8"));
const helper = readFileSync(join(source, "scripts/deploy/release-input-manifest.mjs"));
let received;
if (${JSON.stringify(options?.realRsync ?? false)}) {
  const destination = ${JSON.stringify(join(root, "received-release"))};
  mkdirSync(destination, { mode: 0o750 });
  chmodSync(destination, 0o750);
  const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c",
    'umask 022; exec /usr/bin/rsync -a --no-owner --no-group --no-perms -- "$1/" "$2/"',
    "real-stage-rsync", source, destination], {
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    encoding: "utf8", timeout: 10_000,
  });
  if (result.status !== 0) process.exit(100);
  received = { rootMode: lstatSync(destination).mode & 0o777, paths: walk(destination) };
}
writeFileSync(${JSON.stringify(rsyncCapture)}, JSON.stringify({
  args,
  controlModes: ["authorization.json", "release.tar", "remote-preflight.sh"].map(path => ({
    path, mode: lstatSync(join(source, "..", path)).mode & 0o777,
  })),
  helperSha256: createHash("sha256").update(helper).digest("hex"),
  helperSize: helper.byteLength,
  manifest,
  paths: walk(source),
  privateRootMode: lstatSync(join(source, "..")).mode & 0o777,
  received,
}, null, 2) + "\\n");
if (${JSON.stringify(options?.rsyncFailure ?? false)}) process.exit(43);
`,
  );

  return {
    eventLog,
    fakePath,
    releaseId,
    repository,
    root,
    rsyncCapture,
    runnerPidPath,
    script: committedStageScript,
    sshPath,
    sshPidPath,
    sshReadyPath,
    temporaryRoot,
    transportHome,
    transportPath,
    transportSocket,
  };
}

function stageReleaseEnvironment(
  fixture: StageReleaseFixture,
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    DATABASE_URL: "postgresql://transport-secret-canary.invalid/diesel",
    HOME: fixture.transportHome,
    LANG: "C",
    LC_ALL: "C",
    OPENAI_API_KEY: "transport-secret-canary",
    SSH_AUTH_SOCK: fixture.transportSocket,
    TRANSPORT_SECRET_CANARY: "must-not-reach-transport",
    ...overrides,
    NODE_ENV: overrides.NODE_ENV ?? "test",
    PATH: fixture.fakePath,
    TMPDIR: fixture.temporaryRoot,
  };
  return environment;
}

async function readStageReleaseEvents(
  fixture: StageReleaseFixture,
): Promise<
  Array<{
    args?: string[];
    command: string;
    count?: number;
    environmentKeys?: string[];
    signal?: string;
  }>
> {
  const contents = await readFile(fixture.eventLog, "utf8").catch(() => "");
  return contents
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      args?: string[];
      command: string;
      count?: number;
      environmentKeys?: string[];
      signal?: string;
    });
}

function stageReleaseFailureContext(
  result: CommandResult,
  fixture: StageReleaseFixture,
  events: Awaited<ReturnType<typeof readStageReleaseEvents>>,
): string {
  const sourceArgument = events.find(({ command }) => command === "rsync")
    ?.args?.at(-2);
  return [
    result.stderr.trimEnd(),
    `stage-fixture-v1:${JSON.stringify({
      expectedSourcePrefix: `${fixture.temporaryRoot}/`,
      sourceArgument: sourceArgument ?? null,
    })}`,
  ].filter(Boolean).join("\n");
}

async function waitForFileContents(
  path: string,
  timeoutMs: number,
  stopped: () => boolean = () => false,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const contents = await readFile(path, "utf8").catch(() => undefined);
    if (contents !== undefined) return contents;
    if (stopped()) throw new Error(`process stopped before creating ${path}`);
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`timed out waiting for ${path}`);
}

function stageProcessIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitForStageProcessExit(
  pid: number,
  timeoutMs = 2_000,
): Promise<void> {
  expect(await stageProcessExited(pid, timeoutMs)).toBe(true);
}

async function stageProcessExited(
  pid: number,
  timeoutMs = 2_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (stageProcessIsRunning(pid) && Date.now() < deadline) {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  return !stageProcessIsRunning(pid);
}

async function readOptionalTestPid(path: string): Promise<number | undefined> {
  const contents = await readFile(path, "utf8").catch(() => undefined);
  if (contents === undefined) return undefined;
  const pid = Number(contents.trim());
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function signalTestProcess(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, signal);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function waitForPromiseSettlement(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolveSettlement) => {
    const timer = setTimeout(() => resolveSettlement(false), timeoutMs);
    void promise.then(
      () => {
        clearTimeout(timer);
        resolveSettlement(true);
      },
      () => {
        clearTimeout(timer);
        resolveSettlement(true);
      },
    );
  });
}

function waitForBoundedPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise((resolveResult, rejectResult) => {
    const timer = setTimeout(
      () => rejectResult(new Error(`timed out waiting for ${label}`)),
      timeoutMs,
    );
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolveResult(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        rejectResult(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function captureFirstVerifyCurlArguments(origin: string): Promise<string[]> {
  const fixture = await mkdtemp(join(tmpdir(), "diesel-verify-curl-args-"));
  const fakeBin = join(fixture, "bin");
  const argumentsPath = join(fixture, "curl-arguments");
  await mkdir(fakeBin);
  await writeExecutable(
    join(fakeBin, "curl"),
    `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$@" >${quoteShell(argumentsPath)}
exit 22
`,
  );

  try {
    await execFileAsync(
      "bash",
      [verifyReleaseScript, origin, TEST_RELEASE_SHA],
      {
        env: {
          ...process.env,
          HOME: fixture,
          PATH: `${fakeBin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        },
      },
    ).catch(() => undefined);
    return (await readFile(argumentsPath, "utf8")).trim().split("\n");
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
}

function createLoadedSystemdUnitMetadata(
  unit: string,
  workspace: string,
  controlGroup: string,
): SystemdUnitMetadata {
  return {
    ActiveState: "active",
    ControlGroup: controlGroup,
    Delegate: "no",
    ExecMainCode: "1",
    ExecMainStatus: "0",
    FinalKillSignal: "9",
    FragmentPath: `/run/systemd/transient/${unit}`,
    Group: "diesel-build",
    KillMode: "control-group",
    KillSignal: "15",
    LoadState: "loaded",
    NoNewPrivileges: "yes",
    ProtectControlGroups: "yes",
    RemainAfterExit: "yes",
    Restart: "no",
    Result: "success",
    RuntimeMaxUSec: "45min",
    SendSIGKILL: "yes",
    Slice: "system.slice",
    SubState: "exited",
    TimeoutStopUSec: "30s",
    Transient: "yes",
    Type: "exec",
    UMask: "0077",
    User: "diesel-build",
    WorkingDirectory: workspace,
  };
}

function renderSystemdUnitMetadata(
  metadata: SystemdUnitMetadata,
  omittedProperty?: SystemdBuildUnitProperty,
): string {
  return `${SYSTEMD_BUILD_UNIT_PROPERTIES.filter(
    (property) => property !== omittedProperty,
  )
    .map((property) => `${property}=${metadata[property]}`)
    .join("\n")}\n`;
}

async function executeSystemdUnitMetadataFixture(
  metadataOutput: string,
  shellBody: string,
  unit: string,
  workspace: string,
  controlGroup: string,
  systemctlStatus = "0",
): Promise<{ args: string[]; command: CommandResult }> {
  const fixture = await mkdtemp(join(tmpdir(), "diesel-systemd-metadata-"));
  const fakeBin = join(fixture, "bin");
  const argsLog = join(fixture, "systemctl.args");
  const outputPath = join(fixture, "systemctl.output");

  try {
    await mkdir(fakeBin);
    await Promise.all([
      writeFile(outputPath, metadataOutput, "utf8"),
      writeExecutable(
        join(fakeBin, "timeout"),
        [
          "#!/bin/bash",
          "set -euo pipefail",
          '[[ "${1:-}" == --foreground ]]',
          '[[ "${2:-}" == --signal=TERM ]]',
          '[[ "${3:-}" == --kill-after=2s ]]',
          '[[ "${4:-}" == 10s ]]',
          "shift 4",
          'exec "$@"',
          "",
        ].join("\n"),
      ),
      writeExecutable(
        join(fakeBin, "systemctl"),
        [
          "#!/bin/bash",
          "set -euo pipefail",
          'printf \'%s\\n\' "$@" >"${PREPARE_TEST_SYSTEMCTL_ARGS:?}"',
          '[[ "$#" -eq 30 ]]',
          '[[ "${1:-}" == show ]]',
          '[[ "${2:-}" == --all ]]',
          '[[ "${3:-}" == --no-pager ]]',
          '[[ "${4:-}" == "${PREPARE_TEST_UNIT:?}" ]]',
          '/bin/cat -- "${PREPARE_TEST_SYSTEMCTL_OUTPUT:?}"',
          'exit "${PREPARE_TEST_SYSTEMCTL_STATUS:-0}"',
          "",
        ].join("\n"),
      ),
    ]);

    let command: CommandResult;
    try {
      const result = await execFileAsync(
        "/bin/bash",
        [
          "-c",
          shellBody,
          "systemd-metadata-fixture",
          prepareReleaseRuntimeScript,
          unit,
          workspace,
          controlGroup,
        ],
        {
          env: {
            ...process.env,
            PATH: `${fakeBin}:/usr/bin:/bin`,
            PREPARE_TEST_SYSTEMCTL_ARGS: argsLog,
            PREPARE_TEST_SYSTEMCTL_OUTPUT: outputPath,
            PREPARE_TEST_SYSTEMCTL_STATUS: systemctlStatus,
            PREPARE_TEST_UNIT: unit,
          },
        },
      );
      command = {
        exitCode: 0,
        stderr: String(result.stderr),
        stdout: String(result.stdout),
      };
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      const commandError = error as Error & {
        code?: unknown;
        stderr?: unknown;
        stdout?: unknown;
      };
      command = {
        exitCode:
          typeof commandError.code === "number" ? commandError.code : -1,
        stderr: String(commandError.stderr ?? ""),
        stdout: String(commandError.stdout ?? ""),
      };
    }

    const args = (await readFile(argsLog, "utf8")).trimEnd().split("\n");
    return { args, command };
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
}

async function executePrepareDatabaseIdentity(
  fixture: Awaited<ReturnType<typeof createPreparePreflightFixture>>,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        'source "$1"; prepare_release_require_stable_database_identity "$2" "$3" "$4" "$5"',
        "prepare-database-identity-fixture",
        prepareReleaseRuntimeScript,
        fixture.nodeBinary,
        fixture.environmentBackup,
        fixture.environmentPath,
        fixture.sharedRoot,
      ],
      {
        env: {
          ...process.env,
          PATH: fixture.fakePath,
        },
      },
    );
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

async function executePreparePersistCandidate(
  fixture: Awaited<ReturnType<typeof createPreparePreflightFixture>>,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<CommandResult> {
  const releaseRoot = dirname(fixture.releaseDir);
  const buildMarker = join(fixture.releaseDir, ".build-complete");
  const readyMarker = join(fixture.releaseDir, ".deploy-ready");
  await Promise.all([
    mkdir(join(fixture.releaseDir, "node_modules"), { recursive: true }),
    mkdir(join(fixture.releaseDir, ".next"), { recursive: true }),
    writeFile(buildMarker, "sealed\n", "utf8"),
    writeFile(readyMarker, "ready\n", "utf8"),
  ]);
  try {
    const result = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        'set -Eeuo pipefail; source "$1"; prepare_release_persist_candidate "$2" "$3" "$4" "$5" "$6" "$7"',
        "prepare-candidate-persistence-fixture",
        prepareReleaseRuntimeScript,
        fixture.nodeBinary,
        fixture.releaseDir,
        releaseRoot,
        fixture.deployRoot,
        buildMarker,
        readyMarker,
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          PATH: fixture.fakePath,
          ...environment,
        },
      },
    );
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

async function executePrepareBeforeBuild(
  fixture: Awaited<ReturnType<typeof createPreparePreflightFixture>>,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        'source "$1"; prepare_release_effective_uid() { printf "0\\n"; }; prepare_release_require_fixed_root_command_boundary() { export PATH="$1"; }; host_activation_ledger_require_pending() { return 0; }; prepare_release_require_transient_build_commands() { return 0; }; prepare_release_require_systemd_host() { printf "systemd-preflight\\n" >>"$PREPARE_TEST_OPERATION_LOG"; return 0; }; prepare_release_require_unit_absent() { return 0; }; prepare_release_control_group_has_processes() { return 1; }; prepare_release_control_group_is_populated() { return 1; }; prepare_release_uid_has_processes() { return 1; }; prepare_release_run_build_unit() { printf "build-start\\n" >>"$PREPARE_TEST_OPERATION_LOG"; return 99; }; prepare_release_runtime "$2" "$3" "$4" "$5" "$6"',
        "prepare-before-build-fixture",
        prepareReleaseRuntimeScript,
        TEST_RELEASE_SHA,
        fixture.deployRoot,
        fixture.fakePath,
        fixture.nodeBinary,
        fixture.root,
      ],
      {
        env: {
          ...process.env,
          PATH: fixture.fakePath,
          PREPARE_TEST_OPERATION_LOG: fixture.operationLog,
          ...environment,
        },
      },
    );
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

type GovernanceCountryPublisherFixture = {
  commitMarker: string;
  deployRoot: string;
  fakePath: string;
  invocationLog: string;
  recoveryMarker: string;
  releaseDir: string;
  root: string;
  snapshotPath: string;
  trapLog: string;
  wrongMarkerModeFlag: string;
};

async function createGovernanceCountryPublisherFixture(): Promise<GovernanceCountryPublisherFixture> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "diesel-governance-country-publisher-")),
  );
  const deployRoot = join(root, "deploy");
  const releasesRoot = join(deployRoot, "releases");
  const releaseDir = join(releasesRoot, TEST_RELEASE_SHA);
  const stateDir = join(deployRoot, "backups", TEST_RELEASE_SHA);
  const snapshotPath = join(stateDir, "governance-before.json");
  const recoveryMarker = join(stateDir, "RECOVERY_REQUIRED");
  const commitMarker = join(stateDir, "PUBLISH_COMMITTED");
  const currentLink = join(deployRoot, "current");
  const ingestScript = join(
    releaseDir,
    "scripts",
    "db",
    "ingest-accepted-fixtures.ts",
  );
  const fakeBin = join(root, "bin");
  const invocationLog = join(root, "corepack-invocations.log");
  const trapLog = join(root, "recovery-traps.log");
  const wrongMarkerModeFlag = join(root, "wrong-marker-mode");
  const snapshot = '{"tableCounts":{},"tables":{}}\n';
  const snapshotSha256 = createHash("sha256").update(snapshot).digest("hex");

  await Promise.all([
    mkdir(dirname(ingestScript), { recursive: true }),
    mkdir(stateDir, { recursive: true }),
    mkdir(fakeBin),
  ]);
  await Promise.all([
    writeFile(ingestScript, "// fixture\n", "utf8"),
    writeFile(snapshotPath, snapshot, "utf8"),
    writeFile(
      recoveryMarker,
      `${snapshotSha256}\t${snapshotPath}\n`,
      "utf8",
    ),
  ]);
  await symlink(releaseDir, currentLink);

  await writeExecutable(
    join(fakeBin, "id"),
    "#!/bin/bash\nprintf '0\\n'\n",
  );
  await writeExecutable(
    join(fakeBin, "stat"),
    `#!/bin/bash
set -euo pipefail
path="\${!#}"
case "$path" in
  ${quoteShell(deployRoot)}) printf '%s\\n' root:root:755 ;;
  ${quoteShell(releasesRoot)}) printf '%s\\n' root:root:755 ;;
  ${quoteShell(releaseDir)}) printf '%s\\n' root:diesel:750 ;;
  ${quoteShell(recoveryMarker)})
    if [[ -f ${quoteShell(wrongMarkerModeFlag)} ]]; then
      printf '%s\\n' root:root:644
    else
      printf '%s\\n' root:root:600
    fi
    ;;
  ${quoteShell(snapshotPath)}) printf '%s\\n' root:root:600 ;;
  *) echo "unexpected stat target: $path" >&2; exit 98 ;;
esac
`,
  );
  await writeExecutable(
    join(fakeBin, "corepack"),
    `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >>${quoteShell(invocationLog)}
country_argument="\${!#}"
if [[ -n "\${GOVERNANCE_TEST_FAIL_COUNTRY:-}" ]] &&
   [[ "$country_argument" == "--country=\${GOVERNANCE_TEST_FAIL_COUNTRY}" ]]; then
  exit 23
fi
`,
  );

  return {
    commitMarker,
    deployRoot,
    fakePath: `${fakeBin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    invocationLog,
    recoveryMarker,
    releaseDir,
    root,
    snapshotPath,
    trapLog,
    wrongMarkerModeFlag,
  };
}

async function executeGovernanceCountryPublisher(
  fixture: GovernanceCountryPublisherFixture,
  options?: {
    cwd?: string;
    environment?: Readonly<Record<string, string | undefined>>;
    releaseId?: string;
  },
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        `set -Eeuo pipefail
restore_governance_on_failure() {
  restore_status="\${1:-1}"
  trap - ERR INT TERM HUP EXIT
  printf '%s\\n' "$restore_status" >>"$GOVERNANCE_TEST_TRAP_LOG"
  exit "$restore_status"
}
trap 'restore_governance_on_failure "$?"' ERR
trap 'restore_governance_on_failure 130' INT
if [[ "\${GOVERNANCE_TEST_OMIT_TERM_TRAP:-0}" != '1' ]]; then
  trap 'restore_governance_on_failure 143' TERM
fi
trap 'restore_governance_on_failure 129' HUP
trap 'restore_governance_on_failure "$?"' EXIT
trap -p ERR INT TERM HUP EXIT >"$GOVERNANCE_TEST_TRAPS_BEFORE"
source "$1"
publish_governance_country_fixtures_for_root "$2" "$3"
trap -p ERR INT TERM HUP EXIT >"$GOVERNANCE_TEST_TRAPS_AFTER"
cmp "$GOVERNANCE_TEST_TRAPS_BEFORE" "$GOVERNANCE_TEST_TRAPS_AFTER"
trap - ERR INT TERM HUP EXIT
`,
        "governance-country-publisher-fixture",
        governanceCountryFixturePublisherScript,
        options?.releaseId ?? TEST_RELEASE_SHA,
        fixture.deployRoot,
      ],
      {
        cwd: options?.cwd ?? fixture.releaseDir,
        env: {
          ...process.env,
          DATABASE_MODE: "postgres",
          DIESEL_GOVERNANCE_MAINTENANCE_TOKEN: "b".repeat(64),
          GOVERNANCE_TEST_TRAPS_AFTER: join(fixture.root, "traps-after"),
          GOVERNANCE_TEST_TRAPS_BEFORE: join(fixture.root, "traps-before"),
          GOVERNANCE_TEST_TRAP_LOG: fixture.trapLog,
          NODE_ENV: "production",
          PATH: fixture.fakePath,
          release_id: TEST_RELEASE_SHA,
          ...options?.environment,
        },
      },
    );
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

async function createRollbackFixture(options?: {
  current?: "failed" | "previous" | "unexpected";
  pm2Version?: "absent" | "failed-release" | "previous-release";
  releaseId?: string;
}): Promise<RollbackFixture> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "diesel-host-rollback-")),
  );
  // Shared temporary directories can assign a host-specific group (for
  // example wheel on Darwin). The fixture models one deterministic runtime
  // identity, so normalize its root before descendants inherit ownership.
  await chown(
    root,
    Number(TEST_PROCESS_UID),
    Number(TEST_PROCESS_GID),
  );
  const deployRoot = join(root, "deploy");
  const releasesRoot = join(deployRoot, "releases");
  const releaseId = options?.releaseId ?? "failed-release";
  const failedRelease = join(releasesRoot, releaseId);
  const previousRelease = join(releasesRoot, "previous-release");
  const unexpectedRelease = join(releasesRoot, "unexpected-release");
  const stateDir = join(deployRoot, "backups", releaseId);
  const sharedRoot = join(deployRoot, "shared");
  const environmentPath = join(sharedRoot, ".env.production.local");
  const nginxSitesRoot = join(root, "nginx-sites");
  const nginxPrimaryPath = join(nginxSitesRoot, "jamesky.site");
  const nginxAlternatePath = join(nginxSitesRoot, "diesel-demo");
  const currentLink = join(deployRoot, "current");
  const fakeBin = join(root, "fake-bin");
  const fakePath = `${fakeBin}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  const pm2UnitPath = `${fakePath}:/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin`;
  const lifecycleLock = join(deployRoot, ".release-lifecycle.lock");
  const lifecycleLog = join(root, "lifecycle.log");
  const mutationLog = join(root, "mutations.log");
  const nodeBinary = join(fakeBin, "node");
  const pm2State = join(root, "pm2-state");
  const pm2Home = join(root, "pm2-home");
  const pm2Exec = join(root, "pm2-runtime", "pm2");
  const procRoot = join(root, "proc");
  const procProcessRoot = join(procRoot, "321");
  const pm2DaemonProcRoot = join(procRoot, "111");
  const systemdUnitPathRoot = join(root, "systemd-unit-paths");
  const systemdUnitRoot = join(systemdUnitPathRoot, "etc-systemd-system");
  const systemdSecondaryUnitRoot = join(
    systemdUnitPathRoot,
    "usr-lib-systemd-system",
  );
  const systemdAbsentUnitRoot = join(
    systemdUnitPathRoot,
    "run-systemd-generator-late",
  );
  const pm2UnitFragment = join(systemdUnitRoot, "pm2-root.service");
  const pm2EnablementRoot = join(systemdUnitRoot, "multi-user.target.wants");
  const pm2EnablementLink = join(pm2EnablementRoot, "pm2-root.service");
  const pm2StateHelper = join(
    failedRelease,
    "scripts",
    "deploy",
    "persist-pm2-release-state.mjs",
  );
  const releaseArtifactManifest = join(
    failedRelease,
    "scripts",
    "deploy",
    "release-artifact-manifest.mjs",
  );
  const readinessResponseContract = join(
    failedRelease,
    "scripts",
    "deploy",
    "readiness-response-contract.cjs",
  );
  const hostActivationLedger = join(
    failedRelease,
    "scripts",
    "deploy",
    "host-activation-ledger.sh",
  );

  await Promise.all([
    mkdir(join(previousRelease, "deploy"), { recursive: true }),
    mkdir(join(previousRelease, "node_modules", "next"), { recursive: true }),
    mkdir(join(previousRelease, "scripts", "deploy"), { recursive: true }),
    mkdir(join(failedRelease, "node_modules", "next"), { recursive: true }),
    mkdir(join(failedRelease, "scripts", "deploy"), { recursive: true }),
    mkdir(unexpectedRelease, { recursive: true }),
    mkdir(stateDir, { recursive: true }),
    mkdir(sharedRoot, { recursive: true }),
    mkdir(nginxSitesRoot, { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
    mkdir(pm2Home, { recursive: true }),
    mkdir(join(root, "pm2-runtime"), { recursive: true }),
    mkdir(procProcessRoot, { recursive: true }),
    mkdir(pm2DaemonProcRoot, { recursive: true }),
    mkdir(systemdSecondaryUnitRoot, { recursive: true }),
    mkdir(pm2EnablementRoot, { recursive: true }),
  ]);
  await Promise.all([
    chmod(deployRoot, 0o755),
    chmod(releasesRoot, 0o755),
    chmod(join(deployRoot, "backups"), 0o700),
    chmod(stateDir, 0o700),
    chmod(sharedRoot, 0o750),
    chmod(nginxSitesRoot, 0o755),
    chmod(pm2Home, 0o700),
    chmod(systemdUnitPathRoot, 0o755),
    chmod(systemdUnitRoot, 0o755),
    chmod(systemdSecondaryUnitRoot, 0o755),
    chmod(pm2EnablementRoot, 0o755),
  ]);

  const stateFiles = new Map<string, string>([
    [join(stateDir, "previous-release"), `${previousRelease}\n`],
    [join(stateDir, "env.production.local.pre-switch"), "OLD_ENV=1\n"],
    [join(stateDir, "jamesky.site.pre-switch"), "old primary nginx\n"],
    [join(stateDir, "diesel-demo.pre-switch"), "old alternate nginx\n"],
  ]);
  await Promise.all(
    [...stateFiles].map(async ([path, contents]) => {
      await writeFile(path, contents, "utf8");
      await chmod(path, 0o600);
    }),
  );
  await Promise.all([
    writeFile(join(previousRelease, ".deploy-ready"), "ready\n", "utf8"),
    writeFile(
      join(previousRelease, "node_modules", "next", "package.json"),
      '{"name":"next","version":"16.2.12"}\n',
      "utf8",
    ),
    writeFile(
      join(failedRelease, "node_modules", "next", "package.json"),
      '{"name":"next","version":"16.2.12"}\n',
      "utf8",
    ),
    writeFile(
      join(previousRelease, "deploy", "ecosystem.config.cjs"),
      "module.exports = {};\n",
      "utf8",
    ),
    writeFile(environmentPath, "NEW_ENV=1\n", "utf8"),
    writeFile(nginxPrimaryPath, "new primary nginx\n", "utf8"),
    writeFile(nginxAlternatePath, "new alternate nginx\n", "utf8"),
    writeFile(lifecycleLock, "", "utf8"),
    writeFile(pm2StateHelper, "export {};\n", "utf8"),
    writeFile(releaseArtifactManifest, "export {};\n", "utf8"),
    copyFile(readinessResponseContractScript, readinessResponseContract),
    writeFile(hostActivationLedger, "#!/bin/bash\n", "utf8"),
    writeFile(join(pm2Home, "pm2.pid"), "111", "utf8"),
    writeFile(
      pm2UnitFragment,
      expectedPm2SystemdUnit(pm2Home, pm2Exec, fakePath),
      "utf8",
    ),
  ]);
  await Promise.all([
    chmod(environmentPath, 0o640),
    chmod(lifecycleLock, 0o600),
    chmod(nginxPrimaryPath, 0o644),
    chmod(nginxAlternatePath, 0o644),
    chmod(pm2StateHelper, 0o640),
    chmod(releaseArtifactManifest, 0o640),
    chmod(readinessResponseContract, 0o640),
    chmod(hostActivationLedger, 0o750),
    chmod(pm2UnitFragment, 0o644),
  ]);
  await symlink(pm2UnitFragment, pm2EnablementLink, "file");

  const quotedMutationLog = quoteShell(mutationLog);
  const quotedLifecycleLog = quoteShell(lifecycleLog);
  const fixtureSystemdUnitPaths = [
    systemdUnitRoot,
    systemdSecondaryUnitRoot,
    systemdAbsentUnitRoot,
  ];
  const fixtureSystemdManagerUnitPath = [
    systemdUnitRoot,
    systemdSecondaryUnitRoot,
  ].join(" ");
  const fixturePm2Args = JSON.stringify(
    expectedPm2Args("__APP_VERSION__", deployRoot, fakePath, nodeBinary),
  );
  const driftedFixturePm2Args = JSON.stringify([
    ...expectedPm2Args("__APP_VERSION__", deployRoot, fakePath, nodeBinary),
    "--inspect",
  ]);
  const durablePm2Dump = JSON.stringify([
    durablePm2Application("__APP_VERSION__"),
  ]);
  const durablePm2DumpWithCwdDrift = JSON.stringify([
    durablePm2Application("__APP_VERSION__", {
      pm_cwd: "/opt/diesel/releases/unrelated-release",
    }),
  ]);
  const durablePm2DumpWithExecPathDrift = JSON.stringify([
    durablePm2Application("__APP_VERSION__", {
      pm_exec_path: PRODUCTION_NODE_BINARY,
    }),
  ]);
  const durablePm2DumpWithInterpreterDrift = JSON.stringify([
    durablePm2Application("__APP_VERSION__", {
      exec_interpreter: PRODUCTION_NODE_BINARY,
    }),
  ]);
  const durablePm2DumpWithArgsDrift = JSON.stringify([
    durablePm2Application("__APP_VERSION__", {
      args: [...expectedProductionPm2Args("__APP_VERSION__"), "--inspect"],
    }),
  ]);
  const durablePm2DumpWithUidDrift = JSON.stringify([
    durablePm2Application("__APP_VERSION__", { uid: 0 }),
  ]);
  const durablePm2DumpWithGidDrift = JSON.stringify([
    durablePm2Application("__APP_VERSION__", { gid: 0 }),
  ]);
  const durablePm2ValidationHarness = `
    import { validatePm2DumpDocument } from ${JSON.stringify(
      pathToFileURL(persistPm2ReleaseStateScript).href,
    )};
    try {
      validatePm2DumpDocument(
        JSON.parse(process.argv[2]),
        process.argv[1],
        process.argv[3],
        process.argv[4],
      );
    } catch {
      process.exitCode = 70;
    }
  `;
  const verifier = join(
    previousRelease,
    "scripts",
    "deploy",
    "verify-release.sh",
  );
  await writeExecutable(
    pm2Exec,
    "#!/bin/bash\nexit 0\n",
  );
  await writeExecutable(
    verifier,
    `#!/bin/bash
set -euo pipefail
printf 'verify:%s:%s\\n' "$1" "$2" >>${quotedMutationLog}
printf 'verify:%s:%s\\n' "$1" "$2" >>${quotedLifecycleLog}
if [[ -f ${quoteShell(join(root, "inject-publication-marker-at-verifier"))} ]]; then
  marker_name="$(<${quoteShell(join(root, "inject-publication-marker-at-verifier"))})"
  case "$marker_name" in
    PUBLISH_COMMITTED|PUBLISH_FINALIZED|RECOVERY_REQUIRED) ;;
    *) exit 88 ;;
  esac
  printf 'injected\\n' >${quoteShell(stateDir)}/"$marker_name"
  /bin/chmod 600 ${quoteShell(stateDir)}/"$marker_name"
  printf 'inject:%s\\n' "$marker_name" >>${quotedLifecycleLog}
  /bin/rm -f ${quoteShell(join(root, "inject-publication-marker-at-verifier"))}
fi
if [[ -f ${quoteShell(join(root, "fail-verifier-once"))} ]]; then
  /bin/rm -f ${quoteShell(join(root, "fail-verifier-once"))}
  exit 91
fi
`,
  );
  await writeExecutable(
    join(failedRelease, "scripts", "deploy", "verify-release.sh"),
    `#!/bin/bash
printf 'failed-verifier\\n' >>${quotedMutationLog}
exit 97
`,
  );

  await writeExecutable(
    join(fakeBin, "stat"),
    `#!/bin/bash
set -euo pipefail
path="\${!#}"
format="\${2:-}"
# Read fresh metadata in one native call (plus the existing BSD fallback).
# Do not cache: later contract steps deliberately mutate the same paths.
if metadata="$(/usr/bin/stat -c '%a:%h:%s' -- "$path" 2>/dev/null)"; then
  :
else
  metadata="$(/usr/bin/stat -f '%Lp:%l:%z' -- "$path")"
fi
IFS=: read -r mode link_count size <<< "$metadata"
fixture_root=${quoteShell(root)}
if [[ "$path" == '/' ]] ||
  { [[ "$path" != "$fixture_root" ]] &&
    [[ "$fixture_root" == "$path/"* ]]; }; then
  # The production validator must see a deterministic root-owned host path,
  # not permissions inherited from the machine running this fixture.
  mode='755'
fi
case "$path" in
  ${quoteShell(sharedRoot)}|${quoteShell(`${sharedRoot}/`)}*) owner='root:diesel' ;;
  *) owner='root:root' ;;
esac
if [[ -f ${quoteShell(join(root, "untrusted-owner-path"))} ]] &&
  [[ "$(<${quoteShell(join(root, "untrusted-owner-path"))})" == "$path" ]]; then
  owner='diesel:diesel'
fi
if [[ -f ${quoteShell(join(root, "untrusted-mode-path"))} ]] &&
  [[ "$(<${quoteShell(join(root, "untrusted-mode-path"))})" == "$path" ]]; then
  mode='777'
fi
case "$format" in
  '%h') printf '%s\\n' "$link_count" ;;
  '%s') printf '%s\\n' "$size" ;;
  '%U:%G:%h:%s') printf '%s:%s:%s\\n' "$owner" "$link_count" "$size" ;;
  *) printf '%s:%s\\n' "$owner" "$mode" ;;
esac
`,
  );
  await writeExecutable(
    join(fakeBin, "id"),
    `#!/bin/bash
set -euo pipefail
if [[ "$#" -eq 1 && "$1" == '-u' ]]; then
  printf '0\\n'
elif [[ "$#" -eq 2 && "$1" == '-u' && "$2" == 'diesel' ]]; then
  printf '1001\\n'
elif [[ "$#" -eq 2 && "$1" == '-g' && "$2" == 'diesel' ]]; then
  printf '1001\\n'
else
  exit 64
fi
`,
  );
  await writeExecutable(
    join(fakeBin, "flock"),
    `#!/bin/bash
set -euo pipefail
printf 'flock:%s\\n' "$*" >>${quotedLifecycleLog}
if [[ -f ${quoteShell(join(root, "flock-fail"))} ]]; then
  exit 89
fi
`,
  );
  await writeExecutable(
    nodeBinary,
    `#!/bin/bash
set -euo pipefail
if [[ -f ${quoteShell(join(root, "enforce-activation-fd-boundary"))} ]] &&
  { true <&8; } 2>/dev/null; then
  printf 'fd8-leaked:node\n' >>${quotedLifecycleLog}
  exit 98
fi
if [[ "\${1:-}" == ${quoteShell(releaseArtifactManifest)} ]]; then
  printf 'check-ready:%s\n' "\${3:-}" >>${quotedLifecycleLog}
  if [[ -f ${quoteShell(join(root, "activation-check-ready-fail"))} ]]; then
    exit 95
  fi
  [[ "\${2:-}" == 'check-ready' && "\${3:-}" == ${quoteShell(releaseId)} ]]
  exit 0
fi
if [[ "\${1:-}" == ${quoteShell(pm2StateHelper)} ]]; then
  printf 'pm2-helper:%s\\n' "\${2:-}" >>${quotedLifecycleLog}
  if [[ -f ${quoteShell(join(root, "pm2-helper-fail"))} ]]; then
    exit 92
  fi
  dump_document=${quoteShell(durablePm2Dump)}
  if [[ -f ${quoteShell(join(root, "pm2-dump-cwd-drift"))} ]]; then
    dump_document=${quoteShell(durablePm2DumpWithCwdDrift)}
  elif [[ -f ${quoteShell(join(root, "pm2-dump-exec-path-drift"))} ]]; then
    dump_document=${quoteShell(durablePm2DumpWithExecPathDrift)}
  elif [[ -f ${quoteShell(join(root, "pm2-dump-interpreter-drift"))} ]]; then
    dump_document=${quoteShell(durablePm2DumpWithInterpreterDrift)}
  elif [[ -f ${quoteShell(join(root, "pm2-dump-args-drift"))} ]]; then
    dump_document=${quoteShell(durablePm2DumpWithArgsDrift)}
  elif [[ -f ${quoteShell(join(root, "pm2-dump-uid-drift"))} ]]; then
    dump_document=${quoteShell(durablePm2DumpWithUidDrift)}
  elif [[ -f ${quoteShell(join(root, "pm2-dump-gid-drift"))} ]]; then
    dump_document=${quoteShell(durablePm2DumpWithGidDrift)}
  fi
  dump_document="\${dump_document//__APP_VERSION__/\${2:-}}"
  exec ${quoteShell(process.execPath)} \
    --input-type=module \
    --eval ${quoteShell(durablePm2ValidationHarness)} \
    "\${2:-}" "$dump_document" "\${3:-}" "\${4:-}"
fi
if [[ "\${1:-}" == '-e' && "\${2:-}" == *'fsyncSync'* ]]; then
  final_marker_fsync=0
  for path in "\${@:4}"; do
    printf 'fsync:%s\\n' "$path" >>${quotedLifecycleLog}
    if [[ "$path" == ${quoteShell(stateDir)} ]]; then
      final_marker_fsync=1
    fi
  done
  if [[ -f ${quoteShell(join(root, "fsync-fail"))} ]]; then
    exit 90
  fi
  if [[ "$final_marker_fsync" -eq 1 && -f ${quoteShell(join(root, "final-marker-fsync-fail"))} ]]; then
    exit 90
  fi
fi
exec ${quoteShell(process.execPath)} "$@"
`,
  );
  await writeExecutable(
    join(fakeBin, "realpath"),
    `#!/bin/bash
set -euo pipefail
path="\${!#}"
if [[ "$path" == /proc/*/fd/8 ]]; then
  printf '%s\n' ${quoteShell(lifecycleLock)}
else
  exec /bin/realpath "$@"
fi
`,
  );
  await writeExecutable(
    join(fakeBin, "curl"),
    `#!/bin/bash
set -euo pipefail
if [[ -f ${quoteShell(join(root, "enforce-activation-fd-boundary"))} ]] &&
  { true <&8; } 2>/dev/null; then
  printf 'fd8-leaked:curl\n' >>${quotedLifecycleLog}
  exit 98
fi
printf 'curl-ready:%s\n' "$*" >>${quotedLifecycleLog}
headers_path=''
previous=''
for argument in "$@"; do
  if [[ "$previous" == '--dump-header' ]]; then
    headers_path="$argument"
    break
  fi
  previous="$argument"
done
[[ -n "$headers_path" ]]
cache_control='private, no-store, max-age=0'
if [[ -f ${quoteShell(join(root, "activation-health-cacheable"))} ]]; then
  cache_control='public, max-age=60'
fi
printf 'HTTP/1.1 200 OK\r\nCache-Control: %s\r\nPragma: no-cache\r\n\r\n' \
  "$cache_control" >"$headers_path"
timestamp="$(${quoteShell(process.execPath)} -e 'process.stdout.write(new Date().toISOString())')"
if [[ -f ${quoteShell(join(root, "activation-health-stale-timestamp"))} ]]; then
  timestamp="$(${quoteShell(process.execPath)} -e 'process.stdout.write(new Date(Date.now() - 60000).toISOString())')"
fi
if [[ -f ${quoteShell(join(root, "activation-health-fail"))} ]]; then
  printf '{"checks":{"aiChatAdmission":"error","aiChatRateLimit":"error","database":"error"},"service":"global-diesel-regulations","status":"error","timestamp":"%s","version":"wrong"}\n' "$timestamp"
elif [[ -f ${quoteShell(join(root, "activation-health-extra-field"))} ]]; then
  printf '{"checks":{"aiChatAdmission":"ok","aiChatRateLimit":"ok","database":"ok"},"service":"global-diesel-regulations","status":"ok","timestamp":"%s","version":"%s","unexpected":true}\n' "$timestamp" ${quoteShell(releaseId)}
elif [[ -f ${quoteShell(join(root, "activation-health-missing-timestamp"))} ]]; then
  printf '{"checks":{"aiChatAdmission":"ok","aiChatRateLimit":"ok","database":"ok"},"service":"global-diesel-regulations","status":"ok","version":"%s"}\n' ${quoteShell(releaseId)}
else
  printf '{"checks":{"aiChatAdmission":"ok","aiChatRateLimit":"ok","database":"ok"},"service":"global-diesel-regulations","status":"ok","timestamp":"%s","version":"%s"}\n' "$timestamp" ${quoteShell(releaseId)}
fi
`,
  );
  await writeExecutable(
    join(fakeBin, "ps"),
    `#!/bin/bash
set -euo pipefail
[[ "$#" -eq 4 && "$1" == '-o' && "$3" == '-p' && "$4" == '321' ]]
case "$2" in
  uid=)
    printf 'ps-uid:321\\n' >>${quotedLifecycleLog}
    if [[ -f ${quoteShell(join(root, "pm2-wrong-uid"))} ]]; then
      printf '1002\\n'
    else
      printf '1001\\n'
    fi
    ;;
  gid=)
    printf 'ps-gid:321\\n' >>${quotedLifecycleLog}
    if [[ -f ${quoteShell(join(root, "pm2-wrong-gid"))} ]]; then
      printf '1002\\n'
    else
      printf '1001\\n'
    fi
    ;;
  *) exit 64 ;;
esac
`,
  );
  await writeExecutable(
    join(fakeBin, "install"),
    `#!/bin/bash
set -euo pipefail
mode=''
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -m) mode="$2"; shift 2 ;;
    -o|-g) shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[[ -n "$mode" && "$#" -eq 2 ]]
/bin/cp "$1" "$2"
/bin/chmod "$mode" "$2"
printf 'install:%s\\n' "$2" >>${quotedMutationLog}
`,
  );
  await writeExecutable(
    join(fakeBin, "mv"),
    `#!/bin/bash
set -euo pipefail
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -*) shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[[ "$#" -eq 2 ]]
if [[ "$1" == ${quoteShell(join(stateDir, "HOST_ROLLBACK_REQUIRED"))} ||
  "$2" == ${quoteShell(join(stateDir, "HOST_ROLLBACK_COMPLETED"))} ]]; then
  printf 'transition:%s:%s\\n' "$1" "$2" >>${quotedLifecycleLog}
  if [[ -f ${quoteShell(join(root, "host-marker-transition-fail"))} ]]; then
    exit 87
  fi
fi
if [[ "$2" == ${quoteShell(currentLink)} ]]; then
  if [[ -f ${quoteShell(join(root, "activation-current-switch-fail"))} ]]; then
    printf 'current-switch-fail-before-rename\\n' >>${quotedLifecycleLog}
    exit 96
  fi
  printf 'current-switch\\n' >>${quotedLifecycleLog}
fi
if [[ "$2" == ${quoteShell(nginxPrimaryPath)} ||
  "$2" == ${quoteShell(nginxAlternatePath)} ]]; then
  printf 'live-nginx-rename:%s\\n' "$2" >>${quotedLifecycleLog}
fi
if [[ -f ${quoteShell(join(root, "mv-fail-pre-attempt-restore-once"))} ]] &&
  [[ "$1" == *'.pre-attempt-restore.'* ]]; then
  /bin/rm -f ${quoteShell(join(root, "mv-fail-pre-attempt-restore-once"))}
  exit 94
fi
${quoteShell(process.execPath)} -e \
  'require("node:fs").renameSync(process.argv[1], process.argv[2])' \
  "$1" "$2"
`,
  );
  await writeExecutable(
    join(fakeBin, "pm2"),
    `#!/bin/bash
set -euo pipefail
if [[ -f ${quoteShell(join(root, "enforce-activation-fd-boundary"))} ]] &&
  { true <&8; } 2>/dev/null; then
  printf 'fd8-leaked:pm2\n' >>${quotedLifecycleLog}
  exit 98
fi
state=${quoteShell(pm2State)}
log=${quotedMutationLog}
invalid_jlist=${quoteShell(join(root, "pm2-invalid-jlist"))}
describe_failure=${quoteShell(join(root, "pm2-describe-failure"))}
duplicate_process=${quoteShell(join(root, "pm2-duplicate-process"))}
offline_process=${quoteShell(join(root, "pm2-offline-process"))}
wrong_start_version=${quoteShell(join(root, "pm2-start-wrong-version"))}
live_cwd_drift=${quoteShell(join(root, "pm2-live-cwd-drift"))}
live_exec_path_drift=${quoteShell(join(root, "pm2-live-exec-path-drift"))}
live_interpreter_drift=${quoteShell(join(root, "pm2-live-interpreter-drift"))}
live_args_drift=${quoteShell(join(root, "pm2-live-args-drift"))}
live_env_version_drift=${quoteShell(join(root, "pm2-live-env-version-drift"))}
live_name_drift=${quoteShell(join(root, "pm2-live-name-drift"))}
live_uid_drift=${quoteShell(join(root, "pm2-live-uid-drift"))}
live_gid_drift=${quoteShell(join(root, "pm2-live-gid-drift"))}
publication_marker_injection=${quoteShell(join(root, "inject-publication-marker"))}
state_dir=${quoteShell(stateDir)}
lifecycle_log=${quotedLifecycleLog}
current_link=${quoteShell(currentLink)}
proc_cwd=${quoteShell(join(procProcessRoot, "cwd"))}
proc_exe=${quoteShell(join(procProcessRoot, "exe"))}
proc_cmdline=${quoteShell(join(procProcessRoot, "cmdline"))}
startup_count=${quoteShell(join(root, "pm2-startup-count"))}
case "\${1:-}" in
  jlist)
    if [[ -f "$startup_count" ]]; then
      count="$(<"$startup_count")"
      count="$((count + 1))"
      printf '%s' "$count" >"$startup_count"
      if [[ "$count" -ge 3 && ! -f ${quoteShell(join(root, "pm2-start-never-ready"))} ]]; then
        printf 'next-server (v16.2.12)\\0' >"$proc_cmdline"
      fi
    fi
    if [[ -f "$publication_marker_injection" ]]; then
      marker_name="$(<"$publication_marker_injection")"
      case "$marker_name" in
        PUBLISH_COMMITTED|PUBLISH_FINALIZED|RECOVERY_REQUIRED) ;;
        *) exit 88 ;;
      esac
      printf 'injected\\n' >"$state_dir/$marker_name"
      /bin/chmod 600 "$state_dir/$marker_name"
      printf 'inject:%s\\n' "$marker_name" >>"$lifecycle_log"
      /bin/rm -f "$publication_marker_injection"
    fi
    version=''
    if [[ -f "$state" ]]; then
      version="$(<"$state")"
    fi
    pm_cwd=${quoteShell(currentLink)}
    pm_exec_path=${quoteShell(PRODUCTION_PM2_EXEC_PATH)}
    exec_interpreter=${quoteShell(PRODUCTION_PM2_INTERPRETER)}
    pm2_name='diesel-demo'
    nested_version="$version"
    configured_uid=1001
    configured_gid=1001
    args_json=${quoteShell(fixturePm2Args)}
    args_json="\${args_json/__APP_VERSION__/$version}"
    if [[ -f "$live_cwd_drift" ]]; then
      pm_cwd=${quoteShell(unexpectedRelease)}
    fi
    if [[ -f "$live_exec_path_drift" ]]; then
      pm_exec_path=${quoteShell(nodeBinary)}
    fi
    if [[ -f "$live_interpreter_drift" ]]; then
      exec_interpreter=${quoteShell(nodeBinary)}
    fi
    if [[ -f "$live_args_drift" ]]; then
      args_json=${quoteShell(driftedFixturePm2Args)}
      args_json="\${args_json/__APP_VERSION__/$version}"
    fi
    if [[ -f "$live_env_version_drift" ]]; then
      nested_version='conflicting-release'
    fi
    if [[ -f "$live_name_drift" ]]; then
      pm2_name='conflicting-app'
    fi
    if [[ -f "$live_uid_drift" ]]; then
      configured_uid=0
    fi
    if [[ -f "$live_gid_drift" ]]; then
      configured_gid=0
    fi
    identity_json="$(printf '{\"name\":\"%s\",\"status\":\"online\",\"APP_VERSION\":\"%s\",\"env\":{\"APP_VERSION\":\"%s\"},\"pm_cwd\":\"%s\",\"pm_exec_path\":\"%s\",\"exec_interpreter\":\"%s\",\"args\":%s,\"exec_mode\":\"fork_mode\",\"node_args\":[],\"autorestart\":true,\"max_memory_restart\":1073741824,\"uid\":%s,\"gid\":%s}' "$pm2_name" "$version" "$nested_version" "$pm_cwd" "$pm_exec_path" "$exec_interpreter" "$args_json" "$configured_uid" "$configured_gid")"
    if [[ -f "$invalid_jlist" ]]; then
      printf '{invalid-json\\n'
    elif [[ -f "$duplicate_process" ]]; then
      printf '[{"name":"diesel-demo","pid":321,"pm2_env":%s},{"name":"diesel-demo","pid":322,"pm2_env":%s}]\\n' "$identity_json" "$identity_json"
    elif [[ -f "$offline_process" ]]; then
      offline_identity="\${identity_json/\"status\":\"online\"/\"status\":\"stopped\"}"
      printf '[{"name":"diesel-demo","pid":321,"pm2_env":%s}]\\n' "$offline_identity"
    elif [[ -f "$startup_count" && -f ${quoteShell(join(root, "pm2-start-pid-change"))} && "$count" -ge 2 ]]; then
      printf '[{"name":"diesel-demo","pid":322,"pm2_env":%s}]\\n' "$identity_json"
    elif [[ -f "$state" ]]; then
      printf '[{"name":"diesel-demo","pid":321,"pm2_env":%s}]\\n' "$identity_json"
    else
      printf '[]\\n'
    fi
    ;;
  describe)
    if [[ -f "$describe_failure" ]]; then
      exit 86
    fi
    [[ -f "$state" ]]
    ;;
  delete)
    printf 'pm2-delete:%s\\n' "$2" >>"$log"
    printf 'pm2-delete:%s\\n' "$2" >>"$lifecycle_log"
    /bin/rm -f "$state" "$duplicate_process" "$offline_process"
    ;;
  start)
    if [[ -n "\${ACTIVATION_SECRET_CANARY:-}" ]]; then
      printf 'secret-leaked\n' >>"$log"
    fi
    if [[ -f "$wrong_start_version" ]]; then
      printf 'wrong-release' >"$state"
    else
      printf '%s' "\${APP_VERSION:?}" >"$state"
    fi
    /bin/rm -f "$proc_cwd"
    current_target="$(${quoteShell(process.execPath)} -e \
      'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' \
      "$current_link")"
    /bin/ln -s "$current_target" "$proc_cwd"
    /bin/rm -f "$proc_exe"
    /bin/ln -s ${quoteShell(nodeBinary)} "$proc_exe"
    printf 'next-server (v16.2.12)\\0' >"$proc_cmdline"
    if [[ -f ${quoteShell(join(root, "pm2-start-delayed"))} ]]; then
      printf '0' >"$startup_count"
      ${quoteShell(process.execPath)} -e 'require("node:fs").writeFileSync(process.argv[1], Buffer.from([process.argv[2], "--env-file=.env.production.local", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "8788", ""].join("\\0")))' "$proc_cmdline" ${quoteShell(nodeBinary)}
    fi
    if [[ -f ${quoteShell(join(root, "pm2-start-unknown-title"))} ]]; then
      printf 'unknown-process\\0' >"$proc_cmdline"
    fi
    printf 'pm2-start:%s:%s\\n' "$APP_VERSION" "$2" >>"$log"
    printf 'pm2-start:%s:%s\\n' "$APP_VERSION" "$2" >>"$lifecycle_log"
    ;;
  save)
    printf 'pm2-save\\n' >>"$log"
    printf 'pm2-save\\n' >>"$lifecycle_log"
    ;;
  *) exit 64 ;;
esac
`,
  );
  await writeExecutable(
    join(fakeBin, "rm"),
    `#!/bin/bash
set -euo pipefail
for path in "$@"; do
  if [[ "$path" == ${quoteShell(join(deployRoot, "current.next"))} ]]; then
    printf 'delete-current-next\\n' >>${quotedLifecycleLog}
  fi
  if [[ "$path" == ${quoteShell(join(stateDir, "HOST_ROLLBACK_REQUIRED"))} ]]; then
    printf 'delete:%s\\n' "$path" >>${quotedLifecycleLog}
    if [[ -f ${quoteShell(join(root, "host-marker-delete-fail"))} ]]; then
      exit 87
    fi
  fi
done
exec /bin/rm "$@"
`,
  );
  await writeExecutable(
    join(fakeBin, "runuser"),
    `#!/bin/bash
set -euo pipefail
[[ "\${1:-}" == '-u' && "\${2:-}" == 'diesel' && "\${3:-}" == '--' ]]
shift 3
exec "$@"
`,
  );
  await writeExecutable(
    join(fakeBin, "nginx"),
    `#!/bin/bash
set -euo pipefail
if [[ -f ${quoteShell(join(root, "enforce-activation-fd-boundary"))} ]] &&
  { true <&8; } 2>/dev/null; then
  printf 'fd8-leaked:nginx\n' >>${quotedLifecycleLog}
  exit 98
fi
backup_validation=0
if [[ "$#" -eq 3 && "$1" == '-t' && "$2" == '-c' && -f "$3" ]]; then
  backup_validation=1
elif [[ "$#" -ne 1 || "$1" != '-t' ]]; then
  exit 64
fi
if [[ "$backup_validation" -eq 1 ]]; then
  printf 'nginx-offline-test:%s\\n' "$3" >>${quotedLifecycleLog}
fi
if [[ "$backup_validation" -eq 1 && -f ${quoteShell(join(root, "nginx-backup-invalid"))} ]]; then
  exit 94
fi
if [[ "$backup_validation" -eq 1 &&
  -f ${quoteShell(join(root, "activation-live-primary-hardlink-alias"))} ]]; then
  alias_path="$(<${quoteShell(join(root, "activation-live-primary-hardlink-alias"))})"
  /bin/rm -f -- ${quoteShell(nginxPrimaryPath)}
  /bin/ln -- "$alias_path" ${quoteShell(nginxPrimaryPath)}
  printf 'inject-live-nginx-hardlink:%s\\n' "$alias_path" >>${quotedLifecycleLog}
  /bin/rm -f -- ${quoteShell(join(root, "activation-live-primary-hardlink-alias"))}
fi
if [[ "$backup_validation" -eq 0 && -f ${quoteShell(join(root, "nginx-fail-always"))} ]]; then
  exit 93
fi
if [[ "$backup_validation" -eq 0 && -f ${quoteShell(join(root, "nginx-fail-once"))} ]]; then
  /bin/rm -f ${quoteShell(join(root, "nginx-fail-once"))}
  exit 92
fi
if [[ "$backup_validation" -eq 0 ]]; then
  printf 'nginx-test\n' >>${quotedLifecycleLog}
fi
`,
  );
  await writeExecutable(
    join(fakeBin, "systemd-analyze"),
    `#!/bin/bash
set -euo pipefail
printf 'systemd-analyze:%s\\n' "$*" >>${quotedLifecycleLog}
[[ "$#" -eq 2 && "$1" == '--system' && "$2" == 'unit-paths' ]]
counter=${quoteShell(join(root, "systemd-analyze-count"))}
count=0
if [[ -f "$counter" ]]; then
  count="$(<"$counter")"
fi
count="$((count + 1))"
printf '%s' "$count" >"$counter"
printf '%s\\n' \\
  ${fixtureSystemdUnitPaths.map(quoteShell).join(" \\\n  ")}
if [[ "$count" -ge 2 ]] &&
  { [[ -f ${quoteShell(join(root, "systemd-manager-unit-path-drift"))} ]] ||
    [[ -f ${quoteShell(join(root, "systemd-compiled-unit-path-drift"))} ]]; }; then
  printf '%s\\n' '/run/systemd/transient'
fi
`,
  );
  await writeExecutable(
    join(fakeBin, "systemctl"),
    `#!/bin/bash
set -euo pipefail
if [[ -f ${quoteShell(join(root, "enforce-activation-fd-boundary"))} ]] &&
  { true <&8; } 2>/dev/null; then
  printf 'fd8-leaked:systemctl\\n' >>${quotedLifecycleLog}
  exit 98
fi
printf 'systemctl:%s\\n' "$*" >>${quotedLifecycleLog}
if [[ "$#" -eq 3 && "$1" == 'show' &&
  "$2" == '--property=UnitPath' && "$3" == '--property=Environment' ]]; then
  counter=${quoteShell(join(root, "systemd-manager-show-count"))}
  count=0
  if [[ -f "$counter" ]]; then
    count="$(<"$counter")"
  fi
  count="$((count + 1))"
  printf '%s' "$count" >"$counter"
  unit_path=${quoteShell(fixtureSystemdManagerUnitPath)}
  if [[ -f ${quoteShell(join(root, "systemd-manager-includes-absent"))} ]]; then
    unit_path="$unit_path ${systemdAbsentUnitRoot}"
  fi
  if [[ "$count" -ge 2 && -f ${quoteShell(
    join(root, "systemd-manager-unit-path-drift"),
  )} ]]; then
    unit_path="$unit_path /run/systemd/transient"
  fi
  if [[ "$count" -ge 2 && -f ${quoteShell(
    join(root, "systemd-absent-root-appears"),
  )} ]]; then
    /bin/mkdir -p ${quoteShell(systemdAbsentUnitRoot)}
    printf 'unexpected\\n' >${quoteShell(
      join(systemdAbsentUnitRoot, "pm2-root.service"),
    )}
    /bin/chmod 755 ${quoteShell(systemdAbsentUnitRoot)}
    /bin/chmod 644 ${quoteShell(
      join(systemdAbsentUnitRoot, "pm2-root.service"),
    )}
  fi
  printf 'UnitPath=%s\\n' "$unit_path"
  printf 'Environment=\\n'
  exit 0
fi
if [[ "\${1:-}" == 'show' ]]; then
  loaded_counter=${quoteShell(join(root, "systemd-loaded-show-count"))}
  loaded_count=0
  if [[ -f "$loaded_counter" ]]; then
    loaded_count="$(<"$loaded_counter")"
  fi
  loaded_count="$((loaded_count + 1))"
  printf '%s' "$loaded_count" >"$loaded_counter"
  unit_user='root'
  unit_exec_start=${quoteShell(
    `{ path=${pm2Exec} ; argv[]=${pm2Exec} resurrect ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=110 ; code=exited ; status=0 }`,
  )}
  unit_exec_reload=${quoteShell(
    `{ path=${pm2Exec} ; argv[]=${pm2Exec} reload all ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }`,
  )}
  unit_exec_stop=${quoteShell(
    `{ path=${pm2Exec} ; argv[]=${pm2Exec} kill ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }`,
  )}
  unit_environment=${quoteShell(`PATH=${pm2UnitPath} PM2_HOME=${pm2Home}`)}
  unit_pid_file=${quoteShell(join(pm2Home, "pm2.pid"))}
  unit_main_pid='111'
  unit_control_group='/system.slice/pm2-root.service'
  unit_drop_in_paths=''
  unit_need_daemon_reload='no'
  unit_wants=''
  unit_requires='system.slice sysinit.target'
  unit_upholds=''
  unit_exec_start_post=''
  unit_on_failure=''
  unit_root_directory=''
  unit_conflicts='shutdown.target'
  unit_dynamic_user='no'
  unit_working_directory=''
  if [[ -f ${quoteShell(join(root, "systemd-user-drift"))} ]]; then
    unit_user='diesel'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-exec-start-drift"))} ]]; then
    unit_exec_start='{ path=/usr/bin/false ; argv[]=/usr/bin/false ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-environment-drift"))} ]]; then
    unit_environment='PATH=/usr/bin PM2_HOME=/tmp/untrusted-pm2'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-pid-file-drift"))} ]]; then
    unit_pid_file='/tmp/untrusted-pm2/pm2.pid'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-main-pid-drift"))} ]]; then
    unit_main_pid='112'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-control-group-drift"))} ]]; then
    unit_control_group='/system.slice/unrelated.service'
  fi
  if [[ -f ${quoteShell(
    join(root, "systemd-need-daemon-reload-drift"),
  )} ]]; then
    unit_need_daemon_reload='yes'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-wants-drift"))} ]]; then
    unit_wants='network.target'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-requires-drift"))} ]]; then
    unit_requires='system.slice'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-upholds-drift"))} ]]; then
    unit_upholds='network.target'
  fi
  if [[ -f ${quoteShell(
    join(root, "systemd-exec-start-post-drift"),
  )} ]]; then
    unit_exec_start_post='{ path=/usr/bin/true ; argv[]=/usr/bin/true ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-exec-reload-drift"))} ]]; then
    unit_exec_reload='{ path=/usr/bin/false ; argv[]=/usr/bin/false ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-exec-stop-drift"))} ]]; then
    unit_exec_stop='{ path=/usr/bin/false ; argv[]=/usr/bin/false ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-on-failure-drift"))} ]]; then
    unit_on_failure='network.target'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-root-directory-drift"))} ]]; then
    unit_root_directory='/srv/diesel'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-conflicts-drift"))} ]]; then
    unit_conflicts='shutdown.target reboot.target'
  fi
  if [[ -f ${quoteShell(join(root, "systemd-dynamic-user-drift"))} ]]; then
    unit_dynamic_user='yes'
  fi
  if [[ -f ${quoteShell(
    join(root, "systemd-working-directory-drift"),
  )} ]]; then
    unit_working_directory='/tmp'
  fi
  if [[ "$loaded_count" -ge 2 && -f ${quoteShell(
    join(root, "systemd-loaded-snapshot-drift"),
  )} ]]; then
    unit_wants='network.target'
  fi
  {
  printf 'Id=pm2-root.service\\n'
  printf 'Names=pm2-root.service\\n'
  printf 'LoadState=loaded\\n'
  printf 'ActiveState=active\\n'
  printf 'SubState=running\\n'
  printf 'UnitFileState=enabled\\n'
  printf 'Type=forking\\n'
  printf 'User=%s\\n' "$unit_user"
  printf 'Environment=%s\\n' "$unit_environment"
  printf 'EnvironmentFiles=\\n'
  printf 'PIDFile=%s\\n' "$unit_pid_file"
  printf 'ExecCondition=\\n'
  printf 'ExecStart=%s\\n' "$unit_exec_start"
  printf 'ExecStartPre=\\n'
  printf 'ExecStartPost=%s\\n' "$unit_exec_start_post"
  printf 'ExecReload=%s\\n' "$unit_exec_reload"
  printf 'ExecStop=%s\\n' "$unit_exec_stop"
  printf 'ExecStopPost=\\n'
  printf 'Restart=on-failure\\n'
  printf 'Wants=%s\\n' "$unit_wants"
  printf 'Requires=%s\\n' "$unit_requires"
  printf 'Upholds=%s\\n' "$unit_upholds"
  printf 'Requisite=\\n'
  printf 'BindsTo=\\n'
  printf 'OnFailure=%s\\n' "$unit_on_failure"
  printf 'OnSuccess=\\n'
  printf 'PartOf=\\n'
  printf 'Conflicts=%s\\n' "$unit_conflicts"
  printf 'RootDirectory=%s\\n' "$unit_root_directory"
  printf 'RootImage=\\n'
  printf 'Group=\\n'
  printf 'SupplementaryGroups=\\n'
  printf 'PAMName=\\n'
  printf 'PassEnvironment=\\n'
  printf 'UnsetEnvironment=\\n'
  printf 'DynamicUser=%s\\n' "$unit_dynamic_user"
  printf 'Slice=system.slice\\n'
  printf 'WorkingDirectory=%s\\n' "$unit_working_directory"
  printf 'MainPID=%s\\n' "$unit_main_pid"
  printf 'ControlGroup=%s\\n' "$unit_control_group"
  printf 'FragmentPath=%s\\n' ${quoteShell(pm2UnitFragment)}
  printf 'DropInPaths=%s\\n' "$unit_drop_in_paths"
  printf 'NeedDaemonReload=%s\\n' "$unit_need_daemon_reload"
  } | while IFS= read -r property; do
    omit=0
    if [[ -f ${quoteShell(join(root, "systemd-show-omit"))} ]]; then
      while IFS= read -r omitted; do
        if [[ "$property" == "$omitted="* ]]; then omit=1; fi
      done <${quoteShell(join(root, "systemd-show-omit"))}
    fi
    if [[ "$omit" -eq 0 ]]; then printf '%s\\n' "$property"; fi
  done
  if [[ "$loaded_count" -eq 1 && -f ${quoteShell(
    join(root, "systemd-fragment-ab-drift"),
  )} ]]; then
    printf 'unexpected unit bytes\\n' >${quoteShell(pm2UnitFragment)}
  fi
  exit 0
fi
if [[ "\${1:-}" == 'reload' ]]; then
  printf 'systemctl-reload:%s\\n' "\${2:-}" >>${quotedMutationLog}
fi
`,
  );

  await writeExecutable(
    join(fakeBin, "busctl"),
    `#!/bin/bash
exec ${quoteShell(process.execPath)} -e ${quoteShell(`
const fs = require("node:fs");
const args = process.argv.slice(1);
if (args.slice(0, 3).join(" ") !== "--system --json=short --timeout=5") process.exit(98);
const key = args.at(-1) === "org.freedesktop.systemd1.Unit" ? "GetAll" : args.at(-1);
const configPath = ${JSON.stringify(join(root, "systemd-bus-config.json"))};
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
const countPath = ${JSON.stringify(join(root, "systemd-bus-count-"))} + key;
const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, "utf8")) + 1 : 1;
fs.writeFileSync(countPath, String(count));
fs.appendFileSync(${JSON.stringify(lifecycleLog)}, "busctl:" + key + "\\n");
const response = count >= 2 && config[key]?.second ? config[key].second : config[key];
if (response?.status) process.exit(response.status);
if (response?.stdout !== undefined) { process.stdout.write(response.stdout); process.exit(0); }
const defaults = {
  EnvironmentFiles: { type: "a(sb)", data: [] },
  ExecCondition: { type: "a(sasbttttuii)", data: [] },
  ExecStartPre: { type: "a(sasbttttuii)", data: [] },
  ExecStartPost: { type: "a(sasbttttuii)", data: [] },
  ExecStopPost: { type: "a(sasbttttuii)", data: [] },
  GetAll: { type: "a{sv}", data: [{ Id: { type: "s", data: "pm2-root.service" } }] },
  Version: { type: "s", data: "249.11-0ubuntu3.11" },
};
if (!Object.hasOwn(defaults, key)) process.exit(98);
console.log(JSON.stringify(response?.value ?? defaults[key]));
`)} -- "$@"
`,
  );

  const current = options?.current ?? "failed";
  const currentTarget =
    current === "failed"
      ? failedRelease
      : current === "previous"
        ? previousRelease
        : unexpectedRelease;
  await symlink(currentTarget, currentLink);
  const pm2Version = options?.pm2Version ?? "failed-release";
  if (pm2Version !== "absent") {
    await writeFile(pm2State, pm2Version, "utf8");
  }
  const processRelease =
    pm2Version === "previous-release" ? previousRelease : failedRelease;
  await Promise.all([
    symlink(processRelease, join(procProcessRoot, "cwd"), "dir"),
    symlink(nodeBinary, join(procProcessRoot, "exe"), "file"),
    symlink(nodeBinary, join(pm2DaemonProcRoot, "exe"), "file"),
    writeFile(
      join(procProcessRoot, "cmdline"),
      Buffer.from("next-server (v16.2.12)\0", "utf8"),
    ),
    writeFile(
      join(pm2DaemonProcRoot, "cgroup"),
      "0::/system.slice/pm2-root.service\n",
      "utf8",
    ),
    writeFile(
      join(pm2DaemonProcRoot, "environ"),
      Buffer.from(`PATH=${pm2UnitPath}\0PM2_HOME=${pm2Home}\0`, "utf8"),
    ),
    writeFile(
      join(pm2DaemonProcRoot, "cmdline"),
      Buffer.from("PM2 v6.0.14: God Daemon\0", "utf8"),
    ),
  ]);

  return {
    currentLink,
    deployRoot,
    environmentPath,
    failedRelease,
    fakePath,
    lifecycleLock,
    lifecycleLog,
    hostActivationLedger,
    mutationLog,
    nginxAlternatePath,
    nginxPrimaryPath,
    nginxSitesRoot,
    nodeBinary,
    pm2State,
    pm2StateHelper,
    pm2Exec,
    pm2Home,
    pm2UnitFragment,
    previousRelease,
    procRoot,
    releaseArtifactManifest,
    releaseId,
    root,
    stateDir,
    systemdAbsentUnitRoot,
    systemdSecondaryUnitRoot,
    systemdUnitRoot,
  };
}

async function createActivationFixture(): Promise<RollbackFixture> {
  const fixture = await createRollbackFixture({
    current: "previous",
    pm2Version: "previous-release",
    releaseId: TEST_RELEASE_SHA,
  });
  const candidateNginxRoot = join(
    fixture.failedRelease,
    "deploy",
    "nginx",
  );
  const statePrimary = join(fixture.stateDir, "jamesky.site.pre-switch");
  const stateAlternate = join(fixture.stateDir, "diesel-demo.pre-switch");

  await mkdir(candidateNginxRoot, { recursive: true });
  await Promise.all([
    writeFile(
      join(candidateNginxRoot, "jamesky.site.conf"),
      "candidate primary nginx\n",
      "utf8",
    ),
    writeFile(
      join(candidateNginxRoot, "diesel-demo.conf"),
      "candidate alternate nginx\n",
      "utf8",
    ),
    writeFile(
      join(fixture.failedRelease, "deploy", "ecosystem.config.cjs"),
      "module.exports = {};\n",
      "utf8",
    ),
    writeFile(
      join(fixture.root, "enforce-activation-fd-boundary"),
      "enforce\n",
      "utf8",
    ),
    writeFile(join(fixture.failedRelease, ".build-complete"), "build\n", "utf8"),
    writeFile(join(fixture.failedRelease, ".deploy-ready"), "ready\n", "utf8"),
  ]);
  await Promise.all([
    chmod(join(fixture.failedRelease, "deploy"), 0o750),
    chmod(candidateNginxRoot, 0o750),
    chmod(join(candidateNginxRoot, "jamesky.site.conf"), 0o640),
    chmod(join(candidateNginxRoot, "diesel-demo.conf"), 0o640),
    chmod(join(fixture.failedRelease, "deploy", "ecosystem.config.cjs"), 0o640),
    chmod(join(fixture.failedRelease, ".build-complete"), 0o640),
    chmod(join(fixture.failedRelease, ".deploy-ready"), 0o640),
  ]);
  await Promise.all([
    copyFile(statePrimary, fixture.nginxPrimaryPath),
    copyFile(stateAlternate, fixture.nginxAlternatePath),
  ]);
  await Promise.all([
    chmod(fixture.nginxPrimaryPath, 0o644),
    chmod(fixture.nginxAlternatePath, 0o644),
  ]);
  return fixture;
}

async function executeActivation(
  fixture: RollbackFixture,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(
      "bash",
      [
        "-c",
        [
          'source "$1"',
          'lifecycle_lock="$2"',
          "shift 2",
          'exec 8<>"${lifecycle_lock}"',
          "export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8",
          "host_activation_ledger_require_pending() {",
          '  count_file="$ACTIVATION_TEST_ROOT/pending-count"',
          "  count=0",
          '  if [[ -f "${count_file}" ]]; then count="$(<"${count_file}")"; fi',
          '  count="$((count + 1))"',
          '  printf \'%s\' "${count}" >"${count_file}"',
          '  printf \'ledger-pending:%s\\n\' "${count}" >>"$ACTIVATION_TEST_LIFECYCLE_LOG"',
          '  if [[ -f "$ACTIVATION_TEST_ROOT/pending-fail-at" ]] &&',
          '    [[ "$(<"$ACTIVATION_TEST_ROOT/pending-fail-at")" == "${count}" ]]; then',
          "    return 96",
          "  fi",
          "  HOST_ACTIVATION_LEDGER_PREVIOUS_RELEASE_PATH=\"$ACTIVATION_TEST_PREVIOUS_RELEASE\"",
          "  HOST_ACTIVATION_LEDGER_NGINX_PRIMARY_BACKUP=\"$ACTIVATION_TEST_PRIMARY_BACKUP\"",
          "  HOST_ACTIVATION_LEDGER_NGINX_ALTERNATE_BACKUP=\"$ACTIVATION_TEST_ALTERNATE_BACKUP\"",
          "}",
          'activate_host_release "$@"',
        ].join("\n"),
        "activation-fixture",
        activateHostReleaseScript,
        fixture.lifecycleLock,
        fixture.releaseId,
        fixture.deployRoot,
        fixture.nginxSitesRoot,
        fixture.fakePath,
        fixture.nodeBinary,
        fixture.procRoot,
        fixture.pm2Home,
        fixture.pm2Exec,
        fixture.pm2UnitFragment,
        TEST_PROCESS_UID,
        TEST_PROCESS_GID,
        [
          fixture.systemdSecondaryUnitRoot,
          fixture.systemdAbsentUnitRoot,
        ].join(":"),
      ],
      {
        env: {
          ...process.env,
          ACTIVATION_SECRET_CANARY: "must-not-reach-pm2",
          ACTIVATION_TEST_ALTERNATE_BACKUP: join(
            fixture.stateDir,
            "diesel-demo.pre-switch",
          ),
          ACTIVATION_TEST_LIFECYCLE_LOG: fixture.lifecycleLog,
          ACTIVATION_TEST_PREVIOUS_RELEASE: fixture.previousRelease,
          ACTIVATION_TEST_PRIMARY_BACKUP: join(
            fixture.stateDir,
            "jamesky.site.pre-switch",
          ),
          ACTIVATION_TEST_ROOT: fixture.root,
        },
      },
    );
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

async function executeActivationCli(args: string[]): Promise<CommandResult> {
  try {
    const result = await execFileAsync(
      "/bin/bash",
      [activateHostReleaseScript, ...args],
      {
        env: {
          ...process.env,
          DIESEL_DEPLOY_ROOT: "/tmp/activation-path-override-must-not-run",
        },
      },
    );
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

async function executeRollback(
  fixture: RollbackFixture,
  mode:
    | "--abort-if-uncommitted"
    | "--apply"
    | "--check"
    | "--restore-governance-host"
    | "--validate-committed",
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(
      "bash",
      [
        "-c",
        [
          'source "$1"',
          "shift",
          "host_activation_ledger_validate_release_state() {",
          '  printf \'ledger-validate:%s\\n\' "$1" >>"$ROLLBACK_TEST_LIFECYCLE_LOG"',
          "  HOST_ACTIVATION_LEDGER_PROTOCOL=v1",
          '  if [[ -f "$ROLLBACK_TEST_ROOT/ledger-terminal" ]]; then',
          "    HOST_ACTIVATION_LEDGER_CLASSIFICATION=terminal",
          "    HOST_ACTIVATION_LEDGER_STATE=COMMITTED",
          "    HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE=PUBLISH_FINALIZED",
          "  else",
          "    HOST_ACTIVATION_LEDGER_CLASSIFICATION=active",
          "    HOST_ACTIVATION_LEDGER_STATE=PENDING",
          "    HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE=none",
          "  fi",
          "}",
          "host_activation_ledger_revalidate_terminal() {",
          '  printf \'ledger-revalidate:%s\\n\' "$1" >>"$ROLLBACK_TEST_LIFECYCLE_LOG"',
          "}",
          "host_activation_ledger_transition() {",
          '  printf \'ledger-transition:%s:%s\\n\' "$1" "$4" >>"$ROLLBACK_TEST_LIFECYCLE_LOG"',
          '  [[ ! -f "$ROLLBACK_TEST_ROOT/ledger-transition-fail" ]]',
          "}",
          "host_activation_ledger_begin() {",
          '  printf \'ledger-begin:%s\\n\' "$1" >>"$ROLLBACK_TEST_LIFECYCLE_LOG"',
          "}",
          'rollback_host_release "$@"',
        ].join("\n"),
        "rollback-fixture",
        rollbackHostReleaseScript,
        "failed-release",
        mode,
        fixture.deployRoot,
        fixture.nginxSitesRoot,
        fixture.fakePath,
        fixture.nodeBinary,
        fixture.procRoot,
        fixture.pm2Home,
        fixture.pm2Exec,
        fixture.pm2UnitFragment,
        TEST_PROCESS_UID,
        TEST_PROCESS_GID,
        [
          fixture.systemdSecondaryUnitRoot,
          fixture.systemdAbsentUnitRoot,
        ].join(":"),
      ],
      {
        env: {
          ...process.env,
          ROLLBACK_TEST_LIFECYCLE_LOG: fixture.lifecycleLog,
          ROLLBACK_TEST_ROOT: fixture.root,
        },
      },
    );
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

async function readMutationLog(fixture: RollbackFixture): Promise<string> {
  return readFile(fixture.mutationLog, "utf8").catch(() => "");
}

async function readLifecycleLog(fixture: RollbackFixture): Promise<string> {
  return readFile(fixture.lifecycleLog, "utf8").catch(() => "");
}

async function expectDurablePm2Validation(
  fixture: RollbackFixture,
  expectedReleaseId: string,
  afterIndex = -1,
): Promise<number> {
  const events = (await readLifecycleLog(fixture)).trim().split("\n");
  const processIdentityIndex = events.indexOf("ps-uid:321", afterIndex + 1);
  const processGroupIndex = events.indexOf(
    "ps-gid:321",
    processIdentityIndex + 1,
  );
  const helperIndex = events.indexOf(
    `pm2-helper:${expectedReleaseId}`,
    processGroupIndex + 1,
  );
  const expectedSystemdShow = [
    "systemctl:show pm2-root --all --no-pager",
    ...PM2_SYSTEMD_IDENTITY_PROPERTIES.map((name) => `--property=${name}`),
  ].join(" ");
  const expectedManagerShow =
    "systemctl:show --property=UnitPath --property=Environment";
  const expectedCompiledUnitPaths =
    "systemd-analyze:--system unit-paths";
  const firstManagerIdentityIndex = events.indexOf(
    expectedManagerShow,
    helperIndex + 1,
  );
  const firstCompiledUnitPathsIndex = events.indexOf(
    expectedCompiledUnitPaths,
    firstManagerIdentityIndex + 1,
  );
  const firstSystemdIdentityIndex = events.indexOf(
    expectedSystemdShow,
    firstCompiledUnitPathsIndex + 1,
  );
  const secondSystemdIdentityIndex = events.indexOf(
    expectedSystemdShow,
    firstSystemdIdentityIndex + 1,
  );
  const secondManagerIdentityIndex = events.indexOf(
    expectedManagerShow,
    secondSystemdIdentityIndex + 1,
  );
  const secondCompiledUnitPathsIndex = events.indexOf(
    expectedCompiledUnitPaths,
    secondManagerIdentityIndex + 1,
  );
  expect(processIdentityIndex).toBeGreaterThan(afterIndex);
  expect(processGroupIndex).toBeGreaterThan(processIdentityIndex);
  expect(helperIndex).toBeGreaterThan(processGroupIndex);
  expect(firstManagerIdentityIndex).toBeGreaterThan(helperIndex);
  expect(firstCompiledUnitPathsIndex).toBeGreaterThan(
    firstManagerIdentityIndex,
  );
  expect(firstSystemdIdentityIndex).toBeGreaterThan(
    firstCompiledUnitPathsIndex,
  );
  expect(secondSystemdIdentityIndex).toBeGreaterThan(
    firstSystemdIdentityIndex,
  );
  expect(secondManagerIdentityIndex).toBeGreaterThan(
    secondSystemdIdentityIndex,
  );
  expect(secondCompiledUnitPathsIndex).toBeGreaterThan(
    secondManagerIdentityIndex,
  );
  expect(events).not.toContain("systemctl:daemon-reload");
  return secondCompiledUnitPathsIndex;
}

async function captureRollbackTargets(fixture: RollbackFixture) {
  return {
    currentTarget: await readlink(fixture.currentLink),
    environment: await readFile(fixture.environmentPath, "utf8"),
    nginxAlternate: await readFile(fixture.nginxAlternatePath, "utf8"),
    nginxPrimary: await readFile(fixture.nginxPrimaryPath, "utf8"),
    pm2State: await readFile(fixture.pm2State, "utf8").catch(() => null),
  };
}

type SystemdDiskIdentityFault = {
  mutate: (fixture: RollbackFixture) => Promise<void>;
  name: string;
};

function systemdDiskIdentityFaults(): SystemdDiskIdentityFault[] {
  const faults: SystemdDiskIdentityFault[] = [
    {
      name: "wrong fragment bytes",
      mutate: async (fixture) => {
        await writeFile(fixture.pm2UnitFragment, "unexpected unit bytes\n");
      },
    },
    {
      name: "wrong fragment bytes with the prior mtime restored",
      mutate: async (fixture) => {
        const before = await stat(fixture.pm2UnitFragment);
        await writeFile(fixture.pm2UnitFragment, "unexpected unit bytes\n");
        await utimes(fixture.pm2UnitFragment, before.atime, before.mtime);
      },
    },
    {
      name: "fragment ownership drift",
      mutate: async (fixture) => {
        await writeFile(
          join(fixture.root, "untrusted-owner-path"),
          fixture.pm2UnitFragment,
          "utf8",
        );
      },
    },
    {
      name: "world-writable external fixture ancestor",
      mutate: async (fixture) => {
        await writeFile(
          join(fixture.root, "untrusted-mode-path"),
          dirname(fixture.root),
          "utf8",
        );
      },
    },
    {
      name: "group-writable fragment mode",
      mutate: async (fixture) => {
        await chmod(fixture.pm2UnitFragment, 0o664);
      },
    },
    {
      name: "symlinked fragment",
      mutate: async (fixture) => {
        const target = join(fixture.root, "pm2-root.service.target");
        await writeFile(
          target,
          await readFile(fixture.pm2UnitFragment, "utf8"),
          "utf8",
        );
        await rm(fixture.pm2UnitFragment);
        await symlink(target, fixture.pm2UnitFragment, "file");
      },
    },
    {
      name: "multiply linked fragment",
      mutate: async (fixture) => {
        await link(
          fixture.pm2UnitFragment,
          join(fixture.systemdUnitRoot, "pm2-root-copy.service"),
        );
      },
    },
    {
      name: "missing boot enablement link",
      mutate: async (fixture) => {
        await rm(
          join(
            fixture.systemdUnitRoot,
            "multi-user.target.wants",
            "pm2-root.service",
          ),
        );
      },
    },
    {
      name: "boot enablement link with the wrong lexical target",
      mutate: async (fixture) => {
        const linkPath = join(
          fixture.systemdUnitRoot,
          "multi-user.target.wants",
          "pm2-root.service",
        );
        const target = join(fixture.systemdUnitRoot, "unrelated.service");
        await writeFile(target, "unrelated\n", "utf8");
        await rm(linkPath);
        await symlink(target, linkPath, "file");
      },
    },
    {
      name: "a second UnitPath pm2-root.service candidate",
      mutate: async (fixture) => {
        await writeFile(
          join(fixture.systemdSecondaryUnitRoot, "pm2-root.service"),
          "unexpected\n",
          "utf8",
        );
      },
    },
    {
      name: "a direct cross-root PM2 alias",
      mutate: async (fixture) => {
        await symlink(
          fixture.pm2UnitFragment,
          join(fixture.systemdSecondaryUnitRoot, "diesel-alias.service"),
          "file",
        );
      },
    },
    {
      name: "a dangling cross-root PM2 alias",
      mutate: async (fixture) => {
        await symlink(
          "pm2-root.service",
          join(fixture.systemdSecondaryUnitRoot, "diesel-dangling.service"),
          "file",
        );
      },
    },
    {
      name: "a chained cross-root PM2 alias",
      mutate: async (fixture) => {
        await symlink(
          "bridge.service",
          join(fixture.systemdSecondaryUnitRoot, "diesel-chain.service"),
          "file",
        );
        await symlink(
          "pm2-root.service",
          join(fixture.systemdUnitRoot, "bridge.service"),
          "file",
        );
      },
    },
    {
      name: "an alias targeting pm2-root.service slash-dot",
      mutate: async (fixture) => {
        await symlink(
          "pm2-root.service/.",
          join(fixture.systemdSecondaryUnitRoot, "diesel-dot.service"),
          "file",
        );
      },
    },
  ];

  for (const scope of ["pm2-root.service", "pm2-.service", "service"]) {
    faults.push({
      name: `${scope}.d drop-in`,
      mutate: async (fixture) => {
        const directory = join(
          fixture.systemdSecondaryUnitRoot,
          `${scope}.d`,
        );
        await mkdir(directory);
        await writeFile(join(directory, "override.conf"), "[Service]\n");
      },
    });
  }

  for (const unitName of [
    "pm2-root.service",
    "pm2-.service",
    "service",
    "diesel-alias.service",
  ]) {
    for (const relationship of ["wants", "requires", "upholds"]) {
      for (const entryType of ["regular", "symlink"] as const) {
        faults.push({
          name: `${unitName}.${relationship} ${entryType} entry`,
          mutate: async (fixture) => {
            if (unitName === "diesel-alias.service") {
              await symlink(
                fixture.pm2UnitFragment,
                join(fixture.systemdSecondaryUnitRoot, unitName),
                "file",
              );
            }
            const directory = join(
              fixture.systemdSecondaryUnitRoot,
              `${unitName}.${relationship}`,
            );
            await mkdir(directory);
            const entry = join(directory, "payload.service");
            if (entryType === "regular") {
              await writeFile(entry, "unexpected\n", "utf8");
            } else {
              await symlink(fixture.pm2UnitFragment, entry, "file");
            }
          },
        });
      }
    }
  }

  for (const entryType of ["regular", "symlink"] as const) {
    faults.push({
      name: `an extra global enablement ${entryType} candidate`,
      mutate: async (fixture) => {
        const directory = join(
          fixture.systemdSecondaryUnitRoot,
          "network.target.wants",
        );
        await mkdir(directory);
        const candidate = join(directory, "pm2-root.service");
        if (entryType === "regular") {
          await writeFile(candidate, "unexpected\n", "utf8");
        } else {
          await symlink(fixture.pm2UnitFragment, candidate, "file");
        }
      },
    });
  }
  faults.push({
    name: "a symlinked global enablement directory",
    mutate: async (fixture) => {
      await symlink(
        join(fixture.systemdUnitRoot, "multi-user.target.wants"),
        join(fixture.systemdSecondaryUnitRoot, "network.target.wants"),
        "dir",
      );
    },
  });

  return faults;
}

type GovernanceSnapshotStateMarker =
  | "HOST_ROLLBACK_COMPLETED"
  | "HOST_ROLLBACK_REQUIRED"
  | "PUBLISH_COMMITTED"
  | "PUBLISH_FINALIZED"
  | "RECOVERY_REQUIRED";

async function writePublishStateMarker(
  fixture: RollbackFixture,
  markerName: GovernanceSnapshotStateMarker,
): Promise<string> {
  const snapshotPath = join(fixture.stateDir, "governance-before.json");
  const snapshot = '{"tableCounts":{},"tables":{}}\n';
  const snapshotSha256 = createHash("sha256").update(snapshot).digest("hex");
  const markerPath = join(fixture.stateDir, markerName);
  await writeFile(snapshotPath, snapshot, "utf8");
  await writeFile(markerPath, `${snapshotSha256}\t${snapshotPath}\n`, "utf8");
  await Promise.all([chmod(snapshotPath, 0o600), chmod(markerPath, 0o600)]);
  return markerPath;
}

async function writePublishCommitMarker(
  fixture: RollbackFixture,
): Promise<string> {
  return writePublishStateMarker(fixture, "PUBLISH_COMMITTED");
}

async function writeHostRollbackMarker(
  fixture: RollbackFixture,
): Promise<string> {
  return writePublishStateMarker(fixture, "HOST_ROLLBACK_REQUIRED");
}

async function expectRollbackFilesRestored(
  fixture: RollbackFixture,
): Promise<void> {
  await expect(readFile(fixture.environmentPath, "utf8")).resolves.toBe(
    "OLD_ENV=1\n",
  );
  await expect(readFile(fixture.nginxPrimaryPath, "utf8")).resolves.toBe(
    "old primary nginx\n",
  );
  await expect(readFile(fixture.nginxAlternatePath, "utf8")).resolves.toBe(
    "old alternate nginx\n",
  );
  await expect(realpath(fixture.currentLink)).resolves.toBe(
    fixture.previousRelease,
  );
  await expect(readFile(fixture.pm2State, "utf8")).resolves.toBe(
    "previous-release",
  );
}

async function expectActivationLedgerBasisUnchanged(
  fixture: RollbackFixture,
): Promise<void> {
  await expect(
    readFile(join(fixture.stateDir, "previous-release"), "utf8"),
  ).resolves.toBe(`${fixture.previousRelease}\n`);
  await expect(
    readFile(
      join(fixture.stateDir, "env.production.local.pre-switch"),
      "utf8",
    ),
  ).resolves.toBe("OLD_ENV=1\n");
  await expect(
    readFile(join(fixture.stateDir, "jamesky.site.pre-switch"), "utf8"),
  ).resolves.toBe("old primary nginx\n");
  await expect(
    readFile(join(fixture.stateDir, "diesel-demo.pre-switch"), "utf8"),
  ).resolves.toBe("old alternate nginx\n");
  expect((await readdir(fixture.stateDir)).sort()).toEqual([
    "diesel-demo.pre-switch",
    "env.production.local.pre-switch",
    "jamesky.site.pre-switch",
    "previous-release",
  ]);
}

describe("host activation ledger fixture stat metadata", () => {
  it.each(["gnu", "bsd"] as const)(
    "reads fresh native metadata with the %s dialect and preserves the low nine mode bits",
    async (dialect) => {
      const fixture = await createHostActivationLedgerFixture();
      try {
        const shim = join(fixture.root, "fake-bin", "stat");
        const nativeStat = join(fixture.root, "native-stat");
        const calls = join(fixture.root, "stat-calls");
        const response = join(fixture.root, "native-response");
        const sharedFile = join(fixture.sharedRoot, ".env.production.local");
        await writeExecutable(nativeStat, `#!/bin/bash
set -euo pipefail
printf '%s %s\\n' "$1" "$2" >>${quoteShell(calls)}
[[ "$#" -eq 4 && "$3" == '--' && "$4" == ${quoteShell(sharedFile)} ]] || exit 64
[[ "$1" == '${dialect === "gnu" ? "-c" : "-f"}' ]] || exit 64
[[ "$2" == '${dialect === "gnu" ? "%a:%h:%s" : "%Lp:%l:%z"}' ]] || exit 64
printf '%s\\n' "$(<${quoteShell(response)})"
`);
        await writeExecutable(shim, (await readFile(shim, "utf8")).replaceAll(
          "/usr/bin/stat", quoteShell(nativeStat),
        ));
        for (const [nativeMode, expectedMode] of [
          ["640", "640"], ["0", "0"], ["0007", "7"],
          ["1640", "640"], ["4640", "640"], ["7640", "640"],
        ] as const) {
          await writeFile(response, `${nativeMode}:2:7\n`);
          for (const [format, expected] of [
            ["%U:%G:%a", `root:diesel:${expectedMode}\n`],
            ["%h", "2\n"], ["%s", "7\n"],
          ] as const) {
            await writeFile(calls, "");
            const result = await execFileAsync(shim, ["-c", format, "--", sharedFile]);
            expect(result.stdout).toBe(expected);
            expect(result.stderr).toBe("");
            expect(await readFile(calls, "utf8")).toBe(dialect === "gnu"
              ? "-c %a:%h:%s\n"
              : "-c %a:%h:%s\n-f %Lp:%l:%z\n");
          }
        }
        for (const malformed of ["", "8:2:7", "640:x:7", "640:2:x", "640:2", "640:2:7:extra"]) {
          await writeFile(response, malformed);
          await expect(execFileAsync(shim, ["-c", "%s", "--", sharedFile]))
            .rejects.toMatchObject({ code: 65, stdout: "" });
        }
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it("matches current lstat after file mutations, hardlinks and symbolic links", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      const shim = join(fixture.root, "fake-bin", "stat");
      const file = join(fixture.root, "metadata with spaces\nand newline");
      const hardLink = join(fixture.root, "metadata-hard-link");
      const symbolicLink = join(fixture.root, "metadata-symbolic-link");
      const danglingLink = join(fixture.root, "metadata-dangling-link");
      const assertMetadata = async (path: string) => {
        const metadata = await lstat(path);
        for (const [format, expected] of [
          ["%U:%G:%a", `root:root:${(metadata.mode & 0o777).toString(8)}\n`],
          ["%h", `${metadata.nlink}\n`], ["%s", `${metadata.size}\n`],
        ] as const) {
          const result = await execFileAsync(shim, ["-c", format, "--", path]);
          expect(result.stdout).toBe(expected);
          expect(result.stderr).toBe("");
        }
      };
      await writeFile(file, "before", { mode: 0o640 });
      await assertMetadata(file);
      await writeFile(file, "after mutation: larger bytes");
      await chmod(file, 0o600);
      await link(file, hardLink);
      await symlink(file, symbolicLink);
      await symlink(join(fixture.root, "absent-target"), danglingLink);
      for (const path of [file, hardLink, symbolicLink, danglingLink, fixture.root]) {
        await assertMetadata(path);
      }
      await rm(hardLink);
      await assertMetadata(file);
      await expect(execFileAsync(shim, ["-c", "%s", "--", join(fixture.root, "absent")]))
        .rejects.toMatchObject({ code: 1, stdout: "" });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("preserves owner boundaries and rejects unsupported formats", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      const shim = join(fixture.root, "fake-bin", "stat");
      const sharedFile = join(fixture.sharedRoot, ".env.production.local");
      const nonShared = `${fixture.sharedRoot}-other`;
      await mkdir(nonShared);
      await chmod(nonShared, 0o700);
      for (const [path, expected] of [
        [sharedFile, "root:diesel:640\n"],
        [fixture.sharedRoot, "root:diesel:750\n"],
        [nonShared, "root:root:700\n"],
      ] as const) {
        expect((await execFileAsync(shim, ["-c", "%U:%G:%a", "--", path])).stdout).toBe(expected);
      }
      for (const format of ["", "%a", "%U:%G:%h:%s", "unknown"]) {
        await expect(execFileAsync(shim, ["-c", format, "--", sharedFile]))
          .rejects.toMatchObject({ code: 64, stdout: "" });
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

describe("rollback fixture stat metadata", () => {
  it.each(["gnu", "bsd"] as const)(
    "reads one metadata snapshot with the %s stat dialect",
    async (dialect) => {
      const fixture = await createRollbackFixture();
      try {
        const shim = join(fixture.root, "fake-bin", "stat");
        const nativeStat = join(fixture.root, "native-stat");
        const calls = join(fixture.root, "stat-calls");
        await writeExecutable(
          nativeStat,
          `#!/bin/bash
set -euo pipefail
printf '%s %s\\n' "$1" "$2" >>${quoteShell(calls)}
[[ "$1" == '${dialect === "gnu" ? "-c" : "-f"}' ]] || exit 64
case "$2" in
  '%a'|'%Lp') printf '640\\n' ;;
  '%h'|'%l') printf '2\\n' ;;
  '%s'|'%z') printf '7\\n' ;;
  '%a:%h:%s'|'%Lp:%l:%z') printf '640:2:7\\n' ;;
  *) exit 64 ;;
esac
`,
        );
        await writeExecutable(
          shim,
          (await readFile(shim, "utf8")).replaceAll(
            "/usr/bin/stat",
            quoteShell(nativeStat),
          ),
        );
        for (const [format, expected] of [
          ["%U:%G:%a", "root:diesel:640\n"],
          ["%h", "2\n"],
          ["%s", "7\n"],
          ["%U:%G:%h:%s", "root:diesel:2:7\n"],
        ] as const) {
          await writeFile(calls, "");
          const result = await execFileAsync(shim, [
            "-c", format, "--", fixture.environmentPath,
          ]);
          expect(result.stdout).toBe(expected);
          expect(result.stderr).toBe("");
          expect(await readFile(calls, "utf8")).toBe(
            dialect === "gnu"
              ? "-c %a:%h:%s\n"
              : "-c %a:%h:%s\n-f %Lp:%l:%z\n",
          );
        }
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it("reads fresh real metadata, including hard links and dangling symlinks", async () => {
    const fixture = await createRollbackFixture();
    try {
      const shim = join(fixture.root, "fake-bin", "stat");
      const file = join(fixture.root, "metadata with spaces\nand newline");
      const hardLink = join(fixture.root, "metadata-hard-link");
      const symbolicLink = join(fixture.root, "metadata-symbolic-link");
      const danglingLink = join(fixture.root, "metadata-dangling-link");
      const assertMetadata = async (path: string) => {
        const metadata = await lstat(path);
        for (const [format, expected] of [
          ["%U:%G:%a", `root:root:${(metadata.mode & 0o777).toString(8)}\n`],
          ["%h", `${metadata.nlink}\n`],
          ["%s", `${metadata.size}\n`],
          ["%U:%G:%h:%s", `root:root:${metadata.nlink}:${metadata.size}\n`],
        ] as const) {
          const result = await execFileAsync(shim, ["-c", format, "--", path]);
          expect(result.stdout).toBe(expected);
          expect(result.stderr).toBe("");
        }
      };
      await writeFile(file, "before", { mode: 0o640 });
      await assertMetadata(file);
      await writeFile(file, "after mutation: larger bytes");
      await chmod(file, 0o600);
      await link(file, hardLink);
      await symlink(file, symbolicLink);
      await symlink(join(fixture.root, "absent-target"), danglingLink);
      for (const path of [file, hardLink, symbolicLink, danglingLink, fixture.root]) {
        await assertMetadata(path);
      }
      await expect(
        execFileAsync(shim, ["-c", "%U:%G:%a", "--", join(fixture.root, "absent")]),
      ).rejects.toMatchObject({ code: 1, stdout: "" });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("preserves ownership, trusted ancestors and explicit permission faults", async () => {
    const fixture = await createRollbackFixture();
    try {
      const shim = join(fixture.root, "fake-bin", "stat");
      const readIdentity = async (path: string) =>
        (await execFileAsync(shim, ["-c", "%U:%G:%a", "--", path])).stdout;
      await chmod(fixture.environmentPath, 0o640);
      await chmod(fixture.root, 0o700);
      expect(await readIdentity(fixture.environmentPath)).toBe("root:diesel:640\n");
      expect(await readIdentity(fixture.root)).toBe("root:root:700\n");
      expect(await readIdentity(dirname(fixture.root))).toBe("root:root:755\n");
      expect(await readIdentity("/")).toBe("root:root:755\n");
      await writeFile(join(fixture.root, "untrusted-owner-path"), fixture.environmentPath);
      await writeFile(join(fixture.root, "untrusted-mode-path"), dirname(fixture.root));
      expect(await readIdentity(fixture.environmentPath)).toBe("diesel:diesel:640\n");
      expect(await readIdentity(dirname(fixture.root))).toBe("root:root:777\n");
      await writeFile(join(fixture.root, "untrusted-mode-path"), fixture.environmentPath);
      expect(await readIdentity(fixture.environmentPath)).toBe("diesel:diesel:777\n");
      expect(await readIdentity(dirname(fixture.root))).toBe("root:root:755\n");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

describe("sourceable deployment dependency failures", () => {
  it.each([
    {
      dependency: "rollback-host-release.sh",
      name: "activation rollback helper",
      script: activateHostReleaseScript,
    },
    {
      dependency: "host-activation-ledger.sh",
      name: "runtime-preparation ledger",
      script: prepareReleaseRuntimeScript,
    },
    {
      dependency: "host-activation-ledger.sh",
      name: "rollback ledger",
      script: rollbackHostReleaseScript,
    },
  ])("propagates a sourced $name failure", async ({ dependency, script }) => {
    const root = await mkdtemp(join(tmpdir(), "diesel-deploy-source-"));
    const copiedScript = join(root, script.split("/").at(-1) ?? "entry.sh");
    await Promise.all([
      copyFile(script, copiedScript),
      writeFile(join(root, dependency), "return 23\n", "utf8"),
    ]);

    try {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"',
        "deploy-source-failure-fixture",
        copiedScript,
      ]);

      expect(result).toEqual({ exitCode: 23, stderr: "", stdout: "" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each(
    [
      {
        bootstrapFunction: "activate_host_release_cli_bootstrap",
        entryName: "activate-host-release.sh",
        name: "activation",
        script: activateHostReleaseScript,
        validatorFunction: "activate_host_release_require_cli_bootstrap_path",
      },
      {
        bootstrapFunction: "prepare_release_cli_bootstrap",
        entryName: "prepare-release-runtime.sh",
        name: "runtime preparation",
        script: prepareReleaseRuntimeScript,
        validatorFunction: "prepare_release_require_cli_bootstrap_path",
      },
    ].flatMap((entry) =>
      ["/opt/diesel", "/opt/diesel/", "/opt//diesel"].map((deployRoot) => ({
        ...entry,
        deployRoot,
      })),
    ),
  )(
    "rejects sourced $name bootstrap root $deployRoot before inspecting paths",
    async ({
      bootstrapFunction,
      deployRoot,
      entryName,
      script,
      validatorFunction,
    }) => {
      const root = await mkdtemp(join(tmpdir(), "diesel-sourced-bootstrap-"));
      const marker = join(root, "path-inspected");
      const productionEntry = `${deployRoot}/releases/${TEST_RELEASE_SHA}/scripts/deploy/${entryName}`;
      const harness = [
        'source -- "$1"',
        'BOOTSTRAP_MARKER="$3"',
        `${validatorFunction}() {`,
        '  printf "inspected\\n" >"${BOOTSTRAP_MARKER}"',
        "}",
        `${bootstrapFunction} "$2" "$4" "$5"`,
      ].join("\n");

      try {
        const result = await execute("/bin/bash", [
          "--noprofile",
          "--norc",
          "-c",
          harness,
          "deploy-sourced-bootstrap-fixture",
          script,
          TEST_RELEASE_SHA,
          marker,
          deployRoot,
          productionEntry,
        ]);

        expect(result).toEqual({ exitCode: 64, stderr: "", stdout: "" });
        await expect(readFile(marker, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );
});

describe("versioned host activation", { timeout: 30_000 }, () => {
  it.each([
    ["trusted directory", "directory", "0", "0", "755", "2", 0],
    ["trusted executable", "executable", "0", "0", "755", "1", 0],
    ["non-root owner", "executable", "501", "0", "755", "1", 1],
    ["non-root group", "executable", "0", "501", "755", "1", 1],
    ["group-writable executable", "executable", "0", "0", "775", "1", 1],
    ["world-writable executable", "executable", "0", "0", "777", "1", 1],
    ["special-bit executable", "executable", "0", "0", "4755", "1", 1],
    ["non-executable file", "executable", "0", "0", "644", "1", 1],
    ["hard-linked executable", "executable", "0", "0", "755", "2", 1],
    ["private directory", "directory", "0", "0", "700", "2", 1],
    ["group-writable directory", "directory", "0", "0", "775", "2", 1],
    ["symlink-like mode", "directory", "0", "0", "777", "1", 1],
  ] as const)(
    "classifies %s in the exact production runtime metadata profile",
    async (
      _name,
      objectType,
      owner,
      group,
      mode,
      linkCount,
      expectedStatus,
    ) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; activate_host_release_cli_runtime_metadata_is_trusted "$2" "$3" "$4" "$5" "$6"',
        "activation-metadata-fixture",
        activateHostReleaseScript,
        objectType,
        owner,
        group,
        mode,
        linkCount,
      ]);

      expect(result).toEqual({
        exitCode: expectedStatus,
        stderr: "",
        stdout: "",
      });
    },
  );

  it("rejects the production main when the activation script is sourced", async () => {
    const result = await execute("/bin/bash", [
      "--noprofile",
      "--norc",
      "-c",
      'source -- "$1"; activate_host_release_main "$2"',
      "activation-sourced-main-fixture",
      activateHostReleaseScript,
      TEST_RELEASE_SHA,
    ]);

    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain(
      "production host activation main is unavailable when sourced",
    );
  });

  it.each(["/opt/diesel", "/opt/diesel/", "/opt//diesel"])(
    "rejects sourced activation test seam root %s",
    async (deployRoot) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; activate_host_release "$2" "$3" /tmp/nginx /usr/bin:/bin /usr/bin/node /proc /tmp/pm2 /tmp/pm2-exec /tmp/pm2.service 1001 1001 ""',
        "activation-sourced-production-root-fixture",
        activateHostReleaseScript,
        TEST_RELEASE_SHA,
        deployRoot,
      ]);

      expect(result.exitCode).toBe(64);
      expect(result.stderr).toContain(
        "host activation test seam cannot target the production deployment root",
      );
    },
  );

  it.each([
    {
      args: [],
      name: "a missing release id",
    },
    {
      args: ["a".repeat(39)],
      name: "a short release id",
    },
    {
      args: ["A".repeat(40)],
      name: "an uppercase release id",
    },
    {
      args: [TEST_RELEASE_SHA, "/tmp/attempted-path-override"],
      name: "an extra production path override",
    },
  ] as const)("rejects $name at the CLI boundary", async ({ args }) => {
    const result = await executeActivationCli([...args]);

    expect(result).toMatchObject({ exitCode: 64, stdout: "" });
    expect(result.stderr).toContain(
      "usage: activate-host-release.sh <40-character-lowercase-git-sha>",
    );
  });

  it("rejects a valid SHA from a non-release CLI entry", async () => {
    const result = await executeActivationCli([TEST_RELEASE_SHA]);

    expect(result).toMatchObject({ exitCode: 70, stdout: "" });
    expect(result.stderr).toContain(
      "host activation pre-source trust validation failed",
    );
  });

  it.each([
    ["system directory", "system-directory", "root:root:755", 0],
    ["normalized release directory", "release-directory", "root:diesel:750", 0],
    ["normalized release executable", "release-executable", "root:diesel:750:1", 0],
    ["staged release directory", "release-directory", "root:root:755", 1],
    ["staged release executable", "release-executable", "root:root:755:1", 1],
    ["hard-linked release executable", "release-executable", "root:diesel:750:2", 1],
    ["group-writable release executable", "release-executable", "root:diesel:770:1", 1],
  ] as const)(
    "classifies %s at the direct activation source boundary",
    async (_name, profile, metadata, expectedStatus) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; activate_host_release_cli_bootstrap_metadata_is_allowed "$2" "$3"',
        "activation-cli-metadata-fixture",
        activateHostReleaseScript,
        profile,
        metadata,
      ]);

      expect(result).toEqual({
        exitCode: expectedStatus,
        stderr: "",
        stdout: "",
      });
    },
  );

  it("validates activation, rollback, and ledger inodes before sourcing rollback code", async () => {
    const source = await readFile(activateHostReleaseScript, "utf8");
    const entryBindingIndex = source.indexOf(
      'local expected_entry="${expected_release}/scripts/deploy/activate-host-release.sh"',
    );
    const rollbackValidationIndex = source.indexOf(
      '"${expected_rollback}" release-executable',
    );
    const ledgerValidationIndex = source.indexOf(
      '"${expected_ledger}" release-executable',
    );
    const rootPathIndex = source.indexOf(
      'export PATH="/usr/sbin:/usr/bin:/sbin:/bin"',
    );
    const rollbackSourceIndex = source.indexOf(
      'source -- "${expected_rollback}"',
    );

    expect(entryBindingIndex).toBeGreaterThanOrEqual(0);
    expect(rollbackValidationIndex).toBeGreaterThan(entryBindingIndex);
    expect(ledgerValidationIndex).toBeGreaterThan(rollbackValidationIndex);
    expect(rootPathIndex).toBeGreaterThan(ledgerValidationIndex);
    expect(rollbackSourceIndex).toBeGreaterThan(rootPathIndex);
    expect(source.indexOf("source --")).toBe(rollbackSourceIndex);
    expect(source.slice(0, rollbackSourceIndex)).not.toMatch(
      /^[ \t]*(?:source|\.)[ \t]+/mu,
    );
  });

  it.each(["entry", "rollback", "ledger"] as const)(
    "does not execute poisoned activation dependencies when %s validation fails",
    async (rejectedObject) => {
      const root = await mkdtemp(join(tmpdir(), "diesel-activation-bootstrap-"));
      const deployRoot = join(root, "diesel");
      const releaseDirectory = join(deployRoot, "releases", TEST_RELEASE_SHA);
      const deployDirectory = join(releaseDirectory, "scripts", "deploy");
      const entry = join(deployDirectory, "activate-host-release.sh");
      const rollback = join(deployDirectory, "rollback-host-release.sh");
      const ledger = join(deployDirectory, "host-activation-ledger.sh");
      const rollbackMarker = join(root, "rollback-executed");
      const ledgerMarker = join(root, "ledger-executed");
      const validationLog = join(root, "validation.log");
      const rejectedPath =
        rejectedObject === "entry"
          ? entry
          : rejectedObject === "rollback"
            ? rollback
            : ledger;
      await mkdir(deployDirectory, { recursive: true });
      await Promise.all([
        writeFile(
          rollback,
          [
            'printf "rollback-executed\\n" >"${BOOTSTRAP_ROLLBACK_MARKER:?}"',
            'source -- "${BASH_SOURCE[0]%/*}/host-activation-ledger.sh"',
          ].join("\n"),
          "utf8",
        ),
        writeFile(
          ledger,
          'printf "ledger-executed\\n" >"${BOOTSTRAP_LEDGER_MARKER:?}"\n',
          "utf8",
        ),
      ]);

      try {
        const harness = [
          'source -- "$1"',
          'BOOTSTRAP_REJECT="$5"',
          'BOOTSTRAP_LOG="$6"',
          'BOOTSTRAP_ROLLBACK_MARKER="$7"',
          'BOOTSTRAP_LEDGER_MARKER="$8"',
          'activate_host_release_require_cli_bootstrap_path() {',
          '  printf "%s|%s\\n" "$1" "$2" >>"${BOOTSTRAP_LOG}"',
          '  [[ "$1" != "${BOOTSTRAP_REJECT}" ]]',
          '}',
          'activate_host_release_cli_bootstrap "$2" "$3" "$4"',
        ].join("\n");
        const result = await execute("/bin/bash", [
          "--noprofile",
          "--norc",
          "-c",
          harness,
          "activation-bootstrap-fixture",
          activateHostReleaseScript,
          TEST_RELEASE_SHA,
          deployRoot,
          entry,
          rejectedPath,
          validationLog,
          rollbackMarker,
          ledgerMarker,
        ]);

        expect(result).toEqual({ exitCode: 70, stderr: "", stdout: "" });
        await expect(readFile(rollbackMarker, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(readFile(ledgerMarker, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        const validatedPaths = (await readFile(validationLog, "utf8"))
          .trim()
          .split("\n");
        const expectedValidationSequence = [
          "/opt|system-directory",
          `${deployRoot}|system-directory`,
          `${deployRoot}/releases|system-directory`,
          `${releaseDirectory}|release-directory`,
          `${releaseDirectory}/scripts|release-directory`,
          `${deployDirectory}|release-directory`,
          `${entry}|release-executable`,
          `${rollback}|release-executable`,
          `${ledger}|release-executable`,
        ];
        const rejectedIndex = expectedValidationSequence.findIndex((line) =>
          line.startsWith(`${rejectedPath}|`),
        );
        expect(rejectedIndex).toBeGreaterThanOrEqual(0);
        expect(validatedPaths).toEqual(
          expectedValidationSequence.slice(0, rejectedIndex + 1),
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("sources activation dependencies only after every bootstrap validation succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-activation-bootstrap-"));
    const deployRoot = join(root, "diesel");
    const releaseDirectory = join(deployRoot, "releases", TEST_RELEASE_SHA);
    const deployDirectory = join(releaseDirectory, "scripts", "deploy");
    const entry = join(deployDirectory, "activate-host-release.sh");
    const rollback = join(deployDirectory, "rollback-host-release.sh");
    const ledger = join(deployDirectory, "host-activation-ledger.sh");
    const rollbackMarker = join(root, "rollback-executed");
    const ledgerMarker = join(root, "ledger-executed");
    const validationLog = join(root, "validation.log");
    await mkdir(deployDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        rollback,
        [
          'printf "rollback-executed\\n" >"${BOOTSTRAP_ROLLBACK_MARKER:?}"',
          'source -- "${BASH_SOURCE[0]%/*}/host-activation-ledger.sh"',
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        ledger,
        'printf "ledger-executed\\n" >"${BOOTSTRAP_LEDGER_MARKER:?}"\n',
        "utf8",
      ),
    ]);

    try {
      const harness = [
        'source -- "$1"',
        'BOOTSTRAP_LOG="$5"',
        'BOOTSTRAP_ROLLBACK_MARKER="$6"',
        'BOOTSTRAP_LEDGER_MARKER="$7"',
        'activate_host_release_require_cli_bootstrap_path() {',
        '  printf "%s|%s\\n" "$1" "$2" >>"${BOOTSTRAP_LOG}"',
        '}',
        'activate_host_release_cli_bootstrap "$2" "$3" "$4"',
      ].join("\n");
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        harness,
        "activation-bootstrap-fixture",
        activateHostReleaseScript,
        TEST_RELEASE_SHA,
        deployRoot,
        entry,
        validationLog,
        rollbackMarker,
        ledgerMarker,
      ]);

      expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
      await expect(readFile(rollbackMarker, "utf8")).resolves.toBe(
        "rollback-executed\n",
      );
      await expect(readFile(ledgerMarker, "utf8")).resolves.toBe(
        "ledger-executed\n",
      );
      const validatedPaths = (await readFile(validationLog, "utf8"))
        .trim()
        .split("\n");
      expect(validatedPaths).toEqual([
        "/opt|system-directory",
        `${deployRoot}|system-directory`,
        `${deployRoot}/releases|system-directory`,
        `${releaseDirectory}|release-directory`,
        `${releaseDirectory}/scripts|release-directory`,
        `${deployDirectory}|release-directory`,
        `${entry}|release-executable`,
        `${rollback}|release-executable`,
        `${ledger}|release-executable`,
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when the validated activation rollback helper fails while sourcing", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-activation-bootstrap-"));
    const deployRoot = join(root, "diesel");
    const releaseDirectory = join(deployRoot, "releases", TEST_RELEASE_SHA);
    const deployDirectory = join(releaseDirectory, "scripts", "deploy");
    const entry = join(deployDirectory, "activate-host-release.sh");
    const rollback = join(deployDirectory, "rollback-host-release.sh");
    await mkdir(deployDirectory, { recursive: true });
    await writeFile(rollback, "return 23\n", "utf8");

    try {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        [
          'source -- "$1"',
          "activate_host_release_require_cli_bootstrap_path() { :; }",
          'activate_host_release_cli_bootstrap "$2" "$3" "$4"',
        ].join("\n"),
        "activation-bootstrap-fixture",
        activateHostReleaseScript,
        TEST_RELEASE_SHA,
        deployRoot,
        entry,
      ]);

      expect(result).toEqual({ exitCode: 70, stderr: "", stdout: "" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("activates one ready release in the fail-closed host order", async () => {
    const fixture = await createActivationFixture();
    try {
      const result = await executeActivation(fixture);

      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(result.stdout).toContain("Host activation completed");
      await expect(realpath(fixture.currentLink)).resolves.toBe(
        fixture.failedRelease,
      );
      await expect(readFile(fixture.environmentPath, "utf8")).resolves.toBe(
        "NEW_ENV=1\n",
      );
      await expect(readFile(fixture.nginxPrimaryPath, "utf8")).resolves.toBe(
        "candidate primary nginx\n",
      );
      await expect(
        readFile(fixture.nginxAlternatePath, "utf8"),
      ).resolves.toBe("candidate alternate nginx\n");
      await expect(readFile(fixture.pm2State, "utf8")).resolves.toBe(
        TEST_RELEASE_SHA,
      );
      await expectActivationLedgerBasisUnchanged(fixture);

      const lifecycleEvents = (await readLifecycleLog(fixture))
        .trim()
        .split("\n");
      let cursor = -1;
      const expectAfter = (event: string): number => {
        const eventIndex = lifecycleEvents.indexOf(event, cursor + 1);
        expect(eventIndex, `missing ordered activation event: ${event}`).toBeGreaterThan(
          cursor,
        );
        cursor = eventIndex;
        return eventIndex;
      };

      expectAfter("ledger-pending:1");
      expectAfter(`check-ready:${TEST_RELEASE_SHA}`);
      expectAfter("ledger-pending:2");
      const offlineNginxIndex = lifecycleEvents.findIndex(
        (event, index) => index > cursor && event.startsWith("nginx-offline-test:"),
      );
      expect(offlineNginxIndex).toBeGreaterThan(cursor);
      cursor = offlineNginxIndex;
      expectAfter("ledger-pending:3");
      expectAfter(`live-nginx-rename:${fixture.nginxPrimaryPath}`);
      expectAfter(`live-nginx-rename:${fixture.nginxAlternatePath}`);
      expectAfter("nginx-test");
      for (const durablePath of [
        fixture.environmentPath,
        join(fixture.deployRoot, "shared"),
        fixture.nginxPrimaryPath,
        fixture.nginxAlternatePath,
        fixture.nginxSitesRoot,
      ]) {
        expectAfter(`fsync:${durablePath}`);
      }
      expectAfter("ledger-pending:4");
      expectAfter("current-switch");
      expectAfter(`fsync:${fixture.deployRoot}`);
      expectAfter("pm2-delete:diesel-demo");
      expectAfter(
        `pm2-start:${TEST_RELEASE_SHA}:${fixture.currentLink}/deploy/ecosystem.config.cjs`,
      );
      expectAfter("ps-uid:321");
      expectAfter("ps-gid:321");
      const readinessIndex = lifecycleEvents.findIndex(
        (event, index) => index > cursor && event.startsWith("curl-ready:"),
      );
      expect(readinessIndex).toBeGreaterThan(cursor);
      const readinessEvent = lifecycleEvents[readinessIndex] ?? "";
      expect(readinessEvent).toContain("--disable");
      expect(readinessEvent).toContain("--max-filesize 65536");
      expect(readinessEvent).toContain("--dump-header");
      expect(readinessEvent).toContain("--noproxy *");
      expect(readinessEvent).toContain("--proto =http");
      expect(readinessEvent).toContain(
        "http://127.0.0.1:8788/api/health/ready",
      );
      cursor = readinessIndex;
      expectAfter("ledger-pending:5");
      const saveIndex = expectAfter("pm2-save");
      const durablePm2Index = await expectDurablePm2Validation(
        fixture,
        TEST_RELEASE_SHA,
        saveIndex,
      );
      cursor = durablePm2Index;
      expectAfter("systemctl:is-enabled --quiet pm2-root");
      expectAfter("systemctl:is-active --quiet pm2-root");
      expectAfter("ledger-pending:6");
      expectAfter("systemctl:reload nginx");
      expect(lifecycleEvents.filter((event) => event.startsWith("ledger-pending:")))
        .toHaveLength(6);
      expect(lifecycleEvents.some((event) => event.startsWith("fd8-leaked:")))
        .toBe(false);

      const mutations = await readMutationLog(fixture);
      expect(mutations).not.toContain("secret-leaked");
      expect(mutations.match(/^pm2-delete:diesel-demo$/gmu)).toHaveLength(1);
      expect(
        mutations.match(
          new RegExp(
            `^pm2-start:${TEST_RELEASE_SHA.replaceAll("-", "\\-")}:`,
            "gmu",
          ),
        ),
      ).toHaveLength(1);
      expect(mutations.match(/^pm2-save$/gmu)).toHaveLength(1);
      expect(mutations.match(/^systemctl-reload:nginx$/gmu)).toHaveLength(1);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("clears and durably records an exact same-release current.next residue before activation", async () => {
    const fixture = await createActivationFixture();
    const currentNext = join(fixture.deployRoot, "current.next");
    try {
      await symlink(fixture.failedRelease, currentNext);

      const result = await executeActivation(fixture);

      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      await expect(lstat(currentNext)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(realpath(fixture.currentLink)).resolves.toBe(
        fixture.failedRelease,
      );
      const events = (await readLifecycleLog(fixture)).trim().split("\n");
      const secondPendingIndex = events.indexOf("ledger-pending:2");
      const staleFsyncIndex = events.indexOf(`fsync:${fixture.deployRoot}`);
      const offlineNginxIndex = events.findIndex((event) =>
        event.startsWith("nginx-offline-test:"),
      );
      const currentSwitchIndex = events.indexOf("current-switch");
      const durableCurrentIndex = events.indexOf(
        `fsync:${fixture.deployRoot}`,
        staleFsyncIndex + 1,
      );
      expect(staleFsyncIndex).toBeGreaterThan(secondPendingIndex);
      expect(offlineNginxIndex).toBeGreaterThan(staleFsyncIndex);
      expect(currentSwitchIndex).toBeGreaterThan(offlineNginxIndex);
      expect(durableCurrentIndex).toBeGreaterThan(currentSwitchIndex);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects an untrusted current.next object or another release target without deleting it", async () => {
    for (const kind of ["regular-file", "other-target"] as const) {
      const fixture = await createActivationFixture();
      const currentNext = join(fixture.deployRoot, "current.next");
      try {
        if (kind === "regular-file") {
          await writeFile(currentNext, "operator evidence\n", "utf8");
        } else {
          await symlink(fixture.previousRelease, currentNext);
        }

        const result = await executeActivation(fixture);

        expect(result).toMatchObject({ exitCode: 70, stdout: "" });
        expect(result.stderr).toContain(
          "temporary current activation link is not the exact failed-release symlink",
        );
        if (kind === "regular-file") {
          await expect(readFile(currentNext, "utf8")).resolves.toBe(
            "operator evidence\n",
          );
        } else {
          await expect(readlink(currentNext)).resolves.toBe(
            fixture.previousRelease,
          );
        }
        await expect(realpath(fixture.currentLink)).resolves.toBe(
          fixture.previousRelease,
        );
        const lifecycle = await readLifecycleLog(fixture);
        expect(lifecycle).not.toContain("live-nginx-rename:");
        expect(lifecycle).not.toContain("current-switch");
        expect(lifecycle).not.toContain("pm2-start:");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }
  });

  it("durably cleans current.next when the atomic current switch fails before rename", async () => {
    const fixture = await createActivationFixture();
    const currentNext = join(fixture.deployRoot, "current.next");
    try {
      await writeFile(
        join(fixture.root, "activation-current-switch-fail"),
        "fault\n",
        "utf8",
      );

      const result = await executeActivation(fixture);

      expect(result).toMatchObject({ exitCode: 96, stdout: "" });
      await expect(lstat(currentNext)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(realpath(fixture.currentLink)).resolves.toBe(
        fixture.previousRelease,
      );
      const events = (await readLifecycleLog(fixture)).trim().split("\n");
      const switchFailureIndex = events.indexOf(
        "current-switch-fail-before-rename",
      );
      const cleanupFsyncIndex = events.indexOf(
        `fsync:${fixture.deployRoot}`,
        switchFailureIndex + 1,
      );
      expect(switchFailureIndex).toBeGreaterThan(-1);
      expect(cleanupFsyncIndex).toBeGreaterThan(switchFailureIndex);
      expect(events).not.toContain("current-switch");
      expect(events).not.toContain(`pm2-start:${TEST_RELEASE_SHA}:`);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    ["--check-pending-0b5207c", "none", 0],
    ["--recover-pending-0b5207c", "none", 0],
    ["--recover-pending-0b5207c", "preflight", 45],
    ["--recover-pending-0b5207c", "rollback", 46],
    ["--recover-pending-0b5207c", "scan", 47],
  ] as const)("routes incident recovery %s with %s failure honestly", async (mode, fault, expectedCode) => {
    const root = await mkdtemp(join(tmpdir(), "diesel-recovery-routing-"));
    try {
      const source = await readFile(rollbackHostReleaseScript, "utf8");
      const main = source.slice(source.indexOf("rollback_host_release_main() ("),
        source.indexOf("\nrollback_prepare_pending_incident() {"));
      expect(main).toContain("local target_release");
      const entry = join(root, "entry.sh");
      const log = join(root, "calls");
      await writeExecutable(entry, [
        "#!/bin/bash", "set -Eeuo pipefail",
        `rollback_prepare_pending_incident() { printf 'preflight:%s\\n' "$1" >>${quoteShell(log)}; return ${fault === "preflight" ? 45 : 0}; }`,
        `rollback_host_release() { printf 'rollback:%s:%s\\n' "$1" "$2" >>${quoteShell(log)}; return ${fault === "rollback" ? 46 : 0}; }`,
        `host_activation_ledger_scan_all() { printf 'scan:%s\\n' "$3" >>${quoteShell(log)}; return ${fault === "scan" ? 47 : 0}; }`,
        main, 'rollback_host_release_main "$@"',
      ].join("\n"));
      const result = await execFileAsync("bash", [entry, TEST_RELEASE_SHA, mode])
        .then(() => 0, (error: unknown) => (error as { code: number }).code);
      expect(result).toBe(expectedCode);
      const calls = await readFile(log, "utf8");
      expect(calls).toContain(`preflight:${TEST_RELEASE_SHA}`);
      if (fault === "preflight") expect(calls).not.toContain("rollback:");
      else expect(calls).toContain(`rollback:0b5207c17a6b98260733e0e4f470376f23e377b2:${mode === "--check-pending-0b5207c" ? "--check" : "--abort-if-uncommitted"}`);
      if (fault === "preflight" || fault === "rollback" || mode === "--check-pending-0b5207c")
        expect(calls).not.toContain("scan:");
      else expect(calls).toContain("scan:zero-active");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("forbids invoking production incident recovery through a sourced test seam", async () => {
    const result = await execFileAsync("bash", ["-c", 'source "$1"; rollback_prepare_pending_incident "$2"',
      "recovery-test", rollbackHostReleaseScript, TEST_RELEASE_SHA])
      .then(() => 0, (error: unknown) => (error as { code: number }).code);
    expect(result).toBe(64);
  });

  it.each(["activation", "rollback"] as const)(
    "waits for the exact Next startup transition during %s",
    async (operation) => {
      const fixture = operation === "activation"
        ? await createActivationFixture() : await createRollbackFixture();
      try {
        await writeFile(join(fixture.root, "pm2-start-delayed"), "yes");
        const result = operation === "activation"
          ? await executeActivation(fixture)
          : await executeRollback(fixture, "--abort-if-uncommitted");
        expect(result.exitCode ?? 0, result.stderr).toBe(0);
        expect(Number(await readFile(join(fixture.root, "pm2-startup-count"), "utf8"))).toBeGreaterThanOrEqual(3);
        expect(await readMutationLog(fixture)).toContain("pm2-save");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }, 30_000,
  );

  it.each([
    ["pm2-start-pid-change", 0],
    ["pm2-start-unknown-title", 0],
    ["pm2-live-args-drift", 0],
    ["pm2-live-uid-drift", 0],
    ["pm2-live-env-version-drift", 0],
    ["pm2-start-never-ready", 30_000],
  ] as const)("rejects startup %s without saving or terminalizing", async (fault, minimumMs) => {
    const fixture = await createRollbackFixture();
    try {
      await writeFile(join(fixture.root, "pm2-start-delayed"), "yes");
      await writeFile(join(fixture.root, fault), "yes");
      const started = performance.now();
      const result = await executeRollback(fixture, "--abort-if-uncommitted");
      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain("rollback process identity validation failed");
      expect(performance.now() - started).toBeGreaterThanOrEqual(minimumMs);
      expect(await readMutationLog(fixture)).not.toContain("pm2-save");
      expect(await readLifecycleLog(fixture)).not.toContain("ledger-transition:");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 45_000);

  it("does not grant a startup grace period to committed-state validation", async () => {
    const fixture = await createRollbackFixture();
    try {
      await writePublishStateMarker(fixture, "PUBLISH_FINALIZED");
      await writeFile(join(fixture.root, "ledger-terminal"), "COMMITTED:PUBLISH_FINALIZED\n");
      await writeFile(join(fixture.procRoot, "321", "cmdline"), Buffer.from([
        fixture.nodeBinary, "--env-file=.env.production.local", "node_modules/next/dist/bin/next",
        "start", "--hostname", "127.0.0.1", "--port", "8788", "",
      ].join("\0")));
      const result = await executeRollback(fixture, "--validate-committed");
      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain("rollback process identity validation failed");
      expect(await readMutationLog(fixture)).toBe("");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a live Nginx hardlink race before the first live rename without changing the alias", async () => {
    const fixture = await createActivationFixture();
    const aliasPath = join(fixture.root, "primary-nginx-alias");
    const primaryStage = join(
      fixture.nginxSitesRoot,
      ".jamesky.site.activate",
    );
    const alternateStage = join(
      fixture.nginxSitesRoot,
      ".diesel-demo.activate",
    );
    try {
      await writeFile(aliasPath, "old primary nginx\n", "utf8");
      await chmod(aliasPath, 0o644);
      const aliasBefore = await readFile(aliasPath, "utf8");
      const alternateBefore = await stat(fixture.nginxAlternatePath);
      await writeFile(
        join(fixture.root, "activation-live-primary-hardlink-alias"),
        aliasPath,
        "utf8",
      );

      const result = await executeActivation(fixture);

      expect(result).toMatchObject({ exitCode: 70, stdout: "" });
      expect(result.stderr).toContain(
        "live primary Nginx configuration must have one link",
      );
      await expect(readFile(aliasPath, "utf8")).resolves.toBe(aliasBefore);
      expect((await stat(fixture.nginxPrimaryPath)).ino).toBe(
        (await stat(aliasPath)).ino,
      );
      expect((await stat(fixture.nginxAlternatePath)).ino).toBe(
        alternateBefore.ino,
      );
      await expect(lstat(primaryStage)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(alternateStage)).rejects.toMatchObject({ code: "ENOENT" });
      const lifecycle = await readLifecycleLog(fixture);
      expect(lifecycle).toContain(`inject-live-nginx-hardlink:${aliasPath}`);
      expect(lifecycle).not.toContain("live-nginx-rename:");
      expect(lifecycle).not.toContain("current-switch");
      expect(lifecycle).not.toContain("pm2-start:");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("keeps both live Nginx files untouched when offline candidate validation fails", async () => {
    const fixture = await createActivationFixture();
    const primaryStage = join(
      fixture.nginxSitesRoot,
      ".jamesky.site.activate",
    );
    const alternateStage = join(
      fixture.nginxSitesRoot,
      ".diesel-demo.activate",
    );
    try {
      const primaryBefore = await stat(fixture.nginxPrimaryPath);
      const alternateBefore = await stat(fixture.nginxAlternatePath);
      const primaryBytes = await readFile(fixture.nginxPrimaryPath, "utf8");
      const alternateBytes = await readFile(
        fixture.nginxAlternatePath,
        "utf8",
      );
      await writeFile(
        join(fixture.root, "nginx-backup-invalid"),
        "fault\n",
        "utf8",
      );

      const result = await executeActivation(fixture);

      expect(result.exitCode).not.toBe(0);
      await expect(readFile(fixture.nginxPrimaryPath, "utf8")).resolves.toBe(
        primaryBytes,
      );
      await expect(
        readFile(fixture.nginxAlternatePath, "utf8"),
      ).resolves.toBe(alternateBytes);
      expect((await stat(fixture.nginxPrimaryPath)).ino).toBe(primaryBefore.ino);
      expect((await stat(fixture.nginxAlternatePath)).ino).toBe(
        alternateBefore.ino,
      );
      await expect(lstat(primaryStage)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(lstat(alternateStage)).rejects.toMatchObject({ code: "ENOENT" });
      const lifecycle = await readLifecycleLog(fixture);
      expect(lifecycle).toContain("nginx-offline-test:");
      expect(lifecycle).not.toContain("live-nginx-rename:");
      expect(lifecycle).not.toContain("current-switch");
      expect(lifecycle).not.toContain("pm2-start:");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      expectedCurrent: "previous",
      expectedHealth: false,
      expectedHelper: false,
      expectedNginx: "previous",
      expectedPendingProofs: 3,
      expectedPm2: "previous-release",
      expectedPm2Start: false,
      expectedSave: false,
      flag: "pending-fail-at",
      flagContents: "3",
      name: "the pre-Nginx-install PENDING proof",
    },
    {
      expectedCurrent: "previous",
      expectedHealth: false,
      expectedHelper: false,
      expectedNginx: "candidate",
      expectedPendingProofs: 3,
      expectedPm2: "previous-release",
      expectedPm2Start: false,
      expectedSave: false,
      flag: "nginx-fail-once",
      flagContents: "fault",
      name: "installed Nginx validation",
    },
    {
      expectedCurrent: "previous",
      expectedHealth: false,
      expectedHelper: false,
      expectedNginx: "candidate",
      expectedPendingProofs: 3,
      expectedPm2: "previous-release",
      expectedPm2Start: false,
      expectedSave: false,
      flag: "fsync-fail",
      flagContents: "fault",
      name: "Nginx durability",
    },
    {
      expectedCurrent: "candidate",
      expectedHealth: false,
      expectedHelper: false,
      expectedNginx: "candidate",
      expectedPendingProofs: 4,
      expectedPm2: "wrong-release",
      expectedPm2Start: true,
      expectedSave: false,
      flag: "pm2-start-wrong-version",
      flagContents: "fault",
      name: "new PM2 process identity",
    },
    {
      expectedCurrent: "candidate",
      expectedHealth: true,
      expectedHelper: false,
      expectedNginx: "candidate",
      expectedPendingProofs: 4,
      expectedPm2: TEST_RELEASE_SHA,
      expectedPm2Start: true,
      expectedSave: false,
      flag: "activation-health-fail",
      flagContents: "fault",
      name: "loopback readiness version validation",
    },
    ...[
      ["activation-health-extra-field", "exact readiness fields"],
      ["activation-health-missing-timestamp", "required readiness timestamp"],
      ["activation-health-stale-timestamp", "fresh readiness timestamp"],
      ["activation-health-cacheable", "readiness no-store policy"],
    ].map(([flag, name]) => ({
      expectedCurrent: "candidate" as const,
      expectedHealth: true,
      expectedHelper: false,
      expectedNginx: "candidate" as const,
      expectedPendingProofs: 4,
      expectedPm2: TEST_RELEASE_SHA,
      expectedPm2Start: true,
      expectedSave: false,
      flag,
      flagContents: "fault",
      name,
    })),
    {
      expectedCurrent: "candidate",
      expectedHealth: true,
      expectedHelper: true,
      expectedNginx: "candidate",
      expectedPendingProofs: 5,
      expectedPm2: TEST_RELEASE_SHA,
      expectedPm2Start: true,
      expectedSave: true,
      flag: "pm2-helper-fail",
      flagContents: "fault",
      name: "durable PM2 persistence",
    },
  ] as const)(
    "stops after $name fails",
    async ({
      expectedCurrent,
      expectedHealth,
      expectedHelper,
      expectedNginx,
      expectedPendingProofs,
      expectedPm2,
      expectedPm2Start,
      expectedSave,
      flag,
      flagContents,
    }) => {
      const fixture = await createActivationFixture();
      try {
        await writeFile(join(fixture.root, flag), flagContents, "utf8");

        const result = await executeActivation(fixture);

        expect(result.exitCode).not.toBe(0);
        await expect(realpath(fixture.currentLink)).resolves.toBe(
          expectedCurrent === "candidate"
            ? fixture.failedRelease
            : fixture.previousRelease,
        );
        await expect(readFile(fixture.nginxPrimaryPath, "utf8")).resolves.toBe(
          expectedNginx === "candidate"
            ? "candidate primary nginx\n"
            : "old primary nginx\n",
        );
        await expect(
          readFile(fixture.nginxAlternatePath, "utf8"),
        ).resolves.toBe(
          expectedNginx === "candidate"
            ? "candidate alternate nginx\n"
            : "old alternate nginx\n",
        );
        await expect(readFile(fixture.pm2State, "utf8")).resolves.toBe(
          expectedPm2,
        );
        await expect(readFile(fixture.environmentPath, "utf8")).resolves.toBe(
          "NEW_ENV=1\n",
        );
        await expectActivationLedgerBasisUnchanged(fixture);

        const lifecycle = await readLifecycleLog(fixture);
        expect(lifecycle.match(/^ledger-pending:[0-9]+$/gmu)).toHaveLength(
          expectedPendingProofs,
        );
        expect(lifecycle.includes("curl-ready:")).toBe(expectedHealth);
        expect(lifecycle.includes(`pm2-helper:${TEST_RELEASE_SHA}`)).toBe(
          expectedHelper,
        );
        expect(lifecycle.includes(`pm2-start:${TEST_RELEASE_SHA}:`)).toBe(
          expectedPm2Start,
        );
        expect(lifecycle.includes("pm2-save")).toBe(expectedSave);
        expect(lifecycle).not.toContain("systemctl:is-enabled --quiet pm2-root");
        expect(lifecycle).not.toContain("systemctl:is-active --quiet pm2-root");
        expect(lifecycle).not.toContain("systemctl:reload nginx");
        expect(lifecycle).not.toContain("fd8-leaked:");
        await expect(
          lstat(join(fixture.deployRoot, "current.next")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          lstat(join(fixture.nginxSitesRoot, ".jamesky.site.activate")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          lstat(join(fixture.nginxSitesRoot, ".diesel-demo.activate")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readMutationLog(fixture)).not.toContain("secret-leaked");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );
});

describe("PM2 durable release state helper", () => {
  const expectedReleaseId = "release-20260901";
  const fixedFailure = "PM2 durable release state validation failed.";

  it("accepts one diesel application with the exact durable PM2 definition", async () => {
    const document = [
      durablePm2Application(expectedReleaseId),
      {
        name: "unrelated-worker",
        env: { APP_VERSION: "unrelated-release" },
      },
    ];

    const result = await executePm2StateHarness(
      "validate",
      expectedReleaseId,
      JSON.stringify(document),
    );

    expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "ok\n" });
  });

  it.each([
    {
      document: [
        durablePm2Application(expectedReleaseId, { env: {} }),
        {
          name: "unrelated-worker",
          env: { APP_VERSION: expectedReleaseId },
        },
      ],
      name: "an unrelated application's version",
    },
    {
      document: [
        durablePm2Application(expectedReleaseId, {
          env: {},
          metadata: { env: { APP_VERSION: expectedReleaseId } },
        }),
      ],
      name: "an unrecognised nested version",
    },
    {
      document: [
        durablePm2Application(expectedReleaseId, {
          pm2_env: { APP_VERSION: "conflicting-release" },
        }),
      ],
      name: "conflicting formal version fields",
    },
    {
      document: [
        durablePm2Application(expectedReleaseId),
        {
          name: "unrelated-worker",
          env: { APP_VERSION: expectedReleaseId },
          pm2_env: { name: "diesel-demo" },
        },
      ],
      name: "a second visible diesel application",
    },
  ] as const)("rejects $name with one fixed error", async ({ document }) => {
    const result = await executePm2StateHarness(
      "validate",
      expectedReleaseId,
      JSON.stringify(document),
    );

    expect(result.exitCode).toBe(70);
    expect(result.stderr).toBe(`${fixedFailure}\n`);
    expect(result.stderr).not.toContain(expectedReleaseId);
  });

  it.each([
    {
      document: durablePm2Application(expectedReleaseId, {
        pm_cwd: "/opt/diesel/releases/unrelated-release",
      }),
      name: "pm_cwd drift",
    },
    {
      document: durablePm2Application(expectedReleaseId, {
        pm_exec_path: PRODUCTION_NODE_BINARY,
      }),
      name: "pm_exec_path drift",
    },
    {
      document: durablePm2Application(expectedReleaseId, {
        exec_interpreter: PRODUCTION_NODE_BINARY,
      }),
      name: "exec_interpreter drift",
    },
    {
      document: durablePm2Application(expectedReleaseId, {
        args: [...expectedProductionPm2Args(expectedReleaseId), "--inspect"],
      }),
      name: "argument drift",
    },
    {
      document: durablePm2Application(expectedReleaseId, { uid: 0 }),
      name: "uid drift",
    },
    {
      document: durablePm2Application(expectedReleaseId, { gid: 0 }),
      name: "gid drift",
    },
  ] as const)("rejects durable $name with one fixed error", async ({ document }) => {
    const result = await executePm2StateHarness(
      "validate",
      expectedReleaseId,
      JSON.stringify([document]),
    );

    expect(result.exitCode).toBe(70);
    expect(result.stderr).toBe(`${fixedFailure}\n`);
    expect(result.stderr).not.toContain(expectedReleaseId);
  });

  it.each([
    {
      document: [
        durablePm2Application(expectedReleaseId, {
          pm_cwd: "/opt/diesel/releases/unrelated-release",
        }),
        durablePm2Application(expectedReleaseId, {
          name: "unrelated-worker",
        }),
      ],
      name: "an unrelated application's exact identity as a decoy",
    },
    {
      document: [
        durablePm2Application(expectedReleaseId, {
          args: undefined,
          exec_interpreter: undefined,
          pm2_env: {
            args: expectedProductionPm2Args(expectedReleaseId),
            exec_interpreter: PRODUCTION_PM2_INTERPRETER,
            pm_cwd: PRODUCTION_PM2_CWD,
            pm_exec_path: PRODUCTION_PM2_EXEC_PATH,
          },
          pm_cwd: undefined,
          pm_exec_path: undefined,
        }),
      ],
      name: "a nested jlist identity as a durable top-level decoy",
    },
    {
      document: [
        durablePm2Application(expectedReleaseId, {
          pm2_env: {
            APP_VERSION: expectedReleaseId,
            args: expectedProductionPm2Args(expectedReleaseId),
            exec_interpreter: PRODUCTION_PM2_INTERPRETER,
            pm_cwd: "/opt/diesel/releases/conflicting-release",
            pm_exec_path: PRODUCTION_PM2_EXEC_PATH,
          },
        }),
      ],
      name: "conflicting top-level and nested visible identities",
    },
  ] as const)("rejects $name", async ({ document }) => {
    const result = await executePm2StateHarness(
      "validate",
      expectedReleaseId,
      JSON.stringify(document),
    );

    expect(result.exitCode).toBe(70);
    expect(result.stderr).toBe(`${fixedFailure}\n`);
    expect(result.stderr).not.toContain(expectedReleaseId);
  });

  it("uses the fixed error for an untrusted PM2 state root", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "diesel-pm2-root-")));
    try {
      await chmod(root, 0o750);
      const result = await executePm2StateHarness(
        "persist",
        expectedReleaseId,
        root,
      );

      expect(result.exitCode).toBe(70);
      expect(result.stderr).toBe(`${fixedFailure}\n`);
      expect(result.stderr).not.toContain(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it(
    "normalizes and durably copies a bounded root-owned dump",
    async (context) => {
      if (!(typeof process.getuid === "function" && process.getuid() === 0)) {
        context.skip();
        return;
      }
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "diesel-pm2-root-")),
      );
      const dumpPath = join(root, "dump.pm2");
      const backupPath = join(root, "dump.pm2.bak");
      const document = [durablePm2Application(expectedReleaseId)];
      try {
        await chmod(root, 0o700);
        await writeFile(dumpPath, `${JSON.stringify(document)}\n`, "utf8");
        await chmod(dumpPath, 0o644);

        const result = await executePm2StateHarness(
          "persist",
          expectedReleaseId,
          root,
        );

        expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "ok\n" });
        await expect(readFile(backupPath)).resolves.toEqual(
          await readFile(dumpPath),
        );
        for (const path of [dumpPath, backupPath]) {
          const metadata = await lstat(path);
          expect(metadata.isFile()).toBe(true);
          expect(metadata.isSymbolicLink()).toBe(false);
          expect(metadata.nlink).toBe(1);
          expect(metadata.uid).toBe(0);
          expect(metadata.gid).toBe(0);
          expect(metadata.mode & 0o777).toBe(0o600);
        }
        expect(await readdir(root)).toEqual(["dump.pm2", "dump.pm2.bak"]);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it(
    "rejects symlinked, multiply linked, and oversized PM2 dumps",
    async (context) => {
      if (!(typeof process.getuid === "function" && process.getuid() === 0)) {
        context.skip();
        return;
      }
      for (const kind of ["hardlink", "oversized", "symlink"] as const) {
        const root = await realpath(
          await mkdtemp(join(tmpdir(), "diesel-pm2-root-")),
        );
        const dumpPath = join(root, "dump.pm2");
        const targetPath = join(root, "target.pm2");
        try {
          await chmod(root, 0o700);
          if (kind === "oversized") {
            await writeFile(dumpPath, Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));
          } else {
            await writeFile(
              targetPath,
              JSON.stringify([
                durablePm2Application(expectedReleaseId),
              ]),
              "utf8",
            );
            if (kind === "hardlink") await link(targetPath, dumpPath);
            else await symlink(targetPath, dumpPath);
          }
          await chmod(kind === "symlink" ? targetPath : dumpPath, 0o600);

          const result = await executePm2StateHarness(
            "persist",
            expectedReleaseId,
            root,
          );

          expect(result.exitCode).toBe(70);
          expect(result.stderr).toBe(`${fixedFailure}\n`);
          expect(result.stderr).not.toContain(root);
        } finally {
          await rm(root, { force: true, recursive: true });
        }
      }
    },
  );
});

describe("versioned deployment scripts", () => {
  it("forwards stage signals only through the active Bash jobspec capability", async () => {
    const source = await readFile(stageReleaseScript, "utf8");

    expect(source).toContain(
      'current_job_pid="$(jobs -p %% 2>/dev/null || true)"',
    );
    expect(source).toContain(
      'if [[ "${current_job_pid}" == "${runner_pid}" ]]; then',
    );
    expect(source).toContain(
      'builtin kill -s "${pending_signal}" "%%" 2>/dev/null || true',
    );
    expect(source).not.toContain(
      'builtin kill -s "${pending_signal}" "${runner_pid}"',
    );
    expect(source).not.toContain(
      'builtin kill -s "${pending_signal}" "${active_bounded_command_pid}"',
    );
  });

  it("stages one clean committed archive before the first remote mutation", async () => {
    const fixture = await createStageReleaseFixture({ realRsync: true });
    try {
      const result = await executeStageRelease(
        fixture.script,
        fixture.repository,
        [fixture.releaseId],
        stageReleaseEnvironment(fixture),
      );
      const events = await readStageReleaseEvents(fixture);

      expect(
        result.exitCode,
        stageReleaseFailureContext(result, fixture, events),
      ).toBe(0);
      const outputLines = result.stdout.trim().split("\n");
      expect(outputLines).toHaveLength(1);
      const receipt = JSON.parse(outputLines[0] ?? "null") as Record<
        string,
        unknown
      >;
      expect(Object.keys(receipt).sort()).toEqual([
        "authorization",
        "commit",
        "format",
        "inputDigest",
        "releaseDir",
        "target",
      ]);
      expect(receipt).toMatchObject({
        authorization: {
          commit: fixture.releaseId,
          format: "diesel-release-authorization-v1",
        },
        commit: fixture.releaseId,
        format: "diesel-release-stage-v1",
        inputDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        releaseDir: `/opt/diesel/releases/${fixture.releaseId}`,
        target: "root@111.228.50.85",
      });
      const capture = JSON.parse(
        await readFile(fixture.rsyncCapture, "utf8"),
      ) as {
        args: string[];
        controlModes: Array<{ mode: number; path: string }>;
        helperSha256: string;
        helperSize: number;
        manifest: {
          commit: string;
          files: Array<{ mode: string; path: string }>;
          format: string;
          inputDigest: string;
        };
        paths: Array<{ mode: number; path: string; type: string }>;
        privateRootMode: number;
        received: {
          rootMode: number;
          paths: Array<{ mode: number; path: string; type: string }>;
        };
      };
      const sourceArgument = capture.args.at(-2);
      if (!sourceArgument) throw new Error("rsync fixture omitted its source argument");
      expect(sourceArgument.startsWith(`${fixture.temporaryRoot}/`)).toBe(true);
      expect(sourceArgument.endsWith("/release/")).toBe(true);
      const expectedTransportEnvironment = {
        HOME: fixture.transportHome,
        LANG: "C",
        LC_ALL: "C",
        PATH: fixture.transportPath,
        SSH_AUTH_SOCK: fixture.transportSocket,
      };
      const expectedTransportEnvironmentKeys = Object.keys(
        expectedTransportEnvironment,
      );
      const expectedSshTransport = [
        fixture.sshPath,
        ...STAGE_SSH_OPTIONS,
      ].join(" ");
      expect(capture.args).toEqual([
        "-a",
        "--no-owner",
        "--no-group",
        "--no-perms",
        "--timeout=60",
        "--rsync-path=umask 022 && /usr/bin/env -i HOME=/root LANG=C LC_ALL=C PATH=/usr/bin:/bin /usr/bin/rsync",
        "-e",
        expectedSshTransport,
        "--",
        sourceArgument,
        `root@111.228.50.85:/opt/diesel/releases/${fixture.releaseId}/`,
      ]);
      expect(capture.helperSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(capture.helperSize).toBeGreaterThan(0);
      expect(capture.manifest).toMatchObject({
        commit: fixture.releaseId,
        format: "diesel-release-input-v2",
      });
      expect(receipt.inputDigest).toBe(capture.manifest.inputDigest);
      expect(JSON.stringify(events)).not.toContain("transport-secret-canary");
      expect(JSON.stringify(events)).not.toContain("postgresql://");
      expect(events.map(({ command }) => command)).toEqual([
        "authorization-read",
        "authorization-validate",
        "ssh",
        "rsync",
        "ssh",
      ]);
      expect(events[2]).toEqual({
        args: [
          ...STAGE_SSH_OPTIONS,
          "root@111.228.50.85",
          ...STAGE_REMOTE_SHELL_PREFIX,
          fixture.releaseId,
        ],
        command: "ssh",
        count: 1,
        environmentKeys: expectedTransportEnvironmentKeys,
      });
      expect(events[3]).toEqual({
        args: capture.args,
        command: "rsync",
        environmentKeys: expectedTransportEnvironmentKeys,
      });
      expect(events[4]).toEqual({
        args: [
          ...STAGE_SSH_OPTIONS,
          "root@111.228.50.85",
          ...STAGE_REMOTE_SHELL_PREFIX,
          fixture.releaseId,
          capture.manifest.inputDigest,
          "11",
          "12",
          "21",
          "22",
          "31",
          "32",
          "1001",
          String(capture.helperSize),
          capture.helperSha256,
        ],
        command: "ssh",
        count: 2,
        environmentKeys: expectedTransportEnvironmentKeys,
      });
      expect(capture.manifest.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ mode: "100644", path: "README.md" }),
          expect.objectContaining({
            mode: "100755",
            path: "scripts/deploy/stage-release.sh",
          }),
          expect.objectContaining({
            mode: "100644",
            path: "scripts/deploy/run-bounded-command.mjs",
          }),
        ]),
      );
      expect(capture.paths).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ".release-input-manifest.json",
            type: "file",
          }),
          expect.objectContaining({
            path: "scripts/deploy/stage-release.sh",
            type: "file",
          }),
        ]),
      );
      expect(capture.paths.some(({ path }) => path === ".git")).toBe(false);
      // Exercise the actual Git archive, production extraction and rsync, not
      // hand-created 0644 fixtures that mask a private-umask export defect.
      expect(capture.privateRootMode).toBe(0o700);
      expect(capture.controlModes).toEqual([
        { path: "authorization.json", mode: 0o600 },
        { path: "release.tar", mode: 0o600 },
        { path: "remote-preflight.sh", mode: 0o600 },
      ]);
      expect(capture.received.rootMode).toBe(0o750);
      for (const paths of [capture.paths, capture.received.paths]) {
        for (const file of capture.manifest.files) {
          expect(paths.find(({ path }) => path === file.path)).toEqual({
            path: file.path,
            type: "file",
            mode: file.mode === "100755" ? 0o755 : 0o644,
          });
        }
        for (const directory of paths.filter(({ type }) => type === "directory")) {
          expect(directory.mode, directory.path).toBe(0o755);
        }
        expect(paths.find(({ path }) => path === ".release-input-manifest.json"))
          .toEqual({ path: ".release-input-manifest.json", type: "file", mode: 0o600 });
      }
      expect(JSON.stringify(capture)).not.toContain("PRIVATE_CANARY");
      await expect(readdir(fixture.temporaryRoot)).resolves.toEqual([]);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 30_000);

  it.each([
    { boundedCommandReceiptFault: "missing", label: "missing" },
    { boundedCommandReceiptFault: "malformed", label: "malformed" },
    { boundedCommandReceiptFault: "hardlink", label: "multiply linked" },
    { boundedCommandReceiptFault: "token-mismatch", label: "token-mismatched" },
    { boundedCommandReceiptFault: "exit-mismatch", label: "exit-mismatched" },
  ] as const)(
    "fails closed and preserves staging state for a $label containment receipt",
    async ({ boundedCommandReceiptFault }) => {
      const fixture = await createStageReleaseFixture({
        boundedCommandReceiptFault,
      });
      try {
        const result = await executeStageRelease(
          fixture.script,
          fixture.repository,
          [fixture.releaseId],
          stageReleaseEnvironment(fixture),
        );
        const events = await readStageReleaseEvents(fixture);

        expect(
          result.exitCode,
          stageReleaseFailureContext(result, fixture, events),
        ).toBe(70);
        expect(result.stdout).not.toContain("diesel-release-stage-v1");
        expect(result.stderr).toContain(
          "bounded command did not provide a trustworthy containment receipt:",
        );
        expect(result.stderr).toContain(
          "remote release preflight failed (bounded command status 126)",
        );
        expect(result.stderr).toContain(
          "bounded command containment is unproven; preserving local staging state for operator inspection:",
        );
        expect(events.map(({ command }) => command)).toEqual([
          "authorization-read",
          "authorization-validate",
          "ssh",
        ]);
        const preservedEntries = await readdir(fixture.temporaryRoot);
        expect(preservedEntries).toHaveLength(1);
        await expect(
          stat(join(fixture.temporaryRoot, preservedEntries[0] ?? "")),
        ).resolves.toMatchObject({ mode: expect.any(Number) });
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it.each([
    { expectedExitCode: 129, signal: "SIGHUP" },
    { expectedExitCode: 130, signal: "SIGINT" },
    { expectedExitCode: 143, signal: "SIGTERM" },
  ] as const)(
    "forwards a direct stage $signal to the active command group and returns $expectedExitCode",
    async ({ expectedExitCode, signal }) => {
      const fixture = await createStageReleaseFixture({ sshMode: "hang-first" });
      const child = spawn(fixture.script, [fixture.releaseId], {
        cwd: fixture.repository,
        env: stageReleaseEnvironment(fixture),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let sshPid: number | undefined;
      let runnerPid: number | undefined;
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      const resultPromise = new Promise<CommandResult>((resolveResult, reject) => {
        child.once("error", reject);
        child.once("close", (code) => {
          resolveResult({
            exitCode: code ?? -1,
            stderr: Buffer.concat(stderr).toString("utf8"),
            stdout: Buffer.concat(stdout).toString("utf8"),
          });
        });
      });

      try {
        await waitForFileContents(
          fixture.sshReadyPath,
          10_000,
          () => child.exitCode !== null || child.signalCode !== null,
        );
        sshPid = await readOptionalTestPid(fixture.sshPidPath);
        runnerPid = await readOptionalTestPid(fixture.runnerPidPath);
        expect(sshPid).toBeTypeOf("number");
        expect(runnerPid).toBeTypeOf("number");
        if (sshPid === undefined) throw new Error("fake SSH PID was not recorded");
        if (runnerPid === undefined) throw new Error("runner PID was not recorded");
        expect(stageProcessIsRunning(sshPid)).toBe(true);

        const signalledAt = Date.now();
        expect(child.kill(signal)).toBe(true);
        const result = await waitForBoundedPromise(
          resultPromise,
          5_000,
          "stage signal shutdown",
        );

        expect(result.exitCode).toBe(expectedExitCode);
        expect(Date.now() - signalledAt).toBeLessThan(5_000);
        expect(result.stdout).not.toContain("diesel-release-stage-v1");
        expect(result.stderr).not.toContain("remote release preflight failed");
        expect(
          (await readStageReleaseEvents(fixture)).map(
            ({ command, signal }) => signal ? `${command}:${signal}` : command,
          ),
        ).toEqual([
          "authorization-read",
          "authorization-validate",
          "ssh",
          `ssh-signal:${signal}`,
        ]);
        await waitForStageProcessExit(sshPid);
        await waitForStageProcessExit(runnerPid);
        await expect(readdir(fixture.temporaryRoot)).resolves.toEqual([]);
      } finally {
        const cleanupErrors: string[] = [];
        sshPid ??= await readOptionalTestPid(fixture.sshPidPath);
        runnerPid ??= await readOptionalTestPid(fixture.runnerPidPath);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM");
        }
        let settled = await waitForPromiseSettlement(resultPromise, 2_000);
        if (!settled) {
          for (const pid of [sshPid, runnerPid]) {
            try {
              signalTestProcess(pid, "SIGKILL");
            } catch (error: unknown) {
              cleanupErrors.push(
                error instanceof Error ? error.message : String(error),
              );
            }
          }
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
          const knownPids = [sshPid, runnerPid].filter(
            (pid): pid is number => pid !== undefined,
          );
          const [settledAfterKill, ...processExitResults] = await Promise.all([
            waitForPromiseSettlement(resultPromise, 2_000),
            ...knownPids.map((pid) => stageProcessExited(pid, 2_000)),
          ]);
          settled = settledAfterKill;
          for (const [index, exited] of processExitResults.entries()) {
            if (!exited) {
              cleanupErrors.push(
                `test process ${knownPids[index]} survived SIGKILL`,
              );
            }
          }
        }
        if (!settled) {
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          cleanupErrors.push("stage command pipes did not close after cleanup");
        }
        try {
          await rm(fixture.root, { force: true, recursive: true });
        } catch (error: unknown) {
          cleanupErrors.push(
            error instanceof Error ? error.message : String(error),
          );
        }
        expect(cleanupErrors).toEqual([]);
      }
    },
    30_000,
  );

  it("drops inherited tool startup hooks before any staged child process", async () => {
    const fixture = await createStageReleaseFixture();
    const startupMarker = join(fixture.root, "startup-injection.marker");
    const nodeRequireHook = join(fixture.root, "startup-injection.cjs");
    try {
      await writeFile(
        nodeRequireHook,
        [
          'require("node:fs").writeFileSync(',
          `  ${JSON.stringify(startupMarker)},`,
          '  "startup injection executed\\n",',
          ');',
          "",
        ].join("\n"),
        "utf8",
      );
      const result = await executeStageRelease(
        fixture.script,
        fixture.repository,
        [fixture.releaseId],
        stageReleaseEnvironment(fixture, {
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "core.fsmonitor",
          GIT_CONFIG_VALUE_0: nodeRequireHook,
          GIT_DIR: join(fixture.root, "missing-git-dir"),
          NODE_OPTIONS: `--require=${nodeRequireHook}`,
          NODE_PATH: join(fixture.root, "hostile-node-path"),
          RSYNC_RSH: nodeRequireHook,
          SSH_ASKPASS: nodeRequireHook,
          TAR_OPTIONS: "--definitely-invalid",
          npm_config_node_options: `--require=${nodeRequireHook}`,
        }),
      );
      const events = await readStageReleaseEvents(fixture);

      expect(
        result.exitCode,
        stageReleaseFailureContext(result, fixture, events),
      ).toBe(0);
      expect(result.stderr).not.toContain("startup injection executed");
      expect(JSON.parse(result.stdout)).toMatchObject({
        commit: fixture.releaseId,
        format: "diesel-release-stage-v1",
      });
      await expect(lstat(startupMarker)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readdir(fixture.temporaryRoot)).resolves.toEqual([]);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 30_000);

  it.each([
    ".env.production.local",
    "node_modules/private.txt",
    ".data/private.txt",
  ])(
    "rejects committed sensitive release input %s before remote mutation",
    async (forbiddenPath) => {
      const fixture = await createStageReleaseFixture({ forbiddenPath });
      try {
        const result = await executeStageRelease(
          fixture.script,
          fixture.repository,
          [fixture.releaseId],
          stageReleaseEnvironment(fixture),
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).not.toContain("diesel-release-stage-v1");
        expect(await readStageReleaseEvents(fixture)).toEqual([]);
        await expect(readdir(fixture.temporaryRoot)).resolves.toEqual([]);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    {
      label: "tracked drift",
      mutate: async (fixture: StageReleaseFixture) => {
        await writeFile(
          join(fixture.repository, "README.md"),
          "dirty tracked release input\n",
          "utf8",
        );
      },
    },
    {
      label: "untracked drift",
      mutate: async (fixture: StageReleaseFixture) => {
        await writeFile(
          join(fixture.repository, ".env.local"),
          "PRIVATE_CANARY\n",
          "utf8",
        );
      },
    },
  ])("rejects $label before remote mutation", async ({ mutate }) => {
    const fixture = await createStageReleaseFixture();
    try {
      await mutate(fixture);
      const result = await executeStageRelease(
        fixture.script,
        fixture.repository,
        [fixture.releaseId],
        stageReleaseEnvironment(fixture),
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("diesel-release-stage-v1");
      expect(
        (await readStageReleaseEvents(fixture)).some(({ command }) =>
          command === "ssh" || command === "rsync"
        ),
      ).toBe(false);
      await expect(readdir(fixture.temporaryRoot)).resolves.toEqual([]);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      indexFlag: "--assume-unchanged",
      label: "assume-unchanged stage script drift",
      path: "scripts/deploy/stage-release.sh",
    },
    {
      indexFlag: "--skip-worktree",
      label: "skip-worktree manifest helper drift",
      path: "scripts/deploy/release-input-manifest.mjs",
    },
    {
      indexFlag: "--assume-unchanged",
      label: "assume-unchanged bounded command helper drift",
      path: "scripts/deploy/run-bounded-command.mjs",
    },
    {
      indexFlag: "--assume-unchanged",
      label: "assume-unchanged ordinary payload drift",
      path: "README.md",
    },
  ])(
    "rejects $label from a committed script outside the repository",
    async ({ indexFlag, path }) => {
      const fixture = await createStageReleaseFixture();
      try {
        expect(fixture.script.startsWith(`${fixture.repository}/`)).toBe(false);
        await runStageFixtureGit(fixture.repository, [
          "update-index",
          indexFlag,
          path,
        ]);
        const driftedPath = join(fixture.repository, ...path.split("/"));
        await writeFile(
          driftedPath,
          `${await readFile(driftedPath, "utf8")}# hidden drift\n`,
          "utf8",
        );
        expect(
          await runStageFixtureGit(fixture.repository, [
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--ignore-submodules=none",
          ]),
        ).toBe("");

        const result = await executeStageRelease(
          fixture.script,
          fixture.repository,
          [fixture.releaseId],
          stageReleaseEnvironment(fixture),
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).not.toContain("diesel-release-stage-v1");
        expect(await readStageReleaseEvents(fixture)).toEqual([]);
        await expect(readdir(fixture.temporaryRoot)).resolves.toEqual([]);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it("rejects missing, malformed, mismatched, or extra CLI input before remote mutation", async () => {
    const fixture = await createStageReleaseFixture();
    try {
      for (const args of [
        [],
        ["not-a-commit"],
        [TEST_RELEASE_SHA],
        [fixture.releaseId, "unexpected"],
      ]) {
        const result = await executeStageRelease(
          fixture.script,
          fixture.repository,
          args,
          stageReleaseEnvironment(fixture),
        );
        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).not.toContain("diesel-release-stage-v1");
      }

      expect(
        (await readStageReleaseEvents(fixture)).some(({ command }) =>
          command === "ssh" || command === "rsync"
        ),
      ).toBe(false);
      await expect(readdir(fixture.temporaryRoot)).resolves.toEqual([]);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      expectedCommands: ["authorization-read"],
      label: "empty authorization output",
      options: {
        authorizationMode: "empty-output" as const,
      },
    },
    {
      expectedCommands: ["authorization-read"],
      label: "oversized authorization output",
      options: {
        authorizationMode: "oversized-output" as const,
      },
    },
    {
      expectedCommands: ["authorization-read", "authorization-validate"],
      label: "authorization validation",
      options: {
        authorizationMode: "validation-failure" as const,
      },
    },
    {
      expectedCommands: ["authorization-read", "authorization-validate", "ssh"],
      label: "remote directory creation",
      options: { sshFailureAt: 1 as const },
    },
    {
      expectedCommands: ["authorization-read", "authorization-validate", "ssh"],
      label: "remote identity with extra trailing data",
      options: { remoteIdentityOutputMode: "extra-newline" as const },
    },
    {
      expectedCommands: ["authorization-read", "authorization-validate", "ssh"],
      label: "remote identity output overflow",
      options: { remoteIdentityOutputMode: "oversized" as const },
    },
    {
      expectedCommands: [
        "authorization-read",
        "authorization-validate",
        "ssh",
        "rsync",
      ],
      expectedBoundedStatus: 43,
      label: "archive transfer",
      options: { rsyncFailure: true },
    },
    {
      expectedCommands: [
        "authorization-read",
        "authorization-validate",
        "ssh",
        "rsync",
        "ssh",
      ],
      label: "remote digest readback",
      options: { sshFailureAt: 2 as const },
    },
    {
      expectedCommands: [
        "authorization-read",
        "authorization-validate",
        "ssh",
        "rsync",
        "ssh",
      ],
      label: "remote digest mismatch",
      options: { remoteDigestMismatch: true },
    },
  ])(
    "fails closed at $label and does not execute a later stage",
    async ({ expectedBoundedStatus, expectedCommands, options }) => {
      const fixture = await createStageReleaseFixture(options);
      try {
        const result = await executeStageRelease(
          fixture.script,
          fixture.repository,
          [fixture.releaseId],
          stageReleaseEnvironment(fixture),
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).not.toContain("diesel-release-stage-v1");
        if (expectedBoundedStatus !== undefined) {
          expect(result.stderr).toContain(
            `release archive transfer failed (bounded command status ${expectedBoundedStatus})`,
          );
        }
        const events = await readStageReleaseEvents(fixture);
        const actualCommands = events.map(
          ({ command }) => command,
        );
        expect(
          actualCommands,
          stageReleaseFailureContext(result, fixture, events),
        ).toEqual(expectedCommands);
        await expect(readdir(fixture.temporaryRoot)).resolves.toEqual([]);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it("keeps the Linux release handoff helper executable and syntax-valid", async () => {
    const metadata = await stat(linuxReleaseHandoffScript);
    expect(metadata.mode & 0o100).toBe(0o100);
    await expect(
      execFileAsync("bash", ["-n", linuxReleaseHandoffScript]),
    ).resolves.toMatchObject({ stderr: "" });
  });

  it(
    "keeps an inherited lifecycle flock on the same open file description until the orphan exits",
    async (context) => {
      if (process.platform !== "linux") {
        context.skip();
        return;
      }
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "diesel-lifecycle-flock-")),
      );
      const lockPath = join(root, ".release-lifecycle.lock");
      try {
        await writeFile(lockPath, "", "utf8");
        await chmod(lockPath, 0o600);
        const script = [
          "set -euo pipefail",
          'lock_path="$1"',
          'ready_path="${lock_path}.ready"',
          'release_path="${lock_path}.release"',
          'exec 8<>"${lock_path}"',
          "flock -n 8",
          "(",
          "  flock -n 8",
          "  printf 'sibling-reentrant\\n'",
          '  : >"${ready_path}"',
          '  while [[ ! -e "${release_path}" ]]; do sleep 0.01; done',
          ") &",
          'sibling_pid="$!"',
          "for ((attempt = 0; attempt < 500; attempt += 1)); do",
          '  [[ -e "${ready_path}" ]] && break',
          '  kill -0 "${sibling_pid}" 2>/dev/null',
          "  sleep 0.01",
          "done",
          '[[ -e "${ready_path}" ]]',
          "exec 8>&-",
          "if bash -c 'exec 8<>\"$1\"; flock -n 8' reopen-while-orphan \"${lock_path}\" 2>/dev/null; then",
          "  exit 81",
          "fi",
          "printf 'reopen-blocked-while-orphan-held-lock\\n'",
          ': >"${release_path}"',
          'wait "${sibling_pid}"',
          "bash -c 'exec 8<>\"$1\"; flock -n 8' reopen-after-orphan \"${lock_path}\"",
          "printf 'reopen-succeeded-after-orphan-exit\\n'",
        ].join("\n");

        const result = await execFileAsync(
          "bash",
          ["-c", script, "lifecycle-flock-fixture", lockPath],
          { env: { ...process.env } },
        );

        expect(String(result.stderr)).toBe("");
        expect(String(result.stdout).trim().split("\n")).toEqual([
          "sibling-reentrant",
          "reopen-blocked-while-orphan-held-lock",
          "reopen-succeeded-after-orphan-exit",
        ]);
        expect(script).not.toContain("flock -u");
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
    15_000,
  );

  it(
    "makes the host ledger accept an inherited locked OFD and reject a separately opened FD8",
    async (context) => {
      if (process.platform !== "linux") {
        context.skip();
        return;
      }
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "diesel-ledger-flock-proof-")),
      );
      const deployRoot = join(root, "deploy");
      const lockPath = join(deployRoot, ".release-lifecycle.lock");
      try {
        await mkdir(deployRoot);
        await writeFile(lockPath, "", "utf8");
        await chmod(lockPath, 0o600);
        const script = [
          "set -euo pipefail",
          'deploy_root="$1"',
          'ledger_script="$2"',
          'exec 8<>"${deploy_root}/.release-lifecycle.lock"',
          "flock -n 8",
          "export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8",
          'source "${ledger_script}"',
          'host_activation_ledger_require_lifecycle_lock "${deploy_root}"',
          "printf 'parent-reentrant-ok\\n'",
          "bash -c 'source \"$2\"; host_activation_ledger_require_lifecycle_lock \"$1\"' inherited \"${deploy_root}\" \"${ledger_script}\"",
          "printf 'inherited-sibling-reentrant-ok\\n'",
          "if bash -c 'exec 8>&-; exec 8<>\"$1/.release-lifecycle.lock\"; export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8; source \"$2\"; host_activation_ledger_require_lifecycle_lock \"$1\"' distinct \"${deploy_root}\" \"${ledger_script}\" 2>/dev/null; then",
          "  exit 81",
          "fi",
          "printf 'distinct-ofd-rejected\\n'",
        ].join("\n");

        const result = await execFileAsync(
          "/bin/bash",
          [
            "-c",
            script,
            "host-ledger-flock-proof",
            deployRoot,
            hostActivationLedgerScript,
          ],
          { env: { ...process.env } },
        );

        expect(String(result.stderr)).toBe("");
        expect(String(result.stdout).trim().split("\n")).toEqual([
          "parent-reentrant-ok",
          "inherited-sibling-reentrant-ok",
          "distinct-ofd-rejected",
        ]);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
    15_000,
  );

  it("rejects malformed Linux handoff input before any privileged preflight", async () => {
    const result = await executeLinuxReleaseHandoff(
      ["not-a-commit", "/tmp", process.execPath, "/tmp"],
      { ...process.env },
    );

    expect(result).toMatchObject({ exitCode: 64, stdout: "" });
    expect(result.stderr).toContain("usage: linux-release-handoff-smoke.sh");
  });

  it("refuses self-hosted or locally spoofed Linux handoff execution", async () => {
    const result = await executeLinuxReleaseHandoff(
      [TEST_RELEASE_SHA, "/tmp", process.execPath, "/tmp"],
      {
        ...process.env,
        CI: "true",
        GITHUB_ACTIONS: "true",
        RUNNER_ENVIRONMENT: "self-hosted",
      },
    );

    expect(result).toMatchObject({ exitCode: 77, stdout: "" });
    expect(result.stderr).toContain("only runs on a GitHub-hosted CI runner");
  });

  it("binds the Linux smoke to real identities, handoff code, and exact cleanup", async () => {
    const script = await readFile(linuxReleaseHandoffScript, "utf8");

    expect(script).toContain("RUNNER_ENVIRONMENT:-");
    expect(script).toContain("'github-hosted'");
    expect(script).toContain("LINUX_RELEASE_HANDOFF_DEPLOY_ROOT=''");
    expect(script).toContain('groupadd --system --gid "${runtime_gid}" diesel');
    expect(script).toContain(
      'useradd --system --uid "${builder_uid}" --gid diesel-build',
    );
    expect(script).toContain("rsync -a --no-owner --no-group --no-perms");
    expect(script).toContain(
      'install -d -m 0710 -o root -g diesel-build "${build_root}"',
    );
    expect(script).toContain(
      '"${deploy_root}/.release-build.lock"',
    );
    expect(script).toContain("systemctl systemd systemd-run timeout");
    expect(script).toContain(
      'source "${release_dir}/scripts/deploy/prepare-release-runtime.sh"',
    );
    expect(script).toContain(
      "# the outer EXIT trap must remain authoritative for identities and temp root.",
    );
    expect(script).toContain("prepare_release_runtime");
    expect(script).toContain('"${node_binary}" \\\n      "/proc"');
    expect(script).toContain(
      'check-ready "${release_id}" .build-complete .deploy-ready',
    );
    expect(script).toContain(
      '0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}"',
    );
    expect(script).toContain(
      '"check-ready accepted a group-writable immutable artifact"',
    );
    expect(script).toContain(
      '"check-ready accepted a runtime-owned immutable artifact"',
    );
    expect(script).toContain(
      '"check-ready accepted a runtime-owned releases directory"',
    );
    expect(script).toContain(
      '"check-ready accepted a runtime-owned deployment root"',
    );
    expect(script).toContain(
      'for identity_uid in "${runtime_uid}" "${builder_uid}"; do',
    );
    expect(script).toContain("linux_release_handoff_uid_has_processes");
    expect(script).toContain("prepare_release_require_unit_absent");
    expect(script).toContain("prepare_release_require_control_group_absent");
    expect(script).toContain("prepare_release_control_group_has_processes");
    expect(script).toContain("linux_release_handoff_run_cgroup_canary");
    expect(script).toContain("linux_release_handoff_run_status_canary");
    expect(script).toContain('exec 8<>"${deploy_root}/.release-lifecycle.lock"');
    expect(script).toContain("export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8");
    expect(script).toContain("host_activation_ledger_initialize_protocol");
    expect(script).toContain("host_activation_ledger_begin");
    expect(script).toContain("host_activation_ledger_require_pending");
    expect(script.indexOf("    linux_release_handoff_begin_fixture"))
      .toBeLessThan(script.indexOf("    prepare_release_runtime"));
    expect(script).not.toContain("PUBLISH_FINALIZED");
    expect(script).toContain("'/usr/bin/sleep 300 &'");
    expect(script).toContain("payload_terminal_command='exit 23'");
    expect(script).toContain(
      "payload_terminal_command='trap - TERM; kill -TERM \"$$\"; exit 99'",
    );
    expect(script).toContain("expected_status=23");
    expect(script).toContain("expected_status=143");
    expect(script).toContain('"${BUILD_HOME}/payload-started"');
    expect(script).toContain("canary_marker_lines");
    expect(script).toContain(
      '"background-child canary returned ${canary_status}, expected fail-closed 70"',
    );
    expect(
      script.indexOf("  linux_release_handoff_run_cgroup_canary"),
    ).toBeLessThan(script.indexOf("    prepare_release_runtime"));
    expect(
      script.lastIndexOf("  linux_release_handoff_run_status_canary"),
    ).toBeLessThan(script.indexOf("    prepare_release_runtime"));
    expect(script).toContain("processes survived cleanup");
    expect(script).toContain(
      '"${LINUX_RELEASE_HANDOFF_DEPLOY_ROOT%/*}" != "${LINUX_RELEASE_HANDOFF_RUNNER_TEMP}"',
    );
    expect(script).toContain("LINUX_RELEASE_HANDOFF_DEPLOY_ROOT_DEVICE_INODE");
    expect(script).not.toContain("/opt/diesel");
    expect(script).not.toContain("AI_API_KEY");
  });

  it.each(deployScripts)("%s is executable in release archives", async (name) => {
    const metadata = await stat(resolve(process.cwd(), "scripts/deploy", name));
    expect(metadata.mode & 0o100).toBe(0o100);
  });

  it.each(deployScripts)("%s passes Bash syntax validation", async (name) => {
    await expect(
      execFileAsync("bash", [
        "-n",
        resolve(process.cwd(), "scripts/deploy", name),
      ]),
    ).resolves.toMatchObject({ stderr: "" });
  });

  it.each(["REMOTE_PREFLIGHT", "REMOTE_POSTCHECK"] as const)(
    "stage-release.sh %s heredoc passes independent Bash syntax validation",
    async (marker) => {
      const source = await readFile(stageReleaseScript, "utf8");
      const opening = `<<'${marker}'\n`;
      const openingIndex = source.indexOf(opening);
      expect(openingIndex).toBeGreaterThanOrEqual(0);
      const bodyStart = openingIndex + opening.length;
      const closing = `\n${marker}\n`;
      const bodyEnd = source.indexOf(closing, bodyStart);
      expect(bodyEnd).toBeGreaterThan(bodyStart);
      expect(source.indexOf(opening, bodyStart)).toBe(-1);

      const fixture = await mkdtemp(join(tmpdir(), "diesel-stage-heredoc-"));
      const scriptPath = join(fixture, `${marker.toLowerCase()}.sh`);
      try {
        await writeFile(scriptPath, source.slice(bodyStart, bodyEnd), "utf8");
        await expect(
          execFileAsync("/bin/bash", ["-n", scriptPath]),
        ).resolves.toMatchObject({ stderr: "" });
      } finally {
        await rm(fixture, { force: true, recursive: true });
      }
    },
  );

  it("preserves the pre-created release root and executable semantics during rsync", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "diesel-release-rsync-"));
    const source = join(fixture, "source");
    const destination = join(fixture, "destination");
    const plainFile = join(source, "plain.txt");
    const executableFile = join(source, "scripts", "deploy.sh");
    const relativeLink = join(source, "current-script");
    try {
      await Promise.all([
        mkdir(join(source, "scripts"), { recursive: true }),
        mkdir(destination),
      ]);
      await Promise.all([
        writeFile(plainFile, "plain\n", "utf8"),
        writeFile(executableFile, "#!/bin/sh\nexit 0\n", "utf8"),
      ]);
      await Promise.all([
        chmod(source, 0o755),
        chmod(destination, 0o750),
        chmod(plainFile, 0o644),
        chmod(executableFile, 0o755),
        symlink("scripts/deploy.sh", relativeLink),
      ]);

      await execFileAsync("rsync", [
        "-a",
        "--no-owner",
        "--no-group",
        "--no-perms",
        `${source}/`,
        `${destination}/`,
      ]);

      const [destinationMetadata, plainMetadata, executableMetadata, linkMetadata] =
        await Promise.all([
          stat(destination),
          stat(join(destination, "plain.txt")),
          stat(join(destination, "scripts", "deploy.sh")),
          lstat(join(destination, "current-script")),
        ]);
      expect(destinationMetadata.mode & 0o777).toBe(0o750);
      expect(plainMetadata.mode & 0o111).toBe(0);
      expect(executableMetadata.mode & 0o111).not.toBe(0);
      expect(linkMetadata.isSymbolicLink()).toBe(true);
      await expect(readlink(join(destination, "current-script"))).resolves.toBe(
        "scripts/deploy.sh",
      );
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  it("removes only the exact per-release build directory", async () => {
    const fixture = await realpath(
      await mkdtemp(join(tmpdir(), "diesel-exact-build-cleanup-")),
    );
    const releasePath = join(fixture, TEST_RELEASE_SHA);
    await mkdir(releasePath);
    await writeFile(join(releasePath, "partial-output"), "partial\n", "utf8");
    try {
      await expect(
        execFileAsync("/bin/bash", [
          "-c",
          'source "$1"; prepare_release_remove_exact_directory "$2" "$3" "$4" "test workspace"',
          "cleanup-fixture",
          prepareReleaseRuntimeScript,
          releasePath,
          fixture,
          TEST_RELEASE_SHA,
        ]),
      ).resolves.toMatchObject({ stderr: "" });
      await expect(stat(releasePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  it("refuses cleanup when the exact release path was replaced by a symlink", async () => {
    const fixture = await realpath(
      await mkdtemp(join(tmpdir(), "diesel-replaced-build-cleanup-")),
    );
    const external = await realpath(
      await mkdtemp(join(tmpdir(), "diesel-external-build-home-")),
    );
    const releasePath = join(fixture, TEST_RELEASE_SHA);
    await writeFile(join(external, "keep"), "keep\n", "utf8");
    await symlink(external, releasePath);
    try {
      const result = await execFileAsync("/bin/bash", [
        "-c",
        'source "$1"; prepare_release_remove_exact_directory "$2" "$3" "$4" "test workspace"',
        "cleanup-fixture",
        prepareReleaseRuntimeScript,
        releasePath,
        fixture,
        TEST_RELEASE_SHA,
      ]).catch((error: unknown) => error);

      expect(result).toMatchObject({ code: 70 });
      expect(String((result as { stderr?: unknown }).stderr)).toContain(
        "refusing to remove a replaced test workspace",
      );
      await expect(readFile(join(external, "keep"), "utf8")).resolves.toBe(
        "keep\n",
      );
      await expect(readlink(releasePath)).resolves.toBe(external);
    } finally {
      await Promise.all([
        rm(fixture, { force: true, recursive: true }),
        rm(external, { force: true, recursive: true }),
      ]);
    }
  });

  it.each([
    ["same-uid", "distinct and unprivileged"],
    ["builder-root", "distinct and unprivileged"],
    ["same-primary-gid", "distinct and unprivileged"],
    ["builder-runtime-group", "diesel-build must not belong"],
    ["runtime-builder-group", "diesel must not belong"],
    ["builder-extra-group", "must not have supplementary groups"],
    ["runtime-extra-group", "must not have supplementary groups"],
    ["missing-builder", "must exist"],
  ] as const)(
    "rejects the %s runtime/build identity configuration",
    async (identityCase, expectedError) => {
      const fixture = await mkdtemp(join(tmpdir(), "diesel-build-identity-"));
      const fakeId = join(fixture, "id");
      await writeExecutable(
        fakeId,
        `#!/bin/bash
set -euo pipefail
kind="\${IDENTITY_TEST_CASE:?}"
key="\${1:-}:\${2:-}"
if [[ "$kind" == missing-builder && "$key" == *:diesel-build ]]; then
  exit 1
fi
case "$key" in
  -u:diesel) value=1001 ;;
  -g:diesel) value=2001 ;;
  -G:diesel) value=2001 ;;
  -u:diesel-build) value=1002 ;;
  -g:diesel-build) value=2002 ;;
  -G:diesel-build) value=2002 ;;
  *) exit 98 ;;
esac
case "$kind:$key" in
  same-uid:-u:diesel-build) value=1001 ;;
  builder-root:-u:diesel-build) value=0 ;;
  same-primary-gid:-g:diesel-build) value=2001 ;;
  builder-runtime-group:-G:diesel-build) value='2002 2001' ;;
  runtime-builder-group:-G:diesel) value='2001 2002' ;;
  builder-extra-group:-G:diesel-build) value='2002 2999' ;;
  runtime-extra-group:-G:diesel) value='2001 2998' ;;
esac
printf '%s\\n' "$value"
`,
      );
      try {
        const result = await execFileAsync(
          "/bin/bash",
          [
            "-c",
            'source "$1"; prepare_release_require_identity_boundary',
            "identity-fixture",
            prepareReleaseRuntimeScript,
          ],
          {
            env: {
              ...process.env,
              IDENTITY_TEST_CASE: identityCase,
              PATH: `${fixture}:/usr/bin:/bin`,
            },
          },
        ).catch((error: unknown) => error);

        expect(result).toMatchObject({ code: 70 });
        expect(String((result as { stderr?: unknown }).stderr)).toContain(
          expectedError,
        );
      } finally {
        await rm(fixture, { force: true, recursive: true });
      }
    },
  );

  it("refuses to execute the governance country publisher outside the caller-owned recovery shell", async () => {
    const result = await execFileAsync(
      "/bin/bash",
      [governanceCountryFixturePublisherScript],
      { env: { ...process.env, PATH: "/nonexistent" } },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 64 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "source this script",
    );
  });

  it("runs the fixed 97-country queue without changing the caller's recovery traps", async () => {
    const fixture = await createGovernanceCountryPublisherFixture();
    try {
      const result = await executeGovernanceCountryPublisher(fixture);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const invocations = (await readFile(fixture.invocationLog, "utf8"))
        .trim()
        .split("\n");
      expect(invocations).toHaveLength(97);
      expect(invocations[0]).toBe(
        "pnpm exec tsx --conditions=react-server scripts/db/ingest-accepted-fixtures.ts --country=CRI",
      );
      expect(invocations.at(-1)).toBe(
        "pnpm exec tsx --conditions=react-server scripts/db/ingest-accepted-fixtures.ts --country=MLT",
      );
      expect(invocations.every((invocation) => invocation.startsWith(
        "pnpm exec tsx --conditions=react-server scripts/db/ingest-accepted-fixtures.ts --country=",
      ))).toBe(true);
      expect(new Set(invocations).size).toBe(97);
      await expect(readFile(fixture.trapLog, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stat(fixture.recoveryMarker)).resolves.toMatchObject({
        isFile: expect.any(Function),
      });
      await expect(stat(fixture.commitMarker)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("stops at the first failed country and lets the caller recovery trap preserve the exit code", async () => {
    const fixture = await createGovernanceCountryPublisherFixture();
    try {
      const result = await executeGovernanceCountryPublisher(fixture, {
        environment: { GOVERNANCE_TEST_FAIL_COUNTRY: "PHL" },
      });
      expect(result.exitCode).toBe(23);
      expect(result.stderr).toContain(
        "GOVERNANCE_COUNTRY_FAILED 5/97 PHL status=23",
      );
      const invocations = (await readFile(fixture.invocationLog, "utf8"))
        .trim()
        .split("\n");
      expect(invocations).toHaveLength(5);
      expect(invocations.at(-1)).toContain("--country=PHL");
      expect(invocations.join("\n")).not.toContain("--country=PAK");
      await expect(readFile(fixture.trapLog, "utf8")).resolves.toBe("23\n");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    "invalid-release-id",
    "wrong-environment",
    "missing-maintenance-token",
    "wrong-working-directory",
    "missing-recovery-marker",
    "symlinked-recovery-marker",
    "wrong-recovery-marker-mode",
    "existing-commit-file",
    "existing-commit-symlink",
    "missing-recovery-trap",
  ] as const)("rejects %s before the first governance write", async (failureMode) => {
    const fixture = await createGovernanceCountryPublisherFixture();
    let releaseId = TEST_RELEASE_SHA;
    let cwd = fixture.releaseDir;
    const environment: Record<string, string | undefined> = {};

    try {
      switch (failureMode) {
        case "invalid-release-id":
          releaseId = "not-a-commit";
          break;
        case "wrong-environment":
          environment.NODE_ENV = "development";
          break;
        case "missing-maintenance-token":
          environment.DIESEL_GOVERNANCE_MAINTENANCE_TOKEN = "";
          break;
        case "wrong-working-directory":
          cwd = fixture.root;
          break;
        case "missing-recovery-marker":
          await rm(fixture.recoveryMarker);
          break;
        case "symlinked-recovery-marker":
          await rm(fixture.recoveryMarker);
          await symlink(fixture.snapshotPath, fixture.recoveryMarker);
          break;
        case "wrong-recovery-marker-mode":
          await writeFile(fixture.wrongMarkerModeFlag, "1\n", "utf8");
          break;
        case "existing-commit-file":
          await writeFile(fixture.commitMarker, "premature\n", "utf8");
          break;
        case "existing-commit-symlink":
          await symlink(join(fixture.root, "missing-commit"), fixture.commitMarker);
          break;
        case "missing-recovery-trap":
          environment.GOVERNANCE_TEST_OMIT_TERM_TRAP = "1";
          break;
      }

      const result = await executeGovernanceCountryPublisher(fixture, {
        cwd,
        environment,
        releaseId,
      });
      expect(result.exitCode).toBe(
        failureMode === "invalid-release-id" ? 64 : 70,
      );
      await expect(readFile(fixture.invocationLog, "utf8")).rejects.toMatchObject(
        { code: "ENOENT" },
      );
      await expect(readFile(fixture.trapLog, "utf8")).resolves.toMatch(
        failureMode === "invalid-release-id" ? /^64\n$/u : /^70\n$/u,
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("fails build preflight when a production secret is inherited", async () => {
    const result = await execFileAsync(
      "bash",
      [resolve(process.cwd(), "scripts/deploy/build-release.sh")],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BUILD_HOME: process.cwd(),
          BUILD_RELEASE_ID: TEST_RELEASE_SHA,
          DATABASE_URL: "postgresql://should-not-reach-the-build.invalid/db",
        },
      },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 64 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "DATABASE_URL must not be present",
    );
  });

  it("installs explicit build signal statuses before the first external command", async () => {
    const buildScript = await readFile(
      resolve(process.cwd(), "scripts/deploy/build-release.sh"),
      "utf8",
    );
    const firstExternalCommand = buildScript.indexOf('id -u');

    expect(firstExternalCommand).toBeGreaterThanOrEqual(0);
    for (const signalTrap of [
      "trap 'exit 129' HUP",
      "trap 'exit 130' INT",
      "trap 'exit 143' TERM",
    ]) {
      const trapIndex = buildScript.indexOf(signalTrap);
      expect(trapIndex).toBeGreaterThanOrEqual(0);
      expect(trapIndex).toBeLessThan(firstExternalCommand);
    }
  });

  it("bounds registry downloads, restores Next's tracked environment file and confines TypeScript build state to .next", async () => {
    const fixture = await realpath(
      await mkdtemp(join(tmpdir(), "diesel-next-generated-inputs-")),
    );
    const workspace = join(fixture, "workspace");
    const buildHome = join(fixture, "home");
    const fakeBin = join(fixture, "bin");
    const deployScriptRoot = join(workspace, "scripts", "deploy");
    const expectedNextEnvironmentPath = join(
      fixture,
      "expected-next-env.d.ts",
    );
    const inputVerifyCounterPath = join(fixture, "input-verify-count");
    const installInvocationPath = join(fixture, "install-arguments");
    const originalNextEnvironment =
      '/// <reference types="next" />\n' +
      'import "./.next/dev/types/routes.d.ts";\n';
    const buildEnvironment = { ...process.env };
    delete buildEnvironment.DATABASE_URL;
    delete buildEnvironment.AI_API_KEY;
    delete buildEnvironment.ADMIN_ROLE_BINDINGS_JSON;

    try {
      await Promise.all([
        mkdir(join(workspace, ".next", "server"), { recursive: true }),
        mkdir(join(workspace, "node_modules"), { recursive: true }),
        mkdir(deployScriptRoot, { recursive: true }),
        mkdir(buildHome),
        mkdir(fakeBin),
      ]);
      await Promise.all([
        writeFile(join(workspace, "package.json"), "{}\n", "utf8"),
        writeFile(
          join(workspace, "pnpm-lock.yaml"),
          "lockfileVersion: '9.0'\n",
          "utf8",
        ),
        writeFile(
          join(workspace, "next.config.ts"),
          "export default {};\n",
          "utf8",
        ),
        writeFile(
          join(workspace, "next-env.d.ts"),
          originalNextEnvironment,
          "utf8",
        ),
        writeFile(
          expectedNextEnvironmentPath,
          originalNextEnvironment,
          "utf8",
        ),
        writeFile(join(workspace, ".build-complete"), "", "utf8"),
        writeFile(join(workspace, ".release-input-manifest.json"), "{}\n", "utf8"),
        writeFile(
          join(deployScriptRoot, "release-input-manifest.mjs"),
          "// verified by the fake node command\n",
          "utf8",
        ),
        writeFile(
          join(deployScriptRoot, "release-artifact-manifest.mjs"),
          "// verified by the fake node command\n",
          "utf8",
        ),
      ]);
      await writeExecutable(
        join(fakeBin, "node"),
        `#!/bin/bash
set -euo pipefail
if [[ " $* " == *"release-input-manifest.mjs verify "* ]]; then
  counter_file=${quoteShell(inputVerifyCounterPath)}
  expected_file=${quoteShell(expectedNextEnvironmentPath)}
  verify_count=0
  if [[ -f "${"$"}{counter_file}" ]]; then
    IFS= read -r verify_count <"${"$"}{counter_file}"
  fi
  verify_count=$((verify_count + 1))
  printf '%s\n' "${"$"}{verify_count}" >"${"$"}{counter_file}"
  if [[ "${"$"}{verify_count}" -eq 2 ]]; then
    /usr/bin/cmp -s -- next-env.d.ts "${"$"}{expected_file}" || exit 91
  fi
fi
printf '%064d\n' 0
`,
      );
      await writeExecutable(
        join(fakeBin, "corepack"),
        `#!/bin/bash
set -euo pipefail
if [[ " $* " == *" install "* ]]; then
  printf '%s\\n' "$@" >${quoteShell(installInvocationPath)}
fi
if [[ " $* " == *" pnpm build "* ]]; then
  printf '%s\n' '// rewritten by Next during the fixture build' >next-env.d.ts
  mkdir -p .next/server .next/cache
  printf '%s\n' '${TEST_RELEASE_SHA}' >.next/BUILD_ID
  printf '%s\n' '{}' >.next/required-server-files.json
  printf '%s\n' '{}' >.next/server/app-paths-manifest.json
  printf '%s\n' 'fixture incremental state' >.next/cache/tsconfig.tsbuildinfo
fi
`,
      );

      const result = await execFileAsync(
        "bash",
        [resolve(process.cwd(), "scripts/deploy/build-release.sh")],
        {
          cwd: workspace,
          env: {
            ...buildEnvironment,
            BUILD_HOME: buildHome,
            BUILD_RELEASE_ID: TEST_RELEASE_SHA,
            npm_config_network_concurrency: "128",
            npm_config_fetch_timeout: "1",
            npm_config_fetch_retries: "99",
            PATH: `${fakeBin}:/usr/bin:/bin`,
          },
        },
      );

      expect(result.stderr).toBe("");
      await expect(readFile(installInvocationPath, "utf8")).resolves.toBe(
        [
          "pnpm",
          "--config.registry=https://registry.npmjs.org",
          "--config.network-concurrency=4",
          "--config.fetch-timeout=600000",
          "--config.fetch-retries=2",
          "install",
          "--frozen-lockfile",
          "--trust-lockfile",
          "--package-import-method=copy",
          "--ignore-scripts",
          "--ignore-pnpmfile",
          "",
        ].join("\n"),
      );
      await expect(
        readFile(join(workspace, "next-env.d.ts"), "utf8"),
      ).resolves.toBe(originalNextEnvironment);
      await expect(readFile(inputVerifyCounterPath, "utf8")).resolves.toBe(
        "2\n",
      );
      await expect(
        stat(join(buildHome, "next-env.d.ts.before-build")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(
          join(workspace, ".next", "cache", "tsconfig.tsbuildinfo"),
          "utf8",
        ),
      ).resolves.toBe("fixture incremental state\n");
      await expect(
        stat(join(workspace, "tsconfig.tsbuildinfo")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  it("routes TypeScript incremental metadata through ignored Next build output", async () => {
    const tsconfig = JSON.parse(
      await readFile(resolve(process.cwd(), "tsconfig.json"), "utf8"),
    ) as { compilerOptions?: { tsBuildInfoFile?: unknown } };

    expect(tsconfig.compilerOptions?.tsBuildInfoFile).toBe(
      ".next/cache/tsconfig.tsbuildinfo",
    );
  });

  it("parses and validates the complete systemd v255 build-unit contract", async () => {
    const unit = `diesel-build-${TEST_RELEASE_SHA}.service`;
    const workspace = "/fixture/build-workspace";
    const controlGroup = `/system.slice/${unit}`;
    const metadata = createLoadedSystemdUnitMetadata(
      unit,
      workspace,
      controlGroup,
    );
    const result = await executeSystemdUnitMetadataFixture(
      renderSystemdUnitMetadata(metadata),
      [
        "set -Eeuo pipefail",
        'source "$1"',
        'prepare_release_load_unit_state "$2"',
        'prepare_release_validate_loaded_build_unit "$2" "$3" "$4"',
        "printf '%s|%s|%s|%s\\n' \"${PREPARE_RELEASE_UNIT_PROPERTY_COUNT}\" \"${PREPARE_RELEASE_UNIT_LOAD_STATE}\" \"${PREPARE_RELEASE_UNIT_RUNTIME_MAX_USEC}\" \"${PREPARE_RELEASE_UNIT_PROTECT_CONTROL_GROUPS}\"",
      ].join("\n"),
      unit,
      workspace,
      controlGroup,
    );

    expect(result.command).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "26|loaded|45min|yes\n",
    });
    expect(result.args).toEqual([
      "show",
      "--all",
      "--no-pager",
      unit,
      ...SYSTEMD_BUILD_UNIT_PROPERTIES.map(
        (property) => `--property=${property}`,
      ),
    ]);
  });

  it("accepts a complete not-found unit response with empty properties", async () => {
    const unit = `diesel-build-${TEST_RELEASE_SHA}.service`;
    const workspace = "/fixture/build-workspace";
    const controlGroup = `/system.slice/${unit}`;
    const metadata = createLoadedSystemdUnitMetadata(
      unit,
      workspace,
      controlGroup,
    );
    for (const property of SYSTEMD_BUILD_UNIT_PROPERTIES) {
      metadata[property] = "";
    }
    metadata.LoadState = "not-found";
    metadata.ActiveState = "inactive";
    metadata.SubState = "dead";

    const result = await executeSystemdUnitMetadataFixture(
      renderSystemdUnitMetadata(metadata),
      [
        "set -Eeuo pipefail",
        'source "$1"',
        'prepare_release_require_unit_absent "$2"',
        "printf '%s|%s|%s|%s\\n' \"${PREPARE_RELEASE_UNIT_PROPERTY_COUNT}\" \"${PREPARE_RELEASE_UNIT_LOAD_STATE}\" \"${PREPARE_RELEASE_UNIT_FRAGMENT_PATH}\" \"${PREPARE_RELEASE_UNIT_USER}\"",
      ].join("\n"),
      unit,
      workspace,
      controlGroup,
    );

    expect(result.command).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "26|not-found||\n",
    });
  });

  it("fails closed when systemctl returns metadata with a failed status", async () => {
    const unit = `diesel-build-${TEST_RELEASE_SHA}.service`;
    const workspace = "/fixture/build-workspace";
    const controlGroup = `/system.slice/${unit}`;
    const metadata = createLoadedSystemdUnitMetadata(
      unit,
      workspace,
      controlGroup,
    );
    const result = await executeSystemdUnitMetadataFixture(
      renderSystemdUnitMetadata(metadata),
      [
        "set -Eeuo pipefail",
        'source "$1"',
        'prepare_release_load_unit_state "$2"',
      ].join("\n"),
      unit,
      workspace,
      controlGroup,
      "124",
    );

    expect(result.command).toEqual({
      exitCode: 70,
      stderr: `systemd unit state query failed for ${unit}\n`,
      stdout: "",
    });
  });

  it.each([
    {
      expectedError: "systemd unit metadata was incomplete",
      mutation: "missing-property",
    },
    {
      expectedError: "systemd unit metadata was incomplete",
      mutation: "empty-load-state",
    },
    {
      expectedError: "systemd returned a duplicate unit property",
      mutation: "duplicate-property",
    },
    {
      expectedError: "systemd returned malformed unit metadata",
      mutation: "malformed-property",
    },
    {
      expectedError: "systemd returned an unexpected unit property",
      mutation: "unexpected-property",
    },
  ] as const)(
    "rejects $mutation in systemd unit metadata",
    async ({ expectedError, mutation }) => {
      const unit = `diesel-build-${TEST_RELEASE_SHA}.service`;
      const workspace = "/fixture/build-workspace";
      const controlGroup = `/system.slice/${unit}`;
      const metadata = createLoadedSystemdUnitMetadata(
        unit,
        workspace,
        controlGroup,
      );
      let output: string;
      switch (mutation) {
        case "missing-property":
          output = renderSystemdUnitMetadata(
            metadata,
            "ProtectControlGroups",
          );
          break;
        case "empty-load-state":
          output = renderSystemdUnitMetadata({ ...metadata, LoadState: "" });
          break;
        case "duplicate-property":
          output = `${renderSystemdUnitMetadata(metadata)}User=diesel-build\n`;
          break;
        case "malformed-property":
          output = `${renderSystemdUnitMetadata(metadata)}malformed\n`;
          break;
        case "unexpected-property":
          output = `${renderSystemdUnitMetadata(metadata)}Unknown=value\n`;
          break;
      }

      const result = await executeSystemdUnitMetadataFixture(
        output,
        [
          "set -Eeuo pipefail",
          'source "$1"',
          'prepare_release_load_unit_state "$2"',
        ].join("\n"),
        unit,
        workspace,
        controlGroup,
      );

      expect(result.command.exitCode).toBe(70);
      expect(result.command.stdout).toBe("");
      expect(result.command.stderr).toContain(expectedError);
    },
  );

  it("persists a candidate filesystem before accepting durable readiness", async () => {
    const fixture = await createPreparePreflightFixture("absent");
    try {
      const result = await executePreparePersistCandidate(fixture);
      const releaseRoot = dirname(fixture.releaseDir);

      expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "" });
      await expect(readFile(fixture.operationLog, "utf8")).resolves.toBe(
        [
          `candidate-boundary:${fixture.releaseDir}`,
          `candidate-sync:-f -- ${fixture.releaseDir} ${releaseRoot} ${fixture.deployRoot}`,
          `candidate-fsync:${join(fixture.releaseDir, ".build-complete")}`,
          `candidate-fsync:${join(fixture.releaseDir, ".deploy-ready")}`,
          `candidate-fsync:${join(fixture.releaseDir, "node_modules")}`,
          `candidate-fsync:${join(fixture.releaseDir, ".next")}`,
          `candidate-fsync:${fixture.releaseDir}`,
          `candidate-fsync:${releaseRoot}`,
          `candidate-fsync:${fixture.deployRoot}`,
          "",
        ].join("\n"),
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      environment: { PREPARE_TEST_CANDIDATE_BOUNDARY_STATUS: "70" },
      expectedError: "candidate filesystem boundary validation failed",
      name: "a nested filesystem boundary",
    },
    {
      environment: { PREPARE_TEST_CANDIDATE_SYNC_STATUS: "70" },
      expectedError: "candidate filesystem durability proof failed",
      name: "a containing-filesystem sync failure",
    },
    {
      environment: { PREPARE_TEST_CANDIDATE_FSYNC_STATUS: "70" },
      expectedError: "candidate inode durability proof failed",
      name: "an inode fsync failure",
    },
  ] as const)(
    "fails closed on $name while retaining the candidate evidence",
    async ({ environment, expectedError }) => {
      const fixture = await createPreparePreflightFixture("absent");
      try {
        const result = await executePreparePersistCandidate(
          fixture,
          environment,
        );

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(expectedError);
        for (const path of [
          join(fixture.releaseDir, ".build-complete"),
          join(fixture.releaseDir, ".deploy-ready"),
          join(fixture.releaseDir, "node_modules"),
          join(fixture.releaseDir, ".next"),
        ]) {
          await expect(lstat(path)).resolves.toBeDefined();
        }
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it("revalidates durable candidate bytes before deleting build evidence", async () => {
    const source = await readFile(prepareReleaseRuntimeScript, "utf8");
    const preserveIndex = source.indexOf(
      "PREPARE_RELEASE_PRESERVE_BUILD_ARTIFACTS=1",
    );
    const firstReadyIndex = source.indexOf(
      'check-ready "${release_id}" .build-complete .deploy-ready',
      preserveIndex,
    );
    const persistIndex = source.indexOf(
      "prepare_release_persist_candidate \\",
      firstReadyIndex,
    );
    const durableMetadataIndex = source.indexOf(
      '"durable target release"',
      persistIndex,
    );
    const secondReadyIndex = source.indexOf(
      'check-ready "${release_id}" .build-complete .deploy-ready',
      firstReadyIndex + 1,
    );
    const allowCleanupIndex = source.indexOf(
      "PREPARE_RELEASE_PRESERVE_BUILD_ARTIFACTS=0",
      secondReadyIndex,
    );
    const cleanupIndex = source.indexOf(
      "prepare_release_remove_exact_directory \\",
      allowCleanupIndex,
    );

    expect(preserveIndex).toBeGreaterThan(-1);
    expect(firstReadyIndex).toBeGreaterThan(preserveIndex);
    expect(persistIndex).toBeGreaterThan(firstReadyIndex);
    expect(durableMetadataIndex).toBeGreaterThan(persistIndex);
    expect(secondReadyIndex).toBeGreaterThan(durableMetadataIndex);
    expect(allowCleanupIndex).toBeGreaterThan(secondReadyIndex);
    expect(cleanupIndex).toBeGreaterThan(allowCleanupIndex);
  });

  it.each([
    ["LoadState", "not-found"],
    ["Transient", "no"],
    ["FragmentPath", "/etc/systemd/system/foreign.service"],
    ["User", "root"],
    ["Group", "diesel"],
    ["WorkingDirectory", "/fixture/build-workspace-other"],
    [
      "ControlGroup",
      `/system.slice/diesel-build-${TEST_RELEASE_SHA}.service-lookalike`,
    ],
    ["Slice", "app.slice"],
    ["KillMode", "process"],
    ["Delegate", "yes"],
    ["RemainAfterExit", "no"],
    ["Restart", "always"],
    ["Type", "simple"],
    ["KillSignal", "2"],
    ["FinalKillSignal", "6"],
    ["SendSIGKILL", "no"],
    ["RuntimeMaxUSec", "46min"],
    ["TimeoutStopUSec", "31s"],
    ["UMask", "0022"],
    ["NoNewPrivileges", "no"],
    ["ProtectControlGroups", "no"],
  ] satisfies ReadonlyArray<readonly [SystemdBuildUnitProperty, string]>)(
    "rejects systemd build-unit drift in %s",
    async (property, driftedValue) => {
      const unit = `diesel-build-${TEST_RELEASE_SHA}.service`;
      const workspace = "/fixture/build-workspace";
      const controlGroup = `/system.slice/${unit}`;
      const metadata = createLoadedSystemdUnitMetadata(
        unit,
        workspace,
        controlGroup,
      );
      metadata[property] = driftedValue;

      const result = await executeSystemdUnitMetadataFixture(
        renderSystemdUnitMetadata(metadata),
        [
          "set -Eeuo pipefail",
          'source "$1"',
          'prepare_release_load_unit_state "$2"',
          'prepare_release_validate_loaded_build_unit "$2" "$3" "$4"',
        ].join("\n"),
        unit,
        workspace,
        controlGroup,
      );

      expect(result.command.exitCode).toBe(70);
      expect(result.command.stdout).toBe("");
      expect(result.command.stderr).toContain(
        `build unit metadata drifted: ${unit}`,
      );
    },
  );

  it.each([
    { active: "failed", sub: "failed", absent: true, expected: 23 },
    { active: "failed", sub: "failed", absent: false, expected: 70 },
    { active: "active", sub: "running", absent: true, expected: 70 },
    { active: "active", sub: "exited", absent: true, result: "success", code: "1", status: "0", expected: 0 },
    { active: "active", sub: "exited", absent: false, result: "success", code: "1", status: "0", expected: 70 },
    { active: "active", sub: "exited", absent: true, result: "success", code: "2", status: "15", expected: 143 },
    { active: "activating", sub: "start", absent: true, expected: 70 },
    { active: "deactivating", sub: "stop", absent: true, expected: 70 },
    { active: "inactive", sub: "dead", absent: true, expected: 70 },
    { active: "failed", sub: "running", absent: true, expected: 70 },
  ])(
    "preserves terminal outcomes only with a reclaimed build cgroup: $active/$sub absent=$absent",
    async ({ active, sub, absent, expected, result: terminalResult, code, status }) => {
      const unit = `diesel-build-${TEST_RELEASE_SHA}.service`;
      const workspace = "/fixture/build-workspace";
      const controlGroup = `/system.slice/${unit}`;
      const metadata = createLoadedSystemdUnitMetadata(unit, workspace, "");
      metadata.ActiveState = active;
      metadata.SubState = sub;
      metadata.Result = terminalResult ?? "exit-code";
      metadata.ExecMainCode = code ?? "1";
      metadata.ExecMainStatus = status ?? "23";
      const result = await executeSystemdUnitMetadataFixture(
        renderSystemdUnitMetadata(metadata),
        [
          "set -Eeuo pipefail",
          'source "$1"',
          'prepare_release_load_unit_state "$2"',
          "prepare_release_require_control_group_absent() {",
          '  [[ "$1" == "$expected_cgroup" ]] || return 99',
          `  return ${absent ? 0 : 70}`,
          "}",
          'expected_cgroup="$4"',
          'prepare_release_validate_loaded_build_unit "$2" "$3" "$4"',
          'prepare_release_map_build_status "$PREPARE_RELEASE_UNIT_RESULT" "$PREPARE_RELEASE_UNIT_EXEC_MAIN_CODE" "$PREPARE_RELEASE_UNIT_EXEC_MAIN_STATUS"',
        ].join("\n"),
        unit,
        workspace,
        controlGroup,
      );
      expect(result.command.exitCode).toBe(expected);
      expect(result.command.stdout).toBe("");
    },
  );

  it.each([
    { code: "1", expected: 0, result: "success", status: "0" },
    { code: "1", expected: 23, result: "exit-code", status: "23" },
    { code: "2", expected: 143, result: "success", status: "15" },
    { code: "2", expected: 124, result: "timeout", status: "15" },
    { code: "2", expected: 137, result: "oom-kill", status: "9" },
    { code: "1", expected: 70, result: "future-result", status: "23" },
    { code: "0", expected: 70, result: "success", status: "0" },
  ])(
    "maps retained systemd build metadata $result/$code/$status to $expected",
    async ({ code, expected, result, status }) => {
      const execution = await execFileAsync(
        "/bin/bash",
        [
          "-c",
          'source "$1"; prepare_release_map_build_status "$2" "$3" "$4"',
          "bash",
          prepareReleaseRuntimeScript,
          result,
          code,
          status,
        ],
      ).then(
        () => ({ code: 0 }),
        (error: unknown) => error as { code?: number },
      );

      expect(execution).toMatchObject({ code: expected });
    },
  );

  it("forces the validated cgroup and retries stop before accepting quiescence", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "diesel-systemd-stop-retry-"));
    const commandLog = join(fixture, "commands.log");
    const unit = `diesel-build-${TEST_RELEASE_SHA}.service`;
    const controlGroup = `/system.slice/${unit}`;
    try {
      await execFileAsync(
        "/bin/bash",
        [
          "-c",
          [
            "set -Eeuo pipefail",
            'source "$1"',
            "load_calls=0",
            "stop_calls=0",
            "prepare_release_load_unit_state() {",
            "  load_calls=$((load_calls + 1))",
            '  if [[ "${load_calls}" -eq 1 ]]; then',
            "    PREPARE_RELEASE_UNIT_LOAD_STATE=loaded",
            "  else",
            "    PREPARE_RELEASE_UNIT_LOAD_STATE=not-found",
            "  fi",
            "}",
            "prepare_release_validate_loaded_build_unit() { return 0; }",
            "prepare_release_require_control_group_absent() { return 0; }",
            "prepare_release_prove_build_quiescent() { return 0; }",
            "sleep() { return 0; }",
            "timeout() {",
            '  if [[ " $* " == *" systemctl stop "* ]]; then',
            "    stop_calls=$((stop_calls + 1))",
            '    printf \'stop\\n\' >>"${PREPARE_TEST_COMMAND_LOG}"',
            '    [[ "${stop_calls}" -gt 1 ]]',
            "    return",
            "  fi",
            '  if [[ " $* " == *" systemctl kill "* ]]; then',
            '    printf \'kill\\n\' >>"${PREPARE_TEST_COMMAND_LOG}"',
            "    return 0",
            "  fi",
            "  return 98",
            "}",
            'prepare_release_quiesce_build_unit "$2" "$3" /proc "$4" 1002',
          ].join("\n"),
          "bash",
          prepareReleaseRuntimeScript,
          unit,
          join(fixture, "workspace"),
          controlGroup,
        ],
        {
          env: {
            ...process.env,
            PREPARE_TEST_COMMAND_LOG: commandLog,
          },
        },
      );

      await expect(readFile(commandLog, "utf8")).resolves.toBe(
        "stop\nkill\nstop\n",
      );
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  it.each([
    { expected: 0, memberSuffix: "" },
    { expected: 0, memberSuffix: "/nested/child" },
    { expected: 1, memberSuffix: "-lookalike" },
  ])(
    "matches an exact build cgroup boundary with suffix $memberSuffix",
    async ({ expected, memberSuffix }) => {
      const procRoot = await mkdtemp(join(tmpdir(), "diesel-proc-cgroup-"));
      const controlGroup = `/system.slice/diesel-build-${TEST_RELEASE_SHA}.service`;
      try {
        await mkdir(join(procRoot, "1"));
        await writeFile(
          join(procRoot, "1", "cgroup"),
          `0::${controlGroup}${memberSuffix}\n`,
          "utf8",
        );
        const execution = await execFileAsync(
          "/bin/bash",
          [
            "-c",
            'source "$1"; prepare_release_control_group_has_processes "$2" "$3"',
            "bash",
            prepareReleaseRuntimeScript,
            procRoot,
            controlGroup,
          ],
        ).then(
          () => ({ code: 0 }),
          (error: unknown) => error as { code?: number },
        );

        expect(execution).toMatchObject({ code: expected });
      } finally {
        await rm(procRoot, { force: true, recursive: true });
      }
    },
  );

  it.each([
    "test-release",
    "A".repeat(40),
    "a".repeat(39),
  ])("rejects non-commit build release ID %s", async (releaseId) => {
    const result = await execFileAsync(
      "bash",
      [resolve(process.cwd(), "scripts/deploy/build-release.sh")],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BUILD_HOME: process.cwd(),
          BUILD_RELEASE_ID: releaseId,
        },
      },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 64 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "full lowercase Git commit SHA",
    );
  });

  it.each(["", "../current", "A".repeat(40), "a".repeat(39)])(
    "rejects non-commit public governance release ID %s before network access",
    async (releaseId) => {
      const result = await execFileAsync(
        "/bin/bash",
        [publicGovernanceValidationScript, releaseId],
        {
          env: {
            ...process.env,
            PATH: "/nonexistent",
          },
        },
      ).catch((error: unknown) => error);

      expect(result).toMatchObject({ code: 64 });
      expect(String((result as { stderr?: unknown }).stderr)).toContain(
        "full-lowercase-git-commit-sha",
      );
    },
  );

  it.each(["not-a-commit", "A".repeat(40), "a".repeat(39)])(
    "rejects non-commit runtime preparation ID %s before host access",
    async (releaseId) => {
      const result = await execFileAsync(
        "/bin/bash",
        [prepareReleaseRuntimeScript, releaseId],
        {
          env: {
            ...process.env,
            PATH: "/nonexistent",
          },
        },
      ).catch((error: unknown) => error);

      expect(result).toMatchObject({ code: 64 });
      expect(String((result as { stderr?: unknown }).stderr)).toContain(
        "full-lowercase-git-commit-sha",
      );
    },
  );

  it.each([
    { args: [] as string[], name: "a missing release id" },
    {
      args: [TEST_RELEASE_SHA, "/tmp/attempted-path-override"],
      name: "an extra production path override",
    },
  ])("rejects $name at the runtime-preparation CLI boundary", async ({ args }) => {
    const result = await execFileAsync(
      "/bin/bash",
      [prepareReleaseRuntimeScript, ...args],
      {
        env: {
          ...process.env,
          PATH: "/nonexistent",
        },
      },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 64 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "full-lowercase-git-commit-sha",
    );
  });

  it.each([
    ["system directory", "system-directory", "root:root:755", 0],
    ["staged release directory", "release-directory", "root:root:755", 0],
    ["normalized release directory", "release-directory", "root:diesel:750", 0],
    ["staged release executable", "release-executable", "root:root:755:1", 0],
    ["normalized release executable", "release-executable", "root:diesel:750:1", 0],
    ["group-owned system directory", "system-directory", "root:diesel:750", 1],
    ["hard-linked release executable", "release-executable", "root:root:755:2", 1],
    ["group-writable release executable", "release-executable", "root:diesel:770:1", 1],
  ] as const)(
    "classifies %s at the direct runtime-preparation source boundary",
    async (_name, profile, metadata, expectedStatus) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; prepare_release_cli_bootstrap_metadata_is_allowed "$2" "$3"',
        "prepare-cli-metadata-fixture",
        prepareReleaseRuntimeScript,
        profile,
        metadata,
      ]);

      expect(result).toEqual({
        exitCode: expectedStatus,
        stderr: "",
        stdout: "",
      });
    },
  );

  it("binds runtime preparation to the requested release before sourcing its ledger", async () => {
    const result = await execFileAsync("/bin/bash", [
      prepareReleaseRuntimeScript,
      TEST_RELEASE_SHA,
    ]).catch((error: unknown) => error);
    const source = await readFile(prepareReleaseRuntimeScript, "utf8");
    const entryBindingIndex = source.indexOf(
      'local expected_entry="${expected_release}/scripts/deploy/prepare-release-runtime.sh"',
    );
    const ledgerValidationIndex = source.indexOf(
      '"${expected_ledger}" release-executable',
    );
    const rootPathIndex = source.indexOf(
      'export PATH="/usr/sbin:/usr/bin:/sbin:/bin"',
    );
    const ledgerSourceIndex = source.indexOf(
      'source -- "${expected_ledger}"',
    );

    expect(result).toMatchObject({ code: 70 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "runtime preparation pre-source trust validation failed",
    );
    expect(entryBindingIndex).toBeGreaterThanOrEqual(0);
    expect(ledgerValidationIndex).toBeGreaterThan(entryBindingIndex);
    expect(rootPathIndex).toBeGreaterThan(ledgerValidationIndex);
    expect(ledgerSourceIndex).toBeGreaterThan(rootPathIndex);
    expect(source.indexOf("source --")).toBe(ledgerSourceIndex);
    expect(source.slice(0, ledgerSourceIndex)).not.toMatch(
      /^[ \t]*(?:source|\.)[ \t]+/mu,
    );
  });

  it("rejects the production runtime-preparation main when sourced", async () => {
    const result = await execute("/bin/bash", [
      "--noprofile",
      "--norc",
      "-c",
      'source -- "$1"; prepare_release_runtime_main "$2"',
      "prepare-sourced-main-fixture",
      prepareReleaseRuntimeScript,
      TEST_RELEASE_SHA,
    ]);

    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain(
      "production runtime preparation main is unavailable when sourced",
    );
  });

  it.each(["/opt/diesel", "/opt/diesel/", "/opt//diesel"])(
    "rejects sourced runtime-preparation seam root %s",
    async (deployRoot) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; prepare_release_runtime "$2" "$3" /usr/bin:/bin /usr/bin/node /proc',
        "prepare-sourced-production-root-fixture",
        prepareReleaseRuntimeScript,
        TEST_RELEASE_SHA,
        deployRoot,
      ]);

      expect(result.exitCode).toBe(64);
      expect(result.stderr).toContain(
        "runtime preparation test seam cannot target the production deployment root",
      );
    },
  );

  it.each(["entry", "ledger"] as const)(
    "does not execute a poisoned preparation ledger when %s validation fails",
    async (rejectedObject) => {
      const root = await mkdtemp(join(tmpdir(), "diesel-prepare-bootstrap-"));
      const deployRoot = join(root, "diesel");
      const releaseDirectory = join(deployRoot, "releases", TEST_RELEASE_SHA);
      const deployDirectory = join(releaseDirectory, "scripts", "deploy");
      const entry = join(deployDirectory, "prepare-release-runtime.sh");
      const ledger = join(deployDirectory, "host-activation-ledger.sh");
      const marker = join(root, "ledger-executed");
      const validationLog = join(root, "validation.log");
      const rejectedPath = rejectedObject === "entry" ? entry : ledger;
      await mkdir(deployDirectory, { recursive: true });
      await writeFile(
        ledger,
        'printf "ledger-executed\\n" >"${BOOTSTRAP_MARKER:?}"\n',
        "utf8",
      );

      try {
        const harness = [
          'source -- "$1"',
          'BOOTSTRAP_REJECT="$5"',
          'BOOTSTRAP_LOG="$6"',
          'BOOTSTRAP_MARKER="$7"',
          'prepare_release_require_cli_bootstrap_path() {',
          '  printf "%s|%s\\n" "$1" "$2" >>"${BOOTSTRAP_LOG}"',
          '  [[ "$1" != "${BOOTSTRAP_REJECT}" ]]',
          '}',
          'prepare_release_cli_bootstrap "$2" "$3" "$4"',
        ].join("\n");
        const result = await execute("/bin/bash", [
          "--noprofile",
          "--norc",
          "-c",
          harness,
          "prepare-bootstrap-fixture",
          prepareReleaseRuntimeScript,
          TEST_RELEASE_SHA,
          deployRoot,
          entry,
          rejectedPath,
          validationLog,
          marker,
        ]);

        expect(result).toEqual({ exitCode: 70, stderr: "", stdout: "" });
        await expect(readFile(marker, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        const validatedPaths = (await readFile(validationLog, "utf8"))
          .trim()
          .split("\n");
        const expectedValidationSequence = [
          "/opt|system-directory",
          `${deployRoot}|system-directory`,
          `${deployRoot}/releases|system-directory`,
          `${releaseDirectory}|release-directory`,
          `${releaseDirectory}/scripts|release-directory`,
          `${deployDirectory}|release-directory`,
          `${entry}|release-executable`,
          `${ledger}|release-executable`,
        ];
        const rejectedIndex = expectedValidationSequence.findIndex((line) =>
          line.startsWith(`${rejectedPath}|`),
        );
        expect(rejectedIndex).toBeGreaterThanOrEqual(0);
        expect(validatedPaths).toEqual(
          expectedValidationSequence.slice(0, rejectedIndex + 1),
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("sources the preparation ledger only after every bootstrap validation succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-prepare-bootstrap-"));
    const deployRoot = join(root, "diesel");
    const releaseDirectory = join(deployRoot, "releases", TEST_RELEASE_SHA);
    const deployDirectory = join(releaseDirectory, "scripts", "deploy");
    const entry = join(deployDirectory, "prepare-release-runtime.sh");
    const ledger = join(deployDirectory, "host-activation-ledger.sh");
    const marker = join(root, "ledger-executed");
    const validationLog = join(root, "validation.log");
    await mkdir(deployDirectory, { recursive: true });
    await writeFile(
      ledger,
      'printf "ledger-executed\\n" >"${BOOTSTRAP_MARKER:?}"\n',
      "utf8",
    );

    try {
      const harness = [
        'source -- "$1"',
        'BOOTSTRAP_LOG="$5"',
        'BOOTSTRAP_MARKER="$6"',
        'prepare_release_require_cli_bootstrap_path() {',
        '  printf "%s|%s\\n" "$1" "$2" >>"${BOOTSTRAP_LOG}"',
        '}',
        'prepare_release_cli_bootstrap "$2" "$3" "$4"',
      ].join("\n");
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        harness,
        "prepare-bootstrap-fixture",
        prepareReleaseRuntimeScript,
        TEST_RELEASE_SHA,
        deployRoot,
        entry,
        validationLog,
        marker,
      ]);

      expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
      await expect(readFile(marker, "utf8")).resolves.toBe(
        "ledger-executed\n",
      );
      const validatedPaths = (await readFile(validationLog, "utf8"))
        .trim()
        .split("\n");
      expect(validatedPaths).toEqual([
        "/opt|system-directory",
        `${deployRoot}|system-directory`,
        `${deployRoot}/releases|system-directory`,
        `${releaseDirectory}|release-directory`,
        `${releaseDirectory}/scripts|release-directory`,
        `${deployDirectory}|release-directory`,
        `${entry}|release-executable`,
        `${ledger}|release-executable`,
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when the validated preparation ledger fails while sourcing", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-prepare-bootstrap-"));
    const deployRoot = join(root, "diesel");
    const releaseDirectory = join(deployRoot, "releases", TEST_RELEASE_SHA);
    const deployDirectory = join(releaseDirectory, "scripts", "deploy");
    const entry = join(deployDirectory, "prepare-release-runtime.sh");
    const ledger = join(deployDirectory, "host-activation-ledger.sh");
    await mkdir(deployDirectory, { recursive: true });
    await writeFile(ledger, "return 23\n", "utf8");

    try {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        [
          'source -- "$1"',
          "prepare_release_require_cli_bootstrap_path() { :; }",
          'prepare_release_cli_bootstrap "$2" "$3" "$4"',
        ].join("\n"),
        "prepare-bootstrap-fixture",
        prepareReleaseRuntimeScript,
        TEST_RELEASE_SHA,
        deployRoot,
        entry,
      ]);

      expect(result).toEqual({ exitCode: 70, stderr: "", stdout: "" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts an unchanged PostgreSQL identity and fsyncs the live environment", async () => {
    const fixture = await createPreparePreflightFixture("absent");
    const databaseUrl =
      "postgresql://stable-user:stable-password@database.invalid/diesel";
    try {
      await Promise.all([
        writeFile(
          fixture.environmentBackup,
          `DATABASE_URL=${databaseUrl}\n`,
          "utf8",
        ),
        writeFile(
          fixture.environmentPath,
          `DATABASE_URL=${databaseUrl}\n`,
          "utf8",
        ),
      ]);

      const result = await executePrepareDatabaseIdentity(fixture);

      expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "" });
      await expect(readFile(fixture.operationLog, "utf8")).resolves.toBe(
        "database-identity-start\ndatabase-identity-fsync-complete\n",
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      backup:
        "postgresql://stable-user:endpoint-secret@database-a.invalid/diesel",
      expectedError:
        "runtime database identity changed across the release boundary",
      live:
        "DATABASE_URL=postgresql://stable-user:endpoint-secret@database-b.invalid/diesel",
      name: "endpoint drift",
      secret: "endpoint-secret",
    },
    {
      backup:
        "postgresql://stable-user:credential-before@database.invalid/diesel",
      expectedError:
        "runtime database identity changed across the release boundary",
      live:
        "DATABASE_URL=postgresql://stable-user:credential-after@database.invalid/diesel",
      name: "credential drift",
      secret: "credential-after",
    },
    {
      backup: "postgresql://stable-user:protocol-secret@database.invalid/diesel",
      expectedError: "runtime database identity is missing or invalid",
      live: "DATABASE_URL=mysql://stable-user:protocol-secret@database.invalid/diesel",
      name: "a non-PostgreSQL protocol",
      secret: "protocol-secret",
    },
    {
      backup: "postgresql://stable-user:missing-secret@database.invalid/diesel",
      expectedError: "runtime database identity is missing or invalid",
      live: "AI_API_KEY=missing-secret",
      name: "a missing live DATABASE_URL",
      secret: "missing-secret",
    },
  ] as const)(
    "rejects $name without disclosing the database secret",
    async ({ backup, expectedError, live, secret }) => {
      const fixture = await createPreparePreflightFixture("absent");
      try {
        await Promise.all([
          writeFile(
            fixture.environmentBackup,
            `DATABASE_URL=${backup}\n`,
            "utf8",
          ),
          writeFile(fixture.environmentPath, `${live}\n`, "utf8"),
        ]);

        const result = await executePrepareDatabaseIdentity(fixture);

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(expectedError);
        expect(`${result.stdout}\n${result.stderr}`).not.toContain(secret);
        await expect(readFile(fixture.operationLog, "utf8")).resolves.toBe(
          "database-identity-start\n",
        );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    {
      expectedError:
        "pre-switch alternate Nginx backup must be a regular non-symlink file",
      failure: "missing rollback backup",
      prepare: async (
        fixture: Awaited<ReturnType<typeof createPreparePreflightFixture>>,
      ) => rm(fixture.nginxAlternateBackup),
      runtimeEnvironment: {},
    },
    {
      expectedError: "rollback basis durability proof failed",
      failure: "rollback-basis fsync failure",
      prepare: async () => Promise.resolve(),
      runtimeEnvironment: { PREPARE_TEST_ROLLBACK_FSYNC_STATUS: "70" },
    },
  ] as const)(
    "fails closed on $failure before systemd or builder mutation",
    async ({ expectedError, prepare, runtimeEnvironment }) => {
      const fixture = await createPreparePreflightFixture("absent");
      try {
        await prepare(fixture);

        const result = await executePrepareBeforeBuild(
          fixture,
          runtimeEnvironment,
        );

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(expectedError);
        const log = await readFile(fixture.operationLog, "utf8").catch(
          () => "",
        );
        expect(log).not.toContain("systemd-preflight");
        expect(log).not.toContain("build-start");
        await expect(stat(fixture.buildWorkspaceRoot)).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(
          stat(join(fixture.buildRoot, TEST_RELEASE_SHA)),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it.each(["file", "symlink"] as const)(
    "rejects a pre-existing deploy-ready %s before creating a build workspace",
    async (readyKind) => {
      const fixture = await createPreparePreflightFixture(readyKind);
      try {
        const result = await execFileAsync(
          "/bin/bash",
          [
            "-c",
            'source "$1"; prepare_release_effective_uid() { printf "0\\n"; }; prepare_release_require_fixed_root_command_boundary() { export PATH="$1"; }; host_activation_ledger_require_pending() { return 0; }; prepare_release_require_transient_build_commands() { return 0; }; prepare_release_require_systemd_host() { return 0; }; prepare_release_require_unit_absent() { return 0; }; prepare_release_control_group_has_processes() { return 1; }; prepare_release_control_group_is_populated() { return 1; }; prepare_release_uid_has_processes() { return 1; }; prepare_release_run_build_unit() { echo "fake systemd build invoked" >&2; return "${PREPARE_TEST_BUILD_STATUS:-99}"; }; prepare_release_runtime "$2" "$3" "$4" "$5" "$6"',
            "bash",
            prepareReleaseRuntimeScript,
            TEST_RELEASE_SHA,
            fixture.deployRoot,
            fixture.fakePath,
            fixture.nodeBinary,
            fixture.root,
          ],
        ).catch((error: unknown) => error);

        expect(String((result as { stderr?: unknown }).stderr)).toContain(
          ".deploy-ready",
        );
        expect(result).toMatchObject({ code: 70 });
        await expect(
          stat(join(fixture.deployRoot, "build-workspaces")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    { failure: "busy-lock", flockStatus: "1" },
    { failure: "stale-unit", flockStatus: "0" },
    { failure: "builder-process", flockStatus: "0" },
  ])(
    "rejects $failure before creating any per-release builder state",
    async ({ failure, flockStatus }) => {
      const fixture = await createPreparePreflightFixture("absent");
      try {
        const unitCheck =
          failure === "stale-unit"
            ? 'prepare_release_require_unit_absent() { echo "stale unit" >&2; return 70; };'
            : "prepare_release_require_unit_absent() { return 0; };";
        const uidCheck =
          failure === "builder-process"
            ? "prepare_release_uid_has_processes() { return 0; };"
            : "prepare_release_uid_has_processes() { return 1; };";
        const result = await execFileAsync(
          "/bin/bash",
          [
            "-c",
            `source "$1"; prepare_release_effective_uid() { printf "0\\n"; }; prepare_release_require_fixed_root_command_boundary() { export PATH="$1"; }; host_activation_ledger_require_pending() { return 0; }; prepare_release_require_transient_build_commands() { return 0; }; prepare_release_require_systemd_host() { return 0; }; ${unitCheck} prepare_release_control_group_has_processes() { return 1; }; prepare_release_control_group_is_populated() { return 1; }; ${uidCheck} prepare_release_runtime "$2" "$3" "$4" "$5" "$6"`,
            "bash",
            prepareReleaseRuntimeScript,
            TEST_RELEASE_SHA,
            fixture.deployRoot,
            fixture.fakePath,
            fixture.nodeBinary,
            fixture.root,
          ],
          {
            env: {
              ...process.env,
              PREPARE_TEST_FLOCK_STATUS: flockStatus,
            },
          },
        ).catch((error: unknown) => error);

        expect(result).toMatchObject({ code: 70 });
        await expect(
          stat(join(fixture.deployRoot, "build-workspaces")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          stat(join(fixture.buildRoot, TEST_RELEASE_SHA)),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it("normalizes a root:root staged ledger before the builder and cleans a failed build", async () => {
    const fixture = await createPreparePreflightFixture("absent");
    const deployScriptRoot = join(fixture.releaseDir, "scripts", "deploy");
    const buildWorkspace = join(fixture.buildWorkspaceRoot, TEST_RELEASE_SHA);
    const buildHome = join(fixture.buildRoot, TEST_RELEASE_SHA);
    try {
      await mkdir(deployScriptRoot, { recursive: true });
      await Promise.all([
        writeFile(
          join(fixture.releaseDir, ".release-input-manifest.json"),
          "{}\n",
          "utf8",
        ),
        writeExecutable(
          join(deployScriptRoot, "build-release.sh"),
          "#!/bin/bash\nexit 99\n",
        ),
        writeFile(
          join(deployScriptRoot, "release-input-manifest.mjs"),
          "// fixture\n",
          "utf8",
        ),
        writeFile(
          join(deployScriptRoot, "release-artifact-manifest.mjs"),
          "// fixture\n",
          "utf8",
        ),
      ]);

      const result = await execFileAsync(
        "/bin/bash",
        [
          "-c",
          'source "$1"; prepare_release_effective_uid() { printf "0\\n"; }; prepare_release_require_fixed_root_command_boundary() { export PATH="$1"; }; host_activation_ledger_require_pending() { return 0; }; prepare_release_require_transient_build_commands() { return 0; }; prepare_release_require_systemd_host() { printf "systemd-preflight\\n" >>"$PREPARE_TEST_OPERATION_LOG"; return 0; }; prepare_release_require_unit_absent() { return 0; }; prepare_release_control_group_has_processes() { return 1; }; prepare_release_control_group_is_populated() { return 1; }; prepare_release_uid_has_processes() { return 1; }; prepare_release_run_build_unit() { printf "build-start\\n" >>"$PREPARE_TEST_OPERATION_LOG"; echo "fake systemd build invoked" >&2; return "${PREPARE_TEST_BUILD_STATUS:-99}"; }; prepare_release_runtime "$2" "$3" "$4" "$5" "$6"',
          "bash",
          prepareReleaseRuntimeScript,
          TEST_RELEASE_SHA,
          fixture.deployRoot,
          fixture.fakePath,
          fixture.nodeBinary,
          fixture.root,
        ],
        {
          env: {
            ...process.env,
            PREPARE_TEST_BUILD_STATUS: "23",
            PREPARE_TEST_OPERATION_LOG: fixture.operationLog,
          },
        },
      ).catch((error: unknown) => error);

      expect(result).toMatchObject({ code: 23 });
      expect(String((result as { stderr?: unknown }).stderr)).toContain(
        "fake systemd build invoked",
      );
      await expect(readFile(fixture.operationLog, "utf8")).resolves.toBe(
        [
          `rollback-basis:${fixture.previousReleaseFile}`,
          `rollback-basis:${fixture.environmentBackup}`,
          `rollback-basis:${fixture.nginxPrimaryBackup}`,
          `rollback-basis:${fixture.nginxAlternateBackup}`,
          `rollback-basis:${join(
            fixture.backupRoot,
            TEST_RELEASE_SHA,
          )}`,
          `rollback-basis:${fixture.backupRoot}`,
          `rollback-basis:${fixture.deployRoot}`,
          "database-identity-start",
          "database-identity-fsync-complete",
          "systemd-preflight",
          "build-start",
          "",
        ].join("\n"),
      );
      await expect(stat(buildWorkspace)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stat(buildHome)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(fixture.buildWorkspaceRoot)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
      await expect(stat(fixture.buildRoot)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 30_000);

  it("preserves both builder directories when unit cleanup cannot be proven", async () => {
    const fixture = await createPreparePreflightFixture("absent");
    const deployScriptRoot = join(fixture.releaseDir, "scripts", "deploy");
    const buildWorkspace = join(fixture.buildWorkspaceRoot, TEST_RELEASE_SHA);
    const buildHome = join(fixture.buildRoot, TEST_RELEASE_SHA);
    try {
      await mkdir(deployScriptRoot, { recursive: true });
      await Promise.all([
        writeFile(
          join(fixture.releaseDir, ".release-input-manifest.json"),
          "{}\n",
          "utf8",
        ),
        writeExecutable(
          join(deployScriptRoot, "build-release.sh"),
          "#!/bin/bash\nexit 99\n",
        ),
        writeFile(
          join(deployScriptRoot, "release-input-manifest.mjs"),
          "// fixture\n",
          "utf8",
        ),
        writeFile(
          join(deployScriptRoot, "release-artifact-manifest.mjs"),
          "// fixture\n",
          "utf8",
        ),
      ]);

      const result = await execFileAsync(
        "/bin/bash",
        [
          "-c",
          'source "$1"; prepare_release_effective_uid() { printf "0\\n"; }; prepare_release_require_fixed_root_command_boundary() { export PATH="$1"; }; host_activation_ledger_require_pending() { return 0; }; prepare_release_require_transient_build_commands() { return 0; }; prepare_release_require_systemd_host() { return 0; }; prepare_release_require_unit_absent() { return 0; }; prepare_release_control_group_has_processes() { return 1; }; prepare_release_control_group_is_populated() { return 1; }; prepare_release_uid_has_processes() { return 1; }; prepare_release_run_build_unit() { PREPARE_RELEASE_CLEANUP_BUILD_UNIT_ARMED=1; return 23; }; prepare_release_quiesce_build_unit() { echo "fake cgroup cleanup failure" >&2; return 70; }; prepare_release_runtime "$2" "$3" "$4" "$5" "$6"',
          "bash",
          prepareReleaseRuntimeScript,
          TEST_RELEASE_SHA,
          fixture.deployRoot,
          fixture.fakePath,
          fixture.nodeBinary,
          fixture.root,
        ],
      ).catch((error: unknown) => error);

      expect(result).toMatchObject({ code: 70 });
      expect(String((result as { stderr?: unknown }).stderr)).toContain(
        "retaining build workspace and home",
      );
      await expect(stat(buildWorkspace)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
      await expect(stat(buildHome)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 15_000);

  it.each(["file", "symlink"] as const)(
    "rejects a pre-existing deploy-ready %s before a release build",
    async (readyKind) => {
      const fixture = await createBuildFixture();
      const readyPath = join(fixture, ".deploy-ready");
      if (readyKind === "file") {
        await writeFile(readyPath, "premature\n", "utf8");
      } else {
        await symlink(join(fixture, "missing-ready-target"), readyPath);
      }
      const buildEnvironment = { ...process.env };
      delete buildEnvironment.DATABASE_URL;
      delete buildEnvironment.AI_API_KEY;
      delete buildEnvironment.ADMIN_ROLE_BINDINGS_JSON;

      try {
        const result = await execFileAsync(
          "bash",
          [resolve(process.cwd(), "scripts/deploy/build-release.sh")],
          {
            cwd: fixture,
            env: {
              ...buildEnvironment,
              BUILD_HOME: fixture,
              BUILD_RELEASE_ID: TEST_RELEASE_SHA,
            },
          },
        ).catch((error: unknown) => error);

        expect(result).toMatchObject({ code: 64 });
        expect(String((result as { stderr?: unknown }).stderr)).toContain(
          ".deploy-ready must not exist",
        );
      } finally {
        await rm(fixture, { force: true, recursive: true });
      }
    },
  );

  it("fails public governance validation on a mismatched public release", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "diesel-governance-validator-"));
    const fakeBin = join(fixture, "bin");
    const curlArguments = join(fixture, "curl-arguments");
    await mkdir(fakeBin);
    await writeExecutable(
      join(fakeBin, "curl"),
      `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$@" >${quoteShell(curlArguments)}
printf '%s\\n' '{"status":"ok","version":"wrong-release"}'
`,
    );

    try {
      const result = await execFileAsync(
        "/bin/bash",
        [publicGovernanceValidationScript, TEST_RELEASE_SHA],
        {
          env: {
            ...process.env,
            PATH: `${fakeBin}:${dirname(process.execPath)}:/usr/bin:/bin`,
          },
        },
      ).catch((error: unknown) => error);

      expect(result).toMatchObject({ code: 1 });
      expect(String((result as { stderr?: unknown }).stderr)).toContain(
        "Unexpected public health payload",
      );
      const argumentsUsed = (await readFile(curlArguments, "utf8"))
        .trim()
        .split("\n");
      expect(argumentsUsed[0]).toBe("--disable");
      expect(argumentsUsed).toContain("--max-filesize");
      expect(argumentsUsed).toContain("4194304");
      expect(argumentsUsed).toContain("--noproxy");
      expect(argumentsUsed).toContain("*");
      expect(argumentsUsed).toContain("--proto");
      expect(argumentsUsed).toContain("=https");
      expect(argumentsUsed.at(-1)).toBe(
        "https://diesel.jamesky.site/api/health/ready",
      );
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  it("rejects unsafe release identifiers before rollback filesystem access", async () => {
    const result = await execFileAsync("bash", [
      resolve(process.cwd(), "scripts/deploy/rollback-host-release.sh"),
      "../current",
      "--check",
    ]).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 64 });
  });

  it("rejects a legacy-shaped rollback release identifier at the direct CLI", async () => {
    const result = await execFileAsync("/bin/bash", [
      rollbackHostReleaseScript,
      "failed-release",
      "--check",
    ]).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 64 });
  });

  it.each([
    ["staged directory", "directory", "root:root:755", 0],
    ["normalized directory", "directory", "root:diesel:750", 0],
    ["staged executable", "executable", "root:root:755:1", 0],
    ["normalized executable", "executable", "root:diesel:750:1", 0],
    ["hard-linked executable", "executable", "root:diesel:750:2", 1],
    ["writable executable", "executable", "root:diesel:770:1", 1],
  ] as const)(
    "classifies %s at the direct rollback source boundary",
    async (_name, objectType, metadata, expectedStatus) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; rollback_cli_bootstrap_metadata_is_allowed "$2" "$3"',
        "rollback-cli-metadata-fixture",
        rollbackHostReleaseScript,
        objectType,
        metadata,
      ]);

      expect(result).toEqual({
        exitCode: expectedStatus,
        stderr: "",
        stdout: "",
      });
    },
  );

  it("binds a direct rollback CLI to the requested release before sourcing its ledger", async () => {
    const result = await execFileAsync("/bin/bash", [
      rollbackHostReleaseScript,
      TEST_RELEASE_SHA,
      "--check",
    ]).catch((error: unknown) => error);
    const rollbackScript = await readFile(rollbackHostReleaseScript, "utf8");
    const entryBindingIndex = rollbackScript.indexOf(
      'rollback_expected_entry="/opt/diesel/releases/$1/scripts/deploy/rollback-host-release.sh"',
    );
    const ledgerSourceIndex = rollbackScript.indexOf(
      'source -- "${rollback_script_directory}/host-activation-ledger.sh"',
    );
    const ledgerValidationIndex = rollbackScript.indexOf(
      '"${rollback_expected_ledger}" executable',
    );
    const rootPathIndex = rollbackScript.indexOf(
      'export PATH="/usr/sbin:/usr/bin:/sbin:/bin"',
    );

    expect(result).toMatchObject({ code: 70 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "rollback pre-source trust validation failed",
    );
    expect(entryBindingIndex).toBeGreaterThanOrEqual(0);
    expect(ledgerValidationIndex).toBeGreaterThan(entryBindingIndex);
    expect(rootPathIndex).toBeGreaterThan(ledgerValidationIndex);
    expect(ledgerSourceIndex).toBeGreaterThan(rootPathIndex);
    expect(ledgerSourceIndex).toBeGreaterThan(ledgerValidationIndex);
    expect(ledgerSourceIndex).toBeGreaterThan(entryBindingIndex);
  });

  it.each([
    {
      fixedPath: "/tmp/untrusted-bin:/usr/bin:/bin",
      name: "root PATH",
      nodeBinary: "/opt/node-v22.22.3-linux-x64/bin/node",
      pm2Executable:
        "/opt/node-v22.22.3-linux-x64/lib/node_modules/pm2/bin/pm2",
    },
    {
      fixedPath: PRODUCTION_PROCESS_PATH,
      name: "Node executable",
      nodeBinary: "/tmp/untrusted-node",
      pm2Executable:
        "/opt/node-v22.22.3-linux-x64/lib/node_modules/pm2/bin/pm2",
    },
    {
      fixedPath: PRODUCTION_PROCESS_PATH,
      name: "PM2 executable",
      nodeBinary: "/opt/node-v22.22.3-linux-x64/bin/node",
      pm2Executable: "/tmp/untrusted-pm2",
    },
  ])("rejects production rollback $name drift before host access", async ({
    fixedPath,
    nodeBinary,
    pm2Executable,
  }) => {
    const result = await execute("/bin/bash", [
      "--noprofile",
      "--norc",
      "-c",
      'source -- "$1"; rollback_require_production_command_boundary "$2" "$3" "$4"',
      "rollback-runtime-boundary-fixture",
      rollbackHostReleaseScript,
      fixedPath,
      nodeBinary,
      pm2Executable,
    ]);

    expect(result).toMatchObject({ exitCode: 70, stdout: "" });
    expect(result.stderr).toContain(
      "production rollback requires the fixed runtime profile",
    );
  });

  it.each([
    {
      command: 'source -- "$1"; rollback_host_release_main "$2" --check',
      expectedError: "production rollback main is unavailable when sourced",
      name: "main",
    },
    {
      command:
        'source -- "$1"; rollback_host_release "$2" --check /opt/diesel /etc/nginx/sites-available /opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /opt/node-v22.22.3-linux-x64/bin/node /proc /root/.pm2 /opt/node-v22.22.3-linux-x64/lib/node_modules/pm2/bin/pm2 /etc/systemd/system/pm2-root.service',
      expectedError:
        "production rollback state machine is unavailable when sourced",
      name: "state machine",
    },
    {
      command:
        'source -- "$1"; rollback_host_release "$2" --check /opt/diesel /tmp/nginx /usr/bin:/bin /usr/bin/node /proc /tmp/pm2 /tmp/pm2-exec /tmp/pm2.service 1001 1001 ""',
      expectedError:
        "rollback test seam cannot target the production deployment root",
      name: "13-argument test seam",
    },
    {
      command:
        'source -- "$1"; rollback_host_release "$2" --check /opt/diesel/ /tmp/nginx /usr/bin:/bin /usr/bin/node /proc /tmp/pm2 /tmp/pm2-exec /tmp/pm2.service 1001 1001 ""',
      expectedError:
        "rollback test seam cannot target the production deployment root",
      name: "13-argument trailing-slash test seam",
    },
    {
      command:
        'source -- "$1"; rollback_host_release "$2" --check /opt//diesel /tmp/nginx /usr/bin:/bin /usr/bin/node /proc /tmp/pm2 /tmp/pm2-exec /tmp/pm2.service 1001 1001 ""',
      expectedError:
        "rollback test seam cannot target the production deployment root",
      name: "13-argument repeated-slash test seam",
    },
  ])("rejects the sourced production rollback $name", async ({
    command,
    expectedError,
  }) => {
    const result = await execute("/bin/bash", [
      "--noprofile",
      "--norc",
      "-c",
      command,
      "rollback-sourced-fixture",
      rollbackHostReleaseScript,
      TEST_RELEASE_SHA,
    ]);

    expect(result).toMatchObject({ exitCode: 64, stdout: "" });
    expect(result.stderr).toContain(expectedError);
  });

  it("rejects attempts to override fixed production rollback paths", async () => {
    const result = await execFileAsync("bash", [
      rollbackHostReleaseScript,
      "failed-release",
      "--check",
      "/tmp/test-only-deploy-root",
    ]).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 64 });
  });

  it.each([
    {
      corrupt: async (fixture: RollbackFixture) => {
        await rm(fixture.pm2StateHelper);
      },
      name: "missing",
    },
    {
      corrupt: async (fixture: RollbackFixture) => {
        await rm(fixture.pm2StateHelper);
        await symlink(
          join(
            fixture.previousRelease,
            "scripts",
            "deploy",
            "verify-release.sh",
          ),
          fixture.pm2StateHelper,
        );
      },
      name: "symlinked",
    },
    {
      corrupt: async (fixture: RollbackFixture) => {
        await writeFile(
          join(fixture.root, "untrusted-owner-path"),
          fixture.pm2StateHelper,
          "utf8",
        );
      },
      name: "untrusted",
    },
  ] as const)(
    "rejects a $name versioned PM2 persistence helper before host mutation",
    async ({ corrupt }) => {
      const fixture = await createRollbackFixture();
      try {
        await corrupt(fixture);
        const before = await captureRollbackTargets(fixture);

        const result = await executeRollback(fixture, "--apply");

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain("versioned PM2 persistence helper");
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    {
      corrupt: async (fixture: RollbackFixture) => {
        await rm(fixture.hostActivationLedger);
      },
      name: "missing",
    },
    {
      corrupt: async (fixture: RollbackFixture) => {
        await rm(fixture.hostActivationLedger);
        await symlink(fixture.pm2StateHelper, fixture.hostActivationLedger);
      },
      name: "symlinked",
    },
    {
      corrupt: async (fixture: RollbackFixture) => {
        await writeFile(
          join(fixture.root, "untrusted-owner-path"),
          fixture.hostActivationLedger,
          "utf8",
        );
      },
      name: "untrusted",
    },
  ] as const)(
    "rejects a $name versioned host activation ledger before host mutation",
    async ({ corrupt }) => {
      const fixture = await createRollbackFixture();
      try {
        await corrupt(fixture);
        const before = await captureRollbackTargets(fixture);

        const result = await executeRollback(fixture, "--apply");

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain("versioned host activation ledger");
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    { name: "upstream vendor ordering", paths: ["/etc/systemd/system", "/usr/local/lib/systemd/system", "/usr/lib/systemd/system", "/lib/systemd/system", "/run/systemd/generator.late"], allowed: true },
    { name: "Ubuntu 249 vendor ordering", paths: ["/etc/systemd/system", "/usr/local/lib/systemd/system", "/lib/systemd/system", "/usr/lib/systemd/system", "/run/systemd/generator.late"], allowed: true },
    { name: "optional roots omitted", paths: ["/etc/systemd/system", "/lib/systemd/system"], allowed: true },
    { name: "reversed administrative precedence", paths: ["/run/systemd/system", "/etc/systemd/system"], allowed: false },
    { name: "reversed local vendor precedence", paths: ["/lib/systemd/system", "/usr/local/lib/systemd/system"], allowed: false },
    { name: "duplicate root", paths: ["/etc/systemd/system", "/etc/systemd/system"], allowed: false },
    { name: "unknown root", paths: ["/etc/systemd/system", "/tmp/units"], allowed: false },
  ])("native PM2 unit paths: $name", async ({ paths, allowed }) => {
    const source = await readFile(rollbackHostReleaseScript, "utf8");
    const orders = source.slice(
      source.indexOf("const approvedUnitPathOrder = ["),
      source.indexOf("function readBoundedDescriptor", source.indexOf("const approvedUnitPathOrder = [")),
    );
    const predicate = source.slice(
      source.indexOf("function isOrderedSubset("),
      source.indexOf("function parseManagerProperties("),
    );
    expect(source).toContain("!approvedUnitPathOrders.some((order) =>");
    expect(runInNewContext(
      `${orders}\n${predicate}\npaths.every(path => approvedUnitPaths.has(path)) && approvedUnitPathOrders.some(order => isOrderedSubset(paths, order))`,
      { paths },
      { timeout: 100 },
    )).toBe(allowed);
  });

  it.each(["249.11-0ubuntu3.11", "250", "250.1-1"])(
    "native PM2 compatibility proves omitted properties on systemd %s without mutation",
    async (version) => {
      const fixture = await createRollbackFixture();
      try {
        await writeFile(join(fixture.root, "systemd-show-omit"), "EnvironmentFiles\nExecCondition\nExecStartPre\nExecStartPost\nExecStopPost\nUpholds\n");
        await writeFile(join(fixture.root, "systemd-manager-includes-absent"), "1\n");
        await writeFile(join(fixture.root, "systemd-bus-config.json"), JSON.stringify({ Version: { value: { type: "s", data: version } } }));
        await writeFile(join(fixture.procRoot, "111", "cgroup"), "10:net_prio:/\n9:perf_event:/\n8:net_cls:/\n7:freezer:/\n6:devices:/\n3:cpuacct:/\n0::/system.slice/pm2-root.service\n");
        const before = await captureRollbackTargets(fixture);
        const result = await executeRollback(fixture, "--check");
        expect(result, await readLifecycleLog(fixture)).toMatchObject({ exitCode: 0, stderr: "" });
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
        const log = await readLifecycleLog(fixture);
        for (const key of ["EnvironmentFiles", "ExecCondition", "ExecStartPre", "ExecStartPost", "ExecStopPost", "GetAll", "Version"]) {
          expect(log.split(`busctl:${key}\n`).length - 1).toBe(2);
        }
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it.each([
    ...["EnvironmentFiles", "ExecCondition", "ExecStartPre", "ExecStartPost", "ExecStopPost"].map((key) => ({
      name: `nonempty omitted ${key}`,
      omit: key,
      config: { [key]: { value: { type: key === "EnvironmentFiles" ? "a(sb)" : "a(sasbttttuii)", data: [["untrusted"]] } } },
    })),
    { name: "failed D-Bus read", omit: "EnvironmentFiles", config: { EnvironmentFiles: { status: 1 } } },
    { name: "malformed D-Bus JSON", omit: "EnvironmentFiles", config: { EnvironmentFiles: { stdout: "not-json\n" } } },
    { name: "wrong empty array signature", omit: "EnvironmentFiles", config: { EnvironmentFiles: { value: { type: "as", data: [] } } } },
    { name: "null array", omit: "EnvironmentFiles", config: { EnvironmentFiles: { value: { type: "a(sb)", data: null } } } },
    { name: "extra D-Bus field", omit: "EnvironmentFiles", config: { EnvironmentFiles: { value: { type: "a(sb)", data: [], extra: true } } } },
    { name: "D-Bus A/B drift", omit: "EnvironmentFiles", config: { EnvironmentFiles: { second: { value: { type: "a(sb)", data: [["untrusted", false]] } } } } },
    ...["248", "251", "255.4", "249\n", "249 arbitrary"].map((version) => ({
      name: `unsupported Upholds omission version ${JSON.stringify(version)}`,
      omit: "Upholds", config: { Version: { value: { type: "s", data: version } } },
    })),
    { name: "existing Upholds despite show omission", omit: "Upholds", config: { GetAll: { value: { type: "a{sv}", data: [{ Id: { type: "s", data: "pm2-root.service" }, Upholds: { type: "as", data: [] } }] } } } },
    { name: "wrong GetAll unit identity", omit: "Upholds", config: { GetAll: { value: { type: "a{sv}", data: [{ Id: { type: "s", data: "other.service" } }] } } } },
    { name: "failed capability read", omit: "Upholds", config: { GetAll: { status: 1 } } },
    { name: "failed manager version read", omit: "Upholds", config: { Version: { status: 1 } } },
    { name: "unapproved missing property", omit: "RootDirectory", config: {} },
  ])("native PM2 compatibility rejects $name without mutation", async ({ omit, config }) => {
    const fixture = await createRollbackFixture();
    try {
      await writeFile(join(fixture.root, "systemd-show-omit"), `${omit}\n`);
      await writeFile(join(fixture.root, "systemd-bus-config.json"), JSON.stringify(config));
      const before = await captureRollbackTargets(fixture);
      const result = await executeRollback(fixture, "--check");
      expect(result.exitCode).toBe(70);
      const log = await readLifecycleLog(fixture);
      if (omit === "Upholds") {
        expect(log).toContain("busctl:GetAll\n");
      } else if (omit !== "RootDirectory") {
        expect(log).toContain(`busctl:${omit}\n`);
      } else {
        expect(log).not.toContain("busctl:");
      }
      await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
      await expect(readMutationLog(fixture)).resolves.toBe("");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    "0::/other.service\n",
    "0::/system.slice/pm2-root.service\n0::/system.slice/pm2-root.service\n",
    "3:cpuacct:/other.service\n0::/system.slice/pm2-root.service\n",
    "3:name=systemd:/\n0::/system.slice/pm2-root.service\n",
    "3:cpuacct:/\n3:devices:/\n0::/system.slice/pm2-root.service\n",
    "3:cpuacct:/\n4:cpuacct:/\n0::/system.slice/pm2-root.service\n",
    "3:unknown:/\n0::/system.slice/pm2-root.service\n",
    "3:cpuacct,:/\n0::/system.slice/pm2-root.service\n",
    "3:cpuacct:/\n",
  ])("native PM2 compatibility rejects ambiguous cgroup identity %#", async (contents) => {
    const fixture = await createRollbackFixture();
    try {
      await writeFile(join(fixture.procRoot, "111", "cgroup"), contents);
      const before = await captureRollbackTargets(fixture);
      expect((await executeRollback(fixture, "--check")).exitCode).toBe(70);
      await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
      await expect(readMutationLog(fixture)).resolves.toBe("");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps a successful host rollback check read-only", async () => {
    const fixture = await createRollbackFixture();
    try {
      const before = await captureRollbackTargets(fixture);
      const result = await executeRollback(fixture, "--check");

      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(result.stdout).toContain("Host rollback preflight passed");
      await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
      await expect(readMutationLog(fixture)).resolves.toBe("");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 30_000);

  it("rejects an invalid persisted Nginx pair during read-only preflight", async () => {
    const fixture = await createRollbackFixture();
    try {
      await writeFile(
        join(fixture.root, "nginx-backup-invalid"),
        "invalid\n",
        "utf8",
      );
      const before = await captureRollbackTargets(fixture);

      const result = await executeRollback(fixture, "--check");

      expect(result).toMatchObject({ exitCode: 70 });
      expect(result.stderr).toContain(
        "rollback Nginx backup configuration is invalid",
      );
      await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
      await expect(readMutationLog(fixture)).resolves.toBe("");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 30_000);

  it.each([
    {
      expectedError: /JSON|SyntaxError|Unexpected token/u,
      flag: "pm2-invalid-jlist",
      name: "invalid PM2 jlist JSON",
    },
    {
      expectedError: /PM2 process list and describe output disagree/u,
      flag: "pm2-describe-failure",
      name: "a PM2 jlist and describe disagreement",
    },
  ] as const)(
    "fails before host mutation for $name",
    async ({ expectedError, flag }) => {
      const fixture = await createRollbackFixture();
      try {
        await writeFile(join(fixture.root, flag), "fail\n", "utf8");
        const before = await captureRollbackTargets(fixture);

        const result = await executeRollback(fixture, "--apply");

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toMatch(expectedError);
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it.each([
    {
      flag: "pm2-duplicate-process",
      name: "duplicate named processes",
    },
    {
      flag: "pm2-offline-process",
      name: "an offline named process",
    },
  ] as const)(
    "repairs $name and converges to one healthy previous-release process",
    async ({ flag }) => {
      const fixture = await createRollbackFixture();
      try {
        await writeFile(join(fixture.root, flag), "fault\n", "utf8");

        const result = await executeRollback(fixture, "--apply");

        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        await expectRollbackFilesRestored(fixture);
        const mutations = await readMutationLog(fixture);
        expect(mutations.match(/^pm2-delete:diesel-demo$/gmu)).toHaveLength(1);
        expect(mutations.match(/^pm2-start:previous-release:.*$/gmu)).toHaveLength(
          1,
        );
        expect(mutations).toContain("pm2-save");
        expect(mutations).toContain("systemctl-reload:nginx");
        expect(mutations).toContain(
          "verify:http://127.0.0.1:8788:previous-release",
        );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it(
    "fails closed when PM2 reports the wrong version after start and converges on retry",
    async () => {
      const fixture = await createRollbackFixture();
      const wrongVersionFlag = join(
        fixture.root,
        "pm2-start-wrong-version",
      );
      try {
        await writeFile(wrongVersionFlag, "fault\n", "utf8");

        const firstResult = await executeRollback(fixture, "--apply");

        expect(firstResult.exitCode).not.toBe(0);
        expect(firstResult.stderr).toContain(
          "rollback process identity validation failed",
        );
        await expect(readFile(fixture.environmentPath, "utf8")).resolves.toBe(
          "OLD_ENV=1\n",
        );
        await expect(readFile(fixture.nginxPrimaryPath, "utf8")).resolves.toBe(
          "old primary nginx\n",
        );
        await expect(
          readFile(fixture.nginxAlternatePath, "utf8"),
        ).resolves.toBe("old alternate nginx\n");
        await expect(realpath(fixture.currentLink)).resolves.toBe(
          fixture.previousRelease,
        );
        await expect(readFile(fixture.pm2State, "utf8")).resolves.toBe(
          "wrong-release",
        );
        const failedAttemptMutations = await readMutationLog(fixture);
        // Startup identity is now proven before persisting a replacement.
        expect(failedAttemptMutations).not.toContain("pm2-save");
        expect(failedAttemptMutations).not.toContain("systemctl-reload:nginx");
        expect(failedAttemptMutations).not.toContain("verify:");
        expect(await readLifecycleLog(fixture)).not.toContain("pm2-helper:");

        await rm(wrongVersionFlag);
        const secondResult = await executeRollback(fixture, "--apply");

        expect(secondResult).toMatchObject({ exitCode: 0, stderr: "" });
        await expectRollbackFilesRestored(fixture);
        const mutations = await readMutationLog(fixture);
        expect(mutations.match(/^pm2-delete:diesel-demo$/gmu)).toHaveLength(2);
        expect(mutations.match(/^pm2-start:previous-release:.*$/gmu)).toHaveLength(
          2,
        );
        expect(mutations.match(/^systemctl-reload:nginx$/gmu)).toHaveLength(1);
        expect(
          mutations.match(
            /^verify:http:\/\/127\.0\.0\.1:8788:previous-release$/gmu,
          ),
        ).toHaveLength(1);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it(
    "keeps an exact current.next during rollback check, then durably removes it before abort reaches terminal state",
    async () => {
      const fixture = await createRollbackFixture({
        current: "previous",
        pm2Version: "previous-release",
      });
      const currentNext = join(fixture.deployRoot, "current.next");
      try {
        await symlink(fixture.failedRelease, currentNext);

        const checked = await executeRollback(fixture, "--check");

        expect(checked).toMatchObject({ exitCode: 0, stderr: "" });
        await expect(readlink(currentNext)).resolves.toBe(
          fixture.failedRelease,
        );
        const checkedLifecycle = await readLifecycleLog(fixture);
        expect(checkedLifecycle).not.toContain("delete-current-next");
        const abortStartIndex = checkedLifecycle.trim().split("\n").length;
        await expect(readMutationLog(fixture)).resolves.toBe("");

        const aborted = await executeRollback(
          fixture,
          "--abort-if-uncommitted",
        );

        expect(aborted).toMatchObject({ exitCode: 0, stderr: "" });
        expect(aborted.stdout).toContain("Host rollback completed");
        await expect(lstat(currentNext)).rejects.toMatchObject({ code: "ENOENT" });
        await expectRollbackFilesRestored(fixture);
        const events = (await readLifecycleLog(fixture)).trim().split("\n");
        const secondLockIndex = events.indexOf("flock:-n 8", abortStartIndex);
        const deleteIndex = events.indexOf(
          "delete-current-next",
          secondLockIndex + 1,
        );
        const cleanupFsyncIndex = events.indexOf(
          `fsync:${fixture.deployRoot}`,
          deleteIndex + 1,
        );
        const pm2StartIndex = events.findIndex(
          (event, index) =>
            index > cleanupFsyncIndex &&
            event.startsWith("pm2-start:previous-release:"),
        );
        const terminalIndex = events.indexOf(
          "ledger-transition:failed-release:ROLLED_BACK",
          pm2StartIndex + 1,
        );
        expect(secondLockIndex).toBeGreaterThan(-1);
        expect(deleteIndex).toBeGreaterThan(secondLockIndex);
        expect(cleanupFsyncIndex).toBeGreaterThan(deleteIndex);
        expect(pm2StartIndex).toBeGreaterThan(cleanupFsyncIndex);
        expect(terminalIndex).toBeGreaterThan(pm2StartIndex);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it.each([
    {
      current: "previous",
      mode: "--abort-if-uncommitted",
      name: "before the release symlink switch",
      pm2Version: "previous-release",
    },
    {
      current: "failed",
      mode: "--apply",
      name: "after the release symlink switch",
      pm2Version: "failed-release",
    },
  ] as const)(
    "restores and verifies the previous release $name",
    async ({ current, mode, pm2Version }) => {
      const fixture = await createRollbackFixture({ current, pm2Version });
      try {
        const result = await executeRollback(fixture, mode);

        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(result.stdout).toContain("Host rollback completed");
        await expectRollbackFilesRestored(fixture);
        const mutations = await readMutationLog(fixture);
        expect(mutations).toContain(
          "verify:http://127.0.0.1:8788:previous-release",
        );
        expect(mutations).not.toContain("failed-verifier");
        expect(mutations).toContain("pm2-save");
        expect(mutations).toContain("systemctl-reload:nginx");
        expect(mutations).toContain("pm2-delete:diesel-demo");
        expect(mutations).toContain("pm2-start:previous-release:");
        const lifecycleEvents = (await readLifecycleLog(fixture))
          .trim()
          .split("\n");
        const saveIndex = lifecycleEvents.indexOf("pm2-save");
        expect(saveIndex).toBeGreaterThan(-1);
        const durablePm2Index = await expectDurablePm2Validation(
          fixture,
          "previous-release",
          saveIndex,
        );
        const verifierIndex = lifecycleEvents.indexOf(
          "verify:http://127.0.0.1:8788:previous-release",
          durablePm2Index + 1,
        );
        const ledgerIndex = lifecycleEvents.indexOf(
          "ledger-transition:failed-release:ROLLED_BACK",
          verifierIndex + 1,
        );
        expect(verifierIndex).toBeGreaterThan(durablePm2Index);
        expect(ledgerIndex).toBeGreaterThan(verifierIndex);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it(
    "restores the host in governance mode while preserving HOST_ROLLBACK_REQUIRED",
    async () => {
      const fixture = await createRollbackFixture();
      const completedMarker = join(
        fixture.stateDir,
        "HOST_ROLLBACK_COMPLETED",
      );
      try {
        const hostRollbackMarker = await writeHostRollbackMarker(fixture);
        const governanceSnapshot = join(
          fixture.stateDir,
          "governance-before.json",
        );
        const markerPayload = await readFile(hostRollbackMarker, "utf8");
        const [snapshotHash, snapshotPath] = markerPayload
          .trimEnd()
          .split("\t");

        expect(snapshotHash).toMatch(/^[0-9a-f]{64}$/u);
        expect(snapshotPath).toBe(governanceSnapshot);
        expect(markerPayload).toBe(
          `${snapshotHash}\t${governanceSnapshot}\n`,
        );
        for (const path of [
          fixture.lifecycleLock,
          governanceSnapshot,
          hostRollbackMarker,
        ]) {
          const metadata = await lstat(path);
          expect(metadata.isFile()).toBe(true);
          expect(metadata.mode & 0o777).toBe(0o600);
        }

        const result = await executeRollback(
          fixture,
          "--restore-governance-host",
        );

        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        await expectRollbackFilesRestored(fixture);
        await expect(readFile(hostRollbackMarker, "utf8")).resolves.toBe(
          markerPayload,
        );
        await expect(readFile(completedMarker, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });

        const lifecycleEvents = (await readLifecycleLog(fixture))
          .trim()
          .split("\n");
        const pm2SaveIndex = lifecycleEvents.indexOf("pm2-save");
        const durablePm2Index = await expectDurablePm2Validation(
          fixture,
          "previous-release",
          pm2SaveIndex,
        );
        const verifierIndex = lifecycleEvents.indexOf(
          "verify:http://127.0.0.1:8788:previous-release",
        );
        const markerFsyncIndex = lifecycleEvents.indexOf(
          `fsync:${hostRollbackMarker}`,
          verifierIndex,
        );
        const stateFsyncIndex = lifecycleEvents.indexOf(
          `fsync:${fixture.stateDir}`,
          markerFsyncIndex,
        );
        const backupsFsyncIndex = lifecycleEvents.indexOf(
          `fsync:${join(fixture.deployRoot, "backups")}`,
          stateFsyncIndex,
        );
        expect(lifecycleEvents.filter((event) => event === "flock:-n 8")).toHaveLength(
          1,
        );
        expect(pm2SaveIndex).toBeGreaterThan(-1);
        expect(verifierIndex).toBeGreaterThan(durablePm2Index);
        expect(markerFsyncIndex).toBeGreaterThan(verifierIndex);
        expect(stateFsyncIndex).toBeGreaterThan(markerFsyncIndex);
        expect(backupsFsyncIndex).toBeGreaterThan(stateFsyncIndex);
        expect(lifecycleEvents).not.toContain(
          `transition:${hostRollbackMarker}:${completedMarker}`,
        );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it("refuses HOST_ROLLBACK_REQUIRED outside maintenance-locked governance recovery", async () => {
    const fixture = await createRollbackFixture();
    try {
      const hostRollbackMarker = await writeHostRollbackMarker(fixture);
      const markerPayload = await readFile(hostRollbackMarker, "utf8");
      const before = await captureRollbackTargets(fixture);

      const result = await executeRollback(
        fixture,
        "--abort-if-uncommitted",
      );

      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain(
        "HOST_ROLLBACK_REQUIRED requires maintenance-locked governance recovery",
      );
      await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
      await expect(readFile(hostRollbackMarker, "utf8")).resolves.toBe(
        markerPayload,
      );
      await expect(readMutationLog(fixture)).resolves.toBe("");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it(
    "rejects a terminal HOST_ROLLBACK_COMPLETED ledger in every host rollback mode",
    async () => {
      const fixture = await createRollbackFixture({
        current: "previous",
        pm2Version: "previous-release",
      });
      try {
        const completedMarker = await writePublishStateMarker(
          fixture,
          "HOST_ROLLBACK_COMPLETED",
        );
        const markerPayload = await readFile(completedMarker, "utf8");

        for (const mode of [
          "--abort-if-uncommitted",
          "--restore-governance-host",
        ] as const) {
          const before = await captureRollbackTargets(fixture);
          const result = await executeRollback(fixture, mode);

          expect(result.exitCode).toBe(70);
          expect(result.stderr).toContain(
            "HOST_ROLLBACK_COMPLETED is a terminal audit ledger",
          );
          await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
          await expect(readFile(completedMarker, "utf8")).resolves.toBe(
            markerPayload,
          );
        }
        expect(await readMutationLog(fixture)).toBe("");
        expect(await readLifecycleLog(fixture)).not.toContain("transition:");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it.each([
    {
      failureFlag: "pm2-helper-fail",
      name: "the durable PM2 helper fails",
    },
    {
      failureFlag: "pm2-wrong-uid",
      name: "the restored PM2 process uses the wrong uid",
    },
    {
      failureFlag: "fail-verifier-once",
      name: "the previous-release verifier fails",
    },
    {
      failureFlag: "fsync-fail",
      name: "the host durability proof fails",
    },
  ] as const)(
    "retains HOST_ROLLBACK_REQUIRED when $name",
    async ({ failureFlag }) => {
      const fixture = await createRollbackFixture();
      const completedMarker = join(
        fixture.stateDir,
        "HOST_ROLLBACK_COMPLETED",
      );
      try {
        const hostRollbackMarker = await writeHostRollbackMarker(fixture);
        const markerPayload = await readFile(hostRollbackMarker, "utf8");
        await writeFile(join(fixture.root, failureFlag), "fault\n", "utf8");

        const result = await executeRollback(
          fixture,
          "--restore-governance-host",
        );

        expect(result.exitCode).not.toBe(0);
        await expect(readFile(hostRollbackMarker, "utf8")).resolves.toBe(
          markerPayload,
        );
        await expect(readFile(completedMarker, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        const retainedMetadata = await lstat(hostRollbackMarker);
        expect(retainedMetadata.isFile()).toBe(true);
        expect(retainedMetadata.mode & 0o777).toBe(0o600);
        expect(await readLifecycleLog(fixture)).not.toContain("transition:");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it(
    "refuses host rollback while RECOVERY_REQUIRED exists and retains its snapshot-bound payload",
    async () => {
      const fixture = await createRollbackFixture();
      try {
        const recoveryMarker = await writePublishStateMarker(
          fixture,
          "RECOVERY_REQUIRED",
        );
        const markerPayload = await readFile(recoveryMarker, "utf8");
        const before = await captureRollbackTargets(fixture);

        const result = await executeRollback(
          fixture,
          "--abort-if-uncommitted",
        );

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(
          "governance recovery marker must be absent before host rollback",
        );
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readFile(recoveryMarker, "utf8")).resolves.toBe(
          markerPayload,
        );
        await expect(readMutationLog(fixture)).resolves.toBe("");
        expect((await readLifecycleLog(fixture)).match(/^flock:-n 8$/gmu)).toHaveLength(
          1,
        );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it.each([
    {
      expectedError: "publish commit marker must be absent before host rollback",
      markerName: "PUBLISH_COMMITTED",
    },
    {
      expectedError:
        "publish finalized marker must be absent before host rollback",
      markerName: "PUBLISH_FINALIZED",
    },
    {
      expectedError:
        "governance recovery marker must be absent before host rollback",
      markerName: "RECOVERY_REQUIRED",
    },
  ] as const)(
    "rechecks an injected $markerName under the same lifecycle lock before returning from governance host recovery",
    async ({ expectedError, markerName }) => {
      const fixture = await createRollbackFixture();
      const completedMarker = join(
        fixture.stateDir,
        "HOST_ROLLBACK_COMPLETED",
      );
      try {
        const hostRollbackMarker = await writeHostRollbackMarker(fixture);
        const markerPayload = await readFile(hostRollbackMarker, "utf8");
        await writeFile(
          join(fixture.root, "inject-publication-marker-at-verifier"),
          markerName,
          "utf8",
        );

        const result = await executeRollback(
          fixture,
          "--restore-governance-host",
        );

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(expectedError);
        await expectRollbackFilesRestored(fixture);
        await expect(readFile(hostRollbackMarker, "utf8")).resolves.toBe(
          markerPayload,
        );
        await expect(readFile(completedMarker, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(
          readFile(join(fixture.stateDir, markerName), "utf8"),
        ).resolves.toBe("injected\n");

        const lifecycleLog = await readLifecycleLog(fixture);
        expect(lifecycleLog).toContain(
          "verify:http://127.0.0.1:8788:previous-release",
        );
        expect(lifecycleLog).toContain(`inject:${markerName}`);
        expect(lifecycleLog).not.toContain("transition:");
        expect(lifecycleLog.match(/^flock:-n 8$/gmu)).toHaveLength(1);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it(
    "preserves a structurally valid committed release in abort mode",
    async () => {
      const fixture = await createRollbackFixture();
      try {
        await writePublishCommitMarker(fixture);
        const before = await captureRollbackTargets(fixture);
        const result = await executeRollback(
          fixture,
          "--abort-if-uncommitted",
        );

        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(result.stdout).toContain(
          "Publish commit point is valid; preserving committed release",
        );
        await expectDurablePm2Validation(fixture, "failed-release");
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it(
    "validates committed state without exposing an uncommitted rollback path",
    async () => {
      const fixture = await createRollbackFixture();
      try {
        await writePublishCommitMarker(fixture);
        const before = await captureRollbackTargets(fixture);
        const result = await executeRollback(fixture, "--validate-committed");

        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(result.stdout).toContain(
          "Publish commit point is valid for release",
        );
        await expectDurablePm2Validation(fixture, "failed-release");
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it.each([
    {
      expectedMessage:
        "Publish commit point is valid; preserving committed release",
      mode: "--abort-if-uncommitted",
    },
    {
      expectedMessage: "Publish commit point is valid for release",
      mode: "--validate-committed",
    },
  ] as const)(
    "preserves a valid finalized tombstone in $mode mode without mutation",
    async ({ expectedMessage, mode }) => {
      const fixture = await createRollbackFixture();
      try {
        const markerPath = await writePublishStateMarker(
          fixture,
          "PUBLISH_FINALIZED",
        );
        await writeFile(
          join(fixture.root, "ledger-terminal"),
          "COMMITTED:PUBLISH_FINALIZED\n",
          "utf8",
        );
        const markerBefore = await readFile(markerPath, "utf8");
        const before = await captureRollbackTargets(fixture);

        const result = await executeRollback(fixture, mode);

        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(result.stdout).toContain(expectedMessage);
        await expectDurablePm2Validation(fixture, "failed-release");
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
        expect(await readLifecycleLog(fixture)).toContain(
          `ledger-revalidate:failed-release`,
        );
        await expect(readFile(markerPath, "utf8")).resolves.toBe(markerBefore);
        const markerMetadata = await lstat(markerPath);
        expect(markerMetadata.isFile()).toBe(true);
        expect(markerMetadata.mode & 0o777).toBe(0o600);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it.each([
    {
      failureFlag: "pm2-helper-fail",
      markerName: "PUBLISH_COMMITTED",
      name: "a durable dump failure for committed state",
    },
    {
      failureFlag: "pm2-wrong-uid",
      markerName: "PUBLISH_COMMITTED",
      name: "a runtime uid mismatch for committed state",
    },
    {
      failureFlag: "pm2-wrong-gid",
      markerName: "PUBLISH_COMMITTED",
      name: "a runtime gid mismatch for committed state",
    },
    {
      failureFlag: "pm2-helper-fail",
      markerName: "PUBLISH_FINALIZED",
      name: "a durable dump failure for finalized state",
    },
    {
      failureFlag: "pm2-wrong-uid",
      markerName: "PUBLISH_FINALIZED",
      name: "a runtime uid mismatch for finalized state",
    },
    {
      failureFlag: "pm2-wrong-gid",
      markerName: "PUBLISH_FINALIZED",
      name: "a runtime gid mismatch for finalized state",
    },
  ] as const)("retains the publication ledger on $name", async ({
    failureFlag,
    markerName,
  }) => {
    const fixture = await createRollbackFixture();
    try {
      const markerPath = await writePublishStateMarker(fixture, markerName);
      const markerPayload = await readFile(markerPath, "utf8");
      if (markerName === "PUBLISH_FINALIZED") {
        await writeFile(
          join(fixture.root, "ledger-terminal"),
          "COMMITTED:PUBLISH_FINALIZED\n",
          "utf8",
        );
      }
      await writeFile(join(fixture.root, failureFlag), "fault\n", "utf8");

      const result = await executeRollback(fixture, "--validate-committed");

      expect(result.exitCode).toBe(70);
      await expect(readFile(markerPath, "utf8")).resolves.toBe(markerPayload);
      await expect(readMutationLog(fixture)).resolves.toBe("");
      if (markerName === "PUBLISH_FINALIZED") {
        expect(await readLifecycleLog(fixture)).toContain(
          "ledger-revalidate:failed-release",
        );
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 30_000);

  it.each([
    {
      fault: "pm2-live-cwd-drift",
      kind: "flag",
      name: "live pm_cwd drift",
    },
    {
      fault: "pm2-live-exec-path-drift",
      kind: "flag",
      name: "live pm_exec_path drift",
    },
    {
      fault: "pm2-live-interpreter-drift",
      kind: "flag",
      name: "live exec_interpreter drift",
    },
    {
      fault: "pm2-live-args-drift",
      kind: "flag",
      name: "live argument drift",
    },
    {
      fault: "pm2-live-env-version-drift",
      kind: "flag",
      name: "conflicting live direct and nested versions",
    },
    {
      fault: "pm2-live-name-drift",
      kind: "flag",
      name: "conflicting live row and PM2 environment names",
    },
    {
      fault: "pm2-live-uid-drift",
      kind: "flag",
      name: "live configured uid drift",
    },
    {
      fault: "pm2-live-gid-drift",
      kind: "flag",
      name: "live configured gid drift",
    },
    {
      fault: "pm2-dump-cwd-drift",
      kind: "flag",
      name: "durable pm_cwd drift",
    },
    {
      fault: "pm2-dump-exec-path-drift",
      kind: "flag",
      name: "durable pm_exec_path drift",
    },
    {
      fault: "pm2-dump-interpreter-drift",
      kind: "flag",
      name: "durable exec_interpreter drift",
    },
    {
      fault: "pm2-dump-args-drift",
      kind: "flag",
      name: "durable argument drift",
    },
    {
      fault: "pm2-dump-uid-drift",
      kind: "flag",
      name: "durable uid drift",
    },
    {
      fault: "pm2-dump-gid-drift",
      kind: "flag",
      name: "durable gid drift",
    },
    {
      fault: "cwd",
      kind: "proc",
      name: "/proc cwd drift",
    },
    {
      fault: "cmdline",
      kind: "proc",
      name: "/proc cmdline drift",
    },
    {
      fault: "exe",
      kind: "proc",
      name: "/proc executable drift",
    },
  ] as const)(
    "fails closed and retains a finalized publication ledger on $name",
    async ({ fault, kind }) => {
      const fixture = await createRollbackFixture();
      try {
        const markerPath = await writePublishStateMarker(
          fixture,
          "PUBLISH_FINALIZED",
        );
        const markerPayload = await readFile(markerPath, "utf8");
        await writeFile(
          join(fixture.root, "ledger-terminal"),
          "COMMITTED:PUBLISH_FINALIZED\n",
          "utf8",
        );
        if (kind === "flag") {
          await writeFile(join(fixture.root, fault), "fault\n", "utf8");
        } else if (fault === "cwd") {
          const processCwd = join(fixture.procRoot, "321", "cwd");
          await rm(processCwd);
          await symlink(fixture.previousRelease, processCwd, "dir");
        } else if (fault === "cmdline") {
          await writeFile(
            join(fixture.procRoot, "321", "cmdline"),
            Buffer.from("unexpected-process-title\0", "utf8"),
          );
        } else {
          const processExecutable = join(fixture.procRoot, "321", "exe");
          await rm(processExecutable);
          await symlink(PRODUCTION_PM2_EXEC_PATH, processExecutable, "file");
        }
        const before = await captureRollbackTargets(fixture);

        const result = await executeRollback(
          fixture,
          "--validate-committed",
        );

        expect(result.exitCode).toBe(70);
        await expect(readFile(markerPath, "utf8")).resolves.toBe(
          markerPayload,
        );
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
        expect(await readLifecycleLog(fixture)).toContain(
          "ledger-revalidate:failed-release",
        );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it.each(
    (["PUBLISH_COMMITTED", "PUBLISH_FINALIZED"] as const).flatMap(
      (markerName) =>
        (
          [
            {
              fault: "systemd-need-daemon-reload-drift",
              kind: "flag",
              name: "NeedDaemonReload drift",
            },
            {
              fault: "systemd-wants-drift",
              kind: "flag",
              name: "loaded Wants drift",
            },
            {
              fault: "systemd-requires-drift",
              kind: "flag",
              name: "loaded Requires drift",
            },
            {
              fault: "systemd-upholds-drift",
              kind: "flag",
              name: "loaded Upholds drift",
            },
            {
              fault: "systemd-exec-start-post-drift",
              kind: "flag",
              name: "loaded ExecStartPost drift",
            },
            {
              fault: "systemd-exec-reload-drift",
              kind: "flag",
              name: "loaded ExecReload drift",
            },
            {
              fault: "systemd-exec-stop-drift",
              kind: "flag",
              name: "loaded ExecStop drift",
            },
            {
              fault: "systemd-on-failure-drift",
              kind: "flag",
              name: "loaded OnFailure drift",
            },
            {
              fault: "systemd-root-directory-drift",
              kind: "flag",
              name: "loaded RootDirectory drift",
            },
            {
              fault: "systemd-conflicts-drift",
              kind: "flag",
              name: "loaded Conflicts drift",
            },
            {
              fault: "systemd-dynamic-user-drift",
              kind: "flag",
              name: "loaded DynamicUser drift",
            },
            {
              fault: "systemd-working-directory-drift",
              kind: "flag",
              name: "loaded WorkingDirectory drift",
            },
            {
              fault: "systemd-loaded-snapshot-drift",
              kind: "flag",
              name: "loaded A/B drift",
            },
            {
              fault: "systemd-manager-unit-path-drift",
              kind: "flag",
              name: "manager UnitPath A/B drift",
            },
            {
              fault: "systemd-compiled-unit-path-drift",
              kind: "flag",
              name: "compiled UnitPath A/B drift",
            },
            {
              fault: "systemd-absent-root-appears",
              kind: "flag",
              name: "approved absent UnitPath appearance",
            },
            {
              fault: "systemd-fragment-ab-drift",
              kind: "flag",
              name: "fragment disk A/B drift",
            },
            {
              fault: "systemd-user-drift",
              kind: "flag",
              name: "unit User drift",
            },
            {
              fault: "systemd-exec-start-drift",
              kind: "flag",
              name: "unit ExecStart drift",
            },
            {
              fault: "systemd-environment-drift",
              kind: "flag",
              name: "unit PM2_HOME environment drift",
            },
            {
              fault: "systemd-pid-file-drift",
              kind: "flag",
              name: "unit PIDFile drift",
            },
            {
              fault: "systemd-main-pid-drift",
              kind: "flag",
              name: "unit MainPID drift",
            },
            {
              fault: "systemd-control-group-drift",
              kind: "flag",
              name: "unit ControlGroup drift",
            },
            {
              fault: "proc-cgroup",
              kind: "proc",
              name: "PM2 daemon cgroup drift",
            },
            {
              fault: "proc-environment",
              kind: "proc",
              name: "PM2 daemon environment drift",
            },
            {
              fault: "proc-executable",
              kind: "proc",
              name: "PM2 daemon executable drift",
            },
            {
              fault: "pid-file-contents",
              kind: "proc",
              name: "PM2 daemon pid-file contents drift",
            },
          ] as const
        ).map((fault) => ({ ...fault, markerName })),
    ),
  )(
    "fails closed and retains $markerName on systemd identity fault: $name",
    async ({ fault, kind, markerName }) => {
      const fixture = await createRollbackFixture();
      try {
        const markerPath = await writePublishStateMarker(
          fixture,
          markerName,
        );
        const markerPayload = await readFile(markerPath, "utf8");
        if (markerName === "PUBLISH_FINALIZED") {
          await writeFile(
            join(fixture.root, "ledger-terminal"),
            "COMMITTED:PUBLISH_FINALIZED\n",
            "utf8",
          );
        }
        if (kind === "flag") {
          await writeFile(join(fixture.root, fault), "fault\n", "utf8");
        } else if (fault === "proc-cgroup") {
          await writeFile(
            join(fixture.procRoot, "111", "cgroup"),
            "0::/system.slice/unrelated.service\n",
            "utf8",
          );
        } else if (fault === "proc-environment") {
          await writeFile(
            join(fixture.procRoot, "111", "environ"),
            Buffer.from(
              `PATH=${fixture.fakePath}\0PM2_HOME=/tmp/untrusted-pm2\0`,
              "utf8",
            ),
          );
        } else if (fault === "proc-executable") {
          const daemonExecutable = join(fixture.procRoot, "111", "exe");
          await rm(daemonExecutable);
          await symlink(PRODUCTION_PM2_EXEC_PATH, daemonExecutable, "file");
        } else {
          await writeFile(join(fixture.pm2Home, "pm2.pid"), "112", "utf8");
        }
        const before = await captureRollbackTargets(fixture);

        const result = await executeRollback(
          fixture,
          "--validate-committed",
        );

        expect(result.exitCode).toBe(70);
        await expect(readFile(markerPath, "utf8")).resolves.toBe(
          markerPayload,
        );
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
        if (markerName === "PUBLISH_FINALIZED") {
          expect(await readLifecycleLog(fixture)).toContain(
            "ledger-revalidate:failed-release",
          );
        }
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it.each(
    (["PUBLISH_COMMITTED", "PUBLISH_FINALIZED"] as const).flatMap(
      (markerName) =>
        systemdDiskIdentityFaults().map((fault) => ({
          ...fault,
          markerName,
        })),
    ),
  )(
    "fails closed and retains $markerName on disk identity fault: $name",
    async ({ markerName, mutate }) => {
      const fixture = await createRollbackFixture();
      try {
        const markerPath = await writePublishStateMarker(
          fixture,
          markerName,
        );
        const markerPayload = await readFile(markerPath, "utf8");
        if (markerName === "PUBLISH_FINALIZED") {
          await writeFile(
            join(fixture.root, "ledger-terminal"),
            "COMMITTED:PUBLISH_FINALIZED\n",
            "utf8",
          );
        }
        await mutate(fixture);
        const before = await captureRollbackTargets(fixture);

        const result = await executeRollback(
          fixture,
          "--validate-committed",
        );

        expect(result.exitCode).toBe(70);
        await expect(readFile(markerPath, "utf8")).resolves.toBe(
          markerPayload,
        );
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
        expect(await readLifecycleLog(fixture)).not.toContain(
          "systemctl:daemon-reload",
        );
        if (markerName === "PUBLISH_FINALIZED") {
          expect(await readLifecycleLog(fixture)).toContain(
            "ledger-revalidate:failed-release",
          );
        }
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it("rejects current drift while revalidating a real committed/finalized terminal ledger", async () => {
    const fixture = await createRollbackFixture({
      current: "previous",
      pm2Version: "failed-release",
    });
    try {
      const markerPath = await writePublishStateMarker(
        fixture,
        "PUBLISH_FINALIZED",
      );
      const markerPayload = await readFile(markerPath, "utf8");
      await writeFile(
        join(fixture.root, "ledger-terminal"),
        "COMMITTED:PUBLISH_FINALIZED\n",
        "utf8",
      );

      const result = await executeRollback(
        fixture,
        "--validate-committed",
      );

      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain(
        "committed host does not point to the committed release",
      );
      await expect(readFile(markerPath, "utf8")).resolves.toBe(markerPayload);
      expect(await readLifecycleLog(fixture)).toContain(
        "ledger-revalidate:failed-release",
      );
      await expect(readMutationLog(fixture)).resolves.toBe("");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each(["--check", "--apply"] as const)(
    "rejects a finalized release in direct %s mode without mutation",
    async (mode) => {
      const fixture = await createRollbackFixture();
      try {
        const markerPath = await writePublishStateMarker(
          fixture,
          "PUBLISH_FINALIZED",
        );
        const markerBefore = await readFile(markerPath, "utf8");
        const before = await captureRollbackTargets(fixture);

        const result = await executeRollback(fixture, mode);

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(
          "refusing host-only rollback after the governance publish commit point",
        );
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
        await expect(readFile(markerPath, "utf8")).resolves.toBe(markerBefore);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    "--abort-if-uncommitted",
    "--validate-committed",
    "--check",
    "--apply",
  ] as const)(
    "fails closed without mutation when commit and finalized markers coexist in %s mode",
    async (mode) => {
      const fixture = await createRollbackFixture();
      try {
        const commitMarker = await writePublishStateMarker(
          fixture,
          "PUBLISH_COMMITTED",
        );
        const finalizedMarker = await writePublishStateMarker(
          fixture,
          "PUBLISH_FINALIZED",
        );
        const commitPayload = await readFile(commitMarker, "utf8");
        const finalizedPayload = await readFile(finalizedMarker, "utf8");
        const before = await captureRollbackTargets(fixture);

        expect(finalizedPayload).toBe(commitPayload);
        const result = await executeRollback(fixture, mode);

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(
          "publish commit and finalized markers must not coexist",
        );
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
        await expect(readFile(commitMarker, "utf8")).resolves.toBe(
          commitPayload,
        );
        await expect(readFile(finalizedMarker, "utf8")).resolves.toBe(
          finalizedPayload,
        );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    {
      corrupt: async (markerPath: string) => {
        const payload = await readFile(markerPath, "utf8");
        const [, snapshotPath] = payload.trimEnd().split("\t");
        await writeFile(markerPath, `not-a-sha256\t${snapshotPath}\n`, "utf8");
      },
      name: "a malformed payload",
    },
    {
      corrupt: async (markerPath: string) => {
        const payload = await readFile(markerPath, "utf8");
        await writeFile(markerPath, `${payload}\n`, "utf8");
      },
      name: "an additional newline",
    },
  ] as const)(
    "fails closed and retains a finalized tombstone with $name",
    async ({ corrupt }) => {
      const fixture = await createRollbackFixture();
      try {
        const markerPath = await writePublishStateMarker(
          fixture,
          "PUBLISH_FINALIZED",
        );
        await corrupt(markerPath);
        const corruptedPayload = await readFile(markerPath, "utf8");
        const before = await captureRollbackTargets(fixture);

        const result = await executeRollback(
          fixture,
          "--abort-if-uncommitted",
        );

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(
          "publish finalized marker has an invalid payload",
        );
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
        await expect(readFile(markerPath, "utf8")).resolves.toBe(
          corruptedPayload,
        );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it("fails committed-state validation when the marker is absent", async () => {
    const fixture = await createRollbackFixture();
    try {
      const before = await captureRollbackTargets(fixture);
      const result = await executeRollback(fixture, "--validate-committed");

      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain("publish commit marker is missing");
      await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
      await expect(readMutationLog(fixture)).resolves.toBe("");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each(["--check", "--apply"] as const)(
    "rejects a committed release in direct %s mode without mutation",
    async (mode) => {
      const fixture = await createRollbackFixture();
      try {
        await writePublishCommitMarker(fixture);
        const before = await captureRollbackTargets(fixture);
        const result = await executeRollback(fixture, mode);

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(
          "refusing host-only rollback after the governance publish commit point",
        );
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    {
      corrupt: async (fixture: RollbackFixture) =>
        chmod(join(fixture.stateDir, "PUBLISH_COMMITTED"), 0o644),
      expectedError:
        "publish commit marker has unexpected ownership or permissions",
      name: "loose marker permissions",
    },
    {
      corrupt: async (fixture: RollbackFixture) => {
        const marker = join(fixture.stateDir, "PUBLISH_COMMITTED");
        await rm(marker);
        await symlink(join(fixture.stateDir, "governance-before.json"), marker);
      },
      expectedError:
        "publish commit marker must be a regular non-symlink file",
      name: "a symlinked marker",
    },
    {
      corrupt: async (fixture: RollbackFixture) =>
        writeFile(
          join(fixture.stateDir, "governance-before.json"),
          '{"tampered":true}\n',
          "utf8",
        ),
      expectedError: "committed governance snapshot does not match its marker",
      name: "snapshot hash drift",
    },
  ] as const)(
    "fails closed for $name in abort mode",
    async ({ corrupt, expectedError }) => {
      const fixture = await createRollbackFixture();
      try {
        await writePublishCommitMarker(fixture);
        await corrupt(fixture);
        const before = await captureRollbackTargets(fixture);
        const result = await executeRollback(
          fixture,
          "--abort-if-uncommitted",
        );

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(expectedError);
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it.each([
    {
      current: "unexpected",
      expectedError: "current points to neither the failed nor previous release",
      name: "an unexpected current release",
      prepare: async () => {},
    },
    {
      current: "failed",
      expectedError:
        "previous-release state has unexpected ownership or permissions",
      name: "a previous-release state file with loose permissions",
      prepare: async (fixture: RollbackFixture) =>
        chmod(join(fixture.stateDir, "previous-release"), 0o644),
    },
    {
      current: "failed",
      expectedError:
        "environment rollback backup must be a regular non-symlink file",
      name: "a symlinked environment backup",
      prepare: async (fixture: RollbackFixture) => {
        const backup = join(
          fixture.stateDir,
          "env.production.local.pre-switch",
        );
        await rm(backup);
        await symlink(fixture.environmentPath, backup);
      },
    },
    {
      current: "failed",
      expectedError:
        "previous release verifier must not be group- or world-writable",
      name: "a writable previous-release verifier",
      prepare: async (fixture: RollbackFixture) =>
        chmod(
          join(
            fixture.previousRelease,
            "scripts",
            "deploy",
            "verify-release.sh",
          ),
          0o775,
        ),
    },
    {
      current: "failed",
      expectedError:
        "previous release verifier must be owned by root with group root or diesel",
      name: "a previous-release verifier not owned by root",
      prepare: async (fixture: RollbackFixture) =>
        writeFile(
          join(fixture.root, "untrusted-owner-path"),
          join(
            fixture.previousRelease,
            "scripts",
            "deploy",
            "verify-release.sh",
          ),
          "utf8",
        ),
    },
    {
      current: "failed",
      expectedError:
        "previous release scripts directory must not traverse a symlink",
      name: "a symlinked previous-release scripts directory",
      prepare: async (fixture: RollbackFixture) => {
        const originalScripts = join(fixture.previousRelease, "scripts");
        const externalScripts = join(fixture.root, "external-scripts");
        await mkdir(join(externalScripts, "deploy"), { recursive: true });
        const externalVerifier = join(
          externalScripts,
          "deploy",
          "verify-release.sh",
        );
        await copyFile(
          join(originalScripts, "deploy", "verify-release.sh"),
          externalVerifier,
        );
        await chmod(externalVerifier, 0o755);
        await rm(originalScripts, { force: true, recursive: true });
        await symlink(externalScripts, originalScripts);
      },
    },
  ] as const)(
    "fails before host mutation for $name",
    async ({ current, expectedError, prepare }) => {
      const fixture = await createRollbackFixture({ current });
      try {
        await prepare(fixture);
        const before = await captureRollbackTargets(fixture);
        const result = await executeRollback(fixture, "--apply");

        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(expectedError);
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        await expect(readMutationLog(fixture)).resolves.toBe("");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );

  it(
    "converges when rerun after the previous release verifier fails once",
    async () => {
      const fixture = await createRollbackFixture();
      try {
        await writeFile(
          join(fixture.root, "fail-verifier-once"),
          "fail\n",
          "utf8",
        );

        const firstResult = await executeRollback(fixture, "--apply");
        expect(firstResult).toMatchObject({
          exitCode: 91,
        });
        await expectRollbackFilesRestored(fixture);

        const secondResult = await executeRollback(fixture, "--apply");
        expect(secondResult).toMatchObject({ exitCode: 0, stderr: "" });
        await expectRollbackFilesRestored(fixture);

        const mutations = await readMutationLog(fixture);
        expect(mutations.match(/^pm2-start:/gmu)).toHaveLength(2);
        expect(mutations.match(/^pm2-delete:/gmu)).toHaveLength(2);
        expect(mutations.match(/^verify:/gmu)).toHaveLength(2);
        expect(mutations).not.toContain("failed-verifier");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it(
    "restores the pre-attempt Nginx files before retrying an invalid candidate",
    async () => {
      const fixture = await createRollbackFixture();
      try {
        const before = await captureRollbackTargets(fixture);
        await writeFile(
          join(fixture.root, "nginx-fail-once"),
          "fail\n",
          "utf8",
        );

        const firstResult = await executeRollback(fixture, "--apply");
        expect(firstResult.exitCode).not.toBe(0);
        expect(firstResult.stderr).toContain(
          "rollback Nginx candidate configuration is invalid",
        );
        await expect(captureRollbackTargets(fixture)).resolves.toEqual(before);
        const failedAttemptMutations = await readMutationLog(fixture);
        expect(failedAttemptMutations).not.toContain("pm2-delete:");
        expect(failedAttemptMutations).not.toContain("pm2-start:");
        expect(failedAttemptMutations).not.toContain("systemctl-reload:");
        expect(failedAttemptMutations).not.toContain("verify:");

        const secondResult = await executeRollback(fixture, "--apply");
        expect(secondResult).toMatchObject({ exitCode: 0, stderr: "" });
        await expectRollbackFilesRestored(fixture);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it(
    "preserves immutable recovery masters when pre-attempt Nginx restoration is interrupted",
    async () => {
      const fixture = await createRollbackFixture();
      try {
        await Promise.all([
          writeFile(
            join(fixture.root, "mv-fail-pre-attempt-restore-once"),
            "fail\n",
            "utf8",
          ),
          writeFile(
            join(fixture.root, "nginx-fail-always"),
            "fail\n",
            "utf8",
          ),
        ]);

        const result = await executeRollback(fixture, "--apply");

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(
          "rollback Nginx candidate was invalid and the pre-attempt state could not be revalidated",
        );
        const recoveryMasterPaths = [...result.stderr.matchAll(
          /preserving Nginx recovery master: (\/[^\n]+)/gu,
        )].map((match) => match[1]);
        expect(recoveryMasterPaths).toHaveLength(2);
        expect(
          recoveryMasterPaths.every((path) =>
            path.startsWith(`${fixture.nginxSitesRoot}/.`),
          ),
        ).toBe(true);
        await expect(
          Promise.all(
            recoveryMasterPaths.map((path) => readFile(path, "utf8")),
          ),
        ).resolves.toEqual(
          expect.arrayContaining([
            "new primary nginx\n",
            "new alternate nginx\n",
          ]),
        );
        await expect(readFile(fixture.environmentPath, "utf8")).resolves.toBe(
          "NEW_ENV=1\n",
        );
        await expect(realpath(fixture.currentLink)).resolves.toBe(
          fixture.failedRelease,
        );
        await expect(readFile(fixture.pm2State, "utf8")).resolves.toBe(
          "failed-release",
        );
        const mutations = await readMutationLog(fixture);
        expect(mutations).not.toContain("pm2-delete:");
        expect(mutations).not.toContain("pm2-start:");
        expect(mutations).not.toContain("systemctl-reload:");
        expect(mutations).not.toContain("verify:");
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it.each([
    "http://127.0.0.1:0",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:not-a-port",
    "http://127.0.0.1:80@outside.example",
    "http://127.0.0.1:8788/path",
    "https://jamesky.site",
    "http://diesel.jamesky.site",
    "https://diesel.jamesky.site.evil.example",
    "https://diesel.jamesky.site@evil.example",
    "https://diesel.jamesky.site/path",
  ])("rejects unsafe release verification origin %s", async (origin) => {
    const result = await execFileAsync("bash", [
      verifyReleaseScript,
      origin,
      TEST_RELEASE_SHA,
    ]).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 64 });
  });

  it("pins curl configuration and protocol for allowed verification origins", async () => {
    const publicArguments = await captureFirstVerifyCurlArguments(
      "https://diesel.jamesky.site",
    );
    const loopbackArguments = await captureFirstVerifyCurlArguments(
      "http://127.0.0.1:8788",
    );

    for (const argumentsUsed of [publicArguments, loopbackArguments]) {
      expect(argumentsUsed[0]).toBe("--disable");
      const noProxyIndex = argumentsUsed.indexOf("--noproxy");
      expect(noProxyIndex).toBeGreaterThanOrEqual(0);
      expect(argumentsUsed[noProxyIndex + 1]).toBe("*");
      const maximumSizeIndex = argumentsUsed.indexOf("--max-filesize");
      expect(maximumSizeIndex).toBeGreaterThanOrEqual(0);
      expect(argumentsUsed[maximumSizeIndex + 1]).toBe("65536");
    }

    const publicProtocolIndex = publicArguments.indexOf("--proto");
    expect(publicProtocolIndex).toBeGreaterThanOrEqual(0);
    expect(publicArguments[publicProtocolIndex + 1]).toBe("=https");
    expect(publicArguments.at(-1)).toBe(
      "https://diesel.jamesky.site/api/health",
    );

    const loopbackProtocolIndex = loopbackArguments.indexOf("--proto");
    expect(loopbackProtocolIndex).toBeGreaterThanOrEqual(0);
    expect(loopbackArguments[loopbackProtocolIndex + 1]).toBe("=http");
    expect(loopbackArguments.at(-1)).toBe(
      "http://127.0.0.1:8788/api/health",
    );
  });

  it.each([
    "test-release",
    "A".repeat(40),
    "a".repeat(39),
  ])("rejects non-commit verification version %s", async (version) => {
    const result = await execFileAsync("bash", [
      verifyReleaseScript,
      "http://127.0.0.1:8788",
      version,
    ]).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 64 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "full lowercase Git commit SHA",
    );
  });

  it("verifies locale persistence and a deterministic no-reasoning chat SSE response", async () => {
    const { command, requests } = await executeVerifyRelease("success");

    expect(command).toEqual({ exitCode: 0, stderr: "", stdout: "" });
    const productRequestIndex = requests.findIndex(
      ({ method, url }) => method === "GET" && url === "/api/products",
    );
    const firstPageRequestIndex = requests.findIndex(
      ({ method, url }) => method === "GET" && url === "/",
    );
    const chatRequestIndex = requests.findIndex(
      ({ method, url }) => method === "POST" && url === "/api/chat",
    );
    expect(productRequestIndex).toBeGreaterThan(1);
    expect(productRequestIndex).toBeLessThan(firstPageRequestIndex);
    expect(productRequestIndex).toBeLessThan(chatRequestIndex);
    expect(
      requests
        .filter(
          (request) =>
            request.method === "GET" &&
            ["/", "/map", "/chat", "/countries/CHN"].includes(request.url) &&
            request.cookie.includes("diesel_locale=zh-CN"),
        )
        .map((request) => request.url),
    ).toEqual(["/", "/map", "/chat", "/countries/CHN"]);

    const localeRequest = requests.find(
      ({ method, url }) => method === "POST" && url === "/api/preferences/locale",
    );
    expect(JSON.parse(localeRequest?.body ?? "null")).toEqual({
      locale: "zh-CN",
    });

    const chatRequests = requests.filter(
      ({ method, url }) => method === "POST" && url === "/api/chat",
    );
    expect(chatRequests).toHaveLength(1);
    expect(JSON.parse(chatRequests[0]?.body ?? "null")).toEqual({
      locale: "en",
      messages: [
        {
          id: "release-verification",
          parts: [{ text: "What can you do?", type: "text" }],
          role: "user",
        },
      ],
      sessionId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("keeps the release success fixture inside the canonical product DTO", () => {
    expect(
      productListResponseSchema.safeParse(createReleasePublicProducts()).success,
    ).toBe(true);
  });

  it.each([
    "missing-products",
    "malformed-products",
    "extra-real-product",
    "missing-product-field",
    "product-classification-drift",
    "product-identity-drift",
    "source-classification-drift",
    "source-identity-drift",
    "specification-version-drift",
  ] as const)(
    "fails release verification before page or chat acceptance for %s",
    async (mode) => {
      const { command, requests } = await executeVerifyRelease(mode);

      expect(command.exitCode).not.toBe(0);
      expect(command.stderr).toContain("Unexpected public product payload");
      expect(requests.map(({ url }) => url)).toEqual([
        "/api/health",
        "/api/health/ready",
        "/api/products",
      ]);
    },
  );

  it.each([
    ["wrong-health-service", "liveness"],
    ["wrong-health-status", "liveness"],
    ["wrong-health-version", "liveness"],
    ["missing-health-cache-control", "liveness"],
    ["wrong-health-pragma", "liveness"],
    ["noncanonical-health-timestamp", "liveness"],
    ["stale-health-timestamp", "liveness"],
    ["wrong-readiness-service", "readiness"],
    ["wrong-readiness-status", "readiness"],
    ["extra-readiness-field", "readiness"],
    ["extra-readiness-check", "readiness"],
    ["missing-readiness-check", "readiness"],
    ["missing-readiness-timestamp", "readiness"],
    ["stale-readiness-timestamp", "readiness"],
    ["wrong-readiness-admission-check", "readiness"],
    ["wrong-readiness-rate-limit-check", "readiness"],
    ["wrong-readiness-check", "readiness"],
    ["wrong-readiness-version", "readiness"],
    ["wrong-readiness-cache-control", "readiness"],
    ["missing-readiness-pragma", "readiness"],
    ["noncanonical-readiness-timestamp", "readiness"],
    ["future-readiness-timestamp", "readiness"],
  ] as const)(
    "fails release verification for %s",
    async (mode, payloadKind) => {
      const { command, requests } = await executeVerifyRelease(mode);

      expect(command.exitCode).not.toBe(0);
      expect(command.stderr).toContain(
        `Unexpected application ${payloadKind} payload`,
      );
      expect(requests.map(({ url }) => url)).toEqual(
        payloadKind === "liveness"
          ? ["/api/health"]
          : ["/api/health", "/api/health/ready"],
      );
    },
  );

  it("ignores a hostile HOME curl configuration", async () => {
    const home = await mkdtemp(join(tmpdir(), "diesel-verify-curl-home-"));
    await writeFile(
      join(home, ".curlrc"),
      'header = "x-curlrc-marker: injected"\n',
      "utf8",
    );

    try {
      const { command, requests } = await executeVerifyRelease("success", {
        home,
      });

      expect(command).toEqual({ exitCode: 0, stderr: "", stdout: "" });
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every(({ curlrcMarker }) => curlrcMarker === null)).toBe(
        true,
      );
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("fails release verification when an HTML response exceeds its byte limit", async () => {
    const { command, requests } = await executeVerifyRelease("oversized-html");

    expect(command.exitCode).not.toBe(0);
    expect(command.stderr).toContain("curl: (63)");
    expect(requests.map(({ url }) => url)).toEqual([
      "/api/health",
      "/api/health/ready",
      "/api/products",
      "/",
    ]);
  });

  it.each([
    [
      "wrong-default-locale",
      'Expected / to render <html lang="en">',
    ],
    [
      "lost-locale",
      'Expected /map to render <html lang="zh-CN">',
    ],
    ["reasoning-part", "exposed a forbidden reasoning-delta part"],
    ["missing-start", "must begin with a start event"],
    ["missing-finish", "returned [DONE] before a valid finish event"],
    ["non-stop-finish", "returned a non-stop finish reason"],
    ["unknown-event", "returned an unknown future-contract-event event"],
    ["duplicate-done", "more than one [DONE] event"],
    ["event-after-done", "returned an event after [DONE]"],
    ["unclosed-text", "returned finish before closing its text stream"],
  ] as const)(
    "fails release verification for %s",
    async (mode, expectedError) => {
      const { command } = await executeVerifyRelease(mode);

      expect(command.exitCode).not.toBe(0);
      expect(command.stderr).toContain(expectedError);
    },
  );

  it("replaces and verifies exactly one versioned diesel-demo process on rollback", async () => {
    const rollbackScript = await readFile(
      resolve(process.cwd(), "scripts/deploy/rollback-host-release.sh"),
      "utf8",
    );

    expect(rollbackScript).not.toContain("global-diesel-regulations");
    expect(rollbackScript).toContain(
      'pm2_command=("${node_binary}" "${expected_pm2_exec}")',
    );
    expect(rollbackScript).toContain(
      '"${pm2_command[@]}" describe diesel-demo',
    );
    expect(rollbackScript).toContain(
      '"${pm2_command[@]}" delete diesel-demo',
    );
    expect(rollbackScript).toContain(
      'app?.name === "diesel-demo" ||',
    );
    expect(rollbackScript).toContain("matches.length !== 1");
    expect(rollbackScript).toContain('pm2Environment.name !== "diesel-demo"');
    expect(rollbackScript).toContain(
      "pm2Environment.APP_VERSION !== expectedVersion",
    );
    expect(rollbackScript).toContain(
      "pm2Environment.env?.APP_VERSION !== expectedVersion",
    );
    expect(rollbackScript).toContain(
      "pm2Environment.pm_cwd !== expectedCwd",
    );
    expect(rollbackScript).toContain(
      'pm2Environment.pm_exec_path !== "/usr/bin/env"',
    );
    expect(rollbackScript).toContain(
      'pm2Environment.exec_interpreter !== "none"',
    );
    expect(rollbackScript).toContain(
      "!exactStringArray(pm2Environment.args, expectedArgs)",
    );
    expect(rollbackScript).toContain("pm2Environment.uid !== expectedUid");
    expect(rollbackScript).toContain("pm2Environment.gid !== expectedGid");
    expect(rollbackScript).toContain(
      'realpathSync(resolve(processRoot, "cwd")) !== expectedRelease',
    );
    expect(rollbackScript).toContain(
      'realpathSync(resolve(processRoot, "exe")) !== expectedNode',
    );
    expect(rollbackScript).toContain(
      "const expectedTitle = Buffer.from(`next-server (v${nextVersion})\\0`)",
    );
    expect(rollbackScript).toContain(
      '"${previous_release}/scripts/deploy/verify-release.sh"',
    );
  });

  it.each(buildOutputs)(
    "rejects a symlinked %s build output before install or build",
    async (output) => {
      const fixture = await createBuildFixture(output);
      const buildEnvironment = { ...process.env };
      delete buildEnvironment.DATABASE_URL;
      delete buildEnvironment.AI_API_KEY;
      delete buildEnvironment.ADMIN_ROLE_BINDINGS_JSON;

      try {
        const result = await execFileAsync(
          "bash",
          [resolve(process.cwd(), "scripts/deploy/build-release.sh")],
          {
            cwd: fixture,
            env: {
              ...buildEnvironment,
              BUILD_HOME: fixture,
              BUILD_RELEASE_ID: TEST_RELEASE_SHA,
            },
          },
        ).catch((error: unknown) => error);

        expect(result).toMatchObject({ code: 64 });
        expect(String((result as { stderr?: unknown }).stderr)).toContain(
          `${output} must be a pre-created`,
        );
      } finally {
        await rm(fixture, { force: true, recursive: true });
      }
    },
  );

  it("keeps tracked release inputs root-owned and builds in an isolated writable copy", async () => {
    const buildScript = await readFile(
      resolve(process.cwd(), "scripts/deploy/build-release.sh"),
      "utf8",
    );
    const prepareScript = await readFile(
      resolve(process.cwd(), "scripts/deploy/prepare-release-runtime.sh"),
      "utf8",
    );
    const runbook = await readFile(
      resolve(process.cwd(), "docs/DEPLOYMENT.md"),
      "utf8",
    );
    const stageScript = await readFile(stageReleaseScript, "utf8");

    expect(runbook).not.toContain(
      'chown -R diesel-build:diesel "${release_dir}"',
    );
    expect(buildScript).not.toContain("chown");
    expect(buildScript).toContain(
      "[[ -d node_modules && ! -L node_modules ]]",
    );
    expect(buildScript).toContain("[[ -d .next && ! -L .next ]]");
    expect(buildScript).toContain(
      "[[ -f .build-complete && ! -L .build-complete ]]",
    );
    expect(buildScript).toContain("--package-import-method=copy");
    expect(buildScript).toContain("--ignore-scripts --ignore-pnpmfile");
    expect(buildScript).toContain("export COREPACK_ENABLE_DOWNLOAD_PROMPT=0");
    expect(buildScript).toContain(
      "node scripts/deploy/release-input-manifest.mjs",
    );
    expect(
      buildScript.match(/node scripts\/deploy\/release-input-manifest\.mjs/g),
    ).toHaveLength(2);
    expect(buildScript).toContain(
      "node scripts/deploy/release-artifact-manifest.mjs",
    );
    expect(buildScript).toContain('create "${release_id}" .build-complete');
    expect(buildScript).toContain(
      "[[ ! -e .deploy-ready && ! -L .deploy-ready ]]",
    );
    expect(stageScript).toContain(
      'create "${release_id}" "${generated_manifest}"',
    );
    expect(stageScript).toContain(
      ".release-input-manifest.json",
    );
    expect(runbook).not.toContain('chown -hR root:diesel-build "${release_dir}"');
    expect(runbook).toContain("scripts/deploy/prepare-release-runtime.sh");
    expect(prepareScript).toContain(
      'build_workspace="${build_workspace_root}/${release_id}"',
    );
    expect(prepareScript).toContain(
      'build_home="${build_root}/${release_id}"',
    );
    expect(prepareScript).toContain("prepare_release_require_identity_boundary");
    expect(prepareScript).toContain(
      'COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
    );
    expect(prepareScript).toContain(
      'trap \'prepare_release_cleanup_on_exit "$?"\' EXIT',
    );
    expect(prepareScript).toContain(
      "prepare_release_remove_exact_directory \\\n" +
        '    "${build_home}" "${build_root}" "${release_id}"',
    );
    expect(prepareScript).toContain(
      'cp -a "${release_dir}/." "${build_workspace}/"',
    );
    expect(prepareScript).toContain(
      'chown -hR diesel-build:diesel-build "${build_workspace}"',
    );
    expect(prepareScript).toContain("--reflink=never");
    expect(prepareScript).not.toContain(
      'mv "${build_workspace}/${build_output}" "${release_dir}/${build_output}"',
    );
    expect(prepareScript).toContain(
      'chown -hR root:diesel "${release_dir}"',
    );
    expect(prepareScript).toContain(
      'finalize "${release_id}" .build-complete .deploy-ready',
    );
    expect(prepareScript).toContain(
      'check-ready "${release_id}" .build-complete .deploy-ready',
    );
    expect(prepareScript).toContain(
      '0 "${runtime_gid}" "${runtime_uid}" "${runtime_gid}"',
    );
    expect(prepareScript.indexOf("--reflink=never")).toBeLessThan(
      prepareScript.indexOf('finalize "${release_id}"'),
    );
  });
});
