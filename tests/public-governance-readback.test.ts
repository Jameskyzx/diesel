import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { portfolioReleaseCountryIso3s } from "@/domain/portfolio-evidence";
import type { CountryDetailResponse } from "@/features/countries/schemas";
import {
  countries,
  countryJurisdictions,
  dataSources,
  jurisdictions,
  regulationLimits,
  regulations,
} from "@/server/db/schema";
import {
  acceptanceFixtureIds,
  buildFixtureLimits,
  fixtureCountryJurisdictions,
  fixtureJurisdictions,
  fixtureRegulations,
  fixtureSources,
} from "@/server/db/seed/acceptance-fixtures";
import { demoIds, seedDemoData } from "@/server/db/seed/demo-data";
import {
  getCountryDetails,
  listCountryMapSummaries,
} from "@/server/services/country-service";
import {
  buildFullIngestSelection,
  buildTargetSelection,
} from "../scripts/db/fixture-target-selection";
import { createTestDatabase } from "./helpers/database";

// Only the connection factory is substituted. Queries, the production-mode
// service, DTO validation and the actual Bash/Node public validator are real.
const databaseFactory = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock("@/server/db/client", () => databaseFactory);
vi.mock("@/server/db/environment", () => ({
  getDatabaseMode: () => "postgres",
}));

type AvailableDetail = Extract<CountryDetailResponse, { status: "available" }>;
type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
const executeFile = promisify(execFile);
const release = "a".repeat(40);
const asOf = "2026-08-11";
const detailPath = `/api/countries/CHN?asOf=${asOf}`;
const validatorPath = resolve(
  "scripts/deploy/validate-public-governance.sh",
);
let database: TestDatabase;
let workspace: string;
let china: AvailableDetail;
let responses: Record<string, unknown>;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "diesel-public-governance-"));
  database = await createTestDatabase();
  databaseFactory.getDatabase.mockReturnValue(database.database);
  await seedDemoData(database.database);
  const selection = buildFullIngestSelection(
    [...portfolioReleaseCountryIso3s],
    buildFixtureLimits(),
  );
  // Model the signed publication selection, not every adjacent draft in the
  // fixture catalog. This does not execute ingestion against a live database.
  await database.database.transaction(async (transaction) => {
    await transaction.insert(dataSources).values(
      fixtureSources.filter((row) => row.id && selection.sourceIds.has(row.id)),
    );
    await transaction.insert(jurisdictions).values(
      fixtureJurisdictions.filter(
        (row) => row.id && selection.jurisdictionIds.has(row.id),
      ),
    );
    await transaction.insert(countryJurisdictions).values(
      fixtureCountryJurisdictions.filter(
        (row) => selection.jurisdictionIds.has(row.jurisdictionId),
      ),
    );
    await transaction.insert(regulations).values(
      fixtureRegulations.filter(
        (row) => row.id && selection.regulationIds.has(row.id),
      ),
    );
    await transaction.insert(regulationLimits).values([...selection.limitRows]);
    await transaction.update(countries).set({
      dataCoverageStatus: "covered",
      dataSourceId: demoIds.source.countryDirectory,
      isDemo: false,
    }).where(inArray(countries.iso3, [...portfolioReleaseCountryIso3s]));
  });

  responses = {
    "/api/health/ready": { status: "ok", version: release },
    "/api/countries": await listCountryMapSummaries(),
  };
  for (const iso3 of portfolioReleaseCountryIso3s) {
    const detail = await getCountryDetails({ asOf, iso3 });
    if (detail.status !== "available") {
      throw new Error(`Signed fixture did not produce a public ${iso3} detail`);
    }
    responses[`/api/countries/${iso3}?asOf=${asOf}`] = detail;
    if (iso3 === "CHN") china = detail;
  }

  const bin = join(workspace, "bin");
  await mkdir(bin);
  // The sole transport stub serves the real service payloads above. Unknown
  // URLs fail instead of reaching the network or producing permissive defaults.
  await writeFile(join(bin, "curl"), `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const args = process.argv.slice(2);
const url = new URL(args.at(-1));
if (url.origin !== "https://diesel.jamesky.site" || args[0] !== "--disable") process.exit(64);
appendFileSync(process.env.PUBLIC_GOVERNANCE_REQUEST_LOG, url.pathname + url.search + "\\n");
if (args.includes("--write-out")) {
  if (!/^\\/(?:chat|countries\\/[A-Z]{3})?$/.test(url.pathname)) process.exit(64);
  process.stdout.write("200");
} else {
  const responses = JSON.parse(readFileSync(process.env.PUBLIC_GOVERNANCE_RESPONSES, "utf8"));
  const key = url.pathname + url.search;
  if (!Object.hasOwn(responses, key)) process.exit(64);
  process.stdout.write(JSON.stringify(responses[key]));
}
`, { mode: 0o700 });
}, 60_000);

afterAll(async () => {
  await database?.client.close();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

async function runValidator(
  name: string,
  mutate?: (detail: AvailableDetail) => void,
): Promise<{ exitCode: number; stderr: string; requests: string[] }> {
  const payloads = structuredClone(responses);
  const detail = structuredClone(china);
  mutate?.(detail);
  payloads[detailPath] = detail;
  const responsePath = join(workspace, `${name}.json`);
  const requestLog = join(workspace, `${name}.requests`);
  await writeFile(responsePath, JSON.stringify(payloads), { mode: 0o600 });
  await writeFile(requestLog, "", { mode: 0o600 });
  let exitCode = 0;
  let stderr = "";
  try {
    ({ stderr } = await executeFile("/bin/bash", [validatorPath, release], {
      encoding: "utf8",
      env: {
        HOME: workspace,
        NODE_ENV: "test",
        PATH: `${join(workspace, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
        PUBLIC_GOVERNANCE_REQUEST_LOG: requestLog,
        PUBLIC_GOVERNANCE_RESPONSES: responsePath,
      },
      maxBuffer: 1024 * 1024,
      timeout: 45_000,
    }));
  } catch (error: unknown) {
    if (
      !(error instanceof Error) || !("code" in error) ||
      typeof error.code !== "number" || !("stderr" in error) ||
      typeof error.stderr !== "string"
    ) throw error;
    exitCode = error.code;
    stderr = error.stderr;
  }
  return {
    exitCode,
    stderr,
    requests: (await readFile(requestLog, "utf8")).trim().split("\n"),
  };
}

describe("public governance validator against signed service payloads", () => {
  it.each([
    { applicationScope: "non-road", queryDate: "2026-09-30", regulationIds: [] },
    { applicationScope: "non-road", queryDate: asOf, regulationIds: [] },
    {
      applicationScope: "construction",
      queryDate: "2026-09-30",
      regulationIds: [acceptanceFixtureIds.regulation.cnGb20891],
    },
    {
      applicationScope: "agriculture",
      queryDate: "2026-09-30",
      regulationIds: [acceptanceFixtureIds.regulation.cnGb20891],
    },
  ])("excludes Demo comparison facts from the public $applicationScope summary at $queryDate", async ({ applicationScope, queryDate, regulationIds }) => {
    // This database deliberately contains both the original Demo regulations
    // and the existing signed real fixtures, as the production database does.
    const detail = await getCountryDetails({
      applicationScope,
      asOf: queryDate,
      iso3: "CHN",
      powerKw: 100,
    });
    expect(detail.status).toBe("available");
    if (detail.status !== "available" || detail.applicabilitySummary === null) {
      throw new Error("Expected a validated public applicability summary");
    }
    const summary = detail.applicabilitySummary;
    expect(summary.query).toEqual({
      applicationScope,
      asOf: queryDate,
      countryIso3s: ["CHN"],
      powerKw: 100,
    });
    expect(summary.country.currentEffectiveRegulations.map(({ id }) => id))
      .toEqual(regulationIds);
    expect(summary.country.futureAdoptedRegulations).toEqual([]);
    expect(summary.country.status).toBe(regulationIds.length ? "available" : "no_data");
    expect(summary.sources.every(({ isDemo }) => !isDemo)).toBe(true);
    if (regulationIds.length === 0) {
      expect(summary.sources).toEqual([]);
      expect(summary.lastVerifiedAt).toBeNull();
      expect(summary.missingData).not.toEqual([]);
    }
  });

  it("keeps China's two regulations distinct from its three signed sources", () => {
    const target = buildTargetSelection("CHN", buildFixtureLimits());
    expect(target.regulationIds).toEqual(new Set([
      acceptanceFixtureIds.regulation.cnGb17691,
      acceptanceFixtureIds.regulation.cnGb20891,
    ]));
    expect(target.sourceIds).toEqual(new Set([
      acceptanceFixtureIds.source.cnGb17691,
      acceptanceFixtureIds.source.cnGb20891,
      acceptanceFixtureIds.source.cnHj1014,
    ]));
    expect(new Set(china.country.currentEffectiveRegulations.map(({ id }) => id)))
      .toEqual(target.regulationIds);
    expect(china.country.currentEffectiveRegulations).toHaveLength(2);
    expect(china.country.sources.map(({ id }) => id))
      .toEqual(expect.arrayContaining([...target.sourceIds]));
  });

  it("runs the complete public CLI successfully with the signed service responses", async () => {
    const result = await runValidator("signed-service-success");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    for (const iso3 of portfolioReleaseCountryIso3s) {
      expect(result.requests).toContain(`/countries/${iso3}`);
      expect(result.requests).toContain(`/api/countries/${iso3}?asOf=${asOf}`);
    }
    expect(result.requests.at(-1)).toBe(`/api/countries/TTO?asOf=${asOf}`);
  }, 60_000);

  const driftCases: {
    name: string;
    message: string;
    mutate: (detail: AvailableDetail) => void;
  }[] = [
    {
      name: "missing-regulation",
      message: "Unexpected CHN public detail payload",
      mutate: (detail) => { detail.country.currentEffectiveRegulations.pop(); },
    },
    {
      name: "additional-regulation",
      message: "Unexpected CHN public detail payload",
      mutate: (detail) => {
        const extra = structuredClone(detail.country.currentEffectiveRegulations[0]!);
        extra.id = "10000000-0000-4000-8000-000000009999";
        detail.country.currentEffectiveRegulations.push(extra);
      },
    },
    {
      name: "jurisdiction-source-drift",
      message: "Unexpected CHN national source graph",
      mutate: (detail) => {
        detail.country.jurisdictions[0]!.source.id = acceptanceFixtureIds.source.cnGb20891;
      },
    },
    {
      name: "membership-source-drift",
      message: "Unexpected CHN national source graph",
      mutate: (detail) => {
        detail.country.jurisdictions[0]!.membershipSource.id = acceptanceFixtureIds.source.cnHj1014;
      },
    },
    {
      name: "missing-regulation-source",
      message: "Missing CHN accepted source",
      mutate: (detail) => {
        detail.country.sources = detail.country.sources.filter(
          ({ id }) => id !== acceptanceFixtureIds.source.cnGb20891,
        );
      },
    },
  ];

  it.each(driftCases)("rejects $name without weakening the public boundary", async ({ name, message, mutate }) => {
    const result = await runValidator(name, mutate);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
  }, 60_000);
});
