import "server-only";

import { z } from "zod";

import {
  unwrapUntrustedKnowledgeExcerpt,
  wrapUntrustedKnowledgeExcerpt,
} from "@/domain/knowledge/retrieval-policy";
import {
  getCountryProfileResultSchema,
  searchKnowledgeBaseResultSchema,
} from "@/features/ai/schemas";
import {
  compactModelToolOutputCitations,
  modelToolOutputEnvelopeSchema,
  modelToolOutputFactSourceClosureMatches,
  modelToolOutputSourceRegistry,
  refineModelToolOutputEnvelope,
  refineModelToolOutputSize,
  SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
  type ModelToolOutputCitation,
} from "@/features/ai/model-tool-output-core";
import {
  applicationScopeSchema,
  dataCoverageStatusSchema,
  iso3Schema,
  isoDateSchema,
  marketMetricDecimalSchema,
} from "@/features/database/schemas";
import { hybridSearchQuerySchema } from "@/features/knowledge/schemas";
import {
  countryProfileTopicSchema,
} from "@/features/ai/schemas";

const isoTimestampSchema = z.iso.datetime({ offset: true });
type KnowledgeProjectionFilters = Omit<
  z.infer<typeof hybridSearchQuerySchema>,
  "query"
>;

const knowledgeProjectionResultSchema = z
  .object({
    applicationScope: applicationScopeSchema.nullable(),
    chunkId: z.uuid(),
    content: z.string(),
    countryIso3: iso3Schema.nullable(),
    document: z
      .object({
        id: z.uuid(),
        publishedOn: isoDateSchema.nullable(),
        sourceId: z.uuid(),
        title: z.string().trim().min(1),
      })
      .strict(),
    headingPath: z.array(z.string()).nullable(),
    jurisdiction: z
      .object({ id: z.uuid(), name: z.string().trim().min(1) })
      .strict()
      .nullable(),
    pageFrom: z.number().int().positive().nullable(),
    pageTo: z.number().int().positive().nullable(),
    rank: z.number().int().positive(),
    sectionLocator: z.string().nullable(),
    validFrom: isoDateSchema.nullable(),
    validTo: isoDateSchema.nullable(),
    warnings: z.array(z.string()),
  })
  .strict();

function knowledgeCitationMatchesResult(
  citation: ModelToolOutputCitation,
  result: z.infer<typeof knowledgeProjectionResultSchema>,
): boolean {
  return (
    citation.chunkId === result.chunkId &&
    citation.documentId === result.document.id &&
    citation.sourceId === result.document.sourceId &&
    citation.countryIso3 === (result.countryIso3 ?? undefined) &&
    citation.pageFrom === (result.pageFrom ?? undefined) &&
    citation.pageTo === (result.pageTo ?? undefined) &&
    citation.sectionLocator === (result.sectionLocator ?? undefined) &&
    citation.title === result.document.title
  );
}

function refineKnowledgeProjection(
  output: {
    citations: readonly ModelToolOutputCitation[];
    evidenceSufficient: boolean;
    informationAsOf: string;
    resolvedCountryIso3: string | null;
    search: {
      filters: KnowledgeProjectionFilters;
      query: string;
      results: z.infer<typeof knowledgeProjectionResultSchema>[];
    };
    status: "error" | "no_data" | "ok";
  },
  context: z.RefinementCtx,
): void {
  const { filters, results } = output.search;
  const expectedEvidence = results.length > 0 && output.citations.length > 0;
  if (
    output.evidenceSufficient !== expectedEvidence ||
    output.status !== (expectedEvidence ? "ok" : output.status === "error" ? "error" : "no_data")
  ) {
    context.addIssue({
      code: "custom",
      message: "Knowledge projection status does not match its facts",
      path: ["status"],
    });
  }
  if (
    filters.countryIso3 !== output.resolvedCountryIso3 ||
    filters.asOf !== output.informationAsOf ||
    results.length > filters.limit
  ) {
    context.addIssue({
      code: "custom",
      message: "Knowledge projection query does not match its result envelope",
      path: ["search", "filters"],
    });
  }

  for (const [index, result] of results.entries()) {
    const unwrapped = unwrapUntrustedKnowledgeExcerpt(result.content);
    const filterMismatch =
      (filters.countryIso3 !== null &&
        result.countryIso3 !== filters.countryIso3) ||
      (filters.applicationScope !== null &&
        result.applicationScope !== filters.applicationScope) ||
      (filters.jurisdictionId !== null &&
        result.jurisdiction?.id !== filters.jurisdictionId) ||
      (filters.asOf !== null &&
        ((result.validFrom !== null && result.validFrom > filters.asOf) ||
          (result.validTo !== null && result.validTo <= filters.asOf)));
    if (
      result.rank !== index + 1 ||
      filterMismatch ||
      unwrapped === result.content ||
      wrapUntrustedKnowledgeExcerpt(unwrapped) !== result.content ||
      output.citations.filter((citation) =>
        knowledgeCitationMatchesResult(citation, result),
      ).length !== 1
    ) {
      context.addIssue({
        code: "custom",
        message: "Knowledge result is outside its query, trust, rank, or citation boundary",
        path: ["search", "results", index],
      });
    }
  }
  if (
    output.citations.some(
      (citation) =>
        !results.some((result) => knowledgeCitationMatchesResult(citation, result)),
    ) ||
    !modelToolOutputFactSourceClosureMatches(
      results.map(({ document }) => document.sourceId),
      output.citations,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Knowledge citations do not exactly cover visible results",
      path: ["citations"],
    });
  }
}

export const searchKnowledgeBaseModelToolOutputSchema =
  modelToolOutputEnvelopeSchema
    .extend({
      resolvedCountryIso3: iso3Schema.nullable(),
      search: z
        .object({
          filters: hybridSearchQuerySchema.omit({ query: true }),
          query: hybridSearchQuerySchema.shape.query,
          results: z.array(knowledgeProjectionResultSchema),
        })
        .strict(),
      tool: z.literal("searchKnowledgeBase"),
    })
    .strict()
    .superRefine(refineModelToolOutputEnvelope)
    .superRefine(refineKnowledgeProjection)
    .superRefine(refineModelToolOutputSize);

const countryIdentitySchema = z
  .object({
    isDemo: z.boolean(),
    iso2: z.string().length(2).regex(/^[A-Z]{2}$/u),
    iso3: iso3Schema,
    nameEn: z.string().trim().min(1),
    nameLocal: z.string().nullable(),
    sourceId: z.uuid(),
  })
  .strict();

const countryTopicSchema = z
  .object({
    dataCoverageStatus: dataCoverageStatusSchema,
    isStale: z.boolean(),
    lastVerifiedAt: isoTimestampSchema,
    regionCode: z.string().nullable(),
    subregionCode: z.string().nullable(),
    verifiedAt: isoTimestampSchema,
  })
  .strict();

const countryJurisdictionProjectionSchema = z
  .object({
    code: z.string().trim().min(1),
    id: z.uuid(),
    isDemo: z.boolean(),
    membershipIsDemo: z.boolean(),
    membershipSourceId: z.uuid(),
    name: z.string().trim().min(1),
    sourceId: z.uuid(),
    type: z.enum(["country", "regional", "international"]),
    validFrom: isoDateSchema,
    validTo: isoDateSchema.nullable(),
  })
  .strict();

const countryRegulationProjectionSchema = z
  .object({
    adoptedOn: isoDateSchema.nullable(),
    applicability: z
      .object({
        countryIso3: iso3Schema,
        jurisdiction: z
          .object({
            code: z.string().trim().min(1),
            id: z.uuid(),
            isDemo: z.boolean(),
            name: z.string().trim().min(1),
            sourceId: z.uuid(),
          })
          .strict(),
        membership: z
          .object({
            isDemo: z.boolean(),
            sourceId: z.uuid(),
            validFrom: isoDateSchema,
            validTo: isoDateSchema.nullable(),
          })
          .strict(),
      })
      .strict(),
    canonicalName: z.string().trim().min(1),
    citationCode: z.string().nullable(),
    effectiveFrom: isoDateSchema.nullable(),
    effectiveTo: isoDateSchema.nullable(),
    id: z.uuid(),
    isDemo: z.boolean(),
    proposedOn: isoDateSchema.nullable(),
    sourceId: z.uuid(),
    status: z.enum(["proposed", "adopted", "effective", "superseded"]),
    statusAtAsOf: z.enum(["adopted", "effective"]),
  })
  .strict();

const countryMarketMetricProjectionSchema = z
  .object({
    applicationScope: applicationScopeSchema.nullable(),
    countryIso3: iso3Schema,
    currencyCode: z.string().length(3).regex(/^[A-Z]{3}$/u).nullable(),
    definition: z.string(),
    id: z.uuid(),
    isDemo: z.boolean(),
    methodologyVersion: z.string(),
    metricCode: z.string(),
    metricName: z.string(),
    periodEnd: isoDateSchema,
    periodStart: isoDateSchema,
    publishedOn: isoDateSchema.nullable(),
    sourceId: z.uuid(),
    unitCode: z.string(),
    valueNumeric: marketMetricDecimalSchema,
  })
  .strict();

const countryProjectionProfileSchema = z.discriminatedUnion("status", [
  z.object({ iso3: iso3Schema, status: z.literal("no_data") }).strict(),
  z
    .object({
      asOf: isoDateSchema,
      country: countryTopicSchema.optional(),
      identity: countryIdentitySchema,
      market: z
        .object({ metrics: z.array(countryMarketMetricProjectionSchema) })
        .strict()
        .optional(),
      regulations: z
        .object({
          currentEffective: z.array(countryRegulationProjectionSchema),
          futureAdopted: z.array(countryRegulationProjectionSchema),
          jurisdictions: z.array(countryJurisdictionProjectionSchema),
        })
        .strict()
        .optional(),
      status: z.literal("available"),
    })
    .strict(),
]);

type CountryProjectionProfile = z.infer<typeof countryProjectionProfileSchema>;

function countryProjectionFactSourceIds(profile: CountryProjectionProfile): string[] {
  if (profile.status === "no_data") return [];
  const sourceIds = [profile.identity.sourceId];
  if (profile.regulations) {
    for (const jurisdiction of profile.regulations.jurisdictions) {
      sourceIds.push(jurisdiction.sourceId, jurisdiction.membershipSourceId);
    }
    for (const regulation of [
      ...profile.regulations.currentEffective,
      ...profile.regulations.futureAdopted,
    ]) {
      sourceIds.push(
        regulation.sourceId,
        regulation.applicability.jurisdiction.sourceId,
        regulation.applicability.membership.sourceId,
      );
    }
  }
  if (profile.market) {
    sourceIds.push(...profile.market.metrics.map(({ sourceId }) => sourceId));
  }
  return sourceIds;
}

function countryCitationMatchesFact(
  citation: ModelToolOutputCitation,
  profile: CountryProjectionProfile,
): boolean {
  if (profile.status === "no_data") return false;
  if (
    citation.entityType === undefined &&
    citation.countryIso3 === profile.identity.iso3 &&
    citation.sourceId === profile.identity.sourceId
  ) {
    return true;
  }
  if (
    profile.market?.metrics.some(
      (metric) =>
        citation.entityType === "market_metric" &&
        citation.entityId === metric.id &&
        citation.countryIso3 === metric.countryIso3 &&
        citation.sourceId === metric.sourceId,
    )
  ) {
    return true;
  }
  for (const jurisdiction of profile.regulations?.jurisdictions ?? []) {
    if (
      citation.countryIso3 === profile.identity.iso3 &&
      citation.regulationId === undefined &&
      citation.entityId === jurisdiction.id &&
      ((citation.entityType === "jurisdiction" &&
        citation.sourceId === jurisdiction.sourceId) ||
        (citation.entityType === "country_jurisdiction" &&
          citation.sourceId === jurisdiction.membershipSourceId))
    ) {
      return true;
    }
  }
  for (const regulation of [
    ...(profile.regulations?.currentEffective ?? []),
    ...(profile.regulations?.futureAdopted ?? []),
  ]) {
    if (
      citation.countryIso3 !== profile.identity.iso3 ||
      citation.regulationId !== regulation.id
    ) {
      continue;
    }
    if (
      citation.entityType === "regulation" &&
      citation.entityId === regulation.id &&
      citation.sourceId === regulation.sourceId
    ) {
      return true;
    }
    if (
      citation.entityId === regulation.applicability.jurisdiction.id &&
      ((citation.entityType === "jurisdiction" &&
        citation.sourceId === regulation.applicability.jurisdiction.sourceId) ||
        (citation.entityType === "country_jurisdiction" &&
          citation.sourceId === regulation.applicability.membership.sourceId))
    ) {
      return true;
    }
  }
  return false;
}

function refineCountryProjection(
  output: {
    citations: readonly ModelToolOutputCitation[];
    evidenceSufficient: boolean;
    informationAsOf: string;
    profile: CountryProjectionProfile | null;
    requestedTopics: readonly ("country" | "market" | "regulations")[];
    resolvedCountryIso3: string | null;
    status: "error" | "no_data" | "ok";
  },
  context: z.RefinementCtx,
): void {
  const availableProfile =
    output.profile?.status === "available" ? output.profile : null;
  const available = availableProfile !== null;
  const requestedCountry = output.requestedTopics.includes("country");
  const requestedMarket = output.requestedTopics.includes("market");
  const requestedRegulations = output.requestedTopics.includes("regulations");
  const topicsMatch =
    availableProfile !== null &&
    (availableProfile.country !== undefined) === requestedCountry &&
    (availableProfile.market !== undefined) === requestedMarket &&
    (availableProfile.regulations !== undefined) === requestedRegulations;
  const factsSufficient =
    availableProfile !== null &&
    topicsMatch &&
    (!requestedMarket || availableProfile.market!.metrics.length > 0) &&
    (!requestedRegulations ||
      availableProfile.regulations!.currentEffective.length > 0 ||
      availableProfile.regulations!.futureAdopted.length > 0) &&
    output.citations.length > 0;
  if (
    output.evidenceSufficient !== factsSufficient ||
    output.status !== (factsSufficient ? "ok" : output.status === "error" ? "error" : "no_data")
  ) {
    context.addIssue({
      code: "custom",
      message: "Country projection status does not match requested facts",
      path: ["status"],
    });
  }
  if (
    availableProfile !== null &&
    (availableProfile.asOf !== output.informationAsOf ||
      availableProfile.identity.iso3 !== output.resolvedCountryIso3)
  ) {
    context.addIssue({
      code: "custom",
      message: "Country projection query does not match its profile",
      path: ["profile"],
    });
  }
  if (!available && output.profile?.status === "no_data") {
    if (output.resolvedCountryIso3 !== output.profile.iso3) {
      context.addIssue({
        code: "custom",
        message: "No-data country profile does not match the resolved country",
        path: ["profile", "iso3"],
      });
    }
  }
  if (!topicsMatch && available) {
    context.addIssue({
      code: "custom",
      message: "Country projection exposed an unrequested topic",
      path: ["requestedTopics"],
    });
  }
  if (
    output.profile !== null &&
    (output.citations.some(
      (citation) => !countryCitationMatchesFact(citation, output.profile!),
    ) ||
      !modelToolOutputFactSourceClosureMatches(
        countryProjectionFactSourceIds(output.profile),
        output.citations,
      ))
  ) {
    context.addIssue({
      code: "custom",
      message: "Country citations do not exactly cover visible facts",
      path: ["citations"],
    });
  }
}

export const getCountryProfileModelToolOutputSchema =
  modelToolOutputEnvelopeSchema
    .extend({
      profile: countryProjectionProfileSchema.nullable(),
      requestedTopics: z
        .array(countryProfileTopicSchema)
        .min(1)
        .max(3)
        .refine((topics) => new Set(topics).size === topics.length),
      resolvedCountryIso3: iso3Schema.nullable(),
      tool: z.literal("getCountryProfile"),
    })
    .strict()
    .superRefine(refineModelToolOutputEnvelope)
    .superRefine(refineCountryProjection)
    .superRefine(refineModelToolOutputSize);

export function searchKnowledgeBaseResultToModelOutput(output: unknown) {
  const result = searchKnowledgeBaseResultSchema.parse(output);
  const citations = compactModelToolOutputCitations(result.citations);
  const sources = modelToolOutputSourceRegistry(result.citations);
  return searchKnowledgeBaseModelToolOutputSchema.parse({
    citations,
    evidenceSufficient: result.evidenceSufficient,
    informationAsOf: result.informationAsOf,
    latestVerifiedAt: result.latestVerifiedAt,
    projectionVersion: SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
    resolvedCountryIso3: result.resolvedCountryIso3,
    search: {
      filters: result.search.filters,
      query: result.search.query,
      results: result.search.results.map((searchResult) => ({
        applicationScope: searchResult.applicationScope,
        chunkId: searchResult.chunkId,
        content: searchResult.content,
        countryIso3: searchResult.countryIso3,
        document: {
          id: searchResult.document.id,
          publishedOn: searchResult.document.publishedOn,
          sourceId: searchResult.document.source.id,
          title: searchResult.document.title,
        },
        headingPath: searchResult.headingPath,
        jurisdiction: searchResult.jurisdiction,
        pageFrom: searchResult.pageFrom,
        pageTo: searchResult.pageTo,
        rank: searchResult.rank,
        sectionLocator: searchResult.sectionLocator,
        validFrom: searchResult.validFrom,
        validTo: searchResult.validTo,
        warnings: searchResult.warnings,
      })),
    },
    sources,
    status: result.status,
    tool: result.tool,
    warnings: result.warnings,
  });
}

type AvailableCountryProfile = Extract<
  NonNullable<z.infer<typeof getCountryProfileResultSchema>["profile"]>,
  { status: "available" }
>;
type ProfileRegulation =
  | AvailableCountryProfile["country"]["currentEffectiveRegulations"][number]
  | AvailableCountryProfile["country"]["futureAdoptedRegulations"][number];

function projectCountryRegulation(
  regulation: ProfileRegulation,
) {
  return {
    adoptedOn: regulation.adoptedOn,
    applicability: {
      countryIso3: regulation.applicability.countryIso3,
      jurisdiction: {
        code: regulation.applicability.jurisdiction.code,
        id: regulation.applicability.jurisdiction.id,
        isDemo: regulation.applicability.jurisdiction.isDemo,
        name: regulation.applicability.jurisdiction.name,
        sourceId: regulation.applicability.jurisdiction.source.id,
      },
      membership: {
        isDemo: regulation.applicability.membership.isDemo,
        sourceId: regulation.applicability.membership.source.id,
        validFrom: regulation.applicability.membership.validFrom,
        validTo: regulation.applicability.membership.validTo,
      },
    },
    canonicalName: regulation.canonicalName,
    citationCode: regulation.citationCode,
    effectiveFrom: regulation.effectiveFrom,
    effectiveTo: regulation.effectiveTo,
    id: regulation.id,
    isDemo: regulation.isDemo,
    proposedOn: regulation.proposedOn,
    sourceId: regulation.source.id,
    status: regulation.status,
    statusAtAsOf: regulation.statusAtAsOf,
  };
}

export function getCountryProfileResultToModelOutput(output: unknown) {
  const result = getCountryProfileResultSchema.parse(output);
  if (result.profile?.status !== "available") {
    const citations = compactModelToolOutputCitations(result.citations);
    return getCountryProfileModelToolOutputSchema.parse({
      citations,
      evidenceSufficient: result.evidenceSufficient,
      informationAsOf: result.informationAsOf,
      latestVerifiedAt: result.latestVerifiedAt,
      profile: result.profile,
      projectionVersion: SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
      requestedTopics: result.requestedTopics,
      resolvedCountryIso3: result.resolvedCountryIso3,
      sources: modelToolOutputSourceRegistry(result.citations),
      status: result.status,
      tool: result.tool,
      warnings: result.warnings,
    });
  }

  const { country } = result.profile;
  const includeMarket = result.requestedTopics.includes("market");
  const includeRegulations = result.requestedTopics.includes("regulations");
  const selectedCitations = result.citations.filter((citation) => {
    if (
      citation.entityType == null &&
      citation.sourceId === country.source.id &&
      citation.countryIso3 === country.iso3
    ) {
      return true;
    }
    if (includeMarket && citation.entityType === "market_metric") return true;
    return (
      includeRegulations &&
      (citation.entityType === "regulation" ||
        citation.entityType === "jurisdiction" ||
        citation.entityType === "country_jurisdiction")
    );
  });
  const citations = compactModelToolOutputCitations(selectedCitations);
  const profile: CountryProjectionProfile = {
    asOf: result.profile.asOf,
    ...(result.requestedTopics.includes("country")
      ? {
          country: {
            dataCoverageStatus: country.dataCoverageStatus,
            isStale: country.isStale,
            lastVerifiedAt: country.lastVerifiedAt,
            regionCode: country.regionCode,
            subregionCode: country.subregionCode,
            verifiedAt: country.verifiedAt,
          },
        }
      : {}),
    identity: {
      isDemo: country.isDemo,
      iso2: country.iso2,
      iso3: country.iso3,
      nameEn: country.nameEn,
      nameLocal: country.nameLocal,
      sourceId: country.source.id,
    },
    ...(includeMarket
      ? {
          market: {
            metrics: country.marketMetrics.map((metric) => ({
              applicationScope: metric.applicationScope,
              countryIso3: metric.countryIso3,
              currencyCode: metric.currencyCode,
              definition: metric.definition,
              id: metric.id,
              isDemo: metric.isDemo,
              methodologyVersion: metric.methodologyVersion,
              metricCode: metric.metricCode,
              metricName: metric.metricName,
              periodEnd: metric.periodEnd,
              periodStart: metric.periodStart,
              publishedOn: metric.publishedOn,
              sourceId: metric.source.id,
              unitCode: metric.unitCode,
              valueNumeric: metric.valueNumeric,
            })),
          },
        }
      : {}),
    ...(includeRegulations
      ? {
          regulations: {
            currentEffective: country.currentEffectiveRegulations.map(
              projectCountryRegulation,
            ),
            futureAdopted: country.futureAdoptedRegulations.map(
              projectCountryRegulation,
            ),
            jurisdictions: country.jurisdictions.map((jurisdiction) => ({
              code: jurisdiction.code,
              id: jurisdiction.id,
              isDemo: jurisdiction.isDemo,
              membershipIsDemo: jurisdiction.membershipIsDemo,
              membershipSourceId: jurisdiction.membershipSource.id,
              name: jurisdiction.name,
              sourceId: jurisdiction.source.id,
              type: jurisdiction.type,
              validFrom: jurisdiction.validFrom,
              validTo: jurisdiction.validTo,
            })),
          },
        }
      : {}),
    status: "available",
  };
  return getCountryProfileModelToolOutputSchema.parse({
    citations,
    evidenceSufficient: result.evidenceSufficient,
    informationAsOf: result.informationAsOf,
    latestVerifiedAt: result.latestVerifiedAt,
    profile,
    projectionVersion: SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
    requestedTopics: result.requestedTopics,
    resolvedCountryIso3: result.resolvedCountryIso3,
    sources: modelToolOutputSourceRegistry(selectedCitations),
    status: result.status,
    tool: result.tool,
    warnings: result.warnings,
  });
}
