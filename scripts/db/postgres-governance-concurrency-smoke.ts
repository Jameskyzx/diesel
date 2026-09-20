import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { governanceMaintenanceTokenEnvironmentVariable } from "../../src/server/db/governance-maintenance-lock";
import {
  ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER,
  ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER,
} from "../../src/features/admin/schemas";
import * as schema from "../../src/server/db/schema";
import {
  createGovernanceRepository,
  GovernanceConflictError,
  SOURCE_CONCURRENT_INSERT_CONFLICT_MESSAGE,
  SOURCE_VERIFIED_AT_REGRESSION_MESSAGE,
} from "../../src/server/repositories/governance-repository";

const expectedDatabaseName = "diesel_ci";
export const postgresConcurrencySmokeOptInEnvironmentVariable =
  "DIESEL_POSTGRES_CONCURRENCY_SMOKE";
const repositoryApplicationName = "diesel-governance-concurrency-smoke";
const smokeActor = {
  email: "postgres-concurrency-smoke@example.test",
  role: "admin" as const,
};
const smokeSourceId = "71000000-0000-4000-8000-000000000001";
const smokeConcurrentSourceId = "71000000-0000-4000-8000-000000000002";
const smokeCountryIso3 = "QCI";
const smokeDraftEntityKey = "72000000-0000-4000-8000-000000000001";
const smokeReprocessingBytes = new TextEncoder().encode(
  "# PostgreSQL reprocessing smoke\n\nStable evidence for response-loss retries.",
);
const smokeReprocessingContentSha256 = createHash("sha256")
  .update(smokeReprocessingBytes)
  .digest("hex");
const smokeReprocessingInitialSourceTitle =
  "PostgreSQL reprocessing smoke initial source";
const smokeReprocessingReplacementSourceTitle =
  "PostgreSQL reprocessing smoke replacement source";
const smokeReprocessingDocumentTitle =
  "PostgreSQL reprocessing smoke document";
const smokeReprocessingReason =
  "Exercise the PostgreSQL response-loss reprocessing retry.";
export const postgresSourceVerifiedAtPrecisionCases = {
  current: "2026-03-01T00:00:00.123456Z",
  newer: "2026-03-01T00:00:00.123789Z",
  older: "2026-03-01T00:00:00.123000Z",
} as const;
const smokeInitialSourceVerifiedAt =
  postgresSourceVerifiedAtPrecisionCases.current;
const smokeDraftSourceVerifiedAt =
  postgresSourceVerifiedAtPrecisionCases.older;
const smokeNewestSourceVerifiedAt =
  postgresSourceVerifiedAtPrecisionCases.newer;
const waiterObservationTimeoutMs = 3_000;
const smokeDeadlineMs = 30_000;
const closeTimeoutSeconds = 2;

export function createSameMillisecondTimestampDrift(
  timestamp: string,
): string {
  const match = /^(.*\.\d{3})(\d{3})Z$/u.exec(timestamp);
  if (!match) {
    throw new Error("Expected an exact PostgreSQL microsecond timestamp.");
  }
  return `${match[1]}${match[2] === "789" ? "123" : "789"}Z`;
}

type SmokeEnvironment = Readonly<Record<string, string | undefined>>;

export type PostgresConcurrencyReadback = {
  currentDatabase: string;
  serverVersionNum: number;
  vectorInstalled: boolean;
};

export type PostgresConcurrencySmokeErrors = {
  cleanupError?: unknown;
  monitorCloseError?: unknown;
  operationalCloseError?: unknown;
  primaryError?: unknown;
};

export const postgresGovernanceConcurrencySmokeScenarioNames = [
  "draft creation",
  "import confirmation",
  "source verified-at precision and insert race",
  "document reprocessing idempotent retry",
  "document reprocessing replay drift",
  "entity archive",
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function composePostgresConcurrencySmokeError(
  input: PostgresConcurrencySmokeErrors,
): unknown | null {
  const teardownErrors = [
    ["operational close", input.operationalCloseError],
    ["fixture cleanup", input.cleanupError],
    ["monitor close", input.monitorCloseError],
  ]
    .filter((entry): entry is [string, unknown] => entry[1] !== undefined)
    .map(
      ([stage, error]) =>
        new Error(`${stage}: ${errorMessage(error)}`, { cause: error }),
    );

  if (input.primaryError !== undefined) {
    if (teardownErrors.length === 0) {
      return input.primaryError;
    }
    return new AggregateError(
      [input.primaryError, ...teardownErrors],
      `PostgreSQL concurrency smoke failed: ${errorMessage(input.primaryError)}; teardown also failed.`,
      { cause: input.primaryError },
    );
  }
  if (teardownErrors.length > 0) {
    return new AggregateError(
      teardownErrors,
      `PostgreSQL concurrency smoke teardown failed: ${teardownErrors.map(({ message }) => message).join("; ")}`,
    );
  }
  return null;
}

export function validatePostgresConcurrencySmokeTarget(
  environment: SmokeEnvironment = process.env,
): URL {
  if (
    environment[postgresConcurrencySmokeOptInEnvironmentVariable] !== "1"
  ) {
    throw new Error(
      `${postgresConcurrencySmokeOptInEnvironmentVariable}=1 is required for this destructive smoke.`,
    );
  }
  if (
    environment[governanceMaintenanceTokenEnvironmentVariable] !== undefined
  ) {
    throw new Error(
      `${governanceMaintenanceTokenEnvironmentVariable} must be unset for the concurrency smoke.`,
    );
  }

  const rawUrl = environment.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DATABASE_URL is required for the concurrency smoke.");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (
    databaseUrl.protocol !== "postgres:" &&
    databaseUrl.protocol !== "postgresql:"
  ) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(databaseUrl.hostname)
  ) {
    throw new Error(
      "The concurrency smoke only accepts a loopback PostgreSQL host.",
    );
  }
  if (databaseUrl.pathname !== `/${expectedDatabaseName}`) {
    throw new Error(
      `The concurrency smoke only accepts database ${expectedDatabaseName}.`,
    );
  }

  return databaseUrl;
}

export function validatePostgresConcurrencyReadback(
  input: PostgresConcurrencyReadback,
): void {
  if (input.currentDatabase !== expectedDatabaseName) {
    throw new Error(
      `PostgreSQL readback selected unexpected database ${input.currentDatabase}.`,
    );
  }
  if (
    input.serverVersionNum < 160_000 ||
    input.serverVersionNum >= 170_000
  ) {
    throw new Error("The concurrency smoke requires PostgreSQL 16.x.");
  }
  if (!input.vectorInstalled) {
    throw new Error("The concurrency smoke requires the vector extension.");
  }
}

function createSmokeClient(
  databaseUrl: URL,
  applicationName: string,
  max: number,
): Sql {
  return postgres(databaseUrl.toString(), {
    connect_timeout: 5,
    connection: {
      application_name: applicationName,
      idle_in_transaction_session_timeout: 10_000,
      lock_timeout: 5_000,
      statement_timeout: 10_000,
    },
    idle_timeout: 5,
    max,
    max_lifetime: 60,
    prepare: false,
  });
}

async function readAndValidateTarget(client: Sql): Promise<void> {
  const rows = await client<PostgresConcurrencyReadback[]>`
    select
      current_database() as "currentDatabase",
      current_setting('server_version_num')::int as "serverVersionNum",
      exists (
        select 1 from pg_extension where extname = 'vector'
      ) as "vectorInstalled"
  `;
  if (rows.length !== 1 || !rows[0]) {
    throw new Error("PostgreSQL target readback did not return one row.");
  }
  validatePostgresConcurrencyReadback(rows[0]);
}

async function assertNoSmokeFixtureCollisions(client: Sql): Promise<void> {
  const rows = await client<{ count: number }[]>`
    select (
      (select count(*) from data_change_logs
       where actor_email = ${smokeActor.email}
          or entity_key in (
            ${smokeCountryIso3},
            ${smokeDraftEntityKey},
            ${smokeSourceId},
            ${smokeConcurrentSourceId}
          ))
      +
      (select count(*) from data_governance_drafts
       where created_by = ${smokeActor.email}
          or entity_key in (
            ${smokeDraftEntityKey},
            ${smokeSourceId},
            ${smokeConcurrentSourceId}
          ))
      +
      (select count(*) from market_import_batches
       where created_by = ${smokeActor.email})
      +
      (select count(*) from countries where iso3 = ${smokeCountryIso3})
      +
      (select count(*) from data_sources
       where id in (${smokeSourceId}, ${smokeConcurrentSourceId})
          or title in (
            ${smokeReprocessingInitialSourceTitle},
            ${smokeReprocessingReplacementSourceTitle}
          ))
      +
      (select count(*) from documents
       where content_sha256 = ${smokeReprocessingContentSha256}
          or title = ${smokeReprocessingDocumentTitle})
    )::int as count
  `;
  if (rows[0]?.count !== 0) {
    throw new Error(
      "PostgreSQL concurrency smoke sentinel collision; refusing to delete or reuse existing rows.",
    );
  }
}

async function cleanupOwnedSmokeFixtures(input: {
  client: Sql;
  reprocessingDocumentId: string | null;
}): Promise<void> {
  const { client } = input;
  await client.begin(async (transaction) => {
    await transaction`
      delete from data_change_logs
      where actor_email = ${smokeActor.email}
    `;
    await transaction`
      delete from data_governance_drafts
      where created_by = ${smokeActor.email}
    `;
    await transaction`
      delete from market_import_batches
      where created_by = ${smokeActor.email}
    `;
    await transaction`
      delete from countries where iso3 = ${smokeCountryIso3}
    `;
    if (input.reprocessingDocumentId) {
      await transaction`
        delete from document_chunks
        where document_id = ${input.reprocessingDocumentId}
      `;
      await transaction`
        delete from documents
        where id = ${input.reprocessingDocumentId}
      `;
    }
    await transaction`
      delete from data_sources
      where id in (${smokeSourceId}, ${smokeConcurrentSourceId})
         or title in (
           ${smokeReprocessingInitialSourceTitle},
           ${smokeReprocessingReplacementSourceTitle}
         )
    `;
  });
}

async function createSmokeFixtures(client: Sql): Promise<void> {
  await client.begin(async (transaction) => {
    await transaction`
      insert into data_sources
        (id, title, source_type, verified_at, is_demo)
      values
        (${smokeSourceId}, 'PostgreSQL concurrency smoke source', 'other',
         ${smokeInitialSourceVerifiedAt}, false)
    `;
    await transaction`
      insert into countries
        (iso3, iso2, name_en, data_source_id, verified_at, is_demo)
      values
        (${smokeCountryIso3}, 'QI', 'PostgreSQL concurrency smoke country',
         ${smokeSourceId}, now(), false)
    `;
  });
}

async function waitForLockWaiters(
  monitor: Sql,
  abortSignal: AbortSignal,
  expectedCount = 2,
): Promise<void> {
  const deadline = Date.now() + waiterObservationTimeoutMs;

  while (Date.now() < deadline) {
    if (abortSignal.aborted) {
      throw new Error("PostgreSQL concurrency smoke exceeded its 30s deadline.");
    }
    const rows = await monitor<{ count: number }[]>`
      select count(*)::int as count
      from pg_stat_activity
      where application_name = ${repositoryApplicationName}
        and state = 'active'
        and wait_event_type = 'Lock'
    `;
    if (rows[0]?.count === expectedCount) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Did not observe exactly ${expectedCount} PostgreSQL lock waiters.`,
  );
}

async function waitForDocumentDraftLockWaiters(
  monitor: Sql,
  abortSignal: AbortSignal,
  expectedCount: number,
  applicationName: string,
): Promise<void> {
  const deadline = Date.now() + waiterObservationTimeoutMs;

  while (Date.now() < deadline) {
    if (abortSignal.aborted) {
      throw new Error("PostgreSQL concurrency smoke exceeded its 30s deadline.");
    }
    const rows = await monitor<{ count: number }[]>`
      select count(*)::int as count
      from pg_stat_activity
      where pid <> pg_backend_pid()
        and datname = current_database()
        and application_name = ${applicationName}
        and state = 'active'
        and wait_event_type = 'Lock'
        and query ilike '%data_governance_drafts%'
    `;
    if (rows[0]?.count === expectedCount) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Did not observe exactly ${expectedCount} document-draft lock waiters.`,
  );
}

async function runContendersUnderLock(
  locker: Sql,
  monitor: Sql,
  abortSignal: AbortSignal,
  lockStatement: string,
  lockParameters: string[],
  startContenders: () => [Promise<unknown>, Promise<unknown>],
): Promise<PromiseSettledResult<unknown>[]> {
  let contenders: [Promise<unknown>, Promise<unknown>] | undefined;

  try {
    await locker.begin(async (transaction) => {
      await transaction.unsafe(lockStatement, lockParameters);
      contenders = startContenders();
      await waitForLockWaiters(monitor, abortSignal);
    });
  } catch (error: unknown) {
    if (contenders) {
      await Promise.allSettled(contenders);
    }
    throw error;
  }

  if (!contenders) {
    throw new Error("Concurrency contenders were not started.");
  }
  return Promise.allSettled(contenders);
}

function assertOneConflict(
  results: PromiseSettledResult<unknown>[],
  expectedMessage: RegExp,
): PromiseFulfilledResult<unknown> {
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<unknown> =>
      result.status === "fulfilled",
  );
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0]?.reason instanceof GovernanceConflictError);
  assert.match(rejected[0].reason.message, expectedMessage);
  return fulfilled[0]!;
}

async function verifyConcurrentDraftCreation(input: {
  abortSignal: AbortSignal;
  locker: Sql;
  monitor: Sql;
  repository: ReturnType<typeof createGovernanceRepository>;
}): Promise<void> {
  const create = () =>
    input.repository.createDraft({
      actor: smokeActor,
      changeReason: "Exercise the PostgreSQL draft uniqueness race.",
      entityKey: smokeDraftEntityKey,
      entityType: "data_source",
      payload: { id: smokeDraftEntityKey },
    });
  const results = await runContendersUnderLock(
    input.locker,
    input.monitor,
    input.abortSignal,
    "lock table data_governance_drafts in share mode",
    [],
    () => [create(), create()],
  );
  assertOneConflict(results, /concurrently; retry with the latest version/i);

  const rows = await input.monitor<{ count: number; version: number }[]>`
    select count(*)::int as count, min(version)::int as version
    from data_governance_drafts
    where entity_type = 'data_source'
      and entity_key = ${smokeDraftEntityKey}
  `;
  assert.deepEqual(rows, [{ count: 1, version: 1 }]);
  const auditRows = await input.monitor<{ count: number }[]>`
    select count(*)::int as count
    from data_change_logs
    where actor_email = ${smokeActor.email}
      and entity_key = ${smokeDraftEntityKey}
      and action = 'draft_created'
  `;
  assert.equal(auditRows[0]?.count, 1);
}

async function verifyConcurrentImportConfirmation(input: {
  abortSignal: AbortSignal;
  locker: Sql;
  monitor: Sql;
  repository: ReturnType<typeof createGovernanceRepository>;
}): Promise<void> {
  const batch = await input.repository.createMarketImportPreview({
    actor: smokeActor,
    contentSha256: "7".repeat(64),
    errors: [],
    fileName: "postgres-concurrency-smoke.csv",
    rows: [
      {
        parsed: {
          applicationScope: "non-road",
          countryIso3: smokeCountryIso3,
          currencyCode: null,
          dataSourceId: smokeSourceId,
          definition: "PostgreSQL concurrency smoke metric.",
          isDemo: false,
          methodologyVersion: "smoke-v1",
          metricCode: "POSTGRES_CONCURRENCY_SMOKE",
          metricName: "PostgreSQL concurrency smoke",
          periodEnd: "2026-01-01",
          periodStart: "2025-01-01",
          publishedOn: null,
          unitCode: "units",
          valueNumeric: "1",
          verifiedAt: "2026-08-30T00:00:00.000Z",
        },
        rowNumber: 2,
      },
    ],
  });
  const confirm = () =>
    input.repository.confirmMarketImport({
      actor: smokeActor,
      batchId: batch.id,
      reason: "Exercise PostgreSQL batch confirmation serialization.",
    });
  const results = await runContendersUnderLock(
    input.locker,
    input.monitor,
    input.abortSignal,
    "select id from market_import_batches where id = $1 for update",
    [batch.id],
    () => [confirm(), confirm()],
  );
  const fulfilled = assertOneConflict(results, /no longer previewable/i);
  assert.deepEqual(fulfilled.value, { createdDrafts: 1, status: "committed" });

  const batchRows = await input.monitor<
    { draftCreated: number; importCommitted: number; status: string }[]
  >`
    select
      batch.status,
      count(*) filter (where log.action = 'draft_created')::int as "draftCreated",
      count(*) filter (where log.action = 'import_committed')::int as "importCommitted"
    from market_import_batches batch
    left join data_change_logs log on log.import_batch_id = batch.id
    where batch.id = ${batch.id}
    group by batch.status
  `;
  assert.deepEqual(batchRows, [
    { draftCreated: 1, importCommitted: 1, status: "committed" },
  ]);
}

async function verifyConcurrentSourceVerifiedAtMonotonicity(input: {
  abortSignal: AbortSignal;
  locker: Sql;
  monitor: Sql;
  repository: ReturnType<typeof createGovernanceRepository>;
}): Promise<void> {
  const draft = await input.repository.createDraft({
    actor: smokeActor,
    changeReason: "Prepare the PostgreSQL source monotonicity revision.",
    entityKey: smokeSourceId,
    entityType: "data_source",
    payload: {
      demoNotice: null,
      id: smokeSourceId,
      isDemo: false,
      publishedOn: null,
      publisher: null,
      sourceType: "other",
      title: "Stale PostgreSQL concurrency smoke source revision",
      url: null,
      verifiedAt: smokeDraftSourceVerifiedAt,
    },
  });
  await input.repository.reviewDraft({
    actor: smokeActor,
    draftId: draft.id,
    reason: "Review the PostgreSQL source monotonicity revision.",
  });

  let verification: Promise<unknown> | undefined;
  let stalePublication: Promise<unknown> | undefined;
  try {
    await input.locker.begin(async (transaction) => {
      await transaction`
        select id from data_sources where id = ${smokeSourceId} for update
      `;
      verification = input.repository.updateSourceVerifiedAt({
        actor: smokeActor,
        reason: "Record the newer PostgreSQL source verification.",
        sourceId: smokeSourceId,
        verifiedAt: smokeNewestSourceVerifiedAt,
      });
      await waitForLockWaiters(
        input.monitor,
        input.abortSignal,
        1,
      );
      stalePublication = input.repository.publishDraft({
        actor: smokeActor,
        draftId: draft.id,
        reason: "Attempt the stale PostgreSQL source publication.",
      });
      await waitForLockWaiters(
        input.monitor,
        input.abortSignal,
        2,
      );
    });
  } catch (error: unknown) {
    await Promise.allSettled(
      [verification, stalePublication].filter(
        (operation): operation is Promise<unknown> => operation !== undefined,
      ),
    );
    throw error;
  }

  if (!verification || !stalePublication) {
    throw new Error("Source monotonicity contenders were not started.");
  }
  const [verificationResult, publicationResult] = await Promise.allSettled([
    verification,
    stalePublication,
  ]);
  assert.equal(verificationResult.status, "fulfilled");
  assert.equal(publicationResult.status, "rejected");
  if (publicationResult.status !== "rejected") {
    throw new Error("The stale source publication unexpectedly succeeded.");
  }
  assert.ok(publicationResult.reason instanceof GovernanceConflictError);
  assert.equal(
    publicationResult.reason.message,
    SOURCE_VERIFIED_AT_REGRESSION_MESSAGE,
  );

  const sourceRows = await input.monitor<
    { title: string; verifiedAt: string }[]
  >`
    select
      title,
      to_char(
        verified_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) as "verifiedAt"
    from data_sources
    where id = ${smokeSourceId}
  `;
  assert.deepEqual(sourceRows, [
    {
      title: "PostgreSQL concurrency smoke source",
      verifiedAt: smokeNewestSourceVerifiedAt,
    },
  ]);
  const draftRows = await input.monitor<
    { publishedAudits: number; sourceVerifiedAudits: number; status: string }[]
  >`
    select
      draft.workflow_status as status,
      count(*) filter (
        where log.action = 'published' and log.draft_id = draft.id
      )::int as "publishedAudits",
      count(*) filter (
        where log.action = 'source_verified'
          and log.entity_type = 'data_source'
          and log.entity_key = ${smokeSourceId}
      )::int as "sourceVerifiedAudits"
    from data_governance_drafts draft
    left join data_change_logs log
      on log.entity_key = ${smokeSourceId}
    where draft.id = ${draft.id}
    group by draft.workflow_status
  `;
  assert.deepEqual(draftRows, [
    { publishedAudits: 0, sourceVerifiedAudits: 1, status: "reviewed" },
  ]);
}

async function verifyMissingSourceInsertRaceFailsClosed(input: {
  abortSignal: AbortSignal;
  locker: Sql;
  monitor: Sql;
  repository: ReturnType<typeof createGovernanceRepository>;
}): Promise<void> {
  const draft = await input.repository.createDraft({
    actor: smokeActor,
    changeReason: "Prepare the missing-source PostgreSQL race revision.",
    entityKey: smokeConcurrentSourceId,
    entityType: "data_source",
    payload: {
      demoNotice: null,
      id: smokeConcurrentSourceId,
      isDemo: false,
      publishedOn: null,
      publisher: null,
      sourceType: "other",
      title: "Draft source that must not overwrite a concurrent insert",
      url: null,
      verifiedAt: smokeDraftSourceVerifiedAt,
    },
  });
  await input.repository.reviewDraft({
    actor: smokeActor,
    draftId: draft.id,
    reason: "Review the missing-source PostgreSQL race revision.",
  });

  let publication: Promise<unknown> | undefined;
  try {
    await input.locker.begin(async (transaction) => {
      await transaction`
        insert into data_sources
          (id, title, source_type, verified_at, is_demo)
        values
          (${smokeConcurrentSourceId},
           'Source inserted concurrently with draft publication',
           'other', ${smokeInitialSourceVerifiedAt}, false)
      `;
      publication = input.repository.publishDraft({
        actor: smokeActor,
        draftId: draft.id,
        reason: "Attempt publication while the missing source is inserted.",
      });
      await waitForLockWaiters(input.monitor, input.abortSignal, 1);
    });
  } catch (error: unknown) {
    if (publication) {
      await Promise.allSettled([publication]);
    }
    throw error;
  }

  if (!publication) {
    throw new Error("Missing-source publication contender was not started.");
  }
  const publicationResult = await Promise.allSettled([publication]);
  assert.equal(publicationResult[0]?.status, "rejected");
  const rejection = publicationResult[0];
  if (rejection?.status !== "rejected") {
    throw new Error("The missing-source publication unexpectedly succeeded.");
  }
  assert.ok(rejection.reason instanceof GovernanceConflictError);
  assert.equal(
    rejection.reason.message,
    SOURCE_CONCURRENT_INSERT_CONFLICT_MESSAGE,
  );

  const sourceRows = await input.monitor<
    { title: string; verifiedAt: string }[]
  >`
    select
      title,
      to_char(
        verified_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) as "verifiedAt"
    from data_sources
    where id = ${smokeConcurrentSourceId}
  `;
  assert.deepEqual(sourceRows, [
    {
      title: "Source inserted concurrently with draft publication",
      verifiedAt: smokeInitialSourceVerifiedAt,
    },
  ]);
  const draftRows = await input.monitor<
    { publishedAudits: number; status: string }[]
  >`
    select
      draft.workflow_status as status,
      count(log.id) filter (where log.action = 'published')::int
        as "publishedAudits"
    from data_governance_drafts draft
    left join data_change_logs log on log.draft_id = draft.id
    where draft.id = ${draft.id}
    group by draft.workflow_status
  `;
  assert.deepEqual(draftRows, [{ publishedAudits: 0, status: "reviewed" }]);
}

function createDocumentReprocessingRequest(documentId: string): Request {
  const body = new FormData();
  body.set("reason", smokeReprocessingReason);
  body.set("sourceTitle", smokeReprocessingReplacementSourceTitle);
  const headers = new Headers();
  headers.set("oai-authenticated-user-email", smokeActor.email);
  headers.set(
    ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER,
    smokeActor.email,
  );
  headers.set(
    ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER,
    smokeActor.role,
  );

  return new Request(
    `http://localhost/api/admin/documents/${documentId}/reprocess`,
    { body, headers, method: "POST" },
  );
}

async function verifyDocumentReprocessingBarriers(input: {
  abortSignal: AbortSignal;
  locker: Sql;
  monitor: Sql;
  onDocumentCreated: (documentId: string) => void;
  onStoragePrepared: (input: {
    created: boolean;
    storagePath: string;
  }) => void;
  repository: ReturnType<typeof createGovernanceRepository>;
  routeApplicationName: string;
}): Promise<void> {
  const [{ prepareKnowledgeDocument }, { POST }] = await Promise.all([
    import("../../src/server/services/knowledge-service"),
    import(
      "../../src/app/api/admin/documents/[documentId]/reprocess/route"
    ),
  ]);
  const prepared = await prepareKnowledgeDocument({
    bytes: smokeReprocessingBytes,
    fileName: "postgres-reprocessing-smoke.md",
    metadata: {
      applicationScope: "non-road",
      canonicalUrl: "https://example.test/postgres-reprocessing-smoke",
      countryIso3: null,
      demoNotice: null,
      documentType: "government-notice",
      isDemo: false,
      jurisdictionId: null,
      languageCode: "en",
      licenseCode: "CC-BY-4.0",
      publishedOn: "2026-09-05",
      redistributionAllowed: true,
      sourcePublisher: "PostgreSQL concurrency smoke",
      sourceTitle: smokeReprocessingInitialSourceTitle,
      sourceType: "government-notice",
      sourceUrl: "https://example.test/postgres-reprocessing-source",
      title: smokeReprocessingDocumentTitle,
      validFrom: "2026-01-01",
      validTo: null,
    },
    mimeType: "text/markdown",
  });
  input.onStoragePrepared({
    created: prepared.storageCreated,
    storagePath: prepared.storagePath,
  });
  const uploaded = await input.repository.commitDocumentUpload({
    actor: smokeActor,
    changeReason: "Create the PostgreSQL reprocessing barrier fixture.",
    prepared,
  });
  input.onDocumentCreated(uploaded.documentId);
  const initialDraftId = uploaded.draft?.id;
  if (!initialDraftId) {
    throw new Error("Reprocessing barrier fixture draft was not created.");
  }

  const reprocess = () =>
    POST(createDocumentReprocessingRequest(uploaded.documentId), {
      params: Promise.resolve({ documentId: uploaded.documentId }),
    });
  let contenders: [Promise<Response>, Promise<Response>] | undefined;
  try {
    await input.locker.begin(async (transaction) => {
      await transaction`
        select id from data_governance_drafts
        where id = ${initialDraftId}
        for update
      `;
      contenders = [reprocess(), reprocess()];
      await waitForDocumentDraftLockWaiters(
        input.monitor,
        input.abortSignal,
        2,
        input.routeApplicationName,
      );
    });
  } catch (error: unknown) {
    if (contenders) {
      await Promise.allSettled(contenders);
    }
    throw error;
  }
  if (!contenders) {
    throw new Error("Reprocessing contenders were not started.");
  }
  const responses = await Promise.all(contenders);
  assert.deepEqual(
    responses.map(({ status }) => status),
    [200, 200],
  );
  assert.deepEqual(
    await Promise.all(responses.map((response) => response.json())),
    [{ status: "ready" }, { status: "ready" }],
  );

  const stateAfterRetry = await input.monitor<
    {
      activeDraftCount: number;
      activeDraftId: string;
      draftCount: number;
      markerCount: number;
      sourceCount: number;
      sourceId: string;
    }[]
  >`
    select
      count(distinct draft.id)::int as "draftCount",
      count(distinct draft.id) filter (
        where draft.archived_at is null
          and draft.workflow_status in ('draft', 'reviewed')
      )::int as "activeDraftCount",
      min(draft.id::text) filter (
        where draft.archived_at is null
          and draft.workflow_status in ('draft', 'reviewed')
      ) as "activeDraftId",
      count(distinct log.id) filter (
        where log.action = 'document_reprocessed'
      )::int as "markerCount",
      (
        select count(*)::int
        from data_sources source
        where source.title in (
          ${smokeReprocessingInitialSourceTitle},
          ${smokeReprocessingReplacementSourceTitle}
        )
      ) as "sourceCount",
      document.data_source_id::text as "sourceId"
    from documents document
    join data_governance_drafts draft
      on draft.entity_type = 'document'
     and draft.entity_key = document.id::text
    left join data_change_logs log
      on log.entity_type = 'document'
     and log.entity_key = document.id::text
    where document.id = ${uploaded.documentId}
    group by document.data_source_id
  `;
  assert.equal(stateAfterRetry.length, 1);
  assert.deepEqual(stateAfterRetry[0], {
    activeDraftCount: 1,
    activeDraftId: stateAfterRetry[0]?.activeDraftId,
    draftCount: 2,
    markerCount: 1,
    sourceCount: 2,
    sourceId: stateAfterRetry[0]?.sourceId,
  });
  const activeDraftId = stateAfterRetry[0]?.activeDraftId;
  const currentSourceId = stateAfterRetry[0]?.sourceId;
  if (!activeDraftId || !currentSourceId) {
    throw new Error("Reprocessing retry readback was incomplete.");
  }

  const [currentSourceTimestamps] = await input.monitor<
    { updatedAt: string; verifiedAt: string }[]
  >`
    select
      to_char(updated_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
      to_char(verified_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "verifiedAt"
    from data_sources
    where id = ${currentSourceId}
  `;
  if (!currentSourceTimestamps) {
    throw new Error("Reprocessing source timestamps were not returned.");
  }
  const driftedUpdatedAt = createSameMillisecondTimestampDrift(
    currentSourceTimestamps.updatedAt,
  );
  const driftedVerifiedAt = createSameMillisecondTimestampDrift(
    currentSourceTimestamps.verifiedAt,
  );

  let driftedReplay: Promise<Response> | undefined;
  try {
    await input.locker.begin(async (transaction) => {
      await transaction`
        select id from data_governance_drafts
        where id = ${activeDraftId}
        for update
      `;
      driftedReplay = reprocess();
      await waitForDocumentDraftLockWaiters(
        input.monitor,
        input.abortSignal,
        1,
        input.routeApplicationName,
      );
      await transaction`
        update data_sources
        set verified_at = ${driftedVerifiedAt}::timestamptz,
            updated_at = ${driftedUpdatedAt}::timestamptz
        where id = ${currentSourceId}
      `;
    });
  } catch (error: unknown) {
    if (driftedReplay) {
      await Promise.allSettled([driftedReplay]);
    }
    throw error;
  }
  if (!driftedReplay) {
    throw new Error("Drifted reprocessing replay was not started.");
  }
  const driftedResponse = await driftedReplay;
  assert.equal(driftedResponse.status, 409);
  const driftedBody: unknown = await driftedResponse.json();
  assert.deepEqual(
    typeof driftedBody === "object" && driftedBody !== null
      ? (driftedBody as { error?: { code?: unknown } }).error?.code
      : undefined,
    "CONFLICT",
  );
  assert.equal(JSON.stringify(driftedBody).includes(smokeActor.email), false);

  const stateAfterDrift = await input.monitor<
    { draftCount: number; markerCount: number; sourceCount: number }[]
  >`
    select
      (select count(*)::int from data_governance_drafts
       where entity_type = 'document'
         and entity_key = ${uploaded.documentId}) as "draftCount",
      (select count(*)::int from data_change_logs
       where entity_type = 'document'
         and entity_key = ${uploaded.documentId}
         and action = 'document_reprocessed') as "markerCount",
      (select count(*)::int from data_sources
       where title in (
         ${smokeReprocessingInitialSourceTitle},
         ${smokeReprocessingReplacementSourceTitle}
       )) as "sourceCount"
  `;
  assert.deepEqual(stateAfterDrift, [
    { draftCount: 2, markerCount: 1, sourceCount: 2 },
  ]);
}

async function verifyConcurrentArchive(input: {
  abortSignal: AbortSignal;
  locker: Sql;
  monitor: Sql;
  repository: ReturnType<typeof createGovernanceRepository>;
}): Promise<void> {
  const archive = () =>
    input.repository.archiveEntity({
      actor: smokeActor,
      entityKey: smokeCountryIso3,
      entityType: "country",
      reason: "Exercise PostgreSQL archive serialization.",
    });
  const results = await runContendersUnderLock(
    input.locker,
    input.monitor,
    input.abortSignal,
    "select iso3 from countries where iso3 = $1 for update",
    [smokeCountryIso3],
    () => [archive(), archive()],
  );
  assertOneConflict(results, /does not exist or is already archived/i);

  const rows = await input.monitor<
    { archiveLogs: number; archived: boolean }[]
  >`
    select
      country.archived_at is not null as archived,
      count(log.id)::int as "archiveLogs"
    from countries country
    left join data_change_logs log
      on log.entity_type = 'country'
     and log.entity_key = country.iso3
     and log.action = 'archived'
    where country.iso3 = ${smokeCountryIso3}
    group by country.archived_at
  `;
  assert.deepEqual(rows, [{ archiveLogs: 1, archived: true }]);
}

export async function runPostgresGovernanceConcurrencySmoke(
  environment: SmokeEnvironment = process.env,
): Promise<void> {
  const databaseUrl = validatePostgresConcurrencySmokeTarget(environment);
  const previousAdminRoleBindings = process.env.ADMIN_ROLE_BINDINGS_JSON;
  const previousKnowledgeStorageRoot = process.env.KNOWLEDGE_STORAGE_ROOT;
  process.env.ADMIN_ROLE_BINDINGS_JSON = JSON.stringify({
    [smokeActor.email]: smokeActor.role,
  });
  process.env.KNOWLEDGE_STORAGE_ROOT =
    "postgres-governance-concurrency-smoke";
  const { closeDatabaseConnection, databaseApplicationName } = await import(
    "../../src/server/db/client"
  );
  const repositoryClient = createSmokeClient(
    databaseUrl,
    repositoryApplicationName,
    4,
  );
  const locker = createSmokeClient(
    databaseUrl,
    `${repositoryApplicationName}-locker`,
    1,
  );
  const monitor = createSmokeClient(
    databaseUrl,
    `${repositoryApplicationName}-monitor`,
    1,
  );
  const repository = createGovernanceRepository(
    drizzle(repositoryClient, { schema }),
  );
  const abortController = new AbortController();
  let ownsSmokeFixtures = false;
  const reprocessingFixture: {
    documentId: string | null;
    storage: { created: boolean; storagePath: string } | null;
  } = { documentId: null, storage: null };
  let operationalClose: Promise<void> | undefined;
  const closeOperationalClients = () => {
    operationalClose ??= Promise.allSettled([
      closeDatabaseConnection(closeTimeoutSeconds),
      repositoryClient.end({ timeout: closeTimeoutSeconds }),
      locker.end({ timeout: closeTimeoutSeconds }),
    ]).then((results) => {
      const failed = results.find(({ status }) => status === "rejected");
      if (failed?.status === "rejected") {
        throw failed.reason;
      }
    });
    return operationalClose;
  };
  const deadline = setTimeout(() => {
    abortController.abort();
    void closeOperationalClients().catch(() => undefined);
  }, smokeDeadlineMs);

  let primaryError: unknown;
  try {
    await readAndValidateTarget(monitor);
    await assertNoSmokeFixtureCollisions(monitor);
    await createSmokeFixtures(monitor);
    ownsSmokeFixtures = true;
    await verifyConcurrentDraftCreation({
      abortSignal: abortController.signal,
      locker,
      monitor,
      repository,
    });
    await verifyConcurrentImportConfirmation({
      abortSignal: abortController.signal,
      locker,
      monitor,
      repository,
    });
    await verifyConcurrentSourceVerifiedAtMonotonicity({
      abortSignal: abortController.signal,
      locker,
      monitor,
      repository,
    });
    await verifyMissingSourceInsertRaceFailsClosed({
      abortSignal: abortController.signal,
      locker,
      monitor,
      repository,
    });
    await verifyDocumentReprocessingBarriers({
      abortSignal: abortController.signal,
      locker,
      monitor,
      onDocumentCreated(documentId) {
        reprocessingFixture.documentId = documentId;
      },
      onStoragePrepared(storage) {
        reprocessingFixture.storage = storage;
      },
      repository,
      routeApplicationName: databaseApplicationName,
    });
    await verifyConcurrentArchive({
      abortSignal: abortController.signal,
      locker,
      monitor,
      repository,
    });
    if (abortController.signal.aborted) {
      throw new Error("PostgreSQL concurrency smoke exceeded its 30s deadline.");
    }
  } catch (error: unknown) {
    if (abortController.signal.aborted) {
      primaryError = new Error(
        "PostgreSQL concurrency smoke exceeded its 30s deadline.",
        { cause: error },
      );
    } else {
      primaryError = normalizeError(error);
    }
  }

  clearTimeout(deadline);
  let operationalCloseError: unknown;
  let cleanupError: unknown;
  let monitorCloseError: unknown;
  try {
    await closeOperationalClients();
  } catch (error: unknown) {
    operationalCloseError = normalizeError(error);
  }
  if (ownsSmokeFixtures) {
    try {
      await cleanupOwnedSmokeFixtures({
        client: monitor,
        reprocessingDocumentId: reprocessingFixture.documentId,
      });
      if (reprocessingFixture.storage?.created) {
        const { removeDocumentFile } = await import(
          "../../src/server/knowledge/local-document-storage"
        );
        await removeDocumentFile(
          reprocessingFixture.storage.storagePath,
        );
      }
    } catch (error: unknown) {
      cleanupError = normalizeError(error);
    }
  }
  try {
    await monitor.end({ timeout: closeTimeoutSeconds });
  } catch (error: unknown) {
    monitorCloseError = normalizeError(error);
  }

  if (previousAdminRoleBindings === undefined) {
    delete process.env.ADMIN_ROLE_BINDINGS_JSON;
  } else {
    process.env.ADMIN_ROLE_BINDINGS_JSON = previousAdminRoleBindings;
  }
  if (previousKnowledgeStorageRoot === undefined) {
    delete process.env.KNOWLEDGE_STORAGE_ROOT;
  } else {
    process.env.KNOWLEDGE_STORAGE_ROOT = previousKnowledgeStorageRoot;
  }

  const composedError = composePostgresConcurrencySmokeError({
    cleanupError,
    monitorCloseError,
    operationalCloseError,
    primaryError,
  });
  if (composedError !== null) {
    throw composedError;
  }
}

async function main(): Promise<void> {
  await runPostgresGovernanceConcurrencySmoke();
  process.stdout.write(
    `PostgreSQL governance concurrency smoke passed (${postgresGovernanceConcurrencySmokeScenarioNames.length} scenarios).\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `PostgreSQL governance concurrency smoke failed: ${message}\n`,
    );
    process.exitCode = 1;
  });
}
