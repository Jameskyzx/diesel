import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  apiRateLimitBuckets,
  aiChatSessions,
  aiCitations,
  aiToolCalls,
  countries,
  countryJurisdictions,
  dataChangeLogs,
  dataGovernanceDrafts,
  dataSources,
  documentChunks,
  documents,
  jurisdictions,
  marketImportBatches,
  marketMetrics,
  productCertifications,
  products,
  regulationLimits,
  regulations,
} from "@/server/db/schema";
import { seedDemoData } from "@/server/db/seed/demo-data";
import {
  createLocalHashEmbedding,
  KNOWLEDGE_EMBEDDING_MODEL,
} from "@/domain/knowledge/embedding";
import { demoIds } from "@/server/db/seed/demo-data";
import { createCountryRepository } from "@/server/repositories/country-repository";
import { createProductRepository } from "@/server/repositories/product-repository";
import { createRegulationRepository } from "@/server/repositories/regulation-repository";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import {
  createAiAuditRepository,
  type AiToolCallAuditInput,
} from "@/server/repositories/ai-audit-repository";
import { createMarketRepository } from "@/server/repositories/market-repository";
import { createGovernanceRepository } from "@/server/repositories/governance-repository";
import { createRateLimitRepository } from "@/server/repositories/rate-limit-repository";
import { createPostgresRateLimiter } from "@/server/http/rate-limit";
import { getGovernanceDashboardFromRepository } from "@/server/services/governance-service";
import { createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
}, 30_000);

afterAll(async () => {
  await testDatabase.client.close();
});

describe("database migration and demo seed", () => {
  it("creates all required tables from an empty database", async () => {
    const result = await testDatabase.client.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
       order by table_name`,
    );

    expect(result.rows.map(({ table_name }) => table_name)).toEqual([
      "ai_chat_sessions",
      "ai_citations",
      "ai_tool_calls",
      "api_rate_limit_buckets",
      "countries",
      "country_jurisdictions",
      "data_change_logs",
      "data_governance_drafts",
      "data_sources",
      "document_chunks",
      "documents",
      "jurisdictions",
      "market_import_batches",
      "market_metrics",
      "product_certifications",
      "products",
      "regulation_limits",
      "regulations",
    ]);
  });

  it("shares hashed rate-limit buckets across limiter instances and expires old windows", async () => {
    const scope = "integration-ai-chat";
    const rawClientIdentifier = "203.0.113.77";
    const requestLimit = 5;
    const windowMs = 60_000;
    const firstWindow = 1_700_000_040_000;
    const firstLimiter = createPostgresRateLimiter({
      limit: requestLimit,
      repository: createRateLimitRepository(testDatabase.database),
      scope,
      windowMs,
    });
    const secondLimiter = createPostgresRateLimiter({
      limit: requestLimit,
      repository: createRateLimitRepository(testDatabase.database),
      scope,
      windowMs,
    });

    await testDatabase.database
      .delete(apiRateLimitBuckets)
      .where(eq(apiRateLimitBuckets.scope, scope));

    try {
      const decisions = await Promise.all(
        Array.from({ length: requestLimit + 7 }, (_, index) =>
          (index % 2 === 0 ? firstLimiter : secondLimiter).check(
            rawClientIdentifier,
            firstWindow + index,
          ),
        ),
      );
      expect(decisions.filter(({ allowed }) => allowed)).toHaveLength(
        requestLimit,
      );
      expect(decisions.filter(({ allowed }) => !allowed)).toHaveLength(7);

      const [sharedBucket] = await testDatabase.database
        .select()
        .from(apiRateLimitBuckets)
        .where(eq(apiRateLimitBuckets.scope, scope));
      expect(sharedBucket).toMatchObject({
        requestCount: requestLimit + 1,
        scope,
      });
      expect(sharedBucket?.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(sharedBucket?.keyHash).not.toContain(rawClientIdentifier);

      expect(
        (await secondLimiter.check(rawClientIdentifier, firstWindow + windowMs))
          .allowed,
      ).toBe(true);
      const currentBuckets = await testDatabase.database
        .select()
        .from(apiRateLimitBuckets)
        .where(eq(apiRateLimitBuckets.scope, scope));
      expect(currentBuckets).toHaveLength(1);
      expect(currentBuckets[0]?.requestCount).toBe(1);
    } finally {
      await testDatabase.database
        .delete(apiRateLimitBuckets)
        .where(eq(apiRateLimitBuckets.scope, scope));
    }
  });

  it("enforces one global-scope market observation per natural key", async () => {
    await seedDemoData(testDatabase.database);
    const baseObservation = {
      applicationScope: null,
      countryIso3: "CHN",
      dataSourceId: demoIds.source.market,
      definition: "DEMO ONLY — global-scope uniqueness test.",
      isDemo: true,
      methodologyVersion: "test-v1",
      metricCode: "DEMO_GLOBAL_SCOPE_UNIQUENESS",
      metricName: "DEMO ONLY — Global scope uniqueness",
      periodEnd: "2026-01-01",
      periodStart: "2025-01-01",
      unitCode: "units",
      valueNumeric: "1.000000",
      verifiedAt: new Date("2026-07-29T00:00:00.000Z"),
    } as const;

    await testDatabase.database.insert(marketMetrics).values({
      ...baseObservation,
      id: "10000000-0000-4000-8000-000000000905",
    });
    try {
      await expect(
        testDatabase.database.insert(marketMetrics).values({
          ...baseObservation,
          id: "10000000-0000-4000-8000-000000000906",
          valueNumeric: "2.000000",
        }),
      ).rejects.toThrow();
    } finally {
      await testDatabase.database
        .delete(marketMetrics)
        .where(eq(marketMetrics.metricCode, baseObservation.metricCode));
    }
  });

  it("keeps jurisdiction type and country ownership consistent", async () => {
    await seedDemoData(testDatabase.database);
    const countryJurisdictionId = "10000000-0000-4000-8000-000000000907";

    await testDatabase.database.insert(jurisdictions).values({
      code: "TEST-COUNTRY-TYPE-CHECK",
      countryIso3: "CHN",
      dataSourceId: demoIds.source.country,
      id: countryJurisdictionId,
      isDemo: true,
      name: "DEMO ONLY - Country jurisdiction type check",
      type: "country",
      verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
    });

    try {
      await expect(
        testDatabase.database.insert(jurisdictions).values({
          code: "TEST-REGIONAL-TYPE-CHECK",
          countryIso3: "CHN",
          dataSourceId: demoIds.source.country,
          id: "10000000-0000-4000-8000-000000000908",
          isDemo: true,
          name: "DEMO ONLY - Regional jurisdiction type check",
          type: "regional",
          verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
        }),
      ).rejects.toThrow();
      await expect(
        testDatabase.database.insert(jurisdictions).values({
          code: "TEST-COUNTRY-WITHOUT-ISO3-CHECK",
          countryIso3: null,
          dataSourceId: demoIds.source.country,
          id: "10000000-0000-4000-8000-000000000909",
          isDemo: true,
          name: "DEMO ONLY - Country jurisdiction without ISO3 check",
          type: "country",
          verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
        }),
      ).rejects.toThrow();
    } finally {
      await testDatabase.database
        .delete(jurisdictions)
        .where(eq(jurisdictions.id, countryJurisdictionId));
    }
  });

  it("keeps country coverage status and demo classification consistent", async () => {
    await seedDemoData(testDatabase.database);

    await testDatabase.database.insert(countries).values({
      dataCoverageStatus: "none",
      dataSourceId: demoIds.source.countryDirectory,
      isDemo: false,
      iso2: "ZQ",
      iso3: "ZQA",
      nameEn: "Coverage status check country",
      verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
    });

    try {
      await expect(
        testDatabase.database.insert(countries).values({
          dataCoverageStatus: "unknown-status",
          dataSourceId: demoIds.source.countryDirectory,
          isDemo: false,
          iso2: "ZR",
          iso3: "ZQB",
          nameEn: "Unknown coverage status check country",
          verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
        }),
      ).rejects.toThrow();
      await expect(
        testDatabase.database.insert(countries).values({
          dataCoverageStatus: "demo",
          dataSourceId: demoIds.source.country,
          isDemo: false,
          iso2: "ZS",
          iso3: "ZQC",
          nameEn: "Demo status without classification check country",
          verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
        }),
      ).rejects.toThrow();
      await expect(
        testDatabase.database.insert(countries).values({
          dataCoverageStatus: "planned",
          dataSourceId: demoIds.source.country,
          isDemo: true,
          iso2: "ZT",
          iso3: "ZQD",
          nameEn: "Demo classification without status check country",
          verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
        }),
      ).rejects.toThrow();
    } finally {
      await testDatabase.database
        .delete(countries)
        .where(eq(countries.iso3, "ZQA"));
    }
  });

  it("keeps source type and demo classification consistent", async () => {
    const verifiedAt = new Date("2026-08-06T00:00:00.000Z");

    await testDatabase.database.insert(dataSources).values({
      id: "10000000-0000-4000-8000-000000000910",
      isDemo: false,
      sourceType: "other",
      title: "Source classification check",
      verifiedAt,
    });

    try {
      await expect(
        testDatabase.database.insert(dataSources).values({
          id: "10000000-0000-4000-8000-000000000911",
          isDemo: false,
          sourceType: "demo",
          title: "Demo type without classification",
          verifiedAt,
        }),
      ).rejects.toThrow();
      await expect(
        testDatabase.database.insert(dataSources).values({
          demoNotice: "DEMO ONLY — classification mismatch.",
          id: "10000000-0000-4000-8000-000000000912",
          isDemo: true,
          sourceType: "other",
          title: "Demo classification without type",
          verifiedAt,
        }),
      ).rejects.toThrow();
    } finally {
      await testDatabase.database
        .delete(dataSources)
        .where(eq(dataSources.id, "10000000-0000-4000-8000-000000000910"));
    }
  });

  it("persists minimized AI tool-call audits and traceable citations", async () => {
    await seedDemoData(testDatabase.database);
    const repository = createAiAuditRepository(testDatabase.database);
    const sessionId = "00000000-0000-4000-8000-000000000901";

    await repository.ensureSession({
      modelId: "mock/test-model",
      selectedCountryIso3: "CHN",
      sessionId,
    });
    const firstAudit = {
      citations: [
        {
          chunkId: demoIds.documentChunk.regulation,
          countryIso3: "CHN",
          documentId: demoIds.document.regulation,
          documentTitle: "DEMO regulation evidence",
          isDemo: true,
          locator: "Demo section 1",
          pageFrom: null,
          pageTo: null,
          productCertificationId: null,
          publishedOn: "2026-01-02",
          regulationId: demoIds.regulation.chinaEffective,
          regulationStatus: "effective",
          sectionLocator: "Demo section 1",
          sourceId: demoIds.source.regulation,
          sourceTitle: "DEMO ONLY source",
          sourceUrl: "https://example.invalid/demo/regulations",
          title: "DEMO ONLY regulation",
          verifiedAt: "2026-01-15T00:00:00.000Z",
        },
      ],
      completedAt: new Date("2026-01-15T00:00:00.025Z"),
      durationMs: 25,
      errorCode: null,
      input: { countryIso3: "CHN" },
      resultSummary: {
        citationCount: 1,
        evidenceSufficient: true,
      },
      sessionId,
      startedAt: new Date("2026-01-15T00:00:00.000Z"),
      status: "success",
      toolCallId: "turn-1:provider-tool-call",
      toolName: "generateSalesBrief",
    } satisfies AiToolCallAuditInput;
    await repository.recordToolCall(firstAudit);
    await repository.recordToolCall({
      ...firstAudit,
      completedAt: new Date("2026-01-15T00:00:01.025Z"),
      startedAt: new Date("2026-01-15T00:00:01.000Z"),
      toolCallId: "turn-2:provider-tool-call",
    });

    await expect(repository.recordToolCall(firstAudit)).rejects.toThrow();

    const [session] = await testDatabase.database
      .select()
      .from(aiChatSessions)
      .where(eq(aiChatSessions.id, sessionId));
    const toolCalls = await testDatabase.database
      .select()
      .from(aiToolCalls)
      .where(eq(aiToolCalls.sessionId, sessionId));
    const citations = await testDatabase.database
      .select()
      .from(aiCitations)
      .where(eq(aiCitations.sessionId, sessionId));

    expect(session).toMatchObject({
      modelId: "mock/test-model",
      selectedCountryIso3: "CHN",
    });
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map(({ toolCallId }) => toolCallId).sort()).toEqual([
      "turn-1:provider-tool-call",
      "turn-2:provider-tool-call",
    ]);
    expect(
      toolCalls.every(
        ({ status, toolName }) =>
          status === "success" && toolName === "generateSalesBrief",
      ),
    ).toBe(true);
    expect(citations).toHaveLength(2);
    expect(
      citations.every(
        ({ chunkId, regulationStatus, sourceId }) =>
          chunkId === demoIds.documentChunk.regulation &&
          regulationStatus === "effective" &&
          sourceId === demoIds.source.regulation,
      ),
    ).toBe(true);
  });

  it("installs pgvector and adds processing, full-text, and embedding fields", async () => {
    const extensions = await testDatabase.client.query<{ extname: string }>(
      "select extname from pg_extension where extname = 'vector'",
    );
    const columns = await testDatabase.client.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_name = 'document_chunks'
       order by column_name`,
    );

    expect(extensions.rows).toEqual([{ extname: "vector" }]);
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual(
      expect.arrayContaining([
        "embedding",
        "embedding_model",
        "search_vector",
      ]),
    );
  });

  it("can apply the demo seed repeatedly without creating duplicates", async () => {
    await seedDemoData(testDatabase.database);
    await seedDemoData(testDatabase.database);

    const tables = [
      countries,
      countryJurisdictions,
      dataSources,
      documentChunks,
      documents,
      jurisdictions,
      marketMetrics,
      productCertifications,
      products,
      regulationLimits,
      regulations,
    ] as const;

    const counts = await Promise.all(
      tables.map(async (table) => {
        const [row] = await testDatabase.database
          .select({ count: sql<number>`count(*)::int` })
          .from(table);
        return row?.count ?? 0;
      }),
    );

    expect(counts).toEqual([178, 2, 6, 2, 2, 2, 2, 1, 2, 6, 5]);
  });
});

describe("repositories", () => {
  beforeAll(async () => {
    await seedDemoData(testDatabase.database);
  });

  it("loads a published review baseline even when it falls outside the 100-row dashboard window", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const createdBy = "dashboard-baseline-test@example.test";
    const baselineId = "30000000-0000-4000-8000-000000000800";
    const targetId = "30000000-0000-4000-8000-000000000801";
    const entityKey = "QZZ";
    const basePayload = {
      dataCoverageStatus: "demo",
      dataSourceId: demoIds.source.country,
      isDemo: true,
      iso2: "QZ",
      iso3: entityKey,
      nameEn: "DEMO ONLY — Dashboard baseline v1",
      nameLocal: null,
      regionCode: "DEMO",
      subregionCode: "DEMO",
      verifiedAt: "2026-07-29T00:00:00.000Z",
    };

    await testDatabase.database.insert(countries).values({
      dataCoverageStatus: "demo",
      dataSourceId: demoIds.source.country,
      isDemo: true,
      iso2: "QZ",
      iso3: entityKey,
      nameEn: basePayload.nameEn,
      regionCode: "DEMO",
      subregionCode: "DEMO",
      verifiedAt: new Date(basePayload.verifiedAt),
    });
    await testDatabase.database.insert(dataGovernanceDrafts).values([
      {
        changeReason: "Historical published baseline.",
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
        createdBy,
        entityKey,
        entityType: "country",
        id: baselineId,
        payload: basePayload,
        publishedAt: new Date("2020-01-02T00:00:00.000Z"),
        publishedBy: "reviewer@example.test",
        reviewedAt: new Date("2020-01-01T12:00:00.000Z"),
        reviewedBy: "reviewer@example.test",
        updatedAt: new Date("2020-01-02T00:00:00.000Z"),
        version: 1,
        workflowStatus: "published",
      },
      ...Array.from({ length: 100 }, (_, index) => {
        const id = `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        return {
          changeReason: "Fill the dashboard history window.",
          createdAt: new Date(Date.UTC(2099, 0, 1, 0, 0, index)),
          createdBy,
          entityKey: id,
          entityType: "data_source" as const,
          id,
          payload: { id },
          updatedAt: new Date(Date.UTC(2099, 0, 1, 0, 0, index)),
          version: 1,
          workflowStatus: "draft" as const,
        };
      }),
      {
        changeReason: "Review a revision whose baseline is outside the window.",
        createdAt: new Date("2100-01-01T00:00:00.000Z"),
        createdBy,
        entityKey,
        entityType: "country",
        id: targetId,
        payload: {
          ...basePayload,
          nameEn: "DEMO ONLY — Dashboard baseline v2",
        },
        reviewedAt: new Date("2100-01-01T00:00:00.000Z"),
        reviewedBy: "reviewer@example.test",
        updatedAt: new Date("2100-01-01T00:00:00.000Z"),
        version: 2,
        workflowStatus: "reviewed",
      },
    ]);

    try {
      const dashboard = await getGovernanceDashboardFromRepository(
        governanceRepository,
      );
      const target = dashboard.drafts.find(({ id }) => id === targetId);

      expect(dashboard.drafts).toHaveLength(100);
      expect(
        dashboard.drafts.some(({ id }) => id === baselineId),
      ).toBe(false);
      expect(target?.reviewContext).toMatchObject({
        baselineStatus: "active",
        blockingReasons: [],
        publishedBaseline: { id: baselineId, version: 1 },
        publishReady: true,
      });
    } finally {
      await testDatabase.database
        .delete(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.createdBy, createdBy));
      await testDatabase.database
        .delete(countries)
        .where(eq(countries.iso3, entityKey));
    }
  });

  it("rejects v2 when the formal root entity source is archived", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "root-source-editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "root-source-reviewer@example.test",
      role: "reviewer" as const,
    };
    const sourceId = "30000000-0000-4000-8000-000000000810";
    const entityKey = "QZX";
    const payload = {
      dataCoverageStatus: "demo" as const,
      dataSourceId: sourceId,
      isDemo: true,
      iso2: "QY",
      iso3: entityKey,
      nameEn: "DEMO ONLY — Active-root source baseline",
      nameLocal: null,
      regionCode: "DEMO",
      subregionCode: "DEMO",
      verifiedAt: "2026-07-29T00:00:00.000Z",
    };

    await testDatabase.database.insert(dataSources).values({
      demoNotice: "DEMO ONLY — root source archival test.",
      id: sourceId,
      isDemo: true,
      sourceType: "demo",
      title: "DEMO ONLY — Root source archival test",
      verifiedAt: new Date(payload.verifiedAt),
    });

    try {
      const baseline = await governanceRepository.createDraft({
        actor: editor,
        changeReason: "Create the published baseline before source archival.",
        entityKey,
        entityType: "country",
        payload,
      });
      await governanceRepository.reviewDraft({
        actor: reviewer,
        draftId: baseline.id,
        reason: "Review the root-source baseline.",
      });
      await governanceRepository.publishDraft({
        actor: reviewer,
        draftId: baseline.id,
        reason: "Publish the root-source baseline.",
      });
      const revision = await governanceRepository.createDraft({
        actor: editor,
        changeReason: "Create v2 before the parent source is archived.",
        entityKey,
        entityType: "country",
        payload: {
          ...payload,
          nameEn: "DEMO ONLY — Must remain unpublished",
        },
      });
      await governanceRepository.reviewDraft({
        actor: reviewer,
        draftId: revision.id,
        reason: "Review v2 before simulating legacy source archival.",
      });
      await testDatabase.database
        .update(dataSources)
        .set({ archivedAt: new Date("2026-08-15T01:00:00.000Z") })
        .where(eq(dataSources.id, sourceId));

      await expect(
        governanceRepository.publishDraft({
          actor: reviewer,
          draftId: revision.id,
          reason: "Attempt a direct publish with an archived parent source.",
        }),
      ).rejects.toThrow("requires an active formal entity");

      const [storedCountry] = await testDatabase.database
        .select({ nameEn: countries.nameEn })
        .from(countries)
        .where(eq(countries.iso3, entityKey));
      const [storedRevision] = await testDatabase.database
        .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
        .from(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.id, revision.id));
      expect(storedCountry?.nameEn).toBe(payload.nameEn);
      expect(storedRevision?.workflowStatus).toBe("reviewed");
    } finally {
      await testDatabase.database
        .delete(dataChangeLogs)
        .where(eq(dataChangeLogs.entityKey, entityKey));
      await testDatabase.database
        .delete(dataGovernanceDrafts)
        .where(
          and(
            eq(dataGovernanceDrafts.entityType, "country"),
            eq(dataGovernanceDrafts.entityKey, entityKey),
          ),
        );
      await testDatabase.database
        .delete(countries)
        .where(eq(countries.iso3, entityKey));
      await testDatabase.database
        .delete(dataSources)
        .where(eq(dataSources.id, sourceId));
    }
  });

  it("finds a country by normalized ISO3 and returns its source", async () => {
    const repository = createCountryRepository(testDatabase.database);

    const country = await repository.findByIso3({ iso3: " chn " });

    expect(country).toMatchObject({
      dataCoverageStatus: "demo",
      isDemo: true,
      iso3: "CHN",
      source: {
        isDemo: true,
      },
    });
    expect(country?.source.title).toContain("DEMO ONLY");
  });

  it("rejects invalid external country input", async () => {
    const repository = createCountryRepository(testDatabase.database);

    await expect(repository.findByIso3({ iso3: "12" })).rejects.toThrow();
  });

  it("lists the full country catalog with demo, planned and no-data tiers", async () => {
    const repository = createCountryRepository(testDatabase.database);

    const summaries = await repository.listMapSummaries();
    const china = await repository.findDetailsByIso3({
      asOf: "2026-07-29",
      iso3: "CHN",
    });
    const iso3sForStatus = (status: string) =>
      summaries
        .filter((summary) => summary.dataCoverageStatus === status)
        .map(({ iso3 }) => iso3)
        .sort();

    expect(summaries).toHaveLength(178);
    expect(iso3sForStatus("demo")).toEqual(["BRA", "CHN", "DEU"]);
    expect(iso3sForStatus("planned")).toHaveLength(26);
    expect(iso3sForStatus("no_data")).toHaveLength(149);
    expect(china?.jurisdictions).toHaveLength(1);
    expect(china?.jurisdictions[0]?.source.title).toContain("DEMO ONLY");
    expect(china?.jurisdictions[0]?.membershipSource.title).toContain(
      "DEMO ONLY",
    );
    expect(china?.regulations).toHaveLength(4);
    expect(china?.regulations[0]?.applicability).toMatchObject({
      countryIso3: "CHN",
      jurisdictionCode: "DEMO-CHN-AUTHORITY",
      membershipValidFrom: "2000-01-01",
      membershipValidTo: null,
    });
    expect(china?.marketMetrics).toHaveLength(1);
    expect(china?.regulations.every(({ isDemo }) => isDemo)).toBe(true);
  });

  it("fails closed when a country fact references a Demo source", async () => {
    const repository = createCountryRepository(testDatabase.database);

    await testDatabase.database
      .update(countries)
      .set({ dataSourceId: demoIds.source.country })
      .where(eq(countries.iso3, "FJI"));

    try {
      const summaries = await repository.listMapSummaries();
      const fijiSummary = summaries.find(({ iso3 }) => iso3 === "FJI");
      const fijiDetails = await repository.findByIso3({ iso3: "FJI" });

      expect(fijiSummary?.isDemo).toBe(true);
      expect(fijiDetails).toMatchObject({
        isDemo: false,
        source: { isDemo: true },
      });
    } finally {
      await testDatabase.database
        .update(countries)
        .set({ dataSourceId: demoIds.source.countryDirectory })
        .where(eq(countries.iso3, "FJI"));
    }
  });

  it("seeds catalog countries as explicit planned or no-data directory rows", async () => {
    const repository = createCountryRepository(testDatabase.database);

    const usa = await repository.findByIso3({ iso3: "USA" });
    const fiji = await repository.findByIso3({ iso3: "FJI" });

    expect(usa).toMatchObject({
      dataCoverageStatus: "planned",
      isDemo: false,
      iso2: "US",
      iso3: "USA",
      regionCode: "AMERICAS",
      subregionCode: "NORTHERN_AMERICA",
    });
    expect(usa?.source.isDemo).toBe(false);
    expect(usa?.source.title).toContain("Natural Earth");
    expect(fiji).toMatchObject({
      dataCoverageStatus: "no_data",
      isDemo: false,
      iso3: "FJI",
    });
  });

  it("filters country detail jurisdictions and regulations by membership validity", async () => {
    const repository = createCountryRepository(testDatabase.database);
    const jurisdictionId = "10000000-0000-4000-8000-000000000801";
    const regulationId = "10000000-0000-4000-8000-000000000802";
    const verifiedAt = new Date("2026-07-29T00:00:00.000Z");

    await testDatabase.database.insert(jurisdictions).values({
      code: "DEMO-EXPIRED-MEMBERSHIP",
      countryIso3: null,
      dataSourceId: demoIds.source.regulation,
      id: jurisdictionId,
      isDemo: true,
      name: "DEMO ONLY — Expired membership jurisdiction",
      type: "regional",
      verifiedAt,
      websiteUrl: "https://example.invalid/demo/expired-membership",
    });
    await testDatabase.database.insert(countryJurisdictions).values({
      countryIso3: "CHN",
      dataSourceId: demoIds.source.regulation,
      isDemo: true,
      jurisdictionId,
      validFrom: "2000-01-01",
      validTo: "2010-01-01",
      verifiedAt,
    });
    await testDatabase.database.insert(regulations).values({
      canonicalName: "DEMO ONLY — Expired membership regulation",
      citationCode: "DEMO-EXPIRED-MEMBERSHIP-REG",
      dataSourceId: demoIds.source.regulation,
      effectiveFrom: "2005-01-01",
      id: regulationId,
      isDemo: true,
      jurisdictionId,
      status: "effective",
      verifiedAt,
    });

    const historical = await repository.findDetailsByIso3({
      asOf: "2009-12-31",
      iso3: "CHN",
    });
    const current = await repository.findDetailsByIso3({
      asOf: "2026-07-29",
      iso3: "CHN",
    });

    expect(
      historical?.jurisdictions.some(({ id }) => id === jurisdictionId),
    ).toBe(true);
    expect(historical?.regulations.some(({ id }) => id === regulationId)).toBe(
      true,
    );
    expect(current?.jurisdictions.some(({ id }) => id === jurisdictionId)).toBe(
      false,
    );
    expect(current?.regulations.some(({ id }) => id === regulationId)).toBe(
      false,
    );
  });

  it("accepts the on-road-truck and on-road-bus migration values", async () => {
    const baseMetric = {
      countryIso3: "CHN",
      dataSourceId: demoIds.source.market,
      definition: "TEST ONLY — scope migration check.",
      isDemo: true,
      methodologyVersion: "test-v1",
      metricName: "TEST ONLY — scope migration",
      periodEnd: "2026-01-01",
      periodStart: "2025-01-01",
      unitCode: "units",
      valueNumeric: "1",
      verifiedAt: new Date("2026-01-15T00:00:00.000Z"),
    };

    const [truckMetric] = await testDatabase.database
      .insert(marketMetrics)
      .values({
        ...baseMetric,
        applicationScope: "on-road-truck",
        metricCode: "TEST_SCOPE_MIGRATION_TRUCK",
      })
      .returning({ applicationScope: marketMetrics.applicationScope });
    const [busMetric] = await testDatabase.database
      .insert(marketMetrics)
      .values({
        ...baseMetric,
        applicationScope: "on-road-bus",
        metricCode: "TEST_SCOPE_MIGRATION_BUS",
      })
      .returning({ applicationScope: marketMetrics.applicationScope });

    expect(truckMetric?.applicationScope).toBe("on-road-truck");
    expect(busMetric?.applicationScope).toBe("on-road-bus");
  });

  it("reads back the strict product power constraint after migrations", async () => {
    const result = await testDatabase.client.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition
       from pg_constraint
       where conname = 'products_power_check'`,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.definition.replaceAll('"', "")).toContain(
      "power_max_kw > power_min_kw",
    );
  });

  it("returns only effective regulations for the requested date and power", async () => {
    const repository = createRegulationRepository(testDatabase.database);

    const rows = await repository.findEffectiveByCountry({
      applicationScope: "non-road",
      asOf: "2026-07-29",
      countryIso3: "CHN",
      powerKw: 100,
    });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(({ regulationId }) => regulationId)).size).toBe(1);
    expect(rows.every(({ status }) => status === "effective")).toBe(true);
    expect(rows.every(({ isDemo }) => isDemo)).toBe(true);
    expect(rows.every(({ source }) => source.title.includes("DEMO ONLY"))).toBe(
      true,
    );

    const upperBoundaryRows = await repository.findEffectiveByCountry({
      applicationScope: "non-road",
      asOf: "2026-07-29",
      countryIso3: "CHN",
      powerKw: 560,
    });
    expect(upperBoundaryRows).toEqual([]);
  });

  it("returns a now-superseded regulation when it covered the historical date", async () => {
    const repository = createRegulationRepository(testDatabase.database);

    const rows = await repository.findEffectiveByCountry({
      applicationScope: "non-road",
      asOf: "2024-12-31",
      countryIso3: "CHN",
      powerKw: 100,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      citationCode: "DEMO-CHN-NR-Z",
      status: "superseded",
    });
  });

  it("fails closed when a superseded record has no closing date", async () => {
    const repository = createRegulationRepository(testDatabase.database);
    await testDatabase.database
      .update(regulations)
      .set({ effectiveTo: null })
      .where(eq(regulations.id, demoIds.regulation.chinaSuperseded));

    try {
      const rows = await repository.findEffectiveByCountry({
        applicationScope: "non-road",
        asOf: "2024-12-31",
        countryIso3: "CHN",
        powerKw: 100,
      });

      expect(
        rows.some(
          ({ regulationId }) =>
            regulationId === demoIds.regulation.chinaSuperseded,
        ),
      ).toBe(false);
    } finally {
      await testDatabase.database
        .update(regulations)
        .set({ effectiveTo: "2025-01-01" })
        .where(eq(regulations.id, demoIds.regulation.chinaSuperseded));
    }
  });

  it("excludes regulation limits whose evidence source is archived", async () => {
    const repository = createRegulationRepository(testDatabase.database);
    const archivedSourceId = "10000000-0000-4000-8000-000000000902";
    await testDatabase.database.insert(dataSources).values({
      archivedAt: new Date("2026-07-29T00:00:00.000Z"),
      demoNotice: "DEMO ONLY — archived limit-source filter test.",
      id: archivedSourceId,
      isDemo: true,
      sourceType: "demo",
      title: "DEMO ONLY — Archived limit source",
      verifiedAt: new Date("2026-07-29T00:00:00.000Z"),
    });
    await testDatabase.database
      .update(regulationLimits)
      .set({ dataSourceId: archivedSourceId })
      .where(eq(regulationLimits.id, demoIds.limit.chinaEffectiveNox));

    try {
      const rows = await repository.findEffectiveByCountry({
        applicationScope: "non-road",
        asOf: "2026-07-29",
        countryIso3: "CHN",
        powerKw: 100,
      });

      expect(rows.map(({ limit }) => limit.id)).not.toContain(
        demoIds.limit.chinaEffectiveNox,
      );
    } finally {
      await testDatabase.database
        .update(regulationLimits)
        .set({ dataSourceId: demoIds.source.regulation })
        .where(eq(regulationLimits.id, demoIds.limit.chinaEffectiveNox));
    }
  });

  it("excludes regulations when their owning jurisdiction is archived", async () => {
    const countryRepository = createCountryRepository(testDatabase.database);
    const regulationRepository = createRegulationRepository(
      testDatabase.database,
    );
    await testDatabase.database
      .update(jurisdictions)
      .set({ archivedAt: new Date("2026-07-29T00:00:00.000Z") })
      .where(eq(jurisdictions.id, demoIds.jurisdiction.china));

    try {
      const [country, regulationsForFit, regulationsForComparison] =
        await Promise.all([
          countryRepository.findDetailsByIso3({
            asOf: "2026-07-29",
            iso3: "CHN",
          }),
          regulationRepository.findEffectiveByCountry({
            applicationScope: "non-road",
            asOf: "2026-07-29",
            countryIso3: "CHN",
            powerKw: 100,
          }),
          regulationRepository.findForComparison({
            applicationScope: "non-road",
            asOf: "2026-07-29",
            countryIso3s: ["CHN", "BRA"],
            powerKw: 100,
          }),
        ]);

      expect(country?.jurisdictions).toEqual([]);
      expect(country?.regulations).toEqual([]);
      expect(regulationsForFit).toEqual([]);
      expect(
        regulationsForComparison.filter(
          ({ countryIso3 }) => countryIso3 === "CHN",
        ),
      ).toEqual([]);
    } finally {
      await testDatabase.database
        .update(jurisdictions)
        .set({ archivedAt: null })
        .where(eq(jurisdictions.id, demoIds.jurisdiction.china));
    }
  });

  it("excludes regulations when jurisdiction membership evidence is archived", async () => {
    const countryRepository = createCountryRepository(testDatabase.database);
    const regulationRepository = createRegulationRepository(
      testDatabase.database,
    );
    const archivedSourceId = "10000000-0000-4000-8000-000000000903";
    await testDatabase.database.insert(dataSources).values({
      archivedAt: new Date("2026-07-29T00:00:00.000Z"),
      demoNotice: "DEMO ONLY — archived applicability-source filter test.",
      id: archivedSourceId,
      isDemo: true,
      sourceType: "demo",
      title: "DEMO ONLY — Archived applicability source",
      verifiedAt: new Date("2026-07-29T00:00:00.000Z"),
    });

    const assertChinaRegulationsHidden = async () => {
      const [country, regulationsForFit] = await Promise.all([
        countryRepository.findDetailsByIso3({
          asOf: "2026-07-29",
          iso3: "CHN",
        }),
        regulationRepository.findEffectiveByCountry({
          applicationScope: "non-road",
          asOf: "2026-07-29",
          countryIso3: "CHN",
          powerKw: 100,
        }),
      ]);
      expect(country?.jurisdictions).toEqual([]);
      expect(country?.regulations).toEqual([]);
      expect(regulationsForFit).toEqual([]);
    };

    await testDatabase.database
      .update(countryJurisdictions)
      .set({ dataSourceId: archivedSourceId })
      .where(
        and(
          eq(countryJurisdictions.countryIso3, "CHN"),
          eq(
            countryJurisdictions.jurisdictionId,
            demoIds.jurisdiction.china,
          ),
        ),
      );
    try {
      await assertChinaRegulationsHidden();
    } finally {
      await testDatabase.database
        .update(countryJurisdictions)
        .set({ dataSourceId: demoIds.source.regulation })
        .where(
          and(
            eq(countryJurisdictions.countryIso3, "CHN"),
            eq(
              countryJurisdictions.jurisdictionId,
              demoIds.jurisdiction.china,
            ),
          ),
        );
    }

    await testDatabase.database
      .update(jurisdictions)
      .set({ dataSourceId: archivedSourceId })
      .where(eq(jurisdictions.id, demoIds.jurisdiction.china));
    try {
      await assertChinaRegulationsHidden();
    } finally {
      await testDatabase.database
        .update(jurisdictions)
        .set({ dataSourceId: demoIds.source.regulation })
        .where(eq(jurisdictions.id, demoIds.jurisdiction.china));
    }
  });

  it("excludes regulations when the country or its evidence source is archived", async () => {
    const regulationRepository = createRegulationRepository(
      testDatabase.database,
    );
    const marketRepository = createMarketRepository(testDatabase.database);
    const archivedSourceId = "10000000-0000-4000-8000-000000000904";
    await testDatabase.database.insert(dataSources).values({
      archivedAt: new Date("2026-07-29T00:00:00.000Z"),
      demoNotice: "DEMO ONLY — archived country-source filter test.",
      id: archivedSourceId,
      isDemo: true,
      sourceType: "demo",
      title: "DEMO ONLY — Archived country source",
      verifiedAt: new Date("2026-07-29T00:00:00.000Z"),
    });
    const query = {
      applicationScope: "non-road",
      asOf: "2026-07-29",
      countryIso3: "CHN",
      powerKw: 100,
    } as const;
    const marketQuery = {
      applicationScope: "non-road",
      countryIso3s: ["CHN", "BRA"],
      metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
    } as const;

    const expectChinaHidden = async () => {
      const [regulationRows, marketRows] = await Promise.all([
        regulationRepository.findEffectiveByCountry(query),
        marketRepository.findForComparison(marketQuery),
      ]);
      expect(regulationRows).toEqual([]);
      expect(marketRows.some(({ countryIso3 }) => countryIso3 === "CHN")).toBe(
        false,
      );
    };

    await testDatabase.database
      .update(countries)
      .set({ archivedAt: new Date("2026-07-29T00:00:00.000Z") })
      .where(eq(countries.iso3, "CHN"));
    try {
      await expectChinaHidden();
    } finally {
      await testDatabase.database
        .update(countries)
        .set({ archivedAt: null })
        .where(eq(countries.iso3, "CHN"));
    }

    await testDatabase.database
      .update(countries)
      .set({ dataSourceId: archivedSourceId })
      .where(eq(countries.iso3, "CHN"));
    try {
      await expectChinaHidden();
    } finally {
      await testDatabase.database
        .update(countries)
        .set({ dataSourceId: demoIds.source.country })
        .where(eq(countries.iso3, "CHN"));
    }
  });

  it("compares database regulations and structured market metrics", async () => {
    const regulationRepository = createRegulationRepository(
      testDatabase.database,
    );
    const marketRepository = createMarketRepository(testDatabase.database);

    const regulationRows =
      await regulationRepository.findForComparison({
        applicationScope: "non-road",
        asOf: "2026-07-29",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      });
    const marketRows = await marketRepository.findForComparison({
      applicationScope: "non-road",
      countryIso3s: ["CHN", "BRA"],
      metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
    });

    expect(regulationRows).toHaveLength(4);
    expect(
      regulationRows.filter(({ status }) => status === "effective"),
    ).toHaveLength(3);
    expect(
      regulationRows.filter(({ status }) => status === "adopted"),
    ).toHaveLength(1);
    expect(
      regulationRows.every(({ isDemo, limit, source }) =>
        Boolean(isDemo && limit.isDemo && source.isDemo),
      ),
    ).toBe(true);
    expect(
      regulationRows.every(
        ({ applicability }) =>
          applicability.jurisdictionIsDemo &&
          applicability.jurisdictionSourceIsDemo &&
          applicability.membershipIsDemo &&
          applicability.membershipSourceIsDemo,
      ),
    ).toBe(true);
    expect(marketRows).toHaveLength(2);
    expect(marketRows.map(({ countryIso3 }) => countryIso3).sort()).toEqual([
      "BRA",
      "CHN",
    ]);
    expect(
      marketRows.every(
        ({ methodologyVersion, metricCode, unitCode }) =>
          methodologyVersion === "demo-v1" &&
          metricCode === "DEMO_ADDRESSABLE_UNITS" &&
          unitCode === "units",
      ),
    ).toBe(true);
  });

  it("does not leak a later adoption into a historical comparison", async () => {
    const repository = createRegulationRepository(testDatabase.database);

    const rows = await repository.findForComparison({
      applicationScope: "non-road",
      asOf: "2024-12-31",
      countryIso3s: ["CHN", "BRA"],
      powerKw: 100,
    });

    expect(
      rows.some(
        ({ citationCode }) => citationCode === "DEMO-CHN-NR-C-ADOPTED",
      ),
    ).toBe(false);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          citationCode: "DEMO-CHN-NR-Z",
          status: "superseded",
        }),
        expect.objectContaining({
          citationCode: "DEMO-CHN-NR-A",
          status: "effective",
        }),
      ]),
    );
  });

  it("fails closed when a comparison sees a superseded record without a closing date", async () => {
    const repository = createRegulationRepository(testDatabase.database);
    await testDatabase.database
      .update(regulations)
      .set({ effectiveTo: null })
      .where(eq(regulations.id, demoIds.regulation.chinaSuperseded));

    try {
      const rows = await repository.findForComparison({
        applicationScope: "non-road",
        asOf: "2024-12-31",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      });

      expect(
        rows.some(
          ({ regulationId }) =>
            regulationId === demoIds.regulation.chinaSuperseded,
        ),
      ).toBe(false);
    } finally {
      await testDatabase.database
        .update(regulations)
        .set({ effectiveTo: "2025-01-01" })
        .where(eq(regulations.id, demoIds.regulation.chinaSuperseded));
    }
  });

  it("fails closed for a future superseded comparison without a closing date", async () => {
    const repository = createRegulationRepository(testDatabase.database);
    await testDatabase.database
      .update(regulations)
      .set({ effectiveFrom: "2030-01-01", effectiveTo: null })
      .where(eq(regulations.id, demoIds.regulation.chinaSuperseded));

    try {
      const rows = await repository.findForComparison({
        applicationScope: "non-road",
        asOf: "2026-07-29",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      });

      expect(
        rows.some(
          ({ regulationId }) =>
            regulationId === demoIds.regulation.chinaSuperseded,
        ),
      ).toBe(false);
    } finally {
      await testDatabase.database
        .update(regulations)
        .set({ effectiveFrom: "2020-01-01", effectiveTo: "2025-01-01" })
        .where(eq(regulations.id, demoIds.regulation.chinaSuperseded));
    }
  });

  it("does not assign a query-date adopted status without an adoption date", async () => {
    const repository = createRegulationRepository(testDatabase.database);
    await testDatabase.database
      .update(regulations)
      .set({ adoptedOn: null })
      .where(eq(regulations.id, demoIds.regulation.chinaAdopted));

    try {
      const rows = await repository.findForComparison({
        applicationScope: "non-road",
        asOf: "2026-08-12",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      });

      expect(
        rows.some(
          ({ regulationId }) =>
            regulationId === demoIds.regulation.chinaAdopted,
        ),
      ).toBe(false);
    } finally {
      await testDatabase.database
        .update(regulations)
        .set({ adoptedOn: "2026-01-10" })
        .where(eq(regulations.id, demoIds.regulation.chinaAdopted));
    }
  });

  it("returns certification evidence for a product-fit query", async () => {
    const repository = createProductRepository(testDatabase.database);

    const evidence = await repository.findFitEvidence({
      applicationScope: "non-road",
      asOf: "2026-07-29",
      countryIso3: "CHN",
      powerKw: 100,
      productModelCode: "demo-eng-100",
    });

    expect(evidence.product).toMatchObject({
      availableFrom: "2025-01-01",
      availableTo: "2030-01-01",
      isDemo: true,
      modelCode: "DEMO-ENG-100",
    });
    expect(evidence.applicableRegulations).toHaveLength(1);
    expect(evidence.applicableRegulations[0]?.applicability).toMatchObject({
      countryIso3: "CHN",
      jurisdiction: {
        isDemo: true,
        source: {
          isDemo: true,
          title: expect.stringContaining("DEMO ONLY"),
        },
      },
      membership: {
        isDemo: true,
        source: {
          isDemo: true,
          title: expect.stringContaining("DEMO ONLY"),
        },
      },
    });
    expect(evidence.applicableRegulations[0]?.limitSources[0]?.title).toContain(
      "DEMO ONLY",
    );
    expect(evidence.certifications).toHaveLength(1);
    expect(evidence.uncoveredRegulationIds).toEqual([]);
    expect(evidence.certifications[0]?.source.title).toContain("DEMO ONLY");
  });

  it("fails closed for real products and certifications without publication approval", async () => {
    const repository = createProductRepository(testDatabase.database);
    const unapprovedProductId = "10000000-0000-4000-8000-000000000601";
    const unapprovedCertificationId =
      "10000000-0000-4000-8000-000000000602";

    await testDatabase.database.insert(products).values({
      applicationScopes: ["non-road"],
      availableFrom: "2025-01-01",
      availableTo: null,
      dataSourceId: demoIds.source.countryDirectory,
      id: unapprovedProductId,
      isDemo: false,
      modelCode: "UNAPPROVED-REAL-100",
      name: "Unapproved real product",
      powerMaxKw: 150,
      powerMinKw: 50,
      specificationVersion: "unapproved-v1",
      verifiedAt: new Date("2026-01-15T00:00:00.000Z"),
    });
    await testDatabase.database.insert(productCertifications).values({
      applicationScope: "non-road",
      certificateNumber: "UNAPPROVED-CERT-100",
      dataSourceId: demoIds.source.countryDirectory,
      id: unapprovedCertificationId,
      isDemo: false,
      powerMaxKw: 150,
      powerMinKw: 50,
      productId: demoIds.product.certified,
      regulationId: demoIds.regulation.chinaEffective,
      status: "active",
      validFrom: "2025-01-01",
      validTo: null,
      verifiedAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    try {
      const listedProducts = await repository.listProducts();
      const unapprovedProductEvidence = await repository.findFitEvidence({
        applicationScope: "non-road",
        asOf: "2026-07-29",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "UNAPPROVED-REAL-100",
      });
      const demoProductEvidence = await repository.findFitEvidence({
        applicationScope: "non-road",
        asOf: "2026-07-29",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "DEMO-ENG-100",
      });

      expect(
        listedProducts.some(({ id }) => id === unapprovedProductId),
      ).toBe(false);
      expect(unapprovedProductEvidence.product).toBeNull();
      expect(
        demoProductEvidence.certifications.some(
          ({ id }) => id === unapprovedCertificationId,
        ),
      ).toBe(false);
      expect(demoProductEvidence.certifications).toHaveLength(1);
    } finally {
      await testDatabase.database
        .delete(productCertifications)
        .where(eq(productCertifications.id, unapprovedCertificationId));
      await testDatabase.database
        .delete(products)
        .where(eq(products.id, unapprovedProductId));
    }
  });

  it("preserves demo classification when a demo limit uses a public source", async () => {
    const repository = createProductRepository(testDatabase.database);

    await testDatabase.database
      .update(regulationLimits)
      .set({
        dataSourceId: demoIds.source.countryDirectory,
        isDemo: true,
      })
      .where(eq(regulationLimits.id, demoIds.limit.chinaEffectiveNox));

    try {
      const evidence = await repository.findFitEvidence({
        applicationScope: "non-road",
        asOf: "2026-07-29",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "DEMO-ENG-100",
      });
      const publicLimitSource = evidence.applicableRegulations[0]?.limitSources.find(
        ({ id }) => id === demoIds.source.countryDirectory,
      );

      expect(publicLimitSource).toMatchObject({ isDemo: true });
    } finally {
      await testDatabase.database
        .update(regulationLimits)
        .set({
          dataSourceId: demoIds.source.regulation,
          isDemo: true,
        })
        .where(eq(regulationLimits.id, demoIds.limit.chinaEffectiveNox));
    }
  });

  it("merges demo classification when mixed limits share one public source", async () => {
    const repository = createProductRepository(testDatabase.database);

    await testDatabase.database
      .update(regulationLimits)
      .set({
        dataSourceId: demoIds.source.countryDirectory,
        isDemo: false,
      })
      .where(eq(regulationLimits.id, demoIds.limit.chinaEffectiveNox));
    await testDatabase.database
      .update(regulationLimits)
      .set({
        dataSourceId: demoIds.source.countryDirectory,
        isDemo: true,
      })
      .where(eq(regulationLimits.id, demoIds.limit.chinaEffectivePm));

    try {
      const evidence = await repository.findFitEvidence({
        applicationScope: "non-road",
        asOf: "2026-07-29",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "DEMO-ENG-100",
      });
      const publicLimitSources = evidence.applicableRegulations[0]?.limitSources.filter(
        ({ id }) => id === demoIds.source.countryDirectory,
      );

      expect(publicLimitSources).toEqual([
        expect.objectContaining({ isDemo: true }),
      ]);
    } finally {
      await testDatabase.database
        .update(regulationLimits)
        .set({
          dataSourceId: demoIds.source.regulation,
          isDemo: true,
        })
        .where(
          inArray(regulationLimits.id, [
            demoIds.limit.chinaEffectiveNox,
            demoIds.limit.chinaEffectivePm,
          ]),
        );
    }
  });

  it("keeps missing certification explicit in product-fit evidence", async () => {
    const repository = createProductRepository(testDatabase.database);

    const evidence = await repository.findFitEvidence({
      applicationScope: "non-road",
      asOf: "2026-07-29",
      countryIso3: "CHN",
      powerKw: 100,
      productModelCode: "DEMO-ENG-200",
    });

    expect(evidence.product?.modelCode).toBe("DEMO-ENG-200");
    expect(evidence.certifications).toEqual([]);
    expect(evidence.uncoveredRegulationIds).toHaveLength(1);
  });

  it("runs hybrid candidates with country, jurisdiction, scope, and date filters", async () => {
    const repository = createKnowledgeRepository(testDatabase.database);
    const content =
      "DEMO ONLY fictional non-road emissions requirement and certification.";
    await testDatabase.database
      .update(documentChunks)
      .set({
        content,
        embedding: createLocalHashEmbedding(content),
        embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
      })
      .where(eq(documentChunks.id, demoIds.documentChunk.regulation));

    const baseQuery = {
      applicationScope: "non-road" as const,
      asOf: "2026-07-29",
      countryIso3: "CHN",
      jurisdictionId: demoIds.jurisdiction.china,
      limit: 10,
      query: "non-road emissions certification",
    };
    const rows = await repository.searchCandidates(
      baseQuery,
      createLocalHashEmbedding(baseQuery.query),
    );

    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.keywordScore)).toBeGreaterThan(0);
    expect(Number(rows[0]?.vectorDistance)).toBeLessThan(1);
    expect(rows[0]).toMatchObject({
      countryIso3: "CHN",
      documentPublishedOn: "2026-01-02",
      jurisdictionId: demoIds.jurisdiction.china,
      sourcePublishedOn: "2026-01-02",
    });

    await expect(
      repository.searchCandidates(
        { ...baseQuery, countryIso3: "BRA" },
        createLocalHashEmbedding(baseQuery.query),
      ),
    ).resolves.toEqual([]);
    await expect(
      repository.searchCandidates(
        {
          ...baseQuery,
          jurisdictionId: demoIds.jurisdiction.brazil,
        },
        createLocalHashEmbedding(baseQuery.query),
      ),
    ).resolves.toEqual([]);
    await expect(
      repository.searchCandidates(
        { ...baseQuery, applicationScope: "on-road" },
        createLocalHashEmbedding(baseQuery.query),
      ),
    ).resolves.toEqual([]);
    await expect(
      repository.searchCandidates(
        { ...baseQuery, asOf: "2024-12-31" },
        createLocalHashEmbedding(baseQuery.query),
      ),
    ).resolves.toEqual([]);

    const archivedAt = new Date("2026-08-06T00:00:00.000Z");
    await testDatabase.database
      .update(countries)
      .set({ archivedAt })
      .where(eq(countries.iso3, "CHN"));
    try {
      await expect(
        repository.searchCandidates(
          baseQuery,
          createLocalHashEmbedding(baseQuery.query),
        ),
      ).resolves.toEqual([]);
    } finally {
      await testDatabase.database
        .update(countries)
        .set({ archivedAt: null })
        .where(eq(countries.iso3, "CHN"));
    }

    await testDatabase.database
      .update(jurisdictions)
      .set({ archivedAt })
      .where(eq(jurisdictions.id, demoIds.jurisdiction.china));
    try {
      await expect(
        repository.searchCandidates(
          baseQuery,
          createLocalHashEmbedding(baseQuery.query),
        ),
      ).resolves.toEqual([]);
    } finally {
      await testDatabase.database
        .update(jurisdictions)
        .set({ archivedAt: null })
        .where(eq(jurisdictions.id, demoIds.jurisdiction.china));
    }
  });

  it("preserves demo classification when a demo document uses a public source", async () => {
    const repository = createKnowledgeRepository(testDatabase.database);
    const content = "DEMO ONLY public-source document classification check.";
    await testDatabase.database
      .update(documents)
      .set({ dataSourceId: demoIds.source.countryDirectory, isDemo: true })
      .where(eq(documents.id, demoIds.document.regulation));
    await testDatabase.database
      .update(documentChunks)
      .set({
        content,
        embedding: createLocalHashEmbedding(content),
        embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
        isDemo: true,
      })
      .where(eq(documentChunks.id, demoIds.documentChunk.regulation));

    try {
      const rows = await repository.searchCandidates(
        {
          applicationScope: "non-road",
          asOf: "2026-07-29",
          countryIso3: "CHN",
          jurisdictionId: demoIds.jurisdiction.china,
          limit: 10,
          query: "public-source document classification",
        },
        createLocalHashEmbedding("public-source document classification"),
      );

      expect(rows[0]).toMatchObject({ isDemo: true });
    } finally {
      await testDatabase.database
        .update(documents)
        .set({ dataSourceId: demoIds.source.regulation, isDemo: true })
        .where(eq(documents.id, demoIds.document.regulation));
    }
  });

  it("creates imported processing documents only as governance drafts", async () => {
    const repository = createKnowledgeRepository(testDatabase.database);
    const creation = await repository.createProcessingDocument({
      byteSize: 128,
      contentSha256: "04".repeat(32),
      metadata: {
        applicationScope: "non-road",
        canonicalUrl: null,
        countryIso3: "CHN",
        demoNotice: "FICTIONAL DEMO DATA - NOT FOR PRODUCTION.",
        documentType: "other",
        isDemo: true,
        jurisdictionId: null,
        languageCode: "en",
        licenseCode: null,
        publishedOn: null,
        redistributionAllowed: false,
        sourcePublisher: null,
        sourceTitle: "DEMO ONLY - Draft import source",
        sourceType: "demo",
        sourceUrl: null,
        title: "DEMO ONLY - Draft import document",
        validFrom: null,
        validTo: null,
      },
      mimeType: "text/plain",
      originalFilename: "draft-import.txt",
      storagePath: "knowledge/04/draft-import.txt",
    });
    expect(creation.created).toBe(true);

    const [storedDocument] = await testDatabase.database
      .select({
        governancePublishedAt: documents.governancePublishedAt,
        governanceStatus: documents.governanceStatus,
        processingStatus: documents.processingStatus,
      })
      .from(documents)
      .where(eq(documents.id, creation.documentId));

    expect(storedDocument).toEqual({
      governancePublishedAt: null,
      governanceStatus: "draft",
      processingStatus: "processing",
    });

    const content = "DEMO ONLY - Draft processing state transition.";
    const chunks = [
      {
        applicationScope: "non-road" as const,
        chunkIndex: 0,
        content,
        contentHash: "08".repeat(32),
        countryIso3: null,
        embedding: createLocalHashEmbedding(content),
        embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
        headingPath: ["Draft processing"],
        isDemo: true,
        jurisdictionId: null,
        pageFrom: 1,
        pageTo: 1,
        sectionLocator: "Draft processing > paragraph 1",
        tokenCount: 7,
        validFrom: null,
        validTo: null,
        verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
      },
    ];
    await repository.completeDocument(creation.documentId, chunks, "draft");
    await expect(
      repository.completeDocument(creation.documentId, chunks, "draft"),
    ).rejects.toThrow("draft processing document");
    await repository.markDocumentFailed(
      creation.documentId,
      "A stale worker must not overwrite ready.",
    );

    const [completedDocument] = await testDatabase.database
      .select({
        governanceStatus: documents.governanceStatus,
        processingError: documents.processingError,
        processingStatus: documents.processingStatus,
      })
      .from(documents)
      .where(eq(documents.id, creation.documentId));
    expect(completedDocument).toEqual({
      governanceStatus: "draft",
      processingError: null,
      processingStatus: "ready",
    });
  });

  it("deduplicates concurrent document creation without orphan sources", async () => {
    const repository = createKnowledgeRepository(testDatabase.database);
    const contentSha256 = "07".repeat(32);
    const sourceTitles = [
      "DEMO ONLY - Concurrent import source A",
      "DEMO ONLY - Concurrent import source B",
    ];
    const baseInput = {
      byteSize: 128,
      contentSha256,
      metadata: {
        applicationScope: "non-road" as const,
        canonicalUrl: null,
        countryIso3: "CHN" as const,
        demoNotice: "FICTIONAL DEMO DATA - NOT FOR PRODUCTION.",
        documentType: "other" as const,
        isDemo: true,
        jurisdictionId: null,
        languageCode: "en",
        licenseCode: null,
        publishedOn: null,
        redistributionAllowed: false,
        sourcePublisher: null,
        sourceType: "demo" as const,
        sourceUrl: null,
        title: "DEMO ONLY - Concurrent import document",
        validFrom: null,
        validTo: null,
      },
      mimeType: "text/plain",
      originalFilename: "concurrent-import.txt",
      storagePath: "knowledge/07/concurrent-import.txt",
    };

    const creations = await Promise.all(
      sourceTitles.map((sourceTitle) =>
        repository.createProcessingDocument({
          ...baseInput,
          metadata: { ...baseInput.metadata, sourceTitle },
        }),
      ),
    );
    const storedDocuments = await testDatabase.database
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.contentSha256, contentSha256));
    const storedSources = await testDatabase.database
      .select({ id: dataSources.id })
      .from(dataSources)
      .where(inArray(dataSources.title, sourceTitles));

    expect(creations.map(({ created }) => created).sort()).toEqual([
      false,
      true,
    ]);
    expect(
      new Set(creations.map(({ documentId }) => documentId)).size,
    ).toBe(1);
    expect(storedDocuments).toHaveLength(1);
    expect(storedSources).toHaveLength(1);
  });

  it("revalidates direct-published chunk parents when processing completes", async () => {
    const repository = createKnowledgeRepository(testDatabase.database);
    const creation = await repository.createProcessingDocument({
      byteSize: 128,
      contentSha256: "05".repeat(32),
      metadata: {
        applicationScope: "non-road",
        canonicalUrl: null,
        countryIso3: "CHN",
        demoNotice: "FICTIONAL DEMO DATA - NOT FOR PRODUCTION.",
        documentType: "other",
        isDemo: true,
        jurisdictionId: demoIds.jurisdiction.china,
        languageCode: "en",
        licenseCode: null,
        publishedOn: null,
        redistributionAllowed: false,
        sourcePublisher: null,
        sourceTitle: "DEMO ONLY - Direct publication source",
        sourceType: "demo",
        sourceUrl: null,
        title: "DEMO ONLY - Direct publication document",
        validFrom: null,
        validTo: null,
      },
      mimeType: "text/plain",
      originalFilename: "direct-publication.txt",
      storagePath: "knowledge/05/direct-publication.txt",
    });
    const documentId = creation.documentId;
    const content = "DEMO ONLY direct publication parent validation.";
    const chunks = [
      {
        applicationScope: "non-road" as const,
        chunkIndex: 0,
        content,
        contentHash: "15".repeat(32),
        countryIso3: "CHN",
        embedding: createLocalHashEmbedding(content),
        embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
        headingPath: ["Direct publication"],
        isDemo: true,
        jurisdictionId: demoIds.jurisdiction.china,
        pageFrom: 1,
        pageTo: 1,
        sectionLocator: "Direct publication > paragraph 1",
        tokenCount: 7,
        validFrom: null,
        validTo: null,
        verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
      },
    ];
    const archivedAt = new Date("2026-08-06T00:01:00.000Z");
    await testDatabase.database
      .update(countries)
      .set({ archivedAt })
      .where(eq(countries.iso3, "CHN"));

    try {
      await expect(
        repository.completeDocument(documentId, chunks, "published"),
      ).rejects.toThrow("country");

      const [storedDocument] = await testDatabase.database
        .select({
          governancePublishedAt: documents.governancePublishedAt,
          governanceStatus: documents.governanceStatus,
          processingStatus: documents.processingStatus,
        })
        .from(documents)
        .where(eq(documents.id, documentId));
      const storedChunks = await testDatabase.database
        .select({ id: documentChunks.id })
        .from(documentChunks)
        .where(eq(documentChunks.documentId, documentId));

      expect(storedDocument).toEqual({
        governancePublishedAt: null,
        governanceStatus: "draft",
        processingStatus: "processing",
      });
      expect(storedChunks).toEqual([]);
    } finally {
      await testDatabase.database
        .update(countries)
        .set({ archivedAt: null })
        .where(eq(countries.iso3, "CHN"));
    }

    await repository.completeDocument(documentId, chunks, "published");
    const [publishedDocument] = await testDatabase.database
      .select({
        governancePublishedAt: documents.governancePublishedAt,
        governanceStatus: documents.governanceStatus,
        processingStatus: documents.processingStatus,
      })
      .from(documents)
      .where(eq(documents.id, documentId));

    expect(publishedDocument).toMatchObject({
      governancePublishedAt: expect.any(Date),
      governanceStatus: "published",
      processingStatus: "ready",
    });
  });

  it("rejects non-demo direct publication against demo parents", async () => {
    const repository = createKnowledgeRepository(testDatabase.database);
    const creation = await repository.createProcessingDocument({
      byteSize: 128,
      contentSha256: "06".repeat(32),
      metadata: {
        applicationScope: "non-road",
        canonicalUrl: null,
        countryIso3: "CHN",
        demoNotice: null,
        documentType: "other",
        isDemo: false,
        jurisdictionId: null,
        languageCode: "en",
        licenseCode: null,
        publishedOn: null,
        redistributionAllowed: false,
        sourcePublisher: null,
        sourceTitle: "Direct publication source",
        sourceType: "other",
        sourceUrl: null,
        title: "Direct publication document",
        validFrom: null,
        validTo: null,
      },
      mimeType: "text/plain",
      originalFilename: "non-demo-direct-publication.txt",
      storagePath: "knowledge/06/non-demo-direct-publication.txt",
    });
    const documentId = creation.documentId;
    const content = "Non-demo direct publication classification check.";

    await expect(
      repository.completeDocument(
        documentId,
        [
          {
            applicationScope: "non-road",
            chunkIndex: 0,
            content,
            contentHash: "16".repeat(32),
            countryIso3: "CHN",
            embedding: createLocalHashEmbedding(content),
            embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
            headingPath: ["Direct publication"],
            isDemo: false,
            jurisdictionId: null,
            pageFrom: 1,
            pageTo: 1,
            sectionLocator: "Direct publication > paragraph 1",
            tokenCount: 6,
            validFrom: null,
            validTo: null,
            verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
          },
        ],
        "published",
      ),
    ).rejects.toThrow("demo country");
  });

  it("updates draft document and source metadata atomically before reprocessing", async () => {
    const repository = createKnowledgeRepository(testDatabase.database);
    const sourceId = "11000000-0000-4000-8000-000000000001";
    const documentId = "11000000-0000-4000-8000-000000000002";
    const verifiedAt = new Date("2026-08-06T00:00:00.000Z");
    const metadata = {
      applicationScope: "non-road" as const,
      canonicalUrl: "https://example.test/demo-document",
      countryIso3: "CHN" as const,
      demoNotice: "FICTIONAL DEMO DATA — NOT FOR PRODUCTION.",
      documentType: "government-notice" as const,
      isDemo: true,
      jurisdictionId: null,
      languageCode: "zh-CN",
      licenseCode: "CC-BY-4.0",
      publishedOn: "2026-01-01",
      redistributionAllowed: true,
      sourcePublisher: "Demo publisher",
      sourceTitle: "DEMO ONLY — Reprocessed source",
      sourceType: "demo" as const,
      sourceUrl: "https://example.test/demo-source",
      title: "DEMO ONLY — Reprocessed document",
      validFrom: "2026-01-01",
      validTo: null,
    };

    await testDatabase.database.insert(dataSources).values({
      id: sourceId,
      isDemo: false,
      sourceType: "other",
      title: "Original source",
      verifiedAt,
    });
    await testDatabase.database.insert(documents).values({
      contentSha256: "5".repeat(64),
      dataSourceId: sourceId,
      governanceStatus: "draft",
      id: documentId,
      isDemo: false,
      languageCode: "en",
      processedAt: verifiedAt,
      processingStatus: "ready",
      title: "Original document",
      type: "other",
      verifiedAt,
    });

    const started = await repository.beginDocumentReprocessing(
      documentId,
      metadata,
    );
    const [updated] = await testDatabase.database
      .select({
        document: {
          canonicalUrl: documents.canonicalUrl,
          dataSourceId: documents.dataSourceId,
          demoNotice: documents.demoNotice,
          isDemo: documents.isDemo,
          processingStatus: documents.processingStatus,
          title: documents.title,
        },
        source: {
          demoNotice: dataSources.demoNotice,
          isDemo: dataSources.isDemo,
          publishedOn: dataSources.publishedOn,
          sourceType: dataSources.sourceType,
          title: dataSources.title,
          url: dataSources.url,
        },
      })
      .from(documents)
      .innerJoin(dataSources, eq(documents.dataSourceId, dataSources.id))
      .where(eq(documents.id, documentId));

    expect(started?.beforeData).toMatchObject({
      document: { isDemo: false, title: "Original document" },
      source: { isDemo: false, title: "Original source" },
    });
    expect(updated).toMatchObject({
      document: {
        canonicalUrl: metadata.canonicalUrl,
        dataSourceId: started?.sourceId,
        demoNotice: metadata.demoNotice,
        isDemo: true,
        processingStatus: "processing",
        title: metadata.title,
      },
      source: {
        demoNotice: metadata.demoNotice,
        isDemo: true,
        publishedOn: metadata.publishedOn,
        sourceType: "demo",
        title: metadata.sourceTitle,
        url: metadata.sourceUrl,
      },
    });
    const [originalSource] = await testDatabase.database
      .select({ isDemo: dataSources.isDemo, title: dataSources.title })
      .from(dataSources)
      .where(eq(dataSources.id, sourceId));
    expect(originalSource).toEqual({
      isDemo: false,
      title: "Original source",
    });
    await expect(
      repository.beginDocumentReprocessing(documentId, metadata),
    ).resolves.toBeNull();

    await testDatabase.database
      .update(documents)
      .set({ governanceStatus: "reviewed", processingStatus: "ready" })
      .where(eq(documents.id, documentId));
    await expect(
      repository.beginDocumentReprocessing(documentId, {
        ...metadata,
        title: "Must not bypass review",
      }),
    ).resolves.toBeNull();
    const [reviewedDocument] = await testDatabase.database
      .select({ title: documents.title })
      .from(documents)
      .where(eq(documents.id, documentId));
    expect(reviewedDocument?.title).toBe(metadata.title);
  });

  it("publishes jurisdictions with memberships via governance and reruns cleanly", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const countryRepository = createCountryRepository(testDatabase.database);
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const jurisdictionId = "10000000-0000-4000-8000-000000000901";
    const payload = {
      code: "TEST-JUR",
      countryIso3: "JPN",
      dataSourceId: demoIds.source.country,
      id: jurisdictionId,
      isDemo: true,
      memberships: [
        {
          countryIso3: "JPN",
          dataSourceId: demoIds.source.country,
          isDemo: true,
          validFrom: "2000-01-01",
          validTo: null,
          verifiedAt: "2026-07-30T00:00:00.000Z",
        },
      ],
      name: "DEMO ONLY — Governance test jurisdiction",
      type: "country",
      verifiedAt: "2026-07-30T00:00:00.000Z",
      websiteUrl: null,
    };
    const publishOnce = async () => {
      const draft = await governanceRepository.createDraft({
        actor: editor,
        changeReason: "Jurisdiction governance test draft.",
        entityKey: jurisdictionId,
        entityType: "jurisdiction",
        payload,
      });
      await governanceRepository.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Jurisdiction governance test review.",
      });
      await governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Jurisdiction governance test publish.",
      });
    };

    await publishOnce();
    const firstDetails = await countryRepository.findDetailsByIso3({
      asOf: "2026-07-30",
      iso3: "JPN",
    });
    expect(
      firstDetails?.jurisdictions.some(
        (jurisdiction) => jurisdiction.code === "TEST-JUR",
      ),
    ).toBe(true);

    // 重发布幂等：成员关系归档后重建，活跃成员保持一条。
    await publishOnce();
    const secondDetails = await countryRepository.findDetailsByIso3({
      asOf: "2026-07-30",
      iso3: "JPN",
    });
    expect(
      secondDetails?.jurisdictions.filter(
        (jurisdiction) => jurisdiction.code === "TEST-JUR",
      ),
    ).toHaveLength(1);
  });

  it("preserves disjoint jurisdiction exit and re-entry periods", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const countryRepository = createCountryRepository(testDatabase.database);
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const jurisdictionId = "10000000-0000-4000-8000-000000000924";
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Test disjoint jurisdiction membership periods.",
      entityKey: jurisdictionId,
      entityType: "jurisdiction",
      payload: {
        code: "TEST-REENTRY-JUR",
        countryIso3: null,
        dataSourceId: demoIds.source.country,
        id: jurisdictionId,
        isDemo: true,
        memberships: [
          {
            countryIso3: "JPN",
            dataSourceId: demoIds.source.country,
            isDemo: true,
            validFrom: "2000-01-01",
            validTo: "2010-01-01",
            verifiedAt: "2026-08-06T00:00:00.000Z",
          },
          {
            countryIso3: "JPN",
            dataSourceId: demoIds.source.country,
            isDemo: true,
            validFrom: "2020-01-01",
            validTo: null,
            verifiedAt: "2026-08-06T00:00:00.000Z",
          },
        ],
        name: "DEMO ONLY — Re-entry jurisdiction",
        type: "regional",
        verifiedAt: "2026-08-06T00:00:00.000Z",
        websiteUrl: null,
      },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review disjoint jurisdiction membership periods.",
    });
    await governanceRepository.publishDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Publish disjoint jurisdiction membership periods.",
    });

    const [beforeExit, duringGap, afterReentry, storedMemberships] =
      await Promise.all([
        countryRepository.findDetailsByIso3({
          asOf: "2009-12-31",
          iso3: "JPN",
        }),
        countryRepository.findDetailsByIso3({
          asOf: "2015-01-01",
          iso3: "JPN",
        }),
        countryRepository.findDetailsByIso3({
          asOf: "2026-01-01",
          iso3: "JPN",
        }),
        testDatabase.database
          .select({ validFrom: countryJurisdictions.validFrom })
          .from(countryJurisdictions)
          .where(
            and(
              eq(countryJurisdictions.jurisdictionId, jurisdictionId),
              isNull(countryJurisdictions.archivedAt),
            ),
          ),
      ]);

    const hasReentryJurisdiction = (
      details: Awaited<ReturnType<typeof countryRepository.findDetailsByIso3>>,
    ) =>
      details?.jurisdictions.some(
        ({ code }) => code === "TEST-REENTRY-JUR",
      ) ?? false;

    expect(hasReentryJurisdiction(beforeExit)).toBe(true);
    expect(hasReentryJurisdiction(duringGap)).toBe(false);
    expect(hasReentryJurisdiction(afterReentry)).toBe(true);
    expect(storedMemberships.map(({ validFrom }) => validFrom).sort()).toEqual([
      "2000-01-01",
      "2020-01-01",
    ]);
  });

  it("keeps draft and reviewed country revisions out of formal queries until publication", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const countryRepository = createCountryRepository(testDatabase.database);
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Create a test-only governed country revision.",
      entityKey: "TST",
      entityType: "country",
      payload: {
        dataCoverageStatus: "demo",
        dataSourceId: demoIds.source.country,
        isDemo: true,
        iso2: "XT",
        iso3: "TST",
        nameEn: "DEMO ONLY — Governed test country",
        nameLocal: null,
        regionCode: "DEMO",
        subregionCode: "DEMO",
        verifiedAt: "2026-07-29T00:00:00.000Z",
      },
    });

    await expect(
      countryRepository.findByIso3({ iso3: "TST" }),
    ).resolves.toBeNull();
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Independent review completed for the test revision.",
    });
    await expect(
      countryRepository.findByIso3({ iso3: "TST" }),
    ).resolves.toBeNull();

    await governanceRepository.publishDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Publish the reviewed test revision.",
    });

    await expect(
      countryRepository.findByIso3({ iso3: "TST" }),
    ).resolves.toMatchObject({
      iso3: "TST",
      nameEn: "DEMO ONLY — Governed test country",
    });
    const auditLogs = await governanceRepository.listAuditLogs();
    const reviewAudit = auditLogs.find(
      ({ action, draftId }) =>
        action === "reviewed" && draftId === draft.id,
    );
    expect(
      auditLogs
        .filter(({ draftId }) => draftId === draft.id)
        .map(({ action }) => action)
        .sort(),
    ).toEqual(["draft_created", "published", "reviewed"]);
    expect(reviewAudit?.beforeData).toMatchObject({
      payload: { iso3: "TST" },
      reviewedAt: null,
      reviewedBy: null,
      workflowStatus: "draft",
    });
    expect(reviewAudit?.afterData).toMatchObject({
      payload: { iso3: "TST" },
      reviewedBy: reviewer.email,
      workflowStatus: "reviewed",
    });
  });

  it("prevents a non-admin draft creator from publishing their own reviewed draft", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const creator = {
      email: "creator-reviewer@example.test",
      role: "reviewer" as const,
    };
    const independentReviewer = {
      email: "independent-reviewer@example.test",
      role: "reviewer" as const,
    };
    const draft = await governanceRepository.createDraft({
      actor: creator,
      changeReason: "Create a test draft for publisher separation.",
      entityKey: "OWN",
      entityType: "country",
      payload: {
        dataCoverageStatus: "demo",
        dataSourceId: demoIds.source.country,
        isDemo: true,
        iso2: "XO",
        iso3: "OWN",
        nameEn: "DEMO ONLY — Publisher separation country",
        nameLocal: null,
        regionCode: "DEMO",
        subregionCode: "DEMO",
        verifiedAt: "2026-07-29T00:00:00.000Z",
      },
    });

    await governanceRepository.reviewDraft({
      actor: independentReviewer,
      draftId: draft.id,
      reason: "Independently review the publisher-separation draft.",
    });
    await expect(
      governanceRepository.publishDraft({
        actor: creator,
        draftId: draft.id,
        reason: "Attempt self-publication after independent review.",
      }),
    ).rejects.toThrow("cannot publish their own draft");

    await expect(
      governanceRepository.publishDraft({
        actor: independentReviewer,
        draftId: draft.id,
        reason: "Publish through an independent reviewer.",
      }),
    ).resolves.toMatchObject({ status: "published" });
  });

  it("rejects draft identity mismatches throughout the workflow", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const entityKey = "10000000-0000-4000-8000-000000000930";
    const mismatchedId = "10000000-0000-4000-8000-000000000931";
    const payload = {
      applicationScopes: ["non-road" as const],
      availableFrom: null,
      availableTo: null,
      dataSourceId: demoIds.source.product,
      description: "DEMO ONLY — draft identity test.",
      id: entityKey,
      isDemo: true,
      modelCode: "DEMO-IDENTITY",
      name: "DEMO ONLY — Draft identity test",
      parameters: {},
      powerMaxKw: 200,
      powerMinKw: 100,
      specificationVersion: "demo-v1",
      verifiedAt: "2026-08-06T00:00:00.000Z",
    };

    await expect(
      governanceRepository.createDraft({
        actor: editor,
        changeReason: "Attempt a mismatched draft identity.",
        entityKey: mismatchedId,
        entityType: "product",
        payload,
      }),
    ).rejects.toThrow("entity key does not match its payload identity");

    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Create a valid draft before corruption simulation.",
      entityKey,
      entityType: "product",
      payload,
    });
    await testDatabase.database
      .update(dataGovernanceDrafts)
      .set({ payload: { ...payload, id: mismatchedId } })
      .where(eq(dataGovernanceDrafts.id, draft.id));
    await expect(
      governanceRepository.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt to review the mismatched legacy draft.",
      }),
    ).rejects.toThrow("entity key does not match its payload identity");
    await testDatabase.database
      .update(dataGovernanceDrafts)
      .set({ payload })
      .where(eq(dataGovernanceDrafts.id, draft.id));
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review the restored valid draft.",
    });
    await testDatabase.database
      .update(dataGovernanceDrafts)
      .set({ payload: { ...payload, id: mismatchedId } })
      .where(eq(dataGovernanceDrafts.id, draft.id));

    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt to publish the mismatched legacy draft.",
      }),
    ).rejects.toThrow("entity key does not match its payload identity");

    const [storedDraft] = await testDatabase.database
      .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
      .from(dataGovernanceDrafts)
      .where(eq(dataGovernanceDrafts.id, draft.id));
    const publishedProducts = await testDatabase.database
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.id, [entityKey, mismatchedId]));

    expect(storedDraft?.workflowStatus).toBe("reviewed");
    expect(publishedProducts).toEqual([]);
  });

  it("prevents an older draft version from replacing a published revision", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const entityKey = "VRS";
    const createRevision = (nameEn: string) =>
      governanceRepository.createDraft({
        actor: editor,
        changeReason: `Create ${nameEn}.`,
        entityKey,
        entityType: "country",
        payload: {
          dataCoverageStatus: "demo",
          dataSourceId: demoIds.source.country,
          isDemo: true,
          iso2: "XV",
          iso3: entityKey,
          nameEn,
          nameLocal: null,
          regionCode: "DEMO",
          subregionCode: "DEMO",
          verifiedAt: "2026-08-05T00:00:00.000Z",
        },
      });
    const baselineDraft = await createRevision(
      "DEMO ONLY — Version ordering v1",
    );
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: baselineDraft.id,
      reason: "Review the version-ordering baseline.",
    });
    await governanceRepository.publishDraft({
      actor: reviewer,
      draftId: baselineDraft.id,
      reason: "Publish the version-ordering baseline.",
    });
    const olderDraft = await createRevision(
      "DEMO ONLY — Version ordering v2",
    );
    const newerDraft = await createRevision(
      "DEMO ONLY — Version ordering v3",
    );
    for (const draft of [olderDraft, newerDraft]) {
      await governanceRepository.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Review version ordering test revision.",
      });
    }

    await governanceRepository.publishDraft({
      actor: reviewer,
      draftId: newerDraft.id,
      reason: "Publish the newer revision first.",
    });
    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: olderDraft.id,
        reason: "Attempt to replace the newer revision with v1.",
      }),
    ).rejects.toThrow("newer revision has already been published");

    const [storedCountry] = await testDatabase.database
      .select({ nameEn: countries.nameEn })
      .from(countries)
      .where(eq(countries.iso3, entityKey));
    const storedDrafts = await testDatabase.database
      .select({
        id: dataGovernanceDrafts.id,
        workflowStatus: dataGovernanceDrafts.workflowStatus,
      })
      .from(dataGovernanceDrafts)
      .where(
        and(
          eq(dataGovernanceDrafts.entityType, "country"),
          eq(dataGovernanceDrafts.entityKey, entityKey),
        ),
      );

    expect(storedCountry?.nameEn).toBe("DEMO ONLY — Version ordering v3");
    expect(storedDrafts).toEqual(
      expect.arrayContaining([
        { id: baselineDraft.id, workflowStatus: "published" },
        { id: olderDraft.id, workflowStatus: "reviewed" },
        { id: newerDraft.id, workflowStatus: "published" },
      ]),
    );
  });

  it("serializes concurrent archive requests without duplicate audit entries", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const admin = {
      email: "admin@example.test",
      role: "admin" as const,
    };
    await testDatabase.database.insert(countries).values({
      dataCoverageStatus: "demo",
      dataSourceId: demoIds.source.country,
      isDemo: true,
      iso2: "XA",
      iso3: "ARC",
      nameEn: "DEMO ONLY — Concurrent archive country",
      verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
    });

    const results = await Promise.allSettled([
      governanceRepository.archiveEntity({
        actor: admin,
        entityKey: "ARC",
        entityType: "country",
        reason: "Archive the test country once.",
      }),
      governanceRepository.archiveEntity({
        actor: admin,
        entityKey: "ARC",
        entityType: "country",
        reason: "Attempt duplicate concurrent archive.",
      }),
    ]);
    const archiveLogs = await testDatabase.database
      .select({ id: dataChangeLogs.id })
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.action, "archived"),
          eq(dataChangeLogs.entityType, "country"),
          eq(dataChangeLogs.entityKey, "ARC"),
        ),
      );

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(archiveLogs).toHaveLength(1);
  });

  it("rejects archiving a source that still has active published dependents", async () => {
    await seedDemoData(testDatabase.database);
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const admin = {
      email: "admin@example.test",
      role: "admin" as const,
    };

    await expect(
      governanceRepository.archiveEntity({
        actor: admin,
        entityKey: demoIds.source.regulation,
        entityType: "data_source",
        reason: "Attempt to archive evidence that remains in active use.",
      }),
    ).rejects.toThrow(
      "Cannot archive data source while active dependents exist",
    );

    const [source] = await testDatabase.database
      .select({ archivedAt: dataSources.archivedAt })
      .from(dataSources)
      .where(eq(dataSources.id, demoIds.source.regulation));
    const archiveLogs = await testDatabase.database
      .select({ id: dataChangeLogs.id })
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.action, "archived"),
          eq(dataChangeLogs.entityType, "data_source"),
          eq(dataChangeLogs.entityKey, demoIds.source.regulation),
        ),
      );

    expect(source?.archivedAt).toBeNull();
    expect(archiveLogs).toHaveLength(0);
  });

  it("rejects archiving structural parents that still have active dependents", async () => {
    await seedDemoData(testDatabase.database);
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const admin = {
      email: "admin@example.test",
      role: "admin" as const,
    };
    const attempts = [
      {
        entityKey: "CHN",
        entityType: "country" as const,
        expectedParent: "country",
      },
      {
        entityKey: demoIds.jurisdiction.china,
        entityType: "jurisdiction" as const,
        expectedParent: "jurisdiction",
      },
      {
        entityKey: demoIds.product.certified,
        entityType: "product" as const,
        expectedParent: "product",
      },
      {
        entityKey: demoIds.regulation.chinaEffective,
        entityType: "regulation" as const,
        expectedParent: "regulation",
      },
    ];

    for (const attempt of attempts) {
      await expect(
        governanceRepository.archiveEntity({
          actor: admin,
          entityKey: attempt.entityKey,
          entityType: attempt.entityType,
          reason: "Attempt to archive a parent before its dependents.",
        }),
      ).rejects.toThrow(
        `Cannot archive ${attempt.expectedParent} while active dependents exist`,
      );
    }

    const [country] = await testDatabase.database
      .select({ archivedAt: countries.archivedAt })
      .from(countries)
      .where(eq(countries.iso3, "CHN"));
    const [jurisdiction] = await testDatabase.database
      .select({ archivedAt: jurisdictions.archivedAt })
      .from(jurisdictions)
      .where(eq(jurisdictions.id, demoIds.jurisdiction.china));
    const [product] = await testDatabase.database
      .select({ archivedAt: products.archivedAt })
      .from(products)
      .where(eq(products.id, demoIds.product.certified));
    const [regulation] = await testDatabase.database
      .select({ archivedAt: regulations.archivedAt })
      .from(regulations)
      .where(eq(regulations.id, demoIds.regulation.chinaEffective));

    expect(country?.archivedAt).toBeNull();
    expect(jurisdiction?.archivedAt).toBeNull();
    expect(product?.archivedAt).toBeNull();
    expect(regulation?.archivedAt).toBeNull();
  });

  it("rejects archiving knowledge metadata parents used by published chunks", async () => {
    await seedDemoData(testDatabase.database);
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const admin = {
      email: "admin@example.test",
      role: "admin" as const,
    };
    const countryIso3 = "KDP";
    const jurisdictionId = "10000000-0000-4000-8000-000000000940";
    const countryChunkId = "10000000-0000-4000-8000-000000000941";
    const jurisdictionChunkId =
      "10000000-0000-4000-8000-000000000942";
    const verifiedAt = new Date("2026-08-06T00:00:00.000Z");

    await testDatabase.database.insert(countries).values({
      dataCoverageStatus: "demo",
      dataSourceId: demoIds.source.country,
      isDemo: true,
      iso2: "KD",
      iso3: countryIso3,
      nameEn: "Knowledge Dependency Country",
      verifiedAt,
    });
    await testDatabase.database.insert(jurisdictions).values({
      code: "KNOWLEDGE-DEPENDENCY-JURISDICTION",
      dataSourceId: demoIds.source.country,
      id: jurisdictionId,
      isDemo: true,
      name: "Knowledge Dependency Jurisdiction",
      type: "international",
      verifiedAt,
    });
    await testDatabase.database.insert(documentChunks).values([
      {
        chunkIndex: 910,
        content: "DEMO ONLY country metadata archive dependency.",
        contentHash: "a".repeat(64),
        countryIso3,
        documentId: demoIds.document.regulation,
        id: countryChunkId,
        isDemo: true,
        verifiedAt,
      },
      {
        chunkIndex: 911,
        content: "DEMO ONLY jurisdiction metadata archive dependency.",
        contentHash: "b".repeat(64),
        documentId: demoIds.document.regulation,
        id: jurisdictionChunkId,
        isDemo: true,
        jurisdictionId,
        verifiedAt,
      },
    ]);

    try {
      await expect(
        governanceRepository.archiveEntity({
          actor: admin,
          entityKey: countryIso3,
          entityType: "country",
          reason: "Attempt to orphan a published country-scoped chunk.",
        }),
      ).rejects.toThrow("published document chunks");
      await expect(
        governanceRepository.archiveEntity({
          actor: admin,
          entityKey: jurisdictionId,
          entityType: "jurisdiction",
          reason: "Attempt to orphan a published jurisdiction-scoped chunk.",
        }),
      ).rejects.toThrow("published document chunks");

      const [country] = await testDatabase.database
        .select({ archivedAt: countries.archivedAt })
        .from(countries)
        .where(eq(countries.iso3, countryIso3));
      const [jurisdiction] = await testDatabase.database
        .select({ archivedAt: jurisdictions.archivedAt })
        .from(jurisdictions)
        .where(eq(jurisdictions.id, jurisdictionId));

      expect(country?.archivedAt).toBeNull();
      expect(jurisdiction?.archivedAt).toBeNull();
    } finally {
      await testDatabase.database
        .delete(documentChunks)
        .where(
          inArray(documentChunks.id, [
            countryChunkId,
            jurisdictionChunkId,
          ]),
        );
      await testDatabase.database
        .delete(jurisdictions)
        .where(eq(jurisdictions.id, jurisdictionId));
      await testDatabase.database
        .delete(countries)
        .where(eq(countries.iso3, countryIso3));
    }
  });

  it("archives a regulation and its owned limits in one audit snapshot", async () => {
    await seedDemoData(testDatabase.database);
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const admin = {
      email: "admin@example.test",
      role: "admin" as const,
    };
    const jurisdictionId = "12000000-0000-4000-8000-000000000001";
    const regulationId = "12000000-0000-4000-8000-000000000002";
    const limitId = "12000000-0000-4000-8000-000000000003";

    await testDatabase.database.insert(jurisdictions).values({
      code: "ARCHIVE-REGULATION-AGGREGATE",
      countryIso3: "CHN",
      dataSourceId: demoIds.source.regulation,
      id: jurisdictionId,
      isDemo: true,
      name: "DEMO ONLY - Regulation archive aggregate",
      type: "country",
      verifiedAt: new Date("2026-08-05T00:00:00.000Z"),
    });
    await testDatabase.database.insert(regulations).values({
      canonicalName: "DEMO ONLY - Archived regulation aggregate",
      citationCode: "ARCHIVE-REGULATION-AGGREGATE",
      dataSourceId: demoIds.source.regulation,
      effectiveFrom: "2026-01-01",
      id: regulationId,
      isDemo: true,
      jurisdictionId,
      status: "effective",
      verifiedAt: new Date("2026-08-05T00:00:00.000Z"),
    });
    await testDatabase.database.insert(regulationLimits).values({
      applicationScope: "non-road",
      dataSourceId: demoIds.source.regulation,
      id: limitId,
      isDemo: true,
      limitValue: "1.000000",
      pollutantCode: "NOX",
      regulationId,
      unitCode: "g/kWh",
      validFrom: "2026-01-01",
      verifiedAt: new Date("2026-08-05T00:00:00.000Z"),
    });

    await governanceRepository.archiveEntity({
      actor: admin,
      entityKey: regulationId,
      entityType: "regulation",
      reason: "Archive the regulation aggregate and its owned limits.",
    });

    const [storedRegulation] = await testDatabase.database
      .select({ archivedAt: regulations.archivedAt })
      .from(regulations)
      .where(eq(regulations.id, regulationId));
    const [storedLimit] = await testDatabase.database
      .select({ archivedAt: regulationLimits.archivedAt })
      .from(regulationLimits)
      .where(eq(regulationLimits.id, limitId));
    const [log] = await testDatabase.database
      .select({
        afterData: dataChangeLogs.afterData,
        beforeData: dataChangeLogs.beforeData,
      })
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.action, "archived"),
          eq(dataChangeLogs.entityType, "regulation"),
          eq(dataChangeLogs.entityKey, regulationId),
        ),
      );

    expect(storedRegulation?.archivedAt).toBeInstanceOf(Date);
    expect(storedLimit?.archivedAt).toBeInstanceOf(Date);
    expect(log?.beforeData).toMatchObject({
      limits: [{ id: limitId, regulationId }],
      regulation: { id: regulationId },
    });
    expect(log?.afterData).toMatchObject({
      archivedLimits: [{ id: limitId }],
    });
  });

  it("records jurisdiction memberships affected by an archive", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const admin = {
      email: "admin@example.test",
      role: "admin" as const,
    };
    const jurisdictionId = "11000000-0000-4000-8000-000000000003";
    await testDatabase.database.insert(jurisdictions).values({
      code: "ARCHIVE-AUDIT-JUR",
      countryIso3: "CHN",
      dataSourceId: demoIds.source.country,
      id: jurisdictionId,
      isDemo: true,
      name: "DEMO ONLY — Archive audit jurisdiction",
      type: "country",
      verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
    });
    await testDatabase.database.insert(countryJurisdictions).values({
      countryIso3: "CHN",
      dataSourceId: demoIds.source.country,
      isDemo: true,
      jurisdictionId,
      validFrom: "2026-01-01",
      verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
    });

    await governanceRepository.archiveEntity({
      actor: admin,
      entityKey: jurisdictionId,
      entityType: "jurisdiction",
      reason: "Archive a jurisdiction with its membership snapshot.",
    });

    const [log] = await testDatabase.database
      .select({
        afterData: dataChangeLogs.afterData,
        beforeData: dataChangeLogs.beforeData,
      })
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.action, "archived"),
          eq(dataChangeLogs.entityType, "jurisdiction"),
          eq(dataChangeLogs.entityKey, jurisdictionId),
        ),
      );

    expect(log?.beforeData).toMatchObject({
      jurisdiction: { id: jurisdictionId },
      memberships: [
        { countryIso3: "CHN", jurisdictionId },
      ],
    });
    expect(log?.afterData).toMatchObject({
      archivedMemberships: [
        { countryIso3: "CHN", jurisdictionId },
      ],
    });
  });

  it("keeps an archived ready document from being published", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const admin = {
      email: "admin@example.test",
      role: "admin" as const,
    };
    const documentId = "10000000-0000-4000-8000-000000000934";
    await testDatabase.database.insert(documents).values({
      contentSha256: "9".repeat(64),
      dataSourceId: demoIds.source.country,
      demoNotice: "DEMO ONLY — archived document publication test.",
      id: documentId,
      isDemo: true,
      languageCode: "en",
      processedAt: new Date("2026-08-06T00:00:00.000Z"),
      processingStatus: "ready",
      title: "DEMO ONLY — Archived ready document",
      type: "regulation-text",
      verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
    });
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Create an archived document publication test draft.",
      entityKey: documentId,
      entityType: "document",
      payload: { documentId },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review the ready document before archival.",
    });
    await governanceRepository.archiveEntity({
      actor: admin,
      entityKey: documentId,
      entityType: "document",
      reason: "Archive the ready document before publication.",
    });

    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt to publish the archived ready document.",
      }),
    ).rejects.toThrow("cannot revive an archived formal entity");

    const [storedDraft] = await testDatabase.database
      .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
      .from(dataGovernanceDrafts)
      .where(eq(dataGovernanceDrafts.id, draft.id));
    const [storedDocument] = await testDatabase.database
      .select({ governanceStatus: documents.governanceStatus })
      .from(documents)
      .where(eq(documents.id, documentId));
    const [reviewAudit] = await testDatabase.database
      .select({
        afterData: dataChangeLogs.afterData,
        beforeData: dataChangeLogs.beforeData,
      })
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.action, "reviewed"),
          eq(dataChangeLogs.draftId, draft.id),
        ),
      );

    expect(storedDraft?.workflowStatus).toBe("reviewed");
    expect(storedDocument?.governanceStatus).toBe("reviewed");
    expect(reviewAudit?.beforeData).toMatchObject({
      document: {
        governanceStatus: "draft",
        processingStatus: "ready",
      },
      workflowStatus: "draft",
    });
    expect(reviewAudit?.afterData).toMatchObject({
      document: {
        governanceStatus: "reviewed",
        processingStatus: "ready",
      },
      workflowStatus: "reviewed",
    });
  });

  it("does not downgrade a published document through a duplicate draft", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const documentId = "10000000-0000-4000-8000-000000000935";
    const publishedAt = new Date("2026-08-06T00:00:00.000Z");
    await testDatabase.database.insert(documents).values({
      contentSha256: "8".repeat(64),
      dataSourceId: demoIds.source.country,
      demoNotice: "DEMO ONLY — published document downgrade test.",
      governancePublishedAt: publishedAt,
      governanceStatus: "published",
      id: documentId,
      isDemo: true,
      languageCode: "en",
      processedAt: publishedAt,
      processingStatus: "ready",
      reviewedAt: publishedAt,
      title: "DEMO ONLY — Published document downgrade test",
      type: "regulation-text",
      verifiedAt: publishedAt,
    });
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Create a duplicate published-document draft.",
      entityKey: documentId,
      entityType: "document",
      payload: { documentId },
    });

    await expect(
      governanceRepository.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt to downgrade the published document.",
      }),
    ).rejects.toThrow("ready draft document");

    const [storedDocument] = await testDatabase.database
      .select({ governanceStatus: documents.governanceStatus })
      .from(documents)
      .where(eq(documents.id, documentId));
    const [storedDraft] = await testDatabase.database
      .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
      .from(dataGovernanceDrafts)
      .where(eq(dataGovernanceDrafts.id, draft.id));

    expect(storedDocument?.governanceStatus).toBe("published");
    expect(storedDraft?.workflowStatus).toBe("draft");
  });

  it("rejects document publication after its evidence source is archived", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const admin = {
      email: "admin@example.test",
      role: "admin" as const,
    };
    const sourceId = "10000000-0000-4000-8000-000000000936";
    const documentId = "10000000-0000-4000-8000-000000000937";
    const verifiedAt = new Date("2026-08-06T00:00:00.000Z");
    await testDatabase.database.insert(dataSources).values({
      demoNotice: "DEMO ONLY — document source dependency test.",
      id: sourceId,
      isDemo: true,
      sourceType: "demo",
      title: "DEMO ONLY — Document source dependency",
      verifiedAt,
    });
    await testDatabase.database.insert(documents).values({
      contentSha256: "7".repeat(64),
      dataSourceId: sourceId,
      demoNotice: "DEMO ONLY — document source dependency test.",
      id: documentId,
      isDemo: true,
      languageCode: "en",
      processedAt: verifiedAt,
      processingStatus: "ready",
      title: "DEMO ONLY — Document source dependency",
      type: "regulation-text",
      verifiedAt,
    });
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Create a document source dependency test draft.",
      entityKey: documentId,
      entityType: "document",
      payload: { documentId },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review the document before source archival.",
    });
    await governanceRepository.archiveEntity({
      actor: admin,
      entityKey: sourceId,
      entityType: "data_source",
      reason: "Archive the document evidence source.",
    });

    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt publication with an archived source.",
      }),
    ).rejects.toThrow(
      "A first governance revision cannot revive an archived formal entity.",
    );

    const [storedDocument] = await testDatabase.database
      .select({ governanceStatus: documents.governanceStatus })
      .from(documents)
      .where(eq(documents.id, documentId));
    expect(storedDocument?.governanceStatus).toBe("reviewed");
  });

  it("rejects document publication after a chunk metadata parent is archived", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const admin = {
      email: "admin@example.test",
      role: "admin" as const,
    };
    const countryIso3 = "KPB";
    const documentId = "10000000-0000-4000-8000-000000000943";
    const chunkId = "10000000-0000-4000-8000-000000000944";
    const verifiedAt = new Date("2026-08-06T00:00:00.000Z");

    await testDatabase.database.insert(countries).values({
      dataCoverageStatus: "demo",
      dataSourceId: demoIds.source.country,
      isDemo: true,
      iso2: "ZZ",
      iso3: countryIso3,
      nameEn: "Knowledge Publication Boundary Country",
      verifiedAt,
    });
    await testDatabase.database.insert(documents).values({
      contentSha256: "ef".repeat(32),
      dataSourceId: demoIds.source.country,
      demoNotice: "DEMO ONLY — chunk metadata parent publication test.",
      id: documentId,
      isDemo: true,
      languageCode: "en",
      processedAt: verifiedAt,
      processingStatus: "ready",
      title: "DEMO ONLY — Chunk metadata parent publication test",
      type: "regulation-text",
      verifiedAt,
    });
    await testDatabase.database.insert(documentChunks).values({
      chunkIndex: 0,
      content: "DEMO ONLY chunk with a governed country parent.",
      contentHash: "d".repeat(64),
      countryIso3,
      documentId,
      id: chunkId,
      isDemo: true,
      verifiedAt,
    });
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Create a chunk metadata parent publication test.",
      entityKey: documentId,
      entityType: "document",
      payload: { documentId },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review the document before archiving its metadata parent.",
    });
    await governanceRepository.archiveEntity({
      actor: admin,
      entityKey: countryIso3,
      entityType: "country",
      reason: "Archive an unused parent before document publication.",
    });

    try {
      await expect(
        governanceRepository.publishDraft({
          actor: reviewer,
          draftId: draft.id,
          reason: "Attempt publication with an archived chunk parent.",
        }),
      ).rejects.toThrow(
        "Referenced countries or their sources are missing or archived",
      );

      const [storedDocument] = await testDatabase.database
        .select({ governanceStatus: documents.governanceStatus })
        .from(documents)
        .where(eq(documents.id, documentId));
      const [storedDraft] = await testDatabase.database
        .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
        .from(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.id, draft.id));

      expect(storedDocument?.governanceStatus).toBe("reviewed");
      expect(storedDraft?.workflowStatus).toBe("reviewed");
    } finally {
      await testDatabase.database
        .delete(dataChangeLogs)
        .where(
          or(
            eq(dataChangeLogs.draftId, draft.id),
            and(
              eq(dataChangeLogs.entityType, "country"),
              eq(dataChangeLogs.entityKey, countryIso3),
            ),
          ),
        );
      await testDatabase.database
        .delete(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.id, draft.id));
      await testDatabase.database
        .delete(documents)
        .where(eq(documents.id, documentId));
      await testDatabase.database
        .delete(countries)
        .where(eq(countries.iso3, countryIso3));
    }
  });

  it("serializes document publication against chunk parent archival", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const admin = {
      email: "admin@example.test",
      role: "admin" as const,
    };
    const countryIso3 = "KPC";
    const documentId = "10000000-0000-4000-8000-000000000945";
    const chunkId = "10000000-0000-4000-8000-000000000946";
    const verifiedAt = new Date("2026-08-06T00:00:00.000Z");

    await testDatabase.database.insert(countries).values({
      dataCoverageStatus: "demo",
      dataSourceId: demoIds.source.country,
      isDemo: true,
      iso2: "ZY",
      iso3: countryIso3,
      nameEn: "Knowledge Publication Concurrency Country",
      verifiedAt,
    });
    await testDatabase.database.insert(documents).values({
      contentSha256: "01".repeat(32),
      dataSourceId: demoIds.source.country,
      demoNotice: "DEMO ONLY — chunk parent concurrency test.",
      id: documentId,
      isDemo: true,
      languageCode: "en",
      processedAt: verifiedAt,
      processingStatus: "ready",
      title: "DEMO ONLY — Chunk parent concurrency test",
      type: "regulation-text",
      verifiedAt,
    });
    await testDatabase.database.insert(documentChunks).values({
      chunkIndex: 0,
      content: "DEMO ONLY chunk parent concurrency evidence.",
      contentHash: "02".repeat(32),
      countryIso3,
      documentId,
      id: chunkId,
      isDemo: true,
      verifiedAt,
    });
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Create a chunk parent concurrency draft.",
      entityKey: documentId,
      entityType: "document",
      payload: { documentId },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review the document before the concurrency check.",
    });

    try {
      const results = await Promise.allSettled([
        governanceRepository.publishDraft({
          actor: reviewer,
          draftId: draft.id,
          reason: "Publish while the chunk parent may be archived.",
        }),
        governanceRepository.archiveEntity({
          actor: admin,
          entityKey: countryIso3,
          entityType: "country",
          reason: "Archive while a dependent document may be published.",
        }),
      ]);
      const [country] = await testDatabase.database
        .select({ archivedAt: countries.archivedAt })
        .from(countries)
        .where(eq(countries.iso3, countryIso3));
      const [storedDocument] = await testDatabase.database
        .select({ governanceStatus: documents.governanceStatus })
        .from(documents)
        .where(eq(documents.id, documentId));
      const [storedDraft] = await testDatabase.database
        .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
        .from(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.id, draft.id));

      expect(
        results.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter(({ status }) => status === "rejected"),
      ).toHaveLength(1);
      if (storedDocument?.governanceStatus === "published") {
        expect(country?.archivedAt).toBeNull();
        expect(storedDraft?.workflowStatus).toBe("published");
      } else {
        expect(storedDocument?.governanceStatus).toBe("reviewed");
        expect(storedDraft?.workflowStatus).toBe("reviewed");
        expect(country?.archivedAt).not.toBeNull();
      }
    } finally {
      await testDatabase.database
        .delete(dataChangeLogs)
        .where(
          or(
            eq(dataChangeLogs.draftId, draft.id),
            and(
              eq(dataChangeLogs.entityType, "country"),
              eq(dataChangeLogs.entityKey, countryIso3),
            ),
          ),
        );
      await testDatabase.database
        .delete(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.id, draft.id));
      await testDatabase.database
        .delete(documents)
        .where(eq(documents.id, documentId));
      await testDatabase.database
        .delete(countries)
        .where(eq(countries.iso3, countryIso3));
    }
  });

  it("rejects non-demo document chunks attached to demo metadata parents", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const documentId = "10000000-0000-4000-8000-000000000947";
    const chunkId = "10000000-0000-4000-8000-000000000948";
    const verifiedAt = new Date("2026-08-06T00:00:00.000Z");

    await testDatabase.database.insert(documents).values({
      contentSha256: "03".repeat(32),
      dataSourceId: demoIds.source.countryDirectory,
      id: documentId,
      isDemo: false,
      languageCode: "en",
      processedAt: verifiedAt,
      processingStatus: "ready",
      title: "Non-demo chunk parent classification test",
      type: "regulation-text",
      verifiedAt,
    });
    await testDatabase.database.insert(documentChunks).values({
      chunkIndex: 0,
      content: "Non-demo chunk attached to a demo country.",
      contentHash: "04".repeat(32),
      countryIso3: "CHN",
      documentId,
      id: chunkId,
      isDemo: false,
      verifiedAt,
    });
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Create a chunk parent classification draft.",
      entityKey: documentId,
      entityType: "document",
      payload: { documentId },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review the chunk parent classification draft.",
    });

    try {
      await expect(
        governanceRepository.publishDraft({
          actor: reviewer,
          draftId: draft.id,
          reason: "Attempt to publish a misclassified chunk parent.",
        }),
      ).rejects.toThrow(
        "Non-demo facts cannot reference demo countries: document chunk",
      );

      const [storedDocument] = await testDatabase.database
        .select({ governanceStatus: documents.governanceStatus })
        .from(documents)
        .where(eq(documents.id, documentId));
      expect(storedDocument?.governanceStatus).toBe("reviewed");
    } finally {
      await testDatabase.database
        .delete(dataChangeLogs)
        .where(eq(dataChangeLogs.draftId, draft.id));
      await testDatabase.database
        .delete(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.id, draft.id));
      await testDatabase.database
        .delete(documents)
        .where(eq(documents.id, documentId));
    }
  });

  it("rejects demo source reclassification with a published non-demo document", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const sourceId = "10000000-0000-4000-8000-000000000938";
    const documentId = "10000000-0000-4000-8000-000000000939";
    const verifiedAt = new Date("2026-08-06T00:00:00.000Z");
    await testDatabase.database.insert(dataSources).values({
      id: sourceId,
      isDemo: false,
      sourceType: "other",
      title: "Published non-demo document source",
      verifiedAt,
    });
    await testDatabase.database.insert(documents).values({
      contentSha256: "6".repeat(64),
      dataSourceId: sourceId,
      governancePublishedAt: verifiedAt,
      governanceStatus: "published",
      id: documentId,
      isDemo: false,
      languageCode: "en",
      processedAt: verifiedAt,
      processingStatus: "ready",
      reviewedAt: verifiedAt,
      title: "Published non-demo document",
      type: "regulation-text",
      verifiedAt,
    });
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Attempt document source reclassification.",
      entityKey: sourceId,
      entityType: "data_source",
      payload: {
        demoNotice: "DEMO ONLY — reclassification test.",
        id: sourceId,
        isDemo: true,
        publishedOn: null,
        publisher: null,
        sourceType: "demo",
        title: "DEMO ONLY — Reclassified document source",
        url: null,
        verifiedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review document source reclassification rejection.",
    });

    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt document source reclassification publication.",
      }),
    ).rejects.toThrow("active non-demo dependents: documents");

    const [storedSource] = await testDatabase.database
      .select({ isDemo: dataSources.isDemo })
      .from(dataSources)
      .where(eq(dataSources.id, sourceId));
    expect(storedSource?.isDemo).toBe(false);
  });

  it("rejects an invalid CSV batch without writing drafts or market facts", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const beforeDrafts = await testDatabase.database
      .select({ count: sql<number>`count(*)::int` })
      .from(dataGovernanceDrafts);
    const beforeFacts = await testDatabase.database
      .select({ count: sql<number>`count(*)::int` })
      .from(marketMetrics);
    const batch = await governanceRepository.createMarketImportPreview({
      actor: editor,
      contentSha256: "e".repeat(64),
      errors: [
        {
          field: "valueNumeric",
          message: "Expected number",
          rowNumber: 2,
        },
      ],
      fileName: "invalid-demo.csv",
      rows: [{ parsed: null, rowNumber: 2 }],
    });

    const result = await governanceRepository.confirmMarketImport({
      actor: editor,
      batchId: batch.id,
      reason: "Attempt to confirm an invalid test batch.",
    });
    const afterDrafts = await testDatabase.database
      .select({ count: sql<number>`count(*)::int` })
      .from(dataGovernanceDrafts);
    const afterFacts = await testDatabase.database
      .select({ count: sql<number>`count(*)::int` })
      .from(marketMetrics);
    const [storedBatch] = await testDatabase.database
      .select()
      .from(marketImportBatches)
      .where(eq(marketImportBatches.id, batch.id));

    expect(result).toEqual({ createdDrafts: 0, status: "rejected" });
    expect(afterDrafts[0]?.count).toBe(beforeDrafts[0]?.count);
    expect(afterFacts[0]?.count).toBe(beforeFacts[0]?.count);
    expect(storedBatch?.status).toBe("rejected");
  });

  it("rejects a CSV preview that has validation errors but no parsed rows", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const beforeDrafts = await testDatabase.database
      .select({ count: sql<number>`count(*)::int` })
      .from(dataGovernanceDrafts);
    const batch = await governanceRepository.createMarketImportPreview({
      actor: editor,
      contentSha256: "d".repeat(64),
      errors: [
        {
          field: null,
          message: "CSV 至少需要一行数据。",
          rowNumber: 2,
        },
      ],
      fileName: "header-only.csv",
      rows: [],
    });

    const result = await governanceRepository.confirmMarketImport({
      actor: editor,
      batchId: batch.id,
      reason: "Reject a header-only test batch.",
    });
    const afterDrafts = await testDatabase.database
      .select({ count: sql<number>`count(*)::int` })
      .from(dataGovernanceDrafts);
    const [storedBatch] = await testDatabase.database
      .select()
      .from(marketImportBatches)
      .where(eq(marketImportBatches.id, batch.id));

    expect(batch).toMatchObject({
      invalidRows: 1,
      totalRows: 1,
      validRows: 0,
    });
    expect(result).toEqual({ createdDrafts: 0, status: "rejected" });
    expect(afterDrafts[0]?.count).toBe(beforeDrafts[0]?.count);
    expect(storedBatch?.status).toBe("rejected");
  });

  it("confirms a valid CSV preview atomically as unpublished drafts", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const beforeFacts = await testDatabase.database
      .select({ count: sql<number>`count(*)::int` })
      .from(marketMetrics);
    const batch = await governanceRepository.createMarketImportPreview({
      actor: editor,
      contentSha256: "f".repeat(64),
      errors: [],
      fileName: "valid-demo.csv",
      rows: [
        {
          parsed: {
            applicationScope: "non-road",
            countryIso3: "CHN",
            currencyCode: null,
            dataSourceId: demoIds.source.market,
            definition: "DEMO ONLY — governed CSV test metric.",
            isDemo: true,
            methodologyVersion: "demo-v1",
            metricCode: "DEMO_GOVERNED_IMPORT",
            metricName: "DEMO ONLY — Governed import",
            periodEnd: "2026-01-01",
            periodStart: "2025-01-01",
            publishedOn: "2026-01-02",
            unitCode: "units",
            valueNumeric: "12",
            verifiedAt: "2026-07-29T00:00:00.000Z",
          },
          rowNumber: 2,
        },
      ],
    });

    const result = await governanceRepository.confirmMarketImport({
      actor: editor,
      batchId: batch.id,
      reason: "Confirm a validated test batch.",
    });
    const afterFacts = await testDatabase.database
      .select({ count: sql<number>`count(*)::int` })
      .from(marketMetrics);
    const importedDrafts = await testDatabase.database
      .select()
      .from(dataGovernanceDrafts)
      .where(eq(dataGovernanceDrafts.entityType, "market_metric"));

    expect(result).toEqual({ createdDrafts: 1, status: "committed" });
    expect(afterFacts[0]?.count).toBe(beforeFacts[0]?.count);
    expect(
      importedDrafts.some(
        ({ workflowStatus }) => workflowStatus === "draft",
      ),
    ).toBe(true);
  });

  it("rejects duplicate market natural keys without changing the existing fact", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const existingId = "10000000-0000-4000-8000-000000000932";
    const duplicateId = "10000000-0000-4000-8000-000000000933";
    const naturalKey = {
      applicationScope: null,
      countryIso3: "CHN",
      dataSourceId: demoIds.source.market,
      metricCode: "DEMO_GOVERNANCE_NATURAL_KEY",
      periodEnd: "2026-01-01",
      periodStart: "2025-01-01",
    };
    await testDatabase.database.insert(marketMetrics).values({
      ...naturalKey,
      definition: "DEMO ONLY — existing natural-key observation.",
      id: existingId,
      isDemo: true,
      methodologyVersion: "demo-v1",
      metricName: "DEMO ONLY — Existing natural-key observation",
      publishedOn: null,
      unitCode: "units",
      valueNumeric: "10.000000",
      verifiedAt: new Date("2026-08-06T00:00:00.000Z"),
    });
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Create a duplicate natural-key test draft.",
      entityKey: duplicateId,
      entityType: "market_metric",
      payload: {
        ...naturalKey,
        definition: "DEMO ONLY — conflicting natural-key observation.",
        id: duplicateId,
        isDemo: true,
        methodologyVersion: "demo-v1",
        metricName: "DEMO ONLY — Conflicting natural-key observation",
        publishedOn: null,
        unitCode: "units",
        valueNumeric: "99",
        verifiedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review the duplicate natural-key test draft.",
    });

    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt duplicate natural-key publication.",
      }),
    ).rejects.toThrow(
      `natural key already belongs to entity ${existingId}`,
    );

    const [storedDraft] = await testDatabase.database
      .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
      .from(dataGovernanceDrafts)
      .where(eq(dataGovernanceDrafts.id, draft.id));
    const storedMetrics = await testDatabase.database
      .select({ id: marketMetrics.id, valueNumeric: marketMetrics.valueNumeric })
      .from(marketMetrics)
      .where(eq(marketMetrics.metricCode, naturalKey.metricCode));

    expect(storedDraft?.workflowStatus).toBe("reviewed");
    expect(storedMetrics).toEqual([
      { id: existingId, valueNumeric: "10.000000" },
    ]);
  });

  it("serializes concurrent confirmation of the same CSV preview", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const beforeDrafts = await testDatabase.database
      .select({ count: sql<number>`count(*)::int` })
      .from(dataGovernanceDrafts);
    const batch = await governanceRepository.createMarketImportPreview({
      actor: editor,
      contentSha256: "c".repeat(64),
      errors: [],
      fileName: "concurrent-valid-demo.csv",
      rows: [
        {
          parsed: {
            applicationScope: "non-road",
            countryIso3: "CHN",
            currencyCode: null,
            dataSourceId: demoIds.source.market,
            definition: "DEMO ONLY — concurrent confirmation test.",
            isDemo: true,
            methodologyVersion: "demo-v1",
            metricCode: "DEMO_CONCURRENT_IMPORT",
            metricName: "DEMO ONLY — Concurrent import",
            periodEnd: "2026-01-01",
            periodStart: "2025-01-01",
            publishedOn: null,
            unitCode: "units",
            valueNumeric: "1",
            verifiedAt: "2026-07-29T00:00:00.000Z",
          },
          rowNumber: 2,
        },
      ],
    });

    const confirmations = await Promise.allSettled([
      governanceRepository.confirmMarketImport({
        actor: editor,
        batchId: batch.id,
        reason: "Confirm the concurrent test batch once.",
      }),
      governanceRepository.confirmMarketImport({
        actor: editor,
        batchId: batch.id,
        reason: "Attempt duplicate concurrent confirmation.",
      }),
    ]);
    const afterDrafts = await testDatabase.database
      .select({ count: sql<number>`count(*)::int` })
      .from(dataGovernanceDrafts);
    const [storedBatch] = await testDatabase.database
      .select({ status: marketImportBatches.status })
      .from(marketImportBatches)
      .where(eq(marketImportBatches.id, batch.id));

    expect(
      confirmations.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      confirmations.filter(({ status }) => status === "rejected"),
    ).toHaveLength(1);
    expect(afterDrafts[0]?.count).toBe((beforeDrafts[0]?.count ?? 0) + 1);
    expect(storedBatch?.status).toBe("committed");
  });

  it("rejects publication when a regulation limit source is archived", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const archivedSourceId = "10000000-0000-4000-8000-000000000905";
    const regulationId = "10000000-0000-4000-8000-000000000906";

    await testDatabase.database.insert(dataSources).values({
      archivedAt: new Date("2026-08-06T00:00:00.000Z"),
      demoNotice: "DEMO ONLY — archived publish dependency test.",
      id: archivedSourceId,
      isDemo: true,
      publisher: "Demo Data Team",
      sourceType: "demo",
      title: "DEMO ONLY — Archived publish dependency",
      verifiedAt: new Date("2026-08-05T00:00:00.000Z"),
    });

    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Test archived source publication rejection.",
      entityKey: regulationId,
      entityType: "regulation",
      payload: {
        adoptedOn: "2026-01-01",
        canonicalName: "DEMO ONLY — Archived-source regulation",
        citationCode: "DEMO-ARCHIVED-SOURCE",
        dataSourceId: demoIds.source.regulation,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        id: regulationId,
        isDemo: true,
        jurisdictionId: demoIds.jurisdiction.china,
        limits: [
          {
            applicationScope: "non-road",
            dataSourceId: archivedSourceId,
            engineTypeCode: "CI",
            id: "10000000-0000-4000-8000-000000000907",
            isDemo: true,
            limitValue: "1",
            measurementBasis: "DEMO ONLY",
            pollutantCode: "NOX",
            powerMaxKw: null,
            powerMinKw: null,
            testCycleCode: "DEMO",
            unitCode: "g/kWh",
            validFrom: "2026-01-01",
            validTo: null,
            verifiedAt: "2026-08-05T00:00:00.000Z",
          },
        ],
        proposedOn: null,
        status: "effective",
        summary: "DEMO ONLY — must not publish.",
        verifiedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review archived source publication rejection.",
    });

    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt archived source publication.",
      }),
    ).rejects.toThrow("Referenced data sources are missing or archived");

    const [storedDraft] = await testDatabase.database
      .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
      .from(dataGovernanceDrafts)
      .where(eq(dataGovernanceDrafts.id, draft.id));
    const [publishedRegulation] = await testDatabase.database
      .select({ id: regulations.id })
      .from(regulations)
      .where(eq(regulations.id, regulationId));

    expect(storedDraft?.workflowStatus).toBe("reviewed");
    expect(publishedRegulation).toBeUndefined();
  });

  it("publishes explicitly documented regulation metadata with zero numeric limits", async () => {
    await seedDemoData(testDatabase.database);
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const regulationId = "10000000-0000-4000-8000-000000000920";

    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Test an explicitly documented zero-limit regulation.",
      entityKey: regulationId,
      entityType: "regulation",
      payload: {
        adoptedOn: "2026-01-01",
        canonicalName: "DEMO ONLY — Effective metadata with unavailable limits",
        citationCode: "DEMO-ZERO-LIMIT",
        dataSourceId: demoIds.source.regulation,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        id: regulationId,
        isDemo: true,
        jurisdictionId: demoIds.jurisdiction.china,
        limits: [],
        limitsUnavailable: true,
        proposedOn: null,
        status: "effective",
        summary:
          "DEMO ONLY — the official table has a documented source conflict.",
        verifiedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review the documented zero-limit regulation.",
    });
    await governanceRepository.publishDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Publish the documented zero-limit regulation metadata.",
    });

    const [storedRegulation, storedLimits] = await Promise.all([
      testDatabase.database
        .select({ id: regulations.id, status: regulations.status })
        .from(regulations)
        .where(eq(regulations.id, regulationId)),
      testDatabase.database
        .select({ id: regulationLimits.id })
        .from(regulationLimits)
        .where(
          and(
            eq(regulationLimits.regulationId, regulationId),
            isNull(regulationLimits.archivedAt),
          ),
        ),
    ]);

    expect(storedRegulation).toEqual([
      { id: regulationId, status: "effective" },
    ]);
    expect(storedLimits).toEqual([]);
  });

  it("rejects publication when a regulation jurisdiction is archived", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const jurisdictionId = "10000000-0000-4000-8000-000000000908";
    const regulationId = "10000000-0000-4000-8000-000000000909";

    await testDatabase.database.insert(jurisdictions).values({
      archivedAt: new Date("2026-08-06T00:00:00.000Z"),
      code: "DEMO-ARCHIVED-JURISDICTION",
      countryIso3: "CHN",
      dataSourceId: demoIds.source.regulation,
      id: jurisdictionId,
      isDemo: true,
      name: "DEMO ONLY — Archived jurisdiction dependency",
      type: "country",
      verifiedAt: new Date("2026-08-05T00:00:00.000Z"),
    });

    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Test archived jurisdiction publication rejection.",
      entityKey: regulationId,
      entityType: "regulation",
      payload: {
        adoptedOn: "2026-01-01",
        canonicalName: "DEMO ONLY — Archived-jurisdiction regulation",
        citationCode: "DEMO-ARCHIVED-JURISDICTION",
        dataSourceId: demoIds.source.regulation,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        id: regulationId,
        isDemo: true,
        jurisdictionId,
        limits: [
          {
            applicationScope: "non-road",
            dataSourceId: demoIds.source.regulation,
            engineTypeCode: "CI",
            id: "10000000-0000-4000-8000-000000000910",
            isDemo: true,
            limitValue: "1",
            measurementBasis: "DEMO ONLY",
            pollutantCode: "NOX",
            powerMaxKw: null,
            powerMinKw: null,
            testCycleCode: "DEMO",
            unitCode: "g/kWh",
            validFrom: "2026-01-01",
            validTo: null,
            verifiedAt: "2026-08-05T00:00:00.000Z",
          },
        ],
        proposedOn: null,
        status: "effective",
        summary: "DEMO ONLY — must not publish.",
        verifiedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review archived jurisdiction rejection.",
    });

    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt archived jurisdiction publication.",
      }),
    ).rejects.toThrow(
      "Referenced jurisdictions or their sources are missing or archived",
    );

    const [publishedRegulation] = await testDatabase.database
      .select({ id: regulations.id })
      .from(regulations)
      .where(eq(regulations.id, regulationId));

    expect(publishedRegulation).toBeUndefined();
  });

  it("rejects publication when a parent entity source is archived", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const archivedSourceId = "10000000-0000-4000-8000-000000000911";
    const marketMetricId = "10000000-0000-4000-8000-000000000912";

    await testDatabase.database.insert(dataSources).values({
      archivedAt: new Date("2026-08-06T00:00:00.000Z"),
      demoNotice: "DEMO ONLY — archived country-source dependency test.",
      id: archivedSourceId,
      isDemo: true,
      publisher: "Demo Data Team",
      sourceType: "demo",
      title: "DEMO ONLY — Archived country source dependency",
      verifiedAt: new Date("2026-08-05T00:00:00.000Z"),
    });
    await testDatabase.database.insert(countries).values({
      dataCoverageStatus: "demo",
      dataSourceId: archivedSourceId,
      isDemo: true,
      iso2: "XZ",
      iso3: "XZZ",
      nameEn: "DEMO ONLY — Archived-source country",
      verifiedAt: new Date("2026-08-05T00:00:00.000Z"),
    });

    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Test archived parent-source publication rejection.",
      entityKey: marketMetricId,
      entityType: "market_metric",
      payload: {
        applicationScope: "non-road",
        countryIso3: "XZZ",
        currencyCode: null,
        dataSourceId: demoIds.source.market,
        definition: "DEMO ONLY — must not publish.",
        id: marketMetricId,
        isDemo: true,
        methodologyVersion: "demo-v1",
        metricCode: "DEMO_ARCHIVED_PARENT_SOURCE",
        metricName: "DEMO ONLY — Archived parent source",
        periodEnd: "2026-01-01",
        periodStart: "2025-01-01",
        publishedOn: null,
        unitCode: "units",
        valueNumeric: "1",
        verifiedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review archived parent-source rejection.",
    });

    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt archived parent-source publication.",
      }),
    ).rejects.toThrow(
      "Referenced countries or their sources are missing or archived",
    );

    const [publishedMetric] = await testDatabase.database
      .select({ id: marketMetrics.id })
      .from(marketMetrics)
      .where(eq(marketMetrics.id, marketMetricId));

    expect(publishedMetric).toBeUndefined();
  });

  it("rejects non-demo facts backed by demo sources", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Test demo-source classification rejection.",
      entityKey: "XZY",
      entityType: "country",
      payload: {
        dataCoverageStatus: "covered",
        dataSourceId: demoIds.source.country,
        isDemo: false,
        iso2: "XY",
        iso3: "XZY",
        nameEn: "Misclassified test country",
        nameLocal: null,
        regionCode: "TEST",
        subregionCode: "TEST",
        verifiedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review demo-source classification rejection.",
    });

    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt misclassified country publication.",
      }),
    ).rejects.toThrow(
      "Non-demo facts cannot reference demo sources: country",
    );

    const [publishedCountry] = await testDatabase.database
      .select({ iso3: countries.iso3 })
      .from(countries)
      .where(eq(countries.iso3, "XZY"));

    expect(publishedCountry).toBeUndefined();
  });

  it("rejects market metrics backed by official regulation sources", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const metricId = "10000000-0000-4000-8000-000000000917";
    const sourceId = "10000000-0000-4000-8000-000000000918";
    await testDatabase.database.insert(dataSources).values({
      id: sourceId,
      isDemo: false,
      sourceType: "official-regulation",
      title: "Invalid market regulation source",
      verifiedAt: new Date("2026-08-05T00:00:00.000Z"),
    });
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Test market source classification rejection.",
      entityKey: metricId,
      entityType: "market_metric",
      payload: {
        applicationScope: "on-road-truck",
        countryIso3: "CHN",
        currencyCode: null,
        dataSourceId: sourceId,
        definition: "Market observation with an invalid regulation source.",
        id: metricId,
        isDemo: false,
        methodologyVersion: "test-v1",
        metricCode: "INVALID_REGULATION_SOURCE",
        metricName: "Invalid regulation source metric",
        periodEnd: "2024-01-01",
        periodStart: "2023-01-01",
        publishedOn: null,
        unitCode: "vehicle",
        valueNumeric: "1",
        verifiedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review market source classification rejection.",
    });

    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt invalid market source publication.",
      }),
    ).rejects.toThrow(
      "Market metrics cannot reference official-regulation sources",
    );
    await testDatabase.database
      .delete(dataSources)
      .where(eq(dataSources.id, sourceId));
  });

  it("rejects non-demo facts attached to demo parent entities", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const marketMetricId = "10000000-0000-4000-8000-000000000913";
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Test demo-parent classification rejection.",
      entityKey: marketMetricId,
      entityType: "market_metric",
      payload: {
        applicationScope: "non-road",
        countryIso3: "CHN",
        currencyCode: null,
        dataSourceId: demoIds.source.countryDirectory,
        definition: "Must not publish on a demo parent.",
        id: marketMetricId,
        isDemo: false,
        methodologyVersion: "test-v1",
        metricCode: "DEMO_PARENT_CLASSIFICATION",
        metricName: "Demo parent classification test",
        periodEnd: "2026-01-01",
        periodStart: "2025-01-01",
        publishedOn: null,
        unitCode: "units",
        valueNumeric: "1",
        verifiedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review demo-parent classification rejection.",
    });

    await expect(
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Attempt demo-parent publication.",
      }),
    ).rejects.toThrow(
      "Non-demo facts cannot reference demo countries: market metric",
    );

    const [publishedMetric] = await testDatabase.database
      .select({ id: marketMetrics.id })
      .from(marketMetrics)
      .where(eq(marketMetrics.id, marketMetricId));

    expect(publishedMetric).toBeUndefined();
  });

  it("rejects demo parent payloads with non-demo embedded facts", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const regulationId = "10000000-0000-4000-8000-000000000914";
    const jurisdictionId = "10000000-0000-4000-8000-000000000916";
    const regulationDraft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Test embedded regulation-limit classification.",
      entityKey: regulationId,
      entityType: "regulation",
      payload: {
        adoptedOn: "2026-01-01",
        canonicalName: "DEMO ONLY — Mixed-classification regulation",
        citationCode: "DEMO-MIXED-LIMIT",
        dataSourceId: demoIds.source.regulation,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        id: regulationId,
        isDemo: true,
        jurisdictionId: demoIds.jurisdiction.china,
        limits: [
          {
            applicationScope: "non-road",
            dataSourceId: demoIds.source.countryDirectory,
            engineTypeCode: "CI",
            id: "10000000-0000-4000-8000-000000000915",
            isDemo: false,
            limitValue: "1",
            measurementBasis: "Must not publish.",
            pollutantCode: "NOX",
            powerMaxKw: null,
            powerMinKw: null,
            testCycleCode: "TEST",
            unitCode: "g/kWh",
            validFrom: "2026-01-01",
            validTo: null,
            verifiedAt: "2026-08-05T00:00:00.000Z",
          },
        ],
        proposedOn: null,
        status: "effective",
        summary: "DEMO ONLY — must not publish.",
        verifiedAt: "2026-08-05T00:00:00.000Z",
      },
    });
    const jurisdictionDraft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Test embedded membership classification.",
      entityKey: jurisdictionId,
      entityType: "jurisdiction",
      payload: {
        code: "DEMO-MIXED-MEMBERSHIP",
        countryIso3: null,
        dataSourceId: demoIds.source.regulation,
        id: jurisdictionId,
        isDemo: true,
        memberships: [
          {
            countryIso3: "USA",
            dataSourceId: demoIds.source.countryDirectory,
            isDemo: false,
            validFrom: "2026-01-01",
            validTo: null,
            verifiedAt: "2026-08-05T00:00:00.000Z",
          },
        ],
        name: "DEMO ONLY — Mixed-classification jurisdiction",
        type: "regional",
        verifiedAt: "2026-08-05T00:00:00.000Z",
        websiteUrl: null,
      },
    });

    for (const draft of [regulationDraft, jurisdictionDraft]) {
      await governanceRepository.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Review embedded classification rejection.",
      });
      await expect(
        governanceRepository.publishDraft({
          actor: reviewer,
          draftId: draft.id,
          reason: "Attempt embedded mixed-classification publication.",
        }),
      ).rejects.toThrow("cannot have active non-demo dependents");
    }
  });

  it("rejects reclassifying parents while active non-demo dependents exist", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const sourceId = "10000000-0000-4000-8000-000000000917";
    const countryIso3 = "NDP";
    const jurisdictionId = "10000000-0000-4000-8000-000000000918";
    const regulationId = "10000000-0000-4000-8000-000000000919";
    const limitId = "10000000-0000-4000-8000-000000000920";
    const productId = "10000000-0000-4000-8000-000000000921";
    const certificationId = "10000000-0000-4000-8000-000000000922";
    const marketMetricId = "10000000-0000-4000-8000-000000000923";
    const verifiedAt = new Date("2026-08-05T00:00:00.000Z");

    await testDatabase.database.insert(dataSources).values({
      id: sourceId,
      isDemo: false,
      sourceType: "other",
      title: "Non-demo parent reclassification source",
      verifiedAt,
    });
    await testDatabase.database.insert(countries).values({
      dataCoverageStatus: "covered",
      dataSourceId: sourceId,
      isDemo: false,
      iso2: "QZ",
      iso3: countryIso3,
      nameEn: "Non-demo parent test country",
      verifiedAt,
    });
    await testDatabase.database.insert(jurisdictions).values({
      code: "NON-DEMO-PARENT",
      countryIso3,
      dataSourceId: sourceId,
      id: jurisdictionId,
      isDemo: false,
      name: "Non-demo parent test jurisdiction",
      type: "country",
      verifiedAt,
    });
    await testDatabase.database.insert(countryJurisdictions).values({
      countryIso3,
      dataSourceId: sourceId,
      isDemo: false,
      jurisdictionId,
      validFrom: "2026-01-01",
      verifiedAt,
    });
    await testDatabase.database.insert(regulations).values({
      canonicalName: "Non-demo parent test regulation",
      citationCode: "NON-DEMO-PARENT",
      dataSourceId: sourceId,
      effectiveFrom: "2026-01-01",
      id: regulationId,
      isDemo: false,
      jurisdictionId,
      status: "effective",
      verifiedAt,
    });
    await testDatabase.database.insert(regulationLimits).values({
      applicationScope: "non-road",
      dataSourceId: sourceId,
      id: limitId,
      isDemo: false,
      limitValue: "1.000000",
      pollutantCode: "NOX",
      regulationId,
      unitCode: "g/kWh",
      validFrom: "2026-01-01",
      verifiedAt,
    });
    await testDatabase.database.insert(products).values({
      applicationScopes: ["non-road"],
      dataSourceId: sourceId,
      id: productId,
      isDemo: false,
      modelCode: "NON-DEMO-PARENT",
      name: "Non-demo parent test product",
      powerMaxKw: 200,
      powerMinKw: 100,
      specificationVersion: "test-v1",
      verifiedAt,
    });
    await testDatabase.database.insert(productCertifications).values({
      applicationScope: "non-road",
      dataSourceId: sourceId,
      id: certificationId,
      isDemo: false,
      productId,
      regulationId,
      status: "active",
      verifiedAt,
    });
    await testDatabase.database.insert(marketMetrics).values({
      applicationScope: "non-road",
      countryIso3,
      dataSourceId: sourceId,
      definition: "Non-demo parent reclassification metric.",
      id: marketMetricId,
      isDemo: false,
      methodologyVersion: "test-v1",
      metricCode: "NON_DEMO_PARENT",
      metricName: "Non-demo parent test metric",
      periodEnd: "2026-01-01",
      periodStart: "2025-01-01",
      unitCode: "units",
      valueNumeric: "1.000000",
      verifiedAt,
    });

    const drafts = [
      await governanceRepository.createDraft({
        actor: editor,
        changeReason: "Attempt source reclassification.",
        entityKey: sourceId,
        entityType: "data_source",
        payload: {
          demoNotice: "DEMO ONLY — reclassification test.",
          id: sourceId,
          isDemo: true,
          publishedOn: null,
          publisher: null,
          sourceType: "demo",
          title: "DEMO ONLY — Reclassified source",
          url: null,
          verifiedAt: "2026-08-05T00:00:00.000Z",
        },
      }),
      await governanceRepository.createDraft({
        actor: editor,
        changeReason: "Attempt country reclassification.",
        entityKey: countryIso3,
        entityType: "country",
        payload: {
          dataCoverageStatus: "demo",
          dataSourceId: sourceId,
          isDemo: true,
          iso2: "QZ",
          iso3: countryIso3,
          nameEn: "DEMO ONLY — Reclassified country",
          nameLocal: null,
          regionCode: null,
          subregionCode: null,
          verifiedAt: "2026-08-05T00:00:00.000Z",
        },
      }),
      await governanceRepository.createDraft({
        actor: editor,
        changeReason: "Attempt jurisdiction reclassification.",
        entityKey: jurisdictionId,
        entityType: "jurisdiction",
        payload: {
          code: "NON-DEMO-PARENT",
          countryIso3,
          dataSourceId: sourceId,
          id: jurisdictionId,
          isDemo: true,
          memberships: [
            {
              countryIso3,
              dataSourceId: sourceId,
              isDemo: false,
              validFrom: "2026-01-01",
              validTo: null,
              verifiedAt: "2026-08-05T00:00:00.000Z",
            },
          ],
          name: "DEMO ONLY — Reclassified jurisdiction",
          type: "country",
          verifiedAt: "2026-08-05T00:00:00.000Z",
          websiteUrl: null,
        },
      }),
      await governanceRepository.createDraft({
        actor: editor,
        changeReason: "Attempt product reclassification.",
        entityKey: productId,
        entityType: "product",
        payload: {
          applicationScopes: ["non-road"],
          availableFrom: null,
          availableTo: null,
          dataSourceId: sourceId,
          description: null,
          id: productId,
          isDemo: true,
          modelCode: "NON-DEMO-PARENT",
          name: "DEMO ONLY — Reclassified product",
          parameters: {},
          powerMaxKw: 200,
          powerMinKw: 100,
          specificationVersion: "test-v1",
          verifiedAt: "2026-08-05T00:00:00.000Z",
        },
      }),
      await governanceRepository.createDraft({
        actor: editor,
        changeReason: "Attempt regulation reclassification.",
        entityKey: regulationId,
        entityType: "regulation",
        payload: {
          adoptedOn: null,
          canonicalName: "DEMO ONLY — Reclassified regulation",
          citationCode: "NON-DEMO-PARENT",
          dataSourceId: sourceId,
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          id: regulationId,
          isDemo: true,
          jurisdictionId,
          limits: [
            {
              applicationScope: "non-road",
              dataSourceId: sourceId,
              engineTypeCode: "CI",
              id: "10000000-0000-4000-8000-000000000924",
              isDemo: true,
              limitValue: "1",
              measurementBasis: null,
              pollutantCode: "NOX",
              powerMaxKw: null,
              powerMinKw: null,
              testCycleCode: null,
              unitCode: "g/kWh",
              validFrom: "2026-01-01",
              validTo: null,
              verifiedAt: "2026-08-05T00:00:00.000Z",
            },
          ],
          proposedOn: null,
          status: "effective",
          summary: null,
          verifiedAt: "2026-08-05T00:00:00.000Z",
        },
      }),
    ];

    for (const draft of drafts) {
      await governanceRepository.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Review parent reclassification rejection.",
      });
      await expect(
        governanceRepository.publishDraft({
          actor: reviewer,
          draftId: draft.id,
          reason: "Attempt parent reclassification publication.",
        }),
      ).rejects.toThrow("cannot have active non-demo dependents");
    }

    const [storedSource] = await testDatabase.database
      .select({ isDemo: dataSources.isDemo })
      .from(dataSources)
      .where(eq(dataSources.id, sourceId));
    const [storedCountry] = await testDatabase.database
      .select({ isDemo: countries.isDemo })
      .from(countries)
      .where(eq(countries.iso3, countryIso3));
    expect(storedSource?.isDemo).toBe(false);
    expect(storedCountry?.isDemo).toBe(false);
  });

  it("serializes parent Demo reclassification against child publication", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const sourceId = "10000000-0000-4000-8000-000000000925";
    const productId = "10000000-0000-4000-8000-000000000926";
    const verifiedAt = "2026-08-05T00:00:00.000Z";

    await testDatabase.database.insert(dataSources).values({
      id: sourceId,
      isDemo: false,
      sourceType: "other",
      title: "Concurrent classification source",
      verifiedAt: new Date(verifiedAt),
    });
    const sourceDraft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Race source reclassification against product publication.",
      entityKey: sourceId,
      entityType: "data_source",
      payload: {
        demoNotice: "DEMO ONLY — concurrent classification test.",
        id: sourceId,
        isDemo: true,
        publishedOn: null,
        publisher: null,
        sourceType: "demo",
        title: "DEMO ONLY — Concurrent classification source",
        url: null,
        verifiedAt,
      },
    });
    const productDraft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Race product publication against source reclassification.",
      entityKey: productId,
      entityType: "product",
      payload: {
        applicationScopes: ["non-road"],
        availableFrom: null,
        availableTo: null,
        dataSourceId: sourceId,
        description: null,
        id: productId,
        isDemo: false,
        modelCode: "CONCURRENT-CLASSIFICATION",
        name: "Concurrent classification product",
        parameters: {},
        powerMaxKw: 200,
        powerMinKw: 100,
        specificationVersion: "test-v1",
        verifiedAt,
      },
    });
    for (const draft of [sourceDraft, productDraft]) {
      await governanceRepository.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "Review concurrent classification test.",
      });
    }

    const results = await Promise.allSettled([
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: sourceDraft.id,
        reason: "Attempt concurrent source reclassification.",
      }),
      governanceRepository.publishDraft({
        actor: reviewer,
        draftId: productDraft.id,
        reason: "Attempt concurrent product publication.",
      }),
    ]);
    const [storedSource] = await testDatabase.database
      .select({ isDemo: dataSources.isDemo })
      .from(dataSources)
      .where(eq(dataSources.id, sourceId));
    const [storedProduct] = await testDatabase.database
      .select({ isDemo: products.isDemo })
      .from(products)
      .where(eq(products.id, productId));

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(
      storedSource?.isDemo === true
        ? storedProduct === undefined
        : storedProduct?.isDemo === false,
    ).toBe(true);
  });

  it("records before and after evidence when a regulation version is changed", async () => {
    const governanceRepository = createGovernanceRepository(
      testDatabase.database,
    );
    const editor = {
      email: "editor@example.test",
      role: "editor" as const,
    };
    const reviewer = {
      email: "reviewer@example.test",
      role: "reviewer" as const,
    };
    const draft = await governanceRepository.createDraft({
      actor: editor,
      changeReason: "Revise a fictional regulation for audit testing.",
      entityKey: demoIds.regulation.chinaEffective,
      entityType: "regulation",
      payload: {
        adoptedOn: "2024-06-01",
        canonicalName:
          "DEMO ONLY — Fictional China Non-road Stage A audited revision",
        citationCode: "DEMO-CHN-NR-A",
        dataSourceId: demoIds.source.regulation,
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        id: demoIds.regulation.chinaEffective,
        isDemo: true,
        jurisdictionId: demoIds.jurisdiction.china,
        limits: [
          {
            applicationScope: "non-road",
            dataSourceId: demoIds.source.regulation,
            engineTypeCode: "CI",
            id: "00000000-0000-4000-8000-000000000991",
            isDemo: true,
            limitValue: "3.5",
            measurementBasis: "DEMO ONLY — fictional test basis",
            pollutantCode: "NOX",
            powerMaxKw: 560,
            powerMinKw: 0,
            testCycleCode: "DEMO-CYCLE-A",
            unitCode: "g/kWh",
            validFrom: "2025-01-01",
            validTo: null,
            verifiedAt: "2026-07-29T00:00:00.000Z",
          },
        ],
        proposedOn: null,
        status: "effective",
        summary: "FICTIONAL DEMO DATA — NOT FOR PRODUCTION.",
        verifiedAt: "2026-07-29T00:00:00.000Z",
      },
    });
    await governanceRepository.reviewDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Review the fictional regulation revision.",
    });
    await governanceRepository.publishDraft({
      actor: reviewer,
      draftId: draft.id,
      reason: "Publish the audited fictional regulation revision.",
    });

    const [publishedAudit] = await testDatabase.database
      .select()
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.draftId, draft.id),
          eq(dataChangeLogs.action, "published"),
        ),
      );

    expect(publishedAudit?.beforeData).toMatchObject({
      regulation: {
        canonicalName: "DEMO ONLY — Fictional China Non-road Stage A",
      },
    });
    expect(publishedAudit?.afterData).toMatchObject({
      canonicalName:
        "DEMO ONLY — Fictional China Non-road Stage A audited revision",
    });
  });
});
