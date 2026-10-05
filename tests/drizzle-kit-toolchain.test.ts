import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRepository = createRequire(join(repository, "package.json"));
const drizzleEntry = requireFromRepository.resolve("drizzle-kit");
const drizzleCli = join(dirname(drizzleEntry), "bin.cjs");
const commandTimeoutMs = 10_000;
const temporaryDirectories: string[] = [];
const moduleTypes = ["commonjs", "module"] as const;
type ModuleType = (typeof moduleTypes)[number];

async function createFixture(moduleType: ModuleType) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "diesel-drizzle-toolchain-")));
  temporaryDirectories.push(directory);
  const homeDirectory = join(directory, "home");
  const temporaryDirectory = join(directory, "tmp");
  await Promise.all([
    mkdir(homeDirectory),
    mkdir(temporaryDirectory),
    mkdir(join(directory, "schema")),
    symlink(join(repository, "node_modules"), join(directory, "node_modules"), "dir"),
    writeFile(join(directory, "package.json"), JSON.stringify({ private: true, type: moduleType })),
    writeFile(join(directory, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        paths: { "@/*": ["./schema/*"] },
      },
    })),
    writeFile(join(directory, "drizzle.config.ts"), `
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./schema/index.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
`),
  ]);
  await Promise.all([
    writeFile(join(directory, "schema", "statuses.ts"), 'export const statuses = ["proposed", "effective"] as const;\n'),
    writeFile(join(directory, "schema", "index.ts"), `
import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { statuses } from "@/statuses";
export const regulationStatus = pgEnum("toolchain_status", statuses);
export const regulations = pgTable("toolchain_regulations", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  status: regulationStatus("status").notNull().default("proposed"),
});
`),
  ]);
  // Do not inherit database/model credentials, NODE_OPTIONS, NODE_PATH, loader
  // controls or the user's home/cache directories into a toolchain subprocess.
  const environment: NodeJS.ProcessEnv = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: homeDirectory,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    XDG_CACHE_HOME: join(homeDirectory, ".cache"),
    XDG_CONFIG_HOME: join(homeDirectory, ".config"),
    CI: "true",
    NODE_ENV: "test",
    NO_COLOR: "1",
    TZ: "UTC",
  };
  return { directory, environment };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function runNode(fixture: Fixture, arguments_: string[]) {
  const result = await execFileAsync(process.execPath, arguments_, {
    cwd: fixture.directory,
    env: fixture.environment,
    timeout: commandTimeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 2 * 1024 * 1024,
    encoding: "utf8",
  });
  // Some Drizzle command paths print an exception without a nonzero exit.
  // A zero exit alone is therefore not sufficient evidence of success.
  expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/\b(?:[a-z]*error|ERR_[A-Z_]+)\b/iu);
  return result;
}

async function readMigrationTree(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(relativeDirectory: string): Promise<void> {
    for (const entry of await readdir(join(directory, relativeDirectory), { withFileTypes: true })) {
      const relativePath = join(relativeDirectory, entry.name);
      if (entry.isDirectory()) await visit(relativePath);
      else {
        expect(entry.isFile()).toBe(true);
        files[relativePath] = await readFile(join(directory, relativePath), "utf8");
      }
    }
  }
  await visit("");
  return files;
}

function expectFixtureSql(sql: string): void {
  expect(sql).toContain('CREATE TYPE "public"."toolchain_status" AS ENUM');
  expect(sql).toContain("'proposed', 'effective'");
  expect(sql).toContain('CREATE TABLE "toolchain_regulations"');
  expect(sql).toContain('"id" uuid PRIMARY KEY NOT NULL');
  expect(sql).toContain('"title" text NOT NULL');
  expect(sql).toContain('"status" "toolchain_status" DEFAULT \'proposed\' NOT NULL');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("installed Drizzle toolchain dependency boundary", () => {
  it("omits the legacy loader chain and retains the supported esbuild consumers", async () => {
    const manifestSchema = z.object({ version: z.string() });
    const drizzleManifest = manifestSchema.parse(JSON.parse(await readFile(join(dirname(drizzleEntry), "package.json"), "utf8")));
    expect(drizzleManifest.version).toBe("0.31.11");
    for (const lockPath of ["pnpm-lock.yaml", "node_modules/.pnpm/lock.yaml"]) {
      const lock = await readFile(join(repository, lockPath), "utf8");
      const legacyIdentities = lock.split("\n").filter((line) =>
        /^ {2}'?@esbuild-kit\/(?:esm-loader|core-utils)@/u.test(line) ||
        /^ {2}esbuild@0\.18\./u.test(line)
      );
      expect(legacyIdentities, lockPath).toEqual([]);
    }
    const requireFromDrizzle = createRequire(drizzleEntry);
    for (const packageName of ["@esbuild-kit/esm-loader", "@esbuild-kit/core-utils"]) {
      expect(() => requireFromDrizzle.resolve(packageName)).toThrow(/Cannot find module/u);
    }
    for (const [consumer, version] of [["drizzle-kit", "0.25.12"], ["tsx", "0.28.1"]] as const) {
      const requireFromConsumer = createRequire(requireFromRepository.resolve(consumer));
      const manifest = manifestSchema.parse(JSON.parse(await readFile(requireFromConsumer.resolve("esbuild/package.json"), "utf8")));
      expect(manifest.version).toBe(version);
    }
  });
});

describe.each(moduleTypes)("real Drizzle CLI with %s package semantics", (moduleType) => {
  it("loads TS config and aliased schema for generate/check/export, then generates no changes", async () => {
    const fixture = await createFixture(moduleType);
    await runNode(fixture, [drizzleCli, "generate"]);
    const migrationDirectory = join(fixture.directory, "migrations");
    const generated = await readMigrationTree(migrationDirectory);
    const sqlFiles = Object.keys(generated).filter((path) => path.endsWith(".sql"));
    expect(sqlFiles).toHaveLength(1);
    expectFixtureSql(generated[sqlFiles[0]!]!);
    const checked = await runNode(fixture, [drizzleCli, "check"]);
    expect(checked.stdout).toContain("Everything's fine");
    const exported = await runNode(fixture, [drizzleCli, "export"]);
    expectFixtureSql(exported.stdout);
    const repeated = await runNode(fixture, [drizzleCli, "generate"]);
    expect(repeated.stdout).toContain("No schema changes, nothing to migrate");
    expect(await readMigrationTree(migrationDirectory)).toEqual(generated);
  }, 45_000);
});

describe.each(moduleTypes)("real Drizzle public API with %s imports", (moduleType) => {
  it("exports config, PostgreSQL snapshots and no-op migration generation", async () => {
    const fixture = await createFixture(moduleType);
    const imports = moduleType === "module"
      ? `import { defineConfig } from "drizzle-kit";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";`
      : `const { defineConfig } = require("drizzle-kit");
const { generateDrizzleJson, generateMigration } = require("drizzle-kit/api");
const { pgEnum, pgTable, text, uuid } = require("drizzle-orm/pg-core");`;
    const scriptPath = join(fixture.directory, moduleType === "module" ? "api.mjs" : "api.cjs");
    await writeFile(scriptPath, `${imports}
async function main() {
  const regulationStatus = pgEnum("toolchain_status", ["proposed", "effective"]);
  const regulations = pgTable("toolchain_regulations", {
    id: uuid("id").primaryKey(),
    title: text("title").notNull(),
    status: regulationStatus("status").notNull().default("proposed"),
  });
  const empty = generateDrizzleJson({});
  const snapshot = generateDrizzleJson({ regulationStatus, regulations }, empty.id);
  process.stdout.write(JSON.stringify({
    config: defineConfig({ dialect: "postgresql", schema: "./schema/index.ts" }),
    tables: Object.keys(snapshot.tables),
    enumValues: snapshot.enums["public.toolchain_status"].values,
    migration: await generateMigration(empty, snapshot),
    noChanges: await generateMigration(snapshot, snapshot),
  }) + "\\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
`);
    const result = await runNode(fixture, [scriptPath]);
    const output = z.object({
      config: z.object({ dialect: z.literal("postgresql"), schema: z.literal("./schema/index.ts") }).strict(),
      tables: z.array(z.string()),
      enumValues: z.array(z.string()),
      migration: z.array(z.string()),
      noChanges: z.array(z.string()),
    }).strict().parse(JSON.parse(result.stdout));
    expect(output.tables).toEqual(["public.toolchain_regulations"]);
    expect(output.enumValues).toEqual(["proposed", "effective"]);
    expectFixtureSql(output.migration.join("\n"));
    expect(output.noChanges).toEqual([]);
  }, 15_000);
});

it("generates the real repository schema only into an isolated output directory", async () => {
  const fixture = await createFixture("commonjs");
  // This import closure contains only Drizzle declarations and Zod schemas;
  // it does not import the database client, environment loader or seed runner.
  await writeFile(join(fixture.directory, "drizzle.config.ts"), `
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: ${JSON.stringify(join(repository, "src/server/db/schema/index.ts"))},
  out: "./migrations",
  strict: true,
});
`);
  await writeFile(join(fixture.directory, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "bundler",
      paths: { "@/*": [join(repository, "src/*")] },
    },
  }));
  await runNode(fixture, [drizzleCli, "generate"]);
  const files = await readMigrationTree(join(fixture.directory, "migrations"));
  const sql = Object.entries(files).filter(([path]) => path.endsWith(".sql")).map(([, text]) => text).join("\n");
  for (const table of ["countries", "regulations", "products", "document_chunks"]) {
    expect(sql).toContain(`CREATE TABLE "${table}"`);
  }
  expect(sql).toContain('CREATE TYPE "public"."application_scope" AS ENUM');
  expect(sql).toContain('"embedding" vector(128)');
}, 15_000);

it.each([
  { name: "a nonzero exit", source: "process.exitCode = 9;" },
  { name: "an error printed with a zero exit", source: 'console.error("Error: deliberate fixture failure");' },
])("rejects $name instead of accepting a successful subprocess result", async ({ source }) => {
  const fixture = await createFixture("commonjs");
  await expect(runNode(fixture, ["-e", source])).rejects.toThrow();
}, 15_000);
