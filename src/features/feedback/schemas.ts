import { z } from "zod";

/** Customer-feedback vocabulary. The model picks from these lists; people confirm. */
export const feedbackCategories = [
  "failure",
  "quality",
  "performance_request",
  "service_parts",
  "commercial",
  "documentation",
  "other",
] as const;
export const feedbackSystems = [
  "intake",
  "exhaust",
  "aftertreatment",
  "fuel",
  "cooling",
  "lubrication",
  "electronics",
  "power_output",
  "structure",
  "other",
] as const;
export const feedbackSeverities = ["low", "medium", "high", "safety"] as const;
export const feedbackSourceKinds = ["chat_screenshot", "paper_photo", "pdf", "email", "text"] as const;
export const feedbackPowerUnits = ["kW", "hp", "PS"] as const;

export const feedbackCategorySchema = z.enum(feedbackCategories);
export const feedbackSystemSchema = z.enum(feedbackSystems);
export const feedbackSeveritySchema = z.enum(feedbackSeverities);
export const feedbackSourceKindSchema = z.enum(feedbackSourceKinds);
export const feedbackPowerUnitSchema = z.enum(feedbackPowerUnits);

export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;
export type FeedbackSystem = z.infer<typeof feedbackSystemSchema>;
export type FeedbackSeverity = z.infer<typeof feedbackSeveritySchema>;
export type FeedbackSourceKind = z.infer<typeof feedbackSourceKindSchema>;
export type FeedbackPowerUnit = z.infer<typeof feedbackPowerUnitSchema>;

export const FEEDBACK_EXTRACTION_SCHEMA_VERSION = "engine-feedback-v1";
export const MAX_FEEDBACK_ITEMS_PER_BATCH = 20;
export const MAX_FEEDBACK_TAGS = 5;

const shortText = (max: number) => z.string().trim().min(1).max(max);
const tagsSchema = z.array(shortText(20)).max(MAX_FEEDBACK_TAGS);
const languageSchema = z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/u);

/**
 * What the model may say about one piece of feedback: mentions and wording
 * copied from the source, plus suggested categories. Model codes, countries,
 * unit conversion and catalogue ids are resolved by the server.
 */
export const feedbackExtractionItemSchema = z.object({
  modelMention: shortText(60).nullable().describe("Engine model or series exactly as written in the source, or null."),
  countryMention: shortText(60).nullable().describe("Country or market exactly as written in the source, or null."),
  occurredOn: z.iso.date().nullable().describe("Date the problem happened, only when the source states it."),
  category: feedbackCategorySchema,
  system: feedbackSystemSchema,
  component: shortText(80).nullable().describe("Specific part, e.g. intake pipe, in the source language."),
  symptom: shortText(300).describe("One sentence describing what happened, in the source language."),
  customerRequest: shortText(300).nullable().describe("What the customer asks for, or null."),
  requestedPower: z.object({
    value: z.number().positive().max(100_000),
    unit: feedbackPowerUnitSchema,
  }).strict().nullable().describe("Power the customer asks for, with the unit written in the source."),
  quantityAffected: z.number().int().positive().max(100_000).nullable(),
  severity: feedbackSeveritySchema,
  tags: tagsSchema.describe("Up to five short labels such as 漏油 or noise."),
  evidenceQuote: shortText(500).describe("The exact words from the source that support this item, without names or phone numbers."),
  sourceLanguage: languageSchema.nullable(),
}).strict();

export const feedbackExtractionSchema = z.object({
  transcript: z.string().max(40_000).describe("Every word visible in the uploaded images, transcribed verbatim. Empty for text-only input."),
  items: z.array(feedbackExtractionItemSchema).max(MAX_FEEDBACK_ITEMS_PER_BATCH),
}).strict();

export type FeedbackExtractionItem = z.infer<typeof feedbackExtractionItemSchema>;
export type FeedbackExtraction = z.infer<typeof feedbackExtractionSchema>;

/** Server-side findings shown on each preview card. */
export const feedbackItemIssueCodes = [
  "evidence_not_found",
  "number_not_in_evidence",
  "model_unmatched",
  "model_ambiguous",
  "country_unmatched",
  "contact_redacted",
] as const;
export const feedbackItemIssueSchema = z.object({
  code: z.enum(feedbackItemIssueCodes),
  message: z.string(),
}).strict();
export type FeedbackItemIssue = z.infer<typeof feedbackItemIssueSchema>;

/** One editable item in a feedback batch, after server-side resolution. */
export const feedbackDraftItemSchema = z.object({
  catalogEngineId: z.uuid().nullable(),
  modelCode: shortText(60).nullable(),
  modelMention: shortText(60).nullable(),
  countryIso3: z.string().regex(/^[A-Z]{3}$/u).nullable(),
  countryMention: shortText(60).nullable(),
  occurredOn: z.iso.date().nullable(),
  category: feedbackCategorySchema,
  system: feedbackSystemSchema,
  component: shortText(80).nullable(),
  symptom: shortText(300),
  customerRequest: shortText(300).nullable(),
  requestedPowerValue: z.number().positive().max(100_000).nullable(),
  requestedPowerUnit: feedbackPowerUnitSchema.nullable(),
  requestedPowerKw: z.number().positive().nullable(),
  quantityAffected: z.number().int().positive().max(100_000).nullable(),
  severity: feedbackSeveritySchema,
  tags: tagsSchema,
  evidenceQuote: shortText(500),
  evidenceVerified: z.boolean(),
  sourceLanguage: languageSchema.nullable(),
}).strict();
export type FeedbackDraftItem = z.infer<typeof feedbackDraftItemSchema>;

export const feedbackPreviewSchema = z.object({
  batchId: z.uuid(),
  schemaVersion: z.literal(FEEDBACK_EXTRACTION_SCHEMA_VERSION),
  sourceKind: feedbackSourceKindSchema,
  transcript: z.string(),
  files: z.array(z.object({
    id: z.uuid(),
    filename: z.string(),
    mediaType: z.string(),
    byteSize: z.number().int().positive(),
  }).strict()),
  items: z.array(z.object({
    item: feedbackDraftItemSchema,
    issues: z.array(feedbackItemIssueSchema),
  }).strict()),
  extractionModel: z.string(),
  /** Choices for the review form: every active engine and every directory country. */
  engineOptions: z.array(z.object({ id: z.uuid(), model: z.string() }).strict()),
  countryOptions: z.array(z.object({ iso3: z.string(), name: z.string() }).strict()),
}).strict();
export type FeedbackPreview = z.infer<typeof feedbackPreviewSchema>;

/** What a person confirms for one item; the server re-validates it. */
export const feedbackConfirmItemSchema = feedbackDraftItemSchema.omit({
  evidenceVerified: true,
  modelCode: true,
  requestedPowerKw: true,
}).extend({ catalogEngineId: z.uuid() }).strict();

export const feedbackConfirmRequestSchema = z.object({
  items: z.array(feedbackConfirmItemSchema).min(1).max(MAX_FEEDBACK_ITEMS_PER_BATCH),
  customerRef: shortText(60).nullable(),
  receivedOn: z.iso.date(),
  publish: z.boolean(),
  reason: shortText(500),
}).strict();
export type FeedbackConfirmRequest = z.infer<typeof feedbackConfirmRequestSchema>;

/** The governed draft payload for one published piece of feedback. */
export const engineFeedbackDraftPayloadObjectSchema = z.object({
  id: z.uuid(),
  catalogEngineId: z.uuid(),
  modelCode: shortText(60),
  countryIso3: z.string().regex(/^[A-Z]{3}$/u).nullable(),
  occurredOn: z.iso.date().nullable(),
  receivedOn: z.iso.date(),
  category: feedbackCategorySchema,
  system: feedbackSystemSchema,
  component: shortText(80).nullable(),
  symptom: shortText(300),
  customerRequest: shortText(300).nullable(),
  tags: tagsSchema,
  requestedPowerValue: z.number().positive().max(100_000).nullable(),
  requestedPowerUnit: feedbackPowerUnitSchema.nullable(),
  requestedPowerKw: z.number().positive().nullable(),
  quantityAffected: z.number().int().positive().max(100_000).nullable(),
  severity: feedbackSeveritySchema,
  evidenceQuote: shortText(500),
  evidenceVerified: z.boolean(),
  sourceKind: feedbackSourceKindSchema,
  sourceLanguage: languageSchema.nullable(),
  sourceBatchId: z.uuid().nullable(),
  customerRef: shortText(60).nullable(),
  isDemo: z.boolean(),
}).strict();

export const engineFeedbackDraftPayloadSchema = engineFeedbackDraftPayloadObjectSchema.superRefine((payload, context) => {
  const powerFields = [payload.requestedPowerValue, payload.requestedPowerUnit, payload.requestedPowerKw];
  if (powerFields.some(value => value === null) && powerFields.some(value => value !== null)) {
    context.addIssue({ code: "custom", message: "Requested power needs a value, unit and kW conversion together.", path: ["requestedPowerValue"] });
  }
  if (payload.occurredOn !== null && payload.occurredOn > payload.receivedOn) {
    context.addIssue({ code: "custom", message: "A problem cannot occur after the feedback was received.", path: ["occurredOn"] });
  }
});
export type EngineFeedbackDraftPayload = z.infer<typeof engineFeedbackDraftPayloadSchema>;

/** Public, read-only feedback record; no customer reference or source files. */
export const publicFeedbackRecordSchema = z.object({
  id: z.uuid(),
  modelCode: z.string(),
  countryIso3: z.string().nullable(),
  occurredOn: z.string().nullable(),
  receivedOn: z.string(),
  category: feedbackCategorySchema,
  system: feedbackSystemSchema,
  component: z.string().nullable(),
  symptom: z.string(),
  customerRequest: z.string().nullable(),
  tags: z.array(z.string()),
  requestedPowerValue: z.number().nullable(),
  requestedPowerUnit: feedbackPowerUnitSchema.nullable(),
  requestedPowerKw: z.number().nullable(),
  quantityAffected: z.number().int().nullable(),
  severity: feedbackSeveritySchema,
  evidenceQuote: z.string(),
  sourceKind: feedbackSourceKindSchema,
  isDemo: z.boolean(),
}).strict();
export type PublicFeedbackRecord = z.infer<typeof publicFeedbackRecordSchema>;

export const feedbackQuerySchema = z.object({
  modelCode: z.string().trim().min(1).max(60).optional(),
  category: feedbackCategorySchema.optional(),
  countryIso3: z.string().regex(/^[A-Z]{3}$/u).optional(),
  severity: feedbackSeveritySchema.optional(),
}).strict();
export type FeedbackQuery = z.infer<typeof feedbackQuerySchema>;
