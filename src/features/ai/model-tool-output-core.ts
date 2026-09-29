import "server-only";

import { z } from "zod";

import {
  type AiCitation,
} from "@/features/ai/schemas";
import { citationLocatorDescriptorSchema } from "@/features/ai/citation-locator";
import { citationTitleDescriptorSchema } from "@/features/ai/citation-title";
import {
  citationHasPairedEntityIdentity,
  evidenceEntityTypes,
  latestVerifiedAtFromCitations,
} from "@/features/ai/evidence-semantics";
import {
  httpUrlSchema,
  iso3Schema,
  isoDateSchema,
} from "@/features/database/schemas";

export const SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION =
  "sales-chat-model-tool-output-v4";
export const SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES = 48_000;
export const SALES_CHAT_MODEL_TOOL_RESULTS_MAX_PER_STEP = 8;
export const SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES_PER_STEP = 96_000;
export const SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES_PER_TURN = 128_000;

export const modelToolOutputSourceSchema = z
  .object({
    id: z.uuid(),
    isDemo: z.boolean(),
    title: z.string().trim().min(1),
    url: httpUrlSchema.nullable(),
    verifiedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const modelToolOutputCitationSchema = z
  .object({
    chunkId: z.uuid().optional(),
    countryIso3: iso3Schema.optional(),
    documentId: z.uuid().optional(),
    entityId: z.uuid().optional(),
    entityType: z.enum(evidenceEntityTypes).optional(),
    isDemo: z.boolean(),
    locator: z.string().trim().min(1).optional(),
    locatorDescriptor: citationLocatorDescriptorSchema.optional(),
    pageFrom: z.number().int().positive().optional(),
    pageTo: z.number().int().positive().optional(),
    productCertificationId: z.uuid().optional(),
    publishedOn: isoDateSchema.optional(),
    regulationId: z.uuid().optional(),
    regulationStatus: z
      .enum(["proposed", "adopted", "effective", "superseded"])
      .optional(),
    sectionLocator: z.string().trim().min(1).optional(),
    sourceId: z.uuid(),
    title: z.string().trim().min(1),
    titleDescriptor: citationTitleDescriptorSchema.optional(),
  })
  .strict()
  .superRefine((citation, context) => {
    if (!citationHasPairedEntityIdentity(citation)) {
      context.addIssue({
        code: "custom",
        message: "Citation entityType and entityId must appear together",
        path: ["entityId"],
      });
    }
    if (
      citation.pageTo !== undefined &&
      (citation.pageFrom === undefined || citation.pageTo < citation.pageFrom)
    ) {
      context.addIssue({
        code: "custom",
        message: "pageTo requires an earlier or equal pageFrom",
        path: ["pageTo"],
      });
    }
    if (
      citation.productCertificationId !== undefined &&
      (citation.entityType !== "product_certification" ||
        citation.entityId !== citation.productCertificationId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Certification citation identities must agree",
        path: ["productCertificationId"],
      });
    }
  });

export const modelToolOutputEnvelopeSchema = z
  .object({
    citations: z.array(modelToolOutputCitationSchema),
    evidenceSufficient: z.boolean(),
    informationAsOf: isoDateSchema,
    latestVerifiedAt: z.iso.datetime({ offset: true }).nullable(),
    projectionVersion: z.literal(SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION),
    sources: z.array(modelToolOutputSourceSchema),
    status: z.enum(["ok", "no_data", "error"]),
    warnings: z.array(z.string()),
  })
  .strict();

export type ModelToolOutputCitation = z.infer<
  typeof modelToolOutputCitationSchema
>;
export type ModelToolOutputSource = z.infer<typeof modelToolOutputSourceSchema>;

export function exactModelToolOutputValue(
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function exactModelToolOutputSequence<T>(
  actual: readonly T[],
  expected: readonly T[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export function modelToolOutputUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function refineModelToolOutputSize(
  output: unknown,
  context: z.RefinementCtx,
): void {
  if (
    modelToolOutputUtf8Bytes(output) >
    SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES
  ) {
    context.addIssue({
      code: "custom",
      message: `Model tool output exceeds ${SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES} UTF-8 bytes`,
    });
  }
}

export function compactModelToolOutputCitations(
  citations: readonly AiCitation[],
): ModelToolOutputCitation[] {
  return citations.map((citation) => ({
    ...(citation.chunkId === null ? {} : { chunkId: citation.chunkId }),
    ...(citation.countryIso3 === null
      ? {}
      : { countryIso3: citation.countryIso3 }),
    ...(citation.documentId === null
      ? {}
      : { documentId: citation.documentId }),
    ...(citation.entityId == null || citation.entityType == null
      ? {}
      : { entityId: citation.entityId, entityType: citation.entityType }),
    isDemo: citation.isDemo,
    ...(citation.locator === null || citation.locatorDescriptor != null
      ? {}
      : { locator: citation.locator }),
    ...(citation.locatorDescriptor == null
      ? {}
      : { locatorDescriptor: citation.locatorDescriptor }),
    ...(citation.pageFrom === null ? {} : { pageFrom: citation.pageFrom }),
    ...(citation.pageTo === null ? {} : { pageTo: citation.pageTo }),
    ...(citation.productCertificationId === null
      ? {}
      : { productCertificationId: citation.productCertificationId }),
    ...(citation.publishedOn === null
      ? {}
      : { publishedOn: citation.publishedOn }),
    ...(citation.regulationId === null
      ? {}
      : { regulationId: citation.regulationId }),
    ...(citation.regulationStatus === null
      ? {}
      : { regulationStatus: citation.regulationStatus }),
    ...(citation.sectionLocator === null
      ? {}
      : { sectionLocator: citation.sectionLocator }),
    sourceId: citation.sourceId,
    title: citation.title,
    ...(citation.titleDescriptor == null
      ? {}
      : { titleDescriptor: citation.titleDescriptor }),
  }));
}

export function modelToolOutputSourceRegistry(
  citations: readonly AiCitation[],
): ModelToolOutputSource[] {
  const sources = new Map<string, ModelToolOutputSource>();
  for (const citation of citations) {
    const existing = sources.get(citation.sourceId);
    if (
      existing !== undefined &&
      (existing.title !== citation.sourceTitle ||
        existing.url !== citation.sourceUrl ||
        existing.verifiedAt !== citation.verifiedAt)
    ) {
      throw new Error("Conflicting model tool-output source metadata");
    }
    sources.set(citation.sourceId, {
      id: citation.sourceId,
      isDemo: existing?.isDemo === true || citation.isDemo,
      title: citation.sourceTitle,
      url: citation.sourceUrl,
      verifiedAt: citation.verifiedAt,
    });
  }
  return [...sources.values()];
}

function duplicateStrings(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export function refineModelToolOutputEnvelope(
  output: {
    citations: readonly ModelToolOutputCitation[];
    evidenceSufficient: boolean;
    latestVerifiedAt: string | null;
    sources: readonly ModelToolOutputSource[];
    status: "error" | "no_data" | "ok";
  },
  context: z.RefinementCtx,
): void {
  if ((output.status === "ok") !== output.evidenceSufficient) {
    context.addIssue({
      code: "custom",
      message: "Model tool-output status must match evidence sufficiency",
      path: ["status"],
    });
  }
  if (output.evidenceSufficient && output.citations.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Sufficient model tool output requires citations",
      path: ["citations"],
    });
  }

  const sourceIds = output.sources.map(({ id }) => id);
  const citationSourceIds = [...new Set(output.citations.map(({ sourceId }) => sourceId))];
  if (
    duplicateStrings(sourceIds) ||
    !exactModelToolOutputSequence(sourceIds, citationSourceIds)
  ) {
    context.addIssue({
      code: "custom",
      message: "Model tool-output sources must exactly follow citation order",
      path: ["sources"],
    });
  }

  const sourcesById = new Map(output.sources.map((source) => [source.id, source]));
  if (
    output.citations.some(({ sourceId }) => !sourcesById.has(sourceId)) ||
    latestVerifiedAtFromCitations(output.sources) !== output.latestVerifiedAt
  ) {
    context.addIssue({
      code: "custom",
      message: "Model tool-output source or freshness closure is inconsistent",
      path: ["latestVerifiedAt"],
    });
  }

  if (
    output.status === "error" &&
    (output.citations.length !== 0 ||
      output.sources.length !== 0 ||
      output.latestVerifiedAt !== null)
  ) {
    context.addIssue({
      code: "custom",
      message: "Failed model tool output may not expose evidence",
      path: ["status"],
    });
  }
}

export function modelToolOutputFactSourceClosureMatches(
  factSourceIds: readonly string[],
  citations: readonly ModelToolOutputCitation[],
): boolean {
  const expected = new Set(factSourceIds);
  const actual = new Set(citations.map(({ sourceId }) => sourceId));
  return (
    actual.size === expected.size &&
    [...actual].every((sourceId) => expected.has(sourceId))
  );
}
