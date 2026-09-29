import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  AI_CHAT_ADMISSION_UNITS_PER_REQUEST,
  MAX_AI_CHAT_ADMISSION_UNITS,
  resolveAiChatAdmissionBudgetConfig,
} from "@/server/http/ai-admission-budget";
import {
  AI_CHAT_RATE_LIMIT_GLOBAL_DEFAULT_PER_HOUR,
  AI_CHAT_RATE_LIMIT_MAX_PER_HOUR,
  resolveAiChatRateLimitBackend,
  resolveAiChatRateLimitConfig,
} from "@/server/http/rate-limit";

const execFileAsync = promisify(execFile);

const READBACK_ERROR_CODES = {
  AI_ADMISSION_INVALID: "AI_ADMISSION_INVALID",
  AI_RATE_LIMIT_INVALID: "AI_RATE_LIMIT_INVALID",
  DATABASE_IDENTITY_CHANGED: "DATABASE_IDENTITY_CHANGED",
  ENVIRONMENT_CONTENT_MISMATCH: "ENVIRONMENT_CONTENT_MISMATCH",
  ENVIRONMENT_READBACK_INVALID: "ENVIRONMENT_READBACK_INVALID",
} as const;

type RuntimeEnvironmentContract = Readonly<{
  PRODUCTION_AI_ADMISSION_CONTRACT: Readonly<{
    maxUnitsPerDay: number;
    unitsPerRequest: number;
  }>;
  PRODUCTION_AI_CHAT_RATE_LIMIT_CONTRACT: Readonly<{
    clientDefaultPerHour: number;
    globalDefaultPerHour: number;
    maxPerHour: number;
  }>;
  READBACK_ERROR_CODES: typeof READBACK_ERROR_CODES;
  validateInstalledProductionEnvironmentFiles: (input: {
    backupPath: string;
    candidatePath: string;
    liveGid: number;
    livePath: string;
    maxBytes: number;
    ownerGid: number;
    ownerUid: number;
  }) => void;
  validateProductionAiAdmissionConfiguration: (
    values: Readonly<Record<string, string | undefined>>,
  ) => Readonly<{
    clientUnitsPerDay: number;
    globalUnitsPerDay: number;
  }>;
  validateProductionAiChatRateLimitConfiguration: (
    values: Readonly<Record<string, string | undefined>>,
  ) => Readonly<{
    globalLimitPerHour: number;
    perClientLimitPerHour: number;
  }>;
}>;

const require = createRequire(import.meta.url);
const contract = require(
  "../scripts/deploy/runtime-environment-contract.cjs",
) as RuntimeEnvironmentContract;

const validEnvironment = {
  AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY: "500",
  AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY: "50000",
  AI_CHAT_RATE_LIMIT_BACKEND: "postgres",
  AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR: "300",
  AI_CHAT_RATE_LIMIT_PER_HOUR: "30",
};

const databaseUrl = "postgresql://database.invalid/diesel";
const validEnvironmentText = [
  `DATABASE_URL=${databaseUrl}`,
  "AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY=500",
  "AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY=50000",
  "AI_CHAT_RATE_LIMIT_BACKEND=postgres",
  "AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR=300",
  "AI_CHAT_RATE_LIMIT_PER_HOUR=30",
  "",
].join("\n");

async function createReadbackFixture(options: {
  candidateText?: string;
  liveText?: string;
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "diesel-runtime-env-"));
  const backupPath = join(directory, "backup.env");
  const candidatePath = join(directory, "candidate.env");
  const livePath = join(directory, "live.env");
  await Promise.all([
    writeFile(backupPath, `DATABASE_URL=${databaseUrl}\nLEGACY_ONLY=true\n`),
    writeFile(candidatePath, options.candidateText ?? validEnvironmentText),
    writeFile(livePath, options.liveText ?? validEnvironmentText),
  ]);
  await Promise.all([
    chmod(backupPath, 0o600),
    chmod(candidatePath, 0o600),
    chmod(livePath, 0o640),
  ]);
  return { backupPath, candidatePath, directory, livePath };
}

function currentIdentity(): { gid: number; uid: number } {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    throw new Error("POSIX identity is required for deployment contract tests.");
  }
  return { gid: process.getgid(), uid: process.getuid() };
}

describe("production runtime environment contract", () => {
  it("exports immutable metadata aligned with the application budget contract", () => {
    expect(contract.PRODUCTION_AI_ADMISSION_CONTRACT).toEqual({
      maxUnitsPerDay: MAX_AI_CHAT_ADMISSION_UNITS,
      unitsPerRequest: AI_CHAT_ADMISSION_UNITS_PER_REQUEST,
    });
    expect(Object.isFrozen(contract.PRODUCTION_AI_ADMISSION_CONTRACT)).toBe(
      true,
    );
  });

  it("exports frozen hourly metadata aligned with the application rate-limit contract", () => {
    expect(contract.PRODUCTION_AI_CHAT_RATE_LIMIT_CONTRACT).toEqual({
      clientDefaultPerHour: 30,
      globalDefaultPerHour: AI_CHAT_RATE_LIMIT_GLOBAL_DEFAULT_PER_HOUR,
      maxPerHour: AI_CHAT_RATE_LIMIT_MAX_PER_HOUR,
    });
    expect(Object.isFrozen(contract.PRODUCTION_AI_CHAT_RATE_LIMIT_CONTRACT)).toBe(
      true,
    );
    expect(
      contract.validateProductionAiChatRateLimitConfiguration({}),
    ).toEqual(
      resolveAiChatRateLimitConfig({ perClientLimitPerHour: 30 }),
    );
  });

  it.each([
    {},
    {
      AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR: "",
      AI_CHAT_RATE_LIMIT_PER_HOUR: "",
    },
  ])("applies runtime-equivalent hourly defaults", (values) => {
    expect(
      contract.validateProductionAiChatRateLimitConfiguration(values),
    ).toEqual({
      globalLimitPerHour: 10_000,
      perClientLimitPerHour: 30,
    });
  });

  it("accepts explicit bounded hourly limits and normalizes only counts", () => {
    expect(
      contract.validateProductionAiChatRateLimitConfiguration(validEnvironment),
    ).toEqual({
      globalLimitPerHour: 300,
      perClientLimitPerHour: 30,
    });
  });

  it.each([
    ["lower", "1", "1"],
    ["upper", "10000", "10000"],
  ])("accepts the inclusive %s hourly boundary", (_label, client, global) => {
    expect(
      contract.validateProductionAiChatRateLimitConfiguration({
        AI_CHAT_RATE_LIMIT_BACKEND: "postgres",
        AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR: global,
        AI_CHAT_RATE_LIMIT_PER_HOUR: client,
      }),
    ).toEqual({
      globalLimitPerHour: Number(global),
      perClientLimitPerHour: Number(client),
    });
  });

  it.each([
    ["zero client", "0", "300", "postgres"],
    ["fractional client", "1.5", "300", "postgres"],
    ["non-numeric client", "invalid", "300", "postgres"],
    ["client above maximum", "10001", "10000", "postgres"],
    ["zero global", "30", "0", "postgres"],
    ["fractional global", "30", "30.5", "postgres"],
    ["global above maximum", "30", "10001", "postgres"],
    ["client above global", "31", "30", "postgres"],
    ["production memory backend", "30", "300", "memory"],
    ["unknown backend", "30", "300", "other"],
  ])(
    "rejects %s without echoing hourly configuration",
    (_label, clientLimit, globalLimit, backend) => {
      const values = {
        AI_CHAT_RATE_LIMIT_BACKEND: backend,
        AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR: globalLimit,
        AI_CHAT_RATE_LIMIT_PER_HOUR: clientLimit,
      };
      expect(() =>
        contract.validateProductionAiChatRateLimitConfiguration(values),
      ).toThrow("Production AI chat rate-limit configuration is invalid.");
      try {
        contract.validateProductionAiChatRateLimitConfiguration(values);
      } catch (error: unknown) {
        expect(String(error)).not.toContain(JSON.stringify(values));
      }
    },
  );

  it.each([undefined, "postgres"] as const)(
    "accepts the hourly runtime-equivalent backend setting %s",
    (backend) => {
      expect(
        contract.validateProductionAiChatRateLimitConfiguration({
          AI_CHAT_RATE_LIMIT_BACKEND: backend,
          AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR: "300",
          AI_CHAT_RATE_LIMIT_PER_HOUR: "30",
        }),
      ).toEqual({
        globalLimitPerHour: 300,
        perClientLimitPerHour: 30,
      });
      expect(
        resolveAiChatRateLimitBackend({
          configuredBackend: backend,
          nodeEnv: "production",
        }),
      ).toBe("postgres");
    },
  );

  it("accepts safe admission limits and returns only normalized counts", () => {
    const deployed =
      contract.validateProductionAiAdmissionConfiguration(validEnvironment);
    const application = resolveAiChatAdmissionBudgetConfig({
      clientUnitsPerDay: Number(
        validEnvironment.AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY,
      ),
      globalUnitsPerDay: Number(
        validEnvironment.AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY,
      ),
      nodeEnv: "production",
    });

    expect(deployed).toEqual({
      clientUnitsPerDay: 500,
      globalUnitsPerDay: 50_000,
    });
    expect(deployed).toEqual(application);
  });

  it.each([
    {
      label: "missing global limit",
      values: {
        AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY: "500",
      },
    },
    {
      label: "missing client limit",
      values: {
        AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY: "50000",
      },
    },
    {
      label: "non-integer limit",
      values: {
        ...validEnvironment,
        AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY: "5.5",
      },
    },
    {
      label: "non-multiple limit",
      values: {
        ...validEnvironment,
        AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY: "501",
      },
    },
    {
      label: "limit above the bounded counter range",
      values: {
        ...validEnvironment,
        AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY: "2000000005",
      },
    },
    {
      label: "client limit above global limit",
      values: {
        AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY: "505",
        AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY: "500",
      },
    },
    {
      label: "explicit production memory backend",
      values: {
        ...validEnvironment,
        AI_CHAT_RATE_LIMIT_BACKEND: "memory",
      },
    },
    {
      label: "unknown production backend",
      values: {
        ...validEnvironment,
        AI_CHAT_RATE_LIMIT_BACKEND: "other",
      },
    },
  ])("rejects $label without echoing configuration", ({ values }) => {
    expect(() =>
      contract.validateProductionAiAdmissionConfiguration(values),
    ).toThrow("Production AI chat admission configuration is invalid.");

    try {
      contract.validateProductionAiAdmissionConfiguration(values);
    } catch (error: unknown) {
      expect(String(error)).not.toContain(JSON.stringify(values));
    }
  });

  it.each([undefined, "postgres"])(
    "accepts the runtime-equivalent backend setting %s",
    (backend) => {
      expect(
        contract.validateProductionAiAdmissionConfiguration({
          ...validEnvironment,
          AI_CHAT_RATE_LIMIT_BACKEND: backend,
        }),
      ).toEqual({
        clientUnitsPerDay: 500,
        globalUnitsPerDay: 50_000,
      });
    },
  );

  it("allows a legacy backup but proves exact candidate/live bytes", async () => {
    const fixture = await createReadbackFixture();
    const { gid, uid } = currentIdentity();
    try {
      expect(() =>
        contract.validateInstalledProductionEnvironmentFiles({
          backupPath: fixture.backupPath,
          candidatePath: fixture.candidatePath,
          liveGid: gid,
          livePath: fixture.livePath,
          maxBytes: 1_048_576,
          ownerGid: gid,
          ownerUid: uid,
        }),
      ).not.toThrow();
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it("classifies an invalid installed hourly relationship independently", async () => {
    const invalidText = validEnvironmentText.replace(
      "AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR=300",
      "AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR=29",
    );
    const fixture = await createReadbackFixture({
      candidateText: invalidText,
      liveText: invalidText,
    });
    const { gid, uid } = currentIdentity();
    try {
      expect(() =>
        contract.validateInstalledProductionEnvironmentFiles({
          backupPath: fixture.backupPath,
          candidatePath: fixture.candidatePath,
          liveGid: gid,
          livePath: fixture.livePath,
          maxBytes: 1_048_576,
          ownerGid: gid,
          ownerUid: uid,
        }),
      ).toThrow(
        expect.objectContaining({
          code: READBACK_ERROR_CODES.AI_RATE_LIMIT_INVALID,
        }),
      );
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it.each([
    {
      label: "different valid admission values",
      liveText: validEnvironmentText.replace("=500\n", "=505\n"),
    },
    {
      label: "semantically equivalent backend omission",
      liveText: validEnvironmentText.replace(
        "AI_CHAT_RATE_LIMIT_BACKEND=postgres\n",
        "",
      ),
    },
    {
      label: "different line order",
      liveText: [
        `DATABASE_URL=${databaseUrl}`,
        "AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY=50000",
        "AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY=500",
        "AI_CHAT_RATE_LIMIT_BACKEND=postgres",
        "AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR=300",
        "AI_CHAT_RATE_LIMIT_PER_HOUR=30",
        "",
      ].join("\n"),
    },
  ])("rejects $label after installation", async ({ liveText }) => {
    const fixture = await createReadbackFixture({ liveText });
    const { gid, uid } = currentIdentity();
    try {
      expect(() =>
        contract.validateInstalledProductionEnvironmentFiles({
          backupPath: fixture.backupPath,
          candidatePath: fixture.candidatePath,
          liveGid: gid,
          livePath: fixture.livePath,
          maxBytes: 1_048_576,
          ownerGid: gid,
          ownerUid: uid,
        }),
      ).toThrow(
        expect.objectContaining({
          code: READBACK_ERROR_CODES.ENVIRONMENT_CONTENT_MISMATCH,
        }),
      );
    } finally {
      await rm(fixture.directory, { force: true, recursive: true });
    }
  });

  it.each([
    { label: "backup", targetRead: 1 },
    { label: "candidate", targetRead: 2 },
    { label: "live", targetRead: 3 },
  ])(
    "rejects the $label descriptor when its metadata changes during the read",
    async ({ targetRead }) => {
      const fixture = await createReadbackFixture();
      const { gid, uid } = currentIdentity();
      const contractPath = resolve(
        process.cwd(),
        "scripts/deploy/runtime-environment-contract.cjs",
      );
      const probe = [
        'const fs = require("node:fs");',
        "const originalRead = fs.readFileSync;",
        "let descriptorReadCount = 0;",
        "fs.readFileSync = function (...args) {",
        "  const bytes = originalRead.apply(this, args);",
        '  if (typeof args[0] === "number") {',
        "    descriptorReadCount += 1;",
        "  }",
        "  if (descriptorReadCount === Number(process.argv[7])) {",
        "    descriptorReadCount += 1_000;",
        "    fs.fchmodSync(args[0], 0o777);",
        "  }",
        "  return bytes;",
        "};",
        "const contract = require(process.argv[1]);",
        "try {",
        "  contract.validateInstalledProductionEnvironmentFiles({",
        "    backupPath: process.argv[2],",
        "    candidatePath: process.argv[3],",
        "    livePath: process.argv[4],",
        "    ownerUid: Number(process.argv[5]),",
        "    ownerGid: Number(process.argv[6]),",
        "    liveGid: Number(process.argv[6]),",
        "    maxBytes: 1048576,",
        "  });",
        '  process.stdout.write("unexpected-success");',
        "  process.exit(1);",
        "} catch (error) {",
        '  process.stdout.write(String(error && error.code));',
        "}",
      ].join("\n");

      try {
        const result = await execFileAsync(
          process.execPath,
          [
            "-e",
            probe,
            contractPath,
            fixture.backupPath,
            fixture.candidatePath,
            fixture.livePath,
            String(uid),
            String(gid),
            String(targetRead),
          ],
          { cwd: process.cwd() },
        );
        expect(result.stderr).toBe("");
        expect(result.stdout).toBe(
          READBACK_ERROR_CODES.ENVIRONMENT_READBACK_INVALID,
        );
      } finally {
        await rm(fixture.directory, { force: true, recursive: true });
      }
    },
  );
});
