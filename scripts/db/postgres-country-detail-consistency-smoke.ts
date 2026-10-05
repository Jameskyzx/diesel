import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "../../src/server/db/postgres";

import * as schema from "../../src/server/db/schema";
import { createCountryRepository } from "../../src/server/repositories/country-repository";
import { createRegulationRepository } from "../../src/server/repositories/regulation-repository";
import {
  COUNTRY_DETAIL_READ_TRANSACTION_CONFIG,
} from "../../src/server/services/country-service";
import { compareRegulationsFromRepositories } from "../../src/server/services/marketing-analysis-service";
import { validatePostgresConcurrencySmokeTarget } from "./postgres-governance-concurrency-smoke";

const smokeCountryIso3 = "QCS";
const smokeCountryIso2 = "QS";
const smokeSourceId = "73000000-0000-4000-8000-000000000001";
const smokeJurisdictionId = "73000000-0000-4000-8000-000000000002";
const smokeRegulationId = "73000000-0000-4000-8000-000000000003";
const smokeLimitId = "73000000-0000-4000-8000-000000000004";
const oldRegulationName = "Country snapshot smoke old";
const newRegulationName = "Country snapshot smoke new";

function createSmokeClient(databaseUrl: URL, applicationName: string): Sql {
  return postgres(databaseUrl.toString(), {
    connect_timeout: 5,
    connection: {
      application_name: applicationName,
      idle_in_transaction_session_timeout: 10_000,
      lock_timeout: 5_000,
      statement_timeout: 10_000,
    },
    idle_timeout: 5,
    max: 1,
    max_lifetime: 60,
    prepare: false,
  });
}

function postgresErrorCode(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return null;
    }
    if ("code" in current && typeof current.code === "string") {
      return current.code;
    }
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

async function assertFixturesAbsent(client: Sql): Promise<void> {
  const rows = await client<{ collision: boolean }[]>`
    select
      exists (
        select 1 from data_sources where id = ${smokeSourceId}
      ) or exists (
        select 1 from countries
        where iso3 = ${smokeCountryIso3} or iso2 = ${smokeCountryIso2}
      ) or exists (
        select 1 from jurisdictions
        where id = ${smokeJurisdictionId} or code = 'QCS-SNAPSHOT'
      ) or exists (
        select 1 from country_jurisdictions
        where country_iso3 = ${smokeCountryIso3}
           or jurisdiction_id = ${smokeJurisdictionId}
      ) or exists (
        select 1 from regulations where id = ${smokeRegulationId}
      ) or exists (
        select 1 from regulation_limits where id = ${smokeLimitId}
      ) as collision
  `;
  assert.equal(
    rows[0]?.collision,
    false,
    "country detail consistency smoke fixture identity collided",
  );
}

async function cleanupOwnedFixtures(client: Sql): Promise<void> {
  await client.begin(async (transaction) => {
    const limitDeletion =
      await transaction`delete from regulation_limits where id = ${smokeLimitId}`;
    const regulationDeletion =
      await transaction`delete from regulations where id = ${smokeRegulationId}`;
    const membershipDeletion = await transaction`
      delete from country_jurisdictions
      where country_iso3 = ${smokeCountryIso3}
        and jurisdiction_id = ${smokeJurisdictionId}
        and valid_from = '2020-01-01'
    `;
    const jurisdictionDeletion =
      await transaction`delete from jurisdictions where id = ${smokeJurisdictionId}`;
    const countryDeletion =
      await transaction`delete from countries where iso3 = ${smokeCountryIso3}`;
    const sourceDeletion =
      await transaction`delete from data_sources where id = ${smokeSourceId}`;

    assert.deepEqual(
      [
        limitDeletion.count,
        regulationDeletion.count,
        membershipDeletion.count,
        jurisdictionDeletion.count,
        countryDeletion.count,
        sourceDeletion.count,
      ],
      [1, 1, 1, 1, 1, 1],
      "country detail consistency smoke cleanup did not own exactly one row per fixture table",
    );
  });
}

async function createFixtures(client: Sql): Promise<void> {
  await client.begin(async (transaction) => {
    await transaction`
      insert into data_sources
        (id, title, publisher, source_type, url, published_on, verified_at, is_demo)
      values
        (${smokeSourceId}, 'Country snapshot smoke source', 'Codex CI', 'other',
         'https://example.test/country-snapshot-smoke', '2026-08-30',
         '2026-08-30T00:00:00Z', false)
    `;
    await transaction`
      insert into countries
        (iso3, iso2, name_en, name_local, region_code, subregion_code,
         data_coverage_status, data_source_id, verified_at, is_demo)
      values
        (${smokeCountryIso3}, ${smokeCountryIso2}, 'Country snapshot smoke', null,
         'CI', 'CI-SNAPSHOT', 'covered', ${smokeSourceId},
         '2026-08-30T00:00:00Z', false)
    `;
    await transaction`
      insert into jurisdictions
        (id, code, name, type, country_iso3, data_source_id, verified_at, is_demo)
      values
        (${smokeJurisdictionId}, 'QCS-SNAPSHOT', 'Country snapshot jurisdiction',
         'country', ${smokeCountryIso3}, ${smokeSourceId},
         '2026-08-30T00:00:00Z', false)
    `;
    await transaction`
      insert into country_jurisdictions
        (country_iso3, jurisdiction_id, valid_from, valid_to,
         data_source_id, verified_at, is_demo)
      values
        (${smokeCountryIso3}, ${smokeJurisdictionId}, '2020-01-01', null,
         ${smokeSourceId}, '2026-08-30T00:00:00Z', false)
    `;
    await transaction`
      insert into regulations
        (id, jurisdiction_id, canonical_name, citation_code, status,
         proposed_on, adopted_on, effective_from, effective_to,
         data_source_id, verified_at, is_demo)
      values
        (${smokeRegulationId}, ${smokeJurisdictionId}, ${oldRegulationName},
         'QCS-SNAPSHOT-2020', 'effective', '2019-01-01', '2019-06-01',
         '2020-01-01', null, ${smokeSourceId},
         '2026-08-30T00:00:00Z', false)
    `;
    await transaction`
      insert into regulation_limits
        (id, regulation_id, application_scope, engine_type_code,
         power_min_kw, power_max_kw, pollutant_code, limit_value, unit_code,
         valid_from, valid_to, data_source_id, verified_at, is_demo)
      values
        (${smokeLimitId}, ${smokeRegulationId}, 'non-road', 'CI',
         0, 200, 'NOx', 1.234, 'g/kWh', '2020-01-01', null,
         ${smokeSourceId}, '2026-08-30T00:00:00Z', false)
    `;
  });
}

export async function runPostgresCountryDetailConsistencySmoke(): Promise<void> {
  const databaseUrl = validatePostgresConcurrencySmokeTarget();
  const readerClient = createSmokeClient(
    databaseUrl,
    "diesel-country-detail-snapshot-reader",
  );
  const writerClient = createSmokeClient(
    databaseUrl,
    "diesel-country-detail-snapshot-writer",
  );
  const readerDatabase = drizzle(readerClient, { schema });
  let ownsFixtures = false;
  let primaryError: unknown;

  try {
    await assertFixturesAbsent(writerClient);
    await createFixtures(writerClient);
    ownsFixtures = true;

    let readOnlyRejected = false;
    try {
      await readerDatabase.transaction(
        async (transaction) => {
          await transaction
            .update(schema.countries)
            .set({ nameEn: "Read-only transaction must reject this write" })
            .where(eq(schema.countries.iso3, smokeCountryIso3));
        },
        COUNTRY_DETAIL_READ_TRANSACTION_CONFIG,
      );
    } catch (error: unknown) {
      if (postgresErrorCode(error) !== "25006") {
        throw error;
      }
      readOnlyRejected = true;
    }
    assert.equal(
      readOnlyRejected,
      true,
      "country detail transaction accepted a write",
    );

    const observedNames = await readerDatabase.transaction(
      async (transaction) => {
        const countryRepository = createCountryRepository(transaction);
        const regulationRepository = createRegulationRepository(transaction);
        const details = await countryRepository.findDetailsByIso3({
          asOf: "2026-08-30",
          iso3: smokeCountryIso3,
        });
        assert.ok(details, "country detail fixture was not visible");
        assert.equal(details.regulations.length, 1);
        const profileName = details.regulations[0]?.canonicalName;

        await writerClient`
          update regulations
          set canonical_name = ${newRegulationName}, updated_at = now()
          where id = ${smokeRegulationId}
        `;

        const comparison = await compareRegulationsFromRepositories(
          {
            applicationScope: "non-road",
            asOf: "2026-08-30",
            countryIso3s: [smokeCountryIso3],
            powerKw: 100,
          },
          { countryRepository, regulationRepository },
        );
        const comparisonName =
          comparison.countries[0]?.currentEffectiveRegulations[0]
            ?.canonicalName;
        return { comparisonName, profileName };
      },
      COUNTRY_DETAIL_READ_TRANSACTION_CONFIG,
    );

    assert.deepEqual(observedNames, {
      comparisonName: oldRegulationName,
      profileName: oldRegulationName,
    });
    const rows = await writerClient<{ canonicalName: string }[]>`
      select canonical_name as "canonicalName"
      from regulations
      where id = ${smokeRegulationId}
    `;
    assert.equal(rows[0]?.canonicalName, newRegulationName);
  } catch (error: unknown) {
    primaryError = error;
  }

  let cleanupError: unknown;
  if (ownsFixtures) {
    try {
      await cleanupOwnedFixtures(writerClient);
    } catch (error: unknown) {
      cleanupError = error;
    }
  }
  const closeOutcomes = await Promise.allSettled([
    readerClient.end({ timeout: 2 }),
    writerClient.end({ timeout: 2 }),
  ]);
  const closeErrors = closeOutcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
  const finalErrors = [
    ...(primaryError === undefined ? [] : [primaryError]),
    ...(cleanupError === undefined ? [] : [cleanupError]),
    ...closeErrors,
  ];
  if (finalErrors.length === 1) {
    throw finalErrors[0];
  }
  if (finalErrors.length > 1) {
    throw new AggregateError(
      finalErrors,
      "Country detail consistency smoke failed in multiple stages.",
      { cause: primaryError ?? cleanupError ?? closeErrors[0] },
    );
  }
}

async function main(): Promise<void> {
  await runPostgresCountryDetailConsistencySmoke();
  process.stdout.write(
    "PostgreSQL country detail snapshot smoke passed (read-only + repeatable-read).\n",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `PostgreSQL country detail snapshot smoke failed: ${message}\n`,
    );
    process.exitCode = 1;
  });
}
